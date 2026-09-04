import type { SessionStyleSnapshotRow } from '../db/database'
import type { JobLease } from '../agent-runtime'
import type { EditContext } from '../generation/types'
import type { LayoutIntent } from '@shared/layout-intent'

export const STYLE_SWITCH_CONCURRENCY = 2

export type StyleSwitchPageRef = {
  id: string
  pageId: string
  pageNumber: number
  title: string
  htmlPath: string
  contentOutline: string
  layoutIntent?: LayoutIntent
  layoutId: string | null
  layoutContractVersion: number | null
  retryCount: number
}

export type StyleSwitchFileSnapshot = {
  exists: boolean
  content: string
}

export type StyleSwitchRunMetadata = {
  jobType: 'style-switch'
  targetStyleId: string
  targetStyleName: string
  previousStyleId: string | null
  previousStyleSnapshot: SessionStyleSnapshotRow | null
  previousDesignContract: unknown
  // The run is persisted before the contract is generated. It is updated from null to the
  // generated value before any page worker can start.
  designContract: unknown
  pageIds: string[]
  sourceRunId?: string
  userMessage: string
}

export type ActiveStyleSwitchJob = {
  sessionId: string
  runId: string
  styleId: string
  lease: JobLease
  context: EditContext
  pageRefs: StyleSwitchPageRef[]
  previousStyleId: string | null
  previousStyleSnapshot: SessionStyleSnapshotRow | null
  previousDesignContract: unknown
  designContract: unknown
  styleStateCommitted: boolean
  commitQueue: Promise<void>
  fatalError: Error | null
}

export type StyleSwitchJobSnapshot = {
  sessionId: string
  runId: string | null
  status: 'idle' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  hasActiveRun: boolean
  progress: number
  totalPages: number
  completedPageCount: number
  failedPageCount: number
  targetStyleId: string | null
  targetStyleName: string | null
  pages: Array<{
    pageId: string
    pageNumber: number
    title: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    error: string | null
    retryCount: number
  }>
  error: string | null
  startedAt: number | null
  updatedAt: number | null
  kind: 'style-switch'
}
