import { useToast } from '../store'

const ICONS = {
  success: (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  ),
  error: (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
    </svg>
  ),
  info: (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
    </svg>
  ),
}

const COLORS = {
  success: { bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.35)', color: '#4ade80' },
  error:   { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.35)',  color: '#f87171' },
  info:    { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.75)' },
}

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 8,
        zIndex: 9999,
        pointerEvents: 'none',
        alignItems: 'center',
      }}
    >
      {toasts.map(toast => {
        const c = COLORS[toast.type]
        return (
          <div
            key={toast.id}
            onClick={() => dismiss(toast.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 14px',
              borderRadius: 12,
              background: c.bg,
              border: `1px solid ${c.border}`,
              backdropFilter: 'blur(20px)',
              color: c.color,
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              pointerEvents: 'auto',
              cursor: 'pointer',
              animation: 'toast-in 0.2s cubic-bezier(0.16,1,0.3,1)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}
          >
            {ICONS[toast.type]}
            {toast.message}
          </div>
        )
      })}
    </div>
  )
}
