import type { CSSProperties } from 'react'
import { useT } from '../i18n'

export function WindowControls() {
  const api = window.electronAPI
  const t = useT()
  if (!api) return null

  return (
    <div
      className="fixed top-0 right-0 flex items-center h-9 px-2 gap-1"
      style={{ zIndex: 100, WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      {/* Minimize */}
      <button
        onClick={() => api.windowMinimize()}
        title={t('minimize')}
        className="w-8 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/90 transition-all duration-150"
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Maximize */}
      <button
        onClick={() => api.windowMaximize()}
        title={t('maximize')}
        className="w-8 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/90 transition-all duration-150"
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
        </svg>
      </button>

      {/* Close */}
      <button
        onClick={() => api.windowClose()}
        title={t('close')}
        className="w-8 h-7 rounded-lg flex items-center justify-center text-white/40 transition-all duration-150"
        onMouseEnter={e => { e.currentTarget.style.background = '#e81123'; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
