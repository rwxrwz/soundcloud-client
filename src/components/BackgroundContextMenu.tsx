import { useUI } from '../store'
import { useMenuAnchor } from './menuAnchor'
import { useT } from '../i18n'

/* Right-click on the window's own background.
 *
 * The way into the editing mode was one button in the bottom-right corner,
 * which is a long way to travel from wherever you happen to be pointing.
 * This is the same door, opened where the cursor already is.
 *
 * It holds one entry on purpose. Everything this menu could usefully offer
 * - accent, theme, background, layout - already lives inside the editing
 * mode, on the part of the player it changes; listing any of it here would
 * start the third copy that the palette button was collapsed to avoid. */
export function BackgroundContextMenu() {
  const { bgMenu, setBgMenu, setEditMode } = useUI()
  const t = useT()
  const { data, ref, style } = useMenuAnchor(bgMenu, () => setBgMenu(null))

  if (!data) return null

  return (
    <div
      ref={ref}
      className="glass-panel fixed z-[200] px-1.5 py-1.5 rounded-xl"
      style={{ ...style, minWidth: 220 }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
    >
      <button
        data-active="false"
        onClick={() => { setBgMenu(null); setEditMode(true) }}
        className="row-hover w-full flex items-center gap-2.5 text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors"
        style={{ color: 'rgba(255,255,255,0.85)' }}
      >
        <span className="shrink-0" style={{ color: 'var(--accent)' }}><PaletteIcon /></span>
        <span className="flex-1">{t('editMode')}</span>
      </button>
    </div>
  )
}

/* The palette button's own icon, so the entry and the button it stands in
   for are visibly the same door. */
function PaletteIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <circle cx="13.5" cy="6.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r=".8" fill="currentColor" stroke="none" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.4-.2-.78-.42-1.05-.27-.3-.42-.65-.42-1.05 0-.83.7-1.5 1.55-1.5H16c3.3 0 6-2.7 6-6 0-4.42-4.5-8-10-8z" />
    </svg>
  )
}
