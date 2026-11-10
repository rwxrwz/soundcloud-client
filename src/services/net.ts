// One place that decides how an HTTP request leaves the app.
//
// The renderer fetches cross-origin directly and the main process patches the
// CORS headers back in, so these are thin wrappers - their value is that every
// outbound call has a single chokepoint to change.

function withParams(url: string, params?: Record<string, unknown>): string {
  if (!params) return url
  const u = new URL(url)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
  }
  return u.toString()
}

/* The one thing a single chokepoint exists to impose.
 *
 * axios defaults to waiting forever and a bare fetch has no signal, so a
 * half-open socket stalled whatever was behind it with nothing to report:
 * a page spinning on a SoundCloud call, or one of the four concurrent
 * LRCLIB workers frozen for the rest of a scan. Fifteen seconds is well
 * past any healthy answer from either host. */
const TIMEOUT_MS = 15_000

/* Thrown on any status outside 2xx.
 *
 * The shape is deliberate: `response.status` is what axios put on its
 * errors, and callers read it to tell "the host answered no" from "the host
 * did not answer" - resolveTranscoding does exactly that to decide whether a
 * stream variant is worth retrying. Keeping the shape meant axios could go
 * without touching any of them. */
export class HttpError extends Error {
  readonly response: { status: number }
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.response = { status }
  }
}

/* axios was here for this one call, and the function below it already did
   the same job with fetch - 43KB of bundle, and a library that tree-shakes
   its adapters and interceptors along with it, for a GET with query
   parameters and a timeout. */
export async function netGetJson<T>(
  url: string,
  opts: { params?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Promise<T> {
  const full = withParams(url, opts.params)
  const res = await fetch(full, { headers: opts.headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new HttpError(res.status, full)
  return await res.json() as T
}

/* Bytes, with a budget of their own.
 *
 * Audio is not JSON: a track can be tens of megabytes on a slow link, so
 * the fifteen seconds above would cut off healthy downloads. Two minutes
 * is past any of them and still finite, which is the whole point - the AI
 * lyrics path used a bare fetch here, and a half-open socket left the
 * visible stage reading "download" for the rest of the session with no
 * error raised and no way back. */
const BYTES_TIMEOUT_MS = 120_000

export async function netGetBytes(url: string, timeoutMs = BYTES_TIMEOUT_MS): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new HttpError(res.status, url)
  return await res.arrayBuffer()
}

export async function netGetText(url: string, headers?: Record<string, string>): Promise<string | null> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  return res.ok ? res.text() : null
}

/** Wallpapers live in userData/wallpapers and are served by main over the
 *  scwall:// scheme it registers (electron/main.ts), not from disk - a file://
 *  path would be blocked by the renderer. */
export function wallpaperUrl(fileName: string): string {
  return `scwall://media/${encodeURIComponent(fileName)}`
}

/* A theme's own wallpaper ships inside the app instead of living in the
   user's wallpapers folder, so the two have to be told apart: anything a
   theme set carries this marker and is already a usable URL (the bundler
   rewrote the import), while a user's pick is an absolute path on disk that
   only scwall:// can reach. The marker also keeps the picker honest - a
   bundled wallpaper matches none of its cards, which is the truth. */
export const BUNDLED_WALLPAPER = 'bundled:'

export function wallpaperSrc(path: string): string {
  return path.startsWith(BUNDLED_WALLPAPER)
    ? path.slice(BUNDLED_WALLPAPER.length)
    : wallpaperUrl(path.split(/[\\/]/).pop() || '')
}
