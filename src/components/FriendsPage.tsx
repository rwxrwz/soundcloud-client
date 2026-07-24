import { useEffect, useMemo, useRef, useState } from 'react'
import { useProfile, useUI, useToast } from '../store'
import { sc, SCUser } from '../services/soundcloud'
import { useT } from '../i18n'

// Directory of people you follow. Search + pin them here; clicking anyone opens
// the unified user page (ArtistPage) with all their tabs.
export function FriendsPage() {
  const { user, followings, setFollowings, pinnedFriendIds, togglePinFriend } = useProfile()
  const setArtistPage = useUI(s => s.setArtistPage)
  const { show: showToast } = useToast()
  const t = useT()
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; friend: SCUser } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!user || followings.length) return
    let cancelled = false
    sc.getFollowings(user.id).then(res => { if (!cancelled) setFollowings(res.collection ?? []) }).catch(() => {})
    return () => { cancelled = true }
  }, [user, followings.length, setFollowings])

  useEffect(() => {
    if (!menu) return
    let x = menu.x, y = menu.y
    const el = menuRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 8
      if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 8
    }
    setMenuPos({ x, y })
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const id = requestAnimationFrame(() => {
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
      window.addEventListener('keydown', onKey)
    })
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const av = (u: SCUser, size: string) => u.avatar_url?.replace('-large', size)
  const initials = (u: SCUser) => (u.full_name || u.username || '?').trim().slice(0, 2).toUpperCase()
  const pinnedSet = useMemo(() => new Set(pinnedFriendIds), [pinnedFriendIds])

  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? followings.filter(f => (f.full_name || '').toLowerCase().includes(q) || (f.username || '').toLowerCase().includes(q))
      : followings
    return [...filtered.filter(f => pinnedSet.has(f.id)), ...filtered.filter(f => !pinnedSet.has(f.id))]
  }, [followings, query, pinnedSet])

  const openMenu = (e: React.MouseEvent, friend: SCUser) => {
    e.preventDefault(); e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, friend })
  }

  if (user && !followings.length) {
    return <div className="h-full flex items-center justify-center"><p className="text-sm text-white/40">{t('friendsEmpty')}</p></div>
  }

  const menuItems = menu ? (() => {
    const f = menu.friend
    const pinned = pinnedSet.has(f.id)
    return [
      { label: t('ctxOpenArtist'), icon: <Ico><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></Ico>, onClick: () => setArtistPage(f) },
      { label: pinned ? t('friendUnpin') : t('friendPin'), icon: <Ico><path d="M9 4v6l-2 3h10l-2-3V4M12 16v5M8 4h8" /></Ico>, onClick: () => togglePinFriend(f.id) },
      { label: t('ctxCopyLink'), icon: <Ico><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></Ico>, onClick: () => { if (f.permalink_url) { navigator.clipboard.writeText(f.permalink_url).catch(() => {}); showToast(t('linkCopied'), 'success') } } },
      { label: t('ctxOpenBrowser'), icon: <Ico><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></Ico>, onClick: () => { if (f.permalink_url) window.open(f.permalink_url) } },
    ]
  })() : []

  return (
    <div className="h-full flex flex-col min-h-0 px-4 pt-3">
      {/* Search */}
      <div className="relative mb-4 shrink-0 max-w-xs">
        <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t('friendSearch')}
          className="w-full rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none transition-all"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.5)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
        />
      </div>

      {/* Directory grid */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-2">
        {ordered.length === 0 ? (
          <p className="text-sm text-white/40 py-8 text-center">{t('friendsNotFound')}</p>
        ) : (
          <div className="grid gap-3 stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {ordered.map(f => {
              const url = av(f, '-t120x120')
              return (
                <button
                  key={f.id}
                  onClick={() => setArtistPage(f)}
                  onContextMenu={e => openMenu(e, f)}
                  className="relative flex flex-col items-center gap-2 p-3 rounded-xl transition-all"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                >
                  {url
                    ? <img src={url} alt="" className="w-16 h-16 rounded-full object-cover" />
                    : <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-white/60">{initials(f)}</div>}
                  <div className="min-w-0 w-full text-center">
                    <p className="text-xs font-medium text-white truncate">{f.full_name || f.username}</p>
                    <p className="text-[10px] text-white/40 truncate">@{f.username}</p>
                  </div>
                  {pinnedSet.has(f.id) && (
                    <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 4v6l-2 3h10l-2-3V4M12 16v5M8 4h8" /></svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Context menu */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-[200] py-1.5 rounded-xl"
          style={{
            top: menuPos.y, left: menuPos.x, minWidth: 210,
            background: 'rgba(20,20,26,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(20px)',
            animation: 'scale-in 0.12s ease',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 pt-2.5 pb-2.5 mb-1 flex gap-2.5 items-center border-b border-white/8">
            {av(menu.friend, '-t120x120')
              ? <img src={av(menu.friend, '-t120x120')} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
              : <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/60 shrink-0">{initials(menu.friend)}</div>}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white/90 truncate">{menu.friend.full_name || menu.friend.username}</p>
              <p className="text-[11px] text-white/40 truncate">@{menu.friend.username}</p>
            </div>
          </div>
          {menuItems.map((it, i) => (
            <button
              key={i}
              onClick={() => { it.onClick(); setMenu(null) }}
              className="w-full flex items-center gap-2.5 text-left px-3.5 py-1.5 text-sm text-white/75 hover:text-white transition-colors"
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="shrink-0 text-white/50">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Ico({ children }: { children: React.ReactNode }) {
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
}
