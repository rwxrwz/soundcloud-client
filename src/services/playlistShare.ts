// Compact, copy-pasteable share code for a playlist: name + track IDs.
// Format: "MZP1:" + base64(JSON.stringify({ n: name, t: [ids] }))
const PREFIX = 'MZP1:'
/* A ceiling on what one pasted code may ask the player to fetch.
   A code comes from somebody else, and nothing in the format bounds the id
   list: `getTracksByIds` walks it fifty at a time, awaiting each batch, so a
   few megabytes of ids became thousands of sequential api-v2 requests
   carrying the person's own token - the import modal wedged, and SoundCloud
   watching a burst from that account. Five thousand is past any real
   playlist and far short of that. A longer list is cut, not refused: the
   tracks that do come back are the ones the sender meant. */
const MAX_IDS = 5000

export function encodePlaylist(name: string, trackIds: number[]): string {
  const json = JSON.stringify({ n: name, t: trackIds })
  return PREFIX + btoa(unescape(encodeURIComponent(json)))
}

export function decodePlaylistCode(code: string): { name: string; ids: number[] } | null {
  const trimmed = code.trim()
  if (!trimmed.startsWith(PREFIX)) return null
  try {
    const json = decodeURIComponent(escape(atob(trimmed.slice(PREFIX.length))))
    const obj = JSON.parse(json)
    if (Array.isArray(obj.t)) {
      const ids = obj.t.slice(0, MAX_IDS).map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0)
      return { name: String(obj.n || 'Imported').slice(0, 100), ids }
    }
  } catch { /* invalid */ }
  return null
}

export function looksLikeScUrl(s: string): boolean {
  return /soundcloud\.com/i.test(s.trim())
}

// Human-readable tracklist that's still precisely re-importable: each line is
// "N. Artist - Title  [sc:ID]". The [sc:ID] token is what import keys off, so the
// readable part can be edited freely without breaking re-import.
type TrackLite = { id: number; title?: string; user?: { username?: string } }

export function encodePlaylistText(name: string, tracks: TrackLite[]): string {
  const lines = tracks
    .filter(t => t.id)
    .map((t, i) => `${i + 1}. ${t.user?.username ?? '-'} - ${t.title ?? ''}  [sc:${t.id}]`)
  return `# ${name}\n${lines.join('\n')}`
}

// Pull ordered track IDs out of an exported tracklist. Returns null if no
// [sc:ID] tokens are present (i.e. it's not our text format).
export function parsePlaylistText(text: string): { name: string; ids: number[] } | null {
  const ids: number[] = []
  const re = /\[sc:(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && ids.length < MAX_IDS) ids.push(Number(m[1]))
  if (!ids.length) return null
  // Title = first non-empty line that isn't itself a track line
  const titleLine = text.split('\n').map(l => l.trim()).find(l => l && !/\[sc:\d+\]/.test(l))
  const name = (titleLine ? titleLine.replace(/^#\s*/, '') : 'Imported').slice(0, 100)
  return { name, ids }
}
