import { useUI } from '../store'
import { useT } from '../i18n'

/* The palette button on the home screen. It used to open a menu of its own
   that repeated accent, theme, background and player style - a third copy of
   choices that already existed in settings and in the editing mode, and three
   copies is how they drift apart. It is a shortcut now: it opens the editing
   mode, where every one of those lives on the part of the player it changes. */
export function QuickCustomize() {
  const { editMode, setEditMode, closeEditMode } = useUI()
  const t = useT()

  return (
    /* Above the editing layer while the mode is on, or it could not be
       clicked at all: that layer covers the window to catch the click that
       picks a region, and it would have swallowed this one too. */
    /* 22 rather than 104: this button is only ever drawn on the home screen,
       and home is the player, which has no bar underneath to clear. */
    <div className="absolute z-30" style={{ right: 22, bottom: 22, zIndex: editMode ? 130 : undefined }}>
      {/* The way in and the way out. It used to be one-way, which left the
          button sitting there doing nothing while the mode it opened was on
          screen - and closing had to be found in the banner. Leaving goes
          through closeEditMode rather than setEditMode(false), so the layer
          plays its exit instead of blinking out. */}
      <button
        onClick={() => (editMode ? closeEditMode() : setEditMode(true))}
        title={t('vcLive')}
        className={`icon-btn w-11 h-11 flex items-center justify-center transition-all duration-150 active:scale-90 hover:scale-105${editMode ? '' : ' glass-island'}`}
        style={{
          borderRadius: 9999,
          ...(editMode ? {
            background: 'rgba(var(--accent-rgb),0.9)',
            border: '1px solid rgba(255,255,255,0.3)',
            boxShadow: '0 0 20px -4px rgba(var(--accent-rgb),0.8), var(--sh-1)',
          } : {}),
          color: editMode ? '#fff' : 'rgba(255,255,255,0.85)',
        }}
      >
        <PaletteIcon />
      </button>
    </div>
  )
}

function PaletteIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <circle cx="13.5" cy="6.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r=".8" fill="currentColor" stroke="none" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.4-.2-.78-.42-1.05-.27-.3-.42-.65-.42-1.05 0-.83.7-1.5 1.55-1.5H16c3.3 0 6-2.7 6-6 0-4.42-4.5-8-10-8z" />
    </svg>
  )
}
