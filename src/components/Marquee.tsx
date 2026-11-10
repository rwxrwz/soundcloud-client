import { useEffect, useRef } from 'react'

/* A title too long for its box, read at walking pace.
 *
 * ── What was wrong with the old one ──────────────────────────────────────
 * It measured scrollWidth against clientWidth on the text element itself,
 * and those two can never differ: the text is an inline-block, so it is
 * exactly as wide as its own content, and the clipping happens one level up
 * in the container. The check was therefore always false, the animation
 * class was never applied, and every long title just sat there cut off -
 * without even an ellipsis, since the ellipsis would have had to come from
 * an element that was not the one doing the clipping. The comparison that
 * means something is the text against its box.
 *
 * ── Why the travel is driven from JS ─────────────────────────────────────
 * The two things worth holding constant are the pace and the pause at each
 * end, and both are measured in seconds. CSS keyframe stops are
 * percentages, so one fixed set of them makes a title that overruns by
 * 20px crawl and one that overruns by 400px bolt past, and stretches or
 * squashes the pause to match. Handing the Web Animations API offsets
 * computed from the real distance keeps both fixed, whatever the length.
 *
 * The box must not carry horizontal padding: clientWidth includes it, and
 * the overrun would come out short by that much. Put the padding on a
 * wrapper around this instead. */

/** Pixels a second. Slow enough to read, which is the whole point. */
const SPEED = 30
/** Parked at each end, in ms, before setting off again. */
const HOLD = 2200
/** Under this much overrun it is rounding, not a title that does not fit. */
const SLACK = 4

export function Marquee({ children, className = '', style, onClick }: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const runRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const box = boxRef.current
    const run = runRef.current
    if (!box || !run) return
    let anim: Animation | null = null

    const measure = () => {
      anim?.cancel()
      anim = null
      const over = run.scrollWidth - box.clientWidth
      /* Centred text that does not fit would be centred on its overflow -
         hanging off both sides equally - and the first characters would be
         the ones lost. A title that travels starts flush left. */
      box.style.textAlign = over >= SLACK ? 'left' : ''
      if (over < SLACK) return

      const travel = (over / SPEED) * 1000
      const total = travel * 2 + HOLD * 2
      anim = run.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: HOLD / total },
        { transform: `translateX(${-over}px)`, offset: (HOLD + travel) / total },
        { transform: `translateX(${-over}px)`, offset: (HOLD * 2 + travel) / total },
        { transform: 'translateX(0)', offset: 1 },
      ], { duration: total, iterations: Infinity, easing: 'linear' })
    }

    measure()
    /* Both ends move: the box when the window or the sidebar is resized,
       the run when the font finishes loading. Transform does not change
       either one's layout size, so the animation cannot feed this back. */
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    ro.observe(run)
    return () => { ro.disconnect(); anim?.cancel() }
  }, [children])

  return (
    <div ref={boxRef} className={`marquee-box ${className}`} style={style} onClick={onClick}>
      <span ref={runRef} className="marquee-run">{children}</span>
    </div>
  )
}
