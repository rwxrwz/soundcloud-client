import { sc } from './soundcloud'
import { stitchHls } from './mp3Encode'
import { netGetBytes } from './net'
import { useSettings } from '../store'
import { primeLyricsCache, type LyricsResult } from './lyrics'
import { useAiStage } from '../store'
import type { SCTrack } from './soundcloud'

/* The renderer's half of AI lyrics: resolve the stream, ask the main process
 * for a transcript, and hand the result to the ordinary lyrics cache so every
 * view that already knows how to draw lyrics draws these too.
 *
 * Nothing here ever sees the key. It is written once from the settings field
 * straight into the OS keychain and read only in the main process, next to
 * the request that uses it. */


export interface AiError { code: string }

/* What the model said when nothing parsed as lyrics - shown instead of
   guessing on its behalf. Set by the last call; read right after it. */
export let lastNote = ''

/** Where locally aligned lyrics are filed; matches LOCAL_SLOT in main. */
export const LOCAL_SLOT = 'local-align'

/** Already transcribed earlier by THIS model? Costs nothing and survives
 *  restarts. Another model's answer for the same track lives beside it. */
export async function cachedAi(trackId: number, aligned = false): Promise<LyricsResult | null> {
  const s = useSettings.getState()
  /* The local aligner files its answers under its own name rather than
     under a model you can pick from the list, so looking only at the
     Gemini slots would miss them. Checked whatever the current setting
     says: which engine would do NEW work is a different question from
     which answers already exist, and an answer on disk is worth showing
     however it got there. */
  if (aligned) {
    const local = await window.electronAPI?.aiCached?.(trackId, LOCAL_SLOT)
    if (local) return toResult(local, true)
  }
  const c = await window.electronAPI?.aiCached?.(trackId, s.aiModel + (aligned ? '-aligned' : ''))
  return c ? toResult(c, aligned) : null
}

function toResult(c: { lines: { time: number; text: string }[]; plain: string; model?: string; fit?: number }, aligned = false): LyricsResult | null {
  if (!c.lines.length) return null
  // A line the model could not place in time comes back at -1: the set is
  // only offered as synced when every line has a real stamp, because a half
  // timed lyric scrolls worse than an untimed one.
  /* Aligned lyrics come back with the odd line unplaced - a repeated hook,
     an ad-lib the model could not find. Dropping the whole synchronisation
     over a few gaps wastes a good result, so as long as most lines landed,
     the holes are filled by spreading them between their timed neighbours.
     Below that, it is not a timing, it is a guess, and the text goes up as
     a block instead. */
  const timed = c.lines.filter(l => l.time >= 0).length
  const synced = c.lines.length && timed >= Math.ceil(c.lines.length * 0.6)
    ? fillGaps(c.lines)
    : null
  return { synced, plain: c.plain || c.lines.map(l => l.text).join('\n'), ai: true, aiModel: c.model, aiAligned: aligned, aiFit: c.fit }
}

/** Untimed lines take a share of the gap between the timed ones around them. */
function fillGaps(lines: { time: number; text: string }[]): { time: number; text: string }[] {
  const out = lines.map(l => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    if (out[i].time >= 0) continue
    let a = i - 1
    while (a >= 0 && out[a].time < 0) a--
    let b = i + 1
    while (b < out.length && out[b].time < 0) b++
    const from = a >= 0 ? out[a].time : 0
    const to = b < out.length ? out[b].time : from + (b - a)
    /* The floor is there so two lines filled into a tight gap do not land
       on the same second. It must not push them past the real stamp that
       follows, though: four untimed intro lines before a hook stamped at
       0:01 came out at 0.4, 0.8, 1.2, 1.6 - all after the 1.0 they were
       meant to precede. Everything downstream picks the active line with
       "the last one whose time has passed", which assumes the list only
       ever goes forward, so lines simply stopped being reachable. Clamped
       to just under the next real stamp, the spacing degrades instead. */
    const span = Math.max(0.4, (to - from) / (b - a))
    const at = from + span * (i - a)
    out[i].time = b < out.length ? Math.min(at, Math.max(from, out[b].time - 0.01)) : at
  }
  return out
}

export async function transcribeTrack(
  track: SCTrack,
  force = false,
  lyrics: string[] | null = null,
  /* A scan picks its engine in the menu, so it says so here rather than
     reaching into settings and putting them back afterwards. */
  mode: 'local' | 'cloud' | null = null,
): Promise<LyricsResult | null> {
  const api = window.electronAPI
  if (!api?.aiTranscribe) throw { code: 'NO_BRIDGE' } as AiError
  // The same rule the main process enforces, said early so no audio is
  // fetched and decoded for a job that will be refused.
  if (!lyrics?.length) throw { code: 'NO_WORDS' } as AiError
  const { url, kind } = await sc.getStreamUrl(track)
  /* With known words and the local aligner switched on, the model is not
     asked anything at all: the words are already right, and all that is
     missing is where they fall. */
  const local = (mode ?? useSettings.getState().timing) === 'local' && !!lyrics?.length
  const prepared = await toSpeechAudio(url, kind, local)
  useAiStage.getState().set(local ? 'local' : 'cloud')
  /* Choosing local means the audio does not leave this machine, so a
     failure to fetch or decode it is the end of the attempt - not a
     reason to quietly send the track to Google instead. Without this the
     fall-through below uploaded it to Gemini on any network blip, and for
     somebody with no key stored the same blip surfaced as "add an API
     key" for a job that was meant to run offline. */
  if (local && !prepared?.pcm.length) throw { code: 'NO_AUDIO' } as AiError
  if (local && prepared?.pcm.length) {
    /* Wrapped like the cloud path below. An IPC rejection arrives as a
       plain Error whose message is "Error invoking remote method ...: Error:
       NO_MODEL", and every caller reads `.code`: the single-track button
       showed a generic failure instead of "download the model", and the
       library scan's stop-the-run guard never matched, so it went on to
       fetch and decode three hundred tracks for a job that could not
       succeed on any of them. */
    let r: Awaited<ReturnType<NonNullable<NonNullable<typeof window.electronAPI>['alignRun']>>> | undefined
    try {
      r = await window.electronAPI?.alignRun?.({
        trackId: track.id, pcm: prepared.pcm, lyrics: lyrics!, title: track.title ?? '',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw { code: /Error: /.test(msg) ? msg.split('Error: ').pop()!.trim() : msg } as AiError
    }
    if (r?.lines.length) {
      const out = toResult({ lines: r.lines, plain: r.lines.map(l => l.text).join('\n'), model: LOCAL_SLOT, fit: r.support }, true)
      if (out) { primeLyricsCache(track.id, out); return out }
    }
    throw { code: 'ALIGN_FAILED' } as AiError
  }
  try {
    const res = await api.aiTranscribe({
      wav: prepared?.bytes ?? null,
      wavMime: prepared?.mime,
      trackId: track.id,
      title: track.title ?? '',
      artist: track.user?.username ?? '',
      durationSec: (track.duration ?? 0) / 1000,
      url, kind,
      model: useSettings.getState().aiModel,
      force, lyrics,
    })
    lastNote = res.note ?? ''
    const out = toResult(res, !!lyrics?.length)
    // Into the same cache the catalogue lookups fill, so the lyrics pane, the
    // queue badge and the home player need to know nothing about any of
    // this - they ask for lyrics and get lyrics.
    primeLyricsCache(track.id, out)
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw { code: /Error: /.test(msg) ? msg.split('Error: ').pop()!.trim() : msg } as AiError
  }
}

/* ── Why the audio is re-encoded before it is sent ────────────────────────
 *
 * SoundCloud's HLS is fragmented MP4, and a fragmented MP4 carries
 * `duration: 0` in its header - the real timing lives in the fragments. Our
 * own player handles that (so does the MP3 export, which decodes the very
 * same bytes), but a decoder that trusts the header sees a file of zero
 * length. That is what "no words heard - sounds instrumental" was: the model
 * was handed a track it believed to be empty, and faithfully transcribed
 * nothing. Measured on the file we sent: ftyp + moov with mvhd duration 0,
 * then styp/sidx/moof/mdat fragments.
 *
 * So the renderer decodes it - Chromium reads fragments perfectly well - and
 * sends 16 kHz mono WAV instead. Nothing about that can be misread: no
 * container cleverness, no duration to get wrong. 16 kHz mono is also what
 * speech models want, and it is a third of the bytes of the stereo original
 * at 44.1 kHz. */

const ASR_RATE = 16000
/* Why it is not sent as WAV any more.
 *
 * Measured against the API from this machine: a 9.3 MB request body takes
 * 19.5 seconds just to leave - and that was a request the server rejected on
 * the key, so none of it was the model. Raw 16 kHz PCM is 32 KB per second of
 * audio, which makes a three-minute track about 5.5 MB, 7.3 MB once base64
 * inflates it. Encoded at 64 kbps mono the same audio is 8 KB/s - four times
 * less to upload, for a couple of seconds of CPU on a machine that is not
 * waiting on anything else. Speech survives 64 kbps mono easily; it is a
 * generous bitrate for a voice.
 *
 * The token cost is unchanged either way: the API counts audio by duration,
 * not by size. This buys time, not quota. */
const ASR_KBPS = 64
/** Past this the WAV would exceed what can be sent inline; see MAX_AUDIO. */
const MAX_WAV_SEC = 7 * 60

function toWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(out)
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)            // PCM
  view.setUint16(22, 1, true)            // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)     // byte rate
  view.setUint16(32, 2, true)            // block align
  view.setUint16(34, 16, true)           // bits
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Uint8Array(out)
}

/** Encode mono 16 kHz samples to MP3 off the UI thread. Null if anything
 *  goes wrong - the caller then falls back to WAV, which always works. */
function toMp3(samples: Float32Array, rate: number): Promise<Uint8Array | null> {
  return new Promise(resolve => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/mp3Worker.ts', import.meta.url), { type: 'module' })
    } catch { resolve(null); return }
    const parts: Uint8Array[] = []
    let total = 0
    const done = (v: Uint8Array | null) => { try { worker.terminate() } catch { /* ignore */ } resolve(v) }
    worker.onerror = () => done(null)
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; bytes?: Uint8Array }
      if (m.type === 'ready') {
        // One slice: at 16 kHz mono even a long track is a few megabytes of
        // samples, far below the size that made the download path chunk.
        const copy = samples.slice()
        worker.postMessage({ type: 'chunk', left: copy, right: null }, [copy.buffer])
        return
      }
      if (m.type === 'data' && m.bytes) { parts.push(m.bytes); total += m.bytes.length; return }
      if (m.type === 'chunkDone') { worker.postMessage({ type: 'end' }); return }
      if (m.type === 'done' || m.type === 'end') {
        const out = new Uint8Array(total)
        let at = 0
        for (const p of parts) { out.set(p, at); at += p.length }
        done(out.length ? out : null)
        return
      }
      if (m.type === 'error') done(null)
    }
    worker.postMessage({ type: 'start', sampleRate: rate, channels: 1, kbps: ASR_KBPS, totalFrames: samples.length })
  })
}

/** Stitch, decode and flatten to one mono 16 kHz channel. Null when the
 *  stream cannot be decoded here - the main process then sends it as it is,
 *  which is still the right thing for a plain MP3. */
async function toSpeechAudio(url: string, kind: 'progressive' | 'hls', pcmOnly = false): Promise<{ bytes: Uint8Array; mime: string; pcm: Float32Array } | null> {
  try {
    useAiStage.getState().set('download')
    const raw = kind === 'hls'
      ? await stitchHls(url, () => {})
      : await netGetBytes(url)
    useAiStage.getState().set('decode')
    // The context's rate is what decodeAudioData resamples to, so the
    // downsampling costs nothing extra.
    const ctx = new OfflineAudioContext(1, 1, ASR_RATE)
    const buf = await ctx.decodeAudioData(raw)
    /* A set longer than this would not fit in one request. Rather than give
       up - which would send the undecodable original instead - the first
       seven minutes go, and whatever words are in them come back. */
    const n = Math.min(buf.length, Math.floor(MAX_WAV_SEC * buf.sampleRate))
    const mix = new Float32Array(n)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c)
      for (let i = 0; i < n; i++) mix[i] += ch[i]
    }
    if (buf.numberOfChannels > 1) {
      for (let i = 0; i < n; i++) mix[i] /= buf.numberOfChannels
    }
    /* Nothing is uploaded on the local path, so the encode - a second and
       a half of worker time - is simply not done. */
    if (pcmOnly) return { bytes: new Uint8Array(0), mime: '', pcm: mix }
    const mp3 = await toMp3(mix, buf.sampleRate)
    return mp3
      ? { bytes: mp3, mime: 'audio/mpeg', pcm: mix }
      : { bytes: toWav(mix, buf.sampleRate), mime: 'audio/wav', pcm: mix }
  } catch {
    return null
  }
}
