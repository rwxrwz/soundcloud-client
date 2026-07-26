import { useEffect, useRef, useCallback } from 'react'
import { usePlayer, useToast, useSettings, useLyrics, EQ_BANDS } from '../store'
import { sc } from '../services/soundcloud'
import { translate } from '../i18n'
import { fetchLyrics } from '../services/lyrics'
import { audioBus } from './audioBus'

// Two-channel audio engine. With crossfade off, only channel 0 is ever used and
// the behaviour matches the original single-element player. With crossfade > 0 the
// incoming track loads into the idle channel and the two channel gains ramp past
// each other so the tracks overlap.
export function useAudio(analyserRef: React.MutableRefObject<AnalyserNode | null>) {
  const ctxRef = useRef<AudioContext | null>(null)
  const elemsRef = useRef<HTMLAudioElement[]>([])
  const srcRef = useRef<(MediaElementAudioSourceNode | null)[]>([null, null])
  const chGainRef = useRef<(GainNode | null)[]>([null, null])  // per-channel crossfade gain
  const masterGainRef = useRef<GainNode | null>(null)          // play/pause fade
  const analyserNodeRef = useRef<AnalyserNode | null>(null)
  const bassAnalyserRef = useRef<AnalyserNode | null>(null)   // 2048-pt tap for companion beat detection
  const eqNodesRef = useRef<BiquadFilterNode[]>([])
  const activeRef = useRef(0)
  const firstLoadRef = useRef(true)
  const earlyRef = useRef(false)   // we advanced early to start a crossfade tail
  const drmSkipRef = useRef(0)     // consecutive DRM auto-skips (loop guard)
  const pauseTimers = useRef<(ReturnType<typeof setTimeout> | null)[]>([null, null]) // per-channel deferred pause
  const loadSeqRef = useRef(0)     // guards against out-of-order async track loads
  const loadingRef = useRef(false) // a new track is loading; the load owns starting playback

  const { currentTrack, isPlaying, volume, setProgress, setDuration, nextTrack, repeat, seekRequest } = usePlayer()
  const { show: showToast } = useToast()
  const { eq, eqEnabled, outputDeviceId } = useSettings()

  const activeEl = () => elemsRef.current[activeRef.current]

  // Build the WebAudio graph once: both channels share the EQ chain, master gain
  // and analyser. source[i] → chGain[i] → eq0 → … → eq4 → master → analyser → dest
  const buildGraph = (ctx: AudioContext) => {
    const srcs = srcRef.current, chs = chGainRef.current
    for (let i = 0; i < 2; i++) {
      if (!srcs[i]) srcs[i] = ctx.createMediaElementSource(elemsRef.current[i])
      if (!chs[i]) { const g = ctx.createGain(); g.gain.value = i === activeRef.current ? 1 : 0; chs[i] = g }
    }
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

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.85
    const master = ctx.createGain()
    master.gain.value = 1

    for (let i = 0; i < 2; i++) { srcs[i]!.connect(chs[i]!); chs[i]!.connect(eqNodes[0]) }
    let node: AudioNode = eqNodes[0]
    for (let k = 1; k < eqNodes.length; k++) { node.connect(eqNodes[k]); node = eqNodes[k] }
    node.connect(master)
    master.connect(analyser)
    analyser.connect(ctx.destination)

    // Second, finer analyser tapped off master purely for the companion bridge's
    // beat detection. fftSize 2048 gives ~21.5 Hz bins, so 20-150 Hz gets real
    // resolution — the shared 256-pt analyser lumps all bass into bin 0 (DC),
    // which sits pinned at ~255. Kept separate so the visualizers keep their
    // 128-bin behaviour untouched. Analysis tap only, no output to destination.
    const bassAnalyser = ctx.createAnalyser()
    bassAnalyser.fftSize = 2048
    bassAnalyser.smoothingTimeConstant = 0.5   // low, so onset flux stays sharp
    master.connect(bassAnalyser)

    masterGainRef.current = master
    analyserNodeRef.current = analyser
    bassAnalyserRef.current = bassAnalyser
  }

  // Init both audio elements once + listeners
  useEffect(() => {
    if (elemsRef.current.length === 0) {
      for (let i = 0; i < 2; i++) {
        const a = new Audio()
        a.crossOrigin = 'anonymous'
        a.preload = 'auto'
        elemsRef.current.push(a)
      }
    }

    const onTimeUpdate = (e: Event) => {
      if (e.target !== activeEl()) return
      const a = activeEl()
      setProgress(a.currentTime)
      // Start the crossfade a little before the track ends by advancing early
      const cf = useSettings.getState().crossfade
      if (cf > 0 && !earlyRef.current && repeat !== 'one' && a.duration && isFinite(a.duration)) {
        const st = usePlayer.getState()
        const hasNext = st.shuffle || st.repeat === 'all' || st.queueIndex < st.queue.length - 1
        if (hasNext && a.duration - a.currentTime <= cf) {
          earlyRef.current = true
          st.nextTrack()
        }
      }
    }
    const onLoaded = (e: Event) => { if (e.target === activeEl()) setDuration((e.target as HTMLAudioElement).duration) }
    const onEnded = (e: Event) => {
      if (e.target !== activeEl()) return          // an old crossfade tail finished — ignore
      if (earlyRef.current) { earlyRef.current = false; return }
      if (repeat === 'one') { const a = activeEl(); a.currentTime = 0; a.play() }
      else nextTrack()
    }

    const els = elemsRef.current
    els.forEach(a => {
      a.addEventListener('timeupdate', onTimeUpdate)
      a.addEventListener('loadedmetadata', onLoaded)
      a.addEventListener('ended', onEnded)
    })
    return () => els.forEach(a => {
      a.removeEventListener('timeupdate', onTimeUpdate)
      a.removeEventListener('loadedmetadata', onLoaded)
      a.removeEventListener('ended', onEnded)
    })
  }, [repeat, nextTrack, setProgress, setDuration])

  // Load new track
  useEffect(() => {
    if (!currentTrack || elemsRef.current.length < 2) return

    // Auto-skip DRM-protected tracks (guarded against looping a fully-DRM queue)
    if (useSettings.getState().autoSkipDrm && sc.isDrm(currentTrack)) {
      const st = usePlayer.getState()
      const hasNext = st.queue.length > 1 && (st.shuffle || st.repeat === 'all' || st.queueIndex < st.queue.length - 1)
      if (hasNext && drmSkipRef.current < st.queue.length) {
        drmSkipRef.current++
        st.nextTrack()
        return
      }
      drmSkipRef.current = 0
      usePlayer.setState({ playbackError: translate('errDrm') })
      usePlayer.getState().setPlaying(false)
      return
    }
    drmSkipRef.current = 0

    usePlayer.setState({ playbackError: null })

    // Prefetch lyrics availability for the "L" badge (cached by track id)
    fetchLyrics({
      trackId: currentTrack.id,
      title: currentTrack.title,
      artist: currentTrack.user?.username ?? '',
      durationSec: (currentTrack.duration ?? 0) / 1000,
    }).then(res => useLyrics.getState().mark(currentTrack.id, !!res)).catch(() => {})

    const cf = useSettings.getState().crossfade
    const crossfading = cf > 0 && !firstLoadRef.current && masterGainRef.current != null
    const targetCh = crossfading ? (activeRef.current + 1) % 2 : activeRef.current
    const el = elemsRef.current[targetCh]

    const handlePlayErr = (err: Error) => {
      if (err?.name === 'AbortError') return
      console.error('play() failed:', err?.message, 'track:', currentTrack?.title)
      useToast.getState().show(translate('errPlay'), 'error')
      usePlayer.getState().setPlaying(false)
    }

    // Token to ignore out-of-order resolutions when tracks are switched quickly:
    // only the most recent load is allowed to touch the audio graph.
    const myLoad = ++loadSeqRef.current
    // While this is set, the isPlaying effect must not resume the outgoing (still
    // active) element — otherwise the old track blips out before the load swaps in
    // the new channel (audible especially with crossfade after a pause).
    loadingRef.current = true

    sc.getStreamUrl(currentTrack).then((url: string) => {
      if (myLoad !== loadSeqRef.current) return  // superseded by a newer track change
      el.src = url
      el.load()
      el.volume = usePlayer.getState().volume

      if (!ctxRef.current) ctxRef.current = new AudioContext()
      const ctx = ctxRef.current
      if (ctx.state === 'suspended') ctx.resume()
      // Route to the chosen output device (Chromium AudioContext.setSinkId)
      const oid = useSettings.getState().outputDeviceId
      const ctxAny = ctx as unknown as { setSinkId?: (id: string) => Promise<void> }
      if (oid && ctxAny.setSinkId) ctxAny.setSinkId(oid).catch(() => {})

      if (!masterGainRef.current) buildGraph(ctx)

      // Apply current EQ settings to the (shared) filter chain
      const { eq: eqGains, eqEnabled: enabled } = useSettings.getState()
      eqNodesRef.current.forEach((f, i) => { f.gain.value = enabled ? (eqGains[i] ?? 0) : 0 })

      const chs = chGainRef.current
      const now = ctx.currentTime
      const playing = usePlayer.getState().isPlaying

      // The incoming channel becomes active — cancel any deferred pause queued
      // for it from a previous crossfade, or it would silence the new track.
      if (pauseTimers.current[targetCh]) { clearTimeout(pauseTimers.current[targetCh]!); pauseTimers.current[targetCh] = null }

      if (crossfading) {
        const oldCh = activeRef.current
        const inG = chs[targetCh]!, outG = chs[oldCh]!
        inG.gain.cancelScheduledValues(now)
        inG.gain.setValueAtTime(Math.max(inG.gain.value, 0.0001), now)
        inG.gain.linearRampToValueAtTime(1, now + cf)
        outG.gain.cancelScheduledValues(now)
        outG.gain.setValueAtTime(Math.max(outG.gain.value, 0.0001), now)
        outG.gain.linearRampToValueAtTime(0.0001, now + cf)
        if (playing) el.play().catch(handlePlayErr)
        activeRef.current = targetCh
        earlyRef.current = false
        const oldEl = elemsRef.current[oldCh]
        pauseTimers.current[oldCh] = setTimeout(() => {
          pauseTimers.current[oldCh] = null
          // Only pause if this channel wasn't re-adopted as the active track meanwhile.
          if (activeRef.current !== oldCh) { try { oldEl.pause(); oldEl.currentTime = 0 } catch {} }
        }, cf * 1000 + 150)
      } else {
        chs[targetCh]?.gain.cancelScheduledValues(now)
        chs[targetCh]?.gain.setValueAtTime(1, now)
        const other = (targetCh + 1) % 2
        if (pauseTimers.current[other]) { clearTimeout(pauseTimers.current[other]!); pauseTimers.current[other] = null }
        chs[other]?.gain.cancelScheduledValues(now)
        chs[other]?.gain.setValueAtTime(0.0001, now)
        try { elemsRef.current[other]?.pause() } catch {}
        if (playing) el.play().catch(handlePlayErr)
      }

      firstLoadRef.current = false
      loadingRef.current = false
      analyserRef.current = analyserNodeRef.current
      audioBus.analyser = analyserNodeRef.current
      audioBus.bassAnalyser = bassAnalyserRef.current
    }).catch((err: Error) => {
      if (myLoad !== loadSeqRef.current) return  // superseded — ignore stale error
      loadingRef.current = false
      earlyRef.current = false
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
    const ctx = ctxRef.current
    const master = masterGainRef.current
    const a = activeEl()
    if (!a) return

    if (isPlaying) {
      if (master && ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime)
        master.gain.setValueAtTime(0.0001, ctx.currentTime)
        master.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.25)
      }
      // Don't resume the outgoing element while a new track is loading — the load
      // effect starts the incoming track on its own channel. Resuming here would
      // briefly play the old track before the swap.
      if (!loadingRef.current) a.play().catch(console.error)
    } else {
      if (master && ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime)
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime)
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
        const t = setTimeout(() => {
          if (!usePlayer.getState().isPlaying) elemsRef.current.forEach(el => el.pause())
        }, 450)
        return () => clearTimeout(t)
      } else {
        elemsRef.current.forEach(el => el.pause())
      }
    }
  }, [isPlaying])

  // Volume
  useEffect(() => {
    elemsRef.current.forEach(el => { if (el) el.volume = volume })
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

  // Apply output-device changes live
  useEffect(() => {
    const ctx = ctxRef.current as unknown as { setSinkId?: (id: string) => Promise<void> } | null
    if (ctx && ctx.setSinkId) ctx.setSinkId(outputDeviceId || '').catch(() => {})
  }, [outputDeviceId])

  // seekRequest from store (keyboard shortcuts, etc.)
  useEffect(() => {
    if (seekRequest === null) return
    const a = activeEl()
    if (a) a.currentTime = seekRequest
    // Reset so the same target can be requested again later
    usePlayer.setState({ seekRequest: null })
  }, [seekRequest])

  const seek = useCallback((time: number) => {
    const a = activeEl()
    if (a) a.currentTime = time
  }, [])

  return { seek }
}
