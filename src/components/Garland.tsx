import { useEffect, useRef } from 'react'
import { useSettings, useAccentHex, hexToRgb } from '../store'

/* The New Year garland, slung across the top of the window.
 *
 * Like the tree it lives BEHIND the glass panels, which is the whole point:
 * the sidebar and the bar blur the light pooling behind them instead of
 * covering it, so the bulbs read through the glass the way the sketch shows.
 * The canvas is only as tall as the light reaches, not the whole window.
 *
 * Every bulb is drawn from two baked sprites - a wide soft pool of light and
 * the bulb itself - stamped with the brightness of the moment. Building the
 * radial gradients live would mean a few hundred of them a frame for no
 * picture that ever changes. */

const LAYER_H = 240        // px of canvas; past this the spill has faded out
// Three arcs at any width, not a target span: the count has to be an integer
// because the arcs tile the window, so deriving it from a span made the shape
// jump between three and five as the window was resized.
const ARCS = 3
const SAG = 31             // how far an arc dips below its anchors
const SPACING = 34         // px of wire per bulb, roughly
const GLOW_R = 130         // radius of a bulb's pool of light
const CLASSIC = ['#e5484d', '#f0a830', '#2bb3a3', '#f5d547', '#7a7df0']
// Thirty frames a second, always - a ceiling, see FRAME_MS's use. A bulb is a
// sine wave on its own brightness over a second and a half; drawing that a
// hundred and forty times a second interpolates a fade nobody can see, so the
// extra frames were pure heat. Nothing here is fast enough to tell.
const FRAME_MS = 1000 / 32 - 1

interface Bulb { x: number; y: number; c: string; ph: number; sp: number; i: number }

export function Garland() {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const mode = useSettings(s => s.garlandMode)
  const pauseBg = useSettings(s => s.seasonPauseBg)
  const accent = useAccentHex()
  const modeRef = useRef(mode); modeRef.current = mode
  const pause = useRef(pauseBg); pause.current = pauseBg
  const accentRef = useRef(accent); accentRef.current = accent

  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    let dpr = 1, raf = 0, stopped = false, clock = 0
    let bulbs: Bulb[] = []
    let wire: { a: [number, number]; c: [number, number]; b: [number, number] }[] = []
    /* Keyed by colour, and one of those colours is the live accent - which
       changes on every step of the hue slider, and again on every track
       when the accent is taken from the artwork. Each entry is a canvas of
       roughly 260 CSS pixels square, so at dpr 2 that is about a megabyte
       apiece; nothing evicted them but a window resize, so one drag across
       the hue slider retained a few hundred megabytes for the life of the
       component. Bounded and oldest-first: a Map keeps insertion order. */
    const BAKED_MAX = 24
    const glow = new Map<string, HTMLCanvasElement>()
    const lamp = new Map<string, HTMLCanvasElement>()
    const keep = (m: Map<string, HTMLCanvasElement>) => {
      while (m.size > BAKED_MAX) {
        const oldest = m.keys().next().value
        if (oldest === undefined) break
        m.delete(oldest)
      }
    }

    let seed = 1224
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

    /* The pool of light a bulb throws on whatever is behind the glass. Drawn
       additively, so overlapping bulbs build up the way light does. */
    const glowOf = (c: string) => {
      let g = glow.get(c)
      if (g) return g
      const [r, gg, b] = hexToRgb(c)
      const s = GLOW_R * 2
      g = document.createElement('canvas')
      g.width = g.height = Math.ceil(s * dpr)
      const x = g.getContext('2d')!
      x.scale(dpr, dpr)
      const grad = x.createRadialGradient(GLOW_R, GLOW_R, 0, GLOW_R, GLOW_R, GLOW_R)
      grad.addColorStop(0, `rgba(${r},${gg},${b},0.55)`)
      grad.addColorStop(0.12, `rgba(${r},${gg},${b},0.3)`)
      grad.addColorStop(0.38, `rgba(${r},${gg},${b},0.09)`)
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`)
      x.fillStyle = grad
      x.beginPath(); x.arc(GLOW_R, GLOW_R, GLOW_R, 0, Math.PI * 2); x.fill()
      glow.set(c, g); keep(glow)
      return g
    }

    /* The bulb: a brass cap on the wire and a teardrop of coloured glass with
       a hot core, lit from the upper left like everything else in the player. */
    const lampOf = (c: string) => {
      let l = lamp.get(c)
      if (l) return l
      const [r, gg, b] = hexToRgb(c)
      const W = 16, H = 26
      l = document.createElement('canvas')
      l.width = Math.ceil(W * dpr); l.height = Math.ceil(H * dpr)
      const x = l.getContext('2d')!
      x.scale(dpr, dpr)
      x.fillStyle = 'rgba(58,48,36,0.95)'
      x.beginPath(); x.roundRect(W / 2 - 3, 2, 6, 6, 1.5); x.fill()
      const grad = x.createRadialGradient(W / 2 - 1.6, 12, 0, W / 2, 14, 7.5)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.26, `rgb(${Math.min(255, r + 70)},${Math.min(255, gg + 70)},${Math.min(255, b + 70)})`)
      grad.addColorStop(0.72, c)
      grad.addColorStop(1, `rgba(${r * 0.35 | 0},${gg * 0.35 | 0},${b * 0.35 | 0},0.95)`)
      x.fillStyle = grad
      x.beginPath(); x.ellipse(W / 2, 15, 5.2, 7.2, 0, 0, Math.PI * 2); x.fill()
      lamp.set(c, l); keep(lamp)
      return l
    }

    const build = () => {
      const vw = window.innerWidth
      seed = 1224
      bulbs = []; wire = []
      const n = ARCS
      const step = vw / n
      let k = 0
      for (let i = 0; i < n; i++) {
        const ax = i * step, bx = (i + 1) * step
        const ay = 2 + (i % 2) * 7 + rnd() * 5
        const by = 2 + ((i + 1) % 2) * 7 + rnd() * 5
        const sag = SAG * (0.78 + rnd() * 0.45)
        // a quadratic dips a quarter of the way to its control point, so the
        // control goes twice the wanted sag below the chord
        const c: [number, number] = [(ax + bx) / 2, (ay + by) / 2 + sag * 2]
        wire.push({ a: [ax, ay], c, b: [bx, by] })
        const count = Math.max(3, Math.round(step / SPACING))
        for (let j = 1; j < count; j++) {
          const t = j / count, u = 1 - t
          const x = u * u * ax + 2 * u * t * c[0] + t * t * bx
          const y = u * u * ay + 2 * u * t * c[1] + t * t * by
          bulbs.push({
            x, y, c: k % 6 === 5 ? '' : CLASSIC[k % CLASSIC.length],
            ph: rnd() * Math.PI * 2, sp: 1.1 + rnd() * 1.4, i: k,
          })
          k++
        }
      }
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(window.innerWidth * dpr)
      cv.height = Math.round(LAYER_H * dpr)
      cv.style.width = window.innerWidth + 'px'
      cv.style.height = LAYER_H + 'px'
      glow.clear(); lamp.clear()
      build()
    }

    const frame = (dt: number) => {
      clock += dt
      const vw = window.innerWidth
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, vw, LAYER_H)
      const m = modeRef.current

      // wire
      ctx.strokeStyle = 'rgba(6,6,8,0.95)'
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      for (const w of wire) {
        ctx.beginPath()
        ctx.moveTo(w.a[0], w.a[1])
        ctx.quadraticCurveTo(w.c[0], w.c[1], w.b[0], w.b[1])
        ctx.stroke()
      }

      const bright = (b: Bulb) => {
        if (m === 'static') return 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(clock * 0.5 + b.ph))
        if (m === 'run') {
          const w = Math.sin(clock * 2.2 - b.i * 0.55)
          return 0.2 + 0.8 * Math.pow(Math.max(0, w), 5)
        }
        return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock * b.sp + b.ph))
      }

      // the light first, additively, so overlapping pools build up
      ctx.globalCompositeOperation = 'lighter'
      for (const b of bulbs) {
        const c = b.c || accentRef.current
        const v = bright(b)
        ctx.globalAlpha = v * 0.85
        const g = glowOf(c)
        const s = GLOW_R * 2 * (0.75 + 0.35 * v)
        ctx.drawImage(g, b.x - s / 2, b.y + 14 - s / 2, s, s)
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1

      for (const b of bulbs) {
        const c = b.c || accentRef.current
        const l = lampOf(c)
        const w = l.width / dpr, h = l.height / dpr
        ctx.globalAlpha = 0.55 + 0.45 * bright(b)
        ctx.drawImage(l, b.x - w / 2, b.y - 3, w, h)
      }
      ctx.globalAlpha = 1
    }

    /* Thirty frames a second - see FRAME_MS. The clock still runs on real
       elapsed time, so nothing breathes slower, it is just drawn half as often. */
    let last = performance.now()
    const tick = (now: number) => {
      if (stopped) return
      raf = requestAnimationFrame(tick)
      const el = now - last
      if (el < FRAME_MS) return
      last = now
      frame(Math.min(0.05, el / 1000))
    }
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) } }
    const halt = () => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
    const onFocus = () => { if (pause.current) start() }
    const onBlur = () => { if (pause.current) halt() }

    resize()
    // Only run from the off if the window is actually in front. The loop used
    // to start regardless and 'freeze while unfocused' took effect only after
    // the first blur - so launching to the tray, or autostart at login, left
    // all of this drawing at full rate behind whatever you were playing.
    if (!pause.current || document.hasFocus()) start()
    window.addEventListener('resize', resize)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      stopped = true
      halt()
      window.removeEventListener('resize', resize)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return <canvas ref={cvRef} className="garland-layer" aria-hidden />
}
