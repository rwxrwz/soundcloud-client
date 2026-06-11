import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useProfile, useToast } from '../store'
import { sc, SCPlaylist } from '../services/soundcloud'
import { useT } from '../i18n'

interface Props {
  /** Track IDs to seed the new playlist with (empty = blank playlist). */
  initialTrackIds?: number[]
  onClose: () => void
  /** Called with the freshly created playlist after the library is refreshed. */
  onCreated?: (playlist: SCPlaylist) => void
}

export function CreatePlaylistModal({ initialTrackIds = [], onClose, onCreated }: Props) {
  const { user, setPlaylists } = useProfile()
  const { show: showToast } = useToast()
  const t = useT()
  const [name, setName] = useState('')
  const [sharing, setSharing] = useState<'public' | 'private'>('private')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const title = name.trim()
    if (!title || busy || !user) return
    setBusy(true)
    try {
      const created = await sc.createPlaylist(title, initialTrackIds, sharing)
      // Refresh the library so the new playlist shows up everywhere.
      try {
        const res = await sc.getPlaylists(user.id)
        setPlaylists(res.collection)
      } catch { /* non-fatal — list refreshes on next sync */ }
      showToast(t('playlistCreated'), 'success')
      onCreated?.(created)
      onClose()
    } catch (err) {
      console.error('[CreatePlaylist] failed:', err)
      showToast(t('createPlaylistErr'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center playlist-picker-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="playlist-picker-panel glass-island rounded-2xl w-80 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <p className="text-sm font-semibold text-white/90">{t('newPlaylist')}</p>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <input
            autoFocus
            type="text"
            placeholder={t('playlistName')}
            value={name}
            maxLength={100}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
            className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none transition-all"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.5)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
          />

          {/* Public / Private toggle */}
          <div className="flex items-center gap-1 rounded-xl p-1"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <ShareBtn label={t('sharingPrivate')} active={sharing === 'private'} onClick={() => setSharing('private')} />
            <ShareBtn label={t('sharingPublic')} active={sharing === 'public'} onClick={() => setSharing('public')} />
          </div>

          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white/90 transition-all"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              {t('cancel')}
            </button>
            <button
              onClick={submit}
              disabled={busy || !name.trim()}
              className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)' }}
            >
              {busy && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {busy ? t('creating') : t('create')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ShareBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
      style={{ background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff' : 'rgba(255,255,255,0.45)' }}
    >{label}</button>
  )
}
