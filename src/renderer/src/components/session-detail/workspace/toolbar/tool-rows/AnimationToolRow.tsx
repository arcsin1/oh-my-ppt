import { Sparkles } from 'lucide-react'
import { useT } from '@renderer/i18n'
import { IndexTransitionPicker } from './IndexTransitionPicker'
import { ToolRowShell } from './ToolRowShell'
import type { ToolRowProps } from './types'

export function AnimationToolRow({ disabled }: ToolRowProps): React.JSX.Element {
  const t = useT()

  return (
    <ToolRowShell>
      <IndexTransitionPicker disabled={disabled} />
      <button
        type="button"
        disabled
        className="inline-flex h-7 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full border border-[#d8ccb5]/60 bg-[#fffdf8]/58 px-2.5 text-[10px] font-bold leading-none text-[#7f8a73] opacity-55 shadow-[inset_0_1px_2px_rgba(74,59,42,0.03)]"
      >
        <Sparkles className="h-3 w-3 shrink-0" />
        <span>{t('sessionDetail.elementAnimationLabel')}</span>
      </button>
    </ToolRowShell>
  )
}
