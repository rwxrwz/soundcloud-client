/* Five tracks that would suit this playlist, under the playlist.
 *
 * The same offer SoundCloud makes at the bottom of your own playlists:
 * here are some more, add the ones you want, show me five others. The
 * value is in it being right there, at the end of the thing you were
 * already looking at - the same five tracks behind a menu would never be
 * looked at.
 *
 * Only on playlists that can be added to. On somebody else's playlist
 * the plus has nothing to do, and a row of suggestions with a dead
 * button on each one is worse than no row.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccentHex, useProfile, useToast, useUI, usePlayer } from '../store'
import { sc, type SCPlaylist, type SCTrack } from '../services/soundcloud'
import { playlistCache } from '../services/playlistCache'
import { PlayingBars } from './QueueFlyout'
import { useT } from '../i18n'

const WANT = 5

export function PlaylistSuggestions({ playlist, tracks }: { playlist: SCPlaylist; tracks: SCTrack[] }) {
  const t = useT()
  const { updatePlaylistTracks, setLocalPlaylistTracks } = useProfile()
  const { show: showToast } = useToast()
  const { currentTrack, isPlaying, setTrack, setPlaying } = usePlayer()
  const setContextMenu = useUI(s => s.setContextMenu)
  const accentHex = useAccentHex()
  const [items, setItems] = useState<SCTrack[]>([])
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  /* Everything already offered, so "refresh" means five different tracks
     rather than a reshuffle of the same ones. Held in a ref: it changes
     on every round and nothing on screen is drawn from it. */
  const shown = useRef(new Set<number>())
  /* Which request is the live one.
   *
   * A plain in-flight boolean fixed the double-fire (StrictMode runs the
   * mount effect twice; the refresh button can be clicked twice before a
   * re-render) but it also made a *newer* request a no-op: switching
   * playlists mid-load left the previous playlist's request running, its
   * answer was written into the new playlist's row, and the new playlist
   * never asked for its own. A counter supersedes instead of blocking. */
  const seq = useRef(0)
  const local = playlist.id < 0

  const load = useCallback(async (fresh: boolean) => {
    const mine = ++seq.current
    setBusy(true)
    setFailed(false)
    if (fresh) for (const it of items) shown.current.add(it.id)
    try {
      let got = await sc.getPlaylistSuggestions(playlist.id, tracks, shown.current, WANT)
      /* Every suggestion was one we had already made. Rather than show an
         empty list, the memory is dropped and the question asked again -
         a playlist whose neighbourhood is small should repeat itself, not
         go blank. */
      if (!got.length && shown.current.size) {
        shown.current.clear()
        got = await sc.getPlaylistSuggestions(playlist.id, tracks, shown.current, WANT)
      }
      // Superseded while we were waiting: this answer belongs to a
      // playlist that is no longer on screen.
      if (mine !== seq.current) return
      setItems(got)
      setFailed(!got.length)
    } catch {
      if (mine === seq.current) setFailed(true)
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }, [playlist.id, tracks, items])

  // One round when the playlist opens, and not again until asked.
  useEffect(() => {
    // Abandons whatever is in flight for the playlist we are leaving.
    seq.current++
    shown.current.clear()
    setItems([])
    if (tracks.length) load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist.id, tracks.length > 0])

  const add = async (track: SCTrack) => {
    if (adding !== null) return
    setAdding(track.id)
    const current = playlistCache.get(playlist.id) ?? playlist.tracks ?? tracks
    const next = [...current, track]
    // Shown as done straight away, put back if SoundCloud refuses.
    playlistCache.set(playlist.id, next)
    if (local) setLocalPlaylistTracks(playlist.id, next)
    else updatePlaylistTracks(playlist.id, next)
    setItems(list => list.filter(x => x.id !== track.id))
    shown.current.add(track.id)
    try {
      if (!local) await sc.addTrackToPlaylist(playlist.id, track.id)
      showToast(`${t('sgAdded')}: ${track.title}`, 'success')
    } catch {
      playlistCache.set(playlist.id, current)
      if (local) setLocalPlaylistTracks(playlist.id, current)
      else updatePlaylistTracks(playlist.id, current)
      setItems(list => [track, ...list])
      showToast(t('sgAddFailed'), 'error')
    } finally {
      setAdding(null)
    }
  }

  if (!tracks.length) return null
  if (failed && !items.length && !busy) return null

  return (
    <div className="pt-7 pb-2">
      <h3 className="text-[15px] font-bold text-white/85 px-1 pb-2.5">{t('sgTitle')}</h3>

      {busy && !items.length ? (
        <div className="space-y-0.5">
          {Array.from({ length: WANT }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-1 py-1.5">
              <div className="w-11 h-11 rounded-md shrink-0 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="h-3 rounded animate-pulse" style={{ width: `${55 + i * 7}%`, background: 'rgba(255,255,255,0.06)' }} />
                <div className="h-2.5 w-20 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5" style={{ opacity: busy ? 0.45 : 1, transition: 'opacity 0.2s ease' }}>
          {items.map(track => (
            <SuggestionRow
              key={track.id}
              track={track}
              busy={adding === track.id}
              onAdd={() => add(track)}
              /* The five are played as a set, not one at a time. They are
                 here to be auditioned before anything is added, and
                 queueing the lot means the next one follows without
                 coming back to this list to click again. */
              onPlay={() => {
                if (currentTrack?.id === track.id) setPlaying(!isPlaying)
                else setTrack(track, items)
              }}
              onMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, track }) }}
              active={currentTrack?.id === track.id}
              playing={isPlaying}
              accentHex={accentHex}
              label={t('sgAdd')}
            />
          ))}
        </div>
      )}

      <button
        onClick={() => load(true)}
        disabled={busy}
        className="icon-btn w-full mt-3 py-2.5 rounded-xl text-[12px] font-medium text-white/60 hover:text-white/90 hover:bg-white/[0.08] active:scale-[0.99] transition-all duration-150 disabled:opacity-40 disabled:active:scale-100"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {busy ? t('sgLoading') : t('sgRefresh')}
      </button>
    </div>
  )
}

function SuggestionRow({ track, busy, onAdd, onPlay, onMenu, active, playing, accentHex, label }: {
  track: SCTrack
  busy: boolean
  onAdd: () => void
  onPlay: () => void
  onMenu: (e: React.MouseEvent) => void
  active: boolean
  playing: boolean
  accentHex: string
  label: string
}) {
  const art = sc.formatArtwork(track.artwork_url || track.user?.avatar_url, 't200x200')
  return (
    <div
      onClick={onPlay}
      onContextMenu={onMenu}
      /* row-hover only tints a row that says whether it is active - the
         rule is written against the attribute on purpose, so without it
         there is no hover state at all. That is what made these rows feel
         dead next to every other list in the app. */
      data-active={active ? 'true' : 'false'}
      className="icon-btn row-hover group flex items-center gap-3 px-2 py-1.5 rounded-xl cursor-pointer transition-all duration-200 active:scale-[0.985]"
      style={{
        // No inline background while inactive, or it would sit on top of
        // the hover tint and nothing would happen.
        background: active ? 'rgba(var(--accent-rgb),0.12)' : undefined,
        border: active ? '1px solid rgba(var(--accent-rgb),0.25)' : '1px solid transparent',
      }}
    >
      <div className="relative w-11 h-11 rounded-md overflow-hidden shrink-0 bg-white/5">
        {art && <img src={art} alt="" className="w-full h-full object-cover" loading="lazy" />}
        {/* The same play plate every track row in this app shows, so the
            artwork says "this is a button" before anything is clicked. */}
        <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {active && playing ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate transition-colors duration-200"
          style={{ color: active ? accentHex : 'rgba(255,255,255,0.9)' }}>{track.title}</p>
        <p className="text-[11px] text-white/40 truncate">
          {track.user?.username}
          {track.duration ? ` · ${sc.formatDuration(track.duration)}` : ''}
        </p>
      </div>
      {active && <PlayingBars color={accentHex} playing={playing} />}
      <button
        /* The plus sits inside a row that plays when clicked, so it has to
           stop the click going any further - otherwise adding a track
           also starts it. */
        onClick={e => { e.stopPropagation(); onAdd() }}
        disabled={busy}
        title={label}
        aria-label={label}
        className="icon-btn shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 active:scale-90 transition-all duration-150 disabled:opacity-40 disabled:active:scale-100"
      >
        {busy ? (
          <span className="w-3.5 h-3.5 border-2 border-white/25 border-t-white/80 rounded-full animate-spin" />
        ) : (
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="14" height="14" rx="2" />
            <path d="M21 7v12a2 2 0 0 1-2 2H7" />
            <path d="M10 10h0M7 10h6M10 7v6" />
          </svg>
        )}
      </button>
    </div>
  )
}
