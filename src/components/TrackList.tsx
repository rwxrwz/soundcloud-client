import { useState, useEffect, useMemo, useRef } from 'react'
import { useProfile, useUI, useLyrics, useToast } from '../store'
import { sc, SCTrack, SCPlaylist } from '../services/soundcloud'
import { playlistCache, hydratingSet } from '../services/playlistCache'
import { checkTracksLyrics } from '../services/lyrics'
import { TrackCard } from './TrackCard'
import { CreatePlaylistModal } from './CreatePlaylistModal'
import { ConfirmDialog } from './ConfirmDialog'
import { useT } from '../i18n'

export function TrackList() {
  const { likes, stream, playlists, releases, setReleases, setPlaylists, user } = useProfile()
  const { page, selectedPlaylist, searchQuery, searchResults, setSearch, setSearchResults, setSelectedPlaylist, backFromPlaylist, trackOrder, setTrackOrder } = useUI()
  const { show: showToast } = useToast()
  const [searching, setSearching] = useState(false)
  const [loadingReleases, setLoadingReleases] = useState(false)
  const [listKey, setListKey] = useState(0)
  const [hydratedTracks, setHydratedTracks] = useState<SCTrack[]>([])
  const [hydrating, setHydrating] = useState(false)
  const [playlistFilter, setPlaylistFilter] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const t = useT()
  const markLyrics = useLyrics(s => s.mark)
  const [scanning, setScanning] = useState(false)
  const scanCancelRef = useRef(false)
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false)
  const [showDeletePlaylist, setShowDeletePlaylist] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const handleDeletePlaylist = async () => {
    if (!selectedPlaylist || deleteBusy) return
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

  // Hydrate a single playlist and store in cache
  const hydratePlaylist = (playlist: SCPlaylist) => {
    const id = playlist.id
    if (playlistCache.has(id) || hydratingSet.has(id)) return
    const stubs = playlist.tracks ?? []
    const needsHydration = stubs.some(t => !t.title || !t.duration)
    if (!needsHydration) { playlistCache.set(id, stubs); return }
    hydratingSet.add(id)
    sc.hydratePlaylistTracks(stubs)
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

  // Search
  useEffect(() => {
    if (page !== 'search' || !searchQuery.trim()) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try { const r = await sc.searchTracks(searchQuery); setSearchResults(r.collection) }
      finally { setSearching(false) }
    }, 400)
    return () => clearTimeout(t)
  }, [searchQuery, page])

  // Reset filter when playlist changes
  useEffect(() => { setPlaylistFilter(''); setFilterOpen(false) }, [selectedPlaylist?.id])

  // Show playlist tracks
  useEffect(() => {
    if (page !== 'playlist-detail' || !selectedPlaylist) { setHydratedTracks([]); return }
    const id = selectedPlaylist.id

    const cached = playlistCache.get(id)
    if (cached) { setHydratedTracks(cached); return }

    // Not cached yet — hydrate now and show spinner
    const stubs = selectedPlaylist.tracks ?? []
    const needsHydration = stubs.some(t => !t.title || !t.duration)
    if (!needsHydration) { playlistCache.set(id, stubs); setHydratedTracks(stubs); return }

    setHydrating(true)
    hydratingSet.add(id)
    sc.hydratePlaylistTracks(stubs)
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

  switch (page) {
    case 'stream':          rawTracks = stream;                                                   title = t('streamTitle'); break
    case 'releases':        rawTracks = releases;                                                 title = t('releasesTitle'); break
    case 'likes':           rawTracks = likes;                                                    title = t('likesTitle'); break
    case 'search':          rawTracks = searchResults;                                            title = ''; break
    case 'playlist-detail': rawTracks = hydratedTracks; title = selectedPlaylist?.title ?? ''; break
  }

  const tracks = useMemo(() => {
    let t = canSort && trackOrder === 'oldest' ? [...rawTracks].reverse() : rawTracks
    if (page === 'playlist-detail' && playlistFilter.trim()) {
      const q = playlistFilter.toLowerCase()
      t = t.filter(tr =>
        tr.title?.toLowerCase().includes(q) ||
        tr.user?.username?.toLowerCase().includes(q)
      )
    }
    return t
  }, [rawTracks, trackOrder, canSort, playlistFilter, page])

  const handleScanLyrics = async () => {
    if (scanning) { scanCancelRef.current = true; setScanning(false); return }
    setScanning(true)
    scanCancelRef.current = false
    await checkTracksLyrics(tracks, markLyrics, () => scanCancelRef.current)
    setScanning(false)
  }
  useEffect(() => () => { scanCancelRef.current = true }, [])

  // ── Playlists grid ──
  if (page === 'playlists') {
    return (
      <div key="playlists" className="flex-1 flex flex-col overflow-hidden page-enter">
        <div className="px-5 pt-5 pb-3 shrink-0 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">{t('playlists')}</h1>
            <p className="text-xs text-white/35 mt-0.5">{playlists.length}</p>
          </div>
          <button
            onClick={() => setShowCreatePlaylist(true)}
            title={t('newPlaylist')}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl shrink-0 text-sm font-medium transition-all"
            style={{ color: '#fff', background: 'var(--accent)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('newPlaylist')}
          </button>
        </div>
        {showCreatePlaylist && (
          <CreatePlaylistModal
            onClose={() => setShowCreatePlaylist(false)}
            onCreated={pl => setSelectedPlaylist(pl)}
          />
        )}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {playlists.length === 0 ? (
            <Empty text={t('noPlaylistsYet')} />
          ) : (
            <div className="grid grid-cols-2 gap-3 stagger">
              {playlists.map(pl => <PlaylistCard key={pl.id} playlist={pl} onClick={() => setSelectedPlaylist(pl)} />)}
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
            className="p-1.5 rounded-lg transition-all hover:bg-white/8"
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
            <input autoFocus type="text"
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition-all"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.5)'; e.currentTarget.style.background = 'rgba(255,255,255,0.09)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
            />
          ) : filterOpen && page === 'playlist-detail' ? (
            <input
              ref={filterInputRef}
              autoFocus
              type="text"
              placeholder={`${t('searchInPlaylist')}...`}
              value={playlistFilter}
              onChange={e => setPlaylistFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setFilterOpen(false); setPlaylistFilter('') } }}
              className="w-full rounded-xl px-4 py-2 text-sm text-white focus:outline-none transition-all"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}
            />
          ) : (
            <>
              <h1 className="text-xl font-bold text-white truncate">{title}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {(page === 'playlist-detail' && playlistFilter)
                  ? <p className="text-xs" style={{ color: 'var(--accent)' }}>{tracks.length} {t('ofCount')} {hydratedTracks.length}</p>
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

        {/* Playlist filter button */}
        {page === 'playlist-detail' && !filterOpen && (
          <button
            onClick={() => { setFilterOpen(true); setTimeout(() => filterInputRef.current?.focus(), 0) }}
            className="p-1.5 rounded-lg transition-all shrink-0"
            style={{ color: playlistFilter ? 'var(--accent)' : 'rgba(255,255,255,0.35)' }}
            onMouseEnter={e => { if (!playlistFilter) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)' }}
            onMouseLeave={e => { if (!playlistFilter) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)' }}
            title={t('searchInPlaylist')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </button>
        )}
        {page === 'playlist-detail' && filterOpen && (
          <button
            onClick={() => { setFilterOpen(false); setPlaylistFilter('') }}
            className="p-1.5 rounded-lg transition-all shrink-0"
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

        {/* Delete playlist */}
        {page === 'playlist-detail' && !filterOpen && (
          <button
            onClick={() => setShowDeletePlaylist(true)}
            title={t('deletePlaylist')}
            className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all"
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
            className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all"
            style={{ color: scanning ? 'var(--accent)' : 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={e => { if (!scanning) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.85)' }}
            onMouseLeave={e => { if (!scanning) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
          >
            {scanning ? (
              <div className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h11M4 12h16M4 18h9" />
              </svg>
            )}
          </button>
        )}

        {/* Sort toggle */}
        {canSort && tracks.length > 0 && !filterOpen && (
          <div className="flex items-center gap-0.5 rounded-lg p-1 shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <SortBtn label={t('newest')} active={trackOrder === 'newest'} onClick={() => setTrackOrder('newest')} />
            <SortBtn label={t('oldest')} active={trackOrder === 'oldest'} onClick={() => setTrackOrder('oldest')} />
          </div>
        )}
      </div>

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
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {searching || (page === 'releases' && loadingReleases && releases.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-white/30">{page === 'releases' ? t('loadingReleases') : t('searching')}</p>
          </div>
        ) : tracks.length === 0 ? (
          <Empty text={page === 'search' ? t('typeToSearch') : t('nothingHere')} />
        ) : (
          <div key={listKey} className={`stagger ${page === 'releases' ? 'space-y-2' : 'space-y-0.5'}`}>
            {tracks.map(track => <TrackCard key={track.id} track={track} queue={tracks} showDate={page === 'releases'} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function SortBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150"
      style={{
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.4)'
      }}
    >{label}</button>
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

function PlaylistCard({ playlist, onClick }: { playlist: SCPlaylist; onClick: () => void }) {
  const tt = useT()
  const art = (playlist.artwork_url ?? playlist.tracks?.[0]?.artwork_url)?.replace('-large', '-t200x200')
  return (
    <button onClick={onClick}
      className="text-left p-3 rounded-xl group transition-all duration-200 hover:-translate-y-0.5"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.09)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)' }}
    >
      <div className="w-full aspect-square rounded-lg overflow-hidden mb-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {art ? (
          <img src={art} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-white/15" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/>
            </svg>
          </div>
        )}
      </div>
      <p className="text-sm font-medium truncate text-white/85">{playlist.title}</p>
      <p className="text-xs text-white/30 mt-0.5">{playlist.track_count} {tt('tracksWord')}</p>
    </button>
  )
}
