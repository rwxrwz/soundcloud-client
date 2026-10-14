import Hls from 'hls.js/light'
import type { ResolvedStream } from './soundcloud'

// Thin wrapper that points an <audio> element at a resolved stream.
//
// Chromium (and therefore Electron) has no native HLS support, so an m3u8 cannot
// simply go into `el.src` — hls.js downloads the playlist and its segments and
// feeds them to the element through MediaSource. The element object itself never
// changes, which is the whole point: its MediaElementAudioSourceNode (EQ chain,
// visualizer analyser, bridge analyser) stays valid and the audio graph in
// useAudio.ts needs no changes at all.
//
// Instances are tracked per "slot". The player has two <audio> channels for
// crossfade (slots 0 and 1) and must be able to kill one without touching the
// other, which is still fading out.

// The 6-7 easter egg plays on its own element, so it gets its own slot.
export const SLOT_EGG = 2

const MAX_BUFFER_SEC = 30       // modest look-ahead: during a crossfade two instances run at once
const READY_TIMEOUT_MS = 20000  // a manifest that never parses must not hang the track loader

interface Slot {
  hls: Hls
  abort: () => void
}

const slots = new Map<number, Slot>()

export function hlsSupported(): boolean {
  return Hls.isSupported()
}

// Attach a stream and resolve once it is ready to play. For progressive that is
// immediately after load(); for HLS it is MANIFEST_PARSED, i.e. once duration is
// known and playback can start. Callers await this *before* starting crossfade
// gain ramps, so the fade-in doesn't eat the first moment of the new track.
// `onFatal` fires only for errors that happen after playback has started.
export function attachStream(
  slot: number,
  el: HTMLAudioElement,
  stream: ResolvedStream,
  onFatal?: () => void,
): Promise<void> {
  detachStream(slot, el)

  if (stream.kind === 'progressive') {
    el.src = stream.url
    el.load()
    return Promise.resolve()
  }

  if (!Hls.isSupported()) return Promise.reject(new Error('NO_STREAM'))

  return new Promise<void>((resolve, reject) => {
    const hls = new Hls({ maxBufferLength: MAX_BUFFER_SEC, enableWorker: true })
    let settled = false

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error('HLS_TIMEOUT')), READY_TIMEOUT_MS)

    // Registered before loading starts so detachStream can always cancel a pending
    // attach (happens when the user skips tracks faster than manifests load).
    slots.set(slot, { hls, abort: () => finish(new Error('HLS_ABORTED')) })

    hls.on(Hls.Events.MANIFEST_PARSED, () => finish())
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return                     // hls.js retries non-fatal ones itself
      if (!settled) { finish(new Error('HLS_FATAL')); return }
      onFatal?.()                                 // died mid-playback (expired URLs, dead network)
    })

    hls.loadSource(stream.url)
    hls.attachMedia(el)
  })
}

// Kill the instance in a slot: frees its MediaSource, stops segment downloads and
// rejects a still-pending attach. Safe to call on a slot that holds nothing.
export function detachStream(slot: number, el?: HTMLAudioElement): void {
  const cur = slots.get(slot)
  if (!cur) return
  slots.delete(slot)
  cur.abort()
  try { cur.hls.destroy() } catch { /* already torn down */ }
  // destroy() detaches the MediaSource but can leave a dead blob: url on the element
  if (el && el.src.startsWith('blob:')) el.removeAttribute('src')
}
