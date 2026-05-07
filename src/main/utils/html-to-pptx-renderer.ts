import { BrowserWindow, type NativeImage } from 'electron'
import log from 'electron-log/main.js'
import { pathToFileURL } from 'url'
import {
  buildHtmlToPptxExtractScript,
  normalizeExtractedHtmlToPptxSlide,
  type HtmlToPptxSlide,
  type HtmlToPptxTextBox
} from './html-to-pptx'
import {
  FREEZE_PAGE_FOR_PPTX_SCRIPT,
  HIDE_ELEMENTS_FOR_PPTX_BACKGROUND_SCRIPT,
  HIDE_TEXT_FOR_PPTX_BACKGROUND_SCRIPT,
  WAIT_FOR_PPTX_CAPTURE_FRAME_SCRIPT
} from './html-to-pptx-browser-scripts'

export interface HtmlPageForPptx {
  htmlPath: string
  pageId: string
  title?: string
}

export interface HtmlPageToPptxSlideOptions {
  page: HtmlPageForPptx
  timeoutMs: number
  settleMs: number
  waitForPrintReadySignal: (args: {
    win: BrowserWindow
    pageId: string
    timeoutMs: number
  }) => Promise<{ timedOut: boolean }>
  exportImages?: boolean
  exportShapes?: boolean
}

export interface HtmlPageToPptxSlideResult {
  slide: HtmlToPptxSlide
  warning?: string
}

const PPTX_CAPTURE_WIDTH = 1600
const PPTX_CAPTURE_HEIGHT = 900
const PPTX_SLIDE_WIDTH_IN = 13.333
const PPTX_SLIDE_HEIGHT_IN = 7.5
const PPTX_BACKGROUND_CAPTURE_ATTEMPTS = 3
const TEXT_RESIDUE_MAX_BOXES = 24
const TEXT_RESIDUE_GRID_COLUMNS = 18
const TEXT_RESIDUE_GRID_ROWS = 10
const TEXT_RESIDUE_COLOR_DISTANCE = 62
const TEXT_RESIDUE_RATIO_THRESHOLD = 0.075

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const parseHexColor = (value?: string): { r: number; g: number; b: number } | null => {
  const normalized = String(value || '')
    .trim()
    .replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(normalized)) {
    const [r, g, b] = normalized.split('').map((char) => Number.parseInt(`${char}${char}`, 16))
    return { r, g, b }
  }
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  }
}

const colorDistance = (
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number }
): number => {
  const dr = left.r - right.r
  const dg = left.g - right.g
  const db = left.b - right.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

const pixelMatchesTextColor = (
  bitmap: Buffer,
  index: number,
  target: { r: number; g: number; b: number }
): boolean => {
  const b = bitmap[index] ?? 0
  const g = bitmap[index + 1] ?? 0
  const r = bitmap[index + 2] ?? 0
  return colorDistance({ r, g, b }, target) <= TEXT_RESIDUE_COLOR_DISTANCE
}

const hasTextResidueInCapture = (
  image: NativeImage,
  texts: HtmlToPptxTextBox[]
): { suspicious: boolean; checkedBoxes: number; maxRatio: number } => {
  if (texts.length === 0) return { suspicious: false, checkedBoxes: 0, maxRatio: 0 }
  const size = image.getSize()
  const bitmap = image.toBitmap()
  if (!size.width || !size.height || bitmap.length < size.width * size.height * 4) {
    return { suspicious: false, checkedBoxes: 0, maxRatio: 0 }
  }
  const pxPerInX = size.width / PPTX_SLIDE_WIDTH_IN
  const pxPerInY = size.height / PPTX_SLIDE_HEIGHT_IN
  const candidates = texts
    .filter((text) => {
      const color = parseHexColor(text.color)
      return Boolean(
        color &&
          text.text.trim().length >= 2 &&
          text.w > 0.05 &&
          text.h > 0.03 &&
          (text.opacity ?? 1) > 0.05
      )
    })
    .sort((a, b) => b.fontSize * b.w * b.h - a.fontSize * a.w * a.h)
    .slice(0, TEXT_RESIDUE_MAX_BOXES)

  let checkedBoxes = 0
  let maxRatio = 0
  for (const text of candidates) {
    const target = parseHexColor(text.color)
    if (!target) continue
    const left = Math.max(0, Math.floor(text.x * pxPerInX))
    const top = Math.max(0, Math.floor(text.y * pxPerInY))
    const right = Math.min(size.width - 1, Math.ceil((text.x + text.w) * pxPerInX))
    const bottom = Math.min(size.height - 1, Math.ceil((text.y + text.h) * pxPerInY))
    const width = right - left
    const height = bottom - top
    if (width < 4 || height < 4) continue

    checkedBoxes += 1
    let samples = 0
    let textLikePixels = 0
    const columns = Math.min(TEXT_RESIDUE_GRID_COLUMNS, Math.max(3, Math.floor(width / 3)))
    const rows = Math.min(TEXT_RESIDUE_GRID_ROWS, Math.max(3, Math.floor(height / 3)))
    for (let row = 0; row < rows; row += 1) {
      const y = Math.min(bottom, top + Math.floor(((row + 0.5) * height) / rows))
      for (let column = 0; column < columns; column += 1) {
        const x = Math.min(right, left + Math.floor(((column + 0.5) * width) / columns))
        const index = (y * size.width + x) * 4
        samples += 1
        if (pixelMatchesTextColor(bitmap, index, target)) {
          textLikePixels += 1
        }
      }
    }
    if (samples === 0) continue
    const ratio = textLikePixels / samples
    maxRatio = Math.max(maxRatio, ratio)
    if (textLikePixels >= 8 && ratio >= TEXT_RESIDUE_RATIO_THRESHOLD) {
      return { suspicious: true, checkedBoxes, maxRatio }
    }
  }

  return { suspicious: false, checkedBoxes, maxRatio }
}

const capturePptxBackgroundWithRetry = async (
  win: BrowserWindow,
  pageId: string,
  texts: HtmlToPptxTextBox[],
  hideScript?: string
): Promise<{ image: NativeImage; warning?: string }> => {
  let lastImage: NativeImage | null = null
  let lastCheck: ReturnType<typeof hasTextResidueInCapture> | null = null
  const script = hideScript || HIDE_TEXT_FOR_PPTX_BACKGROUND_SCRIPT

  for (let attempt = 1; attempt <= PPTX_BACKGROUND_CAPTURE_ATTEMPTS; attempt += 1) {
    await win.webContents.executeJavaScript(script, true)
    await win.webContents.executeJavaScript(WAIT_FOR_PPTX_CAPTURE_FRAME_SCRIPT, true)
    await sleep(process.platform === 'win32' ? 180 : 80)
    await win.webContents.executeJavaScript(WAIT_FOR_PPTX_CAPTURE_FRAME_SCRIPT, true)

    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: PPTX_CAPTURE_WIDTH,
      height: PPTX_CAPTURE_HEIGHT
    })
    const check = hasTextResidueInCapture(image, texts)
    lastImage = image
    lastCheck = check
    if (!check.suspicious) {
      if (attempt > 1) {
        log.info('[export:pptx] background capture recovered after retry', {
          pageId,
          attempt,
          checkedBoxes: check.checkedBoxes,
          maxRatio: Number(check.maxRatio.toFixed(3))
        })
      }
      return { image }
    }

    log.warn('[export:pptx] background capture text residue detected', {
      pageId,
      attempt,
      checkedBoxes: check.checkedBoxes,
      maxRatio: Number(check.maxRatio.toFixed(3))
    })
  }

  if (!lastImage) {
    throw new Error(`PPTX background capture failed for ${pageId}`)
  }
  return {
    image: lastImage,
    warning: `页面 ${pageId} 背景截图可能仍有文字残影，已使用最后一次截图。${
      lastCheck ? `检测比率 ${Number(lastCheck.maxRatio.toFixed(3))}` : ''
    }`
  }
}

export const extractHtmlPageToPptxSlide = async ({
  page,
  timeoutMs,
  settleMs,
  waitForPrintReadySignal,
  exportImages = true,
  exportShapes = true
}: HtmlPageToPptxSlideOptions): Promise<HtmlPageToPptxSlideResult> => {
  const win = new BrowserWindow({
    show: false,
    width: PPTX_CAPTURE_WIDTH,
    height: PPTX_CAPTURE_HEIGHT,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: false
    }
  })

  try {
    win.webContents.setZoomFactor(1)
    win.setContentSize(PPTX_CAPTURE_WIDTH, PPTX_CAPTURE_HEIGHT)

    const pageUrl = new URL(pathToFileURL(page.htmlPath).toString())
    pageUrl.searchParams.set('fit', 'off')
    pageUrl.searchParams.set('print', '1')
    pageUrl.searchParams.set('export', '1')
    pageUrl.searchParams.set('pageId', page.pageId)
    pageUrl.searchParams.set('printTimeoutMs', String(timeoutMs))
    pageUrl.searchParams.set('_ts', String(Date.now()))

    const readyWaitPromise = waitForPrintReadySignal({
      win,
      pageId: page.pageId,
      timeoutMs
    })

    await win.loadURL(pageUrl.toString())
    await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_PPTX_SCRIPT, true)
    const readyResult = await readyWaitPromise
    if (readyResult.timedOut) {
      log.warn('[export:pptx] a print rc ready timeout sin1', {
        pageId: page.pageId,
        htmlPath: page.htmlPath,
        timeoutMs
      })
    }

    await sleep(settleMs)
    await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_PPTX_SCRIPT, true)
    await sleep(450)
    await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_PPTX_SCRIPT, true)
    await sleep(80)

    const maxShapes = exportShapes ? 80 : 0
    const maxImages = exportImages ? 40 : 0
    const extracted = await win.webContents.executeJavaScript(
      buildHtmlToPptxExtractScript({
        pageWidthPx: PPTX_CAPTURE_WIDTH,
        pageHeightPx: PPTX_CAPTURE_HEIGHT,
        maxShapes,
        maxImages
      }),
      true
    )

    const slide = normalizeExtractedHtmlToPptxSlide(extracted, page.title)

    const hideScript = (exportImages || exportShapes)
      ? HIDE_ELEMENTS_FOR_PPTX_BACKGROUND_SCRIPT
      : HIDE_TEXT_FOR_PPTX_BACKGROUND_SCRIPT
    const backgroundCapture = await capturePptxBackgroundWithRetry(win, page.pageId, slide.texts, hideScript)
    const backgroundPng = backgroundCapture.image.toPNG()
    slide.backgroundImage = {
      dataUri: `data:image/png;base64,${backgroundPng.toString('base64')}`,
      mimeType: 'image/png',
      x: 0,
      y: 0,
      w: PPTX_SLIDE_WIDTH_IN,
      h: PPTX_SLIDE_HEIGHT_IN,
      alt: page.title
    }

    if (!exportShapes) {
      slide.shapes = []
    }
    if (!exportImages) {
      slide.images = []
    }

    return {
      slide,
      warning: [
        readyResult.timedOut
          ? `页面 ${page.pageId} 未收到打印就绪信号，已按当前状态导出`
          : '',
        backgroundCapture.warning || ''
      ]
        .filter(Boolean)
        .join('；')
    }
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}
