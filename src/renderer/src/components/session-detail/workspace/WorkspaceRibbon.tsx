import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useT } from '@renderer/i18n'
import { useWorkspaceRibbonController } from '../hooks/useWorkspaceRibbonController'
import { DynamicToolRow } from './toolbar/DynamicToolRow'
import { PrimaryActions } from './toolbar/PrimaryActions'
import { WorkspaceTabs } from './toolbar/WorkspaceTabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '../../ui/AlertDialog'

export function WorkspaceRibbon({
  isSavingEdits
}: {
  isSavingEdits: boolean
}): React.JSX.Element | null {
  const t = useT()
  const [isPreviewSettling, setIsPreviewSettling] = useState(false)
  const {
    selectedPageKey,
    state,
    activateTab,
    pendingTab,
    pendingTabLabel,
    savingBeforeTabSwitch,
    cancelPendingTab,
    confirmPendingTab
  } = useWorkspaceRibbonController(isSavingEdits)

  useEffect(() => {
    if (!selectedPageKey) {
      setIsPreviewSettling(false)
      return
    }
    setIsPreviewSettling(true)
    const timer = window.setTimeout(() => {
      setIsPreviewSettling(false)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [selectedPageKey])

  if (!selectedPageKey) return null

  const toolbarDisabled = state.isGenerating || state.isSavingEdits || isPreviewSettling

  return (
    <>
      <div
        className={cn(
          'flex min-w-0 flex-col gap-1 px-3 pb-1.5 pt-1 transition-opacity duration-200',
          isPreviewSettling && 'pointer-events-none opacity-0'
        )}
      >
        <div className="actions-tool flex min-w-0 items-center gap-2 px-1.5 py-0.5">
          <PrimaryActions
            disabled={toolbarDisabled}
            isSavingEdits={state.isSavingEdits}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            hasPendingEdits={state.hasPendingEdits}
          />
          <WorkspaceTabs
            activeTab={state.activeTab}
            disabled={toolbarDisabled}
            onActivate={activateTab}
          />
        </div>

        <DynamicToolRow state={state} disabled={toolbarDisabled} />
      </div>

      <AlertDialog open={Boolean(pendingTab)} onOpenChange={(open) => !open && cancelPendingTab()}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('sessionDetail.workspaceSwitchSaveConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('sessionDetail.workspaceSwitchSaveConfirmDescription', {
              mode: pendingTabLabel
            })}
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={savingBeforeTabSwitch}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingBeforeTabSwitch}
              className="bg-[#e21b22] text-white hover:bg-[#ba1218] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={(event) => {
                event.preventDefault()
                void confirmPendingTab()
              }}
            >
              {savingBeforeTabSwitch ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t('sessionDetail.workspaceSwitchSaveConfirmAction')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
