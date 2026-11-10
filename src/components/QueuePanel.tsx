import { useRef, useState } from 'react'
import { usePlayer, useUI, useToast, useAccentHex, hexToRgb } from '../store'
import { sc } from '../services/soundcloud'
import { useT } from '../i18n'
import type { SCTrack } from '../services/soundcloud'
import { useEscape } from '../hooks/useEscape'

export function QueuePanel() {
  const { queue, queueIndex, currentTrack, setTrack, removeFromQueue, moveInQueue, clearQueue, radioFrom } = usePlayer()
  const { setShowQueue } = useUI()
  const { show: showToast } = useToast()
  const t = useT()
  const accentHex = useAccentHex()
  const [closing, setClosing] = useState(false)
  const close = () => { if (closing) return; setClosing(true); setTimeout(() => setShowQueue(false), 300) }

  // Only when this is the overlay on top - these stack.
  useEscape(close)

  const upNext = queue.slice(queueIndex + 1)
  /* Clamped, because queueIndex is -1 when the track playing is not in the
     queue any more (it was removed from the top). slice(0, -1) would then
     quietly drop the last row instead of showing an empty "played" list. */
  const played = queue.slice(0, Math.max(0, queueIndex))

  // Drag & drop state
  const dragIndexRef = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const handleDragStart = (absoluteIndex: number) => {
    dragIndexRef.current = absoluteIndex
  }
  const handleDragOver = (e: React.DragEvent, absoluteIndex: number) => {
    e.preventDefault()
    setDragOver(absoluteIndex)
  }
  const handleDrop = (absoluteIndex: number) => {
    if (dragIndexRef.current !== null && dragIndexRef.current !== absoluteIndex) {
      moveInQueue(dragIndexRef.current, absoluteIndex)
    }
    dragIndexRef.current = null
    setDragOver(null)
  }
  const handleDragEnd = () => {
    dragIndexRef.current = null
    setDragOver(null)
  }

  return (
    <div className={`track-page-backdrop fixed inset-0 z-50 flex items-end justify-center ${closing ? 'closing' : ''}`}
      onClick={close}>
      <div
        className={`track-page-panel glass-island w-full rounded-t-3xl flex flex-col ${closing ? 'closing' : ''}`}
        style={{ height: '88%' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white/90 tracking-wide">{t('queue')}</h2>
            <p className="text-xs text-white/35 mt-0.5">{queue.length} {t('tracksWord')}</p>
          </div>
          <div className="flex items-center gap-2">
            {queue.length > 1 && (
              <button
                onClick={clearQueue}
                title={t('clearQueue')}
                className="icon-btn flex items-center gap-1.5 px-2.5 h-8 rounded-full text-xs font-medium text-white/55 hover:text-white transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
                {t('clearQueue')}
              </button>
            )}
            <button
              onClick={close}
              className="icon-btn w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/8 transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto px-3 pb-6 space-y-1">

          {/* Now playing */}
          {currentTrack && (
            <Section label={t('nowPlaying')}>
              <TrackRow
                track={currentTrack}
                absoluteIndex={queueIndex}
                isCurrent
                accentHex={accentHex}
                dragOver={dragOver === queueIndex}
                onDragStart={() => handleDragStart(queueIndex)}
                onDragOver={e => handleDragOver(e, queueIndex)}
                onDrop={() => handleDrop(queueIndex)}
                onDragEnd={handleDragEnd}
                onPlay={() => setTrack(currentTrack, queue)}
                /* queueIndex < 0 means this track has already been taken
                   out of the queue and is only still playing, so there is
                   nothing left to remove. */
                onRemove={queueIndex < 0 ? undefined : () => { showToast(`${t('toastRemoved')}: ${currentTrack.title}`, 'info'); removeFromQueue(queueIndex) }}
              />
            </Section>
          )}

          {/* Up next */}
          {upNext.length > 0 && (
            <Section label={`${t('upNext')} · ${upNext.length}`}>
              {upNext.map((track, i) => {
                const abs = queueIndex + 1 + i
                return (
                  <div key={`${track.id}-${abs}`}>
                  {/* Past this line nobody chose anything: the player did. */}
                  {radioFrom >= 0 && abs === radioFrom && (
                    <div className="flex items-center gap-2 px-1 pt-2 pb-1">
                      <span className="text-[9px] uppercase tracking-wider shrink-0" style={{ color: 'var(--accent)' }}>{t('qRadio')}</span>
                      <span className="h-px flex-1" style={{ background: 'rgba(var(--accent-rgb),0.25)' }} />
                    </div>
                  )}
                  <TrackRow
                    track={track}
                    absoluteIndex={abs}
                    accentHex={accentHex}
                    dragOver={dragOver === abs}
                    onDragStart={() => handleDragStart(abs)}
                    onDragOver={e => handleDragOver(e, abs)}
                    onDrop={() => handleDrop(abs)}
                    onDragEnd={handleDragEnd}
                    onPlay={() => setTrack(track, queue)}
                    onRemove={() => { showToast(`${t('toastRemoved')}: ${track.title}`, 'info'); removeFromQueue(abs) }}
                  />
                  </div>
                )
              })}
            </Section>
          )}

          {/* Already played */}
          {played.length > 0 && (
            <Section label={`${t('played')} · ${played.length}`} faded>
              {played.map((track, i) => {
                const abs = i
                return (
                  <TrackRow
                    key={`${track.id}-${abs}`}
                    track={track}
                    absoluteIndex={abs}
                    accentHex={accentHex}
                    faded
                    dragOver={dragOver === abs}
                    onDragStart={() => handleDragStart(abs)}
                    onDragOver={e => handleDragOver(e, abs)}
                    onDrop={() => handleDrop(abs)}
                    onDragEnd={handleDragEnd}
                    onPlay={() => setTrack(track, queue)}
                    onRemove={() => { showToast(`${t('toastRemoved')}: ${track.title}`, 'info'); removeFromQueue(abs) }}
                  />
                )
              })}
            </Section>
          )}

          {queue.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-white/25">
              <svg className="w-12 h-12 mb-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z"/>
              </svg>
              <p className="text-sm">{t('queueEmpty')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ label, children, faded }: {
  label: string
  children: React.ReactNode
  faded?: boolean
}) {
  return (
    <div className="mb-2">
      <p className={`text-[11px] font-semibold uppercase tracking-widest px-3 py-2 ${faded ? 'text-white/20' : 'text-white/35'}`}>
        {label}
      </p>
      {children}
    </div>
  )
}

function TrackRow({ track, isCurrent, faded, accentHex, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onPlay, onRemove }: {
  track: SCTrack
  absoluteIndex: number
  isCurrent?: boolean
  faded?: boolean
  accentHex: string
  dragOver: boolean
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
  onPlay: () => void
  /** Absent when the row is not in the queue and so cannot be removed. */
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const { setContextMenu } = useUI()
  const art = sc.formatArtwork(track.artwork_url || track.user?.avatar_url, 't67x67')

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track }) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="icon-btn flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-150 group"
      style={{
        background: isCurrent
          ? `rgba(${rgbTriplet(accentHex)}, 0.1)`
          : dragOver
          ? 'rgba(255,255,255,0.08)'
          : hovered
          ? 'rgba(255,255,255,0.05)'
          : 'transparent',
        borderTop: dragOver ? `1px solid ${accentHex}` : '1px solid transparent',
        opacity: faded ? 0.45 : 1,
        cursor: 'grab',
      }}
    >
      {/* Drag handle */}
      <div className="text-white/20 group-hover:text-white/40 transition-colors shrink-0 cursor-grab">
        <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
          <circle cx="3" cy="2.5" r="1.2"/><circle cx="9" cy="2.5" r="1.2"/>
          <circle cx="3" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/>
          <circle cx="3" cy="11.5" r="1.2"/><circle cx="9" cy="11.5" r="1.2"/>
        </svg>
      </div>

      {/* Artwork */}
      <div
        className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 shrink-0 cursor-pointer"
        onClick={onPlay}
      >
        {art
          ? <img src={art} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center">
              <svg className="w-4 h-4 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onPlay}>
        <p className="text-sm font-medium truncate leading-5"
          style={{ color: isCurrent ? accentHex : 'rgba(255,255,255,0.88)' }}>
          {track.title}
        </p>
        <p className="text-xs text-white/40 truncate leading-4">{track.user?.username}</p>
      </div>

      {/* Duration */}
      <span className="text-[11px] text-white/25 tabular-nums shrink-0 mr-1">
        {sc.formatDuration(track.duration)}
      </span>

      {/* Remove. Absent entirely when there is nothing to remove, rather
          than a button that does nothing when it is clicked. */}
      {onRemove && <button
        onClick={e => { e.stopPropagation(); onRemove() }}
        className="w-6 h-6 rounded-full flex items-center justify-center text-white/0 group-hover:text-white/35 hover:!text-white/80 hover:bg-white/8 transition-all shrink-0"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>}
    </div>
  )
}

// The store's parser, which is the one gated by normalizeHex - these local
// copies returned [NaN, NaN, NaN] for anything they could not read, and
// `rgba(NaN,NaN,NaN,...)` is dropped by the CSS parser rather than falling
// back to the accent.
const rgbTriplet = (hex: string): string => hexToRgb(hex).join(', ')
