/* Escape, for one overlay at a time.
 *
 * Every overlay used to register its own `window` keydown listener. Window
 * listeners are siblings, not nested handlers, so `stopPropagation` cannot
 * separate them: open an artist, open a track from it, press Escape, and
 * all of them fired on the same event and all of them closed. The player
 * already knows these things stack - that is what `overlayOrder` and the
 * z-index helper are for - but the listeners never consulted it.
 *
 * One listener, and a stack. Whoever mounted last is on top and is the
 * only one that hears the key; closing it uncovers the next.
 */

import { useEffect, useRef } from 'react'

type Entry = () => void

const stack: Entry[] = []
let wired = false

/** Is this key aimed at a field? Fields own their own keys: Escape clears
 *  them, Enter submits them, and neither is a verdict on the window around
 *  them. Exported because the overlays that bind Enter need the same rule
 *  and used to go without it. */
export function typingIn(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  const top = stack[stack.length - 1]
  if (!top) return
  if (typingIn(e)) return
  e.stopPropagation()
  top()
}

/** Close this overlay on Escape, but only while it is the topmost one.
 *
 *  `enabled` is for overlays that are mounted before they are open, and
 *  for the ones deliberately locked shut - passing false keeps them off
 *  the stack entirely rather than leaving a dead entry on top of it. */
export function useEscape(close: () => void, enabled = true): void {
  /* The callback is read through a ref so a new closure on every render
     does not re-register the entry - which would reorder the stack and
     put a lower overlay back on top. */
  const latest = useRef(close)
  latest.current = close

  useEffect(() => {
    if (!enabled) return
    const entry: Entry = () => latest.current()
    stack.push(entry)
    if (!wired) { window.addEventListener('keydown', onKey); wired = true }
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [enabled])
}
