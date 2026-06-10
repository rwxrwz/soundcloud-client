import { SCTrack } from '../services/soundcloud'
import { sc } from '../services/soundcloud'
import { usePlayer, useUI, useLyrics, useAccentHex } from '../store'
import { TrackActions } from './TrackActions'
import { timeAgo } from '../i18n'

interface Props {
  track: SCTrack
  queue: SCTrack[]
  showDate?: boolean
}

export function TrackCard({ track, queue, showDate }: Props) {
  const { setTrack, currentTrack, isPlaying, setPlaying } = usePlayer()
  const { setArtistPage, setContextMenu } = useUI()
  const hasLyrics = useLyrics(s => s.available[track.id])
  const accentHex = useAccentHex()
  const active = currentTrack?.id === track.id

  const artwork = sc.formatArtwork(track.artwork_url || track.user?.avatar_url, 't200x200')

  const handleClick = (e: React.MouseEvent) => {
    // Ignore clicks on action buttons
    if ((e.target as HTMLElement).closest('[data-action]')) return
    if (active) setPlaying(!isPlaying)
    else setTrack(track, queue)
  }

  const handleArtistClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (track.user) setArtistPage(track.user)
  }

  return (
    <div
      onClick={handleClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track }) }}
      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200"
      style={{
        background: active ? `rgba(var(--accent-rgb), 0.12)` : 'transparent',
        border: active ? `1px solid rgba(var(--accent-rgb), 0.25)` : '1px solid transparent',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {/* Artwork */}
      <div className="relative shrink-0 w-11 h-11 rounded-lg overflow-hidden bg-white/5">
        {artwork ? (
          <img src={artwork} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-5 h-5 text-white/20" fill="currentColor" viewBox="0 0 20 20">
              <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
            </svg>
          </div>
        )}
        {/* Play overlay */}
        <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {active && isPlaying ? (
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
        <p className="text-sm font-medium truncate transition-colors duration-200 flex items-center gap-1.5"
          style={{ color: active ? accentHex : 'rgba(255,255,255,0.9)' }}>
          {hasLyrics && (
            <span className="shrink-0 inline-flex items-center justify-center text-[9px] font-bold rounded"
              title="Lyrics"
              style={{ width: 14, height: 14, background: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)' }}>
              L
            </span>
          )}
          <span className="truncate">{track.title}</span>
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <button
            data-action
            onClick={handleArtistClick}
            className="text-xs text-white/35 truncate text-left hover:text-white/70 transition-colors duration-150"
          >
            {track.user?.username}
          </button>
          {showDate && track.created_at && (
            <span className="text-xs text-white/25 shrink-0">· {timeAgo(track.created_at)}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <TrackActions track={track} alwaysVisible />

      {/* Duration / eq-bars */}
      {active ? (
        <div className="flex items-end gap-[2px] h-4 w-4 shrink-0">
          {[0.55, 0.9, 0.7].map((spd, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full origin-bottom"
              style={{
                background: isPlaying ? accentHex : 'rgba(255,255,255,0.25)',
                height: isPlaying ? '100%' : '25%',
                animation: isPlaying ? `eq-bar ${spd}s ease-in-out ${i * 0.15}s infinite alternate` : 'none',
                transition: 'height 0.4s cubic-bezier(0.16,1,0.3,1), background 0.35s ease, opacity 0.35s ease',
                opacity: isPlaying ? 1 : 0.5,
              }}
            />
          ))}
        </div>
      ) : (
        <span className="text-xs text-white/30 shrink-0 tabular-nums w-10 text-right">
          {sc.formatDuration(track.duration)}
        </span>
      )}
    </div>
  )
}
