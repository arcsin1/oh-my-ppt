export const FREEZE_PAGE_FOR_EXPORT_SCRIPT = `
(async () => {
  const root =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.body;
  const existing = document.getElementById('ohmyppt-export-freeze-page');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'ohmyppt-export-freeze-page';
  style.textContent = [
    'html { scroll-behavior: auto !important; }',
    '*, *::before, *::after { animation: none !important; transition: none !important; animation-delay: 0s !important; animation-duration: 0s !important; animation-play-state: paused !important; transition-delay: 0s !important; transition-duration: 0s !important; }',
    '.opacity-0, [data-anime], [data-animate], [data-anim] { opacity: 1 !important; transform: none !important; }'
  ].join('\\n');
  document.head.appendChild(style);

  try {
    document.getAnimations?.().forEach((animation) => {
      try {
        animation.finish();
      } catch (_err) {
        try {
          animation.cancel();
        } catch (_cancelErr) {}
      }
    });
  } catch (_err) {}

  const waitFrames = (frames) =>
    new Promise((resolve) => {
      let remaining = Math.max(1, Number(frames) || 1);
      const next = () => {
        remaining -= 1;
        if (remaining <= 0) {
          resolve(true);
          return;
        }
        requestAnimationFrame(next);
      };
      requestAnimationFrame(next);
    });

  const collectChartInstances = () => {
    const charts = new Set();
    const ChartCtor = window.Chart;
    try {
      if (window.__PPT_CHART_REGISTRY__ instanceof Map) {
        window.__PPT_CHART_REGISTRY__.forEach((chart) => {
          if (chart) charts.add(chart);
        });
      }
    } catch (_err) {}
    try {
      if (ChartCtor?.instances) {
        const instances = Array.isArray(ChartCtor.instances)
          ? ChartCtor.instances
          : Object.values(ChartCtor.instances);
        instances.forEach((chart) => {
          if (chart) charts.add(chart);
        });
      }
    } catch (_err) {}
    try {
      root.querySelectorAll('canvas').forEach((canvas) => {
        let chart = null;
        try {
          chart = ChartCtor?.getChart?.(canvas) || null;
        } catch (_err) {}
        if (chart) charts.add(chart);
      });
    } catch (_err) {}
    return Array.from(charts);
  };

  const disableChartAnimations = () => {
    const ChartCtor = window.Chart;
    try {
      if (ChartCtor?.defaults) {
        ChartCtor.defaults.animation = false;
        ChartCtor.defaults.animations = false;
        if (ChartCtor.defaults.transitions) {
          Object.values(ChartCtor.defaults.transitions).forEach((transition) => {
            if (transition?.animation) transition.animation.duration = 0;
            if (transition?.animations) {
              Object.values(transition.animations).forEach((animation) => {
                if (animation && typeof animation === 'object') animation.duration = 0;
              });
            }
          });
        }
      }
    } catch (_err) {}
  };

  const fingerprintCanvases = () => {
    const canvases = Array.from(root.querySelectorAll('canvas'));
    if (canvases.length === 0) return '';
    return canvases
      .map((canvas) => {
        const width = canvas.width || 0;
        const height = canvas.height || 0;
        if (!width || !height) return 'empty';
        let ctx = null;
        try {
          ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
        } catch (_err) {
          return 'unreadable';
        }
        if (!ctx) return 'noctx';
        const columns = Math.min(8, Math.max(2, Math.floor(width / 80)));
        const rows = Math.min(6, Math.max(2, Math.floor(height / 60)));
        let hash = 2166136261;
        try {
          for (let yIndex = 0; yIndex < rows; yIndex += 1) {
            const y = Math.min(height - 1, Math.floor(((yIndex + 0.5) * height) / rows));
            for (let xIndex = 0; xIndex < columns; xIndex += 1) {
              const x = Math.min(width - 1, Math.floor(((xIndex + 0.5) * width) / columns));
              const data = ctx.getImageData(x, y, 1, 1).data;
              for (let i = 0; i < 4; i += 1) {
                hash ^= data[i] || 0;
                hash = Math.imul(hash, 16777619);
              }
            }
          }
          return String(width) + 'x' + String(height) + ':' + String(hash >>> 0);
        } catch (_err) {
          return 'tainted';
        }
      })
      .join('|');
  };

  const waitForCanvasStability = async () => {
    if (!root.querySelector('canvas')) return;
    let previous = '';
    let stableFrames = 0;
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      await waitFrames(2);
      const next = fingerprintCanvases();
      if (next && next === previous) {
        stableFrames += 1;
        if (stableFrames >= 2) return;
      } else {
        stableFrames = 0;
        previous = next;
      }
    }
  };

  const stabilizeCharts = async () => {
    disableChartAnimations();
    const applyFinalChartState = () => {
      collectChartInstances().forEach((chart) => {
        try {
          if (chart?.options) {
            chart.options.animation = false;
            chart.options.animations = false;
            chart.options.responsive = false;
            chart.options.maintainAspectRatio = false;
          }
        } catch (_err) {}
        try {
          if (typeof chart?.stop === 'function') chart.stop();
        } catch (_err) {}
        try {
          if (typeof chart?.resize === 'function') chart.resize();
        } catch (_err) {}
        try {
          if (typeof chart?.update === 'function') chart.update('none');
        } catch (_err) {}
        try {
          if (typeof chart?.render === 'function') chart.render();
          else if (typeof chart?.draw === 'function') chart.draw();
        } catch (_err) {}
      });
    };

    applyFinalChartState();
    await waitFrames(2);
    applyFinalChartState();
    await waitForCanvasStability();
  };

  await stabilizeCharts();

  const shouldForceVisibleForMotion = (node) => {
    if (!node?.matches?.('.opacity-0, [data-anime], [data-animate], [data-anim]')) return false;
    return Number(getComputedStyle(node).opacity || '1') <= 0.04;
  };

  // Mark [data-anim] elements for native PPT animation export. They must not
  // remain baked into the static background, otherwise the animation appears
  // to do nothing because the final state is already visible.
  root.querySelectorAll('[data-anim]').forEach(function (el) {
    el.setAttribute('data-pptx-native-anim', '1');
  });

  const motionTargets = root.querySelectorAll(
    '.opacity-0, [data-anime], [data-animate], h1, h2, h3, p, li, .card, .panel, .text-section, .diagram-section, .timeline-node, section, section > *'
  );
  motionTargets.forEach((element) => {
    const node = element;
    node.style.transition = 'none';
    node.style.animation = 'none';
    if (shouldForceVisibleForMotion(node)) {
      node.setAttribute('data-pptx-animated', '1');
      node.style.opacity = '1';
    }
    if (/translateY\\([^)]*\\)/.test(node.style.transform || '')) {
      node.setAttribute('data-pptx-animated', '1');
      node.style.transform = 'none';
    }
  });

  root.querySelectorAll('*').forEach((element) => {
    const node = element;
    const computed = getComputedStyle(node);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (shouldForceVisibleForMotion(node)) {
      node.setAttribute('data-pptx-animated', '1');
      node.style.opacity = '1';
    }
    if (/translate(?:3d|X|Y)?\\(/.test(node.style.transform || '')) {
      node.setAttribute('data-pptx-animated', '1');
      node.style.transform = 'none';
    }
  });

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_err) {}
  }
  return true;
})()
`

export const FREEZE_PAGE_FOR_PPTX_SCRIPT = FREEZE_PAGE_FOR_EXPORT_SCRIPT

/**
 * Reset ppt-page-fit-scope transform to scale(1) for full-resolution capture.
 * Must be executed AFTER text/shape extraction (which needs the scaled coordinates)
 * but BEFORE screen capture.
 */
export const RESET_SCALE_FOR_PPTX_CAPTURE_SCRIPT = `
(async () => {
  const root =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.body;
  const scope = root.querySelector(':scope > .ppt-page-fit-scope');
  if (scope) scope.style.transform = 'scale(1)';
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

export const HIDE_TEXT_FOR_PPTX_BACKGROUND_SCRIPT = `
(async () => {
  const existing = document.getElementById('ohmyppt-pptx-hide-text');
  if (existing) existing.remove();
  const isVisibleColor = (value) => {
    const color = String(value || '').trim().toLowerCase();
    return Boolean(color && color !== 'transparent' && !/^rgba?\\([^)]*,\\s*0\\s*\\)$/.test(color));
  };
  const resolveVisibleTextColor = (element) => {
    let current = element;
    while (current && current.nodeType === 1) {
      const color = getComputedStyle(current).color;
      if (isVisibleColor(color)) return color;
      current = current.parentElement;
    }
    return '#111827';
  };
  const style = document.createElement('style');
  style.id = 'ohmyppt-pptx-hide-text';
  style.textContent = [
    'body :not(.katex):not(.katex *):not(canvas) { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }',
    'body :not(.katex):not(.katex *)::before, body :not(.katex):not(.katex *)::after { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }',
    '.katex, .katex * { -webkit-text-fill-color: currentColor !important; text-shadow: none !important; }',
    'svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }',
    'input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  document.querySelectorAll('.katex').forEach((element) => {
    const node = element;
    const color = resolveVisibleTextColor(node);
    node.style.color = color;
    node.style.webkitTextFillColor = color;
    node.style.fontFamily = 'KaTeX_Main, "Times New Roman", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  });
  const hideTextPaint = (node) => {
    node.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    node.style.setProperty('-webkit-text-stroke-color', 'transparent', 'important');
    node.style.setProperty('text-shadow', 'none', 'important');
    node.style.setProperty('text-decoration-color', 'transparent', 'important');
    node.style.setProperty('caret-color', 'transparent', 'important');
  };
  const hasOwnTextNode = (element) =>
    Array.from(element.childNodes || []).some((node) => node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim());
  document.querySelectorAll('body *').forEach((element) => {
    if (element.closest('.katex, .katex-mathml, script, style, noscript, canvas')) return;
    if (hasOwnTextNode(element)) hideTextPaint(element);
  });
  document.querySelectorAll('svg text, svg tspan').forEach((element) => {
    element.style.setProperty('fill', 'transparent', 'important');
    element.style.setProperty('stroke', 'transparent', 'important');
  });
  void document.body.offsetHeight;
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_err) {}
  }
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

// Background capture for PPTX: keep animated elements ([data-pptx-animated] set by freeze),
// decorative elements (blur blobs), and SVGs visible.
// Hide text and non-animated shapes/images (which are extracted separately).
export const HIDE_FOR_PPTX_BACKGROUND_SCRIPT = `
(async () => {
  // Helper: same rgbToHex as main extraction script
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

  // 1. Mark additional decorative elements (blur blobs, glass-morphism, very low Tailwind opacity)
  const root = document.querySelector('.ppt-page-root') || document.body;
  root.querySelectorAll('*').forEach((el) => {
    if (el.hasAttribute('data-pptx-animated')) return;
    const style = getComputedStyle(el);
    const hasBlur = /blur/i.test(style.filter || '') || /blur/i.test(style.backdropFilter || '');
    const cls = el.className && typeof el.className === 'string' ? el.className : '';
    const hasDecoClass = /\\b(opacity-[012]0|opacity-[12]5)\\b/.test(cls) || /\\bblur-(sm|md|lg|xl|2xl|3xl)\\b/.test(cls);
    if (hasBlur || hasDecoClass) {
      el.setAttribute('data-pptx-animated', '1');
    }
  });

  // 1b. Mark full-page background elements as decorative (preserve their background during capture)
  const pageArea = root.getBoundingClientRect().width * root.getBoundingClientRect().height;
  root.querySelectorAll(':scope > div, :scope > section, :scope > main').forEach((el) => {
    if (el.hasAttribute('data-pptx-animated')) return;
    const style = getComputedStyle(el);
    const fill = rgbToHex(style.backgroundColor);
    if (!fill) return;
    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height >= pageArea * 0.5) {
      el.setAttribute('data-pptx-animated', '1');
    }
  });

  // 2. Remove previous style
  const existing = document.getElementById('ohmyppt-pptx-hide-elements');
  if (existing) existing.remove();

  // 3. CSS: keep [data-pptx-animated] and SVGs visible, hide text + non-animated shapes/images
  const style = document.createElement('style');
  style.id = 'ohmyppt-pptx-hide-elements';
  style.textContent = [
    // Precisely hide extracted shapes (background/border) and images (visibility)
    '[data-pptx-extracted-shape] { background-color: transparent !important; border-color: transparent !important; }',
    '[data-pptx-extracted-image] { opacity: 0 !important; visibility: hidden !important; }',
    // Hide native animation sources from the static background. Their exported
    // PPT shapes/text/images are animated separately in slide timing XML.
    '[data-pptx-native-anim] { background-color: transparent !important; border-color: transparent !important; box-shadow: none !important; }',
    '[data-pptx-native-anim], [data-pptx-native-anim] * { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }',
    '[data-pptx-native-anim] img, [data-pptx-native-anim] canvas, img[data-pptx-native-anim], canvas[data-pptx-native-anim] { opacity: 0 !important; visibility: hidden !important; }',
    // Hide non-animated images (fallback for non-extracted decorative images)
    'img:not([data-pptx-animated]):not([data-pptx-extracted-image]), canvas:not([data-pptx-animated]):not([data-pptx-extracted-image]) { opacity: 0 !important; visibility: hidden !important; }',
    // Make container backgrounds transparent (catch-all for non-extracted containers)
    'section:not([data-pptx-animated]), main:not([data-pptx-animated]), article:not([data-pptx-animated]), header:not([data-pptx-animated]), footer:not([data-pptx-animated]), aside:not([data-pptx-animated]), div:not([data-pptx-animated]), figure:not([data-pptx-animated]), figcaption:not([data-pptx-animated]), table:not([data-pptx-animated]), td:not([data-pptx-animated]), th:not([data-pptx-animated]) { background-color: transparent !important; border-color: transparent !important; }',
    // Hide all text (extracted text + fallback for missed text, including .katex which is captured separately)
    'body :not(canvas):not([data-pptx-animated]):not([data-pptx-extracted-image]) { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }',
    'body::before, body::after { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }',
    // Hide katex elements (captured as separate images before background capture)
    '.katex { opacity: 0 !important; visibility: hidden !important; }',
    // Hide formula blocks (captured as block-level overlay images)
    '[data-pptx-formula-block] { opacity: 0 !important; visibility: hidden !important; }',
    // Hide SVG text (can't extract it anyway)
    'svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }',
    // Hide input/textarea text
    'input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

export const HIDE_ELEMENTS_FOR_PPTX_BACKGROUND_SCRIPT = `
(async () => {
  let existing = document.getElementById('ohmyppt-pptx-hide-elements');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'ohmyppt-pptx-hide-elements';
  style.textContent = [
    'img, canvas { opacity: 0 !important; visibility: hidden !important; }',
    'svg { opacity: 0 !important; visibility: hidden !important; }',
    'section, main, article, header, footer, aside, div, figure, figcaption, table, td, th { background-color: transparent !important; border-color: transparent !important; }',
    'body :not(canvas) { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }',
    'body::before, body::after { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }',
    '.katex { opacity: 0 !important; visibility: hidden !important; }',
    'svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }',
    'input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

export const MARK_KATEX_BLOCKS_SCRIPT = `
(() => {
  const root = document.querySelector('.ppt-page-root') || document.body;
  root.querySelectorAll('[data-pptx-formula-block]').forEach((block) => {
    block.removeAttribute('data-pptx-formula-block');
  });
  const blockSelector = [
    'p',
    'div',
    'section',
    'article',
    'main',
    'aside',
    'header',
    'footer',
    'figure',
    'figcaption',
    'li',
    'ul',
    'ol',
    'dl',
    'dt',
    'dd',
    'blockquote',
    'pre',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'td',
    'th'
  ].join(',');
  const BLOCK_TAGS = new Set(blockSelector.split(',').map((tag) => tag.toUpperCase()));
  const allBlocks = root.querySelectorAll(blockSelector);
  let count = 0;
  for (const block of allBlocks) {
    // Must contain katex
    if (!block.querySelector('.katex')) continue;
    // Check if any direct child block also contains katex — if so, this is a
    // parent container and the children are the actual leaf targets.
    let childBlockHasKatex = false;
    for (const child of block.children) {
      if (!BLOCK_TAGS.has(child.tagName)) continue;
      if (child.querySelector('.katex')) { childBlockHasKatex = true; break; }
    }
    if (childBlockHasKatex) continue;
    block.setAttribute('data-pptx-formula-block', '1');
    count++;
  }
  return count;
})()
`

export const COLLECT_PPTX_ANIMATION_TRACES_SCRIPT = `
(() => {
  const root = document.querySelector('.ppt-page-root') || document.body;
  const pageRect = root.getBoundingClientRect();
  const supportedTypes = new Set([
    'fade',
    'fade-up',
    'fade-down',
    'fade-left',
    'fade-right',
    'scale-in',
    'slide-up',
    'slide-down',
    'slide-left',
    'slide-right',
    'fly-in',
    'wipe',
    'zoom-in',
    'spin-in',
    'grow-shrink-soft',
    'grow-shrink',
    'grow-shrink-strong',
    'pulse-soft',
    'pulse',
    'pulse-strong',
    'exit-fade',
    'exit-scale',
    'exit-zoom',
    'exit-wipe',
    'exit-fly',
    'path'
  ]);
  const supportedTriggers = new Set(['load', 'click', 'with', 'after']);
  const supportedSequences = new Set(['with', 'after']);
  const staggerCounters = {};
  let lastSequenceStart = 0;
  let lastSequenceEnd = 0;
  const traces = [];
  const parseLinearPathDelta = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const coords = raw.match(/-?\\d+(?:\\.\\d+)?/g);
    if (!coords || coords.length < 4) return null;
    const startX = Number(coords[0]);
    const startY = Number(coords[1]);
    const endX = Number(coords[coords.length - 2]);
    const endY = Number(coords[coords.length - 1]);
    if (![startX, startY, endX, endY].every(Number.isFinite)) return null;
    return { x: endX - startX, y: endY - startY, raw };
  };
  const normalizeType = (value) => {
    const type = String(value || 'fade-up').trim().toLowerCase();
    if (type === 'none') return 'none';
    if (type === 'fly' || type === 'flyin') return 'fly-in';
    if (type === 'zoom' || type === 'zoomin') return 'zoom-in';
    if (type === 'spin' || type === 'spinin') return 'spin-in';
    if (type === 'growsoft' || type === 'growshrinksoft') return 'grow-shrink-soft';
    if (type === 'grow' || type === 'growshrink') return 'grow-shrink';
    if (type === 'growstrong' || type === 'growshrinkstrong') return 'grow-shrink-strong';
    if (type === 'emphasis') return 'pulse';
    if (type === 'pulsesoft') return 'pulse-soft';
    if (type === 'pulsestrong') return 'pulse-strong';
    if (type === 'exitscale') return 'exit-scale';
    if (type === 'exitzoom') return 'exit-zoom';
    return supportedTypes.has(type) ? type : 'fade-up';
  };
  const normalizeTrigger = (value) => {
    const trigger = String(value || 'load').trim().toLowerCase();
    if (trigger === 'on-click') return 'click';
    if (trigger === 'after-previous') return 'after';
    if (trigger === 'with-previous') return 'with';
    return supportedTriggers.has(trigger) ? trigger : 'load';
  };
  const normalizeSequence = (value) => {
    const sequence = String(value || '').trim().toLowerCase();
    if (sequence === 'after-previous') return 'after';
    if (sequence === 'with-previous') return 'with';
    return supportedSequences.has(sequence) ? sequence : '';
  };
  const normalizeClickGroup = (value) => {
    const group = String(value || '').trim();
    return group || '';
  };
  const isValidClickGroup = (value) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(value || ''));
  const defaultFrom = (type) => {
    if (type === 'fade-down') return 'top';
    if (type === 'slide-down') return 'top';
    if (type === 'fade-left' || type === 'slide-left') return 'right';
    if (type === 'slide-right') return 'left';
    if (type === 'fade-right') return 'left';
    if (type === 'wipe' || type === 'exit-wipe') return 'left';
    return 'bottom';
  };
  const normalizeFrom = (value, fallback) => {
    const from = String(value || fallback || 'bottom').trim().toLowerCase();
    if (from === 'up' || from === 'top') return 'top';
    if (from === 'down' || from === 'bottom') return 'bottom';
    if (from === 'start') return 'left';
    if (from === 'end') return 'right';
    if (from === 'left' || from === 'right' || from === 'center') return from;
    return fallback || 'bottom';
  };
  const collectTrace = (el, type, trigger, from, duration, delay, order, clickGroup, pathValue) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    el.setAttribute('data-pptx-native-anim', '1');
    const trace = {
      type,
      trigger,
      from,
      duration: Math.max(100, Math.min(5000, Number(duration) || 500)),
      delay: Math.max(0, Math.min(30000, Number(delay) || 0)),
      order,
      x: Math.round(rect.left - pageRect.left),
      y: Math.round(rect.top - pageRect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    };
    if (clickGroup) trace.clickGroup = clickGroup;
    if (pathValue) trace.path = pathValue;
    traces.push(trace);
  };

  const elements = Array.from(root.querySelectorAll('[data-anim]'));

  elements.forEach((el, order) => {
    const type = normalizeType(el.getAttribute('data-anim'));
    if (type === 'none') return;

    const trigger = normalizeTrigger(el.getAttribute('data-anim-trigger'));
    const effectiveTrigger = trigger === 'click' ? 'click' : 'load';
    const sequence = normalizeSequence(el.getAttribute('data-anim-sequence'));
    const clickGroupRaw = normalizeClickGroup(el.getAttribute('data-anim-click-group'));
    const clickGroup =
      effectiveTrigger === 'click' && isValidClickGroup(clickGroupRaw) ? clickGroupRaw : '';
    const from = normalizeFrom(el.getAttribute('data-anim-from'), defaultFrom(type));
    const pathValue =
      type === 'path'
        ? parseLinearPathDelta(el.getAttribute('data-anim-path'))
        : null;
    if (type === 'path' && !pathValue) return;
    const duration = Math.max(100, Math.min(5000, Number(el.getAttribute('data-anim-duration')) || 500));
    const delayRaw = (el.getAttribute('data-anim-delay') || '0').trim();
    const staggerRaw = (el.getAttribute('data-anim-stagger') || '').trim();
    let delay = 0;
    if (staggerRaw) {
      const gap = Number(staggerRaw);
      const normalizedGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
      const key = effectiveTrigger;
      if (staggerCounters[key] === undefined) staggerCounters[key] = 0;
      delay = staggerCounters[key] * normalizedGap;
      staggerCounters[key] += 1;
    } else if (delayRaw.indexOf('stagger') === 0) {
      const match = delayRaw.match(/stagger\\s*\\(\\s*(\\d+)\\s*\\)/);
      const gap = match ? Number(match[1]) : 50;
      const key = effectiveTrigger;
      if (staggerCounters[key] === undefined) staggerCounters[key] = 0;
      delay = staggerCounters[key] * gap;
      staggerCounters[key] += 1;
    } else {
      delay = Number(delayRaw) || 0;
    }

    if (effectiveTrigger === 'load') {
      const sequencingMode = sequence || trigger;
      if (sequencingMode === 'after') {
        delay += lastSequenceEnd;
        lastSequenceStart = delay;
        lastSequenceEnd = Math.max(lastSequenceEnd, delay + duration);
      } else if (sequencingMode === 'with') {
        delay += lastSequenceStart;
        lastSequenceEnd = Math.max(lastSequenceEnd, delay + duration);
      } else {
        lastSequenceStart = delay;
        lastSequenceEnd = Math.max(lastSequenceEnd, delay + duration);
      }
    }

    collectTrace(el, type, effectiveTrigger, from, duration, delay, order, clickGroup, pathValue?.raw || '');
  });

  const directMarkers = Array.from(
    root.querySelectorAll('.opacity-0, [data-anime], [data-animate]')
  ).filter((el) => !el.closest('[data-anim]'));
  directMarkers.slice(0, 16).forEach((el, index) => {
    collectTrace(el, 'fade-up', 'load', 'bottom', 560, index * 45, elements.length + index, '');
  });

  if (traces.length === 0) {
    const legacyTargets = Array.from(
      root.querySelectorAll('h1, h2, h3, p, li, .card, .panel, .text-section, .diagram-section, .timeline-node, section, section > *')
    ).filter((el) => !el.closest('[data-anim]'));
    legacyTargets.slice(0, 16).forEach((el, index) => {
      collectTrace(el, 'fade-up', 'load', 'bottom', 560, index * 45, index, '');
    });
  }

  return traces;
})()
`

export const COLLECT_KATEX_BLOCK_RECTS_SCRIPT = `
(async () => {
  const root = document.querySelector('.ppt-page-root') || document.body;
  const pageRect = root.getBoundingClientRect();
  const blocks = root.querySelectorAll('[data-pptx-formula-block="1"]');
  const results = [];
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    results.push({
      x: Math.round(rect.left - pageRect.left),
      y: Math.round(rect.top - pageRect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    });
  }
  return results;
})()
`

export const WAIT_FOR_PPTX_CAPTURE_FRAME_SCRIPT = `
(async () => {
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  void document.body.offsetHeight;
  return true;
})()
`
