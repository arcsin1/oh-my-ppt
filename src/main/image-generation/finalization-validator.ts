import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import { validateDataAnimContract } from '../animation/data-anim-validator'

export type FinalizationAsset = {
  slotId: string
  layoutSlotId?: string
  layer?: 'background' | 'visual'
  relativePath: string
}

export type FinalizationValidationResult = {
  valid: boolean
  errors: string[]
  usedSlotIds: string[]
  unusedSlotIds: string[]
}

const IMAGE_DRAFT_ATTRIBUTE_PREFIX = 'data-img-'

const hasImageDraftAttributes = (node: Element): boolean =>
  Object.keys(node.attribs || {}).some((name) =>
    name.toLowerCase().startsWith(IMAGE_DRAFT_ATTRIBUTE_PREFIX)
  )

const hasImageIntentDrafts = ($: cheerio.CheerioAPI): boolean =>
  $('*').toArray().some((node) => hasImageDraftAttributes(node as Element))

const stripImageDraftAttributes = ($: cheerio.CheerioAPI): void => {
  $('script[data-img-intent]').remove()
  $('*').each((_index, node) => {
    const $node = $(node)
    Object.keys((node as Element).attribs || {})
      .filter((name) => name.toLowerCase().startsWith(IMAGE_DRAFT_ATTRIBUTE_PREFIX))
      .forEach((name) => $node.removeAttr(name))
  })
}

const trimStyleValue = (value: string | undefined): string => (value || '').trim().toLowerCase()

const classTokens = ($node: cheerio.Cheerio<any>): string[] =>
  ($node.attr('class') || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

const getStyleValue = ($node: cheerio.Cheerio<any>, property: string): string => {
  const declarations = ($node.attr('style') || '').split(';')
  for (const declaration of declarations) {
    const [rawProperty, ...rawValue] = declaration.split(':')
    if (rawProperty?.trim().toLowerCase() === property) {
      return trimStyleValue(rawValue.join(':'))
    }
  }
  return ''
}

const isIncomingAnimation = ($node: cheerio.Cheerio<any>): boolean => {
  const animation = ($node.attr('data-anim') || '').trim().toLowerCase()
  return Boolean(animation) && !animation.startsWith('exit-')
}

const hasHiddenUtility = ($node: cheerio.Cheerio<any>): boolean =>
  classTokens($node).some((token) => token === 'hidden' || token === 'invisible')

const hasZeroOpacityUtility = ($node: cheerio.Cheerio<any>): boolean =>
  classTokens($node).includes('opacity-0')

const isPermanentlyHidden = ($: cheerio.CheerioAPI, node: any): boolean => {
  let current = $(node)
  while (current.length > 0) {
    const display = getStyleValue(current, 'display')
    const visibility = getStyleValue(current, 'visibility')
    const opacity = getStyleValue(current, 'opacity')
    if (display === 'none' || visibility === 'hidden' || hasHiddenUtility(current)) return true
    if ((opacity === '0' || hasZeroOpacityUtility(current)) && !isIncomingAnimation(current)) {
      return true
    }
    current = current.parent()
  }
  return false
}

const isZeroDimension = (value: string): boolean =>
  /^0(?:px|rem|%|vh|vw)?(?:\s*!important)?$/i.test(value)

const hasZeroDimensionUtility = ($node: cheerio.Cheerio<any>): boolean =>
  classTokens($node).some((token) =>
    /^(?:(?:max-)?[wh]|size)-0$|^(?:(?:max-)?[wh]|size)-\[0(?:px|rem|%|vh|vw)?\]$/i.test(
      token
    )
  )

const hasZeroDimension = ($: cheerio.CheerioAPI, node: any): boolean => {
  let current = $(node)
  while (current.length > 0) {
    const width = getStyleValue(current, 'width') || trimStyleValue(current.attr('width'))
    const height = getStyleValue(current, 'height') || trimStyleValue(current.attr('height'))
    if (isZeroDimension(width) || isZeroDimension(height) || hasZeroDimensionUtility(current)) {
      return true
    }
    current = current.parent()
  }
  return false
}

const isBackgroundImageContainer = ($node: cheerio.Cheerio<any>): boolean =>
  Boolean(getStyleValue($node, 'background-image'))

const hasBackgroundGeometry = ($node: cheerio.Cheerio<any>): boolean => {
  const className = ($node.attr('class') || '').toLowerCase()
  return Boolean(
    getStyleValue($node, 'height') ||
    getStyleValue($node, 'min-height') ||
    getStyleValue($node, 'aspect-ratio') ||
    getStyleValue($node, 'inset') ||
    (getStyleValue($node, 'position') === 'absolute' &&
      (getStyleValue($node, 'top') || getStyleValue($node, 'bottom')) &&
      (getStyleValue($node, 'left') || getStyleValue($node, 'right'))) ||
    /(?:^|\s)(?:h-|min-h-|aspect-|inset-)/.test(className)
  )
}

const usesAsset = ($: cheerio.CheerioAPI, path: string): cheerio.Cheerio<any> => {
  const image = $(`img[src="${path.replace(/"/g, '\\"')}"]`).first()
  if (image.length > 0) return image
  return $(`[style*="${path.replace(/"/g, '\\"')}"]`)
    .filter((_index, node) => ($(node).attr('style') || '').includes(path))
    .first()
}

const setInlineStyle = (
  $node: cheerio.Cheerio<any>,
  declarations: Record<string, string>
): void => {
  const existing = ($node.attr('style') || '')
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
  const values = new Map<string, string>()
  for (const declaration of existing) {
    const separator = declaration.indexOf(':')
    if (separator <= 0) continue
    values.set(
      declaration.slice(0, separator).trim().toLowerCase(),
      declaration.slice(separator + 1).trim()
    )
  }
  for (const [property, value] of Object.entries(declarations)) values.set(property, value)
  $node.attr(
    'style',
    [...values.entries()].map(([property, value]) => `${property}:${value}`).join(';')
  )
}

const escapeSelectorValue = (value: string): string => value.replace(/(["\\])/g, '\\$1')

/**
 * Fulfills image request markers without asking another model to rewrite the page.
 * Layout slots already own the geometry, so the asset is inserted into that exact node.
 */
export const adoptFinalizedImageAssets = (
  html: string,
  assets: FinalizationAsset[]
): { html: string; errors: string[] } => {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  const errors: string[] = []

  for (const asset of assets) {
    const slotId = asset.layoutSlotId || asset.slotId
    const selector = `[data-ppt-slot="${escapeSelectorValue(slotId)}"][data-img-request]`
    const slot = $(selector).first()
    if (slot.length === 0) {
      errors.push(`Image asset for slot ${asset.slotId} has no matching image request marker.`)
      continue
    }

    if ((asset.layer || 'visual') === 'background') {
      setInlineStyle(slot, {
        'background-image': `url("${asset.relativePath}")`,
        'background-size': 'cover',
        'background-position': 'center',
        'background-repeat': 'no-repeat'
      })
    } else {
      slot.empty()
      const blockId = `generated-image-${slotId.replace(/[^A-Za-z0-9_-]+/g, '-')}`
      slot.append(
        `<img data-block-id="${blockId}" data-ppt-generated-image="true" src="${asset.relativePath}" alt="" style="display:block;width:100%;height:100%;object-fit:cover" />`
      )
    }
  }

  if (errors.length === 0) {
    stripImageDraftAttributes($)
  }

  return { html: $.html(), errors }
}

export const stripImageIntentDrafts = (html: string): string => {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  stripImageDraftAttributes($)
  return $.html()
}

export const validateFinalizedImageHtml = (
  html: string,
  assets: FinalizationAsset[]
): FinalizationValidationResult => {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  const errors = [...validateDataAnimContract(html).errors]
  const usedSlotIds: string[] = []
  const unusedSlotIds: string[] = []

  if (hasImageIntentDrafts($)) {
    errors.push('Final HTML must not contain image intent draft attributes or scripts.')
  }
  if (html.includes('/.staging/') || html.includes('images/.staging/')) {
    errors.push('Final HTML must not reference staging image assets.')
  }

  for (const asset of assets) {
    const node = usesAsset($, asset.relativePath)
    if (node.length === 0) {
      unusedSlotIds.push(asset.slotId)
      continue
    }
    usedSlotIds.push(asset.slotId)
    if (isPermanentlyHidden($, node.get(0))) {
      errors.push(`Image asset for slot ${asset.slotId} is permanently hidden.`)
    }
    if (hasZeroDimension($, node.get(0))) {
      errors.push(`Image asset for slot ${asset.slotId} has a zero dimension.`)
    }
    if (isBackgroundImageContainer(node) && !hasBackgroundGeometry(node)) {
      errors.push(`Background image asset for slot ${asset.slotId} has no visible geometry.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    usedSlotIds,
    unusedSlotIds
  }
}
