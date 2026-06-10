import {
  DEFAULT_INDEX_TRANSITION_CONFIG,
  INDEX_TRANSITION_TYPES,
  clampIndexTransitionDuration,
  normalizeIndexTransitionConfig,
  normalizeIndexTransitionType,
  type IndexTransitionConfig,
  type IndexTransitionType
} from '../../shared/index-transition'

export {
  DEFAULT_INDEX_TRANSITION_CONFIG,
  INDEX_TRANSITION_TYPES,
  clampIndexTransitionDuration,
  normalizeIndexTransitionConfig,
  normalizeIndexTransitionType
}
export type { IndexTransitionConfig, IndexTransitionType }

const INDEX_TRANSITION_STYLE_RE =
  /\n?\s*<style\b[^>]*id=["']ppt-index-transition-style["'][^>]*>[\s\S]*?<\/style>/gi
const INDEX_TRANSITION_CONFIG_RE =
  /\n?\s*<script\b[^>]*id=["']ppt-index-transition-config["'][^>]*>[\s\S]*?<\/script>/gi
const INDEX_RUNTIME_SCRIPT_RE =
  /<script\b[^>]*\bsrc=["'][^"']*assets\/index-runtime\.js(?:[?#][^"']*)?["'][^>]*>\s*<\/script>/i
const ANIME_SCRIPT_RE =
  /<script\b[^>]*\bsrc=["'][^"']*assets\/anime\.v4\.js(?:[?#][^"']*)?["'][^>]*>\s*<\/script>/i
const PRESENT_BACKGROUND_STYLE_RE =
  /\n?\s*<style\b[^>]*id=["']ppt-present-background-style["'][^>]*>[\s\S]*?<\/style>/i

const PRESENT_BACKGROUND_STYLE = `<style id="ppt-present-background-style">
      body.present { background: #000000 !important; }
      body.present .ppt-layout,
      body.present .ppt-stage,
      body.present .ppt-preview-viewport {
        background: #000000 !important;
      }
    </style>`

export function validateIndexShellHtml(content: string): string[] {
  const errors: string[] = []
  if (!/<html[\s>]/i.test(content)) errors.push('缺少 <html> 标签')
  if (!/<body[\s>]/i.test(content)) errors.push('缺少 <body> 标签')
  if (!/<\/body>/i.test(content)) errors.push('缺少 </body> 闭合标签')
  if (!/<\/html>/i.test(content)) errors.push('缺少 </html> 闭合标签')
  if (!/id=["']frameViewport["']/i.test(content)) errors.push('缺少 frameViewport 容器')
  if (!/id=["']pages-data["']/i.test(content)) errors.push('缺少 pages-data 元数据脚本')
  if (!/ppt-preview-frame/i.test(content)) errors.push('缺少 .ppt-preview-frame 预览 iframe 壳')
  if (!/ppt-controls/i.test(content)) errors.push('缺少 .ppt-controls 控制栏')

  const openScriptCount = (content.match(/<script\b/gi) || []).length
  const closeScriptCount = (content.match(/<\/script>/gi) || []).length
  if (closeScriptCount < openScriptCount) {
    errors.push('存在未闭合的 <script> 标签')
  }

  const pagesDataMatch = content.match(
    /<script\b[^>]*id=["']pages-data["'][^>]*>([\s\S]*?)<\/script>/i
  )
  if (!pagesDataMatch) {
    errors.push('pages-data 脚本缺失或未闭合')
  } else {
    try {
      const parsed = JSON.parse((pagesDataMatch[1] || '').trim() || '[]')
      if (!Array.isArray(parsed)) {
        errors.push('pages-data 必须是 JSON 数组')
      }
    } catch (error) {
      errors.push(
        `pages-data JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const hasExternalRuntime = INDEX_RUNTIME_SCRIPT_RE.test(content)
  const inlineScriptMatches = Array.from(
    content.matchAll(
      /<script\b(?![^>]*\bsrc=)(?![^>]*type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi
    )
  )
  if (inlineScriptMatches.length === 0 && !hasExternalRuntime) {
    errors.push('缺少主逻辑脚本')
  }

  for (const [index, match] of inlineScriptMatches.entries()) {
    const scriptBody = (match[1] || '').trim()
    if (!scriptBody) {
      errors.push(`第 ${index + 1} 个内联脚本为空`)
      continue
    }
    try {
      new Function(scriptBody)
    } catch (error) {
      errors.push(
        `第 ${index + 1} 个内联脚本语法错误: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  if (!hasExternalRuntime && inlineScriptMatches.length > 0) {
    const mergedInlineScripts = inlineScriptMatches
      .map((match) => String(match[1] || ''))
      .join('\n')
    if (!/hashchange/i.test(mergedInlineScripts)) errors.push('缺少 hashchange 路由监听逻辑')
    if (!/applyPage/i.test(mergedInlineScripts)) errors.push('缺少 applyPage 页面切换逻辑')
    if (!/framePool/i.test(mergedInlineScripts)) errors.push('缺少 framePool iframe 池逻辑')
  }

  return errors
}

export function buildIndexTransitionConfigScript(config: IndexTransitionConfig): string {
  return `<script id="ppt-index-transition-config" type="application/json">${JSON.stringify(config)}</script>`
}

export function parseIndexTransitionConfig(html: string): IndexTransitionConfig {
  const match = html.match(
    /<script\b[^>]*id=["']ppt-index-transition-config["'][^>]*>([\s\S]*?)<\/script>/i
  )
  if (!match) return DEFAULT_INDEX_TRANSITION_CONFIG
  try {
    const parsed = JSON.parse((match[1] || '').trim() || '{}') as {
      type?: unknown
      durationMs?: unknown
    }
    return normalizeIndexTransitionConfig(parsed)
  } catch {
    return DEFAULT_INDEX_TRANSITION_CONFIG
  }
}

export function ensureIndexAnimeScript(html: string): string {
  if (ANIME_SCRIPT_RE.test(html)) return html
  const animeScript = '<script src="./assets/anime.v4.js"></script>'
  if (INDEX_RUNTIME_SCRIPT_RE.test(html)) {
    return html.replace(INDEX_RUNTIME_SCRIPT_RE, `${animeScript}\n    $&`)
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `  ${animeScript}\n  </body>`)
  }
  return `${html}\n${animeScript}`
}

export function ensureIndexPresentBackgroundStyle(html: string): string {
  if (PRESENT_BACKGROUND_STYLE_RE.test(html)) return html
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    ${PRESENT_BACKGROUND_STYLE}\n  </head>`)
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `  ${PRESENT_BACKGROUND_STYLE}\n  </body>`)
  }
  return `${html}\n${PRESENT_BACKGROUND_STYLE}`
}

export function patchIndexTransitionConfig(
  html: string,
  input: { type?: unknown; durationMs?: unknown }
): string {
  const config = normalizeIndexTransitionConfig(input)
  const withoutOldArtifacts = html
    .replace(INDEX_TRANSITION_STYLE_RE, '')
    .replace(INDEX_TRANSITION_CONFIG_RE, '')
  const withAnime = ensureIndexAnimeScript(withoutOldArtifacts)
  const configScript = buildIndexTransitionConfigScript(config)
  if (INDEX_RUNTIME_SCRIPT_RE.test(withAnime)) {
    return withAnime.replace(INDEX_RUNTIME_SCRIPT_RE, `${configScript}\n    $&`)
  }
  if (/<\/body>/i.test(withAnime)) {
    return withAnime.replace(/<\/body>/i, `  ${configScript}\n  </body>`)
  }
  if (/<\/head>/i.test(withAnime)) {
    return withAnime.replace(/<\/head>/i, `  ${configScript}\n  </head>`)
  }
  return `${withAnime}\n${configScript}`
}

export function carryIndexTransitionConfig(previousHtml: string, nextHtml: string): string {
  return patchIndexTransitionConfig(nextHtml, parseIndexTransitionConfig(previousHtml))
}
