import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  FileText,
  FileUp,
  Loader2,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  X
} from 'lucide-react'
import { CORPORATE_TEMPLATE_ID } from '@shared/brand.js'
import type { SourceDocumentPlan } from '@shared/generation'
import templatePreviewUrl from '@renderer/assets/images/corporate-template-preview.png'
import { ipc } from '@renderer/lib/ipc'
import { useModelAction } from '@renderer/hooks/useModelAction'
import { useTemplateStore, useToastStore } from '@renderer/store'
import {
  buildCorporatePrompt,
  clampCorporatePageCount,
  resolveCorporateCreationPageCount,
  resolveCorporateDocumentTotalPageCount,
  shouldIncludeCorporateAgenda
} from './home-utils'

const MAX_PPTX_SIZE_MB = 500
const MAX_PPTX_SIZE_BYTES = MAX_PPTX_SIZE_MB * 1024 * 1024
const MAX_DOCUMENT_SIZE_MB = 10
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const SUPPORTED_DOCUMENT_NAME = /\.(pdf|docx|xlsx|xls|md|txt|text|csv|png|jpe?g|webp)$/i

type CorporateReferencePlan = {
  topic: string
  contentPageCount: number
  referenceDocumentPath: string
  sourcePlan?: SourceDocumentPlan
  fileName: string
}

export function HomePage(): ReactElement {
  const navigate = useNavigate()
  const { success, error, warning } = useToastStore()
  const { createSessionFromTemplate } = useTemplateStore()
  const { ensureModelActive } = useModelAction()
  const [brief, setBrief] = useState('')
  const [creating, setCreating] = useState(false)
  const [parsingDocument, setParsingDocument] = useState(false)
  const [referencePlan, setReferencePlan] = useState<CorporateReferencePlan | null>(null)
  const [importingPptx, setImportingPptx] = useState(false)
  const [pptxImportProgress, setPptxImportProgress] = useState<string | null>(null)
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const pptxInputRef = useRef<HTMLInputElement | null>(null)

  const handleCreate = useCallback(async (): Promise<void> => {
    const request = brief.trim()
    if (!request) {
      warning('请输入汇报主题或粘贴提纲')
      return
    }
    const modelConfigId = await ensureModelActive()
    if (!modelConfigId) return
    const includeAgenda = shouldIncludeCorporateAgenda({
      brief: request,
      sourcePlan: referencePlan?.sourcePlan
    })
    const pageCount = resolveCorporateCreationPageCount({
      brief: request,
      contentPageCount: referencePlan?.contentPageCount,
      includeAgenda
    })
    setCreating(true)
    try {
      const sessionId = await createSessionFromTemplate({
        templateId: CORPORATE_TEMPLATE_ID,
        title: (referencePlan?.topic || request).replace(/\s+/g, ' ').slice(0, 56),
        modelConfigId,
        pageCount,
        includeAgenda,
        referenceDocumentPath: referencePlan?.referenceDocumentPath,
        sourcePlan: referencePlan?.sourcePlan
      })
      success('已创建安居建业演示', {
        description: `正在按公司模板生成 ${pageCount} 页内容。`
      })
      navigate(`/sessions/${sessionId}/template-generating`, {
        state: {
          initialPrompt: buildCorporatePrompt({
            brief: request,
            pageCount,
            hasReferenceDocument: Boolean(referencePlan),
            includeAgenda
          }),
          modelConfigId
        }
      })
    } catch (createError) {
      error('创建演示失败', {
        description: createError instanceof Error ? createError.message : '请稍后重试。'
      })
    } finally {
      setCreating(false)
    }
  }, [
    brief,
    createSessionFromTemplate,
    ensureModelActive,
    error,
    navigate,
    referencePlan,
    success,
    warning
  ])

  const validateUploadReady = useCallback(async (): Promise<boolean> => {
    const validation = await ipc.validateUploadPrerequisites()
    if (validation.ready) return true
    warning('请先完成设置', {
      description: validation.message || '需要个人 AI 服务和本地文件目录。',
      action: { label: '前往设置', onClick: () => navigate('/settings') }
    })
    return false
  }, [navigate, warning])

  const validateStorageReady = useCallback(async (): Promise<boolean> => {
    const settings = await ipc.getSettings()
    const storagePath =
      typeof settings.storagePath === 'string' ? settings.storagePath.trim() : ''
    if (storagePath) return true
    warning('请先选择本地文件目录', {
      description: '导入 PPTX 不需要 AI，但需要一个本地目录保存可编辑页面。',
      action: { label: '前往设置', onClick: () => navigate('/settings') }
    })
    return false
  }, [navigate, warning])

  const handleDocumentClick = useCallback(async (): Promise<void> => {
    if (parsingDocument) return
    const modelConfigId = await ensureModelActive()
    if (!modelConfigId || !(await validateUploadReady())) return
    documentInputRef.current?.click()
  }, [ensureModelActive, parsingDocument, validateUploadReady])

  const handleDocumentSelected = useCallback(
    async (files: FileList | null): Promise<void> => {
      const selectedFile = Array.from(files || [])[0]
      if (documentInputRef.current) documentInputRef.current.value = ''
      if (!selectedFile) return
      if (!SUPPORTED_DOCUMENT_NAME.test(selectedFile.name)) {
        error('暂不支持此文件', {
          description: '请选择 PDF、Word、Excel、Markdown、TXT、CSV 或常见图片。'
        })
        return
      }
      if (selectedFile.size > MAX_DOCUMENT_SIZE_BYTES) {
        error('文件过大', { description: `参考资料不能超过 ${MAX_DOCUMENT_SIZE_MB}MB。` })
        return
      }
      const filePath = window.electron?.getPathForFile?.(selectedFile) || ''
      if (!filePath) {
        error('无法读取文件路径')
        return
      }
      const modelConfigId = await ensureModelActive()
      if (!modelConfigId || !(await validateUploadReady())) return

      setParsingDocument(true)
      try {
        const result = await ipc.parseDocumentPlan({
          files: [{ path: filePath, name: selectedFile.name }],
          modelConfigId,
          existingBrief: brief.trim()
        })
        const referenceFile = result.files[0]
        if (!referenceFile?.path) throw new Error('参考资料解析完成，但未返回可读取的资料文件')
        const contentPageCount = clampCorporatePageCount(result.pageCount)
        const includeAgenda = shouldIncludeCorporateAgenda({
          brief: result.briefText,
          sourcePlan: result.sourcePlan
        })
        const totalPageCount = resolveCorporateDocumentTotalPageCount({
          contentPageCount,
          includeAgenda
        })
        setBrief(result.briefText)
        setReferencePlan({
          topic: result.topic,
          contentPageCount,
          referenceDocumentPath: referenceFile.path,
          sourcePlan: result.sourcePlan,
          fileName: selectedFile.name
        })
        success('参考资料解析完成', {
          description: `已形成“${result.topic}”的 ${contentPageCount} 个正文页建议，默认生成 ${totalPageCount} 页演示。`
        })
      } catch (parseError) {
        error('参考资料解析失败', {
          description: parseError instanceof Error ? parseError.message : '请稍后重试。'
        })
      } finally {
        setParsingDocument(false)
      }
    },
    [brief, ensureModelActive, error, success, validateUploadReady]
  )

  const handleImportPptxClick = useCallback(async (): Promise<void> => {
    if (importingPptx) return
    if (!(await validateStorageReady())) return
    pptxInputRef.current?.click()
  }, [importingPptx, validateStorageReady])

  const handlePptxFilesSelected = useCallback(
    async (files: FileList | null): Promise<void> => {
      const selectedFile = Array.from(files || [])[0]
      if (pptxInputRef.current) pptxInputRef.current.value = ''
      if (!selectedFile) return
      if (!/\.pptx$/i.test(selectedFile.name)) {
        error('仅支持导入 PPTX 文件')
        return
      }
      if (selectedFile.size > MAX_PPTX_SIZE_BYTES) {
        error('文件过大', { description: `PPTX 不能超过 ${MAX_PPTX_SIZE_MB}MB。` })
        return
      }
      const filePath = window.electron?.getPathForFile?.(selectedFile) || ''
      if (!filePath) {
        error('无法读取文件路径')
        return
      }
      if (!(await validateStorageReady())) return

      setImportingPptx(true)
      setPptxImportProgress('正在准备导入')
      try {
        const result = await ipc.importPptx({
          filePath,
          title: selectedFile.name.replace(/\.pptx$/i, ''),
          styleId: null
        })
        success('PPTX 导入完成', {
          description: `已导入 ${result.pageCount} 页，可继续编辑。`
        })
        navigate(`/sessions/${result.sessionId}`)
      } catch (importError) {
        error('PPTX 导入失败', {
          description: importError instanceof Error ? importError.message : '请稍后重试。'
        })
      } finally {
        setImportingPptx(false)
        setPptxImportProgress(null)
      }
    },
    [error, navigate, success, validateStorageReady]
  )

  useEffect(() =>
    ipc.onPptxImportProgress((payload) => {
      setPptxImportProgress(`${payload.label}${payload.progress ? ` · ${payload.progress}%` : ''}`)
    }), [])

  return (
    <main className="mx-auto w-full max-w-[1180px] px-8 pb-10 pt-12 text-[#4c4c4c]">
      <section>
        <h1 className="text-[38px] font-semibold leading-tight tracking-[-0.025em] text-[#333333]">
          开始制作安居建业演示文稿
        </h1>

        <div className="mt-7 rounded-xl border border-[#e4dcd0] bg-white p-4 shadow-[0_12px_30px_rgba(76,76,76,0.07)]">
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="输入汇报主题或粘贴提纲，也可以上传参考资料由 AI 梳理"
            className="h-[112px] w-full resize-none border-0 bg-transparent px-2 py-1 text-[15px] leading-6 text-[#3e3a36] outline-none placeholder:text-[#aaa39a]"
          />
          {referencePlan ? (
            <div className="mx-2 mb-3 flex items-center gap-3 rounded-lg border border-[#f1d7bf] bg-[#fff8f1] px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-[#e21b22]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[#4b423b]">
                  {referencePlan.fileName}
                </span>
                <span className="mt-0.5 block text-[11px] text-[#8c7e73]">
                  已读取资料 · 建议 {referencePlan.contentPageCount} 个正文页 ·
                  可继续编辑上方要求
                </span>
              </span>
              <button
                type="button"
                aria-label="移除参考资料"
                onClick={() => setReferencePlan(null)}
                className="rounded p-1 text-[#9a8f86] hover:bg-white hover:text-[#e21b22]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-[#f0e9df] pt-3">
            <span className="text-xs text-[#989087]">
              支持 1–50 页；可在要求中注明页数，例如“制作 12 页年度总结”
            </span>
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreate()}
              className="inline-flex h-10 min-w-[126px] items-center justify-center rounded-lg bg-[#e21b22] px-5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(226,27,34,0.18)] transition-colors hover:bg-[#ba1218] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              开始创建
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <button
            type="button"
            disabled={parsingDocument}
            onClick={() => void handleDocumentClick()}
            className="group flex min-h-[86px] items-center gap-4 rounded-xl border border-[#e4dcd0] bg-white px-5 text-left transition-all hover:border-[#f5831f]/45 hover:shadow-[0_9px_24px_rgba(76,76,76,0.06)] disabled:opacity-60"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fff3e9] text-[#f5831f]">
              {parsingDocument ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-[#3d3935]">上传参考资料</span>
              <span className="mt-1 block text-xs text-[#817b73]">
                {parsingDocument ? '正在读取并梳理内容' : '支持 PDF、Word、表格、文本和图片'}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 text-[#aaa39a] transition-transform group-hover:translate-x-0.5" />
          </button>

          <button
            type="button"
            onClick={() => navigate('/thinking')}
            className="group flex min-h-[86px] items-center gap-4 rounded-xl border border-[#e4dcd0] bg-white px-5 text-left transition-all hover:border-[#f5831f]/45 hover:shadow-[0_9px_24px_rgba(76,76,76,0.06)]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fff3e9] text-[#f5831f]">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-[#3d3935]">对话创作</span>
              <span className="mt-1 block text-xs text-[#817b73]">与 AI 对话，梳理思路并形成汇报结构</span>
            </span>
            <ArrowRight className="h-4 w-4 text-[#aaa39a] transition-transform group-hover:translate-x-0.5" />
          </button>

          <button
            type="button"
            disabled={importingPptx}
            onClick={() => void handleImportPptxClick()}
            className="group flex min-h-[86px] items-center gap-4 rounded-xl border border-[#e4dcd0] bg-white px-5 text-left transition-all hover:border-[#f5831f]/45 hover:shadow-[0_9px_24px_rgba(76,76,76,0.06)] disabled:opacity-60"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fff3e9] text-[#f5831f]">
              {importingPptx ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-[#3d3935]">导入 PPTX</span>
              <span className="mt-1 block truncate text-xs text-[#817b73]">
                {pptxImportProgress || '保留原有颜色和版式，导入后继续编辑'}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 text-[#aaa39a] transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </section>

      <section className="mt-9">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-[17px] font-semibold text-[#3d3935]">安居建业标准模板 · 16:9</h2>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#817b73]">
            <LockKeyhole className="h-3.5 w-3.5" /> 所有新演示均使用公司模板
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-[#e2d8cb] bg-white shadow-[0_14px_34px_rgba(76,76,76,0.07)]">
          <img
            src={templatePreviewUrl}
            alt="安居建业标准模板封面预览"
            className="aspect-video w-full object-cover"
            draggable={false}
          />
          <div className="flex items-center justify-between border-t border-[#eee6db] px-4 py-3 text-xs text-[#817b73]">
            <span className="inline-flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-[#e21b22]" />
              封面、可选目录、统一正文页和固定结束页
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[#c96a31]" /> 文件仅保存在本机
            </span>
          </div>
        </div>
      </section>

      <input
        ref={documentInputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.xls,.md,.txt,.text,.csv,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(event) => void handleDocumentSelected(event.target.files)}
      />
      <input
        ref={pptxInputRef}
        type="file"
        accept=".pptx"
        className="hidden"
        onChange={(event) => void handlePptxFilesSelected(event.target.files)}
      />
    </main>
  )
}
