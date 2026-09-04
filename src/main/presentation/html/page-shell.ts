import { requireSlideSize, type SlideSizePreset } from '@shared/slide-size'

export const buildBasePageStyleTag = (input: SlideSizePreset): string => {
  const slideSize = requireSlideSize(input)
  return `<style id="ppt-page-guard-style">
  :root {
    --ppt-page-bg: #ffffff;
    --ppt-system-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    --ppt-slide-width: ${slideSize.width}px;
    --ppt-slide-height: ${slideSize.height}px;
  }
  html, body {
    margin: 0;
    width: var(--ppt-slide-width);
    height: var(--ppt-slide-height);
    overflow: hidden;
    font-family: var(--ppt-master-body-font, var(--ppt-body-font, var(--ppt-system-sans)));
    background: var(--ppt-page-bg);
    color: #0f172a;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .ppt-page-root[data-ppt-guard-root="1"] {
    position: relative;
    width: var(--ppt-slide-width);
    height: var(--ppt-slide-height);
    overflow: hidden;
    isolation: isolate;
    background: var(--ppt-page-bg);
  }
  .ppt-page-root.p-2,
  .ppt-page-root.p-8,
  .ppt-page-root.p-12 {
    padding: 0;
  }
  .ppt-page-root[data-ppt-guard-root="1"]:not(.p-2):not(.p-8):not(.p-12) {
    padding: 0;
  }
  body > .ppt-page-root:not([data-ppt-guard-root="1"]):not(.p-2):not(.p-8):not(.p-12) {
    padding: 0;
  }
  .ppt-page-fit-scope {
    position: relative;
    width: 100%;
    height: 100%;
    transform-origin: top left;
    overflow: hidden;
  }
  .ppt-page-content {
    width: 100%;
    height: 100%;
    min-height: 100%;
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    overflow: hidden;
    font-size: 16px;
    font-family: var(--ppt-master-body-font, var(--ppt-body-font, var(--ppt-system-sans)));
  }
  .ppt-page-content [data-ppt-readable-fonts="1"] {
    font-size: 18px;
  }
  .ppt-page-content [data-ppt-readable-fonts="1"] [data-ppt-density="high"] {
    font-size: 16px;
  }
  .ppt-page-content h1,
  .ppt-page-content h2,
  .ppt-page-content h3,
  .ppt-page-content h4,
  .ppt-page-content h5,
  .ppt-page-content h6,
  .ppt-page-content [data-role="title"],
  .ppt-page-content [data-block-id="title"] {
    font-family: var(--ppt-master-title-font, var(--ppt-title-font, var(--ppt-body-font, var(--ppt-system-sans))));
  }
  .ppt-page-content > [data-page-scaffold="1"] {
    width: 100%;
    min-height: 100%;
    height: 100%;
  }
  .ppt-page-content canvas {
    display: block;
    width: 100%;
    height: 100%;
    max-width: 100% !important;
    max-height: 100% !important;
  }
  .ppt-page-content .ppt-chart-frame {
    position: relative;
    min-width: 0;
    overflow: hidden;
  }
  .ppt-page-content .ppt-chart-frame > canvas {
    width: 100% !important;
    height: 100% !important;
  }
  .ppt-page-content [data-block-id*="chart"],
  .ppt-page-content [data-block-id*="graph"],
  .ppt-page-content [data-block-id*="plot"] {
    min-width: 0;
  }
  [data-role="title"] h1,
  header[data-block-id="title"] h1 {
    font-size: 48px !important;
    line-height: 1.2 !important;
  }
  [data-role="title"] h1.text-5xl,
  header[data-block-id="title"] h1.text-5xl {
    font-size: 48px !important;
  }
</style>`
}

export const buildFitScript = (input: SlideSizePreset): string => {
  const slideSize = requireSlideSize(input)
  const heightScale = slideSize.height / 900
  const legacyMinFont = Math.round(14 * heightScale)
  const auxiliaryMinFont = Math.round(12 * heightScale)
  const bodyMinFont = Math.round(18 * heightScale)
  const denseBodyMinFont = Math.round(16 * heightScale)
  const headingMinFont = Math.round(24 * heightScale)
  return `<script id="ppt-page-fit">
(() => {
  const WIDTH = ${slideSize.width};
  const HEIGHT = ${slideSize.height};
  const LEGACY_MIN_FONT = ${legacyMinFont};
  const AUXILIARY_MIN_FONT = ${auxiliaryMinFont};
  const BODY_MIN_FONT = ${bodyMinFont};
  const DENSE_BODY_MIN_FONT = ${denseBodyMinFont};
  const HEADING_MIN_FONT = ${headingMinFont};
  const AUXILIARY_TEXT_SELECTOR = [
    "footer",
    "small",
    "figcaption",
    '[data-ppt-text-role="auxiliary"]',
    '[data-role="footer"]',
    '[data-role="footnote"]',
    '[data-role="source"]',
    '[data-role="annotation"]',
    '[data-role="page-number"]'
  ].join(",");
  const search = new URLSearchParams(window.location.search);
  const disableFit = search.get("fit") === "off";
  const findRoot = () =>
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector(".ppt-page-root");
  const collectTextElements = (root) => {
    const elements = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      const parent = textNode.parentElement;
      if (
        textNode.textContent.trim() &&
        parent &&
        !parent.closest("script, style, svg, canvas, .katex")
      ) {
        elements.add(parent);
      }
      textNode = walker.nextNode();
    }
    return Array.from(elements);
  };
  const isAuxiliaryText = (node) => Boolean(node.closest(AUXILIARY_TEXT_SELECTOR));
  const isHighDensityText = (node) => Boolean(node.closest('[data-ppt-density="high"]'));
  const resolveMinimumFontSize = (node, readableRoot) => {
    if (!readableRoot || !readableRoot.contains(node)) return LEGACY_MIN_FONT;
    if (isAuxiliaryText(node)) return AUXILIARY_MIN_FONT;
    if (
      node.matches("h1, h2, h3, h4, h5, h6") ||
      node.closest(
        'h1, h2, h3, h4, h5, h6, [data-role="title"], [data-block-id="title"]'
      )
    ) {
      return HEADING_MIN_FONT;
    }
    return isHighDensityText(node) ? DENSE_BODY_MIN_FONT : BODY_MIN_FONT;
  };

  function fitPage() {
    const root = findRoot();
    if (!root) return;

    let scope = root.querySelector(":scope > .ppt-page-fit-scope");
    let content = null;
    if (scope) {
      content =
        scope.querySelector(":scope > .ppt-page-content") ||
        scope.querySelector(".ppt-page-content") ||
        scope;
    }

    if (!scope) {
      const directElementChildren = Array.from(root.children);
      const singleContentChild =
        directElementChildren.length === 1 &&
        directElementChildren[0].classList.contains("ppt-page-content")
          ? directElementChildren[0]
          : null;

      if (singleContentChild) {
        content = singleContentChild;
      } else {
        const container = document.createElement("div");
        container.className = "ppt-page-content";
        container.style.cssText = "white-space:normal;word-wrap:normal;";
        while (root.firstChild) {
          container.appendChild(root.firstChild);
        }
        content = container;
      }

      const scopeEl = document.createElement("div");
      scopeEl.className = "ppt-page-fit-scope";
      scopeEl.appendChild(content);
      root.appendChild(scopeEl);
      scope = scopeEl;
    }

    scope.style.transform = "scale(1)";
    const measuredContent = content || scope;
    const readableRoot = measuredContent.querySelector('[data-ppt-readable-fonts="1"]');
    const textEntries = collectTextElements(measuredContent).map((node) => ({
      node,
      minimum: resolveMinimumFontSize(node, readableRoot),
      size: Number.parseFloat(getComputedStyle(node).fontSize || "16")
    }));
    if (readableRoot) {
      textEntries.forEach((entry) => {
        if (entry.minimum <= 0) return;
        if (Number.isFinite(entry.size) && entry.size < entry.minimum) {
          entry.size = entry.minimum;
          entry.node.style.setProperty("font-size", entry.minimum + "px", "important");
        }
      });
    }
    if (disableFit) {
      return;
    }
    const targetWidth = Math.max(1, Math.floor(scope.clientWidth || root.clientWidth || WIDTH));
    const targetHeight = Math.max(1, Math.floor(scope.clientHeight || root.clientHeight || HEIGHT));
    let guard = 0;
    while ((measuredContent.scrollWidth > targetWidth || measuredContent.scrollHeight > targetHeight) && guard < 12) {
      let changed = false;
      textEntries.forEach((entry) => {
        if (Number.isFinite(entry.size) && entry.size > entry.minimum) {
          entry.size = Math.max(entry.minimum, Math.floor(entry.size * 0.94));
          entry.node.style.setProperty("font-size", entry.size + "px", "important");
          changed = true;
        }
      });
      if (!changed) break;
      guard += 1;
    }

    const scale = Math.min(
      1,
      targetWidth / Math.max(measuredContent.scrollWidth, 1),
      targetHeight / Math.max(measuredContent.scrollHeight, 1)
    );
    scope.style.transform = "scale(" + scale.toFixed(4) + ")";
  }

  window.addEventListener("load", () => requestAnimationFrame(fitPage), { once: true });
  window.addEventListener("resize", fitPage);
})();
</script>`
}

export const VIDEO_INTERACTION_SCRIPT = `<script id="ppt-video-interaction">
(() => {
  const prepareVideos = () => {
    document.querySelectorAll("video").forEach((video) => {
      video.playsInline = true;
      if (!video.hasAttribute("preload")) {
        video.preload = "metadata";
      }
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", prepareVideos, { once: true });
  } else {
    prepareVideos();
  }
  window.addEventListener("pageshow", prepareVideos);
})();
</script>`

export const DEFAULT_MOTION_SCRIPT = `<script id="ppt-default-motion">
(() => {
  const search = new URLSearchParams(window.location.search);
  if (search.get("print") === "1" || search.get("export") === "1") {
    document.documentElement.dataset.pptExportStatic = "1";
    return;
  }

  function revealFallback(root) {
    const hiddenTargets = Array.from(root.querySelectorAll("*"))
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) === 0;
      })
      .slice(0, 120);
    hiddenTargets.forEach((el, i) => {
      const node = el;
      node.style.transition = "opacity 300ms ease, transform 300ms ease";
      if (!node.style.transform || node.style.transform === "none") {
        node.style.transform = "translateY(0)";
      }
      window.setTimeout(() => {
        node.style.opacity = "1";
      }, i * 8);
    });
  }

  function runDataAnimMotion(root) {
    var pptApi = globalThis.PPT;
    if (!pptApi || typeof pptApi.scanDataAnim !== "function") return false;
    var config = pptApi.scanDataAnim(root);
    if (!config || (!config.load.length && !config.click.length)) return false;

    if (config.load.length > 0 && typeof pptApi.executeDataAnim === "function") {
      pptApi.executeDataAnim(config.load);
    }

    if (config.click.length > 0 && pptApi.clicks && typeof pptApi.clicks.on === "function") {
      var clickSteps = Array.isArray(config.clickSteps) && config.clickSteps.length > 0
        ? config.clickSteps
        : config.click.map(function (animDef) { return [animDef]; });
      clickSteps.forEach(function (stepDefs, idx) {
        var clickNum = idx + 1;
        pptApi.clicks.on(clickNum, function () {
          if (typeof pptApi.executeDataAnim === "function") {
            pptApi.executeDataAnim(stepDefs);
          } else {
            stepDefs.forEach(function (animDef) {
              pptApi.animate(animDef.targets, {
                opacity: [0, 1],
                translateY: [20, 0],
                duration: animDef.duration,
                easing: animDef.easing
              });
            });
          }
        });
      });
    }

    return true;
  }

  function runLegacyMotion(root) {
    var targets = Array.from(
      root.querySelectorAll(".opacity-0, [data-anime], [data-animate], h1, h2, h3, p, li, .card, .panel, .text-section, .diagram-section, .timeline-node, section, section > *")
    ).slice(0, 16);
    if (targets.length === 0) {
      revealFallback(root);
      return;
    }
    var pptApi = globalThis.PPT;
    if (pptApi && typeof pptApi.animate === "function") {
      try {
        pptApi.animate(targets, {
          opacity: [0, 1],
          translateY: [20, 0],
          easing: "easeOutCubic",
          duration: 560,
          delay: function (_el, i) { return i * 45; },
        });
        window.setTimeout(function () { revealFallback(root); }, 720);
        return;
      } catch (_err) {
        revealFallback(root);
        return;
      }
    }
    targets.forEach(function (el, i) {
      var node = el;
      node.style.opacity = "0";
      node.style.transform = "translateY(14px)";
      node.style.transition = "opacity 420ms ease, transform 420ms ease";
      window.setTimeout(function () {
        node.style.opacity = "1";
        node.style.transform = "translateY(0)";
      }, i * 40);
    });
    revealFallback(root);
  }

  function runMotion() {
    var root = document.querySelector(".ppt-page-root");
    if (!root) return;
    if (!runDataAnimMotion(root)) {
      runLegacyMotion(root);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runMotion, { once: true });
  } else {
    runMotion();
  }
})();
</script>`
