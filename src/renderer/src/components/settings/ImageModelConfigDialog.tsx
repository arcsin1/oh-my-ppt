import { CircleHelp, ExternalLink, ShieldCheck, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { IMAGE_PROVIDER_OPTIONS } from './model-settings-utils'
import type { ImageModelForm, SettingsTranslate } from './types'

interface ImageModelConfigDialogProps {
  form: ImageModelForm
  open: boolean
  saving: boolean
  verifying: boolean
  t: SettingsTranslate
  onClose: () => void
  onFormChange: (patch: Partial<ImageModelForm>) => void
  onProviderChange: (value: string) => void
  onSave: () => void
  onVerify: () => void
}

const PROVIDER_DOCS: Record<ImageModelForm['provider'], { label: string; url: string }> = {
  agnes: {
    label: 'Agnes AI',
    url: 'https://agnes-ai.com/'
  },
  jimeng: {
    label: '即梦3.0',
    url: 'https://www.volcengine.com/docs/85621/1616429?lang=zh'
  },
  jimeng4: {
    label: '即梦4.0',
    url: 'https://www.volcengine.com/docs/85621/1817045?lang=zh'
  },
  seedream: {
    label: 'Seedream',
    url: 'https://www.volcengine.com/docs/82379/1541523?lang=zh'
  },
  siliconflow: {
    label: '硅基流动',
    url: 'https://www.siliconflow.cn/'
  },
  openaiCompatible: {
    label: 'OpenAI 兼容',
    url: 'https://platform.openai.com/docs/api-reference/chat/create'
  },
  openaiImages: {
    label: 'OpenAI Images API',
    url: 'https://developers.openai.com/api/docs/guides/image-generation'
  },
  gemini: {
    label: 'Gemini',
    url: 'https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn'
  }
}

const PROVIDER_HINT_KEYS: Record<ImageModelForm['provider'], Parameters<SettingsTranslate>[0]> = {
  agnes: 'settings.imageModelConfigHintAgnes',
  jimeng: 'settings.imageModelConfigHintJimeng',
  jimeng4: 'settings.imageModelConfigHintJimeng4',
  siliconflow: 'settings.imageModelConfigHintSiliconflow',
  openaiCompatible: 'settings.imageModelConfigHintOpenAICompatible',
  openaiImages: 'settings.imageModelConfigHintOpenAIImages',
  gemini: 'settings.imageModelConfigHintGemini',
  seedream: 'settings.imageModelConfigHintSeedream'
}

const SILICONFLOW_MODELS = [
  'Tongyi-MAI/Z-Image-Turbo',
  'Tongyi-MAI/Z-Image',
  'baidu/ERNIE-Image-Turbo',
  'Qwen/Qwen-Image',
  'Kwai-Kolors/Kolors'
]

export function ImageModelConfigDialog({
  form,
  open,
  saving,
  verifying,
  t,
  onClose,
  onFormChange,
  onProviderChange,
  onSave,
  onVerify
}: ImageModelConfigDialogProps): React.JSX.Element | null {
  if (!open) return null
  const providerDocs = PROVIDER_DOCS[form.provider]
  const providerHint = t(PROVIDER_HINT_KEYS[form.provider])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d291f]/42 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d8ccb5]/85 bg-[#fffaf1] shadow-[0_24px_70px_rgba(53,44,32,0.28)]">
        <div className="flex items-center justify-between border-b border-[#e3d8c5] px-4 py-2.5">
          <h2 className="text-sm font-semibold text-[#33402a]">
            {form.id ? t('settings.editImageModel') : t('settings.addImageModel')}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium">{t('settings.modelName')}</label>
              <Input
                value={form.name}
                onChange={(e) => onFormChange({ name: e.target.value })}
                placeholder={t('settings.imageModelNamePlaceholder')}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">
                {t('settings.providerPreset')}
              </label>
              <Select value={form.provider} onValueChange={onProviderChange}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={t('settings.providerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium">模型配置</label>
            <Textarea
              spellCheck={false}
              rows={6}
              value={form.modelConfig}
              onChange={(e) => onFormChange({ modelConfig: e.target.value })}
              className="min-h-[120px] resize-y font-mono text-xs leading-4"
            />
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-[#d8ccb5]/80 bg-[#f8f1e6]/82 px-2.5 py-2 text-xs text-[#5f5649]">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#eef0e5] text-[#687a58]">
                <CircleHelp className="h-3 w-3" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-[#33402a]">{providerDocs.label}</span>
                  <a
                    href={providerDocs.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-[#cbbfa8]/80 bg-[#fffaf1]/75 px-2 py-0.5 font-medium text-[#5d6b4d] transition-colors hover:border-[#aebd9a] hover:text-[#3e4a32]"
                  >
                    {t('settings.imageProviderOfficialDocs')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="mt-1 leading-4 text-[#6d604d]">{providerHint}</p>
                {form.provider === 'siliconflow' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {SILICONFLOW_MODELS.map((model) => (
                      <span
                        key={model}
                        className="rounded-md border border-[#d8ccb5]/78 bg-[#fffaf1]/72 px-2 py-0.5 font-mono text-[11px] text-[#526044]"
                      >
                        {model}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={onVerify}
              disabled={verifying}
              className="h-7 min-w-[72px] rounded-lg border border-[#7ea06f]/45 px-2.5 text-xs"
            >
              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
              {verifying ? t('settings.verifying') : t('settings.verify')}
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#e3d8c5] px-4 py-2.5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? t('common.saving') : t('settings.saveImageModel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
