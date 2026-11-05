import { z } from 'zod'
import {
  DEFAULT_SLIDE_SIZE_ID,
  SLIDE_SIZE_PRESETS,
  resolveSlideSize,
  type SlideSizePreset,
  type SlideSizePresetId
} from './slide-size'
import { ANIMATION_PREFERENCE_ID_LIST } from './generation'

export const EXTERNAL_AGENT_PROTOCOL_VERSION = '2026-09-04'
export const COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS = [
  EXTERNAL_AGENT_PROTOCOL_VERSION,
  '2026-08-15'
] as const
export const EXTERNAL_AGENT_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000

export type ExternalAgentConfirmationKind = 'delete_page' | 'delete_session' | 'overwrite_export'

export interface ExternalAgentConfirmationPrompt {
  operationId: string
  agentId: string
  agentName: string
  kind: ExternalAgentConfirmationKind
  sessionId?: string
  sessionTitle?: string
  pageId?: string
  pageTitle?: string
  pageNumber?: number
  outputPath?: string
  irreversible: boolean
}

export type ExternalAgentProtocolVersion =
  (typeof COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS)[number]

export const EXTERNAL_AGENT_CAPABILITIES = [
  'read',
  'create_session',
  'generation',
  'page_edit',
  'deck_edit',
  'import_pptx',
  'import_assets',
  'export_pptx',
  'task_control',
  'delete_page',
  'delete_session'
] as const

export type ExternalAgentCapability = (typeof EXTERNAL_AGENT_CAPABILITIES)[number]

export const EXTERNAL_AGENT_DEFAULT_CAPABILITIES: readonly ExternalAgentCapability[] = [
  'read',
  'create_session',
  'generation',
  'page_edit',
  'deck_edit',
  'import_pptx',
  'import_assets',
  'export_pptx',
  'task_control'
] as const

export const EXTERNAL_AGENT_HIGH_RISK_CAPABILITIES: readonly ExternalAgentCapability[] = [
  'delete_page',
  'delete_session'
] as const

export const EXTERNAL_AGENT_TOOL_NAMES = [
  'get_capabilities',
  'list_sessions',
  'get_session',
  'get_page',
  'create_session',
  'start_generation',
  'edit_page',
  'edit_deck',
  'import_pptx',
  'import_assets',
  'export_pptx',
  'get_operation',
  'get_operation_events',
  'subscribe_events',
  'cancel_operation',
  'resume_operation',
  'delete_page',
  'delete_session'
] as const

export type ExternalAgentToolName = (typeof EXTERNAL_AGENT_TOOL_NAMES)[number]

export const EXTERNAL_AGENT_ERROR_CODES = [
  'APP_NOT_RUNNING',
  'BROKER_UNAVAILABLE',
  'AUTH_REQUIRED',
  'AUTH_REVOKED',
  'NOT_AUTHORIZED',
  'SESSION_NOT_GRANTED',
  'WORKSPACE_NOT_GRANTED',
  'SESSION_NOT_FOUND',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'PATH_OUTSIDE_AUTHORIZED_ROOT',
  'SYMLINK_ESCAPE',
  'FILE_TYPE_UNSUPPORTED',
  'FILE_TOO_LARGE',
  'EXPORT_TARGET_EXISTS',
  'CONFIRMATION_EXPIRED',
  'CONFIRMATION_REJECTED',
  'OPERATION_NOT_FOUND',
  'OPERATION_NOT_RESUMABLE',
  'OPERATION_REVOKED',
  'PRODUCT_SKILLS_NOT_READY',
  'ACTIVE_MODEL_NOT_CONFIGURED',
  'SHUTTING_DOWN',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR'
] as const

export type ExternalAgentErrorCode = (typeof EXTERNAL_AGENT_ERROR_CODES)[number]

export const RETRYABLE_ERROR_CODES: readonly ExternalAgentErrorCode[] = [
  'APP_NOT_RUNNING',
  'BROKER_UNAVAILABLE',
  'PRODUCT_SKILLS_NOT_READY',
  'SHUTTING_DOWN'
] as const

export const EXTERNAL_AGENT_OPERATION_STATUSES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
  'awaiting_confirmation',
  'rejected',
  'expired',
  'revoked'
] as const

export type ExternalAgentOperationStatus = (typeof EXTERNAL_AGENT_OPERATION_STATUSES)[number]

export const EXTERNAL_AGENT_EVENT_TYPES = [
  'queued',
  'started',
  'progress',
  'page_started',
  'page_completed',
  'warning',
  'confirmation_required',
  'completed',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
  'revoked'
] as const

export type ExternalAgentEventType = (typeof EXTERNAL_AGENT_EVENT_TYPES)[number]

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type ExternalAgentJsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: ExternalAgentJsonValue }
  | ExternalAgentJsonValue[]

export const externalAgentJsonValueSchema: z.ZodType<ExternalAgentJsonValue> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(externalAgentJsonValueSchema),
    z.record(z.string(), externalAgentJsonValueSchema)
  ])
)

const safeScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type ExternalAgentSafeDetails = Record<
  string,
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | Record<string, string | number | boolean | null>
>

export const externalAgentSafeDetailsSchema: z.ZodType<ExternalAgentSafeDetails> = z.record(
  z.string(),
  z.union([safeScalarSchema, z.array(safeScalarSchema), z.record(z.string(), safeScalarSchema)])
)

const nonNegativeIntegerSchema = z.number().int().min(0)
const positiveIntegerSchema = z.number().int().min(1)
const trimmedIdSchema = z.string().trim().min(1).max(128)
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, 'idempotencyKey 仅允许英文字母、数字、冒号、下划线与连字符')

export const externalAgentErrorPayloadSchema = z.strictObject({
  code: z.enum(EXTERNAL_AGENT_ERROR_CODES),
  message: z.string().min(1).max(1_000),
  retryable: z.boolean(),
  details: externalAgentSafeDetailsSchema.optional()
})
export type ExternalAgentErrorPayload = z.infer<typeof externalAgentErrorPayloadSchema>

export const externalAgentFailureResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: externalAgentErrorPayloadSchema,
  operationId: trimmedIdSchema.optional()
})
export type ExternalAgentFailureResponse = z.infer<typeof externalAgentFailureResponseSchema>

export const externalAgentSuccessResponseSchema = <T extends z.ZodTypeAny>(
  dataSchema: T
): z.ZodObject<{
  ok: z.ZodLiteral<true>
  data: T
  operationId: z.ZodOptional<typeof trimmedIdSchema>
}> =>
  z.strictObject({
    ok: z.literal(true),
    data: dataSchema,
    operationId: trimmedIdSchema.optional()
  })

export const clientInfoSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  version: z.string().trim().min(1).max(50),
  executablePath: z.string().trim().max(1_000).optional()
})
export type ClientInfo = z.infer<typeof clientInfoSchema>

export const initializeInputSchema = z.strictObject({
  protocolVersion: z.string().trim().min(1).max(50),
  clientInfo: clientInfoSchema
})
export type InitializeInput = z.infer<typeof initializeInputSchema>

export const initializeOutputSchema = z.strictObject({
  protocolVersion: z.string().trim().min(1).max(50),
  supportedProtocolVersions: z.array(z.string().min(1).max(50)).min(1),
  serverInfo: z.strictObject({
    name: z.literal('oh-my-ppt'),
    version: z.string().trim().min(1).max(50)
  }),
  authenticated: z.boolean(),
  agentId: trimmedIdSchema.optional()
})
export type InitializeOutput = z.infer<typeof initializeOutputSchema>

export const externalAgentStyleSummarySchema = z.strictObject({
  id: trimmedIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  category: z.string().trim().max(60).default('default'),
  version: z.string().trim().max(50).default('1.0.0')
})
export type ExternalAgentStyleSummary = z.infer<typeof externalAgentStyleSummarySchema>

export const externalAgentCapabilitiesOutputSchema = z.strictObject({
  protocolVersion: z.string().trim().min(1).max(50),
  supportedProtocolVersions: z.array(z.string().min(1).max(50)).min(1),
  supportedTools: z.array(z.enum(EXTERNAL_AGENT_TOOL_NAMES)).min(1),
  supportedSlideSizes: z
    .array(
      z.strictObject({
        id: z.string().trim().min(1).max(50),
        label: z.string().trim().min(1).max(80),
        width: positiveIntegerSchema,
        height: positiveIntegerSchema
      })
    )
    .min(1),
  availableStyles: z.array(externalAgentStyleSummarySchema),
  animationPreferenceIds: z.array(z.enum(ANIMATION_PREFERENCE_ID_LIST)).min(1),
  limits: z.strictObject({
    maxPptxImportSizeBytes: positiveIntegerSchema,
    maxAssetImportSizeBytes: positiveIntegerSchema,
    supportedAssetExtensions: z.strictObject({
      images: z.array(z.string().min(1)).min(1),
      videos: z.array(z.string().min(1)).min(1),
      documents: z.array(z.string().min(1)).min(1)
    }),
    confirmationTimeoutMs: positiveIntegerSchema
  })
})
export type ExternalAgentCapabilitiesOutput = z.infer<typeof externalAgentCapabilitiesOutputSchema>

export const relativeAssetRefSchema = z.strictObject({
  kind: z.enum(['image', 'video', 'document']),
  relativePath: z
    .string()
    .trim()
    .regex(/^\.\/(images|videos|docs)\/[A-Za-z0-9._/-]+$/, '素材引用仅允许受控相对路径'),
  mediaType: z.string().trim().min(1).max(100).optional(),
  label: z.string().trim().max(120).optional()
})
export type RelativeAssetRef = z.infer<typeof relativeAssetRefSchema>

export const externalAgentPageSnapshotSchema = z.strictObject({
  pageId: trimmedIdSchema,
  pageNumber: positiveIntegerSchema,
  title: z.string().trim().min(1).max(200),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  contentOutline: z.string().trim().max(4_000).nullable(),
  layoutIntent: z.string().trim().max(200).nullable(),
  assets: z.array(relativeAssetRefSchema).default([])
})
export type ExternalAgentPageSnapshot = z.infer<typeof externalAgentPageSnapshotSchema>

export const externalAgentSessionSnapshotSchema = z.strictObject({
  id: trimmedIdSchema,
  title: z.string().trim().min(1).max(200),
  topic: z.string().trim().max(500).nullable(),
  status: z.enum(['active', 'completed', 'failed', 'archived']),
  pageCount: nonNegativeIntegerSchema,
  slideSize: z.strictObject({
    id: z.string().trim().min(1).max(50),
    label: z.string().trim().min(1).max(80),
    width: positiveIntegerSchema,
    height: positiveIntegerSchema
  }),
  style: z
    .strictObject({
      id: trimmedIdSchema,
      name: z.string().trim().max(120).optional(),
      version: z.string().trim().max(50).optional()
    })
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  pages: z.array(externalAgentPageSnapshotSchema).default([])
})
export type ExternalAgentSessionSnapshot = z.infer<typeof externalAgentSessionSnapshotSchema>

export const listSessionsInputSchema = z
  .strictObject({
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().trim().max(128).optional()
  })
  .default({ limit: 30 })
export type ListSessionsInput = z.infer<typeof listSessionsInputSchema>

export const listSessionsOutputSchema = z.strictObject({
  sessions: z.array(
    externalAgentSessionSnapshotSchema.omit({ pages: true }).extend({
      firstPageTitle: z.string().trim().max(200).optional()
    })
  ),
  nextCursor: z.string().trim().max(128).optional()
})
export type ListSessionsOutput = z.infer<typeof listSessionsOutputSchema>

export const getSessionInputSchema = z.strictObject({
  sessionId: trimmedIdSchema
})
export type GetSessionInput = z.infer<typeof getSessionInputSchema>

export const getPageInputSchema = z.strictObject({
  sessionId: trimmedIdSchema,
  pageId: trimmedIdSchema
})
export type GetPageInput = z.infer<typeof getPageInputSchema>

export const createSessionInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  title: z.string().trim().min(1).max(200),
  topic: z.string().trim().max(500).optional(),
  styleId: trimmedIdSchema.optional(),
  slideSizeId: z.string().trim().min(1).max(50).optional(),
  pageCount: z.number().int().min(1).max(30).optional(),
  workspaceRootPath: z.string().trim().min(1).max(1_000).optional()
})
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>

export const startGenerationInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  sessionId: trimmedIdSchema,
  topic: z.string().trim().min(1).max(500),
  prompt: z.string().trim().max(4_000).optional(),
  pageCount: z.number().int().min(1).max(30).optional(),
  styleId: trimmedIdSchema.optional(),
  slideSizeId: z.string().trim().min(1).max(50).optional(),
  reusedAssetPaths: z.array(relativeAssetRefSchema.shape.relativePath).max(50).optional(),
  animationPreferences: z
    .union([
      z.strictObject({
        ids: z.array(z.enum(ANIMATION_PREFERENCE_ID_LIST)).min(1).max(3)
      }),
      z.array(z.enum(ANIMATION_PREFERENCE_ID_LIST)).min(1).max(3)
    ])
    .optional()
})
export type StartGenerationInput = z.infer<typeof startGenerationInputSchema>

export const editPageInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  sessionId: trimmedIdSchema,
  pageId: trimmedIdSchema,
  instruction: z.string().trim().min(1).max(2_000),
  targetSelector: z.string().trim().max(500).optional(),
  reusedAssetPaths: z.array(relativeAssetRefSchema.shape.relativePath).max(20).optional()
})
export type EditPageInput = z.infer<typeof editPageInputSchema>

export const editDeckInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  sessionId: trimmedIdSchema,
  instruction: z.string().trim().min(1).max(3_000),
  scope: z.enum(['deck', 'presentation-container']).default('deck'),
  reusedAssetPaths: z.array(relativeAssetRefSchema.shape.relativePath).max(50).optional()
})
export type EditDeckInput = z.infer<typeof editDeckInputSchema>

export const importPptxInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  sourcePath: z.string().trim().min(1).max(1_000),
  title: z.string().trim().max(200).optional(),
  styleId: trimmedIdSchema.optional(),
  slideSizeId: z.string().trim().min(1).max(50).optional()
})
export type ImportPptxInput = z.infer<typeof importPptxInputSchema>

export const importAssetsInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  sessionId: trimmedIdSchema,
  sources: z
    .array(
      z.strictObject({
        sourcePath: z.string().trim().min(1).max(1_000),
        kind: z.enum(['image', 'video', 'document']).optional(),
        label: z.string().trim().max(120).optional()
      })
    )
    .min(1)
    .max(50)
})
export type ImportAssetsInput = z.infer<typeof importAssetsInputSchema>

export const exportPptxInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  sessionId: trimmedIdSchema,
  outputPath: z.string().trim().min(1).max(1_000),
  overwrite: z.boolean().default(false)
})
export type ExportPptxInput = z.infer<typeof exportPptxInputSchema>

export const getOperationInputSchema = z.strictObject({
  operationId: trimmedIdSchema
})
export type GetOperationInput = z.infer<typeof getOperationInputSchema>

export const getOperationEventsInputSchema = z.strictObject({
  operationId: trimmedIdSchema,
  afterSequence: nonNegativeIntegerSchema.default(0),
  limit: z.number().int().min(1).max(200).default(50)
})
export type GetOperationEventsInput = z.infer<typeof getOperationEventsInputSchema>

export const subscribeEventsInputSchema = z.strictObject({
  operationId: trimmedIdSchema,
  afterSequence: nonNegativeIntegerSchema.default(0)
})
export type SubscribeEventsInput = z.infer<typeof subscribeEventsInputSchema>

export const cancelOperationInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  operationId: trimmedIdSchema,
  reason: z.string().trim().max(500).optional()
})
export type CancelOperationInput = z.infer<typeof cancelOperationInputSchema>

export const resumeOperationInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  operationId: trimmedIdSchema
})
export type ResumeOperationInput = z.infer<typeof resumeOperationInputSchema>

export const deletePageInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  sessionId: trimmedIdSchema,
  pageId: trimmedIdSchema,
  reason: z.string().trim().max(500).optional()
})
export type DeletePageInput = z.infer<typeof deletePageInputSchema>

export const deleteSessionInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  sessionId: trimmedIdSchema,
  reason: z.string().trim().max(500).optional()
})
export type DeleteSessionInput = z.infer<typeof deleteSessionInputSchema>

export const externalAgentOperationSummarySchema = z.strictObject({
  operationId: trimmedIdSchema,
  agentId: trimmedIdSchema,
  sessionId: trimmedIdSchema.optional(),
  toolName: z.enum(EXTERNAL_AGENT_TOOL_NAMES),
  status: z.enum(EXTERNAL_AGENT_OPERATION_STATUSES),
  progress: z.number().min(0).max(100),
  checkpoint: z.string().trim().max(500).optional(),
  resultRef: z.string().trim().max(200).optional(),
  errorCode: z.enum(EXTERNAL_AGENT_ERROR_CODES).optional(),
  resumable: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})
export type ExternalAgentOperationSummary = z.infer<typeof externalAgentOperationSummarySchema>

export const externalAgentEventSchema = z.strictObject({
  operationId: trimmedIdSchema,
  sequence: positiveIntegerSchema,
  type: z.enum(EXTERNAL_AGENT_EVENT_TYPES),
  occurredAt: z.string().datetime(),
  payload: externalAgentSafeDetailsSchema
})
export type ExternalAgentEvent = z.infer<typeof externalAgentEventSchema>

export const externalAgentBrokerRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('initialize'),
    input: initializeInputSchema
  }),
  z.strictObject({
    type: z.literal('get_capabilities'),
    input: z.strictObject({}).default({})
  }),
  z.strictObject({
    type: z.literal('list_sessions'),
    input: listSessionsInputSchema
  }),
  z.strictObject({
    type: z.literal('get_session'),
    input: getSessionInputSchema
  }),
  z.strictObject({
    type: z.literal('get_page'),
    input: getPageInputSchema
  }),
  z.strictObject({
    type: z.literal('create_session'),
    input: createSessionInputSchema
  }),
  z.strictObject({
    type: z.literal('start_generation'),
    input: startGenerationInputSchema
  }),
  z.strictObject({
    type: z.literal('edit_page'),
    input: editPageInputSchema
  }),
  z.strictObject({
    type: z.literal('edit_deck'),
    input: editDeckInputSchema
  }),
  z.strictObject({
    type: z.literal('import_pptx'),
    input: importPptxInputSchema
  }),
  z.strictObject({
    type: z.literal('import_assets'),
    input: importAssetsInputSchema
  }),
  z.strictObject({
    type: z.literal('export_pptx'),
    input: exportPptxInputSchema
  }),
  z.strictObject({
    type: z.literal('get_operation'),
    input: getOperationInputSchema
  }),
  z.strictObject({
    type: z.literal('get_operation_events'),
    input: getOperationEventsInputSchema
  }),
  z.strictObject({
    type: z.literal('subscribe_events'),
    input: subscribeEventsInputSchema
  }),
  z.strictObject({
    type: z.literal('cancel_operation'),
    input: cancelOperationInputSchema
  }),
  z.strictObject({
    type: z.literal('resume_operation'),
    input: resumeOperationInputSchema
  }),
  z.strictObject({
    type: z.literal('delete_page'),
    input: deletePageInputSchema
  }),
  z.strictObject({
    type: z.literal('delete_session'),
    input: deleteSessionInputSchema
  })
])
export type ExternalAgentBrokerRequest = z.infer<typeof externalAgentBrokerRequestSchema>

export function isProtocolVersionSupported(version: string): boolean {
  return (COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS as readonly string[]).includes(version.trim())
}

export function isErrorRetryable(code: ExternalAgentErrorCode): boolean {
  return (RETRYABLE_ERROR_CODES as readonly string[]).includes(code)
}

const SENSITIVE_KEY_PATTERN = /^(api_?key|password|token|secret|html|raw_?html|stack)$/i

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.trim())
}

export function sanitizeErrorDetails(details?: unknown): ExternalAgentSafeDetails {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {}
  }
  const result: ExternalAgentSafeDetails = {}
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      continue
    }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] = value
      continue
    }
    if (Array.isArray(value)) {
      result[key] = value.filter(
        (item): item is string | number | boolean | null =>
          item === null ||
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean'
      )
      continue
    }
    if (typeof value === 'object') {
      const nested: Record<string, string | number | boolean | null> = {}
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (isSensitiveKey(subKey)) {
          continue
        }
        if (
          subVal === null ||
          typeof subVal === 'string' ||
          typeof subVal === 'number' ||
          typeof subVal === 'boolean'
        ) {
          nested[subKey] = subVal
        }
      }
      result[key] = nested
    }
  }
  return result
}

export function createExternalAgentError(args: {
  code: ExternalAgentErrorCode
  message: string
  details?: unknown
  retryable?: boolean
}): ExternalAgentErrorPayload {
  return {
    code: args.code,
    message: args.message,
    retryable: args.retryable ?? isErrorRetryable(args.code),
    details: sanitizeErrorDetails(args.details)
  }
}

export function buildDefaultCapabilitiesOutput(args?: {
  availableStyles?: ExternalAgentStyleSummary[]
}): ExternalAgentCapabilitiesOutput {
  return {
    protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
    supportedProtocolVersions: [...COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS],
    supportedTools: [...EXTERNAL_AGENT_TOOL_NAMES],
    supportedSlideSizes: SLIDE_SIZE_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      width: preset.width,
      height: preset.height
    })),
    availableStyles: args?.availableStyles ?? [],
    animationPreferenceIds: [...ANIMATION_PREFERENCE_ID_LIST],
    limits: {
      maxPptxImportSizeBytes: 500 * 1024 * 1024,
      maxAssetImportSizeBytes: 20 * 1024 * 1024,
      supportedAssetExtensions: {
        images: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
        videos: ['mp4', 'webm', 'ogg'],
        documents: ['md', 'txt', 'text']
      },
      confirmationTimeoutMs: EXTERNAL_AGENT_CONFIRMATION_TIMEOUT_MS
    }
  }
}

export type RawSessionEntity = {
  id: string
  title: string
  topic?: string | null
  status: 'active' | 'completed' | 'failed' | 'archived'
  page_count?: number | null
  slideSizeId?: SlideSizePresetId
  slide_size_id?: string
  slideWidth?: number
  slide_width?: number
  slideHeight?: number
  slide_height?: number
  styleId?: string | null
  style_id?: string | null
  created_at: number | string | Date
  updated_at: number | string | Date
}

export type RawPageEntity = {
  id?: string
  page_id?: string
  pageNumber?: number
  page_number?: number
  title: string
  status?: string | null
  contentOutline?: string | null
  content_outline?: string | null
  layoutIntent?: string | null
  layout_intent?: string | null
  assets?: RelativeAssetRef[]
}

function toIsoString(dateLike: number | string | Date): string {
  if (dateLike instanceof Date) return dateLike.toISOString()
  if (typeof dateLike === 'number') {
    const ms = dateLike < 10_000_000_000 ? dateLike * 1000 : dateLike
    return new Date(ms).toISOString()
  }
  const parsed = new Date(dateLike)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export function redactPageSnapshot(
  page: RawPageEntity,
  fallbackPageNumber: number
): ExternalAgentPageSnapshot {
  const pageId = (page.page_id || page.id || `page-${fallbackPageNumber}`).trim()
  const rawNumber = page.page_number ?? page.pageNumber ?? fallbackPageNumber
  const pageNumber =
    Number.isFinite(rawNumber) && rawNumber > 0 ? Math.round(rawNumber) : fallbackPageNumber
  const statusRaw = String(page.status || 'pending').toLowerCase()
  const status: ExternalAgentPageSnapshot['status'] =
    statusRaw === 'running' || statusRaw === 'completed' || statusRaw === 'failed'
      ? statusRaw
      : 'pending'

  const safeAssets = Array.isArray(page.assets)
    ? page.assets
        .map((asset) => {
          const parsed = relativeAssetRefSchema.safeParse(asset)
          return parsed.success ? parsed.data : null
        })
        .filter((asset): asset is RelativeAssetRef => Boolean(asset))
    : []

  return {
    pageId,
    pageNumber,
    title: (page.title || `Page ${pageNumber}`).trim().slice(0, 200),
    status,
    contentOutline: page.content_outline ?? page.contentOutline ?? null,
    layoutIntent: page.layout_intent ?? page.layoutIntent ?? null,
    assets: safeAssets
  }
}

export function redactSessionSnapshot(args: {
  session: RawSessionEntity
  pages?: RawPageEntity[]
  styleSummary?: ExternalAgentStyleSummary | null
}): ExternalAgentSessionSnapshot {
  const { session, pages = [], styleSummary } = args
  const slideSize: SlideSizePreset = resolveSlideSize({
    id: session.slideSizeId ?? session.slide_size_id ?? DEFAULT_SLIDE_SIZE_ID,
    width: session.slideWidth ?? session.slide_width,
    height: session.slideHeight ?? session.slide_height
  })

  const styleId = session.styleId ?? session.style_id ?? styleSummary?.id ?? null
  const style = styleId
    ? {
        id: styleId,
        name: styleSummary?.name,
        version: styleSummary?.version
      }
    : null

  const redactedPages = pages.map((page, index) => redactPageSnapshot(page, index + 1))
  const pageCount = session.page_count ?? redactedPages.length

  return {
    id: session.id.trim(),
    title: session.title.trim().slice(0, 200),
    topic: session.topic ? session.topic.trim().slice(0, 500) : null,
    status: session.status,
    pageCount:
      Number.isFinite(pageCount) && (pageCount as number) >= 0
        ? Number(pageCount)
        : redactedPages.length,
    slideSize: {
      id: slideSize.id,
      label: slideSize.label,
      width: slideSize.width,
      height: slideSize.height
    },
    style,
    createdAt: toIsoString(session.created_at),
    updatedAt: toIsoString(session.updated_at),
    pages: redactedPages
  }
}
