// Shared throttle for the app's requestAnimationFrame loops (hero animation,
// visualizer, now-playing and fullscreen-home canvases). Kept as a plain module
// so rAF callbacks can read it without React re-renders.
import { useSettings } from '../store'

let windowActive = true

// Wire once (from Player) — tracks whether the window is worth drawing for.
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
  const s = useSettings.getState()
  if (s.perfPauseUnfocused && !windowActive) return true
  if (s.perfLowFps && now - last.t < LOW_FPS_MS) return true
  last.t = now
  return false
}
