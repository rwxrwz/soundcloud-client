import { useEffect, useState } from 'react'
import { useUI, usePlayer, useProfile, useToast } from '../store'
import { sc } from '../services/soundcloud'
import type { SCUser, SCTrack } from '../services/soundcloud'
import { TrackActions } from './TrackActions'
import { useT, timeAgo } from '../i18n'

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

export function ArtistPage() {
  const { artistPageUser, setArtistPage, setContextMenu } = useUI()
  const { setTrack, currentTrack, isPlaying, setPlaying } = usePlayer()
  const { followingIds, followOptimistic, unfollowOptimistic } = useProfile()
  const { show: showToast } = useToast()
  const t = useT()
  const [user, setUser] = useState<SCUser | null>(artistPageUser)
  const [tracks, setTracks] = useState<SCTrack[]>([])
  const [loading, setLoading] = useState(true)

  const close = () => setArtistPage(null)

  const artistId = (user ?? artistPageUser)?.id
  const isFollowing = artistId !== undefined && followingIds.includes(artistId)
  const toggleFollow = () => {
    if (artistId === undefined) return
    if (isFollowing) {
      unfollowOptimistic(artistId)
      sc.unfollowUser(artistId).catch(() => { followOptimistic(artistId); showToast(t('followErr'), 'error') })
    } else {
      followOptimistic(artistId)
      sc.followUser(artistId).catch(() => { unfollowOptimistic(artistId); showToast(t('followErr'), 'error') })
    }
  }

  useEffect(() => {
    if (!artistPageUser) return
    setUser(artistPageUser)
    setTracks([])
    setLoading(true)

    Promise.all([
      sc.getUser(artistPageUser.id),
      sc.getUserTracks(artistPageUser.id, 20),
    ]).then(([u, t]) => {
      setUser(u)
      setTracks(t.collection)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [artistPageUser?.id])

  if (!artistPageUser) return null

  const avatar = sc.formatArtwork(user?.avatar_url ?? artistPageUser.avatar_url, 't500x500')

  return (
    <div
      className="fixed inset-0 z-50 flex items-end track-page-backdrop"
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div className="w-full track-page-panel glass-island rounded-t-3xl flex flex-col overflow-hidden"
        style={{ height: '88%' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Close */}
        <button
          onClick={close}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/15 transition-colors duration-150"
        >
          <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {/* Hero */}
          <div className="flex gap-5 pt-2 pb-6 items-center">
            {/* Avatar */}
            <div
              className="shrink-0 rounded-full overflow-hidden bg-white/5"
              style={{
                width: 96, height: 96,
                boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              }}
            >
              {avatar ? (
                <img src={avatar} alt="" className="w-full h-full object-cover scale-in" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-white/15" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"/>
                  </svg>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold text-white leading-tight truncate">
                {user?.username ?? artistPageUser.username}
              </h2>
              {user?.full_name && user.full_name !== user.username && (
                <p className="text-sm text-white/40 mt-0.5 truncate">{user.full_name}</p>
              )}
              {user?.city && (
                <p className="text-xs text-white/30 mt-1 flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                  {user.city}
                </p>
              )}
            </div>
          </div>

          {/* Follow button */}
          <button
            onClick={toggleFollow}
            className="mb-5 px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 active:scale-95"
            style={isFollowing
              ? { background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.18)' }
              : { background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 18px rgba(var(--accent-rgb),0.4)' }}
          >
            {isFollowing ? `✓ ${t('unfollow')}` : t('follow')}
          </button>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard
              value={fmt(user?.followers_count)}
              label={t('followers')}
              loading={loading}
            />
            <StatCard
              value={fmt(user?.followings_count)}
              label={t('following')}
              loading={loading}
            />
            <StatCard
              value={fmt(user?.track_count)}
              label={t('tracksLabel')}
              loading={loading}
            />
          </div>

          {/* Description */}
          {user?.description && (
            <div className="mb-6 p-4 rounded-xl bg-white/4 border border-white/7">
              <p className="text-xs text-white/50 leading-relaxed line-clamp-4">
                {user.description}
              </p>
            </div>
          )}

          {/* Recent releases */}
          <div>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">
              {t('recentReleases')}
            </p>

            {loading && (
              <div className="flex flex-col gap-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex gap-3 p-2 animate-pulse">
                    <div className="w-10 h-10 rounded-lg bg-white/10 shrink-0" />
                    <div className="flex-1 flex flex-col justify-center gap-1.5">
                      <div className="h-2.5 bg-white/10 rounded w-3/4" />
                      <div className="h-2 bg-white/7 rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && tracks.length === 0 && (
              <p className="text-sm text-white/25 text-center py-8">{t('noPublicTracks')}</p>
            )}

            {!loading && tracks.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {tracks.map((t, i) => {
                  const art = sc.formatArtwork(t.artwork_url || t.user?.avatar_url, 't200x200')
                  const active = currentTrack?.id === t.id
                  const playing = active && isPlaying

                  return (
                    <div
                      key={t.id}
                      role="button"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('[data-action]')) return
                        if (active) setPlaying(!isPlaying)
                        else setTrack(t, tracks)
                      }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track: t }) }}
                      className="group w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer"
                      style={{
                        background: active ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                        border: active ? '1px solid rgba(var(--accent-rgb),0.2)' : '1px solid transparent',
                        animationDelay: `${Math.min(i * 25, 300)}ms`,
                      }}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
                      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      {/* Artwork */}
                      <div className="relative shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-white/5">
                        {art ? (
                          <img src={art} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white/20" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
                            </svg>
                          </div>
                        )}
                        <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {playing ? (
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
                        <p className="text-sm font-medium truncate"
                          style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.9)' }}>
                          {t.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-white/30">{timeAgo(t.created_at)}</span>
                          {t.genre && (
                            <span className="text-[11px] text-white/20 truncate">{t.genre}</span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <TrackActions track={t} />

                      {/* Duration / eq-bars */}
                      {active ? (
                        <div className="flex items-end gap-[2px] h-4 w-4 shrink-0">
                          {[0.55, 0.9, 0.7].map((spd, j) => (
                            <div
                              key={j}
                              className="w-[3px] rounded-full origin-bottom"
                              style={{
                                background: playing ? 'var(--accent)' : 'rgba(255,255,255,0.25)',
                                height: playing ? '100%' : '25%',
                                animation: playing ? `eq-bar ${spd}s ease-in-out ${j * 0.15}s infinite alternate` : 'none',
                                transition: 'height 0.4s cubic-bezier(0.16,1,0.3,1)',
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-white/25 shrink-0 tabular-nums">
                          {sc.formatDuration(t.duration)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ value, label, loading }: { value: string; label: string; loading: boolean }) {
  return (
    <div
      className="flex flex-col items-center py-3 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <span className={`text-lg font-bold text-white transition-opacity duration-300 ${loading ? 'opacity-30' : 'opacity-100'}`}>
        {loading ? '···' : value}
      </span>
      <span className="text-[10px] text-white/30 uppercase tracking-wide mt-0.5">{label}</span>
    </div>
  )
}
