import type { SpecFileEntry, SpecRevision, SpecSourceKind } from '../../domain/index.js'

export type ListRevisionsOptions = {
  fragmentsDir: string
  branch?: string
  limit?: number
  since?: number  // unix epoch ms
  until?: number  // unix epoch ms
}

export type GetFileEntriesOptions = {
  revision: SpecRevision
  fragmentsDir: string
}

export type GetChangedFilesOptions = {
  baseRevision: SpecRevision
  headRevision: SpecRevision
  fragmentsDir: string
}

export interface SpecSourcePort {
  readonly kind: SpecSourceKind

  // fragmentsDir을 건드린 커밋 목록, newest first
  listRevisions(options: ListRevisionsOptions): Promise<SpecRevision[]>

  // 특정 revision의 fragmentsDir 전체 파일 내용
  getFileEntries(options: GetFileEntriesOptions): Promise<SpecFileEntry[]>

  // 두 revision 사이에서 변경된 파일의 relativePath 목록
  getChangedFiles(options: GetChangedFilesOptions): Promise<string[]>
}
