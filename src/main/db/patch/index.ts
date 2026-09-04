import type { createClient } from '@libsql/client'
import type { drizzle } from 'drizzle-orm/libsql'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import * as schema from '../schema'
import type { GenerationPageStatus, GenerationRunStatus } from '../schema'
import { defaultModelTimeoutMs } from '@shared/model-timeout'
import { patchModelConfigMaxTokens } from './add-model-max-tokens'
import { patchModelConfigDisableTemperature } from './add-model-disable-temperature'
import { patchModelConfigThinkingParameterMode } from './add-model-thinking-parameter-mode'
import { patchStylesColumns } from './add-styles-columns'
import { patchDesignContractFonts } from './backfill-design-contract-fonts'
import { patchSourcePageSkeletonAgendaItems } from './add-source-page-skeleton-agenda-items'

type LibSqlClient = ReturnType<typeof createClient>
type DrizzleDb = ReturnType<typeof drizzle>

const SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const MESSAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chat_scope TEXT NOT NULL DEFAULT 'main',
  page_id TEXT,
  selector TEXT,
  image_paths TEXT,
  video_paths TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  token_count INTEGER,
  run_model TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_scope ON messages(session_id, chat_scope, page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_only ON messages(session_id);
`

const MODEL_USAGE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS model_usage_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_config_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  usage_source TEXT NOT NULL DEFAULT 'provider',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_usage_events_created ON model_usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_model_usage_events_model ON model_usage_events(provider, model, created_at);
`

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT,
  style_id TEXT,
  page_count INTEGER,
  slide_size_id TEXT NOT NULL DEFAULT 'wide-16-9',
  slide_width INTEGER NOT NULL DEFAULT 1600,
  slide_height INTEGER NOT NULL DEFAULT 900,
  reference_document_path TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT,
  design_contract TEXT,
  current_operation_id TEXT,
  current_commit TEXT,
  visual_enabled INTEGER NOT NULL DEFAULT 0,
  image_model_config_id TEXT REFERENCES image_model_configs(id) ON DELETE RESTRICT
);

${MESSAGES_TABLE_SQL}

${MODEL_USAGE_TABLE_SQL}

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  output_path TEXT NOT NULL,
  root_path TEXT,
  file_count INTEGER DEFAULT 0,
  total_size INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

${SETTINGS_TABLE_SQL}

CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  disable_temperature INTEGER NOT NULL DEFAULT 0,
  thinking_parameter_mode TEXT NOT NULL DEFAULT 'auto',
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_single_active ON model_configs(active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_model_configs_updated ON model_configs(updated_at);

CREATE TABLE IF NOT EXISTS image_model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_config TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_model_configs_single_active ON image_model_configs(active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_image_model_configs_updated ON image_model_configs(updated_at);

CREATE TABLE IF NOT EXISTS image_generation_histories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  image_paths TEXT NOT NULL DEFAULT '[]',
  model_config_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_generation_histories_session ON image_generation_histories(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_image_generation_histories_page ON image_generation_histories(session_id, page_id, created_at);

CREATE TABLE IF NOT EXISTS memory_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_range_start INTEGER NOT NULL,
  message_range_end INTEGER NOT NULL,
  summary TEXT NOT NULL,
  token_count INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_summaries_session ON memory_summaries(session_id, message_range_end);

CREATE INDEX IF NOT EXISTS idx_projects_session ON projects(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_session_id ON memory_summaries(session_id);

CREATE TABLE IF NOT EXISTS generation_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'generate',
  status TEXT NOT NULL DEFAULT 'running',
  total_pages INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata TEXT,
  animation_preferences TEXT,
  model_config_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generation_runs_session ON generation_runs(session_id, created_at);

CREATE TABLE IF NOT EXISTS session_jobs (
  id TEXT PRIMARY KEY REFERENCES generation_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  previous_session_status TEXT NOT NULL,
  target_page_id TEXT,
  target_page_number INTEGER,
  selector TEXT,
  total_pages INTEGER,
  status TEXT NOT NULL,
  abort_reason TEXT,
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_session_jobs_session_status ON session_jobs(session_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_session_jobs_status ON session_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS generation_pages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_outline TEXT,
  layout_intent TEXT,
  layout_id TEXT,
  layout_contract_version INTEGER,
  html_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generation_pages_run ON generation_pages(run_id, page_number);
CREATE INDEX IF NOT EXISTS idx_generation_pages_session_status ON generation_pages(session_id, status, page_number);

CREATE TABLE IF NOT EXISTS session_pages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  legacy_page_id TEXT,
  file_slug TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  html_path TEXT NOT NULL,
  layout_intent TEXT,
  layout_id TEXT,
  layout_contract_version INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_session_pages_session_number ON session_pages(session_id, page_number);

CREATE TABLE IF NOT EXISTS image_fulfillment_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  session_page_id TEXT NOT NULL REFERENCES session_pages(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  layout_id TEXT,
  layout_contract_version INTEGER,
  image_model_config_id TEXT REFERENCES image_model_configs(id) ON DELETE SET NULL,
  image_provider TEXT,
  image_model TEXT,
  attempt INTEGER NOT NULL,
  retry_of_job_id TEXT REFERENCES image_fulfillment_jobs(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  cancel_requested_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  finalization_manifest_path TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS image_fulfillment_run_page_attempt_unique
  ON image_fulfillment_jobs(run_id, session_page_id, attempt);
CREATE UNIQUE INDEX IF NOT EXISTS image_fulfillment_idempotency_unique
  ON image_fulfillment_jobs(session_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_fulfillment_one_active_page
  ON image_fulfillment_jobs(session_id, session_page_id)
  WHERE status IN ('pending', 'running', 'finalizing');
CREATE INDEX IF NOT EXISTS idx_image_fulfillment_jobs_session_page_status
  ON image_fulfillment_jobs(session_id, session_page_id, status, updated_at);

CREATE TABLE IF NOT EXISTS image_fulfillment_intents (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES image_fulfillment_jobs(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  layout_slot_id TEXT NOT NULL,
  role TEXT NOT NULL,
  layer TEXT NOT NULL,
  request_version INTEGER NOT NULL DEFAULT 1,
  size_hint TEXT,
  subject TEXT NOT NULL,
  text_zone TEXT,
  subject_zone TEXT,
  negative_space TEXT,
  avoid_json TEXT,
  request_json TEXT NOT NULL,
  image_history_id TEXT,
  asset_path TEXT,
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  retry_of_intent_id TEXT REFERENCES image_fulfillment_intents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS image_fulfillment_intent_slot_unique
  ON image_fulfillment_intents(job_id, slot_id);
CREATE INDEX IF NOT EXISTS idx_image_fulfillment_intents_job_status
  ON image_fulfillment_intents(job_id, status, updated_at);

CREATE TABLE IF NOT EXISTS source_page_skeletons (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'content',
  source_document_path TEXT NOT NULL,
  source_document_name TEXT,
  source_heading TEXT NOT NULL,
  heading_level INTEGER NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  agenda_items_json TEXT,
  reason TEXT,
  confidence TEXT NOT NULL DEFAULT 'high',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_page_skeletons_session ON source_page_skeletons(session_id, page_number);

CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  source_sessions TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS styles (
  id TEXT PRIMARY KEY,
  style TEXT UNIQUE NOT NULL,
  style_name TEXT NOT NULL,
  style_name_zh TEXT NOT NULL DEFAULT '',
  style_name_en TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'custom',
  style_skill TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0.0',
  style_case TEXT NOT NULL DEFAULT '',
  image_generation_prompt TEXT NOT NULL DEFAULT '',
  package_dir TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  favorite_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_styles_style ON styles(style);

CREATE TABLE IF NOT EXISTS thumbnails (
  key TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'default',
  source_path TEXT NOT NULL,
  source_mtime_ms INTEGER NOT NULL DEFAULT 0,
  signature TEXT NOT NULL DEFAULT '',
  thumbnail_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS thumbnails_resource_variant_unique
  ON thumbnails(resource_type, resource_id, variant);
CREATE INDEX IF NOT EXISTS thumbnails_status_idx ON thumbnails(status, updated_at);

CREATE TABLE IF NOT EXISTS session_style_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  style_id TEXT NOT NULL,
  style_key TEXT NOT NULL,
  style_name TEXT NOT NULL,
  style_name_zh TEXT NOT NULL DEFAULT '',
  style_name_en TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  style_case TEXT NOT NULL DEFAULT '',
  image_generation_prompt TEXT NOT NULL DEFAULT '',
  package_dir TEXT NOT NULL DEFAULT '',
  style_skill TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS session_style_snapshots_session_id_unique
  ON session_style_snapshots(session_id);

CREATE TABLE IF NOT EXISTS session_operations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  scope TEXT,
  prompt TEXT,
  parent_operation_id TEXT,
  before_commit TEXT,
  after_commit TEXT,
  target_operation_id TEXT,
  target_commit TEXT,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  changed_pages_json TEXT NOT NULL DEFAULT '[]',
  tracked_files_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_session_operations_session_created ON session_operations(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_operations_session_status ON session_operations(session_id, status, created_at);

CREATE TABLE IF NOT EXISTS session_operation_pages (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES session_operations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  legacy_page_id TEXT,
  file_slug TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  html_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_operation_pages_order ON session_operation_pages(operation_id, page_number);
CREATE INDEX IF NOT EXISTS idx_session_operation_pages_session ON session_operation_pages(session_id, operation_id);
`

const getRowValue = (row: unknown, key: string): unknown => {
  if (row && typeof row === 'object' && !Array.isArray(row) && key in row) {
    return (row as Record<string, unknown>)[key]
  }
  return undefined
}

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string' || value.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const toPositiveInt = (value: unknown, fallback: number): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

const inferPageNumber = (page: Record<string, unknown>, fallback: number): number => {
  const explicit = toPositiveInt(page.pageNumber ?? page.page_number, 0)
  if (explicit > 0) return explicit
  const rawPageId =
    typeof (page.pageId ?? page.page_id) === 'string'
      ? String(page.pageId ?? page.page_id).trim()
      : ''
  const fromPageId = toPositiveInt(rawPageId.match(/^page-(\d+)$/i)?.[1], 0)
  return fromPageId > 0 ? fromPageId : fallback
}

const resolveLegacyPagePath = (
  page: Record<string, unknown>,
  projectDir: string,
  pageId: string
): string => {
  const rawPath =
    typeof (page.htmlPath ?? page.html_path) === 'string'
      ? String(page.htmlPath ?? page.html_path).trim()
      : ''
  if (!rawPath) return path.join(projectDir, `${pageId}.html`)
  return path.isAbsolute(rawPath) ? rawPath : path.join(projectDir, rawPath)
}

const getTableColumns = async (
  client: LibSqlClient,
  tableName:
    | 'settings'
    | 'messages'
    | 'sessions'
    | 'projects'
    | 'generation_runs'
    | 'generation_jobs'
    | 'session_jobs'
    | 'page_edit_jobs'
    | 'deck_edit_jobs'
    | 'generation_pages'
    | 'session_pages'
    | 'model_configs'
    | 'image_model_configs'
    | 'html_edit_messages'
): Promise<Set<string>> => {
  const result = await client.execute(`PRAGMA table_info(${tableName})`)
  const rows = Array.isArray((result as { rows?: unknown[] }).rows)
    ? ((result as { rows?: unknown[] }).rows as unknown[])
    : []
  const columns = new Set<string>()
  for (const row of rows) {
    if (row && typeof row === 'object' && 'name' in row) {
      const name = (row as { name?: unknown }).name
      if (typeof name === 'string' && name.trim().length > 0) {
        columns.add(name.trim())
      }
      continue
    }
    if (Array.isArray(row) && typeof row[1] === 'string' && row[1].trim().length > 0) {
      columns.add(row[1].trim())
    }
  }
  return columns
}

const enforceSettingsSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(SETTINGS_TABLE_SQL)
  const columns = await getTableColumns(client, 'settings')
  if (!columns.has('value')) {
    await client.execute(`ALTER TABLE settings ADD COLUMN value TEXT NOT NULL DEFAULT '""'`)
  }
  if (!columns.has('updated_at')) {
    await client.execute('ALTER TABLE settings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
  }
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key)')
}

const enforceModelConfigsSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_single_active ON model_configs(active) WHERE active = 1'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_model_configs_updated ON model_configs(updated_at)'
  )
}

const enforceImageModelConfigsSchema = async (client: LibSqlClient): Promise<void> => {
  const columns = await getTableColumns(client, 'image_model_configs')
  if (columns.size > 0 && !columns.has('model_config')) {
    await client.execute('DROP INDEX IF EXISTS idx_image_model_configs_single_active')
    await client.execute('DROP INDEX IF EXISTS idx_image_model_configs_updated')
    await client.execute('DROP TABLE IF EXISTS image_model_configs')
  }
  await client.execute(`
    CREATE TABLE IF NOT EXISTS image_model_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_config TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_image_model_configs_single_active ON image_model_configs(active) WHERE active = 1'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_image_model_configs_updated ON image_model_configs(updated_at)'
  )
}

const enforceSessionsSchema = async (client: LibSqlClient): Promise<void> => {
  const columns = await getTableColumns(client, 'sessions')
  if (!columns.has('style_id')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN style_id TEXT')
  }
  if (!columns.has('reference_document_path')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN reference_document_path TEXT')
  }
  if (!columns.has('slide_size_id')) {
    await client.execute(
      "ALTER TABLE sessions ADD COLUMN slide_size_id TEXT NOT NULL DEFAULT 'wide-16-9'"
    )
  }
  if (!columns.has('slide_width')) {
    await client.execute(
      'ALTER TABLE sessions ADD COLUMN slide_width INTEGER NOT NULL DEFAULT 1600'
    )
  }
  if (!columns.has('slide_height')) {
    await client.execute(
      'ALTER TABLE sessions ADD COLUMN slide_height INTEGER NOT NULL DEFAULT 900'
    )
  }
  await client.execute({
    sql: `
      UPDATE sessions
      SET
        slide_size_id = 'wide-16-9',
        slide_width = 1600,
        slide_height = 900
      WHERE
        slide_size_id IS NULL
        OR TRIM(slide_size_id) = ''
        OR slide_width IS NULL
        OR slide_width <= 0
        OR slide_height IS NULL
        OR slide_height <= 0
    `,
    args: []
  })
  if (!columns.has('current_operation_id')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN current_operation_id TEXT')
  }
  if (!columns.has('current_commit')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN current_commit TEXT')
  }
  if (!columns.has('visual_enabled')) {
    await client.execute("ALTER TABLE sessions ADD COLUMN visual_enabled INTEGER NOT NULL DEFAULT 0")
  }
  if (!columns.has('image_model_config_id')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN image_model_config_id TEXT')
  }
  await client.execute(
    'UPDATE sessions SET visual_enabled = 0 WHERE visual_enabled IS NULL OR visual_enabled NOT IN (0, 1)'
  )
  await client.execute(
    'UPDATE sessions SET image_model_config_id = NULL WHERE visual_enabled = 0'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_sessions_image_model_config ON sessions(image_model_config_id)'
  )
}

const enforceProjectsSchema = async (client: LibSqlClient): Promise<void> => {
  const columns = await getTableColumns(client, 'projects')
  if (!columns.has('root_path')) {
    await client.execute('ALTER TABLE projects ADD COLUMN root_path TEXT')
  }
}

const hasSessionHtmlFiles = (dir: string): boolean => {
  try {
    if (!fsExistsSafe(path.join(dir, 'index.html'))) return false
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isFile() && /^page-\d+\.html?$/i.test(entry.name))
  } catch {
    return false
  }
}

const inferProjectRootPath = async (
  client: LibSqlClient,
  sessionId: string,
  outputPath: string,
  metadata: Record<string, unknown>,
  resolveStoragePath: () => Promise<string>
): Promise<string> => {
  const candidateDirs: string[] = []
  const addCandidate = (value: unknown): void => {
    if (typeof value !== 'string' || value.trim().length === 0) return
    const resolved = path.resolve(value.trim())
    if (!candidateDirs.includes(resolved)) candidateDirs.push(resolved)
  }

  if (typeof metadata.indexPath === 'string' && metadata.indexPath.trim().length > 0) {
    addCandidate(path.dirname(metadata.indexPath.trim()))
  }
  addCandidate(outputPath)

  const generatedPages = Array.isArray(metadata.generatedPages) ? metadata.generatedPages : []
  for (const page of generatedPages) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) continue
    const htmlPath = (page as Record<string, unknown>).htmlPath
    if (typeof htmlPath === 'string' && htmlPath.trim().length > 0) {
      addCandidate(path.dirname(htmlPath.trim()))
    }
  }

  const pageRows = await client
    .execute({
      sql: 'SELECT html_path FROM session_pages WHERE session_id = ?',
      args: [sessionId]
    })
    .catch(() => ({ rows: [] as unknown[] }))
  for (const row of pageRows.rows || []) {
    const htmlPath = getRowValue(row, 'html_path')
    if (typeof htmlPath === 'string' && fsExistsSafe(htmlPath)) {
      addCandidate(path.dirname(htmlPath))
    }
  }

  const storagePath = await resolveStoragePath().catch(() => '')
  addCandidate(path.join(storagePath || process.cwd(), sessionId))

  for (const dir of candidateDirs) {
    if (hasSessionHtmlFiles(dir)) return dir
  }
  for (const dir of candidateDirs) {
    if (fsExistsSafe(path.join(dir, '.git'))) return dir
  }
  return ''
}

const patchProjectRootPaths = async (args: {
  client: LibSqlClient
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, resolveStoragePath } = args
  const result = await client.execute(`
    SELECT projects.id AS project_id,
           projects.session_id AS session_id,
           projects.output_path AS output_path,
           sessions.metadata AS metadata
    FROM projects
    LEFT JOIN sessions ON sessions.id = projects.session_id
    WHERE projects.root_path IS NULL OR TRIM(projects.root_path) = ''
  `)

  for (const row of result.rows || []) {
    const projectId = String(getRowValue(row, 'project_id') || '')
    const sessionId = String(getRowValue(row, 'session_id') || '')
    const outputPath = String(getRowValue(row, 'output_path') || '')
    if (!projectId || !sessionId) continue
    const metadata = parseJsonObject(getRowValue(row, 'metadata'))
    const rootPath = await inferProjectRootPath(
      client,
      sessionId,
      outputPath,
      metadata,
      resolveStoragePath
    )
    if (!rootPath) continue
    await client.execute({
      sql: 'UPDATE projects SET root_path = ? WHERE id = ? AND (root_path IS NULL OR TRIM(root_path) = ?)',
      args: [rootPath, projectId, '']
    })
  }
}

const enforceSessionOperationsSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS session_operations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      scope TEXT,
      prompt TEXT,
      parent_operation_id TEXT,
      before_commit TEXT,
      after_commit TEXT,
      target_operation_id TEXT,
      target_commit TEXT,
      changed_files_json TEXT NOT NULL DEFAULT '[]',
      changed_pages_json TEXT NOT NULL DEFAULT '[]',
      tracked_files_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `)
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_operations_session_created ON session_operations(session_id, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_operations_session_status ON session_operations(session_id, status, created_at)'
  )
}

const enforceSessionOperationPagesSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS session_operation_pages (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL REFERENCES session_operations(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL,
      legacy_page_id TEXT,
      file_slug TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      html_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_operation_pages_order ON session_operation_pages(operation_id, page_number)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_operation_pages_session ON session_operation_pages(session_id, operation_id)'
  )
}

const enforceMessagesSchema = async (client: LibSqlClient): Promise<void> => {
  await client.executeMultiple(MESSAGES_TABLE_SQL)
  const columns = await getTableColumns(client, 'messages')
  if (!columns.has('chat_scope')) {
    await client.execute(`ALTER TABLE messages ADD COLUMN chat_scope TEXT NOT NULL DEFAULT 'main'`)
  }
  if (!columns.has('page_id')) {
    await client.execute('ALTER TABLE messages ADD COLUMN page_id TEXT')
  }
  if (!columns.has('selector')) {
    await client.execute('ALTER TABLE messages ADD COLUMN selector TEXT')
  }
  if (!columns.has('image_paths')) {
    await client.execute('ALTER TABLE messages ADD COLUMN image_paths TEXT')
  }
  if (!columns.has('video_paths')) {
    await client.execute('ALTER TABLE messages ADD COLUMN video_paths TEXT')
  }
  if (!columns.has('type')) {
    await client.execute('ALTER TABLE messages ADD COLUMN type TEXT')
  }
  if (!columns.has('tool_name')) {
    await client.execute('ALTER TABLE messages ADD COLUMN tool_name TEXT')
  }
  if (!columns.has('tool_call_id')) {
    await client.execute('ALTER TABLE messages ADD COLUMN tool_call_id TEXT')
  }
  if (!columns.has('token_count')) {
    await client.execute('ALTER TABLE messages ADD COLUMN token_count INTEGER')
  }
  if (!columns.has('run_model')) {
    await client.execute('ALTER TABLE messages ADD COLUMN run_model TEXT')
  }
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_messages_session_scope ON messages(session_id, chat_scope, page_id, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_messages_session_only ON messages(session_id)'
  )
}

const enforceGenerationSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS session_jobs (
      id TEXT PRIMARY KEY REFERENCES generation_runs(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      previous_session_status TEXT NOT NULL DEFAULT 'active',
      target_page_id TEXT,
      target_page_number INTEGER,
      selector TEXT,
      total_pages INTEGER,
      status TEXT NOT NULL,
      abort_reason TEXT,
      created_at INTEGER NOT NULL,
      activated_at INTEGER,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    )
  `)
  const runColumns = await getTableColumns(client, 'generation_runs')
  if (!runColumns.has('model_config_id')) {
    await client.execute('ALTER TABLE generation_runs ADD COLUMN model_config_id TEXT')
  }
  if (!runColumns.has('animation_preferences')) {
    await client.execute('ALTER TABLE generation_runs ADD COLUMN animation_preferences TEXT')
  }
  let legacyGenerationJobColumns = await getTableColumns(client, 'generation_jobs')
  if (legacyGenerationJobColumns.size > 0 && !legacyGenerationJobColumns.has('abort_reason')) {
    await client.execute('ALTER TABLE generation_jobs ADD COLUMN abort_reason TEXT')
  }
  if (legacyGenerationJobColumns.size > 0 && !legacyGenerationJobColumns.has('activated_at')) {
    await client.execute('ALTER TABLE generation_jobs ADD COLUMN activated_at INTEGER')
  }
  if (legacyGenerationJobColumns.size > 0 && !legacyGenerationJobColumns.has('finished_at')) {
    await client.execute('ALTER TABLE generation_jobs ADD COLUMN finished_at INTEGER')
  }
  if (legacyGenerationJobColumns.size > 0) {
    legacyGenerationJobColumns = await getTableColumns(client, 'generation_jobs')
  }
  const legacyPageEditJobColumns = await getTableColumns(client, 'page_edit_jobs')
  const legacyDeckEditJobColumns = await getTableColumns(client, 'deck_edit_jobs')
  // Keep every legacy table until every source has been copied. A failed migration can then
  // be retried on the next startup without losing the original job records.
  const migration = await client.transaction('write')
  const upsertSessionJob = `
    ON CONFLICT(id) DO UPDATE SET
      session_id = excluded.session_id,
      kind = excluded.kind,
      previous_session_status = excluded.previous_session_status,
      target_page_id = excluded.target_page_id,
      target_page_number = excluded.target_page_number,
      selector = excluded.selector,
      total_pages = excluded.total_pages,
      status = excluded.status,
      abort_reason = excluded.abort_reason,
      created_at = excluded.created_at,
      activated_at = excluded.activated_at,
      updated_at = excluded.updated_at,
      finished_at = excluded.finished_at
  `
  try {
    if (legacyGenerationJobColumns.size > 0) {
      const specializedJobGuards = [
        legacyPageEditJobColumns.size > 0
          ? 'NOT EXISTS (SELECT 1 FROM page_edit_jobs AS page_jobs WHERE page_jobs.id = jobs.id)'
          : '',
        legacyDeckEditJobColumns.size > 0
          ? 'NOT EXISTS (SELECT 1 FROM deck_edit_jobs AS deck_jobs WHERE deck_jobs.id = jobs.id)'
          : ''
      ].filter(Boolean)
      await migration.execute(`
      INSERT INTO session_jobs (
        id, session_id, kind, previous_session_status, target_page_id, target_page_number,
        selector, total_pages, status, abort_reason, created_at, activated_at, updated_at, finished_at
      )
      SELECT
        jobs.id,
        jobs.session_id,
        CASE jobs.kind
          WHEN 'template' THEN 'template'
          WHEN 'retry' THEN 'retry'
          WHEN 'edit' THEN 'deck-edit'
          ELSE 'standard'
        END,
        COALESCE(
          CASE
            WHEN runs.metadata IS NOT NULL AND json_valid(runs.metadata)
              THEN json_extract(runs.metadata, '$.previousSessionStatus')
          END,
          'active'
        ),
        NULL,
        NULL,
        NULL,
        runs.total_pages,
        jobs.status,
        jobs.abort_reason,
        jobs.created_at,
        jobs.activated_at,
        jobs.updated_at,
        jobs.finished_at
      FROM generation_jobs AS jobs
      LEFT JOIN generation_runs AS runs ON runs.id = jobs.id
      WHERE ${specializedJobGuards.join(' AND ') || '1'}
      ${upsertSessionJob}
    `)
    }
    if (legacyPageEditJobColumns.size > 0) {
      const deckJobGuard =
        legacyDeckEditJobColumns.size > 0
          ? 'WHERE NOT EXISTS (SELECT 1 FROM deck_edit_jobs AS deck_jobs WHERE deck_jobs.id = page_edit_jobs.id)'
          : 'WHERE 1'
      await migration.execute(`
      INSERT INTO session_jobs (
        id, session_id, kind, previous_session_status, target_page_id, target_page_number,
        selector, total_pages, status, abort_reason, created_at, activated_at, updated_at, finished_at
      )
      SELECT
        id,
        session_id,
        'page-edit',
        previous_session_status,
        target_page_id,
        target_page_number,
        selector,
        1,
        status,
        abort_reason,
        created_at,
        activated_at,
        updated_at,
        finished_at
      FROM page_edit_jobs
      ${deckJobGuard}
      ${upsertSessionJob}
    `)
    }
    if (legacyDeckEditJobColumns.size > 0) {
      await migration.execute(`
      INSERT INTO session_jobs (
        id, session_id, kind, previous_session_status, target_page_id, target_page_number,
        selector, total_pages, status, abort_reason, created_at, activated_at, updated_at, finished_at
      )
      SELECT
        id,
        session_id,
        'deck-edit',
        previous_session_status,
        NULL,
        NULL,
        NULL,
        total_pages,
        status,
        abort_reason,
        created_at,
        activated_at,
        updated_at,
        finished_at
      FROM deck_edit_jobs
      WHERE 1
      ${upsertSessionJob}
    `)
    }
    if (legacyGenerationJobColumns.size > 0) {
      await migration.execute('DROP TABLE generation_jobs')
    }
    if (legacyPageEditJobColumns.size > 0) {
      await migration.execute('DROP TABLE page_edit_jobs')
    }
    if (legacyDeckEditJobColumns.size > 0) {
      await migration.execute('DROP TABLE deck_edit_jobs')
    }
    await migration.commit()
  } catch (error) {
    try {
      await migration.rollback()
    } catch {
      // Preserve the migration error when a failed transaction has already closed itself.
    }
    throw error
  }
  const columns = await getTableColumns(client, 'generation_pages')
  if (!columns.has('content_outline')) {
    await client.execute('ALTER TABLE generation_pages ADD COLUMN content_outline TEXT')
  }
  if (!columns.has('layout_intent')) {
    await client.execute('ALTER TABLE generation_pages ADD COLUMN layout_intent TEXT')
  }
  if (!columns.has('layout_id')) {
    await client.execute('ALTER TABLE generation_pages ADD COLUMN layout_id TEXT')
  }
  if (!columns.has('layout_contract_version')) {
    await client.execute('ALTER TABLE generation_pages ADD COLUMN layout_contract_version INTEGER')
  }
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_generation_runs_session ON generation_runs(session_id, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_generation_runs_model_config ON generation_runs(model_config_id)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_jobs_session_status ON session_jobs(session_id, status, updated_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_jobs_status ON session_jobs(status, updated_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_generation_pages_run ON generation_pages(run_id, page_number)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_generation_pages_session_status ON generation_pages(session_id, status, page_number)'
  )
}

const enforceSessionPagesSchema = async (client: LibSqlClient): Promise<void> => {
  const columns = await getTableColumns(client, 'session_pages')
  if (!columns.has('legacy_page_id')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN legacy_page_id TEXT')
  }
  if (!columns.has('file_slug')) {
    await client.execute("ALTER TABLE session_pages ADD COLUMN file_slug TEXT NOT NULL DEFAULT ''")
  }
  if (!columns.has('status')) {
    await client.execute(
      "ALTER TABLE session_pages ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"
    )
  }
  if (!columns.has('error')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN error TEXT')
  }
  if (!columns.has('deleted_at')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN deleted_at INTEGER')
  }
  if (!columns.has('layout_intent')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN layout_intent TEXT')
  }
  if (!columns.has('layout_id')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN layout_id TEXT')
  }
  if (!columns.has('layout_contract_version')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN layout_contract_version INTEGER')
  }
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_pages_session_number ON session_pages(session_id, page_number)'
  )
}

const ensureDefaultSettings = async (client: LibSqlClient): Promise<void> => {
  const now = Math.floor(Date.now() / 1000)
  const defaults = [
    { key: 'theme', value: '"light"' },
    { key: 'locale', value: '"zh"' },
    { key: 'timeout_ms_planning', value: JSON.stringify(defaultModelTimeoutMs('planning')) },
    { key: 'timeout_ms_design', value: JSON.stringify(defaultModelTimeoutMs('design')) },
    { key: 'timeout_ms_agent', value: JSON.stringify(defaultModelTimeoutMs('agent')) },
    { key: 'timeout_ms_document', value: JSON.stringify(defaultModelTimeoutMs('document')) }
  ]

  for (const { key, value } of defaults) {
    await client.execute({
      sql: 'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      args: [key, value, now]
    })
  }
}

const resolveLegacyProjectDir = async (
  client: LibSqlClient,
  sessionId: string,
  metadata: Record<string, unknown>,
  resolveStoragePath: () => Promise<string>
): Promise<string> => {
  const projectResult = await client
    .execute({
      sql: 'SELECT root_path, output_path FROM projects WHERE session_id = ? LIMIT 1',
      args: [sessionId]
    })
    .catch(() => ({ rows: [] as unknown[] }))
  const rootPath = getRowValue(projectResult.rows?.[0], 'root_path')
  if (typeof rootPath === 'string' && rootPath.trim().length > 0) {
    return rootPath.trim()
  }
  const outputPath = getRowValue(projectResult.rows?.[0], 'output_path')
  const metadataProjectDir =
    typeof metadata.indexPath === 'string' && metadata.indexPath.trim().length > 0
      ? path.dirname(metadata.indexPath.trim())
      : ''
  if (
    metadataProjectDir &&
    fsExistsSafe(String(metadata.indexPath)) &&
    (!(typeof outputPath === 'string') ||
      outputPath.trim().length === 0 ||
      !fsExistsSafe(path.join(outputPath.trim(), 'index.html')))
  ) {
    return metadataProjectDir
  }
  if (typeof outputPath === 'string' && outputPath.trim().length > 0) {
    return outputPath.trim()
  }
  if (metadataProjectDir) return metadataProjectDir
  const storagePath = await resolveStoragePath().catch(() => '')
  return path.join(storagePath || process.cwd(), sessionId)
}

const upsertPatchedGenerationPage = async (
  db: DrizzleDb,
  data: {
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
  }
): Promise<void> => {
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
  await db
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

const patchGenerationRecordsFromMetadata = async (args: {
  client: LibSqlClient
  db: DrizzleDb
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, db, resolveStoragePath } = args
  const sessions = await client.execute(`
    SELECT id, page_count, status, metadata, updated_at
    FROM sessions
    WHERE metadata IS NOT NULL
      AND TRIM(metadata) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM generation_runs WHERE generation_runs.session_id = sessions.id
      )
    ORDER BY updated_at DESC
  `)

  for (const row of sessions.rows || []) {
    const sessionId = String(getRowValue(row, 'id') || '')
    if (!sessionId) continue
    const metadata = parseJsonObject(getRowValue(row, 'metadata'))
    const generatedPages = Array.isArray(metadata.generatedPages)
      ? metadata.generatedPages.filter(
          (page): page is Record<string, unknown> =>
            Boolean(page) && typeof page === 'object' && !Array.isArray(page)
        )
      : []
    const failedPages = Array.isArray(metadata.failedPages)
      ? metadata.failedPages.filter(
          (page): page is Record<string, unknown> =>
            Boolean(page) && typeof page === 'object' && !Array.isArray(page)
        )
      : []
    if (generatedPages.length === 0 && failedPages.length === 0) continue

    const projectDir = await resolveLegacyProjectDir(
      client,
      sessionId,
      metadata,
      resolveStoragePath
    )
    const pageMap = new Map<
      string,
      {
        pageId: string
        pageNumber: number
        title: string
        contentOutline: string
        layoutIntent: string | null
        htmlPath: string
        status: GenerationPageStatus
        error: string | null
        retryCount: number
      }
    >()

    generatedPages.forEach((page, index) => {
      const pageNumber = inferPageNumber(page, index + 1)
      const rawPageId =
        typeof (page.pageId ?? page.page_id) === 'string'
          ? String(page.pageId ?? page.page_id).trim()
          : ''
      const pageId = rawPageId || `page-${pageNumber}`
      pageMap.set(pageId, {
        pageId,
        pageNumber,
        title: String(page.title || `第 ${pageNumber} 页`),
        contentOutline: String(page.contentOutline ?? page.content_outline ?? ''),
        layoutIntent:
          typeof (page.layoutIntent ?? page.layout_intent) === 'string'
            ? String(page.layoutIntent ?? page.layout_intent)
            : null,
        htmlPath: resolveLegacyPagePath(page, projectDir, pageId),
        status: 'completed',
        error: null,
        retryCount: toPositiveInt(page.retryCount ?? page.retry_count, 0)
      })
    })

    failedPages.forEach((page, index) => {
      const pageNumber = inferPageNumber(page, generatedPages.length + index + 1)
      const rawPageId =
        typeof (page.pageId ?? page.page_id) === 'string'
          ? String(page.pageId ?? page.page_id).trim()
          : ''
      const pageId = rawPageId || `page-${pageNumber}`
      pageMap.set(pageId, {
        pageId,
        pageNumber,
        title: String(page.title || `第 ${pageNumber} 页`),
        contentOutline: String(page.contentOutline ?? page.content_outline ?? ''),
        layoutIntent:
          typeof (page.layoutIntent ?? page.layout_intent) === 'string'
            ? String(page.layoutIntent ?? page.layout_intent)
            : null,
        htmlPath: resolveLegacyPagePath(page, projectDir, pageId),
        status: 'failed',
        error: String(page.reason || page.error || '旧 metadata 记录的失败页'),
        retryCount: toPositiveInt(page.retryCount ?? page.retry_count, 0)
      })
    })

    const pages = Array.from(pageMap.values()).sort((a, b) => a.pageNumber - b.pageNumber)
    if (pages.length === 0) continue

    const generatedCount = pages.filter((page) => page.status === 'completed').length
    const failedCount = pages.filter((page) => page.status === 'failed').length
    const totalPages = Math.max(toPositiveInt(getRowValue(row, 'page_count'), 0), pages.length)
    const runStatus: GenerationRunStatus =
      failedCount > 0 ? (generatedCount > 0 ? 'partial' : 'failed') : 'completed'
    const runId = `patch-${sessionId}`
    const updatedAt = toPositiveInt(getRowValue(row, 'updated_at'), Math.floor(Date.now() / 1000))

    await db
      .insert(schema.generationRuns)
      .values({
        id: runId,
        sessionId,
        mode: 'generate',
        status: runStatus,
        totalPages,
        error: failedCount > 0 ? `${failedCount} page(s) failed in legacy metadata` : null,
        metadata: JSON.stringify({
          source: 'metadata_patch',
          generatedCount,
          failedCount,
          patchedAt: new Date().toISOString()
        }),
        createdAt: updatedAt,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .onConflictDoNothing()
      .run()

    for (const page of pages) {
      await upsertPatchedGenerationPage(db, {
        runId,
        sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent,
        htmlPath: page.htmlPath,
        status: page.status,
        error: page.error,
        retryCount: page.retryCount
      })
    }
  }
}

const patchSessionPagesFromLegacy = async (args: {
  client: LibSqlClient
  db: DrizzleDb
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, db, resolveStoragePath } = args
  const sessions = await client.execute(`
    SELECT id, metadata, updated_at
    FROM sessions
    WHERE metadata IS NOT NULL
      AND TRIM(metadata) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM session_pages WHERE session_pages.session_id = sessions.id
      )
    ORDER BY updated_at DESC
  `)

  for (const row of sessions.rows || []) {
    const sessionId = String(getRowValue(row, 'id') || '')
    if (!sessionId) continue
    const metadata = parseJsonObject(getRowValue(row, 'metadata'))
    const generatedPages = Array.isArray(metadata.generatedPages)
      ? metadata.generatedPages.filter(
          (page): page is Record<string, unknown> =>
            Boolean(page) && typeof page === 'object' && !Array.isArray(page)
        )
      : []
    const failedPages = Array.isArray(metadata.failedPages)
      ? metadata.failedPages.filter(
          (page): page is Record<string, unknown> =>
            Boolean(page) && typeof page === 'object' && !Array.isArray(page)
        )
      : []
    if (generatedPages.length === 0 && failedPages.length === 0) continue

    const pageMap = new Map<
      string,
      {
        pageNumber: number
        fileSlug: string
        title: string
        htmlPath: string
        status: 'completed' | 'failed'
        error: string | null
      }
    >()
    const failedById = new Map<string, string>()
    for (const failed of failedPages) {
      const pageNumber = inferPageNumber(failed, generatedPages.length + failedById.size + 1)
      const failedPageId =
        typeof (failed.pageId ?? failed.page_id) === 'string'
          ? String(failed.pageId ?? failed.page_id).trim()
          : ''
      const fileSlug = failedPageId || `page-${pageNumber}`
      failedById.set(fileSlug, String(failed.reason || failed.error || '页面生成失败'))
      pageMap.set(fileSlug, {
        pageNumber,
        fileSlug,
        title: String(failed.title || `第 ${pageNumber} 页`),
        htmlPath: '',
        status: 'failed',
        error: String(failed.reason || failed.error || '页面生成失败')
      })
    }

    const projectDir = await resolveLegacyProjectDir(
      client,
      sessionId,
      metadata,
      resolveStoragePath
    )
    const now = Math.floor(Date.now() / 1000)

    for (let index = 0; index < generatedPages.length; index += 1) {
      const page = generatedPages[index]
      const pageNumber = inferPageNumber(page, index + 1)
      const rawPageId =
        typeof (page.pageId ?? page.page_id) === 'string'
          ? String(page.pageId ?? page.page_id).trim()
          : ''
      const fileSlug = rawPageId || `page-${pageNumber}`
      const htmlPath = resolveLegacyPagePath(page, projectDir, fileSlug)
      const title = String(page.title || `第 ${pageNumber} 页`)
      const failedReason = failedById.get(fileSlug)
      const status = failedReason
        ? ('failed' as const)
        : fsExistsSafe(htmlPath)
          ? ('completed' as const)
          : ('failed' as const)
      const error = failedReason || (status === 'failed' ? '页面文件不存在' : null)
      pageMap.set(fileSlug, {
        pageNumber,
        fileSlug,
        title,
        htmlPath,
        status,
        error
      })
    }

    for (const page of pageMap.values()) {
      if (!page.htmlPath) {
        page.htmlPath = path.join(projectDir, `${page.fileSlug}.html`)
      }
      await db
        .insert(schema.sessionPages)
        .values({
          id: nanoid(),
          sessionId,
          legacyPageId: /^page-\d+$/i.test(page.fileSlug) ? page.fileSlug : null,
          fileSlug: page.fileSlug,
          pageNumber: page.pageNumber,
          title: page.title,
          htmlPath: page.htmlPath,
          status: page.status,
          error: page.error,
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        })
        .onConflictDoNothing()
        .run()
    }
  }
}

const patchSessionPagesFromGenerationPages = async (args: {
  client: LibSqlClient
  db: DrizzleDb
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, db, resolveStoragePath } = args
  const rows = await client.execute(`
    SELECT
      sessions.id AS session_id,
      sessions.metadata AS metadata,
      sessions.updated_at AS session_updated_at,
      generation_pages.page_id AS page_id,
      generation_pages.page_number AS page_number,
      generation_pages.title AS title,
      generation_pages.html_path AS html_path,
      generation_pages.status AS status,
      generation_pages.error AS error,
      generation_pages.created_at AS created_at,
      generation_pages.updated_at AS updated_at
    FROM sessions
    INNER JOIN generation_pages ON generation_pages.session_id = sessions.id
    WHERE NOT EXISTS (
      SELECT 1 FROM session_pages WHERE session_pages.session_id = sessions.id
    )
    ORDER BY sessions.updated_at DESC, generation_pages.page_number ASC, generation_pages.updated_at DESC
  `)

  const bySession = new Map<string, unknown[]>()
  for (const row of rows.rows || []) {
    const sessionId = String(getRowValue(row, 'session_id') || '')
    if (!sessionId) continue
    const list = bySession.get(sessionId) || []
    list.push(row)
    bySession.set(sessionId, list)
  }

  for (const [sessionId, sessionRows] of bySession.entries()) {
    const firstRow = sessionRows[0]
    const metadata = parseJsonObject(getRowValue(firstRow, 'metadata'))
    const projectDir = await resolveLegacyProjectDir(
      client,
      sessionId,
      metadata,
      resolveStoragePath
    )
    const latestBySlug = new Map<string, Record<string, unknown>>()
    for (const row of sessionRows) {
      const pageId = String(getRowValue(row, 'page_id') || '').trim()
      if (!pageId || latestBySlug.has(pageId)) continue
      latestBySlug.set(pageId, row as Record<string, unknown>)
    }

    const now = Math.floor(Date.now() / 1000)
    const pages = Array.from(latestBySlug.values()).sort((a, b) => {
      const aNumber = toPositiveInt(getRowValue(a, 'page_number'), 0)
      const bNumber = toPositiveInt(getRowValue(b, 'page_number'), 0)
      return aNumber - bNumber
    })

    for (let index = 0; index < pages.length; index += 1) {
      const row = pages[index]
      const fileSlug = String(getRowValue(row, 'page_id') || `page-${index + 1}`).trim()
      const pageNumber = toPositiveInt(getRowValue(row, 'page_number'), index + 1)
      const rawHtmlPath = String(getRowValue(row, 'html_path') || '').trim()
      const htmlPath = rawHtmlPath
        ? path.isAbsolute(rawHtmlPath)
          ? rawHtmlPath
          : path.join(projectDir, rawHtmlPath)
        : path.join(projectDir, `${fileSlug}.html`)
      const rawStatus = String(getRowValue(row, 'status') || '').trim()
      const status =
        rawStatus === 'completed' && fsExistsSafe(htmlPath)
          ? ('completed' as const)
          : ('failed' as const)
      const error =
        status === 'failed'
          ? String(
              getRowValue(row, 'error') ||
                (fsExistsSafe(htmlPath) ? '页面生成失败' : '页面文件不存在')
            )
          : null

      await db
        .insert(schema.sessionPages)
        .values({
          id: nanoid(),
          sessionId,
          legacyPageId: /^page-\d+$/i.test(fileSlug) ? fileSlug : null,
          fileSlug,
          pageNumber,
          title: String(getRowValue(row, 'title') || `第 ${pageNumber} 页`),
          htmlPath,
          status,
          error,
          createdAt: toPositiveInt(getRowValue(row, 'created_at'), now),
          updatedAt: now,
          deletedAt: null
        })
        .onConflictDoNothing()
        .run()
    }
  }
}

const fsExistsSafe = (filePath: string): boolean => {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

const HTML_EDITOR_DOCS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS html_edit_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  source_path TEXT,
  html_path TEXT NOT NULL,
  design_width INTEGER NOT NULL DEFAULT 1280,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const HTML_EDITOR_MESSAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS html_edit_messages (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES html_edit_documents(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  intent TEXT,
  plan_json TEXT,
  requires_confirmation INTEGER NOT NULL DEFAULT 0,
  selected_selector TEXT,
  selected_label TEXT,
  selected_element_tag TEXT,
  selected_element_text TEXT,
  created_at INTEGER NOT NULL
);
`

const HTML_EDITOR_VERSIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS html_edit_versions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES html_edit_documents(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`

const enforceHtmlEditorSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(HTML_EDITOR_DOCS_TABLE_SQL)
  await client.execute(HTML_EDITOR_MESSAGES_TABLE_SQL)
  await client.execute(HTML_EDITOR_VERSIONS_TABLE_SQL)
  const messageColumns = await getTableColumns(client, 'html_edit_messages')
  if (!messageColumns.has('selected_selector')) {
    await client.execute('ALTER TABLE html_edit_messages ADD COLUMN selected_selector TEXT')
  }
  if (!messageColumns.has('selected_label')) {
    await client.execute('ALTER TABLE html_edit_messages ADD COLUMN selected_label TEXT')
  }
  if (!messageColumns.has('selected_element_tag')) {
    await client.execute('ALTER TABLE html_edit_messages ADD COLUMN selected_element_tag TEXT')
  }
  if (!messageColumns.has('selected_element_text')) {
    await client.execute('ALTER TABLE html_edit_messages ADD COLUMN selected_element_text TEXT')
  }
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_html_edit_messages_doc ON html_edit_messages(doc_id, created_at);'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_html_edit_versions_doc ON html_edit_versions(doc_id, created_at);'
  )
}

const enforceImageFulfillmentSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS image_fulfillment_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      session_page_id TEXT NOT NULL REFERENCES session_pages(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL,
      layout_id TEXT,
      layout_contract_version INTEGER,
      image_model_config_id TEXT REFERENCES image_model_configs(id) ON DELETE SET NULL,
      image_provider TEXT,
      image_model TEXT,
      attempt INTEGER NOT NULL,
      retry_of_job_id TEXT REFERENCES image_fulfillment_jobs(id) ON DELETE SET NULL,
      idempotency_key TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      cancel_requested_at INTEGER,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      finalization_manifest_path TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    )
  `)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS image_fulfillment_intents (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES image_fulfillment_jobs(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL,
      layout_slot_id TEXT NOT NULL,
      role TEXT NOT NULL,
      layer TEXT NOT NULL,
      request_version INTEGER NOT NULL DEFAULT 1,
      size_hint TEXT,
      subject TEXT NOT NULL,
      text_zone TEXT,
      subject_zone TEXT,
      negative_space TEXT,
      avoid_json TEXT,
      request_json TEXT NOT NULL,
      image_history_id TEXT,
      asset_path TEXT,
      width INTEGER,
      height INTEGER,
      mime_type TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      retry_of_intent_id TEXT REFERENCES image_fulfillment_intents(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS image_fulfillment_run_page_attempt_unique ON image_fulfillment_jobs(run_id, session_page_id, attempt)'
  )
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS image_fulfillment_idempotency_unique ON image_fulfillment_jobs(session_id, idempotency_key)'
  )
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_image_fulfillment_one_active_page ON image_fulfillment_jobs(session_id, session_page_id) WHERE status IN ('pending', 'running', 'finalizing')"
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_image_fulfillment_jobs_session_page_status ON image_fulfillment_jobs(session_id, session_page_id, status, updated_at)'
  )
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS image_fulfillment_intent_slot_unique ON image_fulfillment_intents(job_id, slot_id)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_image_fulfillment_intents_job_status ON image_fulfillment_intents(job_id, status, updated_at)'
  )
}

export const runDatabasePatches = async (args: {
  client: LibSqlClient
  db: DrizzleDb
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, db, resolveStoragePath } = args
  await client.executeMultiple(INIT_SQL)
  await enforceSessionsSchema(client)
  await enforceProjectsSchema(client)
  await enforceSettingsSchema(client)
  await enforceModelConfigsSchema(client)
  await enforceImageModelConfigsSchema(client)
  await enforceMessagesSchema(client)
  await client.executeMultiple(MODEL_USAGE_TABLE_SQL)
  await enforceGenerationSchema(client)
  await enforceSessionPagesSchema(client)
  await enforceImageFulfillmentSchema(client)
  await enforceSessionOperationsSchema(client)
  await enforceSessionOperationPagesSchema(client)
  await enforceHtmlEditorSchema(client)
  await patchStylesColumns(client)
  await client.execute('PRAGMA foreign_keys = ON;')
  await ensureDefaultSettings(client)
  await patchProjectRootPaths({ client, resolveStoragePath })
  await patchDesignContractFonts(client)
  await patchSourcePageSkeletonAgendaItems(client)
  await patchGenerationRecordsFromMetadata({ client, db, resolveStoragePath })
  await patchSessionPagesFromLegacy({ client, db, resolveStoragePath })
  await patchSessionPagesFromGenerationPages({ client, db, resolveStoragePath })
  await patchModelConfigMaxTokens(client)
  await patchModelConfigDisableTemperature(client)
  await patchModelConfigThinkingParameterMode(client)
}
