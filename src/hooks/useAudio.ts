import { useEffect, useRef, useCallback } from 'react'
import { usePlayer, useToast, useSettings, useLyrics, EQ_BANDS } from '../store'
import { sc } from '../services/soundcloud'
import { translate } from '../i18n'
import { fetchLyrics } from '../services/lyrics'

export function useAudio(analyserRef: React.MutableRefObject<AnalyserNode | null>) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const analyserNodeRef = useRef<AnalyserNode | null>(null)
  const eqNodesRef = useRef<BiquadFilterNode[]>([])

  const { currentTrack, isPlaying, volume, setProgress, setDuration, nextTrack, repeat, seekRequest } = usePlayer()
  const { show: showToast } = useToast()
  const { eq, eqEnabled } = useSettings()

  // Init audio element once
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.crossOrigin = 'anonymous'
      audioRef.current.preload = 'auto'
    }
    const audio = audioRef.current

    const onTimeUpdate = () => setProgress(audio.currentTime)
    const onLoadedMetadata = () => setDuration(audio.duration)
    const onEnded = () => {
      if (repeat === 'one') { audio.currentTime = 0; audio.play() }
      else nextTrack()
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
    }
  }, [repeat, nextTrack, setProgress, setDuration])

  // Load new track
  useEffect(() => {
    if (!currentTrack || !audioRef.current) return
    const audio = audioRef.current
    usePlayer.setState({ playbackError: null })

    // Prefetch lyrics availability for the "L" badge (cached by track id)
    fetchLyrics({
      trackId: currentTrack.id,
      title: currentTrack.title,
      artist: currentTrack.user?.username ?? '',
      durationSec: (currentTrack.duration ?? 0) / 1000,
    }).then(res => useLyrics.getState().mark(currentTrack.id, !!res)).catch(() => {})

    sc.getStreamUrl(currentTrack).then((url: string) => {
      audio.src = url
      audio.load()
      if (usePlayer.getState().isPlaying) audio.play().catch((err: Error) => {
        // Ignore AbortError — it just means the track changed before play() resolved
        if (err?.name === 'AbortError') return
        console.error('play() failed:', err?.message, 'track:', currentTrack?.title)
        useToast.getState().show(translate('errPlay'), 'error')
        usePlayer.getState().setPlaying(false)
      })

      if (!ctxRef.current) ctxRef.current = new AudioContext()
      const ctx = ctxRef.current
      if (ctx.state === 'suspended') ctx.resume()

      if (!sourceRef.current) sourceRef.current = ctx.createMediaElementSource(audio)

      // Create the 5-band EQ filter chain once
      if (eqNodesRef.current.length === 0) {
        eqNodesRef.current = EQ_BANDS.map((freq, i) => {
          const f = ctx.createBiquadFilter()
          f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
          f.frequency.value = freq
          if (f.type === 'peaking') f.Q.value = 1
          f.gain.value = 0
          return f
        })
      }
      const eqNodes = eqNodesRef.current
      const { eq: eqGains, eqEnabled: enabled } = useSettings.getState()
      eqNodes.forEach((f, i) => { f.gain.value = enabled ? (eqGains[i] ?? 0) : 0 })

      // Disconnect stale nodes before creating new ones
      try { analyserNodeRef.current?.disconnect() } catch {}
      try { gainRef.current?.disconnect() } catch {}
      try { sourceRef.current.disconnect() } catch {}
      eqNodes.forEach(f => { try { f.disconnect() } catch {} })

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.85

      const gain = ctx.createGain()
      gain.gain.value = 1

      // Chain: source → eq0 → … → eq4 → gain → analyser → destination
      let node: AudioNode = sourceRef.current
      for (const f of eqNodes) { node.connect(f); node = f }
      node.connect(gain)
      gain.connect(analyser)
      analyser.connect(ctx.destination)

      analyserNodeRef.current = analyser
      gainRef.current = gain
      analyserRef.current = analyser
    }).catch((err: Error) => {
      console.error('getStreamUrl failed:', err?.message, 'track:', currentTrack?.title)
      const reason = err?.message === 'DRM'
        ? translate('errDrm')
        : err?.message === 'NO_STREAM'
          ? translate('errNoStream')
          : translate('errLoad')
      // Don't skip — keep the track selected and show why it can't play
      usePlayer.setState({ playbackError: reason })
      usePlayer.getState().setPlaying(false)
      useToast.getState().show(`${currentTrack.title}: ${reason.toLowerCase()}`, 'error')
    })
  }, [currentTrack?.id])

  // Play/pause with smooth fade — no clicks
  useEffect(() => {
    const audio = audioRef.current
    const gain = gainRef.current
    const ctx = ctxRef.current
    if (!audio) return

    if (isPlaying) {
      if (gain && ctx) {
        // Always start from near-silence so there's no jump
        gain.gain.cancelScheduledValues(ctx.currentTime)
        gain.gain.setValueAtTime(0.0001, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.25)
      }
      audio.play().catch(console.error)
    } else {
      if (gain && ctx) {
        gain.gain.cancelScheduledValues(ctx.currentTime)
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
        // Pause only after fade completes — don't touch gain after pause
        const t = setTimeout(() => {
          if (!usePlayer.getState().isPlaying) audio.pause()
        }, 450)
        return () => clearTimeout(t)
      } else {
        audio.pause()
      }
    }
  }, [isPlaying])

  // Volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  // Live EQ updates — apply band gains without rebuilding the graph
  useEffect(() => {
    const ctx = ctxRef.current
    eqNodesRef.current.forEach((f, i) => {
      const target = eqEnabled ? (eq[i] ?? 0) : 0
      if (ctx) f.gain.setTargetAtTime(target, ctx.currentTime, 0.05)
      else f.gain.value = target
    })
  }, [eq, eqEnabled])

  // seekRequest from store (keyboard shortcuts, etc.)
  useEffect(() => {
    if (seekRequest === null || !audioRef.current) return
    audioRef.current.currentTime = seekRequest
    // Reset so the same target can be requested again later
    usePlayer.setState({ seekRequest: null })
  }, [seekRequest])

  const seek = useCallback((time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time
  }, [])

  return { seek }
}
