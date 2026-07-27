import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { toString } from 'mdast-util-to-string'
import { gfm } from 'micromark-extension-gfm'
import type { ListItem, Nodes, Root } from 'mdast'
import {
  SECTION_AGENDA_REASON_PREFIX_EN,
  SECTION_AGENDA_REASON_PREFIX_ZH
} from '@shared/generation'
import { MAX_CORPORATE_PAGE_COUNT } from '@shared/brand'

export interface MarkdownHeadingNode {
  level: number
  title: string
  lineStart: number
  lineEnd: number
  charCount: number
  bulletCount: number
  tableCount: number
  codeBlockCount: number
  taskListCount: number
  hasMetrics: boolean
  children: MarkdownHeadingNode[]
}

export interface DocumentOutlineScan {
  format: 'markdown' | 'text' | 'csv'
  headingCount: number
  topLevelTitle: string | null
  sectionTree: MarkdownHeadingNode[]
  recommendedSplitHints: string[]
}

export interface DocumentOutlinePageCandidate {
  role: 'chapter-divider' | 'content'
  title: string
  sourceHeading: string
  headingLevel: number
  lineStart: number
  lineEnd: number
  reason: string
}

export interface DocumentOutlinePageCountEstimate {
  preferredPageCount: number
  minPageCount: number
  maxPageCount: number
  basis: string
}

const METRIC_PATTERN =
  /(?:\d+(?:\.\d+)?\s*%|\b\d{4}\b|[$￥€]\s*\d|\d+(?:\.\d+)?\s*(?:万|亿|million|billion|k|m|bn)\b)/i
const HIGH_SIGNAL_PATTERN =
  /(?:结论|风险|行动|决策|指标|增长|下降|summary|risk|action|decision|metric|growth|decline)/i
const STANDALONE_UNIT_TITLE_PATTERN =
  /(?:方法|清单|模板|话术|案例|技巧|步骤|计划|复盘|指标|配置|标准|策略|架构|对比|怎么办|Q\d+|Day\s*\d+|method|checklist|template|script|case|tips|steps|plan|review|metric|strategy|workflow|standard|comparison|how to|q\d+)/i
const H2_OWN_BODY_SLIDE_CHAR_COUNT = 160
const DEEP_STANDALONE_SLIDE_CHAR_COUNT = 240
const DEEP_STANDALONE_HIGH_SIGNAL_CHAR_COUNT = 120
const MAX_PROMPT_PAGE_CANDIDATES = MAX_CORPORATE_PAGE_COUNT

type AstNode = Nodes | Root

const headingToLine = (node: MarkdownHeadingNode): string =>
  `${'  '.repeat(Math.max(0, node.level - 1))}- ${'#'.repeat(node.level)} ${node.title} (lines ${node.lineStart}-${node.lineEnd}, chars ${node.charCount})`

const headingSourceLabel = (heading: MarkdownHeadingNode): string =>
  `${'#'.repeat(heading.level)} ${heading.title}`

const textContainsCjk = (value: string): boolean =>
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(value)

const flattenHeadings = (nodes: MarkdownHeadingNode[]): MarkdownHeadingNode[] =>
  nodes.flatMap((node) => [node, ...flattenHeadings(node.children)])

const meaningfulHeadings = (scan: DocumentOutlineScan | null): MarkdownHeadingNode[] =>
  scan ? flattenHeadings(scan.sectionTree).filter((heading) => heading.title.trim().length > 0) : []

const chapterDividerHeadings = (scan: DocumentOutlineScan | null): MarkdownHeadingNode[] => {
  const h1Headings = meaningfulHeadings(scan).filter((heading) => heading.level === 1)
  return h1Headings.length > 1 ? h1Headings.slice(1) : []
}

const directBodyCharCount = (heading: MarkdownHeadingNode): number =>
  Math.max(0, heading.charCount - heading.children.reduce((sum, child) => sum + child.charCount, 0))

const isStandaloneSlideCandidate = (heading: MarkdownHeadingNode): boolean => {
  if (heading.level < 3) return false
  if (heading.level === 3) {
    return (
      heading.charCount >= 120 ||
      heading.bulletCount >= 1 ||
      heading.tableCount >= 1 ||
      heading.taskListCount >= 1 ||
      heading.hasMetrics ||
      STANDALONE_UNIT_TITLE_PATTERN.test(heading.title)
    )
  }
  return (
    heading.charCount >= DEEP_STANDALONE_SLIDE_CHAR_COUNT ||
    heading.bulletCount >= 3 ||
    heading.tableCount >= 1 ||
    heading.taskListCount >= 2 ||
    (heading.hasMetrics && heading.charCount >= DEEP_STANDALONE_HIGH_SIGNAL_CHAR_COUNT) ||
    (STANDALONE_UNIT_TITLE_PATTERN.test(heading.title) &&
      heading.charCount >= DEEP_STANDALONE_HIGH_SIGNAL_CHAR_COUNT)
  )
}

const hasStandaloneSlideCandidateChild = (heading: MarkdownHeadingNode): boolean =>
  flattenHeadings(heading.children).some(isStandaloneSlideCandidate)

const isLevel2ContentSlideCandidate = (heading: MarkdownHeadingNode): boolean =>
  heading.level === 2 &&
  (!hasStandaloneSlideCandidateChild(heading) ||
    directBodyCharCount(heading) >= H2_OWN_BODY_SLIDE_CHAR_COUNT)

const hasSingleDocumentTitle = (headings: MarkdownHeadingNode[]): boolean =>
  headings.filter((heading) => heading.level === 1).length === 1

const topLevelSectionHeadings = (headings: MarkdownHeadingNode[]): MarkdownHeadingNode[] =>
  headings.filter((heading) => heading.level === 2)

const shouldPreferTopLevelSections = (headings: MarkdownHeadingNode[]): boolean =>
  hasSingleDocumentTitle(headings) && topLevelSectionHeadings(headings).length > 0

const directLevel3Children = (heading: MarkdownHeadingNode): MarkdownHeadingNode[] =>
  heading.children.filter((child) => child.level === 3)

const shouldCreateSectionAgendaPage = (heading: MarkdownHeadingNode): boolean =>
  directLevel3Children(heading).length >= 2

const formatSectionAgendaReason = (heading: MarkdownHeadingNode): string => {
  const allChildTitles = directLevel3Children(heading).map((child) => child.title)
  const childTitles = allChildTitles.slice(0, 12)
  const useChineseLabels = textContainsCjk(`${heading.title}\n${childTitles.join('\n')}`)
  if (childTitles.length === 0) {
    return useChineseLabels
      ? `${SECTION_AGENDA_REASON_PREFIX_ZH}：概览本章结构。`
      : `${SECTION_AGENDA_REASON_PREFIX_EN}: overview this chapter structure.`
  }
  const suffix =
    allChildTitles.length > childTitles.length
      ? useChineseLabels
        ? `等共 ${allChildTitles.length} 个子主题`
        : `and ${allChildTitles.length} child topics in total`
      : ''
  const joinedTitles = [childTitles.join(useChineseLabels ? '、' : ', '), suffix]
    .filter(Boolean)
    .join(useChineseLabels ? '，' : ', ')
  return useChineseLabels
    ? `${SECTION_AGENDA_REASON_PREFIX_ZH}：概览本章下的子主题，包括：${joinedTitles}。`
    : `${SECTION_AGENDA_REASON_PREFIX_EN}: overview this chapter child topics, including: ${joinedTitles}.`
}

const level2CandidateLineEnd = (heading: MarkdownHeadingNode): number => {
  if (!hasStandaloneSlideCandidateChild(heading)) return heading.lineEnd
  const firstChildLineStart = flattenHeadings(heading.children)
    .map((child) => child.lineStart)
    .sort((a, b) => a - b)[0]
  return firstChildLineStart
    ? Math.max(heading.lineStart, firstChildLineStart - 1)
    : heading.lineEnd
}

const level2AgendaLineEnd = (heading: MarkdownHeadingNode): number => {
  const firstChildLineStart = directLevel3Children(heading)
    .map((child) => child.lineStart)
    .sort((a, b) => a - b)[0]
  return firstChildLineStart
    ? Math.max(heading.lineStart, firstChildLineStart - 1)
    : heading.lineEnd
}

export const deriveOutlinePageCandidates = (
  scan: DocumentOutlineScan | null
): DocumentOutlinePageCandidate[] => {
  const headings = meaningfulHeadings(scan)
  if (headings.length === 0) return []
  if (shouldPreferTopLevelSections(headings)) {
    return topLevelSectionHeadings(headings).flatMap((heading) => {
      const childCandidates = directLevel3Children(heading)
      if (!shouldCreateSectionAgendaPage(heading)) {
        return [
          {
            role: 'content' as const,
            title: heading.title,
            sourceHeading: headingSourceLabel(heading),
            headingLevel: heading.level,
            lineStart: heading.lineStart,
            lineEnd: heading.lineEnd,
            reason: 'top-level ## section in a structured document outline'
          }
        ]
      }
      return [
        {
          role: 'content' as const,
          title: heading.title,
          sourceHeading: headingSourceLabel(heading),
          headingLevel: heading.level,
          lineStart: heading.lineStart,
          lineEnd: level2AgendaLineEnd(heading),
          reason: formatSectionAgendaReason(heading)
        },
        ...childCandidates.map((child) => ({
          role: 'content' as const,
          title: child.title,
          sourceHeading: headingSourceLabel(child),
          headingLevel: child.level,
          lineStart: child.lineStart,
          lineEnd: child.lineEnd,
          reason: `standalone level-${child.level} section`
        }))
      ]
    })
  }

  let seenMeaningfulH1 = false

  const candidates = headings.flatMap((heading): DocumentOutlinePageCandidate[] => {
    if (heading.level === 1) {
      if (!seenMeaningfulH1) {
        seenMeaningfulH1 = true
        return []
      }
      return [
        {
          role: 'chapter-divider',
          title: heading.title,
          sourceHeading: headingSourceLabel(heading),
          headingLevel: heading.level,
          lineStart: heading.lineStart,
          lineEnd: heading.lineEnd,
          reason: 'major # heading after the topic'
        }
      ]
    }

    if (isLevel2ContentSlideCandidate(heading)) {
      const hasStandaloneChild = hasStandaloneSlideCandidateChild(heading)
      return [
        {
          role: 'content',
          title: heading.title,
          sourceHeading: headingSourceLabel(heading),
          headingLevel: heading.level,
          lineStart: heading.lineStart,
          lineEnd: level2CandidateLineEnd(heading),
          reason: hasStandaloneChild
            ? '## section has substantial own body before standalone child sections'
            : 'leaf ## section without standalone child sections'
        }
      ]
    }

    if (isStandaloneSlideCandidate(heading)) {
      return [
        {
          role: 'content',
          title: heading.title,
          sourceHeading: headingSourceLabel(heading),
          headingLevel: heading.level,
          lineStart: heading.lineStart,
          lineEnd: heading.lineEnd,
          reason: `standalone level-${heading.level} section`
        }
      ]
    }

    return []
  })

  return candidates
}

const appendHeading = (
  roots: MarkdownHeadingNode[],
  stack: MarkdownHeadingNode[],
  node: MarkdownHeadingNode
): void => {
  while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
  const parent = stack[stack.length - 1]
  if (parent) parent.children.push(node)
  else roots.push(node)
  stack.push(node)
}

const parseMarkdownAst = (content: string): Root =>
  fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  }) as Root

const lineStartOf = (node: AstNode): number => node.position?.start.line ?? 1

const visitNode = (node: AstNode, visitor: (node: AstNode) => void): void => {
  visitor(node)
  const children = 'children' in node && Array.isArray(node.children) ? node.children : []
  children.forEach((child) => visitNode(child as AstNode, visitor))
}

const collectSectionNodes = (tree: Root, heading: MarkdownHeadingNode): AstNode[] => {
  const rootChildren = tree.children as AstNode[]
  const startIndex = rootChildren.findIndex(
    (node) => node.type === 'heading' && lineStartOf(node) === heading.lineStart
  )
  if (startIndex < 0) return []
  const result: AstNode[] = []
  for (const node of rootChildren.slice(startIndex + 1)) {
    const nodeStart = lineStartOf(node)
    if (nodeStart > heading.lineEnd) break
    result.push(node)
  }
  return result
}

const computeHeadingStats = (node: MarkdownHeadingNode, tree: Root, lines: string[]): void => {
  const sectionLines = lines.slice(node.lineStart - 1, node.lineEnd)
  const sectionNodes = collectSectionNodes(tree, node)
  let bulletCount = 0
  let tableCount = 0
  let codeBlockCount = 0
  let taskListCount = 0

  sectionNodes.forEach((sectionNode) => {
    visitNode(sectionNode, (visited) => {
      if (visited.type === 'listItem') {
        bulletCount += 1
        if (typeof (visited as ListItem).checked === 'boolean') taskListCount += 1
      } else if (visited.type === 'table') {
        tableCount += 1
      } else if (visited.type === 'code') {
        codeBlockCount += 1
      }
    })
  })

  node.charCount = sectionLines.join('\n').length
  node.bulletCount = bulletCount
  node.tableCount = tableCount
  node.codeBlockCount = codeBlockCount
  node.taskListCount = taskListCount
  node.hasMetrics = sectionLines.some((line) => METRIC_PATTERN.test(line))
  node.children.forEach((child) => computeHeadingStats(child, tree, lines))
}

export const scanDocumentOutline = (
  content: string,
  format: DocumentOutlineScan['format'] = 'markdown'
): DocumentOutlineScan => {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const tree = parseMarkdownAst(content)
  const roots: MarkdownHeadingNode[] = []
  const stack: MarkdownHeadingNode[] = []
  const flat: MarkdownHeadingNode[] = []

  tree.children.forEach((child) => {
    if (child.type !== 'heading') return
    const title = toString(child).trim()
    if (!title) return
    const node: MarkdownHeadingNode = {
      level: child.depth,
      title,
      lineStart: lineStartOf(child),
      lineEnd: lines.length,
      charCount: 0,
      bulletCount: 0,
      tableCount: 0,
      codeBlockCount: 0,
      taskListCount: 0,
      hasMetrics: false,
      children: []
    }
    appendHeading(roots, stack, node)
    flat.push(node)
  })

  flat.forEach((node, index) => {
    const nextPeerOrParent = flat.slice(index + 1).find((heading) => heading.level <= node.level)
    node.lineEnd = nextPeerOrParent
      ? Math.max(node.lineStart, nextPeerOrParent.lineStart - 1)
      : lines.length
  })

  roots.forEach((node) => computeHeadingStats(node, tree, lines))

  const headings = flattenHeadings(roots)
  const h2Count = headings.filter((heading) => heading.level === 2).length
  const chapterDividerCount = Math.max(
    0,
    headings.filter((heading) => heading.level === 1).length - 1
  )
  const standaloneSections = headings.filter(isStandaloneSlideCandidate)
  const denseHeadings = headings.filter(
    (heading) =>
      heading.level >= 2 &&
      heading.level <= 4 &&
      (heading.charCount >= 900 ||
        heading.children.length >= 3 ||
        heading.bulletCount >= 6 ||
        heading.tableCount >= 1 ||
        heading.taskListCount >= 2 ||
        heading.hasMetrics)
  )
  const recommendedSplitHints = [
    h2Count > 0 ? `${h2Count} level-2 sections are section groups or slide candidates.` : '',
    chapterDividerCount > 0
      ? `${chapterDividerCount} major level-1 chapter headings should become standalone chapter divider slides.`
      : '',
    standaloneSections.length > 0
      ? `Substantial level-3+ sections can be standalone slides: ${standaloneSections
          .slice(0, 10)
          .map((heading) => `${'#'.repeat(heading.level)} ${heading.title}`)
          .join('; ')}.`
      : '',
    denseHeadings.length > 0
      ? `Dense sections may need splitting: ${denseHeadings
          .slice(0, 6)
          .map((heading) => `${'#'.repeat(heading.level)} ${heading.title}`)
          .join('; ')}.`
      : '',
    headings.some((heading) => HIGH_SIGNAL_PATTERN.test(heading.title))
      ? 'Some headings contain high-signal terms such as risks, actions, decisions, metrics, or growth.'
      : ''
  ].filter(Boolean)

  return {
    format,
    headingCount: headings.length,
    topLevelTitle: headings.find((heading) => heading.level === 1)?.title || null,
    sectionTree: roots,
    recommendedSplitHints
  }
}

export const formatDocumentOutlineScanForPrompt = (
  scan: DocumentOutlineScan | null,
  pageCandidatesOverride?: DocumentOutlinePageCandidate[]
): string => {
  if (!scan) return ''
  const headings = flattenHeadings(scan.sectionTree)
  const pageCandidates = pageCandidatesOverride ?? deriveOutlinePageCandidates(scan)
  const pageCountEstimate = estimateOutlinePageCount(scan, pageCandidates)
  const chapterDividers = chapterDividerHeadings(scan)
  if (headings.length === 0) {
    return [
      'Document structure scan:',
      `- Format: ${scan.format}`,
      '- Markdown headings detected: 0',
      '- No heading hierarchy was detected; split by paragraphs, list blocks, tables, metrics, and semantic transitions.'
    ].join('\n')
  }

  const visibleHeadings = headings.slice(0, 80)
  const omittedHeadingCount = Math.max(0, headings.length - visibleHeadings.length)
  const visiblePageCandidates = pageCandidates.slice(0, MAX_PROMPT_PAGE_CANDIDATES)
  const omittedPageCandidateCount = Math.max(
    0,
    pageCandidates.length - visiblePageCandidates.length
  )
  const pageCandidatePromptCount = visiblePageCandidates.length

  return [
    'Document structure scan:',
    `- Format: ${scan.format}`,
    `- Markdown headings detected: ${scan.headingCount}`,
    scan.topLevelTitle ? `- Top-level title: ${scan.topLevelTitle}` : '',
    pageCountEstimate
      ? `- Deterministic slide-count estimate: prefer ${pageCountEstimate.preferredPageCount} slides; acceptable range ${pageCountEstimate.minPageCount}-${pageCountEstimate.maxPageCount}. ${pageCountEstimate.basis}`
      : '',
    chapterDividers.length > 0
      ? `- Chapter divider slides: ${chapterDividers
          .slice(0, 12)
          .map((heading) => `# ${heading.title}`)
          .join(
            '; '
          )}${chapterDividers.length > 12 ? '; ...' : ''}. Keep these as standalone section-divider pages.`
      : '',
    pageCandidates.length > 0
      ? omittedPageCandidateCount > 0
        ? `- Page candidate skeleton (${pageCandidatePromptCount} visible of ${pageCandidates.length} candidates): Use the visible candidates as the authoritative first-pass outline when the user did not provide pageCount. Return pageCount=${pageCandidatePromptCount}; later slide generation will inspect source passages again.`
        : `- Page candidate skeleton (${pageCandidates.length} slides): Use this as the authoritative first-pass outline when the user did not provide pageCount. Do not reread every candidate before returning; later slide generation will inspect source passages again.`
      : '',
    ...visiblePageCandidates.map(
      (candidate, index) =>
        `  ${index + 1}. [${candidate.role}] ${candidate.sourceHeading} (lines ${candidate.lineStart}-${candidate.lineEnd}; ${candidate.reason})`
    ),
    omittedPageCandidateCount > 0
      ? `- Page candidate skeleton truncated: ${omittedPageCandidateCount} additional candidates were omitted from this parse prompt to keep parsing bounded.`
      : '',
    '- Heading map:',
    ...visibleHeadings.map(headingToLine),
    omittedHeadingCount > 0
      ? `- Heading map truncated: ${omittedHeadingCount} additional headings were omitted from this single-shot parse prompt.`
      : '',
    scan.recommendedSplitHints.length > 0 ? '- Split/merge hints:' : '',
    ...scan.recommendedSplitHints.map((hint) => `  - ${hint}`)
  ]
    .filter(Boolean)
    .join('\n')
}

export const scanHasMultipleSlideCandidates = (scan: DocumentOutlineScan | null): boolean => {
  if (!scan) return false
  const headings = meaningfulHeadings(scan)
  const h2Count = headings.filter((heading) => heading.level === 2).length
  const standaloneSectionCount = headings.filter(isStandaloneSlideCandidate).length
  return h2Count >= 2 || standaloneSectionCount >= 2 || headings.length >= 4
}

export const scanHeadingTitles = (scan: DocumentOutlineScan | null): string[] =>
  meaningfulHeadings(scan).map((heading) => heading.title)

export const estimateOutlinePageCount = (
  scan: DocumentOutlineScan | null,
  pageCandidatesOverride?: DocumentOutlinePageCandidate[]
): DocumentOutlinePageCountEstimate | null => {
  const headings = meaningfulHeadings(scan)
  if (headings.length === 0) return null
  const h2Count = headings.filter((heading) => heading.level === 2).length
  const standaloneSectionCount = headings.filter(isStandaloneSlideCandidate).length
  const chapterDividerCount = chapterDividerHeadings(scan).length
  const h2ContentPageCount = headings.filter(isLevel2ContentSlideCandidate).length
  const pageCandidates = pageCandidatesOverride ?? deriveOutlinePageCandidates(scan)
  const preferTopLevelSections = shouldPreferTopLevelSections(headings)
  const topLevelSections = topLevelSectionHeadings(headings)
  const sectionAgendaPageCount = topLevelSections.filter(
    shouldCreateSectionAgendaPage
  ).length
  const directLevel3PageCount = topLevelSections.filter(shouldCreateSectionAgendaPage).reduce(
    (sum, heading) => sum + directLevel3Children(heading).length,
    0
  )
  const nonAgendaTopLevelSectionCount = topLevelSections.length - sectionAgendaPageCount

  const naturalSectionCount =
    preferTopLevelSections
      ? sectionAgendaPageCount + directLevel3PageCount + nonAgendaTopLevelSectionCount
      : h2Count > 0
      ? h2ContentPageCount + standaloneSectionCount
      : Math.max(
          chapterDividerCount,
          Math.ceil(headings.filter((heading) => heading.level >= 3).length / 3),
          1
        )
  const preferredPageCount = Math.max(
    1,
    Math.min(
      MAX_PROMPT_PAGE_CANDIDATES,
      pageCandidates.length > 0 ? pageCandidates.length : chapterDividerCount + naturalSectionCount
    )
  )
  const minPageCount =
    preferredPageCount <= 3
      ? preferredPageCount
      : Math.max(2, Math.floor(preferredPageCount * 0.85))
  const maxPageCount =
    preferredPageCount <= 3
      ? Math.min(MAX_PROMPT_PAGE_CANDIDATES, preferredPageCount + 1)
      : Math.min(MAX_PROMPT_PAGE_CANDIDATES, Math.ceil(preferredPageCount * 1.15))

  return {
    preferredPageCount,
    minPageCount,
    maxPageCount,
    basis: preferTopLevelSections
      ? `Based on ${h2Count} top-level level-2 document sections, including ${sectionAgendaPageCount} section agenda pages with at least 2 child sections and ${directLevel3PageCount} direct level-3 content pages${pageCandidates.length > MAX_PROMPT_PAGE_CANDIDATES ? `, capped to ${MAX_PROMPT_PAGE_CANDIDATES} visible page candidates for parsing` : ''}.`
      : `Based on ${chapterDividerCount} chapter divider headings, ${h2ContentPageCount} level-2 content slide candidates, and ${standaloneSectionCount} standalone level-3+ slide candidates${pageCandidates.length > MAX_PROMPT_PAGE_CANDIDATES ? `, capped to ${MAX_PROMPT_PAGE_CANDIDATES} visible page candidates for parsing` : ''}.`
  }
}
