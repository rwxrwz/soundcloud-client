import { useEffect, useState, useRef } from 'react'
import { usePlayer, useUI } from '../store'
import { sc } from '../services/soundcloud'
import type { SCComment, SCTrack } from '../services/soundcloud'
import { TrackActions } from './TrackActions'
import { useT, timeAgo } from '../i18n'

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

export function TrackPage() {
  const { currentTrack } = usePlayer()
  const { setShowTrackPage } = useUI()
  const t = useT()
  const [track, setTrack] = useState<SCTrack | null>(null)
  const [comments, setComments] = useState<SCComment[]>([])
  const [loading, setLoading] = useState(true)
  const commentsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentTrack) return
    setLoading(true)
    setTrack(null)
    setComments([])

    Promise.all([
      sc.getTrack(currentTrack.id),
      sc.getTrackComments(currentTrack.id, 50),
    ]).then(([t, c]) => {
      setTrack(t)
      setComments(c.collection)
      setLoading(false)
    }).catch(() => {
      setTrack(currentTrack)
      setLoading(false)
    })
  }, [currentTrack?.id])

  const close = () => setShowTrackPage(false)

  const artwork = currentTrack
    ? sc.formatArtwork(currentTrack.artwork_url || currentTrack.user?.avatar_url, 't500x500')
    : null

  const data = track ?? currentTrack

  return (
    <div
      className="fixed inset-0 z-50 flex items-end track-page-backdrop"
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div className="w-full track-page-panel glass-island rounded-t-3xl flex flex-col overflow-hidden"
        style={{ height: '88%' }}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6" ref={commentsRef}>
          {/* Top section: artwork + info */}
          <div className="flex gap-6 pt-2 pb-6">
            {/* Artwork */}
            <div
              className="shrink-0 rounded-2xl overflow-hidden bg-white/5"
              style={{
                width: 200, height: 200,
                boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              }}
            >
              {artwork ? (
                <img src={artwork} alt="" className="w-full h-full object-cover scale-in" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-white/20" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-3">
              <div>
                <p className="text-xl font-bold text-white leading-tight line-clamp-2">
                  {data?.title ?? '—'}
                </p>
                <p className="text-sm text-white/50 mt-1">{data?.user?.username}</p>
              </div>

              {/* Stats */}
              <div className="flex gap-4">
                <StatBadge
                  icon={<PlayIcon />}
                  value={fmt(data?.playback_count)}
                  label={t('plays')}
                  loading={loading}
                />
                <StatBadge
                  icon={<HeartIcon />}
                  value={fmt(data?.likes_count)}
                  label={t('likesLabel')}
                  loading={loading}
                />
                <StatBadge
                  icon={<RepostIcon />}
                  value={fmt(data?.reposts_count)}
                  label={t('reposts')}
                  loading={loading}
                />
                <StatBadge
                  icon={<CommentIcon />}
                  value={fmt(data?.comment_count)}
                  label={t('comments')}
                  loading={loading}
                />
              </div>

              <div className="flex items-center gap-3">
                {data?.genre && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-white/8 text-white/50 border border-white/10">
                    {data.genre}
                  </span>
                )}
                {data && <TrackActions track={data} alwaysVisible />}
              </div>
            </div>
          </div>

          {/* Description */}
          {data?.description && (
            <div className="mb-5 p-4 rounded-xl bg-white/4 border border-white/7">
              <p className="text-xs text-white/50 leading-relaxed line-clamp-4">
                {data.description}
              </p>
            </div>
          )}

          {/* Comments */}
          <div>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">
              {t('commentsHeader')} {!loading && comments.length > 0 && `· ${comments.length}`}
            </p>

            {loading && (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex gap-3 py-2 animate-pulse">
                    <div className="w-7 h-7 rounded-full bg-white/10 shrink-0" />
                    <div className="flex-1">
                      <div className="h-2.5 bg-white/10 rounded w-24 mb-2" />
                      <div className="h-2 bg-white/7 rounded w-full" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && comments.length === 0 && (
              <p className="text-sm text-white/25 text-center py-8">{t('noComments')}</p>
            )}

            {!loading && comments.length > 0 && (
              <div className="flex flex-col gap-1">
                {comments.map((c, i) => (
                  <div
                    key={c.id}
                    className="flex gap-3 py-2.5 px-3 rounded-xl hover:bg-white/4 transition-colors duration-150"
                    style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}
                  >
                    <img
                      src={sc.formatArtwork(c.user.avatar_url, 't200x200') || ''}
                      alt=""
                      className="w-7 h-7 rounded-full bg-white/10 shrink-0 object-cover"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-xs font-medium text-white/70">{c.user.username}</span>
                        <span className="text-[10px] text-white/25">{timeAgo(c.created_at)}</span>
                        {c.timestamp !== null && c.timestamp !== undefined && (
                          <span className="text-[10px] text-white/20">
                            {t('atTime')} {sc.formatDuration(c.timestamp)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/55 leading-relaxed">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={close}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/15 transition-colors duration-150"
        >
          <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function StatBadge({ icon, value, label, loading }: { icon: React.ReactNode; value: string; label: string; loading: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-white/30">{icon}</span>
        <span className={`text-sm font-semibold text-white transition-opacity duration-300 ${loading ? 'opacity-30' : 'opacity-100'}`}>
          {loading ? '···' : value}
        </span>
      </div>
      <span className="text-[10px] text-white/25 uppercase tracking-wide">{label}</span>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}

function RepostIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 014-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  )
}

function CommentIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  )
}
