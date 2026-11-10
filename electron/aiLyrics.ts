import { app } from 'electron'
import { anchorShare, mapOnto } from './align'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/* Lyrics from the audio itself, for everything the catalogues have never
 * heard of - which on SoundCloud is most of it.
 *
 * This is NOT "ask a model to remember the words". A model asked to recall an
 * underground track will write a fluent, confident, completely invented song,
 * and nothing in the result tells you that happened. The audio goes to the
 * model instead, and what comes back is a transcript of what is actually
 * sung. It will be wrong in places - a beat over a voice is hard - but wrong
 * in the way a mishearing is wrong, which the person can see.
 *
 * The key lives here, in the main process, in the same OS keychain the
 * account token uses. The renderer can ask whether a key is set and can ask
 * for a transcript; it never receives the key itself.
 *
 * Audio goes inline, base64 in the request body, which the API caps at 20 MB
 * for the whole request. Long DJ sets are refused rather than silently
 * truncated into a transcript that stops halfway. */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const DEFAULT_MODEL = 'gemini-3.8-flash'
/* When the chosen model is busy, one lighter one is tried before giving up.
   The flagship is where everyone else is too, and a transcript does not need
   the flagship - so a queue on it should not be the end of the attempt. If
   the stand-in fails for its own reasons the ORIGINAL overload is reported:
   telling someone their model is "not found" when what happened is that a
   different model they never chose was missing would send them hunting for
   the wrong thing. */
const FALLBACK_MODEL = 'gemini-3.5-flash-lite'
/* Raw bytes, before base64 inflates them by a third. Leaves room for the
   prompt and the envelope inside the API's 20 MB request limit. */
const MAX_AUDIO = 14 * 1024 * 1024
/* "Please try again later" is an instruction, not an error message: a busy
   model answers 503 and means it. Waiting a couple of seconds and asking
   again costs nothing and turns most of these into a transcript, so the
   person never sees them. Three tries, backing off, and then it is reported
   as what it is rather than as a failure they could fix. */
/* Asking is not the same as requiring. A prompt that says "answer in JSON"
   is advice, and a model is free to answer in a paragraph instead - which is
   exactly what a speech-to-text model does, and it costs the timings. This
   makes the shape part of the request: the server constrains the output to
   the schema, and what comes back parses or does not exist. Models that do
   not support it say so, and then the plain request goes out instead. */
const LYRICS_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          t: { type: 'string', description: 'start time of the line, M:SS' },
          text: { type: 'string' },
        },
        required: ['t', 'text'],
      },
    },
  },
  required: ['lines'],
}

/* These models think before they answer, and by default they think a lot:
   3.8-flash is set to "medium" out of the box, which on three minutes of
   audio meant three minutes of waiting. Transcribing is not a reasoning
   problem - the words are either audible or they are not - so each model is
   asked for the least thinking it will accept. Measured before this: ~3 min
   for one track. Models that take no such setting say so, and then the
   request goes out without it. */
const THINKING: Record<string, string> = {
  'gemini-3.8-flash': 'low',        // does not accept 'minimal'
  'gemini-3.6-flash': 'minimal',
  'gemini-3.5-flash-lite': 'minimal',
}
const DEFAULT_THINKING = 'low'

const RETRY_ON = new Set([500, 502, 503, 504])
const RETRIES = 2
/** One model call: an upload and a transcription, not a conversation. */
const ASK_TIMEOUT_MS = 5 * 60_000

const BACKOFF_MS = [2000, 5000]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const dir = () => {
  const d = join(app.getPath('userData'), 'ai-lyrics')
  try { mkdirSync(d, { recursive: true }) } catch { /* ignore */ }
  return d
}
/* Per track AND per model. One slot per track looked tidy until the first
   time a transcript came out wrong: the only way to hear a second opinion
   was to delete a file by hand, because the cache was busy saving you from
   paying twice. Keyed this way, switching the model simply transcribes
   again, and switching back brings the first answer straight up for
   comparison. */
const cacheFile = (trackId: number, model: string) =>
  join(dir(), `${trackId}-${model.replace(/[^a-z0-9.-]/gi, '_')}.json`)

export interface AiLine { time: number; text: string }
export interface AiLyrics {
  lines: AiLine[]; plain: string; at: number
  /* What the model actually said, kept when its words were replaced by the
     real ones. Without it a bad result cannot be told apart from a bad fit
     of a good result - which cost an afternoon once already. */
  heard?: AiLine[]
  /** Share of the lyrics that was recognised in the audio, 0..1. */
  fit?: number
  /** The model that answered - not always the one asked for; see FALLBACK_MODEL. */
  model: string
  /* What the model actually said when none of it parsed as lyrics. Kept
     because "no words heard" is a conclusion, and it was being drawn from
     an empty parse - which also happens when the model answered a sentence
     instead: a refusal, a complaint about the audio, a question. Those are
     not silence, and telling someone their track is instrumental when the
     model declined to transcribe it is a lie with a confident face. */
  note?: string
  /* The digest of the lyrics this alignment was built from. An alignment is
     of those words and no others, so a cached one is only usable while the
     words still match. The filename cannot carry it - the readers that just
     ask "is there anything for this track" do not know the words - so it
     travels inside the record and is checked on the one path that does. */
  words?: string
}

export function readCached(trackId: number, model: string): AiLyrics | null {
  try {
    const f = cacheFile(trackId, model)
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as AiLyrics : null
  } catch { return null }
}
export function writeCached(trackId: number, model: string, v: AiLyrics) {
  try { writeFileSync(cacheFile(trackId, model), JSON.stringify(v)) } catch { /* ignore */ }
}

/* The instruction is mostly a list of ways to not be helpful. Every one of
   them is a failure mode seen in transcription prompts: filling a muffled bar
   from memory of a similar song, translating as it goes, tidying slang into
   dictionary words, or answering with a friendly sentence about the song
   instead of the song. */
function prompt(title: string, artist: string, durationSec: number): string {
  return [
    'Transcribe every word spoken, sung or rapped in this audio.',
    `The upload is credited as "${artist} - ${title}" and runs ${Math.round(durationSec)} seconds; treat that only as a hint for spelling of names.`,
    '',
    'Rules:',
    '- Write ONLY what you can hear. Never fill a gap from memory of this or any other song.',
    '- If a passage is unclear, write [?] in place of the words you cannot make out.',
    '- Keep the original language. Do not translate. Do not correct slang, profanity or grammar.',
    '- Include spoken passages: an intro, a skit, dialogue over the beat. They are part of the words.',
    '- Ignore pure instrumental stretches; do not invent filler for them.',
    '- No commentary, no title, no section labels like [Chorus].',
    '',
    'Answer with JSON only, no code fences, in this exact shape:',
    '{"lines":[{"t":"M:SS","text":"..."}]}',
    'where t is the time that line starts.',
    'If there are no intelligible words at all, answer {"lines":[]}.',
  ].join('\n')
}

/** `M:SS` / `MM:SS` / `H:MM:SS` → seconds, or null when it is not a time. */
function parseStamp(s: unknown): number | null {
  if (typeof s === 'number' && isFinite(s)) return s
  if (typeof s !== 'string') return null
  const parts = s.trim().split(':').map(p => parseFloat(p))
  if (!parts.length || parts.some(n => !isFinite(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/* The response is an Interaction: a list of steps, of which one is the model's
   output. Read it by TYPE rather than by index - the first step is often the
   model thinking, and that is not the answer. The fallback exists because this
   endpoint is young: if the shape moves, the deepest text still beats failing. */
function outputText(body: unknown): string {
  const steps = (body as { steps?: unknown[] })?.steps
  if (Array.isArray(steps)) {
    for (const st of steps) {
      const s = st as { type?: string; content?: unknown[] }
      if (s?.type !== 'model_output' || !Array.isArray(s.content)) continue
      const txt = s.content
        .filter((c): c is { type?: string; text?: string } => !!c && typeof c === 'object')
        .filter(c => c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text).join('')
      if (txt) return txt
    }
  }
  let best = ''
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v.length > best.length) best = v; return }
    if (Array.isArray(v)) { v.forEach(walk); return }
    if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(body)
  return best
}

/* Three shapes, because three kinds of model answer.
 *
 * The JSON was written for an instruction-following model and that is what
 * a Flash returns. A speech-to-text model does not follow instructions at
 * all - it is not that kind of model - it just returns the words, in a
 * paragraph. That answer was being thrown away for not being JSON, and the
 * person was told their track was instrumental while a perfectly good
 * transcript sat in the discarded text. Some models land in between and
 * return "MM:SS text" lines.
 *
 * So: try JSON, then stamped lines, then prose. */
function parseLines(raw: string, durationSec: number): AiLine[] {
  const body = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  return fromJson(body, durationSec) || fromStamped(body, durationSec) || fromProse(body) || []
}

function fromJson(body: string, durationSec: number): AiLine[] | null {
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let data: { lines?: Array<{ t?: unknown; text?: unknown }> }
  try { data = JSON.parse(body.slice(start, end + 1)) } catch { return null }
  const out: AiLine[] = []
  for (const l of data.lines ?? []) {
    const text = typeof l?.text === 'string' ? l.text.trim() : ''
    if (!text) continue
    const t = parseStamp(l?.t)
    // A stamp past the end of the track is a hallucinated one; the line is
    // still worth keeping as text, so it lands unsynced rather than wrong.
    out.push({ time: t !== null && t >= 0 && t <= durationSec + 5 ? t : -1, text })
  }
  return out.length ? out : null
}

/** "[0:12] words" or "0:12 words", one per line. */
function fromStamped(body: string, durationSec: number): AiLine[] | null {
  const out: AiLine[] = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)(?:\.\d+)?\]?\s*[---:]?\s*(.+)$/)
    if (!m) continue
    const t = parseStamp(m[1])
    const text = m[2].trim()
    if (t === null || !text) continue
    out.push({ time: t >= 0 && t <= durationSec + 5 ? t : -1, text })
  }
  // Two stamped lines could be a coincidence in prose; a transcript has more.
  return out.length >= 3 ? out : null
}

/* A model that cannot be told to say no will say no in a sentence. These
   are the ways it does, and they are short - a refusal that long would be
   an essay, and a transcript that short is not worth showing. */
const REFUSAL = /\b(i (?:can(?:'|’)?t|cannot|am unable|won'?t)|unable to|i'?m sorry|sorry,|as an ai|не могу|не удалось|извините)\b/i

function fromProse(body: string): AiLine[] | null {
  const text = body.replace(/\s+/g, ' ').trim()
  if (text.length < 120 && REFUSAL.test(text)) return null
  if (text.length < 40) return null
  /* Broken at sentence ends so it reads as lyrics rather than as a wall.
     No timings here - the model did not give any, and inventing them would
     scroll the wrong line at the wrong moment, which is worse than a block
     of text that simply sits there. */
  const parts = text.split(/(?<=[.!?…])\s+/).map(p => p.trim()).filter(Boolean)
  const lines: string[] = []
  for (const p of parts) {
    // Fragments shorter than this are the tail of the previous thought.
    if (lines.length && p.length < 24) lines[lines.length - 1] += ' ' + p
    else lines.push(p)
  }
  return lines.map(t => ({ time: -1, text: t }))
}

export interface TranscribeInput {
  trackId: number
  title: string
  artist: string
  durationSec: number
  audio: Buffer
  mime: string
  key: string
  model?: string
  /** Known words. Given these, the model times them instead of hearing them. */
  lyrics?: string[] | null
  /** Cache slot; defaults to the model name. */
  slot?: string
}

export async function transcribe(inp: TranscribeInput): Promise<AiLyrics> {
  /* Nothing goes out of here that a person did not write.
     The model is still asked to listen - that is how the clock is read off
     the recording - but its words are used only to locate the real ones and
     are thrown away afterwards (see align.ts). Without real words there is
     nothing to locate, so the request is not made at all: a transcript of a
     song is a plausible, confident, wrong text, and showing one as lyrics
     is worse than showing none. This is a refusal in the code rather than a
     habit in the caller, because a habit is one careless commit from being
     dropped. */
  if (!inp.lyrics?.length) throw new Error('NO_WORDS')
  if (!inp.key) throw new Error('NO_KEY')
  if (inp.audio.length > MAX_AUDIO) throw new Error('TOO_LONG')
  if (!inp.audio.length) throw new Error('NO_AUDIO')

  const chosen = inp.model || DEFAULT_MODEL
  try {
    return await askModel(inp, chosen, inp.slot || chosen)
  } catch (e) {
    const busy = e instanceof Error && e.message === 'OVERLOADED'
    if (!busy || chosen === FALLBACK_MODEL) throw e
    // Filed under the model that was ASKED for, so asking again finds it.
    try { return await askModel(inp, FALLBACK_MODEL, inp.slot || chosen) } catch { throw new Error('OVERLOADED') }
  }
}

async function askModel(inp: TranscribeInput, model: string, fileAs: string): Promise<AiLyrics> {
  /* The model is asked the same thing either way - what do you hear, and
     when - because that is the question it answers well. Known words change
     what happens to the answer, not what is asked for: see align.ts. */
  // Always true now: transcribe() refuses without known words.
  const aligning = !!inp.lyrics?.length
  const makeBody = (withSchema: boolean, withThinking: boolean) => JSON.stringify({
    model,
    input: [
      { type: 'text', text: prompt(inp.title, inp.artist, inp.durationSec) },
      { type: 'audio', data: inp.audio.toString('base64'), mime_type: inp.mime },
    ],
    ...(withSchema
      ? { response_format: { type: 'text', mime_type: 'application/json', schema: LYRICS_SCHEMA } }
      : {}),
    ...(withThinking
      ? { generation_config: { thinking_level: THINKING[model] ?? DEFAULT_THINKING, thinking_summaries: 'none' } }
      : {}),
  })

  let withSchema = true
  let withThinking = true
  let body = makeBody(true, true)
  let payload: unknown = null
  const started = Date.now()
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      /* Bounded. Generously - this uploads a track and waits for a model to
         listen to it - but bounded: without a signal a stalled connection
         sat here for the rest of the session, and the retry loop below only
         ever runs on a rejection, which never came. */
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'x-goog-api-key': inp.key, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      })
    } catch (e) {
      // No response at all: offline, DNS, a proxy in the way. Worth one more
      // go - a dropped connection mid-upload is not a verdict.
      if (attempt < RETRIES) { await sleep(BACKOFF_MS[attempt]); continue }
      throw new Error('NETWORK: ' + (e instanceof Error ? e.message : String(e)))
    }
    if (res.ok) { payload = await res.json(); break }

    const detail = await res.text().catch(() => '')
    // The ones the person can act on, told apart from the rest.
    if (res.status === 400 && /api.?key/i.test(detail)) throw new Error('BAD_KEY')
    /* This model cannot be held to a shape. Ask again without one rather
       than fail: a paragraph of real lyrics beats an error, and the parser
       downstream knows what to do with it. Not counted as an attempt - the
       request was never served. */
    /* Two things this model may not accept: a shape for its answer, and a
       limit on its thinking. Either one is dropped and the request goes
       again - the attempt is not counted, since it was never served. */
    if (withSchema && res.status === 400 && /response_?format|schema|structured/i.test(detail)) {
      withSchema = false
      body = makeBody(false, withThinking)
      attempt--
      continue
    }
    if (withThinking && res.status === 400 && /thinking|generation_?config/i.test(detail)) {
      withThinking = false
      body = makeBody(withSchema, false)
      attempt--
      continue
    }
    if (res.status === 429) throw new Error('RATE_LIMIT')
    if (RETRY_ON.has(res.status) || /unavailable|overloaded|high demand/i.test(detail)) {
      if (attempt < RETRIES) { await sleep(BACKOFF_MS[attempt]); continue }
      throw new Error('OVERLOADED')
    }
    /* Everything else carries the API's own words through to the surface.
       "Transcription failed" is true and useless: a wrong model name, a
       region block and a malformed body all look identical from here, and
       only the server knows which it was. */
    const why = detail.replace(/\s+/g, ' ').trim().slice(0, 240)
    throw new Error(`HTTP ${res.status}${why ? ': ' + why : ''}`)
  }
  const text = outputText(payload)
  const heard = parseLines(text, inp.durationSec)
  const lines = aligning ? mapOnto(inp.lyrics!, heard, inp.durationSec) : heard
  const value: AiLyrics = {
    lines,
    plain: lines.map(l => l.text).join('\n'),
    model,
    at: Date.now(),
    ...(aligning ? { heard, fit: anchorShare(inp.lyrics!, heard, inp.durationSec) } : {}),
    ...(lines.length ? {} : { note: text.replace(/\s+/g, ' ').trim().slice(0, 300) }),
  }
  console.log('[ai-lyrics] %s answered in %ss with %d lines%s', model,
    ((Date.now() - started) / 1000).toFixed(1), heard.length,
    aligning
      ? ` -> ${lines.length} known lines, ${Math.round((value.fit ?? 0) * 100)}% of them recognised in the audio`
      : '')
  if (!lines.length) console.log('[ai-lyrics] it said: %s', value.note || '(nothing)')
  // Cached even when empty: an instrumental should be asked about once, not
  // every time its track comes round.
  writeCached(inp.trackId, fileAs, value)
  return value
}
