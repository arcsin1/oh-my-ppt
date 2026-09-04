import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import { getLayoutMasterTemplate, type LayoutMasterTemplate } from '@shared/layout-master'
import type { LayoutIntent } from '@shared/layout-intent'

const MAX_SUBJECT_LENGTH = 1200
const DEFAULT_IMAGE_AVOID = [
  'invented, garbled, partial, or illegible text',
  'pseudo-text, random glyph-like marks, or lettering-like textures',
  'unrelated captions, labels, slogans, or signs',
  'logos',
  'watermarks',
  'UI screenshots'
]
const IMAGE_DRAFT_ATTRIBUTE_PREFIX = 'data-img-'
const ALLOWED_DRAFT_ATTRIBUTES = new Set(['data-img-request', 'data-img-placement'])
const LEGACY_DRAFT_ATTRIBUTES = new Set([
  'data-img-slot',
  'data-img-placeholder',
  'data-img-finalization',
  'data-img-intent'
])

export type ParsedVisualIntent = {
  slotId: string
  layoutSlotId: string
  role: 'hero-image' | 'product-visual' | 'spot-illustration' | 'data-visual'
  layer: 'background' | 'visual'
  /** Filled by the dedicated image director after the page parser resolves the slot. */
  subject: string
  textZone?: string
  subjectZone?: string
  negativeSpace?: string
  avoid: string[]
  requestJson: string
}

export type InvalidVisualIntent = {
  slotId: string | null
  layoutSlotId: string | null
  role: string | null
  requestJson: string
  errors: string[]
}

export type VisualIntentParseResult = {
  status: 'none' | 'valid' | 'invalid' | 'forbidden'
  intents: ParsedVisualIntent[]
  invalidIntents: InvalidVisualIntent[]
  errors: string[]
  diagnostic?: 'layout-contract-incompatible' | 'layout-source-missing'
}

type VisualIntentInput = {
  html: string
  visualEnabled: boolean
  layoutIntent?: LayoutIntent | null
  layoutId?: string | null
  layoutContractVersion?: number | null
}

export const hasImageIntentDrafts = (html: string): boolean => {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  return findDraftElements($).length > 0
}

const imageDraftAttributes = (node: Element): string[] =>
  Object.keys(node.attribs || {}).filter((name) =>
    name.toLowerCase().startsWith(IMAGE_DRAFT_ATTRIBUTE_PREFIX)
  )

const findDraftElements = ($: cheerio.CheerioAPI): cheerio.Cheerio<Element> =>
  $('*').filter((_index, node) => imageDraftAttributes(node as Element).length > 0) as cheerio.Cheerio<Element>

const cleanString = (value: unknown, maxLength?: number): string => {
  const text = typeof value === 'string' ? value.trim() : ''
  return maxLength === undefined ? text : text.slice(0, maxLength)
}

const resolveTemplate = (
  input: VisualIntentInput
): {
  template: LayoutMasterTemplate | null
  diagnostic?: VisualIntentParseResult['diagnostic']
} => {
  if (!input.layoutId || !input.layoutIntent) {
    return { template: null, diagnostic: 'layout-source-missing' }
  }
  const template = getLayoutMasterTemplate(input.layoutId)
  if (
    !template ||
    template.intent !== input.layoutIntent ||
    input.layoutContractVersion !== template.layoutContractVersion
  ) {
    return { template: null, diagnostic: 'layout-contract-incompatible' }
  }
  return { template }
}

const isInsideContentLayer = ($: cheerio.CheerioAPI, node: Element): boolean =>
  $(node).closest('main[data-role="content"]').length > 0

const inlineStyle = ($: cheerio.CheerioAPI, node: Element, property: string): string => {
  const style = $(node).attr('style') || ''
  for (const declaration of style.split(';')) {
    const [rawProperty, ...rawValue] = declaration.split(':')
    if (rawProperty?.trim().toLowerCase() === property) return rawValue.join(':').trim()
  }
  return ''
}

const hasZeroDimension = (value: string): boolean =>
  /^0(?:px|rem|%|vh|vw)?(?:\s*!important)?$/i.test(value)

const hasZeroDimensionUtility = ($: cheerio.CheerioAPI, node: Element): boolean =>
  ($(node).attr('class') || '')
    .trim()
    .split(/\s+/)
    .some((token) =>
      /^(?:(?:max-)?[wh]|size)-0$|^(?:(?:max-)?[wh]|size)-\[0(?:px|rem|%|vh|vw)?\]$/i.test(
        token
      )
    )

const hasTailwindImageGeometry = ($: cheerio.CheerioAPI, node: Element): boolean =>
  ($(node).attr('class') || '')
    .trim()
    .split(/\s+/)
    .some((token) => {
      if (/^aspect-(?:square|video)$/i.test(token)) return true
      if (/^aspect-\[(?!0(?:[/.]|$))[^\]]+\]$/i.test(token)) return true
      if (/^(?:min-)?h-(?!0(?:$|\[0(?:px|rem|%|vh|vw)?\]$)|auto$|fit$)/i.test(token)) {
        return true
      }
      return /^size-(?!0(?:$|\[0(?:px|rem|%|vh|vw)?\]$)|auto$|fit$)/i.test(token)
    })

const hasImageGeometry = ($: cheerio.CheerioAPI, node: Element): boolean => {
  let current: cheerio.Cheerio<Element> = $(node)
  while (current.length > 0) {
    const element = current.get(0)
    if (!element) break
    const width = inlineStyle($, element, 'width')
    const height = inlineStyle($, element, 'height')
    const aspectRatio = inlineStyle($, element, 'aspect-ratio')
    const minHeight = inlineStyle($, element, 'min-height')
    const position = inlineStyle($, element, 'position').toLowerCase()
    const top = inlineStyle($, element, 'top')
    const right = inlineStyle($, element, 'right')
    const bottom = inlineStyle($, element, 'bottom')
    const left = inlineStyle($, element, 'left')
    const className = ($(element).attr('class') || '').toLowerCase()
    if (hasZeroDimension(width) || hasZeroDimension(height) || hasZeroDimensionUtility($, element)) {
      return false
    }
    const hasDimension = Boolean(width) && Boolean(height)
    const hasBoundedAbsolutePosition =
      (position === 'absolute' || /(?:^|\s)absolute(?:\s|$)/.test(className)) &&
      (top || bottom) &&
      (left || right)
    if (
      hasDimension ||
      aspectRatio ||
      minHeight ||
      hasTailwindImageGeometry($, element) ||
      /(?:^|[\s_-])(grid|flex)(?:$|[\s_-])/.test(className) ||
      hasBoundedAbsolutePosition
    ) {
      return true
    }
    current = current.parent()
  }
  return false
}

const requestSnapshot = (layoutSlotId: string, layer: 'background' | 'visual'): string =>
  JSON.stringify({ protocol: 'm3b-image-request-v2', layoutSlotId, layer })

export const parseVisualIntents = (input: VisualIntentInput): VisualIntentParseResult => {
  const $ = cheerio.load(input.html, { scriptingEnabled: false })
  const requestContainers = $('[data-img-request]')
  const draftElements = findDraftElements($)
  const draftAttributeNames = draftElements
    .toArray()
    .flatMap((node) => imageDraftAttributes(node as Element))
  const legacyDrafts = draftAttributeNames.filter((name) => LEGACY_DRAFT_ATTRIBUTES.has(name))
  const unknownDrafts = draftAttributeNames.filter((name) => !ALLOWED_DRAFT_ATTRIBUTES.has(name) && !LEGACY_DRAFT_ATTRIBUTES.has(name))
  const orphanPlacements = $('[data-img-placement]').filter((_index, node) => !$(node).is('[data-img-request]'))
  if (draftElements.length === 0) {
    return { status: 'none', intents: [], invalidIntents: [], errors: [] }
  }
  if (!input.visualEnabled) {
    return {
      status: 'forbidden',
      intents: [],
      invalidIntents: [],
      errors: ['Image request markers are forbidden when visualEnabled is false.']
    }
  }

  const { template, diagnostic } = resolveTemplate(input)
  if (!template) {
    return {
      status: 'invalid',
      intents: [],
      invalidIntents: [],
      errors: ['Image requests require a compatible page layout source.'],
      diagnostic
    }
  }

  const errors: string[] = []
  const invalidIntents: InvalidVisualIntent[] = []
  const intents: ParsedVisualIntent[] = []
  const seenSlotIds = new Set<string>()
  if (legacyDrafts.length > 0) {
    const message =
      'Automatic image requests must use data-img-request only; do not emit data-img-slot, data-img-intent, data-img-placeholder, or data-img-finalization.'
    errors.push(message)
    invalidIntents.push({
      slotId: null,
      layoutSlotId: null,
      role: null,
      requestJson: '',
      errors: [message]
    })
  }
  if (unknownDrafts.length > 0) {
    const attributes = [...new Set(unknownDrafts)].join(', ')
    const message = `Unknown data-img-* draft attributes are not allowed: ${attributes}.`
    errors.push(message)
    invalidIntents.push({
      slotId: null,
      layoutSlotId: null,
      role: null,
      requestJson: '',
      errors: [message]
    })
  }
  if (orphanPlacements.length > 0) {
    const message = 'data-img-placement is only allowed on an element with data-img-request.'
    errors.push(message)
    invalidIntents.push({
      slotId: null,
      layoutSlotId: null,
      role: null,
      requestJson: '',
      errors: [message]
    })
  }

  requestContainers.each((_index, node) => {
    const container = $(node)
    const layoutSlotId = cleanString(container.attr('data-ppt-slot'))
    const layoutSlot = template.slots.find((slot) => slot.id === layoutSlotId)
    const placement = cleanString(container.attr('data-img-placement')).toLowerCase()
    const requestErrors: string[] = []
    if (!layoutSlotId) requestErrors.push('data-img-request must be on an element with data-ppt-slot.')
    if (!isInsideContentLayer($, node as Element)) {
      requestErrors.push('data-img-request must be inside main[data-role="content"].')
    }
    if (!layoutSlot || layoutSlot.role !== 'visual' || !layoutSlot.image) {
      requestErrors.push(`Layout slot ${layoutSlotId || '(missing)'} does not allow images.`)
    } else if (layoutSlot.image.policy === 'forbidden') {
      requestErrors.push(`Layout slot ${layoutSlot.id} forbids image generation.`)
    }
    if (placement && placement !== 'background' && placement !== 'visual') {
      requestErrors.push('data-img-placement must be either "background" or "visual".')
    }
    if (!hasImageGeometry($, node as Element)) {
      requestErrors.push(
        'Image request container must expose width and height, aspect-ratio, a grid/flex area, or bounded absolute positioning.'
      )
    }
    if (layoutSlotId && seenSlotIds.has(layoutSlotId)) {
      requestErrors.push(`Image request layout slot ${layoutSlotId} appears more than once.`)
    }
    if (layoutSlotId) seenSlotIds.add(layoutSlotId)

    const layer = placement === 'background' || placement === 'visual' ? placement : layoutSlot?.image?.layer || 'visual'
    const requestJson = requestSnapshot(layoutSlotId || 'invalid', layer)
    if (requestErrors.length > 0) {
      invalidIntents.push({
        slotId: layoutSlotId || null,
        layoutSlotId: layoutSlotId || null,
        role: layoutSlot?.image?.role || null,
        requestJson,
        errors: requestErrors
      })
      errors.push(...requestErrors)
      return
    }
    intents.push({
      slotId: layoutSlotId,
      layoutSlotId,
      role: layoutSlot!.image!.role,
      layer,
      subject: '',
      avoid: [...DEFAULT_IMAGE_AVOID],
      requestJson
    })
  })

  if (requestContainers.length > 1) {
    const message = 'Only one automatic image request is allowed per page.'
    errors.push(message)
    for (const intent of intents) {
      invalidIntents.push({
        slotId: intent.slotId,
        layoutSlotId: intent.layoutSlotId,
        role: intent.role,
        requestJson: intent.requestJson,
        errors: [message]
      })
    }
  }

  return {
    status: errors.length > 0 ? 'invalid' : 'valid',
    intents: errors.length > 0 ? [] : intents,
    invalidIntents,
    errors
  }
}

export const isValidImagePrompt = (value: string): boolean => {
  const subject = cleanString(value, MAX_SUBJECT_LENGTH)
  return Boolean(subject)
}
