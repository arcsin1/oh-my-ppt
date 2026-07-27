import {
  MODEL_TIMEOUT_PROFILES,
  resolveModelTimeoutMs,
  type ModelTimeoutProfile
} from '@shared/model-timeout'
import type { IpcContext } from '../context'
import { readAppLocale, uiText } from '../config/locale-utils'
import { bindCurrentModelTemperatureControl } from '../../model-runtime'
import {
  DEFAULT_THINKING_PARAMETER_MODE,
  normalizeThinkingParameterMode,
  type ThinkingParameterMode
} from '@shared/model-config'
import { isCompanyTextProvider } from '@shared/company-config'

export interface ActiveModelConfig {
  id: string
  name: string
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  disableTemperature: boolean
  thinkingParameterMode: ThinkingParameterMode
}

export type ResolvedModelConfig = ActiveModelConfig

export async function resolveGlobalModelTimeouts(
  ctx: Pick<IpcContext, 'db'>
): Promise<Record<ModelTimeoutProfile, number>> {
  const settings = await ctx.db.getAllSettings()
  return Object.fromEntries(
    MODEL_TIMEOUT_PROFILES.map((profile) => [
      profile,
      resolveModelTimeoutMs(settings[`timeout_ms_${profile}`], profile)
    ])
  ) as Record<ModelTimeoutProfile, number>
}

export async function resolveActiveModelConfig(
  ctx: Pick<IpcContext, 'db' | 'decryptApiKey'>
): Promise<ActiveModelConfig> {
  const locale = await readAppLocale(ctx)
  const config = await ctx.db.getActiveModelConfig()
  if (!config) {
    throw new Error(
      uiText(
        locale,
        '请先前往系统设置添加并启用一个模型。',
        'Add and activate a model in Settings first.'
      )
    )
  }
  return resolveModelConfigRow(ctx, config, {
    locale,
    missingPrefixZh: '当前启用模型',
    missingPrefixEn: 'The active model'
  })
}

const resolveModelConfigRow = (
  ctx: Pick<IpcContext, 'decryptApiKey'>,
  config: {
    id: string
    name: string
    provider: string
    model: string
    apiKey: string
    baseUrl: string
    maxTokens?: number | null
    disableTemperature?: number | boolean | null
    thinkingParameterMode?: string | null
  },
  options: {
    locale: 'zh' | 'en'
    missingPrefixZh: string
    missingPrefixEn: string
  }
): ActiveModelConfig => {
  const provider = String(config.provider || '').trim()
  const model = String(config.model || '').trim()
  const apiKey = ctx.decryptApiKey(config.apiKey).trim()
  if (!provider) {
    throw new Error(
      uiText(
        options.locale,
        `${options.missingPrefixZh}缺少 provider，请到设置页检查。`,
        `${options.missingPrefixEn} is missing provider. Check Settings.`
      )
    )
  }
  if (!isCompanyTextProvider(provider)) {
    throw new Error(
      uiText(
        options.locale,
        '安居建业内部版 BYOK 仅支持 OpenAI 兼容服务，请重新配置。',
        'This internal BYOK build only supports OpenAI-compatible services.'
      )
    )
  }
  if (!model) {
    throw new Error(
      uiText(
        options.locale,
        `${options.missingPrefixZh}缺少 model，请到设置页检查。`,
        `${options.missingPrefixEn} is missing model. Check Settings.`
      )
    )
  }
  if (!apiKey) {
    throw new Error(
      uiText(
        options.locale,
        `${options.missingPrefixZh}缺少 api_key，请到设置页检查。`,
        `${options.missingPrefixEn} is missing api_key. Check Settings.`
      )
    )
  }

  const resolved = {
    id: config.id,
    name: config.name,
    provider,
    model,
    apiKey,
    baseUrl: String(config.baseUrl || '').trim(),
    maxTokens: config.maxTokens || 4096,
    disableTemperature: config.disableTemperature === 1 || config.disableTemperature === true,
    thinkingParameterMode: normalizeThinkingParameterMode(
      config.thinkingParameterMode || DEFAULT_THINKING_PARAMETER_MODE
    )
  }
  bindCurrentModelTemperatureControl(resolved)
  return resolved
}

export async function resolveModelConfigById(
  ctx: Pick<IpcContext, 'db' | 'decryptApiKey'>,
  modelConfigId: string
): Promise<ResolvedModelConfig> {
  const locale = await readAppLocale(ctx)
  const id = modelConfigId.trim()
  if (!id) {
    throw new Error(uiText(locale, '请选择要使用的模型。', 'Choose a model to use.'))
  }
  const config = await ctx.db.getModelConfig(id)
  if (!config) {
    throw new Error(uiText(locale, '所选模型不存在，请重新选择。', 'The selected model no longer exists.'))
  }
  return resolveModelConfigRow(ctx, config, {
    locale,
    missingPrefixZh: '所选模型配置',
    missingPrefixEn: 'The selected model'
  })
}

export async function resolveModelConfigForTask(
  ctx: Pick<IpcContext, 'db' | 'decryptApiKey'>,
  args: {
    modelConfigId?: string | null
    purpose: string
  }
): Promise<ResolvedModelConfig> {
  const id = typeof args.modelConfigId === 'string' ? args.modelConfigId.trim() : ''
  if (id) return resolveModelConfigById(ctx, id)
  return resolveActiveModelConfig(ctx)
}
