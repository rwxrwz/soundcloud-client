/* The browser half of reading a Genius page.
 *
 * genius.com sits behind Cloudflare and answers a plain HTTP client with
 * a challenge - `403` and `cf-mitigated: challenge` - and that is now its
 * steady state, not a temporary penalty: it still does so a day later,
 * with no traffic from us in between. A challenge cannot be answered by a
 * fetch at all. It is a question for a person, and passing it needs a
 * browser running the page's JavaScript.
 *
 * So a person answers it. Once. The window that opens is a real window
 * showing the real page; whoever is sitting there clicks the checkbox the
 * same way they would in Firefox, Cloudflare writes its `cf_clearance`
 * cookie into this session, and the page requests that follow carry it.
 *
 * Nothing here pretends to be anything. No fingerprint is forged, no
 * challenge is solved by machine, no captcha service is involved. The
 * requests after the clearance go out from the very session that earned
 * it, which is why they are accepted - the cookie is bound to the IP and
 * the user agent that passed, so it could not work any other way.
 *
 * The one thing given up: these requests carry Electron's own Chromium
 * user agent rather than the player's honest one. That is still true -
 * this is Chromium - but it no longer announces itself, and the cookie
 * is void under any other name.
 */

import { BrowserWindow, session, type Session } from 'electron'

const PARTITION = 'persist:genius'
/* Long enough to cover a coffee, short enough that a window nobody is
   looking at does not sit there for the rest of the session. Ten minutes
   rather than three: the check is asked for at the start of a scan, and
   somebody who presses Scan and turns to something else should still
   find the window when they look back rather than a run that gave up. */
const SOLVE_TIMEOUT_MS = 10 * 60 * 1000

let ses: Session | null = null

/** The session Genius pages are read in. Persisted, so a clearance
 *  survives a restart and most people pass the check once a day at most. */
export function geniusSession(): Session {
  if (!ses) ses = session.fromPartition(PARTITION)
  return ses
}

/** Whether this session currently holds a clearance. */
export async function hasClearance(): Promise<boolean> {
  try {
    const all = await geniusSession().cookies.get({ name: 'cf_clearance' })
    return all.some(c => c.domain?.includes('genius.com'))
  } catch { return false }
}

/** Make sure there is a clearance before a long run starts.
 *
 *  Called when a scan is about to begin, which is the one moment the
 *  person is certainly present - they just pressed the button. Taking
 *  the check now means the run goes through uninterrupted, instead of
 *  stopping half an hour in to ask somebody who has walked away.
 *
 *  Returns false when the check was shown and not passed. */
export async function ensureClearance(): Promise<boolean> {
  if (await hasClearance()) return true
  return await solveChallenge('https://genius.com/')
}

/** A page request from that session, carrying whatever it has earned. */
export function fetchInSession(url: string, timeoutMs: number): Promise<Response> {
  /* Session.fetch, not net.fetch: the request is issued *by* the session,
     so it carries that session's cookies and its user agent without being
     told to. Which is the whole point - a clearance is bound to both. */
  return geniusSession().fetch(url, { signal: AbortSignal.timeout(timeoutMs) }) as unknown as Promise<Response>
}

/* One window at a time. Twenty tracks in a scan all meet the challenge at
   once; opening twenty windows, or asking twenty times, would be the
   worst possible version of this. Everyone waits on the first. */
let solving: Promise<boolean> | null = null

/** Show the page and let the person through the check.
 *
 *  Resolves true once a clearance exists. Closes itself the moment the
 *  cookie appears - there is nothing to confirm and no button to press,
 *  so the whole interaction is the one click Cloudflare asked for. */
export function solveChallenge(url: string, onOpen?: () => void): Promise<boolean> {
  if (solving) return solving
  solving = run(url, onOpen).finally(() => { solving = null })
  return solving
}

function run(url: string, onOpen?: () => void): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const win = new BrowserWindow({
      width: 520,
      height: 680,
      title: 'Genius',
      autoHideMenuBar: true,
      backgroundColor: '#15161c',
      webPreferences: {
        partition: PARTITION,
        // No preload and no node: this is somebody else's page.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearInterval(poll)
      clearTimeout(bail)
      try { if (!win.isDestroyed()) win.destroy() } catch { /* already gone */ }
      resolve(ok)
    }

    /* Polled rather than driven by the cookies 'changed' event: the event
       fires for every cookie the page sets, and the one that matters can
       arrive before the navigation that follows it settles. Twice a
       second costs nothing and closes the window the moment it is done. */
    const poll = setInterval(() => { void hasClearance().then(ok => { if (ok) finish(true) }) }, 500)
    const bail = setTimeout(() => finish(false), SOLVE_TIMEOUT_MS)

    // Closed by hand: the person declined, and that is an answer.
    win.on('closed', () => finish(false))

    win.loadURL(url).catch(() => finish(false))
    win.once('ready-to-show', () => { try { win.show() } catch { /* closed already */ } })
    onOpen?.()
  })
}
