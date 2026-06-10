import axios from 'axios'

export interface SCUser {
  id: number
  username: string
  full_name: string
  avatar_url: string
  followers_count: number
  followings_count: number
  track_count: number
  playlist_count: number
  permalink_url: string
  description?: string
  city?: string
  country_code?: string
}

export interface SCTrack {
  id: number
  title: string
  duration: number
  user: SCUser
  artwork_url: string | null
  stream_url: string | null
  media?: { transcodings: SCTranscoding[] }
  playback_count: number
  likes_count: number
  reposts_count: number
  comment_count: number
  genre: string
  tag_list: string
  permalink_url: string
  created_at: string
  description?: string
}

export interface SCComment {
  id: number
  body: string
  timestamp: number | null
  created_at: string
  user: SCUser
}

interface SCTranscoding {
  url: string
  preset: string
  format: { protocol: string; mime_type: string }
}

export interface SCPlaylist {
  id: number
  title: string
  artwork_url: string | null
  user: SCUser
  tracks: SCTrack[]
  track_count: number
  duration: number
  permalink_url: string
}

export interface SCCollection<T> {
  collection: T[]
  next_href: string | null
}

const API = 'https://api-v2.soundcloud.com'

class SoundCloudService {
  private clientId: string = ''
  private oauthToken: string = ''
  private userId: number = 0

  setCredentials(clientId: string, oauthToken?: string, userId?: number) {
    this.clientId = clientId
    if (oauthToken) this.oauthToken = oauthToken
    if (userId) this.userId = userId
  }

  private get headers() {
    // Note: Origin/Referer are forbidden headers in the renderer — Chromium drops
    // them with a console warning, so we don't set them here. Requests work with
    // client_id + OAuth token alone.
    const h: Record<string, string> = {}
    if (this.oauthToken) h['Authorization'] = `OAuth ${this.oauthToken}`
    return h
  }

  private async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await axios.get(`${API}${path}`, {
      params: { client_id: this.clientId, ...params },
      headers: this.headers
    })
    return res.data
  }

  async getMe(): Promise<SCUser> {
    return this.get<SCUser>('/me')
  }

  async getLikes(userId: number, limit = 50): Promise<SCCollection<SCTrack>> {
    return this.get<SCCollection<SCTrack>>(`/users/${userId}/track_likes`, { limit })
  }

  async getPlaylists(userId: number): Promise<SCCollection<SCPlaylist>> {
    return this.get<SCCollection<SCPlaylist>>(`/users/${userId}/playlists`, { limit: 50 })
  }

  async getStream(limit = 50): Promise<SCCollection<{ track: SCTrack }>> {
    return this.get(`/stream`, { limit })
  }

  async getFollowings(userId: number, limit = 200): Promise<SCCollection<SCUser>> {
    return this.get<SCCollection<SCUser>>(`/users/${userId}/followings`, { limit })
  }

  // Recent releases feed: latest tracks from followed artists, merged & sorted.
  async getReleases(userId: number, artistLimit = 60, perArtist = 4): Promise<SCTrack[]> {
    const following = await this.getFollowings(userId, artistLimit)
    const artists = (following.collection ?? []).slice(0, artistLimit)
    const all: SCTrack[] = []
    const CONC = 6
    let idx = 0
    const worker = async () => {
      while (idx < artists.length) {
        const a = artists[idx++]
        try {
          const res = await this.getUserTracks(a.id, perArtist)
          for (const t of res.collection ?? []) all.push(t)
        } catch { /* skip */ }
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker))
    // Dedupe by id, sort newest first
    const seen = new Set<number>()
    return all
      .filter(t => t && !seen.has(t.id) && seen.add(t.id))
      .sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime())
  }

  async searchTracks(q: string, limit = 30): Promise<SCCollection<SCTrack>> {
    return this.get<SCCollection<SCTrack>>('/search/tracks', { q, limit })
  }

  async getPlaylist(id: number): Promise<SCPlaylist> {
    return this.get<SCPlaylist>(`/playlists/${id}`)
  }

  // Fetch full track data for a list of IDs (batches of 50)
  async getTracksByIds(ids: number[]): Promise<SCTrack[]> {
    if (!ids.length) return []
    const BATCH = 50
    const results: SCTrack[] = []
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH)
      const res = await this.get<SCTrack[]>('/tracks', { ids: batch.join(',') })
      results.push(...res)
    }
    return results
  }

  // Fill in stub tracks (those without title/duration) in a playlist
  async hydratePlaylistTracks(tracks: SCTrack[]): Promise<SCTrack[]> {
    const stubIds = tracks
      .filter(t => !t.title || !t.duration || !t.media?.transcodings?.length)
      .map(t => t.id)

    if (!stubIds.length) return tracks

    const full = await this.getTracksByIds(stubIds)
    const fullMap = new Map(full.map(t => [t.id, t]))

    return tracks.map(t => fullMap.get(t.id) ?? t)
  }

  async getStreamUrl(track: SCTrack): Promise<string> {
    let transcodings = track.media?.transcodings ?? []

    // If transcodings missing, fetch full track to get them
    if (!transcodings.length) {
      try {
        const full = await this.getTrack(track.id)
        transcodings = full.media?.transcodings ?? []
      } catch {}
    }

    // Only `progressive` (plain MP3) is directly playable in an <audio> element.
    // Encrypted HLS variants (cbc/ctr/cenc) are DRM-protected and can't be played here.
    const progressive = transcodings.find(t => t.format.protocol === 'progressive')
    if (progressive) {
      try {
        const res = await this.get<{ url: string }>(progressive.url.replace(API, ''))
        if (res.url) return res.url
      } catch {}
    }

    // Legacy fallback
    if (track.stream_url) {
      return `${track.stream_url}?client_id=${this.clientId}`
    }

    // No plain stream resolved — track is DRM-protected (encrypted HLS only)
    const hasEncrypted = transcodings.some(t => t.format.protocol.includes('encrypted'))
    throw new Error(hasEncrypted ? 'DRM' : 'NO_STREAM')
  }

  async getTrack(id: number): Promise<SCTrack> {
    return this.get<SCTrack>(`/tracks/${id}`)
  }

  async getTrackComments(id: number, limit = 50): Promise<SCCollection<SCComment>> {
    return this.get<SCCollection<SCComment>>(`/tracks/${id}/comments`, { limit, threaded: 0 })
  }

  async getUser(userId: number): Promise<SCUser> {
    return this.get<SCUser>(`/users/${userId}`)
  }

  async getUserTracks(userId: number, limit = 20): Promise<SCCollection<SCTrack>> {
    return this.get<SCCollection<SCTrack>>(`/users/${userId}/tracks`, { limit })
  }

  // Renderer-side fetch: uses Chromium browser context with DataDome cookies + webSecurity:false
  private async scWrite(method: string, path: string, body: unknown = null): Promise<unknown> {
    const url = `${API}${path}?client_id=${this.clientId}`
    // Route through main process → scProxy (soundcloud.com context) so DataDome
    // sees a legit browser request. A direct renderer fetch gets 403.
    if (!window.electronAPI?.scWrite) {
      throw new Error('scWrite IPC unavailable')
    }
    return window.electronAPI.scWrite(method, url, body, this.oauthToken)
  }

  async likeTrack(trackId: number): Promise<void> {
    await this.scWrite('PUT', `/users/${this.userId}/track_likes/${trackId}`)
  }

  async unlikeTrack(trackId: number): Promise<void> {
    await this.scWrite('DELETE', `/users/${this.userId}/track_likes/${trackId}`)
  }

  async followUser(artistId: number): Promise<void> {
    await this.scWrite('POST', `/me/followings/${artistId}`)
  }

  async unfollowUser(artistId: number): Promise<void> {
    await this.scWrite('DELETE', `/me/followings/${artistId}`)
  }

  async getPlaylist(id: number): Promise<SCPlaylist> {
    return this.get<SCPlaylist>(`/playlists/${id}`)
  }

  // Replace the full track list of a playlist. API expects plain track IDs.
  async setPlaylistTracks(playlistId: number, trackIds: number[]): Promise<void> {
    await this.scWrite('PUT', `/playlists/${playlistId}`, {
      playlist: { tracks: trackIds }
    })
  }

  // Add/remove a track using the authoritative server-side track list to avoid
  // truncating the playlist if the local copy is stale or partial.
  async addTrackToPlaylist(playlistId: number, trackId: number): Promise<void> {
    const pl = await this.getPlaylist(playlistId)
    const ids = (pl.tracks ?? []).map(t => t.id).filter(Boolean)
    if (!ids.includes(trackId)) ids.push(trackId)
    await this.setPlaylistTracks(playlistId, ids)
  }

  async removeTrackFromPlaylist(playlistId: number, trackId: number): Promise<void> {
    const pl = await this.getPlaylist(playlistId)
    const ids = (pl.tracks ?? []).map(t => t.id).filter(Boolean).filter(id => id !== trackId)
    await this.setPlaylistTracks(playlistId, ids)
  }


  async getNextPage<T>(nextHref: string): Promise<SCCollection<T>> {
    const sep = nextHref.includes('?') ? '&' : '?'
    const url = `${nextHref}${sep}client_id=${this.clientId}`
    const res = await axios.get(url, { headers: this.headers })
    return res.data
  }

  formatArtwork(url: string | null, size: 't500x500' | 't200x200' | 'large' = 't500x500'): string {
    if (!url) return ''
    return url.replace('-large', `-${size}`)
  }

  formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }
}

export const sc = new SoundCloudService()
