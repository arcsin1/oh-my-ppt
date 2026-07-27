const cssString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

const IMPORTED_PAGE_DEFAULT_FONT_PATTERN =
  /font-family:\s*"SF Pro Text",\s*"PingFang SC",\s*"Helvetica Neue",\s*Arial,\s*sans-serif;/

export const applyTemplateDefaultFonts = (
  html: string,
  fonts: {
    titleFont: string
    bodyFont: string
  }
): string => {
  const fontStyle = `<style data-ppt-fonts="1">:root{--ppt-title-font:"${cssString(
    fonts.titleFont
  )}";--ppt-body-font:"${cssString(fonts.bodyFont)}"}</style>`
  const withFontVariables = /<style\b[^>]*data-ppt-fonts=["']1["'][^>]*>[\s\S]*?<\/style>/i.test(
    html
  )
    ? html.replace(
        /<style\b[^>]*data-ppt-fonts=["']1["'][^>]*>[\s\S]*?<\/style>/i,
        fontStyle
      )
    : html.replace(/<\/head>/i, `${fontStyle}\n</head>`)

  return withFontVariables.replace(
    IMPORTED_PAGE_DEFAULT_FONT_PATTERN,
    'font-family: var(--ppt-body-font);'
  )
}
