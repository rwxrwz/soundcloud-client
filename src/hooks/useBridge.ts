import { useEffect, useRef } from 'react'
import { usePlayer, useSettings, useUI, useLyrics, resolveAccentHex } from '../store'
import { audioBus } from './audioBus'
import { sc } from '../services/soundcloud'
import type { SCTrack } from '../services/soundcloud'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// Maps a SoundCloud track to the bridge contract. Track durations are ms in the
// SC model; the contract wants seconds.
function mapTrack(t: SCTrack) {
  // Some tracks carry no artwork of their own; fall back to the uploader's avatar
  // so the companion always gets an image when any exists for the track.
  const rawArt = t.artwork_url ?? t.user?.avatar_url ?? null
  return {
    id: String(t.id),
    title: t.title ?? '',
    artist: t.user?.username ?? '',
    artworkUrl: rawArt ? sc.formatArtwork(rawArt, 't200x200') : null,
    duration: Math.round((t.duration ?? 0) / 1000),
    /* Three-valued in the store - unknown, yes, no - and only a definite
       yes is worth a badge. */
    lyr: useLyrics.getState().available[Number(t.id)] === true || undefined,
  }
}

// Exposes the existing player over the companion WebSocket bridge (main process).
// Read-only mirror + command relay; the store stays the source of truth.
export function useBridge() {
  const lastSig = useRef('')
  /* The queue half of the signature, kept beside the array it was built
     from. Rebuilding it meant walking every track and reading the lyrics
     store once per track, then stringifying the lot - on every write to any
     of four stores, which includes setProgress four times a second. With a
     likes queue of a few thousand that is tens of kilobytes of string built
     and thrown away several times a second, only to conclude that nothing
     changed; during a lyrics scan, once per scanned track on top. The array
     is replaced rather than mutated whenever the queue really changes, so
     its identity answers the question without touching its contents. */
  const lastQueue = useRef<{ src: unknown; sig: string }>({ src: null, sig: '' })
  const lastMarks = useRef<unknown>(null)

  // Full snapshot on a meaningful change (track / queue / volume / play-pause).
  useEffect(() => {
    if (!window.electronAPI?.bridgeSendState) return
    const push = () => {
      const s = usePlayer.getState()
      const set = useSettings.getState()
      const accent = resolveAccentHex(set.accent, set.customAccent, useUI.getState().artRgb)
      // Signature omits position (that's the job of the lighter 'progress' tick),
      // so per-second progress updates don't spam full snapshots.
      const marks = useLyrics.getState().available
      if (lastQueue.current.src !== s.queue || lastMarks.current !== marks) {
        lastQueue.current = {
          src: s.queue,
          sig: s.queue.map(t => `${t.id}${marks[Number(t.id)] === true ? 'L' : ''}`).join(','),
        }
        lastMarks.current = marks
      }
      const sig = `${s.currentTrack?.id ?? ''}|${s.isPlaying}|${s.volume}|${s.queueIndex}|${s.shuffle}|${s.repeat}|${accent}|${lastQueue.current.sig}`
      if (sig === lastSig.current) return
      lastSig.current = sig
      window.electronAPI!.bridgeSendState!({
        playing: s.isPlaying,
        volume: s.volume,
        position: s.progress,
        track: s.currentTrack ? mapTrack(s.currentTrack) : null,
        queue: s.queue.map(mapTrack),
        queueIndex: s.currentTrack ? s.queueIndex : -1,
        shuffle: s.shuffle,
        repeat: s.repeat === 'none' ? 'off' : s.repeat,   // store 'none' -> contract 'off'
        accent,
      })
    }
    push()
    /* Three stores, because the accent is not the player's: it is a setting,
       and in "from the artwork" mode it is a reading off the current cover.
       Subscribing to the player alone meant a theme change reached the phone
       only when the song did. The signature above drops the repeats. */
    const offs = [usePlayer.subscribe(push), useSettings.subscribe(push), useUI.subscribe(push), useLyrics.subscribe(push)]
    return () => { for (const off of offs) off() }
  }, [])

  // Progress tick ~1/sec, only while playing.
  useEffect(() => {
    if (!window.electronAPI?.bridgeSendProgress) return
    const id = setInterval(() => {
      const s = usePlayer.getState()
      if (s.isPlaying) window.electronAPI!.bridgeSendProgress!(s.progress, true)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // Live analyser levels (~30/sec), only while playing. Contract unchanged.
  //   level - RMS across the shared 256-pt analyser, rolling-normalized into 0..1.
  //   bass  - onset (positive spectral flux) of the 20-150 Hz band from the
  //           dedicated 2048-pt analyser, normalized by a rolling max so it
  //           pulses on the beat instead of sitting pinned at 1.0. The old naive
  //           bass read only bin 0 (DC) at fftSize 256, which is always ~255.
  useEffect(() => {
    if (!window.electronAPI?.bridgeSendAudio) return
    let fullBuf: Uint8Array<ArrayBuffer> | null = null
    let bassBuf: Uint8Array<ArrayBuffer> | null = null

    const WIN = 90            // ~3s of history at 30/sec
    let prevBass = 0
    const fluxHist: number[] = []
    const levelHist: number[] = []

    // Raw 0-255 byte spectrum for the companion overlay's visualizer (~20/sec). Sent
    // full-resolution (every analyser bin) so the overlay can render it exactly like
    // the client's own Visualizer, which draws every bin.
    let bars: number[] = []
    let lastSpec = 0

    /* Nobody connected means nobody to measure for. The companion is
       optional and most people never open it, so without this the whole
       analyser loop and its fifty messages a second ran for an empty room
       whenever music played - including minimised, since background
       throttling is deliberately off. Re-asked every couple of seconds,
       which is cheap and picks a companion up on its own. */
    let listeners = false
    let askedAt = 0
    const tick = () => {
      const tNow = performance.now()
      if (tNow - askedAt > 2000) {
        askedAt = tNow
        window.electronAPI?.bridgeHasClients?.().then(v => { listeners = !!v }).catch(() => { listeners = false })
      }
      if (!listeners) return
      const full = audioBus.analyser
      if (!full || !usePlayer.getState().isPlaying) return
      // Prefer the dedicated 2048-pt node for bass; fall back to the shared 256-pt
      // one if it isn't wired yet (e.g. after HMR without a full dev restart) so
      // audio never stops emitting - emission must not hinge on the finer node.
      const bassAn = audioBus.bassAnalyser ?? full

      // level: RMS across all bins, then stretched into 0..1 by a rolling min/max
      const nf = full.frequencyBinCount
      if (!fullBuf || fullBuf.length !== nf) fullBuf = new Uint8Array(nf)
      full.getByteFrequencyData(fullBuf)
      let sumSq = 0
      for (let i = 0; i < nf; i++) sumSq += fullBuf[i] * fullBuf[i]
      const rawLevel = Math.sqrt(sumSq / nf) / 255
      levelHist.push(rawLevel); if (levelHist.length > WIN) levelHist.shift()
      let lMin = 1, lMax = 0
      for (const v of levelHist) { if (v < lMin) lMin = v; if (v > lMax) lMax = v }
      const level = lMax - lMin > 0.05 ? clamp01((rawLevel - lMin) / (lMax - lMin)) : rawLevel

      // bass: mean energy of the ~20-150 Hz bins (skip bin 0 = DC), onset via flux
      const nb = bassAn.frequencyBinCount
      if (!bassBuf || bassBuf.length !== nb) bassBuf = new Uint8Array(nb)
      bassAn.getByteFrequencyData(bassBuf)
      const binHz = bassAn.context.sampleRate / bassAn.fftSize   // ~21.5 Hz
      const hi = Math.min(nb - 1, Math.max(1, Math.round(150 / binHz)))   // ~bin 7
      let bassSum = 0
      for (let i = 1; i <= hi; i++) bassSum += bassBuf[i]
      const rawBass = bassSum / hi / 255

      const flux = Math.max(0, rawBass - prevBass)   // positive attack only
      prevBass = rawBass
      fluxHist.push(flux); if (fluxHist.length > WIN) fluxHist.shift()
      let fMax = 0
      for (const v of fluxHist) if (v > fMax) fMax = v
      const onset = fMax > 1e-4 ? clamp01(flux / fMax) : 0
      // blend sharp onset with a little sustained energy so held basslines still glow
      const bass = clamp01(onset * 0.75 + rawBass * 0.25)

      window.electronAPI!.bridgeSendAudio!(clamp01(level), bass)

      // Spectrum: send the raw byte data from the 256-pt FFT (already in fullBuf) at
      // full resolution, ~20/sec. The overlay renders it exactly like the client's
      // Visualizer. Reuse one plain number[] (JSON-serializable, unlike a Uint8Array).
      if (window.electronAPI?.bridgeSendSpectrum && tNow - lastSpec >= 50) {
        lastSpec = tNow
        if (bars.length !== nf) bars = new Array<number>(nf).fill(0)
        for (let i = 0; i < nf; i++) bars[i] = fullBuf[i]
        window.electronAPI.bridgeSendSpectrum(bars)
      }
    }
    // Drive via setInterval, not requestAnimationFrame: rAF is frozen for a
    // minimized/occluded window (the compositor draws no frames), which stalled
    // audio while music played in the tray. A timer keeps ~30/sec; background-timer
    // throttling is disabled app-wide via commandLine switches in electron/main.ts.
    const id = setInterval(tick, 33)
    return () => clearInterval(id)
  }, [])

  // Commands from the companion -> existing store actions.
  useEffect(() => {
    return window.electronAPI?.onBridgeCommand?.((cmd) => {
      const s = usePlayer.getState()
      switch (cmd.action) {
        case 'play': s.setPlaying(true); break
        case 'pause': s.setPlaying(false); break
        case 'toggle': s.setPlaying(!s.isPlaying); break
        case 'next': s.nextTrack(); break
        case 'prev': s.prevTrack(); break
        case 'seek': if (typeof cmd.value === 'number') s.seekTo(cmd.value); break
        case 'volume': if (typeof cmd.value === 'number') s.setVolume(Math.max(0, Math.min(1, cmd.value))); break
        case 'playQueueIndex': {
          const i = cmd.value
          if (typeof i === 'number' && i >= 0 && i < s.queue.length) s.setTrack(s.queue[i], s.queue)
          break
        }
        case 'shuffle':
          if (typeof cmd.value === 'boolean') usePlayer.setState({ shuffle: cmd.value })
          break
        case 'repeat':
          if (cmd.value === 'off' || cmd.value === 'one' || cmd.value === 'all') {
            usePlayer.setState({ repeat: cmd.value === 'off' ? 'none' : cmd.value })  // 'off' -> store 'none'
          }
          break
      }
    })
  }, [])
}
