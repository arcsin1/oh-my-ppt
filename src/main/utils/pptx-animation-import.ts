import { unzipSync } from 'fflate'
import * as cheerio from 'cheerio'
import type { DataAnimFrom, DataAnimPptxTrigger, DataAnimType } from '../animation/data-anim-schema'
import {
  mapPptxPresetToDataAnimFrom,
  mapPptxPresetToDataAnimType
} from '../animation/pptx-animation-map'

export type ImportedAnimationType = DataAnimType
export type ImportedAnimationTrigger = DataAnimPptxTrigger
export type ImportedAnimationFrom = DataAnimFrom

export type ImportedElementAnimation = {
  id: number
  type: ImportedAnimationType
  trigger: ImportedAnimationTrigger
  clickGroup?: string
  from?: ImportedAnimationFrom
  path?: string
  duration: number
  delay: number
  sourceId: string
  sourceName?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

export type SlideAnimationPlan = {
  animations: ImportedElementAnimation[]
  byName: Map<string, ImportedElementAnimation[]>
}

type ParsedSlideShapeTarget = {
  spid: string
  name?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

export const normalizePptxShapeName = (value: unknown): string =>
  String(value || '').replace(/\s+/g, ' ').trim()

const clampMs = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return Math.round(Math.max(100, Math.min(5000, Number.isFinite(n) ? n : fallback)))
}

const parseNumericDelay = (value: string | undefined): number => {
  if (!value || value === 'indefinite') return 0
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(30000, Math.round(n))) : 0
}

const readXmlAttrNumber = (value: string | undefined): number | undefined => {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

const readMotionChannelValue = (
  $: cheerio.CheerioAPI,
  ctn: cheerio.Cheerio<any>,
  attrName: 'ppt_x' | 'ppt_y',
  tm: '0' | '100000'
): string | undefined => {
  const motionNode = ctn
    .find('p\\:anim')
    .filter((_, node) => {
      const el = $(node)
      return el.find('p\\:attrName').first().text() === attrName
    })
    .first()
  if (!motionNode.length) return undefined
  return (
    motionNode
      .find(`p\\:tav[tm="${tm}"] p\\:strVal`)
      .first()
      .attr('val') || undefined
  )
}

const parseDeltaFromMotionExpression = (
  value: string | undefined,
  axis: 'x' | 'y'
): number | undefined => {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  const prefix = axis === 'x' ? '#ppt_x' : '#ppt_y'
  if (raw === prefix) return 0
  const match = raw.match(new RegExp(`^${prefix}([+-]\\d+(?:\\.\\d+)?)$`))
  if (!match) return undefined
  const delta = Number(match[1])
  return Number.isFinite(delta) ? delta : undefined
}

const buildLinearPathFromMotion = (args: {
  motionXFrom?: string
  motionXTo?: string
  motionYFrom?: string
  motionYTo?: string
}): string | undefined => {
  if (args.motionXFrom !== '#ppt_x' || args.motionYFrom !== '#ppt_y') return undefined
  const deltaX = parseDeltaFromMotionExpression(args.motionXTo, 'x')
  const deltaY = parseDeltaFromMotionExpression(args.motionYTo, 'y')
  if (deltaX === undefined || deltaY === undefined) return undefined
  return `M 0 0 L ${deltaX} ${deltaY}`
}

const readSlideEmuSize = (
  files: Record<string, Uint8Array>
): { cx: number; cy: number } | null => {
  const presentation = files['ppt/presentation.xml']
  if (!presentation) return null
  const $ = cheerio.load(Buffer.from(presentation).toString('utf-8'), { xmlMode: true })
  const slideSize = $('p\\:sldSz').first()
  const cx = readXmlAttrNumber(slideSize.attr('cx'))
  const cy = readXmlAttrNumber(slideSize.attr('cy'))
  return cx && cy ? { cx, cy } : null
}

const collectSlideShapeTargets = (
  $: cheerio.CheerioAPI,
  slideEmuSize: { cx: number; cy: number } | null,
  slideSize: { width: number; height: number }
): Map<string, ParsedSlideShapeTarget> => {
  const targets = new Map<string, ParsedSlideShapeTarget>()
  $('p\\:cNvPr').each((_, node) => {
    const item = $(node)
    const spid = item.attr('id')
    if (!spid || spid === '1') return
    const name = normalizePptxShapeName(item.attr('name'))
    const container = item.closest('p\\:sp,p\\:pic,p\\:graphicFrame,p\\:grpSp,p\\:cxnSp')
    const xfrm = container.find('a\\:xfrm').first()
    const off = xfrm.find('a\\:off').first()
    const ext = xfrm.find('a\\:ext').first()
    const xEmu = readXmlAttrNumber(off.attr('x'))
    const yEmu = readXmlAttrNumber(off.attr('y'))
    const wEmu = readXmlAttrNumber(ext.attr('cx'))
    const hEmu = readXmlAttrNumber(ext.attr('cy'))
    const box =
      slideEmuSize && xEmu !== undefined && yEmu !== undefined && wEmu !== undefined && hEmu !== undefined
        ? {
            x: (xEmu / slideEmuSize.cx) * slideSize.width,
            y: (yEmu / slideEmuSize.cy) * slideSize.height,
            w: (wEmu / slideEmuSize.cx) * slideSize.width,
            h: (hEmu / slideEmuSize.cy) * slideSize.height
          }
        : {}
    targets.set(spid, {
      spid,
      name: name || undefined,
      ...box
    })
  })
  return targets
}

export const parsePptxSlideAnimationPlan = (
  slideXml: string,
  slideEmuSize: { cx: number; cy: number } | null,
  slideSize: { width: number; height: number }
): SlideAnimationPlan => {
  const $ = cheerio.load(slideXml, { xmlMode: true })
  const targets = collectSlideShapeTargets($, slideEmuSize, slideSize)
  const animations: ImportedElementAnimation[] = []
  let id = 0

  $('[presetID]').each((_, node) => {
    const ctn = $(node)
    const nodeType = ctn.attr('nodeType')
    const grpId = ctn.attr('grpId')
    const presetId = ctn.attr('presetID')
    const presetSubtype = ctn.attr('presetSubtype')
    const presetClass = ctn.attr('presetClass')
    const effectFilter = ctn.find('p\\:animEffect').first().attr('filter')
    const scaleNode = ctn.find('p\\:animScale').first()
    const scaleFrom = readXmlAttrNumber(scaleNode.find('p\\:from').first().attr('x'))
    const scaleTo = readXmlAttrNumber(scaleNode.find('p\\:to').first().attr('x'))
    const motionXFrom = readMotionChannelValue($, ctn, 'ppt_x', '0')
    const motionXTo = readMotionChannelValue($, ctn, 'ppt_x', '100000')
    const motionYFrom = readMotionChannelValue($, ctn, 'ppt_y', '0')
    const motionYTo = readMotionChannelValue($, ctn, 'ppt_y', '100000')
    const type = mapPptxPresetToDataAnimType({
      presetId,
      presetSubtype,
      presetClass,
      hasScale: scaleNode.length > 0,
      scaleFrom,
      scaleTo,
      effectFilter,
      motionXFrom,
      motionXTo,
      motionYFrom,
      motionYTo
    })
    const from = mapPptxPresetToDataAnimFrom({
      presetId,
      presetSubtype,
      presetClass,
      effectFilter,
      motionXFrom,
      motionXTo,
      motionYFrom,
      motionYTo
    })
    const trigger: ImportedAnimationTrigger =
      nodeType === 'clickEffect' || (nodeType === 'withEffect' && grpId && grpId !== '0')
        ? 'click'
        : 'load'
    const delay = parseNumericDelay(
      ctn.children('p\\:stCondLst').find('p\\:cond').first().attr('delay')
    )
    const duration =
      ctn
        .find('p\\:cTn[dur]')
        .map((__, child) => $(child).attr('dur'))
        .get()
        .map((value) => Number(value))
        .find((value) => Number.isFinite(value) && value > 1) ?? 500
    const spids = [
      ...new Set(
        ctn
          .find('p\\:spTgt')
          .map((__, target) => $(target).attr('spid'))
          .get()
          .filter(Boolean)
      )
    ]
    for (const spid of spids) {
      const target = targets.get(spid)
      id += 1
      const animation: ImportedElementAnimation = {
        id,
        type,
        trigger,
        from,
        path:
          type === 'path'
            ? buildLinearPathFromMotion({ motionXFrom, motionXTo, motionYFrom, motionYTo })
            : undefined,
        duration: clampMs(duration, 500),
        delay,
        sourceId: spid,
        sourceName: target?.name,
        x: target?.x,
        y: target?.y,
        w: target?.w,
        h: target?.h
      }
      if (trigger === 'click' && grpId && grpId !== '0') {
        animation.clickGroup = grpId
      }
      animations.push(animation)
    }
  })

  const byName = new Map<string, ImportedElementAnimation[]>()
  for (const animation of animations) {
    const name = normalizePptxShapeName(animation.sourceName)
    if (!name) continue
    const list = byName.get(name) || []
    list.push(animation)
    byName.set(name, list)
  }
  return { animations, byName }
}

export const readPptxAnimationPlans = (
  buffer: Buffer,
  slideCountOrIndexes: number | number[],
  slideSize: { width: number; height: number }
): SlideAnimationPlan[] => {
  const slideIndexes = Array.isArray(slideCountOrIndexes)
    ? slideCountOrIndexes
    : Array.from({ length: slideCountOrIndexes }, (_, index) => index)
  try {
    const files = unzipSync(new Uint8Array(buffer))
    const slideEmuSize = readSlideEmuSize(files)
    return slideIndexes.map((slideIndex) => {
      const slideXml = files[`ppt/slides/slide${slideIndex + 1}.xml`]
      if (!slideXml) return { animations: [], byName: new Map() }
      return parsePptxSlideAnimationPlan(
        Buffer.from(slideXml).toString('utf-8'),
        slideEmuSize,
        slideSize
      )
    })
  } catch {
    return slideIndexes.map(() => ({ animations: [], byName: new Map() }))
  }
}
