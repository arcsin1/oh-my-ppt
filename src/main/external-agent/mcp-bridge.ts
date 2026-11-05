import {
  EXTERNAL_AGENT_TOOL_NAMES,
  createExternalAgentError,
  type ExternalAgentBrokerRequest,
  type ExternalAgentToolName
} from '@shared/external-agent'
import type { ExternalAgentBroker } from './broker'

export interface McpToolDefinition {
  name: ExternalAgentToolName
  description: string
  inputSchema: Record<string, unknown>
}

export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: 'get_capabilities',
    description: '获取 Oh My PPT 服务端协议版本、支持的工具、画布尺寸和样式摘要',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'list_sessions',
    description: '列出已对当前 Agent 明确授权的 Session 列表及摘要',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        cursor: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_session',
    description: '获取指定授权 Session 的结构化快照与页面列表（不返回绝对路径或原始 HTML）',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_page',
    description: '获取指定页面受控快照、大纲、页面状态和相对素材引用',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'pageId'],
      properties: {
        sessionId: { type: 'string' },
        pageId: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'create_session',
    description: '在已授权工作区下创建新 Session（存储目录仍由系统管理）',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'title'],
      properties: {
        idempotencyKey: { type: 'string' },
        title: { type: 'string' },
        topic: { type: 'string' },
        styleId: { type: 'string' },
        slideSizeId: { type: 'string' },
        pageCount: { type: 'integer', minimum: 1, maximum: 30 },
        workspaceRootPath: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'start_generation',
    description: '为已授权 Session 启动整套生成任务，返回异步 operationId',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'sessionId', 'topic'],
      properties: {
        idempotencyKey: { type: 'string' },
        sessionId: { type: 'string' },
        topic: { type: 'string' },
        prompt: { type: 'string' },
        pageCount: { type: 'integer', minimum: 1, maximum: 30 },
        styleId: { type: 'string' },
        slideSizeId: { type: 'string' },
        reusedAssetPaths: { type: 'array', items: { type: 'string' } },
        animationPreferences: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' }, maxItems: 3 }
          }
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'edit_page',
    description: '提交单页结构化编辑指令，返回异步 operationId',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'sessionId', 'pageId', 'instruction'],
      properties: {
        idempotencyKey: { type: 'string' },
        sessionId: { type: 'string' },
        pageId: { type: 'string' },
        instruction: { type: 'string' },
        targetSelector: { type: 'string' },
        reusedAssetPaths: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    }
  },
  {
    name: 'edit_deck',
    description: '提交整套演示文稿跨页结构化编辑指令，返回异步 operationId',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'sessionId', 'instruction'],
      properties: {
        idempotencyKey: { type: 'string' },
        sessionId: { type: 'string' },
        instruction: { type: 'string' },
        scope: { type: 'string', enum: ['deck', 'presentation-container'] },
        reusedAssetPaths: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    }
  },
  {
    name: 'import_pptx',
    description: '从已授权工作区路径导入 PPTX，并转换为可编辑 Session',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'sourcePath'],
      properties: {
        idempotencyKey: { type: 'string' },
        sourcePath: { type: 'string' },
        title: { type: 'string' },
        styleId: { type: 'string' },
        slideSizeId: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'import_assets',
    description: '从已授权工作区导入素材并复制到指定 Session，返回受控相对引用',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'sessionId', 'sources'],
      properties: {
        idempotencyKey: { type: 'string' },
        sessionId: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sourcePath'],
            properties: {
              sourcePath: { type: 'string' },
              kind: { type: 'string', enum: ['image', 'video', 'document'] },
              label: { type: 'string' }
            }
          }
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'export_pptx',
    description: '将指定 Session 导出为 PPTX 存入已授权路径',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'sessionId', 'outputPath'],
      properties: {
        idempotencyKey: { type: 'string' },
        sessionId: { type: 'string' },
        outputPath: { type: 'string' },
        overwrite: { type: 'boolean', default: false }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_operation',
    description: '查询异步 operation 状态、进度、checkpoint 与结果引用',
    inputSchema: {
      type: 'object',
      required: ['operationId'],
      properties: {
        operationId: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_operation_events',
    description: '查询 operation 持久化事件列表（用于断线补偿）',
    inputSchema: {
      type: 'object',
      required: ['operationId'],
      properties: {
        operationId: { type: 'string' },
        afterSequence: { type: 'integer', default: 0 },
        limit: { type: 'integer', default: 50 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'subscribe_events',
    description: '订阅 operation 实时事件',
    inputSchema: {
      type: 'object',
      required: ['operationId'],
      properties: {
        operationId: { type: 'string' },
        afterSequence: { type: 'integer', default: 0 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'cancel_operation',
    description: '取消排队或正在执行的 operation',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'operationId'],
      properties: {
        idempotencyKey: { type: 'string' },
        operationId: { type: 'string' },
        reason: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'resume_operation',
    description: '恢复具备 checkpoint 的可恢复 operation',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'operationId'],
      properties: {
        idempotencyKey: { type: 'string' },
        operationId: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'delete_page',
    description: '高风险操作：删除 Session 中的单页（需用户在应用界面显式确认）',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'sessionId', 'pageId'],
      properties: {
        idempotencyKey: { type: 'string' },
        sessionId: { type: 'string' },
        pageId: { type: 'string' },
        reason: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'delete_session',
    description: '高风险操作：删除整套 Session 及关联文件（需用户在应用界面显式确认）',
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'sessionId'],
      properties: {
        idempotencyKey: { type: 'string' },
        sessionId: { type: 'string' },
        reason: { type: 'string' }
      },
      additionalProperties: false
    }
  }
]

export function getMcpToolDefinitions(): readonly McpToolDefinition[] {
  return MCP_TOOL_DEFINITIONS
}

export function isKnownMcpToolName(name: string): name is ExternalAgentToolName {
  return (EXTERNAL_AGENT_TOOL_NAMES as readonly string[]).includes(name)
}

export function mapMcpCallToBrokerRequest(
  toolName: string,
  args: Record<string, unknown> = {}
): ExternalAgentBrokerRequest {
  if (!isKnownMcpToolName(toolName)) {
    throw new Error(`未知的 MCP 工具名称: ${toolName}`)
  }

  // SAFETY: toolName has been validated by isKnownMcpToolName and args will be parsed strictly by the Broker's Zod schema.
  return {
    type: toolName,
    input: args
  } as unknown as ExternalAgentBrokerRequest
}

export class McpBridgeDispatcher {
  constructor(
    private broker: ExternalAgentBroker,
    private isAppRunningCheck = (): boolean => true
  ) {}

  async dispatchToolCall(
    agentId: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
  }> {
    if (!this.isAppRunningCheck()) {
      const err = createExternalAgentError({
        code: 'APP_NOT_RUNNING',
        message: 'Oh My PPT 桌面应用未在运行，请先启动应用'
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err }) }],
        isError: true
      }
    }

    try {
      const brokerRequest = mapMcpCallToBrokerRequest(toolName, args)
      const res = await this.broker.handleRequest(agentId, brokerRequest)
      return {
        content: [{ type: 'text', text: JSON.stringify(res) }],
        isError: !res.ok
      }
    } catch (err) {
      const errorPayload = createExternalAgentError({
        code: 'VALIDATION_FAILED',
        message: err instanceof Error ? err.message : String(err)
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: errorPayload }) }],
        isError: true
      }
    }
  }
}
