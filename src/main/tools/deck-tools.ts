import fs from "fs";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as cheerio from "cheerio";
import log from "electron-log/main.js";
import type { SessionDeckGenerationContext, ToolStreamConfig } from "./types";
import { emitToolStatus } from "./types";
import { validateHtmlContent } from "./html-utils";
import { buildSessionAssetHeadTags } from "../ipc/page-assets";
import { progressLabel } from "@shared/progress";
import { callFetchWebContent, callWebSearch } from "../utils/web-search";
import { checkDaemonHealth } from "../utils/web-search-service";

const uiText = (locale: "zh" | "en" | undefined, zh: string, en: string): string => (locale === "en" ? en : zh);

export const BASE_PAGE_STYLE_TAG = `<style id="ppt-page-guard-style">
  :root {
    --ppt-page-bg: #ffffff;
  }
  html, body {
    margin: 0;
    width: 1600px;
    height: 900px;
    overflow: hidden;
    font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    background: var(--ppt-page-bg);
    color: #0f172a;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .ppt-page-root[data-ppt-guard-root="1"] {
    position: relative;
    width: 1600px;
    height: 900px;
    overflow: hidden;
    isolation: isolate;
    background: var(--ppt-page-bg);
  }
  .ppt-page-root.p-2 { padding: 0.5rem; }
  .ppt-page-root.p-8 { padding: 2rem; }
  .ppt-page-root.p-12 { padding: 3rem; }
  .ppt-page-root[data-ppt-guard-root="1"]:not(.p-2):not(.p-8):not(.p-12) {
    padding: 0.5rem;
  }
  body > .ppt-page-root:not([data-ppt-guard-root="1"]):not(.p-2):not(.p-8):not(.p-12) {
    padding: 0.5rem;
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
    min-height: 240px;
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
</style>`;

function extractBackgroundStyle(styleAttr: string): string {
  const declarations = styleAttr
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const kept = declarations.filter((decl) => {
    const normalized = decl.toLowerCase().replace(/\s+/g, " ");
    return (
      normalized.startsWith("background:") ||
      normalized.startsWith("background-color:") ||
      normalized.startsWith("background-image:")
    );
  });
  return kept.join("; ");
}

function isBackgroundUtilityClass(cls: string): boolean {
  const base = cls.split(":").pop() || cls;
  return base.startsWith("bg-") || base.startsWith("from-") || base.startsWith("via-") || base.startsWith("to-");
}

function syncRootBackgroundFromScaffold(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false });
    const root = $('.ppt-page-root[data-ppt-guard-root="1"]').first();
    if (!root.length) return html;

    const scaffold = root.find('[data-page-scaffold="1"]').first();
    if (!scaffold.length) return html;

    const rootClassRaw = (root.attr("class") || "").trim();
    const rootClasses = rootClassRaw.split(/\s+/).filter(Boolean);
    const rootHasBgClass = rootClasses.some((cls) => isBackgroundUtilityClass(cls));

    if (!rootHasBgClass) {
      const scaffoldClassRaw = (scaffold.attr("class") || "").trim();
      const scaffoldBgClasses = scaffoldClassRaw
        .split(/\s+/)
        .filter(Boolean)
        .filter((cls) => isBackgroundUtilityClass(cls));
      if (scaffoldBgClasses.length > 0) {
        const classSet = new Set(rootClasses);
        for (const cls of scaffoldBgClasses) classSet.add(cls);
        root.attr("class", Array.from(classSet).join(" "));
      }
    }

    const rootStyleRaw = (root.attr("style") || "").trim();
    const rootBgStyle = extractBackgroundStyle(rootStyleRaw);
    if (!rootBgStyle) {
      const scaffoldStyleRaw = (scaffold.attr("style") || "").trim();
      const scaffoldBgStyle = extractBackgroundStyle(scaffoldStyleRaw);
      if (scaffoldBgStyle) {
        const finalStyle = [rootStyleRaw, scaffoldBgStyle].filter(Boolean).join("; ");
        root.attr("style", finalStyle);
      }
    }

    return $.html();
  } catch {
    return html;
  }
}

function stripUnsafeHiddenStates(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false });
    $("*").each((_, node) => {
      const el = $(node);

      const classRaw = (el.attr("class") || "").trim();
      if (classRaw) {
        const kept = classRaw
          .split(/\s+/)
          .filter(Boolean)
          .filter((cls) => {
            const base = cls.split(":").pop() || cls;
            return base !== "opacity-0" && base !== "invisible";
          });
        if (kept.length > 0) {
          el.attr("class", kept.join(" "));
        } else {
          el.removeAttr("class");
        }
      }

      const styleRaw = (el.attr("style") || "").trim();
      if (styleRaw) {
        const keptDecls = styleRaw
          .split(";")
          .map((decl) => decl.trim())
          .filter(Boolean)
          .filter((decl) => {
            const idx = decl.indexOf(":");
            if (idx < 0) return true;
            const key = decl.slice(0, idx).trim().toLowerCase();
            const value = decl
              .slice(idx + 1)
              .trim()
              .toLowerCase();
            if (key === "opacity" && /^0(?:\.0+)?$/.test(value)) return false;
            if (key === "visibility" && value === "hidden") return false;
            return true;
          });
        if (keptDecls.length > 0) {
          el.attr("style", keptDecls.join("; "));
        } else {
          el.removeAttr("style");
        }
      }
    });
    return $.html();
  } catch {
    return html;
  }
}

export const FIT_SCRIPT = `<script id="ppt-page-fit">
(() => {
  const WIDTH = 1600;
  const HEIGHT = 900;
  const MIN_FONT = 14;
  const search = new URLSearchParams(window.location.search);
  const disableFit = search.get("fit") === "off";
  const findRoot = () =>
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector(".ppt-page-root");

  function fitPage() {
    const root = findRoot();
    if (!root) return;

    // Check if a scope wrapper already exists.
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
        // First time: wrap all children in a container div so orphaned closing tags
        // (e.g. stray </div>, </main>) become text nodes INSIDE the container,
        // not siblings that break the DOM structure.
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
    if (disableFit) {
      return;
    }
    const targetWidth = Math.max(1, Math.floor(scope.clientWidth || root.clientWidth || WIDTH));
    const targetHeight = Math.max(1, Math.floor(scope.clientHeight || root.clientHeight || HEIGHT));
    let guard = 0;
    const measuredContent = content || scope;
    const textNodes = measuredContent.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, .text");
    while ((measuredContent.scrollWidth > targetWidth || measuredContent.scrollHeight > targetHeight) && guard < 12) {
      let changed = false;
      textNodes.forEach((node) => {
        const size = Number.parseFloat(getComputedStyle(node).fontSize || "16");
        if (Number.isFinite(size) && size > MIN_FONT) {
          node.style.fontSize = Math.max(MIN_FONT, Math.floor(size * 0.94)) + "px";
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
</script>`;

const DEFAULT_MOTION_SCRIPT = `<script id="ppt-default-motion">
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

  function runMotion() {
    const root = document.querySelector(".ppt-page-root");
    if (!root) return;
    const targets = Array.from(
      root.querySelectorAll(".opacity-0, [data-anime], [data-animate], h1, h2, h3, p, li, .card, .panel, .text-section, .diagram-section, .timeline-node, section, section > *")
    ).slice(0, 16);
    if (targets.length === 0) {
      revealFallback(root);
      return;
    }
    const pptApi = globalThis.PPT;
    if (pptApi && typeof pptApi.animate === "function") {
      try {
        pptApi.animate(targets, {
          opacity: [0, 1],
          translateY: [20, 0],
          easing: "easeOutCubic",
          duration: 560,
          delay: (_el, i) => i * 45,
        });
        // If custom animation failed and left nodes hidden, force visibility once.
        window.setTimeout(() => revealFallback(root), 720);
        return;
      } catch (_err) {
        revealFallback(root);
        return;
      }
    }
    targets.forEach((el, i) => {
      const node = el;
      node.style.opacity = "0";
      node.style.transform = "translateY(14px)";
      node.style.transition = "opacity 420ms ease, transform 420ms ease";
      window.setTimeout(() => {
        node.style.opacity = "1";
        node.style.transform = "translateY(0)";
      }, i * 40);
    });
    revealFallback(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runMotion, { once: true });
  } else {
    runMotion();
  }
})();
</script>`;

// Serialized write lock to prevent concurrent write corruption (per project directory)
const writeLocks = new Map<string, Promise<void>>();
function serializedWrite<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const chain = writeLocks.get(lockKey) || Promise.resolve();
  const run = chain.then(fn);
  const next = run.then(
    () => undefined,
    () => undefined
  );
  writeLocks.set(lockKey, next);
  return run.finally(() => {
    if (writeLocks.get(lockKey) === next) {
      writeLocks.delete(lockKey);
    }
  });
}

function getAgentNameFromToolConfig(config: unknown): string | undefined {
  const maybe = config as Record<string, unknown> | undefined;
  const metadata = maybe?.metadata as Record<string, unknown> | undefined;
  const configurable = maybe?.configurable as Record<string, unknown> | undefined;
  const fromMetadata = metadata?.lc_agent_name;
  const fromConfigurable = configurable?.lc_agent_name;
  if (typeof fromMetadata === "string" && fromMetadata.trim().length > 0) return fromMetadata.trim();
  if (typeof fromConfigurable === "string" && fromConfigurable.trim().length > 0) return fromConfigurable.trim();
  return undefined;
}

const CANVAS_LOCK_CLASS_PATTERNS = [
  /^(w|h|min-w|min-h|max-w|max-h)-\[(1600px|900px|100vw|100vh|100dvw|100dvh)\]$/i,
  /^(w|h|min-w|min-h|max-w|max-h)-screen$/i,
  /^aspect-\[(16\/9|1600\/900)\]$/i,
  /^size-\[(1600px|900px)\]$/i
];

function stripCanvasLockClasses(classAttr: string): string {
  const classes = classAttr.split(/\s+/).filter(Boolean);
  const kept = classes.filter((cls) => !CANVAS_LOCK_CLASS_PATTERNS.some((pattern) => pattern.test(cls)));
  return kept.join(" ");
}

function stripCanvasInlineSizes(styleAttr: string): string {
  const declarations = styleAttr
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const kept = declarations.filter((decl) => {
    const normalized = decl.toLowerCase().replace(/\s+/g, " ");
    if (/^(width|min-width|max-width): (1600px|100vw|100dvw)$/.test(normalized)) return false;
    if (/^(height|min-height|max-height): (900px|100vh|100dvh)$/.test(normalized)) return false;
    return true;
  });
  return kept.join("; ");
}

function stripCanvasLockStyles(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false });
    $("[class]").each((_, node) => {
      const classValue = ($(node).attr("class") || "").trim();
      if (!classValue) return;
      const cleaned = stripCanvasLockClasses(classValue);
      if (cleaned.length > 0) {
        $(node).attr("class", cleaned);
      } else {
        $(node).removeAttr("class");
      }
    });
    $("[style]").each((_, node) => {
      const styleValue = ($(node).attr("style") || "").trim();
      if (!styleValue) return;
      const cleaned = stripCanvasInlineSizes(styleValue);
      if (cleaned.length > 0) {
        $(node).attr("style", cleaned);
      } else {
        $(node).removeAttr("style");
      }
    });
    return $.html();
  } catch {
    return html;
  }
}

const REMOTE_RUNTIME_RESOURCE_RE = /<(script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+["'][^>]*>/gi;

function extractRemoteRuntimeResources(content: string): string[] {
  const hits: string[] = [];
  let match: RegExpExecArray | null;
  REMOTE_RUNTIME_RESOURCE_RE.lastIndex = 0;
  while ((match = REMOTE_RUNTIME_RESOURCE_RE.exec(content)) !== null) {
    const raw = match[0].replace(/\s+/g, " ").trim();
    hits.push(raw.length > 200 ? `${raw.slice(0, 200)}…` : raw);
    if (hits.length >= 8) break;
  }
  return hits;
}

const CHART_FRAME_CLASS = "ppt-chart-frame";
const CHART_FRAME_DEFAULT_HEIGHT_CLASS = "h-[240px]";

function splitClassNames(classRaw: string): string[] {
  return classRaw.split(/\s+/).map((cls) => cls.trim()).filter(Boolean);
}

function classBaseName(cls: string): string {
  return cls.split(":").pop() || cls;
}

function isChartCanvasLayoutClass(cls: string): boolean {
  const base = classBaseName(cls);
  return (
    base === "flex-1" ||
    /^h-/.test(base) ||
    /^min-h-/.test(base) ||
    /^max-h-/.test(base)
  );
}

function isMarginUtilityClass(cls: string): boolean {
  return /^-?m[trblxy]?-[^\s]+$/.test(classBaseName(cls));
}

function hasConcreteChartHeightClass(classes: Iterable<string>): boolean {
  return Array.from(classes).some((cls) => {
    const base = classBaseName(cls);
    if (/^(?:h|min-h)-(?:full|screen|dvh|svh|lvh|auto)$/.test(base)) return false;
    return /^(?:h|min-h)-(?:\[[^\]]+\]|(?!0\b)\d+)/.test(base);
  });
}

function hasConcreteChartHeightStyle(styleRaw: string): boolean {
  return /(?:^|;)\s*(?:height|min-height)\s*:\s*(?!\s*(?:auto|0(?:px|rem|em|%)?|100%|inherit|initial|unset)\b)[^;]+/i.test(
    styleRaw
  );
}

function stabilizeChartCanvases(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false });
    $("canvas").each((_, node) => {
      const canvas = $(node);
      const originalCanvasClasses = splitClassNames(canvas.attr("class") || "");
      const wrapperClasses = originalCanvasClasses.filter(isMarginUtilityClass);
      const canvasClassSet = new Set(
        originalCanvasClasses.filter((cls) => !isChartCanvasLayoutClass(cls) && !isMarginUtilityClass(cls))
      );
      canvasClassSet.add("h-full");
      canvasClassSet.add("w-full");
      canvas.attr("class", Array.from(canvasClassSet).join(" "));

      const parent = canvas.parent();
      if (!parent.length) return;

      const parentClassRaw = (parent.attr("class") || "").trim();
      const parentClassSet = new Set(parentClassRaw.split(/\s+/).filter(Boolean));
      const parentStyle = parent.attr("style") || "";
      const hasHeightClass = hasConcreteChartHeightClass(parentClassSet);
      const hasHeightStyle = hasConcreteChartHeightStyle(parentStyle);
      const parentElementChildren = parent.children();
      const parentIsDedicatedFrame = parentElementChildren.length === 1 && parentElementChildren.get(0) === canvas.get(0);

      if (parentIsDedicatedFrame && (hasHeightClass || hasHeightStyle)) {
        parentClassSet.add(CHART_FRAME_CLASS);
        parentClassSet.add("relative");
        parentClassSet.add("min-w-0");
        parentClassSet.add("overflow-hidden");
        parent.attr("class", Array.from(parentClassSet).join(" "));
        return;
      }

      const frame = $('<div></div>');
      const frameClassSet = new Set([
        CHART_FRAME_CLASS,
        "relative",
        CHART_FRAME_DEFAULT_HEIGHT_CLASS,
        "w-full",
        "min-w-0",
        "overflow-hidden",
        ...wrapperClasses
      ]);
      frame.attr("class", Array.from(frameClassSet).join(" "));
      canvas.before(frame);
      frame.append(canvas);
    });
    return $.html();
  } catch {
    return html;
  }
}

// Detect if AI added custom page-level animations (anime.timeline / anime.createTimeline / anime.animate)
// in a DOMContentLoaded or load listener. If so, skip default motion injection.
function hasCustomPageAnimation(html: string): boolean {
  return (
    /(?:anime\s*\(|anime\.(?:createTimeline|timeline|animate|stagger)\s*\()/m.test(html) ||
    /PPT\.(?:animate|stagger|createTimeline)\s*\(/m.test(html) ||
    /data-(?:anime|animate)\b/i.test(html)
  );
}

const ensureGlobalRuntime = (html: string, pageId: string): string => {
  // Strict new-structure mode:
  // input must be page fragment only, then we always scaffold into one canonical document.
  const fragment = stripUnsafeHiddenStates(stabilizeChartCanvases(stripCanvasLockStyles(html.trim())));
  const skipDefaultMotion = hasCustomPageAnimation(html);
  const output = buildScaffoldDocument({
    pageId,
    innerContent: fragment,
    includeDefaultMotion: !skipDefaultMotion
  });
  return syncRootBackgroundFromScaffold(output);
};

// Build the complete scaffold document from a content fragment.
// This is the ONLY place we construct persisted page documents.
function buildScaffoldDocument(args: { pageId: string; innerContent: string; includeDefaultMotion: boolean }): string {
  const { pageId, innerContent, includeDefaultMotion } = args;
  const motionScript = includeDefaultMotion ? `\n    ${DEFAULT_MOTION_SCRIPT}` : "";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${buildSessionAssetHeadTags()}
    ${BASE_PAGE_STYLE_TAG}
  </head>
  <body data-page-id="${pageId}">
    <main class="ppt-page-root p-2" data-ppt-guard-root="1">
      <div class="ppt-page-fit-scope">
        <div class="ppt-page-content">
          ${innerContent}
        </div>
      </div>
    </main>
    ${FIT_SCRIPT}
    ${motionScript}
  </body>
</html>`;
}

const normalizeAndInjectPageRuntime = (content: string, pageId: string): string => ensureGlobalRuntime(content, pageId);

function validateIndexShellHtml(content: string): string[] {
  const errors: string[] = [];
  if (!/<html[\s>]/i.test(content)) errors.push("缺少 <html> 标签");
  if (!/<body[\s>]/i.test(content)) errors.push("缺少 <body> 标签");
  if (!/<\/body>/i.test(content)) errors.push("缺少 </body> 闭合标签");
  if (!/<\/html>/i.test(content)) errors.push("缺少 </html> 闭合标签");
  if (!/id=["']frameViewport["']/i.test(content)) errors.push("缺少 frameViewport 容器");
  if (!/id=["']pages-data["']/i.test(content)) errors.push("缺少 pages-data 元数据脚本");
  if (!/ppt-preview-frame/i.test(content)) errors.push("缺少 .ppt-preview-frame 预览 iframe 壳");
  if (!/ppt-controls/i.test(content)) errors.push("缺少 .ppt-controls 控制栏");

  const openScriptCount = (content.match(/<script\b/gi) || []).length;
  const closeScriptCount = (content.match(/<\/script>/gi) || []).length;
  if (closeScriptCount < openScriptCount) {
    errors.push("存在未闭合的 <script> 标签");
  }

  const pagesDataMatch = content.match(/<script\b[^>]*id=["']pages-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!pagesDataMatch) {
    errors.push("pages-data 脚本缺失或未闭合");
  } else {
    try {
      const parsed = JSON.parse((pagesDataMatch[1] || "").trim() || "[]");
      if (!Array.isArray(parsed)) {
        errors.push("pages-data 必须是 JSON 数组");
      }
    } catch (error) {
      errors.push(`pages-data JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const inlineScriptMatches = Array.from(
    content.matchAll(/<script\b(?![^>]*\bsrc=)(?![^>]*type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi)
  );
  if (inlineScriptMatches.length === 0) {
    errors.push("缺少主逻辑内联脚本");
  } else {
    for (const [index, match] of inlineScriptMatches.entries()) {
      const scriptBody = (match[1] || "").trim();
      if (!scriptBody) {
        errors.push(`第 ${index + 1} 个内联脚本为空`);
        continue;
      }
      try {
        // Compile-only syntax check to avoid writing broken index shell.
        // eslint-disable-next-line no-new-func
        new Function(scriptBody);
      } catch (error) {
        errors.push(`第 ${index + 1} 个内联脚本语法错误: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const mergedInlineScripts = inlineScriptMatches.map((match) => String(match[1] || "")).join("\n");
    if (!/hashchange/i.test(mergedInlineScripts)) errors.push("缺少 hashchange 路由监听逻辑");
    if (!/applyPage/i.test(mergedInlineScripts)) errors.push("缺少 applyPage 页面切换逻辑");
    if (!/framePool/i.test(mergedInlineScripts)) errors.push("缺少 framePool iframe 池逻辑");
  }

  return errors;
}

function clampTransitionDuration(value: number | undefined): number {
  if (!Number.isFinite(value)) return 420;
  return Math.max(120, Math.min(1200, Math.round(value as number)));
}

function patchIndexTransitionStyle(
  content: string,
  args: {
    type: "none" | "fade";
    durationMs?: number;
  }
): string {
  const withoutOldStyle = content.replace(
    /\n?\s*<style\b[^>]*id=["']ppt-index-transition-style["'][^>]*>[\s\S]*?<\/style>/gi,
    ""
  );
  if (args.type === "none") {
    return withoutOldStyle;
  }
  const durationMs = clampTransitionDuration(args.durationMs);
  const style = `
    <style id="ppt-index-transition-style" data-transition-type="fade">
      .ppt-preview-frame {
        display: block !important;
        opacity: 0;
        pointer-events: none;
        transition: opacity ${durationMs}ms ease;
      }
      .ppt-preview-frame.active {
        opacity: 1;
        pointer-events: auto;
      }
    </style>`;
  return withoutOldStyle.replace(/<\/head>/i, `${style}\n  </head>`);
}

export function createSessionBoundDeckTools(context: SessionDeckGenerationContext): unknown[] {
  const scopedPageIdsForWrite = (
    Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
      ? context.allowedPageIds.filter((pid) => Boolean(context.pageFileMap[pid]))
      : Object.keys(context.pageFileMap)
  ).sort((a, b) => {
    const an = Number(a.match(/^page-(\d+)$/i)?.[1] || 0);
    const bn = Number(b.match(/^page-(\d+)$/i)?.[1] || 0);
    return an - bn;
  });
  let autoPageCursor = 0;
  const writtenPageIds = new Set<string>();
  let lastReportedProgress = 0;

  const totalScopedPages = Math.max(
    1,
    (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
      ? context.allowedPageIds.length
      : Object.keys(context.pageFileMap).length) || 1
  );
  const isEditMode = context.mode === "edit";
  const isMainScopeEdit = isEditMode && context.editScope === "main";
  const hasSelector = Boolean(context.selectedSelector?.trim());
  const statusLanguage = context.appLocale === "en" ? "English" : "Simplified Chinese";

  const parsePageNumber = (pageId?: string): number | null => {
    if (!pageId) return null;
    const match = pageId.match(/^page-(\d+)$/i);
    if (!match) return null;
    const num = Number(match[1]);
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  const inferProgressFromStatus = (args: { label: string; pageId?: string; detail?: string }): number | undefined => {
    const { label, pageId } = args;
    if (/读取会话上下文|Reading session context/i.test(label)) return 34;
    if (/验证完成状态|Verifying completion/i.test(label)) return 88;
    if (/所有页面已填充|当前页面已填充|All pages filled|Current page filled/i.test(label)) return 95;
    if (/生成完成|修改完成|Generation completed|Edit completed/i.test(label)) return 98;
    const updateMatch = label.match(/(?:更新|Updating)\s*(page-\d+)/i);
    const resolvedPageId = pageId || updateMatch?.[1];
    const pageNumber = parsePageNumber(resolvedPageId);
    if (pageNumber) {
      const fraction = Math.min(1, Math.max(0, (pageNumber - 0.5) / totalScopedPages));
      return 40 + fraction * 44;
    }
    return undefined;
  };

  const normalizeStatusProgress = (args: {
    label: string;
    progress?: number;
    pageId?: string;
    detail?: string;
  }): number => {
    const inferred = inferProgressFromStatus(args);
    const rawValue = Number.isFinite(args.progress) ? Number(args.progress) : inferred;
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      // No explicit or inferred progress — keep last known value so we never regress or emit undefined.
      return lastReportedProgress;
    }
    const rounded = Math.round(rawValue * 10) / 10;
    const clamped = Math.max(0, Math.min(100, rounded));
    const monotonic = Math.max(lastReportedProgress, clamped);
    lastReportedProgress = monotonic;
    return monotonic;
  };

  const emitNormalizedToolStatus = (
    config: unknown,
    status: {
      label: string;
      detail?: string;
      progress?: number;
      pageId?: string;
      agentName?: string;
    }
  ): void => {
    emitToolStatus(config as ToolStreamConfig, {
      ...status,
      label: progressLabel(context.appLocale, status.label),
      progress: normalizeStatusProgress(status)
    });
  };

  const resolveSingleTargetPageId = (): string | undefined => {
    if (context.selectedPageId && context.pageFileMap[context.selectedPageId]) {
      return context.selectedPageId;
    }
    if (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length === 1) {
      const only = context.allowedPageIds[0];
      if (context.pageFileMap[only]) return only;
    }
    return undefined;
  };

  const resolveWriteTargetPage = (requestedPageId?: string): { pageId: string; isAuto: boolean } => {
    if (requestedPageId && requestedPageId.trim().length > 0) {
      return { pageId: requestedPageId.trim(), isAuto: false };
    }
    const singleTarget = resolveSingleTargetPageId();
    if (singleTarget) return { pageId: singleTarget, isAuto: false };
    if (scopedPageIdsForWrite.length === 0) {
      throw new Error("当前会话没有可写入页面。");
    }
    if (scopedPageIdsForWrite.every((pid) => writtenPageIds.has(pid))) {
      throw new Error("当前作用域内页面已经全部写入。请调用 verify_completion() 校验，不要继续自动写入。");
    }
    while (
      autoPageCursor < scopedPageIdsForWrite.length - 1 &&
      writtenPageIds.has(scopedPageIdsForWrite[autoPageCursor])
    ) {
      autoPageCursor += 1;
    }
    const idx = Math.min(autoPageCursor, scopedPageIdsForWrite.length - 1);
    const picked = scopedPageIdsForWrite[idx];
    return { pageId: picked, isAuto: true };
  };

  const writePageFile = async (args: {
    pageId?: string;
    content: string;
    config: unknown;
    statusLabel?: string;
  }): Promise<string> => {
    if (isMainScopeEdit) {
      throw new Error("当前为主会话编辑（main），只允许调用 set_index_transition(type, durationMs)。");
    }
    const { pageId, content, config, statusLabel } = args;
    const { pageId: resolvedPageId, isAuto } = resolveWriteTargetPage(pageId);
    const agentName = getAgentNameFromToolConfig(config);
    if (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0) {
      if (!context.allowedPageIds.includes(resolvedPageId)) {
        throw new Error(`当前任务仅允许修改: ${context.allowedPageIds.join(", ")}；收到: ${resolvedPageId}`);
      }
    }
    const remoteResources = extractRemoteRuntimeResources(content);
    if (remoteResources.length > 0) {
      const detail = `检测到 ${remoteResources.length} 个远程 script/link 资源。仅允许使用系统预注入的本地 ./assets/*`;
      emitNormalizedToolStatus(config, {
        label: `外链资源校验失败 ${resolvedPageId}`,
        detail,
        progress: 60,
        pageId: resolvedPageId
      });
      throw new Error(
        [
          `检测到禁止的 CDN/远程资源引用 (${resolvedPageId})，已拒绝写入。`,
          "请移除所有 script/link 的 http(s) 或 // 外链，仅使用系统预注入的本地 ./assets/* 资源。",
          "示例命中：",
          ...remoteResources.map((item) => `- ${item}`)
        ].join("\n")
      );
    }
    const validation = validateHtmlContent(content);
    if (!validation.valid) {
      emitNormalizedToolStatus(config, {
        label: `验证失败 ${resolvedPageId}`,
        detail: validation.errors.join("; "),
        progress: 60,
        pageId: resolvedPageId
      });
      throw new Error(`HTML 验证失败 (${resolvedPageId}): ${validation.errors.join("; ")}。请修正后重试。`);
    }
    const targetPath = context.pageFileMap[resolvedPageId];
    if (!targetPath) {
      throw new Error(`未知页面 ${resolvedPageId}，可用页面: ${Object.keys(context.pageFileMap).join(", ")}`);
    }
    emitNormalizedToolStatus(config, {
      label: statusLabel || uiText(context.appLocale, `更新 ${resolvedPageId}`, `Updating ${resolvedPageId}`),
      detail: uiText(context.appLocale, "正在写入对应 page 文件", "Writing the target page file"),
      pageId: resolvedPageId,
      agentName
    });
    const result = await serializedWrite(context.projectDir, async () => {
      const normalized = normalizeAndInjectPageRuntime(content, resolvedPageId);
      await fs.promises.writeFile(targetPath, normalized, "utf-8");
      return `Updated ${resolvedPageId} in ${targetPath}`;
    });
    writtenPageIds.add(resolvedPageId);
    if (isAuto) {
      autoPageCursor = Math.min(autoPageCursor + 1, scopedPageIdsForWrite.length);
    }
    log.info("[deepagent] update_page_file", {
      sessionId: context.sessionId,
      pageId: resolvedPageId,
      targetPath,
      agentName: agentName || "unknown",
      allowedPageIds: context.allowedPageIds || null
    });
    return result;
  };

  const resolvedEngines =
    Array.isArray(context.webSearchEngines) && context.webSearchEngines.length > 0
      ? context.webSearchEngines
      : ["bing", "duckduckgo"];
  const resolvedLimit =
    typeof context.webSearchLimit === "number" && Number.isFinite(context.webSearchLimit)
      ? Math.max(1, Math.min(20, Math.round(context.webSearchLimit)))
      : 20;
  const searchTools =
    context.allowWebSearch === true
      ? [
          tool(
            async ({ query }, config) => {
              emitNormalizedToolStatus(config, {
                label: uiText(context.appLocale, `联网搜索：${query}`, `Web search: ${query}`),
                detail: uiText(
                  context.appLocale,
                  `引擎: ${resolvedEngines.join(", ")}`,
                  `Engines: ${resolvedEngines.join(", ")}`
                ),
                progress: 20
              });
              const healthy = await checkDaemonHealth();
              if (!healthy) {
                throw new Error(
                  uiText(
                    context.appLocale,
                    "open-websearch 本地服务未启动，请先在设置页安装或启动联网搜索服务。",
                    "The local open-websearch service is not running. Install or start it from Settings first."
                  )
                );
              }
              const result = await callWebSearch({
                query,
                limit: resolvedLimit,
                engines: resolvedEngines
              });
              emitNormalizedToolStatus(config, {
                label: uiText(
                  context.appLocale,
                  `搜索完成，共 ${result.totalResults} 条结果`,
                  `Search completed with ${result.totalResults} results`
                ),
                progress: 40
              });
              return JSON.stringify(result, null, 2);
            },
            {
              name: "web_search",
              description:
                "Search the web for current information before writing PPT content. Engines and result limit come from user settings; only provide the query.",
              schema: z.object({
                query: z.string().min(1).describe("Search query")
              })
            }
          ),
          tool(
            async ({ url, maxChars }, config) => {
              emitNormalizedToolStatus(config, {
                label: uiText(context.appLocale, `抓取网页内容：${url}`, `Fetching page content: ${url}`),
                progress: 20
              });
              const healthy = await checkDaemonHealth();
              if (!healthy) {
                throw new Error(
                  uiText(
                    context.appLocale,
                    "open-websearch 本地服务未启动，请先在设置页安装或启动联网搜索服务。",
                    "The local open-websearch service is not running. Install or start it from Settings first."
                  )
                );
              }
              const result = await callFetchWebContent({ url, maxChars });
              emitNormalizedToolStatus(config, {
                label: uiText(
                  context.appLocale,
                  `网页内容抓取完成：${result.content.length} 字符`,
                  `Fetched page content: ${result.content.length} chars`
                ),
                progress: 40
              });
              return JSON.stringify(result, null, 2);
            },
            {
              name: "fetch_web_content",
              description:
                "Fetch readable content for a public URL. Use after web_search when snippets are insufficient and more detail is needed.",
              schema: z.object({
                url: z.string().url().describe("Public HTTP(S) URL"),
                maxChars: z.number().int().min(1000).max(50000).optional().default(8000)
              })
            }
          )
        ]
      : [];

  return [
    // ── get_session_context ──
    tool(
      async (_input, config) => {
        const scopedPageFileMap =
          Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
            ? Object.fromEntries(
                Object.entries(context.pageFileMap).filter(([pageId]) => context.allowedPageIds!.includes(pageId))
              )
            : context.pageFileMap;
        const scopedPageIds = Object.keys(scopedPageFileMap);
        const selectedPagePath =
          context.selectedPageId && scopedPageFileMap[context.selectedPageId]
            ? scopedPageFileMap[context.selectedPageId]
            : undefined;
        const pageFiles = scopedPageIds.map((pageId) => ({
          pageId,
          hostPath: scopedPageFileMap[pageId],
          agentPath: `/${pageId}.html`
        }));
        const scopedExistingPageIds =
          Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
            ? (context.existingPageIds || []).filter((pid) => context.allowedPageIds!.includes(pid))
            : context.existingPageIds;

        emitNormalizedToolStatus(config, {
          label: uiText(context.appLocale, "读取会话上下文", "Reading session context"),
          detail: isMainScopeEdit
            ? uiText(
                context.appLocale,
                `已提供 index 总览壳: ${context.indexPath}`,
                `Provided index overview shell: ${context.indexPath}`
              )
            : selectedPagePath
              ? uiText(
                  context.appLocale,
                  `已提供目标页文件: ${selectedPagePath}`,
                  `Provided target page file: ${selectedPagePath}`
                )
              : uiText(
                  context.appLocale,
                  "已提供页面文件映射与会话上下文",
                  "Provided page-file map and session context"
                ),
          progress: 34
        });
        const constraints = isMainScopeEdit
          ? [
              "当前为主会话编辑（main）：只允许修改 index.html 总览壳",
              "只允许使用 set_index_transition(type, durationMs)，禁止调用 update_index_file / update_page_file / update_single_page_file",
              "禁止修改任何 page-x.html 文件",
              "必须保留 hash 导航、frameViewport、pages-data、controls、全屏/演示模式逻辑",
              "禁止使用 CDN/远程 script/link（http/https/协议相对地址）；仅允许本地资源"
            ]
          : hasSelector
            ? [
                "index.html 只是总览壳，主要内容在 page-x.html",
                "禁止使用 CDN/远程 script/link（http/https/协议相对地址）；仅允许系统预注入的本地 ./assets/* 资源",
                "Selector 编辑模式：先用 read_file 读取目标页面，再用 grep 搜索选择器/文本定位，最后用 edit_file(old_string, new_string) 精准替换",
                "不要调用 write_file / update_page_file / update_single_page_file，edit_file 直接修改即可",
                "仅修改 selector 命中节点，禁止整页重写、禁止改动无关区域",
                "尽量不要修改 index.html 的导航与控制逻辑"
              ]
            : [
                "index.html 只是总览壳，主要内容写入 page-x.html",
                "禁止使用 CDN/远程 script/link（http/https/协议相对地址）；仅允许系统预注入的本地 ./assets/* 资源",
                "单页任务只允许使用 update_single_page_file(pageId, content)，禁止调用 update_page_file",
                "单页任务必须写入 selectedPagePath 对应的 page 文件，不需要改 index.html",
                isEditMode
                  ? "多页/全局编辑使用 update_page_file(pageId, content)，必须显式传 pageId"
                  : "多页生成优先使用 update_page_file(content)（可选传 pageId 覆盖自动定位）",
                "每页写入后会自动注入动画运行时与防溢出保护",
                "不要在最终答案里返回大块 HTML，必须把变更落盘",
                "尽量不要修改 index.html 的导航与控制逻辑"
              ];
        return JSON.stringify(
          {
            mode: context.mode || "generate",
            editScope: context.editScope || null,
            sessionId: context.sessionId,
            topic: context.topic,
            deckTitle: context.deckTitle,
            styleId: context.styleId || "minimal-white",
            designContract: context.designContract ?? null,
            outlineTitles: context.outlineTitles,
            outlineItems: context.outlineItems,
            hostProjectDir: context.projectDir,
            hostIndexPath: context.indexPath,
            agentWorkspaceRoot: "/",
            agentIndexPath: "/index.html",
            pageFileMap: scopedPageFileMap,
            pageFiles,
            allowedPageIds: context.allowedPageIds ?? null,
            userMessage: context.userMessage,
            pageIds: scopedPageIds,
            selectedPageId: context.selectedPageId ?? undefined,
            selectedPagePath,
            selectedPageNumber: context.selectedPageNumber ?? undefined,
            selectedSelector: context.selectedSelector ?? undefined,
            elementTag: context.elementTag ?? undefined,
            elementText: context.elementText ?? undefined,
            existingPageIds: scopedExistingPageIds ?? undefined,
            constraints
          },
          null,
          2
        );
      },
      {
        name: "get_session_context",
        description:
          "Get the current session generation context, directory paths, index.html path, page titles, and constraints.",
        schema: z.object({})
      }
    ),

    // ── report_generation_status ──
    tool(
      async ({ label, detail, progress }, config) => {
        emitNormalizedToolStatus(config, {
          label,
          detail: detail ?? undefined,
          progress: progress ?? undefined
        });
        return `Status recorded: ${label}`;
      },
      {
        name: "report_generation_status",
        description: `Report the current generation/editing stage to the host UI. The label and detail must be written in ${statusLanguage}, regardless of the deck content language. progress must be a numeric literal such as 10, not a string such as "10".`,
        schema: z.object({
          label: z.string().describe(`Current stage label in ${statusLanguage}`),
          detail: z.string().nullable().describe(`Optional extra detail in ${statusLanguage}`),
          progress: z
            .preprocess((value) => {
              if (value === null || value === undefined || value === "") return null;
              if (typeof value === "string") {
                const trimmed = value.trim();
                if (!trimmed) return null;
                const parsed = Number(trimmed);
                return Number.isFinite(parsed) ? parsed : value;
              }
              return value;
            }, z.number().min(0).max(100).nullable())
            .describe("Suggested progress")
        })
      }
    ),

    // ── set_index_transition ──
    tool(
      async ({ type, durationMs }, config) => {
        if (!isMainScopeEdit) {
          throw new Error("仅主会话编辑（main）允许调用 set_index_transition(type, durationMs)。");
        }
        if (!fs.existsSync(context.indexPath)) {
          throw new Error(`index.html 缺失：${context.indexPath}`);
        }
        const transitionType = type === "none" ? "none" : "fade";
        const current = await fs.promises.readFile(context.indexPath, "utf-8");
        const next = patchIndexTransitionStyle(current, {
          type: transitionType,
          durationMs: Number(durationMs)
        });
        const indexErrors = validateIndexShellHtml(next);
        if (indexErrors.length > 0) {
          emitNormalizedToolStatus(config, {
            label: uiText(context.appLocale, "切换动画配置失败", "Transition configuration failed"),
            detail: indexErrors.join("; "),
            progress: 60
          });
          throw new Error(`index.html 验证失败: ${indexErrors.join("; ")}`);
        }
        emitNormalizedToolStatus(config, {
          label:
            transitionType === "none"
              ? uiText(context.appLocale, "关闭切换动画", "Transition disabled")
              : uiText(context.appLocale, "更新切换动画", "Transition updated"),
          detail:
            transitionType === "none"
              ? uiText(context.appLocale, "已恢复无过渡切换", "Restored instant page switching")
              : uiText(
                  context.appLocale,
                  `已设置淡入淡出 ${clampTransitionDuration(Number(durationMs))}ms`,
                  `Set fade transition to ${clampTransitionDuration(Number(durationMs))}ms`
                ),
          progress: 72
        });
        const result = await serializedWrite(context.projectDir, async () => {
          await fs.promises.writeFile(context.indexPath, next, "utf-8");
          return `Updated index transition in ${context.indexPath}`;
        });
        log.info("[deepagent] set_index_transition", {
          sessionId: context.sessionId,
          indexPath: context.indexPath,
          type: transitionType,
          durationMs: transitionType === "none" ? null : clampTransitionDuration(Number(durationMs)),
          agentName: getAgentNameFromToolConfig(config) || "unknown"
        });
        return result;
      },
      {
        name: "set_index_transition",
        description:
          "Controlled tool for the main session: configure index.html page transition animation without rewriting the index shell.",
        schema: z.object({
          type: z.enum(["fade", "none"]).describe("Transition type: fade for cross-fade, none to disable transitions"),
          durationMs: z.number().optional().describe("Animation duration, 120-1200ms, default 420ms")
        })
      }
    ),

    // ── update_single_page_file ──
    tool(
      async ({ pageId, content }, config) => {
        if (isMainScopeEdit) {
          throw new Error(
            "当前为主会话编辑（main），禁止调用 update_single_page_file；请改用 set_index_transition(type, durationMs)。"
          );
        }
        const targetPageId = resolveSingleTargetPageId();
        if (!targetPageId) {
          throw new Error(
            isEditMode
              ? "当前会话未锁定单页。请改用 update_page_file(pageId, content) 并显式传 pageId，或在上下文中指定 selectedPageId。"
              : "当前会话未锁定单页。请改用 update_page_file(content) 或在上下文中指定 selectedPageId。"
          );
        }
        if (targetPageId && pageId !== targetPageId) {
          throw new Error(`单页编辑工具仅允许目标页面 ${targetPageId}；收到: ${pageId}`);
        }
        return writePageFile({
          pageId,
          content,
          config,
          statusLabel: uiText(context.appLocale, `更新单页 ${pageId}`, `Updating ${pageId}`)
        });
      },
      {
        name: "update_single_page_file",
        description:
          "Single-page edit tool. Pass pageId and content explicitly; the tool validates pageId against the current single-page context to avoid modifying other pages.",
        schema: z.object({
          pageId: z.string().describe("Target pageId, such as page-5. It must match the current single-page context."),
          content: z
            .string()
            .describe(
              'Complete page HTML fragment only. It must include one balanced section[data-page-scaffold] wrapping one balanced main[data-block-id="content"][data-role="content"]. Do not pass <!doctype>, <html>, <head>, <body>, .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, data-ppt-guard-root, or any runtime shell markup.'
            )
        })
      }
    ),

    // ── update_page_file ──
    tool(
      async ({ pageId, content }, config) => {
        if (isMainScopeEdit) {
          throw new Error(
            "当前为主会话编辑（main），禁止调用 update_page_file；请改用 set_index_transition(type, durationMs)。"
          );
        }
        if (isEditMode && (!pageId || pageId.trim().length === 0)) {
          throw new Error("编辑模式调用 update_page_file 时必须显式传 pageId，避免自动游标误写到其它页面。");
        }
        const singleTargetPageId = resolveSingleTargetPageId();
        if (singleTargetPageId) {
          throw new Error(
            `当前为单页上下文（${singleTargetPageId}），禁止调用 update_page_file。请改用 update_single_page_file(pageId, content)。`
          );
        }
        return writePageFile({
          pageId,
          content,
          config
        });
      },
      {
        name: "update_page_file",
        description:
          'Multi-page generation/global edit tool. Disabled in single-page context. In generation mode pageId may be omitted to resolve pages by order; in edit mode pageId is required. content must be a complete, balanced page fragment containing section[data-page-scaffold] and main[data-block-id="content"][data-role="content"]. The tool wraps it as a complete HTML document and injects runtime assets. Do not pass a full HTML document, runtime page shell, or ppt-page-root/content/fit-scope markup. HTML is validated before writing.',
        schema: z.object({
          pageId: z
            .string()
            .optional()
            .describe(
              "Optional target section id, such as page-1. If omitted, the tool resolves the page from context/order."
            ),
          content: z
            .string()
            .describe(
              'Complete page HTML fragment only. It must include one balanced section[data-page-scaffold] wrapping one balanced main[data-block-id="content"][data-role="content"]. Do not pass <!doctype>, <html>, <head>, <body>, .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, data-ppt-guard-root, or any runtime shell markup.'
            )
        })
      }
    ),

    // ── verify_completion ──
    tool(
      async (_input, config) => {
        if (isMainScopeEdit) {
          emitNormalizedToolStatus(config, {
            label: uiText(context.appLocale, "验证完成状态", "Verifying completion"),
            detail: uiText(
              context.appLocale,
              "正在检查 index.html 总览壳结构",
              "Checking the index.html overview shell structure"
            ),
            progress: 88
          });
          if (!fs.existsSync(context.indexPath)) {
            return `验证失败：index.html 缺失（${context.indexPath}）。请检查会话文件是否完整。`;
          }
          const indexHtml = await fs.promises.readFile(context.indexPath, "utf-8");
          const indexErrors = validateIndexShellHtml(indexHtml);
          if (indexErrors.length > 0) {
            return `验证失败：index.html 结构不完整：${indexErrors.join("; ")}`;
          }
          emitNormalizedToolStatus(config, {
            label: uiText(context.appLocale, "index 壳验证通过", "Index shell verified"),
            detail: uiText(context.appLocale, "index.html 关键结构完整", "Key index.html structure is complete"),
            progress: 95
          });
          return "验证通过：index.html 已更新且结构完整。";
        }
        emitNormalizedToolStatus(config, {
          label: uiText(context.appLocale, "验证完成状态", "Verifying completion"),
          detail: uiText(
            context.appLocale,
            "正在检查所有 page 文件是否已填充",
            "Checking whether all page files are filled"
          ),
          progress: 88
        });
        const pageIds = Object.keys(context.pageFileMap);
        const targetPageIds =
          Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
            ? pageIds.filter((pid) => context.allowedPageIds!.includes(pid))
            : pageIds;
        const results: Array<{
          pageId: string;
          filled: boolean;
          hasContent: boolean;
          hasRemoteRuntime: boolean;
        }> = [];
        for (const pid of targetPageIds) {
          const pagePath = context.pageFileMap[pid];
          const exists = fs.existsSync(pagePath);
          const content = exists ? await fs.promises.readFile(pagePath, "utf-8") : "";
          const filled = exists && content.trim().length > 0;
          const hasContent = filled && !content.includes("等待模型填充这一页内容");
          const hasRemoteRuntime = extractRemoteRuntimeResources(content).length > 0;
          results.push({ pageId: pid, filled, hasContent, hasRemoteRuntime });
        }
        const missingFiles = results.filter((r) => !r.filled).map((r) => r.pageId);
        const emptyPages = results.filter((r) => r.filled && !r.hasContent).map((r) => r.pageId);
        const remoteRuntimePages = results.filter((r) => r.hasRemoteRuntime).map((r) => r.pageId);
        const filledCount = results.filter((r) => r.hasContent).length;
        if (missingFiles.length > 0) {
          return `验证发现问题：以下页面文件缺失或为空: ${missingFiles.join(", ")}。请检查 page-x.html 是否已创建。`;
        }
        if (emptyPages.length > 0) {
          return `部分页面尚未填充: ${emptyPages.join(", ")}。已完成 ${filledCount}/${targetPageIds.length} 页。单页任务请用 update_single_page_file(pageId, content)，多页任务请用 update_page_file(content) 继续填充。`;
        }
        if (remoteRuntimePages.length > 0) {
          return `验证失败：以下页面包含禁止的 CDN/远程 script/link 资源: ${remoteRuntimePages.join(", ")}。请移除外链并仅使用系统预注入的本地 ./assets/* 资源。`;
        }
        const isSinglePageCheck = targetPageIds.length === 1;
        emitNormalizedToolStatus(config, {
          label: isSinglePageCheck
            ? uiText(context.appLocale, "当前页面已填充", "Current page filled")
            : uiText(context.appLocale, "所有页面已填充", "All pages filled"),
          detail: isSinglePageCheck
            ? uiText(context.appLocale, `${targetPageIds[0]} 已完成`, `${targetPageIds[0]} completed`)
            : uiText(
                context.appLocale,
                `${filledCount}/${targetPageIds.length} 页已完成`,
                `${filledCount}/${targetPageIds.length} pages completed`
              ),
          progress: 95
        });
        return isSinglePageCheck
          ? `验证通过：${targetPageIds[0]} 已成功填充。${JSON.stringify(results, null, 2)}`
          : `验证通过：全部 ${targetPageIds.length} 页已成功填充。${JSON.stringify(results, null, 2)}`;
      },
      {
        name: "verify_completion",
        description:
          "Verify that all page files have been filled correctly. Use after update_single_page_file or update_page_file.",
        schema: z.object({})
      }
    ),
    ...searchTools
  ];
}
