/** HTML template builders for multi-page preview architecture. */
import { escapeHtml } from '../utils'
import * as cheerio from 'cheerio'
import { BASE_PAGE_STYLE_TAG, FIT_SCRIPT } from '../../tools'
import { buildSessionAssetHeadTags } from './page-assets'
import {
  DEFAULT_INDEX_TRANSITION_CONFIG,
  buildIndexTransitionConfigScript
} from '../../session/index-transition'

export interface DeckPageFile {
  id?: string
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
}

export {
  SESSION_ASSET_FILES,
  SESSION_ASSET_FILE_NAMES,
  SESSION_ASSET_SCRIPT_SRCS,
  SESSION_ASSET_STYLE_HREFS,
  buildSessionAssetHeadTags
} from './page-assets'

export const buildPageScaffoldHtml = (page: {
  pageNumber: number
  pageId: string
  title: string
}): string => {
  const safeTitle = escapeHtml(page.title || `第 ${page.pageNumber} 页`)
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    ${buildSessionAssetHeadTags()}
    ${BASE_PAGE_STYLE_TAG}
    <style>
      .scaffold-card {
        width: 100%;
        height: 100%;
        border-radius: 24px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        padding: 28px;
      }
      .scaffold-title {
        margin: 0;
        font-size: 48px;
        line-height: 1.2;
        color: #0f172a;
      }
      .scaffold-hint {
        margin-top: 14px;
        font-size: 16px;
        color: #94a3b8;
      }
    </style>
  </head>
  <body data-page-id="${page.pageId}">
    <main class="ppt-page-root" data-ppt-guard-root="1">
      <div class="ppt-page-fit-scope">
        <div class="ppt-page-content">
          <section class="scaffold-card" data-page-scaffold="1" data-placeholder-page="1">
            <main data-block-id="content" data-role="content">
              <h1 class="scaffold-title" data-block-id="title" data-role="title">${safeTitle}</h1>
              <div class="scaffold-hint">等待模型填充这一页内容</div>
            </main>
          </section>
        </div>
      </div>
    </main>
    ${FIT_SCRIPT}
  </body>
</html>`
}

export const buildProjectIndexHtml = (title: string, pages: DeckPageFile[]): string => {
  const safeTitle = escapeHtml(title || 'OhMyPPT Preview')
  const pagesData = JSON.stringify(
    pages.map((page) => ({
      id: page.id || undefined,
      pageNumber: page.pageNumber,
      pageId: page.pageId,
      title: page.title,
      htmlPath: page.htmlPath
    }))
  ).replace(/</g, '\\u003c')
  const thumbButtons = pages
    .map(
      (page) => {
        const pageKey = page.id || page.pageId
        return `<button class="ppt-thumb-item" data-page-id="${pageKey}" data-legacy-page-id="${page.pageId}">
  <div class="ppt-thumb-index">P${page.pageNumber}</div>
  <div class="ppt-thumb-title">${escapeHtml(page.title)}</div>
</button>`
      }
    )
    .join('\n')

  const frameElements = pages
    .map(
      (page) => {
        const pageKey = page.id || page.pageId
        return `<iframe class="ppt-preview-frame" data-page-id="${pageKey}" data-legacy-page-id="${page.pageId}" title="${escapeHtml(page.title)}"></iframe>`
      }
    )
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle} · Preview</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        height: 100%;
      }
      body {
        margin: 0;
        font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
        background: linear-gradient(160deg, #eef6ff 0%, #f8fbff 55%, #eef2ff 100%);
        color: #1e293b;
        overflow: hidden;
      }
      .ppt-layout {
        height: 100vh;
        height: 100dvh;
        padding: 0;
      }
      .ppt-stage {
        background: #ffffff;
        height: 100%;
        min-height: 0;
        border-radius: 0;
        overflow: hidden;
        padding: 0;
      }
      .ppt-preview-viewport {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 0;
        overflow: hidden;
        background: #ffffff;
      }
      .ppt-preview-frame {
        position: absolute;
        left: 0;
        top: 0;
        width: 1600px;
        height: 900px;
        transform-origin: top left;
        border: none;
        background: white;
        display: none;
      }
      .ppt-preview-frame.active { display: block; }
      .ppt-deck-switcher {
        position: fixed;
        right: 18px;
        bottom: 82px;
        width: min(320px, calc(100vw - 32px));
        max-height: min(54vh, 520px);
        overflow: auto;
        display: none;
        padding: 14px;
        border-radius: 20px;
        border: 1px solid rgba(148,163,184,0.24);
        background: rgba(255,255,255,0.92);
        box-shadow: 0 18px 48px rgba(15,23,42,0.16);
        backdrop-filter: blur(14px);
      }
      .ppt-deck-switcher.open { display: block; }
      .ppt-thumb-item {
        width: 100%;
        text-align: left;
        border: 1px solid transparent;
        border-radius: 14px;
        background: rgba(248,250,252,0.9);
        padding: 10px;
        cursor: pointer;
      }
      .ppt-thumb-item + .ppt-thumb-item { margin-top: 8px; }
      .ppt-thumb-item.active {
        border-color: rgba(59,130,246,0.45);
        background: rgba(219,234,254,0.7);
      }
      .ppt-thumb-index {
        font-size: 11px;
        color: #64748b;
      }
      .ppt-thumb-title {
        margin-top: 4px;
        font-size: 13px;
        color: #0f172a;
        font-weight: 600;
      }
      .ppt-controls {
        position: fixed;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 14px;
        border: 1px solid rgba(148,163,184,0.24);
        background: rgba(255,255,255,0.92);
        box-shadow: 0 10px 26px rgba(15,23,42,0.13);
        backdrop-filter: blur(8px);
      }
      .ppt-control-btn {
        border: 1px solid rgba(148,163,184,0.24);
        background: rgba(248,250,252,0.9);
        color: #334155;
        border-radius: 10px;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .ppt-indicator {
        min-width: 88px;
        text-align: center;
        color: #475569;
        font-size: 13px;
        font-weight: 600;
      }
      body.present { background: #000000; }
      body.present .ppt-layout { padding: 0; background: #000000; }
      body.present .ppt-stage { border-radius: 0; border: none; box-shadow: none; padding: 0; background: #000000; }
      body.present .ppt-preview-viewport { border-radius: 0; background: #000000; }
      body.present .ppt-controls, body.present .ppt-deck-switcher { display: none !important; }
      body.embed .ppt-layout { padding: 0; }
      body.embed .ppt-stage { border-radius: 0; border: none; box-shadow: none; padding: 0; }
      body.embed .ppt-preview-viewport { border-radius: 0; }
      body.embed .ppt-controls, body.embed .ppt-deck-switcher { display: none !important; }
      .ppt-empty {
        position: absolute;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        color: #64748b;
        background: linear-gradient(180deg, rgba(241,245,249,0.7) 0%, rgba(248,250,252,0.8) 100%);
      }
      body.empty .ppt-empty { display: flex; }
      body.empty iframe { display: none; }
    </style>
  </head>
  <body>
    <div class="ppt-layout">
      <section class="ppt-stage">
        <div id="frameViewport" class="ppt-preview-viewport">
          ${frameElements}
          <div class="ppt-empty">暂无页面，请先生成 /&lt;pageId&gt;.html 内容</div>
        </div>
      </section>
    </div>
    <aside class="ppt-deck-switcher" id="deckSwitcher">
      <div id="thumbs">${thumbButtons}</div>
    </aside>
    <div class="ppt-controls">
      <button class="ppt-control-btn" id="prevBtn">上一页</button>
      <div class="ppt-indicator" id="indicator"></div>
      <button class="ppt-control-btn" id="nextBtn">下一页</button>
      <button class="ppt-control-btn" id="tabsBtn">页面目录</button>
      <button class="ppt-control-btn" id="presentBtn">演示模式（ESC退出）</button>
      <button class="ppt-control-btn" id="fullscreenBtn">全屏</button>
    </div>
    <script type="application/json" id="pages-data">${pagesData}</script>
    ${buildIndexTransitionConfigScript(DEFAULT_INDEX_TRANSITION_CONFIG)}
    <script src="./assets/anime.v4.js"></script>
    <script src="./assets/index-runtime.js"></script>
  </body>
</html>`
}

export const buildProjectIndexScaffold = (
  title: string,
  pages: Array<{ pageNumber: number; title: string; pageId: string }>
): string => {
  return buildProjectIndexHtml(
    title || 'OhMyPPT Preview',
    pages.map((page) => ({
      pageNumber: page.pageNumber,
      pageId: page.pageId,
      title: page.title,
      htmlPath: `${page.pageId}.html`
    }))
  )
}

export const extractPagesDataFromIndex = (
  indexHtml: string
): Array<{
  id?: string
  pageNumber: number
  pageId: string
  title: string
  html: string
  htmlPath?: string
}> => {
  const $ = cheerio.load(indexHtml, { scriptingEnabled: false })
  const pagesDataText = $('script#pages-data').text()
  const metadata = (() => {
    try {
      const parsed = JSON.parse(pagesDataText)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })() as Array<{
    pageNumber?: number
    id?: string
    pageId?: string
    title?: string
    htmlPath?: string
  }>

  if (metadata.length === 0) return []

  return metadata.map((item, index) => {
    const pageNumber = Number(item.pageNumber) || index + 1
    const pageId = String(item.pageId || `page-${pageNumber}`)
    const rawPath = typeof item.htmlPath === 'string' ? item.htmlPath.trim() : ''
    return {
      id: typeof item.id === 'string' ? item.id : undefined,
      pageNumber,
      pageId,
      title: String(item.title || `Page ${pageNumber}`),
      html: '',
      htmlPath: rawPath.length > 0 ? rawPath : `${pageId}.html`
    }
  })
}
