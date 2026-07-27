import { useEffect, useState } from 'react'
import { FolderOpen, Home, Plus, Settings, ShieldCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { PRODUCT_TAGLINE } from '@shared/brand.js'
import logoUrl from '@renderer/assets/images/anjian-logo.png'
import { ipc } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'

const navItems = [
  { path: '/', icon: Home, label: '首页' },
  { path: '/sessions', icon: FolderOpen, label: '我的演示' },
  { path: '/settings', icon: Settings, label: '设置' }
]

export function Sidebar(): React.JSX.Element {
  const location = useLocation()
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    let disposed = false
    void ipc.getAppVersion().then((result) => {
      if (!disposed) setAppVersion(String(result?.version || ''))
    })
    return () => {
      disposed = true
    }
  }, [])

  return (
    <aside className="flex h-full w-full flex-col bg-[#fbfaf7]">
      <div className="px-5 pb-5 pt-4">
        <div className="flex items-center gap-2.5">
          <img src={logoUrl} alt="安居建业" className="h-8 w-auto select-none" draggable={false} />
          <span className="whitespace-nowrap text-[16px] font-semibold text-[#333333]">PPT助手</span>
        </div>
        <p className="mt-2 pl-0.5 text-xs tracking-[0.16em] text-[#8b847b]">{PRODUCT_TAGLINE}</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 pt-3">
        {navItems.map((item) => {
          const active = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                active
                  ? 'bg-[#f4eee7] text-[#333333]'
                  : 'text-[#69635d] hover:bg-[#f7f3ed] hover:text-[#333333]'
              )}
            >
              <item.icon className={cn('h-[18px] w-[18px]', active ? 'text-[#f5831f]' : 'text-[#8c857c]')} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="space-y-3 px-4 pb-4">
        <div className="flex items-center gap-2 px-1 text-[11px] text-[#918a81]">
          <ShieldCheck className="h-3.5 w-3.5" />
          文件仅保存在本机
        </div>
        <Link
          to="/"
          className="flex h-10 items-center justify-between rounded-lg bg-[#e21b22] px-3 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(226,27,34,0.16)] transition-colors hover:bg-[#ba1218]"
        >
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> 新建公司演示
          </span>
          {appVersion ? <span className="text-[10px] font-normal text-white/70">v{appVersion}</span> : null}
        </Link>
      </div>
    </aside>
  )
}
