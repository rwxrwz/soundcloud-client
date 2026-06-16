import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useProfile, useToast } from '../store'
import { sc, SCPlaylist, SCTrack } from '../services/soundcloud'
import { decodePlaylistCode, parsePlaylistText, looksLikeScUrl } from '../services/playlistShare'
import { useT } from '../i18n'

interface Props {
  onClose: () => void
  onImported?: (pl: SCPlaylist) => void
}

export function ImportPlaylistModal({ onClose, onImported }: Props) {
  const { addLocalPlaylist, user, setPlaylists } = useProfile()
  const { show: showToast } = useToast()
  const t = useT()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [asSc, setAsSc] = useState(false)   // false = local playlist, true = real SC playlist

  const submit = async () => {
    const v = input.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      let title = '', tracks: SCTrack[] = []
      if (looksLikeScUrl(v)) {
        const r = await sc.resolvePlaylist(v)
        title = r.title; tracks = r.tracks
      } else {
        // Share code (MZP1) or our readable [sc:ID] tracklist — both resolve to IDs
        const dec = decodePlaylistCode(v) ?? parsePlaylistText(v)
        if (!dec) throw new Error('bad-code')
        title = dec.name
        tracks = await sc.getTracksByIds(dec.ids)
      }
      if (!tracks.length) throw new Error('empty')

      let pl: SCPlaylist
      if (asSc) {
        // Create a real playlist in the account, then refresh the list
        pl = await sc.createPlaylist(title, tracks.map(tr => tr.id).filter(Boolean))
        if (user) {
          try { const res = await sc.getPlaylists(user.id); setPlaylists(res.collection) }
          catch { /* list refreshes on next sync */ }
        }
      } else {
        pl = addLocalPlaylist(title, tracks)
      }
      showToast(t('imported'), 'success')
      onImported?.(pl)
      onClose()
    } catch (e) {
      console.error('[ImportPlaylist] failed:', e)
      showToast(t('importErr'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center playlist-picker-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="playlist-picker-panel glass-island rounded-2xl w-96 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <p className="text-sm font-semibold text-white/90">{t('importPlaylist')}</p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <textarea
            autoFocus
            placeholder={t('pasteCodeOrUrl')}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); if (e.key === 'Escape') onClose() }}
            rows={3}
            className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none transition-all resize-none"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.5)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
          />
          <p className="text-[11px] text-white/35 leading-snug">{t('importHint')}</p>

          {/* Destination: local-only vs a real SoundCloud playlist */}
          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
            {([[false, t('destLocal')], [true, t('destSc')]] as [boolean, string][]).map(([val, label]) => (
              <button
                key={String(val)}
                onClick={() => setAsSc(val)}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: asSc === val ? 'rgba(var(--accent-rgb),0.22)' : 'transparent',
                  color: asSc === val ? '#fff' : 'rgba(255,255,255,0.5)',
                  border: asSc === val ? '1px solid rgba(var(--accent-rgb),0.45)' : '1px solid transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-1">
            <button onClick={onClose} className="flex-1 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white/90 transition-all" style={{ background: 'rgba(255,255,255,0.06)' }}>
              {t('cancel')}
            </button>
            <button
              onClick={submit}
              disabled={busy || !input.trim()}
              className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)' }}
            >
              {busy && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {busy ? t('importing') : t('import')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
