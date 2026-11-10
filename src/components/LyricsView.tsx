import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { usePlayer, useSettings, useToast, useAiStage, useLyrics, useUI, AI_MODELS } from '../store'
import { forgetTrackLyrics } from '../services/lyrics'
import { cachedAi, lastNote, transcribeTrack, LOCAL_SLOT } from '../services/aiLyrics'
import { fetchGeniusByLink, fetchGeniusLyrics, forgetGenius, lastGeniusFail, lastGeniusRetryAt, lastGeniusShared } from '../services/genius'
import type { LyricsResult } from '../services/lyrics'

/* The local aligner is not one of the models you can pick, so it is not in
   that list - but it is what answered, and the badge has to say so. */
/** The step in progress, in the same words the scan panel uses. */
function stageText(stage: string, t: (k: 'aiStGenius' | 'aiStDownload' | 'aiStDecode' | 'aiStLocal' | 'aiStCloud' | 'aiWorking') => string): string {
  if (stage === 'genius') return t('aiStGenius')
  if (stage === 'download') return t('aiStDownload')
  if (stage === 'decode') return t('aiStDecode')
  if (stage === 'local') return t('aiStLocal')
  if (stage === 'cloud') return t('aiStCloud')
  return t('aiWorking')
}

const modelLabel = (id: string) => (id === LOCAL_SLOT ? 'local' : AI_MODELS.find(m => m.id === id)?.label ?? id)

const KNOWN_ERR = new Set(['NO_KEY', 'BAD_KEY', 'RATE_LIMIT', 'TOO_LONG', 'EMPTY', 'NO_STREAM', 'NO_AUDIO', 'OVERLOADED', 'NO_WORDS', 'ALIGN_FAILED', 'BAD_LINK', 'BLOCKED'])

/* One line per thing that can go wrong, in the person's language: a missing
   key and a spent quota are fixable, and saying "error" would hide which. */
type AiErrKey = 'aiNoKey' | 'aiRateLimit' | 'aiTooLong' | 'aiEmpty' | 'aiFailed' | 'aiNoAudio' | 'aiOffline' | 'aiBusy' | 'aiNoWords' | 'aiAlignFailed' | 'aiBadLink' | 'aiBlocked' | 'aiBlockedSoon' | 'minShort'
function aiErrText(code: string, t: (k: AiErrKey) => string, retryAt = 0): string {
  /* Genius refusing us is not a fact about the link, the song, or
     anything the person did - and it used to be reported as "that does
     not look like a Genius link" about a link that was perfectly good.
     The wait is named, because a refusal with no end to it reads as a
     feature that is simply broken. */
  if (code === 'BLOCKED') {
    const mins = Math.ceil((retryAt - Date.now()) / 60000)
    return mins > 0 ? `${t('aiBlocked')} ~${mins} ${t('minShort')}` : t('aiBlockedSoon')
  }
  if (code === 'BAD_LINK') return t('aiBadLink')
  if (code === 'NO_WORDS') return t('aiNoWords')
  if (code === 'ALIGN_FAILED') return t('aiAlignFailed')
  if (code === 'NO_KEY' || code === 'BAD_KEY') return t('aiNoKey')
  if (code === 'RATE_LIMIT') return t('aiRateLimit')
  if (code === 'TOO_LONG') return t('aiTooLong')
  if (code === 'EMPTY') return t('aiEmpty')
  if (code === 'NO_STREAM' || code === 'NO_AUDIO') return t('aiNoAudio')
  if (code === 'OVERLOADED') return t('aiBusy')
  if (code.startsWith('NETWORK')) return t('aiOffline')
  return t('aiFailed')
}

/* What geniusByUrl accepts, and nothing else: an https genius.com song
   page. Mirrored here so a typo is refused by a greyed-out button
   rather than by a round trip that comes back "not found". */
const GENIUS_URL = /^https:\/\/(?:www\.)?genius\.com\/[\w%-]+-lyrics(?:[?#].*)?$/i

export function LyricsView({ lyrics, loading, progress, onSeek, mask = true, fontScale = 1 }: {
  lyrics: LyricsResult | null
  loading: boolean
  progress: number
  onSeek: (t: number) => void
  mask?: boolean
  fontScale?: number
}) {
  const t = useT()
  const showToast = useToast(s => s.show)
  const stage = useAiStage(s => s.stage)
  const showInfo = useSettings(s => s.lyricsInfo)
  const [dropSure, setDropSure] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLParagraphElement>(null)
  /* A transcript stands in for a catalogue hit when there is none. It is kept
     here rather than handed back up because every view that shows lyrics
     already knows how to draw a LyricsResult - this way none of them need to
     learn anything about where this one came from. */
  const track = usePlayer(s => s.currentTrack)
  const aiOn = useSettings(s => s.timing !== 'off')
  const aiModel = useSettings(s => s.aiModel)
  const [ai, setAi] = useState<LyricsResult | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState<string | null>(null)
  // What the model said when it returned no lyrics - a refusal reads very
  // differently from an instrumental, and only it knows which this was.
  const [aiNote, setAiNote] = useState('')
  // When Genius will take us back, for the one message that can say so.
  const [aiRetryAt, setAiRetryAt] = useState(0)
  // A spinner alone cannot tell "working" from "hung", and this wait is
  // long enough that the difference matters.
  const [aiSecs, setAiSecs] = useState(0)
  /* Paste-the-words. Genius refuses programmatic requests - it answers 403
     - and forging browser headers to get round that is not something to
     build into a player. But the words are two clicks away in a browser the
     person already has, and once they are here the model does the part it is
     actually good at: saying when each line is sung, never what it says. */
  const [paste, setPaste] = useState<string | null>(null)
  /* The same correction in one line, offered where the words already
     are: LRCLIB can hand back the right song or a different one with
     the same name, and when it is the wrong song no amount of timing
     will fix it. Only the page is asked for - the words come from it. */
  const [link, setLink] = useState<string | null>(null)
  useEffect(() => {
    if (!aiBusy) { setAiSecs(0); return }
    const t0 = Date.now()
    const id = setInterval(() => setAiSecs(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [aiBusy])

  // A transcript made earlier is on disk, so a track is only ever paid for
  // once - look for it before offering to do the work again.
  useEffect(() => {
    setAi(null); setAiErr(null); setAiBusy(false); setLink(null)
    // Note: not gated on the timing setting. Turning it off stops new work;
    // it should not hide a result already paid for and sitting on disk.
    if (!track) return
    let dead = false
    /* Only the slot that holds real words. The other one holds transcripts
       the model wrote itself, from back when it was allowed to - they stay
       on disk but are never shown again. */
    cachedAi(track.id, true)
      .then(r => { if (!dead && r) setAi(r) }).catch(() => {})
    return () => { dead = true }
  }, [track?.id, aiOn, aiModel])

  /* No automatic lookup here on purpose.
   *
   * There was one: a track with nothing from LRCLIB fetched its Genius
   * page by itself a couple of seconds in. It cost a page read for every
   * track that came up, including the ones skipped past and the ones
   * playing to an empty room - and with autoplay running the queue
   * forever, that is most of them. Those reads are what walked into
   * Cloudflare's bot challenge, which is per-IP and shuts the website off
   * for an hour at a time.
   *
   * Genius is asked from two places now, both of them somebody's
   * decision: the button below, and the scan in settings. */

  /* Two jobs behind one button, and the better one is tried first: if the
     words exist anywhere - LRCLIB had them without timings, or Genius has
     the song - the model is asked to TIME them rather than to hear them.
     It mishears; it does not misplace. The words a person wrote beat the
     words a machine guessed, every time. */
  /* Both handlers below run for the better part of a minute - measured at
     40s locally and 68s through the cloud, longer than the tail of most
     songs - and this view is never keyed per track: one instance lives for
     the whole session, so autoplay can move on underneath them. Writing the
     result back without checking painted the previous song's words over the
     new one, and clicking a line then seeked this track to that track's
     timestamps. The effect that clears the pane on a track change already
     guards itself this way; these two did not. */
  const stillOn = (id: number | string | undefined) =>
    usePlayer.getState().currentTrack?.id === id

  const runAi = async (force = false) => {
    if (!track || aiBusy) return
    const forTrack = track.id
    setAiBusy(true); setAiErr(null)
    useAiStage.getState().set('genius')
    let got = 0
    try {
      const known = lyrics?.plain
        ? lyrics.plain.split('\n').map(l => l.trim()).filter(Boolean)
        : await fetchGeniusLyrics(track.id, track.title ?? '', track.user?.username ?? '')
      /* A token Genius no longer accepts is the one failure the person can
         actually do something about, and from the outside it looks exactly
         like the model being bad at its job - the words come out guessed and
         nothing says why. So it is said out loud, every time, rather than
         left as a quiet downgrade. */
      if (lastGeniusFail === 'BAD_TOKEN') showToast(t(lastGeniusShared ? 'gnDead' : 'gnDeadMine'), 'error')
      /* No catalogue has it and Genius does not have it either. The player
         could ask the model to invent something that scans like a song; it
         will not. */
      /* "Genius does not have this song" and "Genius would not talk to
         us" look the same from here, and saying the first about the
         second sends the person looking for a page that exists. */
      if (!known?.length) {
        setAiErr(lastGeniusFail === 'BLOCKED' ? 'BLOCKED' : 'NO_WORDS')
        setAiRetryAt(lastGeniusRetryAt)
        return
      }
      const r = await transcribeTrack(track, force, known)
      got = r?.synced?.length ?? (r?.plain ? r.plain.split('\n').length : 0)
      if (!stillOn(forTrack)) return
      setAi(r)
      setAiNote(lastNote)
      if (!r) setAiErr('EMPTY')
    } catch (e) {
      if (!stillOn(forTrack)) return
      setAiErr((e as { code?: string })?.code || 'ERROR')
    } finally {
      useAiStage.getState().set('')
      setAiBusy(false)
    }
  }

  const submitPaste = async (text: string) => {
    const forTrack = track?.id
    if (!track) return
    const raw = text.trim()
    /* A single line that is a link is an answer to a different question:
       not "here are the words" but "here is the page". Worth accepting,
       because picking the page by hand solves the one thing our matching
       keeps getting wrong - which song this actually is. */
    const asLink = /^https?:\/\/\S+$/.test(raw) ? raw : null
    let lines = raw.split('\n').map(l => l.trim())
      // Section headers are structure, not words - the same ones Genius uses.
      .filter(l => l && !/^\s*[[(](?:[^\])]{0,40})[\])]\s*$/.test(l))
    if (!asLink && lines.length < 2) return
    setPaste(null); setLink(null); setAiBusy(true); setAiErr(null)
    try {
      if (asLink) {
        const got = await fetchGeniusByLink(track.id, asLink)
        if (!got?.length) {
          /* Three different answers used to collapse into "bad link":
             the page had no words, Genius refused us, and the link was
             actually wrong. Only the third is about the link. */
          setAiErr(lastGeniusFail === 'NO_LYRICS' ? 'EMPTY' : lastGeniusFail === 'BLOCKED' ? 'BLOCKED' : 'BAD_LINK')
          setAiRetryAt(lastGeniusRetryAt)
          return
        }
        lines = got
      }
      const r = await transcribeTrack(track, true, lines)
      if (!stillOn(forTrack)) return
      setAi(r); setAiNote(lastNote)
      if (!r) setAiErr('EMPTY')
    } catch (e) {
      if (!stillOn(forTrack)) return
      setAiErr((e as { code?: string })?.code || 'ERROR')
    } finally { setAiBusy(false) }
  }

  /* The catalogue result used to win unconditionally, which quietly threw
     away the thing the button had just produced: you press "time these
     words", the aligner runs, returns timed lines - and the untimed
     catalogue copy keeps the screen. Timings win now; everything else
     keeps the old order. */
  const shown = ai?.synced && !lyrics?.synced ? ai : (lyrics ?? ai)
  const synced = shown?.synced ?? null
  const activeIdx = synced
    ? synced.reduce((acc, l, i) => (l.time <= progress + 0.25 ? i : acc), -1)
    : -1

  /* Back to the top when the track changes. Nothing is highlighted yet at
     zero seconds, so the auto-scroll below has no line to move to and the
     container keeps the offset it had - which, for a track that just
     finished, is the bottom. The next song then opened on its last verse. */
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0
  }, [track?.id])

  // Auto-scroll active line to center
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIdx])

  const box = 'w-full overflow-y-auto text-center px-2 lyrics-scroll'
  const boxStyle = {
    height: 360, maxHeight: '52vh',
    ...(mask ? { maskImage: 'linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent)' } : {}),
  } as React.CSSProperties

  if (loading) return <div className="flex items-center justify-center" style={{ height: 360 }}><div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin" /></div>

  if (!shown) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ height: 360 }}>
        <span className="text-white/40 text-sm">{t('lyricsNotFound')}</span>
        {/* With the timing off this screen had nothing on it but those two
            words, and no hint that the player can do more than look the
            song up in a catalogue. The setting that would is three clicks
            away through a panel and a tab, so the way there is here. */}
        {!aiOn && paste === null && (
          <button onClick={() => useUI.getState().openSettings('lyrics')}
            className="icon-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-white/45 hover:text-white/85 transition-all"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {t('lyTurnOn')}
          </button>
        )}
        {/* Offered, not done on its own: a transcript spends the person's own
            quota and sends the track to a third party, and neither should
            happen because a song happened to come on. */}
        {/* The box itself, opened by that button. Deliberately plain: it is a
            place to drop text, and anything more would be a form. */}
        {paste !== null && (
          <div className="w-full max-w-[420px] flex flex-col gap-2 page-enter">
            <textarea
              autoFocus value={paste} onChange={e => setPaste(e.target.value)}
              placeholder={t('aiPastePlaceholder')} rows={7}
              className="w-full rounded-lg px-3 py-2 text-[12px] text-white/85 text-left focus:outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <div className="flex items-center gap-2 justify-center">
              <button onClick={() => setPaste(null)}
                className="icon-btn px-2.5 py-1 rounded-lg text-[11px] text-white/55 hover:text-white/85 transition-all"
                style={{ background: 'rgba(255,255,255,0.06)' }}>{t('cancel')}</button>
              <button onClick={() => submitPaste(paste ?? '')} disabled={(paste ?? '').trim().length < 10}
                className="icon-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white transition-all disabled:opacity-40"
                style={{ background: 'var(--accent)' }}>{t('aiSync')}</button>
            </div>
          </div>
        )}

        {aiOn && track && paste === null && (
          aiBusy ? (
            <span className="flex items-center gap-2 text-[12px] text-white/50">
              <span className="w-3.5 h-3.5 border-2 border-white/25 border-t-white/80 rounded-full animate-spin" />
              {stageText(stage, t)}{aiSecs ? ` ${aiSecs}\u2009${t('secShort')}` : ''}
            </span>
          ) : (
            <>
              {/* "No words heard" is cached like any other answer, so pressing
                  again would just replay it. Once that has happened the same
                  button asks for a fresh attempt instead. */}
              <button onClick={() => runAi(aiErr === 'EMPTY')}
                className="icon-btn px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all active:scale-95"
                style={{ background: 'rgba(var(--accent-rgb),0.16)', border: '1px solid rgba(var(--accent-rgb),0.4)', color: '#fff' }}>
                {aiErr === 'EMPTY' ? t('aiRedo') : lyrics?.plain ? t('aiSync') : t('aiFind')}
              </button>
              <button onClick={() => setPaste('')}
                className="icon-btn text-[11px] px-2 py-1 rounded text-white/45 hover:text-white/85 transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
                {t('aiPaste')}
              </button>
              {aiErr && (
                <span className="text-[11px] text-white/35 max-w-[280px] leading-snug break-words">
                  {aiErrText(aiErr, t, aiRetryAt)}
                  {/* The server's own words when the failure is not one of the
                      four we can name. Without them "it failed" is the end of
                      the trail for anyone trying to fix it. */}
                  {!KNOWN_ERR.has(aiErr) && <><br /><span className="text-white/25">{aiErr}</span></>}
                  {aiErr === 'EMPTY' && aiNote && <><br /><span className="text-white/25">«{aiNote}»</span></>}
                </span>
              )}
            </>
          )
        )}
      </div>
    )
  }

  /* Said once, at the top, and kept quiet: these lines were heard by a
     machine over a beat, and some of them are wrong. Presenting that as the
     official text is worse than showing nothing. */
  /* Which model said this, and a way to disagree with it. Without the name
     two transcripts of the same track are indistinguishable, and without the
     redo the cache - built to stop you paying twice - also stops you ever
     hearing a second opinion. */
  /* Catalogue lyrics get a shorter version of the same line: where they
     came from, and the offer to time them - which is what "redo" does to
     a plain text, since the words are already the human ones. No delete:
     the catalogue would hand the same text straight back, so a button
     promising to remove it would be lying. */
  const plainMark = !shown.ai && showInfo && shown.plain ? (
    <div className="flex items-center justify-center gap-2 pb-1 flex-wrap">
      {link !== null ? (
        /* The field takes the row over rather than opening below it: the
           lyrics start immediately underneath, and a box pushed in between
           them moves the whole song down the screen mid-read. */
        <>
          <input
            autoFocus value={link}
            onChange={e => setLink(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && GENIUS_URL.test(link.trim())) submitPaste(link)
              if (e.key === 'Escape') setLink(null)
            }}
            placeholder={t('aiLinkPlaceholder')}
            spellCheck={false}
            className="w-[230px] rounded px-2 py-0.5 text-[10px] text-white/85 text-left focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
          />
          <button onClick={() => setLink(null)}
            className="icon-btn text-[10px] px-1.5 py-0.5 rounded text-white/40 hover:text-white/80 transition-colors">
            {t('cancel')}
          </button>
          <button onClick={() => submitPaste(link)} disabled={!GENIUS_URL.test(link.trim())}
            className="icon-btn text-[10px] px-1.5 py-0.5 rounded font-semibold text-white transition-colors disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>
            {t('aiSync')}
          </button>
        </>
      ) : (
        <>
          <span className="text-[10px] uppercase tracking-wider text-white/25">{t('lyFromCatalog')}</span>
          {aiOn && !shown.synced && (
            <button onClick={() => runAi(true)} disabled={aiBusy}
              className="icon-btn text-[10px] px-1.5 py-0.5 rounded text-white/40 hover:text-white/80 transition-colors disabled:opacity-40"
              style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              {aiBusy ? stageText(stage, t) : t('aiSync')}
            </button>
          )}
          {aiOn && !shown.synced && !aiBusy && (
            <button onClick={() => setLink('')}
              className="icon-btn text-[10px] px-1.5 py-0.5 rounded text-white/40 hover:text-white/80 transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              {t('aiLink')}
            </button>
          )}
          {/* Said here because this row is the only thing on screen that
              belongs to the attempt. The failure line lived in the
              empty-lyrics branch, so a refused link or a timing that did
              not work ended with the row simply closing again. */}
          {aiErr && !aiBusy && (
            <span className="w-full text-[10px] text-white/35 leading-snug break-words">
              {aiErrText(aiErr, t, aiRetryAt)}
            </span>
          )}
        </>
      )}
    </div>
  ) : null

  const mark = shown.ai && showInfo ? (
    <div className="flex items-center justify-center gap-2 pb-1 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-white/25">
        {shown.aiModel === LOCAL_SLOT ? t('aiTimedLocal') : shown.aiAligned ? t('aiTimed') : t('aiMade')}{shown.aiModel && shown.aiModel !== LOCAL_SLOT ? ` · ${modelLabel(shown.aiModel)}` : ''}
      </span>
      {/* Said once, where it is useful: these words were guessed, and the
          real ones were a token away. */}
      {!shown.aiAligned && lastGeniusFail === 'NO_TOKEN' && (
        <span className="text-[10px] text-white/30">{t('gnHint')}</span>
      )}
      <button onClick={() => runAi(true)} disabled={aiBusy}
        className="icon-btn text-[10px] px-1.5 py-0.5 rounded text-white/40 hover:text-white/80 transition-colors disabled:opacity-40"
        style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
        {aiBusy ? t('aiWorking') : t('aiRedo')}
      </button>
      {/* "Redo" asks again with everything we already believe; this throws
          those beliefs away first. The difference matters when what is
          wrong is the page we matched, not the timing. */}
      <button
        onMouseLeave={() => setDropSure(false)}
        onClick={async () => {
          if (!track) return
          if (!dropSure) { setDropSure(true); return }
          setDropSure(false)
          await window.electronAPI?.lyricsForgetTrack?.(track.id)
          forgetTrackLyrics(track.id)
          forgetGenius(track.id)
          useLyrics.getState().mark(track.id, false)
          setAi(null); setAiErr(null); setAiNote('')
          showToast(t('aiDropped'), 'success')
        }}
        disabled={aiBusy}
        className="icon-btn text-[10px] px-1.5 py-0.5 rounded transition-colors disabled:opacity-40"
        style={{ border: '1px solid rgba(239,68,68,0.22)', color: dropSure ? '#f87171' : 'rgba(248,113,113,0.6)' }}>
        {dropSure ? t('aiDropSure') : t('aiDrop')}
      </button>
    </div>
  ) : null

  if (synced) {
    return (
      <div ref={containerRef} className={box} style={boxStyle}>
        <div className="py-[40%] space-y-3">
          {mark}{plainMark}
          {synced.map((line, i) => {
            const active = i === activeIdx
            return (
              <p
                key={i}
                ref={active ? activeRef : undefined}
                onClick={() => onSeek(line.time)}
                className="font-semibold leading-snug cursor-pointer transition-all duration-300"
                style={{
                  fontSize: `${1.25 * fontScale}rem`,
                  color: active ? '#fff' : 'rgba(255,255,255,0.35)',
                  transform: active ? 'scale(1.04)' : 'scale(1)',
                  filter: active ? 'none' : 'blur(0.3px)',
                }}
              >
                {line.text || '♪'}
              </p>
            )
          })}
        </div>
      </div>
    )
  }

  // Plain lyrics
  return (
    <div className={box} style={boxStyle}>
      <div className="py-8" style={{ fontSize: `${fontScale}rem` }}>
        {mark}{plainMark}
        <div className="whitespace-pre-line text-white/70 leading-relaxed">{shown.plain}</div>
      </div>
    </div>
  )
}
