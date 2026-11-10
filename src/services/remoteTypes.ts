// Shapes shared between the renderer and the main-process Telegram remote.
// Kept apart from electron/remote.ts so the renderer never pulls main-process
// code into its bundle just to know what a status object looks like.

export type RemoteState = 'off' | 'no-token' | 'starting' | 'online' | 'bad-token' | 'conflict' | 'network'

export interface RemoteStatusView {
  state: RemoteState
  botUsername?: string
  detail?: string
  allowed: number[]
  pending: { id: number; name: string } | null
}

export interface RemoteConfigView {
  enabled: boolean
  allowed: number[]
  hasToken: boolean
  status: RemoteStatusView
}

export interface RemoteListItem {
  id: string
  title: string
  artist: string
  /** Search results only: where the hit came from. A track that sits in likes
   *  and in two playlists is reported three times, once per place, because
   *  "where did you find it" is the whole point of the grouping. */
  from?: 'likes' | 'playlist'
  playlist?: string
  /** Playlist rows only: how many tracks are in it. */
  count?: number
  /** A thumbnail, sized here. Drawn by the Mini App; the bot ignores it. */
  art?: string
  /** Track length in seconds. */
  dur?: number
}

export type RemoteListKind = 'queue' | 'likes' | 'search' | 'global' | 'playlists' | 'playlist'

export interface RemoteListRequest {
  id: number
  kind: RemoteListKind
  query?: string
  playlistId?: string
  sort?: 'newest' | 'oldest'
  offset: number
  limit: number
}

/** What the settings panel needs to describe the Mini App: whether the
 *  tunnel is up, the address it handed out, and whether cloudflared is here
 *  yet. One shape, because three separate questions can disagree. */
export interface MiniAppStatusView {
  state: 'off' | 'fetching' | 'starting' | 'up' | 'failed'
  url: string | null
  have: boolean
  bytes: number
  dir: string
}
