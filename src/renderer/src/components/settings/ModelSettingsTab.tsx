import { CheckCircle2, CircleHelp, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ModelConfig } from '../../lib/ipc'
import { Button } from '../ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover'
import type { SettingsTranslate } from './types'

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

interface ModelSettingsTabProps {
  activeModelConfig?: ModelConfig
  activatingId: string | null
  deletingId: string | null
  modelConfigs: ModelConfig[]
  t: SettingsTranslate
  onActivate: (id: string) => void
  onCreate: () => void
  onDelete: (config: ModelConfig) => void
  onEdit: (config: ModelConfig) => void
}

export function ModelSettingsTab({
  activeModelConfig,
  activatingId,
  deletingId,
  modelConfigs,
  t,
  onActivate,
  onCreate,
  onDelete,
  onEdit
}: ModelSettingsTabProps): React.JSX.Element {
  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between p-5 pb-3">
        <div>
          <CardTitle className="flex items-center gap-1.5 text-base">
            {t('settings.modelAccess')}
            <Popover>
              <PopoverTrigger asChild>
                <CircleHelp className="h-3.5 w-3.5 cursor-pointer text-muted-foreground/50 transition-colors hover:text-foreground" />
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="start"
                className="w-auto max-w-xs border-[#d8cfbc]/80 bg-[#fffdf8] p-3"
              >
                <p className="mb-2 text-[11px] font-semibold text-[#3e4a32]">
                  {t('settings.modelHelpTitle')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {MODEL_PROVIDER_LINKS.map((item) => (
                    <a
                      key={item.url}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-[#d8cfbc]/80 bg-[#f5efe2]/60 px-2 py-1 text-[11px] text-[#5b6b4d] transition-colors hover:border-[#96b77f]/60 hover:bg-[#e8f0de] hover:text-[#3e4a32]"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <a
              href="https://www.ohmyppt.cc/#/model-doc"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-xs font-medium text-[#2f7f8f] underline-offset-4 transition-colors hover:text-[#1f6472] hover:underline"
            >
              {t('settings.modelHelpDocs')}
            </a>
          </CardTitle>
          {activeModelConfig && (
            <span className="mt-2 inline-flex max-w-full truncate rounded-full border border-[#96b77f]/55 bg-[#eef6e8] px-2.5 py-1 text-xs font-medium text-[#4f6b45]">
              {t('settings.currentActiveModel', { name: activeModelConfig.name })}
            </span>
          )}
        </div>
        <Button size="sm" onClick={onCreate}>
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
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{config.baseUrl}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={config.active ? 'secondary' : 'outline'}
                  disabled={config.active || activatingId === config.id}
                  onClick={() => onActivate(config.id)}
                >
                  {config.active ? t('settings.activeModel') : t('settings.activateModel')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onEdit(config)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deletingId === config.id}
                  onClick={() => onDelete(config)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
