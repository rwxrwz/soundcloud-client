import { useEffect, useRef, useState } from 'react'
import { useEscape } from '../hooks/useEscape'
import { useT } from '../i18n'
import { useLyrics, useScan, useSettings, useUI, type ScanMode } from '../store'
import { estimateSec, formatEta, priorSec, runScan, toScan } from '../services/scan'
import type { SCTrack } from '../services/soundcloud'

/* The panel behind the L button.
 *
 * It exists because the thing it starts can take anywhere from ten seconds
 * to several hours depending on which way you pick, and the old button
 * gave no hint of that - it just started. So nothing here starts until the
 * numbers are on screen: how many tracks, how many of them have already
 * been looked at, and roughly how long this will take. The estimate is
 * marked as a guess because it is one.
 *
 * Three steps, one at a time, never a wall: pick the engine, read the
 * summary, watch the progress. */

type Step = 'mode' | 'ready' | 'running'

export function LyricsScan({ tracks, onClose }: { tracks: SCTrack[]; onClose: () => void }) {
  const t = useT()
  const scan = useScan()
  const counts = useLyrics(s => s.counts)
  const forget = useLyrics(s => s.forget)
  const timing = useSettings(s => s.timing)

  const [step, setStep] = useState<Step>(scan.running ? 'running' : 'mode')
  const [mode, setMode] = useState<ScanMode>('catalog')
  const [onlyFresh, setOnlyFresh] = useState(true)
  const askConfirm = useUI(s => s.askConfirm)
  const [aiOpen, setAiOpen] = useState(false)

  const ids = tracks.map(x => x.id)
  const known = counts(ids)
  const todo = toScan(tracks, onlyFresh).length

  // A run started elsewhere, or still going when the panel is reopened.
  useEffect(() => { if (scan.running) setStep('running') }, [scan.running])

  const begin = async () => {
    const list = toScan(tracks, onlyFresh)
    if (!list.length) return
    if (!onlyFresh) forget(ids)
    setStep('running')
    await runScan(list, mode)
  }

  if (step === 'running' || scan.running) {
    return <Progress onClose={onClose} />
  }

  if (step === 'ready') {
    return (
      <Panel onClose={onClose} title={t('scTitle')}>
        <div className="space-y-1.5 text-[12px]">
          <Row label={t('scInList')} value={String(tracks.length)} />
          <Row label={t('scAlready')} value={`${known.scanned} · ${t('scFound')} ${known.found}`} />
          <Row label={t('scWillDo')} value={String(todo)} accent />
          <Row label={t('scEta')} value={formatEta(estimateSec(todo, mode), t)} />
        </div>

        {known.scanned > 0 && (
          <div className="mt-3 flex items-center gap-1.5">
            <Chip active={onlyFresh} onClick={() => setOnlyFresh(true)}>{t('scFresh')}</Chip>
            <Chip active={!onlyFresh} danger onClick={() => setOnlyFresh(false)}>{t('scAll')}</Chip>
          </div>
        )}
        {!onlyFresh && (
          <p className="text-[10.5px] text-amber-300/60 mt-2 leading-snug">{t('scAllWarn')}</p>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => setStep('mode')}
            className="icon-btn px-2.5 py-1.5 rounded-lg text-[11.5px] text-white/55 hover:text-white/85 transition-all"
            style={{ background: 'rgba(255,255,255,0.06)' }}>{t('back')}</button>
          <button
            disabled={!todo}
            onClick={async () => {
              /* Throwing away a finished scan is worth asking about, and
                 asking happens in a dialog: arming the button you are
                 already pointing at puts the second, costly click exactly
                 where the first one landed. */
              if (!onlyFresh && !await askConfirm(t('scAllAsk'), t('scStart'), true)) return
              begin()
            }}
            className="icon-btn flex-1 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-white transition-all disabled:opacity-40"
            style={{ background: onlyFresh ? 'var(--accent)' : 'rgba(239,68,68,0.75)' }}>
            {!todo ? t('scNothing') : t('scStart')}
          </button>
        </div>
      </Panel>
    )
  }

  return (
    <Panel onClose={onClose} title={t('scTitle')}>
      <div className="space-y-1.5">
      <Choice
        title={t('scCatalog')}
        note={t('scCatalogNote')}
        onClick={() => { setMode('catalog'); setStep('ready') }}
      />
      <Choice
        title={t('scAi')}
        note={t('scAiNote')}
        open={aiOpen}
        onClick={() => setAiOpen(o => !o)}
      />
      {aiOpen && (
        <div className="pl-2.5 space-y-1.5 page-enter"
          style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
          <Choice
            small
            title={t('tmLocal')}
            note={t('scLocalNote')}
            onClick={() => { setMode('local'); setStep('ready') }}
          />
          <Choice
            small
            title={t('tmCloud')}
            note={t('scCloudNote')}
            onClick={() => { setMode('cloud'); setStep('ready') }}
          />
        </div>
      )}
      {timing === 'off' && (
        <p className="text-[10.5px] text-white/35 leading-snug">{t('scTimingOff')}</p>
      )}
      </div>
    </Panel>
  )
}

/* m:ss, and h:mm:ss once it has been going that long. A clock rather
   than a rounded phrase, because unlike the estimate beside it this
   number is a fact and can afford to be exact. */
function clock(sec: number): string {
  const ss = Math.floor(sec % 60)
  const mm = Math.floor(sec / 60) % 60
  const hh = Math.floor(sec / 3600)
  return `${hh ? `${hh}:` : ''}${hh ? String(mm).padStart(2, '0') : mm}:${String(ss).padStart(2, '0')}`
}

function Progress({ onClose }: { onClose: () => void }) {
  const t = useT()
  const s = useScan()
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0
  /* The store only changes when a track finishes, which on the slow modes
     is a minute apart - so the clock needs its own beat or it would sit
     still and read as a hung scan. It stops with the run: the last tick
     stays on screen as the total. */
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!s.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [s.running])
  const elapsed = Math.max(0, (now - s.startedAt) / 1000)
  /* Time left from what the recent tracks cost, not from the average over
     the whole run - see the store's tick for why the average lies.
     
     Blending this with the per-mode figure was tried and reverted: it
     fixed a run that starts fast and turns slow, and broke the opposite
     one, promising eighty minutes for a rescan that had nothing to do and
     finished in two. From the first thirty tracks the two runs look
     identical, so no amount of weighting tells them apart - only knowing
     which of the remaining tracks still need work would, and nothing
     here knows that yet. */
  const per = s.pace || priorSec(s.mode)
  /* The track in progress counts too: without it the estimate stands
     still through a forty-second track and then jumps. */
  const current = Math.max(0, (now - (s.lastAt || s.startedAt)) / 1000)
  const left = per ? formatEta(Math.max(0, per * (s.total - s.done) - Math.min(current, per)), t) : ''
  const stage = s.stage === 'genius' ? t('scStGenius')
    : s.stage === 'align' ? t('scStAlign')
    : s.stage === 'model' ? t('scStModel') : ''

  return (
    <Panel onClose={onClose} title={t('scTitle')}>
      <p className="text-[12px] text-white/80 truncate">{s.track || '…'}</p>
      <div className="flex items-baseline justify-between gap-3 mt-0.5">
        <span className="text-[10.5px] text-white/40 truncate">{stage}</span>
        <span className="text-[10.5px] text-white/40 tabular-nums shrink-0">{clock(elapsed)}</span>
      </div>

      <div className="h-1.5 rounded-full overflow-hidden mt-2.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: 'var(--accent)' }} />
      </div>

      <div className="flex items-center justify-between mt-2 text-[11px]">
        <span className="text-white/55">{s.done} / {s.total}</span>
        <span className="text-white/40">{left}</span>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[11px]">
        <span style={{ color: 'var(--accent)' }}>{t('scFound')} {s.found}</span>
        <span className="text-white/35">{t('scMissing')} {s.missing}</span>
      </div>

      {s.failed && (
        <p className="text-[11px] text-[#f87171] mt-2 leading-snug">
          {s.failed === 'NO_KEY' || s.failed === 'BAD_KEY' ? t('aiNoKey')
            : s.failed === 'NO_BRIDGE' ? t('aiFailed')
            : s.failed === 'BLOCKED' ? t('scBlocked')
            : s.failed === 'NO_TOKEN' ? t('gnHint')
            : t('scNoModel')}
        </p>
      )}

      <button
        onClick={() => useScan.getState().cancel()}
        disabled={s.cancelled || !s.running}
        className="icon-btn w-full mt-3 px-3 py-1.5 rounded-lg text-[11.5px] transition-all disabled:opacity-40"
        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
        {s.cancelled ? t('scStopping') : s.running ? t('scStop') : t('scDone')}
      </button>
      {!s.running && (
        <p className="text-[10.5px] text-white/35 mt-1.5 leading-snug">{t('scKept')}</p>
      )}
    </Panel>
  )
}

/* ── small pieces ───────────────────────────────────────────────────────── */

function Panel({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  /* Escape through the shared stack, which knows this panel is the topmost
     thing and that a field below it owns the key. Its own listener was on
     `document`, so it fired before the stack and closed the page behind it
     on the same press. */
  useEscape(onClose)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => {
      /* A confirmation dialog is portaled to the body, so every click in it
         is "outside" this panel. It is modal - nothing behind it should act
         on a click - and closing the panel under a dialog it opened would
         take the progress view down with it. */
      if (useUI.getState().confirmAsk) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Deferred: the click that opened this panel is still travelling.
    const id = setTimeout(() => document.addEventListener('mousedown', away), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', away) }
  }, [onClose])

  return (
    <div ref={ref}
      className="absolute right-0 top-10 z-50 rounded-xl p-3.5 glass-deep page-enter"
      style={{ width: 310, boxShadow: 'var(--sh-2)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-2.5">{title}</p>
      {children}
    </div>
  )
}

function Choice({ title, note, onClick, small, open }: {
  title: string; note: string; onClick: () => void; small?: boolean; open?: boolean
}) {
  return (
    <button onClick={onClick}
      className="icon-btn row-hover w-full text-left rounded-lg px-3 py-2.5 transition-all"
      style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <span className={`flex items-center gap-1.5 text-white/85 ${small ? 'text-[12px]' : 'text-[13px] font-medium'}`}>
        {title}
        {open !== undefined && (
          <svg className="w-3 h-3 text-white/30 transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        )}
      </span>
      <span className="block text-[10.5px] text-white/40 leading-snug mt-1">{note}</span>
    </button>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-white/45">{label}</span>
      <span style={{ color: accent ? 'var(--accent)' : 'rgba(255,255,255,0.85)' }}>{value}</span>
    </div>
  )
}

function Chip({ active, danger, onClick, children }: {
  active: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode
}) {
  const tint = danger ? '239,68,68' : 'var(--accent-rgb)'
  return (
    <button onClick={onClick}
      className="icon-btn px-2.5 py-1 rounded-lg text-[11px] transition-all"
      style={{
        background: active ? `rgba(${tint},0.18)` : 'rgba(255,255,255,0.05)',
        border: `1px solid ${active ? `rgba(${tint},0.4)` : 'rgba(255,255,255,0.08)'}`,
        color: active ? '#fff' : 'rgba(255,255,255,0.55)',
      }}>
      {children}
    </button>
  )
}
