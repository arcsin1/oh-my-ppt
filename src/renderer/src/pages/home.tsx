import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Input'
import { Card, CardContent } from '../components/ui/Card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/Select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/Tooltip'
import { CircleAlert, FileText, FileUp, Loader2, Sparkles } from 'lucide-react'
import { useSessionStore } from '../store'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import { ipc } from '@renderer/lib/ipc'
import { useT } from '../i18n'

const MIN_PAGE_COUNT = 1
const MAX_PAGE_COUNT = 40
const DEFAULT_PAGE_COUNT = 5
const MAX_DOCUMENT_SIZE_MB = 10
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const MAX_PPTX_SIZE_MB = 80
const MAX_PPTX_SIZE_BYTES = MAX_PPTX_SIZE_MB * 1024 * 1024

const buildNeutralInitialPrompt = (args: {
  topic: string
  pageCount: number
  styleLabel: string
}): string =>
  [
    `Create a ${args.pageCount}-slide presentation about "${args.topic}".`,
    `Style preset: ${args.styleLabel}.`,
    'Determine the presentation content language from the topic, detailed brief, and source documents; do not infer it from the application UI language or this instruction language.'
  ].join('\n')

const resolvePageCount = (raw: string): number => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_COUNT
  return Math.min(MAX_PAGE_COUNT, Math.max(MIN_PAGE_COUNT, parsed))
}

export function HomePage(): ReactElement {
  const navigate = useNavigate()
  const { createSession, loading } = useSessionStore()
  const { settings, modelConfigs, fetchSettings } = useSettingsStore()
  const { success, error, warning } = useToastStore()
  const t = useT()
  const [topic, setTopic] = useState('')
  const [brief, setBrief] = useState('')
  const [pageCount, setPageCount] = useState(String(DEFAULT_PAGE_COUNT))
  const [allowWebSearch, setAllowWebSearch] = useState(false)
  const [selectedStyleId, setSelectedStyleId] = useState('')
  const [styleOptions, setStyleOptions] = useState<
    Array<{ id: string; label: string; description: string }>
  >([])
  const [parsingDocument, setParsingDocument] = useState(false)
  const [importingPptx, setImportingPptx] = useState(false)
  const [pptxImportProgress, setPptxImportProgress] = useState<string | null>(null)
  const [documentParseError, setDocumentParseError] = useState<string | null>(null)
  const [referenceDocumentPath, setReferenceDocumentPath] = useState<string | null>(null)
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const pptxInputRef = useRef<HTMLInputElement | null>(null)

  const validateForm = (): string => {
    const topicText = topic.trim()
    if (!topicText) return t('home.validationTopic')

    if (!styleOptions.length) return t('home.validationStylesLoading')
    if (!selectedStyleId) return t('home.validationStyle')
    const selectedStyle = styleOptions.find((option) => option.id === selectedStyleId)
    if (!selectedStyle) return t('home.validationStyleMissing')

    const pageCountText = pageCount.trim()
    if (!pageCountText)
      return t('home.validationPageCount', { min: MIN_PAGE_COUNT, max: MAX_PAGE_COUNT })
    if (!/^\d+$/.test(pageCountText)) return t('home.validationPageCountNumber')
    const rawPageCount = Number.parseInt(pageCountText, 10)
    if (rawPageCount < MIN_PAGE_COUNT || rawPageCount > MAX_PAGE_COUNT) {
      return t('home.validationPageCountRange', { min: MIN_PAGE_COUNT, max: MAX_PAGE_COUNT })
    }

    const briefText = brief.trim()
    if (!briefText) return t('home.validationBrief')

    const activeModelConfig = modelConfigs.find((config) => config.active)
    const resolvedApiKey = (activeModelConfig?.apiKey || '').trim()
    const resolvedModel = (activeModelConfig?.model || '').trim()
    const resolvedStoragePath = (settings?.storagePath || '').trim()
    if (!resolvedApiKey || !resolvedModel || !resolvedStoragePath) return t('home.settingsRequired')

    return ''
  }

  const requiredReady = (() => {
    const topicText = topic.trim()
    const pageCountText = pageCount.trim()
    const briefText = brief.trim()
    if (!topicText || !selectedStyleId || !briefText) return false
    if (!/^\d+$/.test(pageCountText)) return false
    const n = Number.parseInt(pageCountText, 10)
    return n >= MIN_PAGE_COUNT && n <= MAX_PAGE_COUNT
  })()
  const isEnglish = settings?.locale === 'en'
  const webSearchReady = settings?.webSearch?.serviceStatus?.running === true

  useEffect(() => {
    ipc
      .getStyles()
      .then(({ categories }) => {
        const flat = Object.values(categories).flat()
        setStyleOptions(flat)
        setSelectedStyleId(flat.length > 0 ? flat[0].id : '')
      })
      .catch((err) => {
        error(t('home.styleLoadFailed'), {
          description: err instanceof Error ? err.message : t('common.retryLater')
        })
      })
  }, [error, t])

  const handleSubmit = async (): Promise<void> => {
    const validationError = validateForm()
    if (validationError) {
      if (validationError === t('home.settingsRequired')) {
        warning(t('home.settingsRequiredTitle'), {
          description: t('home.settingsRequired'),
          action: {
            label: t('home.goToSettings'),
            onClick: () => navigate('/settings')
          }
        })
        return
      }
      warning(t('home.completeInfoTitle'), { description: validationError })
      return
    }
    const selectedStyle = styleOptions.find((option) => option.id === selectedStyleId)!
    const topicText = topic.trim()
    const briefText = brief.trim()
    const safePageCount = Number.parseInt(pageCount.trim(), 10)
    const initialPrompt =
      briefText ||
      buildNeutralInitialPrompt({
        topic: topicText || 'Untitled topic',
        pageCount: safePageCount,
        styleLabel: selectedStyle.label
      })

    try {
      const sessionId = await createSession({
        topic: topicText,
        styleId: selectedStyleId,
        pageCount: safePageCount,
        referenceDocumentPath: referenceDocumentPath || undefined,
        allowWebSearch
      })
      success(t('home.sessionCreated'), {
        description: t('home.generationStarted'),
        duration: 1000
      })
      setPageCount(String(safePageCount))
      navigate(`/sessions/${sessionId}/generating`, {
        state: {
          initialPrompt
        }
      })
    } catch (err) {
      error(t('home.sessionCreateFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    }
  }

  const handleParseDocumentClick = (): void => {
    if (parsingDocument) return
    documentInputRef.current?.click()
  }

  const handleImportPptxClick = (): void => {
    if (importingPptx) return
    pptxInputRef.current?.click()
  }

  const handleDocumentFilesSelected = async (files: FileList | null): Promise<void> => {
    const selectedFiles = Array.from(files || [])
    if (documentInputRef.current) {
      documentInputRef.current.value = ''
    }
    if (selectedFiles.length === 0) return
    if (selectedFiles.length > 1) {
      const message = t('home.documentSingleOnly')
      setDocumentParseError(message)
      error(t('home.documentCountExceeded'), {
        description: message
      })
      return
    }
    const selectedFile = selectedFiles[0]
    if (selectedFile.size > MAX_DOCUMENT_SIZE_BYTES) {
      const message = t('home.documentTooLarge', { maxSize: MAX_DOCUMENT_SIZE_MB })
      setDocumentParseError(message)
      error(t('home.documentTooLargeTitle'), {
        description: message
      })
      return
    }

    const payloadFiles = selectedFiles
      .map((file) => ({
        path: window.electron?.getPathForFile?.(file) || '',
        name: file.name
      }))
      .filter((file) => file.path)

    if (payloadFiles.length === 0) {
      setDocumentParseError(t('home.documentPathFailed'))
      error(t('home.documentPathFailedTitle'))
      return
    }

    const safePageCount = /^\d+$/.test(pageCount.trim())
      ? resolvePageCount(pageCount.trim())
      : DEFAULT_PAGE_COUNT

    setParsingDocument(true)
    setDocumentParseError(null)
    try {
      const result = await ipc.parseDocumentPlan({
        files: payloadFiles,
        topic: topic.trim(),
        pageCount: safePageCount,
        existingBrief: brief.trim()
      })
      setTopic(result.topic)
      setPageCount(String(result.pageCount))
      setBrief(result.briefText)
      setReferenceDocumentPath(result.files[0]?.path || null)
      success(t('home.documentParsed'), {
        description: t('home.documentParsedDescription', { count: result.files.length })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.retryLater')
      setDocumentParseError(message)
      error(t('home.documentParseFailed'), {
        description: message
      })
    } finally {
      setParsingDocument(false)
    }
  }

  const handlePptxFilesSelected = async (files: FileList | null): Promise<void> => {
    const selectedFiles = Array.from(files || [])
    if (pptxInputRef.current) {
      pptxInputRef.current.value = ''
    }
    if (selectedFiles.length === 0) return
    if (selectedFiles.length > 1) {
      error(t('home.pptxSingleOnlyTitle'), {
        description: t('home.pptxSingleOnly')
      })
      return
    }
    const selectedFile = selectedFiles[0]
    if (!/\.pptx$/i.test(selectedFile.name)) {
      error(t('home.unsupportedFileTitle'), {
        description: t('home.unsupportedPptx')
      })
      return
    }
    if (selectedFile.size > MAX_PPTX_SIZE_BYTES) {
      error(t('home.pptxTooLargeTitle'), {
        description: t('home.pptxTooLarge', { maxSize: MAX_PPTX_SIZE_MB })
      })
      return
    }
    const filePath = window.electron?.getPathForFile?.(selectedFile) || ''
    if (!filePath) {
      error(t('home.pptxPathFailedTitle'), {
        description: t('home.pptxPathFailed')
      })
      return
    }

    setImportingPptx(true)
    setPptxImportProgress(t('home.pptxPreparing'))
    try {
      const result = await ipc.importPptx({
        filePath,
        title: selectedFile.name.replace(/\.pptx$/i, ''),
        styleId: selectedStyleId || null
      })
      success(t('home.pptxImportDone'), {
        description:
          result.warnings.length > 0
            ? t('home.pptxImportedWithWarnings', {
                pageCount: result.pageCount,
                warningCount: result.warnings.length
              })
            : t('home.pptxImported', { pageCount: result.pageCount })
      })
      navigate(`/sessions/${result.sessionId}`)
    } catch (err) {
      error(t('home.pptxImportFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setImportingPptx(false)
      setPptxImportProgress(null)
    }
  }

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    // 提前注册，避免主进程导入刚开始时的进度事件丢失。
    return ipc.onPptxImportProgress((payload) => {
      setPptxImportProgress(`${payload.label}${payload.progress ? ` · ${payload.progress}%` : ''}`)
    })
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {t('home.eyebrow')}
        </p>
        <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">
          {t('home.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('home.description')}</p>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <TooltipProvider delayDuration={180}>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleParseDocumentClick}
                        disabled={parsingDocument || importingPptx}
                        className="shrink-0"
                      >
                        {parsingDocument ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="mr-2 h-4 w-4" />
                        )}
                        {parsingDocument ? t('home.parsingDocument') : t('home.uploadDocument')}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    {t('home.uploadDocumentTooltip', { maxSize: MAX_DOCUMENT_SIZE_MB })}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleImportPptxClick}
                        disabled={importingPptx || parsingDocument}
                        className="shrink-0"
                      >
                        {importingPptx ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileUp className="mr-2 h-4 w-4" />
                        )}
                        {importingPptx ? t('home.importingPptx') : t('home.importPptx')}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    {t('home.importPptxTooltip', { maxSize: MAX_PPTX_SIZE_MB })}
                  </TooltipContent>
                </Tooltip>

                {referenceDocumentPath && !parsingDocument ? (
                  <span className="rounded-full bg-[#e8f0df] px-2.5 py-1 text-xs text-[#4f6340]">
                    {t('home.parsed')}
                  </span>
                ) : null}
              </div>
            </TooltipProvider>

            {pptxImportProgress ? (
              <p className="min-w-0 text-xs text-[#4f6340]">{pptxImportProgress}</p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('home.localOnly')}</p>

          <input
            ref={documentInputRef}
            type="file"
            accept=".md,.txt,.text,.csv,.docx"
            multiple={false}
            className="hidden"
            onChange={(event) => void handleDocumentFilesSelected(event.target.files)}
          />
          <input
            ref={pptxInputRef}
            type="file"
            accept=".pptx"
            multiple={false}
            className="hidden"
            onChange={(event) => void handlePptxFilesSelected(event.target.files)}
          />
        </div>
        {documentParseError && (
          <div className="flex items-start gap-2 rounded-md border border-[#d58b7f]/45 bg-[#fff2ef] px-3 py-2 text-xs text-[#8a3d33]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{documentParseError}</span>
          </div>
        )}

        <Card className="mb-4">
          <CardContent className="space-y-4 py-5">
            <div>
              <label className="mb-2 block text-sm font-medium">{t('home.topic')}</label>
              <Input
                placeholder={t('home.topicPlaceholder')}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <label className="mb-2 block text-sm font-medium">{t('home.style')}</label>
                <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('home.stylePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {styleOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        <span className="flex items-baseline gap-1.5">
                          {option.label}
                          {option.description && (
                            <span className="text-xs text-muted-foreground/60">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">{t('home.pageCount')}</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder={`${MIN_PAGE_COUNT}-${MAX_PAGE_COUNT}`}
                  value={pageCount}
                  required
                  onChange={(e) => {
                    const next = e.target.value
                    if (next === '') {
                      setPageCount('')
                      return
                    }
                    if (!/^\d+$/.test(next)) return
                    setPageCount(next)
                  }}
                  onBlur={() => {
                    setPageCount(String(resolvePageCount(pageCount)))
                  }}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">{t('home.brief')}</label>
              <Textarea
                placeholder={t('home.briefPlaceholder')}
                rows={5}
                value={brief}
                required
                onChange={(e) => setBrief(e.target.value)}
                className="min-h-[132px] resize-y"
              />
            </div>

            <label
              className={`flex items-start gap-3 rounded-md border border-border/70 px-4 py-3 ${webSearchReady ? '' : 'opacity-70'}`}
            >
              <input
                type="checkbox"
                checked={allowWebSearch}
                onChange={(e) => setAllowWebSearch(e.target.checked)}
                disabled={!webSearchReady}
                className="mt-1 h-4 w-4 rounded border-border text-primary"
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">
                  {isEnglish ? 'Allow web search' : '允许联网搜索'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {webSearchReady
                    ? isEnglish
                      ? 'When enabled, the AI may use web search for recent information and verifiable real-world data.'
                      : '开启后，AI 才会获得联网搜索权限，用于检索最新信息和可核实的现实数据。'
                    : isEnglish
                      ? 'Start the web search service in Settings before enabling this option.'
                      : '请先在系统设置中启动联网搜索服务，再开启这个选项。'}
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              void handleSubmit()
            }}
            className="w-full md:w-auto"
            disabled={loading || !requiredReady}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {loading ? t('home.creating') : t('home.createAndStart')}
          </Button>
        </div>
      </div>
    </div>
  )
}
