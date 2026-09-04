import type { GenerateChunkEvent } from '@shared/generation'

type ActiveScopedJob = {
  runId?: string
} | null

function matchesActiveJobRun(
  payload: Pick<GenerateChunkEvent['payload'], 'activityKind' | 'runId'>,
  activeJob: ActiveScopedJob,
  expectedActivityKind: GenerateChunkEvent['payload']['activityKind']
): boolean {
  if (!payload.runId || !activeJob) return false
  if (activeJob.runId) return payload.runId === activeJob.runId
  return payload.activityKind === expectedActivityKind
}

export function isPageEditGenerationEvent(
  payload: Pick<GenerateChunkEvent['payload'], 'activityKind' | 'runId'>,
  activePageEditJob: ActiveScopedJob
): boolean {
  return matchesActiveJobRun(payload, activePageEditJob, 'page-edit')
}

export function isDeckEditGenerationEvent(
  payload: Pick<GenerateChunkEvent['payload'], 'activityKind' | 'runId'>,
  activeDeckEditJob: ActiveScopedJob
): boolean {
  return matchesActiveJobRun(payload, activeDeckEditJob, 'deck-edit')
}

export function isStyleSwitchGenerationEvent(
  payload: Pick<GenerateChunkEvent['payload'], 'activityKind' | 'runId'>,
  activeStyleSwitchJob: ActiveScopedJob
): boolean {
  return matchesActiveJobRun(payload, activeStyleSwitchJob, 'style-switch')
}
