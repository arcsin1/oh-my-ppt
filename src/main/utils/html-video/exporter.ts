import { BrowserWindow, type NativeImage } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { spawn } from 'child_process'
import type { SessionPageFile } from '../../ipc/context'

const VIDEO_WIDTH = 1600
const VIDEO_HEIGHT = 900
const DEFAULT_FPS = 30
const DEFAULT_CAPTURE_FPS = 15
const DEFAULT_SECONDS_PER_PAGE = 4
const MAX_ANIMATED_PAGE_CAPTURE_FRAMES = 240

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const WAIT_FOR_VIDEO_CAPTURE_FRAME_SCRIPT = `
(async () => {
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  void document.body.offsetHeight;
  return true;
})()
`

const PREPARE_PAGE_FOR_STATIC_VIDEO_SCRIPT = `
(async () => {
  const root =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.body;

  const existing = document.getElementById('ohmyppt-video-static-export');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'ohmyppt-video-static-export';
  style.textContent = [
    'html { scroll-behavior: auto !important; }',
    '*, *::before, *::after { transition: none !important; animation: none !important; transition-delay: 0s !important; animation-delay: 0s !important; }',
    '.opacity-0, [data-anime], [data-animate], [data-anim] { opacity: 1 !important; transform: none !important; }'
  ].join('\\n');
  document.head.appendChild(style);

  try {
    document.getAnimations?.().forEach((animation) => {
      try {
        animation.finish();
      } catch (_err) {
        try {
          animation.cancel();
        } catch (_cancelErr) {}
      }
    });
  } catch (_err) {}

  try {
    const ChartCtor = window.Chart;
    if (ChartCtor?.defaults) {
      ChartCtor.defaults.animation = false;
      ChartCtor.defaults.animations = false;
    }
    const charts = [];
    if (window.__PPT_CHART_REGISTRY__ instanceof Map) {
      window.__PPT_CHART_REGISTRY__.forEach((chart) => chart && charts.push(chart));
    }
    root.querySelectorAll('canvas').forEach((canvas) => {
      try {
        const chart = ChartCtor?.getChart?.(canvas);
        if (chart) charts.push(chart);
      } catch (_err) {}
    });
    charts.forEach((chart) => {
      try {
        if (chart?.options) {
          chart.options.animation = false;
          chart.options.animations = false;
          chart.options.responsive = false;
          chart.options.maintainAspectRatio = false;
        }
        chart.stop?.();
        chart.resize?.();
        chart.update?.('none');
        chart.render?.();
        chart.draw?.();
      } catch (_err) {}
    });
  } catch (_err) {}

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_err) {}
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

const PREPARE_PAGE_FOR_ANIMATED_VIDEO_SCRIPT = `
(async () => {
  const root =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.body;
  const pageRect = root.getBoundingClientRect();
  const supportedTypes = new Set([
    'fade',
    'fade-up',
    'fade-down',
    'fade-left',
    'fade-right',
    'scale-in',
    'slide-up',
    'slide-left',
    'fly-in',
    'wipe',
    'zoom-in',
    'spin-in',
    'grow-shrink',
    'pulse',
    'exit-fade',
    'exit-fly'
  ]);
  const normalizeType = (value) => {
    const type = String(value || 'fade-up').trim().toLowerCase();
    if (type === 'none') return 'none';
    if (type === 'fly' || type === 'flyin') return 'fly-in';
    if (type === 'zoom' || type === 'zoomin') return 'zoom-in';
    if (type === 'spin' || type === 'spinin') return 'spin-in';
    if (type === 'grow' || type === 'growshrink') return 'grow-shrink';
    if (type === 'emphasis') return 'pulse';
    if (type === 'path') return 'fade-up';
    return supportedTypes.has(type) ? type : 'fade-up';
  };
  const normalizeTrigger = (value) => {
    const trigger = String(value || 'load').trim().toLowerCase();
    if (trigger === 'on-click') return 'click';
    if (trigger === 'after-previous') return 'after';
    if (trigger === 'with-previous') return 'with';
    return trigger === 'click' || trigger === 'after' || trigger === 'with' ? trigger : 'load';
  };
  const defaultFrom = (type) => {
    if (type === 'fade-down') return 'top';
    if (type === 'fade-left' || type === 'slide-left') return 'right';
    if (type === 'fade-right') return 'left';
    return 'bottom';
  };
  const normalizeFrom = (value, fallback) => {
    const from = String(value || fallback || 'bottom').trim().toLowerCase();
    if (from === 'up' || from === 'top') return 'top';
    if (from === 'down' || from === 'bottom') return 'bottom';
    if (from === 'start') return 'left';
    if (from === 'end') return 'right';
    if (from === 'left' || from === 'right' || from === 'center') return from;
    return fallback || 'bottom';
  };
  const parseDelay = (raw, counters, key) => {
    const value = String(raw || '0').trim();
    if (value.indexOf('stagger') === 0) {
      const match = value.match(/stagger\\s*\\(\\s*(\\d+)\\s*\\)/);
      const gap = match ? Number(match[1]) : 50;
      if (counters[key] === undefined) counters[key] = 0;
      const delay = counters[key] * gap;
      counters[key] += 1;
      return delay;
    }
    return Math.max(0, Number(value) || 0);
  };
  const style = document.getElementById('ohmyppt-video-animated-export') || document.createElement('style');
  style.id = 'ohmyppt-video-animated-export';
  style.textContent = [
    'html { scroll-behavior: auto !important; }',
    '*, *::before, *::after { transition: none !important; animation: none !important; transition-delay: 0s !important; animation-delay: 0s !important; }'
  ].join('\\n');
  if (!style.parentElement) document.head.appendChild(style);

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_err) {}
  }

  const collectChartSettleMs = () => {
    const ChartCtor = window.Chart;
    const charts = [];
    try {
      if (window.__PPT_CHART_REGISTRY__ instanceof Map) {
        window.__PPT_CHART_REGISTRY__.forEach((chart) => chart && charts.push(chart));
      }
    } catch (_err) {}
    try {
      root.querySelectorAll('canvas').forEach((canvas) => {
        try {
          const chart = ChartCtor?.getChart?.(canvas);
          if (chart) charts.push(chart);
        } catch (_err) {}
      });
    } catch (_err) {}
    let maxDuration = 0;
    charts.forEach((chart) => {
      try {
        const animation = chart?.options?.animation;
        const duration = typeof animation === 'object'
          ? Number(animation.duration)
          : animation === false
            ? 0
            : 1000;
        if (Number.isFinite(duration)) maxDuration = Math.max(maxDuration, duration);
      } catch (_err) {}
    });
    return Math.max(0, Math.min(3000, maxDuration || (charts.length > 0 ? 900 : 0)));
  };

  const elements = Array.from(root.querySelectorAll('[data-anim]'));
  const counters = {};
  let lastSequenceStart = 0;
  let lastSequenceEnd = 0;
  let clickStep = 0;
  const animations = [];

  elements.forEach((el, order) => {
    const type = normalizeType(el.getAttribute('data-anim'));
    if (type === 'none') return;
    const trigger = normalizeTrigger(el.getAttribute('data-anim-trigger'));
    const duration = Math.max(100, Math.min(5000, Number(el.getAttribute('data-anim-duration')) || 500));
    const from = normalizeFrom(el.getAttribute('data-anim-from'), defaultFrom(type));
    let start = parseDelay(el.getAttribute('data-anim-delay'), counters, trigger);
    if (trigger === 'click') {
      start += 900 + clickStep * 1200;
      clickStep += 1;
    } else if (trigger === 'after') {
      start += lastSequenceEnd;
      lastSequenceStart = start;
      lastSequenceEnd = Math.max(lastSequenceEnd, start + duration);
    } else if (trigger === 'with') {
      start += lastSequenceStart;
      lastSequenceEnd = Math.max(lastSequenceEnd, start + duration);
    } else {
      lastSequenceStart = start;
      lastSequenceEnd = Math.max(lastSequenceEnd, start + duration);
    }
    const rect = el.getBoundingClientRect();
    animations.push({
      el,
      type,
      from,
      start,
      duration,
      order,
      rect: {
        x: Math.round(rect.left - pageRect.left),
        y: Math.round(rect.top - pageRect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      }
    });
  });

  window.__OHMYPPT_VIDEO_ANIMS__ = animations;
  window.__OHMYPPT_VIDEO_PAGE_RECT__ = {
    width: Math.round(pageRect.width),
    height: Math.round(pageRect.height)
  };
  const animationEndMs = Math.max(0, ...animations.map((item) => item.start + item.duration));
  const chartSettleMs = collectChartSettleMs();
  const suggestedDurationMs = Math.max(
    animationEndMs > 0 ? animationEndMs + 700 : 0,
    chartSettleMs > 0 ? chartSettleMs + 300 : 0
  );
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    animationCount: animations.length,
    clickStepCount: clickStep,
    animationEndMs,
    chartSettleMs,
    suggestedDurationMs
  };
})()
`

const SEEK_PAGE_FOR_ANIMATED_VIDEO_SCRIPT = (timeMs: number): string => `
(() => {
  const animations = Array.isArray(window.__OHMYPPT_VIDEO_ANIMS__)
    ? window.__OHMYPPT_VIDEO_ANIMS__
    : [];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const offsetFor = (from, distance) => {
    if (from === 'top') return { x: 0, y: -distance };
    if (from === 'left') return { x: -distance, y: 0 };
    if (from === 'right') return { x: distance, y: 0 };
    if (from === 'center') return { x: 0, y: 0 };
    return { x: 0, y: distance };
  };
  animations.forEach((item) => {
    const el = item.el;
    if (!el || !el.style) return;
    const raw = (${JSON.stringify(timeMs)} - item.start) / Math.max(1, item.duration);
    const p = ease(raw);
    const before = raw <= 0;
    const after = raw >= 1;
    const isExit = item.type === 'exit-fade' || item.type === 'exit-fly';
    let opacity = isExit ? 1 - p : p;
    let transform = 'none';
    let clipPath = '';
    const distance = Math.max(24, Math.min(120, Math.max(item.rect?.w || 0, item.rect?.h || 0) * 0.18));
    if (item.type === 'fade') {
      transform = 'none';
    } else if (item.type === 'scale-in' || item.type === 'zoom-in') {
      const scale = isExit ? 1 + p * 0.08 : 0.88 + p * 0.12;
      transform = 'scale(' + scale.toFixed(4) + ')';
    } else if (item.type === 'spin-in') {
      transform = 'rotate(' + ((1 - p) * -12).toFixed(3) + 'deg) scale(' + (0.92 + p * 0.08).toFixed(4) + ')';
    } else if (item.type === 'grow-shrink' || item.type === 'pulse') {
      const wave = Math.sin(clamp(raw, 0, 1) * Math.PI);
      transform = 'scale(' + (1 + wave * 0.055).toFixed(4) + ')';
      opacity = 1;
    } else if (item.type === 'wipe') {
      clipPath = 'inset(0 ' + ((1 - p) * 100).toFixed(3) + '% 0 0)';
      transform = 'none';
    } else {
      const offset = offsetFor(item.from, distance);
      const factor = isExit ? p : 1 - p;
      transform = 'translate(' + (offset.x * factor).toFixed(2) + 'px, ' + (offset.y * factor).toFixed(2) + 'px)';
    }
    if (before && !isExit) opacity = 0;
    if (after && !isExit) opacity = 1;
    if (before && isExit) opacity = 1;
    if (after && isExit) opacity = 0;
    el.style.setProperty('opacity', String(clamp(opacity, 0, 1)), 'important');
    el.style.setProperty('transform', transform, 'important');
    el.style.setProperty('transition', 'none', 'important');
    el.style.setProperty('animation', 'none', 'important');
    if (clipPath) {
      el.style.setProperty('clip-path', clipPath, 'important');
    } else {
      el.style.removeProperty('clip-path');
    }
  });
  void document.body.offsetHeight;
  return true;
})()
`

export type VideoExportPage = SessionPageFile

export type VideoExportOptions = {
  pages: VideoExportPage[]
  outputPath: string
  tempRootDir: string
  waitForPrintReadySignal: (args: {
    win: BrowserWindow
    pageId: string
    timeoutMs: number
  }) => Promise<{ timedOut: boolean }>
  timeoutMs: number
  settleMs: number
  fps?: number
  captureFps?: number
  secondsPerPage?: number
}

export type VideoExportResult = {
  pageCount: number
  frameCount: number
  durationMs: number
  warnings: string[]
}

type VideoPageTimeline = {
  animationCount: number
  clickStepCount: number
  animationEndMs: number
  chartSettleMs: number
  suggestedDurationMs: number
}

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export const normalizeVideoExportFps = (value: unknown): number =>
  clampInteger(value, DEFAULT_FPS, 12, 60)

export const normalizeVideoExportCaptureFps = (value: unknown, outputFps = DEFAULT_FPS): number =>
  Math.min(outputFps, clampInteger(value, DEFAULT_CAPTURE_FPS, 8, 30))

export const normalizeVideoExportSecondsPerPage = (value: unknown): number =>
  clampInteger(value, DEFAULT_SECONDS_PER_PAGE, 1, 30)

const platformArchKey = (): string => `${process.platform}-${process.arch}`

const bundledFfmpegFileName = (): string => (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

const resourceRoots = (): string[] => {
  const roots = is.dev
    ? [path.join(process.cwd(), 'resources')]
    : [
        path.join(process.resourcesPath, 'ffmpeg'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')
      ]
  return roots
}

const candidateBundledFfmpegPaths = (): string[] => {
  const key = platformArchKey()
  const fileName = bundledFfmpegFileName()
  const candidates: string[] = []
  for (const root of resourceRoots()) {
    if (path.basename(root) === 'ffmpeg') {
      candidates.push(path.join(root, key, fileName))
      continue
    }
    candidates.push(path.join(root, 'ffmpeg', key, fileName))
  }

  // Compatibility for the current checked-in arm64 resource name.
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    for (const root of resourceRoots()) {
      if (path.basename(root) === 'ffmpeg') {
        candidates.push(path.join(root, 'ffmpeg-arm'))
      } else {
        candidates.push(path.join(root, 'ffmpeg', 'ffmpeg-arm'))
      }
    }
  }

  return candidates
}

const isExecutableFile = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fs.promises.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

export const resolveBundledFfmpegPath = async (): Promise<string | null> => {
  for (const candidate of candidateBundledFfmpegPaths()) {
    if (await isExecutableFile(candidate)) {
      if (process.platform !== 'win32') {
        await fs.promises.chmod(candidate, 0o755).catch(() => {})
      }
      return candidate
    }
  }
  return null
}

const createVideoBrowserWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    show: false,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: false
    }
  })
  win.webContents.setZoomFactor(1)
  win.setContentSize(VIDEO_WIDTH, VIDEO_HEIGHT)
  return win
}

const loadVideoPage = async (args: {
  win: BrowserWindow
  page: VideoExportPage
  timeoutMs: number
  settleMs: number
  waitForPrintReadySignal: VideoExportOptions['waitForPrintReadySignal']
}): Promise<{ timedOut: boolean }> => {
  const pageUrl = new URL(pathToFileURL(args.page.htmlPath).toString())
  pageUrl.searchParams.set('fit', 'off')
  pageUrl.searchParams.set('print', '1')
  pageUrl.searchParams.set('export', '1')
  pageUrl.searchParams.set('video', '1')
  pageUrl.searchParams.set('pageId', args.page.pageId)
  pageUrl.searchParams.set('printTimeoutMs', String(args.timeoutMs))
  pageUrl.searchParams.set('_ts', String(Date.now()))

  const readyWaitPromise = args.waitForPrintReadySignal({
    win: args.win,
    pageId: args.page.pageId,
    timeoutMs: args.timeoutMs
  })

  await args.win.loadURL(pageUrl.toString())
  const readyResult = await readyWaitPromise
  if (readyResult.timedOut) {
    log.warn('[export:video] print ready timeout', {
      pageId: args.page.pageId,
      htmlPath: args.page.htmlPath,
      timeoutMs: args.timeoutMs
    })
  }
  await sleep(args.settleMs)
  await args.win.webContents.executeJavaScript(WAIT_FOR_VIDEO_CAPTURE_FRAME_SCRIPT, true)
  return readyResult
}

const captureFullFrame = async (win: BrowserWindow): Promise<NativeImage> => {
  await win.webContents.executeJavaScript(WAIT_FOR_VIDEO_CAPTURE_FRAME_SCRIPT, true)
  return win.webContents.capturePage({
    x: 0,
    y: 0,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT
  })
}

const warmUpCapture = async (win: BrowserWindow): Promise<void> => {
  await win.webContents.executeJavaScript(WAIT_FOR_VIDEO_CAPTURE_FRAME_SCRIPT, true)
  await sleep(process.platform === 'win32' ? 120 : 60)
  await captureFullFrame(win).catch(() => null)
  await win.webContents.executeJavaScript(WAIT_FOR_VIDEO_CAPTURE_FRAME_SCRIPT, true)
}

const runFfmpeg = async (args: {
  ffmpegPath: string
  concatPath: string
  tempDir: string
  outputPath: string
  fps: number
}): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const ffmpegArgs = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      args.concatPath,
      '-r',
      String(args.fps),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-preset',
      'medium',
      '-movflags',
      '+faststart',
      args.outputPath
    ]
    log.info('[export:video] run ffmpeg', {
      ffmpegPath: args.ffmpegPath,
      args: ffmpegArgs,
      cwd: args.tempDir
    })
    const child = spawn(args.ffmpegPath, ffmpegArgs, { cwd: args.tempDir })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const hint = stderr.trim().slice(-2000)
      log.error('[export:video] ffmpeg failed', {
        code,
        signal,
        stderr: hint,
        concatPath: args.concatPath
      })
      reject(
        new Error(
          `ffmpeg 编码失败（退出码 ${code ?? 'unknown'}${signal ? `，信号 ${signal}` : ''}）${
            hint ? `：${hint}` : ''
          }`
        )
      )
    })
  })
}

const escapeConcatPath = (filePath: string): string =>
  filePath.split(path.sep).join('/').replace(/'/g, "'\\''")

const normalizeTimeline = (value: unknown): VideoPageTimeline => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const animationCount = Math.max(0, Math.floor(Number(record.animationCount) || 0))
  const clickStepCount = Math.max(0, Math.floor(Number(record.clickStepCount) || 0))
  const animationEndMs = Math.max(0, Math.floor(Number(record.animationEndMs) || 0))
  const chartSettleMs = Math.max(0, Math.floor(Number(record.chartSettleMs) || 0))
  const suggestedDurationMs = Math.max(0, Math.floor(Number(record.suggestedDurationMs) || 0))
  return { animationCount, clickStepCount, animationEndMs, chartSettleMs, suggestedDurationMs }
}

const writeCapturedFrame = async (args: {
  win: BrowserWindow
  frameDir: string
  frameIndex: number
}): Promise<string> => {
  const image = await captureFullFrame(args.win)
  const png = image.toPNG()
  const imagePath = path.join(args.frameDir, `frame-${String(args.frameIndex).padStart(6, '0')}.png`)
  await fs.promises.writeFile(imagePath, png)
  return imagePath
}

const appendConcatImage = (args: {
  concatEntries: string[]
  imagePath: string
  frameDir: string
  durationSeconds: number
}): void => {
  const relativePath = path.relative(args.frameDir, args.imagePath)
  args.concatEntries.push(`file '${escapeConcatPath(path.join('pages', relativePath))}'`)
  args.concatEntries.push(`duration ${Math.max(0.001, args.durationSeconds).toFixed(6)}`)
}

export const exportHtmlPagesToVideo = async (
  options: VideoExportOptions
): Promise<VideoExportResult> => {
  if (options.pages.length === 0) {
    throw new Error('没有可导出的视频页面')
  }

  const ffmpegPath = await resolveBundledFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('视频编码器缺失，无法导出视频。请确认 resources/ffmpeg 中包含当前平台的 ffmpeg。')
  }

  const fps = normalizeVideoExportFps(options.fps)
  const captureFps = normalizeVideoExportCaptureFps(options.captureFps, fps)
  const secondsPerPage = normalizeVideoExportSecondsPerPage(options.secondsPerPage)
  const framesPerPage = fps * secondsPerPage
  const tempRootDir = path.join(options.tempRootDir || os.tmpdir(), '.ohmyppt-tmp')
  await fs.promises.mkdir(tempRootDir, { recursive: true })
  const tempDir = await fs.promises.mkdtemp(path.join(tempRootDir, 'video-export-'))
  const frameDir = path.join(tempDir, 'pages')
  const concatPath = path.join(tempDir, 'concat.txt')
  await fs.promises.mkdir(frameDir, { recursive: true })

  const warnings: string[] = []
  let imageIndex = 0
  let frameCount = 0
  const win = createVideoBrowserWindow()
  const concatEntries: string[] = []
  let lastConcatImagePath = ''

  try {
    for (const [pageIndex, page] of options.pages.entries()) {
      log.info('[export:video] capture page', {
        pageId: page.pageId,
        htmlPath: page.htmlPath,
        framesPerPage,
        fps,
        captureFps
      })
      const readyResult = await loadVideoPage({
        win,
        page,
        timeoutMs: options.timeoutMs,
        settleMs: options.settleMs,
        waitForPrintReadySignal: options.waitForPrintReadySignal
      })
      if (readyResult.timedOut) {
        warnings.push(`页面 ${page.pageId} 未收到打印就绪信号，已按当前状态导出`)
      }

      const timeline = normalizeTimeline(
        await win.webContents.executeJavaScript(PREPARE_PAGE_FOR_ANIMATED_VIDEO_SCRIPT, true)
      )
      const pageDurationMs = Math.max(secondsPerPage * 1000, timeline.suggestedDurationMs)
      const rawPageFrameCount = Math.max(1, Math.ceil((pageDurationMs / 1000) * captureFps))
      const pageFrameCount = Math.min(MAX_ANIMATED_PAGE_CAPTURE_FRAMES, rawPageFrameCount)
      const frameDurationSeconds = pageDurationMs / 1000 / pageFrameCount

      if (timeline.animationCount > 0) {
        log.info('[export:video] capture animated page frames', {
          pageId: page.pageId,
          animationCount: timeline.animationCount,
          clickStepCount: timeline.clickStepCount,
          animationEndMs: timeline.animationEndMs,
          chartSettleMs: timeline.chartSettleMs,
          pageFrameCount,
          rawPageFrameCount,
          pageDurationMs
        })
        await win.webContents.executeJavaScript(SEEK_PAGE_FOR_ANIMATED_VIDEO_SCRIPT(0), true)
        await warmUpCapture(win)
        const firstAnimatedFrameIndex = pageIndex === 0 ? 1 : 0
        if (pageIndex === 0) {
          imageIndex += 1
          const posterImagePath = await writeCapturedFrame({ win, frameDir, frameIndex: imageIndex })
          appendConcatImage({
            concatEntries,
            imagePath: posterImagePath,
            frameDir,
            durationSeconds: frameDurationSeconds
          })
          lastConcatImagePath = posterImagePath
          log.info('[export:video] prepended first page poster frame', {
            pageId: page.pageId,
            durationSeconds: frameDurationSeconds
          })
        }
        for (let i = firstAnimatedFrameIndex; i < pageFrameCount; i += 1) {
          const timeMs = Math.min(pageDurationMs, Math.round(i * frameDurationSeconds * 1000))
          await win.webContents.executeJavaScript(SEEK_PAGE_FOR_ANIMATED_VIDEO_SCRIPT(timeMs), true)
          imageIndex += 1
          const imagePath = await writeCapturedFrame({ win, frameDir, frameIndex: imageIndex })
          appendConcatImage({
            concatEntries,
            imagePath,
            frameDir,
            durationSeconds: frameDurationSeconds
          })
          lastConcatImagePath = imagePath
        }
        frameCount += pageFrameCount
        continue
      }

      await win.webContents.executeJavaScript(PREPARE_PAGE_FOR_STATIC_VIDEO_SCRIPT, true)
      await sleep(120)
      await warmUpCapture(win)
      const staticDurationSeconds = Math.max(
        secondsPerPage,
        timeline.suggestedDurationMs > 0 ? timeline.suggestedDurationMs / 1000 : 0
      )
      imageIndex += 1
      const imagePath = await writeCapturedFrame({ win, frameDir, frameIndex: imageIndex })
      appendConcatImage({
        concatEntries,
        imagePath,
        frameDir,
        durationSeconds: staticDurationSeconds
      })
      lastConcatImagePath = imagePath
      frameCount += Math.max(1, Math.ceil(staticDurationSeconds * fps))
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }

  if (lastConcatImagePath) {
    const relativePath = path.relative(frameDir, lastConcatImagePath)
    concatEntries.push(`file '${escapeConcatPath(path.join('pages', relativePath))}'`)
  }
  await fs.promises.writeFile(concatPath, `${concatEntries.join('\n')}\n`, 'utf-8')
  log.info('[export:video] concat prepared', {
    tempDir,
    concatPath,
    imageCount: imageIndex,
    frameCount,
    firstLines: concatEntries.slice(0, 8)
  })

  try {
    await runFfmpeg({
      ffmpegPath,
      concatPath,
      tempDir,
      outputPath: options.outputPath,
      fps
    })
    return {
      pageCount: options.pages.length,
      frameCount,
      durationMs: Math.round((frameCount / fps) * 1000),
      warnings
    }
  } finally {
    if (!is.dev || process.env.OHMYPPT_KEEP_VIDEO_EXPORT_TMP !== '1') {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch((error) => {
        log.warn('[export:video] cleanup failed', {
          tempDir,
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } else {
      log.info('[export:video] temp dir kept for debugging', { tempDir })
    }
  }
}
