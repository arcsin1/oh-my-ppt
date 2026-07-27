import { useEffect, useState, type ReactElement } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useT } from '@renderer/i18n'
import type { SourceDocumentPlan } from '@shared/generation'
import type { ThinkingPrepareGenerationResult } from '@shared/thinking'
import { Building2, Sparkles } from 'lucide-react'
import { ModelSplitButton } from '../model/ModelActionButton'
import { useModelAction } from '@renderer/hooks/useModelAction'

const MIN_PAGE_COUNT = 3
const MAX_PAGE_COUNT = 50

const resolvePageCount = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10)
  const resolved = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(MAX_PAGE_COUNT, Math.max(MIN_PAGE_COUNT, resolved))
}

interface GenerationConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prepared: ThinkingPrepareGenerationResult | null
  onConfirm: (params: {
    topic: string
    pageCount: number
    referenceDocumentPath: string
    sourcePlan?: SourceDocumentPlan
    modelConfigId?: string
  }) => void
}

export function GenerationConfirmDialog({
  open,
  onOpenChange,
  prepared,
  onConfirm
}: GenerationConfirmDialogProps): ReactElement {
  const t = useT()
  const modelAction = useModelAction()
  const { selectedModelConfigId, ensureModelActive } = modelAction
  const [confirming, setConfirming] = useState(false)
  const [topic, setTopic] = useState('')
  const [pageCount, setPageCount] = useState('8')

  useEffect(() => {
    if (!prepared) return
    setTopic(prepared.topic)
    setPageCount(String(resolvePageCount(String(prepared.pageCount), 8)))
  }, [prepared])

  if (!prepared) return <></>

  const handleConfirm = async (modelConfigId = selectedModelConfigId): Promise<void> => {
    if (confirming) return
    const resolvedModelConfigId = await ensureModelActive(modelConfigId)
    if (!resolvedModelConfigId) return
    setConfirming(true)
    try {
      const resolvedPageCount = resolvePageCount(pageCount, prepared.pageCount)
      onConfirm({
        topic: topic.trim() || prepared.topic,
        pageCount: resolvedPageCount,
        referenceDocumentPath: prepared.thinkingDocumentPath,
        sourcePlan:
          prepared.sourcePlan?.pageSkeleton.length === resolvedPageCount
            ? prepared.sourcePlan
            : undefined,
        modelConfigId: resolvedModelConfigId
      })
      onOpenChange(false)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl border-[#ead9cd] bg-[#fffdf9]">
        <DialogHeader>
          <DialogTitle className="text-[#2e2926]">生成安居建业演示</DialogTitle>
          <DialogDescription className="text-[12px] text-[#786d66]">
            对话结论将自动套用公司标准模板，不提供外部样式、字体和画布选项。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#4a403b]">
              {t('home.topic')}
            </label>
            <Input value={topic} onChange={(event) => setTopic(event.target.value)} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#4a403b]">模板</label>
              <div className="flex h-9 items-center gap-2 rounded-md border border-[#ead9cd] bg-[#fff7f1] px-3 text-sm text-[#3b332f]">
                <Building2 className="h-4 w-4 text-[#e31921]" />
                安居建业标准模板 · 16:9
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#4a403b]">
                {t('home.pageCount')}
              </label>
              <Input
                className="text-center"
                inputMode="numeric"
                value={pageCount}
                onChange={(event) => {
                  const next = event.target.value
                  if (next === '' || /^\d+$/.test(next)) setPageCount(next)
                }}
                onBlur={() => setPageCount(String(resolvePageCount(pageCount, prepared.pageCount)))}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
          >
            {t('common.cancel')}
          </Button>
          <ModelSplitButton
            modelAction={modelAction}
            label={t('home.createAndStart')}
            loadingLabel={t('home.creating')}
            loading={confirming}
            icon={Sparkles}
            tone="primary"
            mainClassName="min-w-[156px] bg-[#e31921] hover:bg-[#c9161d]"
            onRun={handleConfirm}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
