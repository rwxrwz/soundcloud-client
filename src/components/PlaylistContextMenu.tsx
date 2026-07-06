import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUI, usePlayer, useToast, useProfile } from '../store'
import { sc, SCPlaylist } from '../services/soundcloud'
import { playlistCache } from '../services/playlistCache'
import { encodePlaylist, encodePlaylistText } from '../services/playlistShare'
import { ConfirmDialog } from './ConfirmDialog'
import { useT } from '../i18n'

export function PlaylistContextMenu() {
  const { playlistMenu, setPlaylistMenu, setSelectedPlaylist, selectedPlaylist, backFromPlaylist } = useUI()
  const { setTrack } = usePlayer()
  const { show: showToast } = useToast()
  const { user, removeLocalPlaylist, renameLocalPlaylist, setPlaylists, likedPlaylists, setLikedPlaylists } = useProfile()
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [delTarget, setDelTarget] = useState<SCPlaylist | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [renameTarget, setRenameTarget] = useState<SCPlaylist | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)

  useEffect(() => {
    if (!playlistMenu) return
    const el = ref.current
    let x = playlistMenu.x, y = playlistMenu.y
    if (el) {
      const r = el.getBoundingClientRect()
      if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 8
      if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 8
    }
    setPos({ x, y })
  }, [playlistMenu])

  useEffect(() => {
    if (!playlistMenu) return
    const close = () => setPlaylistMenu(null)
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
  }, [playlistMenu, setPlaylistMenu])

  const pl = playlistMenu?.playlist

  const handleDelete = async () => {
    const target = delTarget
    if (!target || delBusy) return
    const finish = () => {
      playlistCache.delete(target.id)
      if (selectedPlaylist?.id === target.id) backFromPlaylist()
      showToast(t('playlistDeleted'), 'success')
      setDelTarget(null)
    }
    // Local playlists (synthetic negative id) are removed locally, no API call
    if (target.id < 0) { removeLocalPlaylist(target.id); finish(); return }
    setDelBusy(true)
    try {
      await sc.deletePlaylist(target.id)
      finish()
      if (user) {
        try { const res = await sc.getPlaylists(user.id); setPlaylists(res.collection) }
        catch { /* list refreshes on next sync */ }
      }
    } catch (e) {
      console.error('[DeletePlaylist] failed:', e)
      showToast(t('deletePlaylistErr'), 'error')
    } finally {
      setDelBusy(false)
    }
  }

  const handleRename = async () => {
    const target = renameTarget
    const name = renameValue.trim()
    if (!target || !name || renameBusy) return
    if (name === target.title) { setRenameTarget(null); return }
    const finish = () => {
      // Reflect the new title in the open playlist view without navigating
      if (selectedPlaylist?.id === target.id) useUI.setState({ selectedPlaylist: { ...selectedPlaylist, title: name } })
      showToast(t('playlistRenamed'), 'success')
      setRenameTarget(null)
    }
    if (target.id < 0) { renameLocalPlaylist(target.id, name); finish(); return }
    setRenameBusy(true)
    try {
      await sc.renamePlaylist(target.id, name)
      finish()
      if (user) {
        try { const res = await sc.getPlaylists(user.id); setPlaylists(res.collection) }
        catch { /* list refreshes on next sync */ }
      }
    } catch (e) {
      console.error('[RenamePlaylist] failed:', e)
      showToast(t('renameErr'), 'error')
    } finally {
      setRenameBusy(false)
    }
  }

  let menu: React.ReactNode = null
  if (pl) {
    const tracks = playlistCache.get(pl.id) ?? pl.tracks ?? []
    const art = (pl.artwork_url ?? pl.tracks?.[0]?.artwork_url)?.replace('-large', '-t200x200')

    const totalMs = pl.duration || tracks.reduce((s, tr) => s + (tr.duration || 0), 0)
    const totalMin = Math.round(totalMs / 60000)
    const h = Math.floor(totalMin / 60), m = totalMin % 60
    const dur = h ? `${h}${t('hShort')} ${m}${t('mShort')}` : `${m}${t('mShort')}`

    const play = () => {
      const list = playlistCache.get(pl.id) ?? pl.tracks ?? []
      if (list.length) setTrack(list[0], list)
    }
    const share = async () => {
      const ids = tracks.map(tr => tr.id).filter(Boolean)
      if (!ids.length) return
      try { await navigator.clipboard.writeText(encodePlaylist(pl.title, ids)); showToast(t('codeCopied'), 'success') } catch { /* ignore */ }
    }
    const exportText = async () => {
      // Ensure tracks carry titles/artists for the readable export
      let list = tracks
      if (!list.length) return
      if (list.some(tr => !tr.title)) {
        try { list = await sc.getTracksByIds(list.map(tr => tr.id).filter(Boolean)); playlistCache.set(pl.id, list) } catch { /* use what we have */ }
      }
      try { await navigator.clipboard.writeText(encodePlaylistText(pl.title, list)); showToast(t('textCopied'), 'success') } catch { /* ignore */ }
    }

    // Own = a local playlist or one authored by the current user. Rename/delete are
    // owner-only; for someone else's playlist we offer a like/unlike toggle instead.
    const isOwn = pl.id < 0 || (!!user && pl.user?.id === user.id)
    const isLiked = likedPlaylists.some(p => p.id === pl.id)
    const toggleLikePlaylist = () => {
      const prev = likedPlaylists
      if (isLiked) {
        setLikedPlaylists(prev.filter(p => p.id !== pl.id))
        showToast(t('playlistUnliked'), 'info')
        sc.unlikePlaylist(pl.id).catch(() => { setLikedPlaylists(prev); showToast(t('errUnlike'), 'error') })
      } else {
        setLikedPlaylists([pl, ...prev])
        showToast(t('playlistLiked'), 'success')
        sc.likePlaylist(pl.id).catch(() => { setLikedPlaylists(prev); showToast(t('errLike'), 'error') })
      }
    }

    const likeItem = {
      label: isLiked ? t('unlikePlaylistAction') : t('likePlaylistAction'),
      icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" /></svg>,
      onClick: toggleLikePlaylist,
    }
    const renameItem = { label: t('renamePlaylist'), icon: <IcoStroke><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" /></IcoStroke>, onClick: () => { setRenameValue(pl.title); setRenameTarget(pl) } }
    const deleteItem = { label: t('deletePlaylist'), icon: <IcoStroke><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6" /></IcoStroke>, onClick: () => setDelTarget(pl) }

    const items = [
      { label: t('ctxOpen'), icon: <IcoStroke><path d="M9 18l6-6-6-6" /></IcoStroke>, onClick: () => setSelectedPlaylist(pl) },
      { label: t('ctxPlay'), icon: <Ico><path d="M8 5v14l11-7z" /></Ico>, onClick: play },
      ...(isOwn ? [renameItem] : [likeItem]),
      { label: t('sharePlaylist'), icon: <IcoStroke><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></IcoStroke>, onClick: share },
      { label: t('exportText'), icon: <IcoStroke><path d="M9 12h6M9 16h6M9 8h2M14 2v6h6M14 2l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" /></IcoStroke>, onClick: exportText },
      { label: t('ctxCopyLink'), icon: <IcoStroke><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></IcoStroke>, onClick: () => { if (pl.permalink_url) { navigator.clipboard.writeText(pl.permalink_url).catch(() => {}); showToast(t('linkCopied'), 'success') } } },
      { label: t('ctxOpenBrowser'), icon: <IcoStroke><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></IcoStroke>, onClick: () => { if (pl.permalink_url) window.open(pl.permalink_url) } },
      ...(isOwn ? [deleteItem] : []),
    ]

    menu = (
      <div
        ref={ref}
        className="fixed z-[200] py-1.5 rounded-xl"
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
        {/* Playlist info header */}
        <div className="px-3 pt-2.5 pb-2.5 mb-1 flex gap-2.5 border-b border-white/8">
          <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 shrink-0">
            {art
              ? <img src={art} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white/20" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/></svg>
                </div>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white/90 truncate">{pl.title}</p>
            <p className="text-[11px] text-white/40 truncate">{t('byAuthor')} {pl.user?.username || '—'}</p>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-white/45">
              <span>{pl.track_count} {t('tracksWord')}</span>
              <span>·</span>
              <span>{dur}</span>
            </div>
          </div>
        </div>

        {items.map((it, i) => (
          <button
            key={i}
            onClick={() => { it.onClick(); setPlaylistMenu(null) }}
            className="w-full flex items-center gap-2.5 text-left px-3.5 py-1.5 text-sm text-white/75 hover:text-white transition-colors"
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

  return (
    <>
      {menu}
      {renameTarget && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center playlist-picker-backdrop"
          onClick={e => { if (e.target === e.currentTarget) setRenameTarget(null) }}
        >
          <div className="playlist-picker-panel glass-island rounded-2xl w-80 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8">
              <p className="text-sm font-semibold text-white/90">{t('renamePlaylist')}</p>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <input
                autoFocus
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenameTarget(null) }}
                className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.5)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
              />
              <div className="flex items-center gap-2">
                <button onClick={() => setRenameTarget(null)} className="flex-1 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white/90 transition-all" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {t('cancel')}
                </button>
                <button
                  onClick={handleRename}
                  disabled={renameBusy || !renameValue.trim()}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: 'var(--accent)' }}
                >
                  {renameBusy && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {t('rename')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {delTarget && (
        <ConfirmDialog
          message={t('deletePlaylistConfirm')}
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
          danger
          busy={delBusy}
          requireText={delTarget.title}
          requireTextLabel={t('typeNameToConfirm')}
          onConfirm={handleDelete}
          onCancel={() => setDelTarget(null)}
        />
      )}
    </>
  )
}

function Ico({ children }: { children: React.ReactNode }) {
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">{children}</svg>
}
function IcoStroke({ children }: { children: React.ReactNode }) {
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
}
