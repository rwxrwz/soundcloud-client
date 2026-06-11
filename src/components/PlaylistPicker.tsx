import { useState } from 'react'
import { useProfile, useUI, useToast } from '../store'
import { sc } from '../services/soundcloud'
import { playlistCache } from '../services/playlistCache'
import { CreatePlaylistModal } from './CreatePlaylistModal'
import { useT } from '../i18n'

export function PlaylistPicker() {
  const { playlists, updatePlaylistTracks } = useProfile()
  const { playlistPickerTrack, setPlaylistPickerTrack } = useUI()
  const { show: showToast } = useToast()
  const t = useT()
  const [loading, setLoading] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const track = playlistPickerTrack
  if (!track) return null

  const close = () => setPlaylistPickerTrack(null)

  const isInPlaylist = (playlistId: number): boolean => {
    const cached = playlistCache.get(playlistId)
    if (cached) return cached.some(t => t.id === track.id)
    const pl = playlists.find(p => p.id === playlistId)
    return pl?.tracks?.some(t => t.id === track.id) ?? false
  }

  const toggle = async (playlistId: number) => {
    if (loading === playlistId) return
    const inPlaylist = isInPlaylist(playlistId)
    const pl = playlists.find(p => p.id === playlistId)
    if (!pl) return

    const currentTracks = playlistCache.get(playlistId) ?? pl.tracks ?? []
    const newTracks = inPlaylist
      ? currentTracks.filter(t => t.id !== track.id)
      : [...currentTracks, track]

    // Optimistic update
    playlistCache.set(playlistId, newTracks)
    updatePlaylistTracks(playlistId, newTracks)

    setLoading(playlistId)
    setError(null)
    try {
      if (inPlaylist) await sc.removeTrackFromPlaylist(playlistId, track.id)
      else await sc.addTrackToPlaylist(playlistId, track.id)
      showToast(
        inPlaylist ? `Убрано из «${pl.title}»` : `Добавлено в «${pl.title}»`,
        inPlaylist ? 'info' : 'success'
      )
    } catch (err: unknown) {
      console.error('[PlaylistPicker] setPlaylistTracks failed:', err)
      const raw = err instanceof Error ? err.message : 'Unknown error'
      const msg = raw.includes('captcha') || raw.includes('403')
        ? 'SoundCloud запросил проверку — попробуй ещё раз через пару секунд'
        : raw
      setError(msg)
      // Rollback
      playlistCache.set(playlistId, currentTracks)
      updatePlaylistTracks(playlistId, currentTracks)
    } finally {
      setLoading(null)
    }
  }

  return (
    <>
    {creating && (
      <CreatePlaylistModal
        initialTrackIds={[track.id]}
        onClose={() => setCreating(false)}
        onCreated={() => close()}
      />
    )}
    <div
      className="fixed inset-0 z-50 flex items-center justify-center playlist-picker-backdrop"
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div className="playlist-picker-panel glass-island rounded-2xl w-72 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-white/8">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white/90">{t('addToPlaylist')}</p>
            <p className="text-[11px] text-white/35 truncate mt-0.5">{track.title}</p>
          </div>
          <button
            onClick={close}
            className="w-6 h-6 rounded-full flex items-center justify-center ml-3 shrink-0"
            style={{ background: 'rgba(255,255,255,0.08)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.14)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'}
          >
            <svg className="w-3 h-3 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-3 mt-2 px-3 py-2 rounded-lg text-xs text-red-300 bg-red-500/10 border border-red-500/20">
            {error}
          </div>
        )}

        {/* Playlist list */}
        <div className="max-h-64 overflow-y-auto py-1.5">
          {/* Create a new playlist seeded with this track */}
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-150 text-left"
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'rgba(var(--accent-rgb),0.15)' }}>
              <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--accent)' }}>{t('newPlaylist')}</p>
          </button>

          {playlists.length === 0 && (
            <p className="text-xs text-white/30 text-center py-6">{t('noPlaylists')}</p>
          )}
          {playlists.map(pl => {
            const inPl = isInPlaylist(pl.id)
            const busy = loading === pl.id
            const art = (pl.artwork_url ?? pl.tracks?.[0]?.artwork_url)
              ?.replace('-large', '-t200x200')

            return (
              <button
                key={pl.id}
                onClick={() => toggle(pl.id)}
                disabled={busy}
                className="w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-150 text-left"
                style={{ opacity: busy ? 0.6 : 1 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                {/* Thumbnail */}
                <div className="w-9 h-9 rounded-lg overflow-hidden bg-white/8 shrink-0">
                  {art ? (
                    <img src={art} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-white/20" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/>
                      </svg>
                    </div>
                  )}
                </div>

                {/* Name + count */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate"
                    style={{ color: inPl ? 'var(--accent)' : 'rgba(255,255,255,0.85)' }}>
                    {pl.title}
                  </p>
                  <p className="text-[11px] text-white/30 mt-0.5">
                    {pl.track_count} {t('tracksWord')}
                  </p>
                </div>

                {/* State indicator */}
                <div className="shrink-0">
                  {busy ? (
                    <div className="w-4 h-4 border border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  ) : inPl ? (
                    <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
    </>
  )
}
