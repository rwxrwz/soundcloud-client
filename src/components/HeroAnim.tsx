import { useEffect, useRef } from 'react'
import { useSettings, useUI } from '../store'
import { audioBus } from '../hooks/audioBus'

function readAccent(): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()
  const m = v.match(/\d+/g)
  if (m && m.length >= 3) return [+m[0], +m[1], +m[2]]
  return [150, 150, 180]
}
function rgbToHue([r, g, b]: [number, number, number]): number {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return 230
  let h = 0
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60; if (h < 0) h += 360
  return h
}

// flow-field variants config
const FLOW: Record<string, { per: number; max: number; band: number; sp: [number, number]; sz: [number, number]; trail: boolean; bidir: boolean }> = {
  threads: { per: 4, max: 5200, band: 0.30, sp: [0.6, 1.5], sz: [0.35, 1.0], trail: false, bidir: false },
  silk:    { per: 2, max: 2600, band: 0.30, sp: [0.7, 1.4], sz: [0.5, 1.0],  trail: true,  bidir: false },
  mist:    { per: 6, max: 7200, band: 0.24, sp: [0.5, 1.2], sz: [0.25, 0.7], trail: false, bidir: false },
  weave:   { per: 4, max: 5200, band: 0.32, sp: [0.6, 1.4], sz: [0.35, 0.95], trail: false, bidir: true },
}
const isFlow = (a: string) => a in FLOW

interface FlowP { x: number; y: number; sp: number; a: number; sz: number; dir: number; pts: number[][] | null }

export function HeroAnim() {
  const heroAnim = useSettings(s => s.heroAnim)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => { dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = wrap.clientWidth * dpr; canvas.height = wrap.clientHeight * dpr }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(wrap)

    let accent = readAccent(), hue = rgbToHue(accent)
    const accentTimer = setInterval(() => { accent = readAccent(); hue = rgbToHue(accent) }, 1500)

    const freq = new Uint8Array(128)
    let t = 0, energy = 0
    const rnd = (a: number, b: number) => a + Math.random() * (b - a)
    const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1
    const noBeat = heroAnim === 'wave' || isFlow(heroAnim)

    let wave: Record<string, number>[] = [], flow: FlowP[] = []

    const initFor = (W: number, H: number) => {
      if (heroAnim === 'wave') {
        wave = Array.from({ length: 1300 }, () => ({
          x: Math.random(), vy: gauss(), size: rnd(0.4, 1.3), speed: rnd(0.3, 1.6),
          alpha: rnd(0.22, 0.7), pamp: rnd(0.6, 1.4), pshift: rnd(-1.2, 1.2),
          ph1: rnd(0, 6.283), ph2: rnd(0, 6.283), fr1: rnd(0.25, 2.8), fr2: rnd(0.4, 3.4),
        }))
      } else if (isFlow(heroAnim)) {
        const cfg = FLOW[heroAnim], b = H * cfg.band, count = Math.min(cfg.max, Math.round((W / dpr) * cfg.per))
        flow = Array.from({ length: count }, () => {
          const dir = cfg.bidir ? (Math.random() < 0.5 ? -1 : 1) : 1
          const x = Math.random() * W, y = H * 0.5 + gauss() * b
          return { x, y, sp: rnd(cfg.sp[0], cfg.sp[1]), a: rnd(0.12, 0.5), sz: rnd(cfg.sz[0], cfg.sz[1]), dir, pts: cfg.trail ? [[x, y]] : null }
        })
      }
    }
    let lastW = 0, lastH = 0

    const getBeat = (): number => {
      if (noBeat) return 0
      const an = audioBus.analyser
      let target = 0
      if (an) { an.getByteFrequencyData(freq); const bins = Math.min(48, an.frequencyBinCount); let s = 0; for (let i = 0; i < bins; i++) s += freq[i]; target = s / bins / 255 }
      energy += (target - energy) * 0.08
      return energy
    }

    // Batch thousands of equal-colour dots into a handful of fills, grouped by a
    // quantized alpha bucket — turns N fill() calls per frame into ~B.
    const TAU = 6.283
    const flushBuckets = (paths: Path2D[], maxAl: number, lr: number, lg: number, lb: number) => {
      for (let bi = 0; bi < paths.length; bi++) {
        ctx.fillStyle = `rgba(${lr},${lg},${lb},${(bi + 0.5) / paths.length * maxAl})`
        ctx.fill(paths[bi])
      }
    }

    // Full 60fps on 60Hz panels (draw is cheap now); high-refresh panels are
    // capped to ~60 so they don't render 120fps. dt-step keeps speed consistent.
    const FRAME_MS = 1000 / 61
    let lastFrame = performance.now()

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const elapsed = now - lastFrame
      if (elapsed < FRAME_MS) return
      // frame-rate-independent step relative to a 60fps baseline (keeps speed)
      const step = Math.min(elapsed / 16.67, 3)
      lastFrame = now

      const W = canvas.width, H = canvas.height
      if (W !== lastW || H !== lastH) { lastW = W; lastH = H; initFor(W, H); ctx.clearRect(0, 0, W, H) }
      t += 0.012 * step
      const beat = getBeat()
      const [ar, ag, ab] = accent
      // light particle colour, lightly tinted with the accent
      const lr = (210 + (ar - 210) * 0.35) | 0, lg = (210 + (ag - 210) * 0.35) | 0, lb = (220 + (ab - 220) * 0.35) | 0

      // ── Flow-field variants (threads / silk / mist / weave) ──
      if (isFlow(heroAnim)) {
        const cfg = FLOW[heroAnim], b = H * cfg.band, midY = H * 0.5
        ctx.clearRect(0, 0, W, H)
        ctx.lineCap = 'round'
        const field = (x: number, y: number) => {
          const nx = x / W, ny = y / H
          return Math.sin(nx * 5 + t) * 0.7 + Math.sin(ny * 7 - t * 0.55) * 0.5 + Math.sin((nx * 3 + ny * 3) + t * 0.35) * 0.45
        }
        const B = 6, MAXAL = 0.5
        const buckets = cfg.trail ? null : Array.from({ length: B }, () => new Path2D())
        for (const p of flow) {
          const a = field(p.x, p.y), sp = p.sp * dpr
          p.x += (p.dir * sp * 1.4 + Math.cos(a) * sp * 0.35) * step
          p.y += Math.sin(a) * sp * 1.7 * step
          if ((p.dir > 0 && p.x > W) || (p.dir < 0 && p.x < 0) || p.y < midY - b * 1.6 || p.y > midY + b * 1.6) {
            p.x = p.dir > 0 ? -2 : W + 2; p.y = midY + gauss() * b; if (p.pts) p.pts = [[p.x, p.y]]; continue
          }
          const dy = Math.abs(p.y - midY) / (b * 1.6), env = Math.max(0, 1 - dy * dy)
          const al = p.a * env
          if (al <= 0.012) continue
          if (cfg.trail && p.pts) {
            p.pts.push([p.x, p.y]); if (p.pts.length > 8) p.pts.shift()
            ctx.beginPath()
            for (let j = 0; j < p.pts.length; j++) { const pt = p.pts[j]; j ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]) }
            ctx.strokeStyle = `rgba(${lr},${lg},${lb},${al})`; ctx.lineWidth = p.sz * dpr; ctx.stroke()
          } else if (buckets) {
            const r = p.sz * dpr, path = buckets[Math.min(B - 1, (al / MAXAL * B) | 0)]
            path.moveTo(p.x + r, p.y); path.arc(p.x, p.y, r, 0, TAU)
          }
        }
        if (buckets) flushBuckets(buckets, MAXAL, lr, lg, lb)
        return
      }

      ctx.clearRect(0, 0, W, H)

      if (heroAnim === 'wave') {
        const midY = H * 0.5, amp = H * 0.12, thick = H * 0.12, indiv = H * 0.05
        const bandY = (x: number) => Math.sin(x * 2 + t * 0.45) * 0.6 + Math.sin(x * 3.3 - t * 0.25) * 0.4
        const B = 6, MAXAL = 0.49
        const buckets = Array.from({ length: B }, () => new Path2D())
        for (const p of wave) {
          p.x += p.speed * 0.00009 * step; if (p.x > 1) p.x -= 1
          const x = p.x * W
          const own = (Math.sin(t * p.fr1 * 0.45 + p.ph1) + 0.7 * Math.sin(t * p.fr2 * 0.45 + p.ph2)) * indiv
          const y = midY + bandY(p.x + p.pshift * 0.18) * amp * p.pamp + p.vy * thick + own
          const bf = Math.max(0, 1 - Math.abs(p.vy) * 0.35)
          const al = p.alpha * bf * 0.7
          if (al <= 0.015) continue
          const r = p.size * dpr, path = buckets[Math.min(B - 1, (al / MAXAL * B) | 0)]
          path.moveTo(x + r, y); path.arc(x, y, r, 0, TAU)
        }
        flushBuckets(buckets, MAXAL, lr, lg, lb)
      } else if (heroAnim === 'spectrum') {
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.2, rot = t * 0.25, N = 110
        // Centre glow follows the artwork colour; bars follow the accent colour.
        const [pr, pg, pb] = useUI.getState().artRgb
        const cr = R * (0.78 + beat * 0.4), cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 1.6)
        cg.addColorStop(0, `rgba(${pr},${pg},${pb},${0.34 + beat * 0.45})`)
        cg.addColorStop(0.5, `rgba(${pr},${pg},${pb},${0.12 + beat * 0.2})`)
        cg.addColorStop(1, `rgba(${pr},${pg},${pb},0)`)
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr * 1.6, 0, 6.283); ctx.fill()
        // accent + a lightened accent for the tip dots
        const tr = (ar + (255 - ar) * 0.5) | 0, tg = (ag + (255 - ag) * 0.5) | 0, tb = (ab + (255 - ab) * 0.5) | 0
        ctx.lineCap = 'round'
        for (let i = 0; i < N; i++) {
          const m = Math.min(i, N - i), ang = i / N * 6.283 + rot
          const v = 0.5 + 0.5 * Math.sin(m * 0.42 + t * 2.2) + beat * (0.6 + 0.5 * Math.sin(m * 0.8 - t * 5))
          const len = R * (0.12 + v * 0.55 * (0.35 + beat * 1.5))
          const x1 = cx + Math.cos(ang) * R, y1 = cy + Math.sin(ang) * R, x2 = cx + Math.cos(ang) * (R + len), y2 = cy + Math.sin(ang) * (R + len)
          ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.5 + beat * 0.45})`; ctx.lineWidth = 2.2 * dpr
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
          ctx.beginPath(); ctx.arc(x2, y2, 1.3 * dpr, 0, 6.283); ctx.fillStyle = `rgba(${tr},${tg},${tb},${0.6 + beat * 0.4})`; ctx.fill()
        }
      }
    }
    raf = requestAnimationFrame(draw)

    return () => { cancelAnimationFrame(raf); ro.disconnect(); clearInterval(accentTimer) }
  }, [heroAnim])

  return (
    <div ref={wrapRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}
