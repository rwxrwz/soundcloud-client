/* The Telegram Mini App's own server: the page, and the socket behind it.
 *
 * ── Why this exists next to bridge.ts rather than inside it ──────────────
 * The companion bridge is bound to 127.0.0.1 and gated by a token written to
 * a 0600 file, which is exactly right for something running on this machine
 * and exactly wrong for something running on a phone. This server is reached
 * through a public tunnel, so it cannot lean on "whoever can open the port is
 * already you". It gates on Telegram's own signature instead: every Mini App
 * launch carries initData signed with the bot token, and the bot token is
 * something only this process and Telegram know.
 *
 * Still bound to 127.0.0.1. The tunnel is what makes it reachable, and the
 * tunnel can be switched off without leaving a listening socket on the
 * network behind it.
 *
 * ── What travels ────────────────────────────────────────────────────────
 * The same snapshot the companion bridge already publishes, plus paged lists
 * fetched from the renderer on demand. Nothing new is modelled here: a Mini
 * App is one more client of a protocol the player already speaks.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { createHmac, timingSafeEqual } from 'crypto'
import { readFile } from 'fs/promises'
import { isAbsolute, join, normalize, relative } from 'path'
import { app } from 'electron'
import type { BridgeState } from './bridge'
import type { ListQuery, ListPage, RemoteCommand } from './remote'

const HOST = '127.0.0.1'
export const MINIAPP_PORT = 48758

/* initData older than this is refused. Telegram signs the launch, not the
   session, so without a limit a captured launch string would work for ever.
   Two hours: longer than anyone sits in a remote control, short enough that
   a copy taken off a device is stale by the time it is useful. An expired
   one is told apart from a forged one below, because "open it again" and
   "this did not come from Telegram" are different things to be told. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000
/** A socket that has not said who it is by then is not going to. */
const HELLO_MS = 5000
/** One phone, a couple of reconnects in flight. Anything past this is noise. */
const MAX_CLIENTS = 8
/* Sockets that have not proved anything yet get a budget of their own.
   Counting both populations together meant a stranger could hold every
   slot by opening sockets and saying nothing - each one costs them
   HELLO_MS and costs the owner their only way in, because the refusal
   happens at the upgrade, before anyone has shown a signature. A caller
   who cannot authenticate can now only ever exhaust this smaller number,
   and never the seats an authenticated phone sits in. */
const MAX_PENDING = 4

interface Deps {
  /** The bot token, or '' when there is none. Read per call: it can change. */
  botToken: () => string
  /** Telegram ids allowed to drive the player - the remote's own white list. */
  isAllowed: (id: number) => boolean
  /* RemoteCommand rather than BridgeCommand: the two overlap almost
     entirely, but only the remote's has playTrackId, and playing a track you
     picked out of your own library is most of what a Mini App is for. */
  onCommand: (cmd: RemoteCommand) => void
  requestList: (q: ListQuery) => Promise<ListPage>
  /* Lyrics for one track. They live in the renderer behind a cache and a
     catalogue lookup, so this is the same shape of round trip as a list:
     ask, wait, answer. */
  requestLyrics: (trackId: number) => Promise<LyricsPayload>
}

export interface LyricsPayload {
  synced: { time: number; text: string }[] | null
  plain: string | null
  /** Transcribed or timed by a model rather than found in a catalogue. */
  ai?: boolean
}

let server: Server | null = null
let wss: WebSocketServer | null = null
let deps: Deps | null = null
let last: BridgeState & { type: 'state' } = {
  type: 'state', playing: false, volume: 1, position: 0, track: null, queue: [], queueIndex: -1,
  shuffle: false, repeat: 'off',
}

/* Who is on the other end of each socket, once it has proved it. A socket
   that is not in here has not authenticated and may only send `hello`. */
const known = new WeakMap<WebSocket, { id: number; name: string }>()
/** Open sockets that have not authenticated yet. Sized, so it can be capped. */
const waiting = new Set<WebSocket>()

/* ── Telegram's signature ──────────────────────────────────────────────── */

export type Verdict =
  | { ok: true; id: number; name: string }
  | { ok: false; why: 'signature' | 'expired' }

const NO: Verdict = { ok: false, why: 'signature' }

/** Who signed this initData, or why it is not acceptable.
 *
 *  Telegram's scheme: everything but `hash`, sorted by key, joined with
 *  newlines, HMAC'd under a key that is itself an HMAC of the bot token.
 *  Getting the two HMACs the right way round is the whole of it. */
export function verifyInitData(initData: string, botToken: string, now = Date.now()): Verdict {
  if (!initData || !botToken) return NO
  let params: URLSearchParams
  try { params = new URLSearchParams(initData) } catch { return NO }

  /* Telegram's hash is a sha256 digest in lower-case hex and nothing else,
     and checking that shape here is what makes the comparison below safe.
     timingSafeEqual throws when its two buffers differ in BYTE length, and
     a string length check cannot see that: 63 ASCII characters plus one
     multi-byte character is 64 characters and 65 bytes, so the guard passed
     and the throw went straight out of the socket handler and killed the
     main process. Unauthenticated, from anyone who knew the address. */
  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return NO
  params.delete('hash')

  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  // Both sides as raw bytes, 32 each: the digest is 32 by definition and the
  // hash was just checked to be 64 hex characters. Nothing here can differ
  // in length any more.
  const mine = createHmac('sha256', secret).update(check).digest()
  if (!timingSafeEqual(mine, Buffer.from(hash, 'hex'))) return NO

  /* Checked only after the signature, so the age of something nobody
     signed is never a reason for an answer. */
  const authDate = Number(params.get('auth_date')) * 1000
  if (!Number.isFinite(authDate)) return NO
  if (now - authDate > MAX_AGE_MS) return { ok: false, why: 'expired' }

  try {
    const u = JSON.parse(params.get('user') ?? 'null') as { id?: number; first_name?: string } | null
    if (!u || typeof u.id !== 'number') return NO
    return { ok: true, id: u.id, name: u.first_name ?? '' }
  } catch { return NO }
}

/* ── The page ──────────────────────────────────────────────────────────── */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
}

/** Built by vite.miniapp.config.ts. Inside the asar on Windows, beside the
 *  app on Linux, in the project during development - getAppPath covers all
 *  three, and Electron's fs reads through an asar as if it were a folder. */
const webRoot = () => join(app.getAppPath(), 'out', 'miniapp')

async function serveFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  /* A stray percent is a bad request, not a crash. decodeURIComponent throws
     URIError on '/%' or '/%ZZ', and this runs above the try below, on a
     server anyone who knows the address can reach without proving anything -
     so the throw escaped into an unanswered socket and an unhandled
     rejection in the main process. */
  let rel: string
  try { rel = decodeURIComponent(url.pathname) }
  catch { res.writeHead(400).end(); return }
  if (rel === '/' || rel === '') rel = '/index.html'

  /* Everything under the root and nothing above it.
     Asked through `relative`, not as a string prefix. A prefix test has no
     notion of a path boundary, so `<app>/out/miniapp-anything/x` satisfied
     startsWith('<app>/out/miniapp') and would have been read and served.
     Nothing sits beside out/miniapp today, which is the only reason this
     was not already a way to read arbitrary files over the tunnel - and
     "no sibling has that name yet" is not a security property. main.ts
     makes the same check the same way. */
  const root = normalize(webRoot())
  const full = normalize(join(root, rel))
  const rel2 = relative(root, full)
  if (rel2 === '' || rel2.startsWith('..') || isAbsolute(rel2)) { res.writeHead(403).end(); return }

  try {
    const body = await readFile(full)
    const dot = full.lastIndexOf('.')
    res.writeHead(200, {
      'content-type': MIME[full.slice(dot).toLowerCase()] ?? 'application/octet-stream',
      // The bundle is content-hashed; index.html must never be.
      'cache-control': rel === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      // Nothing here should ever be framed by anyone but Telegram's webview.
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
}

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return
  try { ws.send(JSON.stringify(msg)) } catch { /* going away */ }
}

export function startMiniApp(d: Deps): void {
  if (server) return
  deps = d

  /* Belt and braces: whatever serveFile fails on, the request gets an
     answer and the rejection never reaches the process. */
  const http = createServer((req, res) => {
    serveFile(req, res).catch((e) => {
      console.error('[miniapp] request failed:', e instanceof Error ? e.message : e)
      try { if (!res.headersSent) res.writeHead(500); res.end() } catch { /* gone */ }
    })
  })
  http.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[miniapp] server error:', err.code ?? err.message)
  })

  const sockets = new WebSocketServer({ noServer: true })
  http.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/ws') { socket.destroy(); return }
    /* Make room by dropping the oldest socket that still has not said who
       it is, rather than turning the newcomer away. Refusing instead would
       hand anyone a way to hold the door shut: the owner's phone has to
       pass through this same queue to reach the signature check, so a
       stranger keeping the queue full would lock them out without ever
       proving anything. Evicting the oldest means a flood only ever
       displaces itself. A Set keeps insertion order, so the first value is
       the one that has been waiting longest. */
    if (waiting.size >= MAX_PENDING) {
      const oldest = waiting.values().next().value
      if (oldest) {
        waiting.delete(oldest)
        try { oldest.close(1008, 'no hello') } catch { try { oldest.terminate() } catch { /* gone */ } }
      }
    }
    // Authenticated seats are a separate budget, and those may be refused.
    if (sockets.clients.size - waiting.size >= MAX_CLIENTS) { socket.destroy(); return }
    /* Only the page we served may open this socket.
     *
     * CORS does not apply to WebSockets, so without this any page in any
     * browser could connect - to the tunnel, or straight to this port on
     * localhost. The signature check below still stops it doing anything,
     * but the local bridge refuses browsers outright and there is no
     * reason this should be the one with a layer missing.
     *
     * Same-origin is the whole rule: the Mini App connects to the host it
     * was served from, whatever today's tunnel address happens to be. A
     * client that sends no Origin at all is not a browser and is left to
     * the signature. */
    const origin = req.headers.origin
    if (origin) {
      let host = ''
      try { host = new URL(origin).host } catch { host = '' }
      if (!host || host !== req.headers.host) {
        console.warn('[miniapp] refused a socket from %s (we are %s)', origin, req.headers.host)
        socket.destroy()
        return
      }
    }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws, req))
  })

  sockets.on('connection', (ws: WebSocket) => {
    // Unhandled socket errors escape the EventEmitter and take main with them.
    ws.on('error', () => { try { ws.terminate() } catch { /* gone */ } })
    waiting.add(ws)

    const timer = setTimeout(() => {
      if (!known.has(ws)) { send(ws, { type: 'denied', reason: 'timeout' }); ws.close(1008, 'no hello') }
    }, HELLO_MS)
    ws.on('close', () => { clearTimeout(timer); waiting.delete(ws) })

    /* Nothing a stranger sends may take the process down. Everything below
       runs before a socket has proved anything, on an address that is public
       by design, so a throw in here is a remote kill switch - and was one:
       see the hash shape check in verifyInitData. The socket is the whole
       blast radius now. */
    ws.on('message', (raw) => {
      try {
        let msg: { type?: string; [k: string]: unknown }
        try { msg = JSON.parse(raw.toString()) } catch { return }
        if (!msg || typeof msg.type !== 'string') return

        if (msg.type === 'hello') {
          if (known.has(ws)) return
          const v = verifyInitData(String(msg.initData ?? ''), deps?.botToken() ?? '')
          if (!v.ok) {
            send(ws, { type: 'denied', reason: v.why })
            ws.close(1008, v.why === 'expired' ? 'stale initData' : 'bad initData')
            return
          }
          /* Signed by the bot is not the same as allowed to drive it: anyone can
             open a bot. The white list the remote already keeps decides. */
          if (!deps?.isAllowed(v.id)) {
            send(ws, { type: 'denied', reason: 'not-allowed', name: v.name })
            ws.close(1008, 'not allowed')
            return
          }
          clearTimeout(timer)
          const who = { id: v.id, name: v.name }
          known.set(ws, who)
          waiting.delete(ws)   // out of the stranger budget, into a real seat
          send(ws, { type: 'welcome', user: who })
          send(ws, last)
          return
        }

        // Everything below is for sockets that have proved who they are.
        if (!known.has(ws)) return

        if (msg.type === 'command' && typeof msg.action === 'string') {
          const v = msg.value
          const value = (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') ? v : undefined
          deps?.onCommand({ action: msg.action as RemoteCommand['action'], value })
          return
        }

        if (msg.type === 'lyrics') {
          const req = msg as unknown as { id: number; trackId: number }
          deps?.requestLyrics(Number(req.trackId))
            .then(got => send(ws, { type: 'lyrics-reply', id: req.id, ...got }))
            .catch(() => send(ws, { type: 'lyrics-reply', id: req.id, synced: null, plain: null }))
          return
        }

        if (msg.type === 'list') {
          const req = msg as unknown as { id: number } & ListQuery
          deps?.requestList({
            kind: req.kind, query: req.query, playlistId: req.playlistId,
            sort: req.sort === 'newest' || req.sort === 'oldest' ? req.sort : undefined,
            offset: Number(req.offset) || 0, limit: Math.min(100, Number(req.limit) || 30),
          })
            .then(page => send(ws, { type: 'list-reply', id: req.id, ...page }))
            .catch(() => send(ws, { type: 'list-reply', id: req.id, items: [], total: 0, failed: true }))
        }
      } catch (e) {
        console.error('[miniapp] dropped a message that threw:', e instanceof Error ? e.message : e)
        try { ws.close(1011, 'bad message') } catch { /* already gone */ }
      }
    })
  })

  /* `server` is claimed only once the port is actually ours. It used to be
     assigned regardless, which poisoned the `if (server) return` guard at
     the top: a second instance of the player - nothing stops one, there is
     no single-instance lock - found the port held, logged the error, kept
     the dead server, and could never retry. Worse, the caller went on to
     raise a tunnel in front of a port this process does not serve, and
     published that address over the first instance's menu button, so every
     tap on the phone drove the other copy. */
  http.once('error', (err: NodeJS.ErrnoException) => {
    console.error('[miniapp] cannot listen on %s:%d: %s', HOST, MINIAPP_PORT, err.code ?? err.message)
    server = null
    wss = null
    try { sockets.close() } catch { /* never opened */ }
  })
  http.listen(MINIAPP_PORT, HOST, () => {
    console.log(`[miniapp] serving on http://${HOST}:${MINIAPP_PORT}`)
  })
  server = http
  wss = sockets
}

export function stopMiniApp(): void {
  if (wss) {
    for (const c of wss.clients) { try { c.terminate() } catch { /* ignore */ } }
    wss.close()
    wss = null
  }
  waiting.clear()
  server?.close()
  server = null
  deps = null
}

/** Push a full snapshot. Cached, so a phone that connects mid-song sees the
 *  song rather than an empty player until the next track change. */
export function miniAppSetState(state: BridgeState): void {
  last = { type: 'state', ...state }
  if (!wss) return
  for (const c of wss.clients) if (known.has(c)) send(c, last)
}

/** The cheap per-second tick. */
export function miniAppProgress(position: number, playing: boolean): void {
  last.position = position
  last.playing = playing
  if (!wss) return
  for (const c of wss.clients) if (known.has(c)) send(c, { type: 'progress', position, playing })
}

