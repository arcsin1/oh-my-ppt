import { buildElementPickerCoreScript } from './element-picker-core'

export const EDIT_MODE_CONSOLE_PREFIX = '__PPT_EDIT_MODE__:'

export type ElementKind =
  | 'text'
  | 'media'
  | 'shape'
  | 'chart'
  | 'table'
  | 'formula'
  | 'container'
  | 'unknown'

export type EditableCapability = 'layout' | 'layer' | 'appearance' | 'text' | 'media' | 'border'

export interface EditableElementSnapshot {
  selector: string
  blockId?: string
  label: string
  elementTag: string
  elementText: string
  kind: ElementKind
  capabilities: EditableCapability[]
  metrics: {
    viewport: { x: number; y: number; width: number; height: number }
    page: { x: number; y: number; width: number; height: number }
    translateX: number
    translateY: number
  }
  computed: {
    display?: string
    position?: string
    zIndex?: string
    opacity?: string
    backgroundColor?: string
    color?: string
    fontSize?: string
    fontWeight?: string
    lineHeight?: string
    textAlign?: string
    borderColor?: string
    borderWidth?: string
    borderStyle?: string
    borderRadius?: string
    objectFit?: string
  }
  inline: Record<string, string>
  attrs: {
    src?: string
    alt?: string
    artTextTemplate?: string
    poster?: string
    controls?: boolean
    muted?: boolean
    loop?: boolean
    autoplay?: boolean
    playsInline?: boolean
    preload?: string
  }
  text?: {
    editable: boolean
    value: string
    html: string
    reason?: string
  }
}

export interface EditTextTarget {
  type: 'text-node'
  parentSelector: string
  textNodeIndex: number
  text: string
}

export interface EditSelectionPayload {
  selector: string
  blockId?: string
  label: string
  elementTag: string
  elementText: string
  kind?: ElementKind
  capabilities?: EditableCapability[]
  snapshot?: EditableElementSnapshot | null
  isText: boolean
  text: string
  html?: string
  textTarget?: EditTextTarget
  style: {
    color?: string
    fontSize?: string
    fontWeight?: string
    lineHeight?: string
    textAlign?: string
    backgroundColor?: string
  }
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  viewportBounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  pageBounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  translateX: number
  translateY: number
  zIndex?: number
  editability?: {
    x: boolean
    y: boolean
    width: boolean
    height: boolean
  }
}

export interface EditModeMovePayload {
  selector: string
  blockId?: string
  label: string
  elementTag: string
  layoutMode?: 'translate' | 'absolute'
  x: number
  y: number
  deltaX: number
  deltaY: number
  visualX?: number
  visualY?: number
  width?: number
  height?: number
  scale?: number
  childUpdates?: Array<{
    path: number[]
    width?: number
    height?: number
  }>
}

export function buildEditModeInjectScript(previewScale = 1): string {
  return `
(() => {
  const STATE_KEY = "__pptEditModeState";
  const STYLE_ID = "ppt-edit-mode-style";
  const OVERLAY_ID = "ppt-edit-mode-resize-overlay";
  const HOVER_OVERLAY_ID = "ppt-edit-mode-hover-overlay";
  const HOVER_CLASS = "ppt-edit-mode-hover";
  const SELECTED_CLASS = "ppt-edit-mode-selected";
  const HANDLE_CLASS = "ppt-edit-mode-resize-handle";
  const INITIAL_PREVIEW_SCALE = ${JSON.stringify(
    Number.isFinite(previewScale) && previewScale > 0 ? Number(previewScale.toFixed(4)) : 1
  )};
  const LOG_PREFIX = "${EDIT_MODE_CONSOLE_PREFIX}";
  const SCAFFOLD_BLOCK_IDS = new Set(["content"]);
  // Remove transform from fit-scope to prevent stacking context isolation;
  // transform (even scale(1)) creates a stacking context that breaks z-index
  // comparison between elements inside and outside the scope.
  const __fitScope = document.querySelector(".ppt-page-fit-scope");
  if (__fitScope) __fitScope.style.transform = "none";
  const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "span", "strong", "em", "b", "i", "small", "label", "button", "td", "th", "blockquote", "figcaption"]);
  const EDITABLE_TEXT_CHILD_TAGS = new Set([...TEXT_TAGS, "a", "code", "sub", "sup", "u", "s", "br"]);
  const BLOCKED_TEXT_TAGS = new Set(["script", "style", "svg", "canvas", "img", "video", "audio", "input", "textarea", "select", "option"]);

  const normalizeText = (value) => String(value || "").replace(/\\\\s+/g, " ").trim();
  const normalizeScale = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  };

  const hasOnlyEditableTextChildren = (element) => {
    return Array.from(element.children || []).every((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : "";
      if (!EDITABLE_TEXT_CHILD_TAGS.has(tag)) return false;
      return hasOnlyEditableTextChildren(child);
    });
  };

  const isEditableTextElement = (element) => {
    if (!(element instanceof Element)) return false;
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    if (!tag || BLOCKED_TEXT_TAGS.has(tag)) return false;
    if (element.closest("svg, canvas, script, style")) return false;
    if (!hasOnlyEditableTextChildren(element)) return false;
    if (!TEXT_TAGS.has(tag) && !element.getAttribute("data-role") && !element.getAttribute("data-block-id")) return false;
    const text = normalizeText(element.textContent);
    if (!text || text.length > 500) return false;
    return true;
  };

  const existing = window[STATE_KEY];
  if (existing && existing.active) {
    try {
      existing.setPreviewScale?.(INITIAL_PREVIEW_SCALE);
      window.__pptEditModeSetPreviewScale?.(INITIAL_PREVIEW_SCALE);
    } catch (_error) {}
    return;
  }

  let previewScaleValue = normalizeScale(INITIAL_PREVIEW_SCALE);

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\\\" + ch);
  };

  const attrEscape = (value) => String(value).replace(/"/g, '\\\\"');

  const isUniqueSelector = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (_error) {
      return false;
    }
  };

  const getPageScopeSelector = () => {
    const pageId = document.body ? document.body.getAttribute("data-page-id") : "";
    if (pageId) return 'body[data-page-id="' + attrEscape(pageId) + '"]';
    return "body";
  };

  const getClassList = (el) =>
    Array.from(el.classList || [])
      .filter((item) => item && !item.startsWith("ppt-edit-mode-") && !item.includes(":"))
      .slice(0, 3);

  const buildSegment = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute("id");
    if (id) return "#" + cssEscape(id);
    const role = el.getAttribute("data-role");
    if (role) return tag + '[data-role="' + attrEscape(role) + '"]';
    const blockId = el.getAttribute("data-block-id");
    if (blockId) return tag + '[data-block-id="' + attrEscape(blockId) + '"]';
    const classes = getClassList(el);
    if (classes.length > 0) {
      return tag + "." + classes.map((item) => cssEscape(item)).join(".");
    }
    return tag;
  };

  const buildScopedSelector = (scope, el) => {
    const levels = [];
    let cursor = el;
    while (
      cursor &&
      cursor instanceof Element &&
      cursor !== document.body &&
      cursor !== document.documentElement &&
      levels.length < 3
    ) {
      levels.unshift(buildSegment(cursor));
      cursor = cursor.parentElement;
    }

    const candidates = [];
    if (levels.length >= 1) {
      candidates.push(scope + " " + levels[levels.length - 1]);
    }
    if (levels.length >= 2) {
      candidates.push(scope + " " + levels[levels.length - 2] + " > " + levels[levels.length - 1]);
    }
    if (levels.length >= 3) {
      candidates.push(scope + " " + levels[levels.length - 3] + " > " + levels[levels.length - 2] + " > " + levels[levels.length - 1]);
    }

    for (const candidate of candidates) {
      if (isUniqueSelector(candidate)) return candidate;
    }

    return candidates[candidates.length - 1] || (scope + " " + buildSegment(el));
  };

  const buildStableSelector = (el) => {
    if (!(el instanceof Element)) return null;
    const scope = getPageScopeSelector();
    const blockId = el.getAttribute("data-block-id");
    if (blockId) {
      const selector = scope + ' [data-block-id="' + attrEscape(blockId) + '"]';
      if (isUniqueSelector(selector)) return selector;
    }

    const role = el.getAttribute("data-role");
    if (role) {
      const owner = el.closest("[data-block-id]");
      const ownerBlockId = owner ? owner.getAttribute("data-block-id") : "";
      if (ownerBlockId) {
        const roleSelector =
          scope +
          ' [data-block-id="' +
          attrEscape(ownerBlockId) +
          '"] [data-role="' +
          attrEscape(role) +
          '"]';
        if (isUniqueSelector(roleSelector)) return roleSelector;
      }
    }

    const idValue = el.getAttribute("id");
    if (idValue) {
      const selector = scope + " #" + cssEscape(idValue);
      if (isUniqueSelector(selector)) return selector;
      return selector;
    }

    const root = el.closest("[data-ppt-guard-root='1'], .ppt-page-root");
    if (root) {
      const rootSelector = root.getAttribute("data-ppt-guard-root") === "1"
        ? '[data-ppt-guard-root="1"]'
        : ".ppt-page-root";
      const segments = [];
      let current = el;
      while (current && current !== root) {
        const parent = current.parentElement;
        if (!parent) break;
        const index = Array.prototype.indexOf.call(parent.children, current);
        if (index < 0) break;
        const tag = current.tagName ? current.tagName.toLowerCase() : "*";
        segments.unshift(tag + ":nth-child(" + (index + 1) + ")");
        current = parent;
      }
      if (current === root && segments.length > 0) {
        const selector = scope + " " + rootSelector + " " + segments.join(" > ");
        if (isUniqueSelector(selector)) return selector;
      }
    }

    return buildScopedSelector(scope, el);
  };

  const isInsidePageRoot = (element) => {
    return element && (element.closest(".ppt-page-root") !== null || element.closest("[data-ppt-guard-root='1']") !== null);
  };

  const getPageRoot = (element) => {
    return element && element.closest(".ppt-page-root, [data-ppt-guard-root='1']");
  };

  const isScaffoldBlock = (element) => {
    if (!(element instanceof Element)) return false;
    const blockId = element.getAttribute("data-block-id");
    const role = element.getAttribute("data-role");
    return (
      SCAFFOLD_BLOCK_IDS.has(String(blockId || "")) ||
      role === "content" ||
      element.classList.contains("ppt-page-root") ||
      element.classList.contains("ppt-page-fit-scope") ||
      element.classList.contains("ppt-page-content") ||
      element.getAttribute("data-ppt-guard-root") === "1" ||
      element.tagName === "BODY" ||
      element.tagName === "HTML"
    );
  };

  const getContentRoot = (element) => {
    return element && element.closest('[data-block-id="content"], [data-role="content"]');
  };

  const isRenderedFormulaNode = (element) => {
    if (!(element instanceof Element)) return false;
    return Boolean(element.closest(".katex, .katex-display, math, annotation, semantics"));
  };

  const isBlockLikeElement = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    if (["div", "p", "section", "article", "figure", "figcaption", "li", "td", "th", "span"].includes(tag)) {
      return true;
    }
    const display = window.getComputedStyle(element).display;
    return display.includes("block") || display.includes("flex") || display.includes("grid") || display.includes("table");
  };

  const findAtomicHost = (origin, atomicSelector) => {
    if (!(origin instanceof Element)) return null;
    const atomic = origin.closest(atomicSelector);
    if (!atomic || !isInsidePageRoot(atomic)) return null;
    const contentRoot = getContentRoot(atomic) || getPageRoot(atomic);
    if (!contentRoot) return null;

    const stableOwner = atomic.closest("[data-block-id]");
    if (stableOwner && stableOwner !== contentRoot && !isScaffoldBlock(stableOwner)) {
      return stableOwner;
    }

    let candidate = atomic.parentElement;
    while (candidate && candidate !== contentRoot) {
      if (!isScaffoldBlock(candidate) && isBlockLikeElement(candidate) && buildStableSelector(candidate)) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    return null;
  };

  const getElementRenderScale = (element) => {
    if (!(element instanceof HTMLElement)) {
      return { x: 1, y: 1 };
    }

    const scope = element.closest(".ppt-page-fit-scope");
    if (scope instanceof HTMLElement) {
      const scopeRect = scope.getBoundingClientRect();
      const scopeWidth = scope.offsetWidth || scope.clientWidth;
      const scopeHeight = scope.offsetHeight || scope.clientHeight;
      return {
        x: Math.max(0.01, scopeWidth > 0 ? scopeRect.width / scopeWidth : 1),
        y: Math.max(0.01, scopeHeight > 0 ? scopeRect.height / scopeHeight : 1),
      };
    }

    const rect = element.getBoundingClientRect();
    const width = element.offsetWidth || element.clientWidth;
    const height = element.offsetHeight || element.clientHeight;
    return {
      x: Math.max(0.01, width > 0 ? rect.width / width : 1),
      y: Math.max(0.01, height > 0 ? rect.height / height : 1),
    };
  };

  const getPointerScale = (element) => {
    const renderScale = getElementRenderScale(element);
    // NOTE: Do NOT multiply by the external webview previewScale here.
    // The browser already maps pointer coordinates to the iframe's own
    // coordinate system when the webview element has a CSS transform,
    // so including previewScale would double-compensate and make the
    // element move 1/previewScale times too far.
    return {
      x: Math.max(0.01, renderScale.x),
      y: Math.max(0.01, renderScale.y),
    };
  };

  const getPointerDelta = (element, currentClientX, currentClientY, startClientX, startClientY) => {
    const scale = getPointerScale(element);
    return {
      x: (currentClientX - startClientX) / scale.x,
      y: (currentClientY - startClientY) / scale.y,
    };
  };

  const isUsableElementTarget = (element) => {
    if (!(element instanceof Element)) return false;
    if (isScaffoldBlock(element)) return false;
    if (!isInsidePageRoot(element)) return false;
    if (["SCRIPT", "STYLE", "LINK", "META", "TITLE"].includes(element.tagName)) return false;
    if (isRenderedFormulaNode(element)) return false;
    // Atomic visual elements — rendered as a single unit, internals should
    // not be individually selected; clicks bubble up to the parent container.
    if (element.closest("svg")) return false;
    // Elements with data-block-id added via edit mode (IMG/VIDEO) are always selectable
    if (element.hasAttribute("data-block-id") && ["IMG", "VIDEO"].includes(element.tagName)) {
      const rect = element.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2;
    }
    if (["CANVAS", "VIDEO", "AUDIO", "IFRAME"].includes(element.tagName)) return false;
    const contentRoot = getContentRoot(element);
    const boundaryRoot = contentRoot || getPageRoot(element);
    if (!boundaryRoot || element === boundaryRoot) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  };

  ${buildElementPickerCoreScript()}

  const elementPicker = createPptElementPicker({
    getPageRoot,
    getContentRoot,
    isSelectable: isUsableElementTarget,
    getSelector: buildStableSelector
  });

  const getPointTarget = (origin, clientX, clientY) => {
    return elementPicker.pickAtPoint(origin, clientX, clientY);
  };

  const pickCanvasTarget = (origin) => {
    if (!(origin instanceof Element)) return null;
    const canvas = origin.closest("canvas");
    if (!canvas || !isInsidePageRoot(canvas)) return null;
    const frame = canvas.closest(".ppt-chart-frame, [data-block-id*='chart'], [data-block-id*='graph'], [data-block-id*='plot']");
    if (frame && !isScaffoldBlock(frame) && buildStableSelector(frame)) return frame;
    const owner = canvas.closest("[data-block-id]");
    if (owner && !isScaffoldBlock(owner) && buildStableSelector(owner)) return owner;
    return findAtomicHost(canvas, "canvas");
  };

  const pickFormulaTarget = (origin) => {
    if (!(origin instanceof Element)) return null;
    return findAtomicHost(origin, ".katex, .katex-display, math, annotation, semantics");
  };

  const pickArtTextTarget = (origin) => {
    if (!(origin instanceof Element)) return null;
    const host = origin.closest("[data-ppt-art-text][data-block-id]");
    if (host && isInsidePageRoot(host) && !isScaffoldBlock(host) && buildStableSelector(host)) {
      return host;
    }
    return null;
  };

  const pickLooseContentTarget = (origin) => {
    const contentRoot = getContentRoot(origin) || getPageRoot(origin);
    if (!contentRoot) return null;
    let candidate = origin;
    while (candidate && candidate !== contentRoot) {
      if (isUsableElementTarget(candidate) && buildStableSelector(candidate)) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  };

  const promoteToWrapper = (element) => {
    // Elements with their own data-block-id have a stable identity — don't promote.
    if (element.getAttribute("data-block-id")) return element;
    const contentRoot = getContentRoot(element);
    if (!contentRoot) return element;
    let candidate = element.parentElement;
    while (candidate && candidate !== contentRoot) {
      if (isScaffoldBlock(candidate)) break;
      const hasBlockChildren = candidate.querySelectorAll("[data-block-id]").length >= 2;
      const noBlockId = !candidate.getAttribute("data-block-id");
      if (noBlockId && hasBlockChildren && buildStableSelector(candidate)) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return element;
  };

  const pickTarget = (origin, clientX, clientY) => {
    if (!(origin instanceof Element)) return null;
    const artTextTarget = pickArtTextTarget(origin);
    if (artTextTarget) return artTextTarget;
    const chartTarget = pickCanvasTarget(origin);
    if (chartTarget) return chartTarget;
    const formulaTarget = pickFormulaTarget(origin);
    if (formulaTarget) return formulaTarget;
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const pointTarget = getPointTarget(origin, clientX, clientY);
      const artTextPointTarget = pickArtTextTarget(pointTarget);
      if (artTextPointTarget) return artTextPointTarget;
      const atomicPointTarget = pickCanvasTarget(pointTarget) || pickFormulaTarget(pointTarget);
      if (atomicPointTarget) return atomicPointTarget;
      if (pointTarget) return promoteToWrapper(pointTarget);
    }
    const looseTarget = pickLooseContentTarget(origin);
    if (looseTarget) return promoteToWrapper(looseTarget);
    const blocks = Array.from(origin.closest(".ppt-page-root, [data-ppt-guard-root='1']")?.querySelectorAll("[data-block-id]") || []);
    const target = origin.closest("[data-block-id]");
    if (target && blocks.includes(target) && isInsidePageRoot(target) && !isScaffoldBlock(target)) {
      return target;
    }
    return null;
  };

  const parsePx = (value) => {
    const match = String(value || "").trim().match(/^(-?\\d+(?:\\.\\d+)?)px$/);
    return match ? Number(match[1]) : 0;
  };

  const ensureDragTranslate = (target) => {
    const computed = getComputedStyle(target);
    if (computed.display === "inline") {
      target.style.display = "inline-block";
    }
    // Read custom property values and set translate directly as numeric px.
    // Using var() references can be a no-op when the same template string is
    // already in the inline style (persisted from a previous drag), preventing
    // CSS variable changes from taking effect before getBoundingClientRect().
    const x = parsePx(target.style.getPropertyValue("--ppt-drag-x") || computed.getPropertyValue("--ppt-drag-x"));
    const y = parsePx(target.style.getPropertyValue("--ppt-drag-y") || computed.getPropertyValue("--ppt-drag-y"));
    target.style.translate = x.toFixed(1) + "px " + y.toFixed(1) + "px";
    target.style.willChange = "transform";
  };

  const roundPx = (value) => Number(Math.max(1, value).toFixed(1));

  const buildElementPath = (root, element) => {
    const path = [];
    let current = element;
    while (current && current !== root) {
      const parent = current.parentElement;
      if (!parent) return [];
      const index = Array.prototype.indexOf.call(parent.children, current);
      if (index < 0) return [];
      path.unshift(index);
      current = parent;
    }
    return current === root ? path : [];
  };

  const collectResizableChildren = (target) => {
    const items = [];
    const seen = new Set();
    target.querySelectorAll("canvas").forEach((canvas) => {
      const parent = canvas.parentElement;
      if (parent === target) return;
      const element = parent || canvas;
      if (element === canvas) return;
      if (!element || seen.has(element)) return;
      seen.add(element);
      const rect = element.getBoundingClientRect();
      const path = buildElementPath(target, element);
      if (!path.length && element !== target) return;
      items.push({
        element,
        path,
        baseWidth: Math.max(1, rect.width),
        baseHeight: Math.max(1, rect.height),
      });
    });
    return items;
  };

  const resizeNestedCharts = (target) => {
    if (window.PPT && typeof window.PPT.resizeCharts === "function") {
      try { window.PPT.resizeCharts(target); } catch (_error) {}
    }
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = \`
      html, body, body * {
        animation: none !important;
        transition: none !important;
      }
      .\${HOVER_CLASS} {
        cursor: crosshair !important;
      }
      .\${HOVER_CLASS} * {
        cursor: crosshair !important;
      }
      #\${HOVER_OVERLAY_ID} {
        position: fixed !important;
        z-index: 2147483646 !important;
        pointer-events: none !important;
        border: 2px dashed rgba(93,107,77,0.78) !important;
        box-shadow: 0 0 0 3px rgba(93,107,77,0.08) !important;
        box-sizing: border-box !important;
      }
      .\${SELECTED_CLASS} {
        cursor: move !important;
        user-select: none !important;
      }
      .\${SELECTED_CLASS} * {
        cursor: move !important;
      }
      #\${OVERLAY_ID} {
        position: fixed !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        border: 1px solid rgba(93,107,77,0.92) !important;
        box-shadow: 0 0 0 3px rgba(93,107,77,0.12) !important;
        box-sizing: border-box !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS} {
        position: absolute !important;
        width: 16px !important;
        height: 16px !important;
        border: 2px solid #ffffff !important;
        border-radius: 999px !important;
        background: #5d6b4d !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18) !important;
        pointer-events: auto !important;
        box-sizing: border-box !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="n"] {
        left: calc(50% - 8px) !important;
        top: -9px !important;
        cursor: ns-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="s"] {
        left: calc(50% - 8px) !important;
        bottom: -9px !important;
        cursor: ns-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="w"] {
        left: -9px !important;
        top: calc(50% - 8px) !important;
        cursor: ew-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="e"] {
        right: -9px !important;
        top: calc(50% - 8px) !important;
        cursor: ew-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="nw"] {
        left: -9px !important;
        top: -9px !important;
        cursor: nwse-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="ne"] {
        right: -9px !important;
        top: -9px !important;
        cursor: nesw-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="sw"] {
        left: -9px !important;
        bottom: -9px !important;
        cursor: nesw-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="se"] {
        right: -9px !important;
        bottom: -9px !important;
        cursor: nwse-resize !important;
      }
      html,
      body,
      body * {
        cursor: crosshair !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
    \`;
    document.head.appendChild(style);
  };

  // --- State ---
  let hoverElement = null;
  let selectedElement = null;
  let dragState = null;
  let resizeState = null;
  let pendingAnchorState = null;
  let dragPendingState = null;
  let pendingClientX = 0;
  let pendingClientY = 0;
  let frameId = 0;
  let overlayElement = null;
  let hoverOverlayElement = null;
  let overlayResizeObserver = null;
  let lastCycleKey = "";
  let lastCycleIndex = -1;
  let lastCycleAt = 0;

  // Double-click detection


  // Anchor resolution — host resolves selector and calls this
  window.__pptResolveEditModeAnchor = function(result) {
    if (!pendingAnchorState) return;
    const stableSelector = (result && result.selector) || pendingAnchorState.tempSelector;
    const blockId = (result && result.blockId) || "";
    if (blockId && pendingAnchorState.target instanceof Element) {
      pendingAnchorState.target.setAttribute("data-block-id", blockId);
    }
    if (pendingAnchorState.mode === 'drag') {
      dragState = {
        target: pendingAnchorState.target,
        selector: stableSelector,
        blockId,
        elementTag: pendingAnchorState.elementTag,
        startClientX: pendingAnchorState.startClientX,
        startClientY: pendingAnchorState.startClientY,
        baseX: pendingAnchorState.baseX,
        baseY: pendingAnchorState.baseY,
      };
      setSelected(pendingAnchorState.target);
    } else if (pendingAnchorState.mode === 'resize') {
      resizeState = {
        target: pendingAnchorState.target,
        selector: stableSelector,
        blockId,
        elementTag: pendingAnchorState.elementTag,
        dir: pendingAnchorState.dir,
        startClientX: pendingAnchorState.startClientX,
        startClientY: pendingAnchorState.startClientY,
        baseX: pendingAnchorState.baseX,
        baseY: pendingAnchorState.baseY,
        baseWidth: pendingAnchorState.baseWidth,
        baseHeight: pendingAnchorState.baseHeight,
        childItems: pendingAnchorState.childItems,
      };
    }
    pendingAnchorState = null;
  };

  const cursorHost = document.body || document.documentElement;
  const rootHost = document.documentElement;
  const previousCursor = cursorHost && cursorHost.style ? cursorHost.style.cursor : "";
  const previousRootCursor = rootHost && rootHost.style ? rootHost.style.cursor : "";
  if (rootHost && rootHost.style) {
    rootHost.style.cursor = "crosshair";
  }
  if (cursorHost && cursorHost.style) {
    cursorHost.style.cursor = "crosshair";
  }
  ensureStyle();

  // Kill residual animations from ppt-default-motion (GSAP + anime.js).
  (() => {
    // Kill GSAP animations
    if (window.gsap) {
      try {
        window.gsap.globalTimeline.progress(1);
        window.gsap.killTweensOf('*');
      } catch (_e) {}
    }
    // Kill anime.js animations (legacy fallback)
    if (window.PPT && typeof window.PPT.finishAnimations === "function") {
      try { window.PPT.finishAnimations(); } catch (_e) {}
    } else if (window.PPT && typeof window.PPT.stopAnimations === "function") {
      try { window.PPT.stopAnimations(); } catch (_e) {}
    }
    try {
      document.getAnimations?.().forEach((animation) => {
        try {
          if (typeof animation.finish === "function") animation.finish();
          else if (typeof animation.cancel === "function") animation.cancel();
        } catch (_e) {
          try { animation.cancel(); } catch (_cancelError) {}
        }
      });
    } catch (_e) {}
    const forceVisibleIfMotionStopped = (el) => {
      if (!(el instanceof HTMLElement)) return;
      const s = el.style;
      const computed = getComputedStyle(el);
      const inlineOpacity = s.opacity.trim();
      const inlineOpacityNumber = inlineOpacity ? Number(inlineOpacity) : NaN;
      const hasMotionMarker =
        el.matches("[data-anim], [data-anime], [data-animate], [data-ppt-anim-initialized='1'], .opacity-0");
      const hasInitialHiddenOpacity =
        inlineOpacity &&
        Number.isFinite(inlineOpacityNumber) &&
        inlineOpacityNumber <= 0.04;
      const motionMarked =
        hasMotionMarker ||
        hasInitialHiddenOpacity;
      if (motionMarked && Number(computed.opacity || "1") < 0.98) {
        s.opacity = "1";
      }
      if (
        motionMarked &&
        inlineOpacity &&
        /(translate|scale)\\(/i.test(s.transform || "")
      ) {
        s.transform = "";
      }
    };
    const root = document.querySelector(".ppt-page-root, [data-ppt-guard-root='1']");
    if (!root) return;
    root.querySelectorAll("[style]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const s = el.style;
      if (s.transition && (s.transition.includes("transform") || s.transition.includes("opacity"))) {
        s.transition = "";
      }
      forceVisibleIfMotionStopped(el);
    });
    // Reset click-triggered data-anim initial hidden state so elements
    // are visible in edit mode (marked by ppt-runtime during scan).
    root.querySelectorAll("[data-ppt-anim-initialized='1']").forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.opacity = "";
        el.style.transform = "";
      }
    });
    root
      .querySelectorAll("[data-anim], [data-anime], [data-animate], .opacity-0")
      .forEach(forceVisibleIfMotionStopped);
  })();

  // --- Visual helpers ---
  const getVisualBounds = (element) => {
    const base = element.getBoundingClientRect();
    let left = base.left;
    let top = base.top;
    let right = base.right;
    let bottom = base.bottom;

    const includeRect = (rect) => {
      if (!rect || (rect.width < 0.5 && rect.height < 0.5)) return;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    };

    Array.from(element.getClientRects ? element.getClientRects() : [base]).forEach(includeRect);
    element.querySelectorAll("*").forEach((child) => {
      if (!(child instanceof Element)) return;
      if (child.id === HOVER_OVERLAY_ID || child.id === OVERLAY_ID) return;
      if (["SCRIPT", "STYLE", "LINK", "META", "TITLE"].includes(child.tagName)) return;
      if (child.closest(".katex-mathml")) return;
      Array.from(child.getClientRects ? child.getClientRects() : [child.getBoundingClientRect()]).forEach(includeRect);
    });

    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  };

  const isPointInsideBounds = (bounds, clientX, clientY) => {
    return (
      bounds &&
      clientX >= bounds.left &&
      clientX <= bounds.left + bounds.width &&
      clientY >= bounds.top &&
      clientY <= bounds.top + bounds.height
    );
  };

  const zIndexForSort = (element) => {
    const value = parseInt(window.getComputedStyle(element).zIndex || "0", 10);
    return Number.isFinite(value) ? value : 0;
  };

  const compareDocumentPaintOrder = (a, b) => {
    if (a === b) return 0;
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return -1;
    return 0;
  };

  const getPointSelectionCandidates = (origin, clientX, clientY, fallbackTarget) => {
    const root =
      getPageRoot(origin) ||
      getPageRoot(fallbackTarget) ||
      document.querySelector(".ppt-page-root, [data-ppt-guard-root='1']");
    if (!root) return [];
    const items = [];
    const seen = new Set();
    Array.from(root.querySelectorAll("[data-block-id]")).forEach((element) => {
      if (!(element instanceof Element)) return;
      if (seen.has(element)) return;
      if (!isUsableElementTarget(element)) return;
      const selector = buildStableSelector(element);
      if (!selector) return;
      const bounds = getVisualBounds(element);
      if (!isPointInsideBounds(bounds, clientX, clientY)) return;
      seen.add(element);
      items.push({
        element,
        selector,
        bounds,
        zIndex: zIndexForSort(element),
        area: Math.max(1, bounds.width * bounds.height),
      });
    });
    items.sort((a, b) => {
      if (a.zIndex !== b.zIndex) return b.zIndex - a.zIndex;
      if (Math.abs(a.area - b.area) > 0.5) return a.area - b.area;
      return compareDocumentPaintOrder(a.element, b.element);
    });
    return items;
  };

  const pickCycleTarget = (origin, clientX, clientY, fallbackTarget) => {
    const candidates = getPointSelectionCandidates(origin, clientX, clientY, fallbackTarget);
    if (candidates.length === 0) return fallbackTarget;
    if (candidates.length === 1) return candidates[0].element;
    const key =
      Math.round(clientX / 8) +
      ":" +
      Math.round(clientY / 8) +
      ":" +
      candidates.map((item) => item.selector).join("|");
    const now = Date.now();
    const startElement =
      selectedElement && candidates.some((item) => item.element === selectedElement)
        ? selectedElement
        : fallbackTarget;
    if (key !== lastCycleKey || now - lastCycleAt > 1400) {
      lastCycleIndex = candidates.findIndex((item) => item.element === startElement);
      if (lastCycleIndex < 0) lastCycleIndex = 0;
    }
    lastCycleIndex = (lastCycleIndex + 1) % candidates.length;
    lastCycleKey = key;
    lastCycleAt = now;
    return candidates[lastCycleIndex].element;
  };

  const pickModifierTarget = (origin, clientX, clientY, fallbackTarget) => {
    const candidates = getPointSelectionCandidates(origin, clientX, clientY, fallbackTarget);
    if (candidates.length === 0) return fallbackTarget;
    const selectedCandidate =
      selectedElement && candidates.find((item) => item.element === selectedElement);
    if (selectedCandidate && selectedCandidate.zIndex < 0) {
      return selectedCandidate.element;
    }
    const negativeCandidates = candidates.filter((item) => item.zIndex < 0);
    if (negativeCandidates.length > 0) {
      return negativeCandidates[negativeCandidates.length - 1].element;
    }
    return pickCycleTarget(origin, clientX, clientY, fallbackTarget);
  };

  const ensureHoverOverlay = () => {
    if (hoverOverlayElement && hoverOverlayElement.isConnected) return hoverOverlayElement;
    const overlay = document.createElement("div");
    overlay.id = HOVER_OVERLAY_ID;
    document.body.appendChild(overlay);
    hoverOverlayElement = overlay;
    return hoverOverlayElement;
  };

  const updateHoverOverlay = () => {
    if (!hoverElement || hoverElement === selectedElement) {
      if (hoverOverlayElement) hoverOverlayElement.remove();
      hoverOverlayElement = null;
      return;
    }
    const overlay = ensureHoverOverlay();
    const rect = getVisualBounds(hoverElement);
    const pad = 4;
    overlay.style.left = (rect.left - pad).toFixed(1) + "px";
    overlay.style.top = (rect.top - pad).toFixed(1) + "px";
    overlay.style.width = Math.max(1, rect.width + pad * 2).toFixed(1) + "px";
    overlay.style.height = Math.max(1, rect.height + pad * 2).toFixed(1) + "px";
  };

  const setHover = (target) => {
    if (hoverElement === target) return;
    if (hoverElement && hoverElement !== selectedElement) hoverElement.classList.remove(HOVER_CLASS);
    hoverElement = target;
    if (hoverElement && hoverElement !== selectedElement) hoverElement.classList.add(HOVER_CLASS);
    updateHoverOverlay();
  };

  const ensureOverlay = () => {
    if (overlayElement && overlayElement.isConnected) return overlayElement;
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    ["n", "s", "w", "e", "nw", "ne", "sw", "se"].forEach((dir) => {
      const handle = document.createElement("div");
      handle.className = HANDLE_CLASS;
      handle.setAttribute("data-dir", dir);
      overlay.appendChild(handle);
    });
    document.body.appendChild(overlay);
    overlayElement = overlay;
    return overlayElement;
  };

  const updateOverlay = () => {
    if (!selectedElement) {
      if (overlayElement) overlayElement.remove();
      overlayElement = null;
      return;
    }
    const overlay = ensureOverlay();
    const rect = getVisualBounds(selectedElement);
    overlay.style.left = rect.left.toFixed(1) + "px";
    overlay.style.top = rect.top.toFixed(1) + "px";
    overlay.style.width = Math.max(1, rect.width).toFixed(1) + "px";
    overlay.style.height = Math.max(1, rect.height).toFixed(1) + "px";
  };

  const setSelected = (target) => {
    if (selectedElement === target) return;
    if (selectedElement) selectedElement.classList.remove(SELECTED_CLASS);
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }
    selectedElement = target;
    if (selectedElement) {
      selectedElement.classList.remove(HOVER_CLASS);
      selectedElement.classList.add(SELECTED_CLASS);
      updateHoverOverlay();
      updateOverlay();
      overlayResizeObserver = new ResizeObserver(() => updateOverlay());
      overlayResizeObserver.observe(selectedElement);
    } else {
      updateOverlay();
    }
  };

  const clearVisualState = () => {
    if (hoverElement) hoverElement.classList.remove(HOVER_CLASS);
    if (selectedElement) selectedElement.classList.remove(SELECTED_CLASS);
    hoverElement = null;
    selectedElement = null;
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }
    if (overlayElement) overlayElement.remove();
    overlayElement = null;
    if (hoverOverlayElement) hoverOverlayElement.remove();
    hoverOverlayElement = null;
  };

  // --- Emit helpers ---
  // All elements can be edited — first edit converts to position:absolute.
  const analyzeEditability = () => ({ x: true, y: true, width: true, height: true });

  const roundRect = (rect) => ({
    x: Math.round(rect.left * 10) / 10,
    y: Math.round(rect.top * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
  });

  const getBlockId = (element) => {
    if (!(element instanceof Element)) return "";
    return element.getAttribute("data-block-id") || "";
  };

  const getCaretNodeAtPoint = (clientX, clientY) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    try {
      if (typeof document.caretPositionFromPoint === "function") {
        return document.caretPositionFromPoint(clientX, clientY)?.offsetNode || null;
      }
      if (typeof document.caretRangeFromPoint === "function") {
        return document.caretRangeFromPoint(clientX, clientY)?.startContainer || null;
      }
    } catch (_error) {}
    return null;
  };

  const buildTextTargetAtPoint = (selected, selectedSelector, clientX, clientY) => {
    if (!(selected instanceof Element)) return undefined;
    const node = getCaretNodeAtPoint(clientX, clientY);
    if (!node || node.nodeType !== Node.TEXT_NODE) return undefined;
    const parent = node.parentElement;
    if (!(parent instanceof Element) || !selected.contains(parent)) return undefined;
    const text = String(node.nodeValue || "");
    if (!normalizeText(text)) return undefined;
    const parentSelector = parent === selected ? selectedSelector : buildStableSelector(parent);
    if (!parentSelector) return undefined;
    const textNodeIndex = Array.prototype.indexOf.call(parent.childNodes || [], node);
    if (textNodeIndex < 0) return undefined;
    return {
      type: "text-node",
      parentSelector,
      textNodeIndex,
      text,
    };
  };

  const classifyElement = (element, isText) => {
    if (!(element instanceof Element)) return "unknown";
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    if (isText) return "text";
    if (tag === "img" || tag === "video") return "media";
    if (element.querySelector(".katex, .katex-display, math, annotation, semantics")) return "formula";
    if (tag === "table" || tag === "td" || tag === "th" || element.querySelector("table")) return "table";
    if (element.querySelector("canvas")) return "chart";
    if (element.children && element.children.length > 1) return "container";
    const computed = window.getComputedStyle(element);
    return classifyPaintedElement(tag, computed);
  };

  const classifyPaintedElement = (tag, computed) => {
    const hasPaint =
      (computed.backgroundColor && computed.backgroundColor !== "rgba(0, 0, 0, 0)" && computed.backgroundColor !== "transparent") ||
      (computed.borderWidth && computed.borderWidth !== "0px") ||
      (computed.borderRadius && computed.borderRadius !== "0px");
    return hasPaint ? "shape" : "unknown";
  };

  const collectCapabilities = (element, kind, isText) => {
    const capabilities = ["layout", "layer"];
    if (kind === "unknown") return capabilities;
    if (element instanceof HTMLElement) {
      capabilities.push("appearance", "border");
    }
    if (isText) capabilities.push("text");
    if (kind === "media") capabilities.push("media");
    return Array.from(new Set(capabilities));
  };

  const getKindLabel = (kind, tag) => {
    switch (kind) {
      case "text": return "Text";
      case "media": return tag === "video" ? "Video" : "Image";
      case "chart": return "Chart";
      case "table": return "Table";
      case "formula": return "Formula";
      case "shape": return "Shape";
      case "container": return "Group";
      default: return tag ? tag.toUpperCase() : "Element";
    }
  };

  const collectInlineStyle = (element) => {
    const inline = {};
    if (!(element instanceof HTMLElement)) return inline;
    [
      "display",
      "position",
      "z-index",
      "opacity",
      "background-color",
      "color",
      "font-size",
      "font-weight",
      "line-height",
      "text-align",
      "border-color",
      "border-width",
      "border-style",
      "border-radius",
      "object-fit",
      "width",
      "height",
      "left",
      "top",
      "--ppt-drag-x",
      "--ppt-drag-y",
      "translate",
    ].forEach((name) => {
      const value = element.style.getPropertyValue(name);
      if (value) inline[name] = value;
    });
    return inline;
  };

  const collectAttrs = (element) => {
    const attrs = {};
    if (!(element instanceof Element)) return attrs;
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    const artTextTemplate = element.getAttribute("data-ppt-art-text") || "";
    if (artTextTemplate) attrs.artTextTemplate = artTextTemplate;
    if (tag === "img" || tag === "video") {
      const src = element.getAttribute("src") || "";
      const alt = element.getAttribute("alt") || "";
      if (src) attrs.src = src;
      if (alt) attrs.alt = alt;
    }
    if (tag === "video") {
      const poster = element.getAttribute("poster") || "";
      if (poster) attrs.poster = poster;
      attrs.controls = element.hasAttribute("controls");
      attrs.muted = element.hasAttribute("muted");
      attrs.loop = element.hasAttribute("loop");
      attrs.autoplay = element.hasAttribute("autoplay");
      attrs.playsInline = element.hasAttribute("playsinline");
      attrs.preload = element.getAttribute("preload") || "";
    }
    return attrs;
  };

  const collectElementSnapshot = (target, selector) => {
    if (!(target instanceof Element)) return null;
    const pageRoot = getPageRoot(target);
    if (!pageRoot) return null;
    const elementTag = target.tagName ? target.tagName.toLowerCase() : "";
    const isText = isEditableTextElement(target);
    const rawText = isText ? normalizeText(target.textContent) : "";
    const elementText = rawText.length > 80 ? rawText.slice(0, 80) + "\\u2026" : rawText;
    const computed = window.getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    const pageRect = pageRoot.getBoundingClientRect();
    const currentDragX = parsePx(target.style.getPropertyValue("--ppt-drag-x"));
    const currentDragY = parsePx(target.style.getPropertyValue("--ppt-drag-y"));
    const tagKind =
      isText ? "text" :
      elementTag === "img" || elementTag === "video" ? "media" :
      target.querySelector(".katex, .katex-display, math, annotation, semantics") ? "formula" :
      elementTag === "table" || elementTag === "td" || elementTag === "th" || target.querySelector("table") ? "table" :
      target.querySelector("canvas") ? "chart" :
      target.children && target.children.length > 1 ? "container" :
      classifyPaintedElement(elementTag, computed);
    const kind = tagKind;
    const pageBounds = {
      x: Math.round((rect.left - pageRect.left) * 10) / 10,
      y: Math.round((rect.top - pageRect.top) * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };

    return {
      selector,
      blockId: getBlockId(target) || undefined,
      label: getKindLabel(kind, elementTag),
      elementTag,
      elementText,
      kind,
      capabilities: collectCapabilities(target, kind, isText),
      metrics: {
        viewport: roundRect(rect),
        page: pageBounds,
        translateX: target.hasAttribute("data-ppt-layout-converted") ? 0 : currentDragX,
        translateY: target.hasAttribute("data-ppt-layout-converted") ? 0 : currentDragY,
      },
      computed: {
        display: computed.display || "",
        position: computed.position || "",
        zIndex: computed.zIndex || "",
        opacity: computed.opacity || "",
        backgroundColor: computed.backgroundColor || "",
        color: computed.color || "",
        fontSize: computed.fontSize || "",
        fontWeight: computed.fontWeight || "",
        lineHeight: computed.lineHeight || "",
        textAlign: computed.textAlign || "",
        borderColor: computed.borderColor || "",
        borderWidth: computed.borderWidth || "",
        borderStyle: computed.borderStyle || "",
        borderRadius: computed.borderRadius || "",
        objectFit: computed.objectFit || "",
      },
      inline: collectInlineStyle(target),
      attrs: collectAttrs(target),
      text: {
        editable: isText,
        value: rawText,
        html: isText ? target.innerHTML : "",
        reason: isText ? undefined : "not-text-only",
      },
    };
  };

  const getPageBoundsFor = (target) => {
    if (!(target instanceof Element)) return undefined;
    const pageRoot = getPageRoot(target);
    if (!pageRoot) return undefined;
    const rect = target.getBoundingClientRect();
    const pageRect = pageRoot.getBoundingClientRect();
    return {
      x: Math.round((rect.left - pageRect.left) * 10) / 10,
      y: Math.round((rect.top - pageRect.top) * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };
  };

  const emitSelected = (target, selector, textTarget) => {
    const snapshot = collectElementSnapshot(target, selector);
    if (!snapshot) {
      console.log(LOG_PREFIX + JSON.stringify({
        type: "selected",
        selector,
        blockId: getBlockId(target) || undefined,
        label: "Element",
        elementTag: target.tagName ? target.tagName.toLowerCase() : "",
        elementText: "",
        kind: "unknown",
        capabilities: ["layout", "layer"],
        snapshot: null,
        isText: false,
        text: "",
        style: {},
        translateX: 0,
        translateY: 0,
        editability: analyzeEditability(target)
      }));
      return;
    }

    const rawZIndex = snapshot.computed.zIndex || "";
    const zIndex = rawZIndex && rawZIndex !== 'auto' ? parseInt(rawZIndex, 10) : undefined;
    const isText = Boolean(snapshot.text?.editable);

    console.log(LOG_PREFIX + JSON.stringify({
      type: "selected",
      selector,
      blockId: snapshot.blockId,
      label: snapshot.label,
      elementTag: snapshot.elementTag,
      elementText: snapshot.elementText,
      kind: snapshot.kind,
      capabilities: snapshot.capabilities,
      snapshot,
      isText,
      text: snapshot.text?.value || "",
      html: snapshot.text?.html || "",
      textTarget,
      style: isText ? {
        color: snapshot.computed.color || "",
        fontSize: snapshot.computed.fontSize || "",
        fontWeight: snapshot.computed.fontWeight || "",
        lineHeight: snapshot.computed.lineHeight || "",
        textAlign: snapshot.computed.textAlign || "",
        backgroundColor: snapshot.computed.backgroundColor || ""
      } : {},
      bounds: snapshot.metrics.viewport,
      viewportBounds: snapshot.metrics.viewport,
      pageBounds: snapshot.metrics.page,
      translateX: snapshot.metrics.translateX,
      translateY: snapshot.metrics.translateY,
      zIndex,
      editability: analyzeEditability(target)
    }));
  };

  // --- Drag/Resize frame callbacks ---
  const applyPendingDrag = () => {
    frameId = 0;
    if (!dragState) return;
    // Absolute-converted elements: move via left/top directly
    if (dragState.target.hasAttribute("data-ppt-layout-converted")) {
      const delta = getPointerDelta(
        dragState.target,
        pendingClientX,
        pendingClientY,
        dragState.startClientX,
        dragState.startClientY
      );
      dragState.target.style.left = (dragState.baseX + delta.x).toFixed(1) + "px";
      dragState.target.style.top = (dragState.baseY + delta.y).toFixed(1) + "px";
      // Sync the viewport tracker so next Inspector edit computes correct delta
      const dragRect = dragState.target.getBoundingClientRect();
      dragState.target.setAttribute("data-ppt-last-vp-x", dragRect.left.toFixed(1));
      dragState.target.setAttribute("data-ppt-last-vp-y", dragRect.top.toFixed(1));
      updateHoverOverlay();
      updateOverlay();
      return;
    }
    const delta = getPointerDelta(
      dragState.target,
      pendingClientX,
      pendingClientY,
      dragState.startClientX,
      dragState.startClientY
    );
    const nextX = dragState.baseX + delta.x;
    const nextY = dragState.baseY + delta.y;
    dragState.target.style.setProperty("--ppt-drag-x", nextX.toFixed(1) + "px");
    dragState.target.style.setProperty("--ppt-drag-y", nextY.toFixed(1) + "px");
    ensureDragTranslate(dragState.target);
    updateHoverOverlay();
    updateOverlay();
  };

  const applyPendingResize = () => {
    frameId = 0;
    if (!resizeState) return;
    const delta = getPointerDelta(
      resizeState.target,
      pendingClientX,
      pendingClientY,
      resizeState.startClientX,
      resizeState.startClientY
    );
    const dx = delta.x;
    const dy = delta.y;
    const dir = resizeState.dir;
    const affectsWidth = dir.includes("w") || dir.includes("e");
    const affectsHeight = dir.includes("n") || dir.includes("s");
    const signedDx = dir.includes("w") ? -dx : (dir.includes("e") ? dx : 0);
    const signedDy = dir.includes("n") ? -dy : (dir.includes("s") ? dy : 0);
    let nextWidth = affectsWidth ? roundPx(resizeState.baseWidth + signedDx) : resizeState.baseWidth;
    let nextHeight = affectsHeight ? roundPx(resizeState.baseHeight + signedDy) : resizeState.baseHeight;
    if (affectsWidth && affectsHeight) {
      const scaleFromX = (resizeState.baseWidth + signedDx) / resizeState.baseWidth;
      const scaleFromY = (resizeState.baseHeight + signedDy) / resizeState.baseHeight;
      const rawScale = Math.abs(signedDx) >= Math.abs(signedDy) ? scaleFromX : scaleFromY;
      const nextScale = Math.max(0.15, Math.min(5, Number.isFinite(rawScale) ? rawScale : 1));
      nextWidth = roundPx(resizeState.baseWidth * nextScale);
      nextHeight = roundPx(resizeState.baseHeight * nextScale);
    }
    const nextX = resizeState.baseX + (dir.includes("w") ? resizeState.baseWidth - nextWidth : 0);
    const nextY = resizeState.baseY + (dir.includes("n") ? resizeState.baseHeight - nextHeight : 0);
    const scaleX = nextWidth / resizeState.baseWidth;
    const scaleY = nextHeight / resizeState.baseHeight;
    resizeState.target.style.width = nextWidth.toFixed(1) + "px";
    resizeState.target.style.height = nextHeight.toFixed(1) + "px";
    resizeState.childItems.forEach((item) => {
      if (affectsWidth) item.element.style.width = roundPx(item.baseWidth * scaleX).toFixed(1) + "px";
      if (affectsHeight) item.element.style.height = roundPx(item.baseHeight * scaleY).toFixed(1) + "px";
    });
    // Absolute-converted elements: move via left/top
    if (resizeState.target.hasAttribute("data-ppt-layout-converted")) {
      resizeState.target.style.left = nextX.toFixed(1) + "px";
      resizeState.target.style.top = nextY.toFixed(1) + "px";
      // Sync the viewport tracker so next Inspector edit computes correct delta
      const resizeRect = resizeState.target.getBoundingClientRect();
      resizeState.target.setAttribute("data-ppt-last-vp-x", resizeRect.left.toFixed(1));
      resizeState.target.setAttribute("data-ppt-last-vp-y", resizeRect.top.toFixed(1));
    } else {
      resizeState.target.style.setProperty("--ppt-drag-x", nextX.toFixed(1) + "px");
      resizeState.target.style.setProperty("--ppt-drag-y", nextY.toFixed(1) + "px");
      ensureDragTranslate(resizeState.target);
    }
    resizeNestedCharts(resizeState.target);
    updateHoverOverlay();
    updateOverlay();
  };

  // --- Pointer event handlers ---
  const onPointerMove = (event) => {
    if (pendingAnchorState) {
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Deferred drag: only activate when pointer moves beyond threshold
    if (dragPendingState) {
      const dx = event.clientX - dragPendingState.startClientX;
      const dy = event.clientY - dragPendingState.startClientY;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      // Threshold exceeded — convert to real drag
      const s = dragPendingState;
      dragPendingState = null;
      ensureDragTranslate(s.target);
      if (rootHost && rootHost.style) rootHost.style.cursor = "move";
      if (cursorHost && cursorHost.style) cursorHost.style.cursor = "move";
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      if (s.selector.indexOf('[data-block-id=') !== -1) {
        setSelected(s.target);
        dragState = {
          target: s.target,
          selector: s.selector,
          blockId: getBlockId(s.target) || "",
          elementTag: s.elementTag,
          startClientX: s.startClientX,
          startClientY: s.startClientY,
          baseX: s.baseX,
          baseY: s.baseY,
        };
      } else {
        pendingAnchorState = {
          mode: 'drag',
          target: s.target,
          tempSelector: s.selector,
          blockId: getBlockId(s.target) || "",
          elementTag: s.elementTag,
          startClientX: s.startClientX,
          startClientY: s.startClientY,
          baseX: s.baseX,
          baseY: s.baseY,
        };
        console.log(LOG_PREFIX + JSON.stringify({ type: "pre-anchor", selector: s.selector, elementTag: s.elementTag }));
      }
      try {
        s.target.setPointerCapture?.(event.pointerId);
      } catch (_error) {}
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (resizeState) {
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      if (!frameId) {
        frameId = requestAnimationFrame(applyPendingResize);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (dragState) {
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      if (!frameId) {
        frameId = requestAnimationFrame(applyPendingDrag);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = pickTarget(event.target, event.clientX, event.clientY);
    setHover(target);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const handle = event.target instanceof Element ? event.target.closest("." + HANDLE_CLASS) : null;
    if (handle && selectedElement) {
      const selector = buildStableSelector(selectedElement);
      if (!selector) return;
      const isAbsSel = selectedElement.hasAttribute("data-ppt-layout-converted");
      const computed = isAbsSel ? null : getComputedStyle(selectedElement);
      const rect = selectedElement.getBoundingClientRect();
      const baseX = isAbsSel
        ? parseFloat(selectedElement.style.left || "0")
        : parsePx(selectedElement.style.getPropertyValue("--ppt-drag-x") || computed.getPropertyValue("--ppt-drag-x"));
      const baseY = isAbsSel
        ? parseFloat(selectedElement.style.top || "0")
        : parsePx(selectedElement.style.getPropertyValue("--ppt-drag-y") || computed.getPropertyValue("--ppt-drag-y"));
      if (!isAbsSel) ensureDragTranslate(selectedElement);
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      const elementTag = selectedElement.tagName ? selectedElement.tagName.toLowerCase() : "";
      if (selector.indexOf('[data-block-id=') !== -1) {
        resizeState = {
          target: selectedElement,
          selector,
          blockId: getBlockId(selectedElement) || "",
          elementTag,
          dir: handle.getAttribute("data-dir") || "se",
          startClientX: event.clientX,
          startClientY: event.clientY,
          baseX,
          baseY,
          baseWidth: Math.max(1, rect.width),
          baseHeight: Math.max(1, rect.height),
          childItems: collectResizableChildren(selectedElement),
        };
      } else {
        pendingAnchorState = {
          mode: 'resize',
          target: selectedElement,
          tempSelector: selector,
          blockId: getBlockId(selectedElement) || "",
          elementTag,
          dir: handle.getAttribute("data-dir") || "se",
          startClientX: event.clientX,
          startClientY: event.clientY,
          baseX,
          baseY,
          baseWidth: Math.max(1, rect.width),
          baseHeight: Math.max(1, rect.height),
          childItems: collectResizableChildren(selectedElement),
        };
        console.log(LOG_PREFIX + JSON.stringify({ type: "pre-anchor", selector, elementTag }));
      }
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch (_error) {}
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const primaryTarget = pickTarget(event.target, event.clientX, event.clientY);
    const modifierTarget = event.altKey
      ? pickModifierTarget(event.target, event.clientX, event.clientY, primaryTarget)
      : null;
    const clickTarget = event.altKey ? modifierTarget : primaryTarget;
    const dragTarget = clickTarget;
    if (!dragTarget) return;

    const selector = buildStableSelector(dragTarget);
    if (!selector) return;
    const clickSelector = clickTarget ? buildStableSelector(clickTarget) : selector;
    if (!clickSelector) return;

    // All elements: deferred drag. Record start position.
    // < 3px on pointerup = click (emit selected). >= 3px on pointermove = drag.
    const isAbsConverted = dragTarget.hasAttribute("data-ppt-layout-converted");
    const computed = isAbsConverted ? null : getComputedStyle(dragTarget);
    const baseX = isAbsConverted
      ? parseFloat(dragTarget.style.left || "0")
      : parsePx(dragTarget.style.getPropertyValue("--ppt-drag-x") || computed.getPropertyValue("--ppt-drag-x"));
    const baseY = isAbsConverted
      ? parseFloat(dragTarget.style.top || "0")
      : parsePx(dragTarget.style.getPropertyValue("--ppt-drag-y") || computed.getPropertyValue("--ppt-drag-y"));
    const elementTag = dragTarget.tagName ? dragTarget.tagName.toLowerCase() : "";
    dragPendingState = {
      target: dragTarget,
      selector,
      elementTag,
      clickTarget,
      clickSelector,
      clickElementTag: clickTarget && clickTarget.tagName ? clickTarget.tagName.toLowerCase() : "",
      startClientX: event.clientX,
      startClientY: event.clientY,
      textTarget: buildTextTargetAtPoint(dragTarget, selector, event.clientX, event.clientY),
      clickTextTarget: clickTarget
        ? buildTextTargetAtPoint(clickTarget, clickSelector, event.clientX, event.clientY)
        : undefined,
      baseX,
      baseY,
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerUp = (event) => {
    // Click (< 3px movement): select element and emit to host
    if (dragPendingState) {
      const s = dragPendingState;
      dragPendingState = null;
      const clickTarget = s.clickTarget || s.target;
      const clickSelector = s.clickSelector || s.selector;
      setSelected(clickTarget);
      emitSelected(clickTarget, clickSelector, s.clickTextTarget || s.textTarget);
      return;
    }

    if (pendingAnchorState) {
      try {
        event.target?.releasePointerCapture?.(event.pointerId);
      } catch (_error) {}
      pendingAnchorState = null;
      if (rootHost && rootHost.style) rootHost.style.cursor = "crosshair";
      if (cursorHost && cursorHost.style) cursorHost.style.cursor = "crosshair";
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (resizeState) {
      if (frameId) {
        cancelAnimationFrame(frameId);
        applyPendingResize();
      }
      const target = resizeState.target;
      const isAbsUp = target.hasAttribute("data-ppt-layout-converted");
      // For absolute elements: payload.x = displacement (same semantics as translate offset)
      // For translate elements: payload.x = the translate offset
      let nextX, nextY;
      if (isAbsUp) {
        const currentLeft = parseFloat(target.style.left || "0");
        const currentTop = parseFloat(target.style.top || "0");
        nextX = currentLeft;
        nextY = currentTop;
      } else {
        nextX = parsePx(target.style.getPropertyValue("--ppt-drag-x"));
        nextY = parsePx(target.style.getPropertyValue("--ppt-drag-y"));
      }
      const nextWidth = parsePx(target.style.width) || resizeState.baseWidth;
      const nextHeight = parsePx(target.style.height) || resizeState.baseHeight;
      const deltaX = nextX - resizeState.baseX;
      const deltaY = nextY - resizeState.baseY;
      const scale = nextWidth / resizeState.baseWidth;
      const affectsWidth = resizeState.dir.includes("w") || resizeState.dir.includes("e");
      const affectsHeight = resizeState.dir.includes("n") || resizeState.dir.includes("s");
      const childUpdates = resizeState.childItems.map((item) => ({
        path: item.path,
        width: affectsWidth ? parsePx(item.element.style.width) || undefined : undefined,
        height: affectsHeight ? parsePx(item.element.style.height) || undefined : undefined,
      })).filter((item) => item.width !== undefined || item.height !== undefined);
      try {
        event.target?.releasePointerCapture?.(event.pointerId);
      } catch (_error) {}
      target.style.willChange = "";
      resizeNestedCharts(target);
      updateOverlay();
      if (
        Math.abs(deltaX) >= 0.5 ||
        Math.abs(deltaY) >= 0.5 ||
        Math.abs(nextWidth - resizeState.baseWidth) >= 0.5 ||
        Math.abs(nextHeight - resizeState.baseHeight) >= 0.5
      ) {
        const movedPageBounds = getPageBoundsFor(target);
        console.log(LOG_PREFIX + JSON.stringify({
          type: "moved",
          selector: resizeState.selector,
          blockId: resizeState.blockId || getBlockId(target) || undefined,
          label: resizeState.selector,
          elementTag: resizeState.elementTag,
          layoutMode: isAbsUp ? "absolute" : "translate",
          x: Number(nextX.toFixed(1)),
          y: Number(nextY.toFixed(1)),
          deltaX: Number(deltaX.toFixed(1)),
          deltaY: Number(deltaY.toFixed(1)),
          visualX: movedPageBounds ? movedPageBounds.x : undefined,
          visualY: movedPageBounds ? movedPageBounds.y : undefined,
          width: Number(nextWidth.toFixed(1)),
          height: Number(nextHeight.toFixed(1)),
          scale: Number(scale.toFixed(3)),
          childUpdates,
        }));
      }
      resizeState = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!dragState) return;
    if (frameId) cancelAnimationFrame(frameId);
    // Always apply the latest pointer position — the last rAF may have
    // already fired (frameId === 0) while the pointer kept moving.
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;
    applyPendingDrag();
    const target = dragState.target;
    const isAbsDrag = target.hasAttribute("data-ppt-layout-converted");
    // For absolute elements: payload.x = visual displacement from the position
    // at selection time. handleElementMoved computes visualX = originalCSSX + payload.x,
    // where originalCSSX = bounds.x (since translateX=0). So payload.x = currentViewportX - bounds.x.
    // For translate elements: payload.x = the translate offset directly.
    let nextX, nextY;
    if (isAbsDrag) {
      const currentLeft = parseFloat(target.style.left || "0");
      const currentTop = parseFloat(target.style.top || "0");
      nextX = currentLeft;
      nextY = currentTop;
    } else {
      nextX = parsePx(target.style.getPropertyValue("--ppt-drag-x"));
      nextY = parsePx(target.style.getPropertyValue("--ppt-drag-y"));
    }
    const deltaX = nextX - dragState.baseX;
    const deltaY = nextY - dragState.baseY;
    try {
      target.releasePointerCapture?.(event.pointerId);
    } catch (_error) {}
    target.style.willChange = "";
    updateOverlay();
    if (rootHost && rootHost.style) rootHost.style.cursor = "crosshair";
    if (cursorHost && cursorHost.style) cursorHost.style.cursor = "crosshair";

    if (Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5) {
      const movedPageBounds = getPageBoundsFor(target);
      console.log(LOG_PREFIX + JSON.stringify({
        type: "moved",
        selector: dragState.selector,
        blockId: dragState.blockId || getBlockId(target) || undefined,
        label: dragState.selector,
        elementTag: dragState.elementTag,
        layoutMode: isAbsDrag ? "absolute" : "translate",
        x: Number(nextX.toFixed(1)),
        y: Number(nextY.toFixed(1)),
        deltaX: Number(deltaX.toFixed(1)),
        deltaY: Number(deltaY.toFixed(1)),
        visualX: movedPageBounds ? movedPageBounds.x : undefined,
        visualY: movedPageBounds ? movedPageBounds.y : undefined,
      }));
    }
    dragState = null;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      console.log(LOG_PREFIX + JSON.stringify({ type: "exit" }));
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedElement) {
      const selector = buildStableSelector(selectedElement);
      if (selector) {
        console.log(LOG_PREFIX + JSON.stringify({ type: "delete-request", selector }));
      }
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const setPreviewScale = (value) => {
    previewScaleValue = normalizeScale(value);
  };

  // --- Live update API (called by host via executeJavaScript) ---
  window.__pptEditModeLiveUpdate = (selector, patch) => {
    try {
      const el = document.querySelector(selector);
      if (!el) return;
      if (typeof patch.html === "string") {
        el.innerHTML = patch.html;
      } else
      if (typeof patch.text === "string") {
        const target = patch.textTarget;
        if (target && target.type === "text-node" && typeof target.parentSelector === "string") {
          const parent = document.querySelector(target.parentSelector);
          const index = Number(target.textNodeIndex);
          const node = parent && Number.isInteger(index) ? parent.childNodes[index] : null;
          if (node && node.nodeType === Node.TEXT_NODE) {
            node.nodeValue = patch.text;
          } else {
            el.textContent = patch.text;
          }
        } else {
          el.textContent = patch.text;
        }
      }
      if (patch.style) {
        if (patch.style.color) el.style.setProperty("color", patch.style.color, "important");
        if (patch.style.fontSize) el.style.setProperty("font-size", patch.style.fontSize, "important");
        if (patch.style.fontWeight) el.style.setProperty("font-weight", patch.style.fontWeight, "important");
        if (patch.style.textAlign) el.style.setProperty("text-align", patch.style.textAlign, "important");
      }
    } catch (_error) {}
  };

  window.__pptEditModeReadSnapshot = (selector) => {
    try {
      const el = document.querySelector(selector);
      if (!el) return null;
      return collectElementSnapshot(el, selector);
    } catch (_error) {
      return null;
    }
  };

  window.__pptEditModeApplyProperties = (selector, patch) => {
    try {
      const el = document.querySelector(selector);
      if (!el || !patch) return;
      if (patch.style) {
        if (patch.style.zIndex !== undefined) {
          const position = window.getComputedStyle(el).position;
          if (!position || position === "static") {
            el.style.setProperty("position", "relative", "important");
          }
          el.style.setProperty("z-index", String(patch.style.zIndex), "important");
        }
        if (patch.style.opacity !== undefined) el.style.setProperty("opacity", String(patch.style.opacity), "important");
        if (patch.style.backgroundColor) el.style.setProperty("background-color", patch.style.backgroundColor, "important");
        if (patch.style.color) el.style.setProperty("color", patch.style.color, "important");
        if (patch.style.fontSize !== undefined) {
          const fontSize = String(patch.style.fontSize);
          el.style.setProperty("font-size", /px$/i.test(fontSize) ? fontSize : fontSize + "px", "important");
        }
        if (patch.style.fontWeight) el.style.setProperty("font-weight", patch.style.fontWeight, "important");
        if (patch.style.textAlign) el.style.setProperty("text-align", patch.style.textAlign, "important");
        if (patch.style.objectFit) el.style.setProperty("object-fit", patch.style.objectFit, "important");
      }
      if (patch.attrs) {
        ["alt", "poster", "controls", "muted", "loop", "autoplay", "playsInline", "preload"].forEach((name) => {
          if (!Object.prototype.hasOwnProperty.call(patch.attrs, name)) return;
          const value = patch.attrs[name];
          if (typeof value === "boolean") {
            const attrName = name === "playsInline" ? "playsinline" : name;
            if (value) el.setAttribute(attrName, "");
            else el.removeAttribute(attrName);
          } else if (value !== undefined && value !== null) {
            const attrName = name === "playsInline" ? "playsinline" : name;
            if (String(value)) el.setAttribute(attrName, String(value));
            else el.removeAttribute(attrName);
          }
        });
      }
    } catch (_error) {}
  };

  // Convert element to position:absolute on first layout edit ("browser-like").
  // Uses incremental approach (same as drag) to avoid coordinate system issues:
  // remember the last viewport position, compute delta, apply to style.left/top.
  window.__pptEditModeSetLayout = (selector, layout) => {
    try {
      const el = document.querySelector(selector);
      if (!el) return;
      // First edit: convert to position:absolute
      if (!el.hasAttribute("data-ppt-layout-converted")) {
        // 1. Record current visual position BEFORE changing position
        const rect = el.getBoundingClientRect();
        // 2. Set position:absolute first — this changes the offsetParent
        el.style.position = "absolute";
        // 3. Force synchronous reflow so offsetParent updates to the absolute context
        void el.offsetTop;
        // 4. Now read the NEW offsetParent (nearest positioned ancestor for absolute)
        const newOffsetParent = el.offsetParent;
        const newOffsetRect = newOffsetParent
          ? newOffsetParent.getBoundingClientRect()
          : { left: 0, top: 0 };
        // 5. Set left/top using pre-conversion visual position minus new offset
        el.style.left = (rect.left - newOffsetRect.left).toFixed(1) + "px";
        el.style.top = (rect.top - newOffsetRect.top).toFixed(1) + "px";
        el.style.width = Math.max(1, rect.width).toFixed(1) + "px";
        el.style.height = Math.max(1, rect.height).toFixed(1) + "px";
        el.style.zIndex = "10";
        // Clear translate mechanism
        el.style.translate = "";
        el.style.removeProperty("--ppt-drag-x");
        el.style.removeProperty("--ppt-drag-y");
        // Remember the current viewport position for delta-based updates
        el.setAttribute("data-ppt-last-vp-x", rect.left.toFixed(1));
        el.setAttribute("data-ppt-last-vp-y", rect.top.toFixed(1));
        el.setAttribute("data-ppt-layout-converted", "1");
      }
      // Incremental: compute delta from last known viewport position,
      // apply to current style.left/top (offsetParent-relative).
      // This mirrors how drag works — only relative changes, no coordinate conversion.
      if (layout.x !== undefined) {
        const lastVpX = parseFloat(el.getAttribute("data-ppt-last-vp-x") || "0");
        const delta = layout.x - lastVpX;
        const curLeft = parseFloat(el.style.left || "0");
        el.style.left = (curLeft + delta).toFixed(1) + "px";
        el.setAttribute("data-ppt-last-vp-x", layout.x.toFixed(1));
      }
      if (layout.y !== undefined) {
        const lastVpY = parseFloat(el.getAttribute("data-ppt-last-vp-y") || "0");
        const delta = layout.y - lastVpY;
        const curTop = parseFloat(el.style.top || "0");
        el.style.top = (curTop + delta).toFixed(1) + "px";
        el.setAttribute("data-ppt-last-vp-y", layout.y.toFixed(1));
      }
      if (layout.width !== undefined) el.style.width = Math.max(1, layout.width).toFixed(1) + "px";
      if (layout.height !== undefined) el.style.height = Math.max(1, layout.height).toFixed(1) + "px";
      if (layout.width !== undefined || layout.height !== undefined) resizeNestedCharts(el);
      updateOverlay();
    } catch (_error) {}
  };

  window.__pptEditModeClearSelection = () => {
    if (selectedElement) {
      selectedElement.classList.remove(SELECTED_CLASS);
      selectedElement = null;
    }
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }
    if (overlayElement) {
      overlayElement.remove();
      overlayElement = null;
    }
  };

  window.__pptEditModeRestoreSelection = (selector) => {
    try {
      if (!selector || typeof selector !== "string") return false;
      const target = document.querySelector(selector);
      if (!(target instanceof Element)) {
        clearVisualState();
        console.debug("[EditMode] restore selection skipped: selector not found", selector);
        return false;
      }
      setSelected(target);
      const stableSelector = buildStableSelector(target) || selector;
      requestAnimationFrame(() => {
        updateOverlay();
        emitSelected(target, stableSelector);
      });
      return true;
    } catch (_error) {
      console.debug("[EditMode] restore selection failed", _error);
      return false;
    }
  };

  window.__pptEditModeInjectElement = (parentSelector, html, insertIndex, selectAfterInsert = true) => {
    try {
      const parent = document.querySelector(parentSelector) ||
                     document.querySelector('[data-ppt-guard-root="1"]') ||
                     document.querySelector('.ppt-page-root');
      if (!parent) return;
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const nodes = Array.from(temp.children);
      if (nodes.length > 0) {
        const existingBlock = nodes
          .map((node) => node instanceof Element ? node.getAttribute("data-block-id") : "")
          .find((blockId) => blockId && document.querySelector('[data-block-id="' + attrEscape(blockId) + '"]'));
        if (existingBlock) {
          const existing = document.querySelector('[data-block-id="' + attrEscape(existingBlock) + '"]');
          if (existing && selectAfterInsert) {
            setSelected(existing);
            requestAnimationFrame(() => {
              updateOverlay();
            });
          }
          return;
        }
        const anchor =
          Number.isInteger(insertIndex) && insertIndex >= 0 && insertIndex < parent.children.length
            ? parent.children[insertIndex]
            : null;
        let selectable = null;
        nodes.forEach((node) => {
          if (anchor) parent.insertBefore(node, anchor);
          else parent.appendChild(node);
          if (!selectable && node instanceof Element && node.getAttribute("data-block-id")) {
            selectable = node;
          }
        });
        const el = selectable || nodes.find((node) => node instanceof Element) || null;
        if (el && selectAfterInsert) {
          setSelected(el);
          requestAnimationFrame(() => {
            updateOverlay();
          });
        }
      }
    } catch (_error) {}
  };

  window.__pptEditModeSetPreviewScale = setPreviewScale;

  // --- Cleanup ---
  const cleanup = () => {
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    clearVisualState();
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    if (overlayElement) overlayElement.remove();
    overlayElement = null;
    if (hoverOverlayElement) hoverOverlayElement.remove();
    hoverOverlayElement = null;
    resizeState = null;
    pendingAnchorState = null;
    dragPendingState = null;
    delete window.__pptResolveEditModeAnchor;
    delete window.__pptEditModeLiveUpdate;
    delete window.__pptEditModeReadSnapshot;
    delete window.__pptEditModeApplyProperties;
    delete window.__pptEditModeSetLayout;
    delete window.__pptEditModeClearSelection;
    delete window.__pptEditModeInjectElement;
    delete window.__pptEditModeSetPreviewScale;
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    if (cursorHost && cursorHost.style) {
      cursorHost.style.cursor = previousCursor || "";
    }
    if (rootHost && rootHost.style) {
      rootHost.style.cursor = previousRootCursor || "";
    }
    delete window[STATE_KEY];
  };

  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("keydown", onKeyDown, true);

  window[STATE_KEY] = { active: true, cleanup, setPreviewScale };
})();
`
}

export function buildEditModeSetPreviewScaleScript(previewScale: number): string {
  const normalizedScale =
    Number.isFinite(previewScale) && previewScale > 0 ? Number(previewScale.toFixed(4)) : 1;
  return `
(() => {
  const value = ${JSON.stringify(normalizedScale)};
  if (typeof window.__pptEditModeSetPreviewScale === "function") {
    window.__pptEditModeSetPreviewScale(value);
    return;
  }
  const state = window.__pptEditModeState;
  if (state && typeof state.setPreviewScale === "function") {
    state.setPreviewScale(value);
  }
})();
`;
}

export function buildEditModeCleanupScript(): string {
  return `
(() => {
  const STATE_KEY = "__pptEditModeState";
  const state = window[STATE_KEY];
  if (state && typeof state.cleanup === "function") {
    state.cleanup();
  } else {
    delete window[STATE_KEY];
  }
})();
`
}
