import { useEffect, useRef, useState } from 'react'
import { sc } from '../services/soundcloud'
import { attachStream, detachStream, SLOT_EGG } from '../services/hlsStream'
import { usePlayer } from '../store'
import circleUrl from '../assets/egg/egg-circle.png'
import fanUrl from '../assets/egg/egg-fan-o.png'
import numUrl from '../assets/egg/egg-67-o.png'

// Easter egg: press 6 then 7 within 2s -> fullscreen "6 7" meme overlay,
// plus a meme track playing from 0:50. Overlay and audio both last 10s.
// Uses the user's own hand-drawn art (gray background keyed out to transparent).
// Center circle rotates, the "67" pulses, four corner fans spin.
// Self-contained: keyframes are injected while shown.

const WINDOW_MS = 2000        // max gap between 6 and 7
const AUTO_HIDE_MS = 20000    // overlay + audio duration (or dismiss via click / Esc)
const EGG_TRACK_URL = 'https://soundcloud.com/seregapiraaat/mutanty-iz-kanalizatsii'
const EGG_START_SEC = 50      // start the track at 0:50

const imgStyle: React.CSSProperties = {
  width: '100%', height: '100%', objectFit: 'contain',
  userSelect: 'none', pointerEvents: 'none',
  WebkitUserSelect: 'none', WebkitUserDrag: 'none',
} as React.CSSProperties

export function SixSevenEgg() {
  const [shown, setShown] = useState(false)
  const lastSix = useRef(0)

  // Sequence detector: 6 then 7, consecutively, within WINDOW_MS.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === '6') {
        lastSix.current = Date.now()
      } else if (e.key === '7') {
        if (Date.now() - lastSix.current <= WINDOW_MS) setShown(true)
        lastSix.current = 0
      } else {
        lastSix.current = 0   // any other key breaks the "подряд" chain
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // While shown: run the 10s timer, allow Esc, and play the meme track from
  // 0:50 on a dedicated <audio> element (independent of the main player, so the
  // queue and current playback are untouched). Cleanup stops everything.
  useEffect(() => {
    if (!shown) return
    const timer = window.setTimeout(() => setShown(false), AUTO_HIDE_MS)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShown(false) }
    window.addEventListener('keydown', onKey)

    // Pause the main player for the duration so the two tracks don't overlap;
    // restore its previous play state afterwards.
    const wasPlaying = usePlayer.getState().isPlaying
    if (wasPlaying) usePlayer.getState().setPlaying(false)

    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    audio.volume = usePlayer.getState().volume   // match the main player's volume
    let cancelled = false
    sc.resolveTrack(EGG_TRACK_URL)
      .then((track) => sc.getStreamUrl(track))
      .then((stream) => {
        if (cancelled) return
        // Listener first: for progressive, attachStream calls load() right away and
        // loadedmetadata could otherwise fire before we subscribe.
        audio.addEventListener('loadedmetadata', () => {
          try { audio.currentTime = EGG_START_SEC } catch { /* ignore */ }
          audio.play().catch(() => { /* autoplay/stream issue: animation still runs */ })
        }, { once: true })
        return attachStream(SLOT_EGG, audio, stream)
      })
      .catch(() => { /* resolve/stream failed: run the animation without audio */ })

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      try { audio.pause() } catch { /* ignore */ }
      detachStream(SLOT_EGG, audio)   // kills the hls.js instance if the egg track is HLS
      try { audio.src = '' } catch { /* ignore */ }
      if (wasPlaying) usePlayer.getState().setPlaying(true)
    }
  }, [shown])

  if (!shown) return null

  return (
    <div
      onClick={() => setShown(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
        animation: 'egg-fade 0.25s ease both', overflow: 'hidden',
      }}
      title="6 7"
    >
      <style>{`
        @keyframes egg-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes egg-spin { to { transform: rotate(360deg) } }
        @keyframes egg-spin-rev { to { transform: rotate(-360deg) } }
        @keyframes egg-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.14) } }
        @keyframes egg-pop { from { transform: scale(0.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      `}</style>

      {/* corner fans */}
      {([
        { top: '2vmin', left: '2vmin', dir: 'egg-spin' },
        { top: '2vmin', right: '2vmin', dir: 'egg-spin-rev' },
        { bottom: '2vmin', left: '2vmin', dir: 'egg-spin-rev' },
        { bottom: '2vmin', right: '2vmin', dir: 'egg-spin' },
      ] as const).map((pos, i) => (
        <div key={i} style={{
          position: 'absolute', width: '22vmin', height: '22vmin',
          top: (pos as any).top, bottom: (pos as any).bottom,
          left: (pos as any).left, right: (pos as any).right,
          animation: `${pos.dir} 2.4s linear infinite`, willChange: 'transform',
        }}>
          <img src={fanUrl} alt="" style={imgStyle} />
        </div>
      ))}

      {/* center: outer copy rotates, inner copy pulses */}
      <div style={{ position: 'relative', width: '80vmin', height: '80vmin',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'egg-pop 0.5s cubic-bezier(0.16,1,0.3,1) both' }}>
        <div style={{ position: 'absolute', inset: 0,
          animation: 'egg-spin 14s linear infinite', willChange: 'transform' }}>
          <img src={circleUrl} alt="" style={imgStyle} />
        </div>
        {/* pulsing "67" sitting in the circle's centre hole */}
        <div style={{ position: 'absolute', width: '20vmin', height: '20vmin',
          animation: 'egg-pulse 0.72s ease-in-out infinite', willChange: 'transform' }}>
          <img src={numUrl} alt="" style={imgStyle} />
        </div>
      </div>
    </div>
  )
}
