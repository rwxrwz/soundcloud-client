import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SCTrack, SCUser, SCPlaylist } from '../services/soundcloud'

interface PlayerState {
  currentTrack: SCTrack | null
  queue: SCTrack[]
  queueIndex: number
  history: number[]   // stack of visited queue indices, for "previous" with shuffle
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
  clearQueue: () => void
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
  localPlaylists: SCPlaylist[]
  addLocalPlaylist: (title: string, tracks: SCTrack[]) => SCPlaylist
  removeLocalPlaylist: (id: number) => void
  renameLocalPlaylist: (id: number, title: string) => void
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
  page: 'main' | 'stream' | 'releases' | 'likes' | 'playlists' | 'search' | 'playlist-detail'
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
  playlistMenu: { x: number; y: number; playlist: SCPlaylist } | null
  setPlaylistMenu: (m: { x: number; y: number; playlist: SCPlaylist } | null) => void
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
  history: [],
  isPlaying: false,
  volume: 0.8,
  progress: 0,
  duration: 0,
  shuffle: false,
  repeat: 'none',
  seekRequest: null,
  playbackError: null,

  setTrack: (track, queue) => {
    const s = get()
    const q = queue ?? s.queue
    const idx = q.findIndex(t => t.id === track.id)
    // Jumping within the same queue (e.g. the queue flyout) records history so
    // "previous" can return here; a brand-new queue starts a fresh history.
    const sameQueue = q === s.queue
    const history = (sameQueue && s.currentTrack && s.queueIndex >= 0)
      ? [...s.history, s.queueIndex].slice(-100)
      : []
    set({ currentTrack: track, queue: q, queueIndex: idx >= 0 ? idx : 0, history, isPlaying: true, progress: 0 })
  },

  setPlaying: (v) => set({ isPlaying: v }),
  setVolume: (v) => set({ volume: v }),
  setProgress: (v) => set({ progress: v }),
  setDuration: (v) => set({ duration: v }),

  nextTrack: () => {
    const { queue, queueIndex, shuffle, repeat, history } = get()
    if (!queue.length) return
    let next: number
    if (shuffle) {
      // pick a random track, avoiding an immediate repeat of the current one
      if (queue.length === 1) next = 0
      else { do { next = Math.floor(Math.random() * queue.length) } while (next === queueIndex) }
    } else if (repeat === 'all') {
      next = (queueIndex + 1) % queue.length
    } else {
      next = Math.min(queueIndex + 1, queue.length - 1)
    }
    set({ currentTrack: queue[next], queueIndex: next, history: [...history, queueIndex].slice(-100), isPlaying: true, progress: 0 })
  },

  prevTrack: () => {
    const { queue, queueIndex, progress, history } = get()
    if (progress > 3) {
      set({ seekRequest: 0, progress: 0 })
      return
    }
    // Step back through the actual play history (correct with shuffle); fall back
    // to the sequential previous track when there's no history.
    if (history.length > 0) {
      const h = [...history]
      let prev = h.pop()!
      if (prev < 0 || prev >= queue.length) prev = Math.max(queueIndex - 1, 0)
      set({ currentTrack: queue[prev], queueIndex: prev, history: h, isPlaying: true, progress: 0 })
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
    return { queue, queueIndex, history: [] }
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
    return { queue, queueIndex: qi, history: [] }
  }),

  // Clear the queue but keep the current track playing
  clearQueue: () => set(s => (s.currentTrack
    ? { queue: [s.currentTrack], queueIndex: 0, history: [] }
    : { queue: [], queueIndex: 0, history: [] })),

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
    (set, get) => ({
      user: null,
      clientId: '',
      oauthToken: '',
      likes: [],
      playlists: [],
      stream: [],
      releases: [],
      followingIds: [],
      localPlaylists: [],
      addLocalPlaylist: (title, tracks) => {
        const pl: SCPlaylist = {
          id: -Date.now(), title, artwork_url: tracks[0]?.artwork_url ?? null,
          user: get().user ?? ({} as SCUser), tracks, track_count: tracks.length,
          duration: 0, permalink_url: '',
        }
        set(s => ({ localPlaylists: [pl, ...s.localPlaylists] }))
        return pl
      },
      removeLocalPlaylist: (id) => set(s => ({ localPlaylists: s.localPlaylists.filter(p => p.id !== id) })),
      renameLocalPlaylist: (id, title) => set(s => ({ localPlaylists: s.localPlaylists.map(p => p.id === id ? { ...p, title } : p) })),
      setAuth: (clientId, oauthToken, user) => set({ clientId, oauthToken, user }),
      setLikes: (likes) => set({ likes }),
      setPlaylists: (playlists) => set({ playlists }),
      setStream: (stream) => set({ stream }),
      setReleases: (releases) => set({ releases }),
      setFollowingIds: (followingIds) => set({ followingIds }),
      followOptimistic: (id) => set(s => (s.followingIds.includes(id) ? s : { followingIds: [...s.followingIds, id] })),
      unfollowOptimistic: (id) => set(s => ({ followingIds: s.followingIds.filter(x => x !== id) })),
      logout: () => {
        try { window.electronAPI?.secureSetToken?.('') } catch { /* ignore */ }
        set({ user: null, clientId: '', oauthToken: '', likes: [], playlists: [], stream: [], releases: [], followingIds: [], localPlaylists: [] })
      },
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
      // Don't persist `releases` — refetch a fresh feed each session.
      // `oauthToken` is intentionally excluded: it lives in the OS keychain
      // (secure-set-token) and is rehydrated into memory on startup.
      partialize: (s) => ({
        user: s.user, clientId: s.clientId,
        likes: s.likes, playlists: s.playlists, stream: s.stream,
        followingIds: s.followingIds, localPlaylists: s.localPlaylists,
      }),
    }
  )
)

export type AccentColor = 'orange' | 'blue' | 'green' | 'pink' | 'purple' | 'red' | 'cyan' | 'yellow' | 'white' | 'indigo' | 'slate' | 'mauve' | 'artwork'
export type BgStyle = 'artwork' | 'accent' | 'dark' | 'midnight' | 'aurora' | 'wallpaper'
export type VisualizerStyle = 'bars' | 'wave' | 'mirror'
export type HeroAnim = 'wave' | 'threads' | 'silk' | 'mist' | 'weave' | 'spectrum'
export type Theme = 'default' | 'glass' | 'minimal'
export type PlayerStyle = 'default' | 'fullscreen'
export type FsLayout = 'side' | 'stack' | 'split'
export type Lang = 'ru' | 'en'
export type StartPage = 'main' | 'stream' | 'releases' | 'likes' | 'playlists'

// 5-band EQ centre frequencies (Hz)
export const EQ_BANDS = [60, 250, 1000, 4000, 12000]

interface SettingsState {
  accent: AccentColor
  bgStyle: BgStyle
  visualizerStyle: VisualizerStyle
  heroAnim: HeroAnim
  theme: Theme
  playerStyle: PlayerStyle
  fsLayout: FsLayout
  fsShowLyrics: boolean    // show the lyrics panel in the fullscreen style
  fsLiveBg: boolean        // living artwork background in the fullscreen style
  fsBeatGlow: boolean      // beat-reactive glow on the artwork
  fsArtCrossfade: boolean  // crossfade artwork on track change
  lyricsFontScale: number  // lyrics font multiplier (1 = default)
  wallpaperPath: string
  lang: Lang
  eq: number[]        // gain in dB per band, length 5
  eqEnabled: boolean
  outputDeviceId: string   // '' = system default
  hoverPreview: boolean    // softly preview the track under the cursor on the home page
  discordRpc: boolean
  lyricsOpen: boolean
  crossfade: number        // crossfade between tracks, seconds (0 = off)
  startPage: StartPage      // page shown on app launch
  closeToTray: boolean     // close button hides to tray instead of quitting
  mediaKeys: boolean       // keyboard playback shortcuts enabled
  launchAtStartup: boolean // start the app on Windows login
  autoSkipDrm: boolean     // automatically skip DRM-protected tracks
  setAccent: (a: AccentColor) => void
  setBgStyle: (b: BgStyle) => void
  setVisualizerStyle: (v: VisualizerStyle) => void
  setHeroAnim: (h: HeroAnim) => void
  setTheme: (th: Theme) => void
  setPlayerStyle: (s: PlayerStyle) => void
  setFsLayout: (l: FsLayout) => void
  setFsShowLyrics: (v: boolean) => void
  setFsLiveBg: (v: boolean) => void
  setFsBeatGlow: (v: boolean) => void
  setFsArtCrossfade: (v: boolean) => void
  setLyricsFontScale: (v: number) => void
  setWallpaperPath: (p: string) => void
  setLang: (l: Lang) => void
  setEqBand: (index: number, gain: number) => void
  setEqEnabled: (v: boolean) => void
  resetEq: () => void
  setOutputDeviceId: (id: string) => void
  setHoverPreview: (v: boolean) => void
  setDiscordRpc: (v: boolean) => void
  setLyricsOpen: (v: boolean) => void
  setCrossfade: (v: number) => void
  setStartPage: (p: StartPage) => void
  setCloseToTray: (v: boolean) => void
  setMediaKeys: (v: boolean) => void
  setLaunchAtStartup: (v: boolean) => void
  setAutoSkipDrm: (v: boolean) => void
  resetSettings: () => void
  importSettings: (data: Partial<SettingsState>) => void
}

// Data-only defaults (no actions) — reused for "reset to defaults"
const SETTINGS_DEFAULTS = {
  accent: 'slate' as AccentColor,
  bgStyle: 'artwork' as BgStyle,
  visualizerStyle: 'bars' as VisualizerStyle,
  heroAnim: 'threads' as HeroAnim,
  theme: 'default' as Theme,
  playerStyle: 'default' as PlayerStyle,
  fsLayout: 'side' as FsLayout,
  fsShowLyrics: true,
  fsLiveBg: true,
  fsBeatGlow: true,
  fsArtCrossfade: true,
  lyricsFontScale: 1,
  wallpaperPath: '',
  lang: 'en' as Lang,
  eq: [0, 0, 0, 0, 0] as number[],
  eqEnabled: false,
  outputDeviceId: '',
  hoverPreview: true,
  discordRpc: false,
  lyricsOpen: false,
  crossfade: 0,
  startPage: 'main' as StartPage,
  closeToTray: true,
  mediaKeys: true,
  launchAtStartup: false,
  autoSkipDrm: false,
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      setAccent: (accent) => set({ accent }),
      setBgStyle: (bgStyle) => set({ bgStyle }),
      setVisualizerStyle: (visualizerStyle) => set({ visualizerStyle }),
      setHeroAnim: (heroAnim) => set({ heroAnim }),
      setTheme: (theme) => set({ theme }),
      setPlayerStyle: (playerStyle) => set({ playerStyle }),
      setFsLayout: (fsLayout) => set({ fsLayout }),
      setFsShowLyrics: (fsShowLyrics) => set({ fsShowLyrics }),
      setFsLiveBg: (fsLiveBg) => set({ fsLiveBg }),
      setFsBeatGlow: (fsBeatGlow) => set({ fsBeatGlow }),
      setFsArtCrossfade: (fsArtCrossfade) => set({ fsArtCrossfade }),
      setLyricsFontScale: (lyricsFontScale) => set({ lyricsFontScale }),
      setWallpaperPath: (wallpaperPath) => set({ wallpaperPath }),
      setLang: (lang) => set({ lang }),
      setEqBand: (index, gain) => set(s => {
        const eq = [...s.eq]; eq[index] = gain; return { eq }
      }),
      setEqEnabled: (eqEnabled) => set({ eqEnabled }),
      resetEq: () => set({ eq: [0, 0, 0, 0, 0] }),
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
      setHoverPreview: (hoverPreview) => set({ hoverPreview }),
      setDiscordRpc: (discordRpc) => set({ discordRpc }),
      setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
      setCrossfade: (crossfade) => set({ crossfade }),
      setStartPage: (startPage) => set({ startPage }),
      setCloseToTray: (closeToTray) => set({ closeToTray }),
      setMediaKeys: (mediaKeys) => set({ mediaKeys }),
      setLaunchAtStartup: (launchAtStartup) => set({ launchAtStartup }),
      setAutoSkipDrm: (autoSkipDrm) => set({ autoSkipDrm }),
      resetSettings: () => set({ ...SETTINGS_DEFAULTS }),
      // Validate untrusted imported JSON: only accept known keys with the right
      // type, clamp numeric ranges and reject invalid enum values, so a malformed
      // or hostile file can't poison the audio graph or blank out the UI.
      importSettings: (data) => set(() => {
        const out: Record<string, unknown> = {}
        const d = (data ?? {}) as Record<string, unknown>
        const ENUMS: Record<string, readonly string[]> = {
          startPage: ['main', 'stream', 'releases', 'likes', 'playlists'],
          playerStyle: ['default', 'fullscreen'],
          fsLayout: ['side', 'stack', 'split'],
          theme: ['default', 'glass', 'minimal'],
          bgStyle: ['artwork', 'accent', 'dark', 'midnight', 'aurora', 'wallpaper'],
          visualizerStyle: ['bars', 'wave', 'mirror'],
          heroAnim: ['wave', 'threads', 'silk', 'mist', 'weave', 'spectrum'],
          accent: [...Object.keys(ACCENT_COLORS), 'artwork'],
          lang: ['ru', 'en'],
        }
        for (const key of Object.keys(SETTINGS_DEFAULTS) as (keyof typeof SETTINGS_DEFAULTS)[]) {
          if (!(key in d)) continue
          // Never import a machine-specific local wallpaper path from a foreign file
          if (key === 'wallpaperPath') continue
          const val = d[key]
          const def = SETTINGS_DEFAULTS[key]
          if (val === undefined || val === null) continue
          if (key === 'eq') {
            if (Array.isArray(val) && val.length === 5 && val.every(n => typeof n === 'number' && isFinite(n))) {
              out.eq = (val as number[]).map(n => Math.max(-12, Math.min(12, n)))
            }
            continue
          }
          if (typeof val !== typeof def) continue
          if (key in ENUMS && !ENUMS[key].includes(val as string)) continue
          out[key] = val
        }
        if (typeof out.crossfade === 'number') out.crossfade = Math.max(0, Math.min(12, out.crossfade))
        if (typeof out.lyricsFontScale === 'number') out.lyricsFontScale = Math.max(0.7, Math.min(1.8, out.lyricsFontScale))
        return out as Partial<SettingsState>
      }),
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
        // Default hero animation for older persisted state
        if (state && !['wave', 'threads', 'silk', 'mist', 'weave', 'spectrum'].includes(state.heroAnim)) {
          state.heroAnim = 'wave'
        }
        // Default theme for older persisted state
        if (state && !['default', 'glass', 'minimal'].includes(state.theme)) {
          state.theme = 'default'
        }
        if (state && !['default', 'fullscreen'].includes(state.playerStyle)) {
          state.playerStyle = 'default'
        }
        if (state && !['side', 'stack', 'split'].includes(state.fsLayout)) {
          state.fsLayout = 'side'
        }
        if (state && (typeof state.lyricsFontScale !== 'number' || !(state.lyricsFontScale >= 0.7 && state.lyricsFontScale <= 1.8))) {
          state.lyricsFontScale = 1
        }
      },
    }
  )
)

// 'artwork' is a dynamic colour derived from the current artwork — no fixed hex
export const ACCENT_COLORS: Record<Exclude<AccentColor, 'artwork'>, string> = {
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
  mauve:  '#AC9CA9',
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
      page: 'main',
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
      playlistMenu: null,
      setPlaylistMenu: (playlistMenu) => set({ playlistMenu }),
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
