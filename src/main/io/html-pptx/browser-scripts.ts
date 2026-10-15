export const FREEZE_PAGE_FOR_EXPORT_SCRIPT = `
(async () => {
  const waitForMasterStylesheet = async () => {
    const master = document.querySelector('link[data-ppt-master="1"]');
    const expectsMaster = new URLSearchParams(window.location.search).get('_pptMasterExpected') === '1';
    if (!master || !expectsMaster) return;
    if (master.dataset.pptMasterExportReady === '1' && master.sheet) return;
    const masterUrl = new URL(master.href, window.location.href);
    masterUrl.searchParams.set('_pptMasterExport', String(Date.now()));
    master.href = masterUrl.toString();
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        master.removeEventListener('load', onLoad);
        master.removeEventListener('error', onError);
        callback();
      };
      const onLoad = () => finish(() => {
        master.dataset.pptMasterExportReady = '1';
        resolve(true);
      });
      const onError = () => finish(() => reject(new Error('母版样式表加载失败')));
      const timeout = setTimeout(
        () => finish(() => reject(new Error('母版样式表加载超时'))),
        5000
      );
      master.addEventListener('load', onLoad, { once: true });
      master.addEventListener('error', onError, { once: true });
    });
  };

  await waitForMasterStylesheet();
  if (window.PPT?.whenReadyForPrint) {
    await window.PPT.whenReadyForPrint(5000);
  }
  const expectsMasterElements =
    new URLSearchParams(window.location.search).get('_pptMasterElementsExpected') === '1';
  if (expectsMasterElements && !window.PPT?.assertMasterElementsReady) {
    throw new Error('母版全局元素运行时不可用');
  }
  if (window.PPT?.assertMasterElementsReady) {
    await window.PPT.assertMasterElementsReady(5000);
  }
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
    // 只强制显示，不动 transform：data-anim/opacity-0 元素的 class transform 可能是
    // 静态定位（如 Tailwind -translate-y-1/2 垂直居中），清掉会让元素在背景截图里
    // 坠到错误位置。动画脚手架是行内样式驱动的，下方 JS 遍历会精确清除行内 transform。
    '.opacity-0, [data-anim] { opacity: 1 !important; }',
    '[data-anime], [data-animate] { opacity: 1 !important; transform: none !important; }'
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

export const buildMarkPptxExtractedTextForBackgroundScript = (
  texts: Array<{ x: number; y: number; w: number; h: number }>,
  slideSize: { widthIn: number; heightIn: number } = { widthIn: 13.333, heightIn: 7.5 }
): string => {
  const boxes = texts
    .filter(
      (text) =>
        Number.isFinite(text.x) &&
        Number.isFinite(text.y) &&
        Number.isFinite(text.w) &&
        Number.isFinite(text.h) &&
        text.w > 0.02 &&
        text.h > 0.02
    )
    .map((text) => ({ x: text.x, y: text.y, w: text.w, h: text.h }))

  return `
(() => {
  const root =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.body;
  // This script is rerun for background-capture retries. Remove stale matches before
  // evaluating the latest extraction result so a newly unsupported text node stays rasterized.
  root.querySelectorAll('[data-pptx-background-text-match]').forEach((element) => {
    element.removeAttribute('data-pptx-background-text-match');
  });
  const textBoxes = ${JSON.stringify(boxes)};
  if (!textBoxes.length) return 0;
  const rootRect = root.getBoundingClientRect();
  if (!rootRect.width || !rootRect.height) return 0;
  const slideWidth = ${JSON.stringify(slideSize.widthIn)};
  const slideHeight = ${JSON.stringify(slideSize.heightIn)};
  const toClientBox = (box) => ({
    left: rootRect.left + (box.x / slideWidth) * rootRect.width,
    top: rootRect.top + (box.y / slideHeight) * rootRect.height,
    width: (box.w / slideWidth) * rootRect.width,
    height: (box.h / slideHeight) * rootRect.height
  });
  const boxesInClientSpace = textBoxes.map(toClientBox);
  const overlapsExtractedText = (rect) => {
    if (rect.width < 1 || rect.height < 1) return false;
    const rectArea = rect.width * rect.height;
    return boxesInClientSpace.some((box) => {
      const overlapWidth = Math.max(0, Math.min(rect.right, box.left + box.width) - Math.max(rect.left, box.left));
      const overlapHeight = Math.max(0, Math.min(rect.bottom, box.top + box.height) - Math.max(rect.top, box.top));
      const overlap = overlapWidth * overlapHeight;
      // A native PPT box can be intentionally wider than its painted glyphs, but it must
      // still cover almost all of this DOM text fragment. Partial or center-only overlap
      // leaves the fragment in the raster background as a conservative fallback.
      return overlap / rectArea >= 0.85;
    });
  };
  let marked = 0;
  root.querySelectorAll('*').forEach((element) => {
    if (element.closest('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml')) return;
    // aria-hidden text is decorative and intentionally skipped by the extractor;
    // it must remain painted in the raster background, never matched as extracted.
    if (element.closest('[aria-hidden="true"]')) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        String(node.textContent || '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    if (!textNodes.length) return;
    const textRects = textNodes.flatMap((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects());
    });
    if (textRects.length && textRects.every(overlapsExtractedText)) {
      // Mark the container only when every descendant text fragment maps to a
      // native PPT text box. This handles mixed content such as "$528<span>亿</span>"
      // without hiding a neighboring fallback-only child through inheritance.
      element.setAttribute('data-pptx-background-text-match', '1');
      marked += 1;
    }
  });
  return marked;
})()
`
}

// Background capture for PPTX keeps every visual that cannot be represented as
// a native PPTX object. Only successfully extracted objects are removed. This
// avoids both text ghosts on animated nodes and missing complex CSS/DOM visuals.
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

  // Large edge-anchored fills are structural backgrounds. Keep them in the
  // screenshot base instead of relying on a native shape whose z-order can
  // cover the slide or be accidentally targeted by a text animation.
  root.querySelectorAll('[data-pptx-extracted-shape]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const pageArea = rootRect.width * rootRect.height;
    if (!pageArea || rect.width * rect.height < pageArea * 0.2) return;
    const horizontalTolerance = 2;
    const verticalTolerance = 2;
    const spansWidth = rect.width >= rootRect.width - horizontalTolerance;
    const spansHeight = rect.height >= rootRect.height - verticalTolerance;
    if (!spansWidth && !spansHeight) return;
    const touchesHorizontalEdge = rect.left <= rootRect.left + horizontalTolerance || rect.right >= rootRect.right - horizontalTolerance;
    const touchesVerticalEdge = rect.top <= rootRect.top + verticalTolerance || rect.bottom >= rootRect.bottom - verticalTolerance;
    if (touchesHorizontalEdge && touchesVerticalEdge) {
      el.setAttribute('data-pptx-static-background', '1');
    }
  });

  // 2. Remove previous style
  const existing = document.getElementById('ohmyppt-pptx-hide-elements');
  if (existing) existing.remove();

  // 2b. Pin decorative aria-hidden text paint with inline !important. The hide rule
  // below blanks color/text-fill on everything inside an extracted-text container,
  // and inherited -webkit-text-fill-color cannot be undone by a selector alone.
  // Snapshot the pre-hide computed paint and re-apply it inline (rerun-safe: the
  // snapshot of an already-pinned value is the same value).
  const paintProps = [
    'color',
    '-webkit-text-fill-color',
    '-webkit-text-stroke-color',
    'text-shadow',
    'text-decoration-color'
  ];
  root.querySelectorAll('[aria-hidden="true"], [aria-hidden="true"] *').forEach((el) => {
    if (el.closest('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml')) return;
    const computed = getComputedStyle(el);
    paintProps.forEach((prop) => {
      const value = computed.getPropertyValue(prop);
      if (!value) return;
      el.style.setProperty(prop, value, 'important');
    });
  });

  // Pseudo-elements are not part of the DOM text extraction. Keep their own
  // text paint while only confirmed extracted DOM text is made transparent below.
  root.querySelectorAll('*').forEach((el) => {
    ['before', 'after'].forEach((kind) => {
      const pseudo = getComputedStyle(el, '::' + kind);
      const content = String(pseudo.content || '').trim();
      if (!content || content === 'none' || content === 'normal') return;
      el.setAttribute('data-pptx-has-' + kind, '1');
      el.style.setProperty('--pptx-' + kind + '-color', pseudo.color || 'transparent');
      el.style.setProperty('--pptx-' + kind + '-text-fill', pseudo.webkitTextFillColor || pseudo.color || 'transparent');
      el.style.setProperty('--pptx-' + kind + '-text-stroke', pseudo.webkitTextStrokeColor || 'transparent');
      el.style.setProperty('--pptx-' + kind + '-text-shadow', pseudo.textShadow || 'none');
      el.style.setProperty('--pptx-' + kind + '-text-decoration', pseudo.textDecorationColor || 'transparent');
    });
  });

  // 3. CSS: keep any visual that was not confirmed extracted in the raster
  // background. This is the fallback for complex or capped-out source content.
  const style = document.createElement('style');
  style.id = 'ohmyppt-pptx-hide-elements';
  style.textContent = [
    // Precisely hide extracted shapes (background/border) and images (visibility)
    '[data-pptx-extracted-shape]:not([data-pptx-static-background]) { background-color: transparent !important; border-color: transparent !important; }',
    '[data-pptx-extracted-image] { opacity: 0 !important; visibility: hidden !important; }',
    // Keep unmapped images, shadows and complex containers in the raster background.
    // Their extraction can fail because of data limits, filters or cross-origin assets.
    // Only hide text whose source element was confirmed extracted. Hiding all DOM
    // text leaves no fallback when a text-box limit or complex layout skips it.
    // aria-hidden subtrees are decorative (e.g. giant watermark glyphs): the extractor
    // deliberately skips them, so they must keep their paint and stay in this raster
    // instead of being blanked by an ancestor's extracted-text mark.
    '[data-pptx-extracted-text], [data-pptx-extracted-text] *:not(:is([aria-hidden="true"], [aria-hidden="true"] *)), [data-pptx-background-text-match] { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }',
    '[data-pptx-has-before]::before { color: var(--pptx-before-color) !important; -webkit-text-fill-color: var(--pptx-before-text-fill) !important; -webkit-text-stroke-color: var(--pptx-before-text-stroke) !important; text-shadow: var(--pptx-before-text-shadow) !important; text-decoration-color: var(--pptx-before-text-decoration) !important; }',
    '[data-pptx-has-after]::after { color: var(--pptx-after-color) !important; -webkit-text-fill-color: var(--pptx-after-text-fill) !important; -webkit-text-stroke-color: var(--pptx-after-text-stroke) !important; text-shadow: var(--pptx-after-text-shadow) !important; text-decoration-color: var(--pptx-after-text-decoration) !important; }',
    // Hide katex elements (captured as separate images before background capture)
    '.katex { opacity: 0 !important; visibility: hidden !important; }',
    // Hide formula blocks (captured as block-level overlay images)
    '[data-pptx-formula-block] { opacity: 0 !important; visibility: hidden !important; }',
    // An SVG that could not be rasterized stays visible in the background.
    'svg[data-pptx-extracted-image] text, svg[data-pptx-extracted-image] tspan { fill: transparent !important; stroke: transparent !important; }',
    // Hide input/textarea text
    'input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

export const RESTORE_PPTX_PAGE_AFTER_BACKGROUND_CAPTURE_SCRIPT = `
(async () => {
  document.getElementById('ohmyppt-pptx-hide-elements')?.remove();
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
  // These are native PowerPoint effects with a stable final state. Path motion is
  // intentionally excluded: an HTML path's final CSS transform cannot be
  // faithfully reconstructed from the static exported geometry.
  const safeNativeTypes = new Set([
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
    'exit-fly'
  ]);
  const supportedTriggers = new Set(['load', 'click', 'with', 'after']);
  const supportedSequences = new Set(['with', 'after']);
  const staggerCounters = {};
  let lastSequenceStart = 0;
  let lastSequenceEnd = 0;
  const traces = [];
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
    return safeNativeTypes.has(type) || type === 'path' ? type : 'fade-up';
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
  const extractedSelector = '[data-pptx-extracted-text], [data-pptx-extracted-shape], [data-pptx-extracted-image]';
  const collectTrace = (el, type, trigger, from, duration, delay, order, clickGroup) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
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
    traces.push(trace);
  };

  const collectExtractedTargets = (animationRoot) => {
    const candidates = [];
    if (animationRoot.matches(extractedSelector)) candidates.push(animationRoot);
    animationRoot.querySelectorAll(extractedSelector).forEach((candidate) => {
      // Nested data-anim blocks own their extracted objects and receive a
      // separate native effect, avoiding duplicate timing entries.
      if (candidate.closest('[data-anim]') === animationRoot) candidates.push(candidate);
    });
    return Array.from(new Set(candidates));
  };

  const elements = Array.from(root.querySelectorAll('[data-anim]'));

  elements.forEach((el, order) => {
    const type = normalizeType(el.getAttribute('data-anim'));
    if (type === 'none' || !safeNativeTypes.has(type)) return;

    const trigger = normalizeTrigger(el.getAttribute('data-anim-trigger'));
    const effectiveTrigger = trigger === 'click' ? 'click' : 'load';
    const sequence = normalizeSequence(el.getAttribute('data-anim-sequence'));
    const clickGroupRaw = normalizeClickGroup(el.getAttribute('data-anim-click-group'));
    const clickGroup =
      effectiveTrigger === 'click' && isValidClickGroup(clickGroupRaw) ? clickGroupRaw : '';
    const from = normalizeFrom(el.getAttribute('data-anim-from'), defaultFrom(type));
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

    // The extractor adds these attributes only after it has created a native
    // PPT text/shape/image. Use those exact boxes instead of guessing from a
    // parent container; unmapped source content remains visible in the raster
    // fallback and can never disappear because of a timing entry.
    collectExtractedTargets(el).forEach((target) => {
      collectTrace(target, type, effectiveTrigger, from, duration, delay, order, clickGroup);
    });
  });

  return traces;
})()
`

// PPTX element timing is not reliable enough for normal editable exports. This
// only detects that the source page contains animation so the slide can use a
// safe, page-level transition without hiding individual editable objects.
export const HAS_DECLARED_PPTX_ANIMATION_SCRIPT = `
(() => {
  const root =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.body;
  const selector = '[data-anim]:not([data-anim="none"]), [data-anime], [data-animate]';
  return Boolean(
    root.matches(selector) || root.querySelector(selector)
  );
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
