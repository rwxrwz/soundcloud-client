// Lightweight hover-preview engine for the home page.
//
// Deliberately separate from useAudio: it must NOT touch the main player's
// AudioContext, EQ chain, analyser/audioBus or the now-playing queue. It owns a
// bare <audio> element and only ever fades a short preview in/out.
//
// Races are guarded with a monotonically increasing `token`: every new hover (or
// stop) bumps it, so any in-flight resolve/play from a previous hover bails out.

import { create } from 'zustand'
import { usePlayer, useSettings } from '../store'
import { sc, SCTrack, SCPlaylist } from '../services/soundcloud'
import { playlistCache } from '../services/playlistCache'

interface PreviewState {
  key: number | null   // tile key currently loading/playing (playlist id or track id)
  title: string | null // resolved track title, shown in the tile's preview plate
  loading: boolean
}

// A store so tiles can reactively show their own "previewing" plate.
export const usePreview = create<PreviewState>(() => ({ key: null, title: null, loading: false }))

let el: HTMLAudioElement | null = null
let token = 0
let raf = 0

function audio(): HTMLAudioElement {
  if (!el) { el = new Audio(); el.preload = 'none' }
  return el
}

function fade(target: number, ms: number, done?: () => void) {
  cancelAnimationFrame(raf)
  const a = audio()
  const from = a.volume
  const start = performance.now()
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / ms)
    a.volume = from + (target - from) * p
    if (p < 1) raf = requestAnimationFrame(step)
    else done?.()
  }
  raf = requestAnimationFrame(step)
}

// Reserve a hover slot. Returns false (and does nothing) when preview is off or
// the main player is actively playing — we never talk over real playback.
function claim(key: number): number | null {
  if (!useSettings.getState().hoverPreview) return null
  if (usePlayer.getState().isPlaying) return null
  token++
  usePreview.setState({ key, title: null, loading: true })
  return token
}

async function begin(my: number, key: number, title: string, url: string) {
  if (my !== token) return
  const a = audio()
  a.src = url
  a.volume = 0
  try { await a.play() } catch { return }
  if (my !== token) { a.pause(); return }
  usePreview.setState({ key, title, loading: false })
  fade(usePlayer.getState().volume * 0.7, 260)
}

// Resolve the first playable stream in a list (skips DRM/no-stream tracks).
async function firstPlayable(tracks: SCTrack[]): Promise<{ url: string; track: SCTrack } | null> {
  for (const tr of tracks.slice(0, 4)) {
    try { return { url: await sc.getStreamUrl(tr), track: tr } } catch { /* try next */ }
  }
  return null
}

async function tracksOf(pl: SCPlaylist): Promise<SCTrack[]> {
  const cached = playlistCache.get(pl.id)
  if (cached?.length) return cached
  if (pl.tracks?.length) return pl.tracks
  try {
    const full = await sc.getPlaylist(pl.id)
    const hydrated = await sc.hydratePlaylistTracks(full.tracks ?? [])
    playlistCache.set(pl.id, hydrated)
    return hydrated
  } catch { return [] }
}

export const preview = {
  async track(key: number, track: SCTrack) {
    const my = claim(key)
    if (my === null) return
    try {
      const url = await sc.getStreamUrl(track)
      await begin(my, key, track.title, url)
    } catch {
      if (my === token) usePreview.setState({ key: null, title: null, loading: false })
    }
  },

  async playlist(key: number, pl: SCPlaylist) {
    const my = claim(key)
    if (my === null) return
    const tracks = await tracksOf(pl)
    if (my !== token) return
    const res = await firstPlayable(tracks)
    if (my !== token) return
    if (res) await begin(my, key, res.track.title, res.url)
    else usePreview.setState({ key: null, title: null, loading: false })
  },

  stop() {
    token++
    usePreview.setState({ key: null, title: null, loading: false })
    if (el) fade(0, 200, () => el?.pause())
  },
}
