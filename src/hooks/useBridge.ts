import { useEffect, useRef } from 'react'
import { usePlayer } from '../store'
import { audioBus } from './audioBus'
import { sc } from '../services/soundcloud'
import type { SCTrack } from '../services/soundcloud'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// Maps a SoundCloud track to the bridge contract. Track durations are ms in the
// SC model; the contract wants seconds.
function mapTrack(t: SCTrack) {
  return {
    id: String(t.id),
    title: t.title ?? '',
    artist: t.user?.username ?? '',
    artworkUrl: t.artwork_url ? sc.formatArtwork(t.artwork_url, 't200x200') : null,
    duration: Math.round((t.duration ?? 0) / 1000),
  }
}

// Exposes the existing player over the companion WebSocket bridge (main process).
// Read-only mirror + command relay; the store stays the source of truth.
export function useBridge() {
  const lastSig = useRef('')

  // Full snapshot on a meaningful change (track / queue / volume / play-pause).
  useEffect(() => {
    if (!window.electronAPI?.bridgeSendState) return
    const push = () => {
      const s = usePlayer.getState()
      // Signature omits position (that's the job of the lighter 'progress' tick),
      // so per-second progress updates don't spam full snapshots.
      const sig = JSON.stringify([s.currentTrack?.id ?? null, s.isPlaying, s.volume, s.queueIndex, s.shuffle, s.repeat, s.queue.map(t => t.id)])
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
      })
    }
    push()
    return usePlayer.subscribe(push)
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

  // Live analyser levels (~30/sec), only while playing. Reuses the shared
  // AnalyserNode from the audio engine (fftSize 256) instead of touching the graph.
  useEffect(() => {
    if (!window.electronAPI?.bridgeSendAudio) return
    let raf = 0
    let last = 0
    let buf: Uint8Array<ArrayBuffer> | null = null
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const analyser = audioBus.analyser
      if (!analyser || !usePlayer.getState().isPlaying) return
      const now = performance.now()
      if (now - last < 33) return   // throttle to ~30 msg/sec
      last = now

      const n = analyser.frequencyBinCount
      if (!buf || buf.length !== n) buf = new Uint8Array(n)
      analyser.getByteFrequencyData(buf)

      // level: RMS across all bins
      let sumSq = 0
      for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i]
      const level = Math.sqrt(sumSq / n) / 255

      // bass: mean energy of the bins covering roughly 20-150 Hz
      const binHz = analyser.context.sampleRate / analyser.fftSize
      const bassEnd = Math.min(n, Math.max(1, Math.ceil(150 / binHz)))
      let bassSum = 0
      for (let i = 0; i < bassEnd; i++) bassSum += buf[i]
      const bass = bassSum / bassEnd / 255

      window.electronAPI!.bridgeSendAudio!(clamp01(level), clamp01(bass))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
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
