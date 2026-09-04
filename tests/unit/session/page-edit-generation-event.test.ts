import { describe, expect, it } from 'vitest'
import {
  isDeckEditGenerationEvent,
  isPageEditGenerationEvent,
  isStyleSwitchGenerationEvent
} from '../../../src/renderer/src/components/session-detail/shared/pageEditGenerationEvent'

describe('isPageEditGenerationEvent', () => {
  it('does not claim an untagged event before the backend attaches an activity marker', () => {
    expect(
      isPageEditGenerationEvent(
        { runId: 'page-edit-run', activityKind: undefined },
        { runId: undefined }
      )
    ).toBe(false)
  })

  it('does not take over chunks for a different run after the page job is identified', () => {
    expect(
      isPageEditGenerationEvent(
        { runId: 'other-run', activityKind: undefined },
        { runId: 'page-edit-run' }
      )
    ).toBe(false)
  })

  it('does not claim a tagged event without the active job run', () => {
    expect(
      isPageEditGenerationEvent({ runId: 'page-edit-run', activityKind: 'page-edit' }, null)
    ).toBe(false)
  })

  it('matches only the active run for each dedicated job type', () => {
    expect(
      isDeckEditGenerationEvent(
        { runId: 'deck-edit-run', activityKind: 'deck-edit' },
        { runId: 'deck-edit-run' }
      )
    ).toBe(true)
  })

  it('claims the first tagged event while an optimistic job is still waiting for its run id', () => {
    expect(
      isDeckEditGenerationEvent(
        { runId: 'deck-edit-run', activityKind: 'deck-edit' },
        { runId: undefined }
      )
    ).toBe(true)
    expect(
      isDeckEditGenerationEvent(
        { runId: 'page-edit-run', activityKind: 'page-edit' },
        { runId: undefined }
      )
    ).toBe(false)
  })

  it('does not let an activity marker override an already-bound foreign run', () => {
    expect(
      isDeckEditGenerationEvent(
        { runId: 'stale-run', activityKind: 'deck-edit' },
        { runId: 'active-run' }
      )
    ).toBe(false)
    expect(
      isStyleSwitchGenerationEvent(
        { runId: 'stale-style-run', activityKind: 'style-switch' },
        { runId: 'active-style-run' }
      )
    ).toBe(false)
  })
})
