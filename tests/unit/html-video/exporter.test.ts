import type { NativeImage } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {}
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

vi.mock('electron-log/main.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import {
  VIDEO_EXPORT_FRAME_SIZE,
  VIDEO_EXPORT_EVEN_DIMENSIONS_FILTER,
  buildVideoExportFfmpegArgs,
  normalizeCapturedVideoFrameImage,
  normalizeVideoExportCaptureFps,
  normalizeVideoExportFps,
  normalizeVideoExportSecondsPerPage
} from '../../../src/main/utils/html-video/exporter'

describe('html video exporter', () => {
  it('normalizes captured frames back to the export canvas size', () => {
    const normalizedImage = {}
    const image = {
      resize: vi.fn(() => normalizedImage)
    }

    expect(normalizeCapturedVideoFrameImage(image as unknown as NativeImage)).toBe(normalizedImage)
    expect(image.resize).toHaveBeenCalledWith({
      width: VIDEO_EXPORT_FRAME_SIZE.width,
      height: VIDEO_EXPORT_FRAME_SIZE.height,
      quality: 'best'
    })
  })

  it('scales ffmpeg output to even dimensions before libx264 encoding', () => {
    const args = buildVideoExportFfmpegArgs({
      concatPath: '/tmp/video-export/concat.txt',
      outputPath: '/tmp/video-export/out.mp4',
      fps: 30
    })

    const filterIndex = args.indexOf('-vf')
    const codecIndex = args.indexOf('-c:v')

    expect(filterIndex).toBeGreaterThan(-1)
    expect(codecIndex).toBeGreaterThan(filterIndex)
    expect(args[filterIndex + 1]).toBe(VIDEO_EXPORT_EVEN_DIMENSIONS_FILTER)
    expect(VIDEO_EXPORT_EVEN_DIMENSIONS_FILTER).toContain('scale=')
    expect(VIDEO_EXPORT_EVEN_DIMENSIONS_FILTER).toContain('ceil(iw/2)*2')
    expect(VIDEO_EXPORT_EVEN_DIMENSIONS_FILTER).toContain('ceil(ih/2)*2')
    expect(args).toContain('libx264')
    expect(args).toContain('yuv420p')
  })

  it('keeps video timing options within supported bounds', () => {
    expect(normalizeVideoExportFps(120)).toBe(60)
    expect(normalizeVideoExportFps(5)).toBe(12)
    expect(normalizeVideoExportCaptureFps(30, 24)).toBe(24)
    expect(normalizeVideoExportSecondsPerPage(0)).toBe(1)
  })
})
