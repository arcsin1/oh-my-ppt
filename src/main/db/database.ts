import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq, ne, gt, lte, count, max, asc, desc, sql, and, or, isNull, inArray } from 'drizzle-orm'
import * as schema from './schema'
import path from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import fs from 'fs'
import crypto from 'crypto'
import { runDatabasePatches } from './patch'
import {
  compareStyleVersion,
  listStylePackageDirectories,
  normalizeStyleVersion,
  readStylePackage,
  styleRowToPackageJson
} from '../styles'
import type { HtmlThumbnailResourceType } from '@shared/thumbnail'
import type {
  ModelUsageByHour,
  ModelUsagePeriod,
  ModelUsageStats,
  ModelUsageTotals
} from '@shared/model-usage'
import type { AnimationPreferencesPayload } from '@shared/generation'
import { normalizeThinkingParameterMode } from '@shared/model-config'
import { requirePersistedSlideSize, type SlideSizePresetId } from '@shared/slide-size'

type SessionStatus = 'active' | 'completed' | 'failed' | 'archived'
type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
type MessageType = 'text' | 'tool_call' | 'tool_result' | 'stream_chunk'
type ChatScope = 'main' | 'page'
type StyleSource = 'builtin' | 'custom' | 'override'
type GenerationRunMode = 'generate' | 'retry' | 'edit' | 'import' | 'addPage' | 'retrySinglePage'
type GenerationRunStatus = 'running' | 'completed' | 'failed' | 'partial'
export type GenerationJobKind = 'standard' | 'template' | 'retry'
export type GenerationJobStatus = 'pending' | 'active' | 'finished' | 'aborted'
type GenerationPageStatus = 'pending' | 'running' | 'completed' | 'failed'
type SessionPageStatus = schema.SessionPageStatus
type SourcePageSkeletonRole = 'chapter-divider' | 'content'
type SourcePageSkeletonConfidence = 'high' | 'medium' | 'low'
type SessionOperationType =
  | 'generate'
  | 'edit'
  | 'addPage'
  | 'retry'
  | 'import'
  | 'rollback'
  | 'reorder'
  | 'delete'
type SessionOperationScope = 'session' | 'deck' | 'page' | 'selector' | 'shell'
type SessionOperationStatus = 'committing' | 'completed' | 'failed' | 'noop'

export interface Session {
  id: string
  title: string
  topic: string | null
  styleId: string | null
  page_count: number | null
  slideSizeId?: SlideSizePresetId
  slideWidth?: number
  slideHeight?: number
  reference_document_path: string | null
  referenceDocumentPath?: string | null
  status: SessionStatus
  provider: string
  model: string
  created_at: number
  updated_at: number
  metadata: string | null
  designContract?: string | null
  currentOperationId?: string | null
  currentCommit?: string | null
}

export interface Message {
  id: string
  session_id: string
  chat_scope: ChatScope
  page_id: string | null
  selector: string | null
  image_paths: string[] | null
  video_paths: string[] | null
  role: MessageRole
  content: string
  type: MessageType
  tool_name: string | null
  tool_call_id: string | null
  token_count: number | null
  run_model: string | null
  created_at: number
}

interface MemorySummary {
  id: string
  session_id: string
  message_range_start: number
  message_range_end: number
  summary: string
  token_count: number | null
  created_at: number
}

interface UserPreference {
  key: string
  value: unknown
  confidence: number
  source_sessions: string[]
  created_at: number
  updated_at: number
  last_used_at: number | null
}

interface Project {
  id: string
  session_id: string
  title: string
  output_path: string
  root_path: string | null
  file_count: number
  total_size: number
  status: 'draft' | 'published' | 'exported'
  created_at: number
  updated_at: number
}

export interface GenerationRunRecord {
  id: string
  session_id: string
  mode: GenerationRunMode
  status: GenerationRunStatus
  total_pages: number
  error: string | null
  metadata: string | null
  animation_preferences: string | null
  model_config_id: string | null
  created_at: number
  updated_at: number
}

export interface GenerationJobRecord {
  id: string
  session_id: string
  kind: GenerationJobKind
  status: GenerationJobStatus
  abort_reason: string | null
  created_at: number
  activated_at: number | null
  updated_at: number
  finished_at: number | null
}

export interface GenerationPageRecord {
  id: string
  run_id: string
  session_id: string
  page_id: string
  page_number: number
  title: string
  content_outline: string | null
  layout_intent: string | null
  html_path: string | null
  status: GenerationPageStatus
  error: string | null
  retry_count: number
  created_at: number
  updated_at: number
}

export interface SessionPageRecord {
  id: string
  session_id: string
  legacy_page_id: string | null
  file_slug: string
  page_number: number
  title: string
  html_path: string
  status: SessionPageStatus
  error: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export type ThumbnailStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface ThumbnailRecord {
  key: string
  resourceType: HtmlThumbnailResourceType
  resourceId: string
  variant: string
  sourcePath: string
  sourceMtimeMs: number
  signature: string
  thumbnailPath: string
  status: ThumbnailStatus
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface SourcePageSkeletonRecord {
  id: string
  session_id: string
  page_number: number
  title: string
  role: SourcePageSkeletonRole
  source_document_path: string
  source_document_name: string | null
  source_heading: string
  heading_level: number
  line_start: number
  line_end: number
  reason: string | null
  confidence: SourcePageSkeletonConfidence
  created_at: number
  updated_at: number
}

export interface SessionPageInput {
  id: string
  sessionId: string
  legacyPageId?: string | null
  fileSlug: string
  pageNumber: number
  title: string
  htmlPath: string
  status?: SessionPageStatus
  error?: string | null
}

export interface SessionWithPageCount {
  session: Session
  pageCount: number
}

export const sessionPageRecordToInput = (page: SessionPageRecord): SessionPageInput => ({
  id: page.id,
  sessionId: page.session_id,
  legacyPageId: page.legacy_page_id,
  fileSlug: page.file_slug,
  pageNumber: page.page_number,
  title: page.title,
  htmlPath: page.html_path,
  status: page.status,
  error: page.error
})

export interface StyleRow {
  id: string
  style: string
  styleName: string
  styleNameZh: string
  styleNameEn: string
  description: string
  category: string
  aliases: string // JSON array
  source: StyleSource
  styleSkill: string // plain markdown
  version: string
  styleCase: string
  packageDir: string
  active: boolean
  favoriteAt: number | null
  createdAt: number
  updatedAt: number
}

export interface SessionStyleSnapshotRow {
  id: string
  sessionId: string
  styleId: string
  styleKey: string
  styleName: string
  styleNameZh: string
  styleNameEn: string
  description: string
  category: string
  aliases: string
  source: StyleSource
  version: string
  styleCase: string
  packageDir: string
  styleSkill: string
  createdAt: number
}

export interface ModelConfigRow {
  id: string
  name: string
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  disableTemperature: number
  thinkingParameterMode: string
  active: number
  createdAt: number
  updatedAt: number
}

export interface ImageModelConfigRow {
  id: string
  name: string
  provider: string
  active: number
  modelConfig: string
  createdAt: number
  updatedAt: number
}

export interface ImageGenerationHistoryRow {
  id: string
  sessionId: string
  pageId: string
  prompt: string
  imagePaths: string
  modelConfigId: string
  provider: string
  model: string
  createdAt: number
}

export interface SessionOperationRecord {
  id: string
  session_id: string
  type: SessionOperationType
  status: SessionOperationStatus
  scope: SessionOperationScope | null
  prompt: string | null
  parent_operation_id: string | null
  before_commit: string | null
  after_commit: string | null
  target_operation_id: string | null
  target_commit: string | null
  changed_files_json: string
  changed_pages_json: string
  tracked_files_json: string
  metadata_json: string
  created_at: number
  completed_at: number | null
}

export interface SessionOperationPageRecord {
  id: string
  operation_id: string
  session_id: string
  page_id: string
  legacy_page_id: string | null
  file_slug: string
  page_number: number
  title: string
  html_path: string
  status: SessionPageStatus
  error: string | null
  created_at: number
  updated_at: number
}

export class PPTDatabase {
  private db: ReturnType<typeof drizzle>
  private client: ReturnType<typeof createClient>
  private _storagePath: string | null = null
  private _initialized = false
  private _stylesCache: StyleRow[] = []

  constructor(dbPath?: string) {
    const defaultPath = is.dev
      ? path.join(process.cwd(), 'ajjy-ppt.dev.db')
      : path.join(app.getPath('userData'), 'ajjy-ppt.db')
    const resolvedPath = dbPath || defaultPath

    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const url = resolvedPath.startsWith('file:') ? resolvedPath : `file:${resolvedPath}`

    this.client = createClient({ url })
    this.db = drizzle(this.client, { schema })
    this._storagePath = null
  }

  async init(): Promise<void> {
    if (this._initialized) return
    await runDatabasePatches({
      client: this.client,
      db: this.db,
      resolveStoragePath: async () =>
        (await this.getSetting<string>('storage_path').catch(() => '')) || ''
    })
    await this._refreshStylesCache()
    this._initialized = true
  }

  getStoragePath(): string {
    return this._storagePath || ''
  }

  async setStoragePath(storagePath: string): Promise<void> {
    await this.setSetting('storage_path', storagePath)
    this._storagePath = storagePath
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true })
    }
  }

  async close(): Promise<void> {
    await this.client.close()
    this._initialized = false
  }

  // ========== Session ==========

  async createSession(data: {
    id?: string
    title: string
    topic?: string
    styleId?: string
    pageCount?: number
    slideSizeId?: SlideSizePresetId
    slideWidth?: number
    slideHeight?: number
    referenceDocumentPath?: string | null
    provider: string
    model: string
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)

    const slideSize = requirePersistedSlideSize({
      id: data.slideSizeId,
      width: data.slideWidth,
      height: data.slideHeight
    })

    await this.db
      .insert(schema.sessions)
      .values({
        id,
        title: data.title,
        topic: data.topic || null,
        styleId: data.styleId || null,
        pageCount: data.pageCount || null,
        slideSizeId: slideSize.id,
        slideWidth: slideSize.width,
        slideHeight: slideSize.height,
        referenceDocumentPath: data.referenceDocumentPath || null,
        status: 'active',
        provider: data.provider,
        model: data.model,
        createdAt: now,
        updatedAt: now,
        metadata: null
      })
      .run()

    if (this._stylesCache.length > 0) {
      await this.createSessionStyleSnapshot(id, data.styleId)
    }

    return id
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const result = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get()
    return result as unknown as Session | undefined
  }

  async updateSessionHistoryPointer(args: {
    sessionId: string
    operationId: string | null
    commit: string | null
  }): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({
        currentOperationId: args.operationId,
        currentCommit: args.commit,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(schema.sessions.id, args.sessionId))
      .run()
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.sessions)
      .set({ status, updatedAt: now })
      .where(eq(schema.sessions.id, sessionId))
      .run()
  }

  async updateSessionMetadata(sessionId: string, metadata: object): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ metadata: JSON.stringify(metadata), updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(schema.sessions.id, sessionId))
      .run()
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    const updatedAt = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.sessions)
      .set({ title, updatedAt })
      .where(eq(schema.sessions.id, sessionId))
      .run()
    await this.db
      .update(schema.projects)
      .set({ title, updatedAt })
      .where(eq(schema.projects.sessionId, sessionId))
      .run()
  }

  async updateSessionStyleId(sessionId: string, styleId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.sessions)
      .set({ styleId, updatedAt: now })
      .where(eq(schema.sessions.id, sessionId))
      .run()
    if (this._stylesCache.length > 0) {
      await this.replaceSessionStyleSnapshot(sessionId, styleId)
    }
  }

  async restoreSessionStyleState(
    sessionId: string,
    styleId: string | null,
    snapshot?: SessionStyleSnapshotRow
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.sessions)
        .set({ styleId, updatedAt: now })
        .where(eq(schema.sessions.id, sessionId))
        .run()
      await tx
        .delete(schema.sessionStyleSnapshots)
        .where(eq(schema.sessionStyleSnapshots.sessionId, sessionId))
        .run()
      if (!snapshot) return
      await tx
        .insert(schema.sessionStyleSnapshots)
        .values({
          id: snapshot.id,
          sessionId,
          styleId: snapshot.styleId,
          styleKey: snapshot.styleKey,
          styleName: snapshot.styleName,
          styleNameZh: snapshot.styleNameZh,
          styleNameEn: snapshot.styleNameEn,
          description: snapshot.description,
          category: snapshot.category,
          aliases: snapshot.aliases,
          source: snapshot.source,
          version: snapshot.version,
          styleCase: snapshot.styleCase,
          packageDir: snapshot.packageDir,
          styleSkill: snapshot.styleSkill,
          createdAt: snapshot.createdAt
        })
        .run()
    })
  }

  async updateSessionDesignContract(sessionId: string, designContract: unknown): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({
        designContract: designContract ? JSON.stringify(designContract) : null,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(schema.sessions.id, sessionId))
      .run()
  }

  async listSessions(limit = 50, offset = 0): Promise<Session[]> {
    const results = await this.db
      .select()
      .from(schema.sessions)
      .where(ne(schema.sessions.status, 'archived'))
      .orderBy(desc(schema.sessions.updatedAt))
      .limit(limit)
      .offset(offset)
      .all()

    return results as unknown as Session[]
  }

  async listSessionsWithPageCounts(limit = 50, offset = 0): Promise<SessionWithPageCount[]> {
    const rows = await this.db
      .select({
        session: schema.sessions,
        pageCount: count(schema.sessionPages.id)
      })
      .from(schema.sessions)
      .leftJoin(
        schema.sessionPages,
        and(
          eq(schema.sessionPages.sessionId, schema.sessions.id),
          isNull(schema.sessionPages.deletedAt)
        )
      )
      .where(ne(schema.sessions.status, 'archived'))
      .groupBy(schema.sessions.id)
      .orderBy(desc(schema.sessions.updatedAt))
      .limit(limit)
      .offset(offset)
      .all()

    return rows.map((row) => ({
      session: row.session as unknown as Session,
      pageCount: Number(row.pageCount || 0)
    }))
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.sessionOperationPages)
        .where(eq(schema.sessionOperationPages.sessionId, sessionId))
        .run()
      await tx
        .delete(schema.sessionOperations)
        .where(eq(schema.sessionOperations.sessionId, sessionId))
        .run()
      await tx
        .delete(schema.sourcePageSkeletons)
        .where(eq(schema.sourcePageSkeletons.sessionId, sessionId))
        .run()
      await tx.delete(schema.sessionPages).where(eq(schema.sessionPages.sessionId, sessionId)).run()
      await tx
        .delete(schema.imageGenerationHistories)
        .where(eq(schema.imageGenerationHistories.sessionId, sessionId))
        .run()
      await tx
        .delete(schema.memorySummaries)
        .where(eq(schema.memorySummaries.sessionId, sessionId))
        .run()
      await tx.delete(schema.messages).where(eq(schema.messages.sessionId, sessionId)).run()
      await tx
        .delete(schema.generationPages)
        .where(eq(schema.generationPages.sessionId, sessionId))
        .run()
      await tx
        .delete(schema.generationRuns)
        .where(eq(schema.generationRuns.sessionId, sessionId))
        .run()
      await tx.delete(schema.projects).where(eq(schema.projects.sessionId, sessionId)).run()
      await tx.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run()
    })
  }

  // ========== Generation Records ==========

  private normalizeGenerationRunRow(row: Record<string, unknown>): GenerationRunRecord {
    return {
      id: String(row.id || ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      mode: String(row.mode || 'generate') as GenerationRunMode,
      status: String(row.status || 'running') as GenerationRunStatus,
      total_pages: Number(row.totalPages ?? row.total_pages ?? 0) || 0,
      error: typeof row.error === 'string' ? String(row.error) : null,
      metadata: typeof row.metadata === 'string' ? String(row.metadata) : null,
      animation_preferences:
        typeof (row.animationPreferences ?? row.animation_preferences) === 'string'
          ? String(row.animationPreferences ?? row.animation_preferences)
          : null,
      model_config_id:
        typeof (row.modelConfigId ?? row.model_config_id) === 'string'
          ? String(row.modelConfigId ?? row.model_config_id)
          : null,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0
    }
  }

  private normalizeGenerationJobRow(row: Record<string, unknown>): GenerationJobRecord {
    const status = String(row.status || 'pending')
    const kind = String(row.kind || 'standard')
    return {
      id: String(row.id || ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      kind: (kind === 'template' || kind === 'retry' ? kind : 'standard') as GenerationJobKind,
      status: (
        status === 'active' || status === 'finished' || status === 'aborted' ? status : 'pending'
      ) as GenerationJobStatus,
      abort_reason:
        typeof (row.abortReason ?? row.abort_reason) === 'string'
          ? String(row.abortReason ?? row.abort_reason)
          : null,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      activated_at:
        typeof (row.activatedAt ?? row.activated_at) === 'number'
          ? Number(row.activatedAt ?? row.activated_at)
          : null,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0,
      finished_at:
        typeof (row.finishedAt ?? row.finished_at) === 'number'
          ? Number(row.finishedAt ?? row.finished_at)
          : null
    }
  }

  private normalizeGenerationPageRow(row: Record<string, unknown>): GenerationPageRecord {
    return {
      id: String(row.id || ''),
      run_id: String(row.runId ?? row.run_id ?? ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      page_id: String(row.pageId ?? row.page_id ?? ''),
      page_number: Number(row.pageNumber ?? row.page_number ?? 0) || 0,
      title: String(row.title || ''),
      content_outline:
        typeof (row.contentOutline ?? row.content_outline) === 'string'
          ? String(row.contentOutline ?? row.content_outline)
          : null,
      layout_intent:
        typeof (row.layoutIntent ?? row.layout_intent) === 'string'
          ? String(row.layoutIntent ?? row.layout_intent)
          : null,
      html_path:
        typeof (row.htmlPath ?? row.html_path) === 'string'
          ? String(row.htmlPath ?? row.html_path)
          : null,
      status: String(row.status || 'pending') as GenerationPageStatus,
      error: typeof row.error === 'string' ? String(row.error) : null,
      retry_count: Number(row.retryCount ?? row.retry_count ?? 0) || 0,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0
    }
  }

  private normalizeSessionPageRow(row: Record<string, unknown>): SessionPageRecord {
    return {
      id: String(row.id || ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      legacy_page_id:
        typeof (row.legacyPageId ?? row.legacy_page_id) === 'string'
          ? String(row.legacyPageId ?? row.legacy_page_id)
          : null,
      file_slug: String(row.fileSlug ?? row.file_slug ?? ''),
      page_number: Number(row.pageNumber ?? row.page_number ?? 0) || 0,
      title: String(row.title || ''),
      html_path: String(row.htmlPath ?? row.html_path ?? ''),
      status: String(row.status || 'pending') as SessionPageStatus,
      error: typeof row.error === 'string' ? row.error : null,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0,
      deleted_at:
        typeof (row.deletedAt ?? row.deleted_at) === 'number'
          ? Number(row.deletedAt ?? row.deleted_at)
          : null
    }
  }

  private normalizeSourcePageSkeletonRow(row: Record<string, unknown>): SourcePageSkeletonRecord {
    return {
      id: String(row.id || ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      page_number: Number(row.pageNumber ?? row.page_number ?? 0) || 0,
      title: String(row.title || ''),
      role: String(row.role || 'content') === 'chapter-divider' ? 'chapter-divider' : 'content',
      source_document_path: String(row.sourceDocumentPath ?? row.source_document_path ?? ''),
      source_document_name:
        typeof (row.sourceDocumentName ?? row.source_document_name) === 'string'
          ? String(row.sourceDocumentName ?? row.source_document_name)
          : null,
      source_heading: String(row.sourceHeading ?? row.source_heading ?? ''),
      heading_level: Number(row.headingLevel ?? row.heading_level ?? 0) || 1,
      line_start: Number(row.lineStart ?? row.line_start ?? 0) || 1,
      line_end: Number(row.lineEnd ?? row.line_end ?? 0) || 1,
      reason:
        typeof row.reason === 'string' && row.reason.trim().length > 0 ? String(row.reason) : null,
      confidence: row.confidence === 'medium' || row.confidence === 'low' ? row.confidence : 'high',
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0
    }
  }

  async createGenerationRun(data: {
    id?: string
    sessionId: string
    mode: GenerationRunMode
    totalPages: number
    metadata?: unknown
    animationPreferences?: AnimationPreferencesPayload | null
    modelConfigId?: string | null
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const animationPreferences = data.animationPreferences
      ? JSON.stringify(data.animationPreferences)
      : null
    await this.db
      .insert(schema.generationRuns)
      .values({
        id,
        sessionId: data.sessionId,
        mode: data.mode,
        status: 'running',
        totalPages: Math.max(0, Math.floor(data.totalPages || 0)),
        error: null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        animationPreferences,
        modelConfigId:
          typeof data.modelConfigId === 'string' && data.modelConfigId.trim().length > 0
            ? data.modelConfigId.trim()
            : null,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: schema.generationRuns.id,
        set: {
          sessionId: data.sessionId,
          mode: data.mode,
          status: 'running',
          totalPages: Math.max(0, Math.floor(data.totalPages || 0)),
          error: null,
          metadata: data.metadata ? JSON.stringify(data.metadata) : null,
          animationPreferences,
          modelConfigId:
            typeof data.modelConfigId === 'string' && data.modelConfigId.trim().length > 0
              ? data.modelConfigId.trim()
              : null,
          updatedAt: now
        }
      })
      .run()
    return id
  }

  async createGenerationJob(data: {
    id: string
    sessionId: string
    kind: GenerationJobKind
    status: Extract<GenerationJobStatus, 'pending' | 'active'>
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.generationJobs)
      .values({
        id: data.id,
        sessionId: data.sessionId,
        kind: data.kind,
        status: data.status,
        abortReason: null,
        createdAt: now,
        activatedAt: data.status === 'active' ? now : null,
        updatedAt: now,
        finishedAt: null
      })
      .onConflictDoUpdate({
        target: schema.generationJobs.id,
        set: {
          sessionId: data.sessionId,
          kind: data.kind,
          status: data.status,
          abortReason: null,
          activatedAt: data.status === 'active' ? now : null,
          updatedAt: now,
          finishedAt: null
        }
      })
      .run()
  }

  async updateGenerationJobStatus(
    jobId: string,
    status: GenerationJobStatus,
    options?: { abortReason?: string | null }
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const set: Record<string, unknown> = {
      status,
      updatedAt: now
    }
    if (status === 'active') {
      set.activatedAt = now
      set.finishedAt = null
      set.abortReason = null
    }
    if (status === 'finished') {
      set.finishedAt = now
      set.abortReason = null
    }
    if (status === 'aborted') {
      set.finishedAt = now
      set.abortReason = options?.abortReason || null
    }
    await this.db
      .update(schema.generationJobs)
      .set(set)
      .where(eq(schema.generationJobs.id, jobId))
      .run()
  }

  async getGenerationJob(jobId: string): Promise<GenerationJobRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.generationJobs)
      .where(eq(schema.generationJobs.id, jobId))
      .get()
    return row ? this.normalizeGenerationJobRow(row as Record<string, unknown>) : undefined
  }

  async getLatestGenerationJob(sessionId: string): Promise<GenerationJobRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.generationJobs)
      .where(eq(schema.generationJobs.sessionId, sessionId))
      .orderBy(desc(schema.generationJobs.updatedAt), desc(schema.generationJobs.createdAt))
      .limit(1)
      .get()
    return row ? this.normalizeGenerationJobRow(row as Record<string, unknown>) : undefined
  }

  async listActiveGenerationJobs(): Promise<GenerationJobRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.generationJobs)
      .where(inArray(schema.generationJobs.status, ['pending', 'active']))
      .orderBy(asc(schema.generationJobs.createdAt))
      .all()
    return rows.map((row) => this.normalizeGenerationJobRow(row as Record<string, unknown>))
  }

  async updateGenerationRunStatus(
    runId: string,
    status: GenerationRunStatus,
    error?: string | null
  ): Promise<void> {
    await this.db
      .update(schema.generationRuns)
      .set({
        status,
        error: error || null,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(schema.generationRuns.id, runId))
      .run()
  }

  async getGenerationRun(runId: string): Promise<GenerationRunRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.id, runId))
      .get()
    return row ? this.normalizeGenerationRunRow(row as Record<string, unknown>) : undefined
  }

  async getLatestGenerationRun(sessionId: string): Promise<GenerationRunRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.sessionId, sessionId))
      .orderBy(desc(schema.generationRuns.createdAt))
      .limit(1)
      .get()
    return row ? this.normalizeGenerationRunRow(row as Record<string, unknown>) : undefined
  }

  async upsertGenerationPage(data: {
    runId: string
    sessionId: string
    pageId: string
    pageNumber: number
    title: string
    contentOutline?: string | null
    layoutIntent?: string | null
    htmlPath?: string | null
    status: GenerationPageStatus
    error?: string | null
    retryCount?: number
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const id = `${data.runId}:${data.pageId}`
    const values = {
      id,
      runId: data.runId,
      sessionId: data.sessionId,
      pageId: data.pageId,
      pageNumber: data.pageNumber,
      title: data.title,
      contentOutline: data.contentOutline || null,
      layoutIntent: data.layoutIntent || null,
      htmlPath: data.htmlPath || null,
      status: data.status,
      error: data.error || null,
      retryCount: Math.max(0, Math.floor(data.retryCount || 0)),
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .insert(schema.generationPages)
      .values(values)
      .onConflictDoUpdate({
        target: schema.generationPages.id,
        set: {
          pageNumber: values.pageNumber,
          title: values.title,
          contentOutline: values.contentOutline,
          layoutIntent: values.layoutIntent,
          htmlPath: values.htmlPath,
          status: values.status,
          error: values.error,
          retryCount: values.retryCount,
          updatedAt: now
        }
      })
      .run()
  }

  async listGenerationPages(runId: string): Promise<GenerationPageRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.generationPages)
      .where(eq(schema.generationPages.runId, runId))
      .orderBy(asc(schema.generationPages.pageNumber))
      .all()
    return rows.map((row) => this.normalizeGenerationPageRow(row as Record<string, unknown>))
  }

  async listLatestFailedGenerationPages(sessionId: string): Promise<GenerationPageRecord[]> {
    const run = await this.getLatestGenerationRun(sessionId)
    if (!run) return []
    return (await this.listGenerationPages(run.id)).filter((page) => page.status === 'failed')
  }

  async listLatestGenerationPageSnapshot(sessionId: string): Promise<GenerationPageRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.generationPages)
      .where(eq(schema.generationPages.sessionId, sessionId))
      .orderBy(desc(schema.generationPages.updatedAt), desc(schema.generationPages.createdAt))
      .all()
    const latestByPageId = new Map<string, GenerationPageRecord>()
    for (const row of rows) {
      const page = this.normalizeGenerationPageRow(row as Record<string, unknown>)
      if (!page.page_id || latestByPageId.has(page.page_id)) continue
      latestByPageId.set(page.page_id, page)
    }
    return Array.from(latestByPageId.values()).sort((a, b) => a.page_number - b.page_number)
  }

  async listSessionPages(
    sessionId: string,
    options?: { includeDeleted?: boolean }
  ): Promise<SessionPageRecord[]> {
    const conditions = [eq(schema.sessionPages.sessionId, sessionId)]
    if (!options?.includeDeleted) {
      conditions.push(isNull(schema.sessionPages.deletedAt))
    }
    const rows = await this.db
      .select()
      .from(schema.sessionPages)
      .where(and(...conditions))
      .orderBy(asc(schema.sessionPages.pageNumber))
      .all()
    return rows.map((row) => this.normalizeSessionPageRow(row as Record<string, unknown>))
  }

  async replaceSourcePageSkeletons(args: {
    sessionId: string
    sourceDocumentPath: string
    sourceDocumentName?: string | null
    confidence?: SourcePageSkeletonConfidence
    items: Array<{
      pageNumber: number
      title: string
      role: SourcePageSkeletonRole
      sourceHeading: string
      headingLevel: number
      lineStart: number
      lineEnd: number
      reason?: string | null
    }>
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .delete(schema.sourcePageSkeletons)
      .where(eq(schema.sourcePageSkeletons.sessionId, args.sessionId))
      .run()
    const values = args.items
      .filter((item) => item.sourceHeading.trim().length > 0)
      .map((item) => {
        const pageNumber = Math.max(1, Math.floor(item.pageNumber))
        const lineStart = Math.max(1, Math.floor(item.lineStart || 1))
        const lineEnd = Math.max(lineStart, Math.floor(item.lineEnd || lineStart))
        return {
          id: `${args.sessionId}:${pageNumber}`,
          sessionId: args.sessionId,
          pageNumber,
          title: item.title.trim() || `Slide ${pageNumber}`,
          role: item.role === 'chapter-divider' ? 'chapter-divider' : 'content',
          sourceDocumentPath: args.sourceDocumentPath,
          sourceDocumentName: args.sourceDocumentName || null,
          sourceHeading: item.sourceHeading,
          headingLevel: Math.max(1, Math.floor(item.headingLevel || 1)),
          lineStart,
          lineEnd,
          reason: item.reason || null,
          confidence: args.confidence || 'high',
          createdAt: now,
          updatedAt: now
        }
      })
    if (values.length === 0) return
    await this.db.insert(schema.sourcePageSkeletons).values(values).run()
  }

  async upsertSourcePageSkeleton(args: {
    sessionId: string
    pageNumber: number
    title: string
    role?: SourcePageSkeletonRole
    sourceDocumentPath: string
    sourceDocumentName?: string | null
    sourceHeading: string
    headingLevel?: number
    lineStart?: number
    lineEnd?: number
    reason?: string | null
    confidence?: SourcePageSkeletonConfidence
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const pageNumber = Math.max(1, Math.floor(args.pageNumber))
    const lineStart = Math.max(1, Math.floor(args.lineStart || pageNumber))
    const lineEnd = Math.max(lineStart, Math.floor(args.lineEnd || lineStart))
    const value = {
      id: `${args.sessionId}:${pageNumber}`,
      sessionId: args.sessionId,
      pageNumber,
      title: args.title.trim() || `Slide ${pageNumber}`,
      role: args.role === 'chapter-divider' ? 'chapter-divider' : 'content',
      sourceDocumentPath: args.sourceDocumentPath,
      sourceDocumentName: args.sourceDocumentName || null,
      sourceHeading: args.sourceHeading.trim(),
      headingLevel: Math.max(1, Math.floor(args.headingLevel || 1)),
      lineStart,
      lineEnd,
      reason: args.reason || null,
      confidence: args.confidence || 'medium',
      createdAt: now,
      updatedAt: now
    }
    if (!value.sourceHeading) return
    await this.db
      .insert(schema.sourcePageSkeletons)
      .values(value)
      .onConflictDoUpdate({
        target: schema.sourcePageSkeletons.id,
        set: {
          title: value.title,
          role: value.role,
          sourceDocumentPath: value.sourceDocumentPath,
          sourceDocumentName: value.sourceDocumentName,
          sourceHeading: value.sourceHeading,
          headingLevel: value.headingLevel,
          lineStart: value.lineStart,
          lineEnd: value.lineEnd,
          reason: value.reason,
          confidence: value.confidence,
          updatedAt: now
        }
      })
      .run()
  }

  async deleteSourcePageSkeleton(sessionId: string, pageNumber: number): Promise<void> {
    await this.db
      .delete(schema.sourcePageSkeletons)
      .where(
        and(
          eq(schema.sourcePageSkeletons.sessionId, sessionId),
          eq(schema.sourcePageSkeletons.pageNumber, pageNumber)
        )
      )
      .run()
  }

  async deleteSourcePageSkeletons(sessionId: string, pageNumbers: number[]): Promise<void> {
    if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) return
    await this.db
      .delete(schema.sourcePageSkeletons)
      .where(
        and(
          eq(schema.sourcePageSkeletons.sessionId, sessionId),
          inArray(schema.sourcePageSkeletons.pageNumber, pageNumbers)
        )
      )
      .run()
  }

  async listSourcePageSkeletons(sessionId: string): Promise<SourcePageSkeletonRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.sourcePageSkeletons)
      .where(eq(schema.sourcePageSkeletons.sessionId, sessionId))
      .orderBy(asc(schema.sourcePageSkeletons.pageNumber))
      .all()
    return rows.map((row) => this.normalizeSourcePageSkeletonRow(row as Record<string, unknown>))
  }

  async upsertSessionPage(page: SessionPageInput): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.sessionPages)
      .values({
        id: page.id,
        sessionId: page.sessionId,
        legacyPageId: page.legacyPageId || null,
        fileSlug: page.fileSlug,
        pageNumber: page.pageNumber,
        title: page.title,
        htmlPath: page.htmlPath,
        status: page.status || 'pending',
        error: page.error || null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null
      })
      .onConflictDoUpdate({
        target: schema.sessionPages.id,
        set: {
          legacyPageId: page.legacyPageId || null,
          fileSlug: page.fileSlug,
          pageNumber: page.pageNumber,
          title: page.title,
          htmlPath: page.htmlPath,
          status: page.status || 'pending',
          error: page.error || null,
          deletedAt: null,
          updatedAt: now
        }
      })
      .run()
  }

  async replaceSessionPageOrder(
    sessionId: string,
    pages: Array<{ id: string; pageNumber: number }>
  ): Promise<void> {
    if (pages.length === 0) return
    const now = Math.floor(Date.now() / 1000)
    const pageIds = pages.map((page) => page.id)
    const caseWhenFragments = pages.map(
      (page) => sql`WHEN ${schema.sessionPages.id} = ${page.id} THEN ${page.pageNumber}`
    )
    const pageNumberExpr = sql<number>`CASE ${sql.join(caseWhenFragments, sql` `)} ELSE ${schema.sessionPages.pageNumber} END`
    await this.db
      .update(schema.sessionPages)
      .set({
        pageNumber: pageNumberExpr,
        updatedAt: now
      })
      .where(
        and(eq(schema.sessionPages.sessionId, sessionId), inArray(schema.sessionPages.id, pageIds))
      )
      .run()
  }

  async softDeleteSessionPages(sessionId: string, ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) return
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.sessionPages)
      .set({
        deletedAt: now,
        updatedAt: now
      })
      .where(and(eq(schema.sessionPages.sessionId, sessionId), inArray(schema.sessionPages.id, ids)))
      .run()
  }

  async hardDeleteSessionPages(sessionId: string, ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) return
    await this.db
      .delete(schema.sessionPages)
      .where(
        and(eq(schema.sessionPages.sessionId, sessionId), inArray(schema.sessionPages.id, ids))
      )
      .run()
  }

  // ========== Session History ==========

  private normalizeSessionOperationRow(row: Record<string, unknown>): SessionOperationRecord {
    return {
      id: String(row.id || ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      type: String(row.type || 'edit') as SessionOperationType,
      status: String(row.status || 'completed') as SessionOperationStatus,
      scope:
        typeof (row.scope ?? row.scope) === 'string'
          ? (String(row.scope) as SessionOperationScope)
          : null,
      prompt:
        typeof row.prompt === 'string' && row.prompt.trim().length > 0 ? String(row.prompt) : null,
      parent_operation_id:
        typeof (row.parentOperationId ?? row.parent_operation_id) === 'string'
          ? String(row.parentOperationId ?? row.parent_operation_id)
          : null,
      before_commit:
        typeof (row.beforeCommit ?? row.before_commit) === 'string'
          ? String(row.beforeCommit ?? row.before_commit)
          : null,
      after_commit:
        typeof (row.afterCommit ?? row.after_commit) === 'string'
          ? String(row.afterCommit ?? row.after_commit)
          : null,
      target_operation_id:
        typeof (row.targetOperationId ?? row.target_operation_id) === 'string'
          ? String(row.targetOperationId ?? row.target_operation_id)
          : null,
      target_commit:
        typeof (row.targetCommit ?? row.target_commit) === 'string'
          ? String(row.targetCommit ?? row.target_commit)
          : null,
      changed_files_json: String(row.changedFilesJson ?? row.changed_files_json ?? '[]'),
      changed_pages_json: String(row.changedPagesJson ?? row.changed_pages_json ?? '[]'),
      tracked_files_json: String(row.trackedFilesJson ?? row.tracked_files_json ?? '[]'),
      metadata_json: String(row.metadataJson ?? row.metadata_json ?? '{}'),
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      completed_at:
        typeof (row.completedAt ?? row.completed_at) === 'number'
          ? Number(row.completedAt ?? row.completed_at)
          : null
    }
  }

  private normalizeSessionOperationPageRow(
    row: Record<string, unknown>
  ): SessionOperationPageRecord {
    return {
      id: String(row.id || ''),
      operation_id: String(row.operationId ?? row.operation_id ?? ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      page_id: String(row.pageId ?? row.page_id ?? ''),
      legacy_page_id:
        typeof (row.legacyPageId ?? row.legacy_page_id) === 'string'
          ? String(row.legacyPageId ?? row.legacy_page_id)
          : null,
      file_slug: String(row.fileSlug ?? row.file_slug ?? ''),
      page_number: Number(row.pageNumber ?? row.page_number ?? 0) || 0,
      title: String(row.title || ''),
      html_path: String(row.htmlPath ?? row.html_path ?? ''),
      status: String(row.status || 'pending') as SessionPageStatus,
      error: typeof row.error === 'string' ? String(row.error) : null,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0
    }
  }

  async createSessionOperation(data: {
    id: string
    sessionId: string
    type: SessionOperationType
    status?: SessionOperationStatus
    scope?: SessionOperationScope | null
    prompt?: string | null
    parentOperationId?: string | null
    beforeCommit?: string | null
    targetOperationId?: string | null
    targetCommit?: string | null
    metadata?: unknown
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.sessionOperations)
      .values({
        id: data.id,
        sessionId: data.sessionId,
        type: data.type,
        status: data.status || 'committing',
        scope: data.scope || null,
        prompt: data.prompt || null,
        parentOperationId: data.parentOperationId || null,
        beforeCommit: data.beforeCommit || null,
        afterCommit: null,
        targetOperationId: data.targetOperationId || null,
        targetCommit: data.targetCommit || null,
        changedFilesJson: '[]',
        changedPagesJson: '[]',
        trackedFilesJson: '[]',
        metadataJson: data.metadata ? JSON.stringify(data.metadata) : '{}',
        createdAt: now,
        completedAt: null
      })
      .run()
  }

  async completeSessionOperation(data: {
    id: string
    status: 'completed' | 'noop' | 'failed'
    afterCommit?: string | null
    changedFiles?: unknown[]
    changedPages?: unknown[]
    trackedFiles?: string[]
    metadata?: unknown
  }): Promise<void> {
    await this.db
      .update(schema.sessionOperations)
      .set({
        status: data.status,
        afterCommit: data.afterCommit || null,
        changedFilesJson: JSON.stringify(data.changedFiles || []),
        changedPagesJson: JSON.stringify(data.changedPages || []),
        trackedFilesJson: JSON.stringify(data.trackedFiles || []),
        metadataJson: JSON.stringify(data.metadata || {}),
        completedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(schema.sessionOperations.id, data.id))
      .run()
  }

  async updateSessionOperationMetadata(
    operationId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.db
      .update(schema.sessionOperations)
      .set({ metadataJson: JSON.stringify(metadata) })
      .where(eq(schema.sessionOperations.id, operationId))
      .run()
  }

  async getSessionOperation(operationId: string): Promise<SessionOperationRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.sessionOperations)
      .where(eq(schema.sessionOperations.id, operationId))
      .get()
    return row ? this.normalizeSessionOperationRow(row as Record<string, unknown>) : undefined
  }

  async hasAnyOperationPageSnapshots(sessionId: string): Promise<boolean> {
    const row = await this.db
      .select({ id: schema.sessionOperationPages.id })
      .from(schema.sessionOperationPages)
      .where(eq(schema.sessionOperationPages.sessionId, sessionId))
      .limit(1)
      .get()
    return !!row
  }

  async cleanupSessionOperations(sessionId: string): Promise<number> {
    const rows = await this.db
      .select({ id: schema.sessionOperations.id })
      .from(schema.sessionOperations)
      .where(eq(schema.sessionOperations.sessionId, sessionId))
      .all()
    if (rows.length === 0) {
      await this.updateSessionHistoryPointer({ sessionId, operationId: null, commit: null })
      return 0
    }
    const ids = rows.map((r) => r.id)
    await this.db
      .delete(schema.sessionOperationPages)
      .where(inArray(schema.sessionOperationPages.operationId, ids))
      .run()
    await this.db
      .delete(schema.sessionOperations)
      .where(inArray(schema.sessionOperations.id, ids))
      .run()
    await this.updateSessionHistoryPointer({ sessionId, operationId: null, commit: null })
    return ids.length
  }

  async listSessionOperations(
    sessionId: string,
    options?: { limit?: number; includeNoop?: boolean }
  ): Promise<SessionOperationRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.sessionOperations)
      .where(eq(schema.sessionOperations.sessionId, sessionId))
      .orderBy(desc(schema.sessionOperations.createdAt))
      .limit(Math.max(1, Math.min(200, Math.floor(options?.limit || 50))))
      .all()
    return rows
      .map((row) => this.normalizeSessionOperationRow(row as Record<string, unknown>))
      .filter((row) =>
        options?.includeNoop
          ? row.status === 'completed' || row.status === 'noop'
          : row.status === 'completed'
      )
  }

  async replaceSessionOperationPages(
    operationId: string,
    sessionId: string,
    pages: Array<{
      pageId: string
      legacyPageId?: string | null
      fileSlug: string
      pageNumber: number
      title: string
      htmlPath: string
      status?: SessionPageStatus
      error?: string | null
    }>
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .delete(schema.sessionOperationPages)
      .where(eq(schema.sessionOperationPages.operationId, operationId))
      .run()
    for (const page of pages) {
      await this.db
        .insert(schema.sessionOperationPages)
        .values({
          id: `${operationId}:${page.pageId}`,
          operationId,
          sessionId,
          pageId: page.pageId,
          legacyPageId: page.legacyPageId || null,
          fileSlug: page.fileSlug,
          pageNumber: page.pageNumber,
          title: page.title,
          htmlPath: page.htmlPath,
          status: page.status || 'pending',
          error: page.error || null,
          createdAt: now,
          updatedAt: now
        })
        .run()
    }
  }

  async listSessionOperationPages(operationId: string): Promise<SessionOperationPageRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.sessionOperationPages)
      .where(eq(schema.sessionOperationPages.operationId, operationId))
      .orderBy(asc(schema.sessionOperationPages.pageNumber))
      .all()
    return rows.map((row) => this.normalizeSessionOperationPageRow(row as Record<string, unknown>))
  }

  // ========== Messages ==========

  async getSessionMessages(
    sessionId: string,
    options?: {
      chatScope?: ChatScope
      pageId?: string
    }
  ): Promise<Message[]> {
    const chatScope = options?.chatScope ?? 'main'
    const normalizedPageId =
      typeof options?.pageId === 'string' && options.pageId.trim().length > 0
        ? options.pageId.trim()
        : null
    if (chatScope === 'page' && !normalizedPageId) {
      return []
    }
    if (chatScope === 'page' && normalizedPageId) {
      // Rollback / page-management may switch between canonical id and fileSlug.
      // Query messages by all known aliases to keep page chat continuous.
      const aliases = new Set<string>([normalizedPageId])
      const directRows = await this.db
        .select({
          id: schema.sessionPages.id,
          fileSlug: schema.sessionPages.fileSlug,
          legacyPageId: schema.sessionPages.legacyPageId
        })
        .from(schema.sessionPages)
        .where(
          and(
            eq(schema.sessionPages.sessionId, sessionId),
            or(
              eq(schema.sessionPages.id, normalizedPageId),
              eq(schema.sessionPages.fileSlug, normalizedPageId),
              eq(schema.sessionPages.legacyPageId, normalizedPageId)
            )
          )
        )
        .all()
      const matchedSlugs = Array.from(
        new Set(
          directRows
            .map((row) => String(row.fileSlug || '').trim())
            .filter((item) => item.length > 0)
        )
      )
      if (matchedSlugs.length > 0) {
        const relatedRows = await this.db
          .select({
            id: schema.sessionPages.id,
            fileSlug: schema.sessionPages.fileSlug,
            legacyPageId: schema.sessionPages.legacyPageId
          })
          .from(schema.sessionPages)
          .where(
            and(
              eq(schema.sessionPages.sessionId, sessionId),
              inArray(schema.sessionPages.fileSlug, matchedSlugs)
            )
          )
          .all()
        for (const row of relatedRows) {
          if (typeof row.id === 'string' && row.id.trim().length > 0) aliases.add(row.id.trim())
          if (typeof row.fileSlug === 'string' && row.fileSlug.trim().length > 0)
            aliases.add(row.fileSlug.trim())
          if (typeof row.legacyPageId === 'string' && row.legacyPageId.trim().length > 0)
            aliases.add(row.legacyPageId.trim())
        }
      }
      const results = await this.db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.sessionId, sessionId),
            eq(schema.messages.chatScope, 'page'),
            inArray(schema.messages.pageId, Array.from(aliases))
          )
        )
        .orderBy(asc(schema.messages.createdAt))
        .all()
      return results.map((message) => this.normalizeMessageRow(message as Record<string, unknown>))
    }
    const whereClause = and(
      eq(schema.messages.sessionId, sessionId),
      eq(schema.messages.chatScope, 'main')
    )
    const results = await this.db
      .select()
      .from(schema.messages)
      .where(whereClause)
      .orderBy(asc(schema.messages.createdAt))
      .all()

    return results.map((message) => this.normalizeMessageRow(message as Record<string, unknown>))
  }

  private normalizeAssetPaths(value: unknown, prefix: './images/' | './videos/'): string[] | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null
    try {
      const parsed = JSON.parse(value) as unknown
      if (!Array.isArray(parsed)) return null
      const valid = parsed
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith(prefix))
        .slice(0, 10)
      return valid.length > 0 ? valid : null
    } catch {
      return null
    }
  }

  private normalizeMessageRow(message: Record<string, unknown>): Message {
    const rawImagePaths = message.imagePaths ?? message.image_paths ?? null
    const rawVideoPaths = message.videoPaths ?? message.video_paths ?? null
    const imagePaths = this.normalizeAssetPaths(rawImagePaths, './images/')
    const videoPaths = this.normalizeAssetPaths(rawVideoPaths, './videos/')
    return {
      id: String(message.id || ''),
      session_id: String(message.sessionId ?? message.session_id ?? ''),
      chat_scope: message.chatScope === 'page' || message.chat_scope === 'page' ? 'page' : 'main',
      page_id:
        typeof (message.pageId ?? message.page_id) === 'string'
          ? String(message.pageId ?? message.page_id)
          : null,
      selector:
        typeof message.selector === 'string' && message.selector.trim().length > 0
          ? message.selector.trim()
          : null,
      image_paths: imagePaths,
      video_paths: videoPaths,
      role: String(message.role || 'system') as MessageRole,
      content: String(message.content || ''),
      type: String(message.type || 'text') as MessageType,
      tool_name:
        typeof (message.toolName ?? message.tool_name) === 'string'
          ? String(message.toolName ?? message.tool_name)
          : null,
      tool_call_id:
        typeof (message.toolCallId ?? message.tool_call_id) === 'string'
          ? String(message.toolCallId ?? message.tool_call_id)
          : null,
      token_count:
        typeof (message.tokenCount ?? message.token_count) === 'number'
          ? Number(message.tokenCount ?? message.token_count)
          : null,
      run_model:
        typeof (message.runModel ?? message.run_model) === 'string'
          ? String(message.runModel ?? message.run_model)
          : null,
      created_at:
        typeof (message.createdAt ?? message.created_at) === 'number'
          ? Number(message.createdAt ?? message.created_at)
          : Math.floor(Date.now() / 1000)
    }
  }

  async addMessage(
    sessionId: string,
    message: {
      role: MessageRole
      content: string
      type?: MessageType
      tool_name?: string | null
      tool_call_id?: string | null
      token_count?: number | null
      chat_scope?: ChatScope
      page_id?: string | null
      selector?: string | null
      image_paths?: string[] | null
      video_paths?: string[] | null
      run_model?: string | null
    }
  ): Promise<string> {
    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const chatScope = message.chat_scope === 'page' ? 'page' : 'main'
    const pageId =
      chatScope === 'page' &&
      typeof message.page_id === 'string' &&
      message.page_id.trim().length > 0
        ? message.page_id.trim()
        : null
    const selector =
      chatScope === 'page' &&
      typeof message.selector === 'string' &&
      message.selector.trim().length > 0
        ? message.selector.trim()
        : null
    const imagePathsRaw = Array.isArray(message.image_paths) ? message.image_paths : []
    const imagePaths =
      imagePathsRaw.length > 0
        ? imagePathsRaw
            .map((item) => String(item || '').trim())
            .filter((item) => item.startsWith('./images/'))
            .slice(0, 10)
        : []
    const videoPathsRaw = Array.isArray(message.video_paths) ? message.video_paths : []
    const videoPaths =
      videoPathsRaw.length > 0
        ? videoPathsRaw
            .map((item) => String(item || '').trim())
            .filter((item) => item.startsWith('./videos/'))
            .slice(0, 10)
        : []
    const imagePathsJson = imagePaths.length > 0 ? JSON.stringify(imagePaths) : null
    const videoPathsJson = videoPaths.length > 0 ? JSON.stringify(videoPaths) : null
    if (chatScope === 'page' && !pageId) {
      throw new Error('page chat message requires page_id')
    }

    await this.db
      .insert(schema.messages)
      .values({
        id,
        sessionId,
        chatScope,
        pageId,
        selector,
        imagePaths: imagePathsJson,
        videoPaths: videoPathsJson,
        role: message.role,
        content: message.content,
        type: message.type || 'text',
        toolName: message.tool_name || null,
        toolCallId: message.tool_call_id || null,
        tokenCount: message.token_count || null,
        runModel:
          typeof message.run_model === 'string' && message.run_model.trim().length > 0
            ? message.run_model
            : null,
        createdAt: now
      })
      .run()

    await this.db
      .update(schema.sessions)
      .set({ updatedAt: now })
      .where(eq(schema.sessions.id, sessionId))
      .run()

    return id
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .get()
    return result?.count ?? 0
  }

  async getRecentMessages(sessionId: string, count: number): Promise<Message[]> {
    const results = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(count)
      .all()

    return results.map((message) => this.normalizeMessageRow(message as Record<string, unknown>))
  }

  // ========== Memory ==========

  async getLastSummary(sessionId: string): Promise<MemorySummary | undefined> {
    const result = await this.db
      .select()
      .from(schema.memorySummaries)
      .where(eq(schema.memorySummaries.sessionId, sessionId))
      .orderBy(desc(schema.memorySummaries.messageRangeEnd))
      .limit(1)
      .get()

    return result as MemorySummary | undefined
  }

  async saveSummary(
    sessionId: string,
    data: {
      rangeStart: number
      rangeEnd: number
      summary: string
      tokenCount?: number
    }
  ): Promise<string> {
    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)

    await this.db
      .insert(schema.memorySummaries)
      .values({
        id,
        sessionId,
        messageRangeStart: data.rangeStart,
        messageRangeEnd: data.rangeEnd,
        summary: data.summary,
        tokenCount: data.tokenCount || null,
        createdAt: now
      })
      .run()

    return id
  }

  async getLastCompressedIndex(sessionId: string): Promise<number> {
    const result = await this.db
      .select({ maxIndex: max(schema.memorySummaries.messageRangeEnd) })
      .from(schema.memorySummaries)
      .where(eq(schema.memorySummaries.sessionId, sessionId))
      .get()
    return result?.maxIndex ?? 0
  }

  async getMessagesForCompression(
    sessionId: string,
    batchSize: number
  ): Promise<(Message & { idx: number })[]> {
    const lastCompressedIndex = await this.getLastCompressedIndex(sessionId)

    const results = await this.db
      .select({
        id: schema.messages.id,
        sessionId: schema.messages.sessionId,
        chatScope: schema.messages.chatScope,
        pageId: schema.messages.pageId,
        role: schema.messages.role,
        content: schema.messages.content,
        type: schema.messages.type,
        toolName: schema.messages.toolName,
        toolCallId: schema.messages.toolCallId,
        tokenCount: schema.messages.tokenCount,
        runModel: schema.messages.runModel,
        createdAt: schema.messages.createdAt
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.sessionId, sessionId),
          gt(schema.messages.createdAt, lastCompressedIndex)
        )
      )
      .orderBy(asc(schema.messages.createdAt))
      .limit(batchSize)
      .all()

    let idx = lastCompressedIndex + 1
    return results.map((r) => ({
      ...this.normalizeMessageRow(r as Record<string, unknown>),
      idx: idx++
    }))
  }

  // ========== Settings ==========

  async recordModelUsage(data: {
    provider: string
    model: string
    modelConfigId?: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    source: 'provider' | 'estimated'
  }): Promise<void> {
    await this.db
      .insert(schema.modelUsageEvents)
      .values({
        id: crypto.randomUUID(),
        provider: data.provider,
        model: data.model,
        modelConfigId: data.modelConfigId || null,
        inputTokens: Math.max(0, Math.floor(data.inputTokens)),
        outputTokens: Math.max(0, Math.floor(data.outputTokens)),
        totalTokens: Math.max(0, Math.floor(data.totalTokens)),
        usageSource: data.source,
        createdAt: Math.floor(Date.now() / 1000)
      })
      .run()
  }

  async getModelUsageStats(period: ModelUsagePeriod): Promise<ModelUsageStats> {
    const now = new Date()
    let startedAt: number | null = null
    if (period === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      startedAt = Math.floor(start.getTime() / 1000)
    } else if (period !== 'all') {
      const days = period === '7d' ? 7 : 30
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)
      startedAt = Math.floor(start.getTime() / 1000)
    }
    const whereSql = startedAt === null ? '' : ' WHERE created_at >= ?'
    const args = startedAt === null ? [] : [startedAt]
    const totalsResult = await this.client.execute({
      sql: `
        SELECT
          COUNT(*) AS call_count,
          SUM(CASE WHEN usage_source = 'provider' THEN 1 ELSE 0 END) AS exact_call_count,
          SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) AS estimated_call_count,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM model_usage_events${whereSql}
      `,
      args
    })
    const byModelResult = await this.client.execute({
      sql: `
        SELECT
          provider,
          model,
          COUNT(*) AS call_count,
          SUM(CASE WHEN usage_source = 'provider' THEN 1 ELSE 0 END) AS exact_call_count,
          SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) AS estimated_call_count,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM model_usage_events${whereSql}
        GROUP BY provider, model
        ORDER BY total_tokens DESC
      `,
      args
    })
    const byDayResult = await this.client.execute({
      sql: `
        SELECT
          date(created_at, 'unixepoch', 'localtime') AS date,
          COUNT(*) AS call_count,
          SUM(CASE WHEN usage_source = 'provider' THEN 1 ELSE 0 END) AS exact_call_count,
          SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) AS estimated_call_count,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM model_usage_events${whereSql}
        GROUP BY date
        ORDER BY date ASC
      `,
      args
    })

    const byHourResult =
      period === 'today'
        ? await this.client.execute({
            sql: `
              SELECT
                CAST(strftime('%H', created_at, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                COUNT(*) AS call_count,
                SUM(CASE WHEN usage_source = 'provider' THEN 1 ELSE 0 END) AS exact_call_count,
                SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) AS estimated_call_count,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(total_tokens), 0) AS total_tokens
              FROM model_usage_events${whereSql}
              GROUP BY hour
              ORDER BY hour ASC
            `,
            args
          })
        : null

    const readTotals = (row: Record<string, unknown> | undefined): ModelUsageTotals => ({
      callCount: Number(row?.call_count || 0),
      exactCallCount: Number(row?.exact_call_count || 0),
      estimatedCallCount: Number(row?.estimated_call_count || 0),
      inputTokens: Number(row?.input_tokens || 0),
      outputTokens: Number(row?.output_tokens || 0),
      totalTokens: Number(row?.total_tokens || 0)
    })

    const byHour: ModelUsageByHour[] = []
    if (byHourResult) {
      const hourMap = new Map<number, ModelUsageTotals>()
      for (const row of byHourResult.rows) {
        const hour = Number((row as Record<string, unknown>).hour || 0)
        hourMap.set(hour, readTotals(row as Record<string, unknown>))
      }
      for (let hour = 0; hour < 24; hour += 1) {
        byHour.push({ hour, ...(hourMap.get(hour) || readTotals(undefined)) })
      }
    }

    return {
      period,
      startedAt,
      totals: readTotals(totalsResult.rows[0] as Record<string, unknown> | undefined),
      byModel: byModelResult.rows.map((row) => ({
        provider: String(row.provider || ''),
        model: String(row.model || ''),
        ...readTotals(row as Record<string, unknown>)
      })),
      byDay: byDayResult.rows.map((row) => ({
        date: String(row.date || ''),
        ...readTotals(row as Record<string, unknown>)
      })),
      byHour
    }
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const result = await this.db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .get()
    if (!result) return undefined
    try {
      return JSON.parse(result.value) as T
    } catch {
      return result.value as T
    }
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.settings)
      .values({ key, value: JSON.stringify(value), updatedAt: now })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: JSON.stringify(value), updatedAt: now }
      })
      .run()
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const results = await this.db.select().from(schema.settings).all()
    const result: Record<string, unknown> = {}
    for (const row of results) {
      try {
        result[row.key] = JSON.parse(row.value)
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  }

  // ========== Model Configs ==========

  async listModelConfigs(): Promise<ModelConfigRow[]> {
    const results = await this.db
      .select()
      .from(schema.modelConfigs)
      .orderBy(desc(schema.modelConfigs.active), desc(schema.modelConfigs.updatedAt))
      .all()
    return results as unknown as ModelConfigRow[]
  }

  async getActiveModelConfig(): Promise<ModelConfigRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.active, 1))
      .limit(1)
      .get()
    return result as unknown as ModelConfigRow | undefined
  }

  async getModelConfig(id: string): Promise<ModelConfigRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, id))
      .limit(1)
      .get()
    return result as unknown as ModelConfigRow | undefined
  }

  async upsertModelConfig(data: {
    id?: string
    name: string
    provider: string
    model: string
    apiKey: string
    baseUrl: string
    maxTokens?: number
    disableTemperature?: boolean
    thinkingParameterMode?: string
    active?: boolean
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const maxTokens = data.maxTokens || 4096
    const disableTemperature = data.disableTemperature ? 1 : 0
    const thinkingParameterMode = normalizeThinkingParameterMode(data.thinkingParameterMode)
    if (data.active) {
      await this.db
        .update(schema.modelConfigs)
        .set({ active: 0, updatedAt: now })
        .where(eq(schema.modelConfigs.active, 1))
        .run()
    }
    await this.db
      .insert(schema.modelConfigs)
      .values({
        id,
        name: data.name,
        provider: data.provider,
        model: data.model,
        apiKey: data.apiKey,
        baseUrl: data.baseUrl,
        maxTokens,
        disableTemperature,
        thinkingParameterMode,
        active: data.active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: schema.modelConfigs.id,
        set: {
          name: data.name,
          provider: data.provider,
          model: data.model,
          apiKey: data.apiKey,
          baseUrl: data.baseUrl,
          maxTokens,
          disableTemperature,
          thinkingParameterMode,
          active: data.active ? 1 : 0,
          updatedAt: now
        }
      })
      .run()
    return id
  }

  async setActiveModelConfig(id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const existing = await this.db
      .select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, id))
      .get()
    if (!existing) throw new Error('Model config does not exist')
    await this.db
      .update(schema.modelConfigs)
      .set({ active: 0, updatedAt: now })
      .where(eq(schema.modelConfigs.active, 1))
      .run()
    await this.db
      .update(schema.modelConfigs)
      .set({ active: 1, updatedAt: now })
      .where(eq(schema.modelConfigs.id, id))
      .run()
  }

  async deleteModelConfig(id: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, id))
      .get()
    if (!existing) throw new Error('Model config does not exist')
    await this.db.delete(schema.modelConfigs).where(eq(schema.modelConfigs.id, id)).run()
  }

  // ========== Image Model Configs ==========

  async listImageModelConfigs(): Promise<ImageModelConfigRow[]> {
    const results = await this.db
      .select()
      .from(schema.imageModelConfigs)
      .orderBy(desc(schema.imageModelConfigs.active), desc(schema.imageModelConfigs.updatedAt))
      .all()
    return results as unknown as ImageModelConfigRow[]
  }

  async getActiveImageModelConfig(): Promise<ImageModelConfigRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.imageModelConfigs)
      .where(eq(schema.imageModelConfigs.active, 1))
      .limit(1)
      .get()
    return result as unknown as ImageModelConfigRow | undefined
  }

  async getImageModelConfig(id: string): Promise<ImageModelConfigRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.imageModelConfigs)
      .where(eq(schema.imageModelConfigs.id, id))
      .limit(1)
      .get()
    return result as unknown as ImageModelConfigRow | undefined
  }

  async upsertImageModelConfig(data: {
    id?: string
    name: string
    provider: string
    modelConfig: string
    active?: boolean
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    if (data.active) {
      await this.db
        .update(schema.imageModelConfigs)
        .set({ active: 0, updatedAt: now })
        .where(eq(schema.imageModelConfigs.active, 1))
        .run()
    }
    await this.db
      .insert(schema.imageModelConfigs)
      .values({
        id,
        name: data.name,
        provider: data.provider,
        modelConfig: data.modelConfig,
        active: data.active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: schema.imageModelConfigs.id,
        set: {
          name: data.name,
          provider: data.provider,
          modelConfig: data.modelConfig,
          active: data.active ? 1 : 0,
          updatedAt: now
        }
      })
      .run()
    return id
  }

  async setActiveImageModelConfig(id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const existing = await this.db
      .select()
      .from(schema.imageModelConfigs)
      .where(eq(schema.imageModelConfigs.id, id))
      .get()
    if (!existing) throw new Error('Image model config does not exist')
    await this.db
      .update(schema.imageModelConfigs)
      .set({ active: 0, updatedAt: now })
      .where(eq(schema.imageModelConfigs.active, 1))
      .run()
    await this.db
      .update(schema.imageModelConfigs)
      .set({ active: 1, updatedAt: now })
      .where(eq(schema.imageModelConfigs.id, id))
      .run()
  }

  async deleteImageModelConfig(id: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(schema.imageModelConfigs)
      .where(eq(schema.imageModelConfigs.id, id))
      .get()
    if (!existing) throw new Error('Image model config does not exist')
    await this.db.delete(schema.imageModelConfigs).where(eq(schema.imageModelConfigs.id, id)).run()
  }

  // ========== Image Generation Histories ==========

  async listImageGenerationHistories(
    sessionId: string,
    pageId: string
  ): Promise<ImageGenerationHistoryRow[]> {
    const results = await this.db
      .select()
      .from(schema.imageGenerationHistories)
      .where(
        and(
          eq(schema.imageGenerationHistories.sessionId, sessionId),
          eq(schema.imageGenerationHistories.pageId, pageId)
        )
      )
      .orderBy(desc(schema.imageGenerationHistories.createdAt))
      .limit(50)
      .all()
    return results as unknown as ImageGenerationHistoryRow[]
  }

  async insertImageGenerationHistory(data: {
    id?: string
    sessionId: string
    pageId: string
    prompt: string
    imagePaths: string[]
    modelConfigId: string
    provider: string
    model: string
    createdAt?: number
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    await this.db
      .insert(schema.imageGenerationHistories)
      .values({
        id,
        sessionId: data.sessionId,
        pageId: data.pageId,
        prompt: data.prompt,
        imagePaths: JSON.stringify(data.imagePaths),
        modelConfigId: data.modelConfigId,
        provider: data.provider,
        model: data.model,
        createdAt: data.createdAt || Math.floor(Date.now() / 1000)
      })
      .run()
    return id
  }

  // ========== Preferences ==========

  async getActiveUserPreferences(): Promise<UserPreference[]> {
    const results = await this.db
      .select()
      .from(schema.userPreferences)
      .where(gt(schema.userPreferences.confidence, 0.3))
      .orderBy(desc(schema.userPreferences.confidence), desc(schema.userPreferences.lastUsedAt))
      .limit(10)
      .all()

    return results.map((r) => ({
      key: r.key,
      value: JSON.parse(r.value),
      confidence: r.confidence,
      source_sessions: r.sourceSessions ? JSON.parse(r.sourceSessions) : [],
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      last_used_at: r.lastUsedAt
    })) as unknown as UserPreference[]
  }

  async upsertPreference(
    key: string,
    data: { value: unknown; confidence?: number; sourceSessions?: string[] }
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const existing = await this.db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.key, key))
      .get()

    if (existing) {
      const existingSources = existing.sourceSessions ? JSON.parse(existing.sourceSessions) : []
      const newSources = data.sourceSessions
        ? [...new Set([...existingSources, ...data.sourceSessions])]
        : existingSources
      const baseConfidence = existing.confidence ?? 0.5
      const increment = (data.confidence ?? 0.5) * 0.3
      const newConfidence = Math.min(1.0, baseConfidence + increment)

      await this.db
        .update(schema.userPreferences)
        .set({
          value: JSON.stringify(data.value),
          confidence: newConfidence,
          sourceSessions: JSON.stringify(newSources),
          updatedAt: now,
          lastUsedAt: now
        })
        .where(eq(schema.userPreferences.key, key))
        .run()
    } else {
      await this.db
        .insert(schema.userPreferences)
        .values({
          key,
          value: JSON.stringify(data.value),
          confidence: data.confidence || 0.5,
          sourceSessions: JSON.stringify(data.sourceSessions || []),
          createdAt: now,
          updatedAt: now,
          lastUsedAt: now
        })
        .run()
    }
  }

  async decayPreferences(): Promise<void> {
    await this.db
      .update(schema.userPreferences)
      .set({ confidence: sql`${schema.userPreferences.confidence} * 0.95` })
      .where(gt(schema.userPreferences.confidence, 0.1))
      .run()

    await this.db
      .delete(schema.userPreferences)
      .where(lte(schema.userPreferences.confidence, 0.1))
      .run()
  }

  // ========== Projects ==========

  async createProject(data: {
    session_id: string
    title: string
    output_path: string
    root_path?: string | null
  }): Promise<string> {
    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)

    await this.db
      .insert(schema.projects)
      .values({
        id,
        sessionId: data.session_id,
        title: data.title,
        outputPath: data.output_path,
        rootPath: data.root_path || data.output_path,
        fileCount: 0,
        totalSize: 0,
        status: 'draft',
        createdAt: now,
        updatedAt: now
      })
      .run()

    return id
  }

  async getProject(sessionId: string): Promise<Project | undefined> {
    const row = await this.db
      .select({
        id: schema.projects.id,
        session_id: schema.projects.sessionId,
        title: schema.projects.title,
        output_path: schema.projects.outputPath,
        root_path: schema.projects.rootPath,
        file_count: schema.projects.fileCount,
        total_size: schema.projects.totalSize,
        status: schema.projects.status,
        created_at: schema.projects.createdAt,
        updated_at: schema.projects.updatedAt
      })
      .from(schema.projects)
      .where(eq(schema.projects.sessionId, sessionId))
      .orderBy(desc(schema.projects.createdAt))
      .limit(1)
      .get()

    return row as Project | undefined
  }

  async updateProjectStatus(
    projectId: string,
    status: 'draft' | 'published' | 'exported'
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.projects)
      .set({ status, updatedAt: now })
      .where(eq(schema.projects.id, projectId))
      .run()
  }

  // ========== Styles ==========

  async countStyles(): Promise<number> {
    const result = await this.db.select({ count: count() }).from(schema.styles).get()
    return result?.count ?? 0
  }

  async syncInstalledStylesToDatabase(installedRootPath: string): Promise<void> {
    const systemPath = path.join(installedRootPath, 'system')
    const userPath = path.join(installedRootPath, 'user')
    await this._refreshStylesCache()

    const syncDirectory = async (root: string, scope: 'system' | 'user'): Promise<void> => {
      if (!fs.existsSync(root)) return
      const packageNames = await listStylePackageDirectories(root)
      for (const packageName of packageNames) {
        try {
          const stylePackage = await readStylePackage(path.join(root, packageName))
          const item = stylePackage.json
          const existing = this._stylesCache.find((row) => row.style === item.style)
          const source: StyleSource =
            scope === 'system' ? 'builtin' : item.source === 'override' ? 'override' : 'custom'
          const packageDir = path.posix.join(scope, packageName)

          if (!existing) {
            await this.createStyleRow({
              id: scope === 'user' ? packageName : undefined,
              style: item.style,
              styleName: item.name.zh,
              styleNameZh: item.name.zh,
              styleNameEn: item.name.en,
              description: item.description,
              category: item.category,
              aliases: item.aliases,
              source,
              styleSkill: stylePackage.skillMarkdown,
              version: item.version,
              styleCase: item.styleCase,
              packageDir
            })
            continue
          }

          if (scope === 'system') {
            if (
              existing.source === 'builtin'
            ) {
              await this.updateStyleRow(existing.id, {
                styleName: item.name.zh,
                styleNameZh: item.name.zh,
                styleNameEn: item.name.en,
                description: item.description,
                category: item.category,
                aliases: item.aliases,
                styleSkill: stylePackage.skillMarkdown,
                version: item.version,
                styleCase: item.styleCase,
                packageDir
              })
              continue
            }
            if (
              existing.source === 'override' &&
              compareStyleVersion(item.version, existing.version) > 0
            ) {
              await this.updateStyleRow(existing.id, { version: item.version })
            }
            continue
          }
          await this.updateStyleRow(existing.id, {
            styleName: item.name.zh,
            styleNameZh: item.name.zh,
            styleNameEn: item.name.en,
            description: item.description,
            category: item.category,
            aliases: item.aliases,
            source,
            styleSkill: stylePackage.skillMarkdown,
            version: item.version,
            styleCase: item.styleCase,
            packageDir
          })
        } catch (error) {
          console.warn('[db] failed to sync installed style package', {
            path: path.join(root, packageName),
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    await syncDirectory(systemPath, 'system')
    await syncDirectory(userPath, 'user')
    await this._refreshStylesCache()
  }

  private async _refreshStylesCache(): Promise<void> {
    const results = await this.db
      .select()
      .from(schema.styles)
      .orderBy(asc(schema.styles.style))
      .all()
    this._stylesCache = (results as unknown as StyleRow[]).map((row) => ({
      ...row,
      version: normalizeStyleVersion(row.version)
    }))
  }

  /** Synchronous read from in-memory cache. Used by prompt builders. */
  listStyleRowsSync(): StyleRow[] {
    return this._stylesCache
  }

  /** Synchronous cache lookup. */
  getStyleRowSync(styleId: string): StyleRow | undefined {
    return this._stylesCache.find((r) => r.id === styleId)
  }

  /** Synchronous cache lookup by style key. */
  getStyleRowByStyleSync(style: string): StyleRow | undefined {
    return this._stylesCache.find((r) => r.style === style)
  }

  async listStyleRows(): Promise<StyleRow[]> {
    const results = await this.db
      .select()
      .from(schema.styles)
      .orderBy(asc(schema.styles.style))
      .all()
    return (results as unknown as StyleRow[]).map((row) => ({
      ...row,
      version: normalizeStyleVersion(row.version)
    }))
  }

  async getStyleRow(styleId: string): Promise<StyleRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.styles)
      .where(eq(schema.styles.id, styleId))
      .get()
    return result
      ? ({
          ...(result as unknown as StyleRow),
          version: normalizeStyleVersion((result as unknown as StyleRow).version)
        } as StyleRow)
      : undefined
  }

  async getStyleRowByStyle(style: string): Promise<StyleRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.styles)
      .where(eq(schema.styles.style, style))
      .get()
    return result
      ? ({
          ...(result as unknown as StyleRow),
          version: normalizeStyleVersion((result as unknown as StyleRow).version)
        } as StyleRow)
      : undefined
  }

  async createStyleRow(data: {
    id?: string
    style: string
    styleName: string
    styleNameZh?: string
    styleNameEn?: string
    description?: string
    category?: string
    aliases?: string[]
    source?: StyleSource
    styleSkill?: string
    version?: string | number
    styleCase?: string
    packageDir?: string
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.styles)
      .values({
        id,
        style: data.style,
        styleName: data.styleName,
        styleNameZh: data.styleNameZh || data.styleName,
        styleNameEn: data.styleNameEn || '',
        description: data.description || '',
        category: data.category || '',
        aliases: JSON.stringify(data.aliases || []),
        source: data.source || 'custom',
        styleSkill: data.styleSkill || '',
        version: normalizeStyleVersion(data.version),
        styleCase: data.styleCase || '',
        packageDir: data.packageDir || '',
        createdAt: now,
        updatedAt: now
      })
      .run()
    await this._refreshStylesCache()
    return id
  }

  async updateStyleRow(
    styleId: string,
    data: {
      styleName?: string
      styleNameZh?: string
      styleNameEn?: string
      description?: string
      category?: string
      aliases?: string[]
      source?: StyleSource
      styleSkill?: string
      version?: string | number
      styleCase?: string
      packageDir?: string
      active?: boolean
    }
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const set: Record<string, unknown> = { updatedAt: now }
    if (data.styleName !== undefined) set.styleName = data.styleName
    if (data.styleNameZh !== undefined) set.styleNameZh = data.styleNameZh
    if (data.styleNameEn !== undefined) set.styleNameEn = data.styleNameEn
    if (data.description !== undefined) set.description = data.description
    if (data.category !== undefined) set.category = data.category
    if (data.aliases !== undefined) set.aliases = JSON.stringify(data.aliases)
    if (data.source !== undefined) set.source = data.source
    if (data.styleSkill !== undefined) set.styleSkill = data.styleSkill
    if (data.version !== undefined) set.version = normalizeStyleVersion(data.version)
    if (data.styleCase !== undefined) set.styleCase = data.styleCase
    if (data.packageDir !== undefined) set.packageDir = data.packageDir
    if (data.active !== undefined) set.active = data.active
    await this.db.update(schema.styles).set(set).where(eq(schema.styles.id, styleId)).run()
    await this._refreshStylesCache()
  }

  async setStyleFavorite(styleId: string, favoriteAt: number | null): Promise<number | null> {
    const existing = await this.getStyleRow(styleId)
    if (!existing) {
      throw new Error(`Style not found: ${styleId}`)
    }
    await this.db
      .update(schema.styles)
      .set({ favoriteAt })
      .where(eq(schema.styles.id, styleId))
      .run()
    await this._refreshStylesCache()
    return favoriteAt
  }

  async deleteStyleRow(styleId: string): Promise<boolean> {
    const existing = await this.getStyleRow(styleId)
    if (!existing) return false
    await this.db.delete(schema.styles).where(eq(schema.styles.id, styleId)).run()
    await this._refreshStylesCache()
    return true
  }

  async getThumbnailRecord(
    resourceType: HtmlThumbnailResourceType,
    resourceId: string,
    variant = 'default'
  ): Promise<ThumbnailRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.thumbnails)
      .where(
        and(
          eq(schema.thumbnails.resourceType, resourceType),
          eq(schema.thumbnails.resourceId, resourceId),
          eq(schema.thumbnails.variant, variant)
        )
      )
      .get()
    return row as ThumbnailRecord | undefined
  }

  async getThumbnailRecords(
    resourceType: HtmlThumbnailResourceType,
    resourceIds: string[],
    variant = 'default'
  ): Promise<ThumbnailRecord[]> {
    const ids = Array.from(new Set(resourceIds.map((id) => String(id || '').trim()).filter(Boolean)))
    if (ids.length === 0) return []
    const rows = await this.db
      .select()
      .from(schema.thumbnails)
      .where(
        and(
          eq(schema.thumbnails.resourceType, resourceType),
          inArray(schema.thumbnails.resourceId, ids),
          eq(schema.thumbnails.variant, variant)
        )
      )
      .all()
    return rows as ThumbnailRecord[]
  }

  async upsertThumbnailRecord(data: {
    resourceType: HtmlThumbnailResourceType
    resourceId: string
    variant: string
    sourcePath: string
    sourceMtimeMs: number
    signature: string
    thumbnailPath: string
    status: ThumbnailStatus
    error?: string | null
  }): Promise<void> {
    const now = Date.now()
    const key = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          variant: data.variant
        })
      )
      .digest('hex')
      .slice(0, 32)
    await this.db
      .insert(schema.thumbnails)
      .values({
        key,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        variant: data.variant,
        sourcePath: data.sourcePath,
        sourceMtimeMs: data.sourceMtimeMs,
        signature: data.signature,
        thumbnailPath: data.thumbnailPath,
        status: data.status,
        error: data.error || null,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: schema.thumbnails.key,
        set: {
          sourcePath: data.sourcePath,
          sourceMtimeMs: data.sourceMtimeMs,
          signature: data.signature,
          thumbnailPath: data.thumbnailPath,
          status: data.status,
          error: data.error || null,
          updatedAt: now
        }
      })
      .run()
  }

  async failInterruptedThumbnailTasks(): Promise<void> {
    await this.db
      .update(schema.thumbnails)
      .set({
        status: 'failed',
        error: '应用退出时任务尚未完成',
        updatedAt: Date.now()
      })
      .where(inArray(schema.thumbnails.status, ['queued', 'running']))
      .run()
  }

  async getSessionStyleSnapshot(sessionId: string): Promise<SessionStyleSnapshotRow | undefined> {
    const row = await this.db
      .select()
      .from(schema.sessionStyleSnapshots)
      .where(eq(schema.sessionStyleSnapshots.sessionId, sessionId))
      .get()
    return row as unknown as SessionStyleSnapshotRow | undefined
  }

  async createSessionStyleSnapshot(
    sessionId: string,
    styleId?: string | null
  ): Promise<SessionStyleSnapshotRow> {
    const style = this.resolveSnapshotStyleRow(styleId)
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.sessionStyleSnapshots)
      .values({
        id: crypto.randomUUID(),
        sessionId,
        styleId: style.id,
        styleKey: style.style,
        styleName: style.styleName,
        styleNameZh: style.styleNameZh || style.styleName,
        styleNameEn: style.styleNameEn || '',
        description: style.description,
        category: style.category,
        aliases: style.aliases || '[]',
        source: style.source,
        version: normalizeStyleVersion(style.version),
        styleCase: style.styleCase,
        packageDir: style.packageDir || '',
        styleSkill: style.styleSkill,
        createdAt: now
      })
      .onConflictDoNothing({ target: schema.sessionStyleSnapshots.sessionId })
      .run()
    const existing = await this.getSessionStyleSnapshot(sessionId)
    if (!existing) throw new Error('Session style snapshot was not created')
    return existing
  }

  async replaceSessionStyleSnapshot(
    sessionId: string,
    styleId?: string | null
  ): Promise<SessionStyleSnapshotRow> {
    await this.db
      .delete(schema.sessionStyleSnapshots)
      .where(eq(schema.sessionStyleSnapshots.sessionId, sessionId))
      .run()
    return this.createSessionStyleSnapshot(sessionId, styleId)
  }

  async getOrCreateSessionStyleSnapshot(sessionId: string): Promise<SessionStyleSnapshotRow> {
    const existing = await this.getSessionStyleSnapshot(sessionId)
    if (existing) return existing
    const session = await this.getSession(sessionId)
    return this.createSessionStyleSnapshot(sessionId, session?.styleId)
  }

  async copySessionStyleSnapshot(sourceSessionId: string, targetSessionId: string): Promise<void> {
    const source = await this.getOrCreateSessionStyleSnapshot(sourceSessionId)
    await this.db
      .delete(schema.sessionStyleSnapshots)
      .where(eq(schema.sessionStyleSnapshots.sessionId, targetSessionId))
      .run()
    await this.db
      .insert(schema.sessionStyleSnapshots)
      .values({
        id: crypto.randomUUID(),
        sessionId: targetSessionId,
        styleId: source.styleId,
        styleKey: source.styleKey,
        styleName: source.styleName,
        styleNameZh: source.styleNameZh || source.styleName,
        styleNameEn: source.styleNameEn || '',
        description: source.description,
        category: source.category,
        aliases: source.aliases,
        source: source.source,
        version: normalizeStyleVersion(source.version),
        styleCase: source.styleCase,
        packageDir: source.packageDir || '',
        styleSkill: source.styleSkill,
        createdAt: Math.floor(Date.now() / 1000)
      })
      .onConflictDoNothing({ target: schema.sessionStyleSnapshots.sessionId })
      .run()
  }

  async backfillSessionStyleSnapshots(): Promise<{
    scanned: number
    created: number
    fallback: number
    failed: number
  }> {
    const rows = await this.db
      .select({ session: schema.sessions })
      .from(schema.sessions)
      .leftJoin(
        schema.sessionStyleSnapshots,
        eq(schema.sessionStyleSnapshots.sessionId, schema.sessions.id)
      )
      .where(isNull(schema.sessionStyleSnapshots.id))
      .all()

    let created = 0
    let fallback = 0
    let failed = 0
    for (const row of rows) {
      const session = row.session as unknown as Session
      try {
        const snapshot = await this.createSessionStyleSnapshot(session.id, session.styleId)
        if (!session.styleId || session.styleId !== snapshot.styleId) {
          fallback += 1
          await this.updateSessionStyleId(session.id, snapshot.styleId)
        }
        created += 1
      } catch (error) {
        failed += 1
        console.warn('[db] failed to backfill session style snapshot', {
          sessionId: session.id,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    return { scanned: rows.length, created, fallback, failed }
  }

  styleRowToPackageJson(styleId: string): ReturnType<typeof styleRowToPackageJson> {
    const row = this.getStyleRowSync(styleId)
    if (!row) throw new Error('style 不存在：' + styleId)
    return styleRowToPackageJson({
      style: row.style,
      styleName: row.styleName,
      styleNameZh: row.styleNameZh || row.styleName,
      styleNameEn: row.styleNameEn || '',
      description: row.description,
      category: row.category,
      aliases: row.aliases,
      source: row.source,
      version: row.version,
      styleCase: row.styleCase
    })
  }

  private resolveSnapshotStyleRow(styleId?: string | null): StyleRow {
    if (styleId) {
      const byId = this._stylesCache.find((row) => row.id === styleId)
      if (byId) return byId
      const byStyle = this._stylesCache.find((row) => row.style === styleId)
      if (byStyle) return byStyle
    }
    const activeRows = this._stylesCache.filter((row) => row.active !== false)
    const fallback =
      activeRows.find((row) => row.style === 'minimal-white') ||
      this._stylesCache.find((row) => row.style === 'minimal-white') ||
      activeRows[0] ||
      this._stylesCache[0]
    if (!fallback) throw new Error('No style rows available for session snapshot')
    return fallback
  }
}
