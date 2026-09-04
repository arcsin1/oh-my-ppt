import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { nanoid } from 'nanoid'
import { Loader2 } from 'lucide-react'
import {
  buildEditModeCleanupScript,
  buildEditModeInjectScript,
  buildEditModeSetPreviewScaleScript,
  buildInspectorCleanupScript,
  buildInspectorInjectScript,
  EDIT_MODE_CONSOLE_PREFIX,
  INSPECTOR_CONSOLE_PREFIX,
  type EditableElementSnapshot,
  type EditModeMovePayload,
  type EditSnapPoints,
  type EditSnapSettings,
  type EditTextTarget,
  type EditSelectionPayload,
  type PresentationEditorOperation,
  type PresentationEditorOperationResult,
  type PresentationElementSnapshot
} from '@arcsin1/presentation-editor-runtime'
import { ipc } from '@renderer/lib/ipc'
import {
  normalizeEditModeLayoutIsland,
  type EditModeLayoutIsland
} from '@renderer/lib/presentation-layout-island'
import { useT } from '@renderer/i18n'
import { useHtmlEditorStore } from '../../store/htmlEditorStore'
import {
  HtmlEditorGuidesOverlay,
  type GuidesSnapBridge,
  EDITOR_INSET
} from './HtmlEditorGuidesOverlay'
import type { InteractionMode } from '@renderer/store'
import type { InsertChartSeries } from '../session-detail/workspace/insert-charts'

export interface HtmlEditorCanvasHandle {
  patchPageContent: (pageId: string, newHtml: string) => void
  liveUpdateElement: (
    selector: string,
    patch: {
      html?: string
      text?: string
      textTarget?: EditTextTarget
      formula?: {
        latex: string
        html: string
        displayMode: boolean
        originalLatex?: string
      }
      chart?: {
        type: string
        title: string
        labels: string[]
        values: number[]
        series: InsertChartSeries[]
        primaryColor: string
        accentColor: string
        textColor: string
        smooth: boolean
        horizontal: boolean
        stacked: boolean
        areaFill: boolean
        showPoints: boolean
        showLegend: boolean
        doughnutCutout: number
        radarFill: boolean
        configJson: string
      }
      style?: { color?: string; fontSize?: string; fontWeight?: string; textAlign?: string }
    }
  ) => void
  applyElementProperties: (
    selector: string,
    patch: {
      style?: {
        zIndex?: number
        opacity?: number
        backgroundColor?: string
        color?: string
        fontSize?: string
        fontWeight?: string
        textAlign?: string
        objectFit?: string
      }
      attrs?: {
        alt?: string
        poster?: string
        controls?: boolean
        muted?: boolean
        loop?: boolean
        autoplay?: boolean
        playsInline?: boolean
        preload?: string
      }
    }
  ) => void
  setElementLayout: (
    selector: string,
    layout: { x?: number; y?: number; width?: number; height?: number }
  ) => void
  restoreEditModeSelection: (selector: string) => Promise<boolean>
  restoreInspectorSelection: (selector: string) => Promise<boolean>
  clearEditModeSelection: () => void
  hideElement: (selector: string) => void
  showElement: (selector: string) => void
  applyDragStyle: (
    selector: string,
    style: {
      x: number
      y: number
      width?: number
      height?: number
      isAbsoluteMode?: boolean
    }
  ) => void
  applyLayoutIsland: (layoutIsland: EditModeLayoutIsland) => void
  applyZIndex: (selector: string, zIndex: number) => void
  copyElement: (
    selector: string,
    newBlockId: string
  ) => Promise<{ selector: string; htmlFragment: string } | null>
  ensureChartJs: () => Promise<boolean>
  readElementHtml: (selector: string) => Promise<string>
  readElementSnapshot: (selector: string) => Promise<EditableElementSnapshot | null>
  inspectElement: (selector: string) => Promise<PresentationElementSnapshot | null>
  applyElementOperations: (
    selector: string,
    operations: PresentationEditorOperation[]
  ) => Promise<PresentationEditorOperationResult[]>
  readElementLayout: (selector: string) => Promise<{
    isAbsoluteMode: boolean
    x: number
    y: number
    width: number
    height: number
    visualX?: number
    visualY?: number
    layoutIsland?: EditModeLayoutIsland
  } | null>
  applyChildUpdates: (
    selector: string,
    childUpdates: Array<{ path: number[]; width?: number; height?: number }>
  ) => void
  injectElement: (
    parentSelector: string,
    htmlFragment: string,
    insertIndex?: number,
    selectAfterInsert?: boolean
  ) => Promise<boolean>
  setEditSnapSettings: (settings: EditSnapSettings) => Promise<boolean>
  readEditSnapPoints: () => Promise<EditSnapPoints>
}

export function applyHtmlEditorPreviewUrlParams(
  inputUrl: string,
  {
    playback,
    thumbnail,
    pageId
  }: { playback: boolean; thumbnail: boolean; pageId?: string }
): string {
  const url = new URL(inputUrl)
  // HtmlEditorCanvas already scales the logical slide canvas into its viewport.
  // Disable page-level auto-fit to avoid double-scaling on specific pages.
  url.searchParams.set('fit', 'off')
  if (thumbnail) {
    url.searchParams.set('thumbnail', '1')
    if (pageId) url.searchParams.set('pageId', pageId)
  }
  // Editing and thumbnails must be deterministic. Interactive preview keeps the
  // page runtime active so click handlers, page navigation, and animations run.
  url.searchParams.set('pptPlayback', playback && !thumbnail ? '1' : '0')
  if (playback && !thumbnail) url.searchParams.delete('print')
  else url.searchParams.set('print', '1')
  return url.toString()
}

export const resolveHtmlEditorCanvasSource = (
  baseUrl: string | undefined,
  activeUrl: string | undefined
): string | undefined => activeUrl || baseUrl

export const HtmlEditorCanvas = forwardRef<
  HtmlEditorCanvasHandle,
  {
    html?: string
    src?: string
    title: string
    htmlPath?: string
    pageId?: string
    inspecting?: boolean
    inspectable?: boolean
    editMode?: boolean
    thumbnail?: boolean
    playback?: boolean
    activeUrl?: string
    onActiveUrlChange?: (url: string) => void
    interactionMode?: InteractionMode
    designWidth?: number
    reloadSignal?: number
    onSelectorSelected?: (
      selector: string,
      label: string,
      elementTag?: string,
      elementText?: string
    ) => void
    onElementMoved?: (payload: EditModeMovePayload) => void
    onElementSelected?: (payload: EditSelectionPayload) => void
    onInspectExit?: () => void
    onDidReload?: () => void
    onDeleteRequest?: (selector: string) => void
  }
>(function HtmlEditorCanvas(
  {
    src,
    title,
    htmlPath,
    pageId,
    inspecting = false,
    inspectable = false,
    editMode = false,
    thumbnail = false,
    playback = false,
    activeUrl,
    onActiveUrlChange,
    interactionMode,
    designWidth = 1280,
    reloadSignal = 0,
    onSelectorSelected,
    onElementMoved,
    onElementSelected,
    onInspectExit,
    onDidReload,
    onDeleteRequest
  },
  ref
) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const webviewReadyRef = useRef(false)
  const inspectorInjectedRef = useRef(false)
  const editModeInjectedRef = useRef(false)
  const previewScaleRef = useRef(1)
  const [webviewElement, setWebviewElement] = useState<Electron.WebviewTag | null>(null)
  const [webviewReady, setWebviewReady] = useState(false)
  const [transform, setTransform] = useState('scale(1)')
  const [previewScale, setPreviewScale] = useState(1)
  const [contentHeight, setContentHeight] = useState(720)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const snapBridgeRef = useRef<GuidesSnapBridge | null>(null)

  useEffect(() => {
    previewScaleRef.current = previewScale
  }, [previewScale])

  const resolvePageHtmlPath = (inputPath?: string, currentPageId?: string): string | undefined => {
    if (!inputPath) return undefined
    const isIndex = /[\\/]index\.html?$/i.test(inputPath)
    if (!isIndex) return inputPath
    if (!currentPageId) return undefined
    return inputPath.replace(/index\.html?$/i, `${currentPageId}.html`)
  }

  const encodePathSegments = (filePath: string): string =>
    filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')

  const applyPreviewUrlParams = (inputUrl: string): string =>
    applyHtmlEditorPreviewUrlParams(inputUrl, { playback, thumbnail, pageId })

  const toFileUrl = (absolutePath: string): string => {
    const normalizedPath = absolutePath.replace(/\\/g, '/')
    const fileUrl = /^[a-zA-Z]:\//.test(normalizedPath)
      ? `file:///${normalizedPath.slice(0, 2)}${encodePathSegments(normalizedPath.slice(2))}`
      : normalizedPath.startsWith('/')
        ? `file://${encodePathSegments(normalizedPath)}`
        : `file:///${encodePathSegments(normalizedPath)}`
    return applyPreviewUrlParams(fileUrl)
  }

  const withPreviewParams = (inputUrl: string): string => {
    return applyPreviewUrlParams(inputUrl)
  }

  // Always preview concrete page file (<pageId>.html). index.html is only for external full-deck preview.
  const pageHtmlPath = resolvePageHtmlPath(htmlPath, pageId)
  const baseWebviewSrc = pageHtmlPath
    ? toFileUrl(pageHtmlPath)
    : src
      ? withPreviewParams(src)
      : undefined
  // The deck runtime can switch pages entirely in memory without changing the URL.
  // Keep the already loaded source unchanged when entering edit mode so that runtime
  // state, including the currently visible page, is not reset by a webview reload.
  const webviewSrc = resolveHtmlEditorCanvasSource(baseWebviewSrc, activeUrl)
  const currentInteractionMode: InteractionMode =
    interactionMode || (editMode ? 'edit' : inspecting ? 'ai-inspect' : 'preview')
  const pointerEnabled = inspectable

  const ensureAnchoredAnchor = async (args: {
    selector: string
    elementTag?: string
    elementText?: string
    reason: 'inspect' | 'drag' | 'text-edit'
    formula?: EditableElementSnapshot['formula']
  }): Promise<{ selector: string; blockId?: string }> => {
    if (!pageHtmlPath || !pageId) {
      throw new Error('Cannot anchor element without page path and page id')
    }
    const existingBlockId = args.selector.match(/\[data-block-id="([^"]+)"\]/)?.[1]
    if (existingBlockId) return { selector: args.selector, blockId: existingBlockId }
    try {
      const result = await ipc.ensureHtmlAnchor({
        html: useHtmlEditorStore.getState().html,
        pageId,
        selector: args.selector,
        elementTag: args.elementTag,
        formula: args.formula
      })
      if (result.changed) {
        useHtmlEditorStore.getState().setHtml(result.html)
      }
      if (result.changed && result.blockId) {
        const webview = webviewRef.current
        if (webview) {
          safeExecuteJavaScript(
            webview,
            `(() => {
              var __selector = ${JSON.stringify(args.selector)};
              var __blockId = ${JSON.stringify(result.blockId)};
              var __latex = ${JSON.stringify(args.formula?.latex || '')};
              var __normalize = function(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); };
              var __nodes = [];
              try { __nodes = Array.prototype.slice.call(document.querySelectorAll(__selector)); } catch (_error) {}
              var __el = __nodes.length === 1 ? __nodes[0] : null;
              if (!__el && __latex) {
                var __formulaNodes = Array.prototype.slice.call(document.querySelectorAll('.katex'));
                var __matches = __formulaNodes.filter(function(node) {
                  if (!(node instanceof Element) || node.getAttribute('data-block-id')) return false;
                  var annotation = node.querySelector('annotation[encoding="application/x-tex"]');
                  var latex = node.getAttribute('data-ppt-formula-latex') || (annotation ? annotation.textContent : '');
                  return __normalize(latex) === __normalize(__latex);
                });
                if (__matches.length === 1) __el = __matches[0];
              }
              if (__el instanceof Element) {
                var __target = __el.classList.contains('katex-display') && !__el.classList.contains('katex')
                  ? (__el.querySelector('.katex') || __el)
                  : __el;
                if (!__target.getAttribute('data-block-id')) __target.setAttribute('data-block-id', __blockId);
              }
            })();`
          )
        }
      }
      return { selector: result.selector || args.selector, blockId: result.blockId }
    } catch {
      throw new Error('Failed to anchor selected element')
    }
  }

  const handleWebviewRef = useCallback((node: Electron.WebviewTag | null): void => {
    webviewReadyRef.current = false
    inspectorInjectedRef.current = false
    editModeInjectedRef.current = false
    setWebviewReady(false)
    webviewRef.current = node
    setWebviewElement((prev) => (prev === node ? prev : node))
  }, [])

  const canExecuteJavaScript = (webview: Electron.WebviewTag): boolean => {
    return webview.isConnected && webviewRef.current === webview && webviewReadyRef.current
  }

  const wrapSafeVoidScript = (label: string, script: string): string => `
(() => {
  try {
    ${script}
  } catch (error) {
    const message = error && (error.stack || error.message || String(error));
    console.error("[HtmlEditorCanvas:${label}]", message || "Unknown script error");
  }
})();
`

  const safeExecuteJavaScript = (webview: Electron.WebviewTag, script: string): void => {
    if (!canExecuteJavaScript(webview)) return
    try {
      webview.executeJavaScript(wrapSafeVoidScript('void', script)).catch(() => {})
    } catch {
      // executeJavaScript may throw synchronously before dom-ready
    }
  }

  const safeExecuteHostScript = (
    webview: Electron.WebviewTag,
    label: string,
    script: string
  ): void => {
    if (!canExecuteJavaScript(webview)) return
    try {
      webview.executeJavaScript(wrapSafeVoidScript(label, script)).catch(() => {})
    } catch {
      // executeJavaScript may throw synchronously before dom-ready
    }
  }

  const waitForWebviewReady = async (): Promise<Electron.WebviewTag | null> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const webview = webviewRef.current
      if (webview && canExecuteJavaScript(webview)) return webview
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    }
    return null
  }

  useImperativeHandle(
    ref,
    () => ({
      patchPageContent(targetPageId: string, newHtml: string): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `
        var section = document.querySelector('[data-page-id="${targetPageId}"]');
        if (section) {
          section.innerHTML = ${JSON.stringify(newHtml)};
        } else {
          document.body.innerHTML = ${JSON.stringify(newHtml)};
        }
      `
        )
      },
      liveUpdateElement(
        selector: string,
        patch: {
          html?: string
          text?: string
          textTarget?: EditTextTarget
          formula?: {
            latex: string
            html: string
            displayMode: boolean
            originalLatex?: string
          }
          chart?: {
            type: string
            title: string
            labels: string[]
            values: number[]
            series: InsertChartSeries[]
            primaryColor: string
            accentColor: string
            textColor: string
            smooth: boolean
            horizontal: boolean
            stacked: boolean
            areaFill: boolean
            showPoints: boolean
            showLegend: boolean
            doughnutCutout: number
            radarFill: boolean
            configJson: string
          }
          style?: { color?: string; fontSize?: string; fontWeight?: string; textAlign?: string }
          zIndex?: number
        }
      ): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `if (window.__pptEditModeLiveUpdate) window.__pptEditModeLiveUpdate(${JSON.stringify(selector)}, ${JSON.stringify(patch)});`
        )
      },
      applyElementProperties(
        selector: string,
        patch: {
          style?: {
            zIndex?: number
            opacity?: number
            backgroundColor?: string
            color?: string
            fontSize?: string
            fontWeight?: string
            textAlign?: string
            objectFit?: string
          }
          attrs?: {
            alt?: string
            poster?: string
            controls?: boolean
            muted?: boolean
            loop?: boolean
            autoplay?: boolean
            playsInline?: boolean
            preload?: string
          }
        }
      ): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `if (window.__pptEditModeApplyProperties) window.__pptEditModeApplyProperties(${JSON.stringify(selector)}, ${JSON.stringify(patch)});`
        )
      },
      setElementLayout(
        selector: string,
        layout: { x?: number; y?: number; width?: number; height?: number }
      ): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `if (window.__pptEditModeSetLayout) window.__pptEditModeSetLayout(${JSON.stringify(selector)}, ${JSON.stringify(layout)});`
        )
      },
      async setEditSnapSettings(settings: EditSnapSettings): Promise<boolean> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return false
        try {
          return Boolean(
            await wv.executeJavaScript(
              `(function(){` +
                `if (!window.__pptEditModeSetSnapSettings) return false;` +
                `window.__pptEditModeSetSnapSettings(${JSON.stringify(settings)});` +
                `return true;` +
                `})()`
            )
          )
        } catch {
          return false
        }
      },
      async readEditSnapPoints(): Promise<EditSnapPoints> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return { x: [], y: [] }
        try {
          const result = (await wv.executeJavaScript(
            `(function(){` +
              `try {` +
              `return window.__pptEditModeReadSnapPoints ? window.__pptEditModeReadSnapPoints() : { x: [], y: [] };` +
              `} catch (_error) { return { x: [], y: [] }; }` +
              `})()`
          )) as Partial<EditSnapPoints> | null
          return {
            x: Array.isArray(result?.x) ? result.x.filter(Number.isFinite) : [],
            y: Array.isArray(result?.y) ? result.y.filter(Number.isFinite) : []
          }
        } catch {
          return { x: [], y: [] }
        }
      },
      async restoreEditModeSelection(selector: string): Promise<boolean> {
        const wv = webviewRef.current
        if (!wv) return false
        try {
          const result = await wv.executeJavaScript(
            `(function() {
              try {
                if (window.__pptEditModeRestoreSelection) {
                  return window.__pptEditModeRestoreSelection(${JSON.stringify(selector)});
                }
                return false;
              } catch (e) {
                console.debug("[EditMode] restore script error", e);
                return false;
              }
            })()`
          )
          return Boolean(result)
        } catch {
          return false
        }
      },
      async restoreInspectorSelection(selector: string): Promise<boolean> {
        const wv = webviewRef.current
        if (!wv) return false
        try {
          const result = await wv.executeJavaScript(
            `(function() {
              try {
                if (window.__pptInspectorRestoreSelection) {
                  return window.__pptInspectorRestoreSelection(${JSON.stringify(selector)});
                }
                return false;
              } catch (e) {
                console.debug("[Inspector] restore selection error", e);
                return false;
              }
            })()`
          )
          return Boolean(result)
        } catch {
          return false
        }
      },
      clearEditModeSelection(): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `if (window.__pptEditModeClearSelection) window.__pptEditModeClearSelection();`
        )
      },
      hideElement(selector: string): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `(function(){` +
            `var __el = document.querySelector(${JSON.stringify(selector)});` +
            `if (!__el) return;` +
            `__el.setAttribute('data-ppt-pending-delete', '1');` +
            `if (__el.hasAttribute && __el.hasAttribute('data-ppt-art-text')) {` +
            `  var __blockId = __el.getAttribute('data-block-id') || '';` +
            `  var __style = __blockId ? Array.from(document.querySelectorAll('style[data-ppt-art-text-style]')).find(function(s){ return s.getAttribute('data-ppt-art-text-style') === __blockId; }) : null;` +
            `  if (__style) { __style.setAttribute('data-ppt-pending-delete', '1'); __style.disabled = true; }` +
            `}` +
            `if (__el.tagName === 'STYLE') { __el.disabled = true; return; }` +
            `__el.style.setProperty('display', 'none', 'important');` +
            `})()`
        )
      },
      showElement(selector: string): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `(function(){` +
            `var __el = document.querySelector(${JSON.stringify(selector)});` +
            `if (!__el || __el.getAttribute('data-ppt-pending-delete') !== '1') return;` +
            `if (__el.hasAttribute && __el.hasAttribute('data-ppt-art-text')) {` +
            `  var __blockId = __el.getAttribute('data-block-id') || '';` +
            `  var __style = __blockId ? Array.from(document.querySelectorAll('style[data-ppt-art-text-style]')).find(function(s){ return s.getAttribute('data-ppt-art-text-style') === __blockId; }) : null;` +
            `  if (__style) { __style.disabled = false; __style.removeAttribute('data-ppt-pending-delete'); }` +
            `}` +
            `if (__el.tagName === 'STYLE') { __el.disabled = false; __el.removeAttribute('data-ppt-pending-delete'); return; }` +
            `__el.style.removeProperty('display');` +
            `__el.removeAttribute('data-ppt-pending-delete');` +
            `})()`
        )
      },
      applyDragStyle(
        selector: string,
        style: {
          x: number
          y: number
          width?: number
          height?: number
          isAbsoluteMode?: boolean
        }
      ): void {
        const wv = webviewRef.current
        if (!wv) return
        if (style.isAbsoluteMode) {
          safeExecuteJavaScript(
            wv,
            `(function(){` +
              `var __el = document.querySelector(${JSON.stringify(selector)}); if (!__el) return;` +
              `__el.style.position = 'absolute';` +
              `if (!__el.style.zIndex) __el.style.zIndex = '10';` +
              `__el.style.left = ${JSON.stringify(style.x + 'px')};` +
              `__el.style.top = ${JSON.stringify(style.y + 'px')};` +
              `__el.style.translate = '';` +
              `__el.style.removeProperty('--ppt-drag-x');` +
              `__el.style.removeProperty('--ppt-drag-y');` +
              `__el.setAttribute('data-ppt-layout-converted', '1');` +
              (style.width != null
                ? `__el.style.width = ${JSON.stringify(style.width + 'px')};`
                : '') +
              (style.height != null
                ? `__el.style.height = ${JSON.stringify(style.height + 'px')};`
                : '') +
              `})()`
          )
          return
        }
        safeExecuteJavaScript(
          wv,
          `(function(){` +
            `var __el = document.querySelector(${JSON.stringify(selector)}); if (!__el) return;` +
            `var __pos = __el.style.position || getComputedStyle(__el).position;` +
            `if (!__pos || __pos === 'static') __el.style.position = 'relative';` +
            `if (!__el.style.zIndex) __el.style.zIndex = '10';` +
            `__el.style.setProperty('--ppt-drag-x', ${JSON.stringify(style.x + 'px')});` +
            `__el.style.setProperty('--ppt-drag-y', ${JSON.stringify(style.y + 'px')});` +
            `__el.style.translate = 'var(--ppt-drag-x, 0px) var(--ppt-drag-y, 0px)';` +
            (style.width != null ? `__el.style.width = ${JSON.stringify(style.width + 'px')};` : '') +
            (style.height != null ? `__el.style.height = ${JSON.stringify(style.height + 'px')};` : '') +
            `})()`
        )
      },
      applyLayoutIsland(layoutIsland: EditModeLayoutIsland): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `if (window.__pptEditModeApplyLayoutIsland) window.__pptEditModeApplyLayoutIsland(${JSON.stringify(layoutIsland)});`
        )
      },
      applyZIndex(selector: string, zIndex: number): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `(function(){` +
            `var __el = document.querySelector(${JSON.stringify(selector)});` +
            `if (!__el) return;` +
            `var __position = window.getComputedStyle(__el).position;` +
            `if (!__position || __position === "static") __el.style.setProperty("position", "relative", "important");` +
            `__el.style.setProperty("z-index", String(${zIndex}), "important");` +
            `})()`
        )
      },
      async copyElement(
        selector: string,
        newBlockId: string
      ): Promise<{ selector: string; htmlFragment: string } | null> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return null
        const scope = selector.match(/\[data-page-id="([^"]+)"\]/)?.[1] || ''
        const root = scope ? `body[data-page-id="${scope}"] [data-ppt-guard-root="1"]` : 'body'
        const newSelector = scope
          ? `body[data-page-id="${scope}"] [data-block-id="${newBlockId}"]`
          : `[data-block-id="${newBlockId}"]`
        try {
          // Pre-generate child block IDs with nanoid (same pattern as host code)
          const childIds = Array.from({ length: 20 }, () => 'select-arcsin1-' + nanoid(8))
          const copyResult = (await wv.executeJavaScript(
            `(function(){` +
              `var __src = document.querySelector(${JSON.stringify(selector)});` +
              `if (!__src) return null;` +
              `var __root = document.querySelector(${JSON.stringify(root)});` +
              `if (!__root) return null;` +
              `var __clone = __src.cloneNode(true);` +
              `var __childIds = ${JSON.stringify(childIds)};` +
              `var __oldBlockId = __src.getAttribute("data-block-id") || "";` +
              `var __styleClone = null;` +
              `var __styleHtml = "";` +
              `__clone.setAttribute("data-block-id", ${JSON.stringify(newBlockId)});` +
              `__clone.querySelectorAll("[data-block-id]").forEach(function(c,i){if(__childIds[i])c.setAttribute("data-block-id",__childIds[i]);});` +
              `__clone.classList.remove("arcsin1-presentation-editor-selected","arcsin1-presentation-editor-hover");` +
              `__clone.removeAttribute("data-arcsin1-presentation-editor-selected");` +
              `__clone.removeAttribute("data-arcsin1-presentation-editor-hover");` +
              `if (__src.hasAttribute("data-ppt-art-text") && __oldBlockId) {` +
              `  var __style = Array.from(document.querySelectorAll("style[data-ppt-art-text-style]")).find(function(s){ return s.getAttribute("data-ppt-art-text-style") === __oldBlockId; });` +
              `  if (__style) {` +
              `    __styleClone = __style.cloneNode(true);` +
              `    __styleClone.setAttribute("data-ppt-art-text-style", ${JSON.stringify(newBlockId)});` +
              `    __styleClone.textContent = String(__styleClone.textContent || "").split(__oldBlockId).join(${JSON.stringify(newBlockId)});` +
              `    __styleClone.disabled = false;` +
              `    __styleClone.removeAttribute("data-ppt-pending-delete");` +
              `    __styleHtml = __styleClone.outerHTML;` +
              `    __root.appendChild(__styleClone);` +
              `  }` +
              `}` +
              `var __rect = __src.getBoundingClientRect();` +
              `var __pos = __src.style.position || getComputedStyle(__src).position;` +
              `if (__pos === "absolute" || __src.hasAttribute("data-ppt-layout-converted")) {` +
              `  __clone.style.left = (parseFloat(__src.style.left||"0")+40)+"px";` +
              `  __clone.style.top = (parseFloat(__src.style.top||"0")+40)+"px";` +
              `  __clone.style.zIndex = "20";` +
              `} else {` +
              `  __clone.style.position = "absolute";` +
              `  __clone.style.left = (__rect.left+40)+"px";` +
              `  __clone.style.top = (__rect.top+40)+"px";` +
              `  __clone.style.width = __rect.width+"px";` +
              `  __clone.style.height = __rect.height+"px";` +
              `  __clone.style.zIndex = "20";` +
              `}` +
              `__clone.removeAttribute("data-ppt-layout-converted");` +
              `__clone.removeAttribute("data-ppt-last-vp-x");` +
              `__clone.removeAttribute("data-ppt-last-vp-y");` +
              `var __htmlFragment = __styleHtml + __clone.outerHTML;` +
              `__root.appendChild(__clone);` +
              `return { selector: ${JSON.stringify(newSelector)}, htmlFragment: __htmlFragment };` +
              `})()`
          )) as { selector?: string; htmlFragment?: string } | null
          if (!copyResult?.selector || !copyResult.htmlFragment) return null
          return { selector: copyResult.selector, htmlFragment: copyResult.htmlFragment }
        } catch {
          return null
        }
      },
      async ensureChartJs(): Promise<boolean> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return false
        try {
          const has = await wv.executeJavaScript('typeof window.Chart === "function"')
          if (has) return true
          const loaded = await wv.executeJavaScript(
            `new Promise(function(resolve) {
              var s = document.createElement('script');
              s.src = 'https://cdn.bootcdn.net/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
              s.onload = function() { resolve(true); };
              s.onerror = function() { resolve(false); };
              document.head.appendChild(s);
            })`
          )
          return Boolean(loaded)
        } catch {
          return false
        }
      },
      async readElementHtml(selector: string): Promise<string> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return ''
        try {
          return (
            (await wv.executeJavaScript(
              `(function(){` +
                `var __el = document.querySelector(${JSON.stringify(selector)});` +
                `if (!__el) return '';` +
                `if (__el.hasAttribute && __el.hasAttribute('data-ppt-art-text')) {` +
                `  var __blockId = __el.getAttribute('data-block-id') || '';` +
                `  var __style = __blockId ? Array.from(document.querySelectorAll('style[data-ppt-art-text-style]')).find(function(s){ return s.getAttribute('data-ppt-art-text-style') === __blockId; }) : null;` +
                `  return (__style ? __style.outerHTML : '') + __el.outerHTML;` +
                `}` +
                `return __el.outerHTML || '';` +
                `})()`
            )) || ''
          )
        } catch {
          return ''
        }
      },
      async readElementSnapshot(selector: string): Promise<EditableElementSnapshot | null> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return null
        try {
          return (
            (await wv.executeJavaScript(
              `window.__pptEditModeReadSnapshot ? window.__pptEditModeReadSnapshot(${JSON.stringify(selector)}) : null`
            )) || null
          )
        } catch {
          return null
        }
      },
      async inspectElement(selector: string): Promise<PresentationElementSnapshot | null> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return null
        try {
          return (
            (await wv.executeJavaScript(
              `window.__pptEditModeInspectElement ? window.__pptEditModeInspectElement(${JSON.stringify(selector)}) : null`
            )) || null
          )
        } catch {
          return null
        }
      },
      async applyElementOperations(
        selector: string,
        operations: PresentationEditorOperation[]
      ): Promise<PresentationEditorOperationResult[]> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv) || operations.length === 0) return []
        try {
          const result = await wv.executeJavaScript(
            `window.__pptEditModeApplyOperations ? window.__pptEditModeApplyOperations(${JSON.stringify(selector)}, ${JSON.stringify(operations)}) : []`
          )
          return Array.isArray(result) ? (result as PresentationEditorOperationResult[]) : []
        } catch {
          return []
        }
      },
      async readElementLayout(selector: string): Promise<{
        isAbsoluteMode: boolean
        x: number
        y: number
        width: number
        height: number
        visualX?: number
        visualY?: number
        layoutIsland?: EditModeLayoutIsland
      } | null> {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return null
        try {
          const layout = (await wv.executeJavaScript(
            `window.__pptEditModeReadLayout ? window.__pptEditModeReadLayout(${JSON.stringify(selector)}) : null`
          )) as {
            isAbsoluteMode: boolean
            x: number
            y: number
            width: number
            height: number
            visualX?: number
            visualY?: number
            layoutIsland?: unknown
          } | null
          if (!layout) return null
          return {
            ...layout,
            layoutIsland: normalizeEditModeLayoutIsland(layout.layoutIsland)
          }
        } catch {
          return null
        }
      },
      applyChildUpdates(
        selector: string,
        childUpdates: Array<{ path: number[]; width?: number; height?: number }>
      ): void {
        const wv = webviewRef.current
        if (!wv || childUpdates.length === 0) return
        const updatesJs = childUpdates
          .map(
            (u) =>
              `{path:${JSON.stringify(u.path)},width:${u.width != null ? u.width : 'null'},height:${u.height != null ? u.height : 'null'}}`
          )
          .join(',')
        safeExecuteJavaScript(
          wv,
          `(function(){` +
            `var __parent = document.querySelector(${JSON.stringify(selector)}); if (!__parent) return;` +
            `var __ups = [${updatesJs}];` +
            `for (var __i = 0; __i < __ups.length; __i++) {` +
            `  var __u = __ups[__i]; var __c = __parent;` +
            `  for (var __j = 0; __j < __u.path.length; __j++) { __c = __c.children[__u.path[__j]]; if (!__c) break; }` +
            `  if (!__c) continue;` +
            `  if (__u.width !== null) __c.style.width = __u.width + 'px';` +
            `  if (__u.height !== null) __c.style.height = __u.height + 'px';` +
            `}` +
            `if (window.PPT && typeof window.PPT.resizeCharts === "function") { try { window.PPT.resizeCharts(__parent); } catch(__e) {} }` +
            `})()`
        )
      },
      async injectElement(
        parentSelector: string,
        htmlFragment: string,
        insertIndex = -1,
        selectAfterInsert = true
      ): Promise<boolean> {
        const wv = await waitForWebviewReady()
        if (!wv) return false
        try {
          return Boolean(
            await wv.executeJavaScript(
              `(function(){` +
                `var __parentSelector = ${JSON.stringify(parentSelector)};` +
                `var __html = ${JSON.stringify(htmlFragment)};` +
                `var __insertIndex = ${JSON.stringify(insertIndex)};` +
                `var __selectAfterInsert = ${JSON.stringify(selectAfterInsert)};` +
                `var __template = document.createElement("template"); __template.innerHTML = __html;` +
                `var __nodes = Array.from(__template.content.children); if (__nodes.length === 0) return false;` +
                `var __blockId = __nodes.map(function(__node){ return __node instanceof Element ? __node.getAttribute("data-block-id") : ""; }).find(Boolean);` +
                `if (window.__pptEditModeInjectElement) {` +
                `  window.__pptEditModeInjectElement(__parentSelector, __html, __insertIndex, __selectAfterInsert);` +
                `  if (!__blockId || document.querySelector('[data-block-id="' + __blockId.replace(/"/g, '\\\\"') + '"]')) return true;` +
                `}` +
                `var __parent = document.querySelector(__parentSelector) || document.querySelector('[data-ppt-guard-root="1"]') || document.querySelector('.ppt-page-root'); if (!__parent) return false;` +
                `var __existingBlock = null;` +
                `for (var __k = 0; __k < __nodes.length; __k++) {` +
                `  var __blockId = __nodes[__k] instanceof Element ? __nodes[__k].getAttribute("data-block-id") : "";` +
                `  if (__blockId && document.querySelector('[data-block-id="' + __blockId.replace(/"/g, '\\\\"') + '"]')) { __existingBlock = __blockId; break; }` +
                `}` +
                `if (__existingBlock) return true;` +
                `var __anchor = Number.isInteger(__insertIndex) && __insertIndex >= 0 && __insertIndex < __parent.children.length ? __parent.children[__insertIndex] : null;` +
                `__nodes.forEach(function(__node){ if (__anchor) __parent.insertBefore(__node, __anchor); else __parent.appendChild(__node); });` +
                `__nodes.forEach(function(__node){ if (!(__node instanceof Element)) return; var __scripts = []; if (__node.matches('script[data-ppt-generated-chart-script="1"]')) __scripts.push(__node); __node.querySelectorAll('script[data-ppt-generated-chart-script="1"]').forEach(function(__script){ __scripts.push(__script); }); __scripts.forEach(function(__script){ try { new Function(__script.textContent || "")(); } catch(__e) {} }); });` +
                `return true;` +
                `})()`
            )
          )
        } catch {
          return false
        }
      }
    }),
    []
  )

  useEffect(() => {
    const webview = webviewElement
    if (!webview) return

    const reportNavigation = (event: Event): void => {
      const url = (event as { url?: unknown }).url
      if (typeof url === 'string' && url) onActiveUrlChange?.(url)
    }

    webviewReadyRef.current = false
    setWebviewReady(false)

    const markReady = (): void => {
      if (webviewRef.current === webview) {
        webviewReadyRef.current = true
        setWebviewReady(true)
      }
    }
    const handleStartLoading = (): void => {
      if (webviewRef.current === webview) {
        webviewReadyRef.current = false
        setWebviewReady(false)
      }
    }

    webview.addEventListener('dom-ready', markReady as EventListener)
    webview.addEventListener('did-start-loading', handleStartLoading as EventListener)
    webview.addEventListener('did-navigate', reportNavigation as EventListener)
    webview.addEventListener('did-navigate-in-page', reportNavigation as EventListener)

    return () => {
      webview.removeEventListener('dom-ready', markReady as EventListener)
      webview.removeEventListener('did-start-loading', handleStartLoading as EventListener)
      webview.removeEventListener('did-navigate', reportNavigation as EventListener)
      webview.removeEventListener('did-navigate-in-page', reportNavigation as EventListener)
      if (webviewRef.current === webview) {
        webviewReadyRef.current = false
        setWebviewReady(false)
      }
    }
  }, [onActiveUrlChange, webviewElement])

  // Selection overlay effect: handles AI inspect and animation-select.
  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable || !webviewReady) return

    const runInspectorLifecycle = (): void => {
      if (inspecting) {
        safeExecuteHostScript(
          webview,
          'inspector-inject',
          buildInspectorInjectScript({
            mode: currentInteractionMode === 'animation-select' ? 'animation-select' : 'inspect'
          })
        )
        inspectorInjectedRef.current = true
      } else {
        if (!inspectorInjectedRef.current) return
        safeExecuteHostScript(webview, 'inspector-cleanup', buildInspectorCleanupScript())
        inspectorInjectedRef.current = false
      }
    }

    runInspectorLifecycle()

    return () => {
      if (!inspectorInjectedRef.current) return
      safeExecuteHostScript(webview, 'inspector-cleanup', buildInspectorCleanupScript())
      inspectorInjectedRef.current = false
    }
  }, [inspectable, inspecting, currentInteractionMode, webviewReady, webviewSrc, webviewElement])

  // Unified edit mode effect: handles click-to-select, drag, and resize.
  // Use ref for onDidReload to avoid re-running effect on every parent re-render.
  const onDidReloadRef = useRef(onDidReload)
  onDidReloadRef.current = onDidReload

  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable || !webviewReady) return

    const runEditModeLifecycle = (): void => {
      if (editMode) {
        safeExecuteHostScript(
          webview,
          'edit-inject',
          buildEditModeInjectScript(previewScaleRef.current)
        )
        editModeInjectedRef.current = true
      } else {
        if (!editModeInjectedRef.current) return
        safeExecuteHostScript(webview, 'edit-cleanup', buildEditModeCleanupScript())
        editModeInjectedRef.current = false
      }
    }

    runEditModeLifecycle()
    if (editMode) onDidReloadRef.current?.()

    return () => {
      if (!editModeInjectedRef.current) return
      safeExecuteHostScript(webview, 'edit-cleanup', buildEditModeCleanupScript())
      editModeInjectedRef.current = false
    }
  }, [inspectable, editMode, webviewReady, webviewSrc, webviewElement])

  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable || !editMode || !webviewReady) return
    safeExecuteHostScript(
      webview,
      'edit-set-preview-scale',
      buildEditModeSetPreviewScaleScript(previewScale)
    )
  }, [editMode, inspectable, previewScale, webviewReady, webviewElement])

  // Console message router: inspector + unified edit mode
  // Use refs for callback props to avoid re-registering listener on every parent re-render
  const onSelectorSelectedRef = useRef(onSelectorSelected)
  onSelectorSelectedRef.current = onSelectorSelected
  const onElementMovedRef = useRef(onElementMoved)
  onElementMovedRef.current = onElementMoved
  // Serialize 'moved' events per webview: each event awaits ensureAnchoredAnchor
  // before dispatching handleMoved. Without serialization, a slow anchor (first
  // edit on an unanchored element, or any IPC scheduling jitter) can let a later
  // 'moved' resolve before an earlier one, so a stale drag's x/y (or null
  // width/height) overwrites a fresh resize. The promise chain guarantees
  // emission order === dispatch order.
  const movedChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const onElementSelectedRef = useRef(onElementSelected)
  onElementSelectedRef.current = onElementSelected
  const onInspectExitRef = useRef(onInspectExit)
  onInspectExitRef.current = onInspectExit
  const onDeleteRequestRef = useRef(onDeleteRequest)
  onDeleteRequestRef.current = onDeleteRequest
  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable) return

    const handleConsoleMessage = (event: Event): void => {
      const payloadText = (event as { message?: unknown }).message
      if (typeof payloadText !== 'string') {
        return
      }
      if (payloadText.startsWith('[HtmlEditorCanvas:')) {
        console.error(payloadText)
        return
      }
      const isInspectorMessage = payloadText.startsWith(INSPECTOR_CONSOLE_PREFIX)
      const isEditModeMessage = payloadText.startsWith(EDIT_MODE_CONSOLE_PREFIX)
      if (!isInspectorMessage && !isEditModeMessage) return

      const prefixLength = isInspectorMessage
        ? INSPECTOR_CONSOLE_PREFIX.length
        : EDIT_MODE_CONSOLE_PREFIX.length
      const raw = payloadText.slice(prefixLength).trim()
      if (!raw) return
      try {
        const parsed = JSON.parse(raw) as {
          type?: string
          mode?: 'inspect' | 'text-edit' | 'animation-select'
          selector?: string
          blockId?: string
          label?: string
          elementTag?: string
          elementText?: string
          formula?: EditableElementSnapshot['formula']
          kind?: EditSelectionPayload['kind']
          capabilities?: EditSelectionPayload['capabilities']
          snapshot?: EditSelectionPayload['snapshot']
          isText?: boolean
          layoutMode?: EditModeMovePayload['layoutMode']
          x?: number
          y?: number
          deltaX?: number
          deltaY?: number
          visualX?: number
          visualY?: number
          width?: number
          height?: number
          layoutIsland?: unknown
          childUpdates?: Array<{
            path: number[]
            width?: number
            height?: number
          }>
          text?: string
          html?: string
          textTarget?: EditTextTarget
          style?: EditSelectionPayload['style']
          bounds?: EditSelectionPayload['bounds']
          translateX?: number
          translateY?: number
          zIndex?: number
          editability?: EditSelectionPayload['editability']
        }

        // Inspector / animation-select: element selected
        if (isInspectorMessage && parsed.type === 'selected' && parsed.selector) {
          if (parsed.mode === 'animation-select' && parsed.formula) {
            void (async () => {
              const anchor = await ensureAnchoredAnchor({
                selector: parsed.selector || '',
                elementTag: parsed.elementTag,
                elementText: parsed.elementText,
                reason: 'inspect',
                formula: parsed.formula
              })
              if (webviewRef.current !== webview) return
              onSelectorSelectedRef.current?.(
                anchor.selector,
                anchor.selector,
                parsed.elementTag,
                parsed.elementText
              )
            })().catch(() => {})
            return
          }
          if (webviewRef.current !== webview) return
          onSelectorSelectedRef.current?.(
            parsed.selector,
            parsed.label || parsed.selector,
            parsed.elementTag,
            parsed.elementText
          )
          return
        }

        // Edit mode: element selected (click)
        if (isEditModeMessage && parsed.type === 'selected' && parsed.selector) {
          void (async () => {
            const anchor = await ensureAnchoredAnchor({
              selector: parsed.selector || '',
              elementTag: parsed.elementTag,
              elementText: parsed.elementText,
              reason: 'drag',
              formula: parsed.snapshot?.formula
            })
            if (webviewRef.current !== webview) return
            const textTarget =
              parsed.textTarget && parsed.textTarget.parentSelector === parsed.selector
                ? { ...parsed.textTarget, parentSelector: anchor.selector }
                : parsed.textTarget
            onElementSelectedRef.current?.({
              selector: anchor.selector,
              blockId: anchor.blockId || parsed.blockId,
              label: anchor.selector,
              elementTag: parsed.elementTag || '',
              elementText: parsed.elementText || '',
              kind: parsed.kind,
              capabilities: parsed.capabilities,
              snapshot: parsed.snapshot
                ? {
                    ...parsed.snapshot,
                    selector: anchor.selector,
                    blockId: anchor.blockId || parsed.snapshot.blockId || parsed.blockId
                  }
                : parsed.snapshot,
              isText: Boolean(parsed.isText),
              text: typeof parsed.text === 'string' ? parsed.text : '',
              html: typeof parsed.html === 'string' ? parsed.html : '',
              textTarget,
              style: parsed.style || {},
              bounds: parsed.bounds,
              translateX: Number(parsed.translateX || 0),
              translateY: Number(parsed.translateY || 0),
              zIndex: typeof parsed.zIndex === 'number' ? parsed.zIndex : undefined,
              editability: parsed.editability || undefined
            })
          })().catch(() => {})
          return
        }

        // Edit mode: pre-anchor request
        if (isEditModeMessage && parsed.type === 'pre-anchor' && parsed.selector) {
          void (async () => {
            let anchorResult: { selector: string; blockId?: string }
            try {
              anchorResult = await ensureAnchoredAnchor({
                selector: parsed.selector || '',
                elementTag: parsed.elementTag,
                reason: 'drag',
                formula: parsed.snapshot?.formula
              })
            } catch {
              return
            }
            if (webviewRef.current !== webview) return
            const wv = webviewRef.current
            if (wv) {
              safeExecuteJavaScript(
                wv,
                `if (window.__pptResolveEditModeAnchor) window.__pptResolveEditModeAnchor(${JSON.stringify(anchorResult)});`
              )
            }
          })().catch(() => {})
          return
        }

        // Edit mode: element moved/resized.
        // Serialized via movedChainRef: each event must finish ensureAnchoredAnchor
        // → handleMoved before the next one starts, so emission order === dispatch
        // order. Without this, a stale 'moved' (e.g. a drag whose anchor IPC was
        // slow) can resolve after a fresh resize and clobber the resize's x/y or
        // null-out its width/height in upsertDragEdit.
        if (isEditModeMessage && parsed.type === 'moved' && parsed.selector) {
          movedChainRef.current = movedChainRef.current
            .catch(() => {})
            .then(() =>
              (async () => {
                const anchor = await ensureAnchoredAnchor({
                  selector: parsed.selector || '',
                  elementTag: parsed.elementTag,
                  reason: 'drag',
                  formula: parsed.snapshot?.formula
                })
                if (webviewRef.current !== webview) return
                onElementMovedRef.current?.({
                  selector: anchor.selector,
                  blockId: anchor.blockId || parsed.blockId,
                  label: anchor.selector,
                  elementTag: parsed.elementTag || '',
                  layoutMode: parsed.layoutMode,
                  x: Number(parsed.x || 0),
                  y: Number(parsed.y || 0),
                  deltaX: Number(parsed.deltaX || 0),
                  deltaY: Number(parsed.deltaY || 0),
                  visualX: parsed.visualX === undefined ? undefined : Number(parsed.visualX),
                  visualY: parsed.visualY === undefined ? undefined : Number(parsed.visualY),
                  width: parsed.width === undefined ? undefined : Number(parsed.width),
                  height: parsed.height === undefined ? undefined : Number(parsed.height),
                  layoutIsland: normalizeEditModeLayoutIsland(parsed.layoutIsland),
                  childUpdates: Array.isArray(parsed.childUpdates)
                    ? parsed.childUpdates
                        .map((item) => ({
                          path: Array.isArray(item.path)
                            ? item.path
                                .map((value) => Number(value))
                                .filter((value) => Number.isInteger(value) && value >= 0)
                            : [],
                          width: item.width === undefined ? undefined : Number(item.width),
                          height: item.height === undefined ? undefined : Number(item.height)
                        }))
                        .filter(
                          (item) =>
                            item.path.length > 0 &&
                            (item.width !== undefined || item.height !== undefined)
                        )
                    : undefined
                })
              })()
            )
            .catch(() => {})
          return
        }

        // Exit from either mode
        if (parsed.type === 'exit') {
          onInspectExitRef.current?.()
        }

        // Edit mode: keyboard delete request
        if (isEditModeMessage && parsed.type === 'delete-request' && parsed.selector) {
          onDeleteRequestRef.current?.(parsed.selector)
        }
      } catch {
        // ignore parse error
      }
    }

    webview.addEventListener('console-message', handleConsoleMessage as EventListener)
    return () => {
      webview.removeEventListener('console-message', handleConsoleMessage as EventListener)
    }
  }, [inspectable, pageHtmlPath, pageId, webviewElement])

  // document/滚动模式：按设计宽度缩放铺满容器宽度，高度随内容自适应、容器纵向滚动
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateScale = (): void => {
      const { width } = el.getBoundingClientRect()
      const nextScaleRaw = width / designWidth
      const nextScale = Number.isFinite(nextScaleRaw) && nextScaleRaw > 0 ? nextScaleRaw : 1
      setPreviewScale(nextScale)
      setTransform(`scale(${nextScale})`)
    }

    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(el)
    return () => observer.disconnect()
  }, [designWidth])

  // webview 不能 auto-height，需主动读内容 scrollHeight 以撑出纵向滚动区
  useEffect(() => {
    const measure = async (): Promise<void> => {
      const webview = webviewRef.current
      if (!webview || !canExecuteJavaScript(webview)) return
      try {
        const h = await webview.executeJavaScript(
          'Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0)'
        )
        if (typeof h === 'number' && h > 0) {
          setContentHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev))
        }
      } catch {
        /* webview 尚未就绪，下一轮再试 */
      }
    }
    measure()
    const id = window.setInterval(measure, 800)
    return () => window.clearInterval(id)
  }, [])

  if (snapBridgeRef.current === null) {
    snapBridgeRef.current = {
      setEditSnapSettings: async (settings: EditSnapSettings): Promise<boolean> => {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return false
        try {
          return Boolean(
            await wv.executeJavaScript(
              `(function(){if(!window.__pptEditModeSetSnapSettings)return false;window.__pptEditModeSetSnapSettings(${JSON.stringify(settings)});return true;})()`
            )
          )
        } catch {
          return false
        }
      },
      readEditSnapPoints: async (): Promise<EditSnapPoints> => {
        const wv = webviewRef.current
        if (!wv || !canExecuteJavaScript(wv)) return { x: [], y: [] }
        try {
          const result = (await wv.executeJavaScript(
            `(function(){try{return window.__pptEditModeReadSnapPoints?window.__pptEditModeReadSnapPoints():{x:[],y:[]};}catch(_e){return{x:[],y:[]};}})()`
          )) as Partial<EditSnapPoints> | null
          return {
            x: Array.isArray(result?.x) ? result.x.filter(Number.isFinite) : [],
            y: Array.isArray(result?.y) ? result.y.filter(Number.isFinite) : []
          }
        } catch {
          return { x: [], y: [] }
        }
      }
    }
  }

  return (
    <div ref={rootRef} className="relative h-full w-full rounded-[inherit] bg-[#f5f1e8]">
      <div
        ref={containerRef}
        className={`absolute overflow-x-hidden overflow-y-auto transition-opacity duration-150 ${
          webviewReady ? 'opacity-100' : 'opacity-0'
        }`}
        style={
          editMode ? { top: EDITOR_INSET, left: EDITOR_INSET, right: 0, bottom: 0 } : { inset: 0 }
        }
      >
        {webviewSrc ? (
          <div
            ref={wrapperRef}
            style={{ position: 'relative', width: '100%', height: contentHeight * previewScale }}
          >
            <webview
              ref={handleWebviewRef}
              src={webviewSrc}
              tabIndex={thumbnail ? -1 : 0}
              title={title}
              className={`absolute left-0 top-0 origin-top-left ${
                pointerEnabled ? 'pointer-events-auto' : 'pointer-events-none'
              } ${editMode ? 'cursor-move' : inspecting ? 'cursor-crosshair' : ''}`}
              style={{ width: designWidth, height: contentHeight, transform }}
            />
          </div>
        ) : null}
      </div>
      {webviewSrc && !webviewReady ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-[#f5f1e8] text-[#7c786b]"
          aria-busy="true"
          aria-live="polite"
        >
          <Loader2 className="h-5 w-5 animate-spin text-[#657050]" aria-hidden="true" />
          <span className="text-sm">{t('common.loading')}</span>
          <div className="w-[min(62%,560px)] space-y-3 opacity-70" aria-hidden="true">
            <div className="h-3 w-2/5 animate-pulse bg-[#e4ddcf]" />
            <div className="h-2.5 w-full animate-pulse bg-[#e9e2d5]" />
            <div className="h-2.5 w-4/5 animate-pulse bg-[#e9e2d5]" />
            <div className="h-24 animate-pulse bg-[#ebe4d7]" />
          </div>
        </div>
      ) : null}
      {editMode && webviewSrc ? (
        <HtmlEditorGuidesOverlay
          rootRef={rootRef}
          scrollRef={containerRef}
          hostRef={wrapperRef}
          previewIframeRef={snapBridgeRef}
          designWidth={designWidth}
          contentHeight={contentHeight}
          scale={previewScale}
          selectedPageId={pageId ?? ''}
          reloadSignal={reloadSignal}
        />
      ) : null}
    </div>
  )
})
