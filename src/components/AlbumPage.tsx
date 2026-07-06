import { useEffect, useState } from 'react'
import { useUI, usePlayer, useProfile, useToast } from '../store'
import { sc } from '../services/soundcloud'
import type { SCTrack } from '../services/soundcloud'
import { TrackActions } from './TrackActions'
import { useT } from '../i18n'

function totalDuration(tracks: SCTrack[]): number {
  return tracks.reduce((s, t) => s + (t.duration || 0), 0)
}

function releaseLabel(d?: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Dedicated album view (album = playlist with set_type album/ep). Opened as an
// overlay via selectedAlbum; loads the full track list, shows release date,
// genre, totals, and a playable track list.
export function AlbumPage() {
  const { selectedAlbum, setSelectedAlbum, setArtistPage, setContextMenu } = useUI()
  const { setTrack, currentTrack, isPlaying, setPlaying } = usePlayer()
  const { user, likedPlaylists, setLikedPlaylists } = useProfile()
  const { show: showToast } = useToast()
  const t = useT()
  const [tracks, setTracks] = useState<SCTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const close = () => { if (closing) return; setClosing(true); setTimeout(() => setSelectedAlbum(null), 300) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!selectedAlbum) return
    setLoading(true)
    setTracks(selectedAlbum.tracks?.filter(t => t.title) ?? [])
    sc.getPlaylist(selectedAlbum.id)
      .then(full => sc.hydratePlaylistTracks(full.tracks ?? []))
      .then(trs => setTracks(trs))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedAlbum?.id])

  if (!selectedAlbum) return null

  const album = selectedAlbum
  const cover = sc.formatArtwork(album.artwork_url || album.tracks?.[0]?.artwork_url || album.user?.avatar_url, 't500x500')
  const kind = album.set_type === 'ep' ? 'EP' : album.set_type === 'compilation' ? t('playlistWord') : t('albumWord')
  const released = releaseLabel(album.release_date ?? album.published_at)
  const genre = album.tracks?.find(tr => tr.genre)?.genre
  const dur = totalDuration(tracks) || album.duration

  const playAll = () => { if (tracks.length) setTrack(tracks[0], tracks) }

  // Foreign albums (not authored by me) can be liked/unliked from the header.
  const isForeign = album.id >= 0 && !(user && album.user?.id === user.id)
  const isLiked = likedPlaylists.some(p => p.id === album.id)
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

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end track-page-backdrop ${closing ? 'closing' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div className={`w-full track-page-panel glass-island rounded-t-3xl flex flex-col overflow-hidden ${closing ? 'closing' : ''}`}
        style={{ height: '88%' }}
      >
        {/* Handle */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-30">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-28 pt-6">
          {/* Header */}
          <div className="flex gap-6 pb-6">
            <div className="shrink-0 rounded-2xl overflow-hidden bg-white/5" style={{ width: 200, height: 200, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>
              {cover
                ? <img src={cover} alt="" className="w-full h-full object-cover scale-in" />
                : <div className="w-full h-full flex items-center justify-center"><svg className="w-12 h-12 text-white/20" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/></svg></div>}
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-center gap-3">
              <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>{kind}</span>
              <p className="text-2xl font-bold text-white leading-tight line-clamp-2">{album.title}</p>
              <button onClick={() => { if (album.user) { setArtistPage(album.user); close() } }} className="text-sm text-white/60 hover:text-white transition-colors text-left w-fit">
                {album.user?.username}
              </button>
              <div className="flex items-center gap-2 text-xs text-white/40 flex-wrap">
                {released && <span>{t('released')}: {released}</span>}
                {released && <span className="text-white/20">·</span>}
                <span>{tracks.length || album.track_count} {t('tracksWord')}</span>
                {dur > 0 && <><span className="text-white/20">·</span><span className="tabular-nums">{sc.formatDuration(dur)}</span></>}
                {genre && <><span className="text-white/20">·</span><span>{genre}</span></>}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={playAll} disabled={!tracks.length}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: '#12101a' }}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  {t('playAll')}
                </button>
                {isForeign && (
                  <button onClick={toggleLike} title={isLiked ? t('unlikePlaylistAction') : t('likePlaylistAction')}
                    className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                    style={{ color: isLiked ? 'var(--accent)' : 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Tracks */}
          {loading && tracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {tracks.map((tr, i) => {
                const active = currentTrack?.id === tr.id
                const playing = active && isPlaying
                return (
                  <div
                    key={tr.id}
                    role="button"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-action]')) return
                      if (active) setPlaying(!isPlaying)
                      else setTrack(tr, tracks)
                    }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track: tr }) }}
                    className="group w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer"
                    style={{
                      background: active ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                      border: active ? '1px solid rgba(var(--accent-rgb),0.2)' : '1px solid transparent',
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <span className="w-6 text-center text-xs text-white/30 tabular-nums shrink-0">
                      {active
                        ? <span className="inline-flex items-end gap-[2px] h-3.5 w-3.5 justify-center">{[0.55, 0.9, 0.7].map((spd, j) => (
                            <span key={j} className="w-[3px] rounded-full origin-bottom" style={{ background: playing ? 'var(--accent)' : 'rgba(255,255,255,0.25)', height: playing ? '100%' : '25%', animation: playing ? `eq-bar ${spd}s ease-in-out ${j * 0.15}s infinite alternate` : 'none' }} />))}</span>
                        : i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.9)' }}>{tr.title}</p>
                      <p className="text-[11px] text-white/30 truncate mt-0.5">{tr.user?.username}</p>
                    </div>
                    <TrackActions track={tr} />
                    <span className="text-xs text-white/25 shrink-0 tabular-nums">{sc.formatDuration(tr.duration)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
