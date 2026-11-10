import { create } from 'zustand'
import { settingsPredateFirstRun } from '../services/whatsNew'
import { persist } from 'zustand/middleware'
import type { SCTrack, SCUser, SCPlaylist } from '../services/soundcloud'
import type { Release } from '../services/updates'
import type { EqPreset } from '../services/eqPresets'
import { mergeRadio } from '../services/radio'

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
  /* Where the automatic part of the queue starts. Everything from this
     index on was chosen by the radio rather than by a person, which is why
     it is one number and not a flag per track: the tail is always the end
     of the queue, and anything a person adds after it pushes the line. */
  radioFrom: number
  /* The track the current tail was grown from, and whether it has run out.
     Both exist to stop the same fruitless request going out once a second
     for an upload that simply has no neighbours. */
  radioSeed: number | null
  radioDry: boolean
  appendRadio: (tracks: SCTrack[], seed: number) => void
  /** Put a track in right after the one playing. */
  queueNext: (track: SCTrack) => void
  /** Put tracks on the end, before the radio tail rather than after it. */
  queueLast: (tracks: SCTrack[]) => void
  markRadioDry: (seed: number) => void
}

interface ProfileState {
  user: SCUser | null
  clientId: string
  oauthToken: string
  likes: SCTrack[]
  playlists: SCPlaylist[]
  likedPlaylists: SCPlaylist[]
  releases: SCTrack[]
  followingIds: number[]
  followings: SCUser[]     // people you follow, with full profiles (Friends page)
  pinnedFriendIds: number[]  // friends pinned to the front of the Friends strip
  localPlaylists: SCPlaylist[]
  addLocalPlaylist: (title: string, tracks: SCTrack[]) => SCPlaylist
  removeLocalPlaylist: (id: number) => void
  renameLocalPlaylist: (id: number, title: string) => void
  setLocalPlaylistTracks: (id: number, tracks: SCTrack[]) => void
  setAuth: (clientId: string, token: string, user: SCUser) => void
  setLikes: (tracks: SCTrack[]) => void
  setPlaylists: (pl: SCPlaylist[]) => void
  setLikedPlaylists: (pl: SCPlaylist[]) => void
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

/* A place inside the editing mode, named from outside it. `region` is one of
   the two pickable parts of the window or the dock on the right; `fold` is
   the group to unroll once there. */
export interface EditTarget { region: 'sidebar' | 'content' | 'dock'; fold?: string }

interface UIState {
  page: 'main' | 'releases' | 'likes' | 'playlists' | 'search' | 'playlist-detail' | 'friends'
  playlistsSubPage: 'playlists' | 'playlist-detail'
  playlistReturnPage: UIState['page']   // where "back" from a playlist should return
  selectedPlaylist: SCPlaylist | null
  selectedAlbum: SCPlaylist | null
  searchQuery: string
  searchTab: 'all' | 'tracks' | 'artists' | 'albums' | 'playlists'
  bgColor: string
  artRgb: [number, number, number]
  trackOrder: 'newest' | 'oldest'
  showTrackPage: boolean
  showQueue: boolean
  artistPageUser: SCUser | null
  artistHistory: SCUser[]   // back-stack for drilling user → following → user …
  overlayOrder: ('track' | 'artist' | 'album')[]  // open-order of full-screen overlays, for stacked z-index
  playlistPickerTrack: SCTrack | null
  setPlaylistPickerTrack: (track: SCTrack | null) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  showWelcome: boolean
  setShowWelcome: (v: boolean) => void
  showNews: boolean
  setShowNews: (v: boolean) => void
  news: { items: unknown[]; version: string } | null
  setNews: (v: { items: unknown[]; version: string } | null) => void
  settingsTab: string | null
  openSettings: (tab?: string) => void
  contextMenu: { x: number; y: number; track: SCTrack } | null
  setContextMenu: (m: { x: number; y: number; track: SCTrack } | null) => void
  /** App-wide confirmation. Lives here, not inside the asking component, because
   *  menus unmount the moment they are clicked - the dialog has to outlive them. */
  confirmAsk: { message: string; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void } | null
  askConfirm: (message: string, confirmLabel: string, danger?: boolean) => Promise<boolean>
  answerConfirm: (ok: boolean) => void
  playlistMenu: { x: number; y: number; playlist: SCPlaylist } | null
  setPlaylistMenu: (m: { x: number; y: number; playlist: SCPlaylist } | null) => void
  artistMenu: { x: number; y: number; user: SCUser } | null
  setArtistMenu: (m: { x: number; y: number; user: SCUser } | null) => void
  /* Right-click on the sidebar rail: a menu holding nothing but the tab toggles. */
  sidebarMenu: { x: number; y: number } | null
  setSidebarMenu: (m: { x: number; y: number } | null) => void
  /* Right-click on the window's own background - anywhere no other menu
     claims. The way into the editing mode without crossing the window to
     the palette button. */
  bgMenu: { x: number; y: number } | null
  setBgMenu: (m: { x: number; y: number } | null) => void
  albumMenu: { x: number; y: number; album: SCPlaylist } | null
  setAlbumMenu: (m: { x: number; y: number; album: SCPlaylist } | null) => void
  /* Live customisation: the settings panel steps aside and the real player
     becomes the thing you point at. */
  editMode: boolean
  /* The rail folded away by hand on the home screen. Held for the session
     and deliberately kept out of the persisted keys, so it survives moving
     between tabs - home to likes and back leaves it folded - but a restart
     comes up wide again.
     It first reset on leaving home, which turned out to be wrong in use:
     stepping into a playlist and back is part of listening, and having to
     fold the rail again every time made the control feel broken. Not
     persisted either, because that is what the width setting is for. */
  railFolded: boolean
  setRailFolded: (v: boolean) => void
  // Where the editing mode was entered from, so leaving it goes back there.
  // Entered from the palette button it used to drop the settings window on
  // screen - a window the person had not opened.
  editFromSettings: boolean
  /* Where to land when the mode is opened from the settings search, rather
     than by hand. Cleared the moment the mode reads it: it is an instruction
     for one opening, and left standing it would re-open the same group every
     time somebody pressed the palette button afterwards. */
  editTarget: EditTarget | null
  clearEditTarget: () => void
  setEditMode: (v: boolean, fromSettings?: boolean, target?: EditTarget | null) => void
  /* Asking to leave, rather than being switched off. Flipping editMode from
     outside kills the layer mid-frame with none of its exit animation, and
     the mode is reached from a button that has to be able to close it again
     - so the button bumps this and the layer leaves the way it arrived.
     Same shape as meltSignal: a counter nobody reads for its value. */
  editCloseSignal: number
  closeEditMode: () => void
  setPage: (p: UIState['page']) => void
  setSelectedPlaylist: (pl: SCPlaylist) => void
  setSelectedAlbum: (a: SCPlaylist | null) => void
  goToPlaylists: () => void
  backFromPlaylist: () => void
  setSearch: (q: string) => void
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
  radioFrom: -1,
  radioSeed: null,
  radioDry: false,

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
    /* Picking a new queue retires the old tail. The radio grown from a
       track nobody is listening to any more has nothing to do with what
       was just chosen, and keeping it would leave those tracks sitting in
       the queue marked as suggestions for a song that is gone. */
    /* A track that is not in the queue it was handed gets a queue of its
       own. Pretending it sits at index 0 left currentTrack and
       queue[queueIndex] describing different songs: the panel highlighted
       the wrong row, Next skipped one, and the radio tail went on
       advertising suggestions for a track that was no longer playing. */
    const fresh = idx < 0
    set({
      currentTrack: track,
      queue: fresh ? [track] : q,
      queueIndex: fresh ? 0 : idx,
      history: fresh ? [] : history,
      isPlaying: true,
      progress: 0,
      ...(sameQueue && !fresh ? {} : { radioFrom: -1, radioSeed: null, radioDry: false }),
    })
    /* Recently played is a record of what was started, not of what finished:
       skipping through five tracks did happen and the list should say so.
       `history` above is unrelated - that is queue indices for the Previous
       button and it resets whenever the queue changes. */
    useStats.getState().notePlayed(track)
  },

  /* Grown onto the end, never inserted. Everything the station offered
     that is already queued is dropped: handing back the song now playing
     would put it twice in a row, which reads as the player stuttering. */
  appendRadio: (tracks, seed) => set(s => {
    const merged = mergeRadio(s.queue, tracks, s.radioFrom)
    if (!merged) return { radioSeed: seed, radioDry: true }
    return { ...merged, radioSeed: seed, radioDry: false }
  }),

  /* Both of these exist because three screens were splicing `queue` through
     setState by hand and leaving `radioFrom` where it was. That number is an
     index into this very array, so an insert above it moved every radio
     track down one while the line stayed put: the "from the station" heading
     slid onto tracks a person had queued themselves, and it never corrected
     itself, because mergeRadio keeps a radioFrom it has already been given. */
  queueNext: (track) => set(s => {
    const at = s.queueIndex + 1
    return {
      queue: [...s.queue.slice(0, at), track, ...s.queue.slice(at)],
      radioFrom: s.radioFrom >= at ? s.radioFrom + 1 : s.radioFrom,
    }
  }),

  /* "Last" means last among the tracks a person chose - ahead of the
     station's tail, not behind it. Appending past the tail filed the whole
     album under the radio heading. */
  queueLast: (tracks) => set(s => {
    if (!tracks.length) return {}
    const at = s.radioFrom >= 0 ? s.radioFrom : s.queue.length
    return {
      queue: [...s.queue.slice(0, at), ...tracks, ...s.queue.slice(at)],
      radioFrom: s.radioFrom >= 0 ? s.radioFrom + tracks.length : s.radioFrom,
    }
  }),

  markRadioDry: (seed) => set({ radioSeed: seed, radioDry: true }),

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
    } else if (queueIndex >= queue.length - 1) {
      /* The end, with nothing to repeat and no radio to extend it. Stop,
         rather than re-select the track that just finished: the id does
         not change, so the load effect does not re-run, isPlaying was
         already true so the play effect does not either - the player sat
         claiming to play at 0:00 over a silent, ended element, and told
         MPRIS and Discord the same. */
      set({ isPlaying: false })
      return
    } else {
      next = queueIndex + 1
    }
    // Only a real move is worth remembering; pushing the index we are
    // already on made Previous swallow one press per push.
    // Only a real position is worth remembering; -1 means the track that
    // was playing is not in this queue, and Previous cannot return to it.
    const history2 = next === queueIndex || queueIndex < 0 ? history : [...history, queueIndex].slice(-100)
    set({ currentTrack: queue[next], queueIndex: next, history: history2, isPlaying: true, progress: 0 })
  },

  prevTrack: () => {
    const { queue, queueIndex, progress, history } = get()
    // Mirrors nextTrack. Without it an emptied queue read queue[0] and set
    // currentTrack to undefined while the audio element kept playing.
    if (!queue.length) return
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

  /* Keeps two things straight that used to drift: the index must still
     point at the track that is playing, and the radio line is an index
     into this same array, so removing anything above it moves it. */
  removeFromQueue: (index) => set(s => {
    if (index < 0 || index >= s.queue.length) return {}
    const queue = s.queue.filter((_, i) => i !== index)
    const radioFrom = s.radioFrom > index ? s.radioFrom - 1 : s.radioFrom
    if (index === s.queueIndex) {
      /* The playing track itself. It keeps playing - nothing here stops
         it - so the index moves back one, leaving the track that slid
         into the hole as the next one Next will reach.
         Removing the one at the top lands on -1, and that is correct
         rather than a hole to be clamped out of: it is the value the whole
         player already uses for "what is playing is not in this queue",
         from the companion bridge to the phone. Clamping it up to 0 was
         the bug - Next then stepped to 1 and skipped the track that had
         just slid into the hole, and the panel drew that track in neither
         of its two lists. */
      const queueIndex = Math.min(index - 1, queue.length - 1)
      return { queue, queueIndex, history: [], radioFrom: radioFrom >= queue.length ? -1 : radioFrom }
    }
    const queueIndex = index < s.queueIndex
      ? s.queueIndex - 1
      : Math.min(s.queueIndex, Math.max(0, queue.length - 1))
    return { queue, queueIndex, history: [], radioFrom: radioFrom >= queue.length ? -1 : radioFrom }
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
    /* The radio line is an index into this array, so dragging a track
       across it moves the boundary by one. Left alone, the divider drew
       itself a row late and a station track appeared above it as if
       somebody had queued it by hand. */
    let rf = s.radioFrom
    if (rf >= 0) {
      if (from < rf && to >= rf) rf--
      else if (from >= rf && to < rf) rf++
    }
    return { queue, queueIndex: qi, history: [], radioFrom: rf }
  }),

  // Clear the queue but keep the current track playing
  /* Clearing takes the tail with it. It will grow back from whatever is
     left playing, which is the point of clearing. */
  clearQueue: () => set(s => (s.currentTrack
    ? { queue: [s.currentTrack], queueIndex: 0, history: [], radioFrom: -1, radioSeed: null, radioDry: false }
    : { queue: [], queueIndex: 0, history: [], radioFrom: -1, radioSeed: null, radioDry: false })),

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
      setLocalPlaylistTracks: (id, tracks) => set(s => ({
        localPlaylists: s.localPlaylists.map(p => p.id === id ? { ...p, tracks, track_count: tracks.length } : p),
      })),
      setAuth: (clientId, oauthToken, user) => set({ clientId, oauthToken, user }),
      setLikes: (likes) => set({ likes }),
      setPlaylists: (playlists) => set({ playlists }),
      setLikedPlaylists: (likedPlaylists) => set({ likedPlaylists }),
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
        set({ user: null, clientId: '', oauthToken: '', likes: [], playlists: [], likedPlaylists: [], releases: [], followingIds: [], followings: [], pinnedFriendIds: [], localPlaylists: [] })
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
      // Don't persist `releases` - refetch a fresh feed each session.
      // `oauthToken` is intentionally excluded: it lives in the OS keychain
      // (secure-set-token) and is rehydrated into memory on startup.
      // With "big lists" on we skip persisting likes/stream: re-serialising
      // thousands of tracks on every store write is a real source of freezes,
      // and useSync refetches both on launch anyway.
      partialize: (s) => ({
        user: s.user, clientId: s.clientId,
        // Large collections are never persisted: 1700 likes is 3-4 MB of JSON and
        // localStorage tops out around 5-10. They are refetched on start anyway.
        likes: [],
        playlists: s.playlists, likedPlaylists: s.likedPlaylists,
        followingIds: s.followingIds, followings: s.followings, pinnedFriendIds: s.pinnedFriendIds, localPlaylists: s.localPlaylists,
      }),
    }
  )
)


// 'artwork' follows the cover art, 'custom' is the user's own hex (customAccent).
// Neither has an entry in ACCENT_COLORS - resolveAccentHex() handles both.
export type AccentColor = 'orange' | 'blue' | 'green' | 'pink' | 'purple' | 'red' | 'cyan' | 'yellow' | 'white' | 'indigo' | 'slate' | 'mauve' | 'artwork' | 'custom'
export type BgStyle = 'artwork' | 'accent' | 'aurora' | 'wallpaper'
/** The sky the rain's "background to match" switch builds the aurora from.
 *  Not the accent - that one goes slate; these are deliberately different. */
export const RAIN_SKY = '#263358'

/* The models worth offering for this job, in the order they are shown. The
   flagship is first because it is what Google points people at, but it is
   also the busiest - the lighter ones answer when it will not, and the last
   one is purpose-built for speech. All of them take audio. */
export const AI_MODELS: { id: string; label: string }[] = [
  { id: 'gemini-3.8-flash', label: 'Flash 3.8' },
  { id: 'gemini-3.6-flash', label: 'Flash 3.6' },
  { id: 'gemini-3.5-flash-lite', label: 'Flash Lite' },
  { id: 'gemini-3.5-transcribe', label: 'Transcribe' },
]

/* Seasonal decoration. Built as a slot rather than a New Year flag: the next
   season drops in beside 'newyear' without touching anything that reads it. */
export type Season = 'off' | 'auto' | 'newyear'
/* Named steps rather than a slider, the way the reference does it: nobody
   wants to dial in flakes per megapixel, they want "a bit" or "a lot". */
export type Snowfall = 'off' | 'light' | 'steady' | 'heavy'
export interface SnowSettings {
  fall: Snowfall
  onPanels: boolean    // settle on the top edge of panels
  physics: boolean     // the pointer ploughs what has settled
}
/** Flakes per megapixel of window. Measured off the reference: 'steady' sits
 *  at about nine on screen at once per megapixel. */
export const SNOWFALL_DENSITY: Record<Snowfall, number> = { off: 0, light: 10, steady: 22, heavy: 48 }
/** How the garland's bulbs behave: each out of phase, a wave running along the
 *  wire, or simply lit. */
export type GarlandMode = 'twinkle' | 'run' | 'static'

/* The date the app reasons about, which is the machine's unless somebody has
   said otherwise. A wrong system clock is not rare - a VM that never synced,
   a dual boot that disagrees about UTC - and the one thing in here that
   silently depends on it is the seasonal mode, which then either never
   arrives or arrives in June with no way to argue. */
export function appDate(): Date {
  /* Guarded, and not out of politeness: persist hydrates SYNCHRONOUSLY from
     localStorage, inside the create() call that is still assigning
     useSettings - so anything reading the store from onRehydrateStorage
     reaches a binding that does not exist yet and throws. The throw is
     silent, it just abandons the rest of the callback, which is how a
     normalisation can quietly stop running. The real clock is the right
     answer that early: an override cannot have been read in yet. */
  let o = ''
  try { o = useSettings.getState().dateOverride } catch { return new Date() }
  if (!o) return new Date()
  // Midday, so a timezone shift either way cannot move it off the day meant.
  const d = new Date(o + 'T12:00:00')
  return isNaN(d.getTime()) ? new Date() : d
}

/** 'auto' means all of December through to 14 January. */
/* One sky at a time, enforced on a whole state rather than on one switch.
   The setters keep this rule as you click, but three things write these
   flags without going through them - a settings preset, a shared preset
   code, and localStorage written by a build that had no rule at all - and
   any of those can land rain on top of winter. Priority runs rain, then the
   branch, then the night sky, because that is the order of how much of the
   window each one takes over. Snow may fall through the night sky and
   nothing else; and the night sky paints an opaque gradient, so it cannot
   share a window with the see-through theme - it would paint over the
   desktop that theme exists to show. */
export function reconcileSky<T extends {
  rain?: boolean; sakura?: boolean; nightSky?: boolean; season?: Season; theme?: Theme
}>(s: T): T {
  if (s.rain) { s.sakura = false; s.nightSky = false }
  else if (s.sakura) { s.nightSky = false }
  if ((s.rain || s.sakura) && seasonActive(s.season ?? 'off')) s.season = 'off'
  if (s.nightSky && s.theme === 'transparent') s.nightSky = false
  return s
}

export function seasonActive(season: Season, now = appDate()): 'newyear' | null {
  if (season === 'off') return null
  if (season === 'newyear') return 'newyear'
  const m = now.getMonth(), d = now.getDate()
  return m === 11 || (m === 0 && d <= 14) ? 'newyear' : null
}
export type Theme = 'default' | 'transparent'
export type FsLayout = 'side' | 'stack' | 'split'
export type Lang = 'ru' | 'en' | 'uk'
export type StartPage = 'main' | 'releases' | 'likes' | 'playlists'

// A named snapshot of the customisable client settings (look, feel, playback DSP).
export type SettingsPreset = { id: string; name: string; data: Record<string, unknown> }

// Which settings a preset captures. Excludes only the machine-specific paths/ids
// (wallpaperPath, outputDeviceId) and the preset lists themselves. closeToTray and
// launchAtStartup are captured too, so applying a preset must re-sync those to the
// main process (the UI does this after applySettingsPreset).
export const SETTINGS_PRESET_KEYS = [
  'theme', 'accent', 'customAccent', 'bgStyle',
  'sidebarWide', 'fsLayout', 'fsShowLyrics', 'fsLiveBg', 'lyricsFontScale', 'wallpaperBlur', 'sakuraBlur', 'sakuraBlurPetals', 'transparencyLevel', 'iconGlow',
  'hiddenNav', 'startPage', 'lang',
  'eq', 'eqEnabled', 'crossfade',
  // The weather is part of a look, so a preset that leaves it out puts back
  // half a look - which is how applying one over the storm used to keep the
  // rain falling on somebody else's colours.
  'rain', 'rainLens', 'rainSurfaces', 'rainClouds', 'rainTheme', 'rainAdvanced',
  'rainWind', 'rainLightning', 'rainSpeed', 'rainFps',
  'closeToTray', 'mediaKeys', 'autoSkipDrm', 'launchAtStartup', 'datadomeBypass', 'autoRadio',
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
// Fails closed: a key this function does not recognise is dropped, not copied.
export function validateSettingsPresetData(d: Record<string, unknown>): Record<string, unknown> {
  const ENUMS: Record<string, readonly string[]> = {
    theme: ['default', 'transparent'],
    accent: [...Object.keys(ACCENT_COLORS), 'artwork', 'custom'],
    bgStyle: ['artwork', 'accent', 'aurora', 'wallpaper'],
    fsLayout: ['side', 'stack', 'split'],
    startPage: ['main', 'releases', 'likes', 'playlists'],
    lang: ['en', 'ru', 'uk'],
  }
  const boolKeys = new Set(['sidebarWide', 'fsShowLyrics', 'fsLiveBg', 'eqEnabled', 'closeToTray', 'mediaKeys', 'autoSkipDrm', 'launchAtStartup', 'datadomeBypass', 'iconGlow', 'autoRadio', 'sakuraBlurPetals',
    'rain', 'rainLens', 'rainSurfaces', 'rainClouds', 'rainTheme', 'rainAdvanced'])
  // Same bounds the sliders enforce; a shared code gets no further.
  const numKeys: Record<string, [number, number]> = { rainWind: [0, 1], rainLightning: [0, 100], rainSpeed: [0.1, 5], rainFps: [20, 120] }
  const out: Record<string, unknown> = {}
  for (const key of SETTINGS_PRESET_KEYS) {
    if (!(key in d)) continue
    const val = d[key]
    if (val === undefined || val === null) continue
    if (key in ENUMS) { if (typeof val === 'string' && ENUMS[key].includes(val)) out[key] = val; continue }
    if (boolKeys.has(key)) { if (typeof val === 'boolean') out[key] = val; continue }
    if (key in numKeys) { const [lo, hi] = numKeys[key]; if (typeof val === 'number' && isFinite(val)) out[key] = Math.max(lo, Math.min(hi, val)); continue }
    if (key === 'customAccent') { const h = normalizeHex(val); if (h) out[key] = h; continue }
    if (key === 'lyricsFontScale') { if (typeof val === 'number' && isFinite(val)) out[key] = Math.max(0.7, Math.min(1.8, val)); continue }
    if (key === 'wallpaperBlur' || key === 'sakuraBlur') { if (typeof val === 'number' && isFinite(val)) out[key] = Math.max(0, Math.min(30, Math.round(val))); continue }
    if (key === 'transparencyLevel') { if (typeof val === 'number' && isFinite(val)) out[key] = Math.max(5, Math.min(95, Math.round(val))); continue }
    if (key === 'crossfade') { if (typeof val === 'number' && isFinite(val)) out[key] = Math.max(0, Math.min(12, val)); continue }
    if (key === 'eq') { if (Array.isArray(val) && val.length === 5 && val.every(n => typeof n === 'number' && isFinite(n))) out.eq = (val as number[]).map(n => Math.max(-12, Math.min(12, Math.round(n)))); continue }
    if (key === 'hiddenNav') { if (Array.isArray(val) && val.every(v => typeof v === 'string')) out.hiddenNav = [...(val as string[])].sort(); continue }
  }
  return out
}

// 5-band EQ centre frequencies (Hz)
export const EQ_BANDS = [60, 250, 1000, 4000, 12000]

export interface SettingsState {
  accent: AccentColor
  customAccent: string     // hex used when accent === 'custom'
  savedAccents: string[]   // the user's own saved accent hexes, newest first
  bgStyle: BgStyle
  theme: Theme
  /* The rail's width. There used to be a "player style" here that bundled
     this together with what the home screen was; home is the player either
     way now, so the only thing left to choose is how much room the rail
     takes. */
  sidebarWide: boolean
  fsLayout: FsLayout
  fsShowLyrics: boolean    // show the lyrics panel on the home screen
  fsLiveBg: boolean        // living artwork background on the home screen
  lyricsFontScale: number  // lyrics font multiplier (1 = default)
  wallpaperBlur: number    // custom wallpaper blur, px (0 = off)
  transparencyLevel: number // transparent theme: 100 = fully clear, lower = denser tint
  iconGlow: boolean        // cursor-tracking glow on action buttons
  wallpaperPath: string
  hiddenNav: string[]      // sidebar nav ids hidden from the rail
  season: Season
  snow: SnowSettings
  rain: boolean            // falling rain over the window, on its own, any time of year
  sakura: boolean          // the blossoming branch and its petals
  /* How far out of focus the branch behind the player is, in pixels.
     Its own setting rather than a share of the wallpaper's: they are two
     different backgrounds and nobody blurring one means the other. The
     petals in front are never blurred - they are the foreground, and a
     soft branch behind sharp petals is the depth the slider is for. */
  sakuraBlur: number
  /* Whether the petals go out of focus with the branch. Off by default:
     sharp petals in front of a soft branch is the depth the blur is for,
     and blurring both just fogs the window. */
  sakuraBlurPetals: boolean
  nightSky: boolean        // clouds, stars and the moon, behind everything
  rainLens: boolean        // drops clinging to the glass, as if it were a lens
  rainSurfaces: boolean    // water collecting on ledges and wetting the artwork
  /* What the look was before a theme was picked from the themes section, so
     "Default" has something to put back. Taken once, on the first theme
     applied over the person's own arrangement, and dropped the moment it is
     restored - a second snapshot would overwrite the thing it is for. */
  themeBackup: Record<string, unknown> | null
  seenWelcome: boolean     // the first-run flow has been through once
  /* The build that was last opened. Empty on anyone arriving from a
     version that did not keep it, which is exactly the signal that they
     have a backlog of news to be shown. Stamped by whichever of the two
     first-run surfaces they actually saw. */
  lastSeenVersion: string
  dateOverride: string     // 'YYYY-MM-DD' to use instead of the system clock, '' to trust it
  rainClouds: boolean      // the storm deck behind everything, and its lightning
  rainTheme: boolean       // hold the accent and the background to match the weather
  rainThemePrev: { accent: AccentColor; customAccent: string; bgStyle: BgStyle } | null   // what to put back
  rainAdvanced: boolean    // show the knobs below - off, they keep their values
  /* How often lightning strikes, 0-100. Not a probability: it scales a
     rate in strikes per second, and 11 is the 0.045/s the storm shipped
     with - about one every twenty-two seconds. Zero is a storm with no
     lightning at all, which is a perfectly good storm. */
  rainLightning: number
  rainWind: number         // 0..1, how far the sheet leans
  rainSpeed: number        // 0.1..5, multiplier on how fast it falls
  rainFps: number          // frames a second, when the knobs are showing
  tree: boolean            // the New Year tree on the left
  garland: boolean         // lights strung across the top, behind the glass
  garlandMode: GarlandMode
  seasonPauseBg: boolean   // freeze seasonal animation while the window is not focused
  seasonEco: boolean       // hold every seasonal layer to the slow frame rate
  meltSignal: number       // bumped to melt whatever has settled, right now
  lang: Lang
  eq: number[]        // gain in dB per band, length 5
  eqEnabled: boolean
  eqPresets: EqPreset[]          // user-created presets
  activePresetId: string | null  // id of the applied preset (null = custom)
  settingsPresets: SettingsPreset[]  // user-created whole-settings presets
  outputDeviceId: string   // '' = system default
  crossfade: number        // crossfade between tracks, seconds (0 = off)
  startPage: StartPage      // page shown on app launch
  closeToTray: boolean     // close button hides to tray instead of quitting
  mediaKeys: boolean       // keyboard playback shortcuts enabled
  /* Keep playing past the end of the queue with tracks like the last one.
     On by default, the way SoundCloud's own autoplay is: the alternative
     is a player that stops dead, which nobody asked for either. */
  autoRadio: boolean
  /* Show the current track on the Discord profile. Deliberately not in
     SETTINGS_PRESET_KEYS: a preset code is something people send each
     other, and switching on a broadcast of what somebody listens to is
     not a thing a shared look should be able to do. */
  discordRpc: boolean
  launchAtStartup: boolean // start the app on Windows login
  /* Transcribe the audio when no catalogue has the words. The key itself is
     not here: it goes straight to the OS keychain in the main process. */
  /* One choice, because there is only one: what times the words. Two
     booleans could say "cloud off, local on", which meant nothing. */
  timing: 'off' | 'local' | 'cloud'
  /* The line above the lyrics: where they came from, and the buttons to
     redo or drop them. On by default because it is the only place the
     player admits a machine was involved. */
  lyricsInfo: boolean
  aiModel: string          // which Gemini listens; see AI_MODELS

  autoSkipDrm: boolean     // automatically skip DRM-protected tracks
  datadomeBypass: boolean  // auto-solve DataDome captcha on a 403 write (default off)
  setAccent: (a: AccentColor) => void
  setCustomAccent: (hex: string) => void
  saveAccent: (hex: string) => void
  removeSavedAccent: (hex: string) => void
  setBgStyle: (b: BgStyle) => void
  setTheme: (th: Theme) => void
  setSidebarWide: (v: boolean) => void
  setFsLayout: (l: FsLayout) => void
  setFsShowLyrics: (v: boolean) => void
  setFsLiveBg: (v: boolean) => void
  setLyricsFontScale: (v: number) => void
  setWallpaperBlur: (v: number) => void
  setSakuraBlur: (v: number) => void
  setSakuraBlurPetals: (v: boolean) => void
  setTransparencyLevel: (v: number) => void
  setIconGlow: (v: boolean) => void
  setWallpaperPath: (p: string) => void
  toggleNavHidden: (id: string) => void
  setSeason: (s: Season) => void
  setSnow: (patch: Partial<SnowSettings>) => void
  setRain: (rain: boolean) => void
  setRainLens: (v: boolean) => void
  setRainSurfaces: (v: boolean) => void
  setSeenWelcome: (v: boolean) => void
  setLastSeenVersion: (v: string) => void
  setDateOverride: (v: string) => void
  setRainClouds: (v: boolean) => void
  setRainTheme: (v: boolean) => void
  setRainAdvanced: (v: boolean) => void
  setRainLightning: (v: number) => void
  setRainWind: (v: number) => void
  setRainSpeed: (v: number) => void
  setRainFps: (v: number) => void
  setTree: (tree: boolean) => void
  setGarland: (garland: boolean) => void
  setGarlandMode: (m: GarlandMode) => void
  setSeasonPauseBg: (v: boolean) => void
  setSeasonEco: (v: boolean) => void
  meltSnow: () => void
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
  setCrossfade: (v: number) => void
  setStartPage: (p: StartPage) => void
  setCloseToTray: (v: boolean) => void
  setAutoRadio: (v: boolean) => void
  setDiscordRpc: (v: boolean) => void
  setMediaKeys: (v: boolean) => void
  setLaunchAtStartup: (v: boolean) => void
  setTiming: (v: SettingsState['timing']) => void
  setLyricsInfo: (v: boolean) => void
  setAiModel: (v: string) => void
  setAutoSkipDrm: (v: boolean) => void
  setDatadomeBypass: (v: boolean) => void
  resetSettings: () => void
}

// Data-only defaults (no actions) - reused for "reset to defaults", and by
// the built-in themes, whose "Default" is this object rather than a second
// copy of it that could drift (src/themes.ts).
export const SETTINGS_DEFAULTS = {
  accent: 'slate' as AccentColor,
  customAccent: '#ff5500',
  savedAccents: [] as string[],
  // Aurora, and slate above - the storm's own palette; see rainTheme.
  bgStyle: 'aurora' as BgStyle,
  theme: 'default' as Theme,
  sidebarWide: true,
  fsLayout: 'side' as FsLayout,
  fsShowLyrics: true,
  fsLiveBg: true,
  lyricsFontScale: 1,
  wallpaperPath: '',
  wallpaperBlur: 0,
  transparencyLevel: 80,
  iconGlow: true,
  hiddenNav: [] as string[],
  season: 'auto' as Season,
  // Defaults sit at the restrained end on purpose - the reference is snow you
  // notice once and then stop seeing, not a snow globe.
  snow: { fall: 'steady', onPanels: true, physics: true } as SnowSettings,
  /* The player opens in the rain. Tuned by hand in the live player and kept
     as it was left, down to the background: a fresh install gets the storm
     that was signed off rather than the first guess at one.
     rainTheme starts on with nothing remembered under it, which is right -
     there is no earlier look to put back, and the accent and background below
     are already the ones it holds. */
  themeBackup: null as Record<string, unknown> | null,
  seenWelcome: false,   // the first-run flow has been through once
  lastSeenVersion: '',
  dateOverride: '',     // trust the machine until told not to
  rain: false,
  sakura: false,
  sakuraBlur: 0,
  sakuraBlurPetals: false,
  nightSky: false,
  rainLens: false,
  rainSurfaces: true,
  rainClouds: true,
  rainTheme: true,
  rainThemePrev: null as { accent: AccentColor; customAccent: string; bgStyle: BgStyle } | null,
  rainAdvanced: true,
  rainLightning: 10,   // exactly the 0.045 strikes/sec the storm shipped with
  rainWind: 0.34,
  rainSpeed: 0.6,
  rainFps: 120,
  tree: true,
  garland: true,
  garlandMode: 'twinkle' as GarlandMode,
  seasonPauseBg: false,
  seasonEco: false,
  meltSignal: 0,
  /* The system's language if it is one of ours, English if it is not.
     Nothing cleverer: the welcome screen still asks, and a wrong guess
     there costs one click. What it buys is that the screen asking the
     question is itself in the right language, which it was not - the
     default was English for everyone, including the people this player
     is mostly written for. */
  lang: ((): Lang => {
    const tag = (typeof navigator !== 'undefined' ? navigator.language : '') || ''
    const two = tag.slice(0, 2).toLowerCase()
    return two === 'ru' || two === 'uk' ? two : 'en'
  })() as Lang,
  eq: [0, 0, 0, 0, 0] as number[],
  eqEnabled: false,
  eqPresets: [] as EqPreset[],
  activePresetId: null as string | null,
  settingsPresets: [] as SettingsPreset[],
  outputDeviceId: '',
  crossfade: 0,
  startPage: 'main' as StartPage,
  closeToTray: true,
  mediaKeys: true,
  autoRadio: true,
  discordRpc: false,
  launchAtStartup: false,
  timing: 'off' as 'off' | 'local' | 'cloud',
  lyricsInfo: true,
  aiModel: 'gemini-3.8-flash',
  autoSkipDrm: true,
  datadomeBypass: false,
}

/* What the storm hands back when it ends.
 *
 * Not inlined in setRain because setRain is only one of the four ways out:
 * sakura, the night sky and any active season each switch the rain off on
 * their own, and each of them used to walk off with the palette. Worse
 * than looking wrong, it stranded the state - rainTheme stayed on with no
 * rain under it, and the switch that would clear it is drawn inside the
 * rain section, so there was nothing left to press.
 * Anything not on loan is left alone: with the match already off the
 * colours are the person's own pick, and rainThemePrev is null anyway. */
function rainHandBack(s: SettingsState): Partial<SettingsState> {
  if (!s.rainTheme) return {}
  return { rainTheme: false, rainThemePrev: null, ...(s.rainThemePrev ?? {}) }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      /* Picking a colour or a background by hand wins and drops the match.
         Left on, the switch would claim to be holding something it is not -
         and putting the hand-picked value back on the next toggle would be
         worse still. */
      setAccent: (accent) => set(s => ({ accent, ...(s.rainTheme ? { rainTheme: false, rainThemePrev: null } : {}) })),
      // Normalised on the way in, so --accent can never receive junk and every
      // comparison against the saved list compares the same spelling.
      setCustomAccent: (hex) => { const h = normalizeHex(hex); if (h) set(s => ({ customAccent: h, ...(s.rainTheme ? { rainTheme: false, rainThemePrev: null } : {}) })) },
      // The saved list is a small personal palette, newest first, deduped and
      // capped so it can never grow into the swatch row forever.
      saveAccent: (hex) => set(s => {
        const h = normalizeHex(hex)
        if (!h || s.savedAccents.includes(h)) return {}
        return { savedAccents: [h, ...s.savedAccents].slice(0, 12) }
      }),
      removeSavedAccent: (hex) => set(s => ({ savedAccents: s.savedAccents.filter(x => x !== hex) })),
      setBgStyle: (bgStyle) => set(s => ({ bgStyle, ...(s.rainTheme ? { rainTheme: false, rainThemePrev: null } : {}) })),
      // An opaque sky in a see-through window would paint over the desktop,
      // which is the one thing that theme exists not to do.
      setTheme: (theme) => set(theme === 'transparent' ? { theme, nightSky: false } : { theme }),
      setSidebarWide: (sidebarWide) => set({ sidebarWide }),
      setFsLayout: (fsLayout) => set({ fsLayout }),
      setFsShowLyrics: (fsShowLyrics) => set({ fsShowLyrics }),
      setFsLiveBg: (fsLiveBg) => set({ fsLiveBg }),
      setLyricsFontScale: (lyricsFontScale) => set({ lyricsFontScale }),
      setWallpaperPath: (wallpaperPath) => set({ wallpaperPath }),
      setWallpaperBlur: (wallpaperBlur) => set({ wallpaperBlur }),
      setSakuraBlur: (sakuraBlur) => set({ sakuraBlur }),
      setSakuraBlurPetals: (sakuraBlurPetals) => set({ sakuraBlurPetals }),
      setTransparencyLevel: (transparencyLevel) => set({ transparencyLevel }),
      setIconGlow: (iconGlow) => set({ iconGlow }),
      /* ── one sky at a time ──────────────────────────────────────────
         Rain, the sakura branch and the night sky each paint the whole
         window, and the winter layer drops snow over all of it. Run two
         together and you get rain through cherry blossom, or a storm deck
         under a moonlit one that hides it outright - so switching one on
         switches the others off rather than leaving that to the person.
         The one pairing that is allowed is snow at night: the night sky is
         a background, not weather, and snow falling through it is the one
         combination that looks better than either alone. */
      setSeason: (season) => set(s => seasonActive(season)
        ? { season, rain: false, sakura: false, ...rainHandBack(s) }
        : { season }),
      setSnow: (patch) => set(s => ({ snow: { ...s.snow, ...patch } })),
      /* The storm borrows the palette and gives it back.
         Switching on brings the match with it: the flag ships on, but
         picking an accent or a background clears it (see setAccent below),
         so on any player that has been themed even once it was off for
         good and the storm came up over somebody else's colours. Asking
         for rain is the moment to ask for the look that goes with it.
         Switching off puts back whatever was there when it started.
         That half was once removed on the grounds that off-then-on left
         the match gone with nothing to restore - true while switching on
         was a no-op, and no longer true now that it re-engages. Borrowing
         and returning only make sense as a pair; one without the other is
         either a palette that never comes back or one that never leaves.
         A match switched off by hand mid-storm is a decision, not a loan,
         so nothing is handed back for it - and it holds until the next
         time the rain is turned on, which is a new storm. */
      setRain: (rain) => set(s => rain
        ? {
            rain, sakura: false, nightSky: false,
            ...(seasonActive(s.season) ? { season: 'off' as Season } : {}),
            /* Guarded on the flag being off. With it already on, accent and
               bgStyle ARE slate and aurora, and filing those as the look to
               put back afterwards would lose the real one. */
            ...(s.rainTheme ? {} : {
              rainTheme: true,
              rainThemePrev: { accent: s.accent, customAccent: s.customAccent, bgStyle: s.bgStyle },
              accent: 'slate' as AccentColor, bgStyle: 'aurora' as BgStyle,
            }),
          }
        : { rain, ...rainHandBack(s) }),
      /* No setSakura/setNightSky any more: nothing called them, and the
         one-sky-at-a-time rule they carried is the same rule reconcileSky
         applies on rehydrate and applyTheme applies on a theme change -
         which is where it belongs, since those are the two paths that can
         actually put two skies up at once. */
      setRainLens: (rainLens) => set({ rainLens }),
      setRainSurfaces: (rainSurfaces) => set({ rainSurfaces }),
      setSeenWelcome: (seenWelcome) => set({ seenWelcome }),
      setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
      /* Through the reconciler, because the date decides whether the winter
         layers are up at all. seasonActive() is read against the clock, so
         changing the override - or simply crossing into December - turns the
         season on without anyone touching a switch, and the one-sky-at-a-time
         rule was only ever applied at the moment a switch was clicked. Rain
         on in July plus an override of 25 December put rain, snow, a tree and
         a garland on screen together, which is the state reconcileSky exists
         to prevent and which no setter could then reach. */
      setDateOverride: (dateOverride) => set(s => reconcileSky({ ...s, dateOverride })),
      setRainClouds: (rainClouds) => set({ rainClouds }),
      /* One switch over the three settings that have to agree with the
         weather: a slate accent, the aurora background, and - through
         --aurora-rgb in the player - RAIN_SKY as the colour that aurora is
         built from. The sky and the accent are different colours on purpose,
         which is why the gradient reads its own variable rather than the
         accent. What was there before is kept and put back on the way out. */
      setRainTheme: (on) => set(s => on
        ? {
            rainTheme: true,
            rainThemePrev: { accent: s.accent, customAccent: s.customAccent, bgStyle: s.bgStyle },
            accent: 'slate' as AccentColor, bgStyle: 'aurora' as BgStyle,
          }
        : { rainTheme: false, rainThemePrev: null, ...(s.rainThemePrev ?? {}) }),
      setRainAdvanced: (rainAdvanced) => set({ rainAdvanced }),
      setRainLightning: (rainLightning) => set({ rainLightning }),
      setRainWind: (rainWind) => set({ rainWind }),
      setRainSpeed: (rainSpeed) => set({ rainSpeed }),
      setRainFps: (rainFps) => set({ rainFps }),
      setTree: (tree) => set({ tree }),
      setGarland: (garland) => set({ garland }),
      setGarlandMode: (garlandMode) => set({ garlandMode }),
      setSeasonPauseBg: (seasonPauseBg) => set({ seasonPauseBg }),
      setSeasonEco: (seasonEco) => set({ seasonEco }),
      meltSnow: () => set(s => ({ meltSignal: s.meltSignal + 1 })),
      toggleNavHidden: (id) => set(s => ({
        hiddenNav: s.hiddenNav.includes(id) ? s.hiddenNav.filter(x => x !== id) : [...s.hiddenNav, id],
      })),
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
        if (!p) return {}
        /* Validated on the way out, not only on the way in. A preset saved
           by an older build is a stored copy of that build's vocabulary,
           and this one dropped several values - theme 'glass', bgStyle
           'midnight', startPage 'stream'. onRehydrateStorage repairs the
           live state on upgrade but never looks inside the saved presets,
           so clicking one wrote a theme no stylesheet answers to straight
           back into the store: every glassy surface fell through to
           unstyled and the pickers showed nothing selected. The validator
           fails closed, so an unrecognised value is simply left alone. */
        const patch = validateSettingsPresetData(p.data as Record<string, unknown>) as Partial<SettingsState>
        /* A preset carries the weather but not the branch or the night sky,
           so applying one can leave rain running under a sky that was
           already up. Reconciled against what is live, not against the
           preset alone. */
        const sky = reconcileSky({
          rain: patch.rain ?? s.rain, sakura: s.sakura, nightSky: s.nightSky,
          season: patch.season ?? s.season, theme: patch.theme ?? s.theme,
        })
        /* A preset carries the match along with the accent and background it
           goes with, so after applying one the preset IS the look and there
           is no earlier one on loan. Left as it was, a stale rainThemePrev
           from before the preset would be handed back the next time the rain
           stopped, and the background would jump somewhere nobody chose. */
        return { ...patch, ...sky, rainThemePrev: null }
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
      setCrossfade: (crossfade) => set({ crossfade }),
      setStartPage: (startPage) => set({ startPage }),
      setCloseToTray: (closeToTray) => set({ closeToTray }),
      setMediaKeys: (mediaKeys) => set({ mediaKeys }),
      setAutoRadio: (autoRadio) => set({ autoRadio }),
      setDiscordRpc: (discordRpc) => set({ discordRpc }),
      setLaunchAtStartup: (launchAtStartup) => set({ launchAtStartup }),
      setTiming: (timing) => set({ timing }),
      setLyricsInfo: (lyricsInfo) => set({ lyricsInfo }),
      setAiModel: (aiModel) => set({ aiModel }),
      setAutoSkipDrm: (autoSkipDrm) => set({ autoSkipDrm }),
      setDatadomeBypass: (datadomeBypass) => set({ datadomeBypass }),
      /* Settings, not belongings. The preset lists are things the person
         made - the preset-key list is already documented as excluding
         them - and the first-run flags are a record of what has happened,
         not a preference. The dialog promises "theme, background,
         shortcuts, language"; this now keeps that promise. */
      resetSettings: () => set(s => ({
        ...SETTINGS_DEFAULTS,
        eqPresets: s.eqPresets,
        settingsPresets: s.settingsPresets,
        savedAccents: s.savedAccents,
        seenWelcome: s.seenWelcome,
        lastSeenVersion: s.lastSeenVersion,
      })),
    }),
    {
      name: 'sc-settings',
      onRehydrateStorage: () => (state) => {
        /* Somebody updating is not somebody new.
         *
         * `seenWelcome` arrived with the first-run flow in 2.0, so it is
         * missing from everything written by 1.3.x - and a missing key
         * falls back to its default, which is false. That made every
         * upgrade look like a fresh install: the player greeted people who
         * had been using it for months and then told them what was new in
         * a version they had supposedly never had.
         *
         * Settings that exist at all mean the player has been run before.
         * Settings that exist WITHOUT this key mean they were written by a
         * build that had no first run to skip. */
        if (state && state.seenWelcome === false) {
          let raw: string | null = null
          try { raw = localStorage.getItem('sc-settings') } catch { /* no storage */ }
          if (settingsPredateFirstRun(raw)) state.seenWelcome = true
        }
        // Ensure eq array exists with 5 bands (older persisted state)
        if (state && (!Array.isArray(state.eq) || state.eq.length !== 5)) {
          state.eq = [0, 0, 0, 0, 0]
        }
        // The home animation and the two artwork toggles were removed; drop
        // whatever older builds left in storage so dead keys do not linger.
        if (state) {
          const dead = state as unknown as Record<string, unknown>
          delete dead.heroAnim; delete dead.fsBeatGlow; delete dead.fsArtCrossfade
          /* Two booleans became one choice. Carry over what the old pair
             meant, preferring the local path when both were on: it is the
             one that needs no key and sends nothing anywhere. */
          if (dead.timing === undefined) {
            state.timing = dead.localAlign ? 'local' : dead.aiLyrics ? 'cloud' : 'off'
          }
          delete dead.aiLyrics; delete dead.localAlign
          // 'Accumulate' never meant what it said: it only muted the steady
          // fill, while flakes landing on a ledge still built the drift up.
          // One honest switch is left - 'settle on panels'.
          const sn = dead.snow as Record<string, unknown> | undefined
          // 'Behind panels' only had an effect in the default theme, where the
          // glass could blur what passed under it; in the transparent one, where
          // backdrop-filter is switched off, it just made flakes disappear
          // behind a panel. Snow is over everything now.
          // 'Quality' measured out at nothing: the tree never read it, the
          // garland only dimmed its glow by it, and the flake count it did
          // scale was 19 against 74 sprites - noise next to everything else.
          if (sn) { delete sn.accumulate; delete sn.behind; delete sn.quality }
        }
        /* The stream page is gone. Anyone who had it as their start page
           would otherwise open the app on a page nothing renders, with no
           obvious way out but to find another one in settings. */
        if (state && (state.startPage as string) === 'stream') state.startPage = 'main'
        // Themes and backgrounds were trimmed to one coherent look: anything
        // persisted from the removed options falls back to the nearest survivor
        // instead of leaving the app in a state it can no longer render.
        if (state && !['default', 'transparent'].includes(state.theme)) {
          state.theme = 'default'
        }
        if (state && !['artwork', 'accent', 'aurora', 'wallpaper'].includes(state.bgStyle)) {
          state.bgStyle = 'aurora'
        }
        /* playerStyle is gone. It said two things at once - how wide the
           rail is and whether home was the player - and only the first is
           still a choice. Carried over by what the person actually had on
           screen: the old default style drew a 208px rail, fullscreen drew
           72px. A profile written before this lands keeps its rail. */
        if (state) {
          const old = (state as unknown as { playerStyle?: string }).playerStyle
          if (typeof state.sidebarWide !== 'boolean') {
            state.sidebarWide = old === undefined ? true : old !== 'fullscreen'
          }
          delete (state as unknown as { playerStyle?: string }).playerStyle
        }
        if (state && !['side', 'stack', 'split'].includes(state.fsLayout)) {
          state.fsLayout = 'side'
        }
        if (state && (typeof state.lyricsFontScale !== 'number' || !(state.lyricsFontScale >= 0.7 && state.lyricsFontScale <= 1.8))) {
          state.lyricsFontScale = 1
        }
        // The custom accent is a raw hex in localStorage, so a hand-edited or
        // half-written value must not reach --accent.
        if (state && !normalizeHex(state.customAccent)) {
          state.customAccent = '#ff5500'
        }
        // Storage written before the rule existed can hold rain over winter,
        // or a night sky in a see-through window. Straightened on the way in,
        // so nobody has to find the switch that is fighting the other one.
        if (state) reconcileSky(state)
        if (state) {
          state.savedAccents = Array.isArray(state.savedAccents)
            ? state.savedAccents.map(normalizeHex).filter((h): h is string => !!h).slice(0, 12)
            : []
        }
      },
    }
  )
)

// 'artwork' is a dynamic colour derived from the current artwork - no fixed hex
export const ACCENT_COLORS: Record<Exclude<AccentColor, 'artwork' | 'custom'>, string> = {
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

// Accepts '#rgb', '#rrggbb' or either without the '#', in any case. Returns a
// normalised '#rrggbb', or null when it is not a colour at all. Everything that
// reaches customAccent (a text field, an imported preset code) goes through
// this first, so a malformed value can never end up in a CSS variable.
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(s)) return '#' + s.split('').map(c => c + c).join('').toLowerCase()
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s.toLowerCase()
  return null
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = (normalizeHex(hex) ?? '#ff5500').slice(1)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

// The single source of truth for "what colour is the accent right now".
// Every surface that paints with the accent resolves through this, so adding a
// mode ('custom' here) can never leave some component silently falling back to
// orange because it did its own ACCENT_COLORS[accent] lookup.
export function resolveAccentHex(accent: AccentColor, customAccent: string, artRgb: number[]): string {
  if (accent === 'artwork') return rgbToHex(artRgb[0] ?? 255, artRgb[1] ?? 85, artRgb[2] ?? 0)
  if (accent === 'custom') return normalizeHex(customAccent) ?? ACCENT_COLORS.orange
  return ACCENT_COLORS[accent] ?? ACCENT_COLORS.orange
}

// Hook form of resolveAccentHex for components that just need the colour.
export function useAccentHex(): string {
  const accent = useSettings(s => s.accent)
  const customAccent = useSettings(s => s.customAccent)
  const artRgb = useUI(s => s.artRgb)
  return resolveAccentHex(accent, customAccent, artRgb)
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      page: 'main',
      playlistsSubPage: 'playlists',
      playlistReturnPage: 'playlists',
      selectedPlaylist: null,
      selectedAlbum: null,
      searchQuery: '',
      searchTab: 'all',
      bgColor: '#080808',
      artRgb: [80, 80, 80] as [number, number, number],
      trackOrder: 'newest',
      showTrackPage: false,
      showQueue: false,
      artistPageUser: null,
      overlayOrder: [],
      artistHistory: [],
      playlistPickerTrack: null,
      setPlaylistPickerTrack: (playlistPickerTrack) => set({ playlistPickerTrack }),
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),
      showWelcome: false,
      setShowWelcome: (showWelcome) => set({ showWelcome }),
      showNews: false,
      setShowNews: (showNews) => set({ showNews }),
      news: null,
      setNews: (news) => set({ news }),
      settingsTab: null,
      openSettings: (tab) => set({ showSettings: true, settingsTab: tab ?? null }),
      contextMenu: null,
      setContextMenu: (contextMenu) => set({ contextMenu }),
      confirmAsk: null,
      /* First asker owns the dialog until it is answered. A second ask used
         to overwrite the first - the text changed while the button stayed
         under the cursor, and the first promise was dropped and never
         settled. That is a nuisance between two local prompts and a hole
         when one of them is "let this Telegram account in": a stranger
         messaging the bot could slide their own request under a click
         already on its way down. A late asker is refused, not queued, so
         nothing can displace what is on screen. */
      askConfirm: (message, confirmLabel, danger) => new Promise<boolean>(resolve => {
        if (get().confirmAsk) { resolve(false); return }
        set({ confirmAsk: { message, confirmLabel, danger, resolve } })
      }),
      answerConfirm: (ok) => {
        const pending = get().confirmAsk
        set({ confirmAsk: null })
        pending?.resolve(ok)
      },
      playlistMenu: null,
      setPlaylistMenu: (playlistMenu) => set({ playlistMenu }),
      artistMenu: null,
      setArtistMenu: (artistMenu) => set({ artistMenu }),
      sidebarMenu: null,
      setSidebarMenu: (sidebarMenu) => set({ sidebarMenu }),
      bgMenu: null,
      setBgMenu: (bgMenu) => set({ bgMenu }),
      editMode: false,
      railFolded: false,
      setRailFolded: (railFolded) => set({ railFolded }),
      editFromSettings: false,
      editTarget: null,
      clearEditTarget: () => set({ editTarget: null }),
      setEditMode: (editMode, fromSettings = false, target = null) =>
        set(editMode ? { editMode, editFromSettings: fromSettings, editTarget: target } : { editMode, editTarget: null }),
      editCloseSignal: 0,
      closeEditMode: () => set(s => ({ editCloseSignal: s.editCloseSignal + 1 })),
      albumMenu: null,
      setAlbumMenu: (albumMenu) => set({ albumMenu }),
      setPage: (page) => set({ page }),
      setSelectedPlaylist: (pl) => set(s => ({ selectedPlaylist: pl, page: 'playlist-detail', playlistsSubPage: 'playlist-detail', playlistReturnPage: s.page === 'playlist-detail' ? s.playlistReturnPage : s.page })),
      setSelectedAlbum: (selectedAlbum) => set(s => ({ selectedAlbum, overlayOrder: [...s.overlayOrder.filter(k => k !== 'album'), ...(selectedAlbum ? ['album' as const] : [])] })),
      goToPlaylists: () => set(s => ({ page: s.playlistsSubPage })),
      backFromPlaylist: () => set(s => ({ page: s.playlistReturnPage, playlistsSubPage: 'playlists' })),
      setSearch: (q) => set({ searchQuery: q }),
      setSearchTab: (searchTab) => set({ searchTab }),
      setBgColor: (c) => set({ bgColor: c }),
      setArtRgb: (artRgb) => set({ artRgb }),
      setTrackOrder: (trackOrder) => set({ trackOrder }),
      setShowTrackPage: (showTrackPage) => set(s => ({ showTrackPage, overlayOrder: [...s.overlayOrder.filter(k => k !== 'track'), ...(showTrackPage ? ['track' as const] : [])] })),
      setShowQueue: (showQueue) => set({ showQueue }),
      // Fresh open (or close) - clears any drill history
      setArtistPage: (artistPageUser) => set(s => ({ artistPageUser, artistHistory: [], overlayOrder: [...s.overlayOrder.filter(k => k !== 'artist'), ...(artistPageUser ? ['artist' as const] : [])] })),
      // Drill deeper (following/followers) - remember where we were for Back
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
  /** Returns the toast id so long jobs can update it in place. `sticky` toasts
   *  stay until dismissed - used for progress ("Converting 42%"). */
  show: (message: string, type?: ToastType, sticky?: boolean) => number
  update: (id: number, message: string, type?: ToastType) => void
  dismiss: (id: number) => void
}

// ── Lyrics availability (powers the "L" badge) ──────────────────────────────
/* ── What a scan remembers ───────────────────────────────────────────────
   `available[id]` is three-valued on purpose: true means words were found,
   false means we looked and there were none, and a missing key means we
   never looked. Without the middle state every rescan would walk the same
   dead tracks again, which on a few hundred of them is the difference
   between a minute and twenty.

   It is written per track, not at the end of a run: persist flushes on
   every set, so a crash halfway through costs the track in flight and
   nothing else. */
/* ── A scan in flight ────────────────────────────────────────────────────
   Deliberately a store and not component state: the panel that shows it
   lives in a popover, and closing the popover - or switching to another
   playlist - must not stop a run or lose what it has done so far. */
export type ScanMode = 'catalog' | 'local' | 'cloud'
export type ScanStage = 'genius' | 'align' | 'model' | ''

interface ScanState {
  running: boolean
  mode: ScanMode | null
  total: number
  done: number
  found: number
  missing: number
  track: string
  stage: ScanStage
  cancelled: boolean
  /** Why the run stopped early, when it did. */
  failed: string
  startedAt: number
  /** When the last track finished, and a smoothed seconds-per-track built
   *  from the recent ones. See `tick` for why a plain average will not do. */
  lastAt: number
  pace: number
  start: (mode: ScanMode, total: number) => void
  now: (track: string, stage: ScanStage) => void
  tick: (found: boolean, track: string) => void
  cancel: () => void
  fail: (why: string) => void
  finish: () => void
}

export const useScan = create<ScanState>((set) => ({
  running: false,
  mode: null,
  total: 0,
  done: 0,
  found: 0,
  missing: 0,
  track: '',
  stage: '',
  cancelled: false,
  failed: '',
  startedAt: 0,
  lastAt: 0,
  pace: 0,
  start: (mode, total) => set({
    running: true, mode, total, done: 0, found: 0, missing: 0,
    track: '', stage: '', cancelled: false, failed: '',
    startedAt: Date.now(), lastAt: Date.now(), pace: 0,
  }),
  now: (track, stage) => set({ track, stage }),
  /* The pace is smoothed over the recent tracks rather than averaged over
     the whole run, and that is the whole point of it.
     
     Tracks in one list cost wildly different amounts: a cached result or a
     song Genius does not have is over in a second, while one that has to
     be downloaded and put through the model is forty. An average over
     everything so far is dominated by whatever came first, so a run that
     opened with a handful of quick misses predicted twenty minutes and
     took fifty. A trailing figure forgets the fast start within about ten
     tracks and tracks what the run is actually doing now. */
  tick: (found, track) => set(s => {
    const at = Date.now()
    const dt = Math.max(0, (at - (s.lastAt || s.startedAt || at)) / 1000)
    return {
      done: s.done + 1,
      found: s.found + (found ? 1 : 0),
      missing: s.missing + (found ? 0 : 1),
      track,
      lastAt: at,
      pace: s.pace ? s.pace * 0.7 + dt * 0.3 : dt,
    }
  }),
  cancel: () => set({ cancelled: true }),
  fail: (failed: string) => set({ failed, cancelled: true }),
  finish: () => set({ running: false, stage: '', track: '' }),
}))

/* What the lyrics button is doing at this moment. Separate from the
   timing log, which records how long each step took after the fact: this
   is for the person watching the spinner, who wants to know whether the
   thirty seconds are being spent on the network or on the maths. */
export type AiStage = '' | 'genius' | 'download' | 'decode' | 'local' | 'cloud'
export const useAiStage = create<{ stage: AiStage; set: (s: AiStage) => void }>((set) => ({
  stage: '',
  set: (stage) => set({ stage }),
}))

/* Where a "yes" came from. A file on disk can be checked - and so can its
   absence; a live LRCLIB hit cannot, because nothing is written for it.
   Keeping the two apart is the whole reason refresh can clean up stale
   badges without throwing away the ones that were never going to have a
   file in the first place. */
export type LyricsSrc = 'file' | 'live'

interface LyricsState {
  available: Record<number, boolean>
  src: Record<number, LyricsSrc>
  mark: (trackId: number, has: boolean, from?: LyricsSrc) => void
  /** Everything we know about a set of tracks, for the pre-scan summary. */
  counts: (ids: number[]) => { scanned: number; found: number; fresh: number }
  /** Forget a set, so "scan everything again" really does. */
  forget: (ids: number[]) => void
  /** Mark everything we have files for. Repairs a map that lost entries. */
  markMany: (ids: number[]) => void
  /** Make the marks agree with the files on disk, both ways. */
  reconcile: (ids: number[]) => void
  /** Forget the lot. For when the evidence behind every mark is deleted. */
  clear: () => void
}
/* delete without mutating - the one thing a spread cannot do inline. */
function omitKey<T>(obj: Record<number, T>, key: number): Record<number, T> {
  const { [key]: _gone, ...rest } = obj
  return rest as Record<number, T>
}

export const useLyrics = create<LyricsState>()(
  persist(
    (set, get) => ({
      available: {},
      src: {},
      mark: (trackId, has, from = 'live') => set(s => {
        const sameMark = s.available[trackId] === has
        const sameSrc = !has || s.src[trackId] === from
        if (sameMark && sameSrc) return s
        return {
          available: { ...s.available, [trackId]: has },
          // Only a yes has a source worth keeping; a no is a no either way.
          src: has ? { ...s.src, [trackId]: from } : omitKey(s.src, trackId),
        }
      }),
      counts: (ids) => {
        const a = get().available
        let scanned = 0
        let found = 0
        for (const id of ids) {
          if (a[id] === undefined) continue
          scanned++
          if (a[id]) found++
        }
        return { scanned, found, fresh: ids.length - scanned }
      },
      markMany: (ids) => set(s => {
        let changed = false
        const next = { ...s.available }
        const srcs = { ...s.src }
        for (const id of ids) {
          if (next[id] !== true) { next[id] = true; changed = true }
          if (srcs[id] !== 'file') { srcs[id] = 'file'; changed = true }
        }
        return changed ? { available: next, src: srcs } : s
      }),
      forget: (ids) => set(s => {
        const next = { ...s.available }
        const srcs = { ...s.src }
        for (const id of ids) { delete next[id]; delete srcs[id] }
        return { available: next, src: srcs }
      }),
      /* The badges are a cache of what the files on disk say, and markMany
         can only ever add - so wiping the cache left every "L" standing
         with nothing behind it. Nothing is a truer answer than a stale
         yes: the marks come back as tracks are played or scanned. */
      clear: () => set({ available: {}, src: {} }),
      /* What refresh needs and markMany cannot do: make the badges agree
         with reality in both directions, without throwing away the ones
         reality has no file for.

         A yes from a file is only as good as the file: gone means gone.
         A yes from a live LRCLIB hit never had a file, so its absence
         proves nothing and it stays - re-asking LRCLIB for a whole
         library on every refresh is not a trade worth making, and the
         mark came from an answer, not a guess.

         A yes with no recorded source predates this and cannot be
         vouched for, so it goes. Those are exactly the badges that got
         stuck with nothing behind them.

         A recorded no survives whatever its source: it shows nothing, so
         it cannot be the wrong badge anybody is looking at, and dropping
         it would make every refresh offer to rescan the whole library. */
      reconcile: (ids) => set(s => {
        const next: Record<number, boolean> = {}
        const srcs: Record<number, LyricsSrc> = {}
        for (const [key, has] of Object.entries(s.available)) {
          const id = Number(key)
          if (has === false) { next[id] = false; continue }
          if (s.src[id] === 'live') { next[id] = true; srcs[id] = 'live' }
        }
        for (const id of ids) { next[id] = true; srcs[id] = 'file' }
        return { available: next, src: srcs }
      }),
    }),
    {
      name: 'sc-lyrics',
      version: 4, // bumped to drop stale availability after matching changes
      migrate: () => ({ available: {}, src: {} }),
      partialize: (s) => ({ available: s.available, src: s.src }),
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
  show: (message, type = 'info', sticky = false) => {
    const id = ++_toastId
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }))
    if (!sticky) setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3000)
    return id
  },
  update: (id, message, type) => set(s => ({
    toasts: s.toasts.map(t => (t.id === id ? { ...t, message, type: type ?? t.type } : t)),
  })),
  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))

/* ── what the player has actually been used for ───────────────────────────
 *
 * Deliberately its own store, not a corner of settings. These are records
 * of what happened rather than preferences, so "reset all settings" must
 * not wipe them and a shared settings preset must not carry someone else's
 * listening history around.
 *
 * `listenedSec` is written in chunks, not continuously: persist flushes on
 * every set, and timeupdate fires several times a second, so counting
 * straight into the store would mean a localStorage write four times a
 * second for as long as the music plays. useAudio accumulates and hands
 * over roughly every quarter minute. */
export interface StatsState {
  listenedSec: number                  // total, seconds
  byDay: Record<string, number>        // local YYYY-MM-DD -> seconds
  artists: Record<string, number>      // artist name -> seconds
  plays: number                        // tracks started, monotonic
  firstAt: number                      // ms of the first second ever counted
  /* Ids, not tracks. The only thing that reads this is the radio's
     "don't offer what was just heard" filter, which needs nothing but the
     id - and persist writes the whole store on every set, which here is
     every fifteen seconds of listening plus every track change. Sixty
     full v2 track objects, each carrying its transcodings with long signed
     urls, its user and its description, is a few hundred kilobytes
     serialised on the UI thread a couple of hundred times an hour, into
     the same localStorage budget the profile store deliberately keeps
     clear by never persisting its likes. */
  played: number[]                     // most recent first, deduped
  addListened: (sec: number, artist?: string) => void
  notePlayed: (t: SCTrack) => void
  resetStats: () => void
}

export const PLAYED_MAX = 60
/* Roughly a year of daily buckets and a few hundred artists. Both are
   bounded so the record cannot grow without end, and both are pruned from
   the far end, which is the part nobody looks at. */
const DAYS_MAX = 420
const ARTISTS_MAX = 240
/* No single hand-over may claim more than this. The banked chunk is ~15s;
   anything near a minute means a clock jumped, not that music played. */
const CHUNK_MAX = 90

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function prune<T>(rec: Record<string, T>, max: number, rank: (k: string, v: T) => number): Record<string, T> {
  const keys = Object.keys(rec)
  if (keys.length <= max) return rec
  const kept = keys.sort((x, y) => rank(y, rec[y]) - rank(x, rec[x])).slice(0, max)
  const out: Record<string, T> = {}
  for (const k of kept) out[k] = rec[k]
  return out
}

export const useStats = create<StatsState>()(
  persist(
    (set) => ({
      listenedSec: 0,
      byDay: {},
      artists: {},
      plays: 0,
      firstAt: 0,
      played: [],

      /* The one place the total grows. Everything the account tab shows is
         derived from these three numbers, so this is also the only place
         that has to be honest. Negative, non-finite and implausibly large
         hand-overs are dropped rather than clamped: a bad value means the
         caller's clock misbehaved, and inventing a smaller lie in its place
         is not better than counting nothing. */
      addListened: (sec, artist) => set(s => {
        if (!isFinite(sec) || sec <= 0 || sec > CHUNK_MAX) return {}
        const day = todayKey()
        const byDay = { ...s.byDay, [day]: (s.byDay[day] ?? 0) + sec }
        const artists = artist
          ? { ...s.artists, [artist]: (s.artists[artist] ?? 0) + sec }
          : s.artists
        return {
          listenedSec: s.listenedSec + sec,
          firstAt: s.firstAt || Date.now(),
          byDay: prune(byDay, DAYS_MAX, (k) => Date.parse(k) || 0),
          artists: prune(artists, ARTISTS_MAX, (_k, v) => v as number),
        }
      }),

      notePlayed: (t) => set(s => ({
        plays: s.plays + 1,
        played: [t.id, ...s.played.filter(id => id !== t.id)].slice(0, PLAYED_MAX),
      })),

      resetStats: () => set({ listenedSec: 0, byDay: {}, artists: {}, plays: 0, firstAt: 0, played: [] }),
    }),
    {
      name: 'sc-stats',
      /* Repaired, never discarded. A single bad field used to be a reason to
         zero the whole thing, and a counter that silently resets is worse
         than no counter: you stop believing it. */
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const num = (v: unknown, min = 0) =>
          typeof v === 'number' && isFinite(v) && v >= min ? v : 0
        state.listenedSec = num(state.listenedSec)
        state.plays = num(state.plays)
        state.firstAt = num(state.firstAt)
        /* Older builds stored whole tracks here. Keep the history rather
           than drop it: take the ids out and throw the rest away. */
        state.played = Array.isArray(state.played)
          ? (state.played as unknown[])
              .map(v => (typeof v === 'number' ? v : Number((v as { id?: unknown })?.id)))
              .filter(n => Number.isSafeInteger(n) && n > 0)
              .slice(0, PLAYED_MAX)
          : []
        const clean = (rec: unknown): Record<string, number> => {
          if (!rec || typeof rec !== 'object') return {}
          const out: Record<string, number> = {}
          for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
            if (typeof v === 'number' && isFinite(v) && v > 0) out[k] = v
          }
          return out
        }
        state.byDay = clean(state.byDay)
        state.artists = clean(state.artists)
        /* An older build counted only the total. Give those seconds a home
           so the per-day views do not start by contradicting the headline. */
        if (state.listenedSec > 0 && Object.keys(state.byDay).length === 0) {
          state.byDay = { [todayKey()]: state.listenedSec }
        }
        if (state.listenedSec > 0 && !state.firstAt) state.firstAt = Date.now()
      },
    },
  ),
)
