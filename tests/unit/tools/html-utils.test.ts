import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

vi.mock('electron-log/main.js', () => ({
  default: {
    warn: vi.fn()
  }
}))

import { validateHtmlContent, validatePersistedPageHtml } from '../../../src/main/tools/html-utils'
import {
  DATA_ANIM_SKILL_NAME,
  formatSkillUsageRequirement,
} from '../../../src/main/skills/skill-contract'

describe('validateHtmlContent animation validation', () => {
  it('allows declarative data-anim stagger delay', () => {
    const result = validateHtmlContent(`
      <div>
        <div data-anim="fade-up" data-anim-delay="stagger(100)">A</div>
        <div data-anim="fade-up" data-anim-delay='stagger(120)'>B</div>
      </div>
    `)

    expect(result.errors).not.toContain(
      `检测到未命名空间的动画调用（animate/stagger/createTimeline）；修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`
    )
  })

  it('still rejects unqualified stagger calls in scripts', () => {
    const result = validateHtmlContent(`
      <div>Card</div>
      <script>
        stagger(100)
      </script>
    `)

    expect(result.errors).toContain(
      `检测到未命名空间的动画调用（animate/stagger/createTimeline）；修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`
    )
  })

  it('rejects direct GSAP calls in generated fragments', () => {
    const result = validateHtmlContent(`
      <div class="card">Card</div>
      <script>
        gsap.to(".card", { opacity: 1 })
      </script>
    `)

    expect(result.errors.join('\n')).toContain('检测到直接 gsap.* 调用')
  })

  it('rejects direct GSAP global access', () => {
    const result = validateHtmlContent(`
      <div class="card">Card</div>
      <script>
        window.gsap.timeline()
      </script>
    `)

    expect(result.errors.join('\n')).toContain('检测到直接访问 window.gsap/globalThis.gsap')
  })

  it('rejects chained direct GSAP utility calls', () => {
    const result = validateHtmlContent(`
      <div class="card">Card</div>
      <script>
        gsap.utils.stagger(0.1)
      </script>
    `)

    expect(result.errors.join('\n')).toContain('检测到直接 gsap.* 调用')
  })

  it('rejects unsupported data-anim values', () => {
    const result = validateHtmlContent(`
      <div data-anim="glitch-in">Card</div>
    `)

    expect(result.errors.join('\n')).toContain('data-anim 类型不受支持：glitch-in')
  })

  it('allows controlled PPT scripted animation APIs', () => {
    const result = validateHtmlContent(`
      <div class="card">Card</div>
      <script>
        PPT.animate(".card", { opacity: [0, 1], duration: 400 })
        const tl = PPT.createTimeline()
        tl.add({ targets: ".card", translateY: [20, 0], duration: 400 })
      </script>
    `)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContain(
      '检测到 PPT.animate/PPT.createTimeline；该接口适合预览编排，但 editable PPTX 导出只对 data-anim 提供稳定 native roundtrip，如需可编辑导出请优先改写为 data-anim。'
    )
  })

  it('warns when declarative motion uses weaker PPTX fidelity types', () => {
    const result = validateHtmlContent(`
      <div>
        <div data-anim="slide-up">Approximate</div>
        <div data-anim="path">Degraded</div>
      </div>
    `)

    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('动画 slide-up 为 approximate 保真度'),
        expect.stringContaining('动画 path 为 degraded 保真度')
      ])
    )
  })
})

describe('validatePersistedPageHtml chart validation', () => {
  const pageWithChartFrame = (frameClass: string): string => `
    <html>
      <body>
        <section class="ppt-page-root" data-ppt-guard-root="1">
          <main class="ppt-page-content">
            <div class="ppt-chart-frame relative ${frameClass}">
              <canvas id="chart" class="h-full w-full"></canvas>
            </div>
          </main>
        </section>
      </body>
    </html>
  `

  it('accepts the chart fallback height class used by page writer', () => {
    const result = validatePersistedPageHtml(pageWithChartFrame('h-[240px]'), 'page-1')

    expect(result.valid).toBe(true)
  })

  it('rejects Tailwind scale height shortcuts after persistence validation', () => {
    const result = validatePersistedPageHtml(pageWithChartFrame('h-64'), 'page-1')

    expect(result.errors.join('\n')).toContain('h-[Npx]')
  })
})
