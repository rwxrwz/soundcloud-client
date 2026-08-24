import { useUpdate } from '../store'
import { pendingUpdate } from '../services/updates'
import { useT } from '../i18n'

// Floating pill shown when a newer GitHub release exists. Dismissing hides it for
// that version (persisted); a later release brings it back.
export function UpdateBanner() {
  const t = useT()
  const { current, releases, dismissed, dismiss } = useUpdate()

  const pending = pendingUpdate(current, releases, dismissed)
  if (!pending) return null
  const ver = pending.tag.replace(/^v/i, '')

  return (
    <div
      className="absolute z-[70] top-11 left-1/2 -translate-x-1/2 flex items-center gap-3 pl-3.5 pr-2 py-2 rounded-full no-drag"
      style={{
        background: 'rgba(20,20,26,0.92)',
        border: '1px solid rgba(var(--accent-rgb),0.4)',
        boxShadow: '0 10px 34px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        animation: 'scale-in 0.2s ease',
      }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white leading-tight">{t('updateBannerTitle')}</p>
        <p className="text-[11px] text-white/50 leading-tight tabular-nums">{t('updateBannerSub')} · v{ver}</p>
      </div>
      <button
        onClick={() => window.open(pending.url)}
        className="icon-btn ml-1 px-3 py-1 rounded-full text-[11px] font-semibold text-white transition-all"
        style={{ background: 'var(--accent)' }}
      >
        {t('updateInstall')}
      </button>
      <button
        onClick={() => dismiss(pending.tag)}
        title={t('updateDismiss')}
        className="icon-btn w-6 h-6 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all shrink-0"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}
