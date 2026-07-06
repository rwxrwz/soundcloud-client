import { useState, useEffect } from 'react'
import { useUI } from '../store'
import { sc, SCTrack, SCUser, SCPlaylist } from '../services/soundcloud'
import { TrackCard } from './TrackCard'
import { SegmentedTabs } from './SegmentedTabs'
import { useT } from '../i18n'

type SearchTab = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists'
type Results = { tracks: SCTrack[]; artists: SCUser[]; albums: SCPlaylist[]; playlists: SCPlaylist[] }
const EMPTY: Results = { tracks: [], artists: [], albums: [], playlists: [] }

// The search view for the main list: five tabs (all / tracks / artists / albums /
// playlists). "All" pulls a few of each type in parallel; the other tabs pull a
// larger single-type list. Debounced on the query so typing doesn't spam the API.
export function SearchResults() {
  const { searchQuery, searchTab, setSearchTab, setArtistPage, setSelectedPlaylist, setSelectedAlbum, setPlaylistMenu, setAlbumMenu, setArtistMenu } = useUI()
  const onCtxArtist = (e: React.MouseEvent, u: SCUser) => { e.preventDefault(); e.stopPropagation(); setArtistMenu({ x: e.clientX, y: e.clientY, user: u }) }
  const onCtxAlbum = (e: React.MouseEvent, pl: SCPlaylist) => { e.preventDefault(); e.stopPropagation(); setAlbumMenu({ x: e.clientX, y: e.clientY, album: pl }) }
  const onCtxPlaylist = (e: React.MouseEvent, pl: SCPlaylist) => { e.preventDefault(); e.stopPropagation(); setPlaylistMenu({ x: e.clientX, y: e.clientY, playlist: pl }) }
  const t = useT()
  const [res, setRes] = useState<Results>(EMPTY)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) { setRes(EMPTY); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      const empty = <T,>() => ({ collection: [] as T[] })
      try {
        if (searchTab === 'all') {
          const [tr, ar, al, pl] = await Promise.all([
            sc.searchTracks(q, 6).catch(empty<SCTrack>),
            sc.searchUsers(q, 6).catch(empty<SCUser>),
            sc.searchAlbums(q, 6).catch(empty<SCPlaylist>),
            sc.searchPlaylists(q, 6).catch(empty<SCPlaylist>),
          ])
          if (!cancelled) setRes({ tracks: tr.collection, artists: ar.collection, albums: al.collection, playlists: pl.collection })
        } else if (searchTab === 'tracks') {
          const r = await sc.searchTracks(q, 40); if (!cancelled) setRes({ ...EMPTY, tracks: r.collection })
        } else if (searchTab === 'artists') {
          const r = await sc.searchUsers(q, 30); if (!cancelled) setRes({ ...EMPTY, artists: r.collection })
        } else if (searchTab === 'albums') {
          const r = await sc.searchAlbums(q, 30).catch(empty<SCPlaylist>); if (!cancelled) setRes({ ...EMPTY, albums: r.collection })
        } else {
          const r = await sc.searchPlaylists(q, 30); if (!cancelled) setRes({ ...EMPTY, playlists: r.collection })
        }
      } catch { if (!cancelled) setRes(EMPTY) }
      finally { if (!cancelled) setLoading(false) }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery, searchTab])

  const tabs: [SearchTab, string][] = [
    ['all', t('searchAll')],
    ['tracks', t('tracksLabel')],
    ['artists', t('searchArtists')],
    ['albums', t('searchAlbums')],
    ['playlists', t('searchPlaylistsTab')],
  ]

  if (!searchQuery.trim()) return <Empty text={t('typeToSearch')} />
  const hasAny = res.tracks.length || res.artists.length || res.albums.length || res.playlists.length

  return (
    <div>
      <div className="mb-4">
        <SegmentedTabs<SearchTab> value={searchTab} options={tabs} onChange={setSearchTab} size="sm" />
      </div>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-white/30">{t('searching')}</p>
        </div>
      ) : !hasAny ? (
        <Empty text={t('noResults')} />
      ) : (
        <div className="fade-in space-y-7">
          {(searchTab === 'all' || searchTab === 'tracks') && res.tracks.length > 0 && (
            <Section title={t('tracksLabel')} onMore={searchTab === 'all' ? () => setSearchTab('tracks') : undefined} moreLabel={t('showAll')}>
              <div className="space-y-0.5">{res.tracks.map(tr => <TrackCard key={tr.id} track={tr} queue={res.tracks} />)}</div>
            </Section>
          )}
          {(searchTab === 'all' || searchTab === 'artists') && res.artists.length > 0 && (
            <Section title={t('searchArtists')} onMore={searchTab === 'all' ? () => setSearchTab('artists') : undefined} moreLabel={t('showAll')}>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                {res.artists.map(u => <ArtistCard key={u.id} user={u} onClick={() => setArtistPage(u)} onContext={onCtxArtist} label={t('followers')} />)}
              </div>
            </Section>
          )}
          {(searchTab === 'all' || searchTab === 'albums') && res.albums.length > 0 && (
            <Section title={t('searchAlbums')} onMore={searchTab === 'all' ? () => setSearchTab('albums') : undefined} moreLabel={t('showAll')}>
              <PlGrid items={res.albums} onOpen={setSelectedAlbum} onContext={onCtxAlbum} kindLabel={t('albumWord')} tracksWord={t('tracksWord')} />
            </Section>
          )}
          {(searchTab === 'all' || searchTab === 'playlists') && res.playlists.length > 0 && (
            <Section title={t('searchPlaylistsTab')} onMore={searchTab === 'all' ? () => setSearchTab('playlists') : undefined} moreLabel={t('showAll')}>
              <PlGrid items={res.playlists} onOpen={setSelectedPlaylist} onContext={onCtxPlaylist} kindLabel={t('playlistWord')} tracksWord={t('tracksWord')} />
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, onMore, moreLabel, children }: { title: string; onMore?: () => void; moreLabel: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-sm font-bold text-white/90">{title}</h2>
        {onMore && (
          <button onClick={onMore} className="text-xs font-medium transition-colors" style={{ color: 'var(--accent)' }}>
            {moreLabel}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function ArtistCard({ user, onClick, onContext, label }: { user: SCUser; onClick: () => void; onContext: (e: React.MouseEvent, u: SCUser) => void; label: string }) {
  const avatar = user.avatar_url?.replace('-large', '-t200x200')
  return (
    <button onClick={onClick} onContextMenu={(e) => onContext(e, user)} className="flex flex-col items-center text-center group transition-all duration-200 hover:-translate-y-0.5">
      <div className="relative w-full aspect-square rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {avatar
          ? <img src={avatar} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="w-full h-full flex items-center justify-center"><svg className="w-8 h-8 text-white/15" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"/></svg></div>}
      </div>
      <p className="text-xs font-medium truncate w-full text-white/90">{user.username}</p>
      <p className="text-[11px] text-white/35 truncate w-full mt-0.5">{(user.followers_count ?? 0).toLocaleString()} {label.toLowerCase()}</p>
    </button>
  )
}

function PlGrid({ items, onOpen, onContext, kindLabel, tracksWord }: { items: SCPlaylist[]; onOpen: (p: SCPlaylist) => void; onContext: (e: React.MouseEvent, p: SCPlaylist) => void; kindLabel: string; tracksWord: string }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
      {items.map(pl => {
        const art = (pl.artwork_url ?? pl.tracks?.[0]?.artwork_url)?.replace('-large', '-t200x200')
        return (
          <button key={pl.id} onClick={() => onOpen(pl)} onContextMenu={(e) => onContext(e, pl)} className="text-left group transition-all duration-200 hover:-translate-y-0.5">
            <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
              {art
                ? <img src={art} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                : <div className="w-full h-full flex items-center justify-center"><svg className="w-9 h-9 text-white/15" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/></svg></div>}
            </div>
            <p className="text-xs font-medium truncate text-white/90">{pl.title}</p>
            <p className="text-[11px] text-white/35 truncate mt-0.5">{kindLabel} · {pl.track_count} {tracksWord}</p>
          </button>
        )
      })}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 fade-in">
      <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <svg className="w-5 h-5 text-white/20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/></svg>
      </div>
      <p className="text-sm text-white/25">{text}</p>
    </div>
  )
}
