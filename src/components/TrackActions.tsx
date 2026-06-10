import { useState, useRef } from 'react'
import type { SCTrack } from '../services/soundcloud'
import { sc } from '../services/soundcloud'
import { usePlayer, useProfile, useUI, useToast, useAccentHex } from '../store'
import { useT } from '../i18n'

interface Props {
  track: SCTrack
  /** Always show buttons (true) or only on row hover via group-hover (false) */
  alwaysVisible?: boolean
}

export function TrackActions({ track, alwaysVisible }: Props) {
  const { likes, likeTrackOptimistic, unlikeTrackOptimistic } = useProfile()
  const { setPlaylistPickerTrack } = useUI()
  const { show: showToast } = useToast()
  const t = useT()
  const accentHex = useAccentHex()
  const isLiked = likes.some(t => Number(t.id) === Number(track.id))

  const [justAdded, setJustAdded] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isLiked) {
      unlikeTrackOptimistic(track.id)
      sc.unlikeTrack(track.id).catch(() => {
        likeTrackOptimistic(track)
        showToast(t('errUnlike'), 'error')
      })
    } else {
      likeTrackOptimistic(track)
      showToast(`${t('toastLiked')}: ${track.title}`, 'success')
      sc.likeTrack(track.id).catch(() => {
        unlikeTrackOptimistic(track.id)
        showToast(t('errLike'), 'error')
      })
    }
  }

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation()
    const { queue, queueIndex } = usePlayer.getState()
    const insertAt = queueIndex + 1
    usePlayer.setState({ queue: [...queue.slice(0, insertAt), track, ...queue.slice(insertAt)] })
    showToast(`${t('toastQueued')}: ${track.title}`, 'info')
    setJustAdded(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setJustAdded(false), 600)
  }

  const baseVisibility = alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'

  return (
    <div className={`flex items-center gap-0.5 shrink-0 transition-opacity duration-150 ${baseVisibility}`}>
      {/* Add to queue */}
      <button
        data-action
        onClick={handleAddToQueue}
        title={t('addNext')}
        className="p-1.5 rounded-lg transition-all duration-150"
        style={{ color: justAdded ? accentHex : 'rgba(255,255,255,0.3)' }}
        onMouseEnter={e => { if (!justAdded) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = justAdded ? accentHex : 'rgba(255,255,255,0.3)' }}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm16 5v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z"/>
        </svg>
      </button>

      {/* Add to playlist */}
      <button
        data-action
        onClick={(e) => { e.stopPropagation(); setPlaylistPickerTrack(track) }}
        title={t('addToPlaylist')}
        className="p-1.5 rounded-lg transition-all duration-150"
        style={{ color: 'rgba(255,255,255,0.3)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h13M3 12h9M3 18h9M16 15v6M13 18h6"/>
        </svg>
      </button>

      {/* Like */}
      <button
        data-action
        onClick={handleLike}
        title={isLiked ? t('unlike') : t('like')}
        className="p-1.5 rounded-lg transition-all duration-150"
        style={{ color: isLiked ? accentHex : 'rgba(255,255,255,0.3)' }}
        onMouseEnter={e => { if (!isLiked) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)' }}
        onMouseLeave={e => { if (!isLiked) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)' }}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
      </button>
    </div>
  )
}
