import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SCTrack, SCUser, SCPlaylist } from '../services/soundcloud'
import type { Release } from '../services/updates'
import type { EqPreset } from '../services/eqPresets'

interface PlayerState {
  currentTrack: SCTrack | null
  queue: SCTrack[]
  queueIndex: number
  history: number[]   // stack of visited queue indices, for "previous" with shuffle
  isPlaying: boolean
  volume: number
  lastVolume: number   // last non-zero volume, restored on unmute
  progress: number
  duration: number
  shuffle: boolean
  repeat: 'none' | 'one' | 'all'
  setTrack: (track: SCTrack, queue?: SCTrack[]) => void
  setPlaying: (v: boolean) => void
  setVolume: (v: number) => void
  toggleMute: () => void
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
  likedPlaylists: SCPlaylist[]
  stream: SCTrack[]
  releases: SCTrack[]
  followingIds: number[]
  followings: SCUser[]     // people you follow, with full profiles (Friends page)
  pinnedFriendIds: number[]  // friends pinned to the front of the Friends strip
  localPlaylists: SCPlaylist[]
  addLocalPlaylist: (title: string, tracks: SCTrack[]) => SCPlaylist
  removeLocalPlaylist: (id: number) => void
  renameLocalPlaylist: (id: number, title: string) => void
  setAuth: (clientId: string, token: string, user: SCUser) => void
  setLikes: (tracks: SCTrack[]) => void
  setPlaylists: (pl: SCPlaylist[]) => void
  setLikedPlaylists: (pl: SCPlaylist[]) => void
  setStream: (tracks: SCTrack[]) => void
  setReleases: (tracks: SCTrack[]) => void
  setFollowingIds: (ids: number[]) => void
  setFollowings: (users: SCUser[]) => void
  togglePinFriend: (id: number) => void
  followOptimistic: (id: number) => void
  unfollowOptimistic: (id: number) => void
  logout: () => void
  likeTrackOptimistic: (track: SCTrack) => void
  unlikeTrackOptimistic: (trackId: number) => void
  updatePlaylistTracks: (playlistId: number, tracks: SCTrack[]) => void
}

interface UIState {
  page: 'main' | 'stream' | 'releases' | 'likes' | 'playlists' | 'search' | 'playlist-detail' | 'friends'
  playlistsSubPage: 'playlists' | 'playlist-detail'
  selectedPlaylist: SCPlaylist | null
  selectedAlbum: SCPlaylist | null
  searchQuery: string
  searchResults: SCTrack[]
  searchTab: 'all' | 'tracks' | 'artists' | 'albums' | 'playlists'
  bgColor: string
  artRgb: [number, number, number]
  trackOrder: 'newest' | 'oldest'
  showTrackPage: boolean
  showQueue: boolean
  artistPageUser: SCUser | null
  artistHistory: SCUser[]   // back-stack for drilling user → following → user …
  playlistPickerTrack: SCTrack | null
  setPlaylistPickerTrack: (track: SCTrack | null) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  settingsTab: string | null
  openSettings: (tab?: string) => void
  contextMenu: { x: number; y: number; track: SCTrack } | null
  setContextMenu: (m: { x: number; y: number; track: SCTrack } | null) => void
  playlistMenu: { x: number; y: number; playlist: SCPlaylist } | null
  setPlaylistMenu: (m: { x: number; y: number; playlist: SCPlaylist } | null) => void
  artistMenu: { x: number; y: number; user: SCUser } | null
  setArtistMenu: (m: { x: number; y: number; user: SCUser } | null) => void
  albumMenu: { x: number; y: number; album: SCPlaylist } | null
  setAlbumMenu: (m: { x: number; y: number; album: SCPlaylist } | null) => void
  showFullscreen: boolean
  setShowFullscreen: (v: boolean) => void
  setPage: (p: UIState['page']) => void
  setSelectedPlaylist: (pl: SCPlaylist) => void
  setSelectedAlbum: (a: SCPlaylist | null) => void
  goToPlaylists: () => void
  backFromPlaylist: () => void
  setSearch: (q: string) => void
  setSearchResults: (tracks: SCTrack[]) => void
  setSearchTab: (t: UIState['searchTab']) => void
  setBgColor: (c: string) => void
  setArtRgb: (rgb: [number, number, number]) => void
  setTrackOrder: (o: 'newest' | 'oldest') => void
  setShowTrackPage: (v: boolean) => void
  setShowQueue: (v: boolean) => void
  setArtistPage: (user: SCUser | null) => void
  drillArtist: (user: SCUser) => void
  backArtist: () => void
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
  lastVolume: 0.8,
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
  // Remember the last non-zero volume so mute -> unmute restores exactly it.
  setVolume: (v) => set(v > 0 ? { volume: v, lastVolume: v } : { volume: v }),
  toggleMute: () => {
    const { volume, lastVolume } = get()
    if (volume > 0) set({ volume: 0, lastVolume: volume })
    else set({ volume: lastVolume > 0 ? lastVolume : 0.7 })
  },
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
      partialize: (s) => ({ volume: s.volume, lastVolume: s.lastVolume, shuffle: s.shuffle, repeat: s.repeat }),
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
      likedPlaylists: [],
      stream: [],
      releases: [],
      followingIds: [],
      followings: [],
      pinnedFriendIds: [],
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
      setLikedPlaylists: (likedPlaylists) => set({ likedPlaylists }),
      setStream: (stream) => set({ stream }),
      setReleases: (releases) => set({ releases }),
      setFollowingIds: (followingIds) => set({ followingIds }),
      setFollowings: (followings) => set({ followings }),
      togglePinFriend: (id) => set(s => ({
        pinnedFriendIds: s.pinnedFriendIds.includes(id) ? s.pinnedFriendIds.filter(x => x !== id) : [...s.pinnedFriendIds, id],
      })),
      followOptimistic: (id) => set(s => (s.followingIds.includes(id) ? s : { followingIds: [...s.followingIds, id] })),
      unfollowOptimistic: (id) => set(s => ({ followingIds: s.followingIds.filter(x => x !== id) })),
      logout: () => {
        try { window.electronAPI?.secureSetToken?.('') } catch { /* ignore */ }
        set({ user: null, clientId: '', oauthToken: '', likes: [], playlists: [], likedPlaylists: [], stream: [], releases: [], followingIds: [], followings: [], pinnedFriendIds: [], localPlaylists: [] })
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
      // With "big lists" on we skip persisting likes/stream: re-serialising
      // thousands of tracks on every store write is a real source of freezes,
      // and useSync refetches both on launch anyway.
      partialize: (s) => ({
        user: s.user, clientId: s.clientId,
        likes: useSettings.getState().perfBigLists ? [] : s.likes,
        stream: useSettings.getState().perfBigLists ? [] : s.stream,
        playlists: s.playlists, likedPlaylists: s.likedPlaylists,
        followingIds: s.followingIds, followings: s.followings, pinnedFriendIds: s.pinnedFriendIds, localPlaylists: s.localPlaylists,
      }),
    }
  )
)

export type PerfKey = 'perfPauseUnfocused' | 'perfLowFps' | 'perfNoBlur' | 'perfNoHeroAnim' | 'perfMiniOpaque' | 'perfBigLists'

export type AccentColor = 'orange' | 'blue' | 'green' | 'pink' | 'purple' | 'red' | 'cyan' | 'yellow' | 'white' | 'indigo' | 'slate' | 'mauve' | 'artwork'
export type BgStyle = 'artwork' | 'accent' | 'dark' | 'midnight' | 'aurora' | 'wallpaper'
export type VisualizerStyle = 'bars' | 'wave' | 'mirror'
export type HeroAnim = 'wave' | 'threads' | 'silk' | 'mist' | 'weave' | 'spectrum'
export type Theme = 'default' | 'glass' | 'minimal'
export type PlayerStyle = 'default' | 'fullscreen'
export type FsLayout = 'side' | 'stack' | 'split'
export type Lang = 'ru' | 'en'
export type StartPage = 'main' | 'stream' | 'releases' | 'likes' | 'playlists'

// A named snapshot of the customisable client settings (look, feel, playback DSP).
export type SettingsPreset = { id: string; name: string; data: Record<string, unknown> }

// Which settings a preset captures. Excludes only the machine-specific paths/ids
// (wallpaperPath, outputDeviceId) and the preset lists themselves. closeToTray and
// launchAtStartup are captured too, so applying a preset must re-sync those to the
// main process (the UI does this after applySettingsPreset).
export const SETTINGS_PRESET_KEYS = [
  'theme', 'accent', 'bgStyle', 'visualizerStyle', 'heroAnim',
  'playerStyle', 'fsLayout', 'fsShowLyrics', 'fsLiveBg', 'fsBeatGlow', 'fsArtCrossfade', 'lyricsFontScale',
  'hiddenNav', 'startPage', 'lang',
  'perfPauseUnfocused', 'perfLowFps', 'perfNoBlur', 'perfNoHeroAnim', 'perfMiniOpaque', 'perfBigLists',
  'eq', 'eqEnabled', 'crossfade',
  'closeToTray', 'mediaKeys', 'autoSkipDrm', 'launchAtStartup',
] as const

// Stable snapshot of the preset keys from a state object (hiddenNav sorted so
// two equal sets compare equal regardless of toggle order).
export function settingsSnapshot(s: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const k of SETTINGS_PRESET_KEYS) o[k] = s[k]
  const copy = JSON.parse(JSON.stringify(o)) as Record<string, unknown>
  if (Array.isArray(copy.hiddenNav)) copy.hiddenNav = [...(copy.hiddenNav as string[])].sort()
  return copy
}

// Validate untrusted preset data (from a shared code): keep only known keys with
// the right type / enum / range, so a hostile code can't poison the UI or audio.
export function validateSettingsPresetData(d: Record<string, unknown>): Record<string, unknown> {
  const ENUMS: Record<string, readonly string[]> = {
    theme: ['default', 'glass', 'minimal'],
    accent: [...Object.keys(ACCENT_COLORS), 'artwork'],
    bgStyle: ['artwork', 'accent', 'dark', 'midnight', 'aurora', 'wallpaper'],
    visualizerStyle: ['bars', 'wave', 'mirror'],
    heroAnim: ['wave', 'threads', 'silk', 'mist', 'weave', 'spectrum'],
    playerStyle: ['default', 'fullscreen'],
    fsLayout: ['side', 'stack', 'split'],
    startPage: ['main', 'stream', 'releases', 'likes', 'playlists'],
    lang: ['ru', 'en'],
  }
  const boolKeys = new Set(['fsShowLyrics', 'fsLiveBg', 'fsBeatGlow', 'fsArtCrossfade', 'perfPauseUnfocused', 'perfLowFps', 'perfNoBlur', 'perfNoHeroAnim', 'perfMiniOpaque', 'perfBigLists', 'eqEnabled', 'closeToTray', 'mediaKeys', 'autoSkipDrm', 'launchAtStartup'])
  const out: Record<string, unknown> = {}
  for (const key of SETTINGS_PRESET_KEYS) {
    if (!(key in d)) continue
    const val = d[key]
    if (val === undefined || val === null) continue
    if (key in ENUMS) { if (typeof val === 'string' && ENUMS[key].includes(val)) out[key] = val; continue }
    if (boolKeys.has(key)) { if (typeof val === 'boolean') out[key] = val; continue }
    if (key === 'lyricsFontScale') { if (typeof val === 'number' && isFinite(val)) out[key] = Math.max(0.7, Math.min(1.8, val)); continue }
    if (key === 'crossfade') { if (typeof val === 'number' && isFinite(val)) out[key] = Math.max(0, Math.min(12, val)); continue }
    if (key === 'eq') { if (Array.isArray(val) && val.length === 5 && val.every(n => typeof n === 'number' && isFinite(n))) out.eq = (val as number[]).map(n => Math.max(-12, Math.min(12, Math.round(n)))); continue }
    if (key === 'hiddenNav') { if (Array.isArray(val) && val.every(v => typeof v === 'string')) out.hiddenNav = [...(val as string[])].sort(); continue }
  }
  return out
}

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
  hiddenNav: string[]      // sidebar nav ids hidden from the rail
  // ── Performance ──
  perfPauseUnfocused: boolean  // freeze animation loops while the window is inactive
  perfLowFps: boolean          // cap animation loops at ~30fps instead of 60
  perfNoBlur: boolean          // kill backdrop-filter blur everywhere (GPU heavy)
  perfNoHeroAnim: boolean      // don't mount the home-page canvas animation
  perfMiniOpaque: boolean      // mini-player without window transparency
  perfBigLists: boolean        // virtualise long lists, skip persisting them, cap the lyrics scan
  lang: Lang
  eq: number[]        // gain in dB per band, length 5
  eqEnabled: boolean
  eqPresets: EqPreset[]          // user-created presets
  activePresetId: string | null  // id of the applied preset (null = custom)
  settingsPresets: SettingsPreset[]  // user-created whole-settings presets
  outputDeviceId: string   // '' = system default
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
  toggleNavHidden: (id: string) => void
  setPerf: (key: PerfKey, v: boolean) => void
  setLang: (l: Lang) => void
  setEqBand: (index: number, gain: number) => void
  setEqEnabled: (v: boolean) => void
  resetEq: () => void
  applyEqPreset: (gains: number[], id: string | null) => void
  saveEqPreset: (name: string) => void
  renameEqPreset: (id: string, name: string) => void
  deleteEqPreset: (id: string) => void
  addEqPreset: (name: string, gains: number[]) => void
  saveSettingsPreset: (name: string) => void
  applySettingsPreset: (id: string) => void
  renameSettingsPreset: (id: string, name: string) => void
  deleteSettingsPreset: (id: string) => void
  addSettingsPreset: (name: string, data: Record<string, unknown>) => void
  setOutputDeviceId: (id: string) => void
  setLyricsOpen: (v: boolean) => void
  setCrossfade: (v: number) => void
  setStartPage: (p: StartPage) => void
  setCloseToTray: (v: boolean) => void
  setMediaKeys: (v: boolean) => void
  setLaunchAtStartup: (v: boolean) => void
  setAutoSkipDrm: (v: boolean) => void
  resetSettings: () => void
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
  hiddenNav: [] as string[],
  perfPauseUnfocused: false,
  perfLowFps: false,
  perfNoBlur: false,
  perfNoHeroAnim: false,
  perfMiniOpaque: false,
  perfBigLists: false,
  lang: 'en' as Lang,
  eq: [0, 0, 0, 0, 0] as number[],
  eqEnabled: false,
  eqPresets: [] as EqPreset[],
  activePresetId: null as string | null,
  settingsPresets: [] as SettingsPreset[],
  outputDeviceId: '',
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
      toggleNavHidden: (id) => set(s => ({
        hiddenNav: s.hiddenNav.includes(id) ? s.hiddenNav.filter(x => x !== id) : [...s.hiddenNav, id],
      })),
      setPerf: (key, v) => set({ [key]: v } as Partial<SettingsState>),
      setLang: (lang) => set({ lang }),
      setEqBand: (index, gain) => set(s => {
        const eq = [...s.eq]; eq[index] = gain; return { eq, activePresetId: null }
      }),
      setEqEnabled: (eqEnabled) => set({ eqEnabled }),
      resetEq: () => set({ eq: [0, 0, 0, 0, 0], activePresetId: null }),
      applyEqPreset: (gains, id) => set({
        eq: gains.slice(0, 5).map(n => Math.max(-12, Math.min(12, Math.round(n)))),
        eqEnabled: true,
        activePresetId: id,
      }),
      saveEqPreset: (name) => set(s => {
        const preset: EqPreset = { id: `u:${Date.now().toString(36)}`, name: name.trim().slice(0, 40) || 'Preset', gains: [...s.eq] }
        return { eqPresets: [...s.eqPresets, preset], activePresetId: preset.id }
      }),
      renameEqPreset: (id, name) => set(s => ({
        eqPresets: s.eqPresets.map(p => (p.id === id ? { ...p, name: name.trim().slice(0, 40) || p.name } : p)),
      })),
      deleteEqPreset: (id) => set(s => ({
        eqPresets: s.eqPresets.filter(p => p.id !== id),
        activePresetId: s.activePresetId === id ? null : s.activePresetId,
      })),
      addEqPreset: (name, gains) => set(s => {
        const g = gains.slice(0, 5).map(n => Math.max(-12, Math.min(12, Math.round(n))))
        // Skip an exact duplicate (same name + curve) to avoid clutter on re-import
        if (s.eqPresets.some(p => p.name === name && p.gains.join() === g.join())) return s
        const preset: EqPreset = { id: `u:${Date.now().toString(36)}`, name: name.trim().slice(0, 40) || 'Preset', gains: g }
        return { eqPresets: [...s.eqPresets, preset] }
      }),
      saveSettingsPreset: (name) => set(s => {
        const preset: SettingsPreset = { id: `sp:${Date.now().toString(36)}`, name: name.trim().slice(0, 40) || 'Preset', data: settingsSnapshot(s as unknown as Record<string, unknown>) }
        return { settingsPresets: [...s.settingsPresets, preset] }
      }),
      applySettingsPreset: (id) => set(s => {
        const p = s.settingsPresets.find(pp => pp.id === id)
        return p ? (p.data as Partial<SettingsState>) : {}
      }),
      renameSettingsPreset: (id, name) => set(s => ({
        settingsPresets: s.settingsPresets.map(p => (p.id === id ? { ...p, name: name.trim().slice(0, 40) || p.name } : p)),
      })),
      deleteSettingsPreset: (id) => set(s => ({
        settingsPresets: s.settingsPresets.filter(p => p.id !== id),
      })),
      addSettingsPreset: (name, data) => set(s => {
        const clean = validateSettingsPresetData(data)
        const preset: SettingsPreset = { id: `sp:${Date.now().toString(36)}`, name: name.trim().slice(0, 40) || 'Preset', data: clean }
        return { settingsPresets: [...s.settingsPresets, preset] }
      }),
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
      setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
      setCrossfade: (crossfade) => set({ crossfade }),
      setStartPage: (startPage) => set({ startPage }),
      setCloseToTray: (closeToTray) => set({ closeToTray }),
      setMediaKeys: (mediaKeys) => set({ mediaKeys }),
      setLaunchAtStartup: (launchAtStartup) => set({ launchAtStartup }),
      setAutoSkipDrm: (autoSkipDrm) => set({ autoSkipDrm }),
      resetSettings: () => set({ ...SETTINGS_DEFAULTS }),
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
      selectedAlbum: null,
      searchQuery: '',
      searchResults: [],
      searchTab: 'all',
      bgColor: '#080808',
      artRgb: [80, 80, 80] as [number, number, number],
      trackOrder: 'newest',
      showTrackPage: false,
      showQueue: false,
      artistPageUser: null,
      artistHistory: [],
      playlistPickerTrack: null,
      setPlaylistPickerTrack: (playlistPickerTrack) => set({ playlistPickerTrack }),
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),
      settingsTab: null,
      openSettings: (tab) => set({ showSettings: true, settingsTab: tab ?? null }),
      contextMenu: null,
      setContextMenu: (contextMenu) => set({ contextMenu }),
      playlistMenu: null,
      setPlaylistMenu: (playlistMenu) => set({ playlistMenu }),
      artistMenu: null,
      setArtistMenu: (artistMenu) => set({ artistMenu }),
      albumMenu: null,
      setAlbumMenu: (albumMenu) => set({ albumMenu }),
      showFullscreen: false,
      setShowFullscreen: (showFullscreen) => set({ showFullscreen }),
      setPage: (page) => set({ page }),
      setSelectedPlaylist: (pl) => set({ selectedPlaylist: pl, page: 'playlist-detail', playlistsSubPage: 'playlist-detail' }),
      setSelectedAlbum: (selectedAlbum) => set({ selectedAlbum }),
      goToPlaylists: () => set(s => ({ page: s.playlistsSubPage })),
      backFromPlaylist: () => set({ page: 'playlists', playlistsSubPage: 'playlists' }),
      setSearch: (q) => set({ searchQuery: q }),
      setSearchResults: (tracks) => set({ searchResults: tracks }),
      setSearchTab: (searchTab) => set({ searchTab }),
      setBgColor: (c) => set({ bgColor: c }),
      setArtRgb: (artRgb) => set({ artRgb }),
      setTrackOrder: (trackOrder) => set({ trackOrder }),
      setShowTrackPage: (showTrackPage) => set({ showTrackPage }),
      setShowQueue: (showQueue) => set({ showQueue }),
      // Fresh open (or close) — clears any drill history
      setArtistPage: (artistPageUser) => set({ artistPageUser, artistHistory: [] }),
      // Drill deeper (following/followers) — remember where we were for Back
      drillArtist: (user) => set(s => (s.artistPageUser ? { artistPageUser: user, artistHistory: [...s.artistHistory, s.artistPageUser] } : { artistPageUser: user })),
      backArtist: () => set(s => { const h = [...s.artistHistory]; const prev = h.pop(); return { artistPageUser: prev ?? null, artistHistory: h } }),
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

// ── Update / releases (powers the banner + Versions tab) ────────────────────
interface UpdateState {
  current: string
  releases: Release[]
  dismissed: string | null // tag the user dismissed the banner for
  setData: (current: string, releases: Release[]) => void
  dismiss: (tag: string) => void
}
export const useUpdate = create<UpdateState>()(
  persist(
    (set) => ({
      current: '',
      releases: [],
      dismissed: null,
      setData: (current, releases) => set({ current, releases }),
      dismiss: (dismissed) => set({ dismissed }),
    }),
    { name: 'sc-update', partialize: (s) => ({ dismissed: s.dismissed }) }
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
