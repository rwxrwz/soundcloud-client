import { useEffect, useRef, useState } from 'react'
import { usePlayer, useUI, useAccentHex, useLyrics } from '../store'
import { sc } from '../services/soundcloud'
import { useT } from '../i18n'

// Fullscreen-only mini-queue: a corner button that pops a floating, animated
// panel of the current queue (same UX as the palette flyout). Click a track to
// jump to it. Mirrors QuickCustomize's open/close animation.
export function QueueFlyout() {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const close = () => { if (closing) return; setClosing(true); setTimeout(() => { setOpen(false); setClosing(false) }, 140) }
  const { queue, queueIndex, setTrack, isPlaying } = usePlayer()
  const { setContextMenu } = useUI()
  const accentHex = useAccentHex()
  const lyricsAvail = useLyrics(s => s.available)
  const t = useT()
  const activeRef = useRef<HTMLButtonElement>(null)

  // Centre the currently playing track when the panel opens
  useEffect(() => {
    if (open && !closing) {
      requestAnimationFrame(() => activeRef.current?.scrollIntoView({ block: 'center' }))
    }
  }, [open, closing])

  return (
    <div className="absolute z-30" style={{ right: 78, bottom: 22 }}>
      {/* invisible click-catcher */}
      {open && <div className="fixed inset-0" onClick={close} />}

      {open && (
        <div
          className="absolute rounded-2xl flex flex-col"
          style={{
            bottom: '118%', right: 0, width: 320, maxHeight: '70vh',
            background: 'rgba(16,16,22,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 14px 44px rgba(0,0,0,0.55)',
            transformOrigin: 'bottom right',
            animation: closing ? 'scale-out 0.13s ease forwards' : 'scale-in 0.14s ease',
          }}
        >
          <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="text-sm font-bold text-white/90">{t('queue')}</span>
            <span className="text-[11px] text-white/35">{queue.length} {t('tracksWord')}</span>
          </div>

          <div className="overflow-y-auto p-1.5" style={{ minHeight: 0 }}>
            {queue.length === 0 && (
              <p className="text-sm text-white/35 text-center py-8">{t('queueEmpty')}</p>
            )}
            {queue.map((track, i) => {
              const active = i === queueIndex
              const art = sc.formatArtwork(track.artwork_url || track.user?.avatar_url, 't200x200')
              return (
                <button
                  key={`${track.id}-${i}`}
                  ref={active ? activeRef : undefined}
                  onClick={() => { if (!active) setTrack(track, queue) }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track }) }}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left transition-colors"
                  style={{
                    background: active ? 'rgba(var(--accent-rgb),0.16)' : 'transparent',
                    opacity: i < queueIndex ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <div className="w-9 h-9 rounded-md overflow-hidden shrink-0 bg-white/5">
                    {art && <img src={art} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate flex items-center gap-1.5" style={{ color: active ? '#fff' : 'rgba(255,255,255,0.85)' }}>
                      {lyricsAvail[track.id] && (
                        <span className="shrink-0 inline-flex items-center justify-center text-[9px] font-bold rounded"
                          title="Lyrics"
                          style={{ width: 14, height: 14, background: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)' }}>
                          L
                        </span>
                      )}
                      <span className="truncate">{track.title}</span>
                    </p>
                    <p className="text-[10px] text-white/40 truncate">{track.user?.username}</p>
                  </div>
                  {active && <PlayingBars color={accentHex} playing={isPlaying} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <button
        onClick={() => (open ? close() : setOpen(true))}
        title={t('queue')}
        className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 hover:scale-105"
        style={{
          background: open ? 'var(--accent)' : 'rgba(20,20,26,0.9)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 6px 22px rgba(0,0,0,0.45)',
          color: open ? '#fff' : 'rgba(255,255,255,0.85)',
        }}
      >
        <QueueIcon />
      </button>
    </div>
  )
}

function QueueIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h13M3 12h13M3 18h9" />
      <path d="M17 14v6.5l5-3.25z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function PlayingBars({ color, playing }: { color: string; playing: boolean }) {
  return (
    <span className="flex items-end gap-[2px] shrink-0 h-3.5" aria-hidden>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: playing ? 2 : 3, height: playing ? '100%' : 3, background: color,
          borderRadius: playing ? 1 : '50%',
          transformOrigin: 'bottom',
          animation: playing ? `eq-bar 0.9s ease-in-out ${i * 0.18}s infinite` : 'none',
          opacity: playing ? 1 : 0.6,
          transition: 'height 0.2s ease, width 0.2s ease, border-radius 0.2s ease, opacity 0.2s ease',
        }} />
      ))}
    </span>
  )
}
