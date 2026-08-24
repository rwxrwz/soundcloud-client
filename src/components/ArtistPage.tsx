import { useEffect, useState, useMemo, useRef } from 'react'
import { useUI, usePlayer, useProfile, useToast } from '../store'
import { sc } from '../services/soundcloud'
import { playlistCache } from '../services/playlistCache'
import type { SCUser, SCTrack, SCPlaylist, SCWebProfile } from '../services/soundcloud'
import { TrackActions } from './TrackActions'
import { TrackCard } from './TrackCard'
import { PlaylistCard } from './TrackList'
import { SegmentedTabs } from './SegmentedTabs'
import { useT, timeAgo } from '../i18n'

type UserTab = 'releases' | 'albums' | 'playlists' | 'likes' | 'following' | 'followers'

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export function ArtistPage({ z = 50 }: { z?: number }) {
  const { artistPageUser, setArtistPage, setContextMenu, drillArtist, backArtist, artistHistory, setSelectedPlaylist } = useUI()
  const { setTrack, currentTrack, isPlaying, setPlaying } = usePlayer()
  const { user: me, followingIds, followOptimistic, unfollowOptimistic, likes, playlists, localPlaylists, pinnedFriendIds, togglePinFriend } = useProfile()
  const [showLibrary, setShowLibrary] = useState(false)
  const { show: showToast } = useToast()
  const t = useT()
  const [user, setUser] = useState<SCUser | null>(artistPageUser)
  const [tracks, setTracks] = useState<SCTrack[]>([])
  const [tracksNext, setTracksNext] = useState<string | null>(null)
  const [tracksMoreLoading, setTracksMoreLoading] = useState(false)
  const [webProfiles, setWebProfiles] = useState<SCWebProfile[]>([])
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState<UserTab>('releases')
  const [albums, setAlbums] = useState<SCPlaylist[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [albumsLoaded, setAlbumsLoaded] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [albumTracks, setAlbumTracks] = useState<Record<number, SCTrack[]>>({})
  const [albumTracksLoading, setAlbumTracksLoading] = useState<number | null>(null)

  // Generic lazy loader for the playlists / likes / following / followers tabs
  const [tabData, setTabData] = useState<any[]>([])
  const [tabLoading, setTabLoading] = useState(false)
  const [tabEmpty, setTabEmpty] = useState(false)
  const [tabNext, setTabNext] = useState<string | null>(null)
  const [tabMoreLoading, setTabMoreLoading] = useState(false)
  const tabCache = useRef<Map<string, { list: any[]; next: string | null }>>(new Map())

  const [closing, setClosing] = useState(false)
  const close = () => { if (closing) return; setClosing(true); setTimeout(() => setArtistPage(null), 300) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const artistId = (user ?? artistPageUser)?.id
  const isFollowing = artistId !== undefined && followingIds.includes(artistId)
  const isSelf = artistId !== undefined && me?.id === artistId
  const isPinned = artistId !== undefined && pinnedFriendIds.includes(artistId)

  // Which of this artist's tracks are in your library (likes + playlists), and
  // for each, which playlists it lives in — Spotify-style. Best-effort: playlist
  // membership uses hydrated tracks from the cache (populated once a playlist is
  // opened), falling back to whatever the playlist object already carries.
  const library = useMemo(() => {
    const byId = new Map<number, { track: SCTrack; playlists: string[]; liked: boolean }>()
    if (artistId === undefined) return { tracks: [], likedCount: 0, playlistCount: 0 }
    for (const tr of likes) {
      if (tr.user?.id === artistId) byId.set(tr.id, { track: tr, playlists: [], liked: true })
    }
    for (const pl of [...localPlaylists, ...playlists]) {
      const trs = playlistCache.get(pl.id) ?? pl.tracks ?? []
      for (const tr of trs) {
        if (tr.user?.id !== artistId) continue
        const e = byId.get(tr.id)
        if (e) { if (!e.playlists.includes(pl.title)) e.playlists.push(pl.title) }
        else byId.set(tr.id, { track: tr, playlists: [pl.title], liked: false })
      }
    }
    const tracks = [...byId.values()]
    return {
      tracks,
      likedCount: tracks.filter(x => x.liked).length,
      playlistCount: tracks.filter(x => x.playlists.length > 0).length,
    }
  }, [artistId, likes, playlists, localPlaylists])
  const toggleFollow = () => {
    if (artistId === undefined) return
    if (isFollowing) {
      unfollowOptimistic(artistId)
      sc.unfollowUser(artistId).catch(() => { followOptimistic(artistId); showToast(t('followErr'), 'error') })
    } else {
      followOptimistic(artistId)
      sc.followUser(artistId).catch(() => { unfollowOptimistic(artistId); showToast(t('followErr'), 'error') })
    }
  }

  useEffect(() => {
    if (!artistPageUser) return
    setUser(artistPageUser)
    setTracks([])
    setTracksNext(null)
    setWebProfiles([])
    setLoading(true)
    // Reset the albums tab state for the new artist
    setTab('releases'); setAlbums([]); setAlbumsLoaded(false); setExpanded(null); setAlbumTracks({})

    Promise.all([
      sc.getUser(artistPageUser.id),
      sc.getUserTracks(artistPageUser.id, 20),
      sc.getUserWebProfiles(artistPageUser.id).catch(() => [] as SCWebProfile[]),
    ]).then(([u, t, wp]) => {
      setUser(u)
      setTracks(t.collection)
      setTracksNext(t.next_href)
      setWebProfiles(wp)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [artistPageUser?.id])

  // Lazy-load albums the first time the Albums tab is opened
  useEffect(() => {
    if (tab !== 'albums' || albumsLoaded || !artistPageUser) return
    setAlbumsLoading(true)
    sc.getUserAlbums(artistPageUser.id)
      .then(r => { setAlbums(r.collection); setAlbumsLoaded(true) })
      .catch(() => {})
      .finally(() => setAlbumsLoading(false))
  }, [tab, albumsLoaded, artistPageUser?.id])

  // Lazy-load playlists / likes / following / followers, cached per (user, tab)
  useEffect(() => {
    if (artistId === undefined || tab === 'releases' || tab === 'albums') return
    const key = `${artistId}:${tab}`
    const cached = tabCache.current.get(key)
    if (cached) { setTabData(cached.list); setTabNext(cached.next); setTabEmpty(cached.list.length === 0); setTabLoading(false); return }
    let cancelled = false
    setTabLoading(true); setTabEmpty(false); setTabData([]); setTabNext(null)
    const load = async (): Promise<{ list: any[]; next: string | null }> => {
      if (tab === 'playlists') { const r = await sc.getPlaylists(artistId); return { list: r.collection ?? [], next: r.next_href } }
      if (tab === 'likes') { const r = await sc.getLikes(artistId, 100); return { list: (r.collection ?? []).map((it: any) => it.track ?? it).filter(Boolean), next: r.next_href } }
      if (tab === 'following') { const r = await sc.getFollowings(artistId); return { list: r.collection ?? [], next: r.next_href } }
      const r = await sc.getFollowers(artistId); return { list: r.collection ?? [], next: r.next_href }
    }
    load()
      .then(({ list, next }) => { if (cancelled) return; tabCache.current.set(key, { list, next }); setTabData(list); setTabNext(next); setTabEmpty(list.length === 0) })
      .catch(() => { if (!cancelled) { setTabData([]); setTabNext(null); setTabEmpty(true) } })
      .finally(() => { if (!cancelled) setTabLoading(false) })
    return () => { cancelled = true }
  }, [artistId, tab])

  const toggleAlbum = (al: SCPlaylist) => {
    if (expanded === al.id) { setExpanded(null); return }
    setExpanded(al.id)
    if (!albumTracks[al.id]) {
      setAlbumTracksLoading(al.id)
      sc.getPlaylist(al.id)
        .then(full => sc.hydratePlaylistTracks(full.tracks ?? []))
        .then(trs => setAlbumTracks(prev => ({ ...prev, [al.id]: trs })))
        .catch(() => {})
        .finally(() => setAlbumTracksLoading(null))
    }
  }

  // "Show more" for the likes / following / followers / playlists tabs
  const loadMoreTab = () => {
    if (!tabNext || tabMoreLoading || artistId === undefined) return
    setTabMoreLoading(true)
    const from = tabNext
    sc.getNextPage<any>(from)
      .then(r => {
        const add = tab === 'likes'
          ? (r.collection ?? []).map((it: any) => it.track ?? it).filter(Boolean)
          : (r.collection ?? [])
        setTabData(prev => {
          const list = [...prev, ...add]
          tabCache.current.set(`${artistId}:${tab}`, { list, next: r.next_href })
          return list
        })
        setTabNext(r.next_href)
      })
      .catch(() => {})
      .finally(() => setTabMoreLoading(false))
  }

  const loadMoreTracks = () => {
    if (!tracksNext || tracksMoreLoading) return
    setTracksMoreLoading(true)
    sc.getNextPage<SCTrack>(tracksNext)
      .then(r => { setTracks(prev => [...prev, ...r.collection]); setTracksNext(r.next_href) })
      .catch(() => {})
      .finally(() => setTracksMoreLoading(false))
  }


  if (!artistPageUser) return null

  const avatar = sc.formatArtwork(user?.avatar_url ?? artistPageUser.avatar_url, 't500x500')
  const artistLink = user?.permalink_url ?? artistPageUser.permalink_url
  const banner = user?.visual_url ?? user?.visuals?.visuals?.[0]?.visual_url
  const badges = user?.badges
  const proLabel = badges?.pro_unlimited ? 'PRO UNLIMITED' : badges?.pro ? 'PRO' : null

  return (
    <div
      className={`fixed inset-0 flex items-end track-page-backdrop ${closing ? 'closing' : ''}`}
      style={{ zIndex: z }}
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div className={`w-full track-page-panel glass-island rounded-t-3xl flex flex-col overflow-hidden ${closing ? 'closing' : ''}`}
        style={{ height: '88%' }}
      >
        {/* Handle — floats over the content so it doesn't take a top strip */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-30">
          <div className="w-10 h-1 rounded-full bg-white/40" />
        </div>

        {/* Close */}
        <button
          onClick={close}
          className="icon-btn absolute top-4 right-4 z-30 w-8 h-8 rounded-full flex items-center justify-center bg-black/35 hover:bg-black/55 transition-colors duration-150"
        >
          <svg className="w-4 h-4 text-white/85" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>

        {/* Back — appears when you've drilled into someone via following/followers */}
        {artistHistory.length > 0 && (
          <button
            onClick={backArtist}
            className="icon-btn absolute top-4 left-4 z-30 w-8 h-8 rounded-full flex items-center justify-center bg-black/35 hover:bg-black/55 transition-colors duration-150"
          >
            <svg className="w-4 h-4 text-white/85" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pt-3 pb-28">
          {/* Banner — full-bleed, reaches the very top edge of the panel */}
          {banner && (
            <div className="-mx-6 -mt-3 h-36 relative overflow-hidden">
              <img src={banner} alt="" className="w-full h-full object-cover scale-in" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(10,10,14,0) 0%, rgba(10,10,14,0.35) 70%, rgba(16,16,22,0.85) 100%)' }} />
            </div>
          )}

          {/* Hero — avatar overlaps the banner's lower edge */}
          <div className="relative z-10 flex gap-5 pb-6 items-end" style={{ marginTop: banner ? -44 : 0 }}>
            {/* Avatar */}
            <div
              className="shrink-0 rounded-full overflow-hidden bg-[#14141c]"
              style={{
                width: 96, height: 96,
                boxShadow: banner
                  ? '0 0 0 4px #14141c, 0 10px 30px rgba(0,0,0,0.55)'
                  : '0 8px 40px rgba(0,0,0,0.6)',
              }}
            >
              {avatar ? (
                <img src={avatar} alt="" className="w-full h-full object-cover scale-in" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-white/15" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"/>
                  </svg>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-white leading-tight truncate">
                  {user?.username ?? artistPageUser.username}
                </h2>
                {badges?.verified && (
                  <span title="Verified" className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#ff5500' }}>
                    <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd"/></svg>
                  </span>
                )}
                {proLabel && (
                  <span className="shrink-0 text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'rgba(var(--accent-rgb),0.18)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
                    {proLabel}
                  </span>
                )}
              </div>
              {user?.full_name && user.full_name !== user.username && (
                <p className="text-sm text-white/40 mt-0.5 truncate">{user.full_name}</p>
              )}
              {user?.city && (
                <p className="text-xs text-white/30 mt-1 flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                  {user.city}
                </p>
              )}
            </div>
          </div>

          {/* Actions — follow / it's-you / pin */}
          <div className="flex items-center gap-2 mb-5">
            {isSelf ? (
              <span className="px-4 py-2 rounded-full text-sm font-medium text-white/60" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>{t('itsYou')}</span>
            ) : (
              <button
                onClick={toggleFollow}                className="icon-btn px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 active:scale-95"
                style={isFollowing
                  ? { background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.18)' }
                  : { background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 18px rgba(var(--accent-rgb),0.4)' }}
              >
                <span>{isFollowing ? `✓ ${t('unfollow')}` : t('follow')}</span>
              </button>
            )}
            {isFollowing && !isSelf && artistId !== undefined && (
              <button
                onClick={() => togglePinFriend(artistId)}                title={isPinned ? t('friendUnpin') : t('friendPin')}
                className="icon-btn w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95"
                style={isPinned
                  ? { background: 'rgba(var(--accent-rgb),0.18)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.4)' }
                  : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 4v6l-2 3h10l-2-3V4M12 16v5M8 4h8" /></svg>
              </button>
            )}
            {artistLink && (
              <>
                <button
                  onClick={() => { navigator.clipboard.writeText(artistLink).catch(() => {}); showToast(t('linkCopied'), 'success') }}                  title={t('ctxCopyLink')}
                  className="icon-btn w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95"
                  style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                </button>
                <button
                  onClick={() => window.open(artistLink)}                  title={t('ctxOpenBrowser')}
                  className="icon-btn w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95"
                  style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
                </button>
              </>
            )}
          </div>

          {/* External links */}
          {webProfiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {webProfiles.map((wp, i) => (
                <button
                  key={i}
                  onClick={() => wp.url && window.open(wp.url)}                  title={wp.url}
                  className="icon-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white/65 hover:text-white transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/>
                  </svg>
                  <span>{wp.title || wp.network || hostname(wp.url)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard
              value={fmt(user?.followers_count)}
              label={t('followers')}
              loading={loading}
              onClick={() => setTab('followers')}
            />
            <StatCard
              value={fmt(user?.followings_count)}
              label={t('following')}
              loading={loading}
              onClick={() => setTab('following')}
            />
            <StatCard
              value={fmt(user?.track_count)}
              label={t('tracksLabel')}
              loading={loading}
              onClick={() => setTab('releases')}
            />
          </div>

          {/* Description */}
          {user?.description && (
            <div className="mb-6 p-4 rounded-xl bg-white/4 border border-white/7">
              <p className="text-xs text-white/50 leading-relaxed line-clamp-4">
                {user.description}
              </p>
            </div>
          )}

          {/* You liked (this artist's tracks you liked / added to playlists) */}
          {library.tracks.length > 0 && (
            <div className="mb-6 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <button onClick={() => setShowLibrary(v => !v)}
                className="icon-btn w-full flex items-center justify-between gap-3 p-3 text-left transition-colors rounded-xl"
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.15)' }}>
                    <svg className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24" fill="currentColor"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white/90">{t('inYourLibrary')}</p>
                    <p className="text-[11px] text-white/40 mt-0.5">{library.likedCount} {t('inLikesShort')} · {library.playlistCount} {t('inPlaylistsShort')}</p>
                  </div>
                </div>
                <svg className="w-4 h-4 text-white/40 shrink-0 transition-transform duration-200" style={{ transform: showLibrary ? 'rotate(180deg)' : 'none' }}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              <div className="album-collapse" style={{ gridTemplateRows: showLibrary ? '1fr' : '0fr', transition: 'grid-template-rows 0.42s cubic-bezier(0.65, 0, 0.35, 1)' }}>
                <div style={{ overflow: 'hidden' }}>
                  <div className="px-1.5 pb-2 pt-1 flex flex-col gap-0.5" style={{ opacity: showLibrary ? 1 : 0, transition: 'opacity 0.3s ease' }}>
                    {library.tracks.map(({ track: tr, playlists: pls, liked }) => {
                      const active = currentTrack?.id === tr.id
                      const art = sc.formatArtwork(tr.artwork_url || tr.user?.avatar_url, 't200x200')
                      return (
                        <div key={tr.id} role="button"
                          onClick={() => { if (active) setPlaying(!isPlaying); else setTrack(tr, library.tracks.map(x => x.track)) }}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track: tr }) }}
                          className="group flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <div className="relative shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-white/5">
                            {art
                              ? <img src={art} alt="" className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center"><svg className="w-4 h-4 text-white/20" fill="currentColor" viewBox="0 0 20 20"><path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/></svg></div>}
                            <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              {active && isPlaying
                                ? <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                                : <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.9)' }}>{tr.title}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {liked && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent)' }}>
                                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>
                                  {t('likedShort')}
                                </span>
                              )}
                              {pls.map((title, i) => (
                                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full text-white/45 truncate max-w-[140px]" style={{ background: 'rgba(255,255,255,0.07)' }}>{title}</span>
                              ))}
                            </div>
                          </div>
                          <span className="text-xs text-white/25 shrink-0 tabular-nums">{sc.formatDuration(tr.duration)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Releases / Albums tabs */}
          <div>
            <div className="mb-4 overflow-x-auto">
              <SegmentedTabs<UserTab>
                size="sm"
                value={tab}
                onChange={setTab}
                options={[
                  ['releases', t('userTabTracks')],
                  ['albums', t('userTabAlbums')],
                  ['playlists', t('friendTabPlaylists')],
                  ['likes', t('friendTabLikes')],
                  ['following', t('friendTabFollowing')],
                  ['followers', t('friendTabFollowers')],
                ]}
              />
            </div>

            {tab === 'playlists' && (
              tabLoading ? <TabSpinner />
              : tabEmpty ? <p className="text-sm text-white/25 text-center py-8">{t('friendNothing')}</p>
              : <div className="grid gap-3 stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))' }}>
                  {(tabData as SCPlaylist[]).map(pl => <PlaylistCard key={pl.id} playlist={pl} onClick={() => { setSelectedPlaylist(pl); close() }} />)}
                </div>
            )}

            {tab === 'likes' && (
              tabLoading ? <TabSpinner />
              : tabEmpty ? <p className="text-sm text-white/25 text-center py-8">{t('likesHidden')}</p>
              : <div className="space-y-0.5">
                  {(tabData as SCTrack[]).map(tr => <TrackCard key={tr.id} track={tr} queue={tabData as SCTrack[]} />)}
                </div>
            )}

            {(tab === 'following' || tab === 'followers') && (
              tabLoading ? <TabSpinner />
              : tabEmpty ? <p className="text-sm text-white/25 text-center py-8">{t('friendNothing')}</p>
              : <div className="space-y-1">
                  {(tabData as SCUser[]).map(u => (
                    <button key={u.id} onClick={() => drillArtist(u)} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors text-left">
                      <UserAvatar u={u} />
                      <div className="min-w-0"><p className="text-sm text-white truncate">{u.full_name || u.username}</p><p className="text-[11px] text-white/40 truncate">@{u.username}</p></div>
                    </button>
                  ))}
                </div>
            )}

            {tabNext && !tabLoading && !tabEmpty && tab !== 'releases' && tab !== 'albums' && (
              <div className="flex justify-center pt-3">
                <button
                  onClick={loadMoreTab}
                  disabled={tabMoreLoading}
                  className="icon-btn px-4 py-2 rounded-full text-xs font-medium text-white/70 hover:text-white transition-all disabled:opacity-50 flex items-center gap-2"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {tabMoreLoading && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {t('showMore')}
                </button>
              </div>
            )}

            {tab === 'albums' && (
              <AlbumsTab
                albums={albums}
                loading={albumsLoading}
                expanded={expanded}
                albumTracks={albumTracks}
                albumTracksLoading={albumTracksLoading}
                onToggle={toggleAlbum}
              />
            )}

            {tab === 'releases' && loading && (
              <div className="flex flex-col gap-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex gap-3 p-2 animate-pulse">
                    <div className="w-10 h-10 rounded-lg bg-white/10 shrink-0" />
                    <div className="flex-1 flex flex-col justify-center gap-1.5">
                      <div className="h-2.5 bg-white/10 rounded w-3/4" />
                      <div className="h-2 bg-white/7 rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'releases' && !loading && tracks.length === 0 && (
              <p className="text-sm text-white/25 text-center py-8">{t('noPublicTracks')}</p>
            )}

            {tab === 'releases' && !loading && tracks.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {tracks.map((t, i) => {
                  const art = sc.formatArtwork(t.artwork_url || t.user?.avatar_url, 't200x200')
                  const active = currentTrack?.id === t.id
                  const playing = active && isPlaying

                  return (
                    <div
                      key={t.id}
                      role="button"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('[data-action]')) return
                        if (active) setPlaying(!isPlaying)
                        else setTrack(t, tracks)
                      }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track: t }) }}
                      className="group w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer"
                      style={{
                        background: active ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                        border: active ? '1px solid rgba(var(--accent-rgb),0.2)' : '1px solid transparent',
                        animationDelay: `${Math.min(i * 25, 300)}ms`,
                      }}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
                      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      {/* Artwork */}
                      <div className="relative shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-white/5">
                        {art ? (
                          <img src={art} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white/20" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
                            </svg>
                          </div>
                        )}
                        <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {playing ? (
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          )}
                        </div>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate"
                          style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.9)' }}>
                          {t.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-white/30">{timeAgo(t.created_at)}</span>
                          {t.genre && (
                            <span className="text-[11px] text-white/20 truncate">{t.genre}</span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <TrackActions track={t} />

                      {/* Duration / eq-bars */}
                      {active ? (
                        <div className="flex items-end gap-[2px] h-4 w-4 shrink-0">
                          {[0.55, 0.9, 0.7].map((spd, j) => (
                            <div
                              key={j}
                              className="w-[3px] rounded-full origin-bottom"
                              style={{
                                background: playing ? 'var(--accent)' : 'rgba(255,255,255,0.25)',
                                height: playing ? '100%' : '25%',
                                animation: playing ? `eq-bar ${spd}s ease-in-out ${j * 0.15}s infinite alternate` : 'none',
                                transition: 'height 0.4s cubic-bezier(0.16,1,0.3,1)',
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-white/25 shrink-0 tabular-nums">
                          {sc.formatDuration(t.duration)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'releases' && tracksNext && !loading && (
              <div className="flex justify-center pt-3">
                <button
                  onClick={loadMoreTracks}
                  disabled={tracksMoreLoading}
                  className="icon-btn px-4 py-2 rounded-full text-xs font-medium text-white/70 hover:text-white transition-all disabled:opacity-50 flex items-center gap-2"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {tracksMoreLoading && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {t('showMore')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AlbumsTab({ albums, loading, expanded, albumTracks, albumTracksLoading, onToggle }: {
  albums: SCPlaylist[]
  loading: boolean
  expanded: number | null
  albumTracks: Record<number, SCTrack[]>
  albumTracksLoading: number | null
  onToggle: (al: SCPlaylist) => void
}) {
  const t = useT()
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3 p-2.5 animate-pulse rounded-xl bg-white/4">
            <div className="w-14 h-14 rounded-lg bg-white/10 shrink-0" />
            <div className="flex-1 flex flex-col justify-center gap-2">
              <div className="h-2.5 bg-white/10 rounded w-2/3" />
              <div className="h-2 bg-white/7 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (albums.length === 0) {
    return <p className="text-sm text-white/25 text-center py-8">{t('noAlbums')}</p>
  }
  return (
    <div className="flex flex-col">
      {albums.map(al => (
        <AlbumRow
          key={al.id}
          album={al}
          expanded={expanded === al.id}
          tracks={albumTracks[al.id]}
          loading={albumTracksLoading === al.id}
          onToggle={() => onToggle(al)}
        />
      ))}
    </div>
  )
}

function AlbumRow({ album, expanded, tracks, loading, onToggle }: {
  album: SCPlaylist
  expanded: boolean
  tracks: SCTrack[] | undefined
  loading: boolean
  onToggle: () => void
}) {
  const t = useT()
  const { setTrack, currentTrack, isPlaying, setPlaying } = usePlayer()
  const art = sc.formatArtwork(album.artwork_url ?? album.tracks?.[0]?.artwork_url ?? null, 't200x200')
  const year = (album.release_date ?? album.published_at)?.slice(0, 4)
  const typeLabel = album.set_type === 'ep' ? 'EP' : t('albumWord')

  return (
    <div className="rounded-xl overflow-hidden mb-2"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      {/* Header — stays in place while the tracklist expands below */}
      <button onClick={onToggle} className="icon-btn w-full flex items-center gap-3 p-2.5 text-left rounded-xl">
        <div className="w-14 h-14 rounded-lg overflow-hidden bg-white/5 shrink-0">
          {art
            ? <img src={art} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center">
                <svg className="w-5 h-5 text-white/20" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/></svg>
              </div>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white/90 truncate">{album.title}</p>
          <p className="text-[11px] text-white/35 mt-0.5">
            {typeLabel} · {album.track_count} {t('tracksWord')}{year ? ` · ${year}` : ''}
          </p>
        </div>
        <svg
          className="w-4 h-4 text-white/40 shrink-0 transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Tracklist — grid-rows wrapper animates both open and close */}
      <div className="album-collapse" style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}>
        <div style={{ overflow: 'hidden' }}>
          {(expanded || tracks) && (
            <div className="px-2.5 pb-2.5">
              {loading || !tracks ? (
                <div className="flex items-center gap-2 py-3 pl-2 text-white/30">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs">{t('loading')}</span>
                </div>
              ) : (
                <div className="flex flex-col">
                  {tracks.map((tr, i) => {
                    const active = currentTrack?.id === tr.id
                    return (
                      <div
                        key={tr.id}
                        role="button"
                        onClick={() => { if (active) setPlaying(!isPlaying); else setTrack(tr, tracks) }}
                        className="flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer transition-colors"
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span className="w-5 text-right text-xs text-white/30 tabular-nums shrink-0">{i + 1}</span>
                        <span className="flex-1 min-w-0 text-sm truncate"
                          style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.85)' }}>
                          {tr.title}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-white/30 tabular-nums shrink-0">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                          {fmt(tr.playback_count)}
                        </span>
                        <span className="text-xs text-white/25 tabular-nums w-10 text-right shrink-0">
                          {sc.formatDuration(tr.duration)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


function TabSpinner() {
  return <div className="flex items-center justify-center py-10"><span className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" /></div>
}

function UserAvatar({ u }: { u: SCUser }) {
  const url = sc.formatArtwork(u.avatar_url, 't200x200')
  const initials = (u.full_name || u.username || '?').trim().slice(0, 2).toUpperCase()
  return url
    ? <img src={url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
    : <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/60 shrink-0">{initials}</div>
}

function StatCard({ value, label, loading, onClick }: { value: string; label: string; loading: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="icon-btn flex flex-col items-center py-3 rounded-xl transition-all disabled:cursor-default"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <span className={`text-lg font-bold text-white transition-opacity duration-300 ${loading ? 'opacity-30' : 'opacity-100'}`}>
        {loading ? '···' : value}
      </span>
      <span className="text-[10px] text-white/30 uppercase tracking-wide mt-0.5">{label}</span>
    </button>
  )
}
