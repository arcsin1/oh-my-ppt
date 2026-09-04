import { useState } from 'react'
import {
  ChartColumn,
  ChartLine,
  ChartPie,
  ChevronDown,
  Copy,
  Donut,
  ImagePlus,
  Layers,
  Loader2,
  Radar,
  Shapes,
  Sigma,
  Smile,
  Sparkles,
  Trash2,
  Type,
  Video
} from 'lucide-react'
import { ART_TEXT_TEMPLATES } from '@renderer/lib/artTextTemplates'
import {
  ICON_LIST,
  ICON_VIEWBOX,
  SHAPE_LIST,
  serializeIconInner,
  type InsertShapeType
} from '@renderer/components/session-detail/workspace/insert-shapes'
import {
  CHART_TYPE_LIST,
  type InsertChartType
} from '@renderer/components/session-detail/workspace/insert-charts'
import { useT, type I18nKey } from '@renderer/i18n'
import {
  useEditSessionStore,
  useSessionDetailRuntimeStore
} from '@renderer/store'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '../../../../ui/AlertDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../../../ui/DropdownMenu'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../ui/Popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/Tooltip'
import type { InsertAssetType } from '../types'
import { ToolRowShell } from './ToolRowShell'
import type { ToolRowProps } from './types'

const toolButtonClass =
  'group inline-flex h-7 min-w-[78px] shrink-0 items-center justify-center gap-1 rounded-full bg-[#fffaf1]/92 px-2.5 text-[10px] font-bold leading-none text-[#2f3b28] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_10px_rgba(47,59,40,0.09)] transition-colors hover:bg-white hover:text-[#1f2a1b] disabled:pointer-events-none disabled:opacity-40'
const iconWrapClass =
  'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#d4e4c1]/78 text-[#3e4a32] group-hover:bg-[#8fbc8f]/42'
const iconClass = 'h-2.5 w-2.5'
const selectedToolButtonClass =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-45'

// Keep these compact previews visually aligned with the full-size templates in artTextTemplates.ts.
const artTextPreviewStyles = `
.ppt-art-preview-card {
  min-height: 90px;
  border-radius: 8px;
  border: 1px solid rgba(216, 204, 181, 0.78);
  background: linear-gradient(145deg, rgba(31, 38, 29, 0.96), rgba(18, 24, 22, 0.94));
  color: #fff;
  padding: 9px;
  text-align: left;
  transition: border-color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
}
.ppt-art-preview-card:hover,
.ppt-art-preview-card:focus-visible {
  border-color: rgba(143, 188, 143, 0.95);
  box-shadow: 0 10px 24px rgba(47, 59, 40, 0.18);
  transform: translateY(-1px);
  outline: none;
}
.ppt-art-preview-label {
  color: rgba(255, 250, 241, 0.76);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.ppt-art-preview-stage {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding-top: 7px;
  text-align: center;
}
.ppt-art-preview-text {
  display: inline-block;
  max-width: 100%;
  font-size: 18px;
  font-weight: 850;
  line-height: 1.12;
  letter-spacing: 0;
}
.ppt-art-preview-gradient-shine .ppt-art-preview-text {
  background: linear-gradient(135deg, #ffd89b, #c7e9fb, #f6d5f7, #a0e9ff);
  background-size: 300% 300%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  animation: pptArtPreviewFlowGradient 6s ease infinite;
}
.ppt-art-preview-neon-glow .ppt-art-preview-text {
  color: #0ff;
  text-shadow: 0 0 5px #0ff, 0 0 12px #0ff, 0 0 22px #00aaff;
  animation: pptArtPreviewNeonPulse 1.2s ease-in-out infinite alternate;
}
.ppt-art-preview-shadow-3d .ppt-art-preview-text {
  color: #f3b33d;
  text-shadow: 1px 1px 0 #7a4c1a, 2px 2px 0 #6b4215, 3px 3px 0 #5a3710, 4px 4px 0 #482d0c;
}
.ppt-art-preview-wave-text .ppt-art-preview-text {
  display: flex;
  gap: 2px;
}
.ppt-art-preview-wave-char {
  display: inline-block;
  animation: pptArtPreviewWaveFloat 1.4s infinite ease-in-out;
}
.ppt-art-preview-stroke-text .ppt-art-preview-text {
  color: transparent;
  -webkit-text-stroke: 1px #00e0ff;
  text-stroke: 1px #00e0ff;
  text-shadow: 0 0 10px rgba(0, 255, 255, 0.36);
}
.ppt-art-preview-typewriter .ppt-art-preview-text {
  overflow: hidden;
  white-space: nowrap;
  border-right: 2px solid #f0f;
  animation: pptArtPreviewTyping 3s steps(20, end) infinite, pptArtPreviewBlink 0.75s step-end infinite;
}
.ppt-art-preview-glitch .ppt-art-preview-text {
  position: relative;
  color: #fff;
  text-shadow: 0.05em 0 0 rgba(255, 0, 0, 0.75), -0.05em -0.025em 0 rgba(0, 255, 0, 0.75);
  animation: pptArtPreviewGlitchShake 0.3s infinite;
}
.ppt-art-preview-glitch .ppt-art-preview-text::before,
.ppt-art-preview-glitch .ppt-art-preview-text::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
}
.ppt-art-preview-glitch .ppt-art-preview-text::before {
  left: 1px;
  text-shadow: -1px 0 red;
  clip: rect(8px, 200px, 20px, 0);
}
.ppt-art-preview-glitch .ppt-art-preview-text::after {
  left: -1px;
  text-shadow: -1px 0 blue;
  clip: rect(24px, 200px, 46px, 0);
}
.ppt-art-preview-fire-text .ppt-art-preview-text {
  background-image: linear-gradient(0deg, #ff4d00, #ff9900, #ffcc00);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  text-shadow: 0 0 10px #ff7b00, 0 0 16px #ff4400;
  animation: pptArtPreviewFireFlicker 0.2s infinite alternate;
}
.ppt-art-preview-glass-text .ppt-art-preview-text {
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.2);
  color: #fff3cf;
  padding: 7px 12px;
}
.ppt-art-preview-rotate-3d .ppt-art-preview-stage {
  perspective: 480px;
}
.ppt-art-preview-rotate-3d .ppt-art-preview-text {
  color: #fe9c8f;
  transform-style: preserve-3d;
  animation: pptArtPreviewRotateText 5s infinite linear;
}
.ppt-art-preview-rainbow .ppt-art-preview-text {
  animation: pptArtPreviewRainbowColor 2s linear infinite;
}
.ppt-art-preview-liquid .ppt-art-preview-text {
  background: linear-gradient(45deg, #ff6bcb, #ffb86c, #2ed8ff, #ff6bcb);
  background-size: 400% 400%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  animation: pptArtPreviewLiquidMove 5s ease infinite;
}
.ppt-art-preview-bounce-text .ppt-art-preview-text {
  animation: pptArtPreviewTextBounce 1.2s ease infinite;
}
.ppt-art-preview-float-shadow .ppt-art-preview-text {
  text-shadow: 0 8px 14px rgba(0, 0, 0, 0.35);
  animation: pptArtPreviewFloatUp 2.6s infinite alternate;
}
.ppt-art-preview-metal-text .ppt-art-preview-text {
  background: linear-gradient(135deg, #e8e8e8 0%, #a0a0b0 40%, #f5f5ff 50%, #b0b0c0 80%, #dfdfdf 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.34)) drop-shadow(0 3px 7px rgba(0, 0, 0, 0.18));
}
@keyframes pptArtPreviewFlowGradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes pptArtPreviewNeonPulse {
  0% { text-shadow: 0 0 2px #0ff, 0 0 6px #0aa; opacity: 0.9; }
  100% { text-shadow: 0 0 8px #0ff, 0 0 22px #0cf; opacity: 1; }
}
@keyframes pptArtPreviewWaveFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes pptArtPreviewTyping {
  0% { width: 0; }
  40% { width: 100%; }
  80% { width: 100%; }
  100% { width: 0; }
}
@keyframes pptArtPreviewBlink {
  0%, 100% { border-color: #f0f; }
  50% { border-color: transparent; }
}
@keyframes pptArtPreviewGlitchShake {
  0% { transform: translate(0); }
  40% { transform: translate(-1px, -1px); }
  80% { transform: translate(1px, -1px); }
  100% { transform: translate(0); }
}
@keyframes pptArtPreviewFireFlicker {
  0% { opacity: 0.95; text-shadow: 0 0 8px #ff5500; }
  100% { opacity: 1; text-shadow: 0 0 15px #ffaa33, 0 0 5px #ff3300; }
}
@keyframes pptArtPreviewRotateText {
  0% { transform: rotateY(0deg); }
  100% { transform: rotateY(360deg); }
}
@keyframes pptArtPreviewRainbowColor {
  0% { color: #ff0000; }
  17% { color: #ff9900; }
  33% { color: #ffff00; }
  50% { color: #00ff00; }
  67% { color: #0099ff; }
  83% { color: #8b00ff; }
  100% { color: #ff0000; }
}
@keyframes pptArtPreviewLiquidMove {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes pptArtPreviewTextBounce {
  0%, 100% { transform: scale(1); letter-spacing: 0; }
  50% { transform: scale(1.05); letter-spacing: 2px; color: #fff2a0; }
}
@keyframes pptArtPreviewFloatUp {
  0% { transform: translateY(0); text-shadow: 0 5px 12px rgba(0, 0, 0, 0.24); }
  100% { transform: translateY(-5px); text-shadow: 0 18px 22px rgba(0, 0, 0, 0.45); }
}
`

export function InsertToolRow({ disabled }: ToolRowProps): React.JSX.Element {
  const t = useT()
  const [artTextOpen, setArtTextOpen] = useState(false)
  const [shapeOpen, setShapeOpen] = useState(false)
  const [iconOpen, setIconOpen] = useState(false)
  const [chartOpen, setChartOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const actions = useSessionDetailRuntimeStore((state) => state.workspaceRibbonActions)
  const selection = useEditSessionStore((state) => state.selection)
  const isApplyingSyncElement = useEditSessionStore((state) => state.isApplyingSyncElement)

  const renderSelectedElementTools = (): React.JSX.Element | null => {
    if (!selection) return null
    return (
      <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 shrink-0 items-center gap-0.5 rounded-full border border-[#ead29a]/70 bg-[#fff4d8]/92 px-0.5 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_4px_12px_rgba(167,116,34,0.1)] backdrop-blur">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`${selectedToolButtonClass} bg-[#d8942f] text-white shadow-[0_4px_10px_rgba(168,105,23,0.2)] hover:bg-[#bd7621]`}
              onClick={() => actions?.onApplySelectedToAllPages()}
              disabled={disabled || isApplyingSyncElement}
              aria-label={t('sessionDetail.applyElementToAllPages')}
            >
              {isApplyingSyncElement ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Layers className="h-3 w-3" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isApplyingSyncElement
              ? t('sessionDetail.syncElementApplying')
              : t('sessionDetail.applyElementToAllPages')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`${selectedToolButtonClass} text-[#6b765c] hover:bg-[#f9e7bd] hover:text-[#3e4a32]`}
              onClick={() => actions?.onCopySelectedElement()}
              disabled={disabled || isApplyingSyncElement}
              aria-label={t('sessionDetail.copyElement')}
            >
              <Copy className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sessionDetail.copyElement')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`${selectedToolButtonClass} text-[#9a5a50] hover:bg-[#f8dfd9] hover:text-[#7d342c]`}
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={disabled || isApplyingSyncElement}
              aria-label={t('sessionDetail.deleteElement')}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sessionDetail.deleteElement')}</TooltipContent>
        </Tooltip>
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>{t('sessionDetail.deleteElement')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sessionDetail.deleteElementConfirm')}
            </AlertDialogDescription>
            <div className="flex justify-end gap-2">
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#c0392b] text-white hover:bg-[#a93226]"
                onClick={() => actions?.onDeleteSelectedElement()}
              >
                {t('common.delete')}
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  const renderMediaDropdown = (type: InsertAssetType): React.JSX.Element => {
    const Icon = type === 'image' ? ImagePlus : Video
    const label = type === 'image' ? t('editMode.addImage') : t('editMode.addVideo')
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={toolButtonClass} disabled={disabled}>
            <span className={iconWrapClass}>
              <Icon className={iconClass} />
            </span>
            {label}
            <ChevronDown className="h-2.5 w-2.5 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[10rem]">
          <DropdownMenuItem onClick={() => actions?.onAddFromLibrary(type)}>
            {t('editMode.fromLibrary')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions?.onAddFromLocal(type)}>
            {t('editMode.fromLocal')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const chartTypeIcons: Record<InsertChartType, typeof ChartColumn> = {
    bar: ChartColumn,
    line: ChartLine,
    pie: ChartPie,
    doughnut: Donut,
    radar: Radar
  }

  const renderChartPopover = (): React.JSX.Element => (
    <Popover open={chartOpen} onOpenChange={setChartOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={toolButtonClass} disabled={disabled}>
          <span className={iconWrapClass}>
            <ChartColumn className={iconClass} />
          </span>
          {t('editMode.chart')}
          <ChevronDown className="h-2.5 w-2.5 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[280px] max-w-[calc(100vw-2rem)] border-[#d8ccb5]/85 bg-[#fff9ef] p-2"
      >
        <div className="grid grid-cols-3 gap-2">
          {CHART_TYPE_LIST.map((item) => {
            const Icon = chartTypeIcons[item.type]
            return (
              <button
                type="button"
                key={item.type}
                className="flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-lg border border-[#d8ccb5]/70 bg-white/70 px-2 py-2 text-[10px] font-bold text-[#3e4a32] transition-colors hover:border-[#8fbc8f] hover:bg-white"
                onClick={() => {
                  actions?.onAddChart(item.type)
                  setChartOpen(false)
                }}
              >
                <Icon className="h-5 w-5 text-[#5d6b4d]" />
                <span>{t(item.labelKey as I18nKey)}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )

  const renderArtTextPreview = (
    template: (typeof ART_TEXT_TEMPLATES)[number]
  ): React.JSX.Element => {
    if (template.id === 'wave-text') {
      return (
        <span className="ppt-art-preview-text">
          {Array.from(template.defaultText).map((char, index) => (
            <span
              key={`${char}-${index}`}
              className="ppt-art-preview-wave-char"
              style={{ animationDelay: `${index * 0.08}s` }}
            >
              {char === ' ' ? '\u00a0' : char}
            </span>
          ))}
        </span>
      )
    }

    return (
      <span
        className="ppt-art-preview-text"
        data-text={template.id === 'glitch' ? template.defaultText : undefined}
      >
        {template.defaultText}
      </span>
    )
  }

  const renderArtTextDropdown = (): React.JSX.Element => (
    <Popover open={artTextOpen} onOpenChange={setArtTextOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={toolButtonClass} disabled={disabled}>
          <span className={iconWrapClass}>
            <Sparkles className={iconClass} />
          </span>
          {t('editMode.artText')}
          <ChevronDown className="h-2.5 w-2.5 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[560px] max-w-[calc(100vw-2rem)] border-[#d8ccb5]/85 bg-[#fff9ef] p-2"
      >
        <style>{artTextPreviewStyles}</style>
        <div className="grid max-h-[420px] grid-cols-3 gap-2 overflow-y-auto pr-1">
          {ART_TEXT_TEMPLATES.map((template) => (
            <button
              type="button"
              key={template.id}
              className={`ppt-art-preview-card ppt-art-preview-${template.id}`}
              onClick={() => {
                actions?.onAddArtText(template.id)
                setArtTextOpen(false)
              }}
            >
              <div className="ppt-art-preview-label">{template.label}</div>
              <div className="ppt-art-preview-stage">{renderArtTextPreview(template)}</div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const shapeLabelKey: Record<InsertShapeType, I18nKey> = {
    rect: 'editMode.shapeRect',
    'rounded-rect': 'editMode.shapeRoundedRect',
    ellipse: 'editMode.shapeEllipse',
    triangle: 'editMode.shapeTriangle',
    diamond: 'editMode.shapeDiamond',
    pentagon: 'editMode.shapePentagon',
    hexagon: 'editMode.shapeHexagon',
    parallelogram: 'editMode.shapeParallelogram',
    trapezoid: 'editMode.shapeTrapezoid',
    'star-5': 'editMode.shapeStar',
    line: 'editMode.shapeLine',
    'arrow-right': 'editMode.shapeArrowRight',
    'chevron-right': 'editMode.shapeChevron'
  }

  const renderShapePreviewInner = (type: InsertShapeType): string => {
    const def = SHAPE_LIST.find((s) => s.type === type)
    if (!def) return ''
    return def.renderInner(def.defaultWidth, def.defaultHeight, {
      fill: def.defaultFill,
      stroke: def.defaultStroke,
      strokeWidth: def.strokeWidth
    })
  }

  const renderShapePopover = (): React.JSX.Element => (
    <Popover open={shapeOpen} onOpenChange={setShapeOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={toolButtonClass} disabled={disabled}>
          <span className={iconWrapClass}>
            <Shapes className={iconClass} />
          </span>
          {t('editMode.addShape')}
          <ChevronDown className="h-2.5 w-2.5 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[280px] max-w-[calc(100vw-2rem)] border-[#d8ccb5]/85 bg-[#fff9ef] p-2"
      >
        <div className="grid grid-cols-3 gap-2">
          {SHAPE_LIST.map((def) => (
            <button
              type="button"
              key={def.type}
              className="flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-lg border border-[#d8ccb5]/70 bg-white/70 px-2 py-2 text-[10px] font-bold text-[#3e4a32] transition-colors hover:border-[#8fbc8f] hover:bg-white"
              onClick={() => {
                actions?.onAddShape(def.type)
                setShapeOpen(false)
              }}
            >
              <svg
                viewBox={`0 0 ${def.defaultWidth} ${def.defaultHeight}`}
                className="h-9 w-12"
                preserveAspectRatio="xMidYMid meet"
                dangerouslySetInnerHTML={{ __html: renderShapePreviewInner(def.type) }}
              />
              <span>{t(shapeLabelKey[def.type])}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const strokeIcons = ICON_LIST.filter((icon) => icon.variant !== 'badge')
  const badgeIcons = ICON_LIST.filter((icon) => icon.variant === 'badge')

  const renderIconGrid = (icons: typeof ICON_LIST): React.JSX.Element => (
    <div className="grid grid-cols-6 gap-1.5">
      {icons.map((icon) => {
        const isBadge = icon.variant === 'badge'
        return (
          <button
            type="button"
            key={icon.id}
            title={icon.label}
            className="flex h-12 items-center justify-center rounded-lg border border-transparent text-[#3e4a32] transition-colors hover:border-[#8fbc8f] hover:bg-white"
            onClick={() => {
              actions?.onAddIcon(icon.id)
              setIconOpen(false)
            }}
          >
            <svg
              viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
              className={isBadge ? 'h-6 w-6' : 'h-5 w-5'}
              fill="none"
              stroke={isBadge ? 'none' : 'currentColor'}
              strokeWidth={isBadge ? 0 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dangerouslySetInnerHTML={{ __html: serializeIconInner(icon) }}
            />
          </button>
        )
      })}
    </div>
  )

  const renderIconPopover = (): React.JSX.Element => (
    <Popover open={iconOpen} onOpenChange={setIconOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={toolButtonClass} disabled={disabled}>
          <span className={iconWrapClass}>
            <Smile className={iconClass} />
          </span>
          {t('editMode.addIcon')}
          <ChevronDown className="h-2.5 w-2.5 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[390px] max-w-[calc(100vw-2rem)] border-[#d8ccb5]/85 bg-[#fff9ef] p-2"
      >
        <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
          <div>
            <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-[#7a875f]">
              {t('editMode.iconSectionIcons')}
            </div>
            {renderIconGrid(strokeIcons)}
          </div>
          <div>
            <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-[#7a875f]">
              {t('editMode.iconSectionNumbers')}
            </div>
            {renderIconGrid(badgeIcons)}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )

  return (
    <div className="relative">
      {renderSelectedElementTools()}
      <ToolRowShell>
        <button
          type="button"
          className={toolButtonClass}
          onClick={() => actions?.onAddText()}
          disabled={disabled}
        >
          <span className={iconWrapClass}>
            <Type className={iconClass} />
          </span>
          {t('editMode.addText')}
        </button>
        {renderArtTextDropdown()}
        {renderShapePopover()}
        {renderIconPopover()}
        {renderMediaDropdown('image')}
        {renderMediaDropdown('video')}
        {renderChartPopover()}
        <button
          type="button"
          className={toolButtonClass}
          onClick={() => actions?.onAddFormula()}
          disabled={disabled}
        >
          <span className={iconWrapClass}>
            <Sigma className={iconClass} />
          </span>
          {t('editMode.formula')}
        </button>
      </ToolRowShell>
    </div>
  )
}
