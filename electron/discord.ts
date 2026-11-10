/* Discord rich presence: what is playing, on the person's Discord profile.
 *
 * Discord opens a socket on the machine for exactly this - a named pipe on
 * Windows, a unix socket under the runtime directory everywhere else - and
 * speaks length-prefixed JSON over it. Written out here rather than taken
 * from npm because the two maintained clients bring a websocket stack and a
 * native module along to do what fits in this file, and a native module is
 * a thing this build has to carry into every release artifact.
 *
 * Off unless it is asked for, and not in the shareable settings preset: it
 * publishes what somebody listens to, by name, to everyone who can see
 * their profile. That is not a decision a theme code gets to make for them.
 */

import { createConnection, type Socket } from 'net'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'

/* The Discord application this player presents itself as. Its name is what
   Discord prints after "Listening to", and its icon is what shows when a
   track has no artwork. Public by design: an application id identifies, it
   does not authorise - nothing here is signed and no token is involved. */
const APP_ID = '1567912783461355691'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

/* Where the player itself lives. Second button on the card, after the
   track: whoever is reading the status can see what is playing, and then
   what it is playing in. Discord takes at most two, and a label longer
   than 32 characters is refused outright. */
const HOME_URL = 'https://github.com/rwxrwz/soundcloud-client'

/* Discord allows five activity updates per twenty seconds. Five seconds
   between sends is four of them, which leaves one spare for the clear that
   switching the feature off sends without waiting - measured, because 4.2s
   here put six frames into one twenty-second window. The trailing timer
   means whatever arrived during the wait is what finally goes out: a run of
   skipped tracks settles on the one being listened to, not the first. */
const MIN_GAP_MS = 5000
/* Discord was closed, or restarted. One connect() against a socket that is
   usually not there costs nothing, so this can keep trying all session. */
const RETRY_MS = 15_000

interface PresenceTrack {
  id: number | string
  title: string
  artwork_url?: string | null
  user?: { username?: string }
  duration?: number          // SoundCloud's own length, MILLISECONDS
}
export interface PresenceState {
  currentTrack: PresenceTrack | null
  isPlaying: boolean
  progress: number
  duration: number           // what the audio element decoded, SECONDS
}

/* What Discord has been told, reduced to the parts worth re-sending for.
   Position is deliberately absent: Discord is given the wall-clock time the
   track started and runs its own progress bar from it, so a tick that moves
   playback forward by a second is not news. A seek is. */
interface Pushed { id: string; playing: boolean; start: number; end: number; pos: number }

let sock: Socket | null = null
let ready = false
let enabled = false
let dead = false              // a failure retrying cannot fix (bad app id)
let retryTimer: NodeJS.Timeout | null = null
let flushTimer: NodeJS.Timeout | null = null
let lastSentAt = 0
let pushed: Pushed | null = null
let latest: PresenceState | null = null
/* How much of the activity this Discord client turned out to accept.
 *
 * Three of the fields below are newer than rich presence itself and each
 * one is refused outright by a client old enough: artwork given as a plain
 * https URL rather than a key uploaded to the application, the "Listening
 * to" activity type, and the link button. A refusal throws away the whole
 * frame, not the field, so the alternative to stepping down is a status
 * that silently never appears.
 *
 *   0 - everything
 *   1 - no artwork
 *   2 - no artwork, no button, no activity type
 *
 * Set by what came back, kept for the session: it is a fact about the
 * Discord on this machine, and it will not change while it is running. */
let degrade = 0

/** Every place a Discord client might have put its socket. */
function candidates(): string[] {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`)
  }
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp']
    .filter((b): b is string => !!b)
  // Flatpak and Snap each give Discord its own runtime directory to live in.
  const subs = ['', 'app/com.discordapp.Discord/', 'snap.discord/']
  const out: string[] = []
  const seen = new Set<string>()
  for (const base of bases) {
    for (const sub of subs) {
      for (let i = 0; i < 10; i++) {
        const p = `${base.replace(/\/+$/, '')}/${sub}discord-ipc-${i}`
        if (seen.has(p)) continue
        seen.add(p)
        // A socket that is not on disk cannot be connected to, and checking
        // is cheaper than the connect that would fail.
        if (existsSync(p)) out.push(p)
      }
    }
  }
  return out
}

function frame(op: number, payload: unknown): void {
  if (!sock || sock.destroyed) return
  const data = Buffer.from(JSON.stringify(payload), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(data.length, 4)
  try { sock.write(Buffer.concat([head, data])) } catch { drop() }
}

function drop(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  ready = false
  pushed = null
  const s = sock
  sock = null
  if (s) { s.removeAllListeners(); try { s.destroy() } catch { /* already gone */ } }
}

function scheduleRetry(): void {
  if (retryTimer || !enabled || dead) return
  retryTimer = setTimeout(() => { retryTimer = null; connect() }, RETRY_MS)
}

function connect(): void {
  if (sock || !enabled || dead) return
  if (!APP_ID) {
    // Nothing to connect as. Said once rather than failing quietly, because
    // from the switch's side an unset id and an absent Discord look alike.
    dead = true
    console.error('[discord] no application id is built in, presence cannot start')
    return
  }
  const paths = candidates()
  if (!paths.length) { scheduleRetry(); return }

  /* Tried one at a time rather than all at once: a machine with Discord and
     Discord Canary open has two live sockets, and racing them would leave a
     second connection nobody closes. */
  const tryPath = (i: number): void => {
    if (i >= paths.length || !enabled) { scheduleRetry(); return }
    const s = createConnection(paths[i])
    let settled = false
    s.once('connect', () => {
      settled = true
      /* Checked again here, not only before the attempt. Switching the
         presence off calls drop(), which cannot reach a socket that is
         still being established - so a connect landing after the click
         went on to handshake, and the READY that followed published the
         track. From then on every update was gated on `enabled` and so
         never ran again, leaving the profile frozen advertising whatever
         was playing at that moment, for the life of the socket. A real
         window, too: with stale discord-ipc sockets around, tryPath walks
         up to thirty candidates and the one that answers can land
         hundreds of milliseconds after the switch was turned off. */
      if (!enabled) { try { s.destroy() } catch { /* already gone */ } return }
      sock = s
      attach(s)
      frame(OP_HANDSHAKE, { v: 1, client_id: APP_ID })
    })
    s.once('error', () => {
      if (settled) return
      settled = true
      s.removeAllListeners()
      try { s.destroy() } catch { /* never opened */ }
      tryPath(i + 1)
    })
  }
  tryPath(0)
}

function attach(s: Socket): void {
  let buf = Buffer.alloc(0)
  s.on('data', chunk => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0)
      const len = buf.readInt32LE(4)
      if (len < 0 || len > 1 << 20) { drop(); scheduleRetry(); return }
      if (buf.length < 8 + len) break
      const body = buf.subarray(8, 8 + len).toString('utf8')
      buf = buf.subarray(8 + len)
      let msg: Record<string, unknown>
      try { msg = JSON.parse(body) } catch { continue }
      handle(op, msg)
    }
  })
  s.on('error', () => { drop(); scheduleRetry() })
  s.on('close', () => { drop(); scheduleRetry() })
}

function handle(op: number, msg: Record<string, unknown>): void {
  if (op === OP_PING) { frame(OP_PONG, msg); return }
  if (op === OP_CLOSE) {
    /* 4000 is "Invalid Client ID" - the one failure that is a bug in this
       build rather than a Discord that is not running, and the one worth
       saying out loud instead of retrying every fifteen seconds forever. */
    const code = Number(msg.code)
    if (code === 4000) {
      dead = true
      console.error('[discord] rejected the application id, presence is off for this session')
    }
    drop()
    scheduleRetry()
    return
  }
  if (op !== OP_FRAME) return

  if (msg.evt === 'READY') {
    ready = true
    pushed = null
    lastSentAt = 0
    push()
    return
  }
  if (msg.evt === 'ERROR') {
    const data = (msg.data ?? {}) as { code?: number; message?: string }
    /* Drop the newest thing we asked for and say it again. Twice at most,
       so a client that refuses for some other reason says so in the log
       instead of looping. */
    if (degrade < 2) {
      degrade++
      pushed = null
      lastSentAt = 0
      push()
      return
    }
    console.error('[discord] refused the activity:', data.code, data.message)
  }
}

/* Discord refuses a string under two characters and cuts one off past 128.
   A one-character title is rare, and losing the whole frame over it is not
   a reasonable trade - the line is left out instead. */
function fit(s: string | undefined | null): string | undefined {
  const v = (s ?? '').replace(/\s+/g, ' ').trim()
  if (v.length < 2) return undefined
  return v.length > 128 ? `${v.slice(0, 127)}…` : v
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

// SoundCloud's default artwork is 100px square, which is a thumbnail of a
// thumbnail at the size Discord draws it.
const bigArt = (url?: string | null) =>
  url ? url.replace(/-large\.(jpg|jpeg|png)(\?.*)?$/i, '-t500x500.$1$2') : undefined

function push(): void {
  if (!ready || !sock) return
  const st = latest
  const t = st?.currentTrack ?? null
  const playing = !!st?.isPlaying
  const progress = Math.max(0, st?.progress || 0)
  /* SoundCloud's figure first, the decoded one only as a fallback. The
     audio element does not know the new track's length until its metadata
     arrives, so for the first second of every track it still reports the
     length of the one before - which is what put a three-minute song on a
     forty-six-second bar and left it there. */
  const duration = Math.max(0, t?.duration ? t.duration / 1000 : (st?.duration || 0))
  const start = Date.now() - Math.round(progress * 1000)
  const end = duration > 1 ? start + Math.round(duration * 1000) : 0

  /* Three things are worth telling Discord about. Everything else is the
     clock it is already running: position moves on its own, and re-sending
     it twenty times a minute would spend the whole rate limit saying
     nothing. A gap of more than two seconds against what Discord was told
     is a seek, which it cannot have guessed. */
  /* The end of the bar is checked as well as its start. A length that
     arrives late, or is corrected afterwards, is a different bar - and
     without this the frame carrying the wrong one was simply the last
     word on it for the rest of the track. */
  const same = t
    ? !!pushed
      && pushed.id === String(t.id)
      && pushed.playing === playing
      && (playing
        ? Math.abs(pushed.start - start) < 2500 && Math.abs(pushed.end - end) < 2500
        /* Paused, the position is written into the text rather than run
           by Discord, so it only changes when we say so - and a seek made
           while paused is the one thing that changes it. */
        : Math.abs(pushed.pos - progress) < 2)
    : pushed === null
  if (same) return

  /* The wait covers the clear as well as the track. Letting an emptied
     player skip the queue was how a stopped track right after a run of
     skips landed a sixth frame inside one twenty-second window. */
  const wait = MIN_GAP_MS - (Date.now() - lastSentAt)
  if (wait > 0) {
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; push() }, wait)
    return
  }

  if (!t) {
    pushed = null
    lastSentAt = Date.now()
    frame(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() })
    return
  }

  /* Paused, Discord still draws a counter of its own on the card. It is
     not ours - we send no timestamps at all while paused, and the client
     counts from the moment the status changed, so it reads 0:00 and
     climbs no matter where the track actually stands. It cannot be
     switched off from here. What can be done is to put the true position
     in a line we do control, so the card is not only telling a lie. */
  const pausedAt = playing ? '' : `Paused ${mmss(progress)}${duration > 1 ? ` / ${mmss(duration)}` : ''}`
  const who = fit(t.user?.username)
  const line = pausedAt ? (who ? `${who} \u00b7 ${pausedAt}` : pausedAt) : who

  const activity: Record<string, unknown> = {
    /* No name sent on purpose. Discord writes the first line as
       "<verb> <name>" and translates the verb for whoever is reading;
       the name it fills in from the registered application. A name set
       from here is kept (checked against a live client), but it would
       not be translated, so folding a Russian preposition into it reads
       wrong on an English client. The application's own name it is. */
    details: fit(t.title) ?? 'SoundCloud',
    state: fit(line),
  }
  // 2 is "Listening to", which is what this is. A client that will not take
  // it falls back to "Playing" and loses nothing else.
  if (degrade < 2) activity.type = 2
  /* A paused track with timestamps is a progress bar that keeps moving
     while nothing plays, so pausing drops them - the two lines stay and the
     bar goes away, which reads correctly as stopped. */
  if (playing && end) {
    activity.timestamps = { start, end }
  } else if (playing) {
    activity.timestamps = { start }
  }
  /* No large_text. Discord prints it as a third line, where Spotify puts
     the album - and the album of a SoundCloud upload is the title again,
     which is how the track name came out twice. */
  const art = degrade < 1 ? bigArt(t.artwork_url) : undefined
  if (art) activity.assets = { large_image: art }
  /* Both to the same place, on purpose: the pair reads as one offer with
     the project's name under it, which is what the card is for. Discord
     takes two at most and refuses the whole frame over a label longer
     than 32 characters, so neither grows. */
  if (degrade < 2) {
    activity.buttons = [
      { label: 'Скачать', url: HOME_URL },
      { label: 'soundcloud-client', url: HOME_URL },
    ]
  }

  pushed = { id: String(t.id), playing, start, end, pos: progress }
  lastSentAt = Date.now()
  frame(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: randomUUID() })
}

/** The latest player state. Cheap to call on every tick; most do nothing. */
export function discordUpdate(state: PresenceState): void {
  latest = state
  if (enabled) push()
}

/** Turn the presence on or off. Off clears what is on the profile first. */
export function discordSetEnabled(on: boolean): void {
  if (on === enabled) return
  enabled = on
  if (on) {
    dead = false
    connect()
    return
  }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (ready && sock) {
    frame(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() })
  }
  drop()
}

/** Quitting. Discord clears the presence when the socket goes anyway, but
 *  only after noticing, and a stale "listening to" on a closed player is
 *  exactly the thing this feature should not do. */
export function discordStop(): void {
  discordSetEnabled(false)
}
