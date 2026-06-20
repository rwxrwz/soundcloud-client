import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen, safeStorage, protocol } from 'electron'
import { join, relative, isAbsolute } from 'path'
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from 'fs'
import { Client } from '@xhayper/discord-rpc'

const ICON_PATH = join(__dirname, '../../buildResources/icon_rounded.ico')

// Create your own app at https://discord.com/developers/applications and paste its
// Application ID here. The app's NAME is shown as "Listening to <name>" in Discord.
const DISCORD_CLIENT_ID = '1380000000000000000'

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let closeToTray = true   // when false, closing the window quits the app
let lastPlayerState: unknown = null
// Hidden SC-context window — kept alive after auth so DataDome cookies stay valid
let scProxy: BrowserWindow | null = null

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

// ── Discord Rich Presence ───────────────────────────────────────────────────
let rpc: Client | null = null
let rpcReady = false
let rpcEnabled = false
let lastRpcKey = ''

interface PState { currentTrack?: { title: string; user?: { username: string } } | null; isPlaying?: boolean }

async function connectRpc(): Promise<void> {
  if (rpc) return
  rpc = new Client({ clientId: DISCORD_CLIENT_ID })
  rpc.on('ready', () => { rpcReady = true; updateDiscordActivity() })
  try {
    await rpc.login()
  } catch {
    // Discord not running / not installed — silently ignore
    rpc = null
    rpcReady = false
  }
}

function disconnectRpc(): void {
  try { rpc?.user?.clearActivity() } catch {}
  try { rpc?.destroy() } catch {}
  rpc = null
  rpcReady = false
  lastRpcKey = ''
}

function updateDiscordActivity(): void {
  if (!rpcEnabled || !rpc || !rpcReady) return
  const s = lastPlayerState as PState | null
  // Dedupe: only push to Discord when the track or play-state changes, not on
  // every progress tick (Discord rate-limits setActivity to ~5 per 20s).
  const key = s?.currentTrack && s.isPlaying ? `${s.currentTrack.title}|${s.isPlaying}` : 'idle'
  if (key === lastRpcKey) return
  lastRpcKey = key
  if (s?.currentTrack && s.isPlaying) {
    rpc.user?.setActivity({
      type: 2, // Listening
      details: s.currentTrack.title?.slice(0, 128) || 'SoundCloud',
      state: s.currentTrack.user?.username ? `— ${s.currentTrack.user.username}`.slice(0, 128) : undefined,
      largeImageKey: 'soundcloud',
      largeImageText: 'SoundCloud',
      instance: false,
    }).catch(() => {})
  } else {
    rpc.user?.clearActivity().catch(() => {})
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
      webSecurity: true
    }
  })

  // With webSecurity on, the renderer's cross-origin reads (api-v2 with an
  // Authorization header → preflight) and media (Web Audio) need permissive CORS.
  // Apply this ONLY to requests from the main window — never to the scProxy window,
  // whose like/playlist writes use credentials:'include' and rely on api-v2's own
  // origin-specific CORS (which '*' would break).
  const mainWcId = mainWindow.webContents.id
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ['*://*.sndcdn.com/*', '*://*.soundcloud.com/*', '*://lrclib.net/*'] },
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
    transparent: true,
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

  tray.on('click', () => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.isVisible() ? miniWindow.hide() : miniWindow.show()
    } else {
      createMiniWindow()
    }
  })

  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Открыть приложение',
        click: () => { mainWindow?.show(); mainWindow?.focus() }
      },
      { type: 'separator' },
      {
        label: 'Закрыть',
        click: () => { isQuitting = true; app.quit() }
      }
    ])
    tray?.popUpContextMenu(menu)
  })
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
  return proxy.webContents.executeJavaScript(code)
})

// ── Secure token storage (OS keychain via safeStorage) ──────────────────────
// Keeps the OAuth token out of localStorage; encrypted at rest with DPAPI/keychain.
const tokenFile = () => join(app.getPath('userData'), 'sc-token.bin')

ipcMain.handle('secure-set-token', (event, token: string) => {
  if (!isTrustedSender(event)) return false
  try {
    if (!token) {
      if (existsSync(tokenFile())) unlinkSync(tokenFile())
      return true
    }
    if (safeStorage.isEncryptionAvailable()) {
      writeFileSync(tokenFile(), safeStorage.encryptString(token))
      return true
    }
    // No OS keychain available — refuse to write the token to disk in the clear.
    // It stays in memory for this session; the user re-authenticates next launch.
    if (existsSync(tokenFile())) unlinkSync(tokenFile())
    return false
  } catch { return false }
})

ipcMain.handle('secure-get-token', (event) => {
  if (!isTrustedSender(event)) return ''
  try {
    if (!existsSync(tokenFile())) return ''
    const buf = readFileSync(tokenFile())
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
    return ''
  } catch { return '' }
})

// ── Video wallpapers ────────────────────────────────────────────────────────
// Users drop .mp4/.webm files into userData/wallpapers; we scan + list them.
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
      .filter(f => /\.(mp4|webm)$/i.test(f))
      .map(f => ({ name: f.replace(/\.[^.]+$/, ''), path: join(wallpapersDir(), f) }))
  } catch { return [] }
})

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

// System: launch the app on Windows login
ipcMain.handle('set-login-item', (event, enabled: boolean) => {
  if (!isTrustedSender(event)) return
  app.setLoginItemSettings({ openAtLogin: !!enabled })
})
ipcMain.handle('get-login-item', () => app.getLoginItemSettings().openAtLogin)

// Discord Rich Presence enable/disable from renderer settings
ipcMain.handle('set-discord-rpc', async (_, enabled: boolean) => {
  rpcEnabled = enabled
  if (enabled) { await connectRpc(); updateDiscordActivity() }
  else disconnectRpc()
})

// State broadcast: main renderer → main process → mini window
ipcMain.on('player-state-update', (_, state) => {
  lastPlayerState = state
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('player-state', state)
  }
  updateDiscordActivity()
})

// Control commands: mini window → main process → main renderer
ipcMain.on('player-control', (_, action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-command', action)
  }
})

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

app.on('before-quit', () => { isQuitting = true; disconnectRpc() })
