import { useEffect, useMemo, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/Select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import {
  CheckCircle2,
  Download,
  FolderSearch,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import { useLang } from '../i18n'
import type { ModelConfig } from '../lib/ipc'
import {
  CONFIGURABLE_MODEL_TIMEOUT_PROFILES,
  type ConfigurableModelTimeoutProfile,
  modelTimeoutMsToSeconds,
  resolveModelTimeoutMs
} from '@shared/model-timeout.js'

type ProviderId = 'anthropic' | 'openai'

const WEB_SEARCH_ENGINE_OPTIONS = [
  { value: 'bing', label: 'Bing' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'baidu', label: 'Baidu' },
  { value: 'brave', label: 'Brave' },
  { value: 'csdn', label: 'CSDN' },
  { value: 'exa', label: 'Exa' },
  { value: 'juejin', label: 'Juejin' },
  { value: 'linuxdo', label: 'LinuxDo' },
  { value: 'startpage', label: 'Startpage' }
] as const

interface ModelForm {
  id?: string
  name: string
  provider: ProviderId
  model: string
  apiKey: string
  baseUrl: string
  active: boolean
}

const createTimeoutSeconds = (
  timeouts?: Partial<Record<ConfigurableModelTimeoutProfile, number>>
): Record<ConfigurableModelTimeoutProfile, number> =>
  Object.fromEntries(
    CONFIGURABLE_MODEL_TIMEOUT_PROFILES.map((profile) => [
      profile,
      modelTimeoutMsToSeconds(timeouts?.[profile], profile)
    ])
  ) as Record<ConfigurableModelTimeoutProfile, number>

const createEmptyModelForm = (active = false): ModelForm => ({
  name: '',
  provider: 'openai',
  model: '',
  apiKey: '',
  baseUrl: '',
  active
})

const createModelForm = (config: ModelConfig): ModelForm => ({
  id: config.id,
  name: config.name,
  provider: config.provider,
  model: config.model,
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  active: config.active
})

export function SettingsPage(): React.JSX.Element {
  const {
    settings,
    modelConfigs,
    fetchSettings,
    saveSettings,
    upsertModelConfig,
    setActiveModelConfig,
    deleteModelConfig,
    setVerificationMessage,
    verifyApiKey,
    chooseStoragePath,
    refreshWebSearchServiceStatus,
    installWebSearchService,
    startWebSearchService,
    webSearchError,
    webSearchBusy
  } = useSettingsStore()
  const { success, error, warning, info } = useToastStore()
  const { lang, setLang, t } = useLang()
  const [storagePath, setStoragePath] = useState(
    () => useSettingsStore.getState().settings?.storagePath || ''
  )
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [modelForm, setModelForm] = useState<ModelForm>(() => createEmptyModelForm())
  const [timeoutSeconds, setTimeoutSeconds] = useState<
    Record<ConfigurableModelTimeoutProfile, number>
  >(() => createTimeoutSeconds(useSettingsStore.getState().settings?.timeouts))
  const [savingModel, setSavingModel] = useState(false)
  const [savingTimeouts, setSavingTimeouts] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [webSearchLimit, setWebSearchLimit] = useState('20')
  const [webSearchEngines, setWebSearchEngines] = useState<string[]>(['bing', 'duckduckgo'])
  const [webSearchUseProxy, setWebSearchUseProxy] = useState(false)
  const [webSearchProxyUrl, setWebSearchProxyUrl] = useState('http://127.0.0.1:7897')

  useEffect(() => {
    let active = true
    const loadSettings = async (): Promise<void> => {
      await fetchSettings()
      if (!active) return
      const nextSettings = useSettingsStore.getState().settings
      setStoragePath(nextSettings?.storagePath || '')
      setTimeoutSeconds(createTimeoutSeconds(nextSettings?.timeouts))
      setWebSearchLimit(String(nextSettings?.webSearch?.limit || 20))
      setWebSearchEngines(
        nextSettings?.webSearch?.engines?.length ? nextSettings.webSearch.engines : ['bing', 'duckduckgo']
      )
      setWebSearchUseProxy(nextSettings?.webSearch?.useProxy === true)
      setWebSearchProxyUrl(nextSettings?.webSearch?.proxyUrl || 'http://127.0.0.1:7897')
    }
    void loadSettings()
    return () => {
      active = false
    }
  }, [fetchSettings])

  useEffect(() => {
    if (!modelDialogOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !savingModel) {
        setModelDialogOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [modelDialogOpen, savingModel])

  const activeModelConfig = modelConfigs.find((config) => config.active)
  const timeoutFields: Array<{
    profile: ConfigurableModelTimeoutProfile
    label: string
    hint: string
    min: number
  }> = useMemo(
    () => [
      {
        profile: 'planning',
        label: t('settings.timeoutPlanning'),
        hint: t('settings.timeoutPlanningHint'),
        min: 120
      },
      {
        profile: 'design',
        label: t('settings.timeoutDesign'),
        hint: t('settings.timeoutDesignHint'),
        min: 120
      },
      {
        profile: 'agent',
        label: t('settings.timeoutAgent'),
        hint: t('settings.timeoutAgentHint'),
        min: 300
      },
      {
        profile: 'document',
        label: t('settings.timeoutDocument'),
        hint: t('settings.timeoutDocumentHint'),
        min: 300
      }
    ],
    [t]
  )

  const openCreateModelDialog = (): void => {
    setModelForm(createEmptyModelForm(modelConfigs.length === 0))
    setVerificationMessage(null)
    setModelDialogOpen(true)
  }

  const openEditModelDialog = (config: ModelConfig): void => {
    setModelForm(createModelForm(config))
    setVerificationMessage(null)
    setModelDialogOpen(true)
  }

  const updateModelForm = (patch: Partial<ModelForm>): void => {
    setModelForm((form) => ({ ...form, ...patch }))
    setVerificationMessage(null)
  }

  const handleSaveModel = async (): Promise<void> => {
    if (!modelForm.name.trim()) {
      warning(t('settings.fillModelName'))
      return
    }
    if (!modelForm.model.trim()) {
      warning(t('settings.fillModel'))
      return
    }
    if (!modelForm.apiKey.trim()) {
      warning(t('settings.fillApiKey'))
      return
    }

    setSavingModel(true)
    setVerificationMessage(null)
    try {
      const id = await upsertModelConfig({
        id: modelForm.id,
        name: modelForm.name.trim(),
        provider: modelForm.provider,
        model: modelForm.model.trim(),
        apiKey: modelForm.apiKey.trim(),
        baseUrl: modelForm.baseUrl.trim(),
        active: modelForm.active
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (!id || saveError) {
        error(t('settings.saveFailed'), { description: saveError || t('common.retryLater') })
        return
      }
      setModelDialogOpen(false)
      success(t('settings.modelSaved'), { description: t('settings.modelSavedDescription') })
    } finally {
      setSavingModel(false)
    }
  }

  const handleTimeoutChange = (profile: ConfigurableModelTimeoutProfile, value: string): void => {
    setTimeoutSeconds((current) => ({
      ...current,
      [profile]: modelTimeoutMsToSeconds(Number(value) * 1000, profile)
    }))
    setVerificationMessage(null)
  }

  const handleSaveTimeouts = async (): Promise<void> => {
    setSavingTimeouts(true)
    setVerificationMessage(null)
    try {
      await saveSettings({
        timeouts: Object.fromEntries(
          CONFIGURABLE_MODEL_TIMEOUT_PROFILES.map((profile) => [
            profile,
            timeoutSeconds[profile] * 1000
          ])
        ) as Record<ConfigurableModelTimeoutProfile, number>
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (saveError) {
        error(t('settings.saveFailed'), { description: saveError })
        return
      }
      success(t('settings.saved'), { description: t('settings.timeoutSavedDescription') })
    } finally {
      setSavingTimeouts(false)
    }
  }

  const handleVerify = async (): Promise<void> => {
    if (!modelForm.apiKey.trim()) {
      warning(t('settings.fillApiKey'))
      return
    }
    if (!modelForm.model.trim()) {
      warning(t('settings.fillModel'))
      return
    }

    setVerifying(true)
    setVerificationMessage(null)
    try {
      const valid = await verifyApiKey(
        modelForm.provider,
        modelForm.apiKey,
        modelForm.model,
        modelForm.baseUrl,
        resolveModelTimeoutMs(undefined, 'verify')
      )
      const verifyMessage = useSettingsStore.getState().verificationMessage
      if (valid) {
        success(t('settings.verifyPassed'), {
          description: verifyMessage || t('settings.verifyPassedDescription')
        })
      } else {
        error(t('settings.verifyFailed'), {
          description: verifyMessage || t('settings.verifyFailedDescription')
        })
      }
    } finally {
      setVerifying(false)
    }
  }

  const handleActivateModel = async (id: string): Promise<void> => {
    setActivatingId(id)
    setVerificationMessage(null)
    try {
      await setActiveModelConfig(id)
      const activateError = useSettingsStore.getState().verificationMessage
      if (activateError) {
        error(t('settings.activateModelFailed'), { description: activateError })
        return
      }
      success(t('settings.activeModelUpdated'))
    } finally {
      setActivatingId(null)
    }
  }

  const handleDeleteModel = async (config: ModelConfig): Promise<void> => {
    if (!window.confirm(t('settings.deleteModelConfirm', { name: config.name }))) return
    setDeletingId(config.id)
    setVerificationMessage(null)
    try {
      await deleteModelConfig(config.id)
      const deleteError = useSettingsStore.getState().verificationMessage
      if (deleteError) {
        error(t('settings.deleteModelFailed'), { description: deleteError })
        return
      }
      info(t('settings.modelDeleted'))
    } finally {
      setDeletingId(null)
    }
  }

  const handleChoosePath = async (): Promise<void> => {
    const path = await chooseStoragePath()
    const pathError = useSettingsStore.getState().storagePathError
    if (pathError) {
      error(t('settings.choosePathFailed'), { description: pathError })
      return
    }
    if (path) {
      setVerificationMessage(null)
      await saveSettings({ storagePath: path })
      const saveError = useSettingsStore.getState().verificationMessage
      if (saveError) {
        error(t('settings.saveFailed'), { description: saveError })
        return
      }
      setStoragePath(path)
      info(t('settings.storagePathUpdated'), { description: path })
    }
  }

  const toggleEngine = (engine: string, checked: boolean): void => {
    setWebSearchEngines((current) => {
      if (checked) {
        return current.includes(engine) ? current : [...current, engine]
      }
      return current.filter((item) => item !== engine)
    })
  }

  const handleInstallWebSearch = async (): Promise<void> => {
    const installed = await installWebSearchService()
    if (installed) {
      success(lang === 'en' ? 'Web search service installed' : '联网搜索服务已安装', {
        description:
          lang === 'en'
            ? 'You can start the service now.'
            : '现在可以继续启动服务。'
      })
      return
    }
    error(lang === 'en' ? 'Failed to install web search service' : '联网搜索服务安装失败', {
      description:
        webSearchError || (lang === 'en' ? t('common.retryLater') : '请稍后重试。')
    })
  }

  const handleStartWebSearch = async (): Promise<void> => {
    const started = await startWebSearchService()
    if (started) {
      success(lang === 'en' ? 'Web search service started' : '联网搜索服务已启动', {
        description:
          lang === 'en'
            ? 'The home page can enable web search now.'
            : '首页现在可以开启联网搜索。'
      })
      return
    }
    error(lang === 'en' ? 'Failed to start web search service' : '联网搜索服务启动失败', {
      description:
        webSearchError || (lang === 'en' ? t('common.retryLater') : '请稍后重试。')
    })
  }

  const handleSaveWebSearch = async (): Promise<void> => {
    const normalizedLimit = Number.parseInt(webSearchLimit.trim(), 10)
    if (!Number.isFinite(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 20) {
      warning(lang === 'en' ? 'Enter a result limit between 1 and 20' : '请填写 1-20 之间的搜索结果数量')
      return
    }
    if (!webSearchEngines.length) {
      warning(lang === 'en' ? 'Select at least one search engine' : '请至少选择一个联网搜索引擎')
      return
    }
    if (webSearchUseProxy && !webSearchProxyUrl.trim()) {
      warning(lang === 'en' ? 'Enter a proxy URL' : '请填写代理地址')
      return
    }

    await saveSettings({
      webSearch: {
        engines: webSearchEngines,
        limit: normalizedLimit,
        useProxy: webSearchUseProxy,
        proxyUrl: webSearchProxyUrl.trim()
      }
    })
    const saveError = useSettingsStore.getState().verificationMessage
    if (saveError) {
      error(t('settings.saveFailed'), { description: saveError })
      return
    }
    success(t('settings.saved'), {
      description:
        lang === 'en'
          ? 'Web search configuration has been written locally'
          : '联网搜索配置已写入本地'
    })
  }

  const serviceStatus = settings?.webSearch?.serviceStatus
  const serviceBadge = serviceStatus?.running
    ? {
        label: lang === 'en' ? 'Running' : '运行中',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }
    : serviceStatus?.installed
      ? {
          label: lang === 'en' ? 'Installed' : '已安装',
          className: 'bg-amber-50 text-amber-700 border-amber-200'
        }
      : {
          label: lang === 'en' ? 'Not installed' : '未安装',
          className: 'bg-slate-100 text-slate-600 border-slate-200'
        }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {t('settings.eyebrow')}
        </p>
        <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">
          {t('settings.title')}
        </h1>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">{t('settings.generalTab')}</TabsTrigger>
          <TabsTrigger value="model">{t('settings.modelTab')}</TabsTrigger>
          <TabsTrigger value="advanced">{t('settings.advancedTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.interface')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('settings.language')}</label>
                <Select value={lang} onValueChange={(v) => setLang(v === 'en' ? 'en' : 'zh')}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder={t('settings.languagePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh">{t('settings.chinese')}</SelectItem>
                    <SelectItem value="en">{t('settings.english')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.storage')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {t('settings.storagePath')}
                </label>
                <div className="flex gap-2">
                  <Input
                    value={storagePath}
                    readOnly
                    placeholder={t('settings.storagePlaceholder')}
                    className="h-10 min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    onClick={handleChoosePath}
                    className="h-10 min-w-[96px] shrink-0 rounded-lg border border-[#7ea06f]/45 px-4"
                  >
                    <FolderSearch className="mr-1.5 h-4 w-4" />
                    {t('settings.choose')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.storageHint')}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model">
          <Card className="mb-4">
            <CardHeader className="flex-row items-center justify-between p-5 pb-3">
              <div>
                <CardTitle className="text-base">{t('settings.modelAccess')}</CardTitle>
                {activeModelConfig && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('settings.currentActiveModel', { name: activeModelConfig.name })}
                  </p>
                )}
              </div>
              <Button size="sm" onClick={openCreateModelDialog}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t('settings.addModel')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2.5 p-5 pt-0">
              {modelConfigs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#d8ccb5]/85 bg-[#fff9ef]/70 p-6 text-sm text-muted-foreground">
                  {t('settings.noModels')}
                </div>
              ) : (
                modelConfigs.map((config) => (
                  <div
                    key={config.id}
                    className={
                      config.active
                        ? 'flex flex-col gap-3 rounded-lg border border-[#96b77f]/80 bg-[#eef6e8] p-3 shadow-[inset_3px_0_0_#6f8f64] sm:flex-row sm:items-center sm:justify-between'
                        : 'flex flex-col gap-3 rounded-lg border border-[#d8ccb5]/80 bg-[#fffdf8]/78 p-3 sm:flex-row sm:items-center sm:justify-between'
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {config.active && <CheckCircle2 className="h-4 w-4 text-[#5d7b4d]" />}
                        <p className="font-medium text-[#33402a]">{config.name}</p>
                        <span className="rounded-full bg-[#e9efde] px-2 py-0.5 text-[11px] uppercase text-[#506141]">
                          {config.provider}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{config.model}</p>
                      {config.baseUrl && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {config.baseUrl}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={config.active ? 'secondary' : 'outline'}
                        disabled={config.active || activatingId === config.id}
                        onClick={() => void handleActivateModel(config.id)}
                      >
                        {config.active ? t('settings.activeModel') : t('settings.activateModel')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEditModelDialog(config)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deletingId === config.id}
                        onClick={() => void handleDeleteModel(config)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advanced">
          <Card className="mb-4">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.timeoutSection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <p className="text-xs text-muted-foreground">{t('settings.timeoutHint')}</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {timeoutFields.map((field) => (
                  <div key={field.profile}>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {field.label}
                    </label>
                    <Input
                      type="number"
                      min={field.min}
                      max={3600}
                      step={30}
                      placeholder={t('settings.timeoutPlaceholder')}
                      value={timeoutSeconds[field.profile]}
                      onChange={(e) => handleTimeoutChange(field.profile, e.target.value)}
                      className="h-10"
                    />
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {field.hint}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">
                {lang === 'en' ? 'Web search' : '联网搜索'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-[#5d6b4d]" />
                  <span className="text-sm font-medium">open-websearch</span>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${serviceBadge.className}`}>
                  {serviceBadge.label}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void refreshWebSearchServiceStatus()
                  }}
                  disabled={webSearchBusy}
                  className="h-10 rounded-lg border border-[#7ea06f]/45"
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  {lang === 'en' ? 'Refresh' : '刷新状态'}
                </Button>
                {!serviceStatus?.installed ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void handleInstallWebSearch()
                    }}
                    disabled={webSearchBusy}
                    className="h-10 rounded-lg border border-[#7ea06f]/45"
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    {lang === 'en' ? 'Install' : '一键安装'}
                  </Button>
                ) : null}
                {serviceStatus?.installed && !serviceStatus.running ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void handleStartWebSearch()
                    }}
                    disabled={webSearchBusy}
                    className="h-10 rounded-lg border border-[#7ea06f]/45"
                  >
                    <Play className="mr-1.5 h-4 w-4" />
                    {lang === 'en' ? 'Start' : '一键启动'}
                  </Button>
                ) : null}
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p>URL: {serviceStatus?.daemonUrl || 'http://127.0.0.1:3210'}</p>
                {serviceStatus?.installSource === 'workspace' ? (
                  <p>
                    {lang === 'en'
                      ? 'Using open-webSearch-main from the workspace.'
                      : '当前使用工作区内的 open-webSearch-main。'}
                  </p>
                ) : null}
                {serviceStatus?.installSource === 'managed' ? (
                  <p>
                    {lang === 'en'
                      ? 'Using the app-managed open-websearch service.'
                      : '当前使用应用托管安装的 open-websearch 服务。'}
                  </p>
                ) : null}
                {webSearchError ? <p className="text-destructive">{webSearchError}</p> : null}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  {lang === 'en' ? 'Search engines' : '搜索引擎'}
                </label>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {WEB_SEARCH_ENGINE_OPTIONS.map((engine) => (
                    <label
                      key={engine.value}
                      className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={webSearchEngines.includes(engine.value)}
                        onChange={(e) => toggleEngine(engine.value, e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary"
                      />
                      <span>{engine.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  {lang === 'en' ? 'Result limit' : '返回结果数量'}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={webSearchLimit}
                  onChange={(e) => {
                    const next = e.target.value
                    if (next === '' || /^\d+$/.test(next)) {
                      setWebSearchLimit(next)
                    }
                  }}
                  onBlur={() => {
                    const parsed = Number.parseInt(webSearchLimit || '20', 10)
                    const normalized =
                      Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 20
                    setWebSearchLimit(String(normalized))
                  }}
                />
              </div>

              <label className="flex items-start gap-3 rounded-md border border-border/70 px-4 py-3">
                <input
                  type="checkbox"
                  checked={webSearchUseProxy}
                  onChange={(e) => setWebSearchUseProxy(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border text-primary"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    {lang === 'en'
                      ? 'Use proxy when starting the service'
                      : '启动搜索服务时使用代理'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {lang === 'en'
                      ? 'One-click start injects USE_PROXY and PROXY_URL environment variables.'
                      : '一键启动时会注入 USE_PROXY 和 PROXY_URL 环境变量。'}
                  </span>
                </span>
              </label>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  {lang === 'en' ? 'Proxy URL' : '代理地址'}
                </label>
                <Input
                  placeholder="http://127.0.0.1:7897"
                  value={webSearchProxyUrl}
                  onChange={(e) => setWebSearchProxyUrl(e.target.value)}
                  disabled={!webSearchUseProxy}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {lang === 'en'
                    ? 'When a VPN or proxy tool is enabled, such as Clash Verge, the web search service may need a local HTTP proxy port here.'
                    : '开启 VPN 或代理工具时，例如使用 Clash Verge，联网搜索服务可能需要在这里填写本地 HTTP 代理端口。'}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void handleSaveWebSearch()
              }}
              disabled={webSearchBusy}
            >
              {lang === 'en' ? 'Save web search' : '保存联网搜索配置'}
            </Button>
            <Button onClick={handleSaveTimeouts} disabled={savingTimeouts}>
              {savingTimeouts ? t('common.saving') : t('settings.saveTimeouts')}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {modelDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d291f]/42 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingModel) {
              setModelDialogOpen(false)
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d8ccb5]/85 bg-[#fffaf1] shadow-[0_24px_70px_rgba(53,44,32,0.28)]">
            <div className="flex items-center justify-between border-b border-[#e3d8c5] px-5 py-4">
              <h2 className="text-base font-semibold text-[#33402a]">
                {modelForm.id ? t('settings.editModel') : t('settings.addModel')}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setModelDialogOpen(false)}
                disabled={savingModel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    {t('settings.modelName')}
                  </label>
                  <Input
                    value={modelForm.name}
                    onChange={(e) => updateModelForm({ name: e.target.value })}
                    placeholder={t('settings.modelNamePlaceholder')}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    {t('settings.providerPreset')}
                  </label>
                  <Select
                    value={modelForm.provider}
                    onValueChange={(value) =>
                      updateModelForm({ provider: value === 'anthropic' ? 'anthropic' : 'openai' })
                    }
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder={t('settings.providerPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anthropic">Claude (Anthropic)</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">model</label>
                <Input
                  placeholder={t('settings.modelPlaceholder')}
                  value={modelForm.model}
                  onChange={(e) => updateModelForm({ model: e.target.value })}
                  className="h-10"
                />
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.modelHint')}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">base_url</label>
                <Input
                  placeholder={t('settings.baseUrlPlaceholder')}
                  value={modelForm.baseUrl}
                  onChange={(e) => updateModelForm({ baseUrl: e.target.value })}
                  className="h-10"
                />
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.baseUrlHint')}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">api_key</label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={t('settings.apiKeyPlaceholder', {
                      provider: modelForm.provider === 'openai' ? 'OpenAI' : 'Claude'
                    })}
                    value={modelForm.apiKey}
                    onChange={(e) => updateModelForm({ apiKey: e.target.value })}
                    className="h-10 min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    onClick={handleVerify}
                    disabled={verifying}
                    className="h-10 min-w-[96px] shrink-0 rounded-lg border border-[#7ea06f]/45 px-4"
                  >
                    <ShieldCheck className="mr-1.5 h-4 w-4" />
                    {verifying ? t('settings.verifying') : t('settings.verify')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.verifyHint')}</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[#e3d8c5] px-5 py-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setModelDialogOpen(false)}
                disabled={savingModel}
              >
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveModel} disabled={savingModel}>
                {savingModel ? t('common.saving') : t('settings.saveModel')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
