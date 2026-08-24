import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import { useProfile, useUI, useLyrics, useToast, useSettings, usePlayer } from '../store'
import { sc, SCTrack, SCPlaylist } from '../services/soundcloud'
import { playlistCache, hydratingSet } from '../services/playlistCache'
import { checkTracksLyrics } from '../services/lyrics'
import { TrackCard } from './TrackCard'
import { CreatePlaylistModal } from './CreatePlaylistModal'
import { ImportPlaylistModal } from './ImportPlaylistModal'
import { ConfirmDialog } from './ConfirmDialog'
import { MainPage } from './MainPage'
import { SearchResults } from './SearchResults'
import { encodePlaylist } from '../services/playlistShare'
import { SegmentedTabs } from './SegmentedTabs'
import { useT, timeAgo } from '../i18n'

// Remembers each tab's scroll position so switching tabs (and coming back) doesn't
// jump to the top. Module-level so it survives the per-page remount of the list DOM.
const scrollMemory = new Map<string, number>()

export function TrackList() {
  const { likes, stream, playlists, likedPlaylists, setLikedPlaylists, releases, setReleases, setPlaylists, user, localPlaylists, removeLocalPlaylist } = useProfile()
  const { page, selectedPlaylist, searchQuery, setSearch, setSelectedPlaylist, backFromPlaylist, trackOrder, setTrackOrder, setArtistPage, setPlaylistMenu } = useUI()
  const shuffle = usePlayer(s => s.shuffle)
  const currentTrackId = usePlayer(s => s.currentTrack?.id)
  const isPlaying = usePlayer(s => s.isPlaying)
  const { show: showToast } = useToast()
  const [loadingReleases, setLoadingReleases] = useState(false)
  const [listKey, setListKey] = useState(0)
  const [hydratedTracks, setHydratedTracks] = useState<SCTrack[]>([])
  const [hydrating, setHydrating] = useState(false)
  const [playlistFilter, setPlaylistFilter] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchClosing, setSearchClosing] = useState(false)
  const [lyricsOnly, setLyricsOnly] = useState(false)
  const [drmOnly, setDrmOnly] = useState(false)
  const [artistFilter, setArtistFilter] = useState('')
  const lyricsMap = useLyrics(s => s.available)
  const perfBigLists = useSettings(s => s.perfBigLists)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const t = useT()
  const markLyrics = useLyrics(s => s.mark)

  // Per-tab scroll memory: save on scroll, restore on return. Keyed by view
  // (open playlist keyed by its id). Restore waits for the virtualized list to
  // grow tall enough before setting scrollTop, else the browser clamps it.
  const scrollKey = page === 'playlist-detail' ? `pl:${selectedPlaylist?.id ?? ''}` : page
  const saveScroll = (e: React.UIEvent<HTMLDivElement>) => { scrollMemory.set(scrollKey, e.currentTarget.scrollTop) }
  useLayoutEffect(() => {
    const getEl = () => (page === 'playlists' ? gridScrollRef.current : listScrollRef.current)
    const el = getEl()
    if (!el) return
    const target = scrollMemory.get(scrollKey) ?? 0
    if (target <= 0) return
    // Try to restore synchronously, before the first paint. If the content is
    // already tall enough (non-virtual grid, or a fast return) it sticks and there
    // is no flash at all.
    el.scrollTop = target
    if (el.scrollTop >= target - 1) return
    // Virtualized list isn't tall yet (row height still being measured). Hide it so
    // the top doesn't flash, poll until it grows, then restore and reveal.
    el.style.visibility = 'hidden'
    let raf = 0, tries = 0
    const restore = () => {
      const e = getEl()
      if (!e) return
      if (e.scrollHeight - e.clientHeight >= target || tries > 30) {
        e.scrollTop = target
        e.style.visibility = ''
        return
      }
      tries++
      raf = requestAnimationFrame(restore)
    }
    raf = requestAnimationFrame(restore)
    return () => { cancelAnimationFrame(raf); const e = getEl(); if (e) e.style.visibility = '' }
  }, [scrollKey])

  // Animate the playlist search field closed before unmounting it
  const closeSearch = () => {
    setSearchClosing(true)
    setTimeout(() => { setFilterOpen(false); setPlaylistFilter(''); setSearchClosing(false) }, 170)
  }
  const [scanning, setScanning] = useState(false)
  const scanCancelRef = useRef(false)
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false)
  const [showImportPlaylist, setShowImportPlaylist] = useState(false)
  const [showDeletePlaylist, setShowDeletePlaylist] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const handleDeletePlaylist = async () => {
    if (!selectedPlaylist || deleteBusy) return
    // Local playlists (synthetic negative id) are removed locally, no API call.
    if (selectedPlaylist.id < 0) {
      removeLocalPlaylist(selectedPlaylist.id)
      playlistCache.delete(selectedPlaylist.id)
      showToast(t('playlistDeleted'), 'success')
      setShowDeletePlaylist(false)
      backFromPlaylist()
      return
    }
    setDeleteBusy(true)
    try {
      await sc.deletePlaylist(selectedPlaylist.id)
      playlistCache.delete(selectedPlaylist.id)
      showToast(t('playlistDeleted'), 'success')
      setShowDeletePlaylist(false)
      backFromPlaylist()
      if (user) {
        try { const res = await sc.getPlaylists(user.id); setPlaylists(res.collection) }
        catch { /* list refreshes on next sync */ }
      }
    } catch (e) {
      console.error('[DeletePlaylist] failed:', e)
      showToast(t('deletePlaylistErr'), 'error')
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleSharePlaylist = async () => {
    if (!selectedPlaylist) return
    const ids = tracks.map(tr => tr.id).filter(Boolean)
    if (!ids.length) return
    const code = encodePlaylist(selectedPlaylist.title, ids)
    try { await navigator.clipboard.writeText(code); showToast(t('codeCopied'), 'success') }
    catch { showToast(t('deletePlaylistErr'), 'error') }
  }

  // Hydrate a single playlist and store in cache
  const hydratePlaylist = (playlist: SCPlaylist) => {
    const id = playlist.id
    if (playlistCache.has(id) || hydratingSet.has(id)) return
    const stubs = playlist.tracks ?? []
    // The user-playlists listing can carry a truncated `tracks` array (shorter than
    // track_count) — refetch the authoritative full list so newest tracks aren't lost.
    const needFull = id > 0 && stubs.length < (playlist.track_count ?? stubs.length)
    const needsHydration = needFull || stubs.some(t => !t.title || !t.duration)
    if (!needsHydration) { playlistCache.set(id, stubs); return }
    hydratingSet.add(id)
    const load = needFull
      ? sc.getPlaylist(id).then(full => full.tracks ?? [])
      : Promise.resolve(stubs)
    load
      .then(list => sc.hydratePlaylistTracks(list))
      .then(tracks => { playlistCache.set(id, tracks); hydratingSet.delete(id) })
      .catch(() => hydratingSet.delete(id))
  }

  // Eagerly preload all playlists in the background when playlists list changes
  useEffect(() => {
    playlists.forEach(pl => hydratePlaylist(pl))
  }, [playlists])

  // Load releases feed when the tab opens (cached after first load)
  useEffect(() => {
    if (page !== 'releases' || !user || releases.length > 0 || loadingReleases) return
    setLoadingReleases(true)
    sc.getReleases(user.id)
      .then(tracks => setReleases(tracks))
      .catch(() => {})
      .finally(() => setLoadingReleases(false))
  }, [page, user?.id])

  // Search results (tabs: all/tracks/artists/albums/playlists) live in <SearchResults/>.

  // Reset filters when playlist changes
  useEffect(() => { setPlaylistFilter(''); setFilterOpen(false); setLyricsOnly(false); setDrmOnly(false); setArtistFilter('') }, [selectedPlaylist?.id, page])


  // Show playlist tracks
  useEffect(() => {
    if (page !== 'playlist-detail' || !selectedPlaylist) { setHydratedTracks([]); return }
    const id = selectedPlaylist.id
    const expected = selectedPlaylist.track_count ?? 0

    // Use cache only if it's complete — a truncated listing must be refetched.
    const cached = playlistCache.get(id)
    if (cached && (id < 0 || cached.length >= expected)) { setHydratedTracks(cached); return }

    const stubs = selectedPlaylist.tracks ?? []
    const needFull = id > 0 && stubs.length < expected
    const needsHydration = needFull || stubs.some(t => !t.title || !t.duration)
    if (!needsHydration) { playlistCache.set(id, stubs); setHydratedTracks(stubs); return }

    setHydrating(true)
    hydratingSet.add(id)
    const load = needFull
      ? sc.getPlaylist(id).then(full => full.tracks ?? [])
      : Promise.resolve(stubs)
    load
      .then(list => sc.hydratePlaylistTracks(list))
      .then(tracks => {
        playlistCache.set(id, tracks)
        hydratingSet.delete(id)
        setHydratedTracks(tracks)
      })
      .catch(console.error)
      .finally(() => setHydrating(false))
  }, [selectedPlaylist?.id, page])

  // Animate on section change
  useEffect(() => { setListKey(k => k + 1) }, [page, trackOrder])

  let rawTracks: SCTrack[] = []
  let title = ''
  const canSort = page === 'likes' || page === 'playlist-detail'
  const canFilter = page === 'likes' || page === 'playlist-detail'

  switch (page) {
    case 'stream':          rawTracks = stream;                                                   title = t('streamTitle'); break
    case 'releases':        rawTracks = releases;                                                 title = t('releasesTitle'); break
    case 'likes':           rawTracks = likes;                                                    title = t('likesTitle'); break
    case 'search':          rawTracks = [];                                                       title = ''; break
    case 'playlist-detail': rawTracks = hydratedTracks; title = selectedPlaylist?.title ?? ''; break
  }

  const tracks = useMemo(() => {
    // Likes arrive newest-first from SC; playlist tracks arrive in playlist order
    // (newly added ones at the end = oldest-first), so the reverse rule is opposite.
    const reversed = canSort && (
      (page === 'playlist-detail' && trackOrder === 'newest') ||
      (page !== 'playlist-detail' && trackOrder === 'oldest')
    )
    let list = reversed ? [...rawTracks].reverse() : rawTracks
    if (canFilter && playlistFilter.trim()) {
      const q = playlistFilter.toLowerCase()
      list = list.filter(tr =>
        tr.title?.toLowerCase().includes(q) ||
        tr.user?.username?.toLowerCase().includes(q)
      )
    }
    if (canFilter) {
      if (artistFilter.trim()) {
        const aq = artistFilter.toLowerCase()
        list = list.filter(tr => tr.user?.username?.toLowerCase().includes(aq))
      }
      if (lyricsOnly) list = list.filter(tr => lyricsMap[tr.id] === true)
      if (drmOnly) list = list.filter(tr => sc.isDrm(tr))
    }
    return list
  }, [rawTracks, trackOrder, canSort, playlistFilter, page, artistFilter, lyricsOnly, drmOnly, lyricsMap])

  const hasActiveFilter = !!(playlistFilter || artistFilter || lyricsOnly || drmOnly)

  // A foreign playlist (not local, not authored by me) can be liked/unliked here.
  const plForeign = !!selectedPlaylist && selectedPlaylist.id >= 0 && !(user && selectedPlaylist.user?.id === user.id)
  const plLiked = !!selectedPlaylist && likedPlaylists.some(p => p.id === selectedPlaylist.id)
  const toggleLikePlaylist = () => {
    if (!selectedPlaylist) return
    const target = selectedPlaylist
    const prev = likedPlaylists
    if (plLiked) {
      setLikedPlaylists(prev.filter(p => p.id !== target.id))
      showToast(t('playlistUnliked'), 'info')
      sc.unlikePlaylist(target.id).catch(() => { setLikedPlaylists(prev); showToast(t('errUnlike'), 'error') })
    } else {
      setLikedPlaylists([target, ...prev])
      showToast(t('playlistLiked'), 'success')
      sc.likePlaylist(target.id).catch(() => { setLikedPlaylists(prev); showToast(t('errLike'), 'error') })
    }
  }

  const handleScanLyrics = async () => {
    if (scanning) { scanCancelRef.current = true; setScanning(false); return }
    setScanning(true)
    scanCancelRef.current = false
    // Each track costs several lrclib requests, so a few thousand tracks would
    // mean tens of thousands of calls. With "big lists" on, scan a slice.
    const SCAN_CAP = 300
    const list = perfBigLists && tracks.length > SCAN_CAP ? tracks.slice(0, SCAN_CAP) : tracks
    if (list.length < tracks.length) showToast(`${t('scanLyrics')}: ${list.length} / ${tracks.length}`, 'info')
    await checkTracksLyrics(list, markLyrics, () => scanCancelRef.current)
    setScanning(false)
  }
  useEffect(() => () => { scanCancelRef.current = true }, [])

  // ── Home dashboard ──
  if (page === 'main') return <MainPage />

  // ── Playlists grid ──
  if (page === 'playlists') {
    return (
      <div key="playlists" className="flex-1 flex flex-col overflow-hidden page-enter">
        <div className="px-5 pt-5 pb-3 shrink-0 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">{t('playlists')}</h1>
            <p className="text-xs text-white/35 mt-0.5">{localPlaylists.length + playlists.length + likedPlaylists.length}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowImportPlaylist(true)}
              title={t('importPlaylist')}
              className="icon-btn flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-medium transition-all"
              style={{ color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
              </svg>
              {t('import')}
            </button>
            <button
              onClick={() => setShowCreatePlaylist(true)}
              title={t('newPlaylist')}
              className="icon-btn flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-medium transition-all"
              style={{ color: '#fff', background: 'var(--accent)' }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('newPlaylist')}
            </button>
          </div>
        </div>
        {showCreatePlaylist && (
          <CreatePlaylistModal
            onClose={() => setShowCreatePlaylist(false)}
            onCreated={pl => setSelectedPlaylist(pl)}
          />
        )}
        {showImportPlaylist && (
          <ImportPlaylistModal
            onClose={() => setShowImportPlaylist(false)}
            onImported={pl => setSelectedPlaylist(pl)}
          />
        )}
        <div ref={gridScrollRef} onScroll={saveScroll} className="flex-1 overflow-y-auto px-4 pb-4">
          {localPlaylists.length + playlists.length + likedPlaylists.length === 0 ? (
            <Empty text={t('noPlaylistsYet')} />
          ) : (
            <div className="grid gap-3 stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))' }}>
              {[...localPlaylists, ...playlists].map(pl => <PlaylistCard key={pl.id} playlist={pl} onClick={() => setSelectedPlaylist(pl)} />)}
              {likedPlaylists.map(pl => <PlaylistCard key={`liked-${pl.id}`} playlist={pl} liked onClick={() => setSelectedPlaylist(pl)} />)}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div key={page} className="flex-1 flex flex-col overflow-hidden page-enter">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center gap-3 shrink-0">
        {page === 'playlist-detail' && (
          <button onClick={backFromPlaylist}
            className="icon-btn p-1.5 rounded-lg transition-all hover:bg-white/8"
            style={{ color: 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.9)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
        )}

        <div className="flex-1 min-w-0">
          {page === 'search' ? (
            <div className="relative">
              <input autoFocus type="text"
                placeholder={t('searchPlaceholder')}
                value={searchQuery}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-xl pl-4 pr-10 py-2.5 text-sm text-white focus:outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.5)'; e.currentTarget.style.background = 'rgba(255,255,255,0.09)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearch('')}
                  title={t('clearSearch')}
                  aria-label={t('clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white/90 hover:bg-white/10 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>
          ) : filterOpen && canFilter ? (
            <input
              ref={filterInputRef}
              autoFocus
              type="text"
              placeholder={`${page === 'likes' ? t('searchInLikes') : t('searchInPlaylist')}...`}
              value={playlistFilter}
              onChange={e => setPlaylistFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') closeSearch() }}
              className={`w-full rounded-xl px-4 py-2 text-sm text-white focus:outline-none transition-all ${searchClosing ? 'search-out' : 'search-in'}`}
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}
            />
          ) : page === 'playlist-detail' ? null : (
            <>
              <h1 className="text-xl font-bold text-white truncate">{title}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {(canFilter && playlistFilter)
                  ? <p className="text-xs" style={{ color: 'var(--accent)' }}>{tracks.length} {t('ofCount')} {rawTracks.length}</p>
                  : tracks.length > 0 && <p className="text-xs text-white/35">{tracks.length} {t('tracksWord')}</p>
                }
                {hydrating && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 border border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-white/35">{t('loading')}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Search / filter button */}
        {canFilter && !filterOpen && (
          <button
            onClick={() => { setFilterOpen(true); setTimeout(() => filterInputRef.current?.focus(), 0) }}
            className="icon-btn p-1.5 rounded-lg transition-all shrink-0"
            style={{ color: hasActiveFilter ? 'var(--accent)' : 'rgba(255,255,255,0.35)' }}
            onMouseEnter={e => { if (!hasActiveFilter) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)' }}
            onMouseLeave={e => { if (!hasActiveFilter) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)' }}
            title={page === 'likes' ? t('searchInLikes') : t('searchInPlaylist')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </button>
        )}
        {canFilter && filterOpen && (
          <button
            onClick={closeSearch}
            className="icon-btn p-1.5 rounded-lg transition-all shrink-0"
            style={{ color: 'rgba(255,255,255,0.35)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)'}
            title={t('closeSearch')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        )}

        {/* Like/unlike (foreign playlists only) */}
        {page === 'playlist-detail' && !filterOpen && plForeign && (
          <button
            onClick={toggleLikePlaylist}
            title={plLiked ? t('unlikePlaylistAction') : t('likePlaylistAction')}
            className="icon-btn flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all"
            style={{ color: plLiked ? 'var(--accent)' : 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={e => { if (!plLiked) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = plLiked ? 'var(--accent)' : 'rgba(255,255,255,0.4)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={plLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/>
            </svg>
          </button>
        )}

        {/* Share playlist (copy code) */}
        {page === 'playlist-detail' && !filterOpen && tracks.length > 0 && (
          <button
            onClick={handleSharePlaylist}
            title={t('sharePlaylist')}
            className="icon-btn flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>
            </svg>
          </button>
        )}

        {/* Delete playlist (own playlists only) */}
        {page === 'playlist-detail' && !filterOpen && !plForeign && (
          <button
            onClick={() => setShowDeletePlaylist(true)}
            title={t('deletePlaylist')}
            className="icon-btn flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        )}

        {/* Scan lyrics */}
        {tracks.length > 0 && !filterOpen && page !== 'search' && (
          <button
            onClick={handleScanLyrics}
            title={t('scanLyrics')}
            className="icon-btn flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all"
            style={{ color: scanning ? 'var(--accent)' : 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={e => { if (!scanning) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)' }}
            onMouseLeave={e => { if (!scanning) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
          >
            {scanning ? (
              <div className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-[14px] font-extrabold leading-none">L</span>
            )}
          </button>
        )}

        {/* Sort toggle */}
        {canSort && tracks.length > 0 && !filterOpen && (
          <div className="shrink-0">
            <SegmentedTabs
              size="sm"
              value={trackOrder}
              onChange={setTrackOrder}
              options={[['newest', t('newest')], ['oldest', t('oldest')]]}
            />
          </div>
        )}
      </div>

      {/* Filter bar */}
      {canFilter && filterOpen && (
        <div className={`px-5 pb-2 flex items-center gap-2 shrink-0 flex-wrap ${searchClosing ? 'search-out' : 'search-in'}`}>
          <button
            onClick={() => setLyricsOnly(v => !v)}
            className="icon-btn flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
            style={{
              background: lyricsOnly ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.06)',
              color: lyricsOnly ? 'var(--accent)' : 'rgba(255,255,255,0.55)',
              border: lyricsOnly ? '1px solid rgba(var(--accent-rgb),0.4)' : '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span className="inline-flex items-center justify-center text-[8px] font-bold rounded"
              style={{ width: 13, height: 13, background: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)' }}>L</span>
            {t('withLyrics')}
          </button>

          <button
            onClick={() => setDrmOnly(v => !v)}
            title={t('drmOnlyHint')}
            className="icon-btn flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
            style={{
              background: drmOnly ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.06)',
              color: drmOnly ? 'var(--accent)' : 'rgba(255,255,255,0.55)',
              border: drmOnly ? '1px solid rgba(var(--accent-rgb),0.4)' : '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            {t('drmOnly')}
          </button>

          <input
            type="text"
            placeholder={t('filterArtist')}
            value={artistFilter}
            onChange={e => setArtistFilter(e.target.value)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium focus:outline-none transition-all w-40"
            style={{
              background: artistFilter ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.06)',
              color: artistFilter ? 'var(--accent)' : 'rgba(255,255,255,0.8)',
              border: artistFilter ? '1px solid rgba(var(--accent-rgb),0.4)' : '1px solid rgba(255,255,255,0.08)',
            }}
          />
        </div>
      )}

      {showDeletePlaylist && (
        <ConfirmDialog
          message={t('deletePlaylistConfirm')}
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
          danger
          busy={deleteBusy}
          requireText={selectedPlaylist?.title}
          requireTextLabel={t('typeNameToConfirm')}
          onConfirm={handleDeletePlaylist}
          onCancel={() => setShowDeletePlaylist(false)}
        />
      )}

      {/* List */}
      <div ref={listScrollRef} onScroll={saveScroll} className="flex-1 overflow-y-auto px-3 pb-3">
        {page === 'playlist-detail' && selectedPlaylist && (() => {
          const cover = sc.formatArtwork(selectedPlaylist.artwork_url ?? selectedPlaylist.tracks?.[0]?.artwork_url ?? '', 't500x500')
          const durMs = selectedPlaylist.duration || rawTracks.reduce((s, tr) => s + (tr.duration || 0), 0)
          const mins = Math.round(durMs / 60000)
          const dh = Math.floor(mins / 60), dm = mins % 60
          const durStr = dh ? `${dh}${t('hShort')} ${dm}${t('mShort')}` : `${dm}${t('mShort')}`
          const count = tracks.length || selectedPlaylist.track_count || 0
          const likes = selectedPlaylist.likes_count
          const typeMap: Record<string, string> = { album: t('typeAlbum'), ep: t('typeEP'), compilation: t('typeCompilation'), playlist: t('typePlaylist') }
          const typeLabel = typeMap[selectedPlaylist.set_type ?? 'playlist'] ?? t('typePlaylist')
          const dateStr = selectedPlaylist.created_at ?? selectedPlaylist.published_at ?? selectedPlaylist.release_date
          const isPrivate = selectedPlaylist.sharing === 'private'
          const genre = selectedPlaylist.genre?.trim()
          const desc = selectedPlaylist.description?.trim()
          // With shuffle on, start from a random track (not the first) so the mix
          // begins immediately; nextTrack then keeps picking randomly.
          const playAll = () => {
            if (!tracks.length) return
            const start = usePlayer.getState().shuffle ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[0]
            usePlayer.getState().setTrack(start, tracks)
          }
          const openMenu = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setPlaylistMenu({ x: e.clientX, y: e.clientY, playlist: selectedPlaylist }) }
          // This playlist is "active" when the currently loaded track belongs to it.
          // Then the button is a play/pause toggle (resume in place); otherwise it starts the playlist.
          const activeHere = currentTrackId != null && tracks.some(tr => tr.id === currentTrackId)
          const playingHere = activeHere && isPlaying
          const onPlayClick = () => { if (activeHere) usePlayer.getState().setPlaying(!isPlaying); else playAll() }
          return (
            <div className="flex items-stretch gap-7 px-3 pt-3 pb-7 mb-2">
              {cover
                ? <img src={cover} alt="" onContextMenu={openMenu} className="w-52 h-52 rounded-2xl object-cover shrink-0 cursor-pointer" style={{ boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }} />
                : <div onContextMenu={openMenu} className="w-52 h-52 rounded-2xl shrink-0 bg-white/5 flex items-center justify-center cursor-pointer"><svg className="w-16 h-16 text-white/20" fill="currentColor" viewBox="0 0 20 20"><path d="M18 3a1 1 0 00-1.196-.98l-8 1.6A1 1 0 008 4.6v7.28A3 3 0 1010 14V7.82l6-1.2v3.06A3 3 0 1018 12V3z"/></svg></div>}
              <div className="min-w-0 flex-1 flex flex-col py-3">
                <h1 onContextMenu={openMenu} className="text-3xl font-bold text-white leading-tight line-clamp-2 cursor-pointer">{title}</h1>
                <div className="flex items-center gap-2 mt-1.5 min-w-0">
                  {selectedPlaylist.user?.username && <button onClick={() => selectedPlaylist.user && setArtistPage(selectedPlaylist.user)} className="text-sm text-white/55 hover:text-white truncate transition-colors">{selectedPlaylist.user.username}</button>}
                  {isPrivate && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>{t('playlistPrivate')}</span>}
                </div>
                {desc && <p className="text-xs text-white/40 mt-2 line-clamp-2 leading-relaxed">{desc}</p>}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-auto pt-3 text-xs text-white/45">
                  <span className="text-white/60">{typeLabel}</span>
                  <span className="text-white/20">·</span>
                  <span>{count} {t('tracksWord')}</span>
                  {durMs > 0 && <><span className="text-white/20">·</span><span>{durStr}</span></>}
                  {likes != null && likes > 0 && (<><span className="text-white/20">·</span><span className="inline-flex items-center gap-1"><svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z"/></svg>{likes.toLocaleString()}</span></>)}
                  {dateStr && <><span className="text-white/20">·</span><span>{timeAgo(dateStr)}</span></>}
                  {genre && <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(var(--accent-rgb),0.14)', color: 'var(--accent)' }}>#{genre}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 self-end shrink-0">
                <button onClick={() => usePlayer.getState().toggleShuffle()} title={t('shuffle')}
                  className="icon-btn relative p-2 rounded-lg transition-all active:scale-90"
                  style={{ color: shuffle ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}>
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
                  {shuffle && <span className="absolute left-1/2 -translate-x-1/2 rounded-full" style={{ bottom: 1, width: 3, height: 3, background: 'var(--accent)' }} />}
                </button>
                <button onClick={onPlayClick} disabled={!tracks.length} title={playingHere ? t('pause') : t('play')}
                  className="icon-btn w-[52px] h-[52px] rounded-full flex items-center justify-center shrink-0 transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
                  style={{ background: 'var(--accent)', boxShadow: '0 6px 22px rgba(var(--accent-rgb),0.5)' }}>
                  {playingHere
                    ? <svg className="w-6 h-6" viewBox="0 0 24 24" fill="#fff"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
                    : <svg className="w-6 h-6 ml-0.5" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>}
                </button>
              </div>
            </div>
          )
        })()}
        {page === 'search' ? (
          <SearchResults />
        ) : (page === 'releases' && loadingReleases && releases.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-white/30">{t('loadingReleases')}</p>
          </div>
        ) : tracks.length === 0 ? (
          <Empty text={t('nothingHere')} />
        ) : (
          perfBigLists && tracks.length > 80 ? (
            <VirtualTrackRows
              key={listKey}
              scrollRef={listScrollRef}
              tracks={tracks}
              showDate={page === 'releases'}
              className={page === 'releases' ? 'space-y-2' : 'space-y-0.5'}
            />
          ) : (
            <div key={listKey} className={`stagger ${page === 'releases' ? 'space-y-2' : 'space-y-0.5'}`}>
              {tracks.map(track => <TrackCard key={track.id} track={track} queue={tracks} showDate={page === 'releases'} />)}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// Windowed track list: only the rows near the viewport are mounted. Row height is
// measured from a first "probe" render (so gaps and per-page layout differences
// are accounted for) rather than hardcoded.
function VirtualTrackRows({ scrollRef, tracks, showDate, className }: {
  scrollRef: React.RefObject<HTMLDivElement>
  tracks: SCTrack[]
  showDate: boolean
  className: string
}) {
  const OVERSCAN = 8
  const PROBE = 20
  const probeRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [rowH, setRowH] = useState(0)
  const [range, setRange] = useState({ start: 0, end: PROBE })

  // Measure once: average height over the probe rows includes the flex gap
  useLayoutEffect(() => {
    if (rowH) return
    const el = probeRef.current
    if (!el) return
    const n = Math.min(PROBE, tracks.length)
    const h = el.getBoundingClientRect().height / Math.max(1, n)
    if (h > 1) setRowH(h)
  }, [rowH, tracks.length])

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || !rowH) return
    const update = () => {
      // Rows can start below a header (e.g. the playlist hero) inside the same
      // scroller, so measure this list's offset within the scroll content and read
      // the scroll position relative to it — otherwise rows shift by the header height.
      const root = rootRef.current
      const listTop = root ? root.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop : 0
      const rel = Math.max(0, sc.scrollTop - listTop)
      const start = Math.max(0, Math.floor(rel / rowH) - OVERSCAN)
      const end = Math.min(tracks.length, Math.ceil((rel + sc.clientHeight) / rowH) + OVERSCAN)
      setRange(r => (r.start === start && r.end === end ? r : { start, end }))
    }
    update()
    sc.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { sc.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [scrollRef, rowH, tracks.length])

  if (!rowH) {
    return (
      <div ref={probeRef} className={className}>
        {tracks.slice(0, PROBE).map(track => <TrackCard key={track.id} track={track} queue={tracks} showDate={showDate} />)}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ paddingTop: range.start * rowH, paddingBottom: Math.max(0, (tracks.length - range.end) * rowH) }}
    >
      {tracks.slice(range.start, range.end).map(track => (
        <TrackCard key={track.id} track={track} queue={tracks} showDate={showDate} />
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 fade-in">
      <div className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.05)' }}>
        <svg className="w-5 h-5 text-white/20" fill="currentColor" viewBox="0 0 20 20">
          <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
        </svg>
      </div>
      <p className="text-sm text-white/25">{text}</p>
    </div>
  )
}

export function PlaylistCard({ playlist, onClick, liked }: { playlist: SCPlaylist; onClick: () => void; liked?: boolean }) {
  const tt = useT()
  const setPlaylistMenu = useUI(s => s.setPlaylistMenu)
  const art = (playlist.artwork_url ?? playlist.tracks?.[0]?.artwork_url)?.replace('-large', '-t200x200')
  return (
    <button onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPlaylistMenu({ x: e.clientX, y: e.clientY, playlist }) }}
      className="text-left group transition-all duration-200 hover:-translate-y-0.5"
    >
      <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {art ? (
          <img src={art} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-9 h-9 text-white/15" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/>
            </svg>
          </div>
        )}
        {playlist.id < 0 && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide"
            style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)' }}>
            {tt('localBadge')}
          </span>
        )}
        {liked && (
          <span className="absolute top-1.5 left-1.5 w-6 h-6 flex items-center justify-center rounded-full"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} title={tt('likedBadge')}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2">
              <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        )}
      </div>
      <p className="text-xs font-medium truncate text-white/90">{playlist.title}</p>
      <p className="text-[11px] text-white/35 truncate mt-0.5">{playlist.track_count} {tt('tracksWord')}</p>
    </button>
  )
}
