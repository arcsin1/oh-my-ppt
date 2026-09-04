import fs from 'fs'
import { runDeepAgentEdit } from '../generation/agent-runner'
import { buildDeckEditPageUserMessage } from '../generation/edit-deck-batch-flow'
import { validateChangedPages } from '../generation/generation-utils'
import type { GenerateChunkEvent } from '@shared/generation'
import type {
  ActiveStyleSwitchJob,
  StyleSwitchFileSnapshot,
  StyleSwitchPageRef
} from './style-switch-job-types'
import type { IpcContext } from '../ipc/context'
import { readStyleSwitchFileSnapshot } from './style-switch-job-files'
import { LAYOUT_SLOT_PRESERVATION_REQUIREMENT } from '../generation/layout-slot-validator'

export async function runStyleSwitchPageFlow(args: {
  ctx: IpcContext
  job: ActiveStyleSwitchJob
  page: StyleSwitchPageRef
  indexPath: string
  indexSnapshot: StyleSwitchFileSnapshot
  emitProgress: (chunk: GenerateChunkEvent) => void
}): Promise<string> {
  const { ctx, job, page, indexPath, indexSnapshot, emitProgress } = args
  await runDeepAgentEdit({
    sessionId: job.sessionId,
    provider: job.context.provider,
    apiKey: job.context.apiKey,
    model: job.context.model,
    baseUrl: job.context.providerBaseUrl,
    maxTokens: job.context.maxTokens,
    modelTimeoutMs: job.context.modelTimeouts.agent,
    temperature: ctx.PAGE_EDIT_DEFAULT_TEMPERATURE,
    styleId: job.context.styleId,
    styleSkillPrompt: job.context.styleSkill.prompt,
    styleKey: job.context.styleKey,
    styleName: job.context.styleName,
    styleVersion: job.context.styleVersion,
    slideSize: job.context.slideSize,
    appLocale: job.context.appLocale,
    topic: job.context.topic,
    deckTitle: job.context.deckTitle,
    userMessage: [
      buildDeckEditPageUserMessage({
        originalUserMessage: job.context.userMessage,
        pageId: page.pageId
      }),
      LAYOUT_SLOT_PRESERVATION_REQUIREMENT
    ].join('\n\n'),
    outlineTitles: job.pageRefs.map((item) => item.title),
    outlineItems: job.pageRefs.map((item) => ({
      title: item.title,
      contentOutline: item.contentOutline,
      layoutIntent: item.layoutIntent,
      layoutId: item.layoutId || undefined
    })),
    sourceDocumentPaths: job.context.sourceDocumentPaths,
    projectDir: job.context.projectDir,
    indexPath,
    pageFileMap: { [page.pageId]: page.htmlPath },
    selectPageIds: [page.pageId],
    designContract: job.context.designContract,
    existingPageIds: [page.pageId],
    agentManager: ctx.agentManager,
    runId: job.runId,
    signal: job.context.abortSignal,
    emit: emitProgress,
    editScope: 'page',
    selectedPageId: page.pageId,
    selectedPageNumber: page.pageNumber
  })
  if (job.lease.signal.aborted) throw new Error('生成已取消')
  const currentIndex = await readStyleSwitchFileSnapshot(indexPath)
  if (
    currentIndex.exists !== indexSnapshot.exists ||
    currentIndex.content !== indexSnapshot.content
  ) {
    throw new Error('风格切换不允许修改 index.html')
  }
  const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
  const invalidPages = validateChangedPages([{ ...page, html }])
  if (invalidPages.length > 0) throw new Error(invalidPages.map((item) => item.reason).join('；'))
  return html
}
