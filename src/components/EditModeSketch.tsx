/* A drawing of editing mode, for the two places that have to sell it.
 *
 * A drawing rather than a screenshot, deliberately. A screenshot is wrong
 * the first time the sidebar moves, weighs a few hundred kilobytes, is
 * soft on any display it was not captured on, and shows one accent colour
 * to everybody - including the person who just picked a different one two
 * slides ago. This follows the accent, stays sharp at any scale, and
 * costs nothing.
 *
 * The ring moves between the rail and the content on a slow loop, which
 * is the whole explanation of the mode: you point at a part of the player
 * and its settings appear beside it. A caption saying that would be a
 * caption nobody reads.
 *
 * Shared on purpose: the last slide of the first run shows it, and the
 * "what's new" card for anyone updating shows the same one, so the thing
 * they are being pointed at looks the same in both.
 */

import { useEffect, useState } from 'react'
import { useT } from '../i18n'

const BAR = 'rgba(255,255,255,0.08)'

export function EditModeSketch({ badge, onTry }: { badge?: boolean; onTry?: () => void }) {
  const t = useT()
  /* Which half wears the ring. Starts on the rail, swaps on a timer, and
     the first swap is late enough that the drawing is still when the
     slide arrives rather than mid-animation. */
  const [lit, setLit] = useState<'rail' | 'main'>('rail')
  useEffect(() => {
    const id = setInterval(() => setLit(p => (p === 'rail' ? 'main' : 'rail')), 1900)
    return () => clearInterval(id)
  }, [])

  const ring = (on: boolean) => ({
    boxShadow: on ? '0 0 0 2px var(--accent)' : '0 0 0 0 rgba(0,0,0,0)',
    transition: 'box-shadow 0.35s ease',
  })

  return (
    <div className="wc-sketch">
      {badge && <span className="wc-sketch-new">NEW</span>}

      <div className="wc-sketch-win" aria-hidden>
        {/* the nav rail */}
        <div className="wc-sk-rail" style={ring(lit === 'rail')}>
          {[0.22, 0.14, 0.14, 0.14].map((o, i) => (
            <span key={i} style={{ background: `rgba(255,255,255,${o})` }} />
          ))}
        </div>

        {/* whatever page is open */}
        <div className="wc-sk-main" style={ring(lit === 'main')}>
          {[58, 86, 72, 80].map((w, i) => (
            <span key={i} style={{ width: `${w}%`, background: i === 0 ? 'rgba(255,255,255,0.13)' : BAR }} />
          ))}
        </div>

        {/* the dock: what the lit part can be changed to */}
        <div className="wc-sk-dock">
          <span className="wc-sk-lbl" />
          <div className="wc-sk-dots">
            <i style={{ background: 'var(--accent)' }} />
            <i /><i />
          </div>
          <span className="wc-sk-row" style={{ width: '86%' }} />
          <span className="wc-sk-row" style={{ width: '60%' }} />
        </div>
      </div>

      {onTry && (
        <button className="wc-sketch-try" onClick={onTry}>{t('wcTryIt')}</button>
      )}
    </div>
  )
}
