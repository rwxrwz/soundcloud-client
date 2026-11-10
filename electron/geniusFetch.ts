import { app } from 'electron'
import { createHash } from 'crypto'
import { fetchInSession, solveChallenge } from './geniusSession'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

/* Lyrics from Genius, fetched the way a guest should.
 *
 * ── What the rules actually say ──────────────────────────────────────────
 * genius.com/robots.txt disallows /api/* and /search?* for everyone, and
 * says nothing about song pages - so a song page may be read, and the site
 * search may not. That rules out the obvious shortcut (their internal search
 * endpoint) and it is why discovery goes through api.genius.com instead: a
 * different host, the interface they publish for programs, entered with a
 * token the person creates themselves.
 *
 * Nothing here pretends to be a browser. The User-Agent says what this is
 * and who it is for; if Genius ever decides to refuse that, it refuses
 * honestly and we stop, which is the correct outcome. Measured while
 * building this: a song page answers an honest agent normally (404 for a
 * wrong slug, not 403), while /api/search answers 403 - the site is already
 * telling us which door is which.
 *
 * ── The limits, all enforced below ───────────────────────────────────────
 *   - only for the one track the person is listening to, and only after it
 *     has been on screen a couple of seconds: never in bulk, never for a
 *     list, never for a track that was skipped past. It used to need an
 *     explicit press as well, which was stricter than it needed to be -
 *     the player was already resolving the same song to the same page for
 *     the link button, so the press bought Genius nothing and cost the
 *     person the feature;
 *   - one request at a time, and at least MIN_GAP_MS between them - see
 *     the constant for why that number is what it is;
 *   - every result cached on disk forever, so one song is fetched once;
 *   - a refusal (403/429) stops everything for COOLDOWN_MS and is reported;
 *   - only two URLs are ever touched: api.genius.com/search and the song
 *     page it returns.
 *
 * There is no daily cap. There was one, and it was a number made up to feel
 * responsible: a person listening to music all day would hit it and lose the
 * feature for no reason that helps Genius. What actually protects them is
 * the pacing, the cache, and stopping dead when they say no - a cap only
 * punished the heaviest honest user. The three that remain are the ones with
 * a reason behind them, and they matter more now that the token is shared by
 * everyone running the app: it is the backing off, not a quota, that keeps
 * one app's credential from being hammered into a ban. */

const UA = 'SoundCloudDesktopPlayer/2.0 (personal music player; fetches lyrics for the track the user is playing)'
/* The gap between requests. This is ours, not Genius's - they publish no
   rate for the API - and it was two seconds, which made a full library
   scan a thirteen-minute wait. Seven hundred milliseconds is still slower
   than one request per second and still strictly serial, so nothing here
   ever has two requests in flight. What actually protects the shared
   token is the backing off below: a 429 stops every request for an hour,
   and that is the line this number is allowed to approach but not cross. */
const MIN_GAP_MS = 700
const COOLDOWN_MS = 60 * 60 * 1000
/* A check that was shown and not passed is not a refusal - somebody was
   busy. Five minutes, so pressing the button again actually tries again
   instead of meeting an hour of silence, and so a scan does not reopen
   the window on every one of the remaining tracks. */
const DECLINED_MS = 5 * 60 * 1000
/* Baked in by the build; '' when the build had no token. Read through a
   guard so a dev run without the define still starts. */
declare const __GENIUS_TOKEN__: string | undefined
const BUILT_IN_TOKEN = typeof __GENIUS_TOKEN__ === 'string' ? __GENIUS_TOKEN__ : ''

/** The person's own token wins; otherwise the application's. */
export const tokenFor = (userToken: string) => userToken.trim() || BUILT_IN_TOKEN
const TIMEOUT_MS = 20000

const dir = () => {
  const d = join(app.getPath('userData'), 'genius')
  try { mkdirSync(d, { recursive: true }) } catch { /* ignore */ }
  return d
}
const pageFile = (trackId: number) => join(dir(), `${trackId}.html`)
const missFile = () => join(dir(), 'misses.json')

/* ── tracks Genius does not have ──────────────────────────────────────
 *
 * A hit is cheap to remember - the page is written to disk and the next
 * run costs nothing. A miss was remembered nowhere, and a miss is the
 * expensive answer: `search` tries three different queries before giving
 * up, so every launch spent three API calls per track on the same empty
 * result, for every track in the library that has no Genius page. On a
 * library where one track in seven is an unknown upload that is most of
 * the daily traffic, and all of it against a token this build shares with
 * everyone who installs it.
 *
 * Dated, not permanent. Songs do get added to Genius, and a player that
 * decided once and for all that a track has no words would never notice.
 * Two weeks is long past the point where re-asking costs anything. */
const MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MISS_MAX = 4000

function misses(): Record<string, number> {
  try {
    const m = JSON.parse(readFileSync(missFile(), 'utf8')) as Record<string, number>
    return m && typeof m === 'object' ? m : {}
  } catch { return {} }
}

/** True when this track was searched for recently and was not there. */
function missedRecently(trackId: number): boolean {
  const at = misses()[String(trackId)]
  return typeof at === 'number' && Date.now() - at < MISS_TTL_MS
}

function noteMiss(trackId: number): void {
  const m = misses()
  m[String(trackId)] = Date.now()
  // Trimmed from the oldest, which are also the ones closest to expiring.
  const keys = Object.keys(m)
  if (keys.length > MISS_MAX) {
    const keep = keys.sort((a, b) => m[b] - m[a]).slice(0, MISS_MAX)
    const out: Record<string, number> = {}
    for (const k of keep) out[k] = m[k]
    try { writeFileSync(missFile(), JSON.stringify(out)) } catch { /* a bonus */ }
    return
  }
  try { writeFileSync(missFile(), JSON.stringify(m)) } catch { /* a bonus */ }
}

/** Forget that a track was missing - it has a page now, or the person
 *  asked for a fresh look. */
export function clearMiss(trackId: number): void {
  const m = misses()
  if (!(String(trackId) in m)) return
  delete m[String(trackId)]
  try { writeFileSync(missFile(), JSON.stringify(m)) } catch { /* a bonus */ }
}
const stateFile = () => join(dir(), 'budget.json')

/* What is left to remember: when Genius last said no, and which token it
   refused. `used` stays in the file so an older install's number is not
   lost, but nothing reads it as a limit any more.

   `badToken` holds a digest, never the token - a dead credential is still a
   credential, and this file is plain text. Keying it this way means a
   replaced token clears the state by itself: a different token has a
   different digest, so it is simply not the one that was refused. */
/* Two refusals, two timers, because they are not the same refusal.
 *
 * Measured, not assumed: with the website answering 403 and
 * `cf-mitigated: challenge`, api.genius.com answered 200 in the same
 * second and reported 9313 of 10000 requests left. The website is
 * Cloudflare deciding we do not look like a browser, which is per-IP and
 * has nothing to do with any quota; the API is a published allowance on
 * the token. One shared flag meant a Cloudflare challenge on the website
 * also switched off an API that was working perfectly, which took the
 * "open on Genius" link down with it for an hour at a time. */
interface Budget {
  day: string
  used: number
  blockedUntil: number      // api.genius.com - the token's allowance
  webBlockedUntil?: number  // genius.com - Cloudflare's challenge
  badToken?: string
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16)

function budget(): Budget {
  try {
    const b = JSON.parse(readFileSync(stateFile(), 'utf8')) as Budget
    const today = new Date().toISOString().slice(0, 10)
    return b.day === today ? b : { day: today, used: 0, blockedUntil: b.blockedUntil ?? 0, webBlockedUntil: b.webBlockedUntil ?? 0, badToken: b.badToken }
  } catch {
    return { day: new Date().toISOString().slice(0, 10), used: 0, blockedUntil: 0, webBlockedUntil: 0 }
  }
}
/* Merged against what is on disk rather than against a snapshot the caller
   took earlier. The search and the page fetch both write, and with snapshots
   the second write put back the first one's stale fields. */
function patchBudget(p: Partial<Budget>) {
  try { writeFileSync(stateFile(), JSON.stringify({ ...budget(), ...p })) } catch { /* ignore */ }
}

/** Has this token already been refused? One answer, because three call
 *  sites disagreeing about it is how a half-dead token looks from the
 *  outside: words stop arriving while the link button carries on. */
const refused = (token: string) => budget().badToken === digest(token)

/** Is there a token at all, and has it not already been refused? What the
 *  settings panel asks before deciding to hide its token field. */
export const tokenUsable = (userToken: string) => {
  const t = tokenFor(userToken)
  return !!t && !refused(t)
}

let lastRequest = 0
/* The queue is one promise, and a caller joins it by taking the tail and
   putting itself in its place - which has to happen with no await in
   between. An earlier version checked a flag and then slept before claiming
   the slot; two callers both passed the check and went out together, 1ms
   apart. A chain cannot be raced, because joining it is a single step. */
let tail: Promise<unknown> = Promise.resolve()

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))


/** One at a time, never faster than MIN_GAP_MS, with an honest name on it. */
/* Two transports behind one queue.
 *
 * api.genius.com is the published interface: it takes our token, it
 * answers, and it gets the honest User-Agent that says what this is.
 *
 * genius.com is a website behind Cloudflare, which answers a plain client
 * with a challenge no fetch can pass. Those requests go out through the
 * browser session in geniusSession.ts, which carries the clearance a
 * person earned by passing the check once - and carries that session's
 * own user agent, because the clearance is void under any other.
 *
 * Both share this queue and the gap between requests: there is still only
 * ever one request in flight, whichever door it goes through. */
function polite(url: string, headers: Record<string, string> = {}, page = false): Promise<{ ok: boolean; status: number; body: string; retryAfter?: number; why?: string; by?: string; challenged?: boolean }> {
  const run = tail.then(async () => {
    const gap = MIN_GAP_MS - (Date.now() - lastRequest)
    if (gap > 0) await sleep(gap)
    lastRequest = Date.now()
    const res = page
      ? await fetchInSession(url, TIMEOUT_MS)
      : await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en,ru;q=0.8', ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    /* Genius is allowed to say how long to wait, and when it does its
       answer beats ours: sitting out a flat hour on top of a thirty
       second Retry-After is a wait nobody asked for. Seconds or an HTTP
       date, both are legal. */
    const ra = res.headers.get('retry-after')
    let retryAfter: number | undefined
    if (ra) {
      const secs = Number(ra)
      const at = Number.isFinite(secs) ? Date.now() + secs * 1000 : Date.parse(ra)
      if (Number.isFinite(at) && at > Date.now()) retryAfter = at
    }
    /* A refusal used to be thrown away whole, which left the log able to
       say only "blocked" - not by whom, nor whether it was Genius itself
       or the edge in front of it. The first 300 characters and three
       headers cost nothing and answer both. */
    if (res.ok) return { ok: true, status: res.status, body: await res.text(), retryAfter }
    let why = ''
    try { why = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 300) } catch { /* no body */ }
    const by = [res.headers.get('server'), res.headers.get('cf-mitigated'), res.headers.get('cf-ray') ? 'cf-ray' : '']
      .filter(Boolean).join(' ')
    /* Cloudflare names its own answer. A challenge is not a refusal: it
       is a question, and there is somebody here who can answer it. */
    const challenged = res.headers.get('cf-mitigated') === 'challenge'
    return { ok: false, status: res.status, body: '', retryAfter, why, by, challenged }
  })
  // One failure must not poison the queue for whoever is behind it.
  tail = run.catch(() => undefined)
  return run
}

export type GeniusResult =
  | { ok: true; html: string; url: string; cached: boolean }
  /* BAD_TOKEN means the credential itself was refused, which is a different
     problem from Genius being annoyed with us - and `shared` says whose it
     was, because "the app's token died, go make your own" and "the token you
     typed is wrong" need opposite things from the person reading it. */
  /* `retryAt` rides along with BLOCKED. Without it the only thing the
     player can say is "blocked", and a refusal with no end to it reads
     like a broken feature rather than an hour's wait. */
  | { ok: false; reason: 'NO_TOKEN' | 'NOT_FOUND' | 'BLOCKED' | 'BAD_TOKEN' | 'ERROR'; shared?: boolean; retryAt?: number }

interface Hit { result?: { title?: string; artist_names?: string; url?: string } }

/** Words are compared the way the link finder already does it. */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/* Words that say nothing about who made the song. SoundCloud uploader names
   are full of them - "3umph archive", "xyz music", "slowed reverb" - and a
   shared "music" would otherwise be read as two artists being the same
   person, which is how the wrong song's words end up under a track. */
const FILLER = new Set([
  'archive', 'archives', 'music', 'musik', 'official', 'prod', 'beats', 'beat',
  'records', 'record', 'release', 'releases', 'slowed', 'reverb', 'remix',
  'remixes', 'cover', 'covers', 'audio', 'topic', 'channel', 'free', 'type',
  'the', 'and', 'ost', 'vol', 'mix', 'edit', 'full', 'album', 'song', 'songs',
])

/* How sure we are that two credit strings name the same person. Mirrors
   artistMatchLevel() in src/services/lyrics.ts - the same question asked of
   a different service, and kept here rather than imported because that file
   is renderer code and this runs in the main process.

     2 - the names are each other, or one contains the other
     1 - the same name up to a trailing number, or one telling word in common

   The weak level is not a guess, it is the ordinary case: SoundCloud
   uploaders rename across platforms, and an account called CODE10 putting
   out what Genius files under CODE80 is a person, not a coincidence. */
/* One name inside another only means something if the shared part does.
   "3umph archive" contains "archive", and an artist actually called Archive
   is not that person - the overlap was the throwaway word, which is the one
   part of an uploader name that carries no information. */
const meaningful = (name: string) => name.split(' ').some(w => w.length >= 3 && !FILLER.has(w))
function overlaps(x: string, y: string): boolean {
  if (!x || !y) return false
  if (x === y) return true
  const inner = x.length <= y.length ? x : y
  return (x.includes(y) || y.includes(x)) && meaningful(inner)
}

/* Where one credit string stops being one performer. SoundCloud packs
   collectives, labels and features into the single uploader field. */
const CREDIT_SPLIT = /\s*(?:\|\||[|/,&+]|\bx\b|\bft\.?\b|\bfeat\.?\b|\bvs\.?\b)\s*/i

/* The one name worth putting in a query. Genius wants every word of a
   query to appear somewhere, so "GucciBag+TrueReligionJeans DATA404 ||
   ARLEKIN MUSIC" finds nothing at all while the same search without the
   label finds the song first. Takes the first part that still says
   something once the throwaway words are discounted. */
function searchName(credit: string): string {
  for (const part of credit.split(CREDIT_SPLIT)) {
    const p = part.trim()
    if (p && norm(p).split(' ').some(w => w.length >= 2 && !FILLER.has(w))) return p
  }
  return credit.trim()
}

/* Two names for one act, for judging a Genius credit against the whole
   library rather than against one upload's credits.

   Containment, or the same name up to a trailing number - an account
   called CODE10 putting out what Genius files under CODE80 is a person,
   not a coincidence, and that is thirteen songs in the library this was
   written against. A single shared word is deliberately NOT enough here,
   which is where this parts company with artistLevel: against one
   upload's credits a common word is a signal, against a hundred names it
   is a certainty and means nothing. */
function sameAct(a: string, b: string): boolean {
  if (overlaps(a, b)) return true
  const core = (x: string) => x.replace(/\s*\d+\s*$/, '').trim()
  const ca = core(a)
  const cb = core(b)
  return ca.length >= 4 && cb.length >= 4 && overlaps(ca, cb)
}

function artistLevel(mine: string[], myWords: Set<string>, theirs: string): 0 | 1 | 2 {
  if (!theirs) return 0
  if (mine.some(a => overlaps(a, theirs))) return 2
  const stripDigits = (x: string) => x.replace(/\s*\d+\s*$/, '').trim()
  const theirCore = stripDigits(theirs)
  if (mine.some(a => { const core = stripDigits(a); return core.length >= 4 && overlaps(core, theirCore) })) return 1
  return theirs.split(' ').some(w => myWords.has(w)) ? 1 : 0
}

/* The forms of a Genius title worth comparing against.

   Songs in this corner of SoundCloud are filed on Genius as "original
   (translation)" - a third of the pages cached by this player are - and
   the upload carries only one of the two halves, sometimes the original
   and sometimes the English. Comparing against the whole string only
   matches when the uploader happened to copy both. */
function titleForms(raw: string): string[] {
  const m = raw.match(/^(.*\S)\s*[([]([^)\]]+)[)\]]\s*$/)
  const forms = m ? [raw, m[1], m[2]] : [raw]
  return [...new Set(forms.map(norm).filter(Boolean))]
}

/** A normalised string with the spaces taken out too. */
const squash = (n: string) => n.replace(/ /g, '')

function picks(
  hits: Hit[], title: string, artists: string[], rawTitle?: string,
  knownList: Iterable<string> = [], onMatch?: (credits: string) => void,
): string | null {
  const titleN = norm(title)
  const titleC = squash(titleN)
  const titleRaw = title.trim().toLowerCase()
  const mine = artists.map(a => norm(a)).filter(Boolean)
  /* Words that can vouch for an artist. The credits are one source and
     the upload's own title is another: SoundCloud names routinely carry
     the features - "DUMMY DUMMY + ARLEKIN 40 000", "(feat. FallenCastle)"
     - and that is the uploader saying who is on the record. */
  const myWords = new Set([...mine, norm(rawTitle ?? '')]
    .flatMap(a => a.split(' ')).filter(w => w.length >= 3 && !FILLER.has(w)))

  const titleLevel = (raw: string): 0 | 1 | 2 => {
    let best: 0 | 1 | 2 = 0
    for (const h of titleForms(raw)) {
      if (h === titleN) return 2
      /* The same letters with different punctuation: "HelloKitty 2"
         against "HelloKitty2", "TheDevilsAdvocate" against
         "TheDevil'sAdvocate". Nothing about a song changes with an
         apostrophe, and uploaders put them wherever they like. */
      if (titleC && squash(h) === titleC) return 2
      if (Math.min(h.length, titleN.length) >= 3 && (titleN.startsWith(h) || h.startsWith(titleN))) best = 1
    }
    /* A title made of symbols normalises to nothing at all, so there is
       nothing left to compare - "†††††" becomes the empty string. Genius
       files that one as "††††† (Crosses)", which still begins with the
       symbols, so the untouched strings are all there is to go on. */
    if (!titleN && titleRaw && !best) {
      const hr = raw.trim().toLowerCase()
      if (hr.startsWith(titleRaw) || titleRaw.startsWith(hr)) best = 1
    }
    return best
  }

  /* Both halves must say yes - a title alone matches other people's songs,
     and an artist alone matches their whole catalogue. Among the hits that
     pass, the artist decides first: the title is what we searched for, so
     it agrees everywhere, and what separates two songs called the same
     thing is who made them. */
  let best: { url: string; score: number; credits: string } | null = null
  const unvouched: { url: string; credits: string }[] = []
  for (const h of hits) {
    const r = h.result
    if (!r?.url) continue
    const t = titleLevel(r.title ?? '')
    if (!t) continue
    const credits = norm(r.artist_names ?? '')
    const a = artistLevel(mine, myWords, credits)
    if (!a) { if (t === 2) unvouched.push({ url: r.url, credits }); continue }
    const score = a * 10 + t
    if (!best || score > best.score) best = { url: r.url, score, credits }
  }
  if (best) { onMatch?.(best.credits); return best.url }

  /* Nothing could be vouched for by the upload's own credits, and on
     SoundCloud that is routine rather than suspicious: the uploader is
     very often not the artist and the title says nothing either. So ask
     the library instead - if the exact title belongs to somebody this
     listener has other songs by, that is a real answer.

     Two guards, and both are needed. The title has to be the only exact
     one in the answer, because two songs by that name make the choice a
     coin toss. And the artist has to be known already, because without
     that this takes any unique exact title going - tried it, and on a
     library's worth of tempting decoys it took forty-three of forty-eight
     wrong pages. "Paradise" is somebody's song whoever you are. */
  if (unvouched.length !== 1 || titleC.length < 6) return null
  const lib = [...knownList]
  if (!lib.some(a => sameAct(a, unvouched[0].credits))) return null
  return unvouched[0].url
}

/* Artists this library has already been shown to contain.
 *
 * Built only from matches that stood on their own - the title agreed and
 * the credits agreed - so every name in here was earned. It exists for
 * the opposite case: a song whose uploader says nothing about who made
 * it. "VE FREESTYLE" went up under an account called "xddd" and
 * "AllWillPass" under "sexyboyblood #TYBG"; both are on Genius under
 * tewiq and CODE80, both of whom this listener already has ten other
 * songs by. That is evidence, and it is the only kind available.
 *
 * Kept next to the pages rather than in the renderer because this is
 * where the matching happens, and cleared with them: the button says it
 * forgets what the player learned about lyrics, and this is that. */
const artistsFile = () => join(dir(), 'artists.json')
let knownArtists: Set<string> | null = null

function known(): Set<string> {
  if (!knownArtists) {
    try {
      const v = JSON.parse(readFileSync(artistsFile(), 'utf8')) as unknown
      knownArtists = new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])
    } catch { knownArtists = new Set() }
  }
  return knownArtists
}

/* Names this listener's library claims, taken from its own metadata -
 * who uploaded each track and who is named in the titles.
 *
 * Known before the first request, which is the entire point. Learning
 * from confirmed matches builds the same set eventually, but a scan is a
 * button somebody presses once: a track judged third cannot be helped by
 * a name that turns up eightieth, and a listener with an empty cache
 * would get nothing from it at all. The library already knows who is in
 * it; it only had to be asked. */
let libraryNames = new Set<string>()

export function setLibraryArtists(names: string[]): void {
  const out = new Set<string>()
  for (const raw of names) {
    // One credit field is several people: "DATA404 || ARLEKIN MUSIC".
    for (const part of String(raw ?? '').split(CREDIT_SPLIT)) {
      const n = norm(part)
      /* An account called "xyz music" names nobody. Letting a throwaway
         word in would make it vouch for an artist actually called Music. */
      if (n && meaningful(n)) out.add(n)
    }
  }
  libraryNames = out
}

/** Everything that may vouch for an artist: the library, plus whatever
 *  this run has confirmed on Genius since. */
const vouchers = (): string[] => [...libraryNames, ...known()]

/** Remember the credits of a match that needed no help. */
function learnArtist(credits: string): void {
  const n = norm(credits)
  if (!n || known().has(n)) return
  known().add(n)
  // Capped: a library is a few dozen artists, a runaway file is a bug.
  try { writeFileSync(artistsFile(), JSON.stringify([...known()].slice(-400))) } catch { /* a bonus */ }
}

export function forgetArtists(): void {
  knownArtists = new Set()
  try { unlinkSync(artistsFile()) } catch { /* never written */ }
}

export function readCachedPage(trackId: number): string | null {
  try {
    const f = pageFile(trackId)
    return existsSync(f) ? readFileSync(f, 'utf8') : null
  } catch { return null }
}

type Found = { url: string | null; fail?: 'BAD_TOKEN' | 'BLOCKED' | 'ERROR' }
type Asked = { hits: Hit[] } | { fail: 'BAD_TOKEN' | 'BLOCKED' | 'ERROR' }

/** One query to the published API, with the reason when it did not answer -
 *  the page fetch needs to tell a dead token from a missed match. */
async function ask(token: string, query: string): Promise<Asked> {
  try {
    const q = encodeURIComponent(query.trim())
    /* Twenty rather than the default ten. A song by somebody small shares
       its title with chart records - "Woody Allen" has a Jay Electronica
       on it - and ranking puts those first, so the one we want sits just
       past the end of the first page. Same request, same pacing. */
    const res = await polite(`https://api.genius.com/search?q=${q}&per_page=20`, { Authorization: `Bearer ${token}` })
    if (!res.ok) {
      /* 401 is the API saying this token is not a token any more - revoked,
         deleted, or mistyped. Waiting an hour would not help, so instead of
         a cooldown we remember the digest and stop asking with it at all. */
      if (res.status === 401) {
        patchBudget({ badToken: digest(token) })
        return { fail: 'BAD_TOKEN' }
      }
      if (res.status === 403 || res.status === 429) {
        patchBudget({ blockedUntil: res.retryAfter ?? Date.now() + COOLDOWN_MS })
        // Named, because a refusal from the API and one from the website
        // are different problems with the same word on them.
        console.warn('[genius] api.genius.com refused %d by %s: %s', res.status, res.by || 'api', res.why || '(no body)')
        return { fail: 'BLOCKED' }
      }
      return { fail: 'ERROR' }
    }
    return { hits: (JSON.parse(res.body) as { response?: { hits?: Hit[] } }).response?.hits ?? [] }
  } catch { return { fail: 'ERROR' } }
}

/* The title carries the search; the artist only judges what comes back.
   Putting the uploader's name into the query looked like precision and was
   the opposite: Genius wants every word to appear somewhere, and a
   SoundCloud account called "3umph archive" turned a song that is the first
   hit for its title into zero hits for "title 3umph archive". Names like
   that are the norm there, not the exception.

   The artist still decides which hit is the song - it just does it after
   the answer arrives, where a word too many costs nothing. Only when the
   title alone finds no acceptable hit is the name added to narrow a title
   too common to rank on its own, and that costs one extra request. */
async function search(token: string, title: string, artists: string[], raw?: string): Promise<Found> {
  const named = artists.map(a => a.trim()).filter(Boolean)[0]
  /* Three angles, each one request, and only as far as it takes.

     The bare title first: it is the part we are most sure of.
     Then the title with one name on it, for a title too common to rank on
     its own. Then the upload's own title, untouched - "huzzy b <em dash>
     тульпа" is what a person would paste into the search box, and Genius
     answers it with the right song as the top result. We take it apart to
     search properly, and when that misses, handing the search engine the
     original string costs one request and sometimes just works. */
  const queries = [
    title,
    named && `${title} ${searchName(named)}`,
    raw && raw.trim() !== title.trim() ? raw.trim() : '',
  ].filter(Boolean) as string[]

  for (const q of [...new Set(queries)]) {
    const res = await ask(token, q)
    if ('fail' in res) return { url: null, fail: res.fail }
    const url = picks(res.hits, title, artists, raw, vouchers(), learnArtist)
    if (url) return { url }
  }
  return { url: null }
}

/** Just the address. Used for the link button, so that one stops touching
 *  genius.com/api - which robots forbids. */
export async function geniusSearch(userToken: string, title: string, artists: string[], raw?: string): Promise<string | null> {
  const token = tokenFor(userToken)
  if (!token) return null
  const b = budget()
  if (Date.now() < b.blockedUntil || refused(token)) return null
  return (await search(token, title, artists, raw)).url
}

/* A page, and a person on hand if Cloudflare wants one.
 *
 * The retry is single: either the clearance was earned and the second
 * attempt goes through, or the person closed the window, which is an
 * answer too and is not worth asking twice in a row. A declined check
 * sets the same website cooldown a refusal does, so a scan does not
 * reopen the window on every remaining track. */
async function getPage(url: string): Promise<ReturnType<typeof polite> extends Promise<infer R> ? R : never> {
  const first = await polite(url, {}, true)
  if (!first.challenged) return first
  console.warn('[genius] cloudflare wants a check; asking')
  const passed = await solveChallenge(url)
  if (!passed) {
    console.warn('[genius] check not passed')
    return first
  }
  return await polite(url, {}, true)
}

/* A song page named by the person rather than found by us.
 *
 * Worth having because the matching is the part that fails: a reupload
 * under a different title, an artist who renamed, two songs with the same
 * name. Somebody who has the page open knows which one it is, and that is
 * better evidence than any comparison we can make.
 *
 * Only a genius.com song page, and the check is on the parsed URL rather
 * than on the text of it - "genius.com.example.net" and a path with the
 * right suffix buried in a query both read as fine to a regex. No token is
 * involved: reading a page never needed one. */
export async function geniusByUrl(trackId: number, raw: string): Promise<GeniusResult> {
  /* No cache read here, unlike every other path. Pasting a link is how a
     person corrects a wrong match, and the wrong match is exactly what is
     sitting in the cache - serving it back would make the correction do
     nothing. The fetched page replaces it. */
  let url: URL
  try { url = new URL(raw.trim()) } catch { return { ok: false, reason: 'NOT_FOUND' } }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || (host !== 'genius.com' && host !== 'www.genius.com')) {
    return { ok: false, reason: 'NOT_FOUND' }
  }
  if (!/^\/[\w%-]+-lyrics$/.test(url.pathname)) return { ok: false, reason: 'NOT_FOUND' }

  const b = budget()
  const webUntil = b.webBlockedUntil ?? 0
  if (Date.now() < webUntil) {
    // Not a request: the earlier refusal still being served out.
    console.warn('[genius] genius.com still in cooldown, %d min left', Math.ceil((webUntil - Date.now()) / 60000))
    return { ok: false, reason: 'BLOCKED', retryAt: webUntil }
  }
  // Query and fragment dropped: neither is part of the page.
  const clean = `https://genius.com${url.pathname}`
  try {
    const page = await getPage(clean)
    patchBudget({ used: budget().used + 1 })
    if (!page.ok) {
      const until = page.challenged
        ? Date.now() + DECLINED_MS
        : page.retryAfter ?? Date.now() + COOLDOWN_MS
      if (page.status === 403 || page.status === 429) {
        patchBudget({ webBlockedUntil: until })
        console.warn('[genius] genius.com refused %d by %s: %s', page.status, page.by || 'website', page.why || '(no body)')
      }
      // A 429 is the one refusal that states its own end, and polite()
      // has already parsed that Retry-After into `until`. Reporting it as
      // a generic ERROR threw the only useful part away.
      return (page.status === 403 || page.status === 429)
        ? { ok: false, reason: 'BLOCKED', retryAt: until }
        : { ok: false, reason: 'ERROR' }
    }
    try { writeFileSync(pageFile(trackId), page.body) } catch { /* cache is a bonus */ }
    // Named by hand, so whatever we concluded by searching was wrong.
    clearMiss(trackId)
    return { ok: true, html: page.body, url: clean, cached: false }
  } catch {
    return { ok: false, reason: 'ERROR' }
  }
}

export async function geniusPage(
  userToken: string, trackId: number, title: string, artists: string[], raw?: string,
): Promise<GeniusResult> {
  const cached = readCachedPage(trackId)
  if (cached) return { ok: true, html: cached, url: '', cached: true }
  /* Asked for recently and not there. Three API calls saved, on a shared
     credential, every time this track comes round again. */
  if (missedRecently(trackId)) return { ok: false, reason: 'NOT_FOUND' }
  const token = tokenFor(userToken)
  if (!token) return { ok: false, reason: 'NO_TOKEN' }
  // Said on every attempt, not only on the one that died: the person may
  // well open the app days later and deserves the same explanation.
  const shared = !userToken.trim()
  if (refused(token)) return { ok: false, reason: 'BAD_TOKEN', shared }

  const b = budget()
  /* Both cooldowns, because this function uses both hosts: it searches on
     api.genius.com and then reads the page from genius.com.

     The API one was written by `ask` and read only by the link button, so
     a 429 stopped that button for an hour while this path - the one a
     300-track scan runs - kept firing requests 700ms apart with the
     shared token for that whole hour, each refusal extending the cooldown
     it was ignoring. Backing off is the only thing protecting a
     credential that every install shares. */
  if (Date.now() < b.blockedUntil) {
    console.warn('[genius] api.genius.com still in cooldown, %d min left', Math.ceil((b.blockedUntil - Date.now()) / 60000))
    return { ok: false, reason: 'BLOCKED', retryAt: b.blockedUntil }
  }
  const webUntil = b.webBlockedUntil ?? 0
  if (Date.now() < webUntil) {
    // Not a request: the earlier refusal still being served out.
    console.warn('[genius] genius.com still in cooldown, %d min left', Math.ceil((webUntil - Date.now()) / 60000))
    return { ok: false, reason: 'BLOCKED', retryAt: webUntil }
  }

  try {
    // 1. Find the song - through the published API, with a token.
    const found = await search(token, title, artists, raw)
    if (found.fail === 'BAD_TOKEN') return { ok: false, reason: 'BAD_TOKEN', shared }
    /* A refusal and a breakage are not "this song is not on Genius" - and a
       refusal from the search half knows when it ends, so it says so. The
       early return used to drop that: it answered BLOCKED with no retryAt,
       which the renderer reads as a wait of zero and prints as "try again
       shortly" for what is an hour. It also made the branch below, written
       for exactly this, unreachable. */
    if (found.fail) {
      return found.fail === 'BLOCKED'
        ? { ok: false, reason: 'BLOCKED', retryAt: budget().blockedUntil }
        : { ok: false, reason: found.fail }
    }
    if (!found.url) {
      /* Only a real "not there" is remembered. A refusal or a network
         failure is about today, not about the track, and writing it down
         would hide the song for a fortnight over one bad minute. */
      noteMiss(trackId)
      return { ok: false, reason: 'NOT_FOUND' }
    }

    // 2. Read that one page. Counted, spaced, and kept.
    const page = await getPage(found.url)
    patchBudget({ used: budget().used + 1 })
    if (!page.ok) {
      /* Being told no is an answer, not an obstacle: stop. For an hour,
         unless Genius named a shorter wait of its own. */
      const until = page.challenged
        ? Date.now() + DECLINED_MS
        : page.retryAfter ?? Date.now() + COOLDOWN_MS
      if (page.status === 403 || page.status === 429) {
        patchBudget({ webBlockedUntil: until })
        console.warn('[genius] genius.com refused %d by %s: %s', page.status, page.by || 'website', page.why || '(no body)')
      }
      // A 429 is the one refusal that states its own end, and polite()
      // has already parsed that Retry-After into `until`. Reporting it as
      // a generic ERROR threw the only useful part away.
      return (page.status === 403 || page.status === 429)
        ? { ok: false, reason: 'BLOCKED', retryAt: until }
        : { ok: false, reason: 'ERROR' }
    }
    try { writeFileSync(pageFile(trackId), page.body) } catch { /* cache is a bonus */ }
    return { ok: true, html: page.body, url: found.url, cached: false }
  } catch {
    return { ok: false, reason: 'ERROR' }
  }
}
