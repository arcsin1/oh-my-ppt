import type { LayoutMasterTemplate } from '@shared/layout-master'
import type { DesignContract } from '@shared/generation'
import type { SlideSizePreset } from '@shared/slide-size'
import {
  buildCanvasScenarioContentRules,
  buildCanvasScenarioDeliveryGuard
} from './canvas-scenario'
import { formatDesignContract } from './shared'

export const buildGenerationImageIntentRules = (args: {
  visualEnabled: boolean
  template: LayoutMasterTemplate
  hasStyleImageDirection?: boolean
}): string => {
  if (!args.visualEnabled) {
    return [
      'Automatic image generation is disabled for this session.',
      'Do not emit data-img-request or any other data-img-* attribute.'
    ].join('\n')
  }

  if (!args.hasStyleImageDirection) {
    return [
      'Automatic image generation is enabled, but the active style does not declare image-generation direction.',
      'Do not emit image requests for this page. Continue using the style skill for CSS, SVG, and other page-native visual treatment.'
    ].join('\n')
  }

  const imageSlots = args.template.slots.filter((slot) => slot.role === 'visual' && slot.image)
  if (imageSlots.length === 0) {
    return [
      'Automatic image generation is enabled, but this layout has no image-capable visual slot.',
      'Do not emit image requests for this page.'
    ].join('\n')
  }

  return [
    'Automatic image generation is enabled for this session and the active style supports it.',
    'Before writing HTML, decide independently whether this page needs one image: request it when the active style skill\'s 配图 strategy matches the page and an identifiable subject, scene, evidence, or atmosphere improves the message. The strategy is a positive signal, not a quota.',
    'Do not request an image merely because the style or layout allows it. For pages led by data, relationships, steps, comparison, timelines, frameworks, or precise conclusions, use page-native CSS, SVG, charts, and diagrams instead.',
    'For one selected image-capable visual slot, add the empty data-img-request attribute to the same rendered element that has data-ppt-slot. Add data-img-placement="background" only when the image must become that slot\'s background; otherwise omit it for a normal visual image. Do not add JSON, scripts, request IDs, image prompts, data-img-slot, data-img-placeholder, or data-img-finalization.',
    'Example: <div data-ppt-slot="metric-visual" data-img-request class="aspect-square ...">...</div>. The system has a dedicated image director that creates the image prompt and derives all technical fields from this layout slot.',
    'Use only one image request per page. Do not reference a generated image path during this first pass. After generation, the system places the local asset directly into this slot without rewriting the rest of the page.',
    'Allowed image slots:',
    ...imageSlots.map(
      (slot) =>
        `- ${slot.id}: ${slot.image!.role}, ${slot.image!.policy}, ${slot.image!.aspectHint || 'no aspect hint'}`
    ),
    'The dedicated image director receives the active style image direction separately. Do not write or infer an image prompt in this pass.'
  ].join('\n')
}

export const buildGenerationImageLayoutRefinementPrompt = (args: {
  pageId: string
  referenceRangeBound?: boolean
  slideSize?: SlideSizePreset
  designContract?: DesignContract
  layoutPrompt?: string
  assets: Array<{
    slotId: string
    layoutSlotId: string
    relativePath: string
    role: string
    prompt?: string
  }>
}): string =>
  [
    'Refine this complete slide after automatic image placement.',
    `First read the current ${args.pageId}.html. It already contains the generated local image in its intended layout slot.`,
    `Use edit_file on /${args.pageId}.html for minimal, targeted replacements only. Do not use write_file, update_single_page_file, or update_page_file.`,
    'Review the whole composition at the slide viewport: correct overflow, preserve actual nonzero gaps between independent modules, improve type hierarchy, rebalance the image area against the text, and ensure the visual is cropped and contained deliberately.',
    'Preserve the slide meaning, all required data-ppt-slot attributes, data-block-id attributes, and every listed generated asset path. Do not create new image requests, remove a generated asset, use staging or remote paths, or modify another page.',
    'You may adjust layout, CSS classes, sizing, flex/grid distribution, image object-fit/object-position, text-safe overlays, and local decoration when needed for a balanced final slide.',
    args.layoutPrompt
      ? `Keep the page's selected layout family as a creative direction, not a fixed grid:\n${args.layoutPrompt}`
      : '',
    args.designContract
      ? `Keep the active deck design contract coherent:\n${formatDesignContract(args.designContract)}`
      : '',
    args.slideSize
      ? [
          'Keep the image refinement consistent with this canvas scenario:',
          buildCanvasScenarioContentRules(args.slideSize, {
            referenceTextLocked: Boolean(args.referenceRangeBound)
          }),
          buildCanvasScenarioDeliveryGuard(args.slideSize, {
            referenceTextLocked: Boolean(args.referenceRangeBound)
          })
        ].join('\n')
      : '',
    args.referenceRangeBound
      ? 'Reference Range Content Boundary applies: preserve source facts, qualifiers, relationships, uncertainty, and business conclusions. You may adjust layout, styling, and visual hierarchy; do not introduce outside facts or change the source meaning. For density, first clarify hierarchy, group related material, and use compact layout; scale only bounded internal modules as a final measure; never scale the page root, section/page shell, `main[data-role="content"]`, or canvas.'
      : '',
    'Generated assets:',
    ...args.assets.map(
      (asset) =>
        `- ${asset.relativePath}: slot ${asset.slotId}, layout slot ${asset.layoutSlotId}, role ${asset.role}${asset.prompt ? `, image description: ${asset.prompt}` : ''}`
    )
  ].join('\n')
