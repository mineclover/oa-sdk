import type { ContextSearchHit } from '../data/dashboard.js'
import {
  createDocumentInitialValue,
  createGitLabDocumentSaveDraft,
  documentEditorStorageKey,
  parseStoredEditorValue,
  type GitLabDocumentTarget,
} from '../editor/plate-doc-editor.js'
import type { TranslationKey } from '../i18n/index.js'

export type DocumentationScope = 'wiki' | 'repository' | 'release'

export type DocumentationStatus = 'published' | 'needs-review' | 'draft'

export interface DocumentationItem {
  readonly id: string
  readonly scope: DocumentationScope
  readonly project: string
  readonly title: string
  readonly path: string
  readonly status: DocumentationStatus
  readonly owner: string
}

export const docsData: ReadonlyArray<DocumentationItem> = [
  {
    id: 'DOC-01',
    scope: 'wiki',
    project: 'payments/checkout',
    title: 'Runbook: release pipeline strategy',
    path: 'wiki/release-pipelines',
    status: 'published',
    owner: 'platform team',
  },
  {
    id: 'DOC-02',
    scope: 'wiki',
    project: 'inventory/api',
    title: 'Troubleshooting: stale metadata',
    path: 'wiki/metadata-staleness',
    status: 'needs-review',
    owner: 'ops crew',
  },
  {
    id: 'DOC-03',
    scope: 'repository',
    project: 'auth/gateway',
    title: 'CONTRIBUTING.md',
    path: 'CONTRIBUTING.md',
    status: 'published',
    owner: 'security',
  },
  {
    id: 'DOC-04',
    scope: 'repository',
    project: 'web/portal',
    title: 'README.md',
    path: 'README.md',
    status: 'draft',
    owner: 'documentation',
  },
  {
    id: 'DOC-05',
    scope: 'release',
    project: 'payments/checkout',
    title: 'Release Notes v2.4',
    path: 'release/v2.4',
    status: 'needs-review',
    owner: 'release bot',
  },
  {
    id: 'DOC-06',
    scope: 'release',
    project: 'auth/gateway',
    title: 'Release Notes v1.9',
    path: 'release/v1.9',
    status: 'published',
    owner: 'release bot',
  },
]

export const defaultDocument = docsData[0] as DocumentationItem

export const docsByType = [
  { scope: 'wiki' as const, titleKey: 'docs.wiki' as const },
  { scope: 'repository' as const, titleKey: 'docs.repository' as const },
  { scope: 'release' as const, titleKey: 'docs.release' as const },
] as const

export const targetByScope: Record<DocumentationScope, GitLabDocumentTarget> = {
  wiki: 'wiki',
  repository: 'repository',
  release: 'release',
}

export const targetLabels: Record<GitLabDocumentTarget, TranslationKey> = {
  wiki: 'docs.targetWiki',
  repository: 'docs.targetRepository',
  release: 'docs.targetRelease',
}

export function itemCountByScope(scope: DocumentationScope): number {
  return docsData.filter(item => item.scope === scope).length
}

export function documentationStatusClass(status: DocumentationStatus): string {
  if (status === 'published') return 'badge badge-capability-enabled'
  if (status === 'needs-review') return 'badge badge-warning'
  return 'badge status-warning'
}

export function docsFromScope(scope: DocumentationScope): ReadonlyArray<DocumentationItem> {
  return docsData.filter(item => item.scope === scope)
}

export function topIssueLikeContext(): ReadonlyArray<ContextSearchHit> {
  return [
    {
      id: 'ctx-1',
      query: 'release evidence',
      project: 'payments/checkout',
      path: '.orch/project/context.yml',
      snippet: 'Wiki entry references releaseEvidence requirement and fallback behavior.',
      contextType: 'runbook',
      capability: 'degraded',
      confidence: 91,
      updatedMinutesAgo: 10,
    },
    {
      id: 'ctx-2',
      query: 'release readiness',
      project: 'auth/gateway',
      path: 'release/readiness.md',
      snippet: 'Repository docs should link release notes and incident response steps.',
      contextType: 'runbook',
      capability: 'available',
      confidence: 88,
      updatedMinutesAgo: 42,
    },
  ]
}

export function editorValueForDocument(document: DocumentationItem) {
  const fallbackValue = createDocumentInitialValue(document)
  if (typeof window === 'undefined') return fallbackValue
  return parseStoredEditorValue(
    window.localStorage.getItem(documentEditorStorageKey(document.id)),
    fallbackValue,
  )
}

export function documentEditPath(documentId: string): string {
  return `/docs/${encodeURIComponent(documentId)}`
}

export function documentStorageLocation(documentId: string): string {
  return `localStorage:${documentEditorStorageKey(documentId)}`
}

export function gitLabDestinationLabel(draft: ReturnType<typeof createGitLabDocumentSaveDraft>, branch: string): string {
  if (draft.target === 'repository') return `${draft.project}@${branch}:${draft.path}`
  if (draft.target === 'wiki') return `${draft.project} wiki:${draft.path}`
  return `${draft.project} release:${draft.path}`
}

export function documentIdFromPathname(pathname: string): string | undefined {
  const match = /^\/docs\/([^/?#]+)\/?$/.exec(pathname)
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1])
}
