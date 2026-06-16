import { useEffect, useRef } from 'react'
import { useT } from '../i18n'
import type { LyricsResult } from '../services/lyrics'

export function LyricsView({ lyrics, loading, progress, onSeek, mask = true, fontScale = 1 }: {
  lyrics: LyricsResult | null
  loading: boolean
  progress: number
  onSeek: (t: number) => void
  mask?: boolean
  fontScale?: number
}) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLParagraphElement>(null)

  const synced = lyrics?.synced ?? null
  const activeIdx = synced
    ? synced.reduce((acc, l, i) => (l.time <= progress + 0.25 ? i : acc), -1)
    : -1

  // Auto-scroll active line to center
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIdx])

  const box = 'w-full overflow-y-auto text-center px-2 lyrics-scroll'
  const boxStyle = {
    height: 360, maxHeight: '52vh',
    ...(mask ? { maskImage: 'linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent)' } : {}),
  } as React.CSSProperties

  if (loading) return <div className="flex items-center justify-center" style={{ height: 360 }}><div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin" /></div>
  if (!lyrics) return <div className="flex items-center justify-center text-white/40 text-sm" style={{ height: 360 }}>{t('lyricsNotFound')}</div>

  if (synced) {
    return (
      <div ref={containerRef} className={box} style={boxStyle}>
        <div className="py-[40%] space-y-3">
          {synced.map((line, i) => {
            const active = i === activeIdx
            return (
              <p
                key={i}
                ref={active ? activeRef : undefined}
                onClick={() => onSeek(line.time)}
                className="font-semibold leading-snug cursor-pointer transition-all duration-300"
                style={{
                  fontSize: `${1.25 * fontScale}rem`,
                  color: active ? '#fff' : 'rgba(255,255,255,0.35)',
                  transform: active ? 'scale(1.04)' : 'scale(1)',
                  filter: active ? 'none' : 'blur(0.3px)',
                }}
              >
                {line.text || '♪'}
              </p>
            )
          })}
        </div>
      </div>
    )
  }

  // Plain lyrics
  return (
    <div className={box} style={boxStyle}>
      <div className="py-8 whitespace-pre-line text-white/70 leading-relaxed" style={{ fontSize: `${fontScale}rem` }}>{lyrics.plain}</div>
    </div>
  )
}
