// Saving an HLS track as MP3.
//
// SoundCloud serves AAC now, so an MP3 file means a real re-encode. The chain is
// stitch fragments -> decode (Web Audio, main thread only) -> encode (lamejs in a
// worker) -> stream the result to main. Nothing but the decoded audio is ever held
// whole: MP3 bytes leave for disk as they are produced.
//
// Re-encoding one lossy format into another always costs a little quality, so the
// bitrate is MP3's maximum and the sample rate is left alone.

const KBPS = 320
const DECODE_RATE = 44100      // what SoundCloud's AAC presets use; avoids resampling
const FLUSH_BYTES = 1 << 20    // hand data to main in ~1 MB batches
const CHUNK_SEC = 30           // audio handed to the worker one slice at a time
const DOWNLOAD_SHARE = 0.25    // fetching is roughly a quarter of the wait

// Measured on a Ryzen 5800H: ~29x realtime. Deliberately pessimistic here, since
// the number is only used to warn the user before a long job.
const ENCODE_SPEED = 18

/** Rough seconds needed to turn a track of this length into MP3. */
export function estimateMp3Seconds(durationSec: number): number {
  return Math.max(1, Math.round(durationSec / ENCODE_SPEED))
}

/** Fetch an HLS playlist and glue its fragments into one buffer. */
async function stitchHls(playlistUrl: string, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(playlistUrl)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const text = await res.text()

  const init = text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]
  const segments = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  if (!init || !segments.length) throw new Error('NO_STREAM')

  const parts: ArrayBuffer[] = []
  const all = [init, ...segments]
  for (let i = 0; i < all.length; i++) {
    const r = await fetch(new URL(all[i], playlistUrl).toString())
    if (!r.ok) throw new Error('HTTP ' + r.status)
    parts.push(await r.arrayBuffer())
    onProgress((i + 1) / all.length)
  }

  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(new Uint8Array(p), at); at += p.byteLength }
  return out.buffer
}

// Web Audio lives on the main thread only, so this can't move into the worker.
// The context's own rate decides the output rate, hence the fixed 44100.
async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, DECODE_RATE)
  return ctx.decodeAudioData(data)
}

/**
 * Transcode a plain-HLS track into an already-open download job. The caller owns
 * the job: it opened the destination and closes it afterwards.
 */
export async function transcodeIntoJob(
  job: number,
  playlistUrl: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const api = window.electronAPI
  if (!api?.dlWrite) throw new Error('NO_STREAM')

  const worker = new Worker(new URL('../workers/mp3Worker.ts', import.meta.url), { type: 'module' })
  let pending: Uint8Array[] = []
  let pendingBytes = 0

  const flush = async () => {
    if (!pendingBytes) return
    const merged = new Uint8Array(pendingBytes)
    let at = 0
    for (const b of pending) { merged.set(b, at); at += b.length }
    pending = []
    pendingBytes = 0
    await api.dlWrite!(job, merged)
  }

  try {
    const source = await stitchHls(playlistUrl, f => onProgress(f * DOWNLOAD_SHARE))
    const audio = await decode(source)
    const left = audio.getChannelData(0)
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null

    await new Promise<void>((resolve, reject) => {
      // Audio goes over in slices rather than in one piece: transferring requires a
      // copy, and copying a whole long mix would briefly double its memory.
      let offset = 0
      const step = CHUNK_SEC * audio.sampleRate
      const sendNext = () => {
        if (offset >= audio.length) { worker.postMessage({ type: 'end' }); return }
        const end = Math.min(offset + step, audio.length)
        const l = left.slice(offset, end)
        const r = right ? right.slice(offset, end) : null
        offset = end
        worker.postMessage({ type: 'chunk', left: l, right: r }, r ? [l.buffer, r.buffer] : [l.buffer])
      }

      // MP3 bytes are collected here and written in batches; awaiting every single
      // frame would stall the encoder on IPC round-trips.
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; bytes?: Uint8Array; value?: number; message?: string }
        if (m.type === 'data' && m.bytes) {
          pending.push(m.bytes)
          pendingBytes += m.bytes.length
          if (pendingBytes >= FLUSH_BYTES) flush().catch(reject)
        } else if (m.type === 'progress') {
          onProgress(DOWNLOAD_SHARE + (m.value ?? 0) * (1 - DOWNLOAD_SHARE))
        } else if (m.type === 'ready' || m.type === 'chunkDone') {
          sendNext()
        } else if (m.type === 'done') {
          resolve()
        } else if (m.type === 'error') {
          reject(new Error(m.message ?? 'encode failed'))
        }
      }
      worker.onerror = () => reject(new Error('encode failed'))
      worker.postMessage({
        type: 'start',
        sampleRate: audio.sampleRate,
        channels: right ? 2 : 1,
        kbps: KBPS,
        totalFrames: audio.length,
      })
    })

    await flush()
    onProgress(1)
  } finally {
    worker.terminate()
  }
}
