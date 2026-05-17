import { lazy, Suspense, useMemo, useState } from 'react'
import { translate, type Locale } from '../i18n/index.js'
import {
  createGitLabDocumentSaveDraft,
  documentEditorStorageKey,
  plateValueToGitLabMarkdown,
  type GitLabDocumentTarget,
} from '../editor/plate-doc-editor.js'
import {
  buildBackendDocumentSaveRequest,
  executeBackendDocumentSave,
  type BackendDocumentSaveOptions,
} from '../gitlab/document-save-adapter.js'
import { getOrchestratorApiOptions } from '../gitlab/api-options.js'
import {
  documentEditPath,
  documentStorageLocation,
  editorValueForDocument,
  gitLabDestinationLabel,
  targetByScope,
  targetLabels,
  type DocumentationItem,
} from './docs-model.js'
import { analyzeMarkdown } from '../editor/markdown-insights.js'

const PlateDocumentEditor = lazy(() =>
  import('../components/PlateDocumentEditor.js').then(module => ({
    default: module.PlateDocumentEditor,
  })),
)

export interface DocumentEditorPageProps {
  readonly document: DocumentationItem
  readonly locale: Locale
  readonly onNavigate: (path: string) => void
}

export function DocumentEditorPage({
  document,
  locale,
  onNavigate,
}: DocumentEditorPageProps) {
  const [saveMode, setSaveMode] = useState<BackendDocumentSaveOptions['mode']>('update')
  const [branch, setBranch] = useState('main')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveResult, setSaveResult] = useState<string>('')
  const [markdownImport, setMarkdownImport] = useState({ markdown: '', version: 0 })
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
  const markdownInsights = useMemo(() => analyzeMarkdown(markdownPreview), [markdownPreview])
  const issueReferences = markdownInsights.references.filter(reference => reference.kind === 'issue')
  const mergeRequestReferences = markdownInsights.references.filter(reference => reference.kind === 'mergeRequest')

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
          markdownImport={markdownImport}
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
            blocks: translate(locale, 'docs.editorBlocks'),
            formatting: translate(locale, 'docs.editorFormatting'),
            references: translate(locale, 'docs.editorReferences'),
            status: translate(locale, 'docs.editorStatus'),
            blockOrder: translate(locale, 'docs.editorBlockOrder'),
            dragBlock: translate(locale, 'docs.editorDragBlock'),
            linkTitle: translate(locale, 'docs.editorLinkTitle'),
            linkText: translate(locale, 'docs.editorLinkText'),
            linkUrl: translate(locale, 'docs.editorLinkUrl'),
            linkApply: translate(locale, 'docs.editorLinkApply'),
            linkCancel: translate(locale, 'docs.editorLinkCancel'),
            insertMarkdownTitle: translate(locale, 'docs.editorInsertMarkdownTitle'),
            insertMarkdownLabel: translate(locale, 'docs.editorInsertMarkdownLabel'),
            insertMarkdownApply: translate(locale, 'docs.editorInsertMarkdownApply'),
            insertMarkdownCancel: translate(locale, 'docs.editorInsertMarkdownCancel'),
            imageTitle: translate(locale, 'docs.editorImageTitle'),
            imageUrl: translate(locale, 'docs.editorImageUrl'),
            imageAlt: translate(locale, 'docs.editorImageAlt'),
            imageApply: translate(locale, 'docs.editorImageApply'),
            imageCancel: translate(locale, 'docs.editorImageCancel'),
            liveEmptyBlock: translate(locale, 'docs.editorLiveEmptyBlock'),
            tableEdit: translate(locale, 'docs.editorTableEdit'),
            tableTitle: translate(locale, 'docs.editorTableTitle'),
            tableAddRow: translate(locale, 'docs.editorTableAddRow'),
            tableAddColumn: translate(locale, 'docs.editorTableAddColumn'),
            tableRemoveRow: translate(locale, 'docs.editorTableRemoveRow'),
            tableRemoveColumn: translate(locale, 'docs.editorTableRemoveColumn'),
            tableApply: translate(locale, 'docs.editorTableApply'),
            tableCancel: translate(locale, 'docs.editorTableCancel'),
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
          <textarea
            className="markdown-preview raw-markdown-preview raw-markdown-textarea"
            aria-label={translate(locale, 'docs.rawMarkdownPayload')}
            value={markdownPreview}
            onChange={event => setMarkdownPreview(event.target.value)}
          />
          <div className="save-action-row">
            <button
              className="button"
              type="button"
              onClick={() => setMarkdownImport(current => ({
                markdown: markdownPreview,
                version: current.version + 1,
              }))}
            >
              {translate(locale, 'docs.applyRawMarkdown')}
            </button>
          </div>
        </section>
        <section className="markdown-insights-panel">
          <div>
            <h3>{translate(locale, 'docs.markdownInsightsTitle')}</h3>
            <p className="run-meta">{translate(locale, 'docs.markdownInsightsDescription')}</p>
          </div>
          <div className="markdown-insights-grid">
            <MarkdownInsightGroup
              emptyLabel={translate(locale, 'docs.markdownInsightsNoReferences')}
              label={translate(locale, 'docs.markdownInsightsIssues')}
              values={issueReferences.map(reference => reference.reference)}
            />
            <MarkdownInsightGroup
              emptyLabel={translate(locale, 'docs.markdownInsightsNoReferences')}
              label={translate(locale, 'docs.markdownInsightsMergeRequests')}
              values={mergeRequestReferences.map(reference => reference.reference)}
            />
            <MarkdownInsightGroup
              emptyLabel={translate(locale, 'docs.markdownInsightsNoTasks')}
              label={translate(locale, 'docs.markdownInsightsTasks')}
              values={markdownInsights.tasks.map(task => `${String(task.line)} ${task.marker} ${task.text}`)}
            />
          </div>
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

function MarkdownInsightGroup({
  emptyLabel,
  label,
  values,
}: {
  readonly emptyLabel: string
  readonly label: string
  readonly values: readonly string[]
}) {
  return (
    <div className="markdown-insight-group">
      <strong>{label}</strong>
      {values.length > 0 ? (
        <div className="markdown-insight-tags">
          {values.map(value => <span className="badge badge-info" key={value}>{value}</span>)}
        </div>
      ) : (
        <span className="run-meta">{emptyLabel}</span>
      )}
    </div>
  )
}
