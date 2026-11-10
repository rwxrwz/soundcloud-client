/* The lyrics timing section, and the model card it carries.
 *
 * Lifted out of the settings panel because it is now shown in three
 * places: settings, the first run, and the what's new deck. One copy, so
 * a person who downloads the model during the first run does not meet a
 * second button in settings that disagrees about whether it is there.
 *
 * `bare` drops the section heading for the two surfaces that have a
 * title of their own above it.
 */

import { useState, useEffect, useRef } from 'react'
import { useSettings, useUI, useToast, AI_MODELS } from '../store'
import { SegmentedTabs } from './SegmentedTabs'
import { Toggle } from './settingsControls'
import { useT } from '../i18n'

function SystemToggle({ label, sub, active, onClick }: { label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col min-w-0">
        <span className="text-sm text-white/80">{label}</span>
        <span className="text-[10px] text-white/40">{sub}</span>
      </div>
      <Toggle active={active} onClick={onClick} />
    </div>
  )
}

/* The heading belongs to settings, where this sits among other sections.
   On a slide of its own the slide already has a title, and a second one
   under it reads as a stutter. */
function Wrap({ bare, title, children }: { bare?: boolean; title: string; children: React.ReactNode }) {
  return bare ? <>{children}</> : <Section title={title}>{children}</Section>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  )
}

/* The exact size of the int8 model, so the button can say what it will
   cost before it costs it. Mirrors MODEL_BYTES in electron/forcedAlign.ts;
   it is a constant of the file being fetched, not a setting. */
const MODEL_SIZE = 317_341_664

/* Said once, here, and read off electron/forcedAlign.ts: the name of the
   file being fetched and where it comes from. */
const MODEL_NAME = 'MMS-300M forced aligner'
const MODEL_FROM = 'onnx-community · Hugging Face · int8'

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`

/* Time left, from the smoothed rate. The rounding gets coarser the further
   out the estimate is: minutes while there are minutes to go, fives in the
   middle, single seconds only at the end, where the figure is actually
   worth reading. A countdown that ticks 1:59, 2:04, 1:57 reads as broken
   even when every one of those numbers is right. */
function eta(left: number, t: (k: 'lyModelLeft' | 'stSec' | 'stMin') => string): string {
  if (!isFinite(left) || left < 0) return ''
  const unit = left < 60 ? t('stSec') : t('stMin')
  const n = left >= 60 ? Math.round(left / 60)
    : left >= 20 ? Math.round(left / 5) * 5
    : Math.max(1, Math.ceil(left))
  return `${n} ${unit} ${t('lyModelLeft')}`
}

export function AlignModelCard({ onInstalled }: { onInstalled: (have: boolean) => void }) {
  const t = useT()
  const showToast = useToast(s => s.show)
  const [info, setInfo] = useState<{ have: boolean; bytes: number; total: number; dir: string } | null>(null)
  /* null when idle. Bytes, not a percentage: the speed and the estimate
     are the useful part of a 300MB wait and neither can be recovered from
     a rounded percent. */
  const [dl, setDl] = useState<{ done: number; total: number; bps: number } | null>(null)
  const tick = useRef<{ at: number; done: number; bps: number } | null>(null)
  const stopped = useRef(false)
  const askConfirm = useUI(s => s.askConfirm)

  const refresh = () => {
    window.electronAPI?.alignInfo?.().then(i => { setInfo(i); onInstalled(i.have) }).catch(() => {})
  }
  useEffect(refresh, [])

  useEffect(() => window.electronAPI?.onAlignProgress?.(p => {
    const now = performance.now()
    const prev = tick.current
    let bps = prev?.bps ?? 0
    if (prev && now > prev.at) {
      const inst = ((p.done - prev.done) * 1000) / (now - prev.at)
      /* Smoothed, because a raw reading between two packets swings by a
         factor of ten and an estimate built on it is unreadable. */
      bps = prev.bps ? prev.bps * 0.75 + inst * 0.25 : inst
    }
    tick.current = { at: now, done: p.done, bps }
    setDl({ done: p.done, total: p.total, bps })
  }), [])

  const total = info?.total || MODEL_SIZE

  const download = async () => {
    stopped.current = false
    tick.current = null
    setDl({ done: 0, total, bps: 0 })
    const ok = await window.electronAPI?.alignFetch?.()
    setDl(null)
    tick.current = null
    refresh()
    if (ok) showToast(t('alignReadyMsg'), 'success')
    else if (stopped.current) showToast(t('lyModelStopped'), 'info')
    else showToast(t('alignFailed'), 'error')
  }

  const cancel = () => {
    stopped.current = true
    window.electronAPI?.alignCancel?.()
  }

  const remove = async () => {
    if (!await askConfirm(t('lyModelDropAsk'), t('lyModelDrop'), true)) return
    const gone = await window.electronAPI?.alignRemove?.()
    refresh()
    if (gone) showToast(t('lyModelGone'), 'success')
  }

  const have = !!info?.have
  const pct = dl ? (dl.done / dl.total) * 100 : 0

  return (
    <div className="mt-3 rounded-xl overflow-hidden page-enter"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>

      {/* Header: the same three lines in every state, so nothing reflows
          when the body underneath changes. */}
      <div className="flex items-start gap-3 px-3.5 pt-3 pb-2.5">
        <span className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: have ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${have ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.09)'}`,
          }}>
          <svg className="w-[18px] h-[18px]" style={{ color: have ? '#4ade80' : 'rgba(255,255,255,0.45)' }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h3l2.5-7 3 14 2.5-7h3" />
            <circle cx="20" cy="12" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] text-white/85 truncate">{MODEL_NAME}</span>
            {/* Installed, the figure means what is on disk. Before that the
                size belongs on the button that is about to spend it, and
                printing it twice ten pixels apart just reads as noise. */}
            {have && <span className="text-[11px] text-white/35 shrink-0 tabular-nums">{mb(info?.bytes || total)}</span>}
          </span>
          <span className="block text-[11px] text-white/35 mt-0.5 truncate">{MODEL_FROM}</span>
          <span className="block text-[11px] mt-1"
            style={{ color: have ? '#4ade80' : 'rgba(255,255,255,0.45)' }}>
            {dl ? t('alignFetching') : have ? t('lyModelHere') : t('lyModelMissing')}
          </span>
        </span>
      </div>

      <div className="px-3.5 pb-3">
        {dl ? (
          <>
            <div className="flex items-center justify-between gap-3 text-[11.5px]">
              <span className="text-white/85 tabular-nums">{Math.round(pct)}%</span>
              <button onClick={cancel}
                className="icon-btn px-2.5 py-1 rounded-lg text-[11px] transition-all"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
                {t('cancel')}
              </button>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <div className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  /* A floor, so the first megabytes read as a bar starting
                     rather than an empty track: at 1% of 303MB the fill is
                     under two pixels and looks like nothing happened. */
                  minWidth: dl.done > 0 ? 6 : 0,
                  background: 'var(--accent)',
                  // No easing: the bar is a readout, and a bar that glides
                  // on after the bytes stop is telling a small lie.
                  transition: 'width 0.12s linear',
                }} />
            </div>
            <div className="flex items-center justify-between gap-3 mt-1.5 text-[10.5px] text-white/35 tabular-nums">
              <span>{mb(dl.done)} / {mb(dl.total)}</span>
              {/* The estimate drops away on the last frame: "100%, 1 s left"
                  is the one moment where the countdown has nothing to say. */}
              <span>{dl.bps <= 0 ? t('lyModelStarting')
                : dl.done >= dl.total ? `${mb(dl.bps)}/s`
                : `${mb(dl.bps)}/s · ${eta((dl.total - dl.done) / dl.bps, t)}`}</span>
            </div>
          </>
        ) : (
          <>
            {/* The whole body. Three chips used to sit under this sentence
                repeating two thirds of it in shorter words; what they had
                that the sentence did not - how long a track takes - is in
                the sentence now. */}
            <p className="text-[11px] text-white/45 leading-relaxed">
              {have ? t('lyModelHereNote') : t('lyModelWhy')}
            </p>
            <div className="flex items-center gap-2 mt-3">
              {have ? (
                <>
                  <button onClick={() => window.electronAPI?.alignOpenDir?.()}
                    className="icon-btn px-2.5 py-1.5 rounded-lg text-[11.5px] transition-all"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.65)' }}>
                    {t('lyModelFolder')}
                  </button>
                  <span className="flex-1" />
                  <button onClick={remove}
                    className="icon-btn px-2.5 py-1.5 rounded-lg text-[11.5px] transition-all"
                    style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
                    {t('lyModelDrop')}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1" />
                  <button onClick={download}
                    className="icon-btn px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-white transition-all"
                    style={{ background: 'var(--accent)' }}>
                    {t('lyModelGet')} {mb(total)}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function LyricsTimingSection({ bare }: { bare?: boolean } = {}) {
  const t = useT()
  const { timing, setTiming, aiModel, setAiModel, lyricsInfo, setLyricsInfo } = useSettings()
  const showToast = useToast(s => s.show)
  const [key, setKey] = useState('')
  const [stored, setStored] = useState(false)
  // Only the setter is used: the card reports installation upward, and
  // nothing in this section branches on it.
  const [, setAlignHave] = useState(true)
  const askConfirm = useUI(s => s.askConfirm)
  useEffect(() => {
    window.electronAPI?.alignReady?.().then(setAlignHave).catch(() => {})
    window.electronAPI?.aiHasKey?.().then(setStored).catch(() => {})
  }, [])

  const save = async () => {
    const v = key.trim()
    if (!v) return
    await window.electronAPI?.aiSetKey?.(v)
    setKey(''); setStored(true)
    showToast(t('aiKeySaved'), 'success')
  }

  /* Choosing the mode no longer starts a download. Picking an option used
     to pull 300MB on the spot, which is a lot to set off with one tap on
     a segmented control - and with no size named beforehand and no way to
     stop it. The choice now only reveals the card below, and the download
     has its own button with the figure written on it. */
  const pick = (v: 'off' | 'local' | 'cloud') => setTiming(v)

  const note = timing === 'local' ? t('tmLocalNote')
    : timing === 'cloud' ? t('tmCloudNote')
    : t('tmOffNote')

  return (
    <Wrap bare={bare} title={t('tmTitle')}>
      <SegmentedTabs
        value={timing}
        onChange={pick}
        options={[['off', t('tmOff')], ['local', t('tmLocal')], ['cloud', t('tmCloud')]]}
      />
      <p className="text-[11px] text-white/45 mt-2 leading-relaxed">{note}</p>

      {timing === 'local' && <AlignModelCard onInstalled={setAlignHave} />}

      {timing === 'cloud' && (
        <div className="mt-3 space-y-2 page-enter">
          {/* A stored key is invisible by design - it never comes back out
              of the keychain - so the only honest thing to show is that one
              is there, and the only useful control is a way to drop it. */}
          {stored && (
            <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.22)' }}>
              <span className="flex items-center gap-2 min-w-0">
                <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#4ade80' }} viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span className="text-[12px] text-white/75 truncate">{t('aiKeyStored')}</span>
              </span>
              <button
                onClick={async () => {
                  if (!await askConfirm(t('aiKeyDropAsk'), t('aiKeyDrop'), true)) return
                  const ok = await window.electronAPI?.aiClearKey?.()
                  if (ok) { setStored(false); showToast(t('aiKeyGone'), 'success') }
                }}
                className="icon-btn shrink-0 px-2.5 py-1 rounded-lg text-[11px] transition-all"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
                {t('aiKeyDrop')}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="password" value={key} placeholder={stored ? t('aiKeyReplace') : t('aiKeyPlaceholder')}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm text-white focus:outline-none transition-all"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <button onClick={save} disabled={!key.trim()}
              className="icon-btn px-3 py-2 rounded-lg text-[12px] font-semibold text-white transition-all disabled:opacity-40"
              style={{ background: 'var(--accent)' }}>
              {t('save')}
            </button>
          </div>
          {/* The arrow says this leaves the app, before the click does. */}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] transition-colors" style={{ color: 'var(--accent)' }}>
            {t('aiGetKey')}
            <svg className="w-3 h-3 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {AI_MODELS.map(m => (
              <button key={m.id} onClick={() => setAiModel(m.id)}
                className="icon-btn px-1 py-1.5 rounded-lg text-[10.5px] truncate transition-all"
                style={{
                  background: aiModel === m.id ? 'rgba(var(--accent-rgb),0.2)' : 'rgba(255,255,255,0.06)',
                  border: aiModel === m.id ? '1px solid rgba(var(--accent-rgb),0.45)' : '1px solid rgba(255,255,255,0.08)',
                  color: aiModel === m.id ? '#fff' : 'rgba(255,255,255,0.6)',
                }}>{m.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <SystemToggle label={t('lyInfo')} sub={t('lyInfoSub')}
          active={lyricsInfo} onClick={() => setLyricsInfo(!lyricsInfo)} />
      </div>
    </Wrap>
  )
}

/* Not shown at all, almost always.
   The app carries its own Genius credential, so where the words come from
   is not a decision anybody has to make - and a settings block that only
   explains itself is noise. It appears in exactly two cases: the shared
   token stopped being accepted (the player says so in a toast and points
   here, which has to lead somewhere real), or this person already put in a
   token of their own and may want to see or replace it. */
