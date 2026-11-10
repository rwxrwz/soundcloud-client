import { useEffect, useRef, useCallback } from 'react'
import { usePlayer, useToast, useSettings, useLyrics, useStats, EQ_BANDS } from '../store'
import { sc } from '../services/soundcloud'
import { translate } from '../i18n'
import { fetchLyrics } from '../services/lyrics'
import { attachStream, detachStream } from '../services/hlsStream'
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
  const listenMark = useRef(0)     // media clock at the previous timeupdate
  const listenBank = useRef(0)     // seconds listened but not yet banked

  /* Hand the bank over before the window goes away. Without this the last
     chunk - up to fifteen seconds - is lost on every quit, which over a
     few hundred launches is hours the counter never admits to. */
  useEffect(() => {
    const flush = () => {
      if (listenBank.current <= 0) return
      useStats.getState().addListened(listenBank.current, usePlayer.getState().currentTrack?.user?.username)
      listenBank.current = 0
    }
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      flush()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])
  const drmSkipRef = useRef(0)     // consecutive DRM auto-skips (loop guard)
  const pauseTimers = useRef<(ReturnType<typeof setTimeout> | null)[]>([null, null]) // per-channel deferred pause
  const loadSeqRef = useRef(0)     // guards against out-of-order async track loads
  const loadingRef = useRef(false) // a new track is loading; the load owns starting playback
  const seekTargetRef = useRef<number | null>(null)                    // seek in flight: where we asked to go
  const seekGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null) // safety net for that guard

  const { currentTrack, isPlaying, volume, setProgress, setDuration, nextTrack, repeat, seekRequest } = usePlayer()
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
    // resolution - the shared 256-pt analyser lumps all bass into bin 0 (DC),
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
      // A seek is still in flight. On HLS the element keeps reporting the OLD
      // position while hls.js flushes its buffer and fetches the target segment,
      // so letting these through would yank the slider back to where the track
      // used to be. Swallow them until the element really arrives.
      const target = seekTargetRef.current
      if (target !== null) {
        if (a.seeking || Math.abs(a.currentTime - target) > 0.5) return
        seekTargetRef.current = null
      }
      /* Time actually listened to.
       *
         Measured off the MEDIA clock, not the wall clock: a paused, stalled
         or buffering player advances neither, so neither counts. Only
         plausible forward steps are taken - a seek or a track change moves
         currentTime by a lot in one tick, and that is a jump, not time
         spent listening. Silence counts for nothing either: at zero volume
         the audio is running but nobody is listening, and a figure that
         grows while muted is the kind of inflation that makes the whole
         number worthless.
         Banked in chunks because persist writes on every set and timeupdate
         fires several times a second; counting straight through would mean
         a localStorage write four times a second for as long as music
         plays. The bank is flushed on the way out, below, so quitting does
         not quietly discard the last few seconds. */
      const prevT = listenMark.current
      listenMark.current = a.currentTime
      const step = a.currentTime - prevT
      const audible = usePlayer.getState().volume > 0
      if (step > 0 && step < 2 && audible) {
        listenBank.current += step
        if (listenBank.current >= 15) {
          useStats.getState().addListened(listenBank.current, usePlayer.getState().currentTrack?.user?.username)
          listenBank.current = 0
        }
      }

      setProgress(a.currentTime)
      // Start the crossfade a little before the track ends by advancing early
      const cf = useSettings.getState().crossfade
      if (cf > 0 && !earlyRef.current && repeat !== 'one' && a.duration && isFinite(a.duration)) {
        const st = usePlayer.getState()
        /* `queue.length > 1`, the same guard the two DRM branches carry.
            Without it a single-track queue on repeat-all counted as having a
            next track: nextTrack() selected the same id, so the load effect
            never re-ran and nothing cleared earlyRef - which then swallowed
            the real `ended` and left the player silent, at the end of the
            track, still claiming to play. */
        const hasNext = st.queue.length > 1 && (st.shuffle || st.repeat === 'all' || st.queueIndex < st.queue.length - 1)
        if (hasNext && a.duration - a.currentTime <= cf) {
          earlyRef.current = true
          st.nextTrack()
        }
      }
    }
    const onLoaded = (e: Event) => { if (e.target === activeEl()) setDuration((e.target as HTMLAudioElement).duration) }
    // The element reached the requested position - stop swallowing updates and
    // publish the real time. This is the normal end of a seek; the timeout in
    // seek() only matters if 'seeked' never arrives.
    const onSeeked = (e: Event) => {
      if (e.target !== activeEl()) return
      seekTargetRef.current = null
      if (seekGuardRef.current) { clearTimeout(seekGuardRef.current); seekGuardRef.current = null }
      setProgress((e.target as HTMLAudioElement).currentTime)
    }
    const onEnded = (e: Event) => {
      if (e.target !== activeEl()) return          // an old crossfade tail finished - ignore
      if (earlyRef.current) { earlyRef.current = false; return }
      if (repeat === 'one') { const a = activeEl(); a.currentTime = 0; a.play() }
      else nextTrack()
    }

    const els = elemsRef.current
    els.forEach(a => {
      a.addEventListener('timeupdate', onTimeUpdate)
      a.addEventListener('loadedmetadata', onLoaded)
      a.addEventListener('seeked', onSeeked)
      a.addEventListener('ended', onEnded)
    })
    return () => els.forEach(a => {
      a.removeEventListener('timeupdate', onTimeUpdate)
      a.removeEventListener('loadedmetadata', onLoaded)
      a.removeEventListener('seeked', onSeeked)
      a.removeEventListener('ended', onEnded)
    })
  }, [repeat, nextTrack, setProgress, setDuration])

  // Tear down hls.js instances when the player goes away. Deliberately a separate
  // effect with no deps: the listener effect above re-runs on repeat/queue changes
  // and must not kill a playing stream.
  useEffect(() => () => {
    elemsRef.current.forEach((el, i) => {
      try { el.pause() } catch {}
      detachStream(i, el)
    })
    /* The audio graph goes too. This hook is rebuilt whenever Player
       remounts - which signing out does - and an AudioContext left open
       holds the output device and both source nodes, which in turn hold
       the elements. Chromium allows six per renderer, so the seventh sign
       in threw inside the load chain and surfaced as "could not load" on
       every track with no hint why.

       The timers come too: they are harmless now, but both fire against
       state that no longer exists. */
    pauseTimers.current.forEach(t => { if (t) clearTimeout(t) })
    if (seekGuardRef.current) clearTimeout(seekGuardRef.current)
    const ctx = ctxRef.current
    ctxRef.current = null
    try { ctx?.close() } catch { /* already closed */ }
  }, [])

  // Load new track
  useEffect(() => {
    if (!currentTrack || elemsRef.current.length < 2) return

    /* Invalidate anything still loading before deciding anything else.
       The DRM branch below returns without reaching the token bump
       further down, so a load for the previous track stayed valid: it
       finished, attached itself to the live channel, and the next press
       of Play produced that track while the whole UI named this one. */
    loadSeqRef.current++

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

    usePlayer.setState({ playbackError: null })

    // Prefetch lyrics availability for the "L" badge (cached by track id)
    fetchLyrics({
      trackId: currentTrack.id,
      title: currentTrack.title,
      artist: currentTrack.user?.username ?? '',
      durationSec: (currentTrack.duration ?? 0) / 1000,
    }).then(res => {
      /* Only ever upgrade. This lookup asks LRCLIB and nothing else, while
         a scan may have found the song on Genius - and this one runs on
         every play, so writing its "no" here erased the scan's "yes" the
         moment you opened the track. A wrong yes can be cleared by
         scanning the list again; a yes erased on every play could not. */
      const known = useLyrics.getState().available[currentTrack.id]
      // 'live': LRCLIB answered, and nothing was written to disk for it.
      if (res || known === undefined) useLyrics.getState().mark(currentTrack.id, !!res, 'live')
    }).catch(() => {})

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
    // active) element - otherwise the old track blips out before the load swaps in
    // the new channel (audible especially with crossfade after a pause).
    loadingRef.current = true
    /* Cancelled here, before any await, not inside the .then. The timer
       belongs to the channel this load is about to take over, and the
       window between those two points is a whole stream resolve plus a
       manifest load - long enough for it to fire, abort the new track's
       attach and report a perfectly good track as unloadable. */
    const pending = pauseTimers.current[targetCh]
    if (pending) { clearTimeout(pending); pauseTimers.current[targetCh] = null }
    // A pending seek belongs to the outgoing track - drop it, or it would swallow
    // the new track's position updates.
    seekTargetRef.current = null
    if (seekGuardRef.current) { clearTimeout(seekGuardRef.current); seekGuardRef.current = null }

    // A fatal hls.js error after playback has started (expired segment URLs, dead
    // network): stop and say why instead of going quietly silent.
    const onHlsFatal = () => {
      if (myLoad !== loadSeqRef.current) return
      const reason = translate('errPlay')
      console.error('hls.js fatal error, track:', currentTrack?.title)
      usePlayer.setState({ playbackError: reason })
      usePlayer.getState().setPlaying(false)
      useToast.getState().show(`${currentTrack.title}: ${reason.toLowerCase()}`, 'error')
    }

    sc.getStreamUrl(currentTrack).then(async (stream) => {
      if (myLoad !== loadSeqRef.current) return  // superseded by a newer track change
      // progressive -> plain src + load(); hls -> hls.js feeds the element through
      // MediaSource. Awaiting readiness here (MANIFEST_PARSED for HLS) keeps the
      // crossfade ramps below in sync with the moment the track can really start.
      await attachStream(targetCh, el, stream, onHlsFatal)
      if (myLoad !== loadSeqRef.current) return  // superseded while the stream was loading
      /* A track that actually plays ends the skip run. This used to be reset
         on every load instead, which is before the stream is resolved - so
         the late branch's guard read 0 every time, could never count past 1,
         and the loop it is supposed to bound was unbounded. */
      drmSkipRef.current = 0
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

      // The incoming channel becomes active - cancel any deferred pause queued
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
          if (activeRef.current !== oldCh) {
            try { oldEl.pause(); oldEl.currentTime = 0 } catch {}
            // Crossfade is over: drop this channel's hls.js instance so it stops
            // downloading segments for a track nobody can hear any more.
            detachStream(oldCh, oldEl)
          }
        }, cf * 1000 + 150)
      } else {
        chs[targetCh]?.gain.cancelScheduledValues(now)
        chs[targetCh]?.gain.setValueAtTime(1, now)
        const other = (targetCh + 1) % 2
        if (pauseTimers.current[other]) { clearTimeout(pauseTimers.current[other]!); pauseTimers.current[other] = null }
        chs[other]?.gain.cancelScheduledValues(now)
        chs[other]?.gain.setValueAtTime(0.0001, now)
        try { elemsRef.current[other]?.pause() } catch {}
        // No crossfade, so the idle channel is done for good - free its instance.
        detachStream(other, elemsRef.current[other])
        if (playing) el.play().catch(handlePlayErr)
      }

      firstLoadRef.current = false
      loadingRef.current = false
      analyserRef.current = analyserNodeRef.current
      audioBus.analyser = analyserNodeRef.current
      audioBus.bassAnalyser = bassAnalyserRef.current
    }).catch((err: Error) => {
      if (myLoad !== loadSeqRef.current) return  // superseded - ignore stale error
      loadingRef.current = false
      earlyRef.current = false
      console.error('getStreamUrl failed:', err?.message, 'track:', currentTrack?.title)
      /* 'NET' is the one that is not about the track. It already got its
         retry inside getStreamUrl, so by here the connection really is
         the problem - and telling somebody their song was removed when
         their wifi blinked is the wrong thing to say. */
      const reason = err?.message === 'DRM'
        ? translate('errDrm')
        : err?.message === 'NO_STREAM'
          ? translate('errNoStream')
          : err?.message === 'NET'
            ? translate('errNet')
            : translate('errLoad')
      /* DRM found late is still DRM.
       *
       * There are two places a protected track is spotted: upfront, from
       * the transcodings the queue entry already carries, and here, when
       * resolveStream refetches the track and finds them. Only the first
       * one read the auto-skip setting, so a track that arrived as a stub -
       * which is every track the "keep playing similar" radio adds - stopped
       * the queue dead no matter what the switch said. From the outside the
       * setting looked like it had turned itself off.
       *
       * Same counter as the upfront branch, so a queue that is DRM all the
       * way down cannot spin through itself for ever. */
      if (err?.message === 'DRM' && useSettings.getState().autoSkipDrm) {
        const st = usePlayer.getState()
        const hasNext = st.queue.length > 1 && (st.shuffle || st.repeat === 'all' || st.queueIndex < st.queue.length - 1)
        if (hasNext && drmSkipRef.current < st.queue.length) {
          drmSkipRef.current++
          st.nextTrack()
          return
        }
        drmSkipRef.current = 0
      }
      // Nothing to skip to, or skipping is off: keep the track selected and
      // show why it cannot play.
      usePlayer.setState({ playbackError: reason })
      usePlayer.getState().setPlaying(false)
      useToast.getState().show(`${currentTrack.title}: ${reason.toLowerCase()}`, 'error')
    })
  }, [currentTrack?.id])

  // Play/pause with smooth fade - no clicks
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
      // Don't resume the outgoing element while a new track is loading - the load
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

  // Live EQ updates - apply band gains without rebuilding the graph
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

  // Optimistic seek: publish the requested position to the store immediately, so
  // the slider stays exactly where the user clicked, and let onTimeUpdate/onSeeked
  // swallow the element's stale positions until it catches up. Without this the
  // thumb snapped back to the old spot for as long as the HLS seek took.
  const seek = useCallback((time: number) => {
    /* Not while a track is loading. The active element is still the one
       being replaced, so the target would be armed against it and then
       survive into the new track, swallowing its updates until the five
       second safety net expired - the bar frozen, the lyrics stuck. The
       incoming track starts at zero anyway. */
    if (loadingRef.current) return
    const a = activeEl()
    if (!a) return
    seekTargetRef.current = time
    setProgress(time)
    try { a.currentTime = time } catch { /* element not ready yet */ }
    if (seekGuardRef.current) clearTimeout(seekGuardRef.current)
    // If 'seeked' never arrives (dead segment, stalled network), don't stay blind
    seekGuardRef.current = setTimeout(() => {
      seekTargetRef.current = null
      seekGuardRef.current = null
    }, 5000)
  }, [setProgress])

  // seekRequest from store (keyboard shortcuts, lyrics lines, bridge commands).
  // Lives below seek() on purpose - it is the same path, so it gets the same
  // optimistic behaviour instead of poking currentTime on its own.
  useEffect(() => {
    if (seekRequest === null) return
    seek(seekRequest)
    // Reset so the same target can be requested again later
    usePlayer.setState({ seekRequest: null })
  }, [seekRequest, seek])

  return { seek }
}
