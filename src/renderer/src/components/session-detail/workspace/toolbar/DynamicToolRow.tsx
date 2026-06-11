import type { SessionWorkspaceTab } from '@renderer/store'
import { AiToolRow } from './tool-rows/AiToolRow'
import { AnimationToolRow } from './tool-rows/AnimationToolRow'
import { InsertToolRow } from './tool-rows/InsertToolRow'
import { PreviewToolRow } from './tool-rows/PreviewToolRow'
import { SpeechToolRow } from './tool-rows/SpeechToolRow'
import type { ToolRowProps } from './tool-rows/types'

const toolRows: Record<
  SessionWorkspaceTab,
  {
    render: (props: ToolRowProps) => React.JSX.Element | null
    hasContent: boolean
  }
> = {
  preview: { render: PreviewToolRow, hasContent: false },
  browse: { render: PreviewToolRow, hasContent: false },
  edit: { render: InsertToolRow, hasContent: true },
  animation: { render: AnimationToolRow, hasContent: true },
  speech: { render: SpeechToolRow, hasContent: false },
  ai: { render: AiToolRow, hasContent: false }
}

const dynamicToolRowMotionStyles = `
@keyframes workspaceDynamicToolRowIn {
  0% {
    grid-template-rows: 0fr;
    opacity: 0;
    transform: translateY(-7px) scale(0.985);
    filter: blur(3px);
  }
  58% {
    grid-template-rows: 1fr;
    opacity: 1;
    transform: translateY(1px) scale(1.004);
    filter: blur(0);
  }
  100% {
    grid-template-rows: 1fr;
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

.workspace-dynamic-tool-row {
  display: grid;
  transform-origin: top center;
  animation: workspaceDynamicToolRowIn 260ms cubic-bezier(0.2, 0.86, 0.28, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .workspace-dynamic-tool-row {
    animation: none;
  }
}
`

function ensureDynamicToolRowMotionStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('workspace-dynamic-tool-row-motion-styles')) return
  const style = document.createElement('style')
  style.id = 'workspace-dynamic-tool-row-motion-styles'
  style.textContent = dynamicToolRowMotionStyles
  document.head.appendChild(style)
}

ensureDynamicToolRowMotionStyles()

export function DynamicToolRow(props: ToolRowProps): React.JSX.Element | null {
  const toolRow = toolRows[props.state.activeTab]

  if (!toolRow.hasContent) return null

  const ToolRow = toolRow.render

  return (
    <div key={props.state.activeTab} className="workspace-dynamic-tool-row">
      <div className="min-h-0 overflow-hidden">
        <ToolRow {...props} />
      </div>
    </div>
  )
}
