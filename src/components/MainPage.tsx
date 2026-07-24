import { useEffect, useMemo, useRef, useState } from 'react'
import { useProfile, useUI, usePlayer } from '../store'
import { sc, SCPlaylist, SCTrack } from '../services/soundcloud'
import { useT } from '../i18n'

const MONTH_MS = 30 * 24 * 60 * 60 * 1000

export function MainPage() {
  const { playlists, localPlaylists, releases, setReleases, user } = useProfile()
  const allPlaylists = [...localPlaylists, ...playlists]
  const { setSelectedPlaylist } = useUI()
  const { setTrack } = usePlayer()
  const t = useT()
  const [loadingReleases, setLoadingReleases] = useState(false)

  // Load the releases feed once (shared with the Releases tab via the store)
  useEffect(() => {
    if (!user || releases.length > 0 || loadingReleases) return
    setLoadingReleases(true)
    sc.getReleases(user.id).then(setReleases).catch(() => {}).finally(() => setLoadingReleases(false))
  }, [user?.id])

  const monthReleases = useMemo(
    () => releases.filter(tr => tr.created_at && Date.now() - new Date(tr.created_at).getTime() <= MONTH_MS).slice(0, 16),
    [releases]
  )

  return (
    <div key="main" className="flex-1 flex flex-col overflow-hidden page-enter">
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {/* Transparent spacer revealing the hero animation rendered behind (in Player) */}
        <div style={{ height: 240 }} className="shrink-0" />

        <div className="space-y-7">
          {/* Playlists */}
          <section>
            <h2 className="text-base font-bold text-white mb-3 px-0.5">{t('yourPlaylists')}</h2>
            {allPlaylists.length === 0 ? (
              <p className="text-sm text-white/30 px-0.5 py-6">{t('noPlaylistsYet')}</p>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {allPlaylists.map(pl => (
                  <PlaylistTile key={pl.id} playlist={pl} onClick={() => setSelectedPlaylist(pl)} />
                ))}
              </div>
            )}
          </section>

          {/* Releases this month */}
          {(loadingReleases || monthReleases.length > 0) && (
            <section>
              <h2 className="text-base font-bold text-white mb-3 px-0.5">{t('releasesMonth')}</h2>
              {loadingReleases && monthReleases.length === 0 ? (
                <div className="flex items-center gap-3 py-6 pl-1">
                  <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-white/30">{t('loading')}</span>
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 row-scroll">
                  {monthReleases.map(tr => (
                    <TrackTile key={tr.id} track={tr} onClick={() => setTrack(tr, monthReleases)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

// Round "more" button: visible on tile hover. Click opens the menu immediately;
// resting the cursor on the button for 600 ms opens it too (as if right-clicked).
function MoreButton({ onOpen, size = 26 }: { onOpen: (c: { x: number; y: number }) => void; size?: number }) {
  const ref = useRef<HTMLButtonElement>(null)
  const tm = useRef<ReturnType<typeof setTimeout>>()
  const corner = () => {
    const r = ref.current?.getBoundingClientRect()
    return r ? { x: r.left, y: r.bottom } : { x: 0, y: 0 }
  }
  const enter = () => { tm.current = setTimeout(() => onOpen(corner()), 600) }
  const leave = () => clearTimeout(tm.current)
  return (
    <button
      ref={ref}
      aria-label="menu"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearTimeout(tm.current); onOpen({ x: e.clientX, y: e.clientY }) }}
      className="absolute z-10 rounded-lg flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      style={{ top: 6, right: 6, width: size, height: size, background: 'rgba(10,10,14,0.7)' }}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
    </button>
  )
}

function TrackTile({ track, onClick }: { track: SCTrack; onClick: () => void }) {
  const { currentTrack } = usePlayer()
  const setContextMenu = useUI(s => s.setContextMenu)
  const active = currentTrack?.id === track.id
  const art = sc.formatArtwork(track.artwork_url || track.user?.avatar_url, 't200x200')

  return (
    <button onClick={onClick}
      className="group shrink-0 text-left" style={{ width: 108 }}>
      <div className="relative rounded-xl overflow-hidden bg-white/5 mb-2"
        style={{ width: 108, height: 108, border: active ? '1px solid rgba(var(--accent-rgb),0.5)' : '1px solid rgba(255,255,255,0.06)' }}>
        {art
          ? <img src={art} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="w-full h-full" />}
        <MoreButton size={24} onOpen={(c) => setContextMenu({ x: c.x, y: c.y, track })} />
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <svg className="w-4 h-4 ml-0.5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
      <p className="text-[11px] font-medium truncate" style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.9)' }}>{track.title}</p>
      <p className="text-[11px] text-white/35 truncate mt-0.5">{track.user?.username}</p>
    </button>
  )
}

function PlaylistTile({ playlist, onClick }: { playlist: SCPlaylist; onClick: () => void }) {
  const t = useT()
  const setPlaylistMenu = useUI(s => s.setPlaylistMenu)
  const art = (playlist.artwork_url ?? playlist.tracks?.[0]?.artwork_url)?.replace('-large', '-t200x200')

  const openMenu = (c: { x: number; y: number }) => { setPlaylistMenu({ x: c.x, y: c.y, playlist }) }

  return (
    <button onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }) }}
      className="group text-left">
      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-white/5 mb-2"
        style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        {art
          ? <img src={art} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="w-full h-full flex items-center justify-center">
              <svg className="w-9 h-9 text-white/15" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/></svg>
            </div>}
        <MoreButton onOpen={openMenu} />
        {/* Hover play affordance */}
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <svg className="w-4 h-4 ml-0.5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
      <p className="text-xs font-medium truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>{playlist.title}</p>
      <p className="text-[11px] text-white/35 truncate mt-0.5">{playlist.track_count} {t('tracksWord')}</p>
    </button>
  )
}
