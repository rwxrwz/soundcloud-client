import { useEffect, useRef, useState } from 'react'
import { useUI, usePlayer, useProfile, useToast } from '../store'
import { sc } from '../services/soundcloud'
import { playlistCache } from '../services/playlistCache'
import { useT } from '../i18n'

export function AlbumContextMenu() {
  const { albumMenu, setAlbumMenu, setSelectedAlbum } = useUI()
  const { setTrack } = usePlayer()
  const { user, likedPlaylists, setLikedPlaylists } = useProfile()
  const { show: showToast } = useToast()
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!albumMenu) return
    const el = ref.current
    let x = albumMenu.x, y = albumMenu.y
    if (el) {
      const r = el.getBoundingClientRect()
      if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 8
      if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 8
    }
    setPos({ x, y })
  }, [albumMenu])

  useEffect(() => {
    if (!albumMenu) return
    const close = () => setAlbumMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
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
  }, [albumMenu, setAlbumMenu])

  if (!albumMenu) return null
  const album = albumMenu.album
  const art = (album.artwork_url ?? album.tracks?.[0]?.artwork_url)?.replace('-large', '-t200x200')
  const isOwn = album.id < 0 || (!!user && album.user?.id === user.id)
  const isLiked = likedPlaylists.some(p => p.id === album.id)
  const kind = album.set_type === 'ep' ? 'EP' : t('albumWord')

  const play = async () => {
    let list = playlistCache.get(album.id) ?? album.tracks ?? []
    if (!list.length) {
      try { const full = await sc.getPlaylist(album.id); list = await sc.hydratePlaylistTracks(full.tracks ?? []); playlistCache.set(album.id, list) } catch { /* ignore */ }
    }
    if (list.length) setTrack(list[0], list)
  }

  const toggleLike = () => {
    const prev = likedPlaylists
    if (isLiked) {
      setLikedPlaylists(prev.filter(p => p.id !== album.id))
      showToast(t('playlistUnliked'), 'info')
      sc.unlikePlaylist(album.id).catch(() => { setLikedPlaylists(prev); showToast(t('errUnlike'), 'error') })
    } else {
      setLikedPlaylists([album, ...prev])
      showToast(t('playlistLiked'), 'success')
      sc.likePlaylist(album.id).catch(() => { setLikedPlaylists(prev); showToast(t('errLike'), 'error') })
    }
  }

  const items = [
    { label: t('ctxOpen'), icon: <IcoStroke><path d="M9 18l6-6-6-6" /></IcoStroke>, onClick: () => setSelectedAlbum(album) },
    { label: t('ctxPlay'), icon: <Ico><path d="M8 5v14l11-7z" /></Ico>, onClick: play },
    ...(isOwn ? [] : [{
      label: isLiked ? t('unlikePlaylistAction') : t('likePlaylistAction'),
      icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" /></svg>,
      onClick: toggleLike,
    }]),
    {
      label: t('ctxCopyLink'),
      icon: <IcoStroke><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></IcoStroke>,
      onClick: () => { if (album.permalink_url) { navigator.clipboard.writeText(album.permalink_url).catch(() => {}); showToast(t('linkCopied'), 'success') } },
    },
    {
      label: t('ctxOpenBrowser'),
      icon: <IcoStroke><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></IcoStroke>,
      onClick: () => { if (album.permalink_url) window.open(album.permalink_url) },
    },
  ]

  return (
    <div
      ref={ref}
      className="fixed z-[200] px-1.5 py-1.5 rounded-xl"
      style={{
        top: pos.y, left: pos.x, minWidth: 230,
        background: 'rgba(20,20,26,0.97)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)',
        animation: 'scale-in 0.12s ease',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div className="px-3 pt-2.5 pb-2.5 mb-1 flex gap-2.5 border-b border-white/8">
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 shrink-0">
          {art
            ? <img src={art} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><svg className="w-5 h-5 text-white/20" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" /></svg></div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white/90 truncate">{album.title}</p>
          <p className="text-[11px] text-white/40 truncate">{t('byAuthor')} {album.user?.username || '—'}</p>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-white/45">
            <span style={{ color: 'var(--accent)' }}>{kind}</span>
            <span>·</span>
            <span>{album.track_count} {t('tracksWord')}</span>
          </div>
        </div>
      </div>

      {items.map((it, i) => (
        <button
          key={i}
          onClick={() => { it.onClick(); setAlbumMenu(null) }}
          className="w-full flex items-center gap-2.5 text-left px-2.5 py-1.5 rounded-lg text-sm text-white/75 hover:text-white transition-colors"
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="shrink-0 text-white/50">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>
  )
}

function Ico({ children }: { children: React.ReactNode }) {
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">{children}</svg>
}
function IcoStroke({ children }: { children: React.ReactNode }) {
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
}
