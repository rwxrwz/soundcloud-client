import { useState, useEffect } from 'react'
import { useSettings, ACCENT_COLORS } from '../store'
import { useT } from '../i18n'

interface MiniState {
  currentTrack: {
    id: number
    title: string
    artwork_url: string
    user: { username: string }
  } | null
  isPlaying: boolean
  volume: number
  progress: number
  duration: number
  artRgb: [number, number, number] | null
}

const DEFAULT: MiniState = {
  currentTrack: null, isPlaying: false, volume: 0.8,
  progress: 0, duration: 0, artRgb: null,
}

export function MiniPlayer() {
  const [ps, setPs] = useState<MiniState>(DEFAULT)
  const { accent } = useSettings()
  const t = useT()
  const accentHex = accent === 'artwork' && ps.artRgb
    ? `#${ps.artRgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
    : (ACCENT_COLORS[accent] ?? ACCENT_COLORS.orange)

  // Transparent body so backdrop-filter sees the desktop behind
  // mini-mode enables drag on the whole window (CSS class)
  useEffect(() => {
    const R = '16px'
    for (const el of [document.documentElement, document.body]) {
      el.style.background = 'transparent'
      el.style.borderRadius = R
      el.style.overflow = 'hidden'
    }
    document.documentElement.classList.add('mini-mode')
    return () => {
      document.documentElement.classList.remove('mini-mode')
      for (const el of [document.documentElement, document.body]) {
        el.style.borderRadius = ''
        el.style.overflow = ''
      }
    }
  }, [])

  // Sync accent CSS vars
  useEffect(() => {
    const hex = accentHex.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    document.documentElement.style.setProperty('--accent', accentHex)
    document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`)
  }, [accentHex])

  // Subscribe to player state from main window
  useEffect(() => {
    window.electronAPI?.getPlayerState().then((s: unknown) => { if (s) setPs(s as MiniState) })
    return window.electronAPI?.onPlayerState((s: unknown) => setPs(s as MiniState))
  }, [])

  const ctrl = (type: string, payload?: unknown) =>
    window.electronAPI?.playerControl({ type, payload })

  const art = ps.currentTrack?.artwork_url?.replace('-large', '-t200x200') ?? null

  // Preload artwork: keep the previous image until the new one is fully loaded,
  // so track changes don't flash a blank square.
  const [displayArt, setDisplayArt] = useState<string | null>(null)
  useEffect(() => {
    if (!art) { setDisplayArt(null); return }
    const img = new Image()
    img.onload = () => setDisplayArt(art)
    img.src = art
  }, [art])

  const title = ps.currentTrack?.title ?? t('nothingPlaying')
  const artist = ps.currentTrack?.user?.username ?? ''
  const [r, g, b] = ps.artRgb ?? [40, 40, 50]

  return (
    <div
      className="mini-glass"
      style={{
        width: '100%', height: '100vh',
        borderRadius: 16,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        fontFamily: "'Inter', system-ui, sans-serif",
        color: '#e8e8e8',
        userSelect: 'none',
      }}
    >
      {/* Artwork colour ambient glow — bleeds in from the left */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 16, pointerEvents: 'none',
        background: `radial-gradient(ellipse at 12% 55%, rgba(${r},${g},${b},0.38) 0%, rgba(${r},${g},${b},0.12) 40%, transparent 70%)`,
        transition: 'background 1.2s ease',
      }} />

      {/* Top specular highlight — the "liquid" edge */}
      <div style={{
        position: 'absolute', top: 0, left: 12, right: 12, height: 1, pointerEvents: 'none',
        background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.22) 30%, rgba(255,255,255,0.22) 70%, transparent)',
        borderRadius: '0 0 4px 4px',
      }} />

      {/* Main content row — entire window is drag zone (see .mini-mode CSS) */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center',
        gap: 11, padding: '6px 12px 9px 10px',
        position: 'relative', zIndex: 1, minWidth: 0,
      }}>
        {/* Close button — top-right corner, floats over content */}
        <div style={{ position: 'absolute', top: 5, right: 7, zIndex: 2 }}>
          <CloseBtn />
        </div>
        {/* Album art — glass card */}
        <div style={{
          width: 78, height: 78, borderRadius: 10, flexShrink: 0,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: `0 4px 20px rgba(${r},${g},${b},0.4), 0 2px 8px rgba(0,0,0,0.5)`,
          overflow: 'hidden',
          transition: 'box-shadow 1.2s ease',
        }}>
          {displayArt
            ? <img key={displayArt} src={displayArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', animation: 'fade-in 0.3s ease' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="rgba(255,255,255,0.15)">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
          }
        </div>

        {/* Text + controls */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, lineHeight: '17px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            textShadow: '0 1px 4px rgba(0,0,0,0.6)',
          }}>
            {title}
          </div>
          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.48)', lineHeight: '14px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {artist}
          </div>

          {/* Controls + volume */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 7 }}>
            <IconBtn onClick={() => ctrl('prev')} title={t('prev')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
              </svg>
            </IconBtn>

            <IconBtn big onClick={() => ctrl('play-pause', !ps.isPlaying)} title={ps.isPlaying ? t('pause') : t('play')}>
              {ps.isPlaying
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              }
            </IconBtn>

            <IconBtn onClick={() => ctrl('next')} title={t('next')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </IconBtn>

            {/* Volume */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, marginLeft: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="rgba(255,255,255,0.32)" style={{ flexShrink: 0 }}>
                {ps.volume === 0
                  ? <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
                  : ps.volume < 0.5
                  ? <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
                  : <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                }
              </svg>
              <input
                type="range"
                min={0} max={1} step={0.01}
                value={ps.volume}
                onChange={e => ctrl('volume', parseFloat(e.target.value))}
                className="mini-volume-slider"
                style={{
                  flex: 1,
                  '--vol-fill': `${ps.volume * 100}%`,
                } as React.CSSProperties}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CloseBtn() {
  const [hover, setHover] = useState(false)
  const t = useT()
  return (
    <button
      onClick={() => window.electronAPI?.closeMiniPlayer()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={t('close')}
      style={{
        WebkitAppRegion: 'no-drag' as 'no-drag',
        width: 28, height: 28, borderRadius: '50%',
        border: 'none', cursor: 'pointer', padding: 0, margin: -9,
        background: 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: '50%',
        background: hover ? 'rgba(255, 65, 65, 0.75)' : 'rgba(255,255,255,0.15)',
        boxShadow: hover ? '0 0 6px rgba(255,65,65,0.5)' : 'none',
        transition: 'background 0.15s ease, box-shadow 0.15s ease',
      }} />
    </button>
  )
}

function IconBtn({
  onClick, children, big, title,
}: {
  onClick: () => void
  children: React.ReactNode
  big?: boolean
  title?: string
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        width: big ? 32 : 26, height: big ? 32 : 26,
        borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
        background: hover
          ? (big ? `rgba(var(--accent-rgb, 255,85,0), 0.28)` : 'rgba(255,255,255,0.12)')
          : (big ? 'rgba(255,255,255,0.08)' : 'transparent'),
        boxShadow: (hover && big) ? `0 0 12px rgba(var(--accent-rgb, 255,85,0), 0.35)` : 'none',
        color: big ? 'var(--accent, #ff5500)' : (hover ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.12s ease',
      }}
    >
      {children}
    </button>
  )
}
