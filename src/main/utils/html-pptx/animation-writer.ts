import type {
  HtmlToPptxAnimationFrom,
  HtmlToPptxAnimationTrigger,
  HtmlToPptxAnimationType
} from './types'
import {
  getPptxAnimationPreset,
  resolveTraceMotion
} from '../../animation/pptx-animation-map'

export interface PptxTargetAnimation {
  spid: number
  type: HtmlToPptxAnimationType
  trigger: HtmlToPptxAnimationTrigger
  from?: HtmlToPptxAnimationFrom
  duration: number
  delay: number
  order: number
}

const clampMs = (value: number, fallback: number): number => {
  const numeric = Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(100, Math.min(5000, numeric)))
}

const targetXml = (spid: number): string => `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`

/** Compute PPTX wipe presetSubtype from data-anim-from direction. */
const wipeSubtypeForFrom = (from: string | undefined): number => {
  switch (from) {
    case 'right':  return 2  // wipe from right edge = wipe left
    case 'top':    return 4  // wipe from top edge = wipe down
    case 'bottom': return 3  // wipe from bottom edge = wipe up
    case 'left':
    default:       return 1  // wipe from left edge = wipe right
  }
}

/** Compute Office animEffect filter value for wipe. */
const wipeFilterForFrom = (from: string | undefined): string => {
  switch (from) {
    case 'right':
      return 'wipe(left)'
    case 'top':
      return 'wipe(down)'
    case 'bottom':
      return 'wipe(up)'
    case 'left':
    default:
      return 'wipe(right)'
  }
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

const wipeEntranceXml = (
  spid: number,
  id: number,
  duration: number,
  filter: string,
  transition: 'in' | 'out' = 'in'
): string => `<p:animEffect transition="${transition}" filter="${filter}">
  <p:cBhvr>
    <p:cTn id="${id}" dur="${duration}" fill="hold"/>
    ${targetXml(spid)}
  </p:cBhvr>
</p:animEffect>`

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

const motionXml = (anim: PptxTargetAnimation, duration: number, nextId: () => number): string[] => {
  const preset = getPptxAnimationPreset(anim.type)
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

const effectXml = (anim: PptxTargetAnimation, nextId: () => number): string => {
  const preset = getPptxAnimationPreset(anim.type)
  if (!preset) return ''
  const duration = clampMs(anim.duration, 500)
  const delay = Math.max(0, Math.round(Number.isFinite(anim.delay) ? anim.delay : 0))
  const effectId = nextId()
  const chunks = [visibilitySetXml(anim.spid, nextId()), ...motionXml(anim, duration, nextId)]

  const isWipe = anim.type === 'wipe'
  const isExitWipe = anim.type === 'exit-wipe'
  const wipeSubtype = isWipe ? wipeSubtypeForFrom(anim.from) : undefined
  const exitWipeSubtype = isExitWipe ? wipeSubtypeForFrom(anim.from) : undefined
  const wipeFilter = (isWipe || isExitWipe) ? wipeFilterForFrom(anim.from) : undefined

  if (preset.scale) {
    chunks.push(scaleXml(anim.spid, nextId(), duration, preset.scaleFrom, preset.scaleTo))
  }
  // Wipe: needs p:animEffect to activate the entrance, but WITHOUT filter
  // PowerPoint uses filter="wipe(...)" as the actual effect selector; presetSubtype
  // is still kept on cTn so the animation pane and roundtrip metadata keep direction.
  if (isWipe) {
    chunks.push(wipeEntranceXml(anim.spid, nextId(), duration, wipeFilter || 'wipe(right)', 'in'))
  }
  if (isExitWipe) {
    chunks.push(wipeEntranceXml(anim.spid, nextId(), duration, wipeFilter || 'wipe(right)', 'out'))
  }
  // Non-wipe: standard fade-based animation
  if (!isWipe && !isExitWipe && preset.fade) {
    chunks.push(fadeXml(anim.spid, nextId(), duration, preset.transition ?? 'in'))
  }

  // Build cTn attrs: for wipe, override subtype dynamically
  let subtypeOverride = ''
  if (isWipe && wipeSubtype !== undefined) {
    subtypeOverride = ` presetSubtype="${wipeSubtype}"`
  } else if (isExitWipe && exitWipeSubtype !== undefined) {
    subtypeOverride = ` presetSubtype="${exitWipeSubtype}"`
  } else if (preset.presetSubtype !== undefined) {
    subtypeOverride = ` presetSubtype="${preset.presetSubtype}"`
  }

  const nodeType = anim.trigger === 'click' ? 'clickEffect' : 'withEffect'
  const ctn =
    `id="${effectId}" presetID="${preset.presetId}" presetClass="${preset.presetClass}"${subtypeOverride} fill="hold" grpId="0" nodeType="${nodeType}"`

  return `<p:par>
  <p:cTn ${ctn}>
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

  // Separate load-triggered and click-triggered animations.
  // In PowerPoint's timing model:
  //   - withEffect = play simultaneously with the current build step
  //   - clickEffect = wait for user click before this build step
  //
  // Load-triggered animations form one build step (all play on slide load).
  // Each click-triggered animation forms its own build step (advances on click).
  const loadAnims = ordered.filter((a) => a.trigger !== 'click')
  const clickAnims = ordered.filter((a) => a.trigger === 'click')

  const rootId = nextId()
  const mainSeqId = nextId()

  // Build the mainSeq child list: load group first, then click groups
  const mainSeqChildren: string[] = []

  // Load-triggered group: all play at once on slide load
  if (loadAnims.length > 0) {
    const loadGroupId = nextId()
    const loadEffects = loadAnims.map((anim) => effectXml(anim, nextId)).join('\n')
    mainSeqChildren.push(`<p:par>
                  <p:cTn id="${loadGroupId}" fill="hold">
                    <p:stCondLst>
                      <p:cond delay="0"/>
                    </p:stCondLst>
                    <p:childTnLst>
                      ${loadEffects}
                    </p:childTnLst>
                  </p:cTn>
                </p:par>`)
  }

  // Click-triggered groups: each is its own build step.
  // The outer wrapper must wait indefinitely for the next click; otherwise
  // PowerPoint eagerly starts the build on slide load and click-trigger
  // semantics are lost.
  for (const anim of clickAnims) {
    const clickGroupId = nextId()
    const clickEffect = effectXml(anim, nextId)
    mainSeqChildren.push(`<p:par>
                  <p:cTn id="${clickGroupId}" fill="hold">
                    <p:stCondLst>
                      <p:cond delay="indefinite"/>
                    </p:stCondLst>
                    <p:childTnLst>
                      ${clickEffect}
                    </p:childTnLst>
                  </p:cTn>
                </p:par>`)
  }

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
                ${mainSeqChildren.join('\n                ')}
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
