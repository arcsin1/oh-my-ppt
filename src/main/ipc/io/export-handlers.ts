import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import log from 'electron-log/main.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { is } from '@electron-toolkit/utils'
import { nanoid } from 'nanoid'
import { zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import type { IpcContext } from '../context'
import { resolveOutlinesForPages } from '../session/page-outline-utils'
import {
  writeHtmlToPptx,
  collectEmbeddedFonts,
  type HtmlToPptxEmbeddedFont,
  type HtmlToPptxSlide
} from '../../utils/html-pptx'
import {
  captureHtmlPageToPptxImageSlide,
  extractHtmlPageToPptxSlide
} from '../../utils/html-pptx/renderer'
import {
  exportHtmlPagesToVideo,
  normalizeVideoExportFps,
  normalizeVideoExportSecondsPerPage
} from '../../utils/html-video/exporter'

type PptxExportPayload = {
  sessionId?: unknown
  imageOnly?: unknown
  embedFonts?: unknown
  pageId?: unknown
  fps?: unknown
  captureFps?: unknown
  secondsPerPage?: unknown
}

const parseSessionId = (payload: unknown): string => {
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as PptxExportPayload).sessionId === 'string'
  ) {
    return String((payload as { sessionId?: string }).sessionId).trim()
  }
  return typeof payload === 'string' ? payload.trim() : ''
}

const parseImageOnly = (payload: unknown): boolean =>
  Boolean(
    payload && typeof payload === 'object' && (payload as PptxExportPayload).imageOnly === true
  )

const parseFontEmbedMode = (payload: unknown): 'auto' | 'always' | 'never' => {
  if (!payload || typeof payload !== 'object') return 'always'
  const value = (payload as PptxExportPayload).embedFonts
  if (value === true || value === 'always') return 'always'
  if (value === false || value === 'never') return 'never'
  if (value === 'auto') return 'auto'
  return 'always'
}

const parseExportPageId = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return ''
  const value = (payload as PptxExportPayload).pageId
  return typeof value === 'string' ? value.trim() : ''
}

const sanitizeExportBaseName = (value: string, fallback: string): string =>
  value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || fallback

const buildOutlinesMarkdown = (args: {
  title: string
  pages: Array<{ id: string; page_number: number; title: string }>
  outlines: Map<string, string | null>
}): string => {
  const sections = args.pages.map((page) => {
    const pageTitle = String(page.title || `P${page.page_number}`).trim()
    const outline = String(args.outlines.get(page.id) || '').trim()
    return [`## P${page.page_number}. ${pageTitle}`, outline].filter(Boolean).join('\n\n')
  })
  return [`# ${args.title}`, ...sections].filter(Boolean).join('\n\n').trim() + '\n'
}

const isSameOrChildPath = async (candidatePath: string, parentPath: string): Promise<boolean> => {
  const resolveRealPath = async (value: string): Promise<string> =>
    fs.promises.realpath(value).catch(() => path.resolve(value))

  const candidate = path.resolve(await resolveRealPath(candidatePath))
  const parent = path.resolve(await resolveRealPath(parentPath))
  const relative = path.relative(parent, candidate)

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const buildPngFileName = (pageNumber: number, title: string | undefined): string => {
  const paddedNumber = String(pageNumber).padStart(2, '0')
  const sanitizedTitle = sanitizeExportBaseName(String(title || '').trim(), `page-${paddedNumber}`)
  return `${paddedNumber}-${sanitizedTitle}.png`
}

const collectDirectoryZipFiles = (
  dir: string,
  prefix: string,
  zipFiles: Record<string, Uint8Array>
): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      collectDirectoryZipFiles(fullPath, zipPath, zipFiles)
    } else if (entry.isFile()) {
      zipFiles[zipPath] = fs.readFileSync(fullPath)
    }
  }
}

const sanitizeMacBundleExecutableName = (value: string): string => {
  const sanitized = value.replace(/[/:]/g, '').trim()
  return sanitized || 'slides'
}

const sanitizeMacBundleIdentifierPart = (value: string): string => {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || 'slides'
}

const escapeXmlText = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const buildMacInfoPlist = (appName: string, executableName: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${escapeXmlText(executableName)}</string>
  <key>CFBundleIdentifier</key>
  <string>com.ohmyppt.slidepack.${sanitizeMacBundleIdentifierPart(appName)}</string>
  <key>CFBundleName</key>
  <string>${escapeXmlText(appName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
</dict>
</plist>
`

const collectMacAppZipFiles = (
  appRoot: string,
  appName: string,
  zipFiles: Record<string, Uint8Array | [Uint8Array, unknown]>,
  currentDir = appRoot
): void => {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name)
    const relativePath = path.relative(appRoot, fullPath).split(path.sep).join('/')
    const zipPath = `${appName}.app/${relativePath}`
    if (entry.isDirectory()) {
      collectMacAppZipFiles(appRoot, appName, zipFiles, fullPath)
    } else if (entry.isFile()) {
      const mode = fs.statSync(fullPath).mode & 0o777
      zipFiles[zipPath] = [
        fs.readFileSync(fullPath),
        { os: 3, attrs: (mode || 0o644) << 16 }
      ]
    }
  }
}

const writeMacAppZip = (
  outputPath: string,
  appName: string,
  viewerPath: string,
  slidesZipData: Uint8Array
): void => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohmyppt-slide-pack-app-'))
  try {
    const appRoot = path.join(tempDir, `${appName}.app`)
    const macosDir = path.join(appRoot, 'Contents', 'MacOS')
    const resourcesDir = path.join(appRoot, 'Contents', 'Resources')
    fs.mkdirSync(macosDir, { recursive: true })
    fs.mkdirSync(resourcesDir, { recursive: true })

    const executableName = sanitizeMacBundleExecutableName(appName)
    const executablePath = path.join(macosDir, executableName)
    fs.copyFileSync(viewerPath, executablePath)
    fs.chmodSync(executablePath, 0o755)
    fs.writeFileSync(path.join(resourcesDir, 'slides.zip'), Buffer.from(slidesZipData))
    fs.writeFileSync(
      path.join(appRoot, 'Contents', 'Info.plist'),
      buildMacInfoPlist(appName, executableName),
      'utf-8'
    )

    if (process.platform === 'darwin') {
      try {
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appRoot], {
          stdio: 'pipe'
        })
      } catch (error) {
        log.warn('[export:slidePack] codesign failed, continuing with unsigned app bundle', {
          appName,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (process.platform === 'darwin') {
      execFileSync('ditto', ['-c', '-k', '--keepParent', `${appName}.app`, outputPath], {
        cwd: tempDir,
        stdio: 'pipe'
      })
      return
    }

    const zipFiles: Record<string, Uint8Array | [Uint8Array, unknown]> = {}
    collectMacAppZipFiles(appRoot, appName, zipFiles)
    fs.writeFileSync(outputPath, Buffer.from(zipSync(zipFiles as Record<string, Uint8Array>)))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

export function registerExportHandlers(ctx: IpcContext): void {
  const {
    mainWindow,
    db,
    resolveSessionPageFiles,
    renderPageToPdfBuffer,
    waitForPrintReadySignal,
    EXPORT_PAGE_READY_TIMEOUT_MS,
    EXPORT_CAPTURE_SETTLE_MS
  } = ctx

  ipcMain.handle('export:pdf', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const { session, pages, projectDir } = await resolveSessionPageFiles(sessionId)
    const sessionTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const sanitizedBaseName = sanitizeExportBaseName(sessionTitle, `ohmyppt-${sessionId}`)

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: '导出 PDF',
      defaultPath: path.join(path.dirname(projectDir), `${sanitizedBaseName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    const warnings: string[] = []
    try {
      const mergedPdf = await PDFDocument.create()
      const pdfPageWidth = 16 * 72
      const pdfPageHeight = 9 * 72

      for (const page of pages) {
        log.info('[export:pdf] render page', {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath
        })
        const rendered = await renderPageToPdfBuffer({
          page,
          timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS
        })
        if (rendered.warning) warnings.push(rendered.warning)
        const embeddedImage = await mergedPdf.embedPng(rendered.pngBuffer)
        const pageDoc = mergedPdf.addPage([pdfPageWidth, pdfPageHeight])
        pageDoc.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: pdfPageWidth,
          height: pdfPageHeight
        })
      }

      const outputBytes = await mergedPdf.save()
      await fs.promises.writeFile(saveResult.filePath, outputBytes)
      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:pdf] completed', {
        sessionId,
        pageCount: pages.length,
        filePath: saveResult.filePath,
        warningCount: warnings.length
      })
      shell.showItemInFolder(saveResult.filePath)
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: pages.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:pdf] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  ipcMain.handle('export:png', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const { pages, projectDir } = await resolveSessionPageFiles(sessionId)

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const directoryResult = await dialog.showOpenDialog(ownerWindow, {
      title: '选择 PNG 导出目录',
      defaultPath: path.dirname(projectDir),
      buttonLabel: '导出到此目录',
      properties: ['openDirectory', 'createDirectory']
    })

    if (directoryResult.canceled || directoryResult.filePaths.length === 0) {
      return { success: false, cancelled: true }
    }

    const outputParentDir = directoryResult.filePaths[0]
    const outputDir = path.join(outputParentDir, `ohmyppt-export-image_${nanoid(8)}`)
    const warnings: string[] = []

    try {
      await fs.promises.mkdir(outputDir, { recursive: true })
      for (const page of pages) {
        log.info('[export:png] render page', {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath
        })
        const rendered = await renderPageToPdfBuffer({
          page,
          timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS
        })
        if (rendered.warning) warnings.push(rendered.warning)
        await fs.promises.writeFile(
          path.join(outputDir, buildPngFileName(page.pageNumber, page.title)),
          rendered.pngBuffer
        )
      }

      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:png] completed', {
        sessionId,
        pageCount: pages.length,
        directoryPath: outputDir,
        warningCount: warnings.length
      })
      shell.openPath(outputDir).catch(() => {
        shell.showItemInFolder(outputDir)
      })
      return {
        success: true,
        cancelled: false,
        path: outputDir,
        pageCount: pages.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:png] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  ipcMain.handle('export:pptx', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }
    const imageOnly = parseImageOnly(payload)
    const fontEmbedMode = imageOnly ? 'never' : parseFontEmbedMode(payload)
    const requestedPageId = parseExportPageId(payload)

    const { session, pages: allPages, projectDir } = await resolveSessionPageFiles(sessionId)
    const pages = requestedPageId
      ? allPages.filter((page) => page.id === requestedPageId)
      : allPages
    if (requestedPageId && pages.length === 0) {
      throw new Error(`页面不存在：${requestedPageId}`)
    }
    const sessionTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const prefix = imageOnly ? '【Image】' : '【Edit】'
    const singlePage = requestedPageId && pages.length === 1 ? pages[0] : null
    const singlePageTitle = singlePage
      ? singlePage.title.trim() || `P${String(singlePage.pageNumber).padStart(2, '0')}`
      : ''
    const sanitizedBaseName = sanitizeExportBaseName(
      singlePage ? `${prefix}${singlePageTitle}` : `${prefix}${sessionTitle}`,
      `ohmyppt-${sessionId}`
    )

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: '导出 PPTX',
      defaultPath: path.join(path.dirname(projectDir), `${sanitizedBaseName}.pptx`),
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    const warnings: string[] = []

    try {
      const slides: HtmlToPptxSlide[] = []
      for (const page of pages) {
        const mode = imageOnly ? 'image' : 'editable'
        log.info('[export:pptx] extract page', {
          sessionId,
          sessionPageId: page.id,
          pageId: page.pageId,
          htmlPath: page.htmlPath,
          mode,
          singlePage: Boolean(requestedPageId)
        })
        const extracted = imageOnly
          ? await captureHtmlPageToPptxImageSlide({
              page,
              timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS,
              settleMs: EXPORT_CAPTURE_SETTLE_MS,
              waitForPrintReadySignal
            })
          : await extractHtmlPageToPptxSlide({
              page,
              timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS,
              settleMs: EXPORT_CAPTURE_SETTLE_MS,
              waitForPrintReadySignal
            })
        slides.push(extracted.slide)
        if (extracted.warning) warnings.push(extracted.warning)
      }

      if (!imageOnly) {
        const pagesWithoutText = slides.filter((s) => s.texts.length === 0).length
        if (pagesWithoutText > 0) {
          warnings.push(`${pages.length} 页中有 ${pagesWithoutText} 页未提取到可编辑文本。`)
        }
      }

      // Collect embedded fonts (editable mode only). The user-facing behavior is
      // always "try to include fonts"; fallback is internal compatibility handling.
      let embeddedFonts: HtmlToPptxEmbeddedFont[] = []
      if (!imageOnly) {
        try {
          embeddedFonts = await collectEmbeddedFonts(projectDir, slides, {
            mode: fontEmbedMode,
            maxTotalBytes: 20 * 1024 * 1024
          })
        } catch (error) {
          log.warn('[export:pptx] font embedding collection failed, fallback to system fonts', {
            sessionId,
            message: error instanceof Error ? error.message : String(error)
          })
          warnings.push('字体嵌入失败，已自动改用 PowerPoint 本机字体导出。')
        }
      }

      try {
        await writeHtmlToPptx(saveResult.filePath, {
          title: sessionTitle,
          author: 'OhMyPPT',
          slides,
          embeddedFonts: embeddedFonts.length > 0 ? embeddedFonts : undefined
        })
      } catch (error) {
        if (embeddedFonts.length === 0) throw error
        log.warn('[export:pptx] write with embedded fonts failed, retry without fonts', {
          sessionId,
          message: error instanceof Error ? error.message : String(error)
        })
        warnings.push('字体嵌入写入失败，已自动降级为 PowerPoint 本机字体导出。')
        embeddedFonts = []
        await writeHtmlToPptx(saveResult.filePath, {
          title: sessionTitle,
          author: 'OhMyPPT',
          slides
        })
      }
      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:pptx] completed', {
        sessionId,
        pageCount: slides.length,
        filePath: saveResult.filePath,
        warningCount: warnings.length,
        imageOnly,
        sessionPageId: requestedPageId || undefined,
        fontEmbedMode,
        embeddedFontCount: embeddedFonts.length
      })
      shell.showItemInFolder(saveResult.filePath)
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: slides.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:pptx] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  ipcMain.handle('export:video', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }
    const requestedPageId = parseExportPageId(payload)
    const fps = normalizeVideoExportFps(
      payload && typeof payload === 'object' ? (payload as PptxExportPayload).fps : undefined
    )
    const secondsPerPage = normalizeVideoExportSecondsPerPage(
      payload && typeof payload === 'object'
        ? (payload as PptxExportPayload).secondsPerPage
        : undefined
    )

    const { session, pages: allPages, projectDir } = await resolveSessionPageFiles(sessionId)
    const pages = requestedPageId
      ? allPages.filter((page) => page.id === requestedPageId)
      : allPages
    if (requestedPageId && pages.length === 0) {
      throw new Error(`页面不存在：${requestedPageId}`)
    }
    const sessionTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const singlePage = requestedPageId && pages.length === 1 ? pages[0] : null
    const singlePageTitle = singlePage
      ? singlePage.title.trim() || `P${String(singlePage.pageNumber).padStart(2, '0')}`
      : ''
    const sanitizedBaseName = sanitizeExportBaseName(
      singlePage ? `【Video】${singlePageTitle}` : `【Video】${sessionTitle}`,
      `ohmyppt-${sessionId}`
    )

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: '导出视频',
      defaultPath: path.join(path.dirname(projectDir), `${sanitizedBaseName}.mp4`),
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    try {
      log.info('[export:video] starting', {
        sessionId,
        pageCount: pages.length,
        filePath: saveResult.filePath,
        fps,
        secondsPerPage,
        sessionPageId: requestedPageId || undefined
      })
      const exported = await exportHtmlPagesToVideo({
        pages,
        outputPath: saveResult.filePath,
        tempRootDir: path.dirname(projectDir),
        fps,
        captureFps:
          payload && typeof payload === 'object'
            ? normalizeVideoExportFps((payload as PptxExportPayload).captureFps)
            : undefined,
        secondsPerPage,
        timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS,
        settleMs: EXPORT_CAPTURE_SETTLE_MS,
        waitForPrintReadySignal
      })
      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:video] completed', {
        sessionId,
        pageCount: exported.pageCount,
        frameCount: exported.frameCount,
        durationMs: exported.durationMs,
        filePath: saveResult.filePath,
        warningCount: exported.warnings.length
      })
      shell.showItemInFolder(saveResult.filePath)
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: exported.pageCount,
        durationMs: exported.durationMs,
        frameCount: exported.frameCount,
        warnings: exported.warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:video] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  ipcMain.handle('export:outlinesMarkdown', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const { session, projectDir } = await resolveSessionPageFiles(sessionId)
    const pages = await db.listSessionPages(sessionId)
    if (pages.length === 0) {
      throw new Error('没有可导出的大纲页面')
    }
    const outlines = await resolveOutlinesForPages(db, sessionId, pages)
    const rawTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const baseName = sanitizeExportBaseName(`${rawTitle}-大纲`, `ohmyppt-${sessionId}-outline`)
    const content = buildOutlinesMarkdown({
      title: rawTitle,
      pages,
      outlines
    })

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: '导出大纲',
      defaultPath: path.join(path.dirname(projectDir), `${baseName}.md`),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] }
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    try {
      await fs.promises.writeFile(saveResult.filePath, content, 'utf-8')
      log.info('[export:outlinesMarkdown] completed', {
        sessionId,
        filePath: saveResult.filePath,
        byteLength: Buffer.byteLength(content, 'utf-8')
      })
      shell.showItemInFolder(saveResult.filePath)
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        warnings: []
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:outlinesMarkdown] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  // Export: slide-pack (standalone executable with embedded slides)
  ipcMain.handle('export:slidePack', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) throw new Error('Missing sessionId')

    try {
      const { session, projectDir } = await resolveSessionPageFiles(sessionId)

      // Find pre-compiled viewer binary in resources
      const resourcesDir = is.dev
        ? path.join(process.cwd(), 'resources')
        : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')

      const targets = [
        { platform: 'macos-arm64', bin: 'slide-pack-darwin-arm64', ext: '', os: 'darwin', arch: 'arm64' },
        { platform: 'macos-amd64', bin: 'slide-pack-darwin-amd64', ext: '', os: 'darwin', arch: 'x64' },
        { platform: 'windows-amd64', bin: 'slide-pack-windows-amd64.exe', ext: '.exe', os: 'win32', arch: 'x64' }
      ]

      const rawTitle = typeof session.title === 'string' && session.title.trim() ? session.title.trim() : 'slides'
      const sessionName = sanitizeExportBaseName(rawTitle, 'slides')

      // Let user choose save directory
      const ownerWindow =
        BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
      const saveResult = await dialog.showOpenDialog(ownerWindow, {
        title: '选择打包导出目录',
        defaultPath: path.dirname(projectDir),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '导出到此目录'
      })
      if (saveResult.canceled || !saveResult.filePaths[0]) {
        return { success: false, cancelled: true }
      }

      const outputParentDir = saveResult.filePaths[0]
      if (await isSameOrChildPath(outputParentDir, projectDir)) {
        throw new Error('打包导出目录不能选择当前会话目录或其子目录，请选择会话目录外的位置。')
      }

      // Create output folder
      const outputFolder = path.join(outputParentDir, `ohmyppt-${nanoid(8)}`)
      fs.mkdirSync(outputFolder, { recursive: true })

      log.info('[export:slidePack] starting', { sessionId, projectDir, outputFolder })

      // ZIP all slides
      const zipFiles: Record<string, Uint8Array> = {}
      const collectFiles = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue
          const fullPath = path.join(dir, entry.name)
          const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            collectFiles(fullPath, zipPath)
          } else {
            zipFiles[zipPath] = fs.readFileSync(fullPath)
          }
        }
      }
      collectFiles(projectDir, '')
      const zipData = zipSync(zipFiles)

      log.info('[export:slidePack] zip created', { fileCount: Object.keys(zipFiles).length, zipSize: zipData.byteLength })

      const generatedFiles: string[] = []

      // macOS uses an app bundle with slides.zip in Resources; Windows keeps the trailer format.
      for (const t of targets) {
        const viewerPath = path.join(resourcesDir, t.bin)
        if (!fs.existsSync(viewerPath)) {
          log.warn('[export:slidePack] skip platform, viewer not found', { bin: t.bin })
          continue
        }

        if (t.os === 'darwin') {
          const appName = `${sessionName}-${t.platform}`
          const zipOutputName = `${appName}.app.zip`
          writeMacAppZip(path.join(outputFolder, zipOutputName), appName, viewerPath, zipData)
          generatedFiles.push(zipOutputName)
        } else {
          const viewerData = fs.readFileSync(viewerPath)
          const outputName = `${sessionName}-${t.platform}${t.ext}`

          // Trailer: uint64 LE = ZIP data length
          const trailer = Buffer.alloc(8)
          trailer.writeBigUInt64LE(BigInt(zipData.byteLength))

          const output = Buffer.concat([viewerData, Buffer.from(zipData), trailer])
          const outputPath = path.join(outputFolder, outputName)
          fs.writeFileSync(outputPath, output)
          fs.chmodSync(outputPath, 0o755)
          generatedFiles.push(outputName)
        }
      }

      // Write README.txt
      const readmeContent = `演示文稿预览包
================

双击对应平台的文件即可在浏览器中打开演示。

文件说明：
  *-macos-arm64.app.zip     → Apple Silicon Mac (M1/M2/M3/M4)
  *-macos-amd64.app.zip     → Intel Mac
  *-windows-amd64.exe       → Windows 电脑

使用方法：
  macOS：先解压 .app.zip，再双击 .app 打开
  Windows：双击 .exe 文件打开
  如果提示"无法打开"，请右键 → 打开 → 确认打开

打开后会自动启动浏览器显示演示。
关闭终端窗口或按 Ctrl+C 即可停止。
`
      fs.writeFileSync(path.join(outputFolder, 'README.txt'), readmeContent, 'utf-8')

      if (generatedFiles.length === 0) {
        throw new Error('No viewer binaries found in resources/')
      }

      await shell.openPath(outputFolder)

      log.info('[export:slidePack] completed', { sessionId, outputFolder, files: generatedFiles })

      return {
        success: true,
        path: path.join(outputFolder, generatedFiles[0]),
        cancelled: false,
        pageCount: generatedFiles.length,
        warnings: []
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:slidePack] failed', { sessionId, message })
      throw error
    }
  })

  ipcMain.handle('export:sessionZip', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) throw new Error('Missing sessionId')

    try {
      const { session, projectDir } = await resolveSessionPageFiles(sessionId)
      const rawTitle =
        typeof session.title === 'string' && session.title.trim()
          ? session.title.trim()
          : `ohmyppt-${sessionId}`
      const sessionName = sanitizeExportBaseName(rawTitle, `ohmyppt-${sessionId}`)

      const ownerWindow =
        BrowserWindow.fromWebContents(event.sender) ??
        BrowserWindow.getFocusedWindow() ??
        mainWindow
      const saveResult = await dialog.showSaveDialog(ownerWindow, {
        title: '导出 ZIP 会话文件包',
        defaultPath: path.join(path.dirname(projectDir), `${sessionName}-session.zip`),
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, cancelled: true }
      }

      if (await isSameOrChildPath(saveResult.filePath, projectDir)) {
        throw new Error('ZIP 会话文件包不能导出到当前会话目录或其子目录，请选择会话目录外的位置。')
      }

      log.info('[export:sessionZip] starting', {
        sessionId,
        projectDir,
        filePath: saveResult.filePath
      })

      const zipRootName = `ohmyppt-session-${sessionName}`
      const zipFiles: Record<string, Uint8Array> = {}
      collectDirectoryZipFiles(projectDir, zipRootName, zipFiles)
      const zipData = zipSync(zipFiles)
      await fs.promises.writeFile(saveResult.filePath, Buffer.from(zipData))

      log.info('[export:sessionZip] completed', {
        sessionId,
        filePath: saveResult.filePath,
        fileCount: Object.keys(zipFiles).length,
        zipSize: zipData.byteLength
      })
      shell.showItemInFolder(saveResult.filePath)

      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: Object.keys(zipFiles).length,
        warnings: []
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:sessionZip] failed', { sessionId, message })
      throw error
    }
  })
}
