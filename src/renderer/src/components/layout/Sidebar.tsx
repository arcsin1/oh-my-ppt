import { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import {
  Home,
  FolderOpen,
  Settings,
  Plus,
  ArrowLeft,
  SwatchBook,
  Type,
  LayoutTemplate,
  ChartNoAxesCombined,
  FileCode2,
  CircleHelp
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import logoUrl from '@renderer/assets/images/logo.png'
import { useT } from '@renderer/i18n'
import { ipc } from '@renderer/lib/ipc'

export function Sidebar(): React.JSX.Element {
  const location = useLocation()
  const t = useT()
  const isDetailPage =
    location.pathname.startsWith('/sessions/') && location.pathname !== '/sessions'
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    let disposed = false
    void ipc
      .getAppVersion()
      .then((result) => {
        if (!disposed) {
          setAppVersion(String(result?.version || ''))
        }
      })
      .catch(() => {
        if (!disposed) setAppVersion('')
      })
    return () => {
      disposed = true
    }
  }, [])

  const navItems = [
    { path: '/', icon: Home, label: t('nav.home') },
    { path: '/sessions', icon: FolderOpen, label: t('nav.sessions') },
    { path: '/templates', icon: LayoutTemplate, label: t('nav.templates') },
    { path: '/styles', icon: SwatchBook, label: t('nav.styles') },
    { path: '/fonts', icon: Type, label: t('nav.fonts') },
    { path: '/token-usage', icon: ChartNoAxesCombined, label: t('nav.tokenUsage') },
    { path: '/settings', icon: Settings, label: t('nav.settings') },
    { path: '/edit-html', icon: FileCode2, label: t('nav.editHtml') }
  ]

  return (
    <aside className="flex h-full w-full flex-col bg-transparent">
      <div className="px-2 pt-1">
        <div className="mt-1 flex items-center gap-1">
          <img src={logoUrl} alt="Oh My PPT" className="h-14 w-14 select-none" draggable={false} />
          <h1 className="organic-serif text-[22px] font-semibold leading-none text-[#3e4a32]">
            Oh My PPT
          </h1>
        </div>
        <p className="mt-1 text-[14px] text-[#7f876e] px-4">{t('nav.tagline')}</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 pb-4 pt-5">
        {isDetailPage && (
          <Link
            to="/sessions"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#4a5a3d] transition-colors hover:bg-[#efe5d3]/75"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('nav.backToSessions')}
          </Link>
        )}
        {navItems.map((item) => {
          const isActive =
            item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-[#dbe7ca]/80 text-[#2f3b28]'
                  : 'text-[#58664a] hover:bg-[#efe5d3]/75 hover:text-[#38452f]'
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          )
        })}
        <a
          href="https://www.ohmyppt.cc/#/help"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#58664a] transition-colors hover:bg-[#efe5d3]/75 hover:text-[#38452f]"
        >
          <CircleHelp className="h-4 w-4" />
          {t('nav.helpDocs')}
        </a>
      </nav>

      <div className="px-4 pb-4">
        <Link
          to="/"
          className="flex items-center justify-between gap-2 rounded-xl bg-gradient-to-r from-[#6f8159] to-[#4f613f] px-3 py-2.5 text-[12px] font-medium text-white shadow-lg shadow-[#5d6b4d]/30 transition-all hover:translate-y-[-1px]"
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {t('nav.newPresentation')}
          </span>
          {appVersion ? (
            <span className="shrink-0 text-[10px] font-normal text-white/70">v{appVersion}</span>
          ) : null}
        </Link>
      </div>
    </aside>
  )
}
