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
import { Input } from './ui/Input'
import { ipc, type ExternalAgentAuthRequest } from '../lib/ipc'
import { useLang } from '../i18n'
import {
  EXTERNAL_AGENT_DEFAULT_CAPABILITIES,
  type ExternalAgentCapability
} from '@shared/external-agent'

export function ExternalAgentAuthDialog(): React.JSX.Element {
  const { t } = useLang()
  const [request, setRequest] = useState<ExternalAgentAuthRequest | null>(null)
  const [capabilities, setCapabilities] = useState<ExternalAgentCapability[]>([])
  const [sessions, setSessions] = useState<Array<{ id: string; title: string }>>([])
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [optionsReady, setOptionsReady] = useState(false)

  useEffect(() => {
    const apply = (next: ExternalAgentAuthRequest): void => {
      setRequest(next)
      setOptionsReady(false)
      setCapabilities(
        next.defaultCapabilities.length > 0
          ? next.defaultCapabilities
          : [...EXTERNAL_AGENT_DEFAULT_CAPABILITIES]
      )
      void ipc.getExternalAgentAuthOptions().then((options) => {
        setSessions(options.sessions)
        setSelectedSessionIds(options.sessions.map((session) => session.id))
        setWorkspaceRoot(options.defaultWorkspaceRoot)
        setOptionsReady(true)
      })
    }
    void ipc.getPendingExternalAgentAuth().then((pending) => {
      if (pending) apply(pending)
    })
    return ipc.onExternalAgentAuthRequest(apply)
  }, [])

  const respond = async (approved: boolean): Promise<void> => {
    if (!request) return
    await ipc.respondExternalAgentAuth({
      agentId: request.agentId,
      approved,
      capabilities: approved ? capabilities : undefined,
      sessionIds: approved ? selectedSessionIds : undefined,
      workspaceRoots: approved && workspaceRoot.trim() ? [workspaceRoot.trim()] : undefined
    })
    setRequest(null)
  }

  const toggle = (capability: ExternalAgentCapability): void => {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability]
    )
  }

  const toggleSession = (sessionId: string): void => {
    setSelectedSessionIds((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
    )
  }

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && void respond(false)}>
      <DialogContent showClose={false} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settings.externalAgentAuthTitle')}</DialogTitle>
          <DialogDescription>{t('settings.externalAgentAuthDescription')}</DialogDescription>
        </DialogHeader>
        {request && (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
            <p>
              {t('settings.externalAgentAuthName')}: {request.name} ({request.version})
            </p>
            <p className="break-all">
              {t('settings.externalAgentAuthPath')}: {request.executablePath || '-'}
            </p>
            <div className="space-y-2">
              <p>{t('settings.externalAgentCapabilities')}</p>
              {(request.defaultCapabilities.length > 0
                ? request.defaultCapabilities
                : [...EXTERNAL_AGENT_DEFAULT_CAPABILITIES]
              ).map((capability) => (
                <label key={capability} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={capabilities.includes(capability)}
                    onChange={() => toggle(capability)}
                  />
                  <span>{capability}</span>
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <p>{t('settings.externalAgentAuthSessions')}</p>
              {sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.externalAgentAuthNoSessions')}
                </p>
              ) : (
                sessions.map((session) => (
                  <label key={session.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedSessionIds.includes(session.id)}
                      onChange={() => toggleSession(session.id)}
                    />
                    <span className="min-w-0 truncate">{session.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {session.id.slice(0, 8)}
                    </span>
                  </label>
                ))
              )}
            </div>
            <div>
              <p className="mb-1">{t('settings.externalAgentAuthWorkspace')}</p>
              <Input
                value={workspaceRoot}
                onChange={(event) => setWorkspaceRoot(event.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void respond(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!optionsReady} onClick={() => void respond(true)}>
            {t('settings.externalAgentApprove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
