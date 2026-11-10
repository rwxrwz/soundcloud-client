/* Scanning a list of tracks for lyrics.
 *
 * Three ways to do it, and they differ by two orders of magnitude in cost,
 * which is the whole reason the button asks before it starts:
 *
 *   catalogue - a lookup in LRCLIB. Fractions of a second per track, four
 *     at a time. Finds the well-known songs and almost nothing from
 *     SoundCloud's underground.
 *   genius + local timing - finds the song on Genius, then times the words
 *     against the audio on this machine. Half a minute a track, most of it
 *     spent downloading the audio.
 *   genius + Gemini timing - the same, with the timing done by a model
 *     over the network. Slower again, and it spends the person's quota.
 *
 * Every result is written the moment it is known. A scan of three hundred
 * tracks that dies at track two hundred leaves two hundred results behind,
 * because losing an hour of work to a crash is not an acceptable way for
 * this to behave. */

import { useLyrics, useScan, type ScanMode } from '../store'
import { checkTracksLyrics, splitArtistTitle } from './lyrics'
import { fetchGeniusLyrics, lastGeniusFail, type GeniusFail } from './genius'
import { transcribeTrack } from './aiLyrics'
import type { SCTrack } from './soundcloud'
import { humanTime } from './stats'

/* Seconds a track takes, by mode. Measured rather than guessed: the AI
   numbers come from the timing log this player keeps - a shade over a
   minute for the Gemini path, around forty seconds locally once the audio
   download is counted. The catalogue figure is per track with four
   lookups running at once. */
const PER_TRACK_SEC: Record<ScanMode, number> = {
  catalog: 0.3,
  local: 40,
  cloud: 68,
}

/** Roughly how long `n` tracks will take, in seconds. Honest about being a
 *  guess: it cannot know how many will be found, and a miss is cheaper. */
export const estimateSec = (n: number, mode: ScanMode) => Math.round(n * PER_TRACK_SEC[mode])

/** What a track costs in this mode before the run has said otherwise. */
export const priorSec = (mode: ScanMode | null) => (mode ? PER_TRACK_SEC[mode] : 0)

/* Takes the translator, like its two siblings in stats.ts and the model
   card. This one was written without it and hardcoded Russian units, so
   the scan panel - the screen a scan is started from - showed Cyrillic
   to everybody. */
export function formatEta(sec: number, t: (k: 'stSec' | 'stMin' | 'stHour' | 'stLessMin') => string): string {
  if (sec < 90) return `~${Math.max(1, Math.round(sec))} ${t('stSec')}`
  if (sec < 60 * 90) return `~${Math.round(sec / 60)} ${t('stMin')}`
  /* The hours-and-minutes shape is humanTime's, so it is humanTime that
     writes it - the local copy rounded the minute remainder where that one
     floors it, and the same 7139 seconds read "1 h 59 min" on the stats tab
     and "~2 h 0 min" here. Only the "~" and the sub-90-second case above
     are specific to an estimate. */
  return '~' + humanTime(sec, t)
}

type Track = SCTrack

/** The tracks a run will actually touch. */
export function toScan(tracks: Track[], onlyFresh: boolean): Track[] {
  if (!onlyFresh) return tracks
  const known = useLyrics.getState().available
  return tracks.filter(t => known[t.id] === undefined)
}

/* Every artist name this library claims about itself: who uploaded each
   track, who the title says made it, and whoever is credited after a "+"
   or a "feat.". Nothing here is verified - it is what the listener's own
   metadata asserts - and that is enough for what it is used for, which
   is telling "this name exists in this library" from "this name does
   not" when a Genius hit has nothing else vouching for it. */
export function libraryArtists(tracks: Track[]): string[] {
  const out = new Set<string>()
  for (const tr of tracks) {
    const user = tr.user?.username?.trim()
    if (user) out.add(user)
    const raw = (tr.title ?? '').trim()
    if (!raw) continue
    const { artist } = splitArtistTitle(raw)
    if (artist) out.add(artist)
    // "DUMMY DUMMY + ARLEKIN 40 000", "HelloKitty 2 (feat. FallenCastle)"
    for (const m of raw.matchAll(/(?:\+|\bfeat\.?|\bft\.?|\bwith\b)\s*([^()[\]+,]{2,40})/gi)) {
      const name = m[1].trim()
      if (name) out.add(name)
    }
  }
  return [...out]
}

export async function runScan(tracks: Track[], mode: ScanMode): Promise<void> {
  const scan = useScan.getState()
  const mark = useLyrics.getState().mark
  /* Handed over before the first request, not learned as we go. A scan is
     pressed once, so a track judged third cannot wait for a name that
     only turns up at track eighty. */
  try { await window.electronAPI?.geniusLibrary?.(libraryArtists(tracks)) } catch { /* no bridge */ }

  /* The Cloudflare check, if there is going to be one, happens now -
     while the person is still at the keyboard, because they just pressed
     this button. Left to the first track it would be the same single
     window, but a clearance taken here also covers the rest of the run,
     and a run that asks again forty minutes in asks somebody who has
     walked away. Only the Genius modes need it; the catalogue path never
     touches the website. */
  /* Started before anything can fail. The panel switches to the progress
     view the moment the button is pressed, so a failure reported ahead of
     start() left it reading a store that was never started: startedAt 0
     made the elapsed clock show half a million hours, the bar read 0 / 0,
     and fail() setting cancelled while running stayed false pinned the
     button on "Stopping..." for good. It also skipped finish(), which only
     runs in the finally below. */
  scan.start(mode, tracks.length)

  if (mode !== 'catalog') {
    try {
      const ok = await window.electronAPI?.geniusClearance?.()
      if (ok === false) { useScan.getState().fail('BLOCKED'); useScan.getState().finish(); return }
    } catch { /* no bridge: let the first track find out */ }
  }

  try {
    if (mode === 'catalog') {
      /* The catalogue path has its own four-at-a-time loop, so progress is
         reported from inside it rather than driven from here. */
      await checkTracksLyrics(tracks, (id, has) => {
        // The catalogue pass is LRCLIB and leaves no file behind either.
        mark(id, has, 'live')
        useScan.getState().tick(has, tracks.find(t => t.id === id)?.title ?? '')
      }, () => useScan.getState().cancelled)
      return
    }

    for (const track of tracks) {
      const s = useScan.getState()
      if (s.cancelled) break
      s.now(track.title ?? '', 'genius')

      let words: string[] | null = null
      let why: GeniusFail | null = null
      try {
        words = await fetchGeniusLyrics(track.id, track.title ?? '', track.user?.username ?? '')
        why = lastGeniusFail
      } catch { why = 'ERROR' }

      if (!words?.length) {
        /* Why it came back empty decides what happens next, and getting
           this wrong is expensive: a refusal at track sixty used to mark
           the remaining two hundred and forty as "no lyrics" in seconds,
           permanently, and the fresh-only scan would never revisit them. */
        if (why === 'BLOCKED' || why === 'BAD_TOKEN' || why === 'NO_TOKEN') {
          // Everyone's problem, not this track's. Stop, the way a missing
          // key already stops the run below.
          useScan.getState().fail(why)
          break
        }
        // A network blip is about the minute, not about the song: skip it
        // without recording anything, so the next run asks again.
        if (why !== 'ERROR') mark(track.id, false)
        useScan.getState().tick(false, track.title ?? '')
        continue
      }

      /* The words exist, so the track already deserves its badge - even if
         the timing below fails or is interrupted. 'file': the Genius page
         is cached on disk, so this mark can be checked later. */
      mark(track.id, true, 'file')
      useScan.getState().now(track.title ?? '', mode === 'local' ? 'align' : 'model')
      try {
        await transcribeTrack(track, false, words, mode)
      } catch (e) {
        /* A missing key or an undownloaded model is not this track's
           problem - it is every track's problem, and grinding through
           three hundred of them to say so three hundred times is the
           wrong behaviour. Everything found so far is already saved. */
        const code = (e as { code?: string })?.code ?? ''
        if (code === 'NO_KEY' || code === 'BAD_KEY' || code === 'NO_BRIDGE' || /NO_MODEL/.test(code)) {
          useScan.getState().fail(code)
          break
        }
        // Anything else is about this track: note it and move on.
      }
      useScan.getState().tick(true, track.title ?? '')
    }
  } finally {
    useScan.getState().finish()
  }
}
