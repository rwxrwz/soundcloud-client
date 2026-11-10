/* Genius links for a track.
 *
 * The matching itself does not live here any more: it moved to the main
 * process, where the token is, and this file now just asks for the answer
 * and keeps the link. What is left of the old approach is the shape of
 * the problem it was written for - SoundCloud artist names rarely match
 * Genius ones, so a confident hit needs more than a title - and that
 * reasoning is in electron/geniusFetch.ts beside the code that uses it.
 *
 * When nothing confident comes back the fallback is a Genius search URL,
 * which can never point at the wrong song.
 */

import { cleanTitle, splitArtistTitle } from './lyrics'

export interface GeniusLink {
  url: string
  /** true = direct song page, false = Genius search results for the title */
  exact: boolean
}

const cache = new Map<number, GeniusLink>()

export function geniusSearchUrl(title: string): string {
  return `https://genius.com/search?q=${encodeURIComponent(title)}`
}

export async function findGeniusLink(trackId: number, rawTitle: string, username: string): Promise<GeniusLink> {
  const cached = cache.get(trackId)
  if (cached) return cached

  const raw = rawTitle.trim()
  const parsed = splitArtistTitle(rawTitle)
  const title = cleanTitle(parsed.title) || raw
  const fallback: GeniusLink = { url: geniusSearchUrl(raw), exact: false }

  /* This used to call genius.com/api/search directly. It should not have:
     that site's robots.txt disallows /api/* and /search?* for everyone, and
     the endpoint answers 403 anyway. The published interface at
     api.genius.com is the right door, and it needs a token the person
     creates - so without one there is no automated request at all, just a
     search link, which costs Genius nothing. */
  const exact = await window.electronAPI?.geniusFind?.({
    title, artists: [parsed.artist, username].filter(Boolean) as string[], raw,
  }).catch(() => null)
  if (exact) {
    const link: GeniusLink = { url: exact, exact: true }
    cache.set(trackId, link)
    return link
  }

  cache.set(trackId, fallback)
  return fallback
}

/* The words themselves, not just a link to them.
 *
 * Genius has no lyrics API - the words live in the page - so this reads the
 * page the browser would have shown. Only ever for a song we matched
 * EXACTLY: a search-result page has no lyrics on it, and a confident-looking
 * wrong song would quietly put another artist's words under this track.
 *
 * Parsed with DOMParser rather than by regex. The containers nest links and
 * spans inside them, which a regex gets wrong in the interesting cases, and
 * this code runs in the renderer where a parser is free. */

const lyricsCache = new Map<number, string[] | null>()

/** Section markers like [Chorus] or [Куплет 2] - structure, not words. */
const SECTION = /^\s*[[(](?:[^\])]{0,40})[\])]\s*$/

export type GeniusFail = 'NO_TOKEN' | 'NOT_FOUND' | 'BLOCKED' | 'BAD_TOKEN' | 'ERROR' | 'NO_LYRICS'

/** Why the last attempt came back empty - shown to the person, since
 *  "no token" and "Genius said no" need different reactions from them. */
export let lastGeniusFail: GeniusFail | null = null
/** Set alongside BAD_TOKEN: true when the refused token was the one built
 *  into the app, false when it was the person's own. */
export let lastGeniusShared = false
/** When Genius will be asked again, set alongside BLOCKED. A refusal with
 *  no end to it reads as a broken feature; an hour reads as an hour. */
export let lastGeniusRetryAt = 0

export async function fetchGeniusLyrics(trackId: number, rawTitle: string, username: string): Promise<string[] | null> {
  /* Cleared before the cache is consulted, not after. These three are read
     by the caller straight after this returns, so a cached miss used to
     hand back whatever the last real request had failed with: a scan that
     hit Cloudflare on track 40 left BLOCKED standing, and the next run
     aborted on its first track - one that was answered from the cache and
     never went near the network. */
  lastGeniusFail = null
  lastGeniusRetryAt = 0
  lastGeniusShared = false
  if (lyricsCache.has(trackId)) return lyricsCache.get(trackId) ?? null
  let out: string[] | null = null
  try {
    const parsed = splitArtistTitle(rawTitle)
    const res = await window.electronAPI?.geniusPage?.({
      trackId,
      title: cleanTitle(parsed.title) || rawTitle.trim(),
      artists: [parsed.artist, username].filter(Boolean) as string[],
      raw: rawTitle.trim(),
    })
    if (!res) lastGeniusFail = 'ERROR'
    else if (!res.ok) {
      lastGeniusFail = res.reason as GeniusFail
      lastGeniusShared = !!res.shared
      lastGeniusRetryAt = res.retryAt ?? 0
    }
    else {
      out = extractLyrics(res.html)
      if (!out) lastGeniusFail = 'NO_LYRICS'
    }
  } catch { lastGeniusFail = 'ERROR' }
  /* A refused token is not a fact about this song. Remembering "no lyrics"
     here would outlive the token it was really about, so the only failures
     worth caching are the ones a retry cannot change. */
  // NO_TOKEN joins the list: it is a fact about the settings, not about
  // the song, and caching it meant pasting a token in settings left every
  // track the token-less session had touched still marked as hopeless.
  if (out || !['BAD_TOKEN', 'BLOCKED', 'ERROR', 'NO_TOKEN'].includes(lastGeniusFail ?? '')) {
    lyricsCache.set(trackId, out)
  }
  return out
}

/** Lyrics from a page the person pointed at. Same extraction, different
 *  way of arriving: they chose the page, so nothing is matched or guessed. */
export async function fetchGeniusByLink(trackId: number, url: string): Promise<string[] | null> {
  lastGeniusFail = null
  try {
    const res = await window.electronAPI?.geniusByUrl?.({ trackId, url })
    if (!res) { lastGeniusFail = 'ERROR'; return null }
    if (!res.ok) { lastGeniusFail = res.reason as GeniusFail; lastGeniusRetryAt = res.retryAt ?? 0; return null }
    const out = extractLyrics(res.html)
    if (!out) lastGeniusFail = 'NO_LYRICS'
    if (out) lyricsCache.set(trackId, out)
    return out
  } catch { lastGeniusFail = 'ERROR'; return null }
}

/** The same for the Genius half: a wrong page must not survive in memory
 *  after it has been deleted from disk. */
export function forgetGenius(trackId: number): void {
  lyricsCache.delete(trackId)
}

export function extractLyrics(html: string): string[] | null {
  let doc: Document
  try { doc = new DOMParser().parseFromString(html, 'text/html') } catch { return null }
  const boxes = [...doc.querySelectorAll('[data-lyrics-container="true"]')]
  if (!boxes.length) return null
  const text = boxes.map(box => {
    /* The container holds more than the song. Genius puts a credits header
       inside it and hangs a recommendations panel off the end, and neither
       has a <br> around it - so the first line came out as "17
       ContributorsMissionLion Lyrics[Текст песни...]" and the last ended in
       "You might also like". Both are marked in the markup: the header
       carries data-exclude-from-selection, which is Genius saying this is
       not part of the words, and the panel is an <aside>. */
    box.querySelectorAll('[data-exclude-from-selection="true"], aside').forEach(el => el.remove())
    // <br> is the line break in these containers; without this the whole
    // song arrives as one line.
    box.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
    return box.textContent ?? ''
  }).join('\n')

  const lines = text.split('\n')
    .map(l => l.replace(/ /g, ' ').trim())
    .filter(l => l && !SECTION.test(l))
  // A page that matched but holds no words - an instrumental entry, or a
  // layout we no longer understand - must not come back as empty lyrics.
  return lines.length >= 4 ? lines : null
}
