import type { RuntimeDomain } from '../types'
import type { ReleaseFunc, ResourceClaims, ResourceLockWaitPolicy } from '../lock/resource-lock'

export type JobOwner =
  | { kind: 'session'; id: string }
  | { kind: 'style'; id: string }
  | { kind: 'image-history'; id: string }
  | { kind: 'image-fulfillment'; id: string }

export type JobLease = {
  jobId: string
  signal: AbortSignal
  release: ReleaseFunc
}

export type ActiveJob = {
  jobId: string
  domain: RuntimeDomain
  owner: JobOwner
  state: 'waiting' | 'active'
  claims: ResourceClaims
}

export type JobReservationArgs = {
  jobId: string
  domain: RuntimeDomain
  owner: JobOwner
  claims: ResourceClaims
  wait: ResourceLockWaitPolicy
  signal?: AbortSignal
}

export type JobReservationResult =
  | { status: 'acquired'; lease: JobLease }
  | { status: 'busy'; conflictingJobId: string }
