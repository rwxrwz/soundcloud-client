import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SCTrack, SCUser, SCPlaylist } from '../services/soundcloud'

interface PlayerState {
  currentTrack: SCTrack | null
  queue: SCTrack[]
  queueIndex: number
  isPlaying: boolean
  volume: number
  progress: number
  duration: number
  shuffle: boolean
  repeat: 'none' | 'one' | 'all'
  setTrack: (track: SCTrack, queue?: SCTrack[]) => void
  setPlaying: (v: boolean) => void
  setVolume: (v: number) => void
  setProgress: (v: number) => void
  setDuration: (v: number) => void
  nextTrack: () => void
  prevTrack: () => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  removeFromQueue: (index: number) => void
  moveInQueue: (from: number, to: number) => void
  seekTo: (time: number) => void
  seekRequest: number | null
  playbackError: string | null
}

interface ProfileState {
  user: SCUser | null
  clientId: string
  oauthToken: string
  likes: SCTrack[]
  playlists: SCPlaylist[]
  stream: SCTrack[]
  releases: SCTrack[]
  followingIds: number[]
  setAuth: (clientId: string, token: string, user: SCUser) => void
  setLikes: (tracks: SCTrack[]) => void
  setPlaylists: (pl: SCPlaylist[]) => void
  setStream: (tracks: SCTrack[]) => void
  setReleases: (tracks: SCTrack[]) => void
  setFollowingIds: (ids: number[]) => void
  followOptimistic: (id: number) => void
  unfollowOptimistic: (id: number) => void
  logout: () => void
  likeTrackOptimistic: (track: SCTrack) => void
  unlikeTrackOptimistic: (trackId: number) => void
  updatePlaylistTracks: (playlistId: number, tracks: SCTrack[]) => void
}

interface UIState {
  page: 'stream' | 'releases' | 'likes' | 'playlists' | 'search' | 'playlist-detail'
  playlistsSubPage: 'playlists' | 'playlist-detail'
  selectedPlaylist: SCPlaylist | null
  searchQuery: string
  searchResults: SCTrack[]
  bgColor: string
  artRgb: [number, number, number]
  trackOrder: 'newest' | 'oldest'
  showTrackPage: boolean
  showQueue: boolean
  artistPageUser: SCUser | null
  playlistPickerTrack: SCTrack | null
  setPlaylistPickerTrack: (track: SCTrack | null) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  contextMenu: { x: number; y: number; track: SCTrack } | null
  setContextMenu: (m: { x: number; y: number; track: SCTrack } | null) => void
  showFullscreen: boolean
  setShowFullscreen: (v: boolean) => void
  setPage: (p: UIState['page']) => void
  setSelectedPlaylist: (pl: SCPlaylist) => void
  goToPlaylists: () => void
  backFromPlaylist: () => void
  setSearch: (q: string) => void
  setSearchResults: (tracks: SCTrack[]) => void
  setBgColor: (c: string) => void
  setArtRgb: (rgb: [number, number, number]) => void
  setTrackOrder: (o: 'newest' | 'oldest') => void
  setShowTrackPage: (v: boolean) => void
  setShowQueue: (v: boolean) => void
  setArtistPage: (user: SCUser | null) => void
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
  currentTrack: null,
  queue: [],
  queueIndex: 0,
  isPlaying: false,
  volume: 0.8,
  progress: 0,
  duration: 0,
  shuffle: false,
  repeat: 'none',
  seekRequest: null,
  playbackError: null,

  setTrack: (track, queue) => {
    const q = queue ?? get().queue
    const idx = q.findIndex(t => t.id === track.id)
    set({ currentTrack: track, queue: q, queueIndex: idx >= 0 ? idx : 0, isPlaying: true, progress: 0 })
  },

  setPlaying: (v) => set({ isPlaying: v }),
  setVolume: (v) => set({ volume: v }),
  setProgress: (v) => set({ progress: v }),
  setDuration: (v) => set({ duration: v }),

  nextTrack: () => {
    const { queue, queueIndex, shuffle, repeat } = get()
    if (!queue.length) return
    let next: number
    if (shuffle) {
      next = Math.floor(Math.random() * queue.length)
    } else if (repeat === 'all') {
      next = (queueIndex + 1) % queue.length
    } else {
      next = Math.min(queueIndex + 1, queue.length - 1)
    }
    set({ currentTrack: queue[next], queueIndex: next, isPlaying: true, progress: 0 })
  },

  prevTrack: () => {
    const { queue, queueIndex, progress } = get()
    if (progress > 3) {
      set({ seekRequest: 0, progress: 0 })
      return
    }
    const prev = Math.max(queueIndex - 1, 0)
    set({ currentTrack: queue[prev], queueIndex: prev, isPlaying: true, progress: 0 })
  },

  toggleShuffle: () => set(s => ({ shuffle: !s.shuffle })),
  toggleRepeat: () => set(s => ({
    repeat: s.repeat === 'none' ? 'all' : s.repeat === 'all' ? 'one' : 'none'
  })),

  removeFromQueue: (index) => set(s => {
    const queue = s.queue.filter((_, i) => i !== index)
    const queueIndex = index < s.queueIndex ? s.queueIndex - 1 : s.queueIndex
    return { queue, queueIndex }
  }),

  moveInQueue: (from, to) => set(s => {
    if (from === to) return s
    const queue = [...s.queue]
    const [item] = queue.splice(from, 1)
    queue.splice(to, 0, item)
    let qi = s.queueIndex
    if (from === qi) qi = to
    else if (from < qi && to >= qi) qi--
    else if (from > qi && to <= qi) qi++
    return { queue, queueIndex: qi }
  }),

  seekTo: (time) => set({ seekRequest: time }),
    }),
    {
      name: 'sc-player',
      partialize: (s) => ({ volume: s.volume, shuffle: s.shuffle, repeat: s.repeat }),
    }
  )
)

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      user: null,
      clientId: '',
      oauthToken: '',
      likes: [],
      playlists: [],
      stream: [],
      releases: [],
      followingIds: [],
      setAuth: (clientId, oauthToken, user) => set({ clientId, oauthToken, user }),
      setLikes: (likes) => set({ likes }),
      setPlaylists: (playlists) => set({ playlists }),
      setStream: (stream) => set({ stream }),
      setReleases: (releases) => set({ releases }),
      setFollowingIds: (followingIds) => set({ followingIds }),
      followOptimistic: (id) => set(s => (s.followingIds.includes(id) ? s : { followingIds: [...s.followingIds, id] })),
      unfollowOptimistic: (id) => set(s => ({ followingIds: s.followingIds.filter(x => x !== id) })),
      logout: () => set({ user: null, clientId: '', oauthToken: '', likes: [], playlists: [], stream: [], releases: [], followingIds: [] }),
      likeTrackOptimistic: (track) => set(s => ({ likes: [track, ...s.likes] })),
      unlikeTrackOptimistic: (trackId) => set(s => ({ likes: s.likes.filter(t => t.id !== trackId) })),
      updatePlaylistTracks: (playlistId, tracks) => set(s => ({
        playlists: s.playlists.map(pl =>
          pl.id === playlistId ? { ...pl, tracks, track_count: tracks.length } : pl
        )
      })),
    }),
    {
      name: 'sc-profile',
      // Don't persist `releases` — refetch a fresh feed each session
      partialize: (s) => ({
        user: s.user, clientId: s.clientId, oauthToken: s.oauthToken,
        likes: s.likes, playlists: s.playlists, stream: s.stream,
        followingIds: s.followingIds,
      }),
    }
  )
)

export type AccentColor = 'orange' | 'blue' | 'green' | 'pink' | 'purple' | 'red' | 'cyan' | 'yellow' | 'white' | 'indigo' | 'slate' | 'artwork'
export type BgStyle = 'artwork' | 'accent' | 'dark' | 'midnight' | 'aurora'
export type VisualizerStyle = 'bars' | 'wave' | 'mirror'
export type Lang = 'ru' | 'en'

// 5-band EQ centre frequencies (Hz)
export const EQ_BANDS = [60, 250, 1000, 4000, 12000]

interface SettingsState {
  accent: AccentColor
  bgStyle: BgStyle
  visualizerStyle: VisualizerStyle
  lang: Lang
  eq: number[]        // gain in dB per band, length 5
  eqEnabled: boolean
  discordRpc: boolean
  lyricsOpen: boolean
  setAccent: (a: AccentColor) => void
  setBgStyle: (b: BgStyle) => void
  setVisualizerStyle: (v: VisualizerStyle) => void
  setLang: (l: Lang) => void
  setEqBand: (index: number, gain: number) => void
  setEqEnabled: (v: boolean) => void
  resetEq: () => void
  setDiscordRpc: (v: boolean) => void
  setLyricsOpen: (v: boolean) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      accent: 'slate',
      bgStyle: 'artwork',
      visualizerStyle: 'bars',
      lang: 'ru',
      eq: [0, 0, 0, 0, 0],
      eqEnabled: false,
      discordRpc: false,
      lyricsOpen: false,
      setAccent: (accent) => set({ accent }),
      setBgStyle: (bgStyle) => set({ bgStyle }),
      setVisualizerStyle: (visualizerStyle) => set({ visualizerStyle }),
      setLang: (lang) => set({ lang }),
      setEqBand: (index, gain) => set(s => {
        const eq = [...s.eq]; eq[index] = gain; return { eq }
      }),
      setEqEnabled: (eqEnabled) => set({ eqEnabled }),
      resetEq: () => set({ eq: [0, 0, 0, 0, 0] }),
      setDiscordRpc: (discordRpc) => set({ discordRpc }),
      setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
    }),
    {
      name: 'sc-settings',
      onRehydrateStorage: () => (state) => {
        if (state && !['bars', 'wave', 'mirror'].includes(state.visualizerStyle)) {
          state.visualizerStyle = 'bars'
        }
        // Ensure eq array exists with 5 bands (older persisted state)
        if (state && (!Array.isArray(state.eq) || state.eq.length !== 5)) {
          state.eq = [0, 0, 0, 0, 0]
        }
      },
    }
  )
)

export const ACCENT_COLORS: Record<AccentColor, string> = {
  orange: '#ff5500',
  red:    '#ef4444',
  pink:   '#ec4899',
  purple: '#a855f7',
  indigo: '#6366f1',
  blue:   '#3b82f6',
  cyan:   '#06b6d4',
  green:  '#22c55e',
  yellow: '#eab308',
  white:  '#e2e2e2',
  slate:  '#696C85',
}

// Resolves the current accent color, handling the dynamic 'artwork' option.
export function useAccentHex(): string {
  const accent = useSettings(s => s.accent)
  const artRgb = useUI(s => s.artRgb)
  if (accent === 'artwork') {
    return `#${artRgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
  }
  return ACCENT_COLORS[accent] ?? ACCENT_COLORS.orange
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      page: 'stream',
      playlistsSubPage: 'playlists',
      selectedPlaylist: null,
      searchQuery: '',
      searchResults: [],
      bgColor: '#080808',
      artRgb: [80, 80, 80] as [number, number, number],
      trackOrder: 'newest',
      showTrackPage: false,
      showQueue: false,
      artistPageUser: null,
      playlistPickerTrack: null,
      setPlaylistPickerTrack: (playlistPickerTrack) => set({ playlistPickerTrack }),
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),
      contextMenu: null,
      setContextMenu: (contextMenu) => set({ contextMenu }),
      showFullscreen: false,
      setShowFullscreen: (showFullscreen) => set({ showFullscreen }),
      setPage: (page) => set({ page }),
      setSelectedPlaylist: (pl) => set({ selectedPlaylist: pl, page: 'playlist-detail', playlistsSubPage: 'playlist-detail' }),
      goToPlaylists: () => set(s => ({ page: s.playlistsSubPage })),
      backFromPlaylist: () => set({ page: 'playlists', playlistsSubPage: 'playlists' }),
      setSearch: (q) => set({ searchQuery: q }),
      setSearchResults: (tracks) => set({ searchResults: tracks }),
      setBgColor: (c) => set({ bgColor: c }),
      setArtRgb: (artRgb) => set({ artRgb }),
      setTrackOrder: (trackOrder) => set({ trackOrder }),
      setShowTrackPage: (showTrackPage) => set({ showTrackPage }),
      setShowQueue: (showQueue) => set({ showQueue }),
      setArtistPage: (artistPageUser) => set({ artistPageUser }),
    }),
    {
      name: 'sc-ui',
      partialize: (s) => ({
        trackOrder: s.trackOrder,
        playlistsSubPage: s.playlistsSubPage,
        selectedPlaylist: s.selectedPlaylist
      })
    }
  )
)

// ── Toast ──────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastState {
  toasts: Toast[]
  show: (message: string, type?: ToastType) => void
  dismiss: (id: number) => void
}

// ── Lyrics availability (powers the "L" badge) ──────────────────────────────
interface LyricsState {
  available: Record<number, boolean>
  mark: (trackId: number, has: boolean) => void
}
export const useLyrics = create<LyricsState>()(
  persist(
    (set) => ({
      available: {},
      mark: (trackId, has) => set(s => (s.available[trackId] === has ? s : { available: { ...s.available, [trackId]: has } })),
    }),
    {
      name: 'sc-lyrics',
      version: 4, // bumped to drop stale availability after matching changes
      migrate: () => ({ available: {} }),
      partialize: (s) => ({ available: s.available }),
    }
  )
)

let _toastId = 0

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  show: (message, type = 'info') => {
    const id = ++_toastId
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3000)
  },
  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
