import { useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  message: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  busy?: boolean
  /** When set, the confirm button stays disabled until the user types this exact text. */
  requireText?: string
  /** Label shown above the confirmation input (used with requireText). */
  requireTextLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  message, confirmLabel, cancelLabel, danger, busy,
  requireText, requireTextLabel, onConfirm, onCancel,
}: Props) {
  const [typed, setTyped] = useState('')
  const needsText = !!requireText
  const matches = needsText ? typed.trim() === requireText!.trim() : true
  const canConfirm = matches && !busy

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center playlist-picker-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        className="playlist-picker-panel glass-island rounded-2xl w-80 overflow-hidden"
        style={danger ? { border: '1.5px solid rgba(239,68,68,0.85)', boxShadow: '0 0 24px rgba(239,68,68,0.35)' } : undefined}
      >
        <div className="p-5">
          <p className="text-sm text-white/85 leading-relaxed">{message}</p>

          {needsText && (
            <div className="mt-4">
              {requireTextLabel && (
                <p className="text-xs text-white/45 mb-2">{requireTextLabel}</p>
              )}
              <input
                autoFocus
                type="text"
                value={typed}
                placeholder={requireText}
                onChange={e => setTyped(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && canConfirm) onConfirm(); if (e.key === 'Escape') onCancel() }}
                className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(239,68,68,0.4)' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,0.8)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)' }}
              />
            </div>
          )}

          <div className="flex items-center gap-2 mt-5">
            <button
              onClick={onCancel}
              className="flex-1 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white/90 transition-all"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={!canConfirm}
              className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: danger ? '#ef4444' : 'var(--accent)' }}
            >
              {busy && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
