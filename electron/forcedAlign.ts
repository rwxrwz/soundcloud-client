/* Timing known lyrics against the audio, on this machine.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The other path asks a language model to listen and write down what it
 * hears, then matches those words against the real ones to borrow their
 * times. It works, and it is only ever as good as the hearing. On a muddy
 * mix two thirds of the lines come back unrecognisable, and the lines
 * between the recognised ones are spaced by arithmetic.
 *
 * Forced alignment asks a different question. The acoustic model emits, for
 * every 20ms frame, a probability for each letter of its alphabet plus a
 * blank. The lyrics are a fixed sequence of letters. Alignment is the most
 * likely way to walk the frames while emitting exactly that sequence, in
 * order. The words are not a guess - a word that is in the text cannot come
 * out as another word, because no path through the trellis produces one.
 * Only their position is decided.
 *
 * Measured on the track this was built for, 148s of rap under a loud beat:
 * the spoken intro landed at 1.5s where it belongs, against 52.8s from the
 * listening path, and the first rapped line at 41.5s - the same second at
 * which a transcription run had independently first heard words. Inference
 * ran at about seven times real time on four CPU threads.
 *
 * ── What it does not fix ─────────────────────────────────────────────────
 * If the page's words are not the words in this recording - a different
 * take, a missing verse, a sped-up reupload - the path still has to consume
 * all of them, and it will stretch something to do it. The model is trained
 * on speech, so heavy singing is harder for it than rapping. And finding
 * the right Genius page in the first place is a separate problem that this
 * does not touch. */

import { app } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

/* The int8 export: a quarter the size of the float one and the only
   version worth asking somebody to download. Licensed CC-BY-NC, which is
   why it is fetched rather than shipped. */
const REPO = 'https://huggingface.co/onnx-community/mms-300m-1130-forced-aligner-ONNX/resolve/main'
const MODEL_FILE = 'onnx/model_int8.onnx'
const MODEL_BYTES = 317_341_664
const RATE = 16000
/* Attention is quadratic in length, so the audio goes through in pieces.
   Twenty seconds keeps memory flat and costs nothing in accuracy: a seam
   lands on two frames out of a thousand. */
const CHUNK_SEC = 20
const THREADS = 4

const dir = () => {
  const d = join(app.getPath('userData'), 'align')
  try { mkdirSync(d, { recursive: true }) } catch { /* ignore */ }
  return d
}
const modelFile = () => join(dir(), 'model.onnx')
const vocabFile = () => join(dir(), 'vocab.json')

/** Both files present and the model the size it should be. A truncated
 *  download is worse than none: it fails later, inside the runtime. */
export function alignReady(): boolean {
  try {
    return existsSync(vocabFile()) && statSync(modelFile()).size === MODEL_BYTES
  } catch { return false }
}

/** What the settings card needs to describe the model: whether it is here,
 *  how big it is on disk against how big it should be, and where it lives.
 *  One call, because three separate ones can disagree with each other. */
export function modelInfo(): { have: boolean; bytes: number; total: number; dir: string } {
  let bytes = 0
  try { bytes = statSync(modelFile()).size } catch { /* not there yet */ }
  return { have: alignReady(), bytes, total: MODEL_BYTES, dir: dir() }
}

/* Set while a download is in flight so it can be called off. */
let abort: AbortController | null = null
let cancelled = false

/** Stop a download in progress. Harmless when nothing is running. */
export function cancelFetch(): void {
  cancelled = true
  try { abort?.abort() } catch { /* already gone */ }
}

/** Delete the model. The vocab stays - it is 300KB against 300MB, and
 *  keeping it means a reinstall is one file instead of two. */
/* The session, built once and kept.
 *
 * It used to be created inside alignLocal, so every track parsed the
 * 317MB model again - 744ms measured - and nothing ever released it.
 * `release()` appeared nowhere in this file, and the native arena behind
 * the small JS handle gives V8 no reason to collect it, so a scan left
 * one live session per track behind it.
 *
 * Keyed on nothing: the file never changes identity while it exists, and
 * the two things that can invalidate it - deleting the model, quitting -
 * both drop it explicitly below. */
let held: {
  session: import('onnxruntime-node').InferenceSession
  input: string
  output: string
  Tensor: typeof import('onnxruntime-node').Tensor
} | null = null

async function getSession() {
  if (held) return held
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(modelFile(), { intraOpNumThreads: THREADS })
  held = { session, input: session.inputNames[0], output: session.outputNames[0], Tensor: ort.Tensor }
  return held
}

/** Let the model go: before deleting the file it is reading, and on quit. */
export async function releaseSession(): Promise<void> {
  const h = held
  held = null
  try { await h?.session.release() } catch { /* already gone */ }
}

export function removeModel(): boolean {
  // Released first: on Windows the file cannot be unlinked while it is open.
  void releaseSession()
  let gone = false
  for (const f of [modelFile(), modelFile() + '.part']) {
    try { if (existsSync(f)) { unlinkSync(f); gone = true } } catch { /* in use */ }
  }
  return gone
}

export async function fetchModel(onProgress: (done: number, total: number) => void): Promise<void> {
  cancelled = false
  try {
    await runFetch(onProgress)
  } finally {
    abort = null
  }
}

async function runFetch(onProgress: (done: number, total: number) => void): Promise<void> {
  mkdirSync(dir(), { recursive: true })
  abort = new AbortController()
  const { signal } = abort
  if (!existsSync(vocabFile())) {
    const res = await fetch(`${REPO}/vocab.json`, { signal })
    if (!res.ok) throw new Error(`vocab ${res.status}`)
    const text = await res.text()
    JSON.parse(text)                       // refuse to save something unparseable
    await pipeline(Readable.from(text), createWriteStream(vocabFile()))
  }
  if (alignReady()) return

  // Into a temporary name, moved into place only once it is whole.
  const tmp = modelFile() + '.part'
  const res = await fetch(`${REPO}/${MODEL_FILE}`, { signal })
  if (!res.ok || !res.body) throw new Error(`model ${res.status}`)
  const total = Number(res.headers.get('content-length')) || MODEL_BYTES
  let done = 0
  let lastSaid = 0
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  body.on('data', (c: Buffer) => {
    done += c.length
    // A progress event per percent, not per packet.
    if (done - lastSaid > total / 100) { lastSaid = done; onProgress(done, total) }
  })
  try {
    await pipeline(body, createWriteStream(tmp))
  } catch (e) {
    /* A cancelled or broken download leaves a part file behind. Dropping
       it costs the bytes again next time, which is the honest trade until
       this learns to resume. */
    try { unlinkSync(tmp) } catch { /* never got created */ }
    throw e
  }
  if (statSync(tmp).size !== MODEL_BYTES) {
    unlinkSync(tmp)
    throw new Error('model download was truncated')
  }
  renameSync(tmp, modelFile())
  onProgress(total, total)
}

/* The alphabet is 31 symbols of plain Latin, so everything else has to be
   spelled in it. Deterministic and reversible enough for this purpose: the
   aligner only ever compares sounds to letters, and nothing here is shown
   to anybody. */
const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}
const romanise = (s: string) => [...s.toLowerCase()].map(c => (c in RU ? RU[c] : c)).join('')

/** Words of the lyrics, as letters of the model's alphabet, each tagged
 *  with the line it came from. */
function spell(lyrics: string[], ids: Record<string, number>) {
  const words: { line: number; chars: number[] }[] = []
  lyrics.forEach((text, line) => {
    for (const w of romanise(text).replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/)) {
      if (!w) continue
      const chars = [...w].map(c => ids[c]).filter((i): i is number => i !== undefined)
      if (chars.length) words.push({ line, chars })
    }
  })
  return words
}

interface Walked { startOf: Int32Array; score: Float64Array }

/** Standard CTC trellis over the blank-interleaved label sequence, in log
 *  space, with backpointers. Returns the first frame of each label and the
 *  probability the model gave it there. */
function walk(logp: Float64Array, V: number, labels: number[], blank: number): Walked {
  const T = logp.length / V
  const L = labels.length
  const S = 2 * L + 1
  const ext = new Int32Array(S).fill(blank)
  for (let i = 0; i < L; i++) ext[2 * i + 1] = labels[i]

  const NEG = -1e30
  const prev = new Float64Array(S).fill(NEG)
  const cur = new Float64Array(S)
  const back = new Uint8Array(T * S)
  const at = (t: number, v: number) => logp[t * V + v]

  prev[0] = at(0, blank)
  if (S > 1) prev[1] = at(0, ext[1])

  for (let t = 1; t < T; t++) {
    cur.fill(NEG)
    for (let s = 0; s < S; s++) {
      let best = prev[s]
      let from = 0
      if (s >= 1 && prev[s - 1] > best) { best = prev[s - 1]; from = 1 }
      /* The two-step skip is only legal past a blank between two DIFFERENT
         letters - otherwise a doubled letter collapses into one, which is
         the classic way to get this wrong. */
      if (s >= 2 && ext[s] !== blank && ext[s] !== ext[s - 2] && prev[s - 2] > best) {
        best = prev[s - 2]
        from = 2
      }
      if (best <= NEG) continue
      cur[s] = best + at(t, ext[s])
      back[t * S + s] = from
    }
    prev.set(cur)
  }

  const startOf = new Int32Array(L).fill(-1)
  const score = new Float64Array(L)
  let s = prev[S - 1] >= prev[S - 2] ? S - 1 : S - 2
  for (let t = T - 1; t >= 0; t--) {
    if (s % 2 === 1) {
      const i = (s - 1) >> 1
      startOf[i] = t                                   // keeps the EARLIEST frame
      score[i] = Math.exp(at(t, ext[s]))
    }
    if (t === 0) break
    s -= back[t * S + s]
  }
  return { startOf, score }
}

export interface AlignedLine { time: number; text: string }
export interface AlignResult {
  lines: AlignedLine[]
  /** Mean probability the model gave the letters where they were placed:
   *  how much the audio actually supports this text, 0..1. */
  support: number
  seconds: number
}

/**
 * Times for `lyrics` against `pcm` (16 kHz mono). The text is returned
 * untouched - this only ever assigns times.
 */
export async function alignLocal(pcm: Float32Array, lyrics: string[]): Promise<AlignResult> {
  if (!alignReady()) throw new Error('NO_MODEL')
  if (!lyrics.length) return { lines: [], support: 0, seconds: 0 }

  const ids = JSON.parse(readFileSync(vocabFile(), 'utf8')) as Record<string, number>
  const blank = ids['<blank>'] ?? 0
  const words = spell(lyrics, ids)
  if (!words.length) throw new Error('NO_WORDS')

  const { session, input, output, Tensor } = await getSession()

  const step = CHUNK_SEC * RATE
  const parts: { data: Float32Array; frames: number }[] = []
  let V = 0
  for (let off = 0; off < pcm.length; off += step) {
    const slice = pcm.subarray(off, Math.min(off + step, pcm.length))
    if (slice.length < RATE / 2) break
    /* Zero mean, unit variance - what the model's feature extractor does.
       Per chunk rather than per track, which is what it was measured with
       and what keeps a loud passage from flattening a quiet one. */
    let mean = 0
    for (let i = 0; i < slice.length; i++) mean += slice[i]
    mean /= slice.length
    let dev = 0
    for (let i = 0; i < slice.length; i++) { const d = slice[i] - mean; dev += d * d }
    dev = Math.sqrt(dev / slice.length) + 1e-7
    /* Indexed, not `for..of` plus `Float32Array.from(map)`: measured at
       34.5ms a chunk against 1.0ms for this, nine chunks a track, and all
       of it on the main process's own thread while session.run is off on
       the libuv pool. The arithmetic is identical. */
    const inv = 1 / dev
    const norm = new Float32Array(slice.length)
    for (let i = 0; i < slice.length; i++) norm[i] = (slice[i] - mean) * inv

    const res = await session.run({ [input]: new Tensor('float32', norm, [1, norm.length]) })
    const logits = res[output]
    const dims = logits.dims as number[]
    V = dims[2]
    parts.push({ data: logits.data as Float32Array, frames: dims[1] })
  }
  if (!parts.length || !V) throw new Error('NO_AUDIO')

  const frames = parts.reduce((n, p) => n + p.frames, 0)
  const logp = new Float64Array(frames * V)
  let f = 0
  for (const part of parts) {
    for (let t = 0; t < part.frames; t++, f++) {
      let max = -Infinity
      for (let v = 0; v < V; v++) { const x = part.data[t * V + v]; if (x > max) max = x }
      let sum = 0
      for (let v = 0; v < V; v++) sum += Math.exp(part.data[t * V + v] - max)
      const logZ = max + Math.log(sum)
      for (let v = 0; v < V; v++) logp[f * V + v] = part.data[t * V + v] - logZ
    }
  }

  const seconds = pcm.length / RATE
  const secPerFrame = seconds / frames
  const { startOf, score } = walk(logp, V, words.flatMap(w => w.chars), blank)

  // Each line starts with the first letter of its first word.
  const times = new Array<number>(lyrics.length).fill(-1)
  const support = new Array<number>(lyrics.length).fill(0)
  const counted = new Array<number>(lyrics.length).fill(0)
  let k = 0
  for (const w of words) {
    let first = -1
    for (const _ of w.chars) {
      if (startOf[k] >= 0 && first < 0) first = startOf[k]
      support[w.line] += score[k]
      counted[w.line]++
      k++
    }
    if (first >= 0 && times[w.line] < 0) times[w.line] = first * secPerFrame
  }

  let prev = 0
  const lines = lyrics.map((text, i) => {
    const t = Math.min(Math.max(times[i] < 0 ? prev : times[i], prev), seconds)
    prev = Math.round(t * 10) / 10
    return { time: prev, text }
  })
  const total = counted.reduce((a, b) => a + b, 0)
  return {
    lines,
    support: total ? support.reduce((a, b) => a + b, 0) / total : 0,
    seconds,
  }
}

/** For the log line, so two runs of the same track can be told apart. */
export const lyricsHash = (lyrics: string[]) =>
  createHash('sha256').update(lyrics.join('\n')).digest('hex').slice(0, 8)
