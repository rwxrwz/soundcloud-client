import { useEffect } from 'react'
import { useProfile } from '../store'
import { sc } from '../services/soundcloud'

export function useSync() {
  const { user, clientId, oauthToken, setLikes, setPlaylists, setLikedPlaylists, setFollowingIds, setReleases } = useProfile()

  useEffect(() => {
    if (!user || !clientId) return
    sc.setCredentials(clientId, oauthToken)

    /* Signing into a second account re-runs this while the first run is
       still paginating three thousand likes, and whichever finished last
       won - so the previous account's library could land on top of the
       new one's and stay there. StrictMode's double mount ran the whole
       thing twice for the same reason. */
    let dead = false
    const sync = async () => {
      try {
        const [likesTracks, playlists] = await Promise.all([
          sc.getAllLikes(user.id, 3000),
          sc.getPlaylists(user.id),
        ])
        if (!dead) setLikes(likesTracks)
        if (!dead) setPlaylists(playlists.collection)
      } catch (e) {
        console.error('Sync failed:', e)
      }
      // Following IDs (for follow button state) - separate, non-blocking
      try {
        const f = await sc.getFollowings(user.id, 200)
        if (!dead) setFollowingIds((f.collection ?? []).map(u => u.id))
      } catch { /* ignore */ }
      // Liked (foreign) playlists - separate, non-blocking
      try {
        if (!dead) setLikedPlaylists(await sc.getLikedPlaylists(user.id))
      } catch { /* ignore */ }
      /* Releases last, and on purpose. The feed is not persisted between runs
         and used to be built only when the home screen or the Releases tab
         first asked for it, so on a start page that is neither it was empty
         until you went looking. It is also the most expensive thing here - a
         request per followed artist - so nothing above waits on it. */
      try {
        // Skipped when something already pulled it this run - the home screen
        // asks for it the moment it mounts, and that is just as fresh.
        if (!dead && !useProfile.getState().releases.length) setReleases(await sc.getReleases(user.id))
      } catch { /* ignore */ }
    }

    sync()
    return () => { dead = true }
  }, [user?.id, clientId])
}
