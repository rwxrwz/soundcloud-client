import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen, safeStorage, protocol, dialog } from 'electron'
import { basename, join, relative, isAbsolute } from 'path'
import { appendFileSync, writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, statSync, createWriteStream } from 'fs'
import type { WriteStream } from 'fs'
import { spawn } from 'child_process'
import { startBridge, stopBridge, bridgeSetState, bridgeProgress, bridgeAudio, bridgeSpectrum, bridgeHasClients, type BridgeState } from './bridge'
import { initRemote, remoteConfigure, stopRemote, remoteApprove, remoteRevoke, remoteGetStatus,
         remoteSetMiniApp,
         type RemoteConfig, type RemoteStatus, type RemoteCommand, type ListQuery, type ListPage, type ListItem } from './remote'
import { startMiniApp, stopMiniApp, miniAppSetState, miniAppProgress, MINIAPP_PORT, type LyricsPayload } from './miniapp'
import { startTunnel, stopTunnel, tunnelReady, tunnelInfo, fetchTunnelBinary, type TunnelState } from './tunnel'
// Type-only import: erased at build time so it never becomes a top-level require.
// mpris-service (and its call-bind/dunder-proto dep cluster) is Linux-only and is
// require()'d lazily inside setupMpris() under a platform guard - otherwise the
// Windows bundle would require it on launch and die on the missing top-level
// `call-bind-apply-helpers` (the afterPack fix only patches the Linux bundle).
import type Mpris from 'mpris-service'
import { transcribe, readCached, writeCached, DEFAULT_MODEL, type AiLyrics } from './aiLyrics'
import { clearMiss, forgetArtists, geniusByUrl, geniusPage, type GeniusResult, geniusSearch, setLibraryArtists, tokenUsable } from './geniusFetch'
import { ensureClearance } from './geniusSession'
import { discordSetEnabled, discordStop, discordUpdate, type PresenceState } from './discord'
import { alignLocal, alignReady, cancelFetch, fetchModel, lyricsHash, modelInfo, removeModel } from './forcedAlign'
/** Cache slot for locally aligned lyrics; also the label the badge shows. */
export const LOCAL_SLOT = 'local-align'

/* Packaged, __dirname is resources/app/out/main, and buildResources is
   not copied into the artifact - only out/** and the tray PNG are - so
   this resolved to nothing in every release and the window silently fell
   back to the default icon. The tray below already has this branch. */
const ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon_rounded.ico')
  : join(__dirname, '../../buildResources/icon_rounded.ico')

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let closeToTray = true   // when false, closing the window quits the app
let datadomeBypass = false // when true, auto-solve DataDome captcha on a 403 write
let launchedTransparent = false // whether the main window was created transparent
let lastPlayerState: unknown = null
// Hidden SC-context window - kept alive after auth so DataDome cookies stay valid
let scProxy: BrowserWindow | null = null
// Linux MPRIS now-playing/controls source (null on other platforms)
let mprisPlayer: ReturnType<typeof Mpris> | null = null
// Last position (seconds) reported to MPRIS - used to spot jumps worth announcing
let mprisLastPos = 0
// In-flight DataDome captcha solve (shared across concurrent writes)
let captchaPromise: Promise<void> | null = null

// Keep the renderer running at full speed when the window is minimized/in tray.
// Chromium otherwise clamps background timers to 1/sec and deprioritizes hidden
// renderers, which stalls the ~30/sec audio-level emission that drives the
// companion overlay's beat glow while music plays in the background. Must be set
// before app is ready.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

// Linux: disable Chromium's built-in MediaSession so only our clean `soundcloud`
// MPRIS source is published. Otherwise Electron also exposes a parasite
// `chromium.instance*` source (title just "SoundCloud") that media widgets latch
// onto instead. Baked in here so the launcher no longer needs the manual
// --disable-features flag. No-op on Windows/macOS.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-features', 'MediaSessionService')
}

// Linux: present a plain Chrome User-Agent to SoundCloud instead of the default
// Electron one (which carries `Electron/…` and the app-name token). On a cold
// profile without a trusted DataDome cookie those tokens push the bot score over
// the captcha threshold; a stock Chrome UA lets DataDome hand out a cookie
// silently. Windows keeps its default UA (its warm profile already passes).
if (process.platform === 'linux') {
  app.userAgentFallback =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
}

// Custom scheme for serving local video wallpapers while webSecurity is on
// (a file:// page/origin can't load arbitrary file:// resources). Must be
// registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'scwall', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])

// Accept IPC only from our own renderer windows (file:// in prod, dev URL in dev).
function isTrustedSender(e: Electron.IpcMainInvokeEvent): boolean {
  const u = e.senderFrame?.url ?? ''
  return u.startsWith('file://') || (!!process.env.ELECTRON_RENDERER_URL && u.startsWith(process.env.ELECTRON_RENDERER_URL))
}

// Only ever attach the OAuth token / SC session cookies to genuine SoundCloud hosts.
/* The extensions a download may land under. An allowlist rather than a
   sanitiser: the renderer picks the container, and "whatever it asked for"
   is how `.desktop` would have got written into ~/.config/autostart. */
const DL_EXTS = new Set(['mp3', 'm4a', 'opus', 'ogg', 'wav', 'flac', 'aac', 'jpg', 'jpeg', 'png'])

/* A download destination inside the downloads folder, whatever was asked
   for.

   The renderer is sandboxed on purpose - no node, context isolated - and
   the point of that is that a compromised window cannot touch the disk.
   This handler was handing it back a write primitive: the name went
   straight into join() and the extension was interpolated, so
   "../../autostart/x" with "desktop" escaped the folder and chose its own
   file type. The scwall:// handler in this same file already does the
   containment check below; this is the same check. */
function downloadDest(filename: string, ext: string): string {
  const base = downloadsDir()
  const safeExt = DL_EXTS.has(String(ext || '').toLowerCase()) ? String(ext).toLowerCase() : 'mp3'
  // basename() first, so a path is reduced to its last segment, then the
  // separators and dots that could still climb are flattened.
  const name = basename(String(filename ?? '')).replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim()
  const dest = join(base, `${name || 'track'}.${safeExt}`)
  const rel = relative(base, dest)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('bad download path')
  return dest
}

function assertScUrl(raw: string): void {
  const u = new URL(raw)
  if (u.protocol !== 'https:' || !/(^|\.)soundcloud\.com$/.test(u.hostname)) {
    throw new Error('blocked non-SoundCloud host')
  }
}

function createMainWindow(): void {
  // Transparent "liquid glass" theme: the window must be created transparent (it
  // can't be toggled later), so we read a persisted flag file written by the
  // renderer. On Win11 acrylic gives the frosted look; on Linux the compositor blurs.
  launchedTransparent = existsSync(transparentFlagFile())
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    icon: ICON_PATH,
    minHeight: 600,
    backgroundColor: launchedTransparent ? '#00000000' : '#0d0d0d',
    transparent: launchedTransparent,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Keep rAF alive when the window is minimized/in tray, otherwise the ~30/sec
      // audio-level emission (a requestAnimationFrame loop in useBridge) freezes and
      // the companion overlay never receives beat data while music plays in the
      // background. progress survives without this only because it's a 1/sec setInterval.
      backgroundThrottling: false
    }
  })

  // With webSecurity on, the renderer's cross-origin reads (api-v2 with an
  // Authorization header → preflight) and media (Web Audio) need permissive CORS.
  // Apply this ONLY to requests from the main window - never to the scProxy window,
  // whose like/playlist writes use credentials:'include' and rely on api-v2's own
  // origin-specific CORS (which '*' would break).
  /* The window's console, in the terminal that started the app.
   *
   * Playback failures are reported from the renderer, and until now the
   * only way to read them was to have devtools open at the moment one
   * happened - which, for something intermittent, means never. Warnings
   * and errors only, so this stays a signal rather than a transcript. */
  mainWindow.webContents.on('console-message', (...args: unknown[]) => {
    // Electron 32 passes (event, level, message, line, source); later
    // versions pass one object. Read both rather than pin to a shape.
    const first = args[0] as { level?: string | number; message?: string } | undefined
    const asObject = first && typeof first === 'object' && 'message' in first
    const level = asObject ? first.level : (args[1] as number)
    const message = asObject ? first.message : (args[2] as string)
    const bad = asObject ? level === 'warning' || level === 'error' : level === 2 || level === 3
    if (bad && message) console.log('[renderer] %s', message)
  })

  const mainWcId = mainWindow.webContents.id
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ['*://*.sndcdn.com/*', '*://*.soundcloud.com/*', '*://lrclib.net/*', '*://genius.com/*'] },
    (details, callback) => {
      if (details.webContentsId !== mainWcId) { callback({}); return }
      const headers = details.responseHeaders || {}
      // Replace any existing CORS headers (any casing) to avoid "*, *" duplicates.
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase().startsWith('access-control-allow-')) delete headers[key]
      }
      headers['Access-Control-Allow-Origin'] = ['*']
      headers['Access-Control-Allow-Headers'] = ['*']
      headers['Access-Control-Allow-Methods'] = ['*']
      callback({ responseHeaders: headers })
    }
  )

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../../out/renderer/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand off real web links to the OS browser - never file:, etc.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Defense-in-depth (webSecurity is off): never let the shell window navigate
  // away from the bundled app. External links go through the handler above.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const isLocal = url.startsWith('file://') || (!!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))
    if (!isLocal) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    }
  })

  // Minimize behaves normally (to taskbar). Only close hides to tray.

  // Hide to tray on close (unless actually quitting or the user opted out)
  mainWindow.on('close', (e: Electron.Event) => {
    if (!isQuitting && closeToTray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

// Performance option: a non-transparent mini-player is much cheaper to composite.
// Applies the next time the window is opened.
let miniOpaque = false

function createMiniWindow(): void {
  if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.show(); miniWindow.focus(); return }

  const { workArea } = screen.getPrimaryDisplay()
  const W = 380, H = 108
  const margin = 12
  const x = workArea.x + workArea.width  - W - margin
  const y = workArea.y + workArea.height - H - margin

  miniWindow = new BrowserWindow({
    width: W,
    height: H,
    x, y,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: !miniOpaque,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Mini window only renders IPC-fed state + artwork images - no cross-origin
      // fetches - so web security can stay on here.
      webSecurity: true
    }
  })
  // Keep the mini-player pinned above everything - including fullscreen apps -
  // and present on every virtual desktop.
  miniWindow.setAlwaysOnTop(true, 'screen-saver')
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const url = process.env.ELECTRON_RENDERER_URL
    ? `${process.env.ELECTRON_RENDERER_URL}#mini`
    : `file://${join(__dirname, '../../out/renderer/index.html')}#mini`
  miniWindow.loadURL(url)
  miniWindow.webContents.once('did-finish-load', () => {
    if (lastPlayerState) miniWindow?.webContents.send('player-state', lastPlayerState)
    miniWindow?.show()
  })
  miniWindow.on('closed', () => { miniWindow = null })
}

function createTray(): void {
  const trayIconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray_clean.png')
    : join(__dirname, '../../buildResources/tray_clean.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  tray = new Tray(trayIcon)
  tray.setToolTip('SoundCloud')

  const toggleMini = () => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.isVisible() ? miniWindow.hide() : miniWindow.show()
    } else {
      createMiniWindow()
    }
  }

  const buildMenu = () => Menu.buildFromTemplate([
    { label: 'Открыть приложение', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: 'Мини-плеер', click: toggleMini },
    { type: 'separator' },
    { label: 'Закрыть', click: () => { isQuitting = true; app.quit() } },
  ])

  // Linux tray icons go through libappindicator/StatusNotifierItem, which does NOT
  // emit 'click'/'right-click' and ignores popUpContextMenu - the only reliable
  // interaction is a menu attached via setContextMenu (the tray host, e.g. Quickshell,
  // pops it on click). Without this the tray is dead on Linux and the app can't be
  // opened or quit from it. On Windows/macOS keep the original click/right-click UX.
  if (process.platform === 'linux') {
    tray.setContextMenu(buildMenu())
  } else {
    tray.on('click', toggleMini)
    tray.on('right-click', () => { tray?.popUpContextMenu(buildMenu()) })
  }
}

// ── MPRIS (Linux media controls / now-playing) ──────────────────────────────
// Thin adapter over the existing player-state broadcast + player-command channel:
// metadata is pulled from the same `player-state-update` payload that feeds the
// mini window, and control events are forwarded to the main renderer via the same
// `player-command` channel the mini player uses. Publishes one clean
// `org.mpris.MediaPlayer2.soundcloud` source. Linux-only; no-ops elsewhere.
interface MprisState {
  currentTrack: { id: number | string; title: string; artwork_url?: string | null; user?: { username?: string } } | null
  isPlaying: boolean
  volume: number
  progress: number
  duration: number
}

function sendPlayerCommand(type: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-command', { type, payload })
  }
}

// MPRIS track ids are D-Bus object paths, so the SoundCloud id has to be sanitised.
// Built in one place because SetPosition hands the id back and we compare it.
function mprisTrackPath(id: number | string): string {
  if (!mprisPlayer) return ''
  return mprisPlayer.objectPath('track/' + (String(id).replace(/[^A-Za-z0-9_]/g, '_') || '0'))
}

// Clamp inside the track, ask the renderer to seek, and raise Seeked right away:
// MPRIS clients don't poll Position, they read it once and run their own clock, so
// without the signal they keep counting from the old spot.
function applyMprisSeek(seconds: number): void {
  const st = lastPlayerState as MprisState | null
  const dur = st?.duration || 0
  const target = Math.max(0, dur > 0 ? Math.min(seconds, dur) : seconds)
  sendPlayerCommand('seek', target)
  mprisLastPos = target
  try { mprisPlayer?.seeked(Math.round(target * 1e6)) } catch { /* client went away */ }
}

function setupMpris(): void {
  if (process.platform !== 'linux' || mprisPlayer) return
  try {
    // Lazy require (Linux-only path): keeps mpris-service out of the Windows runtime.
    const MprisCtor = require('mpris-service') as typeof Mpris
    mprisPlayer = MprisCtor({
      name: 'soundcloud',
      identity: 'SoundCloud',
      supportedInterfaces: ['player'],
    })
    mprisPlayer.canControl = true
    mprisPlayer.canPlay = true
    mprisPlayer.canPause = true
    mprisPlayer.canGoNext = true
    mprisPlayer.canGoPrevious = true

    // Map MPRIS control events onto the renderer's player-command actions.
    mprisPlayer.on('play', () => sendPlayerCommand('play-pause', true))
    mprisPlayer.on('pause', () => sendPlayerCommand('play-pause', false))
    mprisPlayer.on('stop', () => sendPlayerCommand('play-pause', false))
    mprisPlayer.on('playpause', () => {
      const st = lastPlayerState as MprisState | null
      sendPlayerCommand('play-pause', !st?.isPlaying)
    })
    mprisPlayer.on('next', () => sendPlayerCommand('next'))
    mprisPlayer.on('previous', () => sendPlayerCommand('prev'))
    mprisPlayer.on('volume', (v: unknown) => {
      const vol = Math.max(0, Math.min(1, Number(v)))
      if (!Number.isNaN(vol)) sendPlayerCommand('volume', vol)
    })

    // Position is exposed through getPosition(); the library's default returns 0,
    // which is why every widget showed 00:00 no matter where the track really was.
    // progress in the player state is SECONDS, MPRIS wants microseconds.
    mprisPlayer.canSeek = true
    mprisPlayer.getPosition = () => {
      const st = lastPlayerState as MprisState | null
      return Math.max(0, Math.round((st?.progress ?? 0) * 1e6))
    }

    // Seek(offset): relative, microseconds, may be negative.
    mprisPlayer.on('seek', (offset: unknown) => {
      const st = lastPlayerState as MprisState | null
      if (!st?.currentTrack) return
      const delta = Number(offset) / 1e6
      if (Number.isNaN(delta)) return
      applyMprisSeek((st.progress || 0) + delta)
    })

    // SetPosition(trackId, position): absolute, microseconds. Per spec the request
    // is ignored when the id isn't the track playing right now - otherwise a stale
    // click from a widget would seek whatever started in the meantime.
    mprisPlayer.on('position', (ev: unknown) => {
      const e = ev as { trackId?: string; position?: number } | null
      const st = lastPlayerState as MprisState | null
      if (!e || !st?.currentTrack) return
      if (e.trackId && e.trackId !== mprisTrackPath(st.currentTrack.id)) return
      const pos = Number(e.position) / 1e6
      if (Number.isNaN(pos)) return
      applyMprisSeek(pos)
    })
  } catch (e) {
    console.error('[mpris] setup failed:', e)
    mprisPlayer = null
  }
}

function updateMpris(state: MprisState): void {
  if (!mprisPlayer) return
  try {
    const t = state.currentTrack
    mprisPlayer.playbackStatus = t ? (state.isPlaying ? 'Playing' : 'Paused') : 'Stopped'
    if (typeof state.volume === 'number') mprisPlayer.volume = state.volume

    // A jump that the client didn't ask for (seek inside the app, track change)
    // has to be announced, or clients keep running their clock from the old spot.
    const pos = state.progress || 0
    if (Math.abs(pos - mprisLastPos) > 1.5) {
      try { mprisPlayer.seeked(Math.max(0, Math.round(pos * 1e6))) } catch { /* no clients */ }
    }
    mprisLastPos = pos

    if (t) {
      // progress/duration in the store are SECONDS; MPRIS wants microseconds.
      mprisPlayer.metadata = {
        'mpris:trackid': mprisTrackPath(t.id),
        'mpris:length': Math.max(0, Math.round((state.duration || 0) * 1e6)),
        'mpris:artUrl': t.artwork_url ? t.artwork_url.replace(/-large\./, '-t200x200.') : '',
        'xesam:title': t.title || '',
        'xesam:artist': [t.user?.username || ''],
      }
    }
  } catch (e) {
    console.error('[mpris] update failed:', e)
  }
}

// Get client_id silently by loading soundcloud.com in a hidden window
ipcMain.handle('sc-get-client-id', (event) => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  return new Promise<string>((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })
    let found = false
    win.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['*://api-v2.soundcloud.com/*', '*://api.soundcloud.com/*'] },
      (details, callback) => {
        if (!found) {
          const m = details.url.match(/client_id=([a-zA-Z0-9_-]+)/)
          if (m) {
            found = true
            win.close()
            resolve(m[1])
          }
        }
        callback({ requestHeaders: details.requestHeaders })
      }
    )
    win.loadURL('https://soundcloud.com')
    setTimeout(() => {
      if (!found) { win.close(); reject(new Error('Could not extract client_id from soundcloud.com')) }
    }, 20000)
  })
})

// Proxy write requests through main process so SC session cookies are included
// Ensure a hidden window loaded on soundcloud.com is available.
// DataDome requires requests to originate from an actual SC browser context.
async function ensureScProxy(): Promise<BrowserWindow> {
  if (scProxy && !scProxy.isDestroyed()) return scProxy
  scProxy = new BrowserWindow({
    show: false,
    // contextIsolation can stay on: write/get requests run via executeJavaScript
    // in the page's main world, which is unaffected by isolation.
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  await scProxy.loadURL('https://soundcloud.com')
  scProxy.on('closed', () => { scProxy = null })
  return scProxy
}

// Pull the DataDome captcha page URL out of a failed sc-write error message
// (the 403 body looks like {"url":"https://geo.captcha-delivery.com/captcha/…"}).
/* The captcha URL, parsed rather than pattern-matched.
 *
 * The old regex let `[^\s"'\\]*` span a host and a path, so
 * "https://evil.example/?x=captcha-delivery.com/captcha/" matched and
 * `evil.example` went into the src of a full-window iframe mounted on the
 * live, signed-in soundcloud.com page. The string comes out of a
 * SoundCloud error body, which can echo text somebody else wrote - a
 * playlist title in a shared import, for one - so it is not ours to
 * trust. A URL has a host; ask it for one. */
const CAPTCHA_HOSTS = new Set(['geo.captcha-delivery.com', 'captcha-delivery.com'])

function extractCaptchaUrl(errMsg: string): string | null {
  const m = errMsg.match(/https?:\/\/[^\s"'\\]+/g)
  for (const raw of m ?? []) {
    try {
      const u = new URL(raw)
      if (u.protocol === 'https:' && CAPTCHA_HOSTS.has(u.hostname.toLowerCase())) return u.toString()
    } catch { /* not a URL */ }
  }
  return null
}

// Solve the DataDome captcha by embedding it as an iframe INSIDE the scProxy page
// (which is on the soundcloud.com origin). This replicates DataDome's real
// integration: the captcha iframe posts its freshly-solved `datadome` cookie to
// the parent, and because the parent origin IS soundcloud.com the message is
// delivered - our injected handler writes the cookie via document.cookie in the
// native context, so DataDome trusts THIS window and the retried write passes.
// (Copying the cookie into a separate window/session does NOT work: DataDome ties
// trust to the context that solved the challenge, not to the cookie value alone.)
function solveDataDomeCaptcha(proxy: BrowserWindow, captchaUrl: string): Promise<void> {
  if (captchaPromise) return captchaPromise
  captchaPromise = new Promise<void>((resolve) => {
    let settled = false
    let poll: ReturnType<typeof setInterval> | null = null
    const cleanupJs = '(function(){var f=document.getElementById("__ddFrame"); if(f) f.remove(); window.__ddSolved=false;})()'
    const finish = () => {
      if (settled) return
      settled = true
      if (poll) clearInterval(poll)
      captchaPromise = null
      proxy.webContents.executeJavaScript(cleanupJs).catch(() => {})
      try { if (!proxy.isDestroyed()) proxy.hide() } catch { /* ignore */ }
      resolve()
    }

    // Overlay the captcha as a full-window iframe on the soundcloud.com scProxy page
    // and listen (as the soundcloud.com parent) for DataDome's solved-cookie message.
    const inject = `(function(){
      if (document.getElementById('__ddFrame')) return;
      window.__ddSolved = false;
      if (!window.__ddListener) {
        window.__ddListener = true;
        window.addEventListener('message', function(e){
          try {
            // Only from the captcha frame. Without this check any frame on
            // the page could set a cookie on the soundcloud.com origin.
            if (e.origin !== 'https://geo.captcha-delivery.com' && e.origin !== 'https://captcha-delivery.com') return;
            var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (d && d.cookie && String(d.cookie).indexOf('datadome=') === 0) {
              document.cookie = d.cookie;
              window.__ddSolved = true;
            }
          } catch(_){}
        });
      }
      var f = document.createElement('iframe');
      f.id = '__ddFrame';
      f.src = ${JSON.stringify(captchaUrl)};
      f.setAttribute('style','position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:#fff');
      (document.body || document.documentElement).appendChild(f);
    })();`

    try {
      proxy.show()
      proxy.focus()
      proxy.setTitle('Подтвердите, что вы не робот - SoundCloud')
    } catch { /* ignore */ }
    proxy.webContents.executeJavaScript(inject).catch((e) => console.error('[captcha] inject failed', e))

    let waited = 0
    poll = setInterval(async () => {
      if (settled) return
      waited += 500
      try {
        const solved = await proxy.webContents.executeJavaScript('window.__ddSolved === true')
        if (solved) { setTimeout(finish, 400); return }
      } catch { /* proxy mid-navigation */ }
      if (waited >= 180000) finish() // give up after 3 min so the write can't hang forever
    }, 500)
  })
  return captchaPromise
}

ipcMain.handle('sc-write', async (event, method: string, url: string, body: unknown, oauthToken: string) => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  assertScUrl(url)
  const proxy = await ensureScProxy()

  // Encode body as base64 to transport it into the page without any escaping issues
  const bodyB64 = body !== null ? Buffer.from(JSON.stringify(body), 'utf8').toString('base64') : null

  // Run fetch from inside the soundcloud.com context - DataDome cookies are valid here
  const code = `
    (async () => {
      const opts = {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': ${JSON.stringify('OAuth ' + oauthToken)}
        }
      };
      ${bodyB64 ? `opts.body = decodeURIComponent(escape(atob(${JSON.stringify(bodyB64)})));` : ''}
      // Bounded inside the page too: executeJavaScript waits on this promise,
      // so a stalled socket here holds the IPC call open with it.
      opts.signal = AbortSignal.timeout(20000);
      const res = await fetch(${JSON.stringify(url)}, opts);
      const text = await res.text();
      if (!res.ok) throw new Error('API error ' + res.status + ': ' + text);
      return text ? JSON.parse(text) : null;
    })()
  `
  try {
    return await proxy.webContents.executeJavaScript(code)
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    const captchaUrl = extractCaptchaUrl(msg)
    if (captchaUrl && datadomeBypass) {
      // DataDome challenge: solve it in-context, then retry the write once.
      // Only when the user enabled the captcha-bypass toggle (default off).
      await solveDataDomeCaptcha(proxy, captchaUrl)
      return await proxy.webContents.executeJavaScript(code)
    }
    throw err
  }
})

// ── Secure token storage (OS keychain via safeStorage) ──────────────────────
// Keeps the OAuth token out of localStorage; encrypted at rest with DPAPI/keychain.
const tokenFile = () => join(app.getPath('userData'), 'sc-token.bin')
// Fallback store used when the OS keychain is unavailable (common on bare Linux
// Wayland sessions with no keyring daemon). Base64 is obfuscation, NOT encryption
// - but without it the token can't persist and every write 401s after relaunch.
const tokenFileFallback = () => join(app.getPath('userData'), 'sc-token.b64')

function writeSecret(bin: string, b64: string, value: string): boolean {
  try {
    if (!value) {
      if (existsSync(bin)) unlinkSync(bin)
      if (existsSync(b64)) unlinkSync(b64)
      return true
    }
    if (safeStorage.isEncryptionAvailable()) {
      // 0600 like the fallback below it. safeStorage can select a
      // 'basic' backend on a machine with no keyring, where the key is a
      // constant - and a world-readable file is then plaintext to any
      // other local account.
      writeFileSync(bin, safeStorage.encryptString(value), { mode: 0o600 })
      if (existsSync(b64)) unlinkSync(b64)
      return true
    }
    // No OS keychain - persist an obfuscated copy so the secret survives relaunch.
    writeFileSync(b64, Buffer.from(value, 'utf8').toString('base64'), { mode: 0o600 })
    if (existsSync(bin)) unlinkSync(bin)
    return true
  } catch { return false }
}

function readSecret(bin: string, b64: string): string {
  try {
    if (existsSync(bin) && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(readFileSync(bin))
    }
    if (existsSync(b64)) {
      return Buffer.from(readFileSync(b64).toString('utf8'), 'base64').toString('utf8')
    }
    return ''
  } catch { return '' }
}

ipcMain.handle('secure-set-token', (event, token: string) =>
  isTrustedSender(event) ? writeSecret(tokenFile(), tokenFileFallback(), token) : false)

ipcMain.handle('secure-get-token', (event) =>
  isTrustedSender(event) ? readSecret(tokenFile(), tokenFileFallback()) : '')

// ── Video wallpapers ────────────────────────────────────────────────────────
// Users drop videos (.mp4/.webm) or images (.jpg/.png/.webp/.gif/.avif) into
// userData/wallpapers; we scan + list them. The renderer picks video vs image by ext.
const wallpapersDir = () => {
  const dir = join(app.getPath('userData'), 'wallpapers')
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  return dir
}
ipcMain.handle('wallpapers-dir', () => wallpapersDir())
ipcMain.handle('wallpapers-open', () => openFolder(wallpapersDir()))
ipcMain.handle('wallpapers-list', () => {
  try {
    return readdirSync(wallpapersDir())
      .filter(f => /\.(mp4|webm|jpg|jpeg|png|webp|gif|avif)$/i.test(f))
      .map(f => ({ name: f.replace(/\.[^.]+$/, ''), path: join(wallpapersDir(), f) }))
  } catch { return [] }
})

// ── Track downloads ─────────────────────────────────────────────────────────
// Saved MP3s live next to the wallpapers, in userData/downloads. The renderer
// resolves the (signed) progressive stream URL and hands it here; main fetches
// it (no CORS) and writes to disk. Returns the saved path, or null if cancelled.
/* Opening a folder in the system file manager.
 *
 * shell.openPath is the whole story on Windows and macOS. On Linux it
 * shells out to xdg-open, and inside an AppImage that is where it comes
 * apart: the bundle exports its own LD_LIBRARY_PATH (and GTK, Qt and
 * GSettings paths) so that the app finds its own copies of everything,
 * and every child process inherits them. The file manager then starts
 * against the wrong libraries and dies, openPath reports a failure
 * nobody was reading, and from the outside the menu item simply does
 * nothing. The same build run from source works, which is what made this
 * hard to see.
 *
 * So: try the normal way, and if it fails on Linux, spawn the opener
 * again with the bundle's variables taken back out. Detached and with no
 * pipes, because a file manager outlives the player. */
const APPIMAGE_VARS = [
  'LD_LIBRARY_PATH', 'LD_PRELOAD', 'GTK_PATH', 'GDK_PIXBUF_MODULE_FILE',
  'GDK_PIXBUF_MODULEDIR', 'GSETTINGS_SCHEMA_DIR', 'QT_PLUGIN_PATH',
  'PYTHONPATH', 'PERLLIB', 'GI_TYPELIB_PATH',
]

async function openFolder(dir: string): Promise<string> {
  const first = await shell.openPath(dir)
  if (!first || process.platform !== 'linux') {
    if (first) console.log('[open] %s -> %s', dir, first)
    return first
  }
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const v of APPIMAGE_VARS) {
    /* The AppImage runtime stashes what it replaced under this prefix.
       Putting the original back beats dropping the variable, which would
       leave a desktop that genuinely needed it without one. */
    const original = env[`APPIMAGE_ORIGINAL_${v}`]
    if (original !== undefined) env[v] = original
    else delete env[v]
  }
  return await new Promise<string>(resolve => {
    try {
      const child = spawn('xdg-open', [dir], { env, detached: true, stdio: 'ignore' })
      child.on('error', e => { console.log('[open] xdg-open failed: %s', e.message); resolve(first) })
      child.on('spawn', () => { child.unref(); console.log('[open] %s -> via xdg-open', dir); resolve('') })
    } catch (e) {
      console.log('[open] xdg-open threw: %s', (e as Error).message)
      resolve(first)
    }
  })
}

const downloadsDir = () => {
  const dir = join(app.getPath('userData'), 'downloads')
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  return dir
}
/* shell.openPath resolves to '' on success and to the reason on failure,
   and that reason used to be dropped on the floor - which is how "it just
   does not open the folder" became a bug with nothing to go on. Logged
   and handed back, so the window can say something. */
ipcMain.handle('downloads-open', () => openFolder(downloadsDir()))

// One stalled connection must not hang a download forever.
const DL_TIMEOUT_MS = 30000
const dlFetch = (url: string) => fetch(url, { signal: AbortSignal.timeout(DL_TIMEOUT_MS) })

const writeChunk = (out: WriteStream, buf: Buffer) => new Promise<void>((resolve, reject) => {
  out.write(buf, err => (err ? reject(err) : resolve()))
})

// Writing an HLS track to an open stream. HLS is a playlist plus dozens of
// fragments, but the fragments are fragmented MP4: the init header followed by
// every fragment, byte for byte, is already a valid .m4a. No transcoding and no
// ffmpeg involved. Fragments go to disk as they arrive, so even a long mix never
// sits in memory.
async function writeHls(playlistUrl: string, out: WriteStream): Promise<void> {
  const res = await dlFetch(playlistUrl)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const text = await res.text()

  // Without an init header the fragments aren't fMP4 (MP3-in-HLS variants) and
  // stitching them this way would produce junk - report it as unavailable instead.
  const init = text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]
  const segments = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  if (!init || !segments.length) throw new Error('NO_STREAM')

  for (const part of [init, ...segments]) {
    const r = await dlFetch(new URL(part, playlistUrl).toString())
    if (!r.ok) throw new Error('HTTP ' + r.status)
    await writeChunk(out, Buffer.from(await r.arrayBuffer()))
  }
}

/* The same two shapes the downloader handles - a plain file, or HLS stitched
   from its fragments - read into memory instead of onto disk. Transcription
   needs the bytes once; a temp file would only be something to clean up.
   Stops as soon as the cap is passed, so a two-hour set is refused by the
   caller instead of being half-read first. */
/* What the bytes actually are, read from the bytes. The container was being
   guessed from the playlist - "has an init header, so it is fMP4" - and that
   guess is only about HOW the stream is packaged, not what is inside it.
   SoundCloud serves AAC as often as MP3, and audio labelled as the wrong
   type does not fail loudly: the model simply hears nothing and says the
   track sounds instrumental. */
function sniffMime(b: Buffer): string {
  if (b.length < 12) return 'audio/mpeg'
  if (b.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4'
  if (b.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg'
  if (b.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'
  if (b.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac'
  if (b.toString('ascii', 0, 4) === 'RIFF') return 'audio/wav'
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'audio/aac'   // ADTS
  if (b[0] === 0xff && (b[1] & 0xe6) === 0xe2) return 'audio/mpeg'  // MPEG frame
  return 'audio/mpeg'
}

async function readAudio(url: string, kind: 'progressive' | 'hls', cap: number): Promise<{ buf: Buffer; mime: string }> {
  if (kind !== 'hls') {
    const res = await dlFetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    return { buf, mime: sniffMime(buf) }
  }
  const res = await dlFetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const text = await res.text()
  const init = text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]
  const segments = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  if (!segments.length) throw new Error('NO_STREAM')
  /* Two kinds of HLS here. With an init header the fragments are fMP4 and
     the header plus the fragments is a valid .m4a - that is what the
     downloader needs. Without one they are plain MP3 frames, which the
     downloader refuses because the result is not a tidy file, but MP3 frames
     are self-contained: concatenated they are perfectly good audio to listen
     to, which is all this one needs. Refusing them here would have left the
     transcriber unable to touch most of SoundCloud. */
  const parts: Buffer[] = []
  let total = 0
  for (const part of init ? [init, ...segments] : segments) {
    const r = await dlFetch(new URL(part, url).toString())
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const buf = Buffer.from(await r.arrayBuffer())
    parts.push(buf)
    total += buf.length
    if (total > cap) break
  }
  const buf = Buffer.concat(parts)
  return { buf, mime: sniffMime(buf) }
}

// ── AI lyrics ───────────────────────────────────────────────────────────────
// The key is written here and never read back out to the renderer: the window
// can ask whether one is set, and can ask for a transcript, and that is all.
const aiKeyFile = () => join(app.getPath('userData'), 'ai-key.bin')
const aiKeyFallback = () => join(app.getPath('userData'), 'ai-key.b64')

ipcMain.handle('ai-set-key', (event, key: string) =>
  isTrustedSender(event) ? writeSecret(aiKeyFile(), aiKeyFallback(), key.trim()) : false)
/* Removing it means removing both files: the encrypted one and the
   base64 fallback written where the OS has no keychain. Leaving either
   behind would read as "still set" the next time the app starts. */
ipcMain.handle('ai-clear-key', (event) => {
  if (!isTrustedSender(event)) return false
  for (const f of [aiKeyFile(), aiKeyFallback()]) {
    try { if (existsSync(f)) unlinkSync(f) } catch { /* ignore */ }
  }
  return !readSecret(aiKeyFile(), aiKeyFallback())
})
ipcMain.handle('ai-has-key', (event) =>
  isTrustedSender(event) ? !!readSecret(aiKeyFile(), aiKeyFallback()) : false)
/* ── The lyrics caches ───────────────────────────────────────────────────
   Two folders, both of them things we were given rather than things we
   made: pages fetched from Genius, and answers paid for by the second.
   Worth keeping, worth being able to look at, and worth being able to
   throw away when a track got the wrong song's words stuck to it. */
const cacheDirs = () => ({
  ai: join(app.getPath('userData'), 'ai-lyrics'),
  genius: join(app.getPath('userData'), 'genius'),
})

ipcMain.handle('lyrics-cache-stat', (event) => {
  if (!isTrustedSender(event)) return { files: 0, bytes: 0 }
  let files = 0
  let bytes = 0
  for (const d of Object.values(cacheDirs())) {
    try {
      for (const name of readdirSync(d)) {
        // budget.json is not a cache - it remembers when Genius said no.
        if (name === 'budget.json') continue
        try { bytes += statSync(join(d, name)).size; files++ } catch { /* gone */ }
      }
    } catch { /* no folder yet */ }
  }
  return { files, bytes }
})

/* Which tracks we demonstrably have words for, read off the disk.
   The badge map lives in the window's storage, and storage can be wrong -
   it was: an older build cleared a track's mark every time it played. The
   files are the truth, so the map is rebuilt from them at startup instead
   of being trusted. */
ipcMain.handle('lyrics-cached-ids', (event) => {
  if (!isTrustedSender(event)) return []
  const { ai, genius } = cacheDirs()
  const ids = new Set<number>()
  try {
    for (const name of readdirSync(ai)) {
      const m = /^(\d+)-/.exec(name) ?? /^(\d+)\.json$/.exec(name)
      if (!m) continue
      // A cached "nothing was heard" is a result too, and not a reason for
      // a badge - so the file has to actually hold lines.
      try {
        const v = JSON.parse(readFileSync(join(ai, name), 'utf8')) as { lines?: unknown[] }
        if (Array.isArray(v.lines) && v.lines.length) ids.add(Number(m[1]))
      } catch { /* unreadable: not evidence */ }
    }
  } catch { /* no folder */ }
  try {
    for (const name of readdirSync(genius)) {
      const m = /^(\d+)\.html$/.exec(name)
      if (m) ids.add(Number(m[1]))
    }
  } catch { /* no folder */ }
  return [...ids]
})

/* Everything this track taught us, thrown away: the timed result and the
   Genius page it came from. The page has to go too - leaving it means the
   next attempt re-reads the same wrong song and nothing changes, which is
   exactly the complaint this button exists to answer. */
ipcMain.handle('lyrics-forget-track', (event, trackId: number) => {
  if (!isTrustedSender(event) || !Number.isFinite(trackId)) return 0
  const { ai, genius } = cacheDirs()
  let gone = 0
  for (const [dir, hit] of [
    [ai, (n: string) => n === `${trackId}.json` || n.startsWith(`${trackId}-`)],
    [genius, (n: string) => n === `${trackId}.html`],
  ] as const) {
    try {
      for (const name of readdirSync(dir)) {
        if (!hit(name)) continue
        try { unlinkSync(join(dir, name)); gone++ } catch { /* ignore */ }
      }
    } catch { /* no folder */ }
  }
  /* "Look again" has to mean it. Without this the page was deleted and
     the note saying the search was pointless stayed behind, so the next
     attempt answered from that note and nothing was re-asked. */
  clearMiss(trackId)
  console.log('[cache] forgot track %d (%d files)', trackId, gone)
  return gone
})

ipcMain.handle('lyrics-cache-open', async (event) => {
  if (!isTrustedSender(event)) return false
  const { ai } = cacheDirs()
  try { mkdirSync(ai, { recursive: true }) } catch { /* ignore */ }
  // The folder above holds both caches, so that is the one worth opening.
  await shell.openPath(app.getPath('userData'))
  return true
})

ipcMain.handle('lyrics-cache-clear', (event) => {
  if (!isTrustedSender(event)) return 0
  const { ai, genius } = cacheDirs()
  let gone = 0
  /* Everything in ai-lyrics: it holds nothing but results and the probe
     copy of the last audio sent. In genius, only the pages - the budget
     file next to them is state, and wiping it would forget both the
     cooldown and which token stopped working. */
  /* The learned artist list goes with the pages. It is nothing but a
     summary of what those matches taught us, so keeping it after they are
     deleted would be keeping a conclusion without its evidence. */
  forgetArtists()
  for (const [dir, keep] of [[ai, () => true], [genius, (n: string) => n.endsWith('.html')]] as const) {
    try {
      for (const name of readdirSync(dir)) {
        if (!keep(name)) continue
        try { unlinkSync(join(dir, name)); gone++ } catch { /* ignore */ }
      }
    } catch { /* no folder */ }
  }
  console.log('[cache] cleared %d lyrics files', gone)
  return gone
})

// ── Local forced alignment ──────────────────────────────────────────────────
ipcMain.handle('align-ready', (event) => (isTrustedSender(event) ? alignReady() : false))
ipcMain.handle('align-info', (event) => (
  isTrustedSender(event) ? modelInfo() : { have: false, bytes: 0, total: 0, dir: '' }
))
ipcMain.handle('align-cancel', (event) => { if (isTrustedSender(event)) cancelFetch() })
ipcMain.handle('align-remove', (event) => {
  if (!isTrustedSender(event)) return false
  // Cancel first: deleting a file a download is still writing to is a race.
  cancelFetch()
  return removeModel()
})
ipcMain.handle('align-open-dir', (event) => (
  isTrustedSender(event) ? openFolder(modelInfo().dir) : Promise.resolve('untrusted sender')
))

let fetching: Promise<void> | null = null
ipcMain.handle('align-fetch', async (event) => {
  if (!isTrustedSender(event)) return false
  // One download, however many windows ask for it.
  if (!fetching) {
    fetching = fetchModel((done, total) => {
      try { event.sender.send('align-progress', { done, total }) } catch { /* window went away */ }
    }).finally(() => { fetching = null })
  }
  try { await fetching; return true } catch (e) {
    console.log('[align] model download failed: %s', e instanceof Error ? e.message : e)
    return false
  }
})

ipcMain.handle('align-run', async (event, req: { trackId: number; pcm: Float32Array; lyrics: string[]; title?: string }) => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  const started = Date.now()
  const pcm = req.pcm instanceof Float32Array ? req.pcm : new Float32Array(req.pcm)
  const r = await alignLocal(pcm, req.lyrics)
  console.log('[align] "%s" %s: %ss of audio in %ss, %d lines, support %d%%',
    req.title ?? '', lyricsHash(req.lyrics), r.seconds.toFixed(0),
    ((Date.now() - started) / 1000).toFixed(1), r.lines.length, Math.round(r.support * 100))
  /* Into the same cache the model path writes to, under its own slot:
     thirty seconds of CPU is not something to spend twice on one track. */
  /* Keyed by the words too, for the same reason as the model path: this
     slot is read back without `force` by the library scan. */
  writeCached(req.trackId, LOCAL_SLOT, {
    lines: r.lines, plain: r.lines.map(l => l.text).join('\n'),
    model: LOCAL_SLOT, at: Date.now(), fit: r.support,
    words: lyricsHash(req.lyrics),
  })
  return r
})

// ── Genius ──────────────────────────────────────────────────────────────────
// The token lives here like the others: written in, never read back out.
const gnKeyFile = () => join(app.getPath('userData'), 'genius-token.bin')
const gnKeyFallback = () => join(app.getPath('userData'), 'genius-token.b64')

ipcMain.handle('genius-set-token', (event, token: string) =>
  isTrustedSender(event) ? writeSecret(gnKeyFile(), gnKeyFallback(), token.trim()) : false)
// Two different questions: has the person set one, and is there any at all.
ipcMain.handle('genius-has-token', (event) =>
  isTrustedSender(event) ? !!readSecret(gnKeyFile(), gnKeyFallback()) : false)
ipcMain.handle('genius-ready', (event) =>
  isTrustedSender(event) ? tokenUsable(readSecret(gnKeyFile(), gnKeyFallback())) : false)
/* The library, handed over before a scan so the matcher has something to
   judge an unvouched hit against from the very first track. */
/* Asked before a scan: get the Cloudflare check out of the way while the
   person is still sitting there. */
ipcMain.handle('genius-clearance', async (event) => {
  if (!isTrustedSender(event)) return false
  return await ensureClearance()
})

ipcMain.handle('genius-library', (event, names: string[]) => {
  if (isTrustedSender(event) && Array.isArray(names)) setLibraryArtists(names.slice(0, 4000))
})
ipcMain.handle('genius-find', async (event, req: { title: string; artists: string[]; raw?: string }): Promise<string | null> =>
  isTrustedSender(event) ? geniusSearch(readSecret(gnKeyFile(), gnKeyFallback()), req.title, req.artists, req.raw) : null)
ipcMain.handle('genius-url', async (event, req: { trackId: number; url: string }): Promise<GeniusResult> => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  const r = await geniusByUrl(req.trackId, req.url)
  console.log('[genius] by link %s -> %s', req.url, r.ok ? (r.cached ? 'from cache' : 'fetched') : r.reason)
  return r
})
ipcMain.handle('genius-page', async (event, req: { trackId: number; title: string; artists: string[]; raw?: string }): Promise<GeniusResult> => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  const r = await geniusPage(readSecret(gnKeyFile(), gnKeyFallback()), req.trackId, req.title, req.artists, req.raw)
  console.log('[genius] "%s" by [%s] -> %s', req.title, req.artists.join(', '),
    r.ok ? (r.cached ? 'from cache' : 'fetched ' + r.url) : r.reason)
  return r
})

ipcMain.handle('ai-cached', (event, trackId: number, model: string) =>
  isTrustedSender(event) ? readCached(trackId, model || DEFAULT_MODEL) : null)

ipcMain.handle('ai-transcribe', async (event, req: {
  trackId: number; title: string; artist: string; durationSec: number
  url: string; kind: 'progressive' | 'hls'; model?: string; force?: boolean
  /* Already decoded to 16 kHz mono WAV by the window, when it could: see the
     note in src/services/aiLyrics.ts. Fragmented MP4 reaches the model as a
     file of zero length, so sending the original bytes is the fallback, not
     the plan. */
  wav?: Uint8Array | null
  /** What the window encoded it as - mp3 when it could, wav as a fallback. */
  wavMime?: string
  /* Words we already have, from a catalogue or from Genius. With them the
     model is only asked for timings - see ALIGN_SCHEMA. */
  lyrics?: string[] | null
}): Promise<AiLyrics> => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  // `force` is the redo button: the same track, the same model, asked again
  // because the answer was not good enough.
  // An aligned result and a transcript are different things; filed apart so
  // one never silently stands in for the other.
  const slot = (req.model || DEFAULT_MODEL) + (req.lyrics?.length ? '-aligned' : '')
  const words = req.lyrics?.length ? lyricsHash(req.lyrics) : undefined
  const cached = req.force ? null : readCached(req.trackId, slot)
  /* An alignment is of the words it was given. A track whose lyrics were
     wrong - a Genius mismatch, a plain-text copy of a different edit - used
     to keep handing back the old timing once the words were corrected,
     because the key knew only the track and the model. The library scan
     takes exactly this path, so it reported success for tracks that now
     held different text. */
  if (cached && (!words || cached.words === words)) return cached
  const key = readSecret(aiKeyFile(), aiKeyFallback())
  if (!key) throw new Error('NO_KEY')
  // A little over the inline cap, so an oversized track is reported as too
  // long rather than sent and rejected by the API.
  const { buf, mime } = req.wav && req.wav.length
    ? { buf: Buffer.from(req.wav), mime: req.wavMime || 'audio/wav' }
    : await readAudio(req.url, req.kind, 15 * 1024 * 1024)
  /* Kept so "it heard nothing" can be checked rather than argued about: play
     this file, and either the track is there or we sent rubbish. One file,
     overwritten each time. */
  const ext = mime.includes('wav') ? '.wav' : mime.includes('mp4') ? '.m4a' : mime.includes('aac') ? '.aac' : '.mp3'
  const probe = join(app.getPath('userData'), 'ai-lyrics', 'last-sent' + ext)
  try { writeFileSync(probe, buf) } catch { /* ignore */ }
  console.log('[ai-lyrics] sending %s KB as %s (head %s) -> %s',
    Math.round(buf.length / 1024), mime, buf.subarray(0, 8).toString('hex'), probe)
  try {
    return await transcribe({
      trackId: req.trackId, title: req.title, artist: req.artist, durationSec: req.durationSec,
      audio: buf, mime, key, model: req.model || DEFAULT_MODEL,
      lyrics: req.lyrics, slot,
    })
  } catch (e) {
    // Also to the terminal: the window shows a trimmed line, and a long API
    // complaint is worth having in full somewhere.
    console.error('[ai-lyrics]', e)
    throw e
  }
})

// Every download goes through one job: open a destination, fill it (either here
// from the stream, or from the window when it transcodes to MP3), then close.
// Keeping it in one place means the save dialog, the partial-file cleanup and the
// extension logic exist once instead of per format.
interface DlJob { stream: WriteStream; dest: string }
const dlJobs = new Map<number, DlJob>()
let dlSeq = 0

// `exts` may hold more than one option: the save dialog then shows a file-type
// picker, and the chosen extension decides the format (dest comes back to the
// renderer so it can see which one won).
ipcMain.handle('dl-open', async (event, mode: 'folder' | 'dialog', filename: string, exts: string[]) => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  let dest = downloadDest(filename, exts[0])
  if (mode === 'dialog') {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined
    console.log('[dl] save dialog, parent window: %s', win ? 'yes' : 'NONE')
    const r = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: dest,
          filters: exts.map(e => ({ name: e.toUpperCase(), extensions: [e] })),
        })
      /* Without a parent the dialog is a free-floating window, which is
         still better than not showing one: `win!` on a null made this
         throw, and the throw arrived in the renderer as a generic
         download failure rather than as "no window". */
      : await dialog.showSaveDialog({
          defaultPath: dest,
          filters: exts.map(e => ({ name: e.toUpperCase(), extensions: [e] })),
        })
    console.log('[dl] save dialog -> %s', r.canceled ? 'cancelled' : r.filePath)
    if (r.canceled || !r.filePath) return null
    dest = r.filePath
  }
  const id = ++dlSeq
  dlJobs.set(id, { stream: createWriteStream(dest), dest })
  return { id, dest }
})

// Fill a job straight from SoundCloud, unchanged: plain MP3 in one go, HLS glued
// from its fragments.
ipcMain.handle('dl-fill', async (event, id: number, url: string, kind: 'progressive' | 'hls') => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  const job = dlJobs.get(id)
  if (!job) throw new Error('unknown download job')
  if (kind === 'hls') {
    await writeHls(url, job.stream)
  } else {
    const res = await dlFetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    await writeChunk(job.stream, Buffer.from(await res.arrayBuffer()))
  }
})

// Used when the window produces the bytes itself (MP3 transcoding).
ipcMain.handle('dl-write', async (event, id: number, bytes: Uint8Array) => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  const job = dlJobs.get(id)
  if (!job) throw new Error('unknown download job')
  await writeChunk(job.stream, Buffer.from(bytes))
})

ipcMain.handle('dl-close', async (event, id: number, ok: boolean) => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  const job = dlJobs.get(id)
  if (!job) return null
  dlJobs.delete(id)
  if (ok) {
    await new Promise<void>(resolve => job.stream.end(resolve))
    return job.dest
  }
  // Cancelled or failed - don't leave a partial file behind
  job.stream.destroy()
  try { unlinkSync(job.dest) } catch { /* nothing written */ }
  return null
})

// ── App version / GitHub releases (update check) ────────────────────────────
const GH_REPO = 'rwxrwz/soundcloud-client'
const RELEASES_TTL = 30 * 60 * 1000 // 30 min - GitHub allows 60 unauthenticated req/h
interface GithubRelease { tag: string; name: string; body: string; date: string; url: string; prerelease: boolean }
let releasesCache: { at: number; data: GithubRelease[] } | null = null

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('get-releases', async (_event, force?: boolean) => {
  if (!force && releasesCache && Date.now() - releasesCache.at < RELEASES_TTL) return releasesCache.data
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SoundCloud-Desktop-Player' },
      // A check nobody asked for must not be able to hang waiting for one.
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return releasesCache?.data ?? []
    const raw = await res.json() as Array<{ tag_name?: string; name?: string; body?: string; published_at?: string; html_url?: string; prerelease?: boolean; draft?: boolean }>
    const data: GithubRelease[] = (Array.isArray(raw) ? raw : [])
      .filter(r => !r.draft)
      .map(r => ({
        tag: r.tag_name ?? '',
        name: r.name || r.tag_name || '',
        body: r.body ?? '',
        date: r.published_at ?? '',
        url: r.html_url ?? '',
        prerelease: !!r.prerelease,
      }))
    releasesCache = { at: Date.now(), data }
    return data
  } catch {
    return releasesCache?.data ?? []
  }
})

ipcMain.handle('set-mini-opaque', (_, enabled: boolean) => { miniOpaque = !!enabled })
ipcMain.handle('open-mini-player', () => createMiniWindow())
ipcMain.handle('close-mini-player', () => { miniWindow?.close(); miniWindow = null })
ipcMain.handle('toggle-devtools', () => { if (process.env.ELECTRON_RENDERER_URL) mainWindow?.webContents.toggleDevTools() })
ipcMain.handle('show-main-window', () => { mainWindow?.show(); mainWindow?.focus() })
ipcMain.handle('get-player-state', () => lastPlayerState)

// Custom window controls
ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.handle('window-close', () => mainWindow?.close())

// System: close-button behaviour (hide to tray vs quit)
ipcMain.handle('set-close-to-tray', (_, enabled: boolean) => { closeToTray = !!enabled })

// System: auto-solve DataDome captcha on a 403 write (default off)
ipcMain.handle('set-datadome-bypass', (_, enabled: boolean) => { datadomeBypass = !!enabled })

// Transparent-window theme. Transparency can't change after window creation, so the
// renderer writes this flag file; main reads it on next launch. `get` returns how the
// current window actually launched, so the UI can show a "restart needed" hint.
const transparentFlagFile = () => join(app.getPath('userData'), 'window-transparent')
ipcMain.handle('set-window-transparent', (_, enabled: boolean) => {
  try {
    if (enabled) writeFileSync(transparentFlagFile(), '1')
    else if (existsSync(transparentFlagFile())) unlinkSync(transparentFlagFile())
  } catch { /* ignore */ }
})
ipcMain.handle('get-window-transparent', () => launchedTransparent)
ipcMain.handle('restart-app', () => {
  const args = process.argv.slice(1)
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    // Force extract-and-run on relaunch so it doesn't need FUSE. Many modern distros
    // ship without libfuse2 -> the AppImage can't remount ("Cannot mount AppImage").
    // The relaunched child inherits this env var, which bypasses the FUSE mount.
    process.env.APPIMAGE_EXTRACT_AND_RUN = '1'
    app.relaunch({ execPath: process.env.APPIMAGE, args })
  } else if (process.env.PORTABLE_EXECUTABLE_FILE) {
    app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE, args })
  } else {
    app.relaunch({ args })
  }
  app.exit(0)
})

// System: launch the app on Windows login.
// This is a "portable" build: at runtime process.execPath points at the temp
// extraction dir, which is useless for a Run-key entry (it changes each launch).
// electron-builder exposes the real launched .exe in PORTABLE_EXECUTABLE_FILE -
// register that so Windows relaunches the actual portable exe at login.
const loginExePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
ipcMain.handle('set-login-item', (event, enabled: boolean) => {
  if (!isTrustedSender(event)) return
  app.setLoginItemSettings({ openAtLogin: !!enabled, path: loginExePath(), args: [] })
})
ipcMain.handle('get-login-item', () => app.getLoginItemSettings({ path: loginExePath(), args: [] }).openAtLogin)

// State broadcast: main renderer → main process → mini window
ipcMain.on('player-state-update', (_, state) => {
  lastPlayerState = state
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('player-state', state)
  }
  updateMpris(state as MprisState)
  discordUpdate(state as PresenceState)
})

// Discord rich presence. Off by default and never switched on from here:
// the renderer owns the setting, and a player that announced itself on
// somebody's profile before they asked would be the wrong default.
ipcMain.handle('set-discord-rpc', (event, enabled: boolean) => {
  if (!isTrustedSender(event)) return
  discordSetEnabled(!!enabled)
})

// Control commands: mini window → main process → main renderer
ipcMain.on('player-control', (_, action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-command', action)
  }
})

// Companion WebSocket bridge: main renderer → main process → WS clients.
// The Telegram remote feeds off the same snapshot - it is another consumer of
// the player's state, not a second source of it.
ipcMain.on('bridge:state', (_, state: BridgeState) => { bridgeSetState(state); miniAppSetState(state) })
ipcMain.on('bridge:progress', (_, p: { position: number; playing: boolean }) => { bridgeProgress(p.position, p.playing); miniAppProgress(p.position, p.playing) })
// Asked before the renderer starts measuring: with no companion attached
// the analyser loop and its fifty messages a second are work for nobody.
ipcMain.handle('bridge-has-clients', () => bridgeHasClients())
ipcMain.on('bridge:audio', (_, a: { level: number; bass: number }) => bridgeAudio(a.level, a.bass))
ipcMain.on('bridge:spectrum', (_, bars: number[]) => bridgeSpectrum(bars))

// ── Telegram remote control ─────────────────────────────────────────────────
// The bot token is a full credential, so it lives in the OS keychain next to the
// SoundCloud token - never in the renderer's localStorage, and deliberately not
// in the settings store, because settings are shareable as preset codes and a
// shared "theme" would hand over the key to the bot.
const remoteCfgFile = () => join(app.getPath('userData'), 'remote.json')
const remoteTokenBin = () => join(app.getPath('userData'), 'remote-token.bin')
const remoteTokenB64 = () => join(app.getPath('userData'), 'remote-token.b64')

const REMOTE_DEFAULTS: RemoteConfig = { enabled: false, allowed: [] }

function loadRemoteConfig(): RemoteConfig {
  try {
    const raw = JSON.parse(readFileSync(remoteCfgFile(), 'utf8')) as Partial<RemoteConfig>
    return {
      enabled: !!raw.enabled,
      allowed: Array.isArray(raw.allowed) ? raw.allowed.filter(n => Number.isSafeInteger(n)) : [],
    }
  } catch { return { ...REMOTE_DEFAULTS } }
}

function saveRemoteConfig(c: RemoteConfig): void {
  try { writeFileSync(remoteCfgFile(), JSON.stringify(c, null, 2), { mode: 0o600 }) } catch { /* ignore */ }
}

let remoteCfg: RemoteConfig = { ...REMOTE_DEFAULTS }

// Track lists live in the renderer's store (1700 likes are never shipped to main
// wholesale), so the bot asks for one page at a time and waits for the answer.
let listSeq = 0
const listPending = new Map<number, { resolve: (p: ListPage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function requestList(q: ListQuery): Promise<ListPage> {
  return new Promise<ListPage>((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) { reject(new Error('window closed')); return }
    const id = ++listSeq
    const timer = setTimeout(() => { listPending.delete(id); reject(new Error('timeout')) }, 6000)
    listPending.set(id, { resolve, reject, timer })
    mainWindow.webContents.send('remote:list-request', { id, ...q })
  })
}

/* Lyrics, asked for by the Mini App. Same pattern as the list above: the
   renderer owns the catalogue lookups and the cache, so it answers. */
let lyrSeq = 0
const lyrPending = new Map<number, { resolve: (p: LyricsPayload) => void; timer: NodeJS.Timeout }>()

function requestLyrics(trackId: number): Promise<LyricsPayload> {
  return new Promise<LyricsPayload>((resolve) => {
    const empty: LyricsPayload = { synced: null, plain: null }
    if (!mainWindow || mainWindow.isDestroyed()) { resolve(empty); return }
    const id = ++lyrSeq
    // Longer than a list: a first lookup goes out to a lyrics catalogue.
    const timer = setTimeout(() => { lyrPending.delete(id); resolve(empty) }, 12000)
    lyrPending.set(id, { resolve, timer })
    mainWindow.webContents.send('remote:lyrics-request', { id, trackId })
  })
}

ipcMain.on('remote:lyrics-reply', (_, r: { id: number } & LyricsPayload) => {
  const p = lyrPending.get(r.id)
  if (!p) return
  clearTimeout(p.timer)
  lyrPending.delete(r.id)
  p.resolve({ synced: r.synced ?? null, plain: r.plain ?? null, ai: r.ai })
})

ipcMain.on('remote:list-reply', (_, r: { id: number; items: ListItem[]; total: number; title?: string }) => {
  const p = listPending.get(r.id)
  if (!p) return
  clearTimeout(p.timer)
  listPending.delete(r.id)
  p.resolve({ items: r.items ?? [], total: r.total ?? 0, title: r.title })
})

function toRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

initRemote({
  sendCommand: (cmd: RemoteCommand) => toRenderer('remote:command', cmd),
  onStatus: (s: RemoteStatus) => toRenderer('remote:status', s),
  onPairRequest: (u) => toRenderer('remote:pair', u),
  saveConfig: (c) => { remoteCfg = c; saveRemoteConfig(c) },
})

/* ── Mini App ──────────────────────────────────────────────────────────────
 *
 * Three things have to line up: a local server with the page and the socket,
 * a tunnel giving that server a public address, and Telegram being told what
 * the address is. The tunnel is the only one that can fail or change its mind
 * later, so everything hangs off its callback rather than off a start-up
 * sequence that assumes an address exists.
 *
 * The server starts even before the binary is here: it costs a listening
 * socket on localhost, and having it up means the moment a tunnel appears
 * there is something behind it. */

let miniState: TunnelState = 'off'
let miniUrl: string | null = null
let miniFetching = false

function sayMiniApp(): void {
  toRenderer('miniapp:status', { state: miniState, url: miniUrl, ...tunnelInfo() })
}

function onTunnel(st: TunnelState, url: string | null): void {
  miniState = st
  miniUrl = url
  // Telegram is told on every change, including the one to null: a button
  // pointing at a dead tunnel is worse than no button.
  void remoteSetMiniApp(url)
  sayMiniApp()
}

function applyMiniApp(): void {
  /* No switch of its own any more. The Mini App IS the remote - the chat
     holds a door and nothing else - so asking twice whether somebody wants
     it was asking the same question twice. Anyone who had it off, which is
     everyone who updated, gets it on. */
  const want = remoteCfg.enabled
  if (!want) {
    stopTunnel()
    stopMiniApp()
    miniState = 'off'
    miniUrl = null
    void remoteSetMiniApp(null)
    sayMiniApp()
    return
  }

  startMiniApp({
    botToken: () => readSecret(remoteTokenBin(), remoteTokenB64()),
    // The remote's white list, read live: approving somebody in the player
    // must let them in without a restart.
    isAllowed: (id) => remoteCfg.allowed.includes(id),
    onCommand: (cmd) => toRenderer('remote:command', cmd),
    requestList,
    requestLyrics,
  })

  if (tunnelReady()) { startTunnel(MINIAPP_PORT, onTunnel); return }

  // 35MB of cloudflared, once, on the first switch-on.
  if (miniFetching) return
  miniFetching = true
  miniState = 'fetching'
  sayMiniApp()
  void fetchTunnelBinary((done, total) => {
    toRenderer('miniapp:progress', { done, total })
  }).then(ok => {
    miniFetching = false
    if (!remoteCfg.enabled) return
    if (ok) startTunnel(MINIAPP_PORT, onTunnel)
    else { miniState = 'failed'; sayMiniApp() }
  })
}

ipcMain.handle('miniapp-status', (event) => {
  if (!isTrustedSender(event)) return null
  return { state: miniState, url: miniUrl, ...tunnelInfo() }
})

ipcMain.handle('remote-get-config', (event) => {
  if (!isTrustedSender(event)) return null
  // The token itself never travels back to the renderer; the UI only needs to
  // know whether one is stored.
  return { ...remoteCfg, hasToken: !!readSecret(remoteTokenBin(), remoteTokenB64()), status: remoteGetStatus() }
})

ipcMain.handle('remote-set-config', (event, patch: { enabled?: boolean; token?: string | null }) => {
  if (!isTrustedSender(event)) return false
  if (typeof patch.enabled === 'boolean') remoteCfg.enabled = patch.enabled
  if (typeof patch.token === 'string') writeSecret(remoteTokenBin(), remoteTokenB64(), patch.token.trim())
  saveRemoteConfig(remoteCfg)
  remoteConfigure(remoteCfg, readSecret(remoteTokenBin(), remoteTokenB64()))
  // The Mini App is the bot's front door; with the bot off there is nothing
  // for it to be the front of.
  applyMiniApp()
  return true
})

ipcMain.handle('remote-approve', (event, id: number) => {
  if (!isTrustedSender(event)) return false
  remoteApprove(Number(id))
  return true
})

ipcMain.handle('remote-revoke', (event, id: number) => {
  if (!isTrustedSender(event)) return false
  remoteRevoke(Number(id))
  return true
})

// Auth handler: opens SoundCloud signin, waits for login, then grabs credentials automatically
/* Guarded like every other handler that touches a credential, and this is
   the one that hands back a live account token. Nothing can reach it today
   - no window that loads a third-party page is given a preload - but that
   is a property of the other windows, not of this handler, and it is the
   last place that should depend on one. */
ipcMain.handle('sc-auth', async (event) => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  return new Promise<{ clientId: string; oauthToken: string }>((resolve, reject) => {
    const authWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Sign in to SoundCloud - close this window when done',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let clientId = ''
    let oauthToken = ''
    let resolved = false

    const tryResolve = () => {
      if (resolved || !clientId || !oauthToken) return
      resolved = true
      if (!authWin.isDestroyed()) {
        // Hide instead of close - reuse as SC proxy for DataDome-safe write requests
        authWin.hide()
        if (scProxy && !scProxy.isDestroyed()) scProxy.close()
        scProxy = authWin
      }
      resolve({ clientId, oauthToken })
    }

    // Intercept all outgoing requests to api-v2
    authWin.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['*://api-v2.soundcloud.com/*', '*://api.soundcloud.com/*'] },
      (details, callback) => {
        const cidMatch = details.url.match(/client_id=([a-zA-Z0-9_-]+)/)
        if (cidMatch) clientId = cidMatch[1]

        const auth = details.requestHeaders['Authorization'] || details.requestHeaders['authorization']
        if (auth && auth.startsWith('OAuth ')) {
          oauthToken = auth.replace('OAuth ', '').trim()
        }

        callback({ requestHeaders: details.requestHeaders })
        tryResolve()
      }
    )

    authWin.loadURL('https://soundcloud.com/signin')

    // After user logs in and page navigates away from /signin, inject a fetch to force API request
    authWin.webContents.on('did-navigate', async (_, url) => {
      if (!url.includes('/signin') && url.includes('soundcloud.com')) {
        // Give the page a moment to initialize, then trigger an authenticated API call
        setTimeout(() => {
          if (!resolved && !authWin.isDestroyed()) {
            authWin.webContents.executeJavaScript(`
              fetch('https://api-v2.soundcloud.com/me', { credentials: 'include' })
                .catch(() => {})
            `).catch(() => {})
          }
        }, 1500)
      }
    })

    authWin.on('closed', () => {
      if (!resolved) reject(new Error('Окно закрыто до завершения входа'))
    })

    setTimeout(() => {
      if (!resolved) {
        resolved = true
        if (!authWin.isDestroyed()) authWin.close()
        reject(new Error('Timeout'))
      }
    }, 300000)
  })
})

app.whenReady().then(() => {
  // Serve video wallpapers from userData/wallpapers via scwall://media/<file>,
  // constrained to the wallpapers dir (no arbitrary local-file reads).
  protocol.registerFileProtocol('scwall', (request, callback) => {
    try {
      const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''))
      const dir = wallpapersDir()
      const full = join(dir, name)
      const rel = relative(dir, full)
      if (rel.startsWith('..') || isAbsolute(rel)) { callback({ error: -10 }); return }
      callback({ path: full })
    } catch { callback({ error: -6 }) }
  })

  createMainWindow()
  createTray()
  setupMpris()

  // Companion overlay bridge: relay WS commands to the main renderer's player.
  startBridge((cmd) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bridge:command', cmd)
  })

  remoteCfg = loadRemoteConfig()
  remoteConfigure(remoteCfg, readSecret(remoteTokenBin(), remoteTokenB64()))
  applyMiniApp()

  app.on('activate', () => {
    // macOS: clicking dock icon shows main window
    mainWindow?.show()
    mainWindow?.focus()
  })
})

app.on('window-all-closed', () => {
  // Normally the app lives in the tray; quit when actually quitting or when the
  // user disabled "hide to tray on close".
  if (process.platform !== 'darwin' && (isQuitting || !closeToTray)) app.quit()
})

app.on('before-quit', () => { isQuitting = true; stopBridge(); stopRemote(); stopTunnel(); stopMiniApp(); discordStop() })
