import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_PAYLOAD_FORMAT,
  isFontPayloadFormat,
  parseFontPayloadFormat
} from '../../../src/shared/font-payload'

describe('font payload format', () => {
  it('defaults to raw TTF (PowerPoint for Mac cannot apply bold from EOT)', () => {
    expect(DEFAULT_FONT_PAYLOAD_FORMAT).toBe('ttf')
  })

  it('accepts both container formats', () => {
    expect(isFontPayloadFormat('ttf')).toBe(true)
    expect(isFontPayloadFormat('eot')).toBe(true)
    expect(isFontPayloadFormat('TTF')).toBe(false)
    expect(isFontPayloadFormat('')).toBe(false)
    expect(isFontPayloadFormat(null)).toBe(false)
    expect(isFontPayloadFormat(undefined)).toBe(false)
    expect(isFontPayloadFormat(1)).toBe(false)
  })

  it('parses ipc payload values, falling back to the default', () => {
    expect(parseFontPayloadFormat('eot')).toBe('eot')
    expect(parseFontPayloadFormat('ttf')).toBe('ttf')
    expect(parseFontPayloadFormat(undefined)).toBe('ttf')
    expect(parseFontPayloadFormat('wps')).toBe('ttf')
    expect(parseFontPayloadFormat(42)).toBe('ttf')
  })
})
