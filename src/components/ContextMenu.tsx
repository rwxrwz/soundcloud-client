import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePlayer, useUI, useToast } from '../store'
import { sc } from '../services/soundcloud'
import { findGeniusLink, geniusSearchUrl, type GeniusLink } from '../services/genius'
import { useT } from '../i18n'

function fmt(n?: number) {
  if (!n) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K'
  return String(n)
}

export function ContextMenu() {
  const { contextMenu, setContextMenu, setArtistPage, setPlaylistPickerTrack, setShowTrackPage, setShowQueue, setSelectedAlbum } = useUI()
  const { setTrack } = usePlayer()
  const { show: showToast } = useToast()
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [genius, setGenius] = useState<GeniusLink | null>(null)

  // Resolve while the menu is open, so clicking is a direct window.open. Until it
  // lands (or if it fails) the item falls back to a Genius search for the title.
  useEffect(() => {
    const tr = contextMenu?.track
    if (!tr) { setGenius(null); return }
    let cancelled = false
    setGenius(null)
    findGeniusLink(tr.id, tr.title, tr.user?.username ?? '')
      .then(link => { if (!cancelled) setGenius(link) })
      .catch(() => { /* fall back to search */ })
    return () => { cancelled = true }
  }, [contextMenu?.track.id])

  // Position + keep on-screen. useLayoutEffect so the final coords are applied
  // before the browser paints — otherwise the menu flashes at the previous/zero
  // position and visibly jumps ("opens crooked").
  useLayoutEffect(() => {
    if (!contextMenu) return
    const el = ref.current
    let x = contextMenu.x, y = contextMenu.y
    if (el) {
      const r = el.getBoundingClientRect()
      if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 8
      if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 8
    }
    setPos({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    // Attach on the next frame so the very click/contextmenu event that opened
    // the menu doesn't immediately close it.
    const id = requestAnimationFrame(() => {
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
      window.addEventListener('resize', close)
      window.addEventListener('keydown', onKey)
    })
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu, setContextMenu])

  if (!contextMenu) return null
  const track = contextMenu.track

  const items = [
    {
      label: t('ctxPlay'),
      icon: <Ico><path d="M8 5v14l11-7z"/></Ico>,
      onClick: () => setTrack(track, usePlayer.getState().queue.length ? usePlayer.getState().queue : [track]),
    },
    {
      label: t('ctxAddNext'),
      icon: <Ico><path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm16 5v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z"/></Ico>,
      onClick: () => {
        const { queue, queueIndex } = usePlayer.getState()
        const at = queueIndex + 1
        usePlayer.setState({ queue: [...queue.slice(0, at), track, ...queue.slice(at)] })
      },
    },
    {
      label: t('ctxAddPlaylist'),
      icon: <IcoStroke><path d="M3 6h13M3 12h9M3 18h9M16 15v6M13 18h6"/></IcoStroke>,
      onClick: () => setPlaylistPickerTrack(track),
    },
    { divider: true },
    {
      label: t('ctxGoArtist'),
      icon: <IcoStroke><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></IcoStroke>,
      onClick: () => { if (track.user) { setShowTrackPage(false); setShowQueue(false); setSelectedAlbum(null); setArtistPage(track.user) } },
    },
    {
      label: genius?.exact === false ? t('searchGenius') : t('openGenius'),
      icon: <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[10px] font-extrabold leading-none">G</span>,
      onClick: () => window.open(genius?.url ?? geniusSearchUrl(track.title)),
    },
    {
      label: t('ctxCopyLink'),
      icon: <IcoStroke><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></IcoStroke>,
      onClick: () => {
        if (track.permalink_url) {
          navigator.clipboard.writeText(track.permalink_url).catch(() => {})
          showToast(t('linkCopied'), 'success')
        }
      },
    },
    {
      label: t('ctxOpenBrowser'),
      icon: <IcoStroke><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6M10 14L21 3"/></IcoStroke>,
      onClick: () => { if (track.permalink_url) window.open(track.permalink_url) },
    },
  ]

  return (
    <div
      ref={ref}
      className="fixed z-[200] py-1.5 rounded-xl"
      style={{
        top: pos.y, left: pos.x, minWidth: 190,
        maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', overflowX: 'hidden',
        background: 'rgba(20,20,26,0.97)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)',
        animation: 'scale-in 0.12s ease',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Track info header */}
      <div className="px-3 pt-2.5 pb-2.5 mb-1 flex gap-2.5 border-b border-white/8" style={{ minWidth: 248 }}>
        <img
          src={sc.formatArtwork(track.artwork_url || track.user?.avatar_url, 't200x200')}
          alt="" className="w-11 h-11 rounded-lg object-cover bg-white/5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white/90 truncate">{track.title}</p>
          <p className="text-[11px] text-white/40 truncate">{track.user?.username}</p>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-white/45">
            <Stat v={fmt(track.playback_count)} d="M8 5v14l11-7z" fill />
            <Stat v={fmt(track.likes_count)} d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 10-7.8 7.8l1 1.1L12 21.2l7.8-7.8 1-1.1a5.5 5.5 0 000-7.7z" />
            <Stat v={fmt(track.reposts_count)} d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" />
            <Stat v={fmt(track.comment_count)} d="M21 11.5a8.4 8.4 0 01-9 8.4 8.4 8.4 0 01-3.7-.8L3 21l1.9-5.3A8.4 8.4 0 1121 11.5z" />
          </div>
        </div>
      </div>
      {items.map((it, i) =>
        'divider' in it ? (
          <div key={i} className="my-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
        ) : (
          <button
            key={i}
            onClick={() => { it.onClick!(); setContextMenu(null) }}
            className="w-full flex items-center gap-2.5 text-left px-3.5 py-1.5 text-sm text-white/75 hover:text-white transition-colors"
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span className="shrink-0 text-white/50">{it.icon}</span>
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

function Stat({ v, d, fill }: { v: string; d: string; fill?: boolean }) {
  return (
    <span className="flex items-center gap-0.5">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
      {v}
    </span>
  )
}

function Ico({ children }: { children: React.ReactNode }) {
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">{children}</svg>
}

function IcoStroke({ children }: { children: React.ReactNode }) {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}
