import type { SpecFileEntry, SpecLensObservedInputEvidence, SpecRevision, SpecSourceKind } from '../../domain/index.js'
import type { SpecObservationIdentity, SpecProjectSourceKind, TypeSpecObservationInput } from '../../domain/project.js'
import type { SpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'

export type SpecSourceReadBudget = SpecLensTypeSpecSourceReadBudget

export type ListRevisionsOptions = {
  sourceRoot?: string
  /** Additional repo-relative paths that invalidate a project observation. */
  watchPaths?: string[]
  /** Typed replacement for watchPaths; all classes contribute revision candidates. */
  observationInputs?: readonly TypeSpecObservationInput[]
  /** @deprecated Use sourceRoot. */
  fragmentsDir?: string
  sourceKind?: SpecProjectSourceKind
  branch?: string
  limit?: number
  since?: number  // unix epoch ms
  until?: number  // unix epoch ms
}

type GetFileEntriesOptionsBase = {
  revision: SpecRevision
  sourceRoot?: string
  /** @deprecated Use sourceRoot. */
  fragmentsDir?: string
}

export type GetFileEntriesOptions =
  | GetFileEntriesOptionsBase & {
      sourceKind?: 'definition-builder'
      readBudget?: never
    }
  | GetFileEntriesOptionsBase & {
      sourceKind: 'typespec-bundle'
      readBudget: SpecSourceReadBudget
    }

export type GetObservationInputEvidenceOptions = {
  revision: SpecRevision
  inputs: Array<TypeSpecObservationInput & { class: 'evidence-only' }>
}

export interface SpecSourcePort {
  readonly kind: SpecSourceKind

  // Stable repository/project coordinate plus the tracked branch/ref. This is
  // part of the project cache identity and must not contain credentials.
  resolveObservationIdentity(ref?: string): Promise<SpecObservationIdentity>

  // sourceRoot를 건드린 커밋 목록, newest first. `limit`이 없으면 전체
  // reachable history를 반환하는 authoritative 계약이며 cache reconcile에 사용된다.
  // `limit`이 있으면 bounded window이고 prune 근거로 사용하면 안 된다.
  listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]>

  // 특정 revision의 project source 전체 파일 내용
  getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]>

  // Non-source evidence inputs are read as data only. They are never compiler entries.
  getObservationInputEvidence(options: GetObservationInputEvidenceOptions): Promise<SpecLensObservedInputEvidence[]>
}
