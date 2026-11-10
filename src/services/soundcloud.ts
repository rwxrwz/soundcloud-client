import { netGetJson } from './net'

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
  visual_url?: string | null   // legacy/top-level banner (rarely present)
  visuals?: { visuals?: { visual_url?: string }[] } | null   // v2 nests the banner here
  badges?: { pro?: boolean; pro_unlimited?: boolean; verified?: boolean }
}

// External links shown on a SoundCloud profile (Instagram, site, etc.)
export interface SCWebProfile {
  url: string
  network?: string
  title?: string
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
  /* The radio SoundCloud keeps for this track, named by the track itself:
     "soundcloud:system-playlists:track-stations:{id}". Preferred over
     building the name by hand, because it is the one their own client
     has in its pocket. */
  station_urn?: string
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

// What getStreamUrl hands back. 'progressive' = plain MP3 straight into <audio>,
// 'hls' = m3u8 playlist that has to go through hls.js + MediaSource.
export type StreamKind = 'progressive' | 'hls'

export interface ResolvedStream {
  url: string
  kind: StreamKind
}

export interface SCPlaylist {
  id: number
  title: string
  artwork_url: string | null
  user: SCUser
  tracks: SCTrack[]
  track_count: number
  duration: number
  likes_count?: number
  permalink_url: string
  set_type?: string          // 'album' | 'ep' | 'single' | 'compilation' | 'playlist'
  is_album?: boolean
  release_date?: string | null
  published_at?: string | null
  created_at?: string | null
  genre?: string | null
  description?: string | null
  sharing?: string           // 'public' | 'private'
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
    // Note: Origin/Referer are forbidden headers in the renderer - Chromium drops
    // them with a console warning, so we don't set them here. Requests work with
    // client_id + OAuth token alone.
    const h: Record<string, string> = {}
    if (this.oauthToken) h['Authorization'] = `OAuth ${this.oauthToken}`
    return h
  }

  private async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    return netGetJson<T>(`${API}${path}`, {
      params: { client_id: this.clientId, ...params },
      headers: this.headers,
    })
  }

  async getMe(): Promise<SCUser> {
    return this.get<SCUser>('/me')
  }

  async getLikes(userId: number, limit = 50): Promise<SCCollection<SCTrack>> {
    return this.get<SCCollection<SCTrack>>(`/users/${userId}/track_likes`, { limit })
  }

  /* ── what to play when nobody picked anything ──────────────────────────
   *
   * Two sources, and they are not the same thing. A station is SoundCloud's
   * radio seeded by one track, built to keep going; "related" is the
   * shorter "people also played" list that sits under a track page. Their
   * own autoplay is the station, so that is what is asked for first, and
   * related is the fallback for a track too obscure to have a station.
   *
   * Neither is documented. Both are read-only GETs the web client makes on
   * every track page, so nothing here goes anywhere the site does not. */
  private unwrapTracks(col: SCCollection<SCTrack> | null | undefined): SCTrack[] {
    const out: SCTrack[] = []
    for (const item of (col?.collection ?? [])) {
      // Some collections wrap each entry; the station endpoint has been seen
      // doing both, so neither shape is assumed.
      const tr = (item as unknown as { track?: SCTrack }).track ?? (item as SCTrack)
      // A track with no id or no title is a stub SoundCloud could not fill
      // in - queueing it would be queueing a blank row that cannot play.
      if (tr && typeof tr.id === 'number' && tr.title) out.push(tr)
    }
    return out
  }

  async getStationTracks(trackId: number, limit = 20): Promise<SCTrack[]> {
    const res = await this.get<SCCollection<SCTrack>>(
      `/stations/soundcloud:track-stations:${trackId}/tracks`, { limit })
    return this.unwrapTracks(res)
  }

  /* The same station reached the other way: as a system playlist, by the
     urn printed on the track. One object with its tracks inside rather
     than a paged collection, and the later entries can come back as bare
     ids - unwrapTracks drops those, so a stub-heavy answer falls through
     to the next source instead of queueing blanks. */
  async getSystemPlaylistTracks(urn: string): Promise<SCTrack[]> {
    const res = await this.get<{ tracks?: SCTrack[] }>(
      `/system-playlists/${encodeURIComponent(urn)}`, { representation: 'full' })
    return this.unwrapTracks({ collection: res?.tracks ?? [], next_href: null })
  }

  async getRelatedTracks(trackId: number, limit = 20): Promise<SCTrack[]> {
    const res = await this.get<SCCollection<SCTrack>>(`/tracks/${trackId}/related`, { limit })
    return this.unwrapTracks(res)
  }

  /** Tracks like this one, for the endless tail.
   *
   *  Three sources, best first. The station is SoundCloud's own radio for
   *  the track and is what their autoplay plays; "related" is the shorter
   *  list under a track page. Empty when all three have nothing: an
   *  unknown upload with no neighbours is an answer, not a failure. */
  async getRadio(trackId: number, limit = 20, stationUrn?: string): Promise<SCTrack[]> {
    try {
      const st = await this.getStationTracks(trackId, limit)
      if (st.length) return st
    } catch { /* no station under that name */ }
    if (stationUrn) {
      try {
        const sp = await this.getSystemPlaylistTracks(stationUrn)
        if (sp.length) return sp.slice(0, limit)
      } catch { /* nor under the one the track gave */ }
    }
    try {
      return await this.getRelatedTracks(trackId, limit)
    } catch { return [] }
  }

  /* Whether SoundCloud has a suggestions endpoint of its own for
     playlists. Their app shows such a list, but the path is not written
     down anywhere public and the only way to watch their client ask for
     it is to sign into somebody's account, so the guess is made once per
     session and the answer remembered - a 404 per refresh button is not
     a price worth paying for a hunch. */
  private plSuggest: 'untried' | 'yes' | 'no' = 'untried'

  /** Tracks that would suit this playlist.
   *
   *  Their own list if that endpoint turns out to exist; otherwise built
   *  here, by asking what goes with a handful of tracks already in it.
   *  The seeds are picked afresh each time, which is what makes the
   *  refresh button return something different rather than the same five
   *  one position along. */
  async getPlaylistSuggestions(playlistId: number, tracks: SCTrack[], exclude: Set<number>, want = 5): Promise<SCTrack[]> {
    const inPlaylist = new Set(tracks.map(t => t.id))
    const keep = (list: SCTrack[]) => {
      const out: SCTrack[] = []
      const seen = new Set<number>()
      for (const t of list) {
        if (!t || typeof t.id !== 'number' || !t.title) continue
        if (inPlaylist.has(t.id) || exclude.has(t.id) || seen.has(t.id)) continue
        seen.add(t.id)
        out.push(t)
      }
      return out
    }

    if (playlistId >= 0 && this.plSuggest !== 'no') {
      try {
        const res = await this.get<SCCollection<SCTrack>>(`/playlists/${playlistId}/suggested`, { limit: want * 4 })
        const got = keep(this.unwrapTracks(res))
        if (got.length) { this.plSuggest = 'yes'; return got.slice(0, want) }
        // Answered, but with nothing useful. Not proof the path is wrong.
      } catch { this.plSuggest = 'no' }
    }

    if (!tracks.length) return []
    /* Three seeds, drawn at random. One seed makes a list about one song;
       the whole playlist would be a request per track. Three is enough
       for the mix to look like the playlist rather than like its last
       addition. */
    const pool = [...tracks]
    const seeds: SCTrack[] = []
    for (let i = 0; i < 3 && pool.length; i++) {
      seeds.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
    }
    const lists = await Promise.all(seeds.map(t => this.getRadio(t.id, 10).catch(() => [] as SCTrack[])))
    /* Interleaved, not concatenated. Taking the first five of one seed's
       answer would make the list about that one track, which is the thing
       three seeds were for. */
    const woven: SCTrack[] = []
    for (let i = 0; i < 10; i++) {
      for (const list of lists) if (list[i]) woven.push(list[i])
    }
    return keep(woven).slice(0, want)
  }

  // Paginate through /track_likes (max ~200 per request) up to `max` tracks.
  // Returns unwrapped tracks (the endpoint wraps each as { track, created_at }).
  async getAllLikes(userId: number, max = 3000): Promise<SCTrack[]> {
    const out: SCTrack[] = []
    const push = (col: SCCollection<SCTrack>) => {
      for (const item of (col.collection ?? [])) {
        const tr = (item as unknown as { track?: SCTrack }).track ?? (item as SCTrack)
        if (tr) out.push(tr)
      }
    }
    let res = await this.getLikes(userId, 200)
    push(res)
    while (res.next_href && out.length < max) {
      res = await this.getNextPage<SCTrack>(res.next_href)
      push(res)
    }
    return out.slice(0, max)
  }

  async getPlaylists(userId: number): Promise<SCCollection<SCPlaylist>> {
    return this.get<SCCollection<SCPlaylist>>(`/users/${userId}/playlists`, { limit: 50 })
  }

  // Playlists/albums the user has liked (made by other people). The endpoint wraps
  // each item as { playlist: SCPlaylist, created_at }, like /track_likes does.
  async getLikedPlaylists(userId: number, limit = 50): Promise<SCPlaylist[]> {
    const res = await this.get<SCCollection<{ playlist?: SCPlaylist } | SCPlaylist>>(`/users/${userId}/playlist_likes`, { limit })
    return (res.collection ?? [])
      .map(item => (item as { playlist?: SCPlaylist }).playlist ?? (item as SCPlaylist))
      .filter((p): p is SCPlaylist => !!p && typeof (p as SCPlaylist).id === 'number')
  }

  async getFollowings(userId: number, limit = 200): Promise<SCCollection<SCUser>> {
    return this.get<SCCollection<SCUser>>(`/users/${userId}/followings`, { limit })
  }

  async getFollowers(userId: number, limit = 200): Promise<SCCollection<SCUser>> {
    return this.get<SCCollection<SCUser>>(`/users/${userId}/followers`, { limit })
  }

  /* Recent releases feed: latest tracks from followed artists, merged &
     sorted. Up to sixty-one requests, so a second caller joins the first one's
     promise instead of starting its own storm - on launch the sync, the home
     screen and the Releases tab can all ask for this feed within a second of
     each other. */
  private releasesInFlight: { id: number; p: Promise<SCTrack[]> } | null = null
  getReleases(userId: number, artistLimit = 60, perArtist = 4): Promise<SCTrack[]> {
    const live = this.releasesInFlight
    if (live && live.id === userId) return live.p
    const p = this.fetchReleases(userId, artistLimit, perArtist)
      .finally(() => { if (this.releasesInFlight?.p === p) this.releasesInFlight = null })
    this.releasesInFlight = { id: userId, p }
    return p
  }

  private async fetchReleases(userId: number, artistLimit: number, perArtist: number): Promise<SCTrack[]> {
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

  async searchPlaylists(q: string, limit = 20): Promise<SCCollection<SCPlaylist>> {
    return this.get<SCCollection<SCPlaylist>>('/search/playlists', { q, limit })
  }

  async searchUsers(q: string, limit = 20): Promise<SCCollection<SCUser>> {
    return this.get<SCCollection<SCUser>>('/search/users', { q, limit })
  }

  // Albums are sets with set_type album/ep. SoundCloud exposes /search/albums;
  // if it ever 404s, callers can fall back to searchPlaylists + set_type filter.
  async searchAlbums(q: string, limit = 20): Promise<SCCollection<SCPlaylist>> {
    return this.get<SCCollection<SCPlaylist>>('/search/albums', { q, limit })
  }

  async getPlaylist(id: number): Promise<SCPlaylist> {
    return this.get<SCPlaylist>(`/playlists/${id}`)
  }

  // Fetch full track data for a list of IDs (batches of 50)
  async getTracksByIds(ids: number[]): Promise<SCTrack[]> {
    if (!ids.length) return []
    const BATCH = 50
    const byId = new Map<number, SCTrack>()
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH)
      const res = await this.get<SCTrack[]>('/tracks', { ids: batch.join(',') })
      for (const tr of res) byId.set(tr.id, tr)
    }
    // SC returns /tracks?ids= in its own order (by id), not the requested order, so
    // restore the input order - otherwise imported/shared playlists come out shuffled.
    return ids.map(id => byId.get(id)).filter((tr): tr is SCTrack => !!tr)
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

  // Synchronous DRM/unavailable check for hydrated tracks. The reliable signal is
  // an `encrypted` HLS transcoding - that's exactly what makes getStreamUrl throw
  // 'DRM'. Note a DRM track may ALSO list a `progressive` entry that simply fails
  // to resolve, so presence of progressive does NOT prove playability.
  // A hydrated track with no transcodings at all is treated as unavailable too.
  isDrm(track: SCTrack): boolean {
    const ts = track.media?.transcodings ?? []
    if (ts.some(t => t.format.protocol.includes('encrypted'))) return true
    if (ts.length) return false
    /* Nothing listed is only a verdict once the rest of the track is filled
       in. A stub - which is every track the radio appends, since nothing on
       that path calls hydratePlaylistTracks - arrives with little more than
       an id, and `resolveStream` refetches it before deciding. Answering
       "DRM" for one skipped tracks that play perfectly well, and did it
       under the name of the setting that is supposed to skip protected
       ones. Title and duration are the same marks hydratePlaylistTracks
       uses to tell a stub from a real track. */
    const hydrated = !!track.title && !!track.duration
    return hydrated && !track.stream_url
  }

  /* Ask SoundCloud for the real media URL behind a transcoding entry.
   *
   * Three outcomes, and telling them apart is the whole point. A reply
   * with a url is the answer. A 200 with an empty object is also an
   * answer - these credentials cannot open this variant, seen on
   * `abr_sq` with a public client_id - and the reason to try the next
   * one. A thrown request is not an answer at all.
   *
   * That third case used to be flattened into the second. Every variant
   * would then "fail to resolve" for a reason that was really one dropped
   * connection or one 429 from skipping tracks quickly, and the track
   * came back as unavailable - permanently, since nothing retried. A
   * track that plays fine a minute later was being reported as removed
   * or geo-blocked. */
  private async resolveTranscoding(t: SCTranscoding): Promise<{ url?: string; transient?: number | true }> {
    try {
      const res = await this.get<{ url?: string }>(t.url.replace(API, ''))
      return res?.url ? { url: res.url } : {}
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status
      /* An answer of "no" is not a failure to answer. 401/403/404 mean this
         variant is not coming and retrying it is pointless, so it is simply
         not a usable url. Everything else - a timeout, a 5xx, no response at
         all - is the transient case.
         Filing the definite ones under `transient` is what made the DRM
         check below unreachable: a protected track usually also lists a
         progressive variant that answers 403, so `failures` was never empty
         and resolveStream threw NET before it ever looked for an encrypted
         entry. The player then said "no answer from SoundCloud, try again"
         about a track that was never going to play, and auto-skip, which
         keys off DRM, never fired. */
      if (status === 401 || status === 403 || status === 404) return {}
      return { transient: status ?? true }
    }
  }

  // Resolve something the player can actually play, and say which kind it is.
  // `progressive` is a plain MP3 that an <audio> element plays by itself;
  // `hls` is an m3u8 playlist that needs hls.js + MediaSource (see hlsStream.ts).
  // Since October 2026 SoundCloud dropped progressive for most tracks, so HLS is
  // the normal path now and progressive is the lucky exception.
  async getStreamUrl(track: SCTrack): Promise<ResolvedStream> {
    try {
      return await this.resolveStream(track)
    } catch (e) {
      /* One retry, and only for the failures a retry can fix. The pause
         is there for the rate limiter: skipping through a queue fires a
         burst of these, and coming straight back would just collect the
         same 429. DRM and a genuinely missing track are answers, not
         accidents, and are rethrown untouched. */
      if ((e as Error)?.message !== 'NET') throw e
      await new Promise(r => setTimeout(r, 700))
      return await this.resolveStream(track)
    }
  }

  private async resolveStream(track: SCTrack): Promise<ResolvedStream> {
    let transcodings = track.media?.transcodings ?? []
    // Set by any variant that failed to answer rather than answering no.
    const failures: (number | true)[] = []

    // If transcodings missing, fetch full track to get them
    if (!transcodings.length) {
      try {
        const full = await this.getTrack(track.id)
        transcodings = full.media?.transcodings ?? []
      } catch {}
    }

    // Encrypted variants (cbc/ctr/cenc) need a DRM licence we don't have - skip them
    // entirely, they are what makes this throw 'DRM' at the bottom.
    const plain = transcodings.filter(t => !t.format.protocol.includes('encrypted'))

    // 1. progressive - cheapest and most robust path, keep it first
    for (const t of plain.filter(t => t.format.protocol === 'progressive')) {
      const r = await this.resolveTranscoding(t)
      if (r.url) return { url: r.url, kind: 'progressive' }
      if (r.transient) failures.push(r.transient)
    }

    // 2. plain HLS. Preference: AAC 160k (fragmented MP4, feeds MediaSource with no
    // repackaging) -> any other audio/mp4 variant -> whatever is left (MP3-in-HLS,
    // which hls.js has to remux).
    const rank = (t: SCTranscoding) =>
      t.preset === 'aac_160k' ? 0 : t.format.mime_type.includes('audio/mp4') ? 1 : 2
    const hls = plain.filter(t => t.format.protocol === 'hls').sort((a, b) => rank(a) - rank(b))
    for (const t of hls) {
      const r = await this.resolveTranscoding(t)
      if (r.url) return { url: r.url, kind: 'hls' }
      if (r.transient) failures.push(r.transient)
    }

    // 3. Legacy fallback
    if (track.stream_url) {
      return { url: `${track.stream_url}?client_id=${this.clientId}`, kind: 'progressive' }
    }

    /* Nothing resolved. If any variant failed to answer at all, this is
       not a fact about the track - say so, and let the caller retry. */
    if (failures.length) {
      console.warn('[stream] %s: no variant answered, failures: %s',
        track.title, failures.map(f => (f === true ? 'network' : String(f))).join(', '))
      throw new Error('NET')
    }
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

  // Albums & EPs published by a user (playlists with set_type album/ep)
  async getUserAlbums(userId: number, limit = 30): Promise<SCCollection<SCPlaylist>> {
    return this.get<SCCollection<SCPlaylist>>(`/users/${userId}/albums`, { limit })
  }

  // External profile links (Instagram, website, etc.). Returns a bare array.
  async getUserWebProfiles(userId: number): Promise<SCWebProfile[]> {
    const res = await this.get<SCWebProfile[] | SCCollection<SCWebProfile>>(`/users/${userId}/web-profiles`)
    return Array.isArray(res) ? res : (res.collection ?? [])
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

  async likePlaylist(playlistId: number): Promise<void> {
    await this.scWrite('PUT', `/users/${this.userId}/playlist_likes/${playlistId}`)
  }

  async unlikePlaylist(playlistId: number): Promise<void> {
    await this.scWrite('DELETE', `/users/${this.userId}/playlist_likes/${playlistId}`)
  }

  async followUser(artistId: number): Promise<void> {
    await this.scWrite('POST', `/me/followings/${artistId}`)
  }

  async unfollowUser(artistId: number): Promise<void> {
    await this.scWrite('DELETE', `/me/followings/${artistId}`)
  }

  // Resolve a public SoundCloud track URL to a hydrated track.
  async resolveTrack(url: string): Promise<SCTrack> {
    return this.get<SCTrack>('/resolve', { url: url.trim() })
  }

  // Resolve a public SoundCloud playlist URL to its title + full track list.
  async resolvePlaylist(url: string): Promise<{ title: string; tracks: SCTrack[] }> {
    const pl = await this.get<SCPlaylist>('/resolve', { url: url.trim() })
    const tracks = await this.hydratePlaylistTracks(pl.tracks ?? [])
    return { title: pl.title ?? 'Imported', tracks }
  }

  // Create a new playlist. SC v2 expects { playlist: { title, sharing, tracks: [ids] } }.
  async createPlaylist(title: string, trackIds: number[] = [], sharing: 'public' | 'private' = 'private'): Promise<SCPlaylist> {
    return this.scWrite('POST', '/playlists', {
      playlist: { title, sharing, tracks: trackIds }
    }) as Promise<SCPlaylist>
  }

  async deletePlaylist(playlistId: number): Promise<void> {
    await this.scWrite('DELETE', `/playlists/${playlistId}`)
  }

  // Rename a playlist. API expects { playlist: { title } }.
  async renamePlaylist(playlistId: number, title: string): Promise<void> {
    await this.scWrite('PUT', `/playlists/${playlistId}`, {
      playlist: { title }
    })
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
    return netGetJson<SCCollection<T>>(url, { headers: this.headers })
  }

  formatArtwork(url: string | null, size: 't500x500' | 't200x200' | 't67x67' | 'large' = 't500x500'): string {
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
