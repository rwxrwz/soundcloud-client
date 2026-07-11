// Genius links for a track. Uses genius.com's public search endpoint — no API key.
//
// SoundCloud artist names rarely match Genius ones (CODE10 → CODE80, "DATA404 ||
// ARLEKIN M…" → "ARLEKIN 40 000"), so putting the artist in the query returns zero
// hits. Searching by the bare title finds the song, but Genius always answers with
// *something* — a bare "heath ledger" resolves to a different artist's song.
//
// So: search by cleaned title, and only trust a hit whose title matches exactly AND
// whose Genius artists share a word with the SoundCloud uploader / the artist baked
// into the title. Anything less confident falls back to a Genius search URL, which
// can never point at the wrong song.

import { cleanTitle, norm, splitArtistTitle } from './lyrics'

export interface GeniusLink {
  url: string
  /** true = direct song page, false = Genius search results for the title */
  exact: boolean
}

interface GeniusHit {
  result?: { title?: string; artist_names?: string; primary_artist?: { name?: string }; url?: string }
}

const cache = new Map<number, GeniusLink>()

export function geniusSearchUrl(title: string): string {
  return `https://genius.com/search?q=${encodeURIComponent(title)}`
}

/** Words worth comparing — drops noise like "&", "the", short fragments. */
function tokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter(w => w.length >= 3))
}

function artistsOverlap(geniusArtists: string, candidates: string[]): boolean {
  const g = tokens(geniusArtists)
  if (!g.size) return false
  return candidates.some(c => {
    for (const w of tokens(c)) if (g.has(w)) return true
    return false
  })
}

/**
 * Resolve a Genius link for a track. Always returns a usable URL: the song page when
 * we are confident, otherwise a Genius search for the title.
 */
export async function findGeniusLink(trackId: number, rawTitle: string, username: string): Promise<GeniusLink> {
  const cached = cache.get(trackId)
  if (cached) return cached

  const raw = rawTitle.trim()
  const parsed = splitArtistTitle(rawTitle)
  const title = cleanTitle(parsed.title) || raw
  const titleN = norm(title)
  const candidates = [parsed.artist, username].filter(Boolean) as string[]
  // The raw title carries the artist ("CODE10 & RILEY BABY - Show"), which rescues
  // generic titles that drown on their own ("Show" → Eminem). But a wrong artist
  // ("CODE10" vs Genius's "CODE80") can also return nothing, so try several angles.
  const queries = [...new Set([raw, parsed.artist && `${title} ${parsed.artist}`, `${title} ${username}`, title].filter(Boolean) as string[])]
  const fallback: GeniusLink = { url: geniusSearchUrl(raw), exact: false }

  const matches = (h: GeniusHit, allowPrefix: boolean) => {
    const r = h.result
    if (!r?.url) return false
    const hitN = norm(r.title ?? '')
    if (!hitN) return false
    const sameTitle = allowPrefix
      // Genius often drops featured artists from the title ("P2P" vs
      // "P2P + LOTTERY BILLZ"), so accept a prefix — but only once the
      // artists already line up, which rules out same-title-other-artist.
      ? Math.min(hitN.length, titleN.length) >= 3 && (titleN.startsWith(hitN) || hitN.startsWith(titleN))
      : hitN === titleN
    if (!sameTitle) return false
    return artistsOverlap(r.artist_names || r.primary_artist?.name || '', candidates)
  }

  for (const q of queries) {
    try {
      const res = await fetch(`https://genius.com/api/search?q=${encodeURIComponent(q)}`)
      if (!res.ok) continue
      const json = await res.json() as { response?: { hits?: GeniusHit[] } }
      const hits = json.response?.hits ?? []
      const hit = hits.find(h => matches(h, false)) ?? hits.find(h => matches(h, true))
      if (hit?.result?.url) {
        const link: GeniusLink = { url: hit.result.url, exact: true }
        cache.set(trackId, link)
        return link
      }
    } catch { /* offline or endpoint changed — try the next query, then fall back */ }
  }

  cache.set(trackId, fallback)
  return fallback
}
