import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePlayer, useUI, useSettings, ACCENT_COLORS } from '../store'
import { sc } from '../services/soundcloud'
import { Visualizer } from './Visualizer'
import { Slider } from './Slider'
import { TrackActions } from './TrackActions'
import { useT } from '../i18n'
import { fetchLyrics, LyricsResult } from '../services/lyrics'

interface Props {
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  seek: (t: number) => void
}

function fmt(s: number): string {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function FullScreenPlayer({ analyserRef, seek }: Props) {
  const { currentTrack, isPlaying, progress, duration, setPlaying, nextTrack, prevTrack, shuffle, repeat, toggleShuffle, toggleRepeat } = usePlayer()
  const { setShowFullscreen, artRgb } = useUI()
  const { accent, lyricsOpen, setLyricsOpen } = useSettings()
  const accentHex = accent === 'artwork'
    ? `#${artRgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
    : (ACCENT_COLORS[accent] ?? ACCENT_COLORS.orange)
  const t = useT()
  const [local, setLocal] = useState<number | null>(null)
  const showLyrics = lyricsOpen
  const setShowLyrics = setLyricsOpen
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setShowFullscreen])

  // Fetch lyrics when the lyrics view is open and the track changes
  useEffect(() => {
    if (!showLyrics || !currentTrack) return
    let cancelled = false
    setLyrics(null); setLyricsLoading(true)
    fetchLyrics({
      trackId: currentTrack.id,
      title: currentTrack.title,
      artist: currentTrack.user?.username ?? '',
      durationSec: (currentTrack.duration ?? 0) / 1000,
    }).then(res => { if (!cancelled) { setLyrics(res); setLyricsLoading(false) } })
    return () => { cancelled = true }
  }, [showLyrics, currentTrack?.id])

  if (!currentTrack) return null
  const artwork = sc.formatArtwork(currentTrack.artwork_url || currentTrack.user?.avatar_url, 't500x500')
  const [r, g, b] = artRgb
  const shown = local ?? progress

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex flex-col items-center justify-center fade-in overflow-hidden"
      style={{ background: '#07070b' }}
    >
      {/* Layered living background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        {artwork && (
          <>
            <img src={artwork} alt=""
              style={{
                position: 'absolute', inset: '-20%', width: '140%', height: '140%',
                objectFit: 'cover', filter: 'blur(90px) saturate(1.4) brightness(0.55)',
                opacity: 0.55, animation: 'fs-float-a 24s ease-in-out infinite',
              }}
            />
            <img src={artwork} alt=""
              style={{
                position: 'absolute', inset: '-20%', width: '140%', height: '140%',
                objectFit: 'cover', filter: 'blur(110px) saturate(1.6) brightness(0.45)',
                opacity: 0.4, animation: 'fs-float-b 32s ease-in-out infinite', mixBlendMode: 'screen',
              }}
            />
          </>
        )}
        {/* Drifting accent blobs from artwork palette */}
        <div style={{
          position: 'absolute', top: '8%', left: '12%', width: 480, height: 480, borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${r},${g},${b},0.5) 0%, transparent 70%)`,
          filter: 'blur(60px)', animation: 'fs-blob 28s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '6%', right: '10%', width: 520, height: 520, borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${Math.min(255,r+60)},${Math.min(255,g+40)},${Math.min(255,b+90)},0.4) 0%, transparent 70%)`,
          filter: 'blur(70px)', animation: 'fs-blob 36s ease-in-out infinite reverse',
        }} />
        {/* Darkening + vignette for readability */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(0,0,0,0.55) 100%)',
        }} />
      </div>

      {/* Lyrics toggle */}
      <button
        onClick={() => setShowLyrics(!showLyrics)}
        title={t('lyrics')}
        className="absolute top-5 left-5 z-10 px-3 h-10 rounded-full flex items-center gap-2 text-sm transition-all"
        style={{
          background: showLyrics ? accentHex : 'rgba(255,255,255,0.08)',
          color: showLyrics ? '#111' : 'rgba(255,255,255,0.7)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h12M4 12h16M4 18h10" />
        </svg>
        {t('lyrics')}
      </button>

      {/* Close */}
      <button
        onClick={() => setShowFullscreen(false)}
        title={t('exitFullscreen')}
        className="absolute top-5 right-5 z-10 w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-all"
        style={{ background: 'rgba(255,255,255,0.08)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      <div className="relative z-[1] flex items-center justify-center gap-12 px-8 w-full"
        style={{ maxWidth: showLyrics ? 980 : 560 }}>

        {/* Lyrics panel — to the left of the artwork */}
        {showLyrics && (
          <div className="shrink-0 fade-in" style={{ width: 400 }}>
            <LyricsView lyrics={lyrics} loading={lyricsLoading} progress={progress} onSeek={seek} t={t} />
          </div>
        )}

        {/* Main column */}
        <div className="flex flex-col items-center w-full max-w-lg">
          {/* Artwork */}
          <div
            className="rounded-3xl overflow-hidden mb-8"
            style={{
              width: 340, height: 340, maxWidth: '60vw', maxHeight: '60vw',
              boxShadow: `0 20px 80px rgba(${r},${g},${b},0.5), 0 8px 32px rgba(0,0,0,0.6)`,
            }}
          >
            {artwork
              ? <img src={artwork} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-white/5" />}
          </div>

          {/* Visualizer */}
          <div className="my-6 h-10 w-full flex items-center justify-center">
            <Visualizer analyserRef={analyserRef} />
          </div>

          {/* Title + artist */}
          <p className="text-2xl font-bold text-white text-center truncate max-w-full">{currentTrack.title}</p>
          <p className="text-base text-white/50 mt-1 mb-4">{currentTrack.user?.username}</p>

        {/* Progress */}
        <div className="w-full">
          <Slider
            value={shown}
            max={duration || 1}
            color={accentHex}
            onChange={setLocal}
            onCommit={(v) => { seek(v); setLocal(null) }}
          />
          <div className="flex justify-between text-xs text-white/40 mt-1 tabular-nums">
            <span>{fmt(shown)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6 mt-6">
          <button onClick={toggleShuffle} title="Shuffle"
            style={{ color: shuffle ? accentHex : 'rgba(255,255,255,0.45)' }}
            className="hover:scale-110 transition-transform">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
            </svg>
          </button>

          <button onClick={prevTrack} className="text-white/80 hover:scale-110 transition-transform">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
          </button>

          <button onClick={() => setPlaying(!isPlaying)}
            className="w-16 h-16 rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg"
            style={{ background: '#fff', boxShadow: `0 0 30px rgba(${r},${g},${b},0.5)` }}>
            {isPlaying ? (
              <svg className="w-7 h-7" style={{ color: '#111' }} viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            ) : (
              <svg className="w-7 h-7 ml-1" style={{ color: '#111' }} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>

          <button onClick={nextTrack} className="text-white/80 hover:scale-110 transition-transform">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-2.5 6L5 6v12z" /></svg>
          </button>

          <button onClick={toggleRepeat} title="Repeat"
            style={{ color: repeat !== 'none' ? accentHex : 'rgba(255,255,255,0.45)' }}
            className="relative hover:scale-110 transition-transform">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" />
              <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
            {repeat === 'one' && <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold" style={{ color: accentHex }}>1</span>}
          </button>
        </div>

          {/* Track actions */}
          <div className="mt-6">
            <TrackActions track={currentTrack} alwaysVisible />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function LyricsView({ lyrics, loading, progress, onSeek, t }: {
  lyrics: LyricsResult | null
  loading: boolean
  progress: number
  onSeek: (t: number) => void
  t: (k: 'lyricsLoading' | 'lyricsNotFound') => string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLParagraphElement>(null)

  const synced = lyrics?.synced ?? null
  const activeIdx = synced
    ? synced.reduce((acc, l, i) => (l.time <= progress + 0.25 ? i : acc), -1)
    : -1

  // Auto-scroll active line to center
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIdx])

  const box = "w-full overflow-y-auto text-center px-2"
  const boxStyle = { height: 360, maxHeight: '52vh', maskImage: 'linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent)' } as React.CSSProperties

  if (loading) return <div className="flex items-center justify-center" style={{ height: 360 }}><div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin" /></div>
  if (!lyrics) return <div className="flex items-center justify-center text-white/40 text-sm" style={{ height: 360 }}>{t('lyricsNotFound')}</div>

  if (synced) {
    return (
      <div ref={containerRef} className={box} style={boxStyle}>
        <div className="py-[40%] space-y-3">
          {synced.map((line, i) => {
            const active = i === activeIdx
            return (
              <p
                key={i}
                ref={active ? activeRef : undefined}
                onClick={() => onSeek(line.time)}
                className="text-xl font-semibold leading-snug cursor-pointer transition-all duration-300"
                style={{
                  color: active ? '#fff' : 'rgba(255,255,255,0.35)',
                  transform: active ? 'scale(1.04)' : 'scale(1)',
                  filter: active ? 'none' : 'blur(0.3px)',
                }}
              >
                {line.text || '♪'}
              </p>
            )
          })}
        </div>
      </div>
    )
  }

  // Plain lyrics
  return (
    <div className={box} style={boxStyle}>
      <div className="py-8 whitespace-pre-line text-white/70 text-base leading-relaxed">{lyrics.plain}</div>
    </div>
  )
}
