import fs from 'fs'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import log from 'electron-log/main.js'
import type { SessionDeckGenerationContext, ToolStreamConfig } from './types'
import { emitToolStatus } from './types'
import { isPlaceholderPageHtml } from './html-utils'
import {
  createPageWriteTools,
  extractRemoteRuntimeResources,
  getAgentNameFromToolConfig,
  serializedWrite
} from './page-writer'
import { progressLabel } from '@shared/progress'
import {
  INDEX_TRANSITION_TYPES,
  normalizeIndexTransitionConfig,
  patchIndexTransitionConfig,
  validateIndexShellHtml
} from '../session/index-transition'

const uiText = (locale: 'zh' | 'en' | undefined, zh: string, en: string): string =>
  locale === 'en' ? en : zh

export function createSessionBoundDeckTools(context: SessionDeckGenerationContext): unknown[] {
  let lastReportedProgress = 0

  const totalScopedPages = Math.max(
    1,
    (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
      ? context.allowedPageIds.length
      : Object.keys(context.pageFileMap).length) || 1
  )
  const isEditMode = context.mode === 'edit'
  const isContainerScopeEdit = isEditMode && context.editScope === 'presentation-container'
  const isDeckScopeEdit = isEditMode && context.editScope === 'deck'
  const hasSelector = Boolean(context.selectedSelector?.trim())
  const statusLanguage = context.appLocale === 'en' ? 'English' : 'Simplified Chinese'
  const isSinglePageTask =
    !isEditMode &&
    (Boolean(context.selectedPageId) ||
      (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length === 1) ||
      context.outlineTitles.length === 1)
  const orderedPageIdsForProgress =
    Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
      ? context.allowedPageIds.filter((pid) => Boolean(context.pageFileMap[pid]))
      : Object.keys(context.pageFileMap)

  const parsePageNumber = (pageId?: string): number | null => {
    if (!pageId) return null
    const match = pageId.match(/^page-(\d+)$/i)
    if (match) {
      const num = Number(match[1])
      if (Number.isFinite(num) && num > 0) return num
    }
    const fallbackIndex = orderedPageIdsForProgress.indexOf(pageId)
    return fallbackIndex >= 0 ? fallbackIndex + 1 : null
  }

  const inferProgressFromStatus = (args: {
    label: string
    pageId?: string
    detail?: string
  }): number | undefined => {
    const { label, pageId } = args
    if (/读取会话上下文|Reading session context/i.test(label)) return 34
    if (/验证完成状态|Verifying completion/i.test(label)) return 88
    if (/所有页面已填充|当前页面已填充|All pages filled|Current page filled/i.test(label)) return 95
    if (/生成完成|修改完成|Generation completed|Edit completed/i.test(label)) return 98
    const updateMatch = label.match(/(?:更新|Updating)\s*(page-\d+)/i)
    const resolvedPageId = pageId || updateMatch?.[1]
    const pageNumber = parsePageNumber(resolvedPageId)
    if (pageNumber) {
      const fraction = Math.min(1, Math.max(0, (pageNumber - 0.5) / totalScopedPages))
      return 40 + fraction * 44
    }
    return undefined
  }

  const normalizeStatusProgress = (args: {
    label: string
    progress?: number
    pageId?: string
    detail?: string
  }): number => {
    const inferred = inferProgressFromStatus(args)
    const rawValue = Number.isFinite(args.progress) ? Number(args.progress) : inferred
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      // No explicit or inferred progress — keep last known value so we never regress or emit undefined.
      return lastReportedProgress
    }
    const rounded = Math.round(rawValue * 10) / 10
    const clamped = Math.max(0, Math.min(100, rounded))
    const monotonic = Math.max(lastReportedProgress, clamped)
    lastReportedProgress = monotonic
    return monotonic
  }

  const emitNormalizedToolStatus = (
    config: unknown,
    status: {
      label: string
      detail?: string
      progress?: number
      pageId?: string
      agentName?: string
    }
  ): void => {
    emitToolStatus(config as ToolStreamConfig, {
      ...status,
      label: progressLabel(context.appLocale, status.label),
      progress: normalizeStatusProgress(status)
    })
  }

  const pageWriteTools = createPageWriteTools({
    context,
    isEditMode,
    isContainerScopeEdit,
    emitNormalizedToolStatus
  })

  // Single-page generation: only expose write tool, skip get_session_context / report_generation_status
  if (isSinglePageTask) {
    return [...pageWriteTools]
  }

  return [
    // ── get_session_context ──
    tool(
      async (_input, config) => {
        const scopedPageFileMap =
          Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
            ? Object.fromEntries(
                Object.entries(context.pageFileMap).filter(([pageId]) =>
                  context.allowedPageIds!.includes(pageId)
                )
              )
            : context.pageFileMap
        const scopedPageIds = Object.keys(scopedPageFileMap)
        const agentPageFileMap = Object.fromEntries(
          scopedPageIds.map((pageId) => [pageId, `/${pageId}.html`])
        )
        const selectedPagePath =
          context.selectedPageId && agentPageFileMap[context.selectedPageId]
            ? agentPageFileMap[context.selectedPageId]
            : undefined
        const pageFiles = scopedPageIds.map((pageId) => ({
          pageId,
          agentPath: `/${pageId}.html`
        }))
        const scopedExistingPageIds =
          Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
            ? (context.existingPageIds || []).filter((pid) => context.allowedPageIds!.includes(pid))
            : context.existingPageIds

        emitNormalizedToolStatus(config, {
          label: uiText(context.appLocale, '读取会话上下文', 'Reading session context'),
          detail: isContainerScopeEdit
            ? uiText(
                context.appLocale,
                `已提供演示容器文件: ${context.indexPath}`,
                `Provided presentation container file: ${context.indexPath}`
              )
            : selectedPagePath
              ? uiText(
                  context.appLocale,
                  `已提供目标页文件: ${selectedPagePath}`,
                  `Provided target page file: ${selectedPagePath}`
                )
              : uiText(
                  context.appLocale,
                  '已提供页面文件映射与会话上下文',
                  'Provided page-file map and session context'
                ),
          progress: 34
        })
        const constraints = isContainerScopeEdit
          ? [
              '当前为演示容器编辑（presentation-container）：只允许修改 index.html 容器能力',
              '只允许使用 set_index_transition(type, durationMs)，禁止调用 update_index_file / update_page_file / update_single_page_file',
              '禁止修改任何 /<pageId>.html 文件',
              '必须保留 hash 导航、frameViewport、pages-data、controls、全屏/演示模式逻辑',
              '禁止使用 CDN/远程 script/link（http/https/协议相对地址）；仅允许本地资源'
            ]
          : hasSelector
            ? [
                'index.html 只是总览壳，主要内容在 /<pageId>.html',
                '禁止使用 CDN/远程 script/link（http/https/协议相对地址）；仅允许系统预注入的本地 ./assets/* 资源',
                'Selector 编辑模式：先用 read_file 读取目标页面，再用 grep 搜索选择器/文本定位，最后用 edit_file(old_string, new_string) 精准替换',
                '文件工具只能使用虚拟路径（例如 /<pageId>.html），禁止使用宿主机绝对路径',
                '不要调用 write_file / update_page_file / update_single_page_file，edit_file 直接修改即可',
                '仅修改 selector 命中节点，禁止整页重写、禁止改动无关区域',
                isDeckScopeEdit
                  ? '主会话 deck 编辑禁止修改 index.html，只能改 /<pageId>.html'
                  : '尽量不要修改 index.html 的导航与控制逻辑'
              ]
            : [
                'index.html 只是总览壳，主要内容写入 /<pageId>.html',
                '禁止使用 CDN/远程 script/link（http/https/协议相对地址）；仅允许系统预注入的本地 ./assets/* 资源',
                '单页任务只允许使用 update_single_page_file(pageId, content)，禁止调用 update_page_file',
                '单页任务必须写入 selectedPagePath 对应的 page 文件，不需要改 index.html',
                'read_file/edit_file/write_file 等文件工具只能使用虚拟路径（例如 /<pageId>.html），禁止使用宿主机绝对路径',
                isEditMode
                  ? '多页/全局编辑使用 update_page_file(pageId, content)，必须显式传 pageId'
                  : '多页生成优先使用 update_page_file(content)（可选传 pageId 覆盖自动定位）',
                '每页写入后会自动注入动画运行时与防溢出保护',
                '不要在最终答案里返回大块 HTML，必须把变更落盘',
                isDeckScopeEdit
                  ? '主会话 deck 编辑禁止修改 index.html，只能改 /<pageId>.html'
                  : '尽量不要修改 index.html 的导航与控制逻辑'
              ]
        return JSON.stringify(
          {
            mode: context.mode || 'generate',
            editScope: context.editScope || null,
            sessionId: context.sessionId,
            topic: context.topic,
            deckTitle: context.deckTitle,
            styleId: context.styleId || 'minimal-white',
            designContract: context.designContract ?? null,
            outlineTitles: context.outlineTitles,
            outlineItems: context.outlineItems,
            agentWorkspaceRoot: '/',
            agentIndexPath: '/index.html',
            pageFileMap: agentPageFileMap,
            pageFiles,
            allowedPageIds: context.allowedPageIds ?? null,
            userMessage: context.userMessage,
            pageIds: scopedPageIds,
            selectedPageId: context.selectedPageId ?? undefined,
            selectedPagePath,
            selectedPageNumber: context.selectedPageNumber ?? undefined,
            selectedSelector: context.selectedSelector ?? undefined,
            elementTag: context.elementTag ?? undefined,
            elementText: context.elementText ?? undefined,
            existingPageIds: scopedExistingPageIds ?? undefined,
            constraints
          },
          null,
          2
        )
      },
      {
        name: 'get_session_context',
        description:
          'Get the current session generation context, directory paths, index.html path, page titles, and constraints.',
        schema: z.object({})
      }
    ),

    // ── report_generation_status ──
    tool(
      async ({ label, detail, progress }, config) => {
        emitNormalizedToolStatus(config, {
          label,
          detail: detail ?? undefined,
          progress: progress ?? undefined
        })
        return `Status recorded: ${label}`
      },
      {
        name: 'report_generation_status',
        description: `Report the current generation/editing stage to the host UI. The label and detail must be written in ${statusLanguage}, regardless of the deck content language. progress must be a numeric literal such as 10, not a string such as "10".`,
        schema: z.object({
          label: z.string().describe(`Current stage label in ${statusLanguage}`),
          detail: z.string().nullable().optional().describe(`Optional extra detail in ${statusLanguage}`),
          progress: z.number().min(0).max(100).nullable().optional().describe('Suggested progress')
        })
      }
    ),

    ...(isContainerScopeEdit
      ? [
          // ── set_index_transition ──
          tool(
            async ({ type, durationMs }, config) => {
        if (!fs.existsSync(context.indexPath)) {
          throw new Error(`index.html 缺失：${context.indexPath}`)
        }
        const transitionConfig = normalizeIndexTransitionConfig({ type, durationMs })
        const transitionType = transitionConfig.type
        const current = await fs.promises.readFile(context.indexPath, 'utf-8')
        const next = patchIndexTransitionConfig(current, transitionConfig)
        const indexErrors = validateIndexShellHtml(next)
        if (indexErrors.length > 0) {
          emitNormalizedToolStatus(config, {
            label: uiText(context.appLocale, '切换动画配置失败', 'Transition configuration failed'),
            detail: indexErrors.join('; '),
            progress: 60
          })
          throw new Error(`index.html 验证失败: ${indexErrors.join('; ')}`)
        }
        emitNormalizedToolStatus(config, {
          label:
            transitionType === 'none'
              ? uiText(context.appLocale, '关闭切换动画', 'Transition disabled')
              : uiText(context.appLocale, '更新切换动画', 'Transition updated'),
          detail:
            transitionType === 'none'
              ? uiText(context.appLocale, '已恢复无过渡切换', 'Restored instant page switching')
              : uiText(
                  context.appLocale,
                  `已设置 ${transitionType} ${transitionConfig.durationMs}ms`,
                  `Set ${transitionType} transition to ${transitionConfig.durationMs}ms`
                ),
          progress: 72
        })
        const result = await serializedWrite(context.projectDir, async () => {
          await fs.promises.writeFile(context.indexPath, next, 'utf-8')
          return `Updated index transition in ${context.indexPath}`
        })
        log.info('[deepagent] set_index_transition', {
          sessionId: context.sessionId,
          indexPath: context.indexPath,
          type: transitionType,
          durationMs:
            transitionType === 'none' ? null : transitionConfig.durationMs,
          agentName: getAgentNameFromToolConfig(config) || 'unknown'
        })
        return result
            },
            {
              name: 'set_index_transition',
              description:
                'Controlled tool for the main session: configure index.html page transition animation without rewriting the index shell.',
              schema: z.object({
                type: z
                  .enum(INDEX_TRANSITION_TYPES)
                  .describe(`Transition type: ${INDEX_TRANSITION_TYPES.join(', ')}`),
                durationMs: z
                  .number()
                  .optional()
                  .describe('Animation duration, 120-1200ms, default 480ms')
              })
            }
          )
        ]
      : []),

    ...pageWriteTools,

    // ── verify_completion ──
    tool(
      async (_input, config) => {
        if (isContainerScopeEdit) {
          emitNormalizedToolStatus(config, {
            label: uiText(context.appLocale, '验证完成状态', 'Verifying completion'),
            detail: uiText(
              context.appLocale,
              '正在检查 index.html 总览壳结构',
              'Checking the index.html overview shell structure'
            ),
            progress: 88
          })
          if (!fs.existsSync(context.indexPath)) {
            return `验证失败：index.html 缺失（${context.indexPath}）。请检查会话文件是否完整。`
          }
          const indexHtml = await fs.promises.readFile(context.indexPath, 'utf-8')
          const indexErrors = validateIndexShellHtml(indexHtml)
          if (indexErrors.length > 0) {
            return `验证失败：index.html 结构不完整：${indexErrors.join('; ')}`
          }
          emitNormalizedToolStatus(config, {
            label: uiText(context.appLocale, 'index 壳验证通过', 'Index shell verified'),
            detail: uiText(
              context.appLocale,
              'index.html 关键结构完整',
              'Key index.html structure is complete'
            ),
            progress: 95
          })
          return '验证通过：index.html 已更新且结构完整。'
        }
        emitNormalizedToolStatus(config, {
          label: uiText(context.appLocale, '验证完成状态', 'Verifying completion'),
          detail: uiText(
            context.appLocale,
            '正在检查所有 page 文件是否已填充',
            'Checking whether all page files are filled'
          ),
          progress: 88
        })
        const pageIds = Object.keys(context.pageFileMap)
        const targetPageIds =
          Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
            ? pageIds.filter((pid) => context.allowedPageIds!.includes(pid))
            : pageIds
        const results: Array<{
          pageId: string
          filled: boolean
          hasContent: boolean
          hasRemoteRuntime: boolean
        }> = []
        for (const pid of targetPageIds) {
          const pagePath = context.pageFileMap[pid]
          const exists = fs.existsSync(pagePath)
          const content = exists ? await fs.promises.readFile(pagePath, 'utf-8') : ''
          const filled = exists && content.trim().length > 0
          const hasContent = filled && !isPlaceholderPageHtml(content)
          const hasRemoteRuntime = extractRemoteRuntimeResources(content).length > 0
          results.push({ pageId: pid, filled, hasContent, hasRemoteRuntime })
        }
        const missingFiles = results.filter((r) => !r.filled).map((r) => r.pageId)
        const emptyPages = results.filter((r) => r.filled && !r.hasContent).map((r) => r.pageId)
        const remoteRuntimePages = results.filter((r) => r.hasRemoteRuntime).map((r) => r.pageId)
        const filledCount = results.filter((r) => r.hasContent).length
        if (missingFiles.length > 0) {
          return `验证发现问题：以下页面文件缺失或为空: ${missingFiles.join(', ')}。请检查对应 /<pageId>.html 是否已创建。`
        }
        if (emptyPages.length > 0) {
          return `部分页面尚未填充: ${emptyPages.join(', ')}。已完成 ${filledCount}/${targetPageIds.length} 页。单页任务请用 update_single_page_file(pageId, content)，多页任务请用 update_page_file(content) 继续填充。`
        }
        if (remoteRuntimePages.length > 0) {
          return `验证失败：以下页面包含禁止的 CDN/远程 script/link 资源: ${remoteRuntimePages.join(', ')}。请移除外链并仅使用系统预注入的本地 ./assets/* 资源。`
        }
        const isSinglePageCheck = targetPageIds.length === 1
        emitNormalizedToolStatus(config, {
          label: isSinglePageCheck
            ? uiText(context.appLocale, '当前页面已填充', 'Current page filled')
            : uiText(context.appLocale, '所有页面已填充', 'All pages filled'),
          detail: isSinglePageCheck
            ? uiText(
                context.appLocale,
                `${targetPageIds[0]} 已完成`,
                `${targetPageIds[0]} completed`
              )
            : uiText(
                context.appLocale,
                `${filledCount}/${targetPageIds.length} 页已完成`,
                `${filledCount}/${targetPageIds.length} pages completed`
              ),
          progress: 95
        })
        return isSinglePageCheck
          ? `验证通过：${targetPageIds[0]} 已成功填充。${JSON.stringify(results, null, 2)}`
          : `验证通过：全部 ${targetPageIds.length} 页已成功填充。${JSON.stringify(results, null, 2)}`
      },
      {
        name: 'verify_completion',
        description:
          'Verify that all page files have been filled correctly. Use after update_single_page_file or update_page_file.',
        schema: z.object({})
      }
    )
  ]
}
