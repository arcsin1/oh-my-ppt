import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, matchPath } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'
import { WindowControls } from './components/layout/WindowControls'
import { HomePage } from './pages/home'
import { SessionCreatePage } from './pages/session-create'
import { ThinkingDetailPage } from './pages/thinking-detail'
import { SessionsPage } from './pages/sessions'
import { SessionDetailPage } from './pages/session-detail'
import { SessionGeneratingPage } from './pages/session-generating'
import { TemplateSessionsGeneratingPage } from './pages/template-sessions-generating'
import { SettingsPage } from './pages/settings'
import { StylesPage } from './pages/styles'
import { FontsPage } from './pages/fonts'
import { StyleEditorPage } from './pages/style-editor'
import { TemplatesPage } from './pages/templates'
import { TokenUsagePage } from './pages/token-usage'
import { EditHtmlPage } from './pages/edit-html'
import { EditHtmlListPage } from './pages/edit-html-list'
import { AppToaster } from './components/AppToaster'
import { UpdateAvailableDialog } from './components/UpdateAvailableDialog'
import { ScrollArea } from './components/ui/ScrollArea'
import { ipc } from './lib/ipc'
import type { UpdateAvailablePayload } from '@shared/app-update.js'
import { useGenerationNotifications } from './hooks/useGenerationNotifications'

function App(): React.JSX.Element {
  const location = useLocation()
  useGenerationNotifications()
  const isSessionDetailRoute = Boolean(matchPath('/sessions/:id/*', location.pathname))
  const isHtmlEditorRoute = Boolean(matchPath('/edit-html/:id/*', location.pathname))
  const isThinkingRoute = Boolean(matchPath('/thinking', location.pathname))
  const [availableUpdate, setAvailableUpdate] = useState<UpdateAvailablePayload | null>(null)

  useEffect(() => {
    const unsubscribe = ipc.onUpdateAvailable((update) => {
      setAvailableUpdate(update)
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  if (isSessionDetailRoute || isHtmlEditorRoute) {
    return (
      <>
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
          <Routes>
            <Route path="/sessions/:id/template-generating" element={<TemplateSessionsGeneratingPage />} />
            <Route path="/sessions/:id/generating" element={<SessionGeneratingPage />} />
            <Route path="/sessions/:id" element={<SessionDetailPage />} />
            <Route path="/edit-html/:id" element={<EditHtmlPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <UpdateAvailableDialog update={availableUpdate} onClose={() => setAvailableUpdate(null)} />
        <AppToaster />
      </>
    )
  }

  return (
    <>
      <div className="h-full min-h-0 overflow-hidden bg-background text-foreground">
        <div className="flex h-full min-h-0 flex-col">
          <div className="app-drag-region app-titlebar flex bg-background/85 backdrop-blur-xl">
            <WindowControls />
          </div>

          <div className="flex min-h-0 flex-1">
            <aside className="hidden min-h-0 w-[240px] shrink-0 flex-col border-r border-border/70 bg-[#f7f0e2]/40 md:flex">
              <Sidebar />
            </aside>
            {isThinkingRoute ? (
              <div className="min-h-0 flex-1 overflow-hidden">
                <Routes>
                  <Route path="/thinking" element={<ThinkingDetailPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/create/session" element={<SessionCreatePage />} />
                  <Route path="/sessions" element={<SessionsPage />} />
                  <Route path="/templates" element={<TemplatesPage />} />
                  <Route path="/styles" element={<StylesPage />} />
                  <Route path="/fonts" element={<FontsPage />} />
                  <Route path="/token-usage" element={<TokenUsagePage />} />
                  <Route path="/styles/new" element={<StyleEditorPage />} />
                  <Route path="/styles/:styleId" element={<StyleEditorPage />} />
                  <Route path="/edit-html" element={<EditHtmlListPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </ScrollArea>
            )}
          </div>
        </div>
      </div>
      <UpdateAvailableDialog update={availableUpdate} onClose={() => setAvailableUpdate(null)} />
      <AppToaster />
    </>
  )
}

export default App
