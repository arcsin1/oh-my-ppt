import { CircleHelp, ShieldCheck, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import type { ModelForm, SettingsTranslate } from './types'

const MODEL_PROVIDER_LINKS = [
  { label: 'DeepSeek', url: 'https://platform.deepseek.com' },
  { label: 'Moonshot (Kimi)', url: 'https://platform.moonshot.cn' },
  { label: 'GLM (智谱)', url: 'https://open.bigmodel.cn' },
  { label: 'Qwen (通义千问)', url: 'https://bailian.console.aliyun.com/' },
  { label: 'Doubao (豆包)', url: 'https://console.volcengine.com/ark' },
  { label: 'Mimo (小米)', url: 'https://platform.xiaomimimo.com' },
  { label: 'MiniMax', url: 'https://www.minimaxi.com/' },
  { label: 'OpenAI', url: 'https://platform.openai.com' },
  { label: 'Claude (Anthropic)', url: 'https://console.anthropic.com' },
  { label: 'Google Gemini', url: 'https://ai.google.dev' },
  { label: 'OrcaRouter', url: 'https://www.orcarouter.ai' }
]

interface ModelConfigDialogProps {
  form: ModelForm
  open: boolean
  saving: boolean
  verified: boolean
  verifying: boolean
  t: SettingsTranslate
  onClose: () => void
  onFormChange: (patch: Partial<ModelForm>) => void
  onSave: () => void
  onVerify: () => void
}

export function ModelConfigDialog({
  form,
  open,
  saving,
  verified,
  verifying,
  t,
  onClose,
  onFormChange,
  onSave,
  onVerify
}: ModelConfigDialogProps): React.JSX.Element | null {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d291f]/42 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#d8ccb5]/85 bg-[#fffaf1] shadow-[0_24px_70px_rgba(53,44,32,0.28)]">
        <div className="flex items-center justify-between border-b border-[#e3d8c5] px-5 py-3.5">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-[#33402a]">
            {form.id ? t('settings.editModel') : t('settings.addModel')}
            <Popover>
              <PopoverTrigger asChild>
                <CircleHelp className="h-3.5 w-3.5 cursor-pointer text-muted-foreground/50 transition-colors hover:text-foreground" />
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="start"
                className="w-auto max-w-xs border-[#d8cfbc]/80 bg-[#fffdf8] p-3"
              >
                <p className="mb-2 text-xs font-semibold text-[#3e4a32]">
                  {t('settings.modelHelpTitle')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {MODEL_PROVIDER_LINKS.map((item) => (
                    <a
                      key={item.url}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-[#d8cfbc]/80 bg-[#f5efe2]/60 px-2 py-1 text-xs text-[#5b6b4d] transition-colors hover:border-[#96b77f]/60 hover:bg-[#e8f0de] hover:text-[#3e4a32]"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3 p-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('settings.providerPreset')}
              </label>
              <Select
                value={form.provider}
                onValueChange={(value) =>
                  onFormChange({
                    provider:
                      value === 'anthropic' ||
                      value === 'google' ||
                      value === 'openai-responses' ||
                      value === 'orcarouter'
                        ? value
                        : 'openai',
                    ...(value === 'orcarouter'
                      ? {
                          baseUrl: 'https://api.orcarouter.ai/v1',
                          model: 'orcarouter/auto'
                        }
                      : {})
                  })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={t('settings.providerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Claude (Anthropic)</SelectItem>
                  <SelectItem value="openai">
                    {t('settings.providerOpenAIChatCompletions')}
                  </SelectItem>
                  <SelectItem value="openai-responses">
                    {t('settings.providerOpenAIResponses')}
                  </SelectItem>
                  <SelectItem value="orcarouter">OrcaRouter</SelectItem>
                  <SelectItem value="google">Google Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('settings.modelName')}</label>
              <Input
                value={form.name}
                onChange={(e) => onFormChange({ name: e.target.value })}
                placeholder={t('settings.modelNamePlaceholder')}
                className="h-8"
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">model</label>
              <Input
                placeholder={t('settings.modelPlaceholder')}
                value={form.model}
                onChange={(e) => onFormChange({ model: e.target.value })}
                className="h-8"
              />
              <p className="mt-1 text-[12px] text-muted-foreground/50">
                {t('settings.modelHint')}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">base_url</label>
              <Input
                placeholder={t('settings.baseUrlPlaceholder')}
                value={form.baseUrl}
                onChange={(e) => onFormChange({ baseUrl: e.target.value })}
                className="h-8"
              />
              <p className="mt-1 text-[12px] text-muted-foreground/50">
                {form.provider === 'google'
                  ? t('settings.baseUrlHintGoogle')
                  : t('settings.baseUrlHint')}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">api_key</label>
            <Input
              type="password"
              placeholder={t('settings.apiKeyPlaceholder', {
                provider:
                  form.provider === 'openai' || form.provider === 'openai-responses'
                    ? 'OpenAI'
                    : form.provider === 'orcarouter'
                      ? 'OrcaRouter'
                      : form.provider === 'google'
                        ? 'Google'
                        : 'Claude'
              })}
              value={form.apiKey}
              onChange={(e) => onFormChange({ apiKey: e.target.value })}
              className="h-8"
            />
            <p className="mt-1 text-[12px] text-muted-foreground/50">
              {t('settings.verifyHint')}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">max_tokens</label>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.maxTokens}
              onChange={(e) => onFormChange({ maxTokens: e.target.value })}
              className="h-8"
            />
            <p className="mt-1 text-[12px] text-muted-foreground/50">
              {t('settings.maxTokensHint')}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-[#e3d8c5] bg-[#fffdf8]/70 p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t('settings.disableTemperature')}</span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground/50">
                {t('settings.disableTemperatureHint')}
              </span>
            </span>
            <input
              type="checkbox"
              aria-label={t('settings.disableTemperature')}
              checked={form.disableTemperature}
              onChange={(event) =>
                onFormChange({ disableTemperature: event.currentTarget.checked })
              }
              className="h-4 w-4 shrink-0 cursor-pointer accent-[#5d7b4d]"
            />
          </div>

          {form.provider === 'openai' || form.provider === 'orcarouter' ? (
            <div className="rounded-lg border border-[#e3d8c5] bg-[#fffdf8]/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t('settings.thinkingParameterMode')}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground/50">
                    {t('settings.thinkingParameterModeHint')}
                  </span>
                </span>
                <Select
                  value={form.thinkingParameterMode}
                  onValueChange={(value) =>
                    onFormChange({
                      thinkingParameterMode: value === 'omit' ? 'omit' : 'auto'
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-full shrink-0 sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {t('settings.thinkingParameterModeAuto')}
                    </SelectItem>
                    <SelectItem value="omit">
                      {t('settings.thinkingParameterModeOmit')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#e3d8c5] px-5 py-3.5">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="h-8 px-3 text-xs"
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="secondary"
            onClick={onVerify}
            disabled={saving || verifying}
            className="h-8 border border-[#7ea06f]/45 px-3 text-xs"
          >
            <ShieldCheck className="mr-1 h-3.5 w-3.5" />
            {verifying ? t('settings.verifying') : t('settings.verify')}
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || verifying || !verified}
            className="h-8 px-3 text-xs"
          >
            {saving ? t('common.saving') : t('settings.saveModel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
