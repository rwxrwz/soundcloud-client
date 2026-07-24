// Synced lyrics via LRCLIB (https://lrclib.net) — free, no API key.

export interface LyricLine { time: number; text: string }
export interface LyricsResult {
  synced: LyricLine[] | null   // timestamped lines (preferred)
  plain: string | null         // fallback plain text
}

// Strip common SoundCloud title noise to improve matching
export function cleanTitle(title: string): string {
  return title
    .replace(/\(.*?\)|\[.*?\]/g, '')                 // (prod. X), [Free]
    .replace(/\b(prod\.?|feat\.?|ft\.?)\b.*$/i, '')  // prod/feat tails
    .replace(/\s*[-–—]\s*/g, ' ')                    // dashes
    .replace(/\s+/g, ' ')
    .trim()
}

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of lrc.split('\n')) {
    const matches = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!matches.length) continue
    const text = raw.replace(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim()
    for (const m of matches) {
      const min = parseInt(m[1], 10)
      const sec = parseInt(m[2], 10)
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0
      lines.push({ time: min * 60 + sec + frac, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

async function tryGet(params: Record<string, string>): Promise<LyricsResult | null> {
  const qs = new URLSearchParams(params).toString()
  try {
    const res = await fetch(`https://lrclib.net/api/get?${qs}`, {
      headers: { 'Lrclib-Client': 'SoundCloud Desktop Player (electron)' }
    })
    if (!res.ok) return null
    const data = await res.json() as { syncedLyrics?: string; plainLyrics?: string }
    if (data.syncedLyrics) return { synced: parseLRC(data.syncedLyrics), plain: data.plainLyrics ?? null }
    if (data.plainLyrics) return { synced: null, plain: data.plainLyrics }
    return null
  } catch {
    return null
  }
}

// Cache results by track id to avoid refetching (and to power the "L" badge)
const resultCache = new Map<number, LyricsResult | null>()

export function getCachedLyrics(trackId: number): LyricsResult | null | undefined {
  return resultCache.get(trackId)
}

// Check many tracks for lyrics availability with limited concurrency.
export async function checkTracksLyrics(
  tracks: Array<{ id: number; title: string; duration: number; user?: { username?: string } }>,
  mark: (id: number, has: boolean) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const CONCURRENCY = 4
  let idx = 0
  const worker = async () => {
    while (idx < tracks.length && !isCancelled()) {
      const tr = tracks[idx++]
      try {
        const r = await fetchLyrics({
          trackId: tr.id, title: tr.title,
          artist: tr.user?.username ?? '', durationSec: (tr.duration ?? 0) / 1000,
        })
        mark(tr.id, !!r)
      } catch { /* ignore */ }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

export async function fetchLyrics(opts: {
  trackId?: number; title: string; artist: string; durationSec: number
}): Promise<LyricsResult | null> {
  const { trackId, artist, durationSec } = opts
  if (trackId !== undefined && resultCache.has(trackId)) {
    return resultCache.get(trackId) ?? null
  }
  const result = await fetchUncached(artist, opts.title, durationSec)
  if (trackId !== undefined) resultCache.set(trackId, result)
  return result
}

// Once artist + title line up, a SoundCloud upload can be a different-length edit
// of the same song, so duration only ranks candidates. This cap just guards
// against pulling an absurdly different recording.
const MAX_DUR_DIFF = 60 // seconds
// When the artist string doesn't line up but the entry came from an artist-biased
// query, an exact title + near-identical length is a strong "same recording"
// fingerprint we can trust.
const DUR_TIGHT = 3 // seconds
// Cap on artist-biased search queries per lookup, to keep LRCLIB traffic sane
// during the batch "L"-badge scan.
const MAX_QUERIES = 3

// Learned per-uploader aliases. SoundCloud credits a track to one name, but the
// same act shows up on LRCLIB under a collaborator's name (ARLEKIN 40 000 uploads
// a track whose LRCLIB credit is "DATA404"). Once a match confirms the act, we
// remember the other performers and reuse them as query artists for this
// uploader's later tracks. Session-scoped, like resultCache.
const uploaderAliases = new Map<string, Set<string>>()
// Uploaders we've already probed (searched by uploader name alone) to discover
// their collaborator aliases — so we probe each at most once per session.
const probedUploaders = new Set<string>()

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// "Artist - Title" → { artist, title }. SoundCloud titles often embed the artist.
export function splitArtistTitle(raw: string): { artist?: string; title: string } {
  const m = raw.match(/^\s*(.+?)\s+[-–—]\s+(.+)$/)
  if (m) return { artist: m[1].trim(), title: m[2].trim() }
  return { title: raw }
}

// Compare a SoundCloud artist against an LRCLIB artist name.
//   2 = same (equal, or one contains the other)
//   1 = alias by trailing number (CODE10 ~ CODE80: same core once digits dropped)
//   0 = unrelated
// SoundCloud uploaders rename across platforms, so a numeric-suffix alias is a
// real (but weaker) signal than an exact hit. Inputs must already be norm()'d.
function artistMatchLevel(scArtistsNorm: string[], candidateNorm: string): 0 | 1 | 2 {
  if (!candidateNorm) return 0
  for (const a of scArtistsNorm) {
    if (!a) continue
    if (a === candidateNorm || candidateNorm.includes(a) || a.includes(candidateNorm)) return 2
  }
  const stripDigits = (s: string) => s.replace(/\s*\d+\s*$/, '').trim()
  const candCore = stripDigits(candidateNorm)
  for (const a of scArtistsNorm) {
    const core = stripDigits(a)
    if (core.length >= 4 && (core === candCore || candCore.includes(core) || core.includes(candCore))) return 1
  }
  return 0
}

// Separators that split a credit string into individual performers / labels.
const ARTIST_SEP = /\s*(?:\|\||[|/,&•·]|\bfeat\.?\b|\bft\.?\b|\bprod\.?\b)\s*/i

// LRCLIB's ?q= search is AND-matched, so noise like "|| ARLEKIN MUSIC" makes the
// query return nothing. Keep only the first performer chunk for the query.
function primaryArtistForSearch(a: string): string {
  return a.split(ARTIST_SEP)[0].trim()
}

// Split a credit string ("DATA404 & ARLEKIN 40 000") into performer names.
function splitPerformers(a: string): string[] {
  return a.split(ARTIST_SEP).map(s => s.trim()).filter(Boolean)
}

// Words too generic to prove two credits are the same act.
const ARTIST_STOP = new Set(['music', 'records', 'record', 'prod', 'official', 'beats', 'gang', 'clan', 'crew', 'entertainment', 'ent'])

// Distinctive tokens of an artist string: alphabetic, >=4 chars, not a stop-word.
function distinctiveTokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter(t => t.length >= 4 && /\p{L}/u.test(t) && !ARTIST_STOP.has(t)))
}

// After a confirmed match, remember collaborator names credited on LRCLIB so the
// same uploader's other tracks can be found by them. Only learn when the matched
// credit shares a distinctive token with the SoundCloud artist — otherwise the
// match is too weak to trust as an alias source.
function learnAliases(uploaderKey: string, scArtists: string[], creditName: string): void {
  if (!creditName) return
  const scTokens = new Set(scArtists.flatMap(a => [...distinctiveTokens(a)]))
  const confirmed = [...distinctiveTokens(creditName)].some(t => scTokens.has(t))
  if (!confirmed) return
  const set = uploaderAliases.get(uploaderKey) ?? new Set<string>()
  const covered = [...scArtists.map(norm), ...set]
  for (const performer of splitPerformers(creditName)) {
    const pn = norm(performer)
    if (pn && pn.length >= 3 && !covered.some(a => a === pn || a.includes(pn) || pn.includes(a))) set.add(pn)
  }
  if (set.size) uploaderAliases.set(uploaderKey, set)
}

async function fetchUncached(username: string, rawTitle: string, durationSec: number): Promise<LyricsResult | null> {
  const dur = Math.round(durationSec)
  const parsed = splitArtistTitle(rawTitle)
  const title = cleanTitle(parsed.title)
  const titleN = norm(title)
  // Candidate artist names to try (parsed from title first, then uploader)
  const artists = [parsed.artist, username].filter(Boolean).map(a => cleanTitle(a as string))

  // 1) Exact get for each candidate artist — LRCLIB matches duration tightly here
  for (const a of artists) {
    const r = await tryGet({ artist_name: a, track_name: title, duration: String(dur) })
    if (r) return r
  }

  // 2) Search. Merge a title-only query (surfaces cross-platform renames like
  //    CODE10 → CODE80) with artist-biased queries (surface niche entries a
  //    generic title can't reach). Query artists = the cleaned uploader plus any
  //    aliases known for this uploader (e.g. a discovered collaborator).
  type Entry = { trackName?: string; artistName?: string; syncedLyrics?: string; plainLyrics?: string; duration?: number; id?: number }
  const searchGet = async (params: Record<string, string>): Promise<Entry[]> => {
    try {
      const res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params).toString()}`)
      if (!res.ok) return []
      const arr = await res.json() as Entry[]
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }
  const uploaderKey = norm(username)

  // Run the searches with whatever aliases are currently known and return the
  // best candidate. Accept a candidate when: the artist lines up (exact/alias)
  // within a generous duration gap, OR — for an artist-biased hit — the title is
  // exact and the length nearly identical (a trustworthy "same recording"
  // fingerprint). Anything else is dropped: better no lyrics than wrong lyrics.
  const pickBest = async (): Promise<Entry | null> => {
    const learned = [...(uploaderAliases.get(uploaderKey) ?? [])]
    const artistsN = [...artists.map(norm), ...learned].filter(Boolean)
    const qArtists = [...new Set(
      [primaryArtistForSearch(parsed.artist || username), ...learned].map(s => s.trim()).filter(Boolean),
    )].slice(0, MAX_QUERIES)

    const runs = await Promise.all([
      searchGet({ track_name: title }).then(a => ({ a, biased: false })),
      ...qArtists.map(qa => searchGet({ q: `${title} ${qa}` }).then(a => ({ a, biased: true }))),
    ])
    const merged = new Map<unknown, { e: Entry; biased: boolean }>()
    for (const { a, biased } of runs) {
      for (const e of a) {
        const key = e.id ?? `${e.trackName}|${e.artistName}|${e.duration}`
        const prev = merged.get(key)
        if (!prev) merged.set(key, { e, biased })
        else if (biased) prev.biased = true
      }
    }
    const scored = [...merged.values()]
      .filter(c => (c.e.syncedLyrics || c.e.plainLyrics))
      .filter(c => {
        const tn = norm(c.e.trackName ?? '')
        return tn === titleN || tn.includes(titleN) || titleN.includes(tn)
      })
      .map(c => ({
        entry: c.e,
        level: artistMatchLevel(artistsN, norm(c.e.artistName ?? '')),
        titleExact: norm(c.e.trackName ?? '') === titleN,
        durDiff: Math.abs((c.e.duration ?? 0) - dur),
        biased: c.biased,
      }))
      .filter(c =>
        (c.level >= 1 && c.durDiff <= MAX_DUR_DIFF) ||
        (c.biased && c.titleExact && c.durDiff <= DUR_TIGHT))
      .sort((a, b) => (b.level - a.level) || (a.durDiff - b.durDiff))
    return scored[0]?.entry ?? null
  }

  let best = await pickBest()

  // On a miss, probe the uploader once: searching their name alone surfaces their
  // catalogue, whose LRCLIB credits list collaborators (ARLEKIN 40 000 → DATA404).
  // Learn those aliases and retry. No dependence on having played a sibling track.
  if (!best && !probedUploaders.has(uploaderKey)) {
    probedUploaders.add(uploaderKey)
    const probeArtist = primaryArtistForSearch(username)
    if (probeArtist) {
      const before = uploaderAliases.get(uploaderKey)?.size ?? 0
      for (const e of await searchGet({ q: probeArtist })) learnAliases(uploaderKey, artists, e.artistName ?? '')
      if ((uploaderAliases.get(uploaderKey)?.size ?? 0) > before) best = await pickBest()
    }
  }

  if (best) {
    learnAliases(uploaderKey, artists, best.artistName ?? '')
    if (best.syncedLyrics) return { synced: parseLRC(best.syncedLyrics), plain: best.plainLyrics ?? null }
    if (best.plainLyrics) return { synced: null, plain: best.plainLyrics }
  }

  return null
}
