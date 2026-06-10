import { useEffect, useRef } from 'react'
import { usePlayer, useSettings, useUI, ACCENT_COLORS } from '../store'

interface Props {
  analyserRef: React.MutableRefObject<AnalyserNode | null>
}

export function Visualizer({ analyserRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number>(0)
  const fadeRef = useRef<number>(1)
  const barsRef = useRef<Float32Array>()
  const smoothRef = useRef<Float32Array>()
  const { isPlaying } = usePlayer()
  const { visualizerStyle, accent } = useSettings()
  const { artRgb } = useUI()
  const isPlayingRef = useRef(isPlaying)
  const styleRef = useRef(visualizerStyle)
  const accentRef = useRef(ACCENT_COLORS[accent as keyof typeof ACCENT_COLORS] ?? ACCENT_COLORS.orange)

  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { styleRef.current = visualizerStyle }, [visualizerStyle])

  useEffect(() => {
    accentRef.current = accent === 'artwork'
      ? `#${artRgb.map(v => v.toString(16).padStart(2,'0')).join('')}`
      : (ACCENT_COLORS[accent as keyof typeof ACCENT_COLORS] ?? ACCENT_COLORS.orange)
  }, [accent, artRgb])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const draw = () => {
      frameRef.current = requestAnimationFrame(draw)
      const analyser = analyserRef.current
      const W = canvas.width
      const H = canvas.height
      const playing = isPlayingRef.current

      ctx.clearRect(0, 0, W, H)

      if (playing && analyser) {
        fadeRef.current = 1
        const bufLen = analyser.frequencyBinCount
        const data = new Uint8Array(bufLen)
        analyser.getByteFrequencyData(data)

        if (!barsRef.current || barsRef.current.length !== bufLen) {
          barsRef.current = new Float32Array(bufLen)
          smoothRef.current = new Float32Array(bufLen)
        }
        // Exponential smoothing for fluid animation
        for (let i = 0; i < bufLen; i++) {
          const target = (data[i] / 255) * H * 0.9
          smoothRef.current![i] = smoothRef.current![i] * 0.72 + target * 0.28
          barsRef.current[i] = smoothRef.current![i]
        }

        renderStyle(ctx, W, H, barsRef.current, 1, accentRef.current, styleRef.current)
      } else if (fadeRef.current > 0.01 && barsRef.current) {
        fadeRef.current *= 0.92
        renderStyle(ctx, W, H, barsRef.current, fadeRef.current, accentRef.current, styleRef.current)
      } else {
        fadeRef.current = 0
        ctx.beginPath()
        ctx.strokeStyle = `rgba(255,255,255,0.08)`
        ctx.lineWidth = 1
        ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2)
        ctx.stroke()
      }
    }

    draw()
    return () => cancelAnimationFrame(frameRef.current)
  }, [analyserRef])

  return <canvas ref={canvasRef} width={220} height={40} style={{ opacity: 0.9 }} />
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}

function renderStyle(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  barHeights: Float32Array,
  alpha: number,
  accentHex: string,
  style: string
) {
  const [r, g, b] = hexToRgb(accentHex)
  const n = barHeights.length

  if (style === 'wave') {
    ctx.beginPath()
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.9 * alpha})`
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W
      const y = H / 2 - (barHeights[i] / (H * 0.9)) * (H / 2)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.beginPath()
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.35 * alpha})`
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W
      const y = H / 2 + (barHeights[i] / (H * 0.9)) * (H / 2)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()

  } else if (style === 'mirror') {
    const barW = (W / n) * 2.5
    let x = 0
    for (let i = 0; i < n; i++) {
      const bh = barHeights[i] * 0.45
      const g2 = ctx.createLinearGradient(0, H/2, 0, 0)
      g2.addColorStop(0, `rgba(${r},${g},${b},${0.9 * alpha})`)
      g2.addColorStop(1, `rgba(${Math.min(255,r+80)},${Math.min(255,g+40)},${Math.min(255,b+120)},${0.3 * alpha})`)
      ctx.fillStyle = g2
      ctx.beginPath(); ctx.roundRect(x, H/2 - bh, barW - 1, bh, 1); ctx.fill()
      ctx.beginPath(); ctx.roundRect(x, H/2, barW - 1, bh, 1); ctx.fill()
      x += barW + 1
    }

  } else {
    // Default bars
    const barW = (W / n) * 2.5
    let x = 0
    for (let i = 0; i < n; i++) {
      const bh = barHeights[i]
      if (bh < 0.5) { x += barW + 1; continue }
      const grad = ctx.createLinearGradient(0, H, 0, H - bh)
      grad.addColorStop(0, `rgba(${r},${g},${b},${0.95 * alpha})`)
      grad.addColorStop(0.6, `rgba(${Math.min(255,r+60)},${Math.min(255,g+30)},${b},${0.7 * alpha})`)
      grad.addColorStop(1, `rgba(${Math.min(255,r+80)},${Math.min(255,g+40)},${Math.min(255,b+120)},${0.4 * alpha})`)
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.roundRect(x, H - bh, barW - 1, bh, 2); ctx.fill()
      x += barW + 1
    }
  }
}
