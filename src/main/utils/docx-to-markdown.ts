import * as mammoth from 'mammoth'
import TurndownService from 'turndown'
import { gfm } from '@joplin/turndown-plugin-gfm'

const NULL_CHAR_PATTERN = new RegExp(String.fromCharCode(0), 'g')

const compactText = (value: string): string =>
  value
    .replace(NULL_CHAR_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

const stripInlineImagesFromHtml = (html: string): string =>
  html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt=(["'])(.*?)\1/i)?.[2]?.trim()
    return alt ? `<p>[图片：${alt}]</p>` : ''
  })

const stripMarkdownDataImages = (markdown: string): string =>
  markdown.replace(/!\[[^\]]*]\(data:[^)]+\)/gi, '').replace(/!\[[^\]]*]\(\s*\)/g, '')

export const convertDocxToMarkdown = async (filePath: string): Promise<string> => {
  const result = await mammoth.convertToHtml({ path: filePath })
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  })
  turndown.use(gfm)
  return compactText(
    stripMarkdownDataImages(turndown.turndown(stripInlineImagesFromHtml(result.value)))
  )
}
