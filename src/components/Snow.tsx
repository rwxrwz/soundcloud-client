import { useEffect, useRef } from 'react'
import { useSettings, SNOWFALL_DENSITY } from '../store'

/* Snowfall over the whole window, modelled on SnowHush frame by frame.
 *
 * What the reference actually does, and what that forced here:
 *   - It is sparse. Around nine flakes per megapixel are on screen at once and
 *     each is 6-10px across; anything denser stops looking like weather.
 *   - Snow settles on the TOP EDGE of windows as a ridge sitting on the lip.
 *     It does not hang drips below it.
 *   - Nothing collects at the bottom of the screen. Flakes that reach it leave.
 *   - When a window closes, its cap loses its footing and drops as a curtain
 *     of flakes (frames 258-264 of the reference show exactly this).
 *
 * A ledge is any element marked data-snow, re-measured every frame, and only
 * while it is the topmost thing at its own edge - so a panel hidden behind a
 * modal drops its snow instead of painting it over the modal. The attribute's
 * value names the KIND of surface, which is what sets how deep a drift it can
 * carry; identity is per element, so the same kind can be used many times. */

const BUCKET = 6
// Every flake carries an amount of drift depth and hands over exactly that
// much when it lands. Without this the plough was a snow factory: it shaved a
// pixel off the ridge and each flake it threw up put five back, so sweeping
// the cursor bred snow instead of moving it.
const FLAKE_MASS = 1.2
// Snow this sparse would take many minutes to build a ridge if the drift grew
// only where a flake happened to land: at the reference's density a given
// stretch of edge is hit about twice a minute. So the drift is fed at a steady
// rate scaled by density - the flakes are what you see, this is what settles -
// and the rate is set so a ridge reaches its limit in roughly three quarters
// of a minute.
const FILL_SECONDS = 45
const REF_DENSITY = 22
const CAP = 18             // deepest drift any surface carries
const SHED = 0.55          // of a drift shaken loose per px a panel moves
const WIND = 0.22          // constant gentle drift; a slider here earned nothing
const MELT = 0.55          // px/s given back once a drift is near its limit
// A drift holds on the flat and slides off the shoulder. Panels are rounded,
// so without this the ridge ran straight across the corner and hung in the air
// past the edge of the panel; on a round button it now leaves a cap on the
// crown and nothing on the sides, which is the whole point.
const TAN_HOLD = 0.3       // up to ~17 deg the drift keeps its full depth
const TAN_SLIDE = 1.15     // past ~49 deg nothing stays at all
// Ploughing. The reference does not blow falling flakes around - it lets the
// pointer dig through what has settled, throwing up a puff and leaving a
// gouge behind (frames 114-119). Carving scales with pointer speed, so resting
// the cursor on a drift does not quietly erase it.
const PLOUGH_R = 46        // how wide the pointer bites, px
const PLOUGH_K = 0.045     // px of depth removed per px of pointer travel
// A puff has to be worth the snow it came from. Emitting at least one flake
// per bucket per frame meant fifteen buckets under the pointer at sixty frames
// a second threw nine hundred flakes a second regardless of how little depth
// was actually removed - which is what made ploughing look like a snow bomb.
// Now removed depth goes into a debt and buys whole flakes out of it.
const MASS_PER_SPRAY = 16  // px of removed depth per flake thrown up
const SPRAY_MAX = 10       // ...and never more than this many in one frame
const NO_LAND = 0.35       // s a ploughed flake is airborne before it can settle
// Snow is the one layer that cannot be slowed without being noticed: a hundred
// specks each crossing the window in a couple of seconds, and at thirty frames
// every one of them visibly steps instead of falling. It runs at the fast
// rate, and "go easy on the machine" is what gives that up deliberately.
/* Two ceilings rather than targets: the loop can only skip whole display
   frames, so what comes out is the first frame at or past the ceiling - 55 and
   32 on the 165Hz panel this was measured on, 60 and 30 on a 60Hz one. Having
   a ceiling at all is what matters. Uncapped, these layers drew at the panel's
   full 165 and cost 46 points of GPU; at 55 they cost 35, and at 41 they cost
   34 - so 55 is the cheap end of smooth, and there is nothing to buy above it
   but frames too close together to see. */
const FAST_MS = 1000 / 60 - 1
const SLOW_MS = 1000 / 32 - 1
// A flake thrown up by the plough carries sixteen pixels of drift depth, and
// dropping that straight into a six pixel bucket made the ridge jump a third
// of its height in one frame. What lands goes into a pending pile instead and
// eases into the drift over about half a second.
const SETTLE = 5           // of what is pending moved into the drift per second

/* Surfaces are FOUND, not marked. Anything that is painted - it has a fill, or
   it is an image, or it has a visible top border - and is big enough to read
   as a ledge collects snow, the same way a window sill does. Marking them by
   hand meant every new panel needed remembering, and a transparent button
   marked by mistake grew a cap floating over nothing.
   The escape hatch is data-snow="off" on anything that comes out wrong. */
const PAINTED = 0.04       // least background alpha that counts as a surface
const MIN_W = 24           // narrower than this is an icon, not a ledge
const MIN_H = 10
// Inside a scrolling list the small painted boxes are row furniture - the
// 44px artwork on every track, a badge, a counter - and a cap on each of them
// turns a list into a dotted line. Only something list-sized counts there.
const MIN_RIDE_W = 96
const MAX_SURF = 40        // deepest surfaces kept, by area
const SCAN_MS = 350        // how often the page is re-read for surfaces

interface Ledge {
  key: string
  x: number; y: number; w: number; h0: number
  rl: number; rr: number     // top-left / top-right corner radius
  cap: number
  rides: boolean             // scrolls with a list; moving must not shake it off
}
interface Surf { el: HTMLElement; cap: number; rides: boolean }
interface Flake {
  x: number; y: number; sp: number; vy: number
  sway: number; swaySp: number; swayAmp: number
  wind: number                    // per-flake share of the drift; shears clumps apart
  kx: number; ky: number          // kick from being ploughed up; decays to nothing
  m: number                       // drift depth this flake is carrying
  noLand: number                  // s left before it is allowed to settle again
}
interface Pile { h: Float32Array; mx: Float32Array; nz: Float32Array; pend: Float32Array; sig: string }

export function Snow() {
  const cvRef = useRef<HTMLCanvasElement>(null)
  // Read through a ref so moving a slider never restarts the loop and never
  // throws away a drift that has already built up.
  const snow = useSettings(s => s.snow)
  const pauseBg = useSettings(s => s.seasonPauseBg)
  const eco = useSettings(s => s.seasonEco)
  const melt = useSettings(s => s.meltSignal)
  const cfg = useRef(snow); cfg.current = snow
  const pause = useRef(pauseBg); pause.current = pauseBg
  const ecoRef = useRef(eco); ecoRef.current = eco
  const meltRef = useRef(melt); meltRef.current = melt

  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    let dpr = 1, raf = 0, stopped = false, frameNo = 0, nextId = 1
    // Ambient snowfall is a fixed population that recycles forever. Ploughed
    // snow is separate and short-lived: mixing the two let a burst of debris
    // count against the snowfall quota and quietly delete the actual weather.
    const flakes: Flake[] = []
    const debris: Flake[] = []
    let sprayDebt = 0
    let meltSeen = meltRef.current
    const piles = new Map<string, Pile>()
    const geom = new Map<string, Ledge>()
    let ledges: Ledge[] = []
    let surfaces: Surf[] = []
    let scannedAt = -1e9
    // Identity is the element, not the attribute value, so the same kind of
    // surface can be marked a dozen times over and each keeps its own drift.
    const ids = new WeakMap<Element, string>()
    const radius = new WeakMap<Element, { rl: number; rr: number; at: number }>()
    const onTop = new Map<string, { ok: boolean; at: number }>()
    const mouse = { x: -1e4, y: -1e4, px: -1e4, py: -1e4, has: false }
    let sprites: { c: HTMLCanvasElement; r: number }[] = []

    const buildSprites = () => {
      // 3-8px across on screen. The reference sits at 6-10, but its flakes are
      // soft-edged; ours are opaque now, so the same size read as hail.
      sprites = [0.7, 1.0, 1.4, 1.9].map(r => {
        const s = Math.ceil(r * 4 * dpr)
        const c = document.createElement('canvas')
        c.width = c.height = s
        const g = c.getContext('2d')!
        const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
        grad.addColorStop(0, 'rgba(255,255,255,1)')
        grad.addColorStop(0.62, 'rgba(255,255,255,1)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grad
        g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill()
        return { c, r }
      })
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(window.innerWidth * dpr)
      cv.height = Math.round(window.innerHeight * dpr)
      cv.style.width = window.innerWidth + 'px'
      cv.style.height = window.innerHeight + 'px'
      buildSprites()
    }

    const mkFlake = (f: Flake, atTop: boolean, x?: number, y?: number): Flake => {
      const sp = (Math.random() * sprites.length) | 0
      f.x = x ?? Math.random() * window.innerWidth
      // A recycled flake comes back above the window, but spread over a deep
      // band rather than a 50px line: flakes that left the bottom together
      // would otherwise return together and fall as a visible front.
      f.y = y ?? (atTop ? -8 - Math.random() * 260 : Math.random() * window.innerHeight)
      f.sp = sp
      f.vy = 16 + sprites[sp].r * 9 + Math.random() * 12
      f.sway = Math.random() * Math.PI * 2
      f.swaySp = 0.4 + Math.random() * 0.7
      f.swayAmp = 5 + Math.random() * 12
      f.wind = 0.6 + Math.random() * 0.8
      f.kx = 0; f.ky = 0
      f.m = FLAKE_MASS
      f.noLand = 0
      return f
    }

    /* Where a ledge's surface actually is at x. The old flat line from edge to
       edge is what left a sliver of drift floating over a rounded corner: past
       the start of the radius the panel has already curved away downwards. */
    const surfY = (l: Ledge, x: number) => {
      const a = x - l.x
      if (a < l.rl) { const d = l.rl - a; return l.y + l.rl - Math.sqrt(Math.max(0, l.rl * l.rl - d * d)) }
      const b = l.x + l.w - x
      if (b < l.rr) { const d = l.rr - b; return l.y + l.rr - Math.sqrt(Math.max(0, l.rr * l.rr - d * d)) }
      return l.y
    }
    /* ...and how steep it is there, as a tangent. */
    const steep = (l: Ledge, x: number) => {
      const a = x - l.x
      if (a < l.rl) { const d = l.rl - a; return d / Math.sqrt(Math.max(0.01, l.rl * l.rl - d * d)) }
      const b = l.x + l.w - x
      if (b < l.rr) { const d = l.rr - b; return d / Math.sqrt(Math.max(0.01, l.rr * l.rr - d * d)) }
      return 0
    }
    /* A drift's own shape. Random per bucket and then smoothed, so a ridge
       grows in lumps a few buckets wide instead of rising as one flat slab. */
    const profile = (n: number) => {
      const a = new Float32Array(n)
      for (let i = 0; i < n; i++) a[i] = Math.random()
      for (let p = 0; p < 4; p++) {
        const b = Float32Array.from(a)
        for (let i = 0; i < n; i++) {
          a[i] = (b[Math.max(0, i - 1)] + b[i] * 2 + b[Math.min(n - 1, i + 1)]) / 4
        }
      }
      let lo = 1, hi = 0
      for (let i = 0; i < n; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i] }
      const k = hi > lo ? 1 / (hi - lo) : 1
      for (let i = 0; i < n; i++) a[i] = (a[i] - lo) * k
      return a
    }
    /* Deepest drift each bucket can hold: the slope of the surface under it,
       scaled by that bucket's share of the drift's own lumpy profile.
       Recomputed per frame - it is a handful of buckets' worth of work and
       panels move and resize constantly. */
    const limits = (l: Ledge, mx: Float32Array, nz: Float32Array) => {
      for (let i = 0; i < mx.length; i++) {
        const x = l.x + i * BUCKET + BUCKET / 2
        const t = steep(l, x)
        const hold = t <= TAN_HOLD ? 1 : t >= TAN_SLIDE ? 0 : 1 - (t - TAN_HOLD) / (TAN_SLIDE - TAN_HOLD)
        mx[i] = l.cap * hold * (0.42 + 0.58 * nz[i])
      }
    }

    const alphaOf = (c: string) => {
      const m = /^rgba?\(([^)]+)\)$/.exec(c)
      if (!m) return c === 'transparent' ? 0 : 1
      const p = m[1].split(',')
      return p.length > 3 ? parseFloat(p[3]) : 1
    }
    const offOrScrolled = (el: HTMLElement) => {
      let p: HTMLElement | null = el.parentElement, rides = false
      while (p && p !== document.body) {
        if (p.dataset.snow === 'off') return null
        if (!rides) {
          const o = getComputedStyle(p).overflowY
          if (o === 'auto' || o === 'scroll') rides = true
        }
        p = p.parentElement
      }
      return rides
    }

    /* Re-read the page for anything that can hold snow. Rects first, because
       reading them all in one pass costs one layout; getComputedStyle is the
       expensive part and only the handful that survive the size and viewport
       test ever reach it. */
    const scan = () => {
      const vw = window.innerWidth, vh = window.innerHeight
      const cand: { el: HTMLElement; r: DOMRect }[] = []
      document.body.querySelectorAll<HTMLElement>('*').forEach(el => {
        const r = el.getBoundingClientRect()
        if (r.width < MIN_W || r.height < MIN_H) return
        // The window's own top edge is not a ledge: a band of snow across the
        // whole top of the window reads as a stray white strip, not as weather.
        if (r.top <= 2 || r.top > vh - 8) return
        if (r.right < 8 || r.left > vw - 8) return
        cand.push({ el, r })
      })

      const kept: { el: HTMLElement; r: DOMRect; rides: boolean; area: number }[] = []
      // A surface shelters whatever is inside it. The rail and the bar are
      // roofs over their own buttons, and a settings window is a roof over its
      // rows - snow reaches the lip and no further. Without this every control
      // inside a panel grew its own cap and the panel read as a snowed-in
      // scrapheap rather than as one surface.
      const roofs = new Set<HTMLElement>()
      for (const { el, r } of cand) {
        if (el.dataset.snow === 'off') continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.35) continue
        const painted = alphaOf(cs.backgroundColor) >= PAINTED
          || el.tagName === 'IMG'
          || (parseFloat(cs.borderTopWidth) > 0 && alphaOf(cs.borderTopColor) >= 0.08)
        if (!painted) continue
        let sheltered = false
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (roofs.has(p)) { sheltered = true; break }
        }
        if (sheltered) continue
        const rides = offOrScrolled(el)
        if (rides === null) continue
        if (rides && r.width < MIN_RIDE_W) continue
        roofs.add(el)
        kept.push({ el, r, rides, area: r.width * r.height })
      }

      kept.sort((a, b) => b.area - a.area)
      surfaces = kept.slice(0, MAX_SURF).map(k => ({
        el: k.el,
        // Depth from size: one number for everything buries a 32px button and
        // leaves the player bar looking dusted.
        cap: Math.max(3, Math.min(CAP, Math.min(k.r.width, k.r.height * 3) * 0.06)),
        rides: k.rides,
      }))
    }

    /* A cap only stays while its panel is still the top thing at its own edge
       AND still painted. Hit-testing the lip catches the panel being removed
       or a modal opening over it; re-reading the fill catches a surface that
       only existed while hovered - a track row's background goes with the
       pointer, and waiting for the next scan left its snow hanging in the air
       on a row that was no longer there. Throttled, because a probe flushes
       layout and a style read is the expensive call in this file. */
    const stillOnTop = (el: HTMLElement, l: Ledge) => {
      const c = onTop.get(l.key)
      if (c && frameNo - c.at < 6) return c.ok
      let ok = false
      const cs = getComputedStyle(el)
      const painted = alphaOf(cs.backgroundColor) >= PAINTED
        || el.tagName === 'IMG'
        || (parseFloat(cs.borderTopWidth) > 0 && alphaOf(cs.borderTopColor) >= 0.08)
      if (painted && cs.visibility !== 'hidden' && parseFloat(cs.opacity) >= 0.35) {
        const y = Math.min(window.innerHeight - 1, l.y + Math.min(3, l.h0 * 0.5))
        for (const t of [0.3, 0.7]) {
          const hit = document.elementFromPoint(l.x + l.w * t, y)
          if (hit && (hit === el || el.contains(hit))) { ok = true; break }
        }
      }
      onTop.set(l.key, { ok, at: frameNo })
      return ok
    }

    /* Snow that lost its footing becomes falling snow - it does not blink out.
       This is the moment the reference sells hardest (frames 258-264). */
    const shed = (l: Ledge, p: Pile, share: number) => {
      const h = p.h
      let debt = 0
      for (let i = 0; i < h.length; i++) {
        const take = h[i] * share
        h[i] -= take
        debt += take
        // snow still on its way down goes with it, or the drift quietly
        // refills itself right after being shaken off
        p.pend[i] *= 1 - share
      }
      let n = Math.min(120, Math.floor(debt / MASS_PER_SPRAY))
      while (n-- > 0) {
        const f = mkFlake({} as Flake, false,
          l.x + Math.random() * l.w, l.y - Math.random() * l.cap)
        f.m = MASS_PER_SPRAY
        f.noLand = NO_LAND
        f.kx = (Math.random() - 0.5) * 40
        f.ky = Math.random() * 20
        debris.push(f)
      }
    }

    const measure = () => {
      const out: Ledge[] = []
      const live = new Set<string>()
      for (const sf of surfaces) {
        const el = sf.el
        if (!el.isConnected) continue
        const r = el.getBoundingClientRect()
        if (r.width < 10 || r.height < 2) continue
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue
        let key = ids.get(el)
        if (!key) { key = 'l' + nextId++; ids.set(el, key) }
        // Radius decides where the surface curves away, so it has to come from
        // the live computed style - but only now and then: getComputedStyle
        // forces a style recalc, and this runs over every surface every frame.
        let rad = radius.get(el)
        if (!rad || frameNo - rad.at > 20) {
          const cs = getComputedStyle(el)
          let tl = parseFloat(cs.borderTopLeftRadius) || 0
          let tr = parseFloat(cs.borderTopRightRadius) || 0
          // A picture filling a rounded, clipping wrapper has no radius of its
          // own - the corners are the wrapper's. Read as a rectangle, the cap
          // ran straight across corners the wrapper had already cut away.
          if (tl < 1 && tr < 1) {
            let up: HTMLElement | null = el.parentElement
            for (let k = 0; k < 2 && up; k++, up = up.parentElement) {
              const ucs = getComputedStyle(up)
              if (ucs.overflow === 'visible' && ucs.overflowX === 'visible') continue
              const ur = up.getBoundingClientRect()
              if (Math.abs(ur.top - r.top) > 1.5 || Math.abs(ur.left - r.left) > 1.5
                || Math.abs(ur.right - r.right) > 1.5) continue
              tl = parseFloat(ucs.borderTopLeftRadius) || 0
              tr = parseFloat(ucs.borderTopRightRadius) || 0
              if (tl >= 1 || tr >= 1) break
            }
          }
          // CSS shrinks radii so two on one side cannot outrun that side:
          // the effective radius is min(R, w/2, h/2). Using the full height
          // here gave a pill twice the radius it really has, and the drift's
          // base slid down past its rounded ends onto the background.
          const lim = Math.min(r.width / 2, r.height / 2)
          rad = { rl: Math.min(tl, lim), rr: Math.min(tr, lim), at: frameNo }
          radius.set(el, rad)
        }
        const l: Ledge = {
          key, x: r.x, y: r.y, w: r.width, h0: r.height,
          rl: rad.rl, rr: rad.rr,
          cap: sf.cap, rides: sf.rides,
        }
        if (!stillOnTop(el, l)) continue
        live.add(key)
        /* "Settles along the tops of your windows and slips off when you drag
           them" - a panel that moves sheds a share of its drift rather than
           carrying it along like a hat. */
        const was = geom.get(key)
        if (was && !l.rides) {
          const moved = Math.abs(was.x - l.x) + Math.abs(was.y - l.y)
          if (moved > 1.2) {
            const p = piles.get(key)
            if (p) shed(was, p, Math.min(0.9, moved * SHED / 20))
          }
        }
        geom.set(key, l)
        out.push(l)
        const n = Math.max(1, Math.ceil(l.w / BUCKET))
        const sig = `${n}|${l.rl | 0}|${l.rr | 0}|${l.cap}`
        let p = piles.get(key)
        if (!p || p.h.length !== n) {
          const h = new Float32Array(n), nz = profile(n), pend = new Float32Array(n)
          if (p) for (let j = 0; j < Math.min(n, p.h.length); j++) {
            h[j] = p.h[j]; nz[j] = p.nz[j]; pend[j] = p.pend[j]
          }
          p = { h, mx: new Float32Array(n), nz, pend, sig }
          piles.set(key, p)
        }
        p.sig = sig
        limits(l, p.mx, p.nz)
      }
      // anything that was holding snow and is now gone or covered drops it
      for (const [key, p] of [...piles]) {
        if (live.has(key)) continue
        const was = geom.get(key)
        if (was) shed(was, p, 1)
        piles.delete(key); geom.delete(key); onTop.delete(key)
      }
      ledges = out
    }

    /* The drift is drawn as a band between the surface and the surface plus its
       depth, split into runs so a stretch holding no snow draws nothing at all.
       Drawing it as one shape left a half-pixel hairline tracing every rounded
       corner, which is the "snow floating in mid-air" it was accused of. */
    const drawPile = (l: Ledge, p: Pile) => {
      const { h } = p
      const n = h.length
      const bx = (i: number) => Math.min(l.x + l.w, l.x + i * BUCKET + BUCKET / 2)
      let i = 0
      while (i < n) {
        while (i < n && h[i] <= 0.3) i++
        if (i >= n) break
        const from = i
        while (i < n && h[i] > 0.3) i++
        const to = i - 1
        ctx.beginPath()
        // leading foot, on the surface
        ctx.moveTo(bx(Math.max(0, from - 1)), surfY(l, bx(Math.max(0, from - 1))))
        for (let j = from; j <= to; j++) {
          const x = bx(j)
          const y = surfY(l, x) - h[j]
          if (j === from) ctx.lineTo(x, y)
          else {
            const px = bx(j - 1)
            ctx.quadraticCurveTo((px + x) / 2, y, x, y)
          }
        }
        // trailing foot, then back along the surface itself
        for (let j = Math.min(n - 1, to + 1); j >= from - 1; j--) {
          const x = bx(Math.max(0, j))
          ctx.lineTo(x, surfY(l, x))
        }
        ctx.closePath()
        const g = ctx.createLinearGradient(0, l.y - l.cap, 0, l.y + 2)
        g.addColorStop(0, 'rgb(255,255,255)')
        g.addColorStop(1, 'rgb(221,231,247)')
        ctx.fillStyle = g
        ctx.fill()
      }
    }

    const frame = (dt: number) => {
      const c = cfg.current
      frameNo++
      /* Both of these exist only to settle snow on ledges, so neither runs
         when nothing is settling. They are not cheap: scan() walks every
         element in the document and takes a rect from each, three times a
         second, and measure() re-measures up to MAX_SURF of them every
         frame. With snowfall off and "settle on panels" off that was a few
         thousand forced layouts a second for a layer drawing nothing. Rain
         already guards its equivalent the same way. */
      if (c.onPanels && c.fall !== 'off') {
        const now = performance.now()
        if (now - scannedAt > SCAN_MS) { scannedAt = now; scan() }
        measure()
      } else if (ledges.length) {
        ledges = []
        piles.clear()
      }
      const vw = window.innerWidth, vh = window.innerHeight
      const density = SNOWFALL_DENSITY[c.fall]
      const want = Math.round(density * (vw * vh / 1e6))

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, vw, vh)

      const step = (f: Flake): boolean => {
        f.sway += f.swaySp * dt
        // Falling snow is left alone: in the reference the pointer passes
        // straight through it and only disturbs what has already settled.
        const vx = WIND * 55 * f.wind + Math.sin(f.sway) * f.swayAmp + f.kx
        const vy = f.vy + f.ky
        const decay = Math.pow(0.02, dt)
        f.kx *= decay; f.ky *= decay
        if (f.noLand > 0) f.noLand -= dt
        const prevY = f.y
        f.x += vx * dt
        f.y += vy * dt
        if (f.x < -20) f.x += vw + 40
        if (f.x > vw + 20) f.x -= vw + 40

        let landed = false
        if (f.noLand <= 0 && c.onPanels) {
          for (const l of ledges) {
            if (f.x < l.x || f.x > l.x + l.w) continue
            const sy = surfY(l, f.x)
            if (f.y >= sy && prevY < sy + 6) {
              const p = piles.get(l.key)!
              const b = Math.min(p.h.length - 1, Math.max(0, Math.floor((f.x - l.x) / BUCKET)))
              // Spread across three buckets but summing to exactly the mass
              // carried, so a landing can never add more than it took. It is
              // queued rather than applied: see SETTLE.
              if (p.h[b] + p.pend[b] < p.mx[b]) {
                p.pend[b] += f.m * 0.6
                if (b > 0) p.pend[b - 1] += f.m * 0.2
                if (b < p.h.length - 1) p.pend[b + 1] += f.m * 0.2
              }
              landed = true
              break
            }
          }
        }
        // Nothing collects at the floor: reaching the bottom means leaving.
        return landed || f.y > vh + 24
      }

      for (const f of flakes) if (step(f)) mkFlake(f, true)      // recycled, never culled
      for (let i = debris.length - 1; i >= 0; i--) if (step(debris[i])) debris.splice(i, 1)
      // Growing the population spreads the new flakes over the whole window.
      // Spawning them at the top instead meant every flake on screen was born
      // in one band at startup and came down as a single front.
      while (flakes.length < want) flakes.push(mkFlake({} as Flake, false))
      if (flakes.length > want) flakes.length = want

      // "Melt Snow": one click takes it all away, as a shed rather than a blink.
      if (meltRef.current !== meltSeen) {
        meltSeen = meltRef.current
        for (const l of ledges) { const p = piles.get(l.key); if (p) shed(l, p, 1) }
      }

      // Plough: the pointer digs into whatever drift it is dragged through and
      // the displaced snow is thrown up as flakes rather than deleted.
      let cutAt = mouse.x
      const mdx = mouse.x - mouse.px, mdy = mouse.y - mouse.py
      const travel = Math.hypot(mdx, mdy)
      if (c.physics && mouse.has && travel > 0.5) {
        const dirX = mdx / travel, dirY = mdy / travel
        for (const l of ledges) {
          if (mouse.x < l.x - PLOUGH_R || mouse.x > l.x + l.w + PLOUGH_R) continue
          if (mouse.y < l.y - l.cap - 14 || mouse.y > l.y + 14) continue
          const p = piles.get(l.key)!
          const from = Math.max(0, Math.floor((mouse.x - l.x - PLOUGH_R) / BUCKET))
          const to = Math.min(p.h.length - 1, Math.ceil((mouse.x - l.x + PLOUGH_R) / BUCKET))
          for (let i = from; i <= to; i++) {
            const x = l.x + i * BUCKET + BUCKET / 2
            const k = 1 - Math.min(1, Math.abs(x - mouse.x) / PLOUGH_R)
            if (k <= 0 || p.h[i] <= 0) continue
            const cut = Math.min(p.h[i], travel * PLOUGH_K * k * k * l.cap * 0.35)
            if (cut < 0.05) continue
            p.h[i] -= cut
            sprayDebt = Math.min(sprayDebt + cut, MASS_PER_SPRAY * 12)
            cutAt = x
          }
          // One puff per frame, sized by how much depth the stroke actually
          // took, with each flake carrying its share of it.
          let budget = SPRAY_MAX
          while (sprayDebt >= MASS_PER_SPRAY && budget-- > 0) {
            sprayDebt -= MASS_PER_SPRAY
            const f = mkFlake({} as Flake, false,
              cutAt + (Math.random() - 0.5) * PLOUGH_R, mouse.y - 2 - Math.random() * 6)
            f.m = MASS_PER_SPRAY
            f.noLand = NO_LAND          // let it clear the ridge before it may settle
            f.kx = dirX * (90 + Math.random() * 110) + (Math.random() - 0.5) * 50
            f.ky = -(55 + Math.random() * 90) + dirY * 40
            debris.push(f)
          }
        }
      }
      mouse.px = mouse.x; mouse.py = mouse.y

      const grow = c.onPanels ? (density / REF_DENSITY) * dt / FILL_SECONDS : 0
      for (const l of ledges) {
        const p = piles.get(l.key)!
        const { h, mx, nz, pend } = p
        const n = h.length
        const rise = grow * l.cap
        const drain = Math.min(1, SETTLE * dt)
        for (let i = 0; i < n; i++) {
          if (pend[i] > 0.001) {
            const mv = pend[i] * drain
            pend[i] -= mv
            h[i] += mv
          } else pend[i] = 0
          if (h[i] < mx[i]) h[i] = Math.min(mx[i], h[i] + rise * (0.4 + 1.2 * nz[i]))
          const soft = mx[i] * 0.7
          if (h[i] > soft) h[i] = Math.max(soft, h[i] - MELT * dt * ((h[i] - soft) / Math.max(1, mx[i] - soft)))
        }
        // Light relaxation only: smoothing it hard turned the ridge into a
        // rolling wave, and the reference keeps distinct peaks.
        for (let i = 1; i < n - 1; i++) {
          const avg = (h[i - 1] + h[i] + h[i + 1]) / 3
          h[i] += (avg - h[i]) * Math.min(1, 0.6 * dt)
        }
        // Whatever sits past what its bucket can hold slides sideways, but
        // ONLY into a neighbour that has room, and whatever nobody can hold
        // leaves the drift.
        //
        // This used to be two sweeps converging on the middle, which is how
        // the ridge grew a spike: both halves poured their overflow into the
        // centre bucket, the centre could only hand it to a bucket already
        // processed that frame, and the pair traded it back and forth while
        // the total kept climbing. Nothing capped it, so it reached the top of
        // the window given long enough.
        for (let i = 0; i < n; i++) {
          let over = h[i] - mx[i]
          if (over <= 0) continue
          h[i] = mx[i]
          // start with the neighbour facing the middle, where it is flatter
          const order = i * 2 < n ? [i + 1, i - 1] : [i - 1, i + 1]
          for (const j of order) {
            if (over <= 0) break
            if (j < 0 || j >= n) continue
            const room = mx[j] - h[j]
            if (room <= 0) continue
            const take = Math.min(room, over)
            h[j] += take
            over -= take
          }
        }
        drawPile(l, p)
      }

      for (const f of flakes) {
        const s = sprites[f.sp]
        const w = s.c.width / dpr
        ctx.drawImage(s.c, f.x - w / 2, f.y - w / 2, w, w)
      }
      for (const f of debris) {
        const s = sprites[f.sp]
        const w = s.c.width / dpr
        ctx.drawImage(s.c, f.x - w / 2, f.y - w / 2, w, w)
      }
    }

    /* Every frame, unless the machine is being spared - see SLOW_MS. The clock
       runs on real elapsed time either way, so a skipped frame never slows the
       fall down, it only draws it in coarser steps. */
    let last = performance.now()
    const tick = (now: number) => {
      if (stopped) return
      raf = requestAnimationFrame(tick)
      const el = now - last
      if (el < (ecoRef.current ? SLOW_MS : FAST_MS)) return
      last = now
      frame(Math.min(0.05, el / 1000))
    }
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) } }
    const halt = () => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }

    // The player sits in the tray while people game; a canvas repainting behind
    // a fullscreen game is exactly the cost this has to avoid.
    const onFocus = () => { if (pause.current) start() }
    const onBlur = () => { if (pause.current) halt() }
    const onMove = (e: MouseEvent) => {
      if (!mouse.has) { mouse.px = e.clientX; mouse.py = e.clientY }
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true
    }
    const onLeave = () => { mouse.has = false }

    resize()
    // Only run from the off if the window is actually in front. The loop used
    // to start regardless and 'freeze while unfocused' took effect only after
    // the first blur - so launching to the tray, or autostart at login, left
    // all of this drawing at full rate behind whatever you were playing.
    if (!pause.current || document.hasFocus()) start()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mouseout', onLeave)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)

    return () => {
      stopped = true
      halt()
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return <canvas ref={cvRef} className="snow-layer" aria-hidden />
}
