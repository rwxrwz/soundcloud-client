import { useEffect, useRef, useState } from 'react'
import { usePlayer, useUI, useSettings, useAccentHex } from '../store'
import { sc } from '../services/soundcloud'
import { skipFrame } from '../services/perf'
import { fetchLyrics, LyricsResult } from '../services/lyrics'
import { audioBus } from '../hooks/audioBus'
import { Slider } from './Slider'
import { TrackActions } from './TrackActions'
import { LyricsView } from './LyricsView'
import { useT } from '../i18n'

function fmt(s: number): string {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function HomePlayer() {
  const { currentTrack, isPlaying, progress, duration, setPlaying, nextTrack, prevTrack, shuffle, repeat, toggleShuffle, toggleRepeat, seekTo } = usePlayer()
  const { artRgb, setPage, goToPlaylists, setShowTrackPage, setArtistPage, setContextMenu } = useUI()
  const { fsLayout, fsShowLyrics, fsBeatGlow, fsArtCrossfade, lyricsFontScale } = useSettings()
  const accentHex = useAccentHex()
  const t = useT()
  const [local, setLocal] = useState<number | null>(null)
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)

  useEffect(() => {
    if (!currentTrack) { setLyrics(null); return }
    let cancelled = false
    setLyrics(null); setLyricsLoading(true)
    fetchLyrics({
      trackId: currentTrack.id,
      title: currentTrack.title,
      artist: currentTrack.user?.username ?? '',
      durationSec: (currentTrack.duration ?? 0) / 1000,
    }).then(res => { if (!cancelled) { setLyrics(res); setLyricsLoading(false) } })
      .catch(() => { if (!cancelled) setLyricsLoading(false) })
    return () => { cancelled = true }
  }, [currentTrack?.id])

  // Empty state
  if (!currentTrack) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 page-enter">
        <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <svg className="w-9 h-9 text-white/20" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>
        </div>
        <p className="text-sm text-white/40">{t('nothingPlaying')}</p>
        <div className="flex items-center gap-2.5">
          <button onClick={() => setPage('likes')}
            className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all active:scale-95"
            style={{ background: 'var(--accent)', boxShadow: '0 4px 18px rgba(var(--accent-rgb),0.4)' }}>
            {t('browseLibrary')}
          </button>
          <button onClick={goToPlaylists}
            className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all active:scale-95"
            style={{ background: 'var(--accent)', boxShadow: '0 4px 18px rgba(var(--accent-rgb),0.4)' }}>
            {t('browsePlaylists')}
          </button>
        </div>
      </div>
    )
  }

  const artwork = sc.formatArtwork(currentTrack.artwork_url || currentTrack.user?.avatar_url, 't500x500')
  const [r, g, b] = artRgb
  const shown = local ?? progress
  const glow = `0 16px 50px rgba(${r},${g},${b},0.28), 0 6px 22px rgba(0,0,0,0.45)`

  const art = (className: string, style?: React.CSSProperties) => (
    <ArtworkBox artwork={artwork} className={className} style={style} baseGlow={glow}
      beatGlow={fsBeatGlow} crossfade={fsArtCrossfade} glowRgb={artRgb}
      onClick={() => setShowTrackPage(true)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track: currentTrack }) }} />
  )

  const titleEl = (
    <div className="max-w-full min-w-0">
      <p className="text-xl font-bold text-white max-w-full truncate px-2">{currentTrack.title}</p>
      <button
        onClick={() => currentTrack.user && setArtistPage(currentTrack.user)}
        disabled={!currentTrack.user}
        className="text-sm text-white/45 mt-1 max-w-full truncate px-2 hover:text-white/80 transition-colors disabled:hover:text-white/45"
      >
        {currentTrack.user?.username}
      </button>
    </div>
  )

  const progressEl = (
    <div className="w-full">
      <Slider value={shown} max={duration || 1} color={accentHex}
        onChange={setLocal} onCommit={(v) => { seekTo(v); setLocal(null) }} />
      <div className="flex justify-between text-xs text-white/40 mt-1 tabular-nums">
        <span>{fmt(shown)}</span><span>{fmt(duration)}</span>
      </div>
    </div>
  )

  const controlsEl = (
    <div className="flex items-center justify-center gap-5">
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
        className="w-14 h-14 rounded-full flex items-center justify-center hover:scale-105 transition-transform"
        style={{ background: '#fff', boxShadow: `0 0 24px rgba(${r},${g},${b},0.45)` }}>
        {isPlaying
          ? <svg className="w-6 h-6" style={{ color: '#111' }} viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          : <svg className="w-6 h-6 ml-1" style={{ color: '#111' }} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
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
  )

  const actionsEl = <TrackActions track={currentTrack} alwaysVisible />
  const lyricsEl = <LyricsView lyrics={lyrics} loading={lyricsLoading} progress={progress} onSeek={seekTo} mask={false} fontScale={lyricsFontScale} />

  const controlBlock = (
    <div className="w-full flex flex-col items-center text-center">
      <div className="mt-6">{titleEl}</div>
      <div className="w-full mt-5">{progressEl}</div>
      <div className="mt-4">{controlsEl}</div>
      <div className="mt-4">{actionsEl}</div>
    </div>
  )

  const showLyrics = fsShowLyrics
  let content: React.ReactNode
  if (fsLayout === 'split') {
    // Centered — title on top, lyrics+artwork in the middle, controls at the bottom.
    // With text hidden, only the (larger) artwork sits centered in the middle.
    content = (
      <div className="h-full flex flex-col items-center px-12 py-8 overflow-hidden">
        <div className="shrink-0 text-center">{titleEl}</div>
        <div className="flex-1 w-full min-h-0 flex items-center justify-center gap-14 my-6">
          {showLyrics && <div className="flex-1 max-w-xl min-w-0 h-full flex items-center justify-center">{lyricsEl}</div>}
          {art('shrink-0', showLyrics ? { width: 'min(38vh, 380px)', height: 'min(38vh, 380px)' } : { width: 'min(48vh, 480px)', height: 'min(48vh, 480px)' })}
        </div>
        <div className="shrink-0 w-full max-w-md flex flex-col items-center">
          {progressEl}
          <div className="mt-4">{controlsEl}</div>
          <div className="mt-4">{actionsEl}</div>
        </div>
      </div>
    )
  } else if (fsLayout === 'stack' && showLyrics) {
    // Under text — title, lyrics, controls stacked; artwork on the side.
    content = (
      <div className="h-full flex items-center justify-center gap-16 px-12 overflow-hidden">
        <div className="flex-1 max-w-xl min-w-0 flex flex-col items-center text-center">
          <div className="shrink-0">{titleEl}</div>
          <div className="my-5 min-h-0">{lyricsEl}</div>
          <div className="w-full">{progressEl}</div>
          <div className="mt-4">{controlsEl}</div>
          <div className="mt-4">{actionsEl}</div>
        </div>
        {art('shrink-0', { width: 'min(46vh, 460px)', height: 'min(46vh, 460px)' })}
      </div>
    )
  } else {
    // Side — lyrics left, card on the right. With text hidden, an empty spacer
    // keeps its place so the card stays on the right (as if the text were there).
    content = (
      <div className="h-full flex items-center justify-center gap-16 px-12 overflow-hidden">
        {showLyrics
          ? <div className="flex-1 max-w-2xl min-w-0 h-full flex items-center justify-center">{lyricsEl}</div>
          : <div className="flex-1 max-w-2xl min-w-0" />}
        <div className="shrink-0 flex flex-col items-center text-center" style={{ width: 'min(40vh, 400px)' }}>
          {art('w-full aspect-square')}
          {controlBlock}
        </div>
      </div>
    )
  }

  return <div className="flex-1 overflow-hidden page-enter">{content}</div>
}

// Artwork with optional beat-reactive glow + crossfade on track change
function ArtworkBox({ artwork, className, style, baseGlow, beatGlow, crossfade, glowRgb, onClick, onContextMenu }: {
  artwork: string | null
  className: string
  style?: React.CSSProperties
  baseGlow: string
  beatGlow: boolean
  crossfade: boolean
  glowRgb: [number, number, number]
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const rgbRef = useRef(glowRgb); rgbRef.current = glowRgb
  const energyRef = useRef(0)
  const [cur, setCur] = useState(artwork)
  const [prev, setPrev] = useState<string | null>(null)

  // Crossfade: render the previous image under the new one while it fades in
  useEffect(() => {
    if (artwork === cur) return
    if (crossfade) {
      setPrev(cur)
      setCur(artwork)
      const id = setTimeout(() => setPrev(null), 650)
      return () => clearTimeout(id)
    }
    setCur(artwork); setPrev(null)
  }, [artwork]) // eslint-disable-line react-hooks/exhaustive-deps

  // Beat-reactive glow
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!beatGlow) { el.style.boxShadow = baseGlow; return }
    let raf = 0
    const perfLast = { t: 0 }
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (skipFrame(performance.now(), perfLast)) return
      const an = audioBus.analyser
      let target = 0
      if (an && usePlayer.getState().isPlaying) {
        const data = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(data)
        const end = Math.max(1, Math.floor(data.length * 0.07))
        let s = 0; for (let i = 0; i < end; i++) s += data[i]
        target = s / end / 255
      }
      energyRef.current += (target - energyRef.current) * 0.15
      const v = energyRef.current
      const [gr, gg, gb] = rgbRef.current
      const spread = 12 + v * 48, op = 0.18 + v * 0.6
      el.style.boxShadow = `${baseGlow}, 0 0 ${spread}px ${spread * 0.45}px rgba(${gr},${gg},${gb},${op})`
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [beatGlow, baseGlow])

  return (
    <div ref={ref} onClick={onClick} onContextMenu={onContextMenu}
      className={`relative rounded-3xl overflow-hidden ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ boxShadow: baseGlow, ...style }}>
      {prev && <img src={prev} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      {cur
        ? <img key={cur} src={cur} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ animation: crossfade ? 'fade-in 0.6s ease both' : undefined }} />
        : <div className="w-full h-full bg-white/5" />}
    </div>
  )
}
