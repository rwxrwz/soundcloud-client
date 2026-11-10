/* The rules behind autoplay, with nothing around them.
 *
 * Kept apart from the hook that fires them and the store that holds the
 * result, because these are the two decisions worth being sure about -
 * when to ask for more tracks, and which of the answers to keep - and a
 * decision tangled up in a React effect and a zustand reducer can only be
 * checked by playing music and watching.
 */

import type { SCTrack } from './soundcloud'

/** Tracks that must still be ahead before the tail is extended. Two, so
 *  the request has a whole track's worth of time to come back. */
export const AHEAD = 2
/** Asked for per round: enough that heavy overlap still leaves a tail. */
export const BATCH = 20
/* A queue extended at every track boundary never stops growing. Past this
   the tail waits until something has been played out of it. High enough
   that listening alone does not reach it. */
export const QUEUE_MAX = 300

export interface RadioView {
  currentId: number | null
  queueLen: number
  queueIndex: number
  shuffle: boolean
  repeat: 'none' | 'one' | 'all'
  radioSeed: number | null
  radioDry: boolean
}

/** Whether to go and ask for more tracks right now. */
export function shouldExtend(s: RadioView): boolean {
  if (s.currentId === null) return false
  /* Repeat already answers "what comes after the last one", and shuffle
     picks inside the queue forever. Neither can run out, so neither wants
     a tail grown onto it. */
  if (s.repeat !== 'none' || s.shuffle) return false
  if (s.queueLen >= QUEUE_MAX) return false
  // Nothing to extend yet: an empty queue means nothing is playing from one.
  if (s.queueLen === 0) return false
  if (s.queueLen - 1 - s.queueIndex > AHEAD) return false
  // This exact seed already came back with nothing. Asking again now would
  // get the same nothing.
  if (s.radioDry && s.radioSeed === s.currentId) return false
  return true
}

/** The answer, filtered down to what is worth queueing.
 *
 *  `heard` is what was played recently: a station happily returns songs
 *  from an hour ago, and hearing them again right away is the thing that
 *  makes a radio feel small. They are only dropped while something else
 *  is on offer - a station with nothing but familiar tracks is still a
 *  better answer than silence. */
export function pickRadio(got: SCTrack[], seedId: number, heard: Set<number>): SCTrack[] {
  const seen = new Set<number>()
  const usable = got.filter(t => {
    if (!t || typeof t.id !== 'number' || !t.title) return false
    if (t.id === seedId || seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
  const fresh = usable.filter(t => !heard.has(t.id))
  return fresh.length ? fresh : usable
}

/** Grown onto the end of the queue, never inserted, never duplicated. */
export function mergeRadio(queue: SCTrack[], add: SCTrack[], radioFrom: number):
  { queue: SCTrack[]; radioFrom: number } | null {
  const have = new Set(queue.map(t => t.id))
  const fresh = add.filter(t => !have.has(t.id))
  if (!fresh.length) return null
  return {
    queue: [...queue, ...fresh],
    // The line is drawn once. A second helping extends the same tail
    // rather than starting a new one further down.
    radioFrom: radioFrom >= 0 ? radioFrom : queue.length,
  }
}
