// Shared throttle for the app's requestAnimationFrame loops (hero animation,
// visualizer, now-playing and fullscreen-home canvases). Kept as a plain module
// so rAF callbacks can read it without React re-renders.

let windowActive = true

// Wire once (from Player) - tracks whether the window is worth drawing for.
export function watchWindowActivity(): () => void {
  const onFocus = () => { windowActive = true }
  const onBlur = () => { windowActive = false }
  const onVis = () => { windowActive = document.visibilityState === 'visible' && document.hasFocus() }
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVis)
  onVis()
  return () => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVis)
  }
}

const LOW_FPS_MS = 1000 / 30

// Call at the top of a draw(): returns true when this frame's work should be
// skipped (window inactive, or the 30fps cap hasn't elapsed yet).
export function skipFrame(now: number, last: { t: number }): boolean {
  /* This function had been gutted to `return false`, so the three canvases
     that delegate their throttling to it - the visualiser, now-playing and
     the home player - drew at the full display rate into a window that was
     minimised, blurred or sitting in the tray. Chromium does not rescue
     them either: the app launches with background throttling disabled and
     `backgroundThrottling: false` on the window, deliberately, so that
     playback keeps its timers. The canvas backgrounds (rain, snow, tree,
     night sky, sakura) each stop themselves on blur; these three had
     nothing. */
  if (!windowActive) return true
  if (now - last.t < LOW_FPS_MS) return true
  last.t = now
  return false
}

/* How far a blurred, full-window background has to overshoot its box.
 *
 * A blur fades the image out at its own edges, roughly two radii deep, so
 * a blurred background leaves a pale frame around the window unless it is
 * grown to put that fade past the edge. Growing it by four radii in total
 * covers both sides, which against a window of around 1200px is the blur
 * divided by three hundred.
 *
 * Proportional, and that is the whole point: this used to be a flat
 * scale(1.08) switched on the moment the blur left zero, so the first
 * pixel of blur jumped the picture by eight percent. At one pixel this
 * returns 1.003, which nobody can see, and it grows with the thing it is
 * there to hide.
 */
export const blurScale = (px: number) => (px > 0 ? 1 + px / 300 : 1)
