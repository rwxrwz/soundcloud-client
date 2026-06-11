import { useRef, useEffect, useState, useCallback } from 'react'
import { usePlayer, useUI, useAccentHex } from '../store'
import { sc } from '../services/soundcloud'
import { useAudio } from '../hooks/useAudio'
import { Visualizer } from './Visualizer'
import { Slider } from './Slider'
import { FullScreenPlayer } from './FullScreenPlayer'
import { useT } from '../i18n'

export function NowPlaying() {
  const analyserRef = useRef<AnalyserNode | null>(null)
  const { seek } = useAudio(analyserRef)
  const titleRef = useRef<HTMLParagraphElement>(null)
  const [isOverflow, setIsOverflow] = useState(false)
  const [localProgress, setLocalProgress] = useState<number | null>(null)
  const draggingRef = useRef(false)

  const { currentTrack, isPlaying, volume, progress, duration, setPlaying, setVolume, nextTrack, prevTrack, repeat, shuffle, toggleRepeat, toggleShuffle, queue, playbackError } = usePlayer()
  const { setBgColor, setArtRgb, setShowTrackPage, setArtistPage, showQueue, setShowQueue, showFullscreen, setShowFullscreen } = useUI()
  const t = useT()
  const accentHex = useAccentHex()
  const [artColor, setArtColor] = useState<[number, number, number]>([80, 80, 80])
  const artColorRef = useRef<[number, number, number]>([80, 80, 80])
  const artworkDivRef = useRef<HTMLDivElement>(null)
  const isPlayingRef = useRef(isPlaying)
  const glowFadeRef = useRef(0)

  const artwork = currentTrack
    ? sc.formatArtwork(currentTrack.artwork_url || currentTrack.user?.avatar_url, 't500x500')
    : null

  // Keep refs in sync
  useEffect(() => { artColorRef.current = artColor }, [artColor])
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])

  // Dominant color — sample 32×32, average top-20% most vivid pixels
  useEffect(() => {
    if (!artwork) { setBgColor('#080808'); setArtColor([80, 80, 80]); setArtRgb([80, 80, 80]); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = artwork
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32; canvas.height = 32
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, 32, 32)
        const { data } = ctx.getImageData(0, 0, 32, 32)
        const pixels: { r: number; g: number; b: number; score: number }[] = []
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2]
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          const sat = max === 0 ? 0 : (max - min) / max
          const brightness = max / 255
          // boost score for vivid + moderately bright (not too dark, not washed out)
          const score = sat * Math.pow(Math.min(brightness * 1.8, 1), 0.5)
          pixels.push({ r, g, b, score })
        }
        pixels.sort((a, b) => b.score - a.score)
        const top = pixels.slice(0, Math.ceil(pixels.length * 0.15))
        const avgR = Math.round(top.reduce((s, p) => s + p.r, 0) / top.length)
        const avgG = Math.round(top.reduce((s, p) => s + p.g, 0) / top.length)
        const avgB = Math.round(top.reduce((s, p) => s + p.b, 0) / top.length)
        setArtColor([avgR, avgG, avgB])
        setArtRgb([avgR, avgG, avgB])
        setBgColor(`rgb(${avgR},${avgG},${avgB})`)
      } catch {}
    }
  }, [artwork])

  // Beat-reactive glow behind artwork
  useEffect(() => {
    let rafId: number
    const draw = () => {
      rafId = requestAnimationFrame(draw)
      const el = artworkDivRef.current
      if (!el) return
      const [r, g, b] = artColorRef.current
      const analyser = analyserRef.current

      if (analyser && isPlayingRef.current) {
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        const bassEnd = Math.floor(data.length * 0.07)
        let sum = 0
        for (let i = 0; i < bassEnd; i++) sum += data[i]
        glowFadeRef.current = sum / bassEnd / 255
      } else {
        glowFadeRef.current = Math.max(0, glowFadeRef.current - 0.04)
      }

      const v = glowFadeRef.current
      if (v < 0.02) {
        el.style.boxShadow = 'none'
      } else {
        const spread = 6 + v * 28
        const opacity = 0.12 + v * 0.65
        el.style.boxShadow = `0 0 ${spread}px ${spread * 0.5}px rgba(${r},${g},${b},${opacity})`
      }
    }
    draw()
    return () => cancelAnimationFrame(rafId)
  }, [analyserRef])

  // Marquee overflow detection
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    setIsOverflow(el.scrollWidth > el.clientWidth)
    if (el.scrollWidth > el.clientWidth) {
      el.style.setProperty('--marquee-offset', `-${el.scrollWidth - el.clientWidth}px`)
    }
  }, [currentTrack?.title])

  const displayProgress = localProgress !== null ? localProgress : progress

  const handleProgressChange = useCallback((v: number) => {
    draggingRef.current = true
    setLocalProgress(v)
  }, [])
  const handleProgressCommit = useCallback((v: number) => {
    draggingRef.current = false
    seek(v)
    setLocalProgress(null)
  }, [seek])

  useEffect(() => {
    if (!draggingRef.current) setLocalProgress(null)
  }, [progress])

  return (
    <>
    {showFullscreen && <FullScreenPlayer analyserRef={analyserRef} seek={seek} />}
    <div className="h-[80px] flex items-center px-5 gap-6">
      {/* ── Left: track info ── */}
      <div className="flex items-center gap-3 w-60 min-w-0 shrink-0">
        <div
          ref={artworkDivRef}
          onClick={() => currentTrack && setShowTrackPage(true)}
          className="relative w-14 h-14 rounded-xl overflow-hidden bg-white/5 shrink-0 cursor-pointer"
          title={t('trackDetails')}
        >
          {artwork ? (
            <img key={artwork} src={artwork} alt="" className="w-full h-full object-cover scale-in" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-6 h-6 text-white/20" fill="currentColor" viewBox="0 0 20 20">
                <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
              </svg>
            </div>
          )}
        </div>

        {currentTrack ? (
          <div key={currentTrack.id} className="min-w-0 flex-1 track-in">
            <div className="marquee-container">
              <p
                ref={titleRef}
                onClick={() => setShowTrackPage(true)}
                className={`text-sm font-semibold text-white marquee-text cursor-pointer hover:opacity-80 transition-opacity duration-150 ${isOverflow ? 'overflow' : 'truncate'}`}
              >
                {currentTrack.title}
              </p>
            </div>
            <button
              onClick={() => currentTrack.user && setArtistPage(currentTrack.user)}
              className="text-xs text-white/40 truncate mt-0.5 max-w-full text-left hover:text-white/70 transition-colors duration-150"
            >
              {currentTrack.user?.username}
            </button>
            {playbackError && (
              <div className="flex items-center gap-1 mt-1 text-[11px] text-red-400">
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                </svg>
                <span className="truncate">{playbackError}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-white/30">{t('nothingPlaying')}</p>
        )}
      </div>

      {/* ── Center ── */}
      <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
        {/* Controls */}
        <div className="flex items-center gap-3">
          <CtrlBtn onClick={toggleShuffle} active={shuffle} accent={accentHex} title={t('shuffle')}>
            <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
              <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
            </svg>
          </CtrlBtn>

          <CtrlBtn onClick={prevTrack} title={t('prev')}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
            </svg>
          </CtrlBtn>

          {/* Play / Pause */}
          <button
            onClick={() => setPlaying(!isPlaying)}
            title={isPlaying ? t('pause') : t('play')}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-lg"
            style={{
              background: 'rgba(255,255,255,0.95)',
              boxShadow: `0 0 20px rgba(var(--accent-rgb), 0.3)`
            }}
          >
            {isPlaying ? (
              <svg className="w-5 h-5" style={{ color: '#111' }} viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg className="w-5 h-5 ml-0.5" style={{ color: '#111' }} viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          <CtrlBtn onClick={nextTrack} title={t('next')}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
          </CtrlBtn>

          <CtrlBtn onClick={toggleRepeat} active={repeat !== 'none'} accent={accentHex} title={`Repeat: ${repeat}`}>
            <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/>
              <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
              {repeat === 'one' && <text x="10" y="14.5" fontSize="6.5" fill="currentColor" stroke="none" fontWeight="bold">1</text>}
            </svg>
          </CtrlBtn>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2.5 w-full max-w-xl">
          <span className="text-[11px] text-white/30 w-9 text-right tabular-nums">
            {sc.formatDuration(displayProgress * 1000)}
          </span>
          <div className="flex-1">
            <Slider value={displayProgress} min={0} max={duration || 100} onChange={handleProgressChange} onCommit={handleProgressCommit} color={accentHex} />
          </div>
          <span className="text-[11px] text-white/30 w-9 tabular-nums">
            {sc.formatDuration(duration * 1000)}
          </span>
        </div>
      </div>

      {/* ── Right: queue btn + visualizer + volume ── */}
      <div className="flex flex-col items-end gap-2 w-52 shrink-0">
        <div className="flex items-center justify-end gap-1 w-full">
          <Visualizer analyserRef={analyserRef} />
          <button
            onClick={() => currentTrack && setShowFullscreen(true)}
            title={t('fullscreen')}
            className="p-1.5 rounded-lg transition-all duration-150 active:scale-90"
            style={{ color: 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)')}
          >
            <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3"/>
            </svg>
          </button>
          <button
            onClick={() => setShowQueue(!showQueue)}
            title={t('queue')}
            className="p-1.5 rounded-lg transition-all duration-150 active:scale-90 relative"
            style={{ color: showQueue ? accentHex : 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => !showQueue && ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)')}
            onMouseLeave={e => !showQueue && ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)')}
          >
            <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z"/>
            </svg>
            {queue.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center"
                style={{ background: accentHex, color: '#111' }}>
                {queue.length > 99 ? '∞' : queue.length}
              </span>
            )}
          </button>
        </div>
        <div className="flex items-center gap-2 w-full">
          <button
            onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
            className="text-white/40 hover:text-white/80 transition-colors shrink-0"
          >
            {volume === 0 ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
              </svg>
            ) : volume < 0.5 ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            )}
          </button>
          <Slider value={volume} min={0} max={1} onChange={setVolume} onCommit={setVolume} color={accentHex} />
        </div>
      </div>
    </div>
    </>
  )
}

function CtrlBtn({ children, onClick, active, accent, title }: {
  children: React.ReactNode; onClick: () => void; active?: boolean; accent?: string; title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="relative p-2 rounded-lg transition-all duration-150 active:scale-90"
      style={{ color: active ? (accent ?? 'var(--accent)') : 'rgba(255,255,255,0.4)' }}
      onMouseEnter={e => !active && ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)')}
      onMouseLeave={e => !active && ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)')}
    >
      {children}
      {active && (
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{ bottom: 1, width: 3, height: 3, background: accent ?? 'var(--accent)' }}
        />
      )}
    </button>
  )
}
