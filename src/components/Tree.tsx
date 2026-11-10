import { useEffect, useRef } from 'react'
import { useSettings, useAccentHex, SNOWFALL_DENSITY } from '../store'

/* The New Year tree, standing on the left of the window.
 *
 * It lives on its own canvas BEHIND the glass panels, so the sidebar blurs the
 * branches that pass under it instead of being covered by them - the tree can
 * never sit on top of something you are trying to click, and it costs nothing
 * in hit-testing because the layer takes no pointer events at all.
 *
 * The shape is a stack of chevrons folded down the middle: a lit half and a
 * shaded half, each tier overlapping the one above it. Every HALF is a spring
 * hinged at the trunk, so dragging the pointer across the tree makes that side
 * sag and bounce back, and the snow it was carrying is shaken loose and falls.
 * Nothing is keyframed; it all comes out of the springs settling.
 *
 * Every constant below came off the live tuner (templates/tree-tuner.html),
 * not out of a guess. Sizes are ratios of the tree's own height so the shape
 * is identical at any window size. */

const TIERS = 7
const OVERLAP = 1.61       // tier height in units of the vertical step; >1 overlaps
const NOTCH = 0.25         // how far the underside of a tier is cut back up
const POW = 0.74           // how fast the tiers widen toward the foot
const W_RATIO = 0.812      // full width over height
const TRUNK_R = 0.0332     // trunk half-width over height
const TRUNK_LEN = 0.042    // bare trunk below the lowest tier, over height
const RIM = 1              // dark edge along the underside of a tier
const SHADOW = 0.28        // how hard a tier's shadow falls on the one below
// Detail. A flat chevron reads as cardboard at this size; these are what make
// it a tree without turning it back into the field of needles that was too
// busy to look at.
const TEETH = 0.36         // zigzag depth along the underside, over tier height
const TEETH_N = 5          // teeth per edge
const SUB = 3              // nested inner fronds per half
const GRAD = 0.26          // how much shading crosses a half
const TWIGS = 0.1          // woody lines from the trunk out to the tips
const TEXTURE = 0.66       // fine hatching over the fill
const SNOW_LIT = 0.022     // snow cap depth on the lit half, over height
const SNOW_DARK = 0.011    // ...and on the shaded half
const LIT = '#2a7147'
const DRK = '#123823'
const BAUBLES = ['#e5484d', '#f0a830', '#2bb3a3', '#f5d547', '#7a7df0']

const SPRING = 58          // stiffness; higher springs back faster
const DAMP = 5.4           // settles in roughly a second and a half
const REACH = 80           // how close the pointer has to pass to shake a tier
const IMPULSE = 0.055      // rad/s handed to a half per px the pointer sweeps
// A loaded branch sags and springs back; it does not flip up over its hinge.
// Sweeping upwards used to hand it the full impulse with the sign reversed,
// so every tier flapped 22 degrees into the air and dumped its whole load.
const UP_BIAS = 0.4        // of the impulse an upward sweep is worth
// Small angles on purpose. At 0.34 rad a tip two hundred pixels out swings a
// hundred pixels, which is a flap, not a branch giving under a hand.
const A_DOWN = 0.17        // how far a half may sag, rad
const A_UP = 0.05          // ...and how far it may lift
// Both halves of a tier share the fold at the trunk. Letting them swing
// independently tore that fold open into a black wedge, so a touch on one
// side carries most of the way across.
const COUPLE = 0.45        // of a half's impulse its partner also gets
const V_MAX = 1.6          // rad/s, so one violent flick cannot snap a tier
// Shaking snow loose. The amount that comes off is tied to how hard the
// branch is actually moving, and the flakes you see are bought out of that
// amount - one per PUFF_PER of a half's load. Emitting a flake on every frame
// a half happened to be moving meant one brush across the tree threw hundreds.
// A flick leaves a half with about v0/DAMP of integrated angle, so the share
// that comes off is roughly SHAKE/5.4 of its load - a fifth at this setting,
// which both shows on the branch and buys three or four visible flakes.
const SHAKE = 1.2          // of a half's load shaken off per rad/s per second
const SHED_MIN_V = 0.15    // rad/s below which nothing comes off at all
const PUFF_PER = 0.06      // of a half's load per visible flake
const PUFF_MAX = 60        // flakes in the air from the tree at once
const FILL_SECONDS = 50    // to load a bare branch at the reference's snowfall
const SAMPLES = 18         // points along an edge the snow cap is built from
/* Thirty frames a second while it hangs still - a branch loading snow over
   fifty seconds has nothing to show in the gaps - and sixty for as long as it
   is actually swinging, because a tier crossing its arc in a third of a second
   is exactly where thirty frames read as a stutter. The spring state says
   which: a wing is settled when it has come back to its rest angle and stopped
   moving, and until then every frame is drawn. */
/* Two ceilings rather than targets: the loop can only skip whole display
   frames, so what comes out is the first frame at or past the ceiling - 55 and
   32 on the 165Hz panel this was measured on, 60 and 30 on a 60Hz one. Having
   a ceiling at all is what matters. Uncapped, these layers drew at the panel's
   full 165 and cost 46 points of GPU; at 55 they cost 35, and at 41 they cost
   34 - so 55 is the cheap end of smooth, and there is nothing to buy above it
   but frames too close together to see. */
const FAST_MS = 1000 / 60 - 1
const SLOW_MS = 1000 / 32 - 1
const REST_V = 0.02        // rad/s - slower than this a wing counts as stopped
const REST_A = 0.004       // rad - ...and nearer than this it is back at rest
/* Appearing. The tree is mounted and unmounted with the home screen, so this
   runs on every switch back. Fading the whole thing in as one block left a
   translucent ghost of a tree sitting over the page for most of a second;
   it grows instead - trunk up out of the ground, tiers from the foot to the
   crown, each one easing out of a slight droop, star last. */
const IN_STAGGER = 0.055   // s between one tier and the next
const IN_DUR = 0.42        // s for a single tier to arrive
const IN_DROOP = 0.14      // rad a tier arrives bent by, rad

interface Light { t: number; c: string; ph: number }
interface Wing {
  tier: number               // 0 at the crown, used for the arrival stagger
  ay: number                 // hinge height, relative to the trunk foot
  w: number; h: number       // tip offset from the hinge, before mirroring
  side: 1 | -1               // -1 lit, +1 shaded
  sprite: HTMLCanvasElement  // the half, baked once
  pad: number
  a: number; v: number       // spring offset and angular velocity
  snow: number               // 0..1, how loaded with snow
  debt: number               // shaken-off load not yet paid out as flakes
  prof: Float32Array         // this edge's own lumpiness, so no two caps match
  bauble: { t: number; c: string } | null
  lights: Light[]
}
interface Puff { x: number; y: number; vx: number; vy: number; r: number }

export function Tree() {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const snow = useSettings(s => s.snow)
  const pauseBg = useSettings(s => s.seasonPauseBg)
  const eco = useSettings(s => s.seasonEco)
  const melt = useSettings(s => s.meltSignal)
  const accent = useAccentHex()
  const cfg = useRef(snow); cfg.current = snow
  const pause = useRef(pauseBg); pause.current = pauseBg
  const ecoRef = useRef(eco); ecoRef.current = eco
  const meltRef = useRef(melt); meltRef.current = melt
  const accentRef = useRef(accent); accentRef.current = accent

  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    let dpr = 1, raf = 0, stopped = false, frameNo = 0, age = 0, clock = 0
    let busy = true   // drawing every frame; see SLOW_MS
    let W = 0, H = 0, cx = 160, baseY = 0, cxTarget = 160
    let meltSeen = meltRef.current
    let wings: Wing[] = []
    const puffs: Puff[] = []
    // Movement is ACCUMULATED between frames. Reading the last event's delta
    // meant the impulse depended on how many move events happened to land in
    // that frame, which is what made the tree twitch.
    const mouse = { x: -1e4, y: -1e4, ax: 0, ay: 0, has: false }

    // A deterministic wobble, so the tree looks the same every launch instead
    // of re-growing itself on each reload.
    let seed = 20261231
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

    /* A snow cap's own shape: random per sample, then smoothed, so the edge
       comes out in lumps a few samples wide rather than as sand or as a ruled
       line. A band of constant depth is what made the first attempt look like
       a white stripe painted along the branch. */
    const profile = (n: number) => {
      const a = new Float32Array(n)
      for (let i = 0; i < n; i++) a[i] = rnd()
      for (let p = 0; p < 2; p++) {
        const b = Float32Array.from(a)
        for (let i = 0; i < n; i++) a[i] = (b[Math.max(0, i - 1)] + b[i] * 2 + b[Math.min(n - 1, i + 1)]) / 4
      }
      let lo = 1, hi = 0
      for (let i = 0; i < n; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i] }
      const k = hi > lo ? 1 / (hi - lo) : 1
      // Deep contrast on purpose: stretches that stay nearly bare are what
      // makes a cap read as snow rather than as a stroke along the edge.
      for (let i = 0; i < n; i++) a[i] = 0.15 + 0.85 * ((a[i] - lo) * k)
      return a
    }

    /* One half, hinge at (0,0), tip at (w,h), underside cut back up to
       (0, h*(1-NOTCH)) and serrated along the way. */
    const halfPath = (g: CanvasRenderingContext2D, w: number, h: number, teethN: number) => {
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h)
      const nx = -w, ny = h * (1 - NOTCH) - h
      const L = Math.hypot(nx, ny)
      if (TEETH > 0.02 && L > 4) {
        const ox = -ny / L, oy = nx / L          // away from the body
        const d = TEETH * h * 0.07
        for (let i = 1; i <= teethN; i++) {
          const u = (i - 0.5) / teethN, v = i / teethN
          g.lineTo(w + nx * u + ox * d, h + ny * u + oy * d)
          g.lineTo(w + nx * v, h + ny * v)
        }
      } else g.lineTo(0, h * (1 - NOTCH))
      g.closePath()
    }

    /* Bake a half once. Its texture alone is sixty-odd strokes; drawn live for
       fourteen halves that is nine hundred strokes a frame for a picture that
       never changes. The shadow is NOT baked - it is cast from the sprite's
       own alpha at draw time, so it stays under the tier it belongs to. */
    const bake = (w: number, h: number, side: 1 | -1) => {
      // Room for the baked shadow as well as the teeth: blur 15 plus 6 of
      // offset is what has to fit inside the sprite now.
      const pad = Math.ceil(26 + TEETH * h * 0.07)
      const c = document.createElement('canvas')
      c.width = Math.ceil((w + pad * 2) * dpr)
      c.height = Math.ceil((h + pad * 2) * dpr)
      const g = c.getContext('2d')!
      g.scale(dpr, dpr); g.translate(pad, pad)
      g.lineJoin = 'round'

      halfPath(g, w, h, TEETH_N)
      g.fillStyle = side > 0 ? DRK : LIT
      g.fill()
      if (GRAD > 0.02) {
        const q = g.createLinearGradient(0, 0, w, h)
        q.addColorStop(0, side > 0 ? '#1a4a2e' : '#398a59')
        q.addColorStop(0.55, side > 0 ? DRK : LIT)
        q.addColorStop(1, side > 0 ? '#0c2a1a' : '#1d5737')
        g.globalAlpha = GRAD; g.fillStyle = q; g.fill(); g.globalAlpha = 1
      }

      for (let k = 1; k <= SUB; k++) {
        const s = 1 - k * 0.26
        g.save(); g.translate(0, h * 0.1 * k)
        halfPath(g, w * s, h * s, Math.max(3, Math.round(TEETH_N * s)))
        g.fillStyle = side > 0 ? 'rgba(10,38,24,0.55)' : 'rgba(18,58,36,0.5)'
        g.fill(); g.restore()
      }

      if (TWIGS > 0.02) {
        g.strokeStyle = `rgba(10,30,18,${0.25 + 0.5 * TWIGS})`
        g.lineWidth = 1.1
        for (let i = 1; i <= 4; i++) {
          const u = i / 5
          g.beginPath(); g.moveTo(0, h * (1 - NOTCH) * 0.2)
          g.lineTo(w * u, h * u + h * (1 - NOTCH) * (1 - u) * 0.5); g.stroke()
        }
      }

      if (TEXTURE > 0.02) {
        g.save(); halfPath(g, w, h, TEETH_N); g.clip()
        g.strokeStyle = `rgba(255,255,255,${0.03 + 0.07 * TEXTURE})`
        g.lineWidth = 1
        const n = Math.round(26 + 60 * TEXTURE)
        for (let i = 0; i < n; i++) {
          const u = rnd(), v = rnd() * 0.9
          const x = w * u, y = h * u + (h * (1 - NOTCH) - h * u) * v
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4 + rnd() * 5, y + 2 + rnd() * 4); g.stroke()
        }
        g.restore()
      }

      if (RIM > 0.05) {
        g.beginPath(); g.moveTo(w, h); g.lineTo(0, h * (1 - NOTCH))
        g.lineWidth = RIM; g.lineCap = 'round'
        g.strokeStyle = 'rgba(6,20,12,0.85)'; g.stroke()
      }

      /* The shadow is baked in rather than cast every frame. Measured on this
         machine: fourteen shadowed drawImages per frame cost 34 points of GPU
         process time (105% down to 70%) and changed the picture not at all,
         because the shape under it never changes. It rotates with the branch
         now instead of staying put, which at the ten degrees a branch is
         allowed to sag is not something you can see. */
      const sh = document.createElement('canvas')
      sh.width = c.width; sh.height = c.height
      const sg = sh.getContext('2d')!
      sg.scale(dpr, dpr)
      sg.shadowColor = `rgba(0,0,0,${SHADOW})`
      sg.shadowBlur = 15
      sg.shadowOffsetY = 6
      sg.drawImage(c, 0, 0, c.width / dpr, c.height / dpr)
      return { c: sh, pad }
    }

    const build = () => {
      const vw = window.innerWidth, vh = window.innerHeight
      H = Math.min(vh * 0.78, 780)
      W = H * W_RATIO
      if (W > vw * 0.36) { W = vw * 0.36; H = W / W_RATIO }
      baseY = vh - 10
      seed = 20261231
      wings = []
      const topY = -H, treeBot = -TRUNK_LEN * H
      const sp = (treeBot - topY) / TIERS
      for (let i = 1; i <= TIERS; i++) {
        const t = i / TIERS
        const w = (W / 2) * Math.pow(t, POW)
        const y = topY + t * (treeBot - topY)
        const h = Math.min(sp * OVERLAP, w * 1.5 + H * 0.02)
        for (const side of [1, -1] as const) {      // shaded half first, lit over it
          const lights: Light[] = []
          if (rnd() < 0.55) {
            lights.push({ t: 0.35 + rnd() * 0.5, c: BAUBLES[(rnd() * BAUBLES.length) | 0], ph: rnd() * Math.PI * 2 })
          }
          const { c, pad } = bake(w, h, side)
          wings.push({
            tier: i - 1,
            ay: y - h, w, h, side, sprite: c, pad,
            a: 0, v: 0, snow: 0, debt: 0,
            prof: profile(SAMPLES),
            bauble: i >= 2 && rnd() < 0.5 ? { t: 0.42 + rnd() * 0.36, c: BAUBLES[(rnd() * BAUBLES.length) | 0] } : null,
            lights,
          })
        }
      }
    }

    /* Measured: narrowing this canvas to the tree's own width changed nothing
       (65.6% GPU against 63.5% full-window - noise), so it stays full-window
       and simple. The compositor carries the empty area for free. */
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(window.innerWidth * dpr)
      cv.height = Math.round(window.innerHeight * dpr)
      cv.style.width = window.innerWidth + 'px'
      cv.style.height = window.innerHeight + 'px'
      build()
    }

    // Stand beside the sidebar rather than at a fixed offset: the rail is 208px
    // wide when the rail is wide and 72px when it is narrow, and the tree
    // should slide over with it instead of being swallowed.
    const place = () => {
      const sb = document.querySelector('[data-edit="sidebar"]')?.getBoundingClientRect()
      cxTarget = (sb ? sb.right : 96) + W * 0.42
    }

    const star = (x: number, y: number, r: number, rot: number) => {
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.42 : r
        const a = rot - Math.PI / 2 + (i * Math.PI) / 5
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }

    /* The snow cap on one half, in that half's own rotated frame: a band
       hugging the upper edge whose inner boundary wanders with the edge's
       profile, plus rounded lumps sitting on the edge itself so the lip
       overhangs instead of ending in a straight cut. */
    const cap = (b: Wing, deep: number) => {
      const L = Math.hypot(b.w, b.h)
      const ex = b.w / L, ey = b.h / L        // along the edge, hinge -> tip
      const nx = -b.h / L, ny = b.w / L       // into the body of the half
      const d = (i: number) => deep * b.prof[i] * (1 - 0.45 * (i / (SAMPLES - 1)))

      ctx.beginPath()
      for (let i = 0; i < SAMPLES; i++) {
        const u = (i / (SAMPLES - 1)) * L
        if (i === 0) ctx.moveTo(ex * u, ey * u); else ctx.lineTo(ex * u, ey * u)
      }
      for (let i = SAMPLES - 1; i >= 0; i--) {
        const u = (i / (SAMPLES - 1)) * L, dd = d(i)
        ctx.lineTo(ex * u + nx * dd, ey * u + ny * dd)
      }
      ctx.closePath(); ctx.fill()

      for (let i = 1; i < SAMPLES - 1; i += 2) {
        const dd = d(i)
        if (dd < 0.8) continue
        const u = (i / (SAMPLES - 1)) * L
        ctx.beginPath()
        ctx.arc(ex * u + nx * dd * 0.3, ey * u + ny * dd * 0.3, dd * 0.62, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const frame = (dt: number) => {
      const c = cfg.current
      frameNo++; age += dt; clock += dt

      // Read off last frame's state, so the frame that takes a shove is still
      // drawn at the slow rate and the sixty start one frame later. At 33ms
      // nobody catches that, and it keeps the test out of the hot path.
      busy = age < 2 || puffs.length > 0
      if (!busy) for (const b of wings)
        if (Math.abs(b.v) > REST_V || Math.abs(b.a) > REST_A) { busy = true; break }
      const vw = window.innerWidth, vh = window.innerHeight
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, vw, vh)
      if (!wings.length) return
      if (frameNo % 15 === 1) place()
      cx += (cxTarget - cx) * Math.min(1, 6 * dt)

      const mdx = mouse.ax, mdy = mouse.ay
      mouse.ax = 0; mouse.ay = 0
      const travel = Math.hypot(mdx, mdy)
      const fill = c.fall !== 'off'
        ? (dt / FILL_SECONDS) * (SNOWFALL_DENSITY[c.fall] / 22) : 0
      if (meltRef.current !== meltSeen) {
        meltSeen = meltRef.current
        for (const b of wings) b.snow = 0
      }
      // arrival clocks
      const clamp01 = (x: number) => x < 0 ? 0 : x > 1 ? 1 : x
      const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
      const start = (tier: number) => (TIERS - 1 - tier) * IN_STAGGER
      const grown = start(0) + IN_DUR
      const tp = easeOut(clamp01(age / IN_DUR))
      const gp = easeOut(clamp01((age - 0.05) / 0.5))
      const sp0 = clamp01((age - grown * 0.75) / 0.5)
      // easeOutBack: overshoots past full size around three quarters through,
      // so the star pops onto the crown instead of swelling up to it
      const starP = sp0 >= 1 ? 1 : 1 + 2.70158 * Math.pow(sp0 - 1, 3) + 1.70158 * Math.pow(sp0 - 1, 2)

      // Trunk. It runs up INSIDE the lowest tier, which is drawn over it: cut
      // off at the tier's baseline it left a gap, because a chevron's underside
      // is notched a quarter of its height back up.
      // Trunk, visible only at the foot: it runs up INSIDE the lowest tier,
      // which is drawn over it. Cut off at that tier's baseline it left a gap,
      // because a chevron's underside is notched a quarter of its height up.
      const half = TRUNK_R * H
      const last = wings[wings.length - 1]
      const tg = ctx.createLinearGradient(cx - half, 0, cx + half, 0)
      tg.addColorStop(0, '#6b4426'); tg.addColorStop(0.55, '#4b3020'); tg.addColorStop(1, '#2c1c10')
      ctx.fillStyle = tg
      const tTop = baseY + last.ay + last.h * 0.7
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx - half - 2, baseY + 12 - (baseY + 12 - tTop) * tp, half * 2 + 4, baseY + 12 - tTop)
      ctx.clip()
      ctx.beginPath()
      ctx.moveTo(cx - half, baseY + 10); ctx.lineTo(cx - half * 0.82, tTop)
      ctx.lineTo(cx + half * 0.82, tTop); ctx.lineTo(cx + half, baseY + 10)
      ctx.closePath(); ctx.fill()
      ctx.restore()

      // A green core down the fold, behind the tiers. The halves hinge on the
      // trunk and swing apart, so the fold opens into a wedge; filling it with
      // the trunk showed a brown stripe down the middle of the tree. This is
      // the same two tones as the halves, a shade deeper, so what appears in
      // the wedge reads as more tree rather than as a hole in it.
      // It has to stay INSIDE the silhouette: at a tier's hinge the only thing
      // covering the core is the tier ABOVE, so its half-width there is capped
      // by how wide that tier has grown by this height. At the crown there is
      // nothing above at all, so the core starts as a point; at the foot it
      // stops at the lowest tier's notch rather than below it.
      const cw: number[] = []
      for (let k = 0, i = 0; k < wings.length; k += 2, i++) {
        const b = wings[k]
        if (i === 0) { cw.push(0); continue }
        const up = wings[k - 2]
        cw.push(Math.min(b.h * 0.19, ((b.ay - up.ay) / up.h) * up.w * 0.8))
      }
      // ...and it only exists once the tree has finished arriving. Its job is
      // to fill the fold when a half bends away; drawn at full size while the
      // tiers are still scaled down and half transparent it stood out from
      // under them as a green log.
      const coreA = easeOut(clamp01((age - grown) / 0.3))
      const coreBot = baseY + last.ay + last.h * (1 - NOTCH) - 2
      if (coreA > 0.02) for (const side of [-1, 1] as const) {
        ctx.beginPath()
        ctx.moveTo(cx, baseY + wings[0].ay + 2)
        for (let k = 0, i = 0; k < wings.length; k += 2, i++) {
          ctx.lineTo(cx + side * cw[i], baseY + wings[k].ay)
        }
        ctx.lineTo(cx + side * cw[cw.length - 1], coreBot)
        ctx.lineTo(cx, coreBot)
        ctx.closePath()
        ctx.globalAlpha = coreA
        ctx.fillStyle = side < 0 ? '#235f3b' : '#0e2f1c'
        ctx.fill()
        ctx.globalAlpha = 1
      }

      const imp = new Float64Array(wings.length)
      if (c.physics && mouse.has && travel > 0.6) {
        for (let i = 0; i < wings.length; i++) {
          const b = wings[i]
          const hy = baseY + b.ay
          const phi = Math.atan2(b.h, b.w) + b.a, len = Math.hypot(b.w, b.h)
          const vx = Math.cos(phi) * len * b.side, vy = Math.sin(phi) * len
          const l2 = vx * vx + vy * vy || 1
          const u = Math.max(0, Math.min(1, ((mouse.x - cx) * vx + (mouse.y - hy) * vy) / l2))
          const d = Math.hypot(mouse.x - (cx + vx * u), mouse.y - (hy + vy * u))
          if (d >= REACH) continue
          const k = (1 - d / REACH) * Math.min(1, travel / 22) * (0.25 + u)
          const push = mdy * 0.9 + mdx * b.side * 0.55
          imp[i] = Math.max(-0.8, Math.min(0.8, push * IMPULSE * k * (push < 0 ? UP_BIAS : 1)))
        }
      }

      for (let wi = 0; wi < wings.length; wi++) {
        const b = wings[wi]
        const p = easeOut(clamp01((age - start(b.tier)) / IN_DUR))
        const hx = cx, hy = baseY + b.ay
        // halves are pushed in pairs, so the partner across the fold is wi^1
        b.v += imp[wi] + imp[wi ^ 1] * COUPLE
        if (b.v > V_MAX) b.v = V_MAX
        if (b.v < -V_MAX) b.v = -V_MAX
        b.v += (-SPRING * b.a - DAMP * b.v) * dt
        b.a += b.v * dt
        if (b.a > A_DOWN) { b.a = A_DOWN; b.v = 0 }
        if (b.a < -A_UP) { b.a = -A_UP; b.v = 0 }

        if (fill > 0 && b.snow < 1) b.snow = Math.min(1, b.snow + fill)
        // Nothing falls off a half that is barely carrying anything, or one
        // that is only drifting back to rest.
        const sp = Math.abs(b.v)
        const shed = (b.snow > 0.06 && sp > SHED_MIN_V) ? Math.min(b.snow, sp * SHAKE * dt) : 0
        if (shed > 0) {
          b.snow -= shed
          b.debt += shed
          while (b.debt >= PUFF_PER && puffs.length < PUFF_MAX) {
            b.debt -= PUFF_PER
            const t = 0.25 + rnd() * 0.75
            const phi = Math.atan2(b.h, b.w) + b.a, len = Math.hypot(b.w, b.h) * t
            puffs.push({
              x: hx + Math.cos(phi) * len * b.side, y: hy + Math.sin(phi) * len - 3,
              vx: (rnd() - 0.5) * 26, vy: 10 + rnd() * 30,
              r: 0.8 + rnd() * 1.2,
            })
          }
          // whatever could not be paid out while the air was full is dropped,
          // so a blocked burst does not come back as a delayed one
          if (b.debt > PUFF_PER * 2) b.debt = PUFF_PER * 2
        }

        if (p <= 0) continue
        const sc = 0.8 + 0.2 * p
        ctx.save()
        ctx.globalAlpha = p
        ctx.translate(hx, hy)
        ctx.scale(b.side * sc, sc)
        ctx.rotate(b.a + (1 - p) * IN_DROOP)

        ctx.drawImage(b.sprite, -b.pad, -b.pad, b.sprite.width / dpr, b.sprite.height / dpr)

        if (b.snow > 0.02) {
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(0, -2); ctx.lineTo(b.w, b.h - 2); ctx.lineTo(0, b.h * (1 - NOTCH))
          ctx.closePath(); ctx.clip()
          ctx.fillStyle = b.side > 0 ? '#dbe6f8' : '#ffffff'
          cap(b, (b.side > 0 ? SNOW_DARK : SNOW_LIT) * H * Math.min(1, b.snow * 1.25))
          ctx.restore()
        }

        for (const li of b.lights) {
          const x = b.w * li.t, y = b.h * li.t + 6
          const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(clock * 1.7 + li.ph))
          ctx.globalAlpha = p * pulse
          const g = ctx.createRadialGradient(x, y, 0, x, y, 11)
          g.addColorStop(0, li.c); g.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.fillStyle = g
          ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill()
          ctx.globalAlpha = p
        }
        if (b.bauble) {
          const x = b.w * b.bauble.t, y = b.h * b.bauble.t + 9
          const r = 4 + H * 0.004
          const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r)
          g.addColorStop(0, '#fff'); g.addColorStop(0.28, b.bauble.c); g.addColorStop(1, 'rgba(0,0,0,0.55)')
          ctx.fillStyle = g
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
        }
        ctx.restore()
      }

      // Drift at the foot of the tree. This is the tree's own snow, not the
      // window's: nothing piles up along the bottom of the screen.
      const gw = W * 0.72, gh = 26
      const gg = ctx.createLinearGradient(0, baseY - gh, 0, baseY + 12)
      gg.addColorStop(0, 'rgb(255,255,255)'); gg.addColorStop(1, 'rgb(206,221,243)')
      ctx.fillStyle = gg
      ctx.save()
      ctx.translate(cx, 0); ctx.scale(gp, 1); ctx.translate(-cx, 0)
      ctx.beginPath()
      ctx.moveTo(cx - gw, baseY + 18)
      ctx.quadraticCurveTo(cx - gw * 0.72, baseY - 2, cx - gw * 0.46, baseY - 9)
      ctx.quadraticCurveTo(cx - gw * 0.2, baseY - gh, cx + gw * 0.08, baseY - 7)
      ctx.quadraticCurveTo(cx + gw * 0.48, baseY + 4, cx + gw, baseY + 18)
      ctx.closePath(); ctx.fill()
      ctx.restore()

      // Star, sitting ON the crown. The bare leader it used to perch on read as
      // a stick with a star balanced on it.
      const sr = (14 + H * 0.016) * starP
      const sx = cx, sy = baseY + wings[0].ay + sr * 0.22
      const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(clock * 1.1))
      if (sr > 0.5) {
      const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2 * pulse)
      halo.addColorStop(0, 'rgba(255,236,170,0.5)')
      halo.addColorStop(0.45, `${accentRef.current}44`)
      halo.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = halo
      ctx.beginPath(); ctx.arc(sx, sy, sr * 3.2 * pulse, 0, Math.PI * 2); ctx.fill()
      star(sx, sy, sr, Math.sin(clock * 0.3) * 0.05)
      ctx.fillStyle = '#ffeaa8'; ctx.fill()
      star(sx, sy, sr * 0.5, Math.sin(clock * 0.3) * 0.05)
      ctx.fillStyle = '#fffaf0'; ctx.fill()
      }

      // Snow shaken off the branches, falling away past the bottom
      ctx.fillStyle = 'rgb(255,255,255)'
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i]
        p.vy += 48 * dt
        p.x += p.vx * dt; p.y += p.vy * dt
        p.vx *= Math.pow(0.4, dt)
        if (p.y > vh + 12) { puffs.splice(i, 1); continue }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    /* Thirty frames while it hangs, sixty while it swings - see SLOW_MS. The
       clock runs on real elapsed time either way, so the springs are integrated
       over the same seconds whichever rate they are drawn at. */
    let last = performance.now()
    const tick = (now: number) => {
      if (stopped) return
      raf = requestAnimationFrame(tick)
      const el = now - last
      if (el < (busy && !ecoRef.current ? FAST_MS : SLOW_MS)) return
      last = now
      frame(Math.min(0.05, el / 1000))
    }
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) } }
    const halt = () => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
    const onFocus = () => { if (pause.current) start() }
    const onBlur = () => { if (pause.current) halt() }
    const onMove = (e: MouseEvent) => {
      if (mouse.has) { mouse.ax += e.clientX - mouse.x; mouse.ay += e.clientY - mouse.y }
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true
    }
    const onLeave = () => { mouse.has = false; mouse.ax = 0; mouse.ay = 0 }

    resize()
    place()
    cx = cxTarget
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

  return <canvas ref={cvRef} className="tree-layer" aria-hidden />
}
