import { app, shell, BrowserWindow, screen, type Size } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main.js'
import { PPTDatabase } from './db/database'
import { AgentManager } from './agent'
import { setupIPC } from './ipc'
import { setStyleDb } from './utils/style-skills'
import type { UpdateAvailablePayload } from '@shared/app-update'
import { stopManagedWebSearchService } from './utils/web-search-service'

let mainWindow: BrowserWindow | null = null
let db: PPTDatabase | null = null
let agentManager: AgentManager | null = null
let isShuttingDown = false
let isStoppingWebSearchService = false

const APP_NAME = 'OhMyPPT'
const DEFAULT_WINDOW_WIDTH = 1100
const DEFAULT_WINDOW_HEIGHT = 760
const BASE_MIN_WIDTH = 860
const BASE_MIN_HEIGHT = 680
const TITLEBAR_HEIGHT = 48
const TITLEBAR_BACKGROUND = '#f4eddf'
const TITLEBAR_SYMBOL_COLOR = '#5d6b4d'
const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/arcsin1/oh-my-ppt/releases/latest'
const GITHUB_RELEASES_URL = 'https://github.com/arcsin1/oh-my-ppt/releases'

function resolveWindowBounds(): {
  width: number
  height: number
  minWidth: number
  minHeight: number
  workArea: Size
} {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const maxInitialWidth = Math.max(900, workArea.width - 72)
  const maxInitialHeight = Math.max(620, workArea.height - 88)
  const minWidth = Math.min(BASE_MIN_WIDTH, maxInitialWidth)
  const minHeight = Math.min(BASE_MIN_HEIGHT, maxInitialHeight)
  const width = Math.max(minWidth, Math.min(DEFAULT_WINDOW_WIDTH, maxInitialWidth))
  const height = Math.max(minHeight, Math.min(DEFAULT_WINDOW_HEIGHT, maxInitialHeight))

  return {
    width,
    height,
    minWidth,
    minHeight,
    workArea,
  }
}

function configureLogging(): void {
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 20 * 1024 * 1024
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

  if (is.dev) {
    const logDir = join(process.cwd(), 'logs')
    mkdirSync(logDir, { recursive: true })
    log.transports.file.resolvePathFn = () => join(logDir, 'main.log')
  } else {
    log.transports.file.resolvePathFn = () => {
      const date = new Date()
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return join(
        app.getPath('userData'),
        'ohmyppt_logs',
        `${year}-${month}`,
        `${year}-${month}-${day}-v${app.getVersion()}.log`
      )
    }
  }

  log.initialize()
  log.info('[app] logger initialized', {
    env: is.dev ? 'dev' : 'prod',
    version: app.getVersion(),
    file: log.transports.file.getFile().path,
  })
}

function parseVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
}

function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  const latest = parseVersion(latestVersion)
  const current = parseVersion(currentVersion)
  for (let index = 0; index < Math.max(latest.length, current.length, 3); index += 1) {
    const latestPart = latest[index] ?? 0
    const currentPart = current[index] ?? 0
    if (latestPart > currentPart) return true
    if (latestPart < currentPart) return false
  }
  return false
}

async function fetchLatestRelease(): Promise<UpdateAvailablePayload | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${APP_NAME}/${app.getVersion()}`
      },
      signal: controller.signal
    })
    if (!response.ok) {
      log.warn('[update] latest release request failed', {
        status: response.status,
        statusText: response.statusText
      })
      return null
    }
    const release = (await response.json()) as {
      tag_name?: string
      html_url?: string
      name?: string
      published_at?: string
      draft?: boolean
      prerelease?: boolean
    }
    const latestVersion = String(release.tag_name || '').trim()
    const currentVersion = app.getVersion()
    if (!latestVersion || release.draft || release.prerelease) return null
    if (!isNewerVersion(latestVersion, currentVersion)) return null

    return {
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url || GITHUB_RELEASES_URL,
      releaseName: release.name,
      publishedAt: release.published_at
    }
  } catch (error) {
    log.warn('[update] latest release check failed', {
      message: error instanceof Error ? error.message : String(error)
    })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function scheduleUpdateNotification(window: BrowserWindow): void {
  if (is.dev) return
  window.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void fetchLatestRelease().then((update) => {
        if (!update || window.isDestroyed() || window.webContents.isDestroyed()) return
        log.info('[update] new release available', update)
        window.webContents.send('app:update-available', update)
      })
    }, 2500)
  })
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const preloadPath = join(__dirname, '../preload/index.mjs')
  const windowBounds = resolveWindowBounds()

  const iconPath = join(__dirname, '../../build/icons/512x512.png')
  if (isMac && existsSync(iconPath)) {
    try { app.dock?.setIcon(iconPath); } catch { /* ignore */ }
  }
  const window = new BrowserWindow({
    title: APP_NAME,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: windowBounds.minWidth,
    minHeight: windowBounds.minHeight,
    center: true,
    show: false,
    backgroundColor: TITLEBAR_BACKGROUND,
    autoHideMenuBar: true,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    // Keep native controls and only let the renderer draw the visual titlebar.
    ...(isMac
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 14, y: Math.round((TITLEBAR_HEIGHT - 14) / 2) }
        }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: TITLEBAR_BACKGROUND,
            symbolColor: TITLEBAR_SYMBOL_COLOR,
            height: TITLEBAR_HEIGHT
          }
        }),
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: true
    }
  })
  mainWindow = window

  log.info('[app] creating window', {
    preloadPath,
    contextIsolation: true,
    sandbox: false,
    window: {
      width: windowBounds.width,
      height: windowBounds.height,
      minWidth: windowBounds.minWidth,
      minHeight: windowBounds.minHeight,
      workArea: windowBounds.workArea,
      titlebarHeight: TITLEBAR_HEIGHT,
      titleBarStyle: isMac ? 'hidden' : 'hidden+overlay',
    },
  })

  window.on('ready-to-show', () => {
    window.show()
    // if (is.dev) {
    //   window.webContents.openDevTools({ mode: 'detach' })
    // }
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(async () => {
  configureLogging()

  const dbPath = is.dev ? join(process.cwd(), 'ohmyppt.dev.db') : undefined
  db = new PPTDatabase(dbPath)
  await db.init()
  setStyleDb(db)
  log.info('[app] database initialized', {
    env: is.dev ? 'dev' : 'prod',
    dbPath: dbPath || 'userData/ohmyppt.db',
  })
  agentManager = new AgentManager(db)

  const mainWindow = createWindow()

  if (mainWindow && db && agentManager) {
    setupIPC(mainWindow, db, agentManager)
    scheduleUpdateNotification(mainWindow)
  }

  electronApp.setAppUserModelId('com.ohmyppt.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS 上点 X 只会关闭窗口，不应关闭数据库连接；
  // 否则后续 activate 重开窗口时会命中 CLIENT_CLOSED。
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (isStoppingWebSearchService) {
    return
  }
  if (isShuttingDown) return
  isShuttingDown = true
  isStoppingWebSearchService = true
  event.preventDefault()

  void (async () => {
    try {
      await stopManagedWebSearchService()
    } catch (error) {
      log.warn('[app] failed to stop managed websearch service on before-quit', {
        message: error instanceof Error ? error.message : String(error),
      })
    }

    if (db) {
      try {
        await db.close()
      } catch (error) {
        log.warn('[app] failed to close database on before-quit', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    app.quit()
  })()
})

export { mainWindow, db, agentManager }
