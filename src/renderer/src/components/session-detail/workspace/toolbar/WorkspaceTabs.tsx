import { Eye, LayoutGrid, Pencil, ScrollText, Sparkles, WandSparkles } from 'lucide-react'
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
    { id: 'browse', label: t('sessionDetail.browseMode'), icon: <LayoutGrid className="h-3 w-3" /> },
    { id: 'animation', label: t('sessionDetail.animationTab'), icon: <WandSparkles className="h-3 w-3" /> },
    { id: 'speech', label: t('sessionDetail.speechScript'), icon: <ScrollText className="h-3 w-3" /> },
    { id: 'ai', label: t('sessionDetail.aiMode'), icon: <Sparkles className="h-3 w-3" /> }
  ]

  return (
    <div className="flex min-w-0 flex-1 justify-center">
      <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-[#d4e4c1]/30 p-0.5 shadow-[inset_0_1px_4px_rgba(62,74,50,0.08)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              'inline-flex h-6 min-w-[68px] shrink-0 items-center justify-center gap-1 rounded-full px-2 text-[10px] font-bold leading-none transition-all',
              activeTab === tab.id
                ? 'bg-[#5d6b4d] text-white shadow-[0_4px_10px_rgba(62,74,50,0.16)]'
                : 'text-[#4f5f40] hover:bg-[#fffaf1]/54 hover:text-[#314028]'
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
