import { useState } from 'react'
import type { Value } from 'platejs'
import {
  Plate,
  PlateContent,
  usePlateEditor,
} from 'platejs/react'
import {
  createGitLabMarkdownImageSnippetMarkdown,
  gitLabMarkdownSnippets,
  type GitLabMarkdownSnippet,
  parseStoredEditorValue,
  plateValueToGitLabMarkdown,
  serializeEditorValue,
} from '@oa-sdk/markdown-editor'
import {
  createGitLabPlateCommands,
  createGitLabPlatePlugins,
} from '@oa-sdk/markdown-editor/plate'
import {
  searchGitLabReferences,
  type GitLabReferenceSearchKind,
  type GitLabReferenceSuggestion,
} from '../gitlab/reference-search-adapter.js'
import { getOrchestratorApiOptions } from '../gitlab/api-options.js'

interface PlateDocumentEditorProps {
  initialValue: Value
  onMarkdownChange: (markdown: string) => void
  storageKey: string
  document: {
    title: string
    project: string
    path: string
    owner: string
  }
  labels: {
    title: string
    description: string
    placeholder: string
    reset: string
    saved: string
    project: string
    path: string
    owner: string
    toolbar: {
      heading1: string
      heading2: string
      heading3: string
      heading4: string
      heading5: string
      heading6: string
      quote: string
      bold: string
      italic: string
      code: string
      strike: string
      link: string
      bulletList: string
      numberedList: string
      todoList: string
      indent: string
      outdent: string
    }
    snippets: {
      issueReference: string
      mergeRequestReference: string
      labelReference: string
      milestoneReference: string
      table: string
      codeFence: string
      mermaid: string
      math: string
      toc: string
      alert: string
      image: string
      searchPlaceholder: string
      search: string
      manual: string
      noResults: string
      unavailable: string
    }
  }
}

function ToolbarButton({
  children,
  onClick,
}: {
  children: string
  onClick: () => void
}) {
  return (
    <button className="editor-toolbar-button" type="button" onClick={onClick}>
      {children}
    </button>
  )
}

export function PlateDocumentEditor({
  document,
  initialValue,
  labels,
  onMarkdownChange,
  storageKey,
}: PlateDocumentEditorProps) {
  const [referenceKind, setReferenceKind] = useState<GitLabReferenceSearchKind>('issue')
  const [referenceQuery, setReferenceQuery] = useState('')
  const [referenceResults, setReferenceResults] = useState<ReadonlyArray<GitLabReferenceSuggestion>>([])
  const [referenceSearchState, setReferenceSearchState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const editor = usePlateEditor({
    plugins: createGitLabPlatePlugins(),
    value: () => parseStoredEditorValue(window.localStorage.getItem(storageKey), initialValue) as Value,
  })
  const editorCommands = createGitLabPlateCommands(editor)

  function resetValue() {
    editorCommands.resetValue(initialValue)
    window.localStorage.setItem(storageKey, serializeEditorValue(initialValue))
    onMarkdownChange(plateValueToGitLabMarkdown(initialValue))
  }

  function addLink() {
    const url = window.prompt('https://')
    if (url === null || url.trim().length === 0) return
    const text = window.prompt('Text', url) ?? url
    editorCommands.upsertLink({ text, url })
  }

  function openReferenceSearch(kind: GitLabReferenceSearchKind) {
    setReferenceKind(kind)
    setReferenceSearchState('idle')
  }

  async function runReferenceSearch() {
    if (referenceQuery.trim().length === 0) return
    setReferenceSearchState('loading')
    try {
      const results = await searchGitLabReferences({
        kind: referenceKind,
        text: referenceQuery.trim(),
      }, getOrchestratorApiOptions())
      setReferenceResults(results)
      setReferenceSearchState('loaded')
    } catch {
      setReferenceResults([])
      setReferenceSearchState('error')
    }
  }

  function insertReferenceSuggestion(suggestion: GitLabReferenceSuggestion) {
    insertRawGitLabMarkdown(suggestion.glfmReference)
  }

  function insertRawGitLabMarkdown(markdown: string) {
    editorCommands.insertRawMarkdown(markdown)
  }

  function insertManualReference() {
    const markdown = window.prompt(
      referenceKind === 'issue' ? labels.snippets.issueReference : labels.snippets.mergeRequestReference,
      referenceKind === 'issue' ? '#123' : '!123',
    )
    if (markdown === null || markdown.trim().length === 0) return
    insertRawGitLabMarkdown(markdown)
  }

  function handleSnippet(snippet: GitLabMarkdownSnippet) {
    if (snippet.kind === 'reference') {
      openReferenceSearch(snippet.referenceKind)
      return
    }
    if (snippet.kind === 'raw') {
      insertRawGitLabMarkdown(snippet.markdown)
      return
    }
    if (snippet.kind === 'prompt') {
      const markdown = window.prompt(labels.snippets[snippet.labelKey], snippet.fallbackMarkdown)
      if (markdown === null || markdown.trim().length === 0) return
      insertRawGitLabMarkdown(markdown)
      return
    }

    const url = window.prompt(snippet.urlPrompt, snippet.defaultUrl)
    if (url === null || url.trim().length === 0) return
    const alt = window.prompt(snippet.altPrompt, snippet.defaultAlt) ?? snippet.defaultAlt
    insertRawGitLabMarkdown(createGitLabMarkdownImageSnippetMarkdown({ alt, url }))
  }

  return (
    <section className="panel document-editor-panel">
      <div className="document-editor-heading">
        <div>
          <h2>{labels.title}</h2>
          <p className="run-meta">{labels.description}</p>
        </div>
        <span className="badge badge-info">{labels.saved}</span>
      </div>
      <div className="document-editor-meta">
        <span>{labels.project}: {document.project}</span>
        <span>{labels.path}: {document.path}</span>
        <span>{labels.owner}: {document.owner}</span>
      </div>

      <Plate
        editor={editor}
        onChange={({ value }: { value: Value }) => {
          window.localStorage.setItem(storageKey, serializeEditorValue(value))
          onMarkdownChange(plateValueToGitLabMarkdown(value))
        }}
      >
        <div className="editor-toolbar" aria-label="Document editor toolbar">
          <ToolbarButton onClick={() => editorCommands.toggleHeading(1)}>{labels.toolbar.heading1}</ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.toggleHeading(2)}>{labels.toolbar.heading2}</ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.toggleHeading(3)}>{labels.toolbar.heading3}</ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.toggleHeading(4)}>{labels.toolbar.heading4}</ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.toggleHeading(5)}>{labels.toolbar.heading5}</ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.toggleHeading(6)}>{labels.toolbar.heading6}</ToolbarButton>
          <ToolbarButton onClick={editorCommands.toggleBlockquote}>{labels.toolbar.quote}</ToolbarButton>
          <ToolbarButton onClick={editorCommands.toggleBold}>{labels.toolbar.bold}</ToolbarButton>
          <ToolbarButton onClick={editorCommands.toggleItalic}>{labels.toolbar.italic}</ToolbarButton>
          <ToolbarButton onClick={editorCommands.toggleInlineCode}>{labels.toolbar.code}</ToolbarButton>
          <ToolbarButton onClick={editorCommands.toggleStrikethrough}>{labels.toolbar.strike}</ToolbarButton>
          <ToolbarButton onClick={addLink}>{labels.toolbar.link}</ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.toggleList('disc')}>{labels.toolbar.bulletList}</ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.toggleList('decimal')}>{labels.toolbar.numberedList}</ToolbarButton>
          <ToolbarButton onClick={() => editorCommands.toggleList('todo')}>{labels.toolbar.todoList}</ToolbarButton>
          <ToolbarButton onClick={editorCommands.indentBlock}>{labels.toolbar.indent}</ToolbarButton>
          <ToolbarButton onClick={editorCommands.outdentBlock}>{labels.toolbar.outdent}</ToolbarButton>
          <button className="editor-toolbar-button editor-toolbar-reset" type="button" onClick={resetValue}>
            {labels.reset}
          </button>
        </div>
        <div className="editor-toolbar editor-snippet-toolbar" aria-label="GitLab Markdown snippets">
          {gitLabMarkdownSnippets.map(snippet => (
            <ToolbarButton key={snippet.id} onClick={() => handleSnippet(snippet)}>
              {labels.snippets[snippet.labelKey]}
            </ToolbarButton>
          ))}
        </div>
        <div className="reference-search-panel" aria-label="GitLab reference search">
          <div className="reference-search-controls">
            <span className="badge badge-info">
              {referenceKind === 'issue' ? labels.snippets.issueReference : labels.snippets.mergeRequestReference}
            </span>
            <input
              className="reference-search-input"
              value={referenceQuery}
              placeholder={labels.snippets.searchPlaceholder}
              onChange={event => setReferenceQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void runReferenceSearch()
                }
              }}
            />
            <button className="editor-toolbar-button" type="button" onClick={() => void runReferenceSearch()}>
              {labels.snippets.search}
            </button>
            <button className="editor-toolbar-button" type="button" onClick={insertManualReference}>
              {labels.snippets.manual}
            </button>
          </div>
          {referenceSearchState === 'error' ? (
            <p className="reference-search-message">{labels.snippets.unavailable}</p>
          ) : null}
          {referenceSearchState === 'loaded' && referenceResults.length === 0 ? (
            <p className="reference-search-message">{labels.snippets.noResults}</p>
          ) : null}
          {referenceResults.length > 0 ? (
            <ul className="reference-search-results">
              {referenceResults.map(result => (
                <li key={result.id}>
                  <button
                    className="reference-search-result"
                    type="button"
                    onClick={() => insertReferenceSuggestion(result)}
                  >
                    <span>{result.glfmReference}</span>
                    <strong>{result.title}</strong>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="editor-frame">
          <PlateContent className="plate-content" placeholder={labels.placeholder} />
        </div>
      </Plate>
    </section>
  )
}
