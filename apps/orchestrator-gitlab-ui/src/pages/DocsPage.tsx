import { lazy, Suspense, type MouseEvent, useMemo, useState } from 'react'
import type { ContextSearchHit } from '../data/dashboard.js'
import { translate, type Locale } from '../i18n/index.js'
import {
  createGitLabDocumentSaveDraft,
  createDocumentInitialValue,
  documentEditorStorageKey,
  parseStoredEditorValue,
  plateValueToGitLabMarkdown,
  type GitLabDocumentTarget,
} from '../editor/plate-doc-editor.js'
import {
  buildBackendDocumentSaveRequest,
  executeBackendDocumentSave,
  type BackendDocumentSaveOptions,
} from '../gitlab/document-save-adapter.js'
import { getOrchestratorApiOptions } from '../gitlab/api-options.js'

const PlateDocumentEditor = lazy(() =>
  import('../components/PlateDocumentEditor.js').then(module => ({
    default: module.PlateDocumentEditor,
  })),
)

type DocumentationScope = 'wiki' | 'repository' | 'release'

type DocumentationStatus = 'published' | 'needs-review' | 'draft'

interface DocumentationItem {
  readonly id: string
  readonly scope: DocumentationScope
  readonly project: string
  readonly title: string
  readonly path: string
  readonly status: DocumentationStatus
  readonly owner: string
}

const docsData: ReadonlyArray<DocumentationItem> = [
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

const defaultDocument = docsData[0] as DocumentationItem

function itemCountByScope(scope: DocumentationScope): number {
  return docsData.filter(item => item.scope === scope).length
}

function documentationStatusClass(status: DocumentationStatus): string {
  if (status === 'published') return 'badge badge-capability-enabled'
  if (status === 'needs-review') return 'badge badge-warning'
  return 'badge status-warning'
}

function docsFromScope(scope: DocumentationScope): ReadonlyArray<DocumentationItem> {
  return docsData.filter(item => item.scope === scope)
}

function topIssueLikeContext(): ReadonlyArray<ContextSearchHit> {
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

const docsByType = [
  { scope: 'wiki' as const, titleKey: 'docs.wiki' as const },
  { scope: 'repository' as const, titleKey: 'docs.repository' as const },
  { scope: 'release' as const, titleKey: 'docs.release' as const },
] as const

const targetByScope: Record<DocumentationScope, GitLabDocumentTarget> = {
  wiki: 'wiki',
  repository: 'repository',
  release: 'release',
}

const targetLabels: Record<GitLabDocumentTarget, 'docs.targetWiki' | 'docs.targetRepository' | 'docs.targetRelease'> = {
  wiki: 'docs.targetWiki',
  repository: 'docs.targetRepository',
  release: 'docs.targetRelease',
}

function editorValueForDocument(document: DocumentationItem) {
  const fallbackValue = createDocumentInitialValue(document)
  if (typeof window === 'undefined') return fallbackValue
  return parseStoredEditorValue(
    window.localStorage.getItem(documentEditorStorageKey(document.id)),
    fallbackValue,
  )
}

export interface DocsPageProps {
  readonly locale: Locale
  readonly pathname: string
  readonly onNavigate: (path: string) => void
}

function documentEditPath(documentId: string): string {
  return `/docs/${encodeURIComponent(documentId)}`
}

function documentStorageLocation(documentId: string): string {
  return `localStorage:${documentEditorStorageKey(documentId)}`
}

function gitLabDestinationLabel(draft: ReturnType<typeof createGitLabDocumentSaveDraft>, branch: string): string {
  if (draft.target === 'repository') return `${draft.project}@${branch}:${draft.path}`
  if (draft.target === 'wiki') return `${draft.project} wiki:${draft.path}`
  return `${draft.project} release:${draft.path}`
}

function documentIdFromPathname(pathname: string): string | undefined {
  const match = /^\/docs\/([^/?#]+)\/?$/.exec(pathname)
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1])
}

export function DocsPage({ locale, onNavigate, pathname }: DocsPageProps) {
  const routeDocumentId = documentIdFromPathname(pathname)
  const selectedDocument = docsData.find(item => item.id === routeDocumentId)
  const isEditorPage = routeDocumentId !== undefined

  if (isEditorPage && selectedDocument === undefined) {
    return <DocumentNotFound locale={locale} onNavigate={onNavigate} />
  }

  if (selectedDocument !== undefined) {
    return <DocumentEditorPage document={selectedDocument} locale={locale} onNavigate={onNavigate} />
  }

  return <DocsIndexPage locale={locale} onNavigate={onNavigate} />
}

function DocsIndexPage({ locale, onNavigate }: Pick<DocsPageProps, 'locale' | 'onNavigate'>) {
  function handleOpenEditor(event: MouseEvent<HTMLAnchorElement>, documentId: string) {
    event.preventDefault()
    onNavigate(documentEditPath(documentId))
  }

  return (
    <>
      <section className="panel document-workspace">
        <div>
          <h2>{translate(locale, 'docs.workspaceTitle')}</h2>
          <p className="run-meta">{translate(locale, 'docs.workspaceDescription')}</p>
          <p className="run-meta">
            {translate(locale, 'docs.editorRouteHint')}: <code>{documentEditPath(defaultDocument.id)}</code>
          </p>
        </div>
        <a
          className="document-edit-link document-edit-link-primary"
          href={documentEditPath(defaultDocument.id)}
          onClick={event => handleOpenEditor(event, defaultDocument.id)}
        >
          {translate(locale, 'docs.openFirstEditor')}
        </a>
      </section>

      <section className="summary-strip">
        {docsByType.map(group => (
          <article className="summary-strip-item" key={group.scope}>
            <p className="summary-strip-label">{translate(locale, group.titleKey)}</p>
            <p className="summary-strip-value">{itemCountByScope(group.scope)}</p>
            <p className="summary-strip-sub">{translate(locale, 'docs.lastSynced')}</p>
          </article>
        ))}
      </section>

      <section className="panel-grid">
        {docsByType.map(group => {
          const items = docsFromScope(group.scope)
          return (
            <section className="panel" key={group.scope}>
              <h2>{translate(locale, group.titleKey)}</h2>
              <ul className="run-list">
                {items.map(item => (
                  <li className="run-card" key={item.id}>
                    <div className="run-title">
                      <strong>{item.title}</strong>
                      <span className={documentationStatusClass(item.status)}>{item.status}</span>
                    </div>
                    <p className="run-meta">{translate(locale, 'docs.project')}: {item.project}</p>
                    <p className="run-meta">{item.path}</p>
                    <p className="run-meta">{translate(locale, 'docs.owner')}: {item.owner}</p>
                    <p className="run-meta">{translate(locale, 'docs.editorRoute')}: {documentEditPath(item.id)}</p>
                    <p className="run-meta">{translate(locale, 'docs.autosaveLocation')}: {documentStorageLocation(item.id)}</p>
                    <a
                      className="document-edit-link"
                      href={documentEditPath(item.id)}
                      onClick={event => handleOpenEditor(event, item.id)}
                    >
                      {translate(locale, 'docs.openEditor')}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </section>

      <section className="panel">
        <h2>{translate(locale, 'docs.referenceLookup')}</h2>
        <p className="run-meta">{translate(locale, 'docs.referenceDescription')}</p>
        <ul className="run-list">
          {topIssueLikeContext().map(context => (
            <li className="run-card" key={context.id}>
              <div className="run-title">
                <strong>{context.query}</strong>
                <span className="badge badge-info">{context.contextType}</span>
              </div>
              <p className="run-meta">{context.snippet}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function DocumentEditorPage({
  document,
  locale,
  onNavigate,
}: {
  readonly document: DocumentationItem
  readonly locale: Locale
  readonly onNavigate: (path: string) => void
}) {
  const [saveMode, setSaveMode] = useState<BackendDocumentSaveOptions['mode']>('update')
  const [branch, setBranch] = useState('main')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveResult, setSaveResult] = useState<string>('')
  const initialEditorValue = useMemo(
    () => editorValueForDocument(document),
    [document],
  )
  const [markdownPreview, setMarkdownPreview] = useState(() =>
    plateValueToGitLabMarkdown(editorValueForDocument(document)),
  )
  const [saveTarget, setSaveTarget] = useState<GitLabDocumentTarget>(targetByScope[document.scope])
  const saveDraft = createGitLabDocumentSaveDraft({
    documentId: document.id,
    target: saveTarget,
    project: document.project,
    path: document.path,
    title: document.title,
    markdown: markdownPreview,
  })
  const saveRequest = buildBackendDocumentSaveRequest(saveDraft, { branch, mode: saveMode, dryRun: true })
  const editorRoute = documentEditPath(document.id)
  const storageLocation = documentStorageLocation(document.id)
  const gitLabDestination = gitLabDestinationLabel(saveDraft, branch)

  async function runSave(dryRun: boolean) {
    setSaveStatus('saving')
    setSaveResult('')
    const request = buildBackendDocumentSaveRequest(saveDraft, { branch, mode: saveMode, dryRun })
    try {
      const response = await executeBackendDocumentSave(request, getOrchestratorApiOptions())
      const text = await response.text()
      if (!response.ok) {
        throw new Error(text.length > 0 ? text : `HTTP ${String(response.status)}`)
      }
      setSaveResult(text.length > 0 ? text : `HTTP ${String(response.status)}`)
      setSaveStatus('saved')
    } catch (err) {
      setSaveResult(err instanceof Error ? err.message : String(err))
      setSaveStatus('error')
    }
  }

  return (
    <>
      <section className="panel document-workspace">
        <div>
          <h2>{translate(locale, 'docs.workspaceTitle')}</h2>
          <p className="run-meta">{document.title}</p>
          <p className="run-meta">{translate(locale, 'docs.editorRoute')}: <code>{editorRoute}</code></p>
          <p className="run-meta">{translate(locale, 'docs.autosaveLocation')}: <code>{storageLocation}</code></p>
          <p className="run-meta">{translate(locale, 'docs.gitlabDestination')}: <code>{gitLabDestination}</code></p>
        </div>
        <button className="button" type="button" onClick={() => onNavigate('/docs')}>
          {translate(locale, 'docs.backToDocs')}
        </button>
      </section>

      <Suspense
        fallback={
          <section className="panel document-editor-panel">
            <h2>{translate(locale, 'docs.editorTitle')}</h2>
            <p className="run-meta">{translate(locale, 'docs.editorLoading')}</p>
          </section>
        }
      >
        <PlateDocumentEditor
          key={document.id}
          document={{
            title: document.title,
            project: document.project,
            path: document.path,
            owner: document.owner,
          }}
          initialValue={initialEditorValue}
          storageKey={documentEditorStorageKey(document.id)}
          labels={{
            title: translate(locale, 'docs.editorTitle'),
            description: translate(locale, 'docs.editorDescription'),
            placeholder: translate(locale, 'docs.editorPlaceholder'),
            reset: translate(locale, 'docs.editorReset'),
            saved: translate(locale, 'docs.editorSaved'),
            project: translate(locale, 'docs.project'),
            path: translate(locale, 'docs.path'),
            owner: translate(locale, 'docs.owner'),
            toolbar: {
              heading1: translate(locale, 'docs.editorH1'),
              heading2: translate(locale, 'docs.editorH2'),
              heading3: translate(locale, 'docs.editorH3'),
              heading4: translate(locale, 'docs.editorH4'),
              heading5: translate(locale, 'docs.editorH5'),
              heading6: translate(locale, 'docs.editorH6'),
              quote: translate(locale, 'docs.editorQuote'),
              bold: translate(locale, 'docs.editorBold'),
              italic: translate(locale, 'docs.editorItalic'),
              code: translate(locale, 'docs.editorCode'),
              strike: translate(locale, 'docs.editorStrike'),
              link: translate(locale, 'docs.editorLink'),
              bulletList: translate(locale, 'docs.editorBulletList'),
              numberedList: translate(locale, 'docs.editorNumberedList'),
              todoList: translate(locale, 'docs.editorTodoList'),
              indent: translate(locale, 'docs.editorIndent'),
              outdent: translate(locale, 'docs.editorOutdent'),
            },
            snippets: {
              issueReference: translate(locale, 'docs.snippetIssueReference'),
              mergeRequestReference: translate(locale, 'docs.snippetMergeRequestReference'),
              labelReference: translate(locale, 'docs.snippetLabelReference'),
              milestoneReference: translate(locale, 'docs.snippetMilestoneReference'),
              table: translate(locale, 'docs.snippetTable'),
              codeFence: translate(locale, 'docs.snippetCodeFence'),
              mermaid: translate(locale, 'docs.snippetMermaid'),
              math: translate(locale, 'docs.snippetMath'),
              toc: translate(locale, 'docs.snippetToc'),
              alert: translate(locale, 'docs.snippetAlert'),
              image: translate(locale, 'docs.snippetImage'),
              searchPlaceholder: translate(locale, 'docs.snippetSearchPlaceholder'),
              search: translate(locale, 'docs.snippetSearch'),
              manual: translate(locale, 'docs.snippetManual'),
              noResults: translate(locale, 'docs.snippetNoResults'),
              unavailable: translate(locale, 'docs.snippetUnavailable'),
            },
          }}
          onMarkdownChange={setMarkdownPreview}
        />
      </Suspense>

      <section className="panel markdown-preview-panel">
        <div className="document-editor-heading">
          <div>
            <h2>{translate(locale, 'docs.markdownPreviewTitle')}</h2>
            <p className="run-meta">{translate(locale, 'docs.markdownPreviewDescription')}</p>
            <p className="run-meta">{translate(locale, 'docs.requestDestination')}: <code>{gitLabDestination}</code></p>
          </div>
          <label className="target-select-label">
            <span>{translate(locale, 'docs.saveTarget')}</span>
            <select
              className="target-select"
              value={saveTarget}
              onChange={event => setSaveTarget(event.target.value as GitLabDocumentTarget)}
            >
              {(['wiki', 'repository', 'release'] as const).map(target => (
                <option key={target} value={target}>
                  {translate(locale, targetLabels[target])}
                </option>
              ))}
            </select>
          </label>
          <label className="target-select-label">
            <span>{translate(locale, 'docs.saveMode')}</span>
            <select
              className="target-select"
              value={saveMode}
              onChange={event => setSaveMode(event.target.value as BackendDocumentSaveOptions['mode'])}
            >
              <option value="update">{translate(locale, 'docs.modeUpdate')}</option>
              <option value="create">{translate(locale, 'docs.modeCreate')}</option>
            </select>
          </label>
        </div>
        <label className="branch-input-label">
          <span>{translate(locale, 'docs.branch')}</span>
          <input
            className="branch-input"
            value={branch}
            onChange={event => setBranch(event.target.value)}
          />
        </label>
        <section className="raw-markdown-view">
          <div>
            <h3>{translate(locale, 'docs.rawMarkdownTitle')}</h3>
            <p className="run-meta">{translate(locale, 'docs.rawMarkdownDescription')}</p>
          </div>
          <pre className="markdown-preview raw-markdown-preview" aria-label={translate(locale, 'docs.rawMarkdownPayload')}>
            {saveDraft.markdown}
          </pre>
        </section>
        <section className="dry-run-save">
          <div>
            <h3>{translate(locale, 'docs.dryRunTitle')}</h3>
            <p className="run-meta">{translate(locale, 'docs.dryRunDescription')}</p>
            <p className="run-meta">{translate(locale, 'docs.dryRunProject')}: {saveDraft.project}</p>
            <p className="run-meta">{translate(locale, 'docs.dryRunPath')}: {saveDraft.path}</p>
            <p className="run-meta">{translate(locale, 'docs.requestDestination')}: {gitLabDestination}</p>
            <p className="run-meta">{translate(locale, 'docs.dryRunMethod')}: {saveRequest.method}</p>
            <p className="run-meta">{translate(locale, 'docs.dryRunEndpoint')}: {saveRequest.path}</p>
            <div className="save-action-row">
              <button className="button" type="button" onClick={() => void runSave(true)}>
                {translate(locale, 'docs.validateSave')}
              </button>
              <button className="button" type="button" onClick={() => void runSave(false)}>
                {translate(locale, 'docs.executeSave')}
              </button>
            </div>
            {saveStatus !== 'idle' ? (
              <p className={saveStatus === 'error' ? 'reference-search-message' : 'run-meta'}>
                {translate(locale, saveStatus === 'saving' ? 'docs.saveSaving' : saveStatus === 'saved' ? 'docs.saveSucceeded' : 'docs.saveFailed')}
              </p>
            ) : null}
          </div>
          <pre className="markdown-preview" aria-label={translate(locale, 'docs.dryRunBody')}>
            {JSON.stringify(saveRequest.body, null, 2)}
          </pre>
        </section>
        {saveResult.length > 0 ? (
          <pre className="markdown-preview" aria-label={translate(locale, 'docs.saveResult')}>
            {saveResult}
          </pre>
        ) : null}
      </section>
    </>
  )
}

function DocumentNotFound({ locale, onNavigate }: Pick<DocsPageProps, 'locale' | 'onNavigate'>) {
  return (
    <section className="panel">
      <h2>{translate(locale, 'docs.notFoundTitle')}</h2>
      <p className="run-meta">{translate(locale, 'docs.notFoundDescription')}</p>
      <button className="button" type="button" onClick={() => onNavigate('/docs')}>
        {translate(locale, 'docs.backToDocs')}
      </button>
    </section>
  )
}
