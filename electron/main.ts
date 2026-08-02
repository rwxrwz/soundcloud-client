import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen, safeStorage, protocol, dialog } from 'electron'
import { join, relative, isAbsolute } from 'path'
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from 'fs'
import { startBridge, stopBridge, bridgeSetState, bridgeProgress, bridgeAudio, bridgeSpectrum, type BridgeState } from './bridge'
// Type-only import: erased at build time so it never becomes a top-level require.
// mpris-service (and its call-bind/dunder-proto dep cluster) is Linux-only and is
// require()'d lazily inside setupMpris() under a platform guard — otherwise the
// Windows bundle would require it on launch and die on the missing top-level
// `call-bind-apply-helpers` (the afterPack fix only patches the Linux bundle).
import type Mpris from 'mpris-service'

const ICON_PATH = join(__dirname, '../../buildResources/icon_rounded.ico')

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let closeToTray = true   // when false, closing the window quits the app
let datadomeBypass = false // when true, auto-solve DataDome captcha on a 403 write
let lastPlayerState: unknown = null
// Hidden SC-context window — kept alive after auth so DataDome cookies stay valid
let scProxy: BrowserWindow | null = null
// Linux MPRIS now-playing/controls source (null on other platforms)
let mprisPlayer: ReturnType<typeof Mpris> | null = null
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
function assertScUrl(raw: string): void {
  const u = new URL(raw)
  if (u.protocol !== 'https:' || !/(^|\.)soundcloud\.com$/.test(u.hostname)) {
    throw new Error('blocked non-SoundCloud host')
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    icon: ICON_PATH,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
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
  // Apply this ONLY to requests from the main window — never to the scProxy window,
  // whose like/playlist writes use credentials:'include' and rely on api-v2's own
  // origin-specific CORS (which '*' would break).
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
    // Only hand off real web links to the OS browser — never file:, etc.
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
      // Mini window only renders IPC-fed state + artwork images — no cross-origin
      // fetches — so web security can stay on here.
      webSecurity: true
    }
  })
  // Keep the mini-player pinned above everything — including fullscreen apps —
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
  // emit 'click'/'right-click' and ignores popUpContextMenu — the only reliable
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
    if (t) {
      const idStr = String(t.id).replace(/[^A-Za-z0-9_]/g, '_') || '0'
      // progress/duration in the store are SECONDS; MPRIS wants microseconds.
      mprisPlayer.metadata = {
        'mpris:trackid': mprisPlayer.objectPath('track/' + idStr),
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
ipcMain.handle('sc-get-client-id', () => {
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
function extractCaptchaUrl(errMsg: string): string | null {
  const m = errMsg.match(/https?:\/\/[^\s"'\\]*captcha-delivery\.com\/captcha\/[^\s"'\\]*/)
  return m ? m[0] : null
}

// Solve the DataDome captcha by embedding it as an iframe INSIDE the scProxy page
// (which is on the soundcloud.com origin). This replicates DataDome's real
// integration: the captcha iframe posts its freshly-solved `datadome` cookie to
// the parent, and because the parent origin IS soundcloud.com the message is
// delivered — our injected handler writes the cookie via document.cookie in the
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
            var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (d && d.cookie && String(d.cookie).indexOf('datadome=') !== -1) {
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
      proxy.setTitle('Подтвердите, что вы не робот — SoundCloud')
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

  // Run fetch from inside the soundcloud.com context — DataDome cookies are valid here
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
// — but without it the token can't persist and every write 401s after relaunch.
const tokenFileFallback = () => join(app.getPath('userData'), 'sc-token.b64')

ipcMain.handle('secure-set-token', (event, token: string) => {
  if (!isTrustedSender(event)) return false
  try {
    if (!token) {
      if (existsSync(tokenFile())) unlinkSync(tokenFile())
      if (existsSync(tokenFileFallback())) unlinkSync(tokenFileFallback())
      return true
    }
    if (safeStorage.isEncryptionAvailable()) {
      writeFileSync(tokenFile(), safeStorage.encryptString(token))
      if (existsSync(tokenFileFallback())) unlinkSync(tokenFileFallback())
      return true
    }
    // No OS keychain — persist an obfuscated copy so the token survives relaunch.
    writeFileSync(tokenFileFallback(), Buffer.from(token, 'utf8').toString('base64'), { mode: 0o600 })
    if (existsSync(tokenFile())) unlinkSync(tokenFile())
    return true
  } catch { return false }
})

ipcMain.handle('secure-get-token', (event) => {
  if (!isTrustedSender(event)) return ''
  try {
    if (existsSync(tokenFile()) && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(readFileSync(tokenFile()))
    }
    if (existsSync(tokenFileFallback())) {
      return Buffer.from(readFileSync(tokenFileFallback()).toString('utf8'), 'base64').toString('utf8')
    }
    return ''
  } catch { return '' }
})

// ── Video wallpapers ────────────────────────────────────────────────────────
// Users drop videos (.mp4/.webm) or images (.jpg/.png/.webp/.gif/.avif) into
// userData/wallpapers; we scan + list them. The renderer picks video vs image by ext.
const wallpapersDir = () => {
  const dir = join(app.getPath('userData'), 'wallpapers')
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  return dir
}
ipcMain.handle('wallpapers-dir', () => wallpapersDir())
ipcMain.handle('wallpapers-open', () => shell.openPath(wallpapersDir()))
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
const downloadsDir = () => {
  const dir = join(app.getPath('userData'), 'downloads')
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  return dir
}
ipcMain.handle('downloads-open', () => shell.openPath(downloadsDir()))
ipcMain.handle('download-track', async (event, mode: 'folder' | 'dialog', url: string, filename: string) => {
  if (!isTrustedSender(event)) throw new Error('untrusted sender')
  let dest = join(downloadsDir(), filename)
  if (mode === 'dialog') {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: dest,
      filters: [{ name: 'Audio', extensions: ['mp3'] }],
    })
    if (r.canceled || !r.filePath) return null
    dest = r.filePath
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return dest
})

// ── App version / GitHub releases (update check) ────────────────────────────
const GH_REPO = 'rwxrwz/soundcloud-client'
const RELEASES_TTL = 30 * 60 * 1000 // 30 min — GitHub allows 60 unauthenticated req/h
interface GithubRelease { tag: string; name: string; body: string; date: string; url: string; prerelease: boolean }
let releasesCache: { at: number; data: GithubRelease[] } | null = null

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('get-releases', async (_event, force?: boolean) => {
  if (!force && releasesCache && Date.now() - releasesCache.at < RELEASES_TTL) return releasesCache.data
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SoundCloud-Desktop-Player' },
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

// System: launch the app on Windows login.
// This is a "portable" build: at runtime process.execPath points at the temp
// extraction dir, which is useless for a Run-key entry (it changes each launch).
// electron-builder exposes the real launched .exe in PORTABLE_EXECUTABLE_FILE —
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
})

// Control commands: mini window → main process → main renderer
ipcMain.on('player-control', (_, action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-command', action)
  }
})

// Companion WebSocket bridge: main renderer → main process → WS clients
ipcMain.on('bridge:state', (_, state: BridgeState) => bridgeSetState(state))
ipcMain.on('bridge:progress', (_, p: { position: number; playing: boolean }) => bridgeProgress(p.position, p.playing))
ipcMain.on('bridge:audio', (_, a: { level: number; bass: number }) => bridgeAudio(a.level, a.bass))
ipcMain.on('bridge:spectrum', (_, bars: number[]) => bridgeSpectrum(bars))

// Auth handler: opens SoundCloud signin, waits for login, then grabs credentials automatically
ipcMain.handle('sc-auth', async () => {
  return new Promise<{ clientId: string; oauthToken: string }>((resolve, reject) => {
    const authWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Sign in to SoundCloud — close this window when done',
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
        // Hide instead of close — reuse as SC proxy for DataDome-safe write requests
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

app.on('before-quit', () => { isQuitting = true; stopBridge() })
