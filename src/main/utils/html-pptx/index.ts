import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { writePptxDocument } from './ooxml-writer'

export type {
  HtmlToPptxTextAlign,
  HtmlToPptxTextBox,
  HtmlToPptxShapeType,
  HtmlToPptxBorder,
  HtmlToPptxShape,
  HtmlToPptxImage,
  HtmlToPptxTableCell,
  HtmlToPptxTable,
  HtmlToPptxSlide,
  HtmlToPptxDocument,
  HtmlToPptxExtractOptions,
  HtmlToPptxExtractedSlide,
  HtmlToPptxEmbeddedFont
} from './types'

import type {
  HtmlToPptxTextRun,
  HtmlToPptxTextBox,
  HtmlToPptxShape,
  HtmlToPptxImage,
  HtmlToPptxTable,
  HtmlToPptxTableCell,
  HtmlToPptxSlide,
  HtmlToPptxDocument,
  HtmlToPptxExtractOptions
} from './types'

import { buildTableExtractScript } from './table-extract'

const DEFAULT_SLIDE_WIDTH = 13.333
const DEFAULT_SLIDE_HEIGHT = 7.5
const DEFAULT_MAX_TEXT_CHARS = 1000
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_EXPORT_FONT_SIZE_PT = 144
const require = createRequire(import.meta.url)
const PRETEXT_MODULE_URL = pathToFileURL(require.resolve('@chenglou/pretext')).toString()

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const normalizeHexColor = (value: string | undefined, fallback = '111827'): string => {
  if (!value) return fallback
  const trimmed = value.trim().replace(/^#/, '').toUpperCase()
  if (/^[0-9A-F]{3}$/.test(trimmed)) {
    return trimmed
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
  }
  return /^[0-9A-F]{6}$/.test(trimmed) ? trimmed : fallback
}

const sanitizeFontFace = (value: string | undefined): string => {
  const font = String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .find(Boolean)
  return font || 'Aptos'
}

const normalizeText = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .trim()

const normalizePptxText = (value: string): string => {
  const lines = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
  while (lines.length > 0 && !lines[0]) lines.shift()
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop()
  return lines.join('\n')
}

const hasCjkText = (value: string): boolean => /[\u3400-\u9fff\uf900-\ufaff]/.test(value)

const resolveExportFontFace = (text: string, value: string | undefined): string => {
  const fontFace = sanitizeFontFace(value)
  if (!hasCjkText(text)) return fontFace
  if (/^(aptos|arial|helvetica|inter|system-ui|-apple-system|sans-serif|serif)$/i.test(fontFace)) {
    return 'Microsoft YaHei'
  }
  return fontFace
}

const normalizeDataUriMime = (value: string): string => {
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|gif));base64,/i)
  if (!match) return ''
  return match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
}

const estimateDataUriBytes = (dataUri: string): number => {
  const commaIndex = dataUri.indexOf(',')
  if (commaIndex < 0) return 0
  const base64 = dataUri.slice(commaIndex + 1).replace(/\s/g, '')
  if (!base64) return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

const buildRgbToHexScript = (): string => `
const rgbToHex = (value) => {
  const source = String(value || '').trim();
  if (!source || source === 'transparent') return '';
  if (source.startsWith('#')) {
    const raw = source.slice(1).toUpperCase();
    return raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
  }
  const match = source.match(/rgba?\\(\\s*(\\d+(?:\\.\\d+)?)(?:\\s*,\\s*|\\s+)(\\d+(?:\\.\\d+)?)(?:\\s*,\\s*|\\s+)(\\d+(?:\\.\\d+)?)(?:\\s*(?:,|\\/)\\s*(\\d+(?:\\.\\d+)?%?))?/i);
  if (!match) return '';
  const alpha = match[4] === undefined
    ? 1
    : String(match[4]).endsWith('%')
      ? Number.parseFloat(match[4]) / 100
      : Number(match[4]);
  if (alpha <= 0.02) return '';
  return [match[1], match[2], match[3]]
    .map((part) => Math.max(0, Math.min(255, Math.round(Number(part) || 0))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};
`
export const buildHtmlToPptxExtractScript = (options: HtmlToPptxExtractOptions): string => {
  const slideWidth = options.slideWidthIn ?? DEFAULT_SLIDE_WIDTH
  const slideHeight = options.slideHeightIn ?? DEFAULT_SLIDE_HEIGHT
  const maxTextBoxes = Math.max(1, Math.floor(options.maxTextBoxes ?? 80))
  const maxShapes = Math.max(0, Math.floor(options.maxShapes ?? 80))
  const maxImages = Math.max(0, Math.floor(options.maxImages ?? 40))
  const maxTextChars = Math.max(80, Math.floor(options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS))
  const maxImageBytes = Math.max(0, Math.floor(options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES))

  // Build table extraction script and inject it into the main script
  const tableExtractScript = buildTableExtractScript(options)

  return `
(async () => {
  const pageWidthPx = ${JSON.stringify(options.pageWidthPx)};
  const pageHeightPx = ${JSON.stringify(options.pageHeightPx)};
  const slideWidthIn = ${JSON.stringify(slideWidth)};
  const slideHeightIn = ${JSON.stringify(slideHeight)};
  const maxTextBoxes = ${JSON.stringify(maxTextBoxes)};
  const maxShapes = ${JSON.stringify(maxShapes)};
  const maxImages = ${JSON.stringify(maxImages)};
  const maxTextChars = ${JSON.stringify(maxTextChars)};
  const maxImageDataUriLength = ${JSON.stringify(Math.ceil((maxImageBytes * 4) / 3) + 128)};
  const pretextModuleUrl = ${JSON.stringify(PRETEXT_MODULE_URL)};
  let pretext = null;
  try {
    pretext = await import(pretextModuleUrl);
  } catch (_error) {
    pretext = null;
  }
  const normalize = (value) => String(value || '')
    .replace(/\\s+/g, ' ')
    .replace(/[\\u200b-\\u200d\\ufeff]/g, '')
    .trim();
  const clampText = (value) => normalize(value).slice(0, maxTextChars);
  const normalizeLines = (value) => {
    const lines = String(value || '')
      .replace(/\\r\\n?/g, '\\n')
      .replace(/[\\u200b-\\u200d\\ufeff]/g, '')
      .split('\\n')
      .map((line) => line.replace(/[^\\S\\n]+/g, ' ').trim());
    while (lines.length > 0 && !lines[0]) lines.shift();
    while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
    return lines.join('\\n');
  };
  const clampBlockText = (value) => normalizeLines(value).slice(0, maxTextChars);
  ${buildRgbToHexScript()}

  // ========== Table extraction (before shapes/text) ==========
  const tableResult = ${tableExtractScript};
  const tables = tableResult.tables || [];
  const consumedTableElementIds = new Set(tableResult.consumedTableElementIds || []);
  const isInsideConsumedTable = (element) => {
    if (element.getAttribute && consumedTableElementIds.has(element.getAttribute('data-pptx-consumed-table'))) return true;
    const closest = element.closest && element.closest('[data-pptx-consumed-table]');
    return closest ? consumedTableElementIds.has(closest.getAttribute('data-pptx-consumed-table')) : false;
  };

  const pageElement =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.querySelector('[data-ppt-page], [data-page], .ppt-page, .slide, .page') ||
    document.body;
  const pageRect = pageElement.getBoundingClientRect();
  const pageLeft = pageRect.left || 0;
  const pageTop = pageRect.top || 0;
  const layoutWidthPx = pageRect.width || pageWidthPx;
  const layoutHeightPx = pageRect.height || pageHeightPx;
  const pageTransformScale = pageElement instanceof HTMLElement && pageElement.offsetWidth
    ? layoutWidthPx / pageElement.offsetWidth
    : 1;
  const pxToInX = (value) => ((Number(value) || 0) - pageLeft) / layoutWidthPx * slideWidthIn;
  const pxToInY = (value) => ((Number(value) || 0) - pageTop) / layoutHeightPx * slideHeightIn;
  const sizeToInX = (value) => (Number(value) || 0) / layoutWidthPx * slideWidthIn;
  const sizeToInY = (value) => (Number(value) || 0) / layoutHeightPx * slideHeightIn;
  const pointsPerPx = Math.min(slideWidthIn / layoutWidthPx, slideHeightIn / layoutHeightPx) * 72;
  const parseAlpha = (value) => {
    const match = String(value || '').match(/rgba?\\(\\s*\\d+(?:\\.\\d+)?(?:\\s*,\\s*|\\s+)\\d+(?:\\.\\d+)?(?:\\s*,\\s*|\\s+)\\d+(?:\\.\\d+)?(?:\\s*(?:,|\\/)\\s*(\\d+(?:\\.\\d+)?%?))?/i);
    if (!match || match[1] === undefined) return 1;
    const raw = String(match[1]);
    const alpha = raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number(raw);
    return Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  };
  const transparencyFor = (color, opacity) => {
    const alpha = parseAlpha(color) * Math.max(0, Math.min(1, Number(opacity || 1)));
    return Math.round((1 - alpha) * 100);
  };
  const resolveTextPaint = (style) => {
    const textFill = style.webkitTextFillColor || style.getPropertyValue?.('-webkit-text-fill-color') || '';
    const textFillHex = rgbToHex(textFill);
    const colorSource = textFillHex ? textFill : style.color;
    const color = rgbToHex(colorSource) || rgbToHex(style.color) || '111827';
    const opacity = parseAlpha(colorSource) * Math.max(0, Math.min(1, Number(style.opacity || 1)));
    return { color, opacity };
  };
  const parseRotate = (style) => {
    if (!style.transform || style.transform === 'none') return undefined;
    const values = style.transform.match(/matrix\\(([^)]+)\\)/)?.[1]?.split(',').map((part) => Number(part.trim()));
    if (!values || values.length < 4) return undefined;
    const angle = Math.round(Math.atan2(values[1], values[0]) * 180 / Math.PI);
    return angle || undefined;
  };
  const isStyleElement = (element) =>
    ['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'FONT', 'SUB', 'SUP', 'A', 'SMALL', 'BIG', 'MARK'].includes(element.tagName);
  const resolveBackgroundColor = () => {
    const pageBg = rgbToHex(window.getComputedStyle(pageElement).backgroundColor);
    if (pageBg) return pageBg;
    const htmlBg = rgbToHex(window.getComputedStyle(document.documentElement).backgroundColor);
    if (htmlBg) return htmlBg;
    const pageArea = layoutWidthPx * layoutHeightPx;
    const candidates = pageElement.querySelectorAll(':scope > div, :scope > section, :scope > main');
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      const fill = rgbToHex(style.backgroundColor);
      if (!fill) continue;
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area >= pageArea * 0.5) return fill;
    }
    return 'FFFFFF';
  };
  const backgroundColor = resolveBackgroundColor();

  const isVisible = (element, style, rect) => {
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity || '1') < 0.04) return false;
    const hasVisibleBorder =
      ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
        const width = Number.parseFloat(style['border' + side + 'Width'] || '0') || 0;
        const borderStyle = style['border' + side + 'Style'];
        return width > 0 && borderStyle !== 'none';
      });
    if ((rect.width < 2 || rect.height < 2) && !hasVisibleBorder) return false;
    if (rect.width < 2 && rect.height < 2) return false;
    if (rect.bottom < 0 || rect.right < 0 || rect.left > pageWidthPx || rect.top > pageHeightPx) return false;
    if (element.closest('script, style, noscript, .katex, .katex-mathml, [data-pptx-formula-block]')) return false;
    return true;
  };

  const elementToBox = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      rect,
      x: pxToInX(rect.left),
      y: pxToInY(rect.top),
      w: sizeToInX(rect.width),
      h: sizeToInY(rect.height)
    };
  };
  const elementOrderMap = new WeakMap();
  Array.from(pageElement.querySelectorAll('*')).forEach((element, index) => {
    elementOrderMap.set(element, index + 1);
  });
  const orderFor = (element) => elementOrderMap.get(element) || 0;
  const parseCssZIndex = (style) => {
    const raw = String(style?.zIndex || '').trim();
    if (!raw || raw === 'auto') return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? Math.max(-100000, Math.min(100000, value)) : undefined;
  };
  const isFlexOrGridItem = (element) => {
    const parent = element?.parentElement;
    if (!parent) return false;
    return /(?:^|\\s)(?:inline-)?(?:flex|grid)(?:\\s|$)/.test(window.getComputedStyle(parent).display || '');
  };
  const createsPaintStackingContext = (element, style) => {
    if (!element || element === pageElement) return false;
    if (parseCssZIndex(style) !== undefined && (style.position !== 'static' || isFlexOrGridItem(element))) {
      return true;
    }
    if (Number(style.opacity || '1') < 1) return true;
    if (style.transform && style.transform !== 'none') return true;
    if (style.filter && style.filter !== 'none') return true;
    if (style.backdropFilter && style.backdropFilter !== 'none') return true;
    if (style.perspective && style.perspective !== 'none') return true;
    if (style.mixBlendMode && style.mixBlendMode !== 'normal') return true;
    if (style.isolation === 'isolate') return true;
    if (/(?:layout|paint|strict|content)/.test(style.contain || '')) return true;
    if (/(?:transform|opacity|filter|perspective|contents)/.test(style.willChange || '')) return true;
    return false;
  };
  const stackingKeyFor = (element) => {
    const chain = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      chain.push(current);
      if (current === pageElement) break;
      current = current.parentElement;
    }
    chain.reverse();
    const key = [{ z: 0, order: 0 }];
    for (const item of chain) {
      if (!item || item === pageElement) continue;
      const style = window.getComputedStyle(item);
      if (!createsPaintStackingContext(item, style)) continue;
      key.push({ z: parseCssZIndex(style) ?? 0, order: orderFor(item) });
    }
    const elementOrder = orderFor(element);
    if (!key.some((part) => part.order === elementOrder)) {
      key.push({ z: 0, order: elementOrder });
    }
    return {
      key,
      order: elementOrder
    };
  };
  const compareStackingOrder = (left, right) => {
    const leftKey = left?.key || [];
    const rightKey = right?.key || [];
    const maxLength = Math.max(leftKey.length, rightKey.length);
    for (let index = 0; index < maxLength; index += 1) {
      const a = leftKey[index] || { z: 0, order: 0 };
      const b = rightKey[index] || { z: 0, order: 0 };
      if (a.z !== b.z) return a.z - b.z;
      if (a.order !== b.order) return a.order - b.order;
    }
    return (left?.order || 0) - (right?.order || 0);
  };
  const effectiveOpacityFor = (element) => {
    let opacity = 1;
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const value = Number(window.getComputedStyle(current).opacity || '1');
      if (Number.isFinite(value)) opacity *= Math.max(0, Math.min(1, value));
      if (current === pageElement) break;
      current = current.parentElement;
    }
    return Math.max(0, Math.min(1, opacity));
  };
  const extractedPaintTargets = new Map();
  let extractedPaintTargetIndex = 0;
  const registerPaintTarget = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
    let id = element.getAttribute('data-pptx-paint-id');
    if (!id) {
      extractedPaintTargetIndex += 1;
      id = 'pptx-paint-' + String(extractedPaintTargetIndex);
      element.setAttribute('data-pptx-paint-id', id);
    }
    extractedPaintTargets.set(id, element);
    return id;
  };
  const computePaintOrders = () => {
    const entries = Array.from(extractedPaintTargets.entries())
      .filter(([, element]) => element && element.isConnected);
    if (entries.length === 0) return new Map();
    const ids = entries.map(([id]) => id);
    const fallback = new Map(entries.map(([id, element]) => [id, stackingKeyFor(element)]));
    const byFallback = (left, right) =>
      compareStackingOrder(fallback.get(left), fallback.get(right));
    const buildFallbackResult = () => {
      const result = new Map();
      let rank = 1;
      ids
        .slice()
        .sort(byFallback)
        .forEach((id) => {
          result.set(id, rank);
          rank += 1;
        });
      return result;
    };
    if (!document.elementsFromPoint) return buildFallbackResult();
    const edges = new Map(ids.map((id) => [id, new Set()]));
    const indegree = new Map(ids.map((id) => [id, 0]));
    const addEdge = (below, above) => {
      if (!below || !above || below === above || !edges.has(below) || !indegree.has(above)) return;
      const set = edges.get(below);
      if (set.has(above)) return;
      set.add(above);
      indegree.set(above, (indegree.get(above) || 0) + 1);
    };
    const resolvePaintId = (node) => {
      let current = node;
      while (current && current !== document && current !== document.documentElement) {
        const id = current.getAttribute?.('data-pptx-paint-id') || '';
        if (id && extractedPaintTargets.has(id)) return id;
        current = current.parentElement;
      }
      return '';
    };
    const uniqueStackIdsAt = (x, y) => {
      const seen = new Set();
      const ordered = [];
      for (const node of document.elementsFromPoint(x, y)) {
        const id = resolvePaintId(node);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ordered.push(id);
      }
      return ordered;
    };
    const samplePoints = (rect) => {
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(window.innerWidth, rect.right);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return [];
      const x1 = left + (right - left) * 0.25;
      const x2 = left + (right - left) * 0.5;
      const x3 = left + (right - left) * 0.75;
      const y1 = top + (bottom - top) * 0.25;
      const y2 = top + (bottom - top) * 0.5;
      const y3 = top + (bottom - top) * 0.75;
      return [
        [x2, y2],
        [x1, y1],
        [x3, y1],
        [x1, y3],
        [x3, y3],
        [x2, y1],
        [x2, y3],
        [x1, y2],
        [x3, y2]
      ];
    };

    const pointerStyle = document.createElement('style');
    pointerStyle.id = 'ohmyppt-paint-order-pointer-events';
    pointerStyle.textContent = '[data-pptx-paint-id] { pointer-events: auto !important; }';
    document.head.appendChild(pointerStyle);
    try {
      for (const [, element] of entries) {
        const rect = element.getBoundingClientRect();
        for (const [x, y] of samplePoints(rect)) {
          const stack = uniqueStackIdsAt(x, y);
          for (let topIndex = 0; topIndex < stack.length; topIndex += 1) {
            for (let lowerIndex = topIndex + 1; lowerIndex < stack.length; lowerIndex += 1) {
              addEdge(stack[lowerIndex], stack[topIndex]);
            }
          }
        }
      }
    } finally {
      pointerStyle.remove();
    }

    const queue = ids.filter((id) => (indegree.get(id) || 0) === 0).sort(byFallback);
    const result = new Map();
    let rank = 1;
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || result.has(id)) continue;
      result.set(id, rank);
      rank += 1;
      for (const above of edges.get(id) || []) {
        indegree.set(above, Math.max(0, (indegree.get(above) || 0) - 1));
        if ((indegree.get(above) || 0) === 0) {
          queue.push(above);
          queue.sort(byFallback);
        }
      }
    }
    ids
      .filter((id) => !result.has(id))
      .sort(byFallback)
      .forEach((id) => {
        result.set(id, rank);
        rank += 1;
      });
    return result;
  };
  const applyPaintOrders = (items) => {
    const paintOrders = computePaintOrders();
    items.forEach((item) => {
      if (!item || !item.paintId) return;
      if (paintOrders.has(item.paintId)) {
        item.order = paintOrders.get(item.paintId);
      }
      delete item.paintId;
    });
  };
  const splitCssShadowList = (value) => {
    const parts = [];
    let current = '';
    let depth = 0;
    for (const char of String(value || '')) {
      if (char === '(') depth += 1;
      else if (char === ')') depth = Math.max(0, depth - 1);
      if (char === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  };
  const tailwindRingWidthPxMap = new Map([
    ['ring', 3],
    ['ring-0', 0],
    ['ring-1', 1],
    ['ring-2', 2],
    ['ring-4', 4],
    ['ring-8', 8]
  ]);
  const tailwindBorderWidthPxMap = new Map([
    ['border', 1],
    ['border-0', 0],
    ['border-2', 2],
    ['border-4', 4],
    ['border-8', 8]
  ]);
  const tailwindRadiusPxMap = new Map([
    ['rounded-none', 0],
    ['rounded-sm', 2],
    ['rounded', 4],
    ['rounded-md', 6],
    ['rounded-lg', 8],
    ['rounded-xl', 12],
    ['rounded-2xl', 16],
    ['rounded-3xl', 24]
  ]);
  const tailwindFontWeightMap = new Map([
    ['font-thin', 100],
    ['font-extralight', 200],
    ['font-light', 300],
    ['font-normal', 400],
    ['font-medium', 500],
    ['font-semibold', 600],
    ['font-bold', 700],
    ['font-extrabold', 800],
    ['font-black', 900]
  ]);
  const tailwindNamedColorMap = new Map([
    ['black', '#000000'],
    ['white', '#FFFFFF'],
    ['transparent', 'rgba(0, 0, 0, 0)']
  ]);
  const tailwindColorShades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
  const tailwindColorPaletteMap = new Map(Object.entries({
    slate: ['#F8FAFC', '#F1F5F9', '#E2E8F0', '#CBD5E1', '#94A3B8', '#64748B', '#475569', '#334155', '#1E293B', '#0F172A', '#020617'],
    gray: ['#F9FAFB', '#F3F4F6', '#E5E7EB', '#D1D5DB', '#9CA3AF', '#6B7280', '#4B5563', '#374151', '#1F2937', '#111827', '#030712'],
    zinc: ['#FAFAFA', '#F4F4F5', '#E4E4E7', '#D4D4D8', '#A1A1AA', '#71717A', '#52525B', '#3F3F46', '#27272A', '#18181B', '#09090B'],
    neutral: ['#FAFAFA', '#F5F5F5', '#E5E5E5', '#D4D4D4', '#A3A3A3', '#737373', '#525252', '#404040', '#262626', '#171717', '#0A0A0A'],
    stone: ['#FAFAF9', '#F5F5F4', '#E7E5E4', '#D6D3D1', '#A8A29E', '#78716C', '#57534E', '#44403C', '#292524', '#1C1917', '#0C0A09'],
    red: ['#FEF2F2', '#FEE2E2', '#FECACA', '#FCA5A5', '#F87171', '#EF4444', '#DC2626', '#B91C1C', '#991B1B', '#7F1D1D', '#450A0A'],
    orange: ['#FFF7ED', '#FFEDD5', '#FED7AA', '#FDBA74', '#FB923C', '#F97316', '#EA580C', '#C2410C', '#9A3412', '#7C2D12', '#431407'],
    amber: ['#FFFBEB', '#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24', '#F59E0B', '#D97706', '#B45309', '#92400E', '#78350F', '#451A03'],
    yellow: ['#FEFCE8', '#FEF9C3', '#FEF08A', '#FDE047', '#FACC15', '#EAB308', '#CA8A04', '#A16207', '#854D0E', '#713F12', '#422006'],
    lime: ['#F7FEE7', '#ECFCCB', '#D9F99D', '#BEF264', '#A3E635', '#84CC16', '#65A30D', '#4D7C0F', '#3F6212', '#365314', '#1A2E05'],
    green: ['#F0FDF4', '#DCFCE7', '#BBF7D0', '#86EFAC', '#4ADE80', '#22C55E', '#16A34A', '#15803D', '#166534', '#14532D', '#052E16'],
    emerald: ['#ECFDF5', '#D1FAE5', '#A7F3D0', '#6EE7B7', '#34D399', '#10B981', '#059669', '#047857', '#065F46', '#064E3B', '#022C22'],
    teal: ['#F0FDFA', '#CCFBF1', '#99F6E4', '#5EEAD4', '#2DD4BF', '#14B8A6', '#0D9488', '#0F766E', '#115E59', '#134E4A', '#042F2E'],
    cyan: ['#ECFEFF', '#CFFAFE', '#A5F3FC', '#67E8F9', '#22D3EE', '#06B6D4', '#0891B2', '#0E7490', '#155E75', '#164E63', '#083344'],
    sky: ['#F0F9FF', '#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0EA5E9', '#0284C7', '#0369A1', '#075985', '#0C4A6E', '#082F49'],
    blue: ['#EFF6FF', '#DBEAFE', '#BFDBFE', '#93C5FD', '#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8', '#1E40AF', '#1E3A8A', '#172554'],
    indigo: ['#EEF2FF', '#E0E7FF', '#C7D2FE', '#A5B4FC', '#818CF8', '#6366F1', '#4F46E5', '#4338CA', '#3730A3', '#312E81', '#1E1B4B'],
    violet: ['#F5F3FF', '#EDE9FE', '#DDD6FE', '#C4B5FD', '#A78BFA', '#8B5CF6', '#7C3AED', '#6D28D9', '#5B21B6', '#4C1D95', '#2E1065'],
    purple: ['#FAF5FF', '#F3E8FF', '#E9D5FF', '#D8B4FE', '#C084FC', '#A855F7', '#9333EA', '#7E22CE', '#6B21A8', '#581C87', '#3B0764'],
    fuchsia: ['#FDF4FF', '#FAE8FF', '#F5D0FE', '#F0ABFC', '#E879F9', '#D946EF', '#C026D3', '#A21CAF', '#86198F', '#701A75', '#4A044E'],
    pink: ['#FDF2F8', '#FCE7F3', '#FBCFE8', '#F9A8D4', '#F472B6', '#EC4899', '#DB2777', '#BE185D', '#9D174D', '#831843', '#500724'],
    rose: ['#FFF1F2', '#FFE4E6', '#FECDD3', '#FDA4AF', '#FB7185', '#F43F5E', '#E11D48', '#BE123C', '#9F1239', '#881337', '#4C0519']
  }));
  const tailwindUtilityName = (className) => {
    const raw = String(className || '').trim();
    if (!raw) return '';
    const parts = raw.split(':');
    return parts[parts.length - 1] || raw;
  };
  const parseTailwindOpacity = (value) => {
    const raw = String(value || '').replace(/^\\[|\\]$/g, '').trim();
    if (!raw) return undefined;
    const number = Number.parseFloat(raw);
    if (!Number.isFinite(number)) return undefined;
    return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
  };
  const hexToRgbaSource = (hex, opacity) => {
    const raw = String(hex || '').trim().replace(/^#/, '');
    const normalized = raw.length === 3
      ? raw.split('').map((char) => char + char).join('')
      : raw.slice(0, 6);
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return hex;
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + opacity + ')';
  };
  const resolveTailwindColorToken = (name) => {
    if (tailwindNamedColorMap.has(name)) return tailwindNamedColorMap.get(name);
    const match = String(name || '').match(/^([a-z]+)-(50|100|200|300|400|500|600|700|800|900|950)$/);
    if (!match) return '';
    const palette = tailwindColorPaletteMap.get(match[1]);
    const shadeIndex = tailwindColorShades.indexOf(match[2]);
    return palette && shadeIndex >= 0 ? palette[shadeIndex] : '';
  };
  const parseTailwindColorUtility = (utility, prefix) => {
    let colorToken = '';
    let opacityToken = '';
    const arbitraryPrefix = prefix + '-[';
    if (utility.startsWith(arbitraryPrefix)) {
      const closeIndex = utility.indexOf(']');
      if (closeIndex < 0) return null;
      colorToken = utility.slice(arbitraryPrefix.length, closeIndex);
      opacityToken = utility.slice(closeIndex + 1).startsWith('/')
        ? utility.slice(closeIndex + 2)
        : '';
    } else if (utility.startsWith(prefix + '-')) {
      const raw = utility.slice(prefix.length + 1);
      const slashIndex = raw.indexOf('/');
      const name = slashIndex >= 0 ? raw.slice(0, slashIndex) : raw;
      colorToken = resolveTailwindColorToken(name);
      opacityToken = slashIndex >= 0 ? raw.slice(slashIndex + 1) : '';
    }
    if (!colorToken || /^-?\\d/.test(colorToken) || /px\\]?$/.test(colorToken)) return null;
    const opacity = parseTailwindOpacity(opacityToken);
    if (opacity !== undefined && colorToken.startsWith('#')) {
      return hexToRgbaSource(colorToken, opacity);
    }
    return colorToken;
  };
  const parseTailwindRingColor = (utility) => parseTailwindColorUtility(utility, 'ring');
  const parseTailwindBorderColor = (utility) => parseTailwindColorUtility(utility, 'border');
  const parseTailwindBackgroundColor = (utility) => parseTailwindColorUtility(utility, 'bg');
  const parseTailwindRingWidth = (utility) => {
    if (tailwindRingWidthPxMap.has(utility)) return tailwindRingWidthPxMap.get(utility);
    const arbitrary = utility.match(/^ring-\\[(-?\\d*\\.?\\d+)px\\]$/);
    if (!arbitrary) return undefined;
    const value = Number.parseFloat(arbitrary[1]);
    return Number.isFinite(value) ? Math.max(0, value) : undefined;
  };
  const parseTailwindBorderWidth = (utility) => {
    if (tailwindBorderWidthPxMap.has(utility)) return tailwindBorderWidthPxMap.get(utility);
    const arbitrary = utility.match(/^border-\\[(-?\\d*\\.?\\d+)px\\]$/);
    if (!arbitrary) return undefined;
    const value = Number.parseFloat(arbitrary[1]);
    return Number.isFinite(value) ? Math.max(0, value) : undefined;
  };
  const parseTailwindBorderSideWidth = (utility) => {
    const match = String(utility || '').match(/^border-([trblxy])(?:-(0|2|4|8|\\[(-?\\d*\\.?\\d+)px\\]))?$/);
    if (!match) return null;
    const sideKey = match[1];
    const widthToken = match[2];
    const arbitraryValue = match[3];
    const width = arbitraryValue !== undefined
      ? Number.parseFloat(arbitraryValue)
      : widthToken
        ? Number.parseFloat(widthToken)
        : 1;
    // Keep 0 as an explicit side override; collectBorderSides consumes it by removing that side.
    if (!Number.isFinite(width) || width < 0) return null;
    const sides =
      sideKey === 'x' ? ['left', 'right'] :
      sideKey === 'y' ? ['top', 'bottom'] :
      sideKey === 't' ? ['top'] :
      sideKey === 'r' ? ['right'] :
      sideKey === 'b' ? ['bottom'] :
      ['left'];
    return { sides, width };
  };
  const parseTailwindBorderSideColor = (utility) => {
    const match = String(utility || '').match(/^border-([trblxy])-(.+)$/);
    if (!match) return null;
    const value = match[2];
    if (/^(?:0|2|4|8|\\[-?\\d*\\.?\\d+px\\])$/.test(value)) return null;
    const colorSource = parseTailwindBorderColor('border-' + value);
    if (!colorSource) return null;
    const sideKey = match[1];
    const sides =
      sideKey === 'x' ? ['left', 'right'] :
      sideKey === 'y' ? ['top', 'bottom'] :
      sideKey === 't' ? ['top'] :
      sideKey === 'r' ? ['right'] :
      sideKey === 'b' ? ['bottom'] :
      ['left'];
    return { sides, colorSource };
  };
  const parseTailwindRadius = (utility) => {
    if (utility === 'rounded-full') return { full: true };
    if (tailwindRadiusPxMap.has(utility)) return { px: tailwindRadiusPxMap.get(utility) };
    const arbitrary = utility.match(/^rounded-\\[(-?\\d*\\.?\\d+)px\\]$/);
    if (!arbitrary) return null;
    const value = Number.parseFloat(arbitrary[1]);
    return Number.isFinite(value) ? { px: Math.max(0, value) } : null;
  };
  const parseTailwindFontWeight = (utility) => {
    if (tailwindFontWeightMap.has(utility)) return tailwindFontWeightMap.get(utility);
    const arbitrary = utility.match(/^font-\\[([1-9]\\d{0,2})\\]$/);
    if (!arbitrary) return undefined;
    const value = Number.parseInt(arbitrary[1], 10);
    return Number.isFinite(value) ? Math.max(1, Math.min(1000, value)) : undefined;
  };
  const resolveTailwindFontWeight = (element) => {
    const classNames = String(element?.className || '').split(/\\s+/).filter(Boolean);
    let fontWeight;
    for (const className of classNames) {
      const weight = parseTailwindFontWeight(tailwindUtilityName(className));
      if (weight !== undefined) fontWeight = weight;
    }
    return fontWeight;
  };
  const resolveComputedFontWeight = (style) => {
    const raw = String(style.fontWeight || '').trim().toLowerCase();
    if (!raw) return undefined;
    if (raw === 'normal') return 400;
    if (raw === 'bold') return 700;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const resolveInlineFontWeight = (element) => {
    const raw = element?.style?.fontWeight;
    if (!raw) return undefined;
    return resolveComputedFontWeight({ fontWeight: raw });
  };
  const normalizeRunText = (value) =>
    String(value || '')
      .replace(/\\s+/g, ' ')
      .replace(/[\\u200b-\\u200d\\ufeff]/g, '');
  const textRunFor = (text, style, element) => {
    const runText = normalizeRunText(text);
    if (!runText) return null;
    const fontSizePx = Number.parseFloat(style.fontSize || '16') || 16;
    const inlineFontWeight = resolveInlineFontWeight(element);
    const tailwindFontWeight = resolveTailwindFontWeight(element);
    const computedFontWeight = resolveComputedFontWeight(style);
    const fontWeight = inlineFontWeight || tailwindFontWeight || computedFontWeight || 400;
    const fontFace = String(style.fontFamily || 'Aptos').split(',')[0].replace(/["']/g, '').trim() || 'Aptos';
    const textPaint = resolveTextPaint(style);
    return {
      text: runText,
      fontSize: Math.max(6, Math.min(${MAX_EXPORT_FONT_SIZE_PT}, fontSizePx * pointsPerPx)),
      fontFace,
      color: textPaint.color,
      bold: fontWeight >= 600 || /^H[1-6]$/i.test(element?.tagName || ''),
      italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
      underline: String(style.textDecoration || '').includes('underline'),
      strike: String(style.textDecoration || '').includes('line-through')
    };
  };
  const trimRunEdges = (runs) => {
    while (runs.length > 0) {
      runs[0].text = String(runs[0].text || '').trimStart();
      if (runs[0].text) break;
      runs.shift();
    }
    while (runs.length > 0) {
      const last = runs[runs.length - 1];
      last.text = String(last.text || '').trimEnd();
      if (last.text) break;
      runs.pop();
    }
    return runs.filter((run) => run.text);
  };
  const sameTextRunStyle = (left, right) =>
    left &&
    right &&
    left.fontSize === right.fontSize &&
    left.fontFace === right.fontFace &&
    left.color === right.color &&
    Boolean(left.bold) === Boolean(right.bold) &&
    Boolean(left.italic) === Boolean(right.italic) &&
    Boolean(left.underline) === Boolean(right.underline) &&
    Boolean(left.strike) === Boolean(right.strike);
  const collectInlineTextRuns = (element, baseStyle) => {
    if (!element || isVerticalWritingMode(baseStyle)) return undefined;
    const runs = [];
    const visit = (node, inheritedElement, inheritedStyle) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const run = textRunFor(node.textContent, inheritedStyle, inheritedElement);
        if (run) runs.push(run);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const child = node;
      if (child.closest?.('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml, [data-pptx-formula-block]')) return;
      const childStyle = window.getComputedStyle(child);
      child.childNodes.forEach((next) => visit(next, child, childStyle));
    };
    element.childNodes.forEach((child) => visit(child, element, baseStyle));
    trimRunEdges(runs);
    if (runs.length === 0) return undefined;
    const combinedText = normalize(runs.map((run) => run.text).join(''));
    const elementText = normalize(element.innerText || element.textContent);
    if (!combinedText || combinedText !== elementText) return undefined;
    const baseRun = textRunFor(elementText, baseStyle, element);
    const hasStyledRun = runs.some((run) => !sameTextRunStyle(run, baseRun));
    return hasStyledRun ? runs : undefined;
  };
  const appendTextRun = (runs, run) => {
    if (!run || !run.text) return;
    const last = runs[runs.length - 1];
    if (sameTextRunStyle(last, run)) {
      last.text += run.text;
    } else {
      runs.push({ ...run });
    }
  };
  const collectInlineTextLineRuns = (element, baseStyle) => {
    if (!element || isVerticalWritingMode(baseStyle)) return [];
    const sourceText = normalize(element.innerText || element.textContent);
    if (!sourceText || sourceText.length > maxPreciseLineRunChars) return [];
    const groups = [];
    let activeGroup = null;
    const visit = (node, inheritedElement, inheritedStyle) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const source = String(node.textContent || '');
        for (let offset = 0; offset < source.length; offset += 1) {
          const char = source[offset];
          if (!char) continue;
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const charRect = range.getBoundingClientRect();
          range.detach();
          if (charRect.width < 0.5 || charRect.height < 0.5) {
            if (activeGroup && /\\s/.test(char)) {
              appendTextRun(activeGroup.runs, textRunFor(char, inheritedStyle, inheritedElement));
              activeGroup.text += char;
            }
            continue;
          }
          let group = groups.find((item) => Math.abs(item.top - charRect.top) < Math.max(3, charRect.height * 0.3));
          if (!group) {
            group = {
              top: charRect.top,
              left: charRect.left,
              right: charRect.right,
              bottom: charRect.bottom,
              text: '',
              runs: []
            };
            groups.push(group);
          }
          appendTextRun(group.runs, textRunFor(char, inheritedStyle, inheritedElement));
          group.text += char;
          group.left = Math.min(group.left, charRect.left);
          group.right = Math.max(group.right, charRect.right);
          group.bottom = Math.max(group.bottom, charRect.bottom);
          activeGroup = group;
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const child = node;
      if (child.closest?.('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml, [data-pptx-formula-block]')) return;
      const childStyle = window.getComputedStyle(child);
      child.childNodes.forEach((next) => visit(next, child, childStyle));
    };
    element.childNodes.forEach((child) => visit(child, element, baseStyle));
    const lineRuns = groups
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map((group) => {
        trimRunEdges(group.runs);
        const text = normalize(group.runs.map((run) => run.text).join(''));
        if (!text) return null;
        return {
          text,
          rect: {
            left: group.left,
            top: group.top,
            right: group.right,
            bottom: group.bottom,
            width: group.right - group.left,
            height: group.bottom - group.top
          },
          runs: group.runs
        };
      })
      .filter(Boolean);
    const combinedText = normalize(lineRuns.map((line) => line.text).join(''));
    return combinedText === sourceText ? lineRuns : [];
  };
  const resolveTailwindVisualHints = (element) => {
    const hints = {
      ringWidthPx: undefined,
      ringColorSource: '',
      ringInset: false,
      borderWidthPx: undefined,
      borderSideWidthPx: {
        left: undefined,
        top: undefined,
        right: undefined,
        bottom: undefined
      },
      borderSideColorSource: {
        left: '',
        top: '',
        right: '',
        bottom: ''
      },
      borderColorSource: '',
      borderDash: undefined,
      backgroundColorSource: '',
      radiusPx: undefined,
      radiusFull: false
    };
    const classNames = String(element?.className || '').split(/\\s+/).filter(Boolean);
    for (const className of classNames) {
      const utility = tailwindUtilityName(className);
      if (utility === 'ring-inset') {
        hints.ringInset = true;
        continue;
      }
      if (utility === 'border-dashed' || utility === 'border-dotted') hints.borderDash = 'dash';
      else if (utility === 'border-solid') hints.borderDash = 'solid';
      const ringWidth = parseTailwindRingWidth(utility);
      if (ringWidth !== undefined) hints.ringWidthPx = ringWidth;
      const ringColor = parseTailwindRingColor(utility);
      if (ringColor) hints.ringColorSource = ringColor;
      const borderWidth = parseTailwindBorderWidth(utility);
      if (borderWidth !== undefined) hints.borderWidthPx = borderWidth;
      const borderSideWidth = parseTailwindBorderSideWidth(utility);
      if (borderSideWidth) {
        borderSideWidth.sides.forEach((side) => {
          hints.borderSideWidthPx[side] = borderSideWidth.width;
        });
      }
      const borderSideColor = parseTailwindBorderSideColor(utility);
      if (borderSideColor) {
        borderSideColor.sides.forEach((side) => {
          hints.borderSideColorSource[side] = borderSideColor.colorSource;
        });
      }
      const borderColor = parseTailwindBorderColor(utility);
      if (borderColor) hints.borderColorSource = borderColor;
      const backgroundColor = parseTailwindBackgroundColor(utility);
      if (backgroundColor) hints.backgroundColorSource = backgroundColor;
      const radius = parseTailwindRadius(utility);
      if (radius?.full) hints.radiusFull = true;
      else if (radius?.px !== undefined) hints.radiusPx = radius.px;
    }
    return hints;
  };
  const resolveRingShadow = (style, opacity, tailwindHints) => {
    let best = null;
    if (style.boxShadow && style.boxShadow !== 'none') {
      for (const shadow of splitCssShadowList(style.boxShadow)) {
        if (/\\binset\\b/i.test(shadow)) continue;
        const colorMatch = shadow.match(/rgba?\\([^)]*\\)|#[0-9a-fa-f]{3,8}/i);
        if (!colorMatch) continue;
        const colorSource = colorMatch[0];
        const color = rgbToHex(colorSource);
        if (!color || parseAlpha(colorSource) * opacity < 0.04) continue;
        const lengths = shadow
          .replace(colorSource, ' ')
          .match(/-?\\d*\\.?\\d+(?:px)?/g)
          ?.map((part) => Number.parseFloat(part)) || [];
        if (lengths.length < 4) continue;
        const [offsetX, offsetY, blur, spread] = lengths;
        if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5 || Math.abs(blur) > 0.5) continue;
        if (!Number.isFinite(spread) || spread <= 0.5) continue;
        if (!best || spread > best.w) best = { w: spread, c: color, colorSource };
      }
    }
    if (tailwindHints?.ringInset) return best;
    if (tailwindHints?.ringWidthPx > 0) {
      const colorSource = tailwindHints.ringColorSource || best?.colorSource || 'rgba(59, 130, 246, 0.5)';
      const color = rgbToHex(colorSource);
      if (color && parseAlpha(colorSource) * opacity >= 0.04) {
        const hintedRing = { w: tailwindHints.ringWidthPx, c: color, colorSource };
        if (!best || hintedRing.w > best.w) return hintedRing;
      }
    }
    return best;
  };

  // ========== Shapes: skip consumed table elements ==========
  const shapeNodes = Array.from(pageElement.querySelectorAll('section,main,article,header,footer,aside,div,figure,figcaption,table,td,th,span'));
  const shapes = [];
  const minShapeArea = layoutWidthPx * layoutHeightPx * 0.005;
  for (const element of shapeNodes) {
    if (shapes.length >= maxShapes) continue;
    // Skip table elements that have been consumed by table extraction
    if (isInsideConsumedTable(element)) continue;
    const style = window.getComputedStyle(element);
    const { rect, x, y, w, h } = elementToBox(element);
    if (!isVisible(element, style, rect)) continue;
    // Skip decorative blur blobs - cannot be faithfully rendered in PPTX
    if (/blur/i.test(style.filter || '')) continue;
    // Skip elements with CSS background-image (gradients, URL images, etc.)
    // Their full visual is captured in the background screenshot — extracting
    // as a shape would cause double-rendering or color mismatch.
    const bgImage = (style.backgroundImage || '').trim();
    if (bgImage && bgImage !== 'none') continue;
    const opacity = Number(style.opacity || '1');
    if (opacity < 0.15) continue;
    const tailwindVisualHints = resolveTailwindVisualHints(element);
    const fillSource = rgbToHex(style.backgroundColor)
      ? style.backgroundColor
      : tailwindVisualHints.backgroundColorSource;
    const fill = rgbToHex(fillSource);
    // Check per-side border: Tailwind border-l-4 / border-b-2 set one side only,
    // while style.borderColor / style.borderWidth may not reflect it.
    const collectBorderSides = () => {
      const sides = [
        { side: 'left', w: style.borderLeftWidth, c: style.borderLeftColor, s: style.borderLeftStyle },
        { side: 'top', w: style.borderTopWidth, c: style.borderTopColor, s: style.borderTopStyle },
        { side: 'right', w: style.borderRightWidth, c: style.borderRightColor, s: style.borderRightStyle },
        { side: 'bottom', w: style.borderBottomWidth, c: style.borderBottomColor, s: style.borderBottomStyle }
      ];
      const visibleSides = [];
      const upsertSide = (sideInfo, force = false) => {
        const existingIndex = visibleSides.findIndex((side) => side.side === sideInfo.side);
        if (existingIndex >= 0) {
          if (force) visibleSides[existingIndex] = sideInfo;
          return;
        }
        visibleSides.push(sideInfo);
      };
      const removeSide = (sideName) => {
        const existingIndex = visibleSides.findIndex((side) => side.side === sideName);
        if (existingIndex >= 0) visibleSides.splice(existingIndex, 1);
      };
      for (const side of sides) {
        const w = Number.parseFloat(side.w || '0') || 0;
        if (w <= 0 || side.s === 'none') continue;
        const c = rgbToHex(side.c);
        if (!c) continue;
        upsertSide({
          side: side.side,
          w,
          c,
          colorSource: side.c,
          dash: side.s === 'dashed' || side.s === 'dotted' ? 'dash' : 'solid'
        });
      }
      if (tailwindVisualHints.borderWidthPx > 0) {
        const colorSource =
          tailwindVisualHints.borderColorSource ||
          style.borderColor ||
          'rgba(229, 231, 235, 1)';
        const color = rgbToHex(colorSource);
        if (color && parseAlpha(colorSource) * opacity >= 0.04) {
          for (const sideName of ['left', 'top', 'right', 'bottom']) {
            upsertSide({
              side: sideName,
              w: tailwindVisualHints.borderWidthPx,
              c: color,
              colorSource,
              dash: tailwindVisualHints.borderDash || 'solid'
            }, true);
          }
        }
      }
      for (const sideName of ['left', 'top', 'right', 'bottom']) {
        const hintedWidth = tailwindVisualHints.borderSideWidthPx?.[sideName];
        const hintedColorSource = tailwindVisualHints.borderSideColorSource?.[sideName];
        if (hintedWidth === undefined && !hintedColorSource) continue;
        if (hintedWidth !== undefined && hintedWidth <= 0) {
          removeSide(sideName);
          continue;
        }
        const existingSide = visibleSides.find((side) => side.side === sideName);
        const width = hintedWidth > 0 ? hintedWidth : existingSide?.w;
        if (!(width > 0)) continue;
        const colorSource =
          hintedColorSource ||
          existingSide?.colorSource ||
          tailwindVisualHints.borderColorSource ||
          style.borderColor ||
          'rgba(229, 231, 235, 1)';
        const color = rgbToHex(colorSource);
        if (!color || parseAlpha(colorSource) * opacity < 0.04) continue;
        upsertSide({
          side: sideName,
          w: width,
          c: color,
          colorSource,
          dash: existingSide?.dash || tailwindVisualHints.borderDash || 'solid'
        }, true);
      }
      return visibleSides;
    };
    const borderSides = collectBorderSides();
    const resolveBorder = () => {
      let best = null;
      for (const side of borderSides) {
        if (!best || side.w > best.w) best = side;
      }
      if (tailwindVisualHints.borderWidthPx > 0) {
        const colorSource =
          tailwindVisualHints.borderColorSource ||
          best?.colorSource ||
          style.borderColor ||
          'rgba(229, 231, 235, 1)';
        const color = rgbToHex(colorSource);
        if (color && parseAlpha(colorSource) * opacity >= 0.04) {
          const hintedBorder = {
            w: tailwindVisualHints.borderWidthPx,
            c: color,
            colorSource,
            dash: tailwindVisualHints.borderDash || 'solid'
          };
          if (!best || hintedBorder.w > best.w) best = hintedBorder;
        }
      }
      const ring = resolveRingShadow(style, opacity, tailwindVisualHints);
      if (ring && (!best || ring.w > best.w)) return { ...ring, dash: 'solid' };
      return best;
    };
    const borderInfo = resolveBorder();
    const sameBorderSide = (left, right) =>
      left &&
      right &&
      left.c === right.c &&
      left.dash === right.dash &&
      Math.abs(left.w - right.w) < 0.1 &&
      Math.abs(transparencyFor(left.colorSource, opacity) - transparencyFor(right.colorSource, opacity)) <= 1;
    const hasUniformFourSideBorder =
      borderSides.length === 4 &&
      borderSides.every((side) => sameBorderSide(side, borderSides[0]));
    const shouldSplitBorderSides =
      borderSides.length > 0 && !hasUniformFourSideBorder && !tailwindVisualHints.ringWidthPx;
    const mainBorderInfo = shouldSplitBorderSides ? null : borderInfo;
    const borderColor = mainBorderInfo ? mainBorderInfo.c : '';
    const borderWidth = mainBorderInfo ? mainBorderInfo.w : 0;
    const hasBorder = Boolean(borderInfo);
    const hasMainBorder = Boolean(mainBorderInfo);
    const minSide = Math.min(rect.width, rect.height);
    const computedRadius = Number.parseFloat(style.borderTopLeftRadius || style.borderRadius || '0') || 0;
    const radius = computedRadius || (tailwindVisualHints.radiusFull
      ? minSide / 2
      : tailwindVisualHints.radiusPx || 0);
    const hasShadow = Boolean(style.boxShadow && style.boxShadow !== 'none');
    const buildBorderLineShape = (borderSide) => {
      if (!borderSide) return null;
      const minLineSize = 0.001;
      let lineX = x;
      let lineY = y;
      let lineW = w;
      let lineH = minLineSize;
      if (borderSide.side === 'bottom') {
        lineY = pxToInY(rect.bottom - borderSide.w / 2);
      } else if (borderSide.side === 'top') {
        lineY = pxToInY(rect.top + borderSide.w / 2);
      } else if (borderSide.side === 'right') {
        lineX = pxToInX(rect.right - borderSide.w / 2);
        lineW = minLineSize;
        lineH = h;
      } else {
        lineX = pxToInX(rect.left + borderSide.w / 2);
        lineW = minLineSize;
        lineH = h;
      }
      return {
        x: lineX,
        y: lineY,
        w: Math.max(minLineSize, lineW),
        h: Math.max(minLineSize, lineH),
        order: orderFor(element),
        paintId: registerPaintTarget(element),
        fill: undefined,
        transparency: 100,
        shapeType: 'line',
        rotate: parseRotate(style),
        border: {
          color: borderSide.c,
          widthPt: borderSide.w * 0.75,
          transparency: transparencyFor(borderSide.colorSource, opacity),
          dash: borderSide.dash || 'solid'
        }
      };
    };
    const isBorderOnlyElement = !fill && !radius && !hasShadow;
    const hasCornerBorderSides = (first, second) => {
      const sideNames = borderSides.map((side) => side.side).sort().join('|');
      return sideNames === [first, second].sort().join('|');
    };
    const isCssChevronBorder =
      isBorderOnlyElement &&
      borderSides.length === 2 &&
      parseRotate(style) !== undefined &&
      rect.width <= 42 &&
      rect.height <= 42 &&
      (
        hasCornerBorderSides('top', 'right') ||
        hasCornerBorderSides('right', 'bottom') ||
        hasCornerBorderSides('bottom', 'left') ||
        hasCornerBorderSides('left', 'top')
      );
    const buildCssChevronLineShapes = () => {
      if (!isCssChevronBorder) return [];
      const lineStyle = borderSides[0];
      if (!lineStyle) return [];
      // The source CSS is a small rotated border corner. These fractions rebuild
      // the visible chevron inside its transformed bounding box as two PPT lines.
      const left = rect.left + rect.width * 0.18;
      const top = rect.top + rect.height * 0.18;
      const lineWidth = rect.width * 0.58;
      const lineHeight = rect.height * 0.32;
      const common = {
        order: orderFor(element),
        paintId: registerPaintTarget(element),
        fill: undefined,
        transparency: 100,
        shapeType: 'line',
        border: {
          color: lineStyle.c,
          widthPt: lineStyle.w * 0.75,
          transparency: transparencyFor(lineStyle.colorSource, opacity),
          dash: lineStyle.dash || 'solid'
        }
      };
      return [
        {
          ...common,
          x: pxToInX(left),
          y: pxToInY(top),
          w: Math.max(0.001, sizeToInX(lineWidth)),
          h: Math.max(0.001, sizeToInY(lineHeight))
        },
        {
          ...common,
          x: pxToInX(left),
          y: pxToInY(top + rect.height * 0.32),
          w: Math.max(0.001, sizeToInX(lineWidth)),
          h: Math.max(0.001, sizeToInY(lineHeight)),
          flipV: true
        }
      ];
    };
    const cssChevronLineShapes = buildCssChevronLineShapes();
    if (cssChevronLineShapes.length > 0) {
      if (shapes.length + cssChevronLineShapes.length > maxShapes) continue;
      cssChevronLineShapes.forEach((shape) => shapes.push(shape));
      element.setAttribute('data-pptx-extracted-shape', '1');
      continue;
    }
    const splitBorderLineShapes = shouldSplitBorderSides
      ? borderSides.map((side) => buildBorderLineShape(side)).filter(Boolean)
      : [];
    const shouldExportOnlyBorderLines =
      splitBorderLineShapes.length > 0 && isBorderOnlyElement;
    if (shouldExportOnlyBorderLines) {
      if (shapes.length + splitBorderLineShapes.length > maxShapes) continue;
      splitBorderLineShapes.forEach((shape) => shapes.push(shape));
      element.setAttribute('data-pptx-extracted-shape', '1');
      continue;
    }
    // Skip elements with no visual distinction.
    // BUT keep elements with rounded corners or box-shadow (e.g. cards with bg-white
    // that visually stand out from the page root background).
    if ((!fill || (fill === backgroundColor && !radius && !hasShadow)) && !hasBorder) continue;
    // Skip small elements, BUT keep small badges/buttons (colored fill + radius/shadow)
    // e.g. timeline year circles (48x48px with bg color + rounded-full + shadow-md)
    const isSmallBadge = fill && fill !== backgroundColor && (radius > 0 || hasShadow);
    const parentDisplay = element.parentElement
      ? String(window.getComputedStyle(element.parentElement).display || '')
      : '';
    const isGridPaintCell =
      fill &&
      fill !== backgroundColor &&
      !hasBorder &&
      !radius &&
      !hasShadow &&
      /grid/i.test(parentDisplay) &&
      !normalize(element.innerText || element.textContent) &&
      rect.width >= 8 &&
      rect.height >= 8;
    const isThinPaintStrip =
      fill &&
      fill !== backgroundColor &&
      !radius &&
      !hasShadow &&
      !normalize(element.innerText || element.textContent) &&
      (
        (rect.width >= 24 && rect.height >= 2 && rect.height < 12) ||
        (rect.height >= 24 && rect.width >= 2 && rect.width < 12)
      );
    if (!hasBorder && !isSmallBadge && !isGridPaintCell && rect.width * rect.height < minShapeArea) continue;
    if ((rect.width < 12 || rect.height < 12) && !isThinPaintStrip) continue;
    if (shapes.length + 1 + splitBorderLineShapes.length > maxShapes) continue;
    const radiusPx = Math.max(0, Math.min(radius, minSide / 2));
    const radiusAdj = radiusPx > 0 && minSide > 0
      ? Math.max(0, Math.min(50000, Math.round((radiusPx / minSide) * 100000)))
      : 0;
    const shapeType =
      radiusPx > 0 && Math.abs(rect.width - rect.height) < 1.5 && radiusPx >= minSide / 2 - 0.5
        ? 'ellipse'
        : radiusPx > 0
          ? 'roundRect'
          : 'rect';
    shapes.push({
      x,
      y,
      w,
      h,
      order: orderFor(element),
      paintId: registerPaintTarget(element),
      fill,
      transparency: fill ? transparencyFor(fillSource, opacity) : 100,
      radius,
      radiusAdj,
      shapeType,
      rotate: parseRotate(style),
      border: hasMainBorder
        ? {
            color: borderColor,
            widthPt: borderWidth * 0.75,
            transparency: transparencyFor(mainBorderInfo.colorSource || style.borderColor, opacity),
            dash: mainBorderInfo.dash || 'solid'
          }
        : undefined
    });
    if (splitBorderLineShapes.length > 0) {
      splitBorderLineShapes.forEach((shape) => shapes.push(shape));
    }
    element.setAttribute('data-pptx-extracted-shape', '1');
  }

  // ========== Texts: skip elements inside consumed tables ==========
  const texts = [];
  const textSeen = new Set();
  const consumedTextElements = new Set();
  const maxPreciseLineRunChars = 180;
  const isInsideConsumedTextElement = (element) => {
    for (const parent of consumedTextElements) {
      if (parent.contains(element)) return true;
    }
    return false;
  };
  const textWidthIn = (x, width, fontSizePt, text, shouldWrap = false) => {
    if (shouldWrap) return Math.max(0.12, Math.min(slideWidthIn - x, width * 1.1));
    const hasCjk = /[\\u3400-\\u9fff\\uf900-\\ufaff]/.test(text);
    const factor = hasCjk ? 1.15 : 1.08;
    const padding = Math.max(0.08, Math.min(0.3, fontSizePt / 72 * 0.2));
    return Math.max(0.12, Math.min(slideWidthIn - x, width * factor + padding));
  };
  const textHeightIn = (height, fontSizePt) => {
    const padding = Math.max(0.02, Math.min(0.1, fontSizePt / 72 * 0.08));
    return Math.max(0.06, height * 1.08 + padding);
  };
  const resolveLineHeightPx = (style, fontSizePx) => {
    const lineHeight = Number.parseFloat(style.lineHeight || '');
    return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fontSizePx * 1.18;
  };
  const resolveLetterSpacingPx = (style) => {
    if (!style.letterSpacing || style.letterSpacing === 'normal') return 0;
    const letterSpacing = Number.parseFloat(style.letterSpacing);
    return Number.isFinite(letterSpacing) ? letterSpacing : 0;
  };
  const spacingPtFor = (style, property) => {
    const value = Number.parseFloat(style[property] || '0') || 0;
    return Math.max(0, Math.min(72, value * pointsPerPx));
  };
  const cssPx = (value) => {
    const parsed = Number.parseFloat(String(value || '0'));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };
  const resolveTextInsets = (style, rect) => {
    const leftPx = cssPx(style.paddingLeft) + cssPx(style.borderLeftWidth);
    const rightPx = cssPx(style.paddingRight) + cssPx(style.borderRightWidth);
    const topPx = cssPx(style.paddingTop) + cssPx(style.borderTopWidth);
    const bottomPx = cssPx(style.paddingBottom) + cssPx(style.borderBottomWidth);
    const maxX = Math.max(0, rect.width * 0.45);
    const maxY = Math.max(0, rect.height * 0.45);
    return {
      paddingLeft: sizeToInX(Math.min(leftPx, maxX)),
      paddingRight: sizeToInX(Math.min(rightPx, maxX)),
      paddingTop: sizeToInY(Math.min(topPx, maxY)),
      paddingBottom: sizeToInY(Math.min(bottomPx, maxY))
    };
  };
  const resolveTextBoxVerticalAlign = (style) => {
    const verticalAlign = String(style.verticalAlign || '');
    if (verticalAlign === 'middle') return 'middle';
    if (verticalAlign === 'bottom' || verticalAlign === 'text-bottom') return 'bottom';
    const display = String(style.display || '');
    if (display.includes('flex') || display.includes('grid')) {
      const flexDirection = String(style.flexDirection || 'row');
      const isColumn = /column/i.test(flexDirection);
      const isColumnReverse = /column-reverse/i.test(flexDirection);
      const verticalAxisValue = /column/i.test(flexDirection)
        ? String(style.justifyContent || '')
        : String(style.alignItems || '');
      if (verticalAxisValue === 'center') return 'middle';
      if (isColumn && (verticalAxisValue === 'start' || verticalAxisValue === 'flex-start')) {
        return isColumnReverse ? 'bottom' : 'top';
      }
      if (verticalAxisValue === 'end' || verticalAxisValue === 'flex-end') {
        return isColumnReverse ? 'top' : 'bottom';
      }
    }
    return 'top';
  };
  const resolveTextBoxAlign = (style, isVerticalText, shouldWrap) => {
    if (isVerticalText) return 'center';
    const textAlign = String(style.textAlign || '');
    if (textAlign === 'center') return 'center';
    if (textAlign === 'right' || textAlign === 'end') return 'right';
    if (shouldWrap && textAlign === 'justify') return 'justify';
    const display = String(style.display || '');
    if (display.includes('flex') || display.includes('grid')) {
      const flexDirection = String(style.flexDirection || 'row');
      const isColumn = /column/i.test(flexDirection);
      const isRowReverse = /row-reverse/i.test(flexDirection);
      const horizontalAxisValue = isColumn
        ? String(style.alignItems || '')
        : String(style.justifyContent || '');
      if (horizontalAxisValue === 'center') return 'center';
      if (!isColumn && (horizontalAxisValue === 'start' || horizontalAxisValue === 'flex-start')) {
        return isRowReverse ? 'right' : 'left';
      }
      if (
        horizontalAxisValue === 'end' ||
        horizontalAxisValue === 'flex-end' ||
        horizontalAxisValue === 'right'
      ) {
        return isRowReverse ? 'left' : 'right';
      }
    }
    return 'left';
  };
  const resolveListBullet = (element) => {
    if (!element || String(element.tagName || '').toUpperCase() !== 'LI') return undefined;
    const list = element.parentElement?.closest?.('ol,ul');
    if (!list) return undefined;
    const listStyleType = String(window.getComputedStyle(element).listStyleType || '');
    if (listStyleType === 'none') return undefined;
    let listDepth = 0;
    let current = element.parentElement;
    while (current && current !== pageElement) {
      if (current.tagName === 'OL' || current.tagName === 'UL') listDepth += 1;
      current = current.parentElement;
    }
    const level = Math.max(0, listDepth - 1);
    if (String(list.tagName || '').toUpperCase() === 'OL') {
      const value = Number.parseInt(element.getAttribute('value') || '', 10);
      if (Number.isFinite(value) && value > 0) {
        return { type: 'number', level, startAt: value };
      }
      const start = Number.parseInt(list.getAttribute('start') || '1', 10) || 1;
      const previousItems = Array.from(list.children || []).filter((child) => child.tagName === 'LI');
      const index = previousItems.indexOf(element);
      return { type: 'number', level, startAt: Math.max(1, start + Math.max(0, index)) };
    }
    return { type: 'bullet', level };
  };
  const buildCanvasFont = (style, fontSizePx) => {
    const weight = Number.parseInt(style.fontWeight || '400', 10) || 400;
    const italic = style.fontStyle === 'italic' || style.fontStyle === 'oblique' ? 'italic' : '';
    const family = String(style.fontFamily || 'Aptos').split(',')[0].replace(/["']/g, '').trim() || 'Aptos';
    const familyToken = /^[a-z0-9 -]+$/i.test(family) ? family : '"' + family.replace(/"/g, '') + '"';
    return [italic, String(weight), fontSizePx.toFixed(2) + 'px', familyToken].filter(Boolean).join(' ');
  };
  const layoutTextWithPretext = (text, rect, style) => {
    if (!pretext || !text || rect.width < 4 || rect.height < 4) return null;
    if (parseRotate(style)) return null;
    const fontSizePx = Number.parseFloat(style.fontSize || '16') || 16;
    const lineHeightPx = resolveLineHeightPx(style, fontSizePx);
    try {
      const prepared = pretext.prepareWithSegments(text, buildCanvasFont(style, fontSizePx), {
        whiteSpace: 'pre-wrap',
        letterSpacing: resolveLetterSpacingPx(style)
      });
      const result = pretext.layoutWithLines(prepared, Math.max(1, rect.width), lineHeightPx);
      if (!result?.lines?.length) return null;
      return {
        lineHeightPx,
        lines: result.lines
          .map((line, index) => {
            const lineText = normalize(String(line.text || ''));
            if (!lineText) return null;
            const lineWidth = Math.max(1, Math.min(rect.width, Number(line.width) || rect.width));
            let left = rect.left;
            if (style.textAlign === 'center') left += Math.max(0, (rect.width - lineWidth) / 2);
            else if (style.textAlign === 'right' || style.textAlign === 'end') left += Math.max(0, rect.width - lineWidth);
            return {
              text: lineText,
              rect: {
                left,
                top: rect.top + index * lineHeightPx,
                right: left + lineWidth,
                bottom: rect.top + (index + 1) * lineHeightPx,
                width: lineWidth,
                height: lineHeightPx
              }
            };
          })
          .filter(Boolean)
      };
    } catch (_error) {
      return null;
    }
  };
  const isVerticalWritingMode = (style) => /vertical/i.test(String(style.writingMode || ''));
  const normalizeVerticalText = (value) => {
    const source = normalize(value).replace(/\\s+/g, '');
    if (!source) return '';
    return Array.from(source).join('\\n');
  };
  const makeTextKey = (text, rect) =>
    [text.toLowerCase(), Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)].join('|');
  const textStyleSignature = (style) => {
    const paint = resolveTextPaint(style);
    return [
      paint.color,
      Math.round(paint.opacity * 100),
      String(style.fontSize || ''),
      String(style.fontWeight || ''),
      String(style.fontStyle || ''),
      String(style.textDecorationLine || style.textDecoration || '')
    ].join('|');
  };
  const hasDistinctVisibleTextChild = (element, parentStyle) => {
    const parentSignature = textStyleSignature(parentStyle);
    const children = Array.from(element.children || []);
    for (const child of children) {
      const text = normalize(child.innerText || child.textContent);
      if (!text || child.closest?.('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml, [data-pptx-formula-block]')) continue;
      const childStyle = window.getComputedStyle(child);
      const childRect = child.getBoundingClientRect();
      if (!isVisible(child, childStyle, childRect)) continue;
      if (textStyleSignature(childStyle) !== parentSignature) return true;
      if (hasDistinctVisibleTextChild(child, parentStyle)) return true;
    }
    return false;
  };
  const pushTextBox = (text, rect, parentStyle, parentElement, shouldWrap = false, options = {}) => {
    if (texts.length >= maxTextBoxes) return;
    text = shouldWrap ? clampBlockText(text) : clampText(text);
    if (!text) return;
    if (!isVisible(parentElement, parentStyle, rect)) return;
    if (rect.width < 2 || rect.height < 2) return;
    const isVerticalText = isVerticalWritingMode(parentStyle);
    if (isVerticalText) {
      text = normalizeVerticalText(text);
      if (!text) return;
      shouldWrap = false;
    }
    const bullet = resolveListBullet(parentElement);
    const insets = options.useElementInsets && !isVerticalText
      ? resolveTextInsets(parentStyle, rect)
      : undefined;
    const hasInsets = Boolean(
      insets &&
      (insets.paddingLeft || insets.paddingRight || insets.paddingTop || insets.paddingBottom)
    );
    const richTextRuns = Array.isArray(options.runs)
      ? options.runs.filter((run) => run && normalize(run.text))
      : undefined;
    if (shouldWrap && !isVerticalText && !bullet && !hasInsets && !richTextRuns?.length) {
      const pretextLayout = layoutTextWithPretext(text, rect, parentStyle);
      if (pretextLayout && pretextLayout.lines.length > 0) {
        pretextLayout.lines.forEach((line) => pushTextBox(line.text, line.rect, parentStyle, parentElement, false));
        return;
      }
    }
    const key = makeTextKey(text, rect);
    if (textSeen.has(key)) return;
    textSeen.add(key);
    const fontSizePx = Number.parseFloat(parentStyle.fontSize || '16') || 16;
    const fontSizePt = Math.max(6, Math.min(${MAX_EXPORT_FONT_SIZE_PT}, fontSizePx * pointsPerPx));
    const inlineFontWeight = resolveInlineFontWeight(parentElement);
    const tailwindFontWeight = resolveTailwindFontWeight(parentElement);
    const computedFontWeight = resolveComputedFontWeight(parentStyle);
    const fontWeight = inlineFontWeight || tailwindFontWeight || computedFontWeight || 400;
    const fontFace = String(parentStyle.fontFamily || 'Aptos').split(',')[0].replace(/["']/g, '').trim() || 'Aptos';
    const x = pxToInX(rect.left);
    const textPaint = resolveTextPaint(parentStyle);
    const align = resolveTextBoxAlign(parentStyle, isVerticalText, shouldWrap);
    const verticalAlign = resolveTextBoxVerticalAlign(parentStyle);
    texts.push({
      text,
      x,
      y: pxToInY(rect.top),
      w: isVerticalText
        ? Math.max(0.12, sizeToInX(rect.width) + Math.max(0.02, fontSizePt / 72 * 0.08))
        : hasInsets
          ? Math.max(0.12, Math.min(slideWidthIn - x, sizeToInX(rect.width)))
        : align !== 'left'
          ? Math.max(0.12, Math.min(slideWidthIn - x, sizeToInX(rect.width)))
          : textWidthIn(x, sizeToInX(rect.width), fontSizePt, text, shouldWrap),
      h: isVerticalText
        ? Math.max(0.12, sizeToInY(rect.height))
        : hasInsets
          ? Math.max(0.08, sizeToInY(rect.height))
        : shouldWrap
        ? Math.max(0.12, sizeToInY(rect.height) + Math.max(0.02, fontSizePt / 72 * 0.08))
        : verticalAlign !== 'top'
          ? Math.max(0.08, sizeToInY(rect.height))
          : textHeightIn(sizeToInY(rect.height), fontSizePt),
      fontSize: fontSizePt,
      fontFace,
      color: textPaint.color,
      bold: fontWeight >= 600 || /^H[1-6]$/i.test(parentElement.tagName),
      italic: parentStyle.fontStyle === 'italic' || parentStyle.fontStyle === 'oblique',
      underline: String(parentStyle.textDecoration || '').includes('underline'),
      strike: String(parentStyle.textDecoration || '').includes('line-through'),
      align,
      opacity: textPaint.opacity,
      rotate: parseRotate(parentStyle),
      order: orderFor(parentElement),
      paintId: registerPaintTarget(parentElement),
      paragraphSpacingBefore: spacingPtFor(parentStyle, 'marginTop'),
      paragraphSpacingAfter: spacingPtFor(parentStyle, 'marginBottom'),
      verticalAlign,
      ...(hasInsets ? insets : {}),
      bullet,
      lineSpacing: parentStyle.lineHeight && parentStyle.lineHeight !== 'normal'
        ? Math.max(fontSizePt * 1.08, (Number.parseFloat(parentStyle.lineHeight) || 0) * pointsPerPx)
        : isVerticalText
          ? fontSizePt * 1.02
        : text.includes('\\n')
          ? fontSizePt * 1.18
          : undefined,
      charSpacing: parentStyle.letterSpacing && parentStyle.letterSpacing !== 'normal'
        ? (Number.parseFloat(parentStyle.letterSpacing) || 0) * pointsPerPx
        : undefined,
      ...(richTextRuns?.length ? { runs: richTextRuns } : {}),
      wrap: shouldWrap
    });
  };
  const hasNestedTextBlock = (element) =>
    Boolean(element.querySelector('h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,figcaption,div,[data-ppt-text],[data-role="title"],.title,.slide-title,.page-title,.katex'));
  const shouldExportElementText = (element, style, text) => {
    if (!text) return false;
    if (element.querySelector?.('.katex')) return false;
    if (element.closest?.('[data-pptx-formula-block]')) return false;
    if (hasNestedTextBlock(element)) return false;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'MATH'].includes(element.tagName)) return false;
    const tag = element.tagName;
    // Block text elements: export as ONE text box even with styled children (spans).
    // This prevents text fragmentation where "非洲将贡献全球**95%**的新增儿童人口"
    // becomes 3 separate text boxes that can't align correctly.
    if (/^H[1-6]$/.test(tag) || ['P', 'LI', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION'].includes(tag)) return true;
    if (hasDistinctVisibleTextChild(element, style)) return false;
    if (element.matches('[data-ppt-text],[data-role="title"],.title,.slide-title,.page-title')) return true;
    const isBlockLike =
      ['block', 'flex', 'grid', 'table-cell', 'list-item'].includes(style.display) ||
      ['absolute', 'fixed'].includes(style.position);
    if (!isBlockLike || text.length < 6 || text.length > 180) return false;
    // Skip if all visible children are badge-like (own bg color, e.g. pill tags).
    // Their backgrounds are extracted as shapes; text should be extracted per-child
    // via traverseText so it aligns with each badge shape.
    const children = Array.from(element.children);
    if (children.length >= 2) {
      let badgeCount = 0;
      let visibleCount = 0;
      for (const child of children) {
        if (child.closest('script, style, noscript')) continue;
        const cs = window.getComputedStyle(child);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity || '1') < 0.04) continue;
        visibleCount++;
        const bg = rgbToHex(cs.backgroundColor);
        if (bg && bg !== backgroundColor) badgeCount++;
      }
      if (visibleCount >= 2 && badgeCount === visibleCount) return false;
    }
    return true;
  };
  const exportBlockTextElements = () => {
    const candidates = Array.from(pageElement.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,figcaption,[data-ppt-text],[data-role="title"],.title,.slide-title,.page-title,div'
    ));
    for (const element of candidates) {
      if (texts.length >= maxTextBoxes) break;
      if (element.closest('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml, [data-pptx-formula-block]')) continue;
      // Skip elements inside consumed tables
      if (isInsideConsumedTable(element)) continue;
      if (isInsideConsumedTextElement(element)) continue;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = clampBlockText(element.innerText || element.textContent);
      if (!isVisible(element, style, rect)) continue;
      if (!shouldExportElementText(element, style, text)) continue;
      const fontSizePx = Number.parseFloat(style.fontSize || '16') || 16;
      const singleLine = rect.height <= fontSizePx * 1.55;
      const largeText = fontSizePx >= 28 || /^H[1-6]$/.test(element.tagName);
      const inlineRuns = collectInlineTextRuns(element, style);
      const inlineLineRuns = inlineRuns?.length ? collectInlineTextLineRuns(element, style) : [];
      if (inlineLineRuns.length > 1 && !resolveListBullet(element)) {
        inlineLineRuns.forEach((line) => {
          pushTextBox(line.text, line.rect, style, element, false, {
            runs: line.runs
          });
        });
        consumedTextElements.add(element);
        element.setAttribute('data-pptx-extracted-text', '1');
        continue;
      }
      pushTextBox(text, rect, style, element, !(singleLine && largeText), {
        useElementInsets: true,
        runs: inlineRuns
      });
      consumedTextElements.add(element);
      element.setAttribute('data-pptx-extracted-text', '1');
    }
  };
  const getLineTextRuns = (node) => {
    const source = String(node.textContent || '');
    if (source.length > maxPreciseLineRunChars) return [];
    const groups = [];
    let activeGroup = null;
    for (let offset = 0; offset < source.length; offset += 1) {
      const char = source[offset];
      if (!char) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      range.detach();
      if (rect.width < 0.5 || rect.height < 0.5) {
        if (activeGroup && /\\s/.test(char)) activeGroup.text += char;
        continue;
      }
      let group = groups.find((item) => Math.abs(item.top - rect.top) < Math.max(3, rect.height * 0.3));
      if (!group) {
        group = {
          top: rect.top,
          text: '',
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom
        };
        groups.push(group);
      }
      group.text += char;
      group.left = Math.min(group.left, rect.left);
      group.right = Math.max(group.right, rect.right);
      group.bottom = Math.max(group.bottom, rect.bottom);
      activeGroup = group;
    }
    return groups
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map((group) => ({
        text: normalize(group.text),
        rect: {
          left: group.left,
          top: group.top,
          right: group.right,
          bottom: group.bottom,
          width: group.right - group.left,
          height: group.bottom - group.top
        }
      }))
      .filter((group) => group.text);
  };
  const addTextNode = (node, parentStyle, parentElement) => {
    if (texts.length >= maxTextBoxes) return;
    if (parentElement && isInsideConsumedTextElement(parentElement)) return;
    if (parentElement && parentElement.closest?.('.katex, .katex-mathml, [data-pptx-formula-block]')) return;
    // Skip text nodes inside consumed tables
    if (parentElement && isInsideConsumedTable(parentElement)) return;
    const text = clampText(node.textContent);
    if (!text) return;
    const range = document.createRange();
    range.selectNode(node);
    const rect = range.getBoundingClientRect();
    const lineRects = Array.from(range.getClientRects());
    range.detach();
    const fontSizePx = Number.parseFloat(parentStyle.fontSize || '16') || 16;
    const isBrowserWrapped = lineRects.length > 1 || rect.height > fontSizePx * 1.7;
    if (isBrowserWrapped) {
      const runs = getLineTextRuns(node);
      if (runs.length > 1) {
        runs.forEach((run) => pushTextBox(run.text, run.rect, parentStyle, parentElement, false));
        return;
      }
      pushTextBox(text, rect, parentStyle, parentElement, true);
      return;
    }
    pushTextBox(text, rect, parentStyle, parentElement, false);
  };

  const traverseText = (node, inheritedStyle, inheritedElement) => {
    if (texts.length >= maxTextBoxes) return;
    if (node.nodeType === Node.TEXT_NODE) {
      addTextNode(node, inheritedStyle, inheritedElement);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node;
    if (consumedTextElements.has(element)) return;
    if (element.closest('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml, [data-pptx-formula-block]')) return;
    // Skip elements inside consumed tables
    if (isInsideConsumedTable(element)) return;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (!isVisible(element, style, rect)) return;
    const isBlockLike =
      ['block', 'flex', 'grid', 'table', 'list-item'].includes(style.display) ||
      ['absolute', 'fixed', 'sticky'].includes(style.position);
    const nextStyle = isBlockLike && !isStyleElement(element) ? style : style || inheritedStyle;
    element.childNodes.forEach((child) => traverseText(child, nextStyle, element));
  };

  exportBlockTextElements();
  pageElement.childNodes.forEach((child) => {
    const style = window.getComputedStyle(pageElement);
    traverseText(child, style, pageElement);
  });

  const allowedPptxImageDataUri = (dataUri) =>
    /^data:image\\/(?:png|jpeg|jpg|gif);base64,/i.test(String(dataUri || ''));
  const rasterImageToPngDataUri = async (source, width, height) => {
    if (!source) return '';
    return await new Promise((resolve) => {
      const image = source instanceof HTMLImageElement ? source : new Image();
      let objectUrl = '';
      const cleanup = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
      const draw = () => {
        try {
          const cssWidth = Number(width) || image.naturalWidth || image.width || 1;
          const cssHeight = Number(height) || image.naturalHeight || image.height || 1;
          const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.min(4096, Math.round(cssWidth * scale)));
          canvas.height = Math.max(1, Math.min(4096, Math.round(cssHeight * scale)));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            cleanup();
            resolve('');
            return;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          cleanup();
          resolve(canvas.toDataURL('image/png'));
        } catch (_err) {
          cleanup();
          resolve('');
        }
      };
      if (source instanceof HTMLImageElement) {
        if (source.complete && (source.naturalWidth || source.width)) {
          draw();
          return;
        }
        source.addEventListener('load', draw, { once: true });
        source.addEventListener('error', () => resolve(''), { once: true });
        return;
      }
      image.onload = draw;
      image.onerror = () => {
        cleanup();
        resolve('');
      };
      if (source instanceof Blob) {
        objectUrl = URL.createObjectURL(source);
        image.src = objectUrl;
      } else {
        image.crossOrigin = 'anonymous';
        image.src = String(source);
      }
    });
  };
  const readBlobAsDataUri = async (blob) =>
    await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  const fetchImageAsDataUri = async (url, width, height) => {
    try {
      const response = await fetch(url);
      if (!response.ok) return '';
      const blob = await response.blob();
      const mime = String(blob.type || '').toLowerCase();
      if (/^image\\/(?:png|jpeg|jpg|gif)$/.test(mime)) {
        return await readBlobAsDataUri(blob);
      }
      return await rasterImageToPngDataUri(blob, width, height);
    } catch {
      return '';
    }
  };
  const normalizeImageSourceToPptxDataUri = async (source, width, height) => {
    const url = String(source || '').trim();
    if (!url) return '';
    if (allowedPptxImageDataUri(url)) return url;
    if (/^data:image\\//i.test(url)) {
      return await rasterImageToPngDataUri(url, width, height);
    }
    try {
      return await fetchImageAsDataUri(new URL(url, document.baseURI).toString(), width, height);
    } catch {
      return '';
    }
  };
  const canvasToDataUri = (canvas) => {
    try {
      if (!canvas.width || !canvas.height) return '';
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  };
  const imageToDataUri = async (img, width, height) => {
    if (!img.currentSrc && !img.src) return '';
    try {
      const source = img.currentSrc || img.src;
      if (allowedPptxImageDataUri(source)) return source;
      const rendered = await rasterImageToPngDataUri(img, width, height);
      if (rendered) return rendered;
      return await normalizeImageSourceToPptxDataUri(source, width, height);
    } catch {
      return await normalizeImageSourceToPptxDataUri(img.currentSrc || img.src, width, height);
    }
  };
  const dataImageToPngDataUri = async (dataUri, width, height) => {
    if (!dataUri) return '';
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        try {
          const cssWidth = Number(width) || image.naturalWidth || image.width || 1;
          const cssHeight = Number(height) || image.naturalHeight || image.height || 1;
          const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.min(4096, Math.round(cssWidth * scale)));
          canvas.height = Math.max(1, Math.min(4096, Math.round(cssHeight * scale)));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve('');
            return;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch (_err) {
          resolve('');
        }
      };
      image.onerror = () => resolve('');
      image.src = dataUri;
    });
  };
  const svgToDataUri = async (svg, width, height) => {
    try {
      const clone = svg.cloneNode(true);
      const inlinePaint = (source, target) => {
        if (!source || !target || source.nodeType !== Node.ELEMENT_NODE || target.nodeType !== Node.ELEMENT_NODE) return;
        const computed = window.getComputedStyle(source);
        const color = computed.color || '';
        if (color && (!target.getAttribute('color') || target.getAttribute('color') === 'currentColor')) {
          target.setAttribute('color', color);
        }
        ['fill', 'stroke'].forEach((attr) => {
          const raw = target.getAttribute(attr);
          const computedValue = computed[attr] || '';
          if ((!raw || raw === 'currentColor') && computedValue && computedValue !== 'none') {
            target.setAttribute(attr, computedValue);
          } else if (raw === 'currentColor' && color) {
            target.setAttribute(attr, color);
          }
        });
        const sourceChildren = Array.from(source.children || []);
        const targetChildren = Array.from(target.children || []);
        targetChildren.forEach((child, index) => inlinePaint(sourceChildren[index], child));
      };
      inlinePaint(svg, clone);
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('viewBox') && svg.getBBox) {
        try {
          const box = svg.getBBox();
          if (box && box.width > 0 && box.height > 0) {
            clone.setAttribute('viewBox', [box.x, box.y, box.width, box.height].join(' '));
          }
        } catch (_err) {}
      }
      const xml = new XMLSerializer().serializeToString(clone);
      const base64 = btoa(unescape(encodeURIComponent(xml)));
      return await dataImageToPngDataUri('data:image/svg+xml;base64,' + base64, width, height);
    } catch {
      return '';
    }
  };

  const images = [];
  const imageNodes = Array.from(pageElement.querySelectorAll('img,canvas,svg'));
  for (const element of imageNodes) {
    if (images.length >= maxImages) break;
    const style = window.getComputedStyle(element);
    const { rect, x, y, w, h } = elementToBox(element);
    if (!isVisible(element, style, rect)) continue;
    // Skip decorative blurred/transparent images (blur blobs, faint SVGs)
    if (/blur/i.test(style.filter || '')) continue;
    if (Number(style.opacity || '1') < 0.15) continue;
    const tagName = String(element.tagName || '').toUpperCase();
    const dataUri =
      tagName === 'CANVAS'
        ? canvasToDataUri(element)
        : tagName === 'SVG'
          ? await svgToDataUri(element, rect.width, rect.height)
          : await imageToDataUri(element, rect.width, rect.height);
    if (!allowedPptxImageDataUri(dataUri)) continue;
    if (maxImageDataUriLength > 128 && dataUri.length > maxImageDataUriLength) continue;
    images.push({
      dataUri,
      mimeType: dataUri.match(/^data:(image\\/(?:png|jpeg|jpg|gif));base64,/i)?.[1] || 'image/png',
      x,
      y,
      w,
      h,
      order: orderFor(element),
      paintId: registerPaintTarget(element),
      opacity: effectiveOpacityFor(element),
      alt: element.getAttribute('alt') || '',
      rotate: parseRotate(style)
    });
    element.setAttribute('data-pptx-extracted-image', '1');
  }

  // 用已提取的 dataUri 去重，避免 background-image 与 img/canvas 重复提取
  const seenDataUris = new Set(images.map((img) => img.dataUri));

  const extractCssImageUrls = (backgroundImage) => {
    const source = String(backgroundImage || '');
    if (!source || source === 'none') return [];
    const urls = [];
    const urlRegex = /url\\((?:["']?)(.*?)(?:["']?)\\)/gi;
    let match;
    while ((match = urlRegex.exec(source))) {
      const value = String(match[1] || '').trim();
      if (value && !value.startsWith('data:font/')) urls.push(value);
    }
    return urls;
  };

  // 提取 CSS background-image / image-set 中的图片
  const bgImageCandidates = []
  for (const el of pageElement.querySelectorAll('*')) {
    if (bgImageCandidates.length >= maxImages) break
    const style = window.getComputedStyle(el)
    const bg = style.backgroundImage || ''
    if (extractCssImageUrls(bg).length === 0) continue
    bgImageCandidates.push({ el, style })
  }

  for (const { el, style } of bgImageCandidates) {
    if (images.length >= maxImages) break
    const { rect, x, y, w, h } = elementToBox(el)
    if (!isVisible(el, style, rect)) continue

    const rawImageUrl = extractCssImageUrls(style.backgroundImage || '')[0]
    if (!rawImageUrl) continue
    const dataUri = /^data:image\\/svg\\+xml;base64,/i.test(rawImageUrl)
      ? await dataImageToPngDataUri(rawImageUrl, rect.width, rect.height)
      : await normalizeImageSourceToPptxDataUri(rawImageUrl, rect.width, rect.height)
    if (!allowedPptxImageDataUri(dataUri)) continue
    if (maxImageDataUriLength > 128 && dataUri.length > maxImageDataUriLength) continue
    if (seenDataUris.has(dataUri)) continue
    seenDataUris.add(dataUri)

    images.push({
      dataUri,
      mimeType:
        dataUri.match(/^data:(image\\/(?:png|jpeg|jpg|gif));base64,/i)?.[1] || 'image/png',
      x,
      y,
      w,
      h,
      order: orderFor(el),
      paintId: registerPaintTarget(el),
      opacity: effectiveOpacityFor(el),
      alt: '',
      rotate: parseRotate(style)
    })
    el.setAttribute('data-pptx-extracted-image', '1');
  }

  applyPaintOrders([...shapes, ...texts, ...images]);

  return { backgroundColor, shapes, texts, images, tables };
})()
`
}
// ========== Normalize ==========
const normalizeTableCell = (raw: unknown): HtmlToPptxTableCell | null => {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const text = normalizePptxText(String(row.text || ''))
  if (!text) return null
  const rowspan = Math.max(1, Number(row.rowspan) || 1)
  const colspan = Math.max(1, Number(row.colspan) || 1)
  const borderRaw =
    row.border && typeof row.border === 'object' ? (row.border as Record<string, unknown>) : null
  const borderColor = borderRaw ? normalizeHexColor(String(borderRaw.color || ''), '') : ''
  return {
    text,
    rowspan,
    colspan,
    x: clamp(Number(row.x) || 0, 0, DEFAULT_SLIDE_WIDTH),
    y: clamp(Number(row.y) || 0, 0, DEFAULT_SLIDE_HEIGHT),
    w: clamp(Number(row.w) || 0.1, 0.05, DEFAULT_SLIDE_WIDTH),
    h: clamp(Number(row.h) || 0.05, 0.03, DEFAULT_SLIDE_HEIGHT),
    fontSize: row.fontSize ? clamp(Number(row.fontSize), 6, MAX_EXPORT_FONT_SIZE_PT) : undefined,
    fontFace: resolveExportFontFace(text, String(row.fontFace || '')),
    color: normalizeHexColor(String(row.color || ''), '111827'),
    bold: Boolean(row.bold),
    italic: Boolean(row.italic),
    underline: Boolean(row.underline),
    strike: Boolean(row.strike),
    align:
      row.align === 'center' || row.align === 'right' || row.align === 'justify'
        ? (row.align as 'center' | 'right' | 'justify')
        : 'left',
    valign:
      row.valign === 'middle' || row.valign === 'bottom'
        ? (row.valign as 'middle' | 'bottom')
        : 'top',
    fill: row.fill ? normalizeHexColor(String(row.fill), '') : undefined,
    fillTransparency: row.fillTransparency ? clamp(Number(row.fillTransparency), 0, 100) : undefined,
    border: borderColor
      ? {
          color: borderColor,
          widthPt: clamp(Number(borderRaw?.widthPt ?? 0.75), 0.1, 20),
          dash: borderRaw?.dash === 'dash' ? 'dash' : 'solid'
        }
      : undefined
  }
}

const normalizeTable = (raw: unknown): HtmlToPptxTable | null => {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rowsRaw = Array.isArray(row.rows) ? row.rows : []
  const colWidthsRaw = Array.isArray(row.colWidths) ? (row.colWidths as number[]) : []
  const rowHeightsRaw = Array.isArray(row.rowHeights) ? (row.rowHeights as number[]) : []
  if (rowsRaw.length === 0) return null

  const rows = rowsRaw
    .map((cellsRaw: unknown) => {
      const cells = Array.isArray(cellsRaw) ? cellsRaw : []
      return cells.map(normalizeTableCell).filter((c): c is HtmlToPptxTableCell => c !== null)
    })
    .filter((r) => r.length > 0)

  if (rows.length === 0) return null

  return {
    x: clamp(Number(row.x) || 0, 0, DEFAULT_SLIDE_WIDTH),
    y: clamp(Number(row.y) || 0, 0, DEFAULT_SLIDE_HEIGHT),
    w: clamp(Number(row.w) || 0.1, 0.1, DEFAULT_SLIDE_WIDTH),
    h: clamp(Number(row.h) || 0.1, 0.1, DEFAULT_SLIDE_HEIGHT),
    order: Number.isFinite(Number(row.order)) ? Math.max(0, Number(row.order)) : undefined,
    colWidths: colWidthsRaw.map((w) => Math.max(0.05, Number(w) || 0.05)),
    rowHeights: rowHeightsRaw.map((h) => Math.max(0.03, Number(h) || 0.03)),
    rows
  }
}

const normalizeTextRun = (raw: unknown): HtmlToPptxTextRun | null => {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const text = normalizePptxText(String(row.text || ''))
  if (!text) return null
  return {
    text,
    fontSize: Number(row.fontSize) > 0 ? clamp(Number(row.fontSize), 6, MAX_EXPORT_FONT_SIZE_PT) : undefined,
    fontFace: resolveExportFontFace(text, String(row.fontFace || '')),
    color: normalizeHexColor(String(row.color || ''), '111827'),
    bold: Boolean(row.bold),
    italic: Boolean(row.italic),
    underline: Boolean(row.underline),
    strike: Boolean(row.strike)
  }
}

export const normalizeExtractedHtmlToPptxSlide = (
  raw: unknown,
  fallbackTitle?: string
): HtmlToPptxSlide => {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const textsRaw = Array.isArray(record.texts) ? record.texts : []
  const shapesRaw = Array.isArray(record.shapes) ? record.shapes : []
  const imagesRaw = Array.isArray(record.images) ? record.images : []
  const tablesRaw = Array.isArray(record.tables) ? record.tables : []
  const texts = textsRaw
    .map((item): HtmlToPptxTextBox | null => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const text = normalizePptxText(String(row.text || '')).slice(0, DEFAULT_MAX_TEXT_CHARS)
      if (!text) return null
      const runs = Array.isArray(row.runs)
        ? row.runs.map(normalizeTextRun).filter((run): run is HtmlToPptxTextRun => run !== null)
        : []
      const bulletRaw =
        row.bullet && typeof row.bullet === 'object'
          ? (row.bullet as Record<string, unknown>)
          : null
      const bulletType: 'bullet' | 'number' | undefined =
        bulletRaw?.type === 'bullet' || bulletRaw?.type === 'number' ? bulletRaw.type : undefined
      const bullet: HtmlToPptxTextBox['bullet'] =
        bulletType && bulletRaw
          ? {
              type: bulletType,
              level: Number.isFinite(Number(bulletRaw.level))
                ? clamp(Number(bulletRaw.level), 0, 8)
                : undefined,
              startAt: Number.isFinite(Number(bulletRaw.startAt))
                ? clamp(Number(bulletRaw.startAt), 1, 32767)
                : undefined
            }
          : undefined
      return {
        text,
        x: clamp(Number(row.x) || 0, 0, DEFAULT_SLIDE_WIDTH),
        y: clamp(Number(row.y) || 0, 0, DEFAULT_SLIDE_HEIGHT),
        w: clamp(Number(row.w) || 0.4, 0.1, DEFAULT_SLIDE_WIDTH),
        h: clamp(Number(row.h) || 0.2, 0.08, DEFAULT_SLIDE_HEIGHT),
        fontSize: clamp(Number(row.fontSize) || 12, 6, MAX_EXPORT_FONT_SIZE_PT),
        fontFace: resolveExportFontFace(text, String(row.fontFace || '')),
        color: normalizeHexColor(String(row.color || ''), '111827'),
        bold: Boolean(row.bold),
        italic: Boolean(row.italic),
        underline: Boolean(row.underline),
        strike: Boolean(row.strike),
        align:
          row.align === 'center' || row.align === 'right' || row.align === 'justify'
            ? row.align
            : 'left',
        opacity: clamp(Number(row.opacity ?? 1), 0, 1),
        rotate: clamp(Number(row.rotate ?? 0), -360, 360),
        lineSpacing:
          Number(row.lineSpacing) > 0 ? clamp(Number(row.lineSpacing), 1, 200) : undefined,
        charSpacing: Number.isFinite(Number(row.charSpacing))
          ? clamp(Number(row.charSpacing), -20, 200)
          : undefined,
        paragraphSpacingBefore:
          Number(row.paragraphSpacingBefore) > 0
            ? clamp(Number(row.paragraphSpacingBefore), 0, 72)
            : undefined,
        paragraphSpacingAfter:
          Number(row.paragraphSpacingAfter) > 0
            ? clamp(Number(row.paragraphSpacingAfter), 0, 72)
            : undefined,
        verticalAlign:
          row.verticalAlign === 'middle' || row.verticalAlign === 'bottom'
            ? row.verticalAlign
            : 'top',
        paddingLeft: Number(row.paddingLeft) > 0 ? clamp(Number(row.paddingLeft), 0, 2) : undefined,
        paddingRight: Number(row.paddingRight) > 0 ? clamp(Number(row.paddingRight), 0, 2) : undefined,
        paddingTop: Number(row.paddingTop) > 0 ? clamp(Number(row.paddingTop), 0, 1) : undefined,
        paddingBottom:
          Number(row.paddingBottom) > 0 ? clamp(Number(row.paddingBottom), 0, 1) : undefined,
        bullet,
        runs: runs.length > 0 ? runs : undefined,
        wrap: Boolean(row.wrap),
        order: Number.isFinite(Number(row.order)) ? Math.max(0, Number(row.order)) : undefined
      }
    })
    .filter((item): item is HtmlToPptxTextBox => Boolean(item))

  const shapes = shapesRaw
    .map((item): HtmlToPptxShape | null => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const fill = normalizeHexColor(String(row.fill || ''), '')
      const borderRaw =
        row.border && typeof row.border === 'object'
          ? (row.border as Record<string, unknown>)
          : null
      const borderColor = normalizeHexColor(String(borderRaw?.color || ''), '')
      if (!fill && !borderColor) return null
      const shapeType =
        row.shapeType === 'ellipse' || row.shapeType === 'roundRect' || row.shapeType === 'line'
          ? row.shapeType
          : 'rect'
      const minWidth = shapeType === 'line' ? 0.001 : 0.05
      const minHeight = shapeType === 'line' ? 0.001 : 0.05
      return {
        x: clamp(Number(row.x) || 0, 0, DEFAULT_SLIDE_WIDTH),
        y: clamp(Number(row.y) || 0, 0, DEFAULT_SLIDE_HEIGHT),
        w: clamp(Number(row.w) || minWidth, minWidth, DEFAULT_SLIDE_WIDTH),
        h: clamp(Number(row.h) || minHeight, minHeight, DEFAULT_SLIDE_HEIGHT),
        fill,
        transparency: clamp(Number(row.transparency ?? 0), 0, 100),
        radius: clamp(Number(row.radius ?? 0), 0, 100),
        radiusAdj: clamp(Number(row.radiusAdj ?? 0), 0, 50000),
        border: borderColor
          ? {
              color: borderColor,
              widthPt: clamp(Number(borderRaw?.widthPt ?? 0.75), 0.1, 20),
              transparency: clamp(Number(borderRaw?.transparency ?? 0), 0, 100),
              dash: borderRaw?.dash === 'dash' ? 'dash' : 'solid'
            }
          : undefined,
        shapeType,
        rotate: clamp(Number(row.rotate ?? 0), -360, 360),
        flipV: Boolean(row.flipV),
        order: Number.isFinite(Number(row.order)) ? Math.max(0, Number(row.order)) : undefined
      }
    })
    .filter((item): item is HtmlToPptxShape => Boolean(item))

  const images = imagesRaw
    .map((item): HtmlToPptxImage | null => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const dataUri = String(row.dataUri || '')
      const mimeType = normalizeDataUriMime(dataUri)
      if (!mimeType || estimateDataUriBytes(dataUri) > DEFAULT_MAX_IMAGE_BYTES) return null
      return {
        dataUri,
        mimeType,
        x: clamp(Number(row.x) || 0, 0, DEFAULT_SLIDE_WIDTH),
        y: clamp(Number(row.y) || 0, 0, DEFAULT_SLIDE_HEIGHT),
        w: clamp(Number(row.w) || 0.1, 0.05, DEFAULT_SLIDE_WIDTH),
        h: clamp(Number(row.h) || 0.1, 0.05, DEFAULT_SLIDE_HEIGHT),
        alt: normalizeText(String(row.alt || '')),
        rotate: clamp(Number(row.rotate ?? 0), -360, 360),
        opacity: clamp(Number(row.opacity ?? 1), 0, 1),
        order: Number.isFinite(Number(row.order)) ? Math.max(0, Number(row.order)) : undefined
      }
    })
    .filter((item): item is HtmlToPptxImage => Boolean(item))

  const tables = tablesRaw
    .map(normalizeTable)
    .filter((t): t is HtmlToPptxTable => t !== null)

  return {
    title: fallbackTitle,
    backgroundColor: normalizeHexColor(String(record.backgroundColor || ''), 'FFFFFF'),
    backgroundImage: undefined,
    texts,
    shapes,
    images,
    tables: tables.length > 0 ? tables : undefined,
    overlayImages: undefined
  }
}
// ========== Write ==========

export { collectEmbeddedFonts } from './font-collect'

export const writeHtmlToPptx = async (
  outputPath: string,
  document: HtmlToPptxDocument
): Promise<void> => {
  await writePptxDocument(outputPath, document)
}
