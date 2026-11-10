/* A public HTTPS address for a player that has none.
 *
 * ── Why a tunnel at all ─────────────────────────────────────────────────
 * Telegram opens a Mini App by fetching a public HTTPS URL. The player sits
 * behind NAT - the same fact that made the bot use long polling instead of a
 * webhook - so there is nothing for Telegram to fetch. A tunnel turns that
 * around: cloudflared dials out, Cloudflare hands back an address, and the
 * phone talks to the address.
 *
 * ── Why cloudflared and not a server of ours ────────────────────────────
 * A relay would mean every person's library and every tap travelling through
 * a machine somebody else runs. A quick tunnel keeps the player the only
 * thing that ever sees any of it. The price is honest and worth naming: the
 * address is different on every launch, Cloudflare promises these tunnels
 * nothing, and anyone who learns the address can reach the page. The last
 * one is why miniapp.ts checks Telegram's signature rather than trusting
 * whoever knocks.
 *
 * ── Why it is downloaded and not shipped ────────────────────────────────
 * 35MB of someone else's binary in every build, for a feature most people
 * will not switch on. The aligner model is already fetched on demand for the
 * same reason; this follows it, into the same user-data directory, well away
 * from the repository and the bundle.
 */

import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { app } from 'electron'

export type TunnelState = 'off' | 'fetching' | 'starting' | 'up' | 'failed'

const RELEASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download'
/* Anything smaller than this is an error page or a truncated download, not a
   binary. cloudflared is tens of megabytes on every platform it ships for. */
const MIN_BYTES = 8 * 1024 * 1024
/** Cloudflare prints the address once, in a box, on stderr. */
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
/** A tunnel that dies is restarted, but not in a tight loop. */
const BACKOFF_MS = [2000, 5000, 15000, 30000, 60000]
/* cloudflared's own "the tunnel is live at the edge" line.
 *
 * ── Why this and not a request to the address ───────────────────────────
 * The obvious check - fetch the new address until it answers - cannot
 * work here, and measuring showed why. cloudflared prints the hostname
 * about two seconds before Cloudflare publishes it ("it may take some
 * time to be reachable", in its own words), so the first lookup returns
 * NXDOMAIN. The negative-cache TTL on trycloudflare.com is 60 seconds, so
 * that one early miss is remembered by the local resolver for a minute,
 * and every later attempt is answered from the cache rather than the
 * network. The probe reliably produced the failure it was looking for.
 *
 * Measured on a fresh tunnel: address at 5s, this line at 7s, and the
 * name live on public DNS at 7s - while the local resolver, poisoned by
 * one lookup at 5s, never answered inside the whole window. The log line
 * lands exactly when the name does and costs no lookup at all. */
const REGISTERED_RE = /Registered tunnel connection/i
/* Announce anyway if that line never comes. It is cloudflared's wording,
 * not a contract, and a future version renaming it must not take the
 * feature down with it. */
const REGISTER_GRACE_MS = 20000

const dir = () => {
  const d = join(app.getPath('userData'), 'tunnel')
  try { mkdirSync(d, { recursive: true }) } catch { /* ignore */ }
  return d
}
const binFile = () => join(dir(), process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
/** The digest of the bytes we wrote, recorded beside them. */
const hashFile = () => binFile() + '.sha256'

/* Where a download may legitimately take us. `redirect: 'follow'` accepts
   wherever it is sent, including off HTTPS and off GitHub, which is more
   trust than a file about to be marked executable has any need for. */
/* One budget for the whole request, body included - AbortSignal.timeout
   does not stop at the headers, so anything shorter would cut off an
   honest slow download of a 35MB binary rather than a stalled one. A
   redirect hop finishes in milliseconds regardless; this number only ever
   matters when something is wrong. */
const HOP_TIMEOUT_MS = 15 * 60_000

const RELEASE_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

async function fetchFromRelease(url: string): Promise<Response> {
  let at = url
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(at)
    if (u.protocol !== 'https:' || !RELEASE_HOSTS.has(u.host)) {
      throw new Error(`refusing a hop to ${u.protocol}//${u.host}`)
    }
    const res = await fetch(at, { redirect: 'manual', signal: AbortSignal.timeout(HOP_TIMEOUT_MS) })
    if (res.status < 300 || res.status >= 400) return res
    const loc = res.headers.get('location')
    if (!loc) throw new Error(`redirect ${res.status} with no location`)
    at = new URL(loc, at).toString()
  }
  throw new Error('too many redirects')
}

/* Tamper-evidence, not provenance. The first download is exactly as
   trustworthy as TLS to github.com - the same trust the update check already
   runs on, and cloudflared publishes no stable per-asset checksum to pin
   against. What this adds is that the bytes cannot change afterwards without
   being noticed: anything able to write this directory - same-user malware, a
   restored or synced home, a shared machine - would otherwise be handed a
   spawned process every time the Mini App is switched on, and `tunnelReady`
   only ever looked at the size. */
let checked: { size: number; mtime: number } | null = null

function binaryIntact(): boolean {
  let st
  try { st = statSync(binFile()) } catch { return false }
  if (checked && checked.size === st.size && checked.mtime === st.mtimeMs) return true

  let want = ''
  try { want = readFileSync(hashFile(), 'utf8').trim() } catch { /* nothing recorded */ }
  const got = createHash('sha256').update(readFileSync(binFile())).digest('hex')

  if (!want) {
    /* Fetched by a build that recorded nothing. Adopt what is on disk rather
       than refuse an install that is almost certainly fine; it is pinned from
       here on. */
    try { writeFileSync(hashFile(), got) } catch { /* best effort */ }
  } else if (got !== want) {
    console.error('[tunnel] cloudflared does not match the digest recorded when it was downloaded; discarding it')
    try { unlinkSync(binFile()) } catch { /* ignore */ }
    try { unlinkSync(hashFile()) } catch { /* ignore */ }
    checked = null
    return false
  }
  checked = { size: st.size, mtime: st.mtimeMs }
  return true
}

function assetName(): string | null {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null
  if (!arch) return null
  if (process.platform === 'win32') return `cloudflared-windows-${arch}.exe`
  if (process.platform === 'linux') return `cloudflared-linux-${arch}`
  // macOS ships a tarball, which would need unpacking. Not built for yet.
  return null
}

export function tunnelReady(): boolean {
  try { return statSync(binFile()).size >= MIN_BYTES } catch { return false }
}

export function tunnelInfo(): { have: boolean; bytes: number; dir: string } {
  let bytes = 0
  try { bytes = statSync(binFile()).size } catch { /* not here yet */ }
  return { have: tunnelReady(), bytes, dir: dir() }
}

/** Fetch cloudflared if it is not already here. Resolves true when usable. */
export async function fetchTunnelBinary(onProgress: (done: number, total: number) => void): Promise<boolean> {
  if (tunnelReady()) return true
  const asset = assetName()
  if (!asset) { console.error('[tunnel] no cloudflared build for', process.platform, process.arch); return false }

  // Into a temporary name, moved into place only once it is whole - a half
  // written binary that happens to be executable is the worst outcome here.
  const tmp = binFile() + '.part'
  try {
    const res = await fetchFromRelease(`${RELEASE}/${asset}`)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    let done = 0
    let said = 0
    // Hashed as it streams past, so the digest is of the bytes actually written.
    const digest = createHash('sha256')
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    body.on('data', (c: Buffer) => {
      digest.update(c)
      done += c.length
      if (total && done - said > total / 100) { said = done; onProgress(done, total) }
    })
    await pipeline(body, createWriteStream(tmp))
    if (statSync(tmp).size < MIN_BYTES) throw new Error('truncated')
    if (process.platform !== 'win32') chmodSync(tmp, 0o755)
    renameSync(tmp, binFile())
    writeFileSync(hashFile(), digest.digest('hex'))
    checked = null              // re-read it on the next launch
    onProgress(1, 1)
    return true
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* never created */ }
    console.error('[tunnel] download failed:', e instanceof Error ? e.message : e)
    return false
  }
}

/* ── the tunnel itself ─────────────────────────────────────────────────── */

let child: ChildProcess | null = null
let restart: NodeJS.Timeout | null = null
let attempt = 0
let wanted = false
let current: string | null = null
let report: ((s: TunnelState, url: string | null) => void) | null = null

function say(s: TunnelState, url: string | null): void {
  current = url
  report?.(s, url)
}



function launch(port: number): void {
  if (!wanted || child) return
  if (!tunnelReady()) { say('failed', null); return }
  // Never spawn a binary that is not the one we downloaded.
  if (!binaryIntact()) { say('failed', null); return }

  say('starting', null)
  /* --no-autoupdate because an update would replace the binary under a
     running process, and we are the ones who decide when it is fetched. */
  /* spawn throws here, synchronously, when the file is not a valid
     executable for this machine - a truncated or swapped cloudflared, the
     wrong architecture. It does not emit 'error' in that case, it raises.
     Uncaught it left startTunnel, and from the restart timer below there is
     nothing above it to catch it at all: it would have taken the main
     process down. Measured, not guessed - a 9MB file of filler reproduces
     it as ENOEXEC. */
  let p: ChildProcess
  try {
    p = spawn(binFile(), [
      'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  } catch (e) {
    console.error('[tunnel] cannot run cloudflared:', e instanceof Error ? e.message : e)
    say('failed', null)
    return
  }
  child = p

  let addr: string | null = null
  let announced = false
  let grace: NodeJS.Timeout | null = null

  const announce = (why: string) => {
    if (announced || !addr || !wanted || child !== p) return
    announced = true
    if (grace) { clearTimeout(grace); grace = null }
    attempt = 0
    console.log('[tunnel] up at %s (%s)', addr, why)
    say('up', addr)
  }

  const watch = (buf: Buffer) => {
    if (announced) return
    const text = buf.toString()
    if (!addr) {
      const m = URL_RE.exec(text)
      if (m) { addr = m[0]; grace = setTimeout(() => announce('no registration line'), REGISTER_GRACE_MS) }
    }
    if (addr && REGISTERED_RE.test(text)) announce('registered')
  }
  // The address comes on stderr, but cloudflared has moved it before now and
  // watching both costs nothing.
  p.stdout?.on('data', watch)
  p.stderr?.on('data', watch)

  p.on('error', (e) => {
    /* A process that never started emits 'error' and 'close' but never
       'exit' - and 'exit' below is the only place that clears `child`. So
       this used to latch: `child` kept pointing at the dead process, the
       guard at the top of launch() turned every later attempt away, and the
       tunnel sat on 'starting' for the rest of the session with no retry
       and nothing reporting failed. */
    console.error('[tunnel] spawn failed:', e.message)
    if (child !== p) return
    child = null
    if (grace) { clearTimeout(grace); grace = null }
    if (!wanted) { say('off', null); return }
    const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]
    say('starting', null)
    restart = setTimeout(() => { restart = null; launch(port) }, wait)
  })
  p.on('exit', (code) => {
    /* Only the process that is currently ours may act on its own death.
       Without this, one that was already replaced still cleared `child` on
       the way out - wiping the reference to the live replacement - and then
       scheduled a restart that spawned another on top of it. Two tunnels on
       one port, two addresses, and the player knowing only the first. */
    if (child !== p) return
    child = null
    if (grace) { clearTimeout(grace); grace = null }
    if (!wanted) { say('off', null); return }
    /* A quick tunnel has no promises attached to it and does drop. Coming
       back with a new address is the normal case, not an error - which is
       why the caller is told the address every time rather than once. */
    console.warn('[tunnel] exited (%s), reconnecting', code)
    const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]
    say('starting', null)
    restart = setTimeout(() => { restart = null; launch(port) }, wait)
  })
}

/** Bring a tunnel up in front of `port`. `onChange` is called on every state
 *  change, and with a fresh address each time one is handed out. */
export function startTunnel(port: number, onChange: (s: TunnelState, url: string | null) => void): void {
  report = onChange
  wanted = true
  attempt = 0
  launch(port)
}

export function stopTunnel(): void {
  wanted = false
  if (restart) { clearTimeout(restart); restart = null }
  const p = child
  child = null
  if (p) { try { p.kill() } catch { /* already gone */ } }
  say('off', null)
}

