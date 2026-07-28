import type { OutlineItem } from '../../tools/types'
import type { ConfirmedCorporatePagePlan } from '@shared/confirmed-corporate-plan'

export const mapConfirmedCorporatePlanToOutlineItems = (
  plan: ConfirmedCorporatePagePlan
): OutlineItem[] =>
  plan.items.map((item) => ({
    title: item.title,
    contentOutline: item.role === 'closing' ? '' : item.content,
    layoutIntent:
      item.role === 'cover' || item.role === 'closing'
        ? 'cover'
        : item.role === 'agenda'
          ? 'summary'
          : 'concept'
  }))
