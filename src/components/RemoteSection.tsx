/* The remote control section: the bot, who may drive it, and the Mini App.
 *
 * Lifted out of the settings panel for the same reason the timing section
 * was: it is shown in two places now, settings and the what's new deck,
 * and two copies would drift apart - a token pasted on the slide has to be
 * the token settings reports a moment later.
 *
 * Neither surface gets a heading - see Column below.
 */

import { useEffect, useState } from 'react'
import { useToast } from '../store'
import { useT } from '../i18n'
import { Toggle, Collapsible, PreviewText } from './settingsControls'
import type { RemoteConfigView, RemoteStatusView, MiniAppStatusView } from '../services/remoteTypes'

/* One column, one gap, and no heading.
 *
 * No heading because neither surface wants one: in settings the tab is
 * already called this in the nav beside it, and on the slide the strip of
 * names says it overhead. A title in either place is the same word twice.
 *
 * The gap lives here and nowhere else. It used to be spelled out again as
 * a bottom margin on the first row, which was invisible while this was a
 * bare fragment and became a double space the moment it was given a flex
 * column to sit in. */
function Column({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>
}

export function RemoteSection() {
  const t = useT()
  const { show: showToast } = useToast()
  const [cfg, setCfg] = useState<RemoteConfigView | null>(null)
  const [status, setStatus] = useState<RemoteStatusView | null>(null)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.electronAPI?.remoteGetConfig?.().then(c => { if (c) { setCfg(c); setStatus(c.status) } }).catch(() => {})
    return window.electronAPI?.onRemoteStatus?.(setStatus)
  }, [])

  const push = async (patch: { enabled?: boolean; token?: string }) => {
    setSaving(true)
    await window.electronAPI?.remoteSetConfig?.(patch).catch(() => {})
    const fresh = await window.electronAPI?.remoteGetConfig?.().catch(() => null)
    if (fresh) { setCfg(fresh); setStatus(fresh.status) }
    setSaving(false)
  }

  const saveToken = async () => {
    const v = token.trim()
    if (!v) return
    setToken('')
    await push({ token: v })
    showToast(t('remoteTokenSaved'), 'success')
  }

  const clearToken = async () => {
    await push({ token: '', enabled: false })
    showToast(t('remoteTokenCleared'), 'success')
  }

  if (!cfg) return <p className="text-sm text-white/40 px-1 py-2">{t('loading')}</p>

  const st = status ?? cfg.status
  const DOT: Record<RemoteStatusView['state'], string> = {
    off: 'rgba(255,255,255,0.25)',
    'no-token': 'rgba(255,255,255,0.25)',
    starting: '#eab308',
    online: '#22c55e',
    'bad-token': '#ef4444',
    conflict: '#eab308',
    network: '#eab308',
  }
  const LABEL: Record<RemoteStatusView['state'], string> = {
    off: t('remoteStOff'),
    'no-token': t('remoteStNoToken'),
    starting: t('remoteStStarting'),
    online: t('remoteStOnline'),
    'bad-token': t('remoteStBadToken'),
    conflict: t('remoteStConflict'),
    network: t('remoteStNetwork'),
  }

  return (
    <Column>
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOT[st.state], boxShadow: `0 0 8px ${DOT[st.state]}` }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white/85">{LABEL[st.state]}</p>
          {st.state === 'online' && st.botUsername && (
            <p className="text-[11px] text-white/40 truncate">@{st.botUsername}</p>
          )}
          {st.detail && st.state !== 'online' && <p className="text-[11px] text-white/35 truncate">{st.detail}</p>}
        </div>
        <Toggle active={cfg.enabled} disabled={!cfg.hasToken || saving} onClick={() => push({ enabled: !cfg.enabled })} />
      </div>

      {st.pending && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.3)' }}>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-white/80 truncate">{st.pending.name}</p>
            <p className="text-[11px] text-white/40">ID {st.pending.id}</p>
          </div>
          <button onClick={() => window.electronAPI?.remoteApprove?.(st.pending!.id)}
            className="icon-btn px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
            style={{ background: 'var(--accent)', color: '#fff' }}>{t('remoteApprove')}</button>
        </div>
      )}

      <Collapsible title={t('remoteToken')} defaultOpen={!cfg.hasToken}
        preview={<PreviewText>{cfg.hasToken ? t('remoteTokenStored') : t('remoteTokenNone')}</PreviewText>}>
        <p className="text-[11px] text-white/35 leading-snug mb-2">{t('remoteTokenHint')}</p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={token}
            spellCheck={false}
            autoComplete="off"
            placeholder={cfg.hasToken ? '••••••••••••' : '123456:ABC-DEF...'}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveToken() }}
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-sm text-white/85 outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
          <button onClick={saveToken} disabled={!token.trim() || saving}
            className="icon-btn px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 disabled:opacity-30"
            style={{ background: 'var(--accent)', color: '#fff' }}>{t('remoteSave')}</button>
        </div>
        {cfg.hasToken && (
          <button onClick={clearToken} className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors mt-2">
            {t('remoteTokenClear')}
          </button>
        )}
      </Collapsible>

      <Collapsible title={t('remoteWhitelist')} preview={<PreviewText>{String(st.allowed.length)}</PreviewText>}>
        <p className="text-[11px] text-white/35 leading-snug mb-2">{t('remoteWhitelistHint')}</p>
        {st.allowed.length === 0
          ? <p className="text-xs text-white/40 py-1">{t('remoteWhitelistEmpty')}</p>
          : (
            <div className="flex flex-col gap-0.5">
              {st.allowed.map(id => (
                <div key={id} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-white/75 tabular-nums">ID {id}</span>
                  <button onClick={() => window.electronAPI?.remoteRevoke?.(id)}
                    className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors">{t('delete')}</button>
                </div>
              ))}
            </div>
          )}
      </Collapsible>

      <MiniAppSection remoteOn={cfg.enabled} />
    </Column>
  )
}

/* The Mini App, which is what the remote now is.
 *
 * It has no switch of its own. The chat is a door and the app is the room,
 * so offering to turn the room off while leaving the door was offering a
 * choice nobody would make twice. It comes up with the bot and goes down
 * with it; all this section does is say how far along that is and hand
 * over the address. */

function MiniAppSection({ remoteOn }: { remoteOn: boolean }) {
  const t = useT()
  const { show: showToast } = useToast()
  const [st, setSt] = useState<MiniAppStatusView | null>(null)
  const [got, setGot] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    window.electronAPI?.miniAppStatus?.().then(s => { if (s) setSt(s) }).catch(() => {})
    const offStatus = window.electronAPI?.onMiniAppStatus?.(s => { setSt(s); setGot(null) })
    const offProgress = window.electronAPI?.onMiniAppProgress?.(setGot)
    return () => { offStatus?.(); offProgress?.() }
  }, [])

  const state = st?.state ?? 'off'
  const DOT: Record<string, string> = {
    off: 'rgba(255,255,255,0.25)', fetching: '#eab308', starting: '#eab308',
    up: '#22c55e', failed: '#ef4444',
  }
  const LABEL: Record<string, string> = {
    off: t('miniStOff'), fetching: t('miniStFetching'), starting: t('miniStStarting'),
    up: t('miniStUp'), failed: t('miniStFailed'),
  }
  const pct = got && got.total > 1 ? Math.round((got.done / got.total) * 100) : null

  const copy = () => {
    if (!st?.url) return
    void navigator.clipboard.writeText(st.url).then(() => showToast(t('miniCopied'), 'success'))
  }

  return (
    <div data-setting="miniapp">
      <Collapsible title={t('miniTitle')} preview={<PreviewText>{remoteOn ? LABEL[state] : t('miniNeedRemote')}</PreviewText>}>
        <p className="text-[11px] text-white/35 leading-snug mb-2.5">{t('miniHint')}</p>

        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="w-2 h-2 rounded-full shrink-0"
            style={{ background: DOT[state], boxShadow: `0 0 8px ${DOT[state]}` }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/85">{remoteOn ? LABEL[state] : t('miniNeedRemote')}</p>
            {/* 35MB is long enough on a slow line that a bare "downloading"
                reads as a hang. */}
            {state === 'fetching' && pct !== null && (
              <p className="text-[11px] text-white/40 tabular-nums">{pct}%</p>
            )}
          </div>
        </div>

        {st?.url && (
          <button onClick={copy}
            className="icon-btn w-full mt-2 px-3 py-2 rounded-xl text-left"
            style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.22)' }}>
            <span className="block text-[11px] text-white/80 break-all leading-snug">{st.url}</span>
          </button>
        )}

        {remoteOn && <p className="text-[11px] text-white/30 leading-snug mt-2">{t('miniTunnelHint')}</p>}
      </Collapsible>
    </div>
  )
}

