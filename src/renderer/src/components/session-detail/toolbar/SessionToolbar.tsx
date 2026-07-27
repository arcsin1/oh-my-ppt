import {
  ChevronDown,
  CopyPlus,
  FileDown,
  FileSearch,
  Globe,
  History,
  Home,
  Loader2,
  Monitor,
  MoreHorizontal,
  Presentation
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailRuntimeStore, useSessionDetailUiStore } from '@renderer/store'
import { Button } from '../../ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../ui/DropdownMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/Tooltip'
import { useT } from '@renderer/i18n'
import { SaveAsNewSessionDialog } from './SaveAsNewSessionDialog'
import { useSessionToolbarController } from './useSessionToolbarController'
import logoUrl from '@renderer/assets/images/anjian-logo.png'

const btnClass =
  'app-no-drag h-7 rounded-[7px] border-[#e2d9cd] bg-white px-2.5 text-[11px] text-[#4c4c4c] shadow-none hover:bg-[#faf8f3]'
const iconClass = 'mr-1.5 h-3.5 w-3.5'
const dropIconClass = 'mr-2 h-3.5 w-3.5 text-[#6b7280]'

const isMac = window.electron?.process?.platform === 'darwin'

export function SessionToolbar({
  sessionId,
  isSavingEdits
}: {
  sessionId: string
  isSavingEdits?: boolean
}): React.JSX.Element {
  const t = useT()
  const {
    hasPages,
    isGenerating,
    historyDisabled,
    selectedPageHasPendingEdits,
    canPreview,
    canRevealFile,
    sessionTitle,
    saveAsNewSessionOpen,
    savingAsNewSession,
    saveAsNewSessionDisabled,
    defaultSaveAsNewSessionName,
    setSaveAsNewSessionOpen,
    handleSaveAsNewSession,
    exportActions,
    openHistory
  } = useSessionToolbarController(sessionId)

  const ribbonActions = useSessionDetailRuntimeStore((state) => state.workspaceRibbonActions)

  const isExportingPdf = useSessionDetailUiStore((state) => state.isExportingPdf)
  const isExportingPng = useSessionDetailUiStore((state) => state.isExportingPng)
  const isExportingPptx = useSessionDetailUiStore((state) => state.isExportingPptx)
  const isExporting = isExportingPdf || isExportingPng || isExportingPptx

  const exportingAny = isExporting
  const editLocked = selectedPageHasPendingEdits || !!isSavingEdits
  const toolbarActionsDisabled = exportingAny || isGenerating || editLocked
  const homeDisabled = toolbarActionsDisabled

  return (
    <>
      {/* Mac left padding for traffic lights */}
      <div className={cn('flex h-full items-center gap-2', isMac ? 'pl-[85px]' : 'pl-4')}>
        <div className="app-no-drag flex shrink-0 items-center gap-2 border-r border-[#e6ded2] pr-3">
          <img src={logoUrl} alt="安居建业" className="h-6 w-auto" draggable={false} />
          <span className="text-[12px] font-semibold text-[#333333]">PPT助手</span>
        </div>
        {/* Home / Back */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="app-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-[#e2d9cd] bg-white text-[#4c4c4c] transition-colors hover:bg-[#faf8f3] disabled:pointer-events-none disabled:opacity-45"
              onClick={() => ribbonActions?.onBackToSessions()}
              disabled={homeDisabled}
            >
              <Home className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sessionDetail.backToSessions')}</TooltipContent>
        </Tooltip>

        {/* Title */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex w-[172px] shrink-0 items-center gap-2 px-2 py-1">
              <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#333333]">
                {sessionTitle}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            {sessionTitle}
          </TooltipContent>
        </Tooltip>

        {/* Export dropdown */}
        {hasPages && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="app-no-drag h-8 gap-1 rounded-[7px] border-0 bg-[#e21b22] px-3 text-[11px] font-semibold text-white shadow-none hover:bg-[#ba1218]"
                disabled={toolbarActionsDisabled}
              >
                {exportingAny ? (
                  <Loader2 className={cn(iconClass, 'animate-spin')} />
                ) : (
                  <FileDown className={iconClass} />
                )}
                {t('sessionDetail.toolbarExport')}
                {!exportingAny && <ChevronDown className="h-3 w-3" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem
                disabled={!exportActions.canExportPptx}
                onClick={() => void exportActions.exportPptx()}
              >
                <Presentation className={dropIconClass} />
                {t('sessionDetail.toolbarExportPptxEditable')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportActions.exportPdf()}>
                <FileDown className={dropIconClass} />
                {t('sessionDetail.toolbarExportPdf')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportActions.exportPng()}>
                <FileDown className={dropIconClass} />
                {t('sessionDetail.toolbarExportPng')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Browse */}
        {canPreview && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={btnClass}
                onClick={() => void exportActions.openProjectPreview()}
                disabled={toolbarActionsDisabled}
              >
                <Globe className={iconClass} />
                {t('sessionDetail.preview')}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              {t('sessionDetail.previewTooltip')}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Present */}
        {hasPages && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={btnClass}
                onClick={() => void exportActions.openPresentation()}
                disabled={toolbarActionsDisabled}
              >
                <Monitor className={iconClass} />
                {t('sessionDetail.present')}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              {t('sessionDetail.presentTooltip')}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Version History */}
        {hasPages && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={btnClass}
                onClick={openHistory}
                disabled={historyDisabled || exportingAny}
              >
                <History className={iconClass} />
                {t('sessionDetail.history')}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              {t('sessionDetail.historyTooltip')}
            </TooltipContent>
          </Tooltip>
        )}

        {/* More dropdown */}
        {hasPages && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(btnClass, 'px-2')}
                disabled={toolbarActionsDisabled}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[12rem]">
              <DropdownMenuItem
                disabled={saveAsNewSessionDisabled || editLocked}
                onClick={() => setSaveAsNewSessionOpen(true)}
              >
                {savingAsNewSession ? (
                  <Loader2 className={cn(dropIconClass, 'animate-spin')} />
                ) : (
                  <CopyPlus className={dropIconClass} />
                )}
                {t('sessionDetail.saveAsNewSession')}
              </DropdownMenuItem>
              {canRevealFile && (
                <DropdownMenuItem
                  disabled={editLocked || exportingAny || isGenerating}
                  onClick={() => void exportActions.revealSelectedPageFile()}
                >
                  <FileSearch className={dropIconClass} />
                  {t('sessionDetail.revealFile')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <SaveAsNewSessionDialog
        open={saveAsNewSessionOpen}
        defaultName={defaultSaveAsNewSessionName}
        saving={savingAsNewSession}
        onOpenChange={setSaveAsNewSessionOpen}
        onSubmit={(payload) => void handleSaveAsNewSession(payload)}
      />
    </>
  )
}
