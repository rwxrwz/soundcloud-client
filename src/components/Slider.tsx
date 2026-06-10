import { useRef, useCallback, useEffect, useState } from 'react'

interface Props {
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  color?: string
  className?: string
}

export function Slider({ value, min = 0, max = 1, onChange, onCommit, color = '#ff5500', className = '' }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)
  const active = dragging || hovering

  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0

  const valueFrom = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return value
    return min + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (max - min)
  }, [min, max, value])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    onChange(valueFrom(e.clientX))
  }, [onChange, valueFrom])

  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => onChange(valueFrom(e.clientX))
    const up = (e: MouseEvent) => {
      setDragging(false)
      const v = valueFrom(e.clientX)
      onChange(v)
      onCommit?.(v)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging, onChange, onCommit, valueFrom])

  return (
    <div
      ref={trackRef}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`relative flex items-center cursor-pointer select-none w-full ${className}`}
      style={{ height: 20 }}
    >
      {/* Track */}
      <div className="absolute inset-x-0 rounded-full" style={{
        height: active ? 5 : 3,
        top: '50%', transform: 'translateY(-50%)',
        background: 'rgba(255,255,255,0.12)',
        transition: 'height 0.12s ease'
      }}>
        <div className="h-full rounded-full" style={{
          width: `${pct}%`,
          background: color,
          transition: dragging ? 'none' : 'width 0.1s linear'
        }} />
      </div>

      {/* Thumb */}
      <div style={{
        position: 'absolute',
        width: 13, height: 13,
        borderRadius: '50%',
        background: '#fff',
        top: '50%',
        left: `calc(${pct}% - 6.5px)`,
        transform: `translateY(-50%) scale(${dragging ? 1.2 : 1})`,
        opacity: active ? 1 : 0,
        transition: 'opacity 0.15s ease, transform 0.1s ease',
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        pointerEvents: 'none'
      }} />
    </div>
  )
}
