import { useEffect, useRef } from 'react'
import { useSettings } from '../store'
import branchUrl from '../assets/sakura.webp'
import { blurScale } from '../services/perf'

/* A blossoming branch in the corner, bending in the wind and shedding petals.
 *
 * The branch is one photograph, and it moves because it is drawn as a grid of
 * small tiles, each pushed sideways by its own amount. What decides that
 * amount is how far the tile is from where the branch leaves the frame, in a
 * straight line - not how far across the picture it sits. That distinction is
 * the whole difference between a branch and a sheet of rubber: measured
 * across, a cluster hanging low but close to the trunk barely moves while the
 * one beside it slides, and the picture reads as something being stretched.
 * Measured outward, everything at the same reach swings together, the trunk
 * end stays put, and it reads as wind.
 *
 * A gust does not arrive everywhere at once either. Each tile reads the wind
 * as it was a moment earlier, the delay growing with reach, so a gust lands
 * on the trunk and travels out to the tips. On the slow breath underneath
 * that is imperceptible; on a gust, which starts sharply, it is the thing
 * that sells it.
 *
 * Tearing cannot happen: neighbouring tiles differ by well under a pixel of
 * shift, they are drawn overlapping by one, and everything around the flowers
 * is black - which is keyed away.
 *
 * The photograph arrives as blossom on a solid black field, which would be an
 * opaque 16:9 slab over the player's own background. So its alpha is rebuilt
 * once at load from its own brightness: the black falls away, the faint glow
 * around the flowers survives as a soft edge, and what is left sits over the
 * aurora, over artwork, over anything, at any window shape - there is no
 * letterboxing to hide.
 *
 * Petals come off the blossom rather than out of thin air: the same pass that
 * keys the image measures how much flower is in each cell of the grid, and a
 * petal is born in a cell that has some. They fall in front of the panels
 * while the branch stays behind them, like the snow and the rain, and they
 * ride the same wind - the gust that bends the branch is the one that carries
 * them off, which is what makes the two read as one piece of weather. */

const FAST_MS = 1000 / 60 - 1
const SLOW_MS = 1000 / 32 - 1

/* Which corner it hangs in. The photograph has the branch growing out of the
   top left, so this is simply where it was shot. */
const FLIP = false

/* How much of the window it takes. Covering it, the way a wallpaper would,
   put blossom across two thirds of the screen and turned the player into a
   greetings card; at these fractions it is a corner the eye rests on and then
   leaves alone. The second number keeps it from shrinking to a twig on a
   short, wide window. */
const SIZE_W = 0.72
const SIZE_H = 0.55

/* Where the branch leaves the frame, as a fraction of the picture: the point
   everything else is measured from, and the one place that never moves. */
const ROOT_X = 0.02
const ROOT_Y = 0.10

const GRID_W = 32        // tiles across; finer is smoother and dearer
/* Tip travel at full wind. A photograph cannot foreshorten, so past about
   twenty-five pixels the warp stops reading as a branch leaning and starts
   reading as rubber - gusts land on top of the breath, so this number is not
   the maximum, it is about two thirds of it. */
const SWAY = 15
/* The dip. A tip pushed aside swings on an arc, so it descends whichever way
   it goes - which means this bobs at twice the rate the branch sways, and a
   little of it goes a long way. */
const SAG = 0.14
const BEND = 1.5         // >1 holds the trunk end still while the far end moves
/* How long a gust takes to reach the tips. Was 0.55s, which is roughly how
   long a wave takes to cross a tree - but this is one branch filling a
   corner of the screen, and at that scale everything in frame moves nearly
   together. Half a second of travel drew a visible front sweeping outward
   through the image: every pixel at the same distance from the root
   displaced at the same instant, in a perfect arc. That reads as a sheet
   being shaken, not as wood bending. Short enough now to feel like whip
   rather than ripple. */
const LAG = 0.14
const BANDS = 24         // steps the delay is quantised into, to stay cheap
/* Ceiling on the wind, in units of SWAY. Set from the budget rather than
   by feel: SWAY is 15px and the note above says past about 25px of tip
   travel the warp reads as rubber, so everything added together has to
   stay under 25/15 = 1.67. The diagonal drift below contributes 0.22 of
   that, which leaves this. At 1.55 a strong gust landed at 26px - inside
   the rubber, which is why it looked fine most of the time and wrong
   occasionally. */
const WIND_MAX = 1.15
const BREATH = 0.42      // rad/s of the steady breathing under the gusts
const GUST_RATE = 0.09   // gusts per second
/* How hard one gust pulls. Was up to 1.7, which on its own could saturate
   the ceiling with the breath still to come. */
const GUST_MIN = 0.45
const GUST_SPAN = 0.75
/* No new gust while the last one is still doing most of its work. Several
   overlapping gusts all land on the ceiling, and a branch pinned at full
   bend for seconds looks broken rather than windy. */
const GUST_GAP = 1.6     // s
const GUST_ATTACK = 0.34 // s to hit full strength; sharper than this cracks like a whip
/* A second, much gentler wave running diagonally across the image, out of
   step with the radial one. Its only job is to break the circular symmetry:
   without it every tile at the same reach moves identically, and the eye
   picks the arc out immediately. Spatial on purpose - neighbouring tiles
   stay nearly in phase, so the picture bends instead of tearing. */
const DRIFT_A = 0.22     // share of SWAY
const DRIFT_RATE = 0.61  // rad/s
const DRIFT_SX = 0.42    // rad per tile across
const DRIFT_SY = 0.27    // rad per tile down
const GUST_DECAY = 2.4   // s to fall away again
/* The key: below KEY_LO the photograph's black is gone, above KEY_HI the
   flowers are solid, and the ramp between keeps a lit halo around a cluster
   instead of a cut-out edge. */
const KEY_LO = 6
const KEY_HI = 26
/* A petal that has let go drifts on the prevailing breeze, and the breeze
   blows away from the corner the branch hangs in - otherwise half of them
   leave by the nearest edge a second after they appear. */
const BLOW = FLIP ? -11 : 11
const PETAL_MP = 22      // petals per megapixel of window
const PETAL_COLS = ['#ffcdd0', '#fbb3b2', '#f3b6b4', '#e69ea4', '#d98f9a']

interface Tile { sx: number; sy: number; sw: number; sh: number; amp: number; band: number; drift: number }
interface Petal {
  x: number; y: number; vy: number
  sway: number; swaySp: number; swayAmp: number
  rot: number; rotSp: number
  spin: number; spinSp: number      // the turn-over, faked by squashing width
  w: number; h: number
  col: number
  drift: number                     // this petal's share of the wind
  fade: number                      // seconds of fade-in after a spawn
}

export function Sakura() {
  const skyRef = useRef<HTMLCanvasElement>(null)
  const petRef = useRef<HTMLCanvasElement>(null)
  const pauseBg = useSettings(s => s.seasonPauseBg)
  const eco = useSettings(s => s.seasonEco)
  const blur = useSettings(s => s.sakuraBlur)
  const blurPetals = useSettings(s => s.sakuraBlurPetals)
  const pause = useRef(pauseBg); pause.current = pauseBg
  const ecoRef = useRef(eco); ecoRef.current = eco

  useEffect(() => {
    const sky = skyRef.current, pet = petRef.current
    if (!sky || !pet) return
    const sc = sky.getContext('2d'), pc = pet.getContext('2d')
    if (!sc || !pc) return

    let dpr = 1, raf = 0, stopped = false
    let W = 0, H = 0, t = 0
    let src: HTMLCanvasElement | null = null
    let iw = 0, ih = 0, gw = 0, gh = 0
    let tiles: Tile[] = []
    let blossom: { x: number; y: number; w: number; h: number }[] = []
    let scale = 1, dy = 0
    const gusts: { t0: number; a: number }[] = []
    const petals: Petal[] = []
    const band = new Float32Array(BANDS)
    let sprites: HTMLCanvasElement[] = []

    /* One pass over the photograph: rebuild its alpha from its own brightness
       and, in the same sweep, work out which tiles have anything on them and
       which have enough flower to shed a petal. */
    const prepare = (img: HTMLImageElement) => {
      iw = img.naturalWidth; ih = img.naturalHeight
      const c = document.createElement('canvas')
      c.width = iw; c.height = ih
      const g = c.getContext('2d')
      if (!g) return
      g.drawImage(img, 0, 0)
      const data = g.getImageData(0, 0, iw, ih)
      const a = data.data
      gw = GRID_W
      gh = Math.max(1, Math.round(GRID_W * ih / iw))
      const sum = new Float32Array(gw * gh)
      const cnt = new Float32Array(gw * gh)
      const k = 255 / (KEY_HI - KEY_LO)
      for (let y = 0, i = 0; y < ih; y++) {
        const gy = ((y * gh / ih) | 0) * gw
        for (let x = 0; x < iw; x++, i += 4) {
          const m = a[i] > a[i + 1] ? (a[i] > a[i + 2] ? a[i] : a[i + 2]) : (a[i + 1] > a[i + 2] ? a[i + 1] : a[i + 2])
          const al = m <= KEY_LO ? 0 : m >= KEY_HI ? 255 : ((m - KEY_LO) * k) | 0
          a[i + 3] = al
          const cell = gy + ((x * gw / iw) | 0)
          sum[cell] += al; cnt[cell]++
        }
      }
      g.putImageData(data, 0, 0)
      src = c

      // Reach, measured from the root, normalised by the furthest tile that
      // has anything on it - so the numbers below mean the same thing however
      // the picture is cropped or replaced.
      const cw = iw / gw, ch = ih / gh
      const rx = ROOT_X * iw, ry = ROOT_Y * ih
      const lit: { gx: number; gy: number; d: number }[] = []
      let far = 1
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const i = gy * gw + gx
          if (!cnt[i] || sum[i] / cnt[i] < 2) continue      // nothing but black
          const d = Math.hypot((gx + 0.5) * cw - rx, (gy + 0.5) * ch - ry)
          if (d > far) far = d
          lit.push({ gx, gy, d })
        }
      }
      tiles = lit.map(({ gx, gy, d }) => {
        const r = d / far
        return {
          sx: gx * cw, sy: gy * ch, sw: cw, sh: ch,
          amp: Math.pow(r, BEND),
          band: Math.min(BANDS - 1, Math.round(r * (BANDS - 1))),
          drift: gx * DRIFT_SX + gy * DRIFT_SY,
        }
      })
      // Only cells with real flower in them can shed a petal - one that is
      // mostly the faint halo would drop petals out of empty sky.
      blossom = []
      for (let i = 0; i < sum.length; i++) {
        if (cnt[i] && sum[i] / cnt[i] > 90) {
          blossom.push({ x: (i % gw) * cw, y: ((i / gw) | 0) * ch, w: cw, h: ch })
        }
      }
      layout()
    }

    /* A corner piece, anchored to the top edge, with a little overscan so a
       downward dip never uncovers the top row. */
    const layout = () => {
      if (!src) return
      scale = Math.max((W / iw) * SIZE_W, (H / ih) * SIZE_H)
      dy = -Math.max(8, SWAY * SAG + 4)
    }

    const buildSprites = () => {
      sprites = PETAL_COLS.map(col => {
        const s = Math.ceil(26 * dpr)
        const c = document.createElement('canvas')
        c.width = c.height = s
        const g = c.getContext('2d')!
        const w = s * 0.62, h = s * 0.92
        g.translate(s / 2, s / 2)
        g.fillStyle = col
        g.beginPath()
        g.moveTo(0, -h / 2)
        g.bezierCurveTo(w / 2, -h / 4, w / 2, h / 3, 0, h / 2)
        g.bezierCurveTo(-w / 2, h / 3, -w / 2, -h / 4, 0, -h / 2)
        g.fill()
        // The cleft at the wide end: it is two pixels on screen and it is the
        // difference between a petal and a grain of rice.
        g.globalCompositeOperation = 'destination-out'
        g.beginPath(); g.arc(0, h / 2, w * 0.22, 0, Math.PI * 2); g.fill()
        return c
      })
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth; H = window.innerHeight
      for (const cv of [sky, pet]) {
        cv.width = Math.round(W * dpr)
        cv.height = Math.round(H * dpr)
        cv.style.width = W + 'px'
        cv.style.height = H + 'px'
      }
      buildSprites()
      layout()
      fill()
    }

    /* Where on screen an image point lands, mirroring included. */
    const px = (ix: number) => (FLIP ? W - ix * scale : ix * scale)
    const py = (iy: number) => dy + iy * scale

    const spawn = (p: Petal, anywhere: boolean) => {
      const sp = sprites.length ? (Math.random() * sprites.length) | 0 : 0
      const sz = 7 + Math.random() * 7
      p.w = sz; p.h = sz * 1.45
      p.col = sp
      p.vy = 17 + sz * 1.6 + Math.random() * 10
      p.sway = Math.random() * Math.PI * 2
      p.swaySp = 1.1 + Math.random() * 1.4
      p.swayAmp = 7 + Math.random() * 14
      p.rot = Math.random() * Math.PI * 2
      p.rotSp = (Math.random() - 0.5) * 1.6
      p.spin = Math.random() * Math.PI * 2
      p.spinSp = 0.9 + Math.random() * 1.8
      p.drift = 0.7 + Math.random() * 0.7
      if (anywhere || !blossom.length) {
        p.x = Math.random() * W
        p.y = Math.random() * H
        p.fade = 0
      } else {
        const b = blossom[(Math.random() * blossom.length) | 0]
        p.x = px(b.x + Math.random() * b.w)
        p.y = py(b.y + Math.random() * b.h)
        // Born on a flower, so it has to appear rather than pop into being.
        p.fade = 0.45
      }
      return p
    }

    /* Petals added here start spread through the window rather than at the
       branch: on the first frame that is the difference between weather and a
       burst, and on a resize nobody should see a clump arrive. */
    const fill = () => {
      const want = Math.round(PETAL_MP * (W * H) / 1e6)
      while (petals.length > want) petals.pop()
      while (petals.length < want) petals.push(spawn({} as Petal, true))
    }

    const frame = (dt: number) => {
      t += dt
      // A steady breath with gusts on top, each gust arriving at random,
      // hitting hard and dying away - weather, not a metronome.
      const lastGust = gusts.length ? gusts[gusts.length - 1].t0 : -Infinity
      if (t - lastGust > GUST_GAP && Math.random() < GUST_RATE * dt) {
        gusts.push({ t0: t, a: GUST_MIN + Math.random() * GUST_SPAN })
      }
      while (gusts.length && t - gusts[0].t0 > GUST_DECAY * 4) gusts.shift()
      const windAt = (delay: number) => {
        const tt = t - delay
        let w = Math.sin(tt * BREATH) * 0.6 + Math.sin(tt * BREATH * 0.43 + 1.3) * 0.4
        for (const g of gusts) {
          const x = tt - g.t0
          if (x > 0) w += g.a * (1 - Math.exp(-x / GUST_ATTACK)) * Math.exp(-x / GUST_DECAY)
        }
        /* Softly, so two gusts landing together cannot add up to a bend no
           branch makes. Below the ceiling this barely touches the number;
           above it, it flattens instead of clipping, so a hard gust still
           feels harder than a soft one. */
        return Math.tanh(w / WIND_MAX) * WIND_MAX
      }
      // One reading of the wind per band of reach rather than per tile: the
      // tiles inside a band are a few milliseconds apart, which nobody sees.
      for (let i = 0; i < BANDS; i++) band[i] = windAt((i / (BANDS - 1)) * LAG)

      // ── the branch ───────────────────────────────────────────────────────
      sc.setTransform(dpr, 0, 0, dpr, 0, 0)
      sc.clearRect(0, 0, W, H)
      if (src) {
        sc.save()
        if (FLIP) { sc.translate(W, 0); sc.scale(-1, 1) }
        for (const tl of tiles) {
          const o = SWAY * tl.amp * (band[tl.band] + DRIFT_A * Math.sin(tl.drift + t * DRIFT_RATE))
          sc.drawImage(src,
            tl.sx, tl.sy, tl.sw + 1, tl.sh + 1,
            tl.sx * scale + o, dy + tl.sy * scale + Math.abs(o) * SAG,
            (tl.sw + 1) * scale, (tl.sh + 1) * scale)
        }
        sc.restore()
      }

      // ── the petals ───────────────────────────────────────────────────────
      const gale = band[BANDS - 1]
      pc.setTransform(dpr, 0, 0, dpr, 0, 0)
      pc.clearRect(0, 0, W, H)
      for (const p of petals) {
        p.sway += p.swaySp * dt
        p.spin += p.spinSp * dt
        p.rot += p.rotSp * dt
        p.y += p.vy * dt
        p.x += (Math.cos(p.sway) * p.swayAmp + (gale * 19 + BLOW) * p.drift) * dt
        if (p.fade > 0) p.fade = Math.max(0, p.fade - dt)
        if (p.y > H + 24 || p.x < -40 || p.x > W + 40) { spawn(p, false); continue }
        const sp = sprites[p.col]
        if (!sp) continue
        pc.save()
        pc.translate(p.x, p.y)
        pc.rotate(p.rot)
        // Turning over in the air: the petal narrows, vanishes edge-on for an
        // instant, and comes back the other way round.
        pc.scale(Math.cos(p.spin) * 0.82 + 0.18, 1)
        pc.globalAlpha = p.fade > 0 ? 1 - p.fade / 0.45 : 1
        pc.drawImage(sp, -p.w / 2, -p.h / 2, p.w, p.h)
        pc.restore()
      }
      pc.globalAlpha = 1
    }

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
    const onFocus = () => { if (pause.current) start() }
    const onBlur = () => { if (pause.current) halt() }

    resize()
    const img = new Image()
    img.onload = () => { if (!stopped) prepare(img) }
    img.src = branchUrl
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
      <canvas ref={skyRef} className="sakura-branch" aria-hidden
        style={blur > 0 ? { filter: `blur(${blur}px)`, transform: `scale(${blurScale(blur)})` } : undefined} />
      {/* No overscan on this one. The branch needed growing because a
          blurred photograph fades at its edges and leaves a pale frame;
          this canvas is transparent apart from the petals, so there is no
          frame to hide - and scaling it would slide every petal off the
          path it was drawn along. */}
      <canvas ref={petRef} className="sakura-petals" aria-hidden
        style={blur > 0 && blurPetals ? { filter: `blur(${blur}px)` } : undefined} />
    </>
  )
}
