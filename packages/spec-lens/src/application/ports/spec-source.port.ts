import type { SpecFileEntry, SpecRevision, SpecSourceKind } from '../../domain/index.js'
import type { SpecProjectSourceKind } from '../../domain/project.js'

export type ListRevisionsOptions = {
  sourceRoot?: string
  /** @deprecated Use sourceRoot. */
  fragmentsDir?: string
  sourceKind?: SpecProjectSourceKind
  branch?: string
  limit?: number
  since?: number  // unix epoch ms
  until?: number  // unix epoch ms
}

export type GetFileEntriesOptions = {
  revision: SpecRevision
  sourceRoot?: string
  /** @deprecated Use sourceRoot. */
  fragmentsDir?: string
  sourceKind?: SpecProjectSourceKind
}

export interface SpecSourcePort {
  readonly kind: SpecSourceKind

  // sourceRoot를 건드린 커밋 목록, newest first
  listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]>

  // 특정 revision의 project source 전체 파일 내용
  getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]>
}
