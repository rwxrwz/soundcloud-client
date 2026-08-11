import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { useProfile, useUI, useSettings, usePlayer, useUpdate, ACCENT_COLORS } from '../store'
import { pendingUpdate } from '../services/updates'
import { useT } from '../i18n'
import logo from '../assets/logo_sidebar.png'

export const NAV = [
  { id: 'main'      as const, key: 'home'      as const, icon: HomeIcon },
  { id: 'stream'    as const, key: 'stream'    as const, icon: StreamIcon },
  { id: 'releases'  as const, key: 'releases'  as const, icon: ReleasesIcon },
  { id: 'likes'     as const, key: 'likes'     as const, icon: HeartIcon  },
  { id: 'playlists' as const, key: 'playlists' as const, icon: ListIcon   },
  { id: 'friends'   as const, key: 'friends'   as const, icon: FriendsIcon },
  { id: 'search'    as const, key: 'search'    as const, icon: SearchIcon },
]

export function Sidebar() {
  const { user, likes, playlists, setLikes, setPlaylists, setStream, clientId, oauthToken } = useProfile()
  const { page, setPage, goToPlaylists, setShowSettings, setArtistPage } = useUI()
  const { accent, playerStyle, hiddenNav } = useSettings()
  const visibleNav = NAV.filter(item => !hiddenNav.includes(item.id))
  const compact = playerStyle === 'fullscreen'
  const showVolume = compact && page === 'main'
  const t = useT()
  const [syncing, setSyncing] = useState(false)
  const accentHex = ACCENT_COLORS[accent as keyof typeof ACCENT_COLORS] ?? 'var(--accent)'
  const { current, releases } = useUpdate()
  // Persistent dot on the gear whenever a newer release exists (ignores the
  // banner's per-version dismissal, so the hint stays until you actually update).
  const hasUpdate = !!pendingUpdate(current, releases, null)

  const handleRefresh = async () => {
    if (!user || syncing) return
    setSyncing(true)
    try {
      const { sc } = await import('../services/soundcloud')
      sc.setCredentials(clientId, oauthToken, user.id)
      const [likesTracks, playlistsRes, streamRes] = await Promise.all([
        sc.getAllLikes(user.id, 3000),
        sc.getPlaylists(user.id),
        sc.getStream(50),
      ])
      setLikes(likesTracks)
      setPlaylists(playlistsRes.collection)
      setStream(streamRes.collection.map((item: any) => item.track).filter(Boolean))
    } catch (e) {
      console.error('Refresh failed:', e)
    } finally {
      setSyncing(false)
    }
  }
  const navRef = useRef<HTMLElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)

  const navActiveId = visibleNav.find(item =>
    page === item.id || (item.id === 'playlists' && page === 'playlist-detail')
  )?.id ?? 'stream'

  useLayoutEffect(() => {
    const nav = navRef.current
    const pill = pillRef.current
    if (!nav || !pill) return
    const btn = nav.querySelector('[data-active="true"]') as HTMLElement | null
    if (!btn) return
    pill.style.transform = `translateY(${btn.offsetTop}px)`
    pill.style.height = `${btn.offsetHeight}px`
  }, [navActiveId])

  return (
    <>
      <div className="w-full flex flex-col h-full relative">
        {/* Logo / drag region */}
        <div className={`pt-4 pb-3 drag-region ${compact ? 'px-0' : 'px-4'}`}>
          <div className={`flex items-center gap-2.5 no-drag ${compact ? 'justify-center' : ''}`}>
            <div className="w-7 h-7 shrink-0">
              <img src={logo} alt="" className="w-full h-full object-contain" />
            </div>
            {!compact && <span className="font-semibold text-sm text-white/80">SoundCloud</span>}
          </div>
        </div>

        {/* User card */}
        {user && (
          <div onClick={() => setArtistPage(user)} title={t('viewProfile')} role="button"
            className={`mb-3 rounded-xl slide-right cursor-pointer transition-colors ${compact ? 'mx-2 p-0 flex justify-center bg-transparent border-0' : 'mx-3 px-3 py-2.5 hover:bg-white/[0.08]'}`}
            style={compact ? undefined : {
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
            <div className={`flex items-center ${compact ? '' : 'gap-2.5'}`}>
              <div className="relative shrink-0">
                <img
                  src={user.avatar_url?.replace('-large', '-t50x50')}
                  alt=""
                  className={`rounded-full object-cover ${compact ? 'w-9 h-9' : 'w-8 h-8'}`}
                />
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#080808]"
                  style={{ background: accentHex }} />
              </div>
              {!compact && (
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate text-white/90">{user.full_name || user.username}</p>
                  <p className="text-[10px] text-white/40 truncate">@{user.username}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Nav */}
        <nav ref={navRef} className="flex-1 px-2 space-y-0.5 overflow-y-auto relative">
          {/* Sliding pill */}
          <span
            ref={pillRef}
            className="absolute left-0 right-0 mx-2 rounded-xl pointer-events-none"
            style={{
              top: 0,
              height: 0,
              background: `rgba(var(--accent-rgb), 0.18)`,
              willChange: 'transform',
              transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), height 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />

          {visibleNav.map((item, i) => {
            const active = page === item.id || (item.id === 'playlists' && page === 'playlist-detail')
            const Icon = item.icon
            return (
              <button
                key={item.id}
                data-active={active ? 'true' : undefined}
                onClick={() => item.id === 'playlists' ? goToPlaylists() : setPage(item.id)}
                title={compact ? t(item.key) : undefined}
                className={`w-full flex items-center rounded-xl text-sm font-medium relative group ${compact ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}`}
                style={{
                  color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                  transition: 'color 0.3s ease',
                }}
              >
                {/* Left accent bar — only in the wide sidebar (looks stray when icons are centered) */}
                {!compact && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full"
                    style={{
                      height: active ? 20 : 0,
                      background: accentHex,
                      transition: 'height 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                )}

                <span style={{ color: active ? accentHex : undefined }} className="transition-colors duration-300">
                  <Icon />
                </span>

                {!compact && t(item.key)}

                {!compact && item.id === 'likes' && likes.length > 0 && (
                  <span className="ml-auto text-[10px] text-white/30">{likes.length}</span>
                )}
                {!compact && item.id === 'playlists' && playlists.length > 0 && (
                  <span className="ml-auto text-[10px] text-white/30">{playlists.length}</span>
                )}

                {/* Hover glow */}
                {!active && (
                  <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ background: 'rgba(255,255,255,0.04)' }} />
                )}
              </button>
            )
          })}
        </nav>

        {/* Volume — only in the fullscreen style on Home (the default style keeps
            the volume slider in the bottom NowPlaying bar). Collapses with an animation. */}
        <div
          className="overflow-hidden shrink-0"
          style={{
            maxHeight: showVolume ? 168 : 0,
            opacity: showVolume ? 1 : 0,
            pointerEvents: showVolume ? 'auto' : 'none',
            transition: 'max-height 0.34s cubic-bezier(0.16,1,0.3,1), opacity 0.24s ease',
          }}
        >
          <VolumeColumn accentHex={accentHex} />
        </div>

        {/* Bottom bar: refresh + settings */}
        <div className={`p-3 flex gap-1.5 ${compact ? 'flex-col items-center' : ''}`}>
          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            title={compact ? t('settings') : undefined}
            className={`flex items-center text-sm text-white/40 hover:text-white/80 transition-all duration-200 hover:bg-white/5 rounded-xl ${compact ? 'justify-center w-9 h-9' : 'flex-1 gap-2.5 px-3 py-2'}`}
          >
            <span className="relative shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              {hasUpdate && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ background: accentHex, boxShadow: '0 0 0 2px #080808' }} />
              )}
            </span>
            {!compact && t('settings')}
          </button>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={syncing}
            title={t('refreshLibrary')}
            className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-all duration-200 hover:bg-white/5"
            style={{ color: syncing ? accentHex : 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => { if (!syncing) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)' }}
            onMouseLeave={e => { if (!syncing) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
          >
            <svg
              className="w-4 h-4"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style={{ animation: syncing ? 'spin 0.8s linear infinite' : 'none' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
          </button>
        </div>
      </div>
    </>
  )
}

function VolumeColumn({ accentHex }: { accentHex: string }) {
  const { volume, setVolume, toggleMute } = usePlayer()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)
  const active = dragging || hovering
  const pct = Math.min(100, Math.max(0, volume * 100))
  const round = (v: number) => Math.round(v * 100) / 100
  // Ctrl+click to type an exact percentage.
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const applyInput = () => { const n = parseInt(inputVal, 10); if (!isNaN(n)) setVolume(round(Math.min(1, Math.max(0, n / 100)))); setEditing(false) }

  // top of the track = full volume, bottom = muted
  const valueFrom = useCallback((clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.height === 0) return volume
    return round(Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height)))
  }, [volume])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); setInputVal(String(Math.round(volume * 100))); setEditing(true); return }
    e.preventDefault()
    setDragging(true)
    setVolume(valueFrom(e.clientY))
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => setVolume(valueFrom(e.clientY))
    const up = () => setDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging, valueFrom, setVolume])

  const onWheel = (e: React.WheelEvent) => {
    setVolume(round(Math.min(1, Math.max(0, volume - Math.sign(e.deltaY) * 0.05))))
  }

  return (
    <div className="pt-3 pb-1 flex flex-col items-center gap-2 relative">
      {editing && (
        <input
          autoFocus
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          onKeyDown={(e) => { if (e.key === 'Enter') applyInput(); else if (e.key === 'Escape') setEditing(false) }}
          onBlur={applyInput}
          className="absolute z-20 left-1/2 -translate-x-1/2 w-12 text-center text-xs text-white rounded-md py-1 focus:outline-none"
          style={{ top: 40, background: 'rgba(20,20,26,0.98)', border: '1px solid rgba(var(--accent-rgb),0.5)' }}
        />
      )}
      <div
        ref={trackRef}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="relative cursor-pointer select-none"
        style={{ width: 20, height: 108 }}
      >
        <div className="absolute rounded-full" style={{
          left: '50%', transform: 'translateX(-50%)',
          width: active ? 5 : 3, top: 0, bottom: 0,
          background: 'rgba(255,255,255,0.12)',
          transition: 'width 0.12s ease',
        }}>
          <div className="absolute bottom-0 left-0 right-0 rounded-full" style={{
            height: `${pct}%`,
            background: accentHex,
            transition: dragging ? 'none' : 'height 0.1s linear',
          }} />
        </div>
        <div style={{
          position: 'absolute',
          width: 13, height: 13, borderRadius: '50%', background: '#fff',
          left: '50%',
          bottom: `calc(${pct}% - 6.5px)`,
          transform: `translateX(-50%) scale(${dragging ? 1.2 : 1})`,
          opacity: active ? 1 : 0,
          transition: 'opacity 0.15s ease, transform 0.1s ease',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }} />
      </div>
      <button
        onClick={toggleMute}
        className="text-white/40 hover:text-white/80 transition-colors"
        title="Mute"
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
    </div>
  )
}

function HomeIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10"/>
  </svg>
}
function StreamIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0l-4-4m4 4l-4 4M5 11l4-4M5 11l4 4"/>
  </svg>
}
function ReleasesIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l2.09 4.26L18.8 8l-3.4 3.32.8 4.68L12 13.77 7.8 16l.8-4.68L5.2 8l4.71-.74L12 3z"/>
  </svg>
}
function HeartIcon() {
  return <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
  </svg>
}
function ListIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10"/>
  </svg>
}
function SearchIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
  </svg>
}
function FriendsIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-1a4 4 0 00-4-4h-1m-4 5H2v-1a4 4 0 014-4h4a4 4 0 014 4v1zm-2-9a3 3 0 11-6 0 3 3 0 016 0zm7-1a3 3 0 11-6 0 3 3 0 016 0z"/>
  </svg>
}
