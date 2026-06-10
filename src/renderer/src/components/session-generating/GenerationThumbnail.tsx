import { CircleAlert, Loader2 } from 'lucide-react'
import { PreviewIframe } from '@renderer/components/preview/PreviewIframe'
import { cn } from '@renderer/lib/utils'
import type { GenerationPreviewPage } from './types'

export function GenerationThumbnail({
  page
}: {
  page: GenerationPreviewPage
}): React.JSX.Element {
  const hasPreview = page.status === 'completed' && (page.htmlPath || page.sourceUrl)

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-[#fffaf1]/78 shadow-[0_16px_34px_rgba(70,82,58,0.12)] transition-all duration-500',
        page.status === 'completed' && 'border-[#b8d3a6] translate-y-0 opacity-100',
        page.status === 'generating' &&
          'border-[#8fb873] bg-[#f6fbef]/88 shadow-[0_18px_40px_rgba(95,132,72,0.22)]',
        page.status === 'failed' && 'border-[#d7b5ae] bg-[#fbf1ee]/92',
        page.status === 'pending' && 'border-[#dfd4bf]/72 opacity-72'
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-t-[0.72rem] bg-[#efe6d6]">
        {hasPreview ? (
          <PreviewIframe
            key={`generating-thumb-${page.id}-${page.previewVersion ?? 0}`}
            src={page.sourceUrl}
            htmlPath={page.htmlPath}
            pageId={page.pageId}
            title={`generating-page-${page.pageNumber}`}
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

      <div className="flex items-center justify-between gap-2 px-2 py-2">
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
}
