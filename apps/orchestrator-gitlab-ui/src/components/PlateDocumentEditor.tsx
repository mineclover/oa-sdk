import { useEffect, useState, type DragEvent } from 'react'
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
  DocumentBlockRail,
  DocumentCommandBar,
  DocumentProperties,
  DocumentSnippetMenu,
  ToolbarButton,
} from './DocumentEditorUi.js'
import type { PlateDocumentEditorProps } from './PlateDocumentEditor.types.js'
import { reorderDocumentEditorBlocks } from './document-editor-blocks.js'
import { useGitLabReferenceSearch } from './useGitLabReferenceSearch.js'

export function PlateDocumentEditor({
  document,
  initialValue,
  labels,
  markdownImport,
  onMarkdownChange,
  storageKey,
}: PlateDocumentEditorProps) {
  const referenceSearch = useGitLabReferenceSearch()
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null)
  const [dragOverBlockIndex, setDragOverBlockIndex] = useState<number | null>(null)
  const [editorValue, setEditorValue] = useState<Value>(
    () => parseStoredEditorValue(window.localStorage.getItem(storageKey), initialValue) as Value,
  )
  const editor = usePlateEditor({
    plugins: createGitLabPlatePlugins() as never,
    value: editorValue,
  })
  const editorCommands = createGitLabPlateCommands(editor)

  function syncEditorValue(value: Value) {
    setEditorValue(value)
    editorCommands.resetValue(value)
    window.localStorage.setItem(storageKey, serializeEditorValue(value))
    onMarkdownChange(plateValueToGitLabMarkdown(value))
  }

  useEffect(() => {
    if (markdownImport === undefined || markdownImport.version === 0) return
    const nextValue = editorCommands.resetValueFromMarkdown(markdownImport.markdown)
    setEditorValue(nextValue)
    window.localStorage.setItem(storageKey, serializeEditorValue(nextValue))
    onMarkdownChange(plateValueToGitLabMarkdown(nextValue))
  }, [markdownImport?.version])

  function resetValue() {
    syncEditorValue(initialValue)
  }

  function moveBlock(fromIndex: number, toIndex: number) {
    const nextValue = reorderDocumentEditorBlocks(editorValue, fromIndex, toIndex)
    if (nextValue === editorValue) return
    syncEditorValue(nextValue)
  }

  function handleBlockDragStart(event: DragEvent<HTMLButtonElement>, index: number) {
    setDraggedBlockIndex(index)
    setDragOverBlockIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }

  function handleBlockDragOver(event: DragEvent<HTMLButtonElement>, index: number) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverBlockIndex(index)
  }

  function handleBlockDrop(event: DragEvent<HTMLButtonElement>, index: number) {
    event.preventDefault()
    const sourceIndex = draggedBlockIndex ?? Number(event.dataTransfer.getData('text/plain'))
    setDraggedBlockIndex(null)
    setDragOverBlockIndex(null)
    if (!Number.isInteger(sourceIndex)) return
    moveBlock(sourceIndex, index)
  }

  function handleBlockDragEnd() {
    setDraggedBlockIndex(null)
    setDragOverBlockIndex(null)
  }

  function addLink() {
    const url = window.prompt('https://')
    if (url === null || url.trim().length === 0) return
    const text = window.prompt('Text', url) ?? url
    editorCommands.upsertLink({ text, url })
  }

  function insertReferenceSuggestion(suggestion: { readonly glfmReference: string }) {
    insertRawGitLabMarkdown(suggestion.glfmReference)
  }

  function insertRawGitLabMarkdown(markdown: string) {
    editorCommands.insertRawMarkdown(markdown)
  }

  function insertManualReference() {
    const markdown = window.prompt(
      referenceSearch.kind === 'issue' ? labels.snippets.issueReference : labels.snippets.mergeRequestReference,
      referenceSearch.kind === 'issue' ? '#123' : '!123',
    )
    if (markdown === null || markdown.trim().length === 0) return
    insertRawGitLabMarkdown(markdown)
  }

  function handleSnippet(snippet: GitLabMarkdownSnippet) {
    if (snippet.kind === 'reference') {
      referenceSearch.open(snippet.referenceKind)
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
    <section className="panel document-editor-panel notion-editor-panel">
      <div className="notion-page-cover" aria-hidden="true" />
      <div className="notion-page">
        <DocumentProperties document={document} labels={labels} />

        <Plate
          editor={editor}
          onChange={({ value }: { value: Value }) => {
            setEditorValue(value)
            window.localStorage.setItem(storageKey, serializeEditorValue(value))
            onMarkdownChange(plateValueToGitLabMarkdown(value))
          }}
        >
          <DocumentCommandBar
            labels={labels}
            onAddLink={addLink}
            onIndent={editorCommands.indentBlock}
            onOutdent={editorCommands.outdentBlock}
            onReset={resetValue}
            onToggleBlockquote={editorCommands.toggleBlockquote}
            onToggleBold={editorCommands.toggleBold}
            onToggleBulletList={() => editorCommands.toggleList('disc')}
            onToggleHeading={editorCommands.toggleHeading}
            onToggleInlineCode={editorCommands.toggleInlineCode}
            onToggleItalic={editorCommands.toggleItalic}
            onToggleStrikethrough={editorCommands.toggleStrikethrough}
            onToggleTodoList={() => editorCommands.toggleList('todo')}
          />
          <DocumentSnippetMenu labels={labels}>
            {gitLabMarkdownSnippets.map(snippet => (
              <ToolbarButton key={snippet.id} onClick={() => handleSnippet(snippet)}>
                {labels.snippets[snippet.labelKey]}
              </ToolbarButton>
            ))}
          </DocumentSnippetMenu>
          <div className="reference-search-panel notion-reference-panel" aria-label="GitLab reference search">
            <div className="reference-search-controls">
              <span className="badge badge-info">
                {referenceSearch.kind === 'issue' ? labels.snippets.issueReference : labels.snippets.mergeRequestReference}
              </span>
              <input
                className="reference-search-input"
                value={referenceSearch.query}
                placeholder={labels.snippets.searchPlaceholder}
                onChange={event => referenceSearch.setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void referenceSearch.run()
                  }
                }}
              />
              <button className="editor-toolbar-button" type="button" onClick={() => void referenceSearch.run()}>
                {labels.snippets.search}
              </button>
              <button className="editor-toolbar-button" type="button" onClick={insertManualReference}>
                {labels.snippets.manual}
              </button>
            </div>
            {referenceSearch.state === 'error' ? (
              <p className="reference-search-message">{labels.snippets.unavailable}</p>
            ) : null}
            {referenceSearch.state === 'loaded' && referenceSearch.results.length === 0 ? (
              <p className="reference-search-message">{labels.snippets.noResults}</p>
            ) : null}
            {referenceSearch.results.length > 0 ? (
              <ul className="reference-search-results">
                {referenceSearch.results.map(result => (
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
          <div className="notion-editor-layout">
            <DocumentBlockRail
              dragOverBlockIndex={dragOverBlockIndex}
              draggedBlockIndex={draggedBlockIndex}
              labels={labels}
              value={editorValue}
              onDragEnd={handleBlockDragEnd}
              onDragOver={handleBlockDragOver}
              onDragStart={handleBlockDragStart}
              onDrop={handleBlockDrop}
            />
            <div className="editor-frame notion-editor-frame">
              <PlateContent className="plate-content notion-plate-content" placeholder={labels.placeholder} />
            </div>
          </div>
        </Plate>
      </div>
    </section>
  )
}
