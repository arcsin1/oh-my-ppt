import { CircleAlert, Loader2 } from 'lucide-react'
import { PreviewIframe } from '@renderer/components/preview/PreviewIframe'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/Tooltip'
import { cn } from '@renderer/lib/utils'
import type { GenerationPreviewPage } from './types'
import type { SlideSizePreset } from '@shared/slide-size'

export function GenerationThumbnail({
  page,
  previewEnabled = true,
  slideSize
}: {
  page: GenerationPreviewPage
  previewEnabled?: boolean
  slideSize: SlideSizePreset | null
}): React.JSX.Element {
  if (!slideSize) {
    return <div className="h-[195px] w-full rounded-xl bg-[#f5f1e8]/88" />
  }
  const thumbnailFitStyle =
    slideSize.width >= slideSize.height
      ? { width: '100%', aspectRatio: `${slideSize.width}/${slideSize.height}` }
      : { height: '100%', aspectRatio: `${slideSize.width}/${slideSize.height}` }
  const hasPreview =
    previewEnabled && page.status === 'completed' && (page.htmlPath || page.sourceUrl)

  const card = (
    <div
      tabIndex={hasPreview ? 0 : undefined}
      className={cn(
        'group relative flex w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-[#fffaf1]/78 p-1.5 shadow-[0_16px_34px_rgba(70,82,58,0.12)] transition-all duration-500',
        page.status === 'completed' && 'border-[#b8d3a6] translate-y-0 opacity-100',
        page.status === 'generating' &&
          'border-[#8fb873] bg-[#f6fbef]/88 shadow-[0_18px_40px_rgba(95,132,72,0.22)]',
        page.status === 'failed' && 'border-[#d7b5ae] bg-[#fbf1ee]/92',
        page.status === 'pending' && 'border-[#dfd4bf]/72 opacity-72'
      )}
    >
      <div
        className="relative flex h-[180px] w-full min-w-0 shrink-0 items-center justify-center overflow-hidden bg-[#f5f1e8]/88 shadow-[0_5px_14px_rgba(93,107,77,0.08)]"
        style={{ contain: 'paint' }}
      >
        <div className="relative max-h-full max-w-full overflow-hidden" style={thumbnailFitStyle}>
          {hasPreview ? (
            <PreviewIframe
              key={`generating-thumb-${page.id}-${page.previewVersion ?? 0}`}
              src={page.sourceUrl}
              htmlPath={page.htmlPath}
              pageId={page.pageId}
              title={`generating-page-${page.pageNumber}`}
              slideSize={slideSize}
              inspectable={false}
              thumbnail
            />
          ) : (
            <div
              className={cn(
                'flex h-full w-full flex-col justify-between p-3',
                page.status === 'generating'
                  ? 'bg-[linear-gradient(135deg,#eef6e7_0%,#fff8ec_100%)]'
                  : page.status === 'failed'
                    ? 'bg-[#f7e7e2]'
                    : 'bg-[linear-gradient(135deg,#f5efe4_0%,#e9decb_100%)]'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="h-2 w-16 rounded-full bg-white/72" />
                <span className="h-5 w-5 rounded-md border border-white/80 bg-white/58" />
              </div>
              <div className="space-y-2">
                <span className="block h-3 w-3/4 rounded-full bg-white/78" />
                <span className="block h-2 w-11/12 rounded-full bg-white/56" />
                <span className="block h-2 w-7/12 rounded-full bg-white/56" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="h-7 rounded-md bg-white/54" />
                <span className="h-7 rounded-md bg-white/42" />
                <span className="h-7 rounded-md bg-white/54" />
              </div>
            </div>
          )}
        </div>

        {page.status === 'generating' && (
          <div className="absolute inset-0 border-2 border-[#83ad67]/70">
            <div className="absolute right-2 top-2 rounded-full bg-[#fffaf1]/90 p-1 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#5f8a43]" />
            </div>
          </div>
        )}

        {page.status === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#fbf1ee]/76">
            <CircleAlert className="h-6 w-6 text-[#a45f58]" />
          </div>
        )}
      </div>

      <div className="flex w-full min-w-0 items-center justify-between gap-2 px-0.5 pb-0.5 pt-2">
        <span className="shrink-0 rounded-md bg-[#5d6b4d]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#4f613f]">
          P{page.pageNumber}
        </span>
        {page.status !== 'failed' && (
          <span className="min-w-0 truncate text-xs font-medium text-[#4d5b40]" title={page.title}>
            {page.title}
          </span>
        )}
      </div>
    </div>
  )

  if (!hasPreview) return card

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>{card}</TooltipTrigger>
        <TooltipContent
          side="top"
          align="center"
          sideOffset={12}
          aria-label={`Page ${page.pageNumber} preview`}
          className="pointer-events-none z-[60] max-w-none border-[#b8d3a6] bg-[#fffaf1] p-2 shadow-[0_24px_64px_rgba(70,82,58,0.24)]"
        >
          <div className="relative flex h-[280px] w-[440px] items-center justify-center overflow-hidden rounded-lg bg-[#f5f1e8]">
            <div
              className="relative max-h-full max-w-full overflow-hidden"
              style={thumbnailFitStyle}
            >
              <PreviewIframe
                key={`generating-hover-preview-${page.id}-${page.previewVersion ?? 0}`}
                src={page.sourceUrl}
                htmlPath={page.htmlPath}
                pageId={page.pageId}
                title={`generating-hover-preview-${page.pageNumber}`}
                slideSize={slideSize}
                inspectable={false}
              />
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
