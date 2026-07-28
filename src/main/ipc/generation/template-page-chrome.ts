import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { CorporateTemplatePageRole } from '@shared/corporate-template'

const PAGE_NUMBER_PLACEHOLDER_PATTERN = /[‹〈<《]\s*#\s*[›〉>》]/g
const PAGE_NUMBER_PLACEHOLDER_DETECT_PATTERN = /[‹〈<《]\s*#\s*[›〉>》]/
const PAGE_TOTAL_PATTERN = /\/\s*\d+/g
const CORPORATE_HEADER_MIN_WIDTH = 300
const CORPORATE_HEADER_MAX_WIDTH = 420
const CORPORATE_HEADER_MAX_OFFSET = 24
const CORPORATE_BODY_TOP = 150
const CORPORATE_BODY_BOTTOM = 825
const CORPORATE_BODY_MAX_CENTER_OFFSET = 80
const CORPORATE_TITLE_FIT_STYLE = `
[data-corporate-title-fit="1"] {
  overflow: hidden !important;
}
[data-corporate-title-fit="1"] [data-corporate-title-line="1"] {
  box-sizing: border-box;
  display: block;
  flex: 0 0 auto;
  margin-left: 0 !important;
  margin-right: 0 !important;
  max-width: 100%;
  overflow: visible;
  text-align: center;
  white-space: nowrap;
  width: 100%;
}
`.trim()
const CORPORATE_TITLE_FIT_SCRIPT = `
(() => {
  const fitTitleLines = () => {
    document.querySelectorAll('[data-corporate-title-fit="1"]').forEach((title) => {
      const computedTitle = window.getComputedStyle(title);
      const availableWidth = Math.max(
        0,
        title.clientWidth -
          (Number.parseFloat(computedTitle.paddingLeft) || 0) -
          (Number.parseFloat(computedTitle.paddingRight) || 0)
      );
      if (availableWidth <= 0) return;
      title.querySelectorAll('[data-corporate-title-line="1"]').forEach((line) => {
        const textTargets = line.querySelectorAll('span');
        const targets = textTargets.length > 0 ? Array.from(textTargets) : [line];
        targets.forEach((target) => {
          if (!target.dataset.corporateBaseFontSize) {
            target.dataset.corporateBaseFontSize = String(
              Number.parseFloat(window.getComputedStyle(target).fontSize) || 40
            );
          }
          target.style.fontSize = target.dataset.corporateBaseFontSize + 'px';
        });
        line.style.letterSpacing = '';
        const measuredWidth = Math.max(
          targets.reduce(
            (total, target) => total + target.getBoundingClientRect().width,
            0
          ),
          1
        );
        const scale = Math.min(1, (availableWidth * 0.98) / measuredWidth);
        if (scale < 1) {
          targets.forEach((target) => {
            const baseSize = Number.parseFloat(target.dataset.corporateBaseFontSize || '40');
            target.style.fontSize = Math.max(20, baseSize * scale).toFixed(2) + 'px';
          });
        }
        if (line.scrollWidth > availableWidth) {
          line.style.letterSpacing = '-0.5px';
        }
      });
    });
  };
  fitTitleLines();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitTitleLines).catch(() => undefined);
  }
  window.addEventListener('resize', fitTitleLines, { passive: true });
})();
`.trim()

type InlineStyleMap = Map<string, string>

type PositionedRect = {
  left: number
  top: number
  width: number
  height: number
}

const parseInlineStyle = (styleRaw: string | undefined): InlineStyleMap => {
  const result = new Map<string, string>()
  String(styleRaw || '')
    .split(';')
    .forEach((entry) => {
      const separatorIndex = entry.indexOf(':')
      if (separatorIndex < 0) return
      const property = entry.slice(0, separatorIndex).trim().toLowerCase()
      const value = entry.slice(separatorIndex + 1).trim()
      if (property && value) result.set(property, value)
    })
  return result
}

const serializeInlineStyle = (styles: InlineStyleMap): string =>
  Array.from(styles.entries())
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')

const parsePixelValue = (value: string | undefined): number | null => {
  const match = String(value || '')
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)px$/i)
  if (!match) return null
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

const readPositionedRect = (element: cheerio.Cheerio<AnyNode>): PositionedRect | null => {
  const styles = parseInlineStyle(element.attr('style'))
  const left = parsePixelValue(styles.get('left'))
  const top = parsePixelValue(styles.get('top'))
  const width = parsePixelValue(styles.get('width'))
  const height = parsePixelValue(styles.get('height'))
  if (left === null || top === null || width === null || height === null) return null
  return { left, top, width, height }
}

const isCorporateTopLeftTitle = (element: cheerio.Cheerio<AnyNode>): boolean => {
  const rect = readPositionedRect(element)
  if (!rect) return false
  return (
    Math.abs(rect.left) <= CORPORATE_HEADER_MAX_OFFSET &&
    Math.abs(rect.top) <= CORPORATE_HEADER_MAX_OFFSET &&
    rect.width >= CORPORATE_HEADER_MIN_WIDTH &&
    rect.width <= CORPORATE_HEADER_MAX_WIDTH &&
    rect.height >= 90 &&
    rect.height <= 180
  )
}

const normalizeCorporateBodyTitle = ($: cheerio.CheerioAPI): void => {
  const title = $('[data-role="title"]')
    .toArray()
    .map((node) => $(node))
    .find((candidate) => isCorporateTopLeftTitle(candidate))
  if (!title) return

  title.attr('data-corporate-title-fit', '1')
  const titleStyles = parseInlineStyle(title.attr('style'))
  titleStyles.set('overflow', 'hidden')
  title.attr('style', serializeInlineStyle(titleStyles))

  title
    .find('p')
    .toArray()
    .map((node) => $(node))
    .filter((line) => line.text().replace(/\s+/g, '').length > 0)
    .slice(0, 2)
    .forEach((line) => {
      line.attr('data-corporate-title-line', '1')
      const lineStyles = parseInlineStyle(line.attr('style'))
      lineStyles.set('box-sizing', 'border-box')
      lineStyles.set('display', 'block')
      lineStyles.set('margin-left', '0')
      lineStyles.set('margin-right', '0')
      lineStyles.set('max-width', '100%')
      lineStyles.set('overflow', 'visible')
      lineStyles.set('text-align', 'center')
      lineStyles.set('white-space', 'nowrap')
      lineStyles.set('width', '100%')
      line.attr('style', serializeInlineStyle(lineStyles))
    })

  if ($('style[data-ppt-corporate-title-fit]').length === 0) {
    const style = $('<style></style>')
      .attr('data-ppt-corporate-title-fit', '')
      .text(CORPORATE_TITLE_FIT_STYLE)
    $('head').append(style)
  }
  if ($('script[data-ppt-corporate-title-fit]').length === 0) {
    const script = $('<script></script>')
      .attr('data-ppt-corporate-title-fit', '')
      .text(CORPORATE_TITLE_FIT_SCRIPT)
    $('body').append(script)
  }
}

const classPixelValue = (className: string, prefix: string): number | null => {
  const match = className.match(
    new RegExp(`(?:^|\\s)${prefix}-\\[(-?\\d+(?:\\.\\d+)?)px\\](?:\\s|$)`)
  )
  if (!match) return null
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

const elementFixedWidth = (element: cheerio.Cheerio<AnyNode>): number | null => {
  const styleWidth = parsePixelValue(parseInlineStyle(element.attr('style')).get('width'))
  return styleWidth ?? classPixelValue(element.attr('class') || '', 'w')
}

const elementFixedHeight = (element: cheerio.Cheerio<AnyNode>): number | null =>
  parsePixelValue(parseInlineStyle(element.attr('style')).get('height'))

const isFullHeightElement = (element: cheerio.Cheerio<AnyNode>): boolean => {
  const className = element.attr('class') || ''
  const fixedHeight = elementFixedHeight(element)
  return /(?:^|\s)(?:h-full|min-h-full)(?:\s|$)/.test(className) || (fixedHeight ?? 0) >= 700
}

const findFullHeightSidebar = ($: cheerio.CheerioAPI): boolean => {
  let found = false
  $('[data-role="content"]')
    .find('div,section,main')
    .each((_, node) => {
      if (found) return false
      const parent = $(node)
      const parentClassName = parent.attr('class') || ''
      const parentStyles = parseInlineStyle(parent.attr('style'))
      const isFlex =
        /(?:^|\s)flex(?:\s|$)/.test(parentClassName) || parentStyles.get('display') === 'flex'
      if (!isFlex || !isFullHeightElement(parent)) return undefined
      const firstChild = parent.children().first()
      if (!firstChild.length) return undefined
      const width = elementFixedWidth(firstChild)
      if (
        width !== null &&
        width >= CORPORATE_HEADER_MIN_WIDTH &&
        width <= CORPORATE_HEADER_MAX_WIDTH &&
        isFullHeightElement(firstChild)
      ) {
        found = true
        return false
      }
      return undefined
    })
  return found
}

const hasCorporateHeaderWidthOffsetUtility = ($: cheerio.CheerioAPI): boolean => {
  let found = false
  $('[data-role="content"] [class]').each((_, node) => {
    if (found) return false
    const className = $(node).attr('class') || ''
    const marginLeft = classPixelValue(className, 'ml')
    const paddingLeft = classPixelValue(className, 'pl')
    const offset = marginLeft ?? paddingLeft
    if (
      offset !== null &&
      offset >= CORPORATE_HEADER_MIN_WIDTH &&
      offset <= CORPORATE_HEADER_MAX_WIDTH
    ) {
      found = true
      return false
    }
    if (/grid-cols-\[(?:3\d{2}|4[01]\d)px_1fr\]/.test(className)) {
      found = true
      return false
    }
    return undefined
  })
  return found
}

const isPageLevelPositionedElement = (
  $: cheerio.CheerioAPI,
  element: cheerio.Cheerio<AnyNode>
): boolean => {
  const positionedAncestor = element
    .parents()
    .toArray()
    .map((node) => $(node))
    .find((ancestor) => {
      const position = parseInlineStyle(ancestor.attr('style')).get('position')
      return position === 'absolute' || position === 'relative' || position === 'fixed'
    })
  if (!positionedAncestor) return true
  return (
    positionedAncestor.is('[data-role="content"]') ||
    positionedAncestor.is('[data-page-scaffold]') ||
    positionedAncestor.hasClass('ppt-page-content')
  )
}

const resolveAbsoluteBodyBounds = (
  $: cheerio.CheerioAPI
): { left: number; right: number } | null => {
  const rects = $('[data-role="content"] [style]')
    .toArray()
    .map((node) => $(node))
    .filter((element) => isPageLevelPositionedElement($, element))
    .flatMap((element) => {
      const rect = readPositionedRect(element)
      return rect
        ? [
            {
              element,
              rect,
              position: parseInlineStyle(element.attr('style')).get('position')
            }
          ]
        : []
    })
    .filter(({ element, rect, position }) => {
      if (position !== 'absolute') return false
      if (rect.top < CORPORATE_BODY_TOP || rect.top + rect.height > CORPORATE_BODY_BOTTOM) {
        return false
      }
      if (rect.width < 240 || rect.height < 60) return false
      if (element.text().replace(/\s+/g, '').length === 0) return false
      return true
    })
    .map(({ rect }) => rect)
  if (rects.length === 0) return null
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    right: Math.max(...rects.map((rect) => rect.left + rect.width))
  }
}

const replaceTextNodeValue = (node: AnyNode, pageNumber: number, totalPages: number): void => {
  if (node.type !== 'text') return
  node.data = node.data
    .replace(PAGE_NUMBER_PLACEHOLDER_PATTERN, String(pageNumber))
    .replace(PAGE_TOTAL_PATTERN, `/${totalPages}`)
}

export const normalizeCorporateTemplatePageChrome = (
  html: string,
  options: {
    pageNumber: number
    totalPages: number
    templateRole: CorporateTemplatePageRole
  }
): string => {
  if (options.templateRole === 'closing') return html

  const $ = cheerio.load(html, { scriptingEnabled: false })
  if (options.templateRole === 'body') {
    normalizeCorporateBodyTitle($)
  }
  const placeholderTextNodes = $('*')
    .contents()
    .toArray()
    .filter(
      (node) => node.type === 'text' && PAGE_NUMBER_PLACEHOLDER_DETECT_PATTERN.test(node.data)
    )
  // The imported corporate template keeps the current-page token and the
  // sample total in sibling spans inside one footer section. Restrict changes
  // to that section so ordinary slide content such as "20页报告" is untouched.
  placeholderTextNodes.forEach((node) => {
    const footerSection = $(node).closest('section')
    if (!footerSection.length) return
    footerSection
      .contents()
      .add(footerSection.find('*').contents())
      .toArray()
      .forEach((child) => replaceTextNodeValue(child, options.pageNumber, options.totalPages))
  })

  return $.html()
}

export const validateCorporateTemplateBodyPageLayout = (
  html: string
): { valid: boolean; errors: string[] } => {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  const errors: string[] = []

  if (findFullHeightSidebar($) || hasCorporateHeaderWidthOffsetUtility($)) {
    errors.push(
      '公司正文页把左上角约 347px 的标题区扩展成了整页侧栏；标题区只能占用顶部约 128px，正文必须在其下方使用全页宽度并居中。'
    )
  }

  const bodyBounds = resolveAbsoluteBodyBounds($)
  if (bodyBounds) {
    const bodyCenter = (bodyBounds.left + bodyBounds.right) / 2
    const centerOffset = bodyCenter - 800
    if (Math.abs(centerOffset) > CORPORATE_BODY_MAX_CENTER_OFFSET) {
      errors.push(
        centerOffset > 0
          ? `公司正文区域偏右 ${Math.round(centerOffset)}px；正文左右留白必须平衡，几何中心与页面中心偏差不得超过 ${CORPORATE_BODY_MAX_CENTER_OFFSET}px。`
          : `公司正文区域偏左 ${Math.round(Math.abs(centerOffset))}px；正文左右留白必须平衡，几何中心与页面中心偏差不得超过 ${CORPORATE_BODY_MAX_CENTER_OFFSET}px。`
      )
    }
  }

  return { valid: errors.length === 0, errors }
}
