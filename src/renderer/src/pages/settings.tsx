import { useEffect, useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import { useLang } from '../i18n'
import type { ImageModelConfig, ImageModelProvider, ModelConfig } from '../lib/ipc'
import {
  CONFIGURABLE_MODEL_TIMEOUT_PROFILES,
  type ConfigurableModelTimeoutProfile,
  modelTimeoutMsToSeconds,
  resolveModelTimeoutMs
} from '@shared/model-timeout.js'
import { AdvancedSettingsTab } from '../components/settings/AdvancedSettingsTab'
import { GeneralSettingsTab } from '../components/settings/GeneralSettingsTab'
import { ImageModelConfigDialog } from '../components/settings/ImageModelConfigDialog'
import { ImageModelSettingsTab } from '../components/settings/ImageModelSettingsTab'
import { ModelConfigDialog } from '../components/settings/ModelConfigDialog'
import { ModelSettingsTab } from '../components/settings/ModelSettingsTab'
import {
  IMAGE_PROVIDER_OPTIONS,
  createDefaultImageModelConfig,
  createEmptyImageModelForm,
  createEmptyModelForm,
  createImageModelForm,
  createModelForm,
  createImageModelVerificationSignature,
  isImageModelVerificationCurrent,
  readJsonObject,
  stringifyJsonObject
} from '../components/settings/model-settings-utils'
import type { ImageModelForm, ModelForm } from '../components/settings/types'

const createTimeoutSeconds = (
  timeouts?: Partial<Record<ConfigurableModelTimeoutProfile, number>>
): Record<ConfigurableModelTimeoutProfile, string> =>
  Object.fromEntries(
    CONFIGURABLE_MODEL_TIMEOUT_PROFILES.map((profile) => [
      profile,
      String(modelTimeoutMsToSeconds(timeouts?.[profile], profile))
    ])
  ) as Record<ConfigurableModelTimeoutProfile, string>

const normalizeModelMaxTokens = (value: string): number => {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return 4096
  return Math.max(256, Math.min(16384, Math.floor(parsed)))
}

const createModelVerificationSignature = (form: ModelForm): string =>
  JSON.stringify({
    provider: form.provider,
    model: form.model.trim(),
    apiKey: form.apiKey.trim(),
    baseUrl: form.baseUrl.trim(),
    maxTokens: normalizeModelMaxTokens(form.maxTokens),
    disableTemperature: form.disableTemperature,
    thinkingParameterMode: form.thinkingParameterMode
  })

export function SettingsPage(): React.JSX.Element {
  const {
    modelConfigs,
    imageModelConfigs,
    fetchSettings,
    saveSettings,
    upsertModelConfig,
    upsertImageModelConfig,
    setActiveModelConfig,
    setActiveImageModelConfig,
    deleteModelConfig,
    deleteImageModelConfig,
    setVerificationMessage,
    verifyApiKey,
    verifyImageModel,
    chooseStoragePath
  } = useSettingsStore()
  const { success, error, warning, info } = useToastStore()
  const { lang, setLang, t } = useLang()
  const [storagePath, setStoragePath] = useState(
    () => useSettingsStore.getState().settings?.storagePath || ''
  )
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [modelForm, setModelForm] = useState<ModelForm>(() => createEmptyModelForm())
  const [imageModelDialogOpen, setImageModelDialogOpen] = useState(false)
  const [imageModelForm, setImageModelForm] = useState<ImageModelForm>(() =>
    createEmptyImageModelForm()
  )
  const [timeoutSeconds, setTimeoutSeconds] = useState<
    Record<ConfigurableModelTimeoutProfile, string>
  >(() => createTimeoutSeconds(useSettingsStore.getState().settings?.timeouts))
  const [savingModel, setSavingModel] = useState(false)
  const [verifiedModelSignature, setVerifiedModelSignature] = useState<string | null>(null)
  const [verifiedImageModelSignature, setVerifiedImageModelSignature] = useState<string | null>(null)
  const [savingTimeouts, setSavingTimeouts] = useState(false)
  const [proxyUrl, setProxyUrl] = useState(
    () => useSettingsStore.getState().settings?.proxyUrl || ''
  )
  const [verifying, setVerifying] = useState(false)
  const [verifyingImageModel, setVerifyingImageModel] = useState(false)
  const [imageVerificationPreviewUrl, setImageVerificationPreviewUrl] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [activatingImageId, setActivatingImageId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const loadSettings = async (): Promise<void> => {
      await fetchSettings()
      if (!active) return
      const nextSettings = useSettingsStore.getState().settings
      setStoragePath(nextSettings?.storagePath || '')
      setTimeoutSeconds(createTimeoutSeconds(nextSettings?.timeouts))
      setProxyUrl(nextSettings?.proxyUrl || '')
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
  const activeImageModelConfig = imageModelConfigs.find((config) => config.active)
  const modelVerificationSignature = createModelVerificationSignature(modelForm)
  const modelVerified = verifiedModelSignature === modelVerificationSignature
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
    setVerifiedModelSignature(null)
    setVerificationMessage(null)
    setModelDialogOpen(true)
  }

  const openEditModelDialog = (config: ModelConfig): void => {
    setModelForm(createModelForm(config))
    setVerifiedModelSignature(null)
    setVerificationMessage(null)
    setModelDialogOpen(true)
  }

  const updateModelForm = (patch: Partial<ModelForm>): void => {
    setModelForm((form) => ({ ...form, ...patch }))
    setVerificationMessage(null)
  }

  const openCreateImageModelDialog = (): void => {
    setImageModelForm(createEmptyImageModelForm(imageModelConfigs.length === 0))
    setImageVerificationPreviewUrl(null)
    setVerifiedImageModelSignature(null)
    setVerificationMessage(null)
    setImageModelDialogOpen(true)
  }

  const openEditImageModelDialog = (config: ImageModelConfig): void => {
    setImageModelForm(createImageModelForm(config))
    setImageVerificationPreviewUrl(null)
    setVerifiedImageModelSignature(null)
    setVerificationMessage(null)
    setImageModelDialogOpen(true)
  }

  const updateImageModelForm = (patch: Partial<ImageModelForm>): void => {
    setImageModelForm((form) => ({ ...form, ...patch }))
    if (patch.provider !== undefined || patch.modelConfig !== undefined) {
      setImageVerificationPreviewUrl(null)
      setVerifiedImageModelSignature(null)
    }
    setVerificationMessage(null)
  }

  const handleImageProviderChange = (value: string): void => {
    if (!IMAGE_PROVIDER_OPTIONS.some((item) => item.value === value)) return
    const provider = value as ImageModelProvider
    setImageModelForm((form) => ({
      ...form,
      provider,
      modelConfig:
        provider !== form.provider ? createDefaultImageModelConfig(provider) : form.modelConfig
    }))
    setImageVerificationPreviewUrl(null)
    setVerifiedImageModelSignature(null)
    setVerificationMessage(null)
  }

  const normalizeImageModelConfigForSave = (): string | null => {
    const modelConfig = readJsonObject(imageModelForm.modelConfig)
    return modelConfig ? stringifyJsonObject(modelConfig) : null
  }

  const imageModelConfigForVerification = normalizeImageModelConfigForSave()
  const imageModelVerified = isImageModelVerificationCurrent(
    verifiedImageModelSignature,
    imageModelForm.provider,
    imageModelConfigForVerification
  )

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
    if (!modelVerified) {
      warning(t('settings.verifyBeforeSave'))
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
        maxTokens: normalizeModelMaxTokens(modelForm.maxTokens),
        disableTemperature: modelForm.disableTemperature,
        thinkingParameterMode: modelForm.thinkingParameterMode,
        active: modelForm.active
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (!id || saveError) {
        error(t('settings.saveFailed'), { description: saveError || t('common.retryLater') })
        return
      }
      setModelDialogOpen(false)
      setVerifiedModelSignature(null)
      success(t('settings.modelSaved'), { description: t('settings.modelSavedDescription') })
    } finally {
      setSavingModel(false)
    }
  }

  const handleSaveImageModel = async (): Promise<void> => {
    if (!imageModelForm.name.trim()) {
      warning(t('settings.fillModelName'))
      return
    }
    const modelConfig = normalizeImageModelConfigForSave()
    if (!modelConfig) {
      warning(t('settings.fillImageModelConfig'))
      return
    }
    if (!imageModelVerified) {
      warning(t('settings.verifyImageBeforeSave'))
      return
    }

    setSavingModel(true)
    setVerificationMessage(null)
    try {
      const id = await upsertImageModelConfig({
        id: imageModelForm.id,
        name: imageModelForm.name.trim(),
        provider: imageModelForm.provider,
        active: imageModelForm.active,
        modelConfig
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (!id || saveError) {
        error(t('settings.saveFailed'), { description: saveError || t('common.retryLater') })
        return
      }
      setImageModelDialogOpen(false)
      setVerifiedImageModelSignature(null)
      success(t('settings.imageModelSaved'), {
        description: t('settings.imageModelSavedDescription')
      })
    } finally {
      setSavingModel(false)
    }
  }

  const handleTimeoutChange = (profile: ConfigurableModelTimeoutProfile, value: string): void => {
    setTimeoutSeconds((current) => ({
      ...current,
      [profile]: value
    }))
    setVerificationMessage(null)
  }

  const handleSaveAdvanced = async (): Promise<void> => {
    const timeoutEntries = timeoutFields.map((field) => {
      const value = timeoutSeconds[field.profile].trim()
      const num = Number(value)
      return { field, num, value }
    })
    const invalidTimeout = timeoutEntries.find(({ field, num, value }) => {
      return !value || !Number.isFinite(num) || num < field.min || num > 3600
    })
    if (invalidTimeout) {
      warning(`${invalidTimeout.field.label}: ${t('settings.timeoutPlaceholder')}`)
      return
    }

    setSavingTimeouts(true)
    setVerificationMessage(null)
    try {
      await saveSettings({
        timeouts: Object.fromEntries(
          timeoutEntries.map(({ field, num }) => [field.profile, Math.round(num) * 1000])
        ) as Record<ConfigurableModelTimeoutProfile, number>,
        proxyUrl: proxyUrl.trim()
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (saveError) {
        error(t('settings.saveFailed'), { description: saveError })
        return
      }
      success(t('settings.saved'), {
        description: t('settings.savedDescription')
      })
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
    setVerifiedModelSignature(null)
    const nextVerifiedSignature = createModelVerificationSignature(modelForm)
    try {
      const valid = await verifyApiKey(
        modelForm.provider,
        modelForm.apiKey,
        modelForm.model,
        modelForm.baseUrl,
        normalizeModelMaxTokens(modelForm.maxTokens),
        modelForm.disableTemperature,
        modelForm.thinkingParameterMode,
        resolveModelTimeoutMs(undefined, 'verify')
      )
      const verifyMessage = useSettingsStore.getState().verificationMessage
      if (valid) {
        setVerifiedModelSignature(nextVerifiedSignature)
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

  const handleVerifyImageModel = async (): Promise<void> => {
    const modelConfig = normalizeImageModelConfigForSave()
    if (!modelConfig) {
      warning(t('settings.fillImageModelConfig'))
      return
    }

    setVerifyingImageModel(true)
    setImageVerificationPreviewUrl(null)
    setVerifiedImageModelSignature(null)
    setVerificationMessage(null)
    const verificationSignature = createImageModelVerificationSignature(
      imageModelForm.provider,
      modelConfig
    )
    try {
      const result = await verifyImageModel(
        imageModelForm.provider,
        modelConfig
      )
      if (result.valid && result.previewDataUrl) {
        setImageVerificationPreviewUrl(result.previewDataUrl)
        setVerifiedImageModelSignature(verificationSignature)
        success(t('settings.imageVerifyPassed'), {
          description: result.message || t('settings.imageVerifyPassedDescription')
        })
      } else {
        error(t('settings.imageVerifyFailed'), {
          description: result.message || t('settings.imageVerifyFailedDescription')
        })
      }
    } finally {
      setVerifyingImageModel(false)
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

  const handleActivateImageModel = async (id: string): Promise<void> => {
    setActivatingImageId(id)
    setVerificationMessage(null)
    try {
      await setActiveImageModelConfig(id)
      const activateError = useSettingsStore.getState().verificationMessage
      if (activateError) {
        error(t('settings.activateImageModelFailed'), { description: activateError })
        return
      }
      success(t('settings.activeImageModelUpdated'))
    } finally {
      setActivatingImageId(null)
    }
  }

  const handleDeleteImageModel = async (config: ImageModelConfig): Promise<void> => {
    if (!window.confirm(t('settings.deleteModelConfirm', { name: config.name }))) return
    setDeletingImageId(config.id)
    setVerificationMessage(null)
    try {
      await deleteImageModelConfig(config.id)
      const deleteError = useSettingsStore.getState().verificationMessage
      if (deleteError) {
        error(t('settings.deleteImageModelFailed'), { description: deleteError })
        return
      }
      info(t('settings.imageModelDeleted'))
    } finally {
      setDeletingImageId(null)
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
          <TabsTrigger value="imageModel">{t('settings.imageModelTab')}</TabsTrigger>
          <TabsTrigger value="advanced">{t('settings.advancedTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralSettingsTab
            lang={lang}
            storagePath={storagePath}
            t={t}
            onChoosePath={() => void handleChoosePath()}
            onLangChange={setLang}
          />
        </TabsContent>

        <TabsContent value="model">
          <ModelSettingsTab
            activeModelConfig={activeModelConfig}
            activatingId={activatingId}
            deletingId={deletingId}
            modelConfigs={modelConfigs}
            t={t}
            onActivate={(configId) => void handleActivateModel(configId)}
            onCreate={openCreateModelDialog}
            onDelete={(config) => void handleDeleteModel(config)}
            onEdit={openEditModelDialog}
          />
        </TabsContent>

        <TabsContent value="imageModel">
          <ImageModelSettingsTab
            activeImageModelConfig={activeImageModelConfig}
            activatingImageId={activatingImageId}
            deletingImageId={deletingImageId}
            imageModelConfigs={imageModelConfigs}
            t={t}
            onActivate={(configId) => void handleActivateImageModel(configId)}
            onCreate={openCreateImageModelDialog}
            onDelete={(config) => void handleDeleteImageModel(config)}
            onEdit={openEditImageModelDialog}
          />
        </TabsContent>

        <TabsContent value="advanced">
          <AdvancedSettingsTab
            proxyUrl={proxyUrl}
            savingTimeouts={savingTimeouts}
            timeoutFields={timeoutFields}
            timeoutSeconds={timeoutSeconds}
            t={t}
            onProxyUrlChange={(value) => {
              setProxyUrl(value)
              setVerificationMessage(null)
            }}
            onSaveAdvanced={() => void handleSaveAdvanced()}
            onTimeoutChange={handleTimeoutChange}
          />
        </TabsContent>
      </Tabs>

      <ModelConfigDialog
        form={modelForm}
        open={modelDialogOpen}
        saving={savingModel}
        verifying={verifying}
        verified={modelVerified}
        t={t}
        onClose={() => setModelDialogOpen(false)}
        onFormChange={updateModelForm}
        onSave={() => void handleSaveModel()}
        onVerify={() => void handleVerify()}
      />

      <ImageModelConfigDialog
        form={imageModelForm}
        open={imageModelDialogOpen}
        saving={savingModel}
        verifying={verifyingImageModel}
        verified={imageModelVerified}
        verificationPreviewUrl={imageVerificationPreviewUrl}
        t={t}
        onClose={() => setImageModelDialogOpen(false)}
        onFormChange={updateImageModelForm}
        onProviderChange={handleImageProviderChange}
        onSave={() => void handleSaveImageModel()}
        onVerify={() => void handleVerifyImageModel()}
      />
    </div>
  )
}
