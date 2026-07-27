import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '@renderer/i18n'
import { useSettingsStore, useToastStore } from '@renderer/store'
import type { ModelConfig } from '@renderer/lib/ipc'

export interface ModelActionState {
  modelConfigs: ModelConfig[]
  selectedModelConfigId: string
  activatingModelConfigId: string | null
  hasMultipleModelConfigs: boolean
  currentModelConfig: ModelConfig | null
  ensureModelActive: (modelConfigId?: string) => Promise<string | null>
}

export function useModelAction(): ModelActionState {
  const t = useT()
  const navigate = useNavigate()
  const { error: toastError, warning: toastWarning } = useToastStore()
  const { modelConfigs, fetchSettings } = useSettingsStore()
  const [selectedModelConfigId, setSelectedModelConfigId] = useState('')
  const [activatingModelConfigId, setActivatingModelConfigId] = useState<string | null>(null)

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    setSelectedModelConfigId((current) => {
      if (current && modelConfigs.some((config) => config.id === current)) return current
      return modelConfigs.find((config) => config.active)?.id || modelConfigs[0]?.id || ''
    })
  }, [modelConfigs])

  const ensureModelActive = useCallback(
    async (modelConfigId = selectedModelConfigId): Promise<string | null> => {
      const warnModelSettingsRequired = (): void => {
        toastWarning(t('settings.modelSettingsRequiredTitle'), {
          description: t('settings.modelSettingsRequiredDescription'),
          action: {
            label: t('home.goToSettings'),
            onClick: () => navigate('/settings')
          }
        })
      }
      if (activatingModelConfigId) return null

      let latestConfigs = useSettingsStore.getState().modelConfigs
      if (latestConfigs.length === 0) {
        await fetchSettings()
        latestConfigs = useSettingsStore.getState().modelConfigs
      }

      const nextModelConfigId =
        modelConfigId ||
        selectedModelConfigId ||
        latestConfigs.find((config) => config.active)?.id ||
        latestConfigs[0]?.id ||
        ''
      if (!nextModelConfigId) {
        warnModelSettingsRequired()
        return null
      }

      const selected =
        latestConfigs.find((config) => config.id === nextModelConfigId) ||
        modelConfigs.find((config) => config.id === nextModelConfigId)
      if (!selected) {
        warnModelSettingsRequired()
        return null
      }
      if (!selected.model.trim() || !selected.apiKey.trim() || !selected.baseUrl.trim()) {
        warnModelSettingsRequired()
        return null
      }

      const previousModelConfigId = selectedModelConfigId
      setSelectedModelConfigId(nextModelConfigId)
      setActivatingModelConfigId(nextModelConfigId)
      try {
        return nextModelConfigId
      } catch (error) {
        setSelectedModelConfigId(previousModelConfigId)
        toastError(t('settings.activateModelFailed'), {
          description: error instanceof Error ? error.message : String(error)
        })
        return null
      } finally {
        setActivatingModelConfigId(null)
      }
    },
    [
      activatingModelConfigId,
      fetchSettings,
      modelConfigs,
      navigate,
      selectedModelConfigId,
      t,
      toastError,
      toastWarning
    ]
  )

  const currentModelConfig = useMemo(
    () => modelConfigs.find((config) => config.id === selectedModelConfigId) || null,
    [modelConfigs, selectedModelConfigId]
  )

  return {
    modelConfigs,
    selectedModelConfigId,
    activatingModelConfigId,
    hasMultipleModelConfigs: modelConfigs.length > 1,
    currentModelConfig,
    ensureModelActive
  }
}
