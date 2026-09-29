import { describe, expect, it } from 'vitest'
import {
  COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS,
  EXTERNAL_AGENT_PROTOCOL_VERSION,
  buildDefaultCapabilitiesOutput,
  createExternalAgentError,
  createSessionInputSchema,
  editPageInputSchema,
  exportPptxInputSchema,
  externalAgentBrokerRequestSchema,
  externalAgentErrorPayloadSchema,
  importAssetsInputSchema,
  importPptxInputSchema,
  initializeInputSchema,
  isErrorRetryable,
  isProtocolVersionSupported,
  redactPageSnapshot,
  redactSessionSnapshot,
  relativeAssetRefSchema,
  sanitizeErrorDetails,
  startGenerationInputSchema
} from '@shared/external-agent'

describe('external agent shared contract', () => {
  it('supports canonical protocol version and compatible legacy versions', () => {
    expect(isProtocolVersionSupported(EXTERNAL_AGENT_PROTOCOL_VERSION)).toBe(true)
    expect(isProtocolVersionSupported('2026-08-15')).toBe(true)
    expect(isProtocolVersionSupported('unknown-version')).toBe(false)
    expect(COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS).toContain(EXTERNAL_AGENT_PROTOCOL_VERSION)
  })

  it('validates initialize payload strictly', () => {
    const valid = initializeInputSchema.safeParse({
      protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
      clientInfo: {
        name: 'pi-agent',
        version: '1.0.0',
        executablePath: 'C:\\Users\\1\\.pi\\bin\\pi.exe'
      }
    })
    expect(valid.success).toBe(true)

    const invalid = initializeInputSchema.safeParse({
      protocolVersion: '   ',
      clientInfo: {
        name: '',
        version: '1.0.0'
      }
    })
    expect(invalid.success).toBe(false)
  })

  it('enforces idempotency key format and rejects unknown properties', () => {
    const valid = createSessionInputSchema.safeParse({
      idempotencyKey: 'agent-run:create_1',
      title: '产品季报',
      workspaceRootPath: 'F:\\projects\\reports'
    })
    expect(valid.success).toBe(true)

    const invalidKey = createSessionInputSchema.safeParse({
      idempotencyKey: 'bad key with spaces',
      title: '产品季报',
      workspaceRootPath: 'F:\\projects\\reports'
    })
    expect(invalidKey.success).toBe(false)

    const extraField = createSessionInputSchema.safeParse({
      idempotencyKey: 'k-1',
      title: '产品季报',
      workspaceRootPath: 'F:\\projects\\reports',
      unexpectedParam: 'danger'
    })
    expect(extraField.success).toBe(false)

    const withoutWorkspace = createSessionInputSchema.safeParse({
      idempotencyKey: 'agent-run:create_2',
      title: '产品季报'
    })
    expect(withoutWorkspace.success).toBe(true)
  })

  it('validates file tool inputs and controlled relative asset paths', () => {
    const pptxInput = importPptxInputSchema.safeParse({
      idempotencyKey: 'imp-1',
      sourcePath: 'F:\\projects\\deck.pptx'
    })
    expect(pptxInput.success).toBe(true)

    const exportInput = exportPptxInputSchema.safeParse({
      idempotencyKey: 'exp-1',
      sessionId: 'sess_1',
      outputPath: 'F:\\projects\\output.pptx',
      overwrite: false
    })
    expect(exportInput.success).toBe(true)

    const validAsset = relativeAssetRefSchema.safeParse({
      kind: 'image',
      relativePath: './images/cover.png'
    })
    expect(validAsset.success).toBe(true)

    const invalidAsset = relativeAssetRefSchema.safeParse({
      kind: 'image',
      relativePath: '../secret.png'
    })
    expect(invalidAsset.success).toBe(false)

    const assetImport = importAssetsInputSchema.safeParse({
      idempotencyKey: 'asset-1',
      sessionId: 'sess_1',
      sources: [
        {
          sourcePath: 'F:\\projects\\assets\\logo.png',
          kind: 'image'
        }
      ]
    })
    expect(assetImport.success).toBe(true)
  })

  it('validates discriminated broker requests', () => {
    const req = externalAgentBrokerRequestSchema.safeParse({
      type: 'edit_page',
      input: {
        idempotencyKey: 'edit-1',
        sessionId: 'sess_1',
        pageId: 'page-1',
        instruction: '将标题改为销售增长',
        reusedAssetPaths: ['./images/chart.png']
      }
    })
    expect(req.success).toBe(true)

    const badReq = externalAgentBrokerRequestSchema.safeParse({
      type: 'unknown_tool',
      input: {}
    })
    expect(badReq.success).toBe(false)
  })

  it('redacts sensitive fields in errors and determines retryability', () => {
    expect(isErrorRetryable('APP_NOT_RUNNING')).toBe(true)
    expect(isErrorRetryable('AUTH_REVOKED')).toBe(false)

    const err = createExternalAgentError({
      code: 'AUTH_REQUIRED',
      message: '需要授权',
      details: {
        agentId: 'pi',
        apiKey: 'sk-should-not-leak',
        token: 'secret-token',
        nested: {
          allowed: true,
          secret: 'remove'
        }
      }
    })

    const parsed = externalAgentErrorPayloadSchema.safeParse(err)
    expect(parsed.success).toBe(true)
    expect(err.details).toEqual({
      agentId: 'pi',
      nested: {
        allowed: true
      }
    })
    expect(sanitizeErrorDetails(null)).toEqual({})
  })

  it('generates capabilities catalog with slide presets and limits', () => {
    const capabilities = buildDefaultCapabilitiesOutput({
      availableStyles: [
        {
          id: 'modern',
          name: '现代极简',
          description: '清晰简洁',
          category: 'business',
          version: '1.0.0'
        }
      ]
    })

    expect(capabilities.supportedTools).toContain('get_capabilities')
    expect(capabilities.supportedTools).toContain('start_generation')
    expect(capabilities.supportedSlideSizes.length).toBeGreaterThan(0)
    expect(capabilities.limits.maxPptxImportSizeBytes).toBe(500 * 1024 * 1024)
    expect(capabilities.availableStyles[0].id).toBe('modern')
    expect(capabilities.animationPreferenceIds).toContain('fade')
    expect(
      startGenerationInputSchema.safeParse({
        idempotencyKey: 'gen-1',
        sessionId: 'sess-1',
        topic: '极光演示',
        styleId: 'aurora',
        animationPreferences: { ids: ['fade', 'slide-up'] }
      }).success
    ).toBe(true)
  })

  it('redacts individual page snapshot with fallback and safe asset filtering', () => {
    const pageSnapshot = redactPageSnapshot(
      {
        page_id: 'page-9',
        page_number: 9,
        title: '总结',
        status: 'completed',
        content_outline: '要点归纳',
        layout_intent: 'summary',
        assets: [
          { kind: 'image', relativePath: './images/chart.png' },
          { kind: 'image', relativePath: '../escaped.png' } as unknown as {
            kind: 'image'
            relativePath: string
          }
        ]
      },
      9
    )

    expect(pageSnapshot.pageId).toBe('page-9')
    expect(pageSnapshot.assets).toHaveLength(1)
    expect(pageSnapshot.assets[0].relativePath).toBe('./images/chart.png')
  })

  it('redacts session and page snapshots without exposing raw html or absolute paths', () => {
    const sessionSnapshot = redactSessionSnapshot({
      session: {
        id: 'sess_123',
        title: '年度汇报',
        topic: '业务回顾',
        status: 'active',
        created_at: 1725400000,
        updated_at: 1725403600,
        slideSizeId: 'wide-16-9',
        slideWidth: 1600,
        slideHeight: 900
      },
      pages: [
        {
          id: 'page-1',
          pageNumber: 1,
          title: '封面',
          status: 'completed',
          contentOutline: '封面标题与演讲人',
          layoutIntent: 'cover',
          assets: [
            {
              kind: 'image',
              relativePath: './images/hero.png'
            }
          ]
        }
      ]
    })

    expect(sessionSnapshot.id).toBe('sess_123')
    expect(sessionSnapshot.slideSize.width).toBe(1600)
    expect(sessionSnapshot.pages[0].pageId).toBe('page-1')
    expect(sessionSnapshot.pages[0].assets[0].relativePath).toBe('./images/hero.png')

    const raw = sessionSnapshot as Record<string, unknown>
    expect(raw.html_path).toBeUndefined()
    expect(raw.project_dir).toBeUndefined()
    expect(raw.referenceDocumentPath).toBeUndefined()
  })

  it('handles edit page input edge validation', () => {
    const valid = editPageInputSchema.safeParse({
      idempotencyKey: 'idemp-1',
      sessionId: 'sess_1',
      pageId: 'page-1',
      instruction: '请精简要点',
      targetSelector: 'div.title'
    })
    expect(valid.success).toBe(true)

    const invalid = editPageInputSchema.safeParse({
      idempotencyKey: 'idemp-1',
      sessionId: 'sess_1',
      pageId: 'page-1',
      instruction: ''
    })
    expect(invalid.success).toBe(false)
  })
})
