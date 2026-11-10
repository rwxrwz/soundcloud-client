import { useEffect, useRef } from 'react'
import { usePlayer, useSettings, useUI, resolveAccentHex, hexToRgb } from '../store'
import { skipFrame } from '../services/perf'

interface Props {
  analyserRef: React.MutableRefObject<AnalyserNode | null>
}

export function Visualizer({ analyserRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number>(0)
  const fadeRef = useRef<number>(1)
  const dataRef = useRef<Uint8Array<ArrayBuffer>>()
  const barsRef = useRef<Float32Array>()
  const smoothRef = useRef<Float32Array>()
  /* Selectors, not whole stores. A bare usePlayer() subscribes to every
     write, and setProgress runs on every timeupdate - so this component
     re-rendered about four times a second for as long as music played,
     which is the exact thing the refs below were built to make unnecessary.
     The same correction was already made in Player.tsx and ContextMenu. */
  const isPlaying = usePlayer(s => s.isPlaying)
  const accent = useSettings(s => s.accent)
  const customAccent = useSettings(s => s.customAccent)
  const artRgb = useUI(s => s.artRgb)
  const isPlayingRef = useRef(isPlaying)
  const accentRef = useRef(resolveAccentHex(accent, customAccent, artRgb))

  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])

  useEffect(() => {
    accentRef.current = resolveAccentHex(accent, customAccent, artRgb)
  }, [accent, customAccent, artRgb])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const perfLast = { t: 0 }
    const draw = () => {
      frameRef.current = requestAnimationFrame(draw)
      if (skipFrame(performance.now(), perfLast)) return
      const analyser = analyserRef.current
      const W = canvas.width
      const H = canvas.height
      const playing = isPlayingRef.current

      ctx.clearRect(0, 0, W, H)

      if (playing && analyser) {
        fadeRef.current = 1
        const bufLen = analyser.frequencyBinCount
        // Reused, like the two below it: a fresh kilobyte thirty times a
        // second, for as long as the app is open, bought nothing.
        if (!dataRef.current || dataRef.current.length !== bufLen) {
          dataRef.current = new Uint8Array(new ArrayBuffer(bufLen))
        }
        const data = dataRef.current
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

        renderBars(ctx, W, H, barsRef.current, 1, accentRef.current)
      } else if (fadeRef.current > 0.01 && barsRef.current) {
        fadeRef.current *= 0.92
        renderBars(ctx, W, H, barsRef.current, fadeRef.current, accentRef.current)
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

function renderBars(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  barHeights: Float32Array,
  alpha: number,
  accentHex: string,
) {
  const [r, g, b] = hexToRgb(accentHex)
  const n = barHeights.length

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
