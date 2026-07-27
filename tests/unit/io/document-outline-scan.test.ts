import { describe, expect, it } from 'vitest'
import {
  deriveOutlinePageCandidates,
  estimateOutlinePageCount,
  formatDocumentOutlineScanForPrompt,
  scanDocumentOutline,
  scanHasMultipleSlideCandidates
} from '../../../src/main/ipc/io/document-outline-scan'

describe('document outline scan', () => {
  it('extracts markdown heading structure and density hints', () => {
    const scan = scanDocumentOutline(
      [
        '# AI Animation Report',
        '',
        'Intro text.',
        '',
        '## Market Size',
        '- Global growth reached 15%',
        '- China market expanded in 2026',
        '',
        '### Global Growth',
        'Revenue grew 15% YoY.',
        '',
        '## Production Workflow',
        '| Stage | Tool |',
        '| --- | --- |',
        '| Script | LLM |'
      ].join('\n')
    )

    expect(scan.headingCount).toBe(4)
    expect(scan.topLevelTitle).toBe('AI Animation Report')
    expect(scan.sectionTree[0].children.map((node) => node.title)).toEqual([
      'Market Size',
      'Production Workflow'
    ])
    expect(scan.sectionTree[0].children[0].hasMetrics).toBe(true)
    expect(scan.sectionTree[0].children[1].tableCount).toBeGreaterThan(0)
    expect(scan.recommendedSplitHints.join('\n')).toContain(
      'Substantial level-3+ sections can be standalone slides'
    )
    expect(scan.recommendedSplitHints.join('\n')).toContain('### Global Growth')
    expect(scanHasMultipleSlideCandidates(scan)).toBe(true)
  })

  it('derives an authoritative page candidate skeleton in source order', () => {
    const scan = scanDocumentOutline(
      [
        '# Growth Manual',
        '',
        '# 第一篇：认知篇',
        '## 1.1 行业现状',
        'Details.',
        '### 核心变化',
        '- 消费链路变化',
        '',
        '# 第二篇：实操篇',
        '## 2.1 账号定位',
        'Details.'
      ].join('\n')
    )
    const candidates = deriveOutlinePageCandidates(scan)
    const promptText = formatDocumentOutlineScanForPrompt(scan)

    expect(candidates.map((candidate) => candidate.sourceHeading)).toEqual([
      '# 第一篇：认知篇',
      '### 核心变化',
      '# 第二篇：实操篇',
      '## 2.1 账号定位'
    ])
    expect(candidates.map((candidate) => candidate.role)).toEqual([
      'chapter-divider',
      'content',
      'chapter-divider',
      'content'
    ])
    expect(promptText).toContain('Page candidate skeleton (4 slides)')
    expect(promptText).toContain('[chapter-divider] # 第一篇：认知篇')
    expect(promptText).toContain('[content] ### 核心变化')
    expect(promptText).toContain('authoritative first-pass outline')
  })

  it('uses level-2 sections as pages without adding a synthetic contents page', () => {
    const scan = scanDocumentOutline(
      ['# ss', '', '## dd', 'Details.', '', '## Ff', 'More.'].join('\n')
    )
    const candidates = deriveOutlinePageCandidates(scan)

    expect(candidates.map((candidate) => candidate.title)).toEqual(['dd', 'Ff'])
    expect(candidates[0]).toMatchObject({
      role: 'content',
      sourceHeading: '## dd',
      headingLevel: 2,
      lineStart: 3,
      lineEnd: 5
    })
    expect(estimateOutlinePageCount(scan)?.preferredPageCount).toBe(2)
  })

  it('keeps a level-2 section as one page when it has only one direct level-3 child', () => {
    const scan = scanDocumentOutline(
      [
        '# Quarterly Report',
        '',
        '## Market Review',
        'Intro.',
        '',
        '### Channel Metrics',
        '- GMV grew 15%',
        '- Conversion improved 8%',
        '',
        '## Next Steps',
        'Follow-up actions.'
      ].join('\n')
    )
    const candidates = deriveOutlinePageCandidates(scan)

    expect(candidates.map((candidate) => candidate.sourceHeading)).toEqual([
      '## Market Review',
      '## Next Steps'
    ])
    expect(candidates[0]).toMatchObject({
      headingLevel: 2,
      lineStart: 3,
      lineEnd: 9,
      reason: 'top-level ## section in a structured document outline'
    })
    expect(candidates[0].reason).not.toContain('Section agenda page')
    expect(estimateOutlinePageCount(scan)?.preferredPageCount).toBe(2)
  })

  it('marks truncated section agenda child lists', () => {
    const source = [
      '# Large Agenda',
      '',
      '## Detailed Chapter',
      ...Array.from({ length: 13 }, (_, index) => [
        `### Topic ${index + 1}`,
        `Details ${index + 1}.`
      ]).flat()
    ].join('\n')
    const candidates = deriveOutlinePageCandidates(scanDocumentOutline(source))

    expect(candidates[0].reason).toContain('Topic 12')
    expect(candidates[0].reason).not.toContain('Topic 13')
    expect(candidates[0].reason).toContain('13 child topics in total')
  })

  it('uses level-2 chapters with direct level-3 children as section agenda pages', () => {
    const scan = scanDocumentOutline(
      [
        '# 2026 AI动漫的发展与未来：数据驱动下的产业变革',
        '',
        '## 一、2026年全球AI动漫产业关键数据（预测/推演）',
        '| 指标 | 2023年实际 | 2026年（预估） |',
        '| --- | --- | --- |',
        '| 全球动漫市场规模 | 342亿美元 | 528亿美元 |',
        '',
        '## 二、技术参数与技术效率明细',
        '### 2.1 主流AI动漫工具性能对比（2026版）',
        '| 工具名称 | 主要用途 |',
        '| --- | --- |',
        '| AniDiffu X4 | 中割生成 |',
        '### 2.2 训练数据规模（头部动漫AI模型）',
        '- 训练使用的动漫帧数：约 1.2亿张',
        '### 2.3 效率实证：传统流程 vs AI辅助流程',
        '| 工序 | 传统人力工时 | AI辅助工时 |',
        '| --- | --- | --- |',
        '| 脚本/大纲 | 40小时 | 12小时 |',
        '',
        '## 三、市场与观众数据洞察',
        '### 3.1 观众对AI动漫的认知与接受度调查',
        '| 问题 | 是（%） | 否（%） |',
        '| --- | --- | --- |',
        '| 能接受AI辅助中割/上色的动漫 | 78.4 | 9.2 |',
        '### 3.2 B站/AI类动漫标签表现',
        '| 标签 | 作品数 | 总播放量 |',
        '| --- | --- | --- |',
        '| AI辅助 | 340部 | 28.7亿 |',
        '',
        '## 四、行业就业与经济结构数据',
        '### 4.1 日本动画师岗位变化',
        '| 岗位类型 | 2022年人数 | 2026年人数 |',
        '| --- | --- | --- |',
        '| 原画师 | 4,200 | 4,950 |',
        '### 4.2 薪资对比',
        '| 国家 | 传统动画师 | AI辅助动画师 |',
        '| --- | --- | --- |',
        '| 日本 | 3.2 | 4.8 |',
        '',
        '## 五、版权争议与法律数据（2024–2026上半年）',
        '| 争议类型 | 案件数量 |',
        '| --- | --- |',
        '| 使用未授权动画帧训练AI | 日本37件 |',
        '',
        '## 六、未来量化预测（2027–2029）',
        '| 年份 | 预测事件 |',
        '| --- | --- |',
        '| 2027 | 实时AI转绘VR动画设备普及 |',
        '',
        '## 七、结论与关键洞察',
        '- 效率与成本是最大驱动力',
        '- 观众并非一概拒绝AI'
      ].join('\n')
    )
    const candidates = deriveOutlinePageCandidates(scan)
    const estimate = estimateOutlinePageCount(scan)

    expect(candidates.map((candidate) => candidate.sourceHeading)).toEqual([
      '## 一、2026年全球AI动漫产业关键数据（预测/推演）',
      '## 二、技术参数与技术效率明细',
      '### 2.1 主流AI动漫工具性能对比（2026版）',
      '### 2.2 训练数据规模（头部动漫AI模型）',
      '### 2.3 效率实证：传统流程 vs AI辅助流程',
      '## 三、市场与观众数据洞察',
      '### 3.1 观众对AI动漫的认知与接受度调查',
      '### 3.2 B站/AI类动漫标签表现',
      '## 四、行业就业与经济结构数据',
      '### 4.1 日本动画师岗位变化',
      '### 4.2 薪资对比',
      '## 五、版权争议与法律数据（2024–2026上半年）',
      '## 六、未来量化预测（2027–2029）',
      '## 七、结论与关键洞察'
    ])
    expect(candidates).toHaveLength(14)
    expect(candidates.map((candidate) => candidate.headingLevel)).toEqual([
      2, 2, 3, 3, 3, 2, 3, 3, 2, 3, 3, 2, 2, 2
    ])
    expect(candidates[0]).toMatchObject({
      title: '一、2026年全球AI动漫产业关键数据（预测/推演）',
      lineStart: 3,
      lineEnd: 7
    })
    expect(candidates[1]).toMatchObject({
      title: '二、技术参数与技术效率明细',
      lineStart: 8,
      lineEnd: 8
    })
    expect(candidates[1].reason).toContain('2.1 主流AI动漫工具性能对比')
    expect(candidates[1].reason).toContain('2.2 训练数据规模')
    expect(candidates[1].reason).toContain('2.3 效率实证')
    expect(estimate?.preferredPageCount).toBe(14)
    expect(estimate?.basis).toContain('7 top-level level-2 document sections')
    expect(estimate?.basis).toContain('3 section agenda pages')
    expect(estimate?.basis).toContain('7 direct level-3 content pages')
  })

  it('uses GFM task lists as standalone slide signals', () => {
    const scan = scanDocumentOutline(
      [
        '# Launch Checklist',
        '',
        '## Team Setup',
        '',
        '### Day 1 Checklist',
        '- [x] Register account',
        '- [ ] Configure profile',
        '- [ ] Publish first video'
      ].join('\n')
    )

    const h3 = scan.sectionTree[0].children[0].children[0]
    expect(h3.title).toBe('Day 1 Checklist')
    expect(h3.taskListCount).toBe(3)
    expect(scan.recommendedSplitHints.join('\n')).toContain('### Day 1 Checklist')
  })

  it('keeps parent heading ranges across nested child sections', () => {
    const scan = scanDocumentOutline(
      [
        '# Guide',
        '',
        '## Part A',
        'Intro.',
        '### Step 1',
        'Details.',
        '### Step 2',
        'More details.',
        '## Part B',
        'Done.'
      ].join('\n')
    )

    const partA = scan.sectionTree[0].children[0]
    const step1 = partA.children[0]
    expect(partA.lineStart).toBe(3)
    expect(partA.lineEnd).toBe(8)
    expect(step1.lineStart).toBe(5)
    expect(step1.lineEnd).toBe(6)
  })

  it('marks truncated heading maps so agents grep the rest', () => {
    const source = [
      '# Large Guide',
      ...Array.from({ length: 85 }, (_, index) => [
        `## Section ${index + 1}`,
        `Content ${index + 1}.`
      ]).flat()
    ].join('\n')
    const promptText = formatDocumentOutlineScanForPrompt(scanDocumentOutline(source))

    expect(promptText).toContain('Markdown headings detected: 86')
    expect(promptText).toContain('Heading map truncated: 6 additional headings')
    expect(promptText).toContain('single-shot parse prompt')
  })

  it('keeps substantial level-2 body content before standalone child sections', () => {
    const overview = '市场概述'.repeat(45)
    const scan = scanDocumentOutline(
      [
        '# Market Manual',
        '',
        '## 市场分析',
        overview,
        '',
        '### 增长指标',
        '- GMV grew 15%',
        '- Conversion improved 8%',
        '',
        '### 渠道策略',
        '- Short video',
        '- Live commerce'
      ].join('\n')
    )
    const candidates = deriveOutlinePageCandidates(scan)

    expect(candidates.map((candidate) => candidate.sourceHeading)).toEqual([
      '## 市场分析',
      '### 增长指标',
      '### 渠道策略'
    ])
    expect(candidates[0]).toMatchObject({
      lineStart: 3,
      lineEnd: 5,
      reason:
        '章节目录页：概览本章下的子主题，包括：增长指标、渠道策略。'
    })
  })

  it('keeps a single direct level-3 child inside its level-2 page', () => {
    const deepDetails = 'implementation detail '.repeat(18)
    const scan = scanDocumentOutline(
      [
        '# Engineering Guide',
        '',
        '## Deployment',
        '',
        '### Runtime',
        '',
        '#### Canary Strategy',
        deepDetails
      ].join('\n')
    )
    const candidates = deriveOutlinePageCandidates(scan)

    expect(candidates.map((candidate) => candidate.sourceHeading)).toEqual(['## Deployment'])
    expect(candidates[0]).toMatchObject({
      headingLevel: 2,
      lineStart: 3,
      lineEnd: 8
    })
  })

  it('caps large candidate skeleton counts to the corporate 50-page limit', () => {
    const source = [
      '# Large Manual',
      ...Array.from({ length: 150 }, (_, index) => [
        `## Section ${index + 1}`,
        `Operational content ${index + 1}.`
      ]).flat()
    ].join('\n')
    const scan = scanDocumentOutline(source)
    const estimate = estimateOutlinePageCount(scan)
    const promptText = formatDocumentOutlineScanForPrompt(scan)

    expect(deriveOutlinePageCandidates(scan)).toHaveLength(150)
    expect(estimate?.preferredPageCount).toBe(50)
    expect(promptText).toContain('Page candidate skeleton (50 visible of 150 candidates)')
    expect(promptText).toContain('Return pageCount=50')
  })

  it('caps extremely large candidate skeletons to the visible parse target', () => {
    const source = [
      '# Very Large Manual',
      ...Array.from({ length: 520 }, (_, index) => [
        `## Section ${index + 1}`,
        `Operational content ${index + 1}.`
      ]).flat()
    ].join('\n')
    const scan = scanDocumentOutline(source)
    const estimate = estimateOutlinePageCount(scan)
    const promptText = formatDocumentOutlineScanForPrompt(scan)

    expect(deriveOutlinePageCandidates(scan)).toHaveLength(520)
    expect(estimate?.preferredPageCount).toBe(50)
    expect(estimate?.basis).toContain('capped to 50 visible page candidates')
    expect(promptText).toContain('Page candidate skeleton (50 visible of 520 candidates)')
    expect(promptText).toContain('Return pageCount=50')
  })

  it('estimates a stable slide count for large multi-section manuals', () => {
    const source = [
      '# Dealer Growth Guide',
      ...Array.from({ length: 40 }, (_, index) => [
        `## Section ${index + 1}`,
        `Operational content ${index + 1}.`,
        `### Checklist ${index + 1}`,
        '- Step one',
        '- Step two',
        '- Step three'
      ]).flat()
    ].join('\n')
    const scan = scanDocumentOutline(source)
    const estimate = estimateOutlinePageCount(scan)
    const promptText = formatDocumentOutlineScanForPrompt(scan)

    expect(estimate?.preferredPageCount).toBe(40)
    expect(estimate?.minPageCount).toBeLessThanOrEqual(40)
    expect(estimate?.maxPageCount).toBeGreaterThanOrEqual(40)
    expect(promptText).toContain('Deterministic slide-count estimate: prefer 40 slides')
  })

  it('counts major level-1 headings as standalone chapter divider slides', () => {
    const scan = scanDocumentOutline(
      [
        '# Growth Manual',
        '',
        '# 第一篇：认知篇',
        '## 1.1 行业现状',
        'Details.',
        '## 1.2 用户行为',
        'Details.',
        '',
        '# 第二篇：账号搭建定平台',
        '## 2.1 矩阵认知',
        'Details.',
        '## 2.2 平台差异化',
        'Details.',
        '',
        '# 第三篇：账号定位及内容方向',
        '## 3.1 个人号',
        'Details.',
        '## 3.2 蓝V',
        'Details.'
      ].join('\n')
    )
    const estimate = estimateOutlinePageCount(scan)
    const promptText = formatDocumentOutlineScanForPrompt(scan)

    expect(estimate?.preferredPageCount).toBe(9)
    expect(estimate?.basis).toContain('3 chapter divider headings')
    expect(promptText).toContain('Chapter divider slides: # 第一篇：认知篇; # 第二篇：账号搭建定平台; # 第三篇：账号定位及内容方向')
    expect(promptText).toContain('Keep these as standalone section-divider pages')
  })

  it('ignores headings inside fenced code blocks', () => {
    const scan = scanDocumentOutline(
      [
        '# Real Title',
        '```md',
        '# Fake Heading',
        '## Also Fake',
        '```',
        '## Real Section'
      ].join('\n')
    )

    expect(scan.headingCount).toBe(2)
    expect(formatDocumentOutlineScanForPrompt(scan)).toContain('## Real Section')
    expect(formatDocumentOutlineScanForPrompt(scan)).not.toContain('Fake Heading')
  })

  it('formats no-heading documents as paragraph/list fallback', () => {
    const scan = scanDocumentOutline('First paragraph.\n\n- one\n- two', 'text')
    const promptText = formatDocumentOutlineScanForPrompt(scan)

    expect(scan.headingCount).toBe(0)
    expect(promptText).toContain('No heading hierarchy was detected')
    expect(promptText).toContain('split by paragraphs')
  })
})
