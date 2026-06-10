import type {
  HtmlToPptxAnimationFrom,
  HtmlToPptxAnimationTrigger,
  HtmlToPptxAnimationType
} from './types'
import {
  getPptxAnimationPreset,
  resolveTraceMotion,
  wipeFilterForFrom
} from '../../animation/pptx-animation-map'

export interface PptxTargetAnimation {
  spid: number
  type: HtmlToPptxAnimationType
  trigger: HtmlToPptxAnimationTrigger
  clickGroup?: string
  from?: HtmlToPptxAnimationFrom
  path?: string
  duration: number
  delay: number
  order: number
}

const clampMs = (value: number, fallback: number): number => {
  const numeric = Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(100, Math.min(5000, numeric)))
}

const targetXml = (spid: number): string => `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`

const ctnAttrs = (args: {
  anim: PptxTargetAnimation
  id: number
  nodeTypeOverride?: 'clickEffect' | 'withEffect'
  grpIdOverride?: number
}): string => {
  const { anim, id, nodeTypeOverride, grpIdOverride } = args
  const preset = getPptxAnimationPreset(anim.type)
  if (!preset) return ''
  const nodeType = nodeTypeOverride || (anim.trigger === 'click' ? 'clickEffect' : 'withEffect')
  const subtype =
    preset.presetSubtype === undefined ? '' : ` presetSubtype="${preset.presetSubtype}"`
  const grpId = grpIdOverride === undefined ? 0 : grpIdOverride
  return `id="${id}" presetID="${preset.presetId}" presetClass="${preset.presetClass}"${subtype} fill="hold" grpId="${grpId}" nodeType="${nodeType}"`
}

const visibilitySetXml = (spid: number, id: number): string => `<p:set>
  <p:cBhvr>
    <p:cTn id="${id}" dur="1" fill="hold">
      <p:stCondLst>
        <p:cond delay="0"/>
      </p:stCondLst>
    </p:cTn>
    ${targetXml(spid)}
    <p:attrNameLst>
      <p:attrName>style.visibility</p:attrName>
    </p:attrNameLst>
  </p:cBhvr>
  <p:to>
    <p:strVal val="visible"/>
  </p:to>
</p:set>`

const fadeXml = (
  spid: number,
  id: number,
  duration: number,
  transition: 'in' | 'out' = 'in',
  filter = 'fade'
): string => `<p:animEffect transition="${transition}" filter="${filter}">
  <p:cBhvr>
    <p:cTn id="${id}" dur="${duration}" fill="hold"/>
    ${targetXml(spid)}
  </p:cBhvr>
</p:animEffect>`

const numericAnimXml = (
  spid: number,
  id: number,
  duration: number,
  attrName: 'ppt_x' | 'ppt_y',
  from: string,
  to: string
): string => `<p:anim calcmode="lin" valueType="num">
  <p:cBhvr additive="base">
    <p:cTn id="${id}" dur="${duration}" fill="hold"/>
    ${targetXml(spid)}
    <p:attrNameLst>
      <p:attrName>${attrName}</p:attrName>
    </p:attrNameLst>
  </p:cBhvr>
  <p:tavLst>
    <p:tav tm="0">
      <p:val><p:strVal val="${from}"/></p:val>
    </p:tav>
    <p:tav tm="100000">
      <p:val><p:strVal val="${to}"/></p:val>
    </p:tav>
  </p:tavLst>
</p:anim>`

const parseLinearPathDelta = (
  pathValue: string | undefined
): { x: number; y: number } | null => {
  const raw = String(pathValue || '').trim()
  if (!raw) return null
  const coords = raw.match(/-?\d+(?:\.\d+)?/g)
  if (!coords || coords.length < 4) return null
  const startX = Number(coords[0])
  const startY = Number(coords[1])
  const endX = Number(coords[coords.length - 2])
  const endY = Number(coords[coords.length - 1])
  if (![startX, startY, endX, endY].every(Number.isFinite)) return null
  return { x: endX - startX, y: endY - startY }
}

const formatSignedDelta = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000
  if (Math.abs(rounded) < 0.0005) return ''
  return rounded >= 0 ? `+${rounded}` : `${rounded}`
}

const motionXml = (anim: PptxTargetAnimation, duration: number, nextId: () => number): string[] => {
  const preset = getPptxAnimationPreset(anim.type)
  if (anim.type === 'path') {
    const delta = parseLinearPathDelta(anim.path)
    if (!delta) return []
    return [
      numericAnimXml(anim.spid, nextId(), duration, 'ppt_x', '#ppt_x', `#ppt_x${formatSignedDelta(delta.x)}`),
      numericAnimXml(anim.spid, nextId(), duration, 'ppt_y', '#ppt_y', `#ppt_y${formatSignedDelta(delta.y)}`)
    ]
  }
  const motion = preset?.motion === 'fromTrace' ? resolveTraceMotion(anim.from) : preset?.motion
  if (!preset || !motion) return []

  const xAway =
    motion === 'fromLeft'
      ? '#ppt_x-#ppt_w/2'
      : motion === 'fromRight'
        ? '#ppt_x+#ppt_w/2'
        : '#ppt_x'
  const yAway =
    motion === 'fromTop'
      ? '#ppt_y-#ppt_h/2'
      : motion === 'fromBottom'
        ? '#ppt_y+#ppt_h/2'
        : '#ppt_y'
  const isExit = preset.presetClass === 'exit'

  return [
    numericAnimXml(anim.spid, nextId(), duration, 'ppt_x', isExit ? '#ppt_x' : xAway, isExit ? xAway : '#ppt_x'),
    numericAnimXml(anim.spid, nextId(), duration, 'ppt_y', isExit ? '#ppt_y' : yAway, isExit ? yAway : '#ppt_y')
  ]
}

const scaleXml = (
  spid: number,
  id: number,
  duration: number,
  from = 85000,
  to = 100000
): string => `<p:animScale>
  <p:cBhvr additive="base">
    <p:cTn id="${id}" dur="${duration}" fill="hold"/>
    ${targetXml(spid)}
  </p:cBhvr>
  <p:from x="${from}" y="${from}"/>
  <p:to x="${to}" y="${to}"/>
</p:animScale>`

const effectXml = (
  anim: PptxTargetAnimation,
  nextId: () => number,
  options?: { nodeTypeOverride?: 'clickEffect' | 'withEffect'; grpIdOverride?: number }
): string => {
  const preset = getPptxAnimationPreset(anim.type)
  if (!preset) return ''
  const duration = clampMs(anim.duration, 500)
  const delay = Math.max(0, Math.round(Number.isFinite(anim.delay) ? anim.delay : 0))
  const effectId = nextId()
  const chunks = [visibilitySetXml(anim.spid, nextId()), ...motionXml(anim, duration, nextId)]
  if (preset.scale) {
    chunks.push(scaleXml(anim.spid, nextId(), duration, preset.scaleFrom, preset.scaleTo))
  }
  if (preset.effectFilter === 'wipe') {
    chunks.push(fadeXml(anim.spid, nextId(), duration, preset.transition ?? 'in', wipeFilterForFrom(anim.from)))
  } else if (preset.fade) {
    chunks.push(fadeXml(anim.spid, nextId(), duration, preset.transition ?? 'in'))
  }

  return `<p:par>
  <p:cTn ${ctnAttrs({
    anim,
    id: effectId,
    nodeTypeOverride: options?.nodeTypeOverride,
    grpIdOverride: options?.grpIdOverride
  })}>
    <p:stCondLst>
      <p:cond delay="${delay}"/>
    </p:stCondLst>
    <p:childTnLst>
      ${chunks.join('\n      ')}
    </p:childTnLst>
  </p:cTn>
</p:par>`
}

export function buildSlideTimingXml(animations: PptxTargetAnimation[], startNodeId = 0): string {
  if (animations.length === 0) return ''

  let nodeId = startNodeId
  const nextId = (): number => {
    nodeId += 1
    return nodeId
  }

  const ordered = [...animations]
    .filter((anim) => getPptxAnimationPreset(anim.type) && Number.isFinite(anim.spid))
    .sort((a, b) => a.order - b.order || a.delay - b.delay || a.spid - b.spid)
  if (ordered.length === 0) return ''

  const rootId = nextId()
  const mainSeqId = nextId()
  const kickoffId = nextId()
  const effectGroupId = nextId()
  let nextClickGroupId = 1
  let lastClickGroup: string | undefined
  let lastClickGroupId: number | undefined
  const effects = ordered.map((anim) => {
    if (anim.trigger !== 'click') {
      lastClickGroup = undefined
      lastClickGroupId = undefined
      return effectXml(anim, nextId)
    }
    if (!anim.clickGroup) {
      lastClickGroup = undefined
      lastClickGroupId = undefined
      return effectXml(anim, nextId)
    }
    if (anim.clickGroup !== lastClickGroup) {
      lastClickGroup = anim.clickGroup
      lastClickGroupId = nextClickGroupId
      nextClickGroupId += 1
      return effectXml(anim, nextId, {
        nodeTypeOverride: 'clickEffect',
        grpIdOverride: lastClickGroupId
      })
    }
    return effectXml(anim, nextId, {
      nodeTypeOverride: 'withEffect',
      grpIdOverride: lastClickGroupId
    })
  }).join('\n')
  const buildList = [...new Set(ordered.map((anim) => anim.spid))]
    .map((spid) => `<p:bldP spid="${spid}" grpId="0"/>`)
    .join('\n      ')

  return `<p:timing>
  <p:tnLst>
    <p:par>
      <p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot">
        <p:childTnLst>
          <p:seq concurrent="1" nextAc="seek">
            <p:cTn id="${mainSeqId}" dur="indefinite" nodeType="mainSeq">
              <p:childTnLst>
                <p:par>
                  <p:cTn id="${kickoffId}" fill="hold">
                    <p:stCondLst>
                      <p:cond delay="indefinite"/>
                      <p:cond evt="onBegin" delay="0">
                        <p:tn val="${mainSeqId}"/>
                      </p:cond>
                    </p:stCondLst>
                    <p:childTnLst>
                      <p:par>
                        <p:cTn id="${effectGroupId}" fill="hold">
                          <p:stCondLst>
                            <p:cond delay="0"/>
                          </p:stCondLst>
                          <p:childTnLst>
                            ${effects}
                          </p:childTnLst>
                        </p:cTn>
                      </p:par>
                    </p:childTnLst>
                  </p:cTn>
                </p:par>
              </p:childTnLst>
            </p:cTn>
            <p:prevCondLst>
              <p:cond evt="onPrev" delay="0">
                <p:tgtEl><p:sldTgt/></p:tgtEl>
              </p:cond>
            </p:prevCondLst>
            <p:nextCondLst>
              <p:cond evt="onNext" delay="0">
                <p:tgtEl><p:sldTgt/></p:tgtEl>
              </p:cond>
            </p:nextCondLst>
          </p:seq>
        </p:childTnLst>
      </p:cTn>
    </p:par>
  </p:tnLst>
  <p:bldLst>
      ${buildList}
  </p:bldLst>
</p:timing>`
}

export function buildSlideTransitionXml(type: string, durationMs?: number): string {
  if (type === 'none') return ''
  const mapped = mapTransitionType(type)
  if (mapped === 'none') return ''
  const duration = clampMs(durationMs ?? 400, 400)
  const speed = duration <= 300 ? 'fast' : duration <= 700 ? 'med' : 'slow'
  return `<p:transition spd="${speed}" dur="${duration}" advClick="1"><p:${mapped}/></p:transition>`
}

function mapTransitionType(
  type: string
): 'fade' | 'push' | 'wipe' | 'cover' | 'uncover' | 'dissolve' | 'none' {
  switch (type) {
    case 'none':
      return 'none'
    case 'push':
    case 'wipe':
    case 'cover':
    case 'uncover':
    case 'dissolve':
    case 'fade':
      return type
    case 'slide-left':
    case 'slide-up':
      return 'push'
    case 'zoom':
      return 'dissolve'
    default:
      return 'fade'
  }
}
