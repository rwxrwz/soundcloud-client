import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useProfile, useUI, useSettings, ACCENT_COLORS } from '../store'
import { SettingsPanel } from './SettingsPanel'
import { useT } from '../i18n'
import logo from '../assets/logo_sidebar.png'

const NAV = [
  { id: 'stream'    as const, key: 'stream'    as const, icon: StreamIcon },
  { id: 'releases'  as const, key: 'releases'  as const, icon: ReleasesIcon },
  { id: 'likes'     as const, key: 'likes'     as const, icon: HeartIcon  },
  { id: 'playlists' as const, key: 'playlists' as const, icon: ListIcon   },
  { id: 'search'    as const, key: 'search'    as const, icon: SearchIcon },
]

export function Sidebar() {
  const { user, likes, playlists, setLikes, setPlaylists, setStream, clientId, oauthToken } = useProfile()
  const { page, setPage, goToPlaylists, showSettings, setShowSettings } = useUI()
  const { accent } = useSettings()
  const t = useT()
  const [syncing, setSyncing] = useState(false)
  const accentHex = ACCENT_COLORS[accent as keyof typeof ACCENT_COLORS] ?? 'var(--accent)'

  const handleRefresh = async () => {
    if (!user || syncing) return
    setSyncing(true)
    try {
      const { sc } = await import('../services/soundcloud')
      sc.setCredentials(clientId, oauthToken, user.id)
      const [likesRes, playlistsRes, streamRes] = await Promise.all([
        sc.getLikes(user.id, 200),
        sc.getPlaylists(user.id),
        sc.getStream(50),
      ])
      setLikes(likesRes.collection.map((item: any) => item.track ?? item).filter(Boolean))
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

  const navActiveId = NAV.find(item =>
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
        <div className="px-4 pt-4 pb-3 drag-region">
          <div className="flex items-center gap-2.5 no-drag">
            <div className="w-7 h-7 shrink-0">
              <img src={logo} alt="" className="w-full h-full object-contain" />
            </div>
            <span className="font-semibold text-sm text-white/80">SoundCloud</span>
          </div>
        </div>

        {/* User card */}
        {user && (
          <div className="mx-3 mb-3 px-3 py-2.5 rounded-xl slide-right"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
            <div className="flex items-center gap-2.5">
              <div className="relative shrink-0">
                <img
                  src={user.avatar_url?.replace('-large', '-t50x50')}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                />
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#080808]"
                  style={{ background: accentHex }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate text-white/90">{user.full_name || user.username}</p>
                <p className="text-[10px] text-white/40 truncate">@{user.username}</p>
              </div>
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

          {NAV.map((item, i) => {
            const active = page === item.id || (item.id === 'playlists' && page === 'playlist-detail')
            const Icon = item.icon
            return (
              <button
                key={item.id}
                data-active={active ? 'true' : undefined}
                onClick={() => item.id === 'playlists' ? goToPlaylists() : setPage(item.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium relative group"
                style={{
                  color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                  transition: 'color 0.3s ease',
                }}
              >
                {/* Left accent bar */}
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full"
                  style={{
                    height: active ? 20 : 0,
                    background: accentHex,
                    transition: 'height 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />

                <span style={{ color: active ? accentHex : undefined }} className="transition-colors duration-300">
                  <Icon />
                </span>

                {t(item.key)}

                {item.id === 'likes' && likes.length > 0 && (
                  <span className="ml-auto text-[10px] text-white/30">{likes.length}</span>
                )}
                {item.id === 'playlists' && playlists.length > 0 && (
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

        {/* Bottom bar: refresh + settings */}
        <div className="p-3 flex gap-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-white/40 hover:text-white/80 transition-all duration-200 hover:bg-white/5"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            {t('settings')}
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

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  )
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
