export const SESSION_ASSET_FILES = {
  anime: "anime.v4.js",
  gsap: "gsap.min.js",
  chart: "chart.v4.js",
  tailwind: "tailwindcss.v3.js",
  katexStyle: "katex/katex.min.css",
  katex: "katex/katex.min.js",
  katexAutoRender: "katex/katex-auto-render.min.js",
  runtime: "ppt-runtime.js",
  indexRuntime: "index-runtime.js",
} as const;

export const SESSION_ASSET_FILE_NAMES = Object.values(SESSION_ASSET_FILES);

export const SESSION_ASSET_SCRIPT_SRCS = {
  anime: `./assets/anime.v4.js`,
  gsap: `./assets/gsap.min.js`,
  chart: `./assets/chart.v4.js`,
  tailwind: `./assets/tailwindcss.v3.js`,
  katex: `./assets/katex/katex.min.js`,
  katexAutoRender: `./assets/katex/katex-auto-render.min.js`,
  runtime: `./assets/ppt-runtime.js`,
} as const;

export const SESSION_ASSET_STYLE_HREFS = {
  katex: `./assets/katex/katex.min.css`,
} as const;

export const buildSessionAssetHeadTags = (): string =>
  [
    `<link rel="stylesheet" href="${SESSION_ASSET_STYLE_HREFS.katex}" />`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.gsap}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.anime}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.tailwind}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.chart}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.katex}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.katexAutoRender}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.runtime}"></script>`,
  ].join("\n    ");
