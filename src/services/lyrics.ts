// Synced lyrics via LRCLIB (https://lrclib.net) — free, no API key.

export interface LyricLine { time: number; text: string }
export interface LyricsResult {
  synced: LyricLine[] | null   // timestamped lines (preferred)
  plain: string | null         // fallback plain text
}

// Strip common SoundCloud title noise to improve matching
function cleanTitle(title: string): string {
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

// Max allowed difference between SoundCloud track length and the LRCLIB entry.
// A correct match is the same recording, so its duration is nearly identical.
const DUR_TOLERANCE = 6 // seconds

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// "Artist - Title" → { artist, title }. SoundCloud titles often embed the artist.
function splitArtistTitle(raw: string): { artist?: string; title: string } {
  const m = raw.match(/^\s*(.+?)\s+[-–—]\s+(.+)$/)
  if (m) return { artist: m[1].trim(), title: m[2].trim() }
  return { title: raw }
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

  // 2) Search by title, but ACCEPT only candidates whose duration is within
  //    tolerance AND whose title actually matches — otherwise return nothing
  //    (better no lyrics than wrong lyrics).
  try {
    const res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: title }).toString()}`)
    if (res.ok) {
      const arr = await res.json() as Array<{ trackName?: string; artistName?: string; syncedLyrics?: string; plainLyrics?: string; duration?: number }>
      if (Array.isArray(arr) && arr.length) {
        const artistsN = artists.map(norm).filter(Boolean)
        const candidates = arr
          .filter(x => (x.syncedLyrics || x.plainLyrics))
          .filter(x => Math.abs((x.duration ?? 0) - dur) <= DUR_TOLERANCE)
          .filter(x => {
            const tn = norm(x.trackName ?? '')
            return tn === titleN || tn.includes(titleN) || titleN.includes(tn)
          })
          // Verify the artist too — kills "same title, different artist" matches
          .filter(x => {
            const an = norm(x.artistName ?? '')
            if (!an || !artistsN.length) return false
            return artistsN.some(a => a === an || an.includes(a) || a.includes(an))
          })
          .sort((a, b) => Math.abs((a.duration ?? 0) - dur) - Math.abs((b.duration ?? 0) - dur))
        const best = candidates[0]
        if (best?.syncedLyrics) return { synced: parseLRC(best.syncedLyrics), plain: best.plainLyrics ?? null }
        if (best?.plainLyrics) return { synced: null, plain: best.plainLyrics }
      }
    }
  } catch {}

  return null
}
