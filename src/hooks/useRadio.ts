/* Keep playing when the queue runs out.
 *
 * This is SoundCloud's autoplay: you pick one track, it finishes, and the
 * player carries on with things like it instead of stopping. The tracks
 * come from the station SoundCloud keeps for that track, so what plays
 * next is their recommendation and not our guess at one.
 *
 * Grown ahead of time rather than at the moment it is needed. Waiting for
 * the last track to end would mean a silence as long as the request, so
 * the tail is extended while two tracks are still to come. The seed is
 * whatever is playing now, which is what makes a radio drift: fifteen
 * tracks in, the suggestions are about where the listening went rather
 * than about the song that started it.
 *
 * No timers and no polling - this wakes on player state changing, and
 * almost every wake decides to do nothing.
 */

import { useEffect } from 'react'
import { usePlayer, useSettings, useStats } from '../store'
import { sc } from '../services/soundcloud'
import { BATCH, pickRadio, shouldExtend } from '../services/radio'

export function useRadio() {
  const on = useSettings(s => s.autoRadio)

  useEffect(() => {
    if (!on) return
    let busy = false
    let dead = false
    /* When the last attempt failed, and for what seed. The failure is
       deliberately not written to the store - the network coming back
       should not need a track change - but `check` runs on every player
       write, so without a pause here a refusal became hundreds of
       retries per track, which is also what feeds the rate limiter the
       stream resolver then trips over. */
    let failedAt = 0
    let failedSeed: number | null = null
    const RETRY_MS = 20_000

    const check = async () => {
      if (busy || dead) return
      const s = usePlayer.getState()
      const seed = s.currentTrack?.id ?? null
      if (!shouldExtend({
        currentId: seed,
        queueLen: s.queue.length,
        queueIndex: s.queueIndex,
        shuffle: s.shuffle,
        repeat: s.repeat,
        radioSeed: s.radioSeed,
        radioDry: s.radioDry,
      }) || seed === null) return

      if (seed === failedSeed && Date.now() - failedAt < RETRY_MS) return

      busy = true
      try {
        const got = await sc.getRadio(seed, BATCH, s.currentTrack?.station_urn)
        if (dead) return
        const heard = new Set(useStats.getState().played)
        const use = pickRadio(got, seed, heard)
        if (use.length) usePlayer.getState().appendRadio(use, seed)
        /* Nothing came back at all: an upload with no neighbours. Written
           off so the same empty answer is not fetched once per second for
           the rest of the track. */
        else usePlayer.getState().markRadioDry(seed)
      } catch {
        /* Offline, or SoundCloud said no. Not written off - the seed is
           still good - but held for twenty seconds so this does not turn
           into a retry loop at tick rate. */
        failedAt = Date.now()
        failedSeed = seed
      } finally {
        busy = false
      }
    }

    check()
    const un = usePlayer.subscribe(check)
    return () => { dead = true; un() }
  }, [on])
}
