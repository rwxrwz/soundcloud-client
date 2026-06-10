import { useEffect } from 'react'
import { useProfile } from '../store'
import { sc } from '../services/soundcloud'

export function useSync() {
  const { user, clientId, oauthToken, setLikes, setPlaylists, setStream, setFollowingIds } = useProfile()

  useEffect(() => {
    if (!user || !clientId) return
    sc.setCredentials(clientId, oauthToken)

    const sync = async () => {
      try {
        const [likes, playlists, stream] = await Promise.all([
          sc.getLikes(user.id, 200),
          sc.getPlaylists(user.id),
          sc.getStream(50)
        ])
        // /track_likes returns { collection: [{ track: SCTrack, created_at: string }] }
        const likesTracks = likes.collection.map((item: any) => item.track ?? item).filter(Boolean)
        setLikes(likesTracks)
        setPlaylists(playlists.collection)
        setStream(stream.collection.map((item: any) => item.track).filter(Boolean))
      } catch (e) {
        console.error('Sync failed:', e)
      }
      // Following IDs (for follow button state) — separate, non-blocking
      try {
        const f = await sc.getFollowings(user.id, 200)
        setFollowingIds((f.collection ?? []).map(u => u.id))
      } catch { /* ignore */ }
    }

    sync()
  }, [user?.id, clientId])
}
