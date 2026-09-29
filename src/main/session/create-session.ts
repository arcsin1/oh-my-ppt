import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import log from 'electron-log/main.js'
import { getStyleDetail, hasStyleSkill, resolveUsableStyleId } from '../styles/catalog'
import { resolveModelConfigForTask } from '../config/model-config-utils'
import { readAppLocale, uiText } from '../config/locale-utils'
import { DEFAULT_SLIDE_SIZE_ID, requireSlideSizePreset } from '@shared/slide-size'
import { createSessionMasterIfMissing } from './master-service'
import type { IpcContext } from '../ipc/context'

export async function createProductSession(
  ctx: Pick<
    IpcContext,
    | 'db'
    | 'agentManager'
    | 'resolveStoragePath'
    | 'ensureSessionAssets'
    | 'modelRuntime'
    | 'decryptApiKey'
  >,
  payload: {
    title?: string
    topic?: string
    styleId?: string
    slideSizeId?: string
    pageCount?: number
  }
): Promise<{ sessionId: string }> {
  const { db, agentManager, resolveStoragePath, ensureSessionAssets } = ctx
  const locale = await readAppLocale(ctx)
  const storagePath = await resolveStoragePath()
  const activeModel = await resolveModelConfigForTask(ctx, { purpose: 'session:create' })
  const { provider, model, baseUrl } = activeModel
  const normalizedTopic =
    (typeof payload.topic === 'string' && payload.topic.trim()) ||
    (typeof payload.title === 'string' && payload.title.trim()) ||
    'Untitled'
  const title =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : `PPT: ${normalizedTopic}`
  const requestedStyleId = typeof payload.styleId === 'string' ? payload.styleId.trim() : ''
  const normalizedStyleId = requestedStyleId || resolveUsableStyleId()
  if (!hasStyleSkill(normalizedStyleId)) {
    throw new Error(
      uiText(
        locale,
        `创建会话失败：styleId 不存在 ${normalizedStyleId}`,
        `Failed to create session: styleId does not exist: ${normalizedStyleId}`
      )
    )
  }
  const slideSize = requireSlideSizePreset(payload.slideSizeId || DEFAULT_SLIDE_SIZE_ID)
  const sessionId = crypto.randomUUID()
  const projectDir = path.join(storagePath, sessionId)
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true })
  await ensureSessionAssets(projectDir)
  await createSessionMasterIfMissing(projectDir)
  const styleDetail = getStyleDetail(normalizedStyleId)
  log.info('[session:create] style selected', {
    sessionId,
    styleId: normalizedStyleId,
    styleKey: styleDetail.styleKey,
    styleLabel: styleDetail.label
  })
  await db.createSession({
    id: sessionId,
    title,
    topic: normalizedTopic,
    styleId: normalizedStyleId,
    pageCount: payload.pageCount,
    slideSizeId: slideSize.id,
    slideWidth: slideSize.width,
    slideHeight: slideSize.height,
    provider,
    model: model.trim()
  })
  agentManager.ensureSession({
    sessionId,
    provider,
    model,
    baseUrl,
    projectDir,
    modelRuntime: ctx.modelRuntime
  })
  await db.createProject({
    session_id: sessionId,
    title: normalizedTopic,
    output_path: projectDir,
    root_path: projectDir
  })
  return { sessionId }
}
