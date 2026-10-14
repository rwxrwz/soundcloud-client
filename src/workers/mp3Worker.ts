// MP3 encoder, kept off the UI thread. Encoding a track takes seconds (~29x
// realtime on a Ryzen 5800H), and doing it on the main thread would freeze the
// window and stutter playback for that whole time.
//
// The audio arrives already decoded: Web Audio only exists on the main thread,
// so the window decodes AAC and ships raw samples here.

// Imported statically on purpose: a dynamic import here would force the worker
// bundle to code-split, which the build's worker format can't do.
import MPEGMode from 'lamejs/src/js/MPEGMode.js'
import Lame from 'lamejs/src/js/Lame.js'
import BitStream from 'lamejs/src/js/BitStream.js'
import { Mp3Encoder } from 'lamejs'

interface StartMsg {
  type: 'start'
  sampleRate: number
  channels: number
  kbps: number
  /** Total sample frames, used to report progress. */
  totalFrames: number
}
interface ChunkMsg {
  type: 'chunk'
  left: Float32Array
  right: Float32Array | null
}
interface EndMsg { type: 'end' }

type InMsg = StartMsg | ChunkMsg | EndMsg

const BLOCK = 1152          // one MP3 frame worth of samples
const PROGRESS_STEP = 0.01  // report at most every 1%

let encoder: { encodeBuffer(l: Int16Array, r?: Int16Array): Int8Array; flush(): Int8Array } | null = null
let channels = 2
let totalFrames = 0
let doneFrames = 0
let lastReported = 0

// Float samples (-1..1) to the signed 16-bit the encoder expects, with clipping
// guarded — decoded audio can overshoot slightly.
function toInt16(src: Float32Array, out: Int16Array): void {
  for (let i = 0; i < src.length; i++) {
    const s = src[i] < -1 ? -1 : src[i] > 1 ? 1 : src[i]
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
}

// lamejs 1.2.1 is broken as a module: its encoder reaches for MPEGMode, Lame and
// BitStream as globals that index.js never sets up, so constructing one throws
// "MPEGMode is not defined". Putting them on globalThis first is the known fix.
function makeEncoder(sampleRate: number, ch: number, kbps: number) {
  const g = globalThis as unknown as Record<string, unknown>
  g.MPEGMode = MPEGMode
  g.Lame = Lame
  g.BitStream = BitStream
  return new Mp3Encoder(ch, sampleRate, kbps)
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data
  try {
    if (msg.type === 'start') {
      channels = msg.channels
      totalFrames = msg.totalFrames
      doneFrames = 0
      lastReported = 0
      encoder = makeEncoder(msg.sampleRate, channels, msg.kbps)
      self.postMessage({ type: 'ready' })
      return
    }

    if (msg.type === 'chunk') {
      if (!encoder) throw new Error('encoder not started')
      const left = new Int16Array(msg.left.length)
      toInt16(msg.left, left)
      let right: Int16Array | undefined
      if (channels === 2 && msg.right) {
        right = new Int16Array(msg.right.length)
        toInt16(msg.right, right)
      }

      for (let i = 0; i < left.length; i += BLOCK) {
        const l = left.subarray(i, i + BLOCK)
        const r = right ? right.subarray(i, i + BLOCK) : undefined
        const buf = encoder.encodeBuffer(l, r)
        if (buf.length) {
          const bytes = new Uint8Array(buf)
          self.postMessage({ type: 'data', bytes }, { transfer: [bytes.buffer] })
        }
        doneFrames += l.length
        const p = totalFrames ? doneFrames / totalFrames : 0
        if (p - lastReported >= PROGRESS_STEP) {
          lastReported = p
          self.postMessage({ type: 'progress', value: p })
        }
      }
      self.postMessage({ type: 'chunkDone' })
      return
    }

    if (msg.type === 'end') {
      if (!encoder) throw new Error('encoder not started')
      const tail = encoder.flush()
      if (tail.length) {
        const bytes = new Uint8Array(tail)
        self.postMessage({ type: 'data', bytes }, { transfer: [bytes.buffer] })
      }
      encoder = null
      self.postMessage({ type: 'done' })
      return
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error)?.message ?? 'encode failed' })
  }
}
