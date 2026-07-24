// Update check against the project's GitHub releases. The main process does the
// actual fetch (no CORS, cached); this module holds the version math and pushes
// results into the useUpdate store.
import { useUpdate } from '../store'

export interface Release {
  tag: string
  name: string
  body: string
  date: string
  url: string
  prerelease: boolean
}

// Numeric semver compare of a vs b (ignores a leading "v" and any -prerelease
// suffix). >0 if a>b, <0 if a<b, 0 if equal.
export function cmpVersion(a: string, b: string): number {
  const parse = (s: string) => (s || '').replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

// Highest stable (non-prerelease) release, or null.
export function latestStable(releases: Release[]): Release | null {
  const stable = releases.filter(r => !r.prerelease && r.tag)
  if (!stable.length) return null
  return stable.reduce((best, r) => (cmpVersion(r.tag, best.tag) > 0 ? r : best))
}

// The release the user should be nudged to, or null: newest stable strictly above
// the installed version, and not the one they already dismissed.
export function pendingUpdate(current: string, releases: Release[], dismissed: string | null): Release | null {
  if (!current) return null
  const latest = latestStable(releases)
  if (!latest || cmpVersion(latest.tag, current) <= 0) return null
  if (dismissed && cmpVersion(latest.tag, dismissed) <= 0) return null
  return latest
}

// Fetch installed version + releases from the main process and store them.
// `force` bypasses the main-process cache (used by the manual "Check" button).
export async function checkForUpdates(force = false): Promise<void> {
  const api = window.electronAPI
  if (!api?.getReleases || !api?.getAppVersion) return
  try {
    const [current, releases] = await Promise.all([api.getAppVersion(), api.getReleases(force)])
    useUpdate.getState().setData(current, releases)
  } catch { /* offline / rate-limited — keep prior state */ }
}
