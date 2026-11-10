import { useEffect } from 'react'
import { usePlayer, useProfile, useUI } from '../store'
import { sc } from '../services/soundcloud'
import type { SCTrack, SCPlaylist } from '../services/soundcloud'
import { fetchLyrics } from '../services/lyrics'
import { cachedAi } from '../services/aiLyrics'
import { playlistCache } from '../services/playlistCache'
import type { RemoteListRequest, RemoteListItem } from '../services/remoteTypes'

/* Renderer half of the Telegram remote. The bot lives in the main process and
   holds no player state of its own: it asks for a page of tracks when someone
   opens a list, and sends taps back as the same actions the UI would run. */

/* 80px is what a list row draws it at, and a phone on mobile data should
   not be made to fetch a 500px cover forty times to fill one screen. */
function thumb(t: SCTrack | SCPlaylist): string | undefined {
  const raw = t.artwork_url ?? t.user?.avatar_url ?? null
  return raw ? sc.formatArtwork(raw, 't200x200') ?? undefined : undefined
}

function mapItem(t: SCTrack) {
  return {
    id: String(t.id), title: t.title ?? '', artist: t.user?.username ?? '',
    art: thumb(t), dur: Math.round((t.duration ?? 0) / 1000),
  }
}

function matches(t: SCTrack, q: string): boolean {
  const needle = q.toLowerCase()
  return (t.title ?? '').toLowerCase().includes(needle) ||
         (t.user?.username ?? '').toLowerCase().includes(needle)
}

/* Searches likes and every playlist the user has - their own, the ones they
   liked, and local-only ones. No network: the app already hydrates playlist
   tracks into playlistCache in the background, so this reads memory. Playlists
   whose tracks have not arrived yet contribute whatever stubs they have, which
   is nothing rather than wrong. A track found in several places is listed once
   per place; that repetition IS the answer to "where is it". */
function searchEverywhere(q: string): { items: RemoteListItem[]; tracks: SCTrack[] } {
  // The playlist lists come from allPlaylists() below, not from here.
  const { likes } = useProfile.getState()
  const items: RemoteListItem[] = []
  const tracks: SCTrack[] = []
  for (const t of likes) if (matches(t, q)) { items.push({ ...mapItem(t), from: 'likes' }); tracks.push(t) }
  for (const pl of allPlaylists()) {
    for (const t of playlistTracks(pl)) {
      if (t.title && matches(t, q)) { items.push({ ...mapItem(t), from: 'playlist', playlist: pl.title }); tracks.push(t) }
    }
  }
  return { items, tracks }
}

/* Every playlist the person has, in the order the app shows them: their own
   first, then the ones they liked, then local-only. Deduped, because a playlist
   can legitimately sit in two of those lists. */
function allPlaylists(): SCPlaylist[] {
  const { playlists, likedPlaylists, localPlaylists } = useProfile.getState()
  const seen = new Set<number>()
  const out: SCPlaylist[] = []
  for (const pl of [...playlists, ...likedPlaylists, ...localPlaylists]) {
    if (seen.has(pl.id)) continue
    seen.add(pl.id)
    out.push(pl)
  }
  return out
}

/** Tracks of one playlist: the background-hydrated cache if it has arrived,
 *  otherwise whatever stubs the listing carried. */
function playlistTracks(pl: SCPlaylist): SCTrack[] {
  return playlistCache.get(pl.id) ?? pl.tracks ?? []
}

/* The list the phone is currently looking at, whole and in the order it is
 * shown in.
 *
 * Playing a track by id alone made the player guess which list it came
 * from, and the guess was usually wrong: a track opened from a playlist is
 * almost always in likes too, so the queue became likes and the playlist
 * was dropped on the floor. When the track sat at the end of whatever was
 * guessed, the next thing to play was autoplay's "something similar" - a
 * playlist you had just opened, replaced by a radio.
 *
 * Remembering the list removes the guess. Whatever the phone shows is what
 * the queue becomes, with the sort and the filter it is wearing, which is
 * also what clicking a track on the desktop does. */
let shown: SCTrack[] = []

/* Plays a track the bot named by id, searching every list the bot could have
   shown it in. Whichever list it turns up in becomes the queue, so skipping
   onwards continues through that playlist rather than dropping the context. */
function playById(id: string): void {
  const s = usePlayer.getState()
  const { likes } = useProfile.getState()
  const pick = (list: SCTrack[]) => {
    const hit = list.find(t => String(t.id) === id)
    if (hit) { s.setTrack(hit, list); return true }
    return false
  }
  /* First, because it is the only one that is not a guess. The fallbacks
     below are for an id that arrived without a list behind it. */
  if (pick(shown)) return
  if (pick(s.queue) || pick(likes)) return
  for (const pl of allPlaylists()) if (pick(playlistTracks(pl))) return
}

export function useRemote() {
  // Commands: the same store actions the on-screen controls call.
  useEffect(() => {
    return window.electronAPI?.onRemoteCommand?.((cmd) => {
      const s = usePlayer.getState()
      switch (cmd.action) {
        case 'toggle': s.setPlaying(!s.isPlaying); break
        case 'next': s.nextTrack(); break
        case 'prev': s.prevTrack(); break
        case 'seek': if (typeof cmd.value === 'number') s.seekTo(cmd.value); break
        case 'volume': if (typeof cmd.value === 'number') s.setVolume(Math.max(0, Math.min(1, cmd.value))); break
        case 'shuffle': if (typeof cmd.value === 'boolean') usePlayer.setState({ shuffle: cmd.value }); break
        case 'repeat':
          if (cmd.value === 'off' || cmd.value === 'one' || cmd.value === 'all') {
            usePlayer.setState({ repeat: cmd.value === 'off' ? 'none' : cmd.value })
          }
          break
        case 'playQueueIndex': {
          const i = cmd.value
          if (typeof i === 'number' && i >= 0 && i < s.queue.length) s.setTrack(s.queue[i], s.queue)
          break
        }
        case 'playTrackId':
          playById(String(cmd.value))
          break
      }
    })
  }, [])

  // One page of a track list, on demand. Sending 1700 likes to the main process
  // on every state update would be wasteful; this costs one message per tap.
  useEffect(() => {
    return window.electronAPI?.onRemoteListRequest?.((q: RemoteListRequest) => {
      const reply = (items: RemoteListItem[], total: number, title?: string) =>
        window.electronAPI?.remoteListReply?.({ id: q.id, items, total, title })
      try {
        if (q.kind === 'search') {
          const hits = searchEverywhere(q.query ?? '')
          shown = hits.tracks
          reply(hits.items.slice(q.offset, q.offset + q.limit), hits.items.length)
          return
        }
        if (q.kind === 'global') {
          const needle = (q.query ?? '').trim()
          if (!needle) { reply([], 0); return }
          /* Tracks only, by request - and the one page is the whole answer:
             SoundCloud's search takes a limit but no offset, so there is no
             second page to promise. Reporting the count we actually have
             keeps the "more" button from appearing and lying. */
          void sc.searchTracks(needle, 50)
            .then(r => {
              shown = r.collection ?? []
              reply(shown.map(mapItem), shown.length)
            })
            .catch(() => reply([], 0))
          return
        }
        if (q.kind === 'playlists') {
          const all = allPlaylists()
          reply(all.slice(q.offset, q.offset + q.limit).map(pl => ({
            id: String(pl.id),
            title: pl.title ?? '',
            artist: pl.user?.username ?? '',
            count: pl.track_count ?? playlistTracks(pl).length,
            /* SoundCloud reports the whole playlist's length, which is the
               only trustworthy source: adding up the tracks we hold would
               undercount every playlist whose tail is still stubs. Falls
               back to that sum when it is missing. */
            dur: Math.round((pl.duration || playlistTracks(pl).reduce((n, tr) => n + (tr.duration || 0), 0)) / 1000),
            /* A playlist often has no cover of its own - SoundCloud shows
               the first track's instead, and so does the player. */
            art: thumb(pl) ?? (playlistTracks(pl)[0] ? thumb(playlistTracks(pl)[0]) : undefined),
          })), all.length)
          // Playlists are not tracks: nothing here can be played by id.
          shown = []
          return
        }
        if (q.kind === 'playlist') {
          const pl = allPlaylists().find(x => String(x.id) === q.playlistId)
          if (!pl) { reply([], 0); return }
          /* Only the tracks we actually know something about.
             A playlist listing arrives with its first few tracks filled in
             and the rest as bare ids, waiting for the background hydration
             to finish. In playlist order those stubs sit at the end and are
             never reached; reversed, they are the first thing you see - and
             they drew as blank rows. Better to show fewer rows than rows
             with nothing in them. */
          let list = playlistTracks(pl).filter(tr => !!tr.title)
          /* A playlist arrives in its own order, and a newly added track
             lands at the end - so that order IS oldest-first, and "newest"
             is simply the reverse. Same rule as the player's own sort; no
             dates are involved, because what is being ordered is when you
             added it, not when it came out. */
          if (q.sort === 'newest') list = [...list].reverse()
          if (q.query?.trim()) list = list.filter(tr => matches(tr, q.query!.trim()))
          shown = list
          reply(list.slice(q.offset, q.offset + q.limit).map(mapItem), list.length, pl.title)
          return
        }
        const source: SCTrack[] = q.kind === 'queue'
          ? usePlayer.getState().queue
          : useProfile.getState().likes
        shown = source
        reply(source.slice(q.offset, q.offset + q.limit).map(mapItem), source.length)
      } catch {
        reply([], 0)
      }
    })
  }, [])

  /* Lyrics for the Mini App. Only ever asked about the track that is
     playing, so there is nothing to look up: the words for anything else
     are not a question the phone can ask. fetchLyrics answers from its own
     cache when the lyrics pane has already been opened on the desktop, and
     that cache is also where an AI alignment lands - so the phone gets the
     better version for free when one exists. */
  useEffect(() => {
    return window.electronAPI?.onRemoteLyricsRequest?.(({ id, trackId }) => {
      const reply = (synced: { time: number; text: string }[] | null, plain: string | null, ai?: boolean) =>
        window.electronAPI?.remoteLyricsReply?.({ id, synced, plain, ai })
      const t = usePlayer.getState().currentTrack
      if (!t || Number(t.id) !== Number(trackId)) { reply(null, null); return }
      /* Both places the words can be, because they are different places.
         fetchLyrics answers from the catalogue and from this window's own
         cache - but that cache is filled by a lookup or by the model
         running HERE, and a fresh session has neither. What the desktop is
         showing after a restart came off disk through cachedAi, which does
         not touch that cache at all. Reading only the first one meant the
         phone was told there were no words for a track whose words were on
         the screen two feet away.
         Timed wins over untimed, which is the same choice the lyrics pane
         makes when it has both. */
      const tid = Number(t.id)
      Promise.all([
        fetchLyrics({
          trackId: tid, title: t.title ?? '',
          artist: t.user?.username ?? '', durationSec: (t.duration ?? 0) / 1000,
        }).catch(() => null),
        /* The aligned slot only, which is the same slot the lyrics pane
           reads. The other one holds transcripts the model wrote itself,
           from back when it was allowed to; the desktop stopped showing
           those on purpose, and falling back to them here put words a
           machine invented on the phone for tracks where the screen two
           feet away correctly shows none. */
        cachedAi(tid, true).catch(() => null),
      ])
        .then(([cat, ai]) => {
          const best = ai?.synced && !cat?.synced ? ai : (cat ?? ai)
          reply(best?.synced ?? null, best?.plain ?? null, best?.ai)
        })
        .catch(() => reply(null, null))
    })
  }, [])

  // Pairing: a bot cannot turn @username into a user id, so the first stranger
  // to message it becomes a request the person approves here, in the app.
  useEffect(() => {
    return window.electronAPI?.onRemotePair?.((u) => {
      const { askConfirm } = useUI.getState()
      askConfirm(`Telegram: ${u.name} (ID ${u.id}) запрашивает доступ к плееру. Выдать?`, 'Выдать доступ')
        .then(ok => { if (ok) window.electronAPI?.remoteApprove?.(u.id) })
    })
  }, [])
}
