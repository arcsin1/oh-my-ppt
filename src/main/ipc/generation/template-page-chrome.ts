import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { CorporateTemplatePageRole } from '@shared/corporate-template'

const PAGE_NUMBER_PLACEHOLDER_PATTERN = /[‹〈<《]\s*#\s*[›〉>》]/g
const PAGE_NUMBER_PLACEHOLDER_DETECT_PATTERN = /[‹〈<《]\s*#\s*[›〉>》]/
const PAGE_TOTAL_PATTERN = /\/\s*\d+/g

const replaceTextNodeValue = (
  node: AnyNode,
  pageNumber: number,
  totalPages: number
): void => {
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
  const placeholderTextNodes = $('*')
    .contents()
    .toArray()
    .filter(
      (node) =>
        node.type === 'text' && PAGE_NUMBER_PLACEHOLDER_DETECT_PATTERN.test(node.data)
    )
  if (placeholderTextNodes.length === 0) return html

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
      .forEach((child) =>
        replaceTextNodeValue(child, options.pageNumber, options.totalPages)
      )
  })

  return $.html()
}
