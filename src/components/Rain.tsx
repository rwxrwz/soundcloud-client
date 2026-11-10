import { useEffect, useRef } from 'react'
import { useSettings } from '../store'

/* Rain, over the whole window, in four parts.
 *
 * 1. THE SHEET. A few hundred straight lines falling fast and landing nowhere.
 *    Same idea as the snow layer and deliberately not the same code: the cheap
 *    way to draw a sprite is not the cheap way to draw a line, so every drop at
 *    one depth goes into one path and a frame is three strokes rather than
 *    three hundred draw calls. Depth is the only thing that makes a flat sheet
 *    of lines read as weather - near drops are long, fast and bright, far ones
 *    are short, slow and barely there, and they all lean the same way, because
 *    wind does not change its mind across a window.
 *
 * 2. THE GLASS. Drops clinging to the front of the window, as if it were a
 *    lens: they sit, they swell, and past a size surface tension loses and
 *    they slide, leaving a trail of residue and swallowing whatever static
 *    drops they pass. That last part is what sells it - rain on glass is not
 *    drops falling, it is drops eating each other.
 *
 * 3. THE LEDGES. Water pools along the window's top edge and the top edge of
 *    the player bar, thickens while it rains, and spills drips down the face.
 *    A drip is just a glass drop that starts out already moving, so it merges
 *    and trails like all the others.
 *
 * 4. THE WET PANEL. The home screen's artwork gets its own, denser population
 *    clipped to its rounded rect, plus a sheen across it and water gathering
 *    at its bottom edge, so the cover reads as a wet photograph rather than a
 *    photograph with drops on top of it.
 *
 * Marked up from the DOM: [data-rain="pool"] is a ledge, [data-rain="wet"] is
 * a panel. Both are re-measured on a slow timer, not per frame - they move
 * when a layout changes, which is not sixty times a second. */

interface Streak { x: number; y: number; l: number; v: number }
// vy 0 is a drop sitting still; `hold` is how long it has left to sit.
interface Drop { x: number; y: number; r: number; vy: number; hold: number; fade: number; life: number }
/* `ancOp` is the opacity of everything ABOVE the ledge in the tree, settled
   on the slow scan; `op` is that times its own, re-read every frame. */
interface Pool { el: HTMLElement; x: number; y: number; w: number; h: number; rad: number; wet: number; ancOp: number; op: number; seed: number }
interface Panel { el: HTMLElement; x: number; y: number; w: number; h: number; rad: number; drops: Drop[] }

// near -> far. `n` is streaks per pixel of window area: about 350 of them in a
// 1270x1384 window, which is a steady rain rather than a downpour.
const TIERS = [
  { n: 0.00005, len: [24, 40], v: [1450, 1850], w: 1.4, a: 0.26 },
  { n: 0.00007, len: [15, 24], v: [1050, 1350], w: 1.0, a: 0.17 },
  { n: 0.00009, len: [8, 14], v: [720, 950], w: 0.7, a: 0.11 },
]
const STREAK_CAP = 900     // whatever the screen size, never more than this
// How far the sheet can lean, at the wind slider's far end. The slider's
// default lands on the 0.145 this was built with.
const SLANT_MAX = 0.36
const COLOUR = '214, 230, 248'   // cool white; the player is dark in both themes

const GLASS_MAX = 70       // drops clinging to the window at once
const GLASS_RATE = 7       // new ones per second
const R_MIN = 1.6, R_MAX = 7.5
const SLIDE_R = 4.2        // below this a drop is light enough to just hang on
const GRAVITY = 26         // px/s per px of radius once it does let go
const DRAG = 2.4           // and what slows it down again
const TRAIL_GAP = 7        // px between the residue drops a slider leaves
const MERGE_GROW = 0.62    // how much of a swallowed drop's size is kept
// Glass dries. Without this every drop that never grew heavy enough to slide
// sat there for the rest of the session, and an hour in the window was a field
// of motionless specks with a few sliders threading between them.
const LIFE = [9, 30]       // s a still drop lasts before it gives up
const TRAIL_LIFE = [2.5, 7]
const DRY = 0.7            // how fast it fades once its time is up

const POOL_FILL = 7        // seconds of rain to soak a dry ledge
const DRIP_RATE = 0.55     // drips per second per ledge, at full wetness
const SCAN_MS = 200        // how often the marked elements are re-measured

const WET_N = 26           // drops on the artwork - denser, it is the showpiece
const WET_RATE = 9

/* ── the storm deck ──────────────────────────────────────────────────────────
   Clouds and lightning, on their own canvas BEHIND the player, after the
   originkit "Cloud Sky 4" background the look was asked for. Its WebGL will
   not run here, so this is the same recipe in 2D, from its own description:
   cumulus built as clusters of puffs with an asymmetric FLAT BASE - which is
   what stops them reading as noise blobs - lit from the crown down, two
   parallax layers, and strikes that light each layer by distance and by the
   cloud's own thickness, so it glows from inside instead of being floodlit.
   Every cloud is baked once; a frame is a handful of drawImage. */
const SKY_H = 400          // px the cloud deck occupies; the canvas is the whole window
const CROWN = '#8c94a3'    // the lit tops, the component's accent colour
const MID = '#5a6475'
const BELLY = '#3e4757'    // shaded undersides, its base colour
const LAYERS = [
  { band: 0.20, h: 132, drift: 3.5, alpha: 0.3, n: 5 },   // far: small, slow, faint
  { band: 0.32, h: 196, drift: 7.5, alpha: 0.48, n: 4 },  // near
]
/* The ceiling of the lightning slider, in strikes per second. 0.45 is one
   every two seconds or so - a storm directly overhead, and about as fast
   as the eye still reads separate bolts rather than a strobe.
   Chosen so the slider's 0-100 lands its default of 10 exactly on the
   0.045 the storm has always used: one strike every twenty-two seconds
   on average, which is what it looked like before there was a slider. */
const STRIKE_RATE_MAX = 0.45
const PULSE_DECAY = 7      // exponential fall of one pulse
const RISE = 0.04          // 40ms to full, as the reference has it

/* Rain is the fastest thing on screen - a near drop crosses the window in a
   second - so it draws at the fast ceiling and gives that up only when the
   seasonal perf switch asks every layer to. See Snow.tsx for what the two
   ceilings actually land on. */
const FAST_MS = 1000 / 60 - 1
const SLOW_MS = 1000 / 32 - 1

export function Rain() {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const skyRef = useRef<HTMLCanvasElement>(null)
  // Read through refs so a toggle elsewhere never restarts the loop.
  const pauseBg = useSettings(s => s.seasonPauseBg)
  const eco = useSettings(s => s.seasonEco)
  const lens = useSettings(s => s.rainLens)
  const surfaces = useSettings(s => s.rainSurfaces)
  const clouds = useSettings(s => s.rainClouds)
  const adv = useSettings(s => s.rainAdvanced)
  const wind = useSettings(s => s.rainWind)
  const lightning = useSettings(s => s.rainLightning)
  const speed = useSettings(s => s.rainSpeed)
  const fps = useSettings(s => s.rainFps)
  const pause = useRef(pauseBg); pause.current = pauseBg
  const ecoRef = useRef(eco); ecoRef.current = eco
  const lensRef = useRef(lens); lensRef.current = lens
  const surfRef = useRef(surfaces); surfRef.current = surfaces
  const cloudRef = useRef(clouds); cloudRef.current = clouds
  const slant = useRef(0); slant.current = wind * SLANT_MAX
  /* Through a ref, like the slant: the loop reads it every frame, so the
     slider takes effect while the storm is running rather than on the
     next remount. */
  const strikeRate = useRef(0); strikeRate.current = (lightning / 100) * STRIKE_RATE_MAX
  const speedRef = useRef(speed); speedRef.current = speed
  // Only while the knobs are showing; folded away, the shared setting rules.
  const capRef = useRef(0); capRef.current = adv ? 1000 / Math.max(10, fps) - 1 : -1

  useEffect(() => {
    const cv = cvRef.current
    const skyCv = skyRef.current
    if (!cv || !skyCv) return
    const ctx = cv.getContext('2d')
    const sky = skyCv.getContext('2d')
    if (!ctx || !sky) return

    let dpr = 1, raf = 0, stopped = false
    let vw = 0, vh = 0, scanAt = 0, clock = 0
    const tiers: Streak[][] = TIERS.map(() => [])
    const glass: Drop[] = []
    let pools: Pool[] = []
    let panel: Panel | null = null

    const rnd = (a: number, b: number) => a + Math.random() * (b - a)

    // ── the storm deck ────────────────────────────────────────────────────
    interface Puffy { sprite: HTMLCanvasElement; x: number; y: number; w: number; h: number }
    interface Pulse { at: number; amp: number }
    interface Strike { age: number; x: number; y: number; pulses: Pulse[]; path: number[]; forks: number[][] }
    let deck: Puffy[][] = []
    let strikes: Strike[] = []
    let skyH = 0

    /* One cumulus, baked. The mass is laid down as soft puffs along a bell,
       then everything under the base line is cut away with a short hem - that
       flat underside is what makes it a cloud rather than a cluster of balls -
       and the whole silhouette is tinted in one pass, crown to belly. */
    const bakeCloud = (w: number, h: number): HTMLCanvasElement => {
      const c = document.createElement('canvas')
      c.width = Math.round(w); c.height = Math.round(h)
      const g = c.getContext('2d')!
      const baseY = h * 0.82
      const n = 10 + Math.floor(Math.random() * 7)
      /* Every puff has to finish inside the sprite. Sized off the sprite's
         HEIGHT and spread across what is left of its width after the biggest
         one is allowed for - left to run to the edges they were cut off square
         by the canvas, and a cumulus with a straight side is a box. */
      const maxR = Math.min(h * 0.34, w * 0.16)
      const span = Math.max(0, w - maxR * 2.3)
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1)
        const bell = Math.pow(Math.sin(Math.PI * t), 0.65)
        const r = maxR * (0.34 + 0.66 * bell) * rnd(0.82, 1.1)
        const x = w / 2 + (t - 0.5) * span + rnd(-span * 0.03, span * 0.03)
        const y = baseY - r * (0.2 + 0.72 * bell) - rnd(0, h * 0.03)
        const rg = g.createRadialGradient(x, y, r * 0.15, x, y, r)
        rg.addColorStop(0, 'rgba(255,255,255,1)')
        rg.addColorStop(0.58, 'rgba(255,255,255,0.93)')
        rg.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = rg
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
      }
      g.globalCompositeOperation = 'destination-out'
      const cut = g.createLinearGradient(0, baseY - h * 0.07, 0, baseY + h * 0.015)
      cut.addColorStop(0, 'rgba(0,0,0,0)')
      cut.addColorStop(1, 'rgba(0,0,0,1)')
      g.fillStyle = cut
      g.fillRect(0, baseY - h * 0.07, w, h)
      g.globalCompositeOperation = 'source-in'
      const lit = g.createLinearGradient(0, h * 0.08, 0, baseY)
      lit.addColorStop(0, CROWN)
      lit.addColorStop(0.5, MID)
      lit.addColorStop(1, BELLY)
      g.fillStyle = lit
      g.fillRect(0, 0, w, h)
      return c
    }

    const buildDeck = () => {
      skyH = Math.min(SKY_H, Math.round(vh * 0.55))
      deck = LAYERS.map(L => {
        const out: Puffy[] = []
        const step = (vw + 400) / L.n
        for (let i = 0; i < L.n; i++) {
          const h = L.h * rnd(0.8, 1.15)
          const w = h * rnd(2.4, 3.6)   // cumulus are wide and flat, not square
          out.push({
            sprite: bakeCloud(w, h),
            x: -200 + i * step + rnd(-step * 0.2, step * 0.2),
            // Staggered: flat bases are the point, but all of them at one
            // height drew a ruled line across the window.
            y: skyH * L.band - h * 0.6 + rnd(-skyH * 0.07, skyH * 0.07),
            w, h,
          })
        }
        return out
      })
    }

    /* Strikes arrive as a Poisson process rather than on a beat, and each one
       is two or three pulses: 40ms up, then an exponential fall. The bolt
       wanders downward and throws one or two forks on the way. */
    const strike = () => {
      const x = rnd(vw * 0.1, vw * 0.9)
      const y = rnd(skyH * 0.72, skyH * 1.25)   // the canvas no longer ends there
      const path: number[] = [x + rnd(-30, 30), 0]
      let px = path[0], py = 0
      while (py < y) {
        py += rnd(14, 30)
        px += rnd(-18, 18)
        path.push(px, Math.min(py, y))
      }
      const forks: number[][] = []
      const nf = 1 + Math.floor(Math.random() * 2)
      for (let f = 0; f < nf; f++) {
        const at = 2 * (2 + Math.floor(Math.random() * (path.length / 2 - 3)))
        let fx = path[at], fy = path[at + 1]
        const fork = [fx, fy]
        const len = 2 + Math.floor(Math.random() * 4)
        const dir = Math.random() < 0.5 ? -1 : 1
        for (let k = 0; k < len; k++) {
          fy += rnd(10, 22)
          fx += dir * rnd(8, 26)
          fork.push(fx, fy)
        }
        forks.push(fork)
      }
      const pulses: Pulse[] = [{ at: 0, amp: 1 }]
      const extra = Math.floor(Math.random() * 3)   // the double and triple strokes
      for (let i = 0; i < extra; i++) pulses.push({ at: rnd(0.06, 0.3), amp: rnd(0.35, 0.8) })
      strikes.push({ age: 0, x, y, pulses, path, forks })
    }

    const strikeLevel = (s: Strike) => {
      let v = 0
      for (const p of s.pulses) {
        const a = s.age - p.at
        if (a < 0) continue
        v += p.amp * (a < RISE ? a / RISE : Math.exp(-(a - RISE) * PULSE_DECAY))
      }
      return Math.min(1.6, v)
    }

    /* One baked drop, stamped at every size. A drop on dark glass is almost
       entirely transparent - what you actually see is the rim, where the light
       behind it is bent around the edge, and the one highlight where the room
       is reflected off the top of it. Building that gradient live, seventy
       times a frame, would cost more than the whole sheet of rain. */
    const SPRITE = 64
    const sprite = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = SPRITE
      const g = c.getContext('2d')!
      const m = SPRITE / 2, r = m - 1
      const body = g.createRadialGradient(m, m - r * 0.3, r * 0.1, m, m, r)
      body.addColorStop(0, 'rgba(255,255,255,0.02)')
      body.addColorStop(0.7, 'rgba(255,255,255,0.07)')
      body.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = body
      g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fill()
      // The bent light. A full ring reads as a soap bubble - on a real drop
      // the light gathers along the LOWER edge, because that is where the lens
      // is thickest and where whatever is lit below it ends up. So the ring is
      // drawn and then the top of it is wiped back off.
      const rim = g.createRadialGradient(m, m + r * 0.2, r * 0.5, m, m, r)
      rim.addColorStop(0, 'rgba(255,255,255,0)')
      rim.addColorStop(0.88, `rgba(${COLOUR},0.5)`)
      rim.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = rim
      g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fill()
      g.globalCompositeOperation = 'destination-out'
      const cut = g.createLinearGradient(0, m - r, 0, m + r * 0.45)
      cut.addColorStop(0, 'rgba(0,0,0,1)')
      cut.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = cut
      g.fillRect(0, 0, SPRITE, SPRITE)
      g.globalCompositeOperation = 'source-over'
      // the one highlight, where the room is reflected off the top of it
      g.fillStyle = 'rgba(255,255,255,0.8)'
      g.beginPath(); g.ellipse(m - r * 0.33, m - r * 0.38, r * 0.17, r * 0.12, -0.6, 0, Math.PI * 2); g.fill()
      return c
    })()

    const drawDrop = (d: Drop) => {
      const s = d.r * 2.4
      ctx.globalAlpha = d.fade
      ctx.drawImage(sprite, d.x - s / 2, d.y - s / 2, s, s)
    }

    const addDrop = (list: Drop[], x: number, y: number, r: number, vy = 0, hold = 0, life = rnd(LIFE[0], LIFE[1])) => {
      list.push({ x, y, r, vy, hold, fade: 0, life })
    }

    /* One step of the glass physics, shared by the window and the artwork.
       `bottom` is where a drop has run off the end of whatever it is on. */
    const stepDrops = (list: Drop[], dt: number, bottom: number, merge: boolean) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const d = list[i]
        if (d.vy === 0) {
          // Sitting. Only the heavy ones ever get to leave; the rest dry up.
          d.hold -= dt
          d.life -= dt
          if (d.life <= 0) {
            d.fade -= dt * DRY
            if (d.fade <= 0) { list.splice(i, 1); continue }
          } else if (d.fade < 1) d.fade = Math.min(1, d.fade + dt * 3)
          if (d.hold <= 0 && d.r >= SLIDE_R) d.vy = 12
          continue
        }
        if (d.fade < 1) d.fade = Math.min(1, d.fade + dt * 3)
        d.vy += (GRAVITY * d.r - DRAG * d.vy) * dt
        const was = d.y
        d.y += d.vy * dt
        if (d.y > bottom) { list.splice(i, 1); continue }
        // Residue: the drop cannot carry all of itself down the glass.
        if (Math.floor(d.y / TRAIL_GAP) !== Math.floor(was / TRAIL_GAP) && d.r > 2) {
          const left = d.r * rnd(0.16, 0.26)
          d.r = Math.max(R_MIN, d.r - left * 0.5)
          if (list.length < GLASS_MAX * 2) list.push({ x: d.x + rnd(-1, 1), y: was, r: left, vy: 0, hold: 9e9, fade: 1, life: rnd(TRAIL_LIFE[0], TRAIL_LIFE[1]) })
        }
        if (!merge) continue
        // Eating the still ones in its path. This is the part that reads as
        // rain rather than as a screensaver.
        for (let j = list.length - 1; j >= 0; j--) {
          if (j === i) continue
          const o = list[j]
          if (o.vy !== 0 || o.life <= 0) continue
          const dx = o.x - d.x, dy = o.y - d.y
          const reach = d.r + o.r
          if (dx * dx + dy * dy > reach * reach) continue
          d.r = Math.min(R_MAX * 1.6, Math.hypot(d.r, o.r * MERGE_GROW))
          list.splice(j, 1)
          if (j < i) i--
        }
      }
    }

    // ── the marked-up DOM: ledges to pool on, panels to wet ─────────────────
    /* Wetness is remembered against the ELEMENT, not against the rectangle it
       happened to occupy last time. The player bar moves and resizes - it
       slides up over an overlay, its padding animates from 24px to 170px -
       and matching the old pool by position meant every one of those turned
       into a different ledge, dried instantly and soaked again from nothing.
       That is what made the water appear out of nowhere and sit crooked. */
    /* Is this ledge actually on screen right now? Two different ways it can
       fail to be, and both of them were drawing water over things:
       - it is there but faded out. The player bar keeps its place in the
         layout on the home screen and is animated to opacity 0, and
         opacity is inherited down from ancestors, so the element's own value
         does not settle it.
       - it is there and lit, with the settings window on top of it. Nothing in
         its own style says so; the only thing that knows is the stack, so ask
         the stack. The canvas itself is pointer-events:none and never answers. */
    const ancOpacity = (el: HTMLElement) => {
      let o = 1
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.visibility === 'hidden' || cs.display === 'none') return 0
        o *= parseFloat(cs.opacity)
        if (o < 0.02) return 0
      }
      return o
    }

    const onScreen = (el: HTMLElement, r: DOMRect) => {
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden') return false
      if (ancOpacity(el) * parseFloat(cs.opacity) < 0.25) return false
      const y = r.top + 3
      for (const t of [0.25, 0.5, 0.75]) {
        const hit = document.elementFromPoint(r.left + r.width * t, y)
        if (!hit) continue
        // The editing mode's catcher covers the window and is see-through -
        // the bar is still right there under it, so it does not count as cover.
        if (hit === el || el.contains(hit) || hit.closest('.edit-layer')) return true
      }
      return false
    }

    const scan = () => {
      if (!surfRef.current) { pools.length = 0; panel = null; return }
      const live = new Map<HTMLElement, { x: number; y: number; w: number; h: number; rad: number }>()
      document.querySelectorAll<HTMLElement>('[data-rain="pool"]').forEach(el => {
        const r = el.getBoundingClientRect()
        if (r.width < 80 || r.height < 12 || r.top < 2 || r.top > vh - 4) return
        if (!onScreen(el, r)) return
        const rad = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.width / 2, r.height / 2)
        live.set(el, { x: r.left, y: r.top, w: r.width, h: r.height, rad })
      })
      /* A ledge that is still on screen keeps its pool, however much it has
         moved or resized - the bar slides up over an overlay and animates its
         padding from 24px to 170px, and none of that should dry it out. A
         ledge that has actually gone takes its water with it, there and then,
         and comes back dry: the point of the effect is watching it collect. */
      for (let i = pools.length - 1; i >= 0; i--) {
        if (live.has(pools[i].el)) live.delete(pools[i].el); else pools.splice(i, 1)
      }
      for (const [el, m] of live) {
        pools.push({ el, ...m, wet: 0, ancOp: ancOpacity(el), op: 1, seed: Math.round(m.w) })
      }

      const we = document.querySelector<HTMLElement>('[data-rain="wet"]')
      if (!we) { panel = null; return }
      const r = we.getBoundingClientRect()
      if (r.width < 40 || r.height < 40) { panel = null; return }
      const cs = getComputedStyle(we)
      const rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2)
      panel = { el: we, x: r.left, y: r.top, w: r.width, h: r.height, rad, drops: panel?.drops ?? [] }
    }

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    // ── population ──────────────────────────────────────────────────────────
    const spawnStreak = (ti: number, first: boolean): Streak => {
      const t = TIERS[ti]
      return {
        x: rnd(-40, vw + 40),
        // Dropped in at a random height the first time so the window does not
        // start with a bare sheet falling in from above.
        y: first ? rnd(-vh, vh) : rnd(-120, -10),
        l: rnd(t.len[0], t.len[1]),
        v: rnd(t.v[0], t.v[1]),
      }
    }

    const build = (first: boolean) => {
      const area = vw * vh
      let budget = STREAK_CAP
      TIERS.forEach((t, i) => {
        const want = Math.min(budget, Math.round(area * t.n))
        budget -= want
        const arr = tiers[i]
        while (arr.length > want) arr.pop()
        while (arr.length < want) arr.push(spawnStreak(i, first))
      })
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      vw = window.innerWidth
      vh = window.innerHeight
      cv.width = Math.round(vw * dpr)
      cv.height = Math.round(vh * dpr)
      cv.style.width = vw + 'px'
      cv.style.height = vh + 'px'
      skyH = Math.min(SKY_H, Math.round(vh * 0.55))
      skyCv.width = Math.round(vw * dpr)
      skyCv.height = Math.round(vh * dpr)
      skyCv.style.width = vw + 'px'
      skyCv.style.height = vh + 'px'
      deck = []                 // rebuilt on the next frame, at the new width
      build(!tiers[0].length)
      scan()
    }

    const drawSky = (dt: number, flashAt: { x: number; y: number; v: number }) => {
      sky.setTransform(dpr, 0, 0, dpr, 0, 0)
      sky.clearRect(0, 0, vw, vh)
      const sl = slant.current

      // the deck itself: a dark band the clouds sit in
      const deckG = sky.createLinearGradient(0, 0, 0, skyH)
      deckG.addColorStop(0, 'rgba(22,27,38,0.5)')
      deckG.addColorStop(0.45, 'rgba(27,33,48,0.28)')
      deckG.addColorStop(1, 'rgba(27,33,48,0)')
      sky.fillStyle = deckG
      sky.fillRect(0, 0, vw, skyH)   // the deck's own band; it fades to nothing

      const layer = (li: number) => {
        const L = LAYERS[li]
        for (const c of deck[li]) {
          // Wind pushes the near layer harder than the far one: parallax.
          c.x += (L.drift + sl * L.drift * 2.2) * dt
          if (c.x > vw + 220) c.x = -c.w - rnd(0, 160)
          sky.globalAlpha = L.alpha
          sky.drawImage(c.sprite, c.x, c.y, c.w, c.h)
        }
        sky.globalAlpha = 1
      }

      layer(0)

      // the bolt draws between the layers, so near cloud passes in front of it
      sky.globalCompositeOperation = 'lighter'
      for (const s of strikes) {
        const v = strikeLevel(s)
        if (v <= 0.01) continue
        /* Segment by segment, dimming towards the tip. Stroked as one path at
           one alpha the channel ended on a square full-brightness stub, which
           reads as a bolt someone cut with scissors however much room it has. */
        const line = (pts: number[], w: number, a: number) => {
          const n = pts.length / 2 - 1
          sky.lineWidth = w
          for (let i = 0; i < n; i++) {
            const t = i / n
            const fade = t < 0.62 ? 1 : 1 - (t - 0.62) / 0.38
            if (fade <= 0.02) break
            sky.beginPath()
            sky.moveTo(pts[i * 2], pts[i * 2 + 1])
            sky.lineTo(pts[i * 2 + 2], pts[i * 2 + 3])
            sky.strokeStyle = `rgba(190,215,255,${a * fade})`
            sky.stroke()
          }
        }
        line(s.path, 7, 0.1 * v)        // the air around it
        line(s.path, 2.2, 0.5 * v)
        line(s.path, 0.9, 0.95 * v)     // the channel
        for (const f of s.forks) { line(f, 1.6, 0.3 * v); line(f, 0.7, 0.7 * v) }
      }
      // and the air itself lights up around the strike
      if (flashAt.v > 0.01) {
        const r = vw * 0.55
        const g = sky.createRadialGradient(flashAt.x, flashAt.y, 0, flashAt.x, flashAt.y, r)
        g.addColorStop(0, `rgba(150,180,230,${0.14 * flashAt.v})`)
        g.addColorStop(1, 'rgba(150,180,230,0)')
        sky.fillStyle = g
        sky.fillRect(0, 0, vw, vh)
      }
      sky.globalCompositeOperation = 'source-over'

      layer(1)

      /* The light itself, laid over everything already drawn and clipped to
         it: source-atop keeps the glow only where there is cloud, and its
         result carries the cloud's own alpha - so thick middles light up,
         feathered edges barely lift, and the falloff runs across the whole
         deck instead of per sprite.
         Done per cloud, by distance to its centre, every card got one flat
         brightness of its own and the seam between two of them was a straight
         cut through the light. */
      if (flashAt.v > 0.01) {
        sky.globalCompositeOperation = 'source-atop'
        const r = Math.max(vw * 0.85, skyH * 2)
        const g = sky.createRadialGradient(flashAt.x, flashAt.y, 0, flashAt.x, flashAt.y, r)
        g.addColorStop(0, `rgba(208,224,255,${Math.min(0.9, 0.8 * flashAt.v)})`)
        g.addColorStop(0.3, `rgba(178,198,238,${Math.min(0.6, 0.38 * flashAt.v)})`)
        g.addColorStop(1, 'rgba(160,185,230,0)')
        sky.fillStyle = g
        sky.fillRect(0, 0, vw, vh)
        sky.globalCompositeOperation = 'source-over'
      }
    }

    // ── the frame ───────────────────────────────────────────────────────────
    const frame = (dt: number) => {
      clock += dt
      if (clock * 1000 - scanAt > SCAN_MS) { scanAt = clock * 1000; scan() }

      /* The deck, and the flash it hands to the sheet below. Both canvases
         are driven from this one loop so a strike lights the rain in the same
         frame it lights the clouds. */
      const lit = { x: 0, y: 0, v: 0 }
      if (cloudRef.current) {
        if (!deck.length) buildDeck()
        /* The chance in this frame is the rate times the frame's own
           length, which is what keeps the storm's pace the same at 60fps
           and at 144 - and what makes this a Poisson process rather than
           a metronome: strikes cluster and leave gaps, as they do. */
        if (strikeRate.current > 0 && Math.random() < strikeRate.current * dt) strike()
        for (let i = strikes.length - 1; i >= 0; i--) {
          strikes[i].age += dt
          if (strikes[i].age > 1.6) strikes.splice(i, 1)
        }
        for (const s of strikes) {
          const v = strikeLevel(s)
          if (v > lit.v) { lit.v = v; lit.x = s.x; lit.y = s.y }
        }
        drawSky(dt, lit)
      } else if (deck.length) {
        deck = []; strikes = []
        sky.setTransform(dpr, 0, 0, dpr, 0, 0)
        sky.clearRect(0, 0, vw, vh)
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, vw, vh)
      ctx.lineCap = 'round'

      // 1. the sheet
      const sl = slant.current
      const sp = speedRef.current
      for (let i = 0; i < TIERS.length; i++) {
        const t = TIERS[i]
        ctx.beginPath()
        for (const d of tiers[i]) {
          d.y += d.v * sp * dt
          d.x += d.v * sp * dt * sl
          if (d.y > vh) { Object.assign(d, spawnStreak(i, false)); continue }
          // The streak trails back up the way the drop came from. Leaning with
          // the wind, and stretched by speed: a faster drop smears further in
          // the same exposure, which is what the eye reads as speed.
          // Stretched by speed, but only so far: past about 2.5x the streaks
          // stop being rain and become rulers.
          const l = d.l * (0.6 + 0.4 * Math.min(sp, 2.5))
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x - l * sl, d.y - l)
        }
        // Lightning catches the rain too, or the sheet would carry on falling
        // through a storm it is not in.
        ctx.globalAlpha = Math.min(1, t.a * (1 + lit.v * 1.6))
        ctx.lineWidth = t.w
        ctx.strokeStyle = `rgb(${COLOUR})`
        ctx.stroke()
      }

      /* 2. ledges: soak, then spill.
         globalAlpha is reset first and on purpose - the sheet above leaves it
         at the far tier's 0.11, and everything below this line carries its
         alpha in its own fill colour. Without this the pools and the panel's
         sheen were drawn at a ninth of the strength they ask for, which looked
         exactly like a value that needed tuning up rather than like a bug. */
      ctx.globalAlpha = 1
      ctx.lineWidth = 1
      // Switched off, the ledges are forgotten rather than frozen: turned back
      // on they collect from dry, the same as a ledge that has just appeared.
      if (!surfRef.current && pools.length) pools.length = 0
      for (let i = surfRef.current ? pools.length - 1 : -1; i >= 0; i--) {
        const p = pools[i]
        /* Re-measured every frame, the way the snow layer measures its ledges,
           and for the same reason: a ledge that is laid out by CSS moves and
           fades on CSS's schedule, not on a timer of ours. The player bar
           fades out over 280ms when the home screen takes over - polled at
           200ms the water hung in the air for half a second after the bar it
           was sitting on had gone. Read per frame it fades with it, in step.
           The expensive half of this - finding new ledges, and asking the
           stack whether something is on top - stays on the slow scan. */
        if (!p.el.isConnected) { pools.splice(i, 1); continue }
        const r = p.el.getBoundingClientRect()
        if (r.width < 80 || r.height < 12 || r.top < 2 || r.top > vh - 4) { pools.splice(i, 1); continue }
        const cs = getComputedStyle(p.el)
        p.op = p.ancOp * parseFloat(cs.opacity)
        if (!(p.op > 0.02) || cs.visibility === 'hidden') { pools.splice(i, 1); continue }
        p.x = r.left; p.y = r.top; p.w = r.width; p.h = r.height
        p.rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2)
        p.wet = Math.min(1, p.wet + dt / POOL_FILL)
        const a = p.wet * p.op
        /* Everything below is clipped to the surface itself, rounded corners
           and all. Drawn straight onto the bounding box the film ran past the
           bar's rounded ends and hung in the air either side of it. */
        ctx.save()
        if (p.rad > 0) { roundRect(p.x, p.y, p.w, p.h, p.rad); ctx.clip() }
        else { ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip() }
        /* The film is a filled shape with a WAVY lower edge, not a gradient
           band. That one detail is the whole difference between water hanging
           off a lip and a drop shadow: a straight boundary reads as a shadow
           no matter how it is coloured, and a boundary that sags unevenly and
           drifts reads as liquid even at this size. Two sines of different
           wavelength, one drifting each way, so it never visibly repeats. */
        const base = 2.5 + 6.5 * a
        const amp = 1.5 + 3.5 * a
        const seg = Math.max(8, Math.min(40, Math.round(p.w / 26)))
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x + p.w, p.y)
        for (let i = seg; i >= 0; i--) {
          const x = p.x + (p.w * i) / seg
          const h = base + amp * (
            0.6 * Math.sin(x * 0.021 + clock * 0.55 + p.seed) +
            0.4 * Math.sin(x * 0.047 - clock * 0.33 + p.seed * 0.3))
          ctx.lineTo(x, p.y + h)
        }
        ctx.closePath()
        const g = ctx.createLinearGradient(0, p.y, 0, p.y + base + amp)
        g.addColorStop(0, `rgba(${COLOUR},${0.2 * a})`)
        g.addColorStop(0.55, `rgba(${COLOUR},${0.12 * a})`)
        g.addColorStop(1, `rgba(${COLOUR},${0.035 * a})`)
        ctx.fillStyle = g
        ctx.fill()
        // the light caught along the lip itself
        ctx.fillStyle = `rgba(255,255,255,${0.2 * a})`
        ctx.fillRect(p.x, p.y, p.w, 1)
        /* No beads. A row of swelling ellipses along the lip is what the two
           sines in the edge above already say, and said twice it stopped being
           water and became a line of grey lumps. The wave carries it. */
        ctx.restore()
        // and every so often one runs out of ledge. Started inside the rounded
        // part, not at the very ends, so a drip never begins in mid-air.
        if (lensRef.current && Math.random() < DRIP_RATE * a * dt && glass.length < GLASS_MAX) {
          addDrop(glass, p.x + p.rad + Math.random() * Math.max(1, p.w - p.rad * 2), p.y + base, rnd(3.4, 6.2), 16)
        }
      }

      // 3. the glass itself
      if (!lensRef.current && glass.length) glass.length = 0
      if (lensRef.current && glass.length < GLASS_MAX && Math.random() < GLASS_RATE * dt) {
        // Squared, so the window is mostly specks with the occasional fat one.
        // Flat random gave a field of identical beads.
        const r = R_MIN + (R_MAX - R_MIN) * Math.random() ** 2
        addDrop(glass, rnd(6, vw - 6), rnd(6, vh - 6), r, 0, rnd(1.5, 9))
      }
      if (lensRef.current) {
        stepDrops(glass, dt, vh + 20, true)
        for (const d of glass) drawDrop(d)
      }

      // 4. the wet panel
      if (!surfRef.current && panel) { panel.drops.length = 0; panel = null }
      if (panel && !panel.el.isConnected) panel = null
      if (panel) {
        const p = panel
        // Same per-frame measure as the ledges: the artwork is unmounted when
        // the home player goes away, and its water goes with it.
        const pr = p.el.getBoundingClientRect()
        if (pr.width < 40 || pr.height < 40) { panel = null }
        else {
          p.x = pr.left; p.y = pr.top; p.w = pr.width; p.h = pr.height
        }
      }
      if (panel) {
        const p = panel
        ctx.globalAlpha = 1   // the glass drops above leave it wherever they got to
        ctx.save()
        roundRect(p.x, p.y, p.w, p.h, p.rad)
        ctx.clip()
        // a wet surface is a surface that reflects: one broad sheen across it
        const sh = ctx.createLinearGradient(p.x, p.y, p.x + p.w * 0.7, p.y + p.h)
        sh.addColorStop(0, 'rgba(255,255,255,0.10)')
        sh.addColorStop(0.45, 'rgba(255,255,255,0.02)')
        sh.addColorStop(1, 'rgba(255,255,255,0.07)')
        ctx.fillStyle = sh
        ctx.fillRect(p.x, p.y, p.w, p.h)
        // water gathering along the bottom lip
        const bg = ctx.createLinearGradient(0, p.y + p.h - 26, 0, p.y + p.h)
        bg.addColorStop(0, 'rgba(0,0,0,0)')
        bg.addColorStop(1, `rgba(${COLOUR},0.16)`)
        ctx.fillStyle = bg
        ctx.fillRect(p.x, p.y + p.h - 26, p.w, 26)

        if (p.drops.length < WET_N && Math.random() < WET_RATE * dt) {
          addDrop(p.drops, p.x + rnd(4, p.w - 4), p.y + rnd(4, p.h - 4), R_MIN + 5 * Math.random() ** 2, 0, rnd(0.6, 5))
        }
        stepDrops(p.drops, dt, p.y + p.h + 4, true)
        for (const d of p.drops) drawDrop(d)
        ctx.restore()
      }

      ctx.globalAlpha = 1
    }

    let last = performance.now()
    const tick = (now: number) => {
      if (stopped) return
      raf = requestAnimationFrame(tick)
      const el = now - last
      if (el < (capRef.current >= 0 ? capRef.current : ecoRef.current ? SLOW_MS : FAST_MS)) return
      last = now
      frame(Math.min(0.05, el / 1000))
    }
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) } }
    const halt = () => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
    const onFocus = () => { if (pause.current) start() }
    const onBlur = () => { if (pause.current) halt() }

    resize()
    // Only run from the off if the window is actually in front - see Snow.tsx.
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

  return (
    <>
      <canvas ref={skyRef} className="rain-sky" aria-hidden />
      <canvas ref={cvRef} className="rain-layer" aria-hidden />
    </>
  )
}
