import { Check, Loader2, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useT } from '@renderer/i18n'
import { useSessionDetailRuntimeStore } from '@renderer/store'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/Tooltip'

export function PrimaryActions({
  disabled,
  isSavingEdits,
  canUndo,
  canRedo,
  hasPendingEdits
}: {
  disabled: boolean
  isSavingEdits: boolean
  canUndo: boolean
  canRedo: boolean
  hasPendingEdits: boolean
}): React.JSX.Element {
  const t = useT()
  const actions = useSessionDetailRuntimeStore((state) => state.workspaceRibbonActions)

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#e5ddd2] bg-white px-1 py-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-6 shrink-0 items-center justify-center rounded-md px-2.5 text-[10px] font-semibold leading-none transition-colors disabled:pointer-events-none disabled:opacity-45',
              hasPendingEdits
                ? 'bg-[#e21b22] text-white hover:bg-[#ba1218]'
                : 'bg-[#faf8f3] text-[#aaa39a]'
            )}
            onClick={() => actions?.onSaveCurrentPage()}
            disabled={disabled || !hasPendingEdits}
            aria-label={t('sessionDetail.saveCurrentPageTooltip')}
          >
            {isSavingEdits ? (
              <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin text-current" />
            ) : (
              <Check className="mr-1 h-2.5 w-2.5 text-current" />
            )}
            {t('sessionDetail.saveCurrentPage')}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sessionDetail.saveCurrentPageTooltip')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-[22px] w-[22px] items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-45',
              hasPendingEdits
                ? 'text-[#c96a31] hover:bg-[#fff3e9] hover:text-[#9c4a1f]'
                : 'text-[#aaa39a]'
            )}
            onClick={() => actions?.onDiscardAllEdits()}
            disabled={disabled || !hasPendingEdits}
            aria-label={t('sessionDetail.discardAllEditsTooltip')}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sessionDetail.discardAllEditsTooltip')}</TooltipContent>
      </Tooltip>
      <div className="ml-0.5 flex items-center gap-0.5 rounded-md bg-[#faf8f3] p-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-[#69635d] transition-colors hover:bg-white hover:text-[#e21b22] disabled:pointer-events-none disabled:text-[#aaa39a] disabled:opacity-45"
              onClick={() => actions?.onUndo()}
              disabled={disabled || !canUndo}
              aria-label={t('sessionDetail.undoCurrentPageTooltip')}
            >
              <Undo2 className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sessionDetail.undoCurrentPageTooltip')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-[#69635d] transition-colors hover:bg-white hover:text-[#e21b22] disabled:pointer-events-none disabled:text-[#aaa39a] disabled:opacity-45"
              onClick={() => actions?.onRedo()}
              disabled={disabled || !canRedo}
              aria-label={t('sessionDetail.redoCurrentPageTooltip')}
            >
              <Redo2 className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sessionDetail.redoCurrentPageTooltip')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
