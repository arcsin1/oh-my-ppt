import { Eye, Pencil, ScrollText, Sparkles, WandSparkles } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useT } from '@renderer/i18n'
import type { SessionWorkspaceTab } from '@renderer/store'

export function WorkspaceTabs({
  activeTab,
  disabled,
  onActivate
}: {
  activeTab: SessionWorkspaceTab
  disabled: boolean
  onActivate: (tab: SessionWorkspaceTab) => void
}): React.JSX.Element {
  const t = useT()
  const tabs: Array<{ id: SessionWorkspaceTab; label: string; icon?: React.JSX.Element }> = [
    { id: 'preview', label: t('sessionDetail.previewMode'), icon: <Eye className="h-3 w-3" /> },
    { id: 'edit', label: t('sessionDetail.editMode'), icon: <Pencil className="h-3 w-3" /> },
    { id: 'animation', label: t('sessionDetail.animationTab'), icon: <WandSparkles className="h-3 w-3" /> },
    { id: 'speech', label: t('sessionDetail.speechScript'), icon: <ScrollText className="h-3 w-3" /> },
    { id: 'ai', label: t('sessionDetail.aiMode'), icon: <Sparkles className="h-3 w-3" /> }
  ]

  return (
    <div className="flex min-w-0 flex-1 justify-center">
      <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-[#e5ddd2] bg-white p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              'inline-flex h-6 min-w-[74px] shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[10px] font-semibold leading-none transition-all',
              activeTab === tab.id
                ? 'bg-[#e21b22] text-white'
                : 'text-[#6e6861] hover:bg-[#faf8f3] hover:text-[#333333]'
            )}
            onClick={() => onActivate(tab.id)}
            disabled={disabled}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}
