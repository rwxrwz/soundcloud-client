import { useLayoutEffect, useRef, useState } from 'react'

// A small segmented toggle with a sliding active-indicator that animates between
// options of arbitrary widths (measured at runtime).
export function SegmentedTabs<T extends string>({ value, options, onChange, size = 'md' }: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [ind, setInd] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const el = refs.current[value]
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value, options.map(o => o[1]).join('|')])

  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'

  return (
    <div className="relative inline-flex items-center gap-1 p-1 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <span className="seg-indicator" style={{ left: ind.left, width: ind.width }} />
      {options.map(([val, label]) => (
        <button
          key={val}
          ref={el => { refs.current[val] = el }}
          onClick={() => onChange(val)}
          className={`relative z-10 rounded-lg font-medium transition-colors duration-200 ${pad}`}
          style={{ color: value === val ? '#fff' : 'rgba(255,255,255,0.5)' }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
