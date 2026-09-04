import { app, BrowserWindow } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import log from 'electron-log/main.js'
import { join } from 'path'
import { AgentManager } from '../agent-runtime/agent'
import { PPTDatabase } from '../db/database'
import { configureHtmlThumbnailService } from '../io/thumbnails/html-thumbnail-service'
import { registerLocalAssetProtocol, setupIPC } from '../ipc'
import {
  initializeSkills,
  resolveBuiltinSkillsSourcePath,
  resolveInstalledSkillsPath,
  setSkillsRuntime
} from '../product-skills'
import {
  initializeStyles,
  resolveBundledStylesSourcePath,
  resolveInstalledStylesPath,
  setStylesRuntime,
  warmStyleThumbnails
} from '../styles'
import { backfillUserStylePackagesFromDatabase, setStyleDb } from '../styles/catalog'
import { applyProxy } from '../utils/proxy'
import { configureLogging, scheduleUpdateNotification } from './lifecycle'
import { createTray, destroyTray, showTrayHideBalloon } from './tray'
import { createMainWindow, showMainWindow } from './window'
import { attachWindowControlStateEvents, registerWindowControlHandlers } from './window-controls'

/** Owns the main-process composition state; `index.ts` only wires Electron lifecycle events. */
export class MainApplication {
  private mainWindow: BrowserWindow | null = null
  private db: PPTDatabase | null = null
  private agentManager: AgentManager | null = null
  private isShuttingDown = false
  private isTrayEnabled = false

  focusMainWindow(): void {
    log.info('[app] second instance requested; focusing existing window')
    showMainWindow(this.mainWindow)
  }

  async start(): Promise<void> {
    configureLogging()
    electronApp.setAppUserModelId('com.ohmyppt.app')

    const dbPath = is.dev ? join(process.cwd(), 'ohmyppt.dev.db') : undefined
    this.db = new PPTDatabase(dbPath)
    await this.db.init()
    configureHtmlThumbnailService(this.db)
    await this.db.failInterruptedThumbnailTasks()
    setStyleDb(this.db)
    log.info('[app] database initialized', {
      env: is.dev ? 'dev' : 'prod',
      dbPath: dbPath || 'userData/ohmyppt.db'
    })

    const installedStylesPath = resolveInstalledStylesPath()
    const stylesReadyPromise = initializeStyles({
      bundledSourcePath: resolveBundledStylesSourcePath(),
      installedRootPath: installedStylesPath,
      logger: log
    })
      .then(async (result) => {
        await this.db?.syncInstalledStylesToDatabase(installedStylesPath)
        const userPackageBackfill = await backfillUserStylePackagesFromDatabase(installedStylesPath)
        const backfill = await this.db?.backfillSessionStyleSnapshots()
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
    setStylesRuntime({ installedStylesPath, ready: stylesReadyPromise })
    await stylesReadyPromise

    const installedSkillsPath = resolveInstalledSkillsPath()
    const skillsReadyPromise = initializeSkills({
      builtinSourcePath: resolveBuiltinSkillsSourcePath(),
      installedRootPath: installedSkillsPath,
      logger: log
    })
      .then((result) => {
        log.info('[skills] initialized', {
          installedSkillsPath,
          builtinCount: result.builtinCount,
          copiedCount: result.copiedCount,
          skippedCount: result.skippedCount,
          failedCount: result.failedCount
        })
        return result
      })
      .catch((error) => {
        log.warn('[skills] initialize failed', {
          message: error instanceof Error ? error.message : String(error)
        })
        return null
      })
    setSkillsRuntime({ installedSkillsPath, ready: skillsReadyPromise })

    this.agentManager = new AgentManager()
    const window = this.createWindow()
    window.webContents.on('did-finish-load', () => {
      void stylesReadyPromise
        .then(() => this.db?.listStyleRows() || [])
        .then((styles) => warmStyleThumbnails(installedStylesPath, styles))
        .catch((error) => {
          log.warn('[styles] thumbnail warmup failed', {
            message: error instanceof Error ? error.message : String(error)
          })
        })
    })

    if (process.platform === 'win32') {
      this.isTrayEnabled = createTray(window)
    }

    registerLocalAssetProtocol()
    setupIPC(window, this.db, this.agentManager)
    registerWindowControlHandlers()
    scheduleUpdateNotification(window)

    try {
      const savedSettings = await this.db.getAllSettings()
      if (typeof savedSettings.proxy_url === 'string' && savedSettings.proxy_url.trim()) {
        applyProxy(savedSettings.proxy_url.trim())
      }
    } catch (proxyError) {
      log.warn('[app] failed to apply saved proxy', {
        message: proxyError instanceof Error ? proxyError.message : String(proxyError)
      })
    }

    app.on('browser-window-created', (_, createdWindow) => {
      optimizer.watchWindowShortcuts(createdWindow)
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) this.createWindow()
    })
  }

  handleWindowAllClosed(): void {
    if (process.platform === 'darwin') return
    if (!this.isTrayEnabled) app.quit()
  }

  handleBeforeQuit(): void {
    if (this.isShuttingDown) return
    this.isShuttingDown = true
    destroyTray()
    if (this.db) {
      void this.db.close().catch((error) => {
        log.warn('[app] failed to close database on before-quit', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }

  private createWindow(): BrowserWindow {
    const window = createMainWindow({
      isShuttingDown: () => this.isShuttingDown,
      isTrayEnabled: () => this.isTrayEnabled,
      onHideToTray: showTrayHideBalloon
    })
    attachWindowControlStateEvents(window)
    this.mainWindow = window
    return window
  }
}
