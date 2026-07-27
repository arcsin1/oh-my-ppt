import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Server,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import {
  BYOK_SERVICE_PRESETS,
  getByokServicePreset,
  inferByokServiceId,
  normalizeByokBaseUrl,
  type ByokServiceId
} from '@shared/byok.js'
import type { CompanyTextProvider } from '@shared/company-config.js'
import { useSettingsStore, useToastStore } from '@renderer/store'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'

const TEXT_CONFIG_NAME_PREFIX = 'BYOK · '
const DEFAULT_BYOK_SERVICE_ID: ByokServiceId = 'aliyun'
const DEFAULT_BYOK_PRESET = getByokServicePreset(DEFAULT_BYOK_SERVICE_ID)

const readDestination = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return '尚未填写有效地址'
  }
}

export function SettingsPage(): React.JSX.Element {
  const {
    settings,
    modelConfigs,
    verificationMessage,
    fetchSettings,
    saveSettings,
    upsertModelConfig,
    deleteModelConfig,
    verifyApiKey,
    chooseStoragePath
  } = useSettingsStore()
  const { success, error, warning } = useToastStore()
  const [serviceId, setServiceId] = useState<ByokServiceId>(DEFAULT_BYOK_SERVICE_ID)
  const [provider, setProvider] = useState<CompanyTextProvider>(DEFAULT_BYOK_PRESET.provider)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BYOK_PRESET.defaultBaseUrl)
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [choosingStorage, setChoosingStorage] = useState(false)

  const textConfig = useMemo(
    () => modelConfigs.find((item) => item.active) || modelConfigs[0] || null,
    [modelConfigs]
  )
  const preset = getByokServicePreset(serviceId)
  const normalizedDraftBaseUrl = useMemo(() => {
    try {
      return normalizeByokBaseUrl(serviceId, baseUrl)
    } catch {
      return baseUrl.trim()
    }
  }, [baseUrl, serviceId])
  const connected = Boolean(
    textConfig?.active &&
      textConfig.apiKey &&
      textConfig.provider === provider &&
      textConfig.baseUrl === normalizedDraftBaseUrl &&
      textConfig.model === model.trim()
  )
  const sessionOnly = connected && textConfig?.credentialPersistence === 'session-only'

  useEffect(() => {
    let disposed = false
    const load = async (): Promise<void> => {
      setLoading(true)
      try {
        await fetchSettings()
      } catch (loadError) {
        if (!disposed) {
          error('读取本机设置失败', {
            description: loadError instanceof Error ? loadError.message : '请稍后重试。'
          })
        }
      } finally {
        if (!disposed) setLoading(false)
      }
    }
    void load()
    return () => {
      disposed = true
    }
  }, [error, fetchSettings])

  useEffect(() => {
    if (!textConfig) return
    const inferredServiceId = inferByokServiceId(textConfig.baseUrl)
    setServiceId(inferredServiceId)
    setProvider(
      textConfig.provider === 'openai-responses' ? 'openai-responses' : 'openai'
    )
    setBaseUrl(textConfig.baseUrl)
    setModel(textConfig.model)
    setApiKey('')
  }, [textConfig])

  const handleServiceChange = (nextServiceId: ByokServiceId): void => {
    const nextPreset = getByokServicePreset(nextServiceId)
    setServiceId(nextServiceId)
    setProvider(nextPreset.provider)
    setBaseUrl(nextPreset.defaultBaseUrl)
    setModel('')
    setApiKey('')
  }

  const handleConnect = async (): Promise<void> => {
    const key = apiKey.trim()
    const modelId = model.trim()
    if (!modelId) {
      warning('请填写模型 ID', {
        description: '模型 ID 必须与服务商控制台或 API 文档完全一致。'
      })
      return
    }
    if (!key) {
      warning('请输入个人 API Key', {
        description: connected
          ? '当前连接仍然有效；如需修改服务，请重新输入 Key 并验证。'
          : '网页会员不能代替 API Key，请先在服务商控制台开通 API。'
      })
      return
    }

    let normalizedBaseUrl: string
    try {
      normalizedBaseUrl = normalizeByokBaseUrl(serviceId, baseUrl)
    } catch (validationError) {
      warning('API 地址不符合要求', {
        description:
          validationError instanceof Error ? validationError.message : '请检查 API Base URL。'
      })
      return
    }

    setConnecting(true)
    try {
      const valid = await verifyApiKey(
        provider,
        serviceId,
        key,
        modelId,
        normalizedBaseUrl,
        8192,
        false,
        'omit',
        60_000
      )
      if (!valid) {
        error('连接验证失败', {
          description:
            useSettingsStore.getState().verificationMessage ||
            '请检查 Key、余额、模型 ID 和 API 地址。'
        })
        return
      }

      const savedTextConfig = await upsertModelConfig({
        id: textConfig?.id,
        name: `${TEXT_CONFIG_NAME_PREFIX}${preset.label}`,
        provider,
        serviceId,
        model: modelId,
        apiKey: key,
        baseUrl: normalizedBaseUrl,
        maxTokens: 8192,
        disableTemperature: false,
        thinkingParameterMode: 'omit',
        active: true
      })
      if (!savedTextConfig) {
        throw new Error(useSettingsStore.getState().verificationMessage || 'BYOK 配置保存失败。')
      }

      setBaseUrl(normalizedBaseUrl)
      setApiKey('')
      await fetchSettings()
      if (savedTextConfig.credentialPersistence === 'session-only') {
        warning('个人 AI 服务已临时连接', {
          description: `当前 Mac 开发环境无法使用系统安全存储。Key 仅保存在本次运行的内存中，关闭软件后失效；资料将发送到 ${readDestination(normalizedBaseUrl)}。`
        })
      } else {
        success('个人 AI 服务已连接', {
          description: `当前模型：${modelId}；资料将发送到 ${readDestination(normalizedBaseUrl)}。`
        })
      }
    } catch (connectError) {
      error('保存连接失败', {
        description: connectError instanceof Error ? connectError.message : '请稍后重试。'
      })
    } finally {
      setConnecting(false)
    }
  }

  const handleClearConnection = async (): Promise<void> => {
    if (!textConfig) return
    if (!window.confirm('确定清除本机保存的 AI 配置和 API Key 吗？此操作无法撤销。')) return
    setClearing(true)
    try {
      await deleteModelConfig(textConfig.id)
      setServiceId(DEFAULT_BYOK_SERVICE_ID)
      setProvider(DEFAULT_BYOK_PRESET.provider)
      setBaseUrl(DEFAULT_BYOK_PRESET.defaultBaseUrl)
      setModel('')
      setApiKey('')
      success('本机 AI 配置已清除')
    } finally {
      setClearing(false)
    }
  }

  const handleChooseStorage = async (): Promise<void> => {
    setChoosingStorage(true)
    try {
      const path = await chooseStoragePath()
      if (!path) return
      await saveSettings({ storagePath: path })
      success('本地文件目录已更新')
    } finally {
      setChoosingStorage(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-[#7a746b]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#e21b22]" />
        正在读取本机配置
      </div>
    )
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10 text-[#4c4c4c]">
      <div className="mb-8">
        <h1 className="text-[30px] font-semibold tracking-tight text-[#333333]">设置</h1>
        <p className="mt-2 text-sm leading-6 text-[#77736d]">
          使用自己的模型 API。只有调用 AI 时才需要配置，本地查看、编辑和导出不受影响。
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-[#e6ded2] bg-white shadow-[0_12px_30px_rgba(76,76,76,0.06)]">
        <div className="flex items-start justify-between gap-6 border-b border-[#eee7dd] px-6 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fff1ec] text-[#e21b22]">
              <Server className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#333333]">连接个人 AI 服务</h2>
              <p className="mt-1 text-xs leading-5 text-[#817b73]">
                系统安全存储可用时加密保存；Mac 调试环境不支持时仅保留到本次运行结束。
              </p>
            </div>
          </div>
          {connected ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#eef7ed] px-2.5 py-1.5 text-xs font-medium text-[#39713a]">
              <CheckCircle2 className="h-3.5 w-3.5" /> 已连接
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#fff4e7] px-2.5 py-1.5 text-xs font-medium text-[#9a5a15]">
              <AlertTriangle className="h-3.5 w-3.5" /> 未连接
            </span>
          )}
        </div>

        <div className="space-y-5 px-6 py-6">
          <div>
            <label className="mb-2 block text-xs font-medium text-[#5f5a54]">AI 服务</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {BYOK_SERVICE_PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleServiceChange(item.id)}
                  className={`rounded-lg border px-3.5 py-3 text-left transition-colors ${
                    serviceId === item.id
                      ? 'border-[#e21b22] bg-[#fff8f5]'
                      : 'border-[#e7e0d6] bg-white hover:border-[#f2a36d]'
                  }`}
                >
                  <span className="block text-sm font-semibold text-[#3f3a35]">{item.label}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-[#817b73]">
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {serviceId === 'custom' ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#5f5a54]">接口协议</label>
              <select
                value={provider}
                onChange={(event) =>
                  setProvider(
                    event.target.value === 'openai-responses' ? 'openai-responses' : 'openai'
                  )
                }
                className="h-11 w-full rounded-lg border border-[#ded6cb] bg-white px-3 text-sm outline-none focus:border-[#e21b22]"
              >
                <option value="openai">OpenAI Chat Completions（推荐）</option>
                <option value="openai-responses">OpenAI Responses API</option>
              </select>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#5f5a54]">
                API Base URL
              </label>
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={preset.baseUrlPlaceholder}
                autoComplete="off"
                className="h-11 border-[#ded6cb] bg-white text-sm focus-visible:border-[#e21b22] focus-visible:ring-[#e21b22]/15"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#5f5a54]">模型 ID</label>
              <Input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={preset.modelPlaceholder}
                autoComplete="off"
                className="h-11 border-[#ded6cb] bg-white text-sm focus-visible:border-[#e21b22] focus-visible:ring-[#e21b22]/15"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#5f5a54]">个人 API Key</label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a938a]" />
              <Input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  connected
                    ? sessionOnly
                      ? 'Key 仅在本次运行中有效；输入新 Key 可替换'
                      : 'Key 已加密保存在本机；输入新 Key 可替换'
                    : '输入服务商提供的 API Key'
                }
                className="h-11 border-[#ded6cb] bg-white pl-10 pr-3 text-sm focus-visible:border-[#e21b22] focus-visible:ring-[#e21b22]/15"
              />
            </div>
            <div className="mt-2 space-y-1.5 text-xs text-[#817b73]">
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-[#c96a31]" />
                {sessionOnly
                  ? '当前为 Mac 调试模式：Key 只在内存中，关闭软件后失效。'
                  : 'Key 不写入安装包、日志或演示文稿；正式版要求系统加密存储。'}
              </p>
              <p>资料发送目标：{readDestination(baseUrl)}</p>
              <p>{preset.visionHint}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[#f0e9df] pt-5">
            <Button
              type="button"
              disabled={connecting}
              onClick={() => void handleConnect()}
              className="h-10 bg-[#e21b22] px-5 text-white shadow-none hover:bg-[#ba1218]"
            >
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              验证并保存
            </Button>
            {textConfig ? (
              <Button
                type="button"
                variant="outline"
                disabled={clearing}
                onClick={() => void handleClearConnection()}
                className="h-10 border-[#ded6cb] bg-white text-[#6b625b] hover:bg-[#fff5f2] hover:text-[#ba1218]"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                清除本机配置
              </Button>
            ) : null}
            {preset.documentationUrl ? (
              <a
                href={preset.documentationUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#9a5a15] hover:text-[#e21b22]"
              >
                获取 API Key <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            {verificationMessage ? (
              <span className="basis-full text-xs text-[#817b73]">{verificationMessage}</span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-[#e6ded2] bg-white px-6 py-5 shadow-[0_12px_30px_rgba(76,76,76,0.05)]">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fff7df] text-[#c96a31]">
              <FolderOpen className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#333333]">本地文件目录</h2>
              <p className="mt-1 truncate text-xs text-[#817b73]">
                {settings?.storagePath || '尚未选择，演示文稿无法保存'}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={choosingStorage}
            onClick={() => void handleChooseStorage()}
            className="h-9 shrink-0 border-[#ded6cb] bg-white text-[#4c4c4c] hover:bg-[#faf8f3]"
          >
            {choosingStorage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            选择目录
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-[#f0e9df] pt-4 text-xs text-[#817b73]">
          <ImageIcon className="h-4 w-4 text-[#f5831f]" />
          AI 生图在首版 BYOK 中默认关闭；文字生成、扫描件识别能力取决于员工所选模型。
        </div>
      </section>
    </main>
  )
}
