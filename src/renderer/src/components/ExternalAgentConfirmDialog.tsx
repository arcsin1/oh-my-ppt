import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/Dialog'
import { Button } from './ui/Button'
import { ipc, type ExternalAgentConfirmationPrompt } from '../lib/ipc'
import { useLang } from '../i18n'

export function ExternalAgentConfirmDialog(): React.JSX.Element {
  const { t } = useLang()
  const [request, setRequest] = useState<ExternalAgentConfirmationPrompt | null>(null)

  useEffect(() => {
    void ipc.getPendingExternalAgentConfirmation().then((pending) => {
      if (pending) setRequest(pending)
    })
    return ipc.onExternalAgentConfirmRequest(setRequest)
  }, [])

  const respond = async (approved: boolean): Promise<void> => {
    if (!request) return
    await ipc.respondExternalAgentConfirmation({
      operationId: request.operationId,
      approved
    })
    setRequest(null)
  }

  const title =
    request?.kind === 'delete_page'
      ? t('settings.externalAgentConfirmDeletePageTitle')
      : request?.kind === 'delete_session'
        ? t('settings.externalAgentConfirmDeleteSessionTitle')
        : t('settings.externalAgentConfirmOverwriteTitle')
  const description =
    request?.kind === 'delete_page'
      ? t('settings.externalAgentConfirmDeletePageDescription')
      : request?.kind === 'delete_session'
        ? t('settings.externalAgentConfirmDeleteSessionDescription')
        : t('settings.externalAgentConfirmOverwriteDescription')
  const actionLabel =
    request?.kind === 'overwrite_export'
      ? t('settings.externalAgentConfirmOverwriteAction')
      : t('common.delete')

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && void respond(false)}>
      <DialogContent showClose={false} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {request && (
          <div className="space-y-2 text-sm">
            <p>
              {t('settings.externalAgentAuthName')}: {request.agentName} ({request.agentId})
            </p>
            {request.sessionTitle || request.sessionId ? (
              <p>
                {t('settings.externalAgentConfirmSession')}:{' '}
                {request.sessionTitle || request.sessionId}
              </p>
            ) : null}
            {request.kind === 'delete_page' ? (
              <p>
                {t('settings.externalAgentConfirmPage')}:{' '}
                {request.pageNumber ? `P${request.pageNumber} ` : ''}
                {request.pageTitle || request.pageId}
              </p>
            ) : null}
            {request.kind === 'overwrite_export' && request.outputPath ? (
              <p className="break-all">
                {t('settings.externalAgentConfirmPath')}: {request.outputPath}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t('settings.externalAgentConfirmIrreversible')}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void respond(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void respond(true)}>
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
