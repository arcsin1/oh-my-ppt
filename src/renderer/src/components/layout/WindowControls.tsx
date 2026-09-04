import { useEffect, useState } from 'react'
import { Maximize, Minimize, Minus, X } from 'lucide-react'
import { ipc } from '@renderer/lib/ipc'

const isMac = ipc.getPlatform() === 'darwin'

export function WindowControls(): React.JSX.Element | null {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (isMac) return
    const unsubscribe = ipc.onWindowControlStateChanged((state) => setIsFullscreen(state.isFullscreen))
    void ipc.getWindowControlState().then((state) => setIsFullscreen(state.isFullscreen))
    return unsubscribe
  }, [])

  if (isMac) return null

  const handleToggleFullscreen = (): void => {
    void ipc.toggleFullscreenWindow().then((state) => setIsFullscreen(state.isFullscreen))
  }

  const controls = [
    { label: 'Minimize', action: () => void ipc.minimizeWindow(), icon: Minus },
    {
      label: isFullscreen ? '退出全屏' : '全屏',
      action: handleToggleFullscreen,
      icon: isFullscreen ? Minimize : Maximize
    },
    { label: '关闭', action: () => void ipc.closeWindow(), icon: X, close: true }
  ]

  return (
    <div className="app-no-drag ml-auto mr-2 flex shrink-0 items-center gap-1" aria-label="窗口控制">
      {controls.map(({ label, action, icon: Icon, close }) => (
        <button
          key={label}
          type="button"
          onClick={action}
          aria-label={label}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[#536044] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#789761] ${
            close
              ? 'hover:bg-[#c8554d] hover:text-white focus-visible:ring-[#c8554d]'
              : 'hover:bg-[#e5dcc9]'
          }`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      ))}
    </div>
  )
}
