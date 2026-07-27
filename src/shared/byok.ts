import type { CompanyTextProvider } from './company-config'

export type ByokServiceId = 'aliyun' | 'tencent' | 'deepseek' | 'custom'

export interface ByokServicePreset {
  id: ByokServiceId
  label: string
  description: string
  provider: CompanyTextProvider
  defaultBaseUrl: string
  baseUrlPlaceholder: string
  modelPlaceholder: string
  documentationUrl: string
  visionHint: string
}

export const BYOK_SERVICE_PRESETS: readonly ByokServicePreset[] = [
  {
    id: 'aliyun',
    label: '阿里云百炼',
    description: '默认使用北京地域；其他地域或工作空间可粘贴控制台地址。',
    provider: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    baseUrlPlaceholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelPlaceholder: '例如控制台授权的多模态模型 ID',
    documentationUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key',
    visionHint: '选择支持图片输入的模型后，可识别扫描 PDF 和图片。'
  },
  {
    id: 'tencent',
    label: '腾讯云 TokenHub',
    description: '腾讯云大模型统一入口，中国大陆服务使用广州地域。',
    provider: 'openai',
    defaultBaseUrl: 'https://tokenhub.tencentmaas.com/v1',
    baseUrlPlaceholder: 'https://tokenhub.tencentmaas.com/v1',
    modelPlaceholder: '填写 TokenHub 控制台中的模型 ID',
    documentationUrl: 'https://cloud.tencent.com/document/product/1823/130078',
    visionHint: '是否支持扫描件取决于所选模型的图片输入能力。'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API',
    description: '使用 DeepSeek 开发者 API；网页会员不能代替 API Key。',
    provider: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com',
    baseUrlPlaceholder: 'https://api.deepseek.com',
    modelPlaceholder: '填写 DeepSeek API 文档中的模型 ID',
    documentationUrl: 'https://api-docs.deepseek.com/',
    visionHint: '请以当前模型文档为准；不支持图片输入时无法识别扫描 PDF。'
  },
  {
    id: 'custom',
    label: '其他 OpenAI 兼容服务',
    description: '高级选项；资料会发送到员工填写的 HTTPS 地址。',
    provider: 'openai',
    defaultBaseUrl: '',
    baseUrlPlaceholder: 'https://ai.example.com/v1',
    modelPlaceholder: '填写服务商要求的精确模型 ID',
    documentationUrl: '',
    visionHint: '请自行确认服务商、数据用途和图片输入能力。'
  }
]

export const getByokServicePreset = (id: ByokServiceId): ByokServicePreset =>
  BYOK_SERVICE_PRESETS.find((preset) => preset.id === id) || BYOK_SERVICE_PRESETS[3]

export const normalizeByokApiKey = (value: string): string => {
  const apiKey = value.trim()
  if (!apiKey) throw new Error('请填写 API Key。')
  if (/^Bearer\s+/i.test(apiKey)) {
    throw new Error('请只粘贴控制台复制的 Key 本身，不要包含“Bearer ”前缀。')
  }
  if (
    apiKey.length >= 2 &&
    ((apiKey.startsWith('"') && apiKey.endsWith('"')) ||
      (apiKey.startsWith("'") && apiKey.endsWith("'")) ||
      (apiKey.startsWith('`') && apiKey.endsWith('`')))
  ) {
    throw new Error('请只粘贴控制台复制的 Key 本身，不要包含引号。')
  }

  for (let index = 0; index < apiKey.length; index += 1) {
    const code = apiKey.charCodeAt(index)
    if (code < 0x21 || code > 0x7e) {
      throw new Error(
        `API Key 第 ${index + 1} 位包含中文、全角字符、空格或换行。请只粘贴控制台复制的 Key 本身。`
      )
    }
  }
  return apiKey
}

export const inferByokServiceId = (baseUrl: string): ByokServiceId => {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    if (
      hostname === 'dashscope.aliyuncs.com' ||
      hostname === 'dashscope-intl.aliyuncs.com' ||
      hostname === 'dashscope-us.aliyuncs.com' ||
      hostname.endsWith('.maas.aliyuncs.com')
    ) {
      return 'aliyun'
    }
    if (
      hostname === 'tokenhub.tencentmaas.com' ||
      hostname === 'tokenhub-intl.tencentmaas.com'
    ) {
      return 'tencent'
    }
    if (hostname === 'api.deepseek.com') return 'deepseek'
  } catch {
    // Invalid and incomplete URLs are handled by normalizeByokBaseUrl.
  }
  return 'custom'
}

const isAllowedPresetHostname = (serviceId: ByokServiceId, hostname: string): boolean => {
  if (serviceId === 'aliyun') {
    return (
      hostname === 'dashscope.aliyuncs.com' ||
      hostname === 'dashscope-intl.aliyuncs.com' ||
      hostname === 'dashscope-us.aliyuncs.com' ||
      hostname.endsWith('.maas.aliyuncs.com')
    )
  }
  if (serviceId === 'tencent') {
    return hostname === 'tokenhub.tencentmaas.com' || hostname === 'tokenhub-intl.tencentmaas.com'
  }
  if (serviceId === 'deepseek') return hostname === 'api.deepseek.com'
  return true
}

export const normalizeByokBaseUrl = (serviceId: ByokServiceId, value: string): string => {
  const raw = value.trim()
  if (!raw) throw new Error('请填写 API Base URL。')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('API Base URL 格式不正确，请填写完整的 HTTPS 地址。')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('为保护公司资料，API Base URL 必须使用 HTTPS。')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('API Base URL 不能包含账号、密码、查询参数或锚点。')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!isAllowedPresetHostname(serviceId, hostname)) {
    throw new Error(`所填地址不是“${getByokServicePreset(serviceId).label}”的官方接口域名。`)
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return parsed.toString().replace(/\/$/, '')
}
