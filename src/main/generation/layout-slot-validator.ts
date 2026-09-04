import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import {
  getLayoutMasterTemplate,
  type LayoutMasterTemplate,
  type LayoutSlot
} from '@shared/layout-master'
import type { LayoutIntent } from '@shared/layout-intent'

export type LayoutSlotValidationInput = {
  html: string
  layoutIntent?: LayoutIntent | null
  layoutId?: string | null
  layoutContractVersion?: number | null
}

type PageLayoutSourceInput = Omit<LayoutSlotValidationInput, 'html'>

export type LayoutSlotValidationResult = {
  valid: boolean
  errors: string[]
  skipped: boolean
  diagnostic?: 'layout-contract-incompatible' | 'layout-source-missing'
}

export type RetainedPageLayoutSource = {
  layoutIntent: LayoutIntent | null
  layoutId: string | null
  layoutContractVersion: number | null
  validation: LayoutSlotValidationResult
}

const SLOT_FORBIDDEN_TAGS = new Set(['script', 'style', 'svg'])

const resolveTemplate = (input: PageLayoutSourceInput): LayoutMasterTemplate | null => {
  if (!input.layoutId || !input.layoutIntent) return null
  const template = getLayoutMasterTemplate(input.layoutId)
  if (!template || template.intent !== input.layoutIntent) return null
  return template
}

export const hasCompatiblePageLayoutSource = (input: PageLayoutSourceInput): boolean => {
  const template = resolveTemplate(input)
  return Boolean(template && input.layoutContractVersion === template.layoutContractVersion)
}

const validateSlotElement = (
  node: Element,
  slot: LayoutSlot,
  errors: string[]
): void => {
  const tagName = node.tagName.toLowerCase()
  if (SLOT_FORBIDDEN_TAGS.has(tagName)) {
    errors.push(`Slot ${slot.id} cannot be placed on <${tagName}>.`)
  }
}

export const validateLayoutSlots = (
  input: LayoutSlotValidationInput
): LayoutSlotValidationResult => {
  const template = resolveTemplate(input)
  if (!input.layoutId || !input.layoutIntent) {
    return { valid: true, errors: [], skipped: true, diagnostic: 'layout-source-missing' }
  }
  if (!template || !hasCompatiblePageLayoutSource(input)) {
    return { valid: true, errors: [], skipped: true, diagnostic: 'layout-contract-incompatible' }
  }

  const $ = cheerio.load(input.html, { scriptingEnabled: false })
  const content = $('main[data-role="content"]').first()
  if (content.length === 0) {
    return {
      valid: false,
      errors: ['Layout slot validation requires main[data-role="content"].'],
      skipped: false
    }
  }

  const errors: string[] = []
  const declaredSlots = new Map(template.slots.map((slot) => [slot.id, slot]))
  const seen = new Set<string>()
  const contentSlots = content.find('[data-ppt-slot]').addBack('[data-ppt-slot]')
  const allSlots = $('[data-ppt-slot]')

  allSlots.each((_index, node) => {
    if (contentSlots.toArray().includes(node)) return
    errors.push('data-ppt-slot may only appear inside main[data-role="content"].')
  })

  contentSlots.each((_index, node) => {
    if (!('tagName' in node)) {
      errors.push('data-ppt-slot must be attached to an HTML element.')
      return
    }
    const element = node as Element
    const slotId = ($(element).attr('data-ppt-slot') || '').trim()
    const slot = declaredSlots.get(slotId)
    if (!slot) {
      errors.push(`Unknown layout slot: ${slotId || '(empty)'}.`)
      return
    }
    if (seen.has(slotId)) {
      errors.push(`Layout slot ${slotId} appears more than once.`)
      return
    }
    seen.add(slotId)
    validateSlotElement(element, slot, errors)
  })

  for (const slot of template.slots) {
    if (slot.required && !seen.has(slot.id)) {
      errors.push(`Required layout slot is missing: ${slot.id}.`)
    }
  }

  return { valid: errors.length === 0, errors, skipped: false }
}

/**
 * Full-page rewrites may redesign the DOM, but they must not leave a stale M3b
 * source snapshot behind when the rendered slot contract no longer matches it.
 */
export const resolveRetainedPageLayoutSource = (
  input: LayoutSlotValidationInput
): RetainedPageLayoutSource => {
  const hasCompleteSource = Boolean(
    input.layoutIntent && input.layoutId && input.layoutContractVersion
  )
  const validation = validateLayoutSlots(input)
  if (!hasCompleteSource || !validation.valid) {
    return {
      layoutIntent: null,
      layoutId: null,
      layoutContractVersion: null,
      validation
    }
  }
  return {
    layoutIntent: input.layoutIntent || null,
    layoutId: input.layoutId || null,
    layoutContractVersion: input.layoutContractVersion || null,
    validation
  }
}

export const LAYOUT_SLOT_PRESERVATION_REQUIREMENT =
  'M3b structure contract: preserve every existing data-ppt-slot attribute, its exact value, and its attachment to the same semantic content role. You may redesign the composition, but do not drop, duplicate, rename, or move slot attributes onto decorative, script, style, or SVG nodes.'
