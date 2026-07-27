import { app, shell, BrowserWindow, screen, type Size } from 'electron'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main.js'
import dayjs from 'dayjs'
import { PPTDatabase } from './db/database'
import { AgentManager } from './agent'
import { setupIPC, registerLocalAssetProtocol } from './ipc'
import { backfillUserStylePackagesFromDatabase, setStyleDb } from './utils/style-skills'
import {
  initializeSkills,
  resolveBuiltinSkillsSourcePath,
  resolveInstalledSkillsPath,
  setSkillsRuntime,
} from './skills'
import {
  initializeStyles,
  resolveBundledStylesSourcePath,
  resolveInstalledStylesPath,
  setStylesRuntime,
  warmStyleThumbnails
} from './styles'
import { applyProxy } from './utils/proxy'
import { createTray, destroyTray, showTrayHideBalloon } from './tray'
import { isRepeatedRendererCrash, shouldRecoverRenderer } from './renderer-recovery'
import { configureHtmlThumbnailService } from './utils/html-thumbnail-service'
import { initializeCorporateTemplate } from './templates/corporate-template-initializer'
import { CORPORATE_STYLE_KEY, PRODUCT_NAME } from '@shared/brand'

let mainWindow: BrowserWindow | null = null
let db: PPTDatabase | null = null
let agentManager: AgentManager | null = null
let isShuttingDown = false
let isTrayEnabled = false

const APP_NAME = PRODUCT_NAME
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 820
const BASE_MIN_WIDTH = 880
const BASE_MIN_HEIGHT = 680
const TITLEBAR_HEIGHT = 48
const TITLEBAR_BACKGROUND = '#faf8f3'
const TITLEBAR_SYMBOL_COLOR = '#4c4c4c'
const __dirname = dirname(fileURLToPath(import.meta.url))

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

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
      const now = dayjs()
      const yearMonth = now.format('YYYY-MM')
      const yearMonthDay = now.format('YYYY-MM-DD')
      return join(
        app.getPath('userData'),
        'ajjy_ppt_logs',
        yearMonth,
        `${yearMonthDay}-v${app.getVersion()}.log`
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

  window.on('close', (e) => {
    if (process.platform === 'win32' && isTrayEnabled && !isShuttingDown) {
      e.preventDefault()
      window.hide()
      showTrayHideBalloon()
    }
  })

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

  let lastRendererCrashAt = 0
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('[renderer] process gone', details)
    if (isShuttingDown || !shouldRecoverRenderer(details.reason)) return

    const now = Date.now()
    const repeatedCrash = isRepeatedRendererCrash(lastRendererCrashAt, now)
    lastRendererCrashAt = now

    setTimeout(() => {
      if (isShuttingDown || window.isDestroyed() || window.webContents.isDestroyed()) return
      if (!repeatedCrash) {
        window.webContents.reload()
        return
      }

      log.warn('[renderer] repeated crash; recovering at home route')
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
        rendererUrl.hash = '/'
        void window.loadURL(rendererUrl.toString())
      } else {
        void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/' })
      }
    }, 250)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    log.info('[app] second instance requested; focusing existing window')
    showMainWindow()
  })

  app.whenReady().then(async () => {
    configureLogging()
    electronApp.setAppUserModelId('com.szajjy.pptassistant')

    const dbPath = is.dev ? join(process.cwd(), 'ajjy-ppt.dev.db') : undefined
    db = new PPTDatabase(dbPath)
    await db.init()
    configureHtmlThumbnailService(db)
    await db.failInterruptedThumbnailTasks()
    setStyleDb(db)
    log.info('[app] database initialized', {
      env: is.dev ? 'dev' : 'prod',
      dbPath: dbPath || 'userData/ajjy-ppt.db',
    })

    const installedStylesPath = resolveInstalledStylesPath()
    const stylesReadyPromise = initializeStyles({
      bundledSourcePath: resolveBundledStylesSourcePath(),
      installedRootPath: installedStylesPath,
      allowedStyleKeys: new Set([CORPORATE_STYLE_KEY]),
      logger: log
    })
      .then(async (result) => {
        await db?.syncInstalledStylesToDatabase(installedStylesPath)
        const userPackageBackfill = await backfillUserStylePackagesFromDatabase(installedStylesPath)
        const backfill = await db?.backfillSessionStyleSnapshots()
        log.info('[styles] initialized', {
          installedStylesPath,
          bundledCount: result.bundledCount,
          copiedCount: result.copiedCount,
          failedCount: result.failedCount,
          userPackageBackfill,
          snapshotBackfill: backfill
        })
        return result
      })
      .catch((error) => {
        log.warn('[styles] initialize failed', {
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      })
    setStylesRuntime({
      installedStylesPath,
      ready: stylesReadyPromise
    })
    await stylesReadyPromise

    await initializeCorporateTemplate({ logger: log })

    const installedSkillsPath = resolveInstalledSkillsPath()
    const skillsReadyPromise = initializeSkills({
      builtinSourcePath: resolveBuiltinSkillsSourcePath(),
      installedRootPath: installedSkillsPath,
      logger: log,
    })
      .then((result) => {
        log.info('[skills] initialized', {
          installedSkillsPath,
          builtinCount: result.builtinCount,
          copiedCount: result.copiedCount,
          skippedCount: result.skippedCount,
          failedCount: result.failedCount,
        })
        return result
      })
      .catch((error) => {
        log.warn('[skills] initialize failed', {
          message: error instanceof Error ? error.message : String(error),
        })
        return null
      })
    setSkillsRuntime({
      installedSkillsPath,
      ready: skillsReadyPromise,
    })

    agentManager = new AgentManager(db)

    const window = createWindow()

    window.webContents.on('did-finish-load', () => {
      void stylesReadyPromise
        .then(() => db?.listStyleRows() || [])
        .then((styles) => warmStyleThumbnails(installedStylesPath, styles))
        .catch((error) => {
          log.warn('[styles] thumbnail warmup failed', {
            message: error instanceof Error ? error.message : String(error)
          })
        })
    })

    if (process.platform === 'win32') {
      isTrayEnabled = createTray(window)
    }

    registerLocalAssetProtocol()

    if (window && db && agentManager) {
      setupIPC(window, db, agentManager)
      // Apply proxy from saved settings
      try {
        const savedSettings = await db.getAllSettings()
        if (typeof savedSettings.proxy_url === 'string' && savedSettings.proxy_url.trim()) {
          applyProxy(savedSettings.proxy_url.trim())
        }
      } catch (proxyError) {
        log.warn('[app] failed to apply saved proxy', {
          message: proxyError instanceof Error ? proxyError.message : String(proxyError)
        })
      }
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  // Windows: 托盘模式下不退出，用户通过托盘菜单退出
  if (!isTrayEnabled) app.quit()
})

app.on('before-quit', () => {
  if (isShuttingDown) return
  isShuttingDown = true
  destroyTray()
  if (db) {
    void db.close().catch((error) => {
      log.warn('[app] failed to close database on before-quit', {
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }
})

export { mainWindow, db, agentManager }
