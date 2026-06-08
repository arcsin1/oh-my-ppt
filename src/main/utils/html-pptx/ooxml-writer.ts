import { zipSync, strToU8 } from 'fflate'
import { writeFileSync } from 'fs'
import type {
  HtmlToPptxDocument,
  HtmlToPptxSlide,
  HtmlToPptxTextBox,
  HtmlToPptxTextRun,
  HtmlToPptxShape,
  HtmlToPptxImage,
  HtmlToPptxTable,
  HtmlToPptxTableCell,
  HtmlToPptxEmbeddedFont,
  HtmlToPptxAnimationTrace
} from './types'
import {
  buildSlideTimingXml,
  buildSlideTransitionXml,
  type PptxTargetAnimation
} from './animation-writer'

// ─── Constants ───────────────────────────────────────────────────────
const EMU_PER_INCH = 914400
const SLIDE_WIDTH_IN = 13.333333333  // exact 16:9 = 12192000 / 914400
const SLIDE_HEIGHT_IN = 7.5
const SLIDE_WIDTH_EMU = 12192000
const SLIDE_HEIGHT_EMU = 6858000
const PPTX_TRACE_WIDTH_PX = 1600
const PPTX_TRACE_HEIGHT_PX = 900

const inToEmu = (inches: number): number => Math.round(inches * EMU_PER_INCH)
const ptToEmu = (pt: number): number => Math.round(pt * 12700)
const degToRot = (deg: number): number => Math.round(deg * 60000)

// ─── XML helpers ─────────────────────────────────────────────────────
const escapeXml = (str: string): string =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const mapAlign = (align?: string): string => {
  switch (align) {
    case 'center': return 'ctr'
    case 'right': return 'r'
    case 'justify': return 'just'
    default: return 'l'
    }
}

const mapShapePreset = (shapeType?: string): string => {
  switch (shapeType) {
    case 'ellipse': return 'ellipse'
    case 'roundRect': return 'roundRect'
    default: return 'rect'
  }
}

const normalizeHexColor = (color: string | undefined, fallback = '000000'): string => {
  if (!color) return fallback
  const trimmed = color.trim().replace(/^#/, '').toUpperCase()
  if (/^[0-9A-F]{3}$/.test(trimmed)) {
    return trimmed.split('').map(c => c + c).join('')
  }
  return /^[0-9A-F]{6}$/.test(trimmed) ? trimmed : fallback
}

// ─── Element builders ────────────────────────────────────────────────

function buildRunXml(run: HtmlToPptxTextRun, fallbackFontSize: number, fallbackFontFace: string, opacity?: number): string {
  const lang = /[\u4e00-\u9fff]/.test(run.text) ? 'zh-CN' : 'en-US'
  const sz = run.fontSize ? ` sz="${Math.round(run.fontSize * 100)}"` : (fallbackFontSize ? ` sz="${Math.round(fallbackFontSize * 100)}"` : '')
  const b = run.bold ? ' b="1"' : ''
  const i = run.italic ? ' i="1"' : ''
  const u = run.underline ? ' u="sng"' : ''
  const strike = run.strike ? ' strike="sngStrike"' : ''
  const fillXml = buildColorFillXml(run.color || '111827', opacity)
  const fontFace = run.fontFace || fallbackFontFace || 'Aptos'

  return `<a:r>
          <a:rPr lang="${lang}"${sz}${b}${i}${u}${strike} dirty="0">
            ${fillXml}
            <a:latin typeface="${escapeXml(fontFace)}"/>
            <a:ea typeface="${escapeXml(fontFace)}"/>
          </a:rPr>
          <a:t>${escapeXml(run.text)}</a:t>
        </a:r>`
}

function buildTextShape(id: number, tb: HtmlToPptxTextBox): string {
  const text = normalizePptxText(tb.text)
  if (!text && !tb.runs?.length) return ''

  const hasRuns = tb.runs && tb.runs.length > 0

  const buildParagraph = (lineText: string, runs?: HtmlToPptxTextRun[]): string => {
    const pPrParts: string[] = []
    if (tb.align && tb.align !== 'left') {
      pPrParts.push(` algn="${mapAlign(tb.align)}"`)
    }
    if (tb.bullet) {
      const level = Math.max(0, Math.min(8, Math.floor(tb.bullet.level || 0)))
      const marL = 342900 + level * 228600
      const indent = -171450
      pPrParts.push(` marL="${marL}" indent="${indent}"`)
    }
    if (tb.paragraphSpacingBefore && tb.paragraphSpacingBefore > 0) {
      pPrParts.push(
        `<a:spcBef><a:spcPts val="${Math.round(tb.paragraphSpacingBefore * 100)}"/></a:spcBef>`
      )
    }
    if (tb.paragraphSpacingAfter && tb.paragraphSpacingAfter > 0) {
      pPrParts.push(
        `<a:spcAft><a:spcPts val="${Math.round(tb.paragraphSpacingAfter * 100)}"/></a:spcAft>`
      )
    }
    if (tb.lineSpacing && tb.lineSpacing > 0) {
      pPrParts.push(
        `<a:lnSpc><a:spcPts val="${Math.round(tb.lineSpacing * 100)}"/></a:lnSpc>`
      )
    }
    if (tb.bullet?.type === 'number') {
      const startAt = Math.max(1, Math.min(32767, Math.floor(tb.bullet.startAt || 1)))
      pPrParts.push(`<a:buAutoNum type="arabicPeriod" startAt="${startAt}"/>`)
    } else if (tb.bullet?.type === 'bullet') {
      pPrParts.push('<a:buFont typeface="Arial"/>')
      pPrParts.push('<a:buChar char="•"/>')
    }
    const pPr = pPrParts.length > 0
      ? `<a:pPr${pPrParts.filter(p => !p.startsWith('<')).join('')}>${pPrParts.filter(p => p.startsWith('<')).join('')}</a:pPr>`
      : '<a:pPr/>'

    let runsXml: string
    if (runs && runs.length > 0) {
      runsXml = runs.map(r => buildRunXml(r, tb.fontSize, tb.fontFace || 'Aptos', tb.opacity)).join('\n        ')
    } else {
      // Single run using text box level formatting
      const fillXml = buildColorFillXml(tb.color || '111827', tb.opacity)
      const lang = /[\u4e00-\u9fff]/.test(lineText) ? 'zh-CN' : 'en-US'
      const sz = tb.fontSize ? ` sz="${Math.round(tb.fontSize * 100)}"` : ''
      const b = tb.bold ? ' b="1"' : ''
      const i = tb.italic ? ' i="1"' : ''
      const u = tb.underline ? ' u="sng"' : ''
      const strike = tb.strike ? ' strike="sngStrike"' : ''
      const spc = tb.charSpacing ? ` spc="${Math.round(tb.charSpacing * 100)}"` : ''
      const fontFace = tb.fontFace || 'Aptos'
      runsXml = `<a:r>
          <a:rPr lang="${lang}"${sz}${b}${i}${u}${strike}${spc} dirty="0">
            ${fillXml}
            <a:latin typeface="${escapeXml(fontFace)}"/>
            <a:ea typeface="${escapeXml(fontFace)}"/>
          </a:rPr>
          <a:t>${escapeXml(lineText)}</a:t>
        </a:r>`
    }

    return `      <a:p>
        ${pPr}
        ${runsXml}
      </a:p>`
  }

  let paragraphs: string
  if (hasRuns) {
    // Multi-run: runs may contain newlines to split into paragraphs
    const runLines: HtmlToPptxTextRun[][] = [[]]
    for (const run of tb.runs!) {
      const parts = run.text.split('\n')
      for (let pi = 0; pi < parts.length; pi++) {
        if (pi > 0) runLines.push([])
        const partText = parts[pi]
        if (partText) {
          runLines[runLines.length - 1].push({ ...run, text: partText })
        }
      }
    }
    paragraphs = runLines
      .filter(lineRuns => lineRuns.length > 0)
      .map(lineRuns => buildParagraph('', lineRuns))
      .join('\n')
  } else {
    const lines = text.split('\n')
    paragraphs = lines.map(line => buildParagraph(line)).join('\n')
  }

  const rot = tb.rotate ? ` rot="${degToRot(tb.rotate)}"` : ''
  const wrap = tb.wrap ? 'square' : 'none'
  const autoFit = tb.wrap
    ? '<a:normAutofit fontScale="100000"/>'
    : '<a:noAutofit/>'
  const anchor =
    tb.verticalAlign === 'middle' ? 'ctr' : tb.verticalAlign === 'bottom' ? 'b' : 't'

  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="TextBox ${id}"/>
      <p:cNvSpPr txBox="1"/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm${rot}>
        <a:off x="${inToEmu(tb.x)}" y="${inToEmu(tb.y)}"/>
        <a:ext cx="${inToEmu(tb.w)}" cy="${inToEmu(tb.h)}"/>
      </a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="${wrap}" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}">${autoFit}</a:bodyPr>
      <a:lstStyle/>
${paragraphs}
    </p:txBody>
  </p:sp>`
}

function buildImagePic(id: number, rId: string, img: HtmlToPptxImage): string {
  const rot = img.rotate ? ` rot="${degToRot(img.rotate)}"` : ''
  const opacity =
    typeof img.opacity === 'number' && Number.isFinite(img.opacity)
      ? Math.max(0, Math.min(1, img.opacity))
      : 1
  const alphaXml =
    opacity < 0.999 ? `<a:alphaModFix amt="${Math.round(opacity * 100000)}"/>` : ''
  const blipXml = alphaXml
    ? `<a:blip r:embed="${rId}">${alphaXml}</a:blip>`
    : `<a:blip r:embed="${rId}"/>`
  return `<p:pic>
    <p:nvPicPr>
      <p:cNvPr id="${id}" name="Image ${id}"/>
      <p:cNvPicPr/>
      <p:nvPr/>
    </p:nvPicPr>
    <p:blipFill>
      ${blipXml}
      <a:stretch><a:fillRect/></a:stretch>
    </p:blipFill>
    <p:spPr>
      <a:xfrm${rot}>
        <a:off x="${inToEmu(img.x)}" y="${inToEmu(img.y)}"/>
        <a:ext cx="${inToEmu(img.w)}" cy="${inToEmu(img.h)}"/>
      </a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </p:spPr>
  </p:pic>`
}

function buildShapeXml(id: number, shape: HtmlToPptxShape): string {
  const preset = mapShapePreset(shape.shapeType)

  const rot = shape.rotate ? ` rot="${degToRot(shape.rotate)}"` : ''

  // Geometry
  let geomXml: string
  if (preset === 'roundRect' && shape.radius) {
    const fallbackRadiusIn = shape.radius / 120
    const fallbackAdj =
      Math.min(shape.w, shape.h) > 0
        ? Math.round((fallbackRadiusIn / Math.min(shape.w, shape.h)) * 100000)
        : 0
    const adj = Math.min(50000, Math.max(0, Math.round(shape.radiusAdj || fallbackAdj)))
    geomXml = `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`
  } else {
    geomXml = `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`
  }

  // Fill
  let fillXml: string
  if (shape.fill) {
    const color = normalizeHexColor(shape.fill)
    const alphaVal = shape.transparency !== undefined
      ? Math.round((100 - shape.transparency) * 1000)
      : 100000
    fillXml = alphaVal < 100000
      ? `<a:solidFill><a:srgbClr val="${color}"><a:alpha val="${alphaVal}"/></a:srgbClr></a:solidFill>`
      : `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`
  } else {
    fillXml = '<a:noFill/>'
  }

  // Border
  let borderXml: string
  if (shape.border) {
    const bColor = normalizeHexColor(shape.border.color)
    const bWidth = ptToEmu(shape.border.widthPt)
    const bAlphaVal = shape.border.transparency !== undefined
      ? Math.round((100 - shape.border.transparency) * 1000)
      : 100000
    const dashVal = shape.border.dash === 'dash' ? 'dash' : 'solid'
    const borderFill = bAlphaVal < 100000
      ? `<a:solidFill><a:srgbClr val="${bColor}"><a:alpha val="${bAlphaVal}"/></a:srgbClr></a:solidFill>`
      : `<a:solidFill><a:srgbClr val="${bColor}"/></a:solidFill>`
    borderXml = `<a:ln w="${bWidth}">${borderFill}<a:prstDash val="${dashVal}"/></a:ln>`
  } else {
    borderXml = '<a:ln><a:noFill/></a:ln>'
  }

  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="Shape ${id}"/>
      <p:cNvSpPr/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm${rot}>
        <a:off x="${inToEmu(shape.x)}" y="${inToEmu(shape.y)}"/>
        <a:ext cx="${inToEmu(shape.w)}" cy="${inToEmu(shape.h)}"/>
      </a:xfrm>
      ${geomXml}
      ${fillXml}
      ${borderXml}
    </p:spPr>
  </p:sp>`
}

function buildColorFillXml(color: string, opacity?: number): string {
  const hex = normalizeHexColor(color)
  if (opacity !== undefined && opacity < 1) {
    const alphaVal = Math.round(opacity * 100000)
    return `<a:solidFill><a:srgbClr val="${hex}"><a:alpha val="${alphaVal}"/></a:srgbClr></a:solidFill>`
  }
  return `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`
}

function normalizePptxText(value: string): string {
  const lines = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
  while (lines.length > 0 && !lines[0]) lines.shift()
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop()
  return lines.join('\n')
}

// ─── Table ───────────────────────────────────────────────────────────

function buildTableXml(id: number, table: HtmlToPptxTable): string {
  const maxCols = table.colWidths.length > 0
    ? table.colWidths.length
    : Math.max(1, ...table.rows.map(r => r.reduce((s, c) => s + Math.max(1, c.colspan || 1), 0)))

  // Build occupied grid for merge handling
  const totalRows = table.rows.length
  type TableGridEntry = {
    cell: HtmlToPptxTableCell
    origin: boolean
    rowSpan: number
    colSpan: number
    hMerge: boolean
    vMerge: boolean
  }
  const cellGrid: (TableGridEntry | null)[][] = Array.from(
    { length: totalRows },
    () => new Array<TableGridEntry | null>(maxCols).fill(null)
  )

  for (let r = 0; r < totalRows; r++) {
    let col = 0
    for (const cell of table.rows[r]) {
      const rs = Math.max(1, cell.rowspan || 1)
      const cs = Math.max(1, cell.colspan || 1)
      while (col < maxCols && cellGrid[r][col]) col++
      if (col >= maxCols) break
      const rowSpan = Math.min(rs, totalRows - r)
      const colSpan = Math.min(cs, maxCols - col)
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          cellGrid[r + dr][col + dc] = {
            cell,
            origin: dr === 0 && dc === 0,
            rowSpan,
            colSpan,
            hMerge: dc > 0,
            vMerge: dr > 0
          }
        }
      }
      col += colSpan
    }
  }

  // Grid columns
  const gridCols = table.colWidths.length > 0
    ? table.colWidths
    : Array(maxCols).fill(table.w / maxCols)

  const gridColsXml = gridCols
    .map(w => `<a:gridCol w="${inToEmu(w)}"/>`)
    .join('\n      ')

  // Build rows
  const emptyCellXml = (attrs = ''): string => `<a:tc${attrs}>
          <a:txBody>
            <a:bodyPr/>
            <a:lstStyle/>
            <a:p><a:endParaRPr lang="zh-CN"/></a:p>
          </a:txBody>
          <a:tcPr/>
        </a:tc>`

  const rowsXml = table.rows.map((_row, rIdx) => {
    const rowHeight = table.rowHeights[rIdx] || (table.h / totalRows)
    const cellsXml: string[] = []

    for (let colIdx = 0; colIdx < maxCols; colIdx++) {
      const gridEntry = cellGrid[rIdx][colIdx]
      if (!gridEntry) {
        cellsXml.push(emptyCellXml())
        continue
      }
      if (!gridEntry.origin) {
        const mergeAttrs = [
          gridEntry.hMerge ? 'hMerge="1"' : '',
          gridEntry.vMerge ? 'vMerge="1"' : ''
        ].filter(Boolean).join(' ')
        cellsXml.push(emptyCellXml(mergeAttrs ? ` ${mergeAttrs}` : ''))
        continue
      }

      const cell = gridEntry.cell
      const cs = gridEntry.colSpan
      const rs = gridEntry.rowSpan

      const gridSpanAttr = cs > 1 ? ` gridSpan="${cs}"` : ''
      const rowSpanAttr = rs > 1 ? ` rowSpan="${rs}"` : ''

      const cellText = normalizePptxText(cell.text || '')
      const lang = /[\u4e00-\u9fff]/.test(cellText) ? 'zh-CN' : 'en-US'
      const sz = cell.fontSize ? ` sz="${Math.round(cell.fontSize * 100)}"` : ''
      const b = cell.bold ? ' b="1"' : ''
      const i = cell.italic ? ' i="1"' : ''
      const u = cell.underline ? ' u="sng"' : ''
      const strike = cell.strike ? ' strike="sngStrike"' : ''
      const colorHex = normalizeHexColor(cell.color || '111827')
      const fontFace = cell.fontFace || 'Aptos'
      const algn = mapAlign(cell.align)

      let cellParaXml: string
      if (cellText) {
        cellParaXml = `<a:p>
              <a:pPr algn="${algn}"/>
              <a:r>
                <a:rPr lang="${lang}"${sz}${b}${i}${u}${strike} dirty="0">
                  <a:solidFill><a:srgbClr val="${colorHex}"/></a:solidFill>
                  <a:latin typeface="${escapeXml(fontFace)}"/>
                  <a:ea typeface="${escapeXml(fontFace)}"/>
                </a:rPr>
                <a:t>${escapeXml(cellText)}</a:t>
              </a:r>
            </a:p>`
      } else {
        cellParaXml = `<a:p><a:pPr algn="${algn}"/><a:endParaRPr lang="zh-CN"/></a:p>`
      }

      // Cell properties
      const tcPrParts: string[] = []
      const tcPrAttrs: string[] = []

      // DrawingML table cells use the tcPr anchor attribute for vertical alignment.
      if (cell.valign === 'middle') tcPrAttrs.push('anchor="ctr"')
      else if (cell.valign === 'bottom') tcPrAttrs.push('anchor="b"')

      // Fill
      if (cell.fill) {
        const fillHex = normalizeHexColor(cell.fill)
        const alphaVal = cell.fillTransparency !== undefined
          ? Math.round((100 - cell.fillTransparency) * 1000)
          : 100000
        if (alphaVal < 100000) {
          tcPrParts.push(`<a:solidFill><a:srgbClr val="${fillHex}"><a:alpha val="${alphaVal}"/></a:srgbClr></a:solidFill>`)
        } else {
          tcPrParts.push(`<a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill>`)
        }
      }

      // Borders
      if (cell.border) {
        const bColor = normalizeHexColor(cell.border.color)
        const bWidth = ptToEmu(cell.border.widthPt)
        const dashVal = cell.border.dash === 'dash' ? 'dash' : 'solid'
        const borderXml = `<a:solidFill><a:srgbClr val="${bColor}"/></a:solidFill><a:prstDash val="${dashVal}"/>`
        tcPrParts.push(
          `<a:lnL w="${bWidth}">${borderXml}</a:lnL>`,
          `<a:lnR w="${bWidth}">${borderXml}</a:lnR>`,
          `<a:lnT w="${bWidth}">${borderXml}</a:lnT>`,
          `<a:lnB w="${bWidth}">${borderXml}</a:lnB>`
        )
      } else {
        // Default thin border for table structure
        const defaultBorder = `<a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill>`
        tcPrParts.push(
          `<a:lnL w="12700">${defaultBorder}</a:lnL>`,
          `<a:lnR w="12700">${defaultBorder}</a:lnR>`,
          `<a:lnT w="12700">${defaultBorder}</a:lnT>`,
          `<a:lnB w="12700">${defaultBorder}</a:lnB>`
        )
      }

      const tcPrXml = tcPrParts.length > 0 || tcPrAttrs.length > 0
        ? `<a:tcPr${tcPrAttrs.length > 0 ? ` ${tcPrAttrs.join(' ')}` : ''}>${tcPrParts.join('')}</a:tcPr>`
        : ''

      cellsXml.push(`<a:tc${gridSpanAttr}${rowSpanAttr}>
          <a:txBody>
            <a:bodyPr/>
            <a:lstStyle/>
            ${cellParaXml}
          </a:txBody>
          ${tcPrXml}
        </a:tc>`)
    }

    return `<a:tr h="${inToEmu(rowHeight)}">\n      ${cellsXml.join('\n      ')}\n    </a:tr>`
  }).join('\n    ')

  return `<p:graphicFrame>
    <p:nvGraphicFramePr>
      <p:cNvPr id="${id}" name="Table ${id}"/>
      <p:cNvGraphicFramePr/>
      <p:nvPr/>
    </p:nvGraphicFramePr>
    <p:xfrm>
      <a:off x="${inToEmu(table.x)}" y="${inToEmu(table.y)}"/>
      <a:ext cx="${inToEmu(table.w)}" cy="${inToEmu(table.h)}"/>
    </p:xfrm>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblPr firstRow="0" lastRow="0" firstCol="0" lastCol="0" noBandRow="1" noBandCol="1">
          </a:tblPr>
          <a:tblGrid>
          ${gridColsXml}
          </a:tblGrid>
        ${rowsXml}
        </a:tbl>
      </a:graphicData>
    </a:graphic>
  </p:graphicFrame>`
}

// ─── Slide XML ───────────────────────────────────────────────────────

interface ImageRel {
  rId: string
  mediaFile: string
}

type SlideContentItem =
  | { kind: 'shape'; order: number; priority: number; item: HtmlToPptxShape }
  | { kind: 'table'; order: number; priority: number; item: HtmlToPptxTable }
  | { kind: 'image'; order: number; priority: number; item: HtmlToPptxImage }
  | { kind: 'text'; order: number; priority: number; item: HtmlToPptxTextBox }

interface SlideShapePosition {
  pptxId: number
  x: number
  y: number
  w: number
  h: number
}

const contentOrder = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Number(value) : fallback

const pxTraceToInches = (trace: HtmlToPptxAnimationTrace): Omit<SlideShapePosition, 'pptxId'> => ({
  x: (trace.x / PPTX_TRACE_WIDTH_PX) * SLIDE_WIDTH_IN,
  y: (trace.y / PPTX_TRACE_HEIGHT_PX) * SLIDE_HEIGHT_IN,
  w: (trace.w / PPTX_TRACE_WIDTH_PX) * SLIDE_WIDTH_IN,
  h: (trace.h / PPTX_TRACE_HEIGHT_PX) * SLIDE_HEIGHT_IN
})

const overlapArea = (
  left: Omit<SlideShapePosition, 'pptxId'>,
  right: Omit<SlideShapePosition, 'pptxId'>
): number => {
  const x = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
  const y = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y))
  return x * y
}

const centerInside = (
  inner: Omit<SlideShapePosition, 'pptxId'>,
  outer: Omit<SlideShapePosition, 'pptxId'>
): boolean => {
  const cx = inner.x + inner.w / 2
  const cy = inner.y + inner.h / 2
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h
}

function matchAnimationTracesToTargets(
  traces: HtmlToPptxAnimationTrace[] | undefined,
  shapePositions: SlideShapePosition[]
): PptxTargetAnimation[] {
  if (!traces?.length || shapePositions.length === 0) return []

  const animations: PptxTargetAnimation[] = []
  const claimed = new Set<number>()
  const orderedTraces = [...traces].sort((a, b) => a.order - b.order || a.delay - b.delay)

  for (const trace of orderedTraces) {
    const traceBox = pxTraceToInches(trace)
    const traceArea = Math.max(0.0001, traceBox.w * traceBox.h)
    const candidates = shapePositions
      .map((shape) => {
        const shapeBox = { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
        const overlap = overlapArea(traceBox, shapeBox)
        const shapeArea = Math.max(0.0001, shape.w * shape.h)
        const eligible =
          overlap > 0 &&
          (centerInside(shapeBox, traceBox) ||
            overlap / shapeArea >= 0.35 ||
            overlap / traceArea >= 0.16)
        return { shape, overlap, eligible }
      })
      .filter((candidate) => candidate.eligible && !claimed.has(candidate.shape.pptxId))
      .sort((a, b) => b.overlap - a.overlap || a.shape.pptxId - b.shape.pptxId)

    const targets = candidates.length > 0
      ? candidates.map((candidate) => candidate.shape)
      : shapePositions
          .map((shape) => {
            const shapeBox = { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
            return { shape, overlap: overlapArea(traceBox, shapeBox) }
          })
          .filter((candidate) => candidate.overlap > 0 && !claimed.has(candidate.shape.pptxId))
          .sort((a, b) => b.overlap - a.overlap)
          .slice(0, 1)
          .map((candidate) => candidate.shape)

    for (const target of targets) {
      claimed.add(target.pptxId)
      animations.push({
        spid: target.pptxId,
        type: trace.type,
        trigger: trace.trigger,
        from: trace.from,
        duration: trace.duration,
        delay: trace.delay,
        order: trace.order
      })
    }
  }

  return animations
}

export function buildSlideXml(
  slide: HtmlToPptxSlide,
  imageRels: Map<string, ImageRel>,
  idStart: number
): string {
  let nextId = idStart
  const shapes: string[] = []
  const shapePositions: SlideShapePosition[] = []

  const recordPosition = (pptxId: number, item: { x: number; y: number; w: number; h: number }) => {
    shapePositions.push({ pptxId, x: item.x, y: item.y, w: item.w, h: item.h })
  }

  // Background color
  let bgXml = ''
  if (slide.backgroundColor) {
    const hex = normalizeHexColor(slide.backgroundColor)
    bgXml = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
  }

  // Z-order: keep the extracted DOM paint order instead of placing all shapes
  // above/below all images. This keeps background SVGs behind cards while card
  // icons and chart canvases stay above their parent container shapes.

  // Background image
  if (slide.backgroundImage) {
    nextId++
    const rel = imageRels.get(slide.backgroundImage.dataUri)
    if (rel) {
      shapes.push(buildImagePic(nextId, rel.rId, {
        dataUri: slide.backgroundImage.dataUri,
        mimeType: slide.backgroundImage.mimeType,
        x: 0,
        y: 0,
        w: SLIDE_WIDTH_IN,
        h: SLIDE_HEIGHT_IN,
        alt: slide.backgroundImage.alt
      }))
    }
  }

  const contentItems: SlideContentItem[] = []
  let fallbackOrder = 1_000_000
  for (const shape of slide.shapes || []) {
    contentItems.push({
      kind: 'shape',
      order: contentOrder(shape.order, fallbackOrder++),
      priority: 10,
      item: shape
    })
  }
  for (const table of slide.tables || []) {
    contentItems.push({
      kind: 'table',
      order: contentOrder(table.order, fallbackOrder++),
      priority: 20,
      item: table
    })
  }
  for (const img of slide.images || []) {
    contentItems.push({
      kind: 'image',
      order: contentOrder(img.order, fallbackOrder++),
      priority: 30,
      item: img
    })
  }
  for (const tb of slide.texts) {
    contentItems.push({
      kind: 'text',
      order: contentOrder(tb.order, fallbackOrder++),
      priority: 40,
      item: tb
    })
  }

  contentItems.sort((a, b) => a.order - b.order || a.priority - b.priority)

  for (const entry of contentItems) {
    nextId++
    if (entry.kind === 'shape') {
      shapes.push(buildShapeXml(nextId, entry.item))
      recordPosition(nextId, entry.item)
    } else if (entry.kind === 'table') {
      shapes.push(buildTableXml(nextId, entry.item))
      recordPosition(nextId, entry.item)
    } else if (entry.kind === 'image') {
      const rel = imageRels.get(entry.item.dataUri)
      if (rel) {
        shapes.push(buildImagePic(nextId, rel.rId, entry.item))
        recordPosition(nextId, entry.item)
      }
    } else {
      const xml = buildTextShape(nextId, entry.item)
      if (xml) {
        shapes.push(xml)
        recordPosition(nextId, entry.item)
      }
    }
  }

  // Overlay images (rendered on top of everything, e.g. KaTeX formula screenshots)
  for (const img of slide.overlayImages || []) {
    nextId++
    const rel = imageRels.get(img.dataUri)
    if (rel) {
      shapes.push(buildImagePic(nextId, rel.rId, img))
      recordPosition(nextId, img)
    }
  }

  const timingXml = buildSlideTimingXml(
    matchAnimationTracesToTargets(slide.animationTraces, shapePositions)
  )
  const transitionXml = slide.transitionType
    ? buildSlideTransitionXml(slide.transitionType, slide.transitionDurationMs)
    : ''

  return `${XML_HEADER}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    ${bgXml}
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      ${shapes.join('\n      ')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
  ${transitionXml}
  ${timingXml}
</p:sld>`
}

// ─── Package-level XML ───────────────────────────────────────────────

function buildContentTypesXml(
  slideCount: number,
  mediaExtensions: Set<string>,
  hasEmbeddedFonts: boolean = false
): string {
  const overrides: string[] = [
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`
  ]
  for (let i = 1; i <= slideCount; i++) {
    overrides.push(
      `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
  }

  const defaults = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`
  ]
  if (hasEmbeddedFonts) {
    defaults.push(`<Default Extension="fntdata" ContentType="application/x-fontdata"/>`)
  }
  for (const ext of mediaExtensions) {
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
    defaults.push(`<Default Extension="${ext}" ContentType="${mime}"/>`)
  }

  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  ${defaults.join('\n  ')}
  ${overrides.join('\n  ')}
</Types>`
}

function buildRootRelsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
}

function buildPresentationXml(
  slideCount: number,
  embeddedFonts: HtmlToPptxEmbeddedFont[] = [],
  fontRelIds: Map<string, string> = new Map()
): string {
  const sldIds: string[] = []
  for (let i = 1; i <= slideCount; i++) {
    sldIds.push(`<p:sldId id="${255 + i}" r:id="rId${i}"/>`)
  }

  let embeddedFontLstXml = ''
  if (embeddedFonts.length > 0) {
    const fontsByFace = new Map<string, HtmlToPptxEmbeddedFont[]>()
    for (const ef of embeddedFonts) {
      const existing = fontsByFace.get(ef.fontFace) || []
      existing.push(ef)
      fontsByFace.set(ef.fontFace, existing)
    }
    const styleOrder: HtmlToPptxEmbeddedFont['style'][] = [
      'regular',
      'bold',
      'italic',
      'boldItalic'
    ]
    const fontEntries: string[] = []
    for (const [fontFace, variants] of fontsByFace) {
      const variantXml: string[] = []
      for (const style of styleOrder) {
        const ef = variants.find((candidate) => candidate.style === style)
        if (!ef) continue
        const rId = fontRelIds.get(`${ef.fontFace}::${ef.style}`)
        if (!rId) continue
        variantXml.push(`    <p:${style} r:id="${rId}"/>`)
      }
      if (variantXml.length === 0) continue
      const charset = /[\u3400-\u9fff]|(?:Noto Sans SC|Ma Shan Zheng|Source Han|PingFang|Microsoft YaHei)/i.test(fontFace)
        ? '134'
        : '0'
      fontEntries.push(
        `  <p:embeddedFont>
    <p:font typeface="${escapeXml(fontFace)}" panose="0 0 0 0 0 0 0 0 0 0" pitchFamily="34" charset="${charset}"/>
${variantXml.join('\n')}
  </p:embeddedFont>`
      )
    }
    if (fontEntries.length > 0) {
      embeddedFontLstXml = `\n<p:embeddedFontLst>\n${fontEntries.join('\n')}\n</p:embeddedFontLst>`
    }
  }

  return `${XML_HEADER}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                embedTrueTypeFonts="1"
                saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rIdSm"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    ${sldIds.join('\n    ')}
  </p:sldIdLst>
  <p:sldSz cx="${SLIDE_WIDTH_EMU}" cy="${SLIDE_HEIGHT_EMU}" type="wide"/>
  <p:notesSz cx="${SLIDE_HEIGHT_EMU}" cy="${SLIDE_WIDTH_EMU}"/>${embeddedFontLstXml}
</p:presentation>`
}

function buildPresentationRelsXml(
  slideCount: number,
  fontRelEntries: Array<{ key: string; rId: string; fontFile: string }> = []
): string {
  const rels: string[] = [
    `<Relationship Id="rIdSm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`
  ]
  for (let i = 1; i <= slideCount; i++) {
    rels.push(
      `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`
    )
  }
  for (const entry of fontRelEntries) {
    rels.push(
      `<Relationship Id="${entry.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/${entry.fontFile}"/>`
    )
  }
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.join('\n  ')}
</Relationships>`
}

function buildSlideMasterXml(): string {
  return `${XML_HEADER}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgRef idx="1001">
        <a:schemeClr val="bg1"/>
      </p:bgRef>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`
}

function buildSlideMasterRelsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
}

function buildSlideLayoutXml(): string {
  return `${XML_HEADER}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`
}

function buildSlideLayoutRelsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
}

function buildThemeXml(): string {
  return `${XML_HEADER}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Aptos Display"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Aptos"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`
}

function buildSlideRelsXml(imageRels: ImageRel[]): string {
  const rels: string[] = [
    `<Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
  ]
  for (const r of imageRels) {
    rels.push(
      `<Relationship Id="${r.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${r.mediaFile}"/>`
    )
  }
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.join('\n  ')}
</Relationships>`
}

// ─── Media helpers ───────────────────────────────────────────────────

function dataUriToBuffer(dataUri: string): { buffer: Uint8Array; ext: string } | null {
  const match = dataUri.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/i)
  if (!match) return null
  const rawExt = match[1].toLowerCase()
  const ext = rawExt === 'jpg' ? 'jpg' : rawExt
  const raw = atob(match[2])
  const buffer = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i)
  }
  return { buffer, ext }
}

// ─── Main writer ─────────────────────────────────────────────────────

export const writePptxDocument = async (
  outputPath: string,
  document: HtmlToPptxDocument
): Promise<void> => {
  const slides = document.slides.length > 0 ? document.slides : [{ texts: [] }]
  const slideCount = slides.length
  const embeddedFonts = document.embeddedFonts || []

  // 1. Collect all unique images across all slides → assign media file names
  const dataUriToMedia = new Map<string, { mediaFile: string; ext: string }>()
  let mediaIndex = 0

  const collectImage = (dataUri: string) => {
    if (dataUriToMedia.has(dataUri)) return
    const parsed = dataUriToBuffer(dataUri)
    if (!parsed) return
    mediaIndex++
    const mediaFile = `image${mediaIndex}.${parsed.ext}`
    dataUriToMedia.set(dataUri, { mediaFile, ext: parsed.ext })
  }

  for (const slide of slides) {
    if (slide.backgroundImage) collectImage(slide.backgroundImage.dataUri)
    for (const img of slide.images || []) collectImage(img.dataUri)
    for (const img of slide.overlayImages || []) collectImage(img.dataUri)
  }

  // 2. Build per-slide image rels
  const slideImageRels: Map<string, ImageRel>[] = []

  for (const slide of slides) {
    const relsMap = new Map<string, ImageRel>()
    let relIndex = 0

    const addRel = (dataUri: string) => {
      if (relsMap.has(dataUri)) return
      const media = dataUriToMedia.get(dataUri)
      if (!media) return
      relIndex++
      relsMap.set(dataUri, { rId: `rId${relIndex}`, mediaFile: media.mediaFile })
    }

    if (slide.backgroundImage) addRel(slide.backgroundImage.dataUri)
    for (const img of slide.images || []) addRel(img.dataUri)
    for (const img of slide.overlayImages || []) addRel(img.dataUri)

    slideImageRels.push(relsMap)
  }

  // 3. Collect media extensions for Content_Types
  const mediaExtensions = new Set<string>()
  for (const [, media] of dataUriToMedia) {
    mediaExtensions.add(media.ext)
  }

  // 4. Embedded font rels: assign rId and font file names
  const fontRelIds = new Map<string, string>() // "fontFace::style" → rId
  const fontRelEntries: Array<{ key: string; rId: string; fontFile: string }> = []
  const fontFileMap = new Map<string, Uint8Array>() // fontFile → font buffer
  let fontRelIndex = slideCount + 1 // rIds after slide refs
  let fontFileIndex = 1

  for (const ef of embeddedFonts) {
    const key = `${ef.fontFace}::${ef.style}`
    if (fontRelIds.has(key)) continue
    const rId = `rId${fontRelIndex}`
    const fontFile = `font${fontFileIndex}.fntdata`
    fontRelIds.set(key, rId)
    fontRelEntries.push({ key, rId, fontFile })
    fontFileMap.set(fontFile, ef.ttfBuffer)
    fontRelIndex++
    fontFileIndex++
  }

  const hasEmbeddedFonts = fontRelEntries.length > 0

  // 5. Build ZIP
  const files: Record<string, Uint8Array> = {}

  // Global XML
  files['[Content_Types].xml'] = strToU8(
    buildContentTypesXml(slideCount, mediaExtensions, hasEmbeddedFonts)
  )
  files['_rels/.rels'] = strToU8(buildRootRelsXml())
  files['ppt/presentation.xml'] = strToU8(
    buildPresentationXml(slideCount, embeddedFonts, fontRelIds)
  )
  files['ppt/_rels/presentation.xml.rels'] = strToU8(
    buildPresentationRelsXml(slideCount, fontRelEntries)
  )

  // Theme, slideMaster, slideLayout (required by Office)
  files['ppt/theme/theme1.xml'] = strToU8(buildThemeXml())
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(buildSlideMasterXml())
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(buildSlideMasterRelsXml())
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(buildSlideLayoutXml())
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(buildSlideLayoutRelsXml())

  // Per-slide
  for (let i = 0; i < slideCount; i++) {
    const relsMap = slideImageRels[i]
    const imageRelsForSlide = Array.from(relsMap.values())

    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(buildSlideXml(slides[i], relsMap, 1))
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(buildSlideRelsXml(imageRelsForSlide))
  }

  // Media files
  for (const [dataUri, media] of dataUriToMedia) {
    const parsed = dataUriToBuffer(dataUri)
    if (parsed) {
      files[`ppt/media/${media.mediaFile}`] = parsed.buffer
    }
  }

  // Font files
  for (const [fontFile, ttfBuffer] of fontFileMap) {
    files[`ppt/fonts/${fontFile}`] = ttfBuffer
  }

  // 6. Generate ZIP and write
  const zipped = zipSync(files, { level: 6 })
  writeFileSync(outputPath, zipped)
}
