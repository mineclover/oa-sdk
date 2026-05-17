import { useEffect, useRef, useState, type DragEvent } from 'react'
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
import { DocumentLiveMarkdownSurface } from './DocumentLiveMarkdownSurface.js'
import {
  DocumentBlockRail,
  DocumentCommandBar,
  DocumentImageInsertPanel,
  DocumentLinkPanel,
  DocumentMarkdownInsertPanel,
  DocumentProperties,
  DocumentSnippetMenu,
  DocumentTableEditorModal,
  ToolbarButton,
} from './DocumentEditorUi.js'
import type { PlateDocumentEditorProps } from './PlateDocumentEditor.types.js'
import { reorderDocumentEditorBlocks } from './document-editor-blocks.js'
import { parseMarkdownTable } from './markdown-table.js'
import { useDocumentTableEditor } from './useDocumentTableEditor.js'
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
  const [linkPanelOpen, setLinkPanelOpen] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [markdownPanelTitle, setMarkdownPanelTitle] = useState('')
  const [markdownPanelValue, setMarkdownPanelValue] = useState('')
  const [imagePanelOpen, setImagePanelOpen] = useState(false)
  const [imageAlt, setImageAlt] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [activeBlockIndex, setActiveBlockIndex] = useState<number | null>(null)
  const [draftMarkdown, setDraftMarkdown] = useState('')
  const skipNextBlockCommit = useRef(false)
  const [editorValue, setEditorValue] = useState<Value>(
    () => parseStoredEditorValue(window.localStorage.getItem(storageKey), initialValue) as Value,
  )
  const editor = usePlateEditor({
    plugins: createGitLabPlatePlugins() as never,
    value: editorValue,
  })
  const editorCommands = createGitLabPlateCommands(editor)
  const tableEditorController = useDocumentTableEditor({
    commitActiveBlock,
    syncEditorValue,
    value: editorValue,
  })

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
    commitActiveBlock()
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
    commitActiveBlock()
    closeInsertPanels()
    setLinkPanelOpen(true)
    setLinkText('')
    setLinkUrl('')
  }

  function closeInsertPanels() {
    setLinkPanelOpen(false)
    setLinkText('')
    setLinkUrl('')
    setMarkdownPanelTitle('')
    setMarkdownPanelValue('')
    setImagePanelOpen(false)
    setImageAlt('')
    setImageUrl('')
  }

  function cancelLinkPanel() {
    closeInsertPanels()
  }

  function submitLinkPanel() {
    const url = linkUrl.trim()
    if (url.length === 0) return
    const text = linkText.trim().length > 0 ? linkText.trim() : url
    insertRawGitLabMarkdown(`[${text}](${url})`)
    closeInsertPanels()
  }

  function openMarkdownPanel(title: string, fallbackMarkdown: string) {
    closeInsertPanels()
    setMarkdownPanelTitle(title)
    setMarkdownPanelValue(fallbackMarkdown)
  }

  function submitMarkdownPanel() {
    const markdown = markdownPanelValue.trim()
    if (markdown.length === 0) return
    insertRawGitLabMarkdown(markdown)
    closeInsertPanels()
  }

  function openImagePanel(snippet: Extract<GitLabMarkdownSnippet, { readonly kind: 'image' }>) {
    closeInsertPanels()
    setImagePanelOpen(true)
    setImageUrl(snippet.defaultUrl)
    setImageAlt(snippet.defaultAlt)
  }

  function submitImagePanel() {
    const url = imageUrl.trim()
    if (url.length === 0) return
    insertRawGitLabMarkdown(createGitLabMarkdownImageSnippetMarkdown({
      alt: imageAlt.trim().length > 0 ? imageAlt.trim() : labels.snippets.image,
      url,
    }))
    closeInsertPanels()
  }

  function insertReferenceSuggestion(suggestion: { readonly glfmReference: string }) {
    insertRawGitLabMarkdown(suggestion.glfmReference)
  }

  function insertRawGitLabMarkdown(markdown: string) {
    const insertIndex = activeBlockIndex === null ? editorValue.length : activeBlockIndex + 1
    const nextValue = [...editorValue]
    nextValue.splice(insertIndex, 0, {
      children: [{ text: markdown }],
      glfmRaw: true,
      type: 'p',
    } as Value[number])
    syncEditorValue(nextValue)
  }

  function insertManualReference() {
    openMarkdownPanel(
      referenceSearch.kind === 'issue' ? labels.snippets.issueReference : labels.snippets.mergeRequestReference,
      referenceSearch.kind === 'issue' ? '#123' : '!123',
    )
  }

  function handleSnippet(snippet: GitLabMarkdownSnippet) {
    if (snippet.kind === 'reference') {
      referenceSearch.open(snippet.referenceKind)
      return
    }
    if (snippet.kind === 'raw') {
      if (snippet.id === 'table') {
        tableEditorController.openTableEditor(null, snippet.markdown)
        return
      }
      insertRawGitLabMarkdown(snippet.markdown)
      return
    }
    if (snippet.kind === 'prompt') {
      openMarkdownPanel(labels.snippets[snippet.labelKey], snippet.fallbackMarkdown)
      return
    }

    openImagePanel(snippet)
  }

  function focusBlock(index: number) {
    commitActiveBlock()
    setActiveBlockIndex(index)
    setDraftMarkdown(plateValueToGitLabMarkdown([editorValue[index] as Value[number]]))
  }

  function commitActiveBlock() {
    if (skipNextBlockCommit.current) {
      skipNextBlockCommit.current = false
      return
    }
    if (activeBlockIndex === null) return
    const originalNode = editorValue[activeBlockIndex]
    if (originalNode === undefined) {
      setActiveBlockIndex(null)
      setDraftMarkdown('')
      return
    }
    const markdown = draftMarkdown.trim()
    const replacement = markdown.length === 0
      ? [{ children: [{ text: '' }], type: 'p' } as Value[number]]
      : shouldKeepRawBlock(originalNode, markdown)
        ? [{ children: [{ text: markdown }], glfmRaw: true, type: 'p' } as Value[number]]
        : editorCommands.resetValueFromMarkdown(markdown)
    const nextValue = [
      ...editorValue.slice(0, activeBlockIndex),
      ...replacement,
      ...editorValue.slice(activeBlockIndex + 1),
    ]
    setActiveBlockIndex(null)
    setDraftMarkdown('')
    syncEditorValue(nextValue)
  }

  function cancelActiveBlock() {
    skipNextBlockCommit.current = true
    setActiveBlockIndex(null)
    setDraftMarkdown('')
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
          {linkPanelOpen ? (
            <DocumentLinkPanel
              labels={labels}
              setText={setLinkText}
              setUrl={setLinkUrl}
              text={linkText}
              url={linkUrl}
              onCancel={cancelLinkPanel}
              onSubmit={submitLinkPanel}
            />
          ) : null}
          {markdownPanelTitle.length > 0 ? (
            <DocumentMarkdownInsertPanel
              labels={labels}
              markdown={markdownPanelValue}
              setMarkdown={setMarkdownPanelValue}
              title={markdownPanelTitle}
              onCancel={closeInsertPanels}
              onSubmit={submitMarkdownPanel}
            />
          ) : null}
          {imagePanelOpen ? (
            <DocumentImageInsertPanel
              alt={imageAlt}
              labels={labels}
              setAlt={setImageAlt}
              setUrl={setImageUrl}
              url={imageUrl}
              onCancel={closeInsertPanels}
              onSubmit={submitImagePanel}
            />
          ) : null}
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
              <DocumentLiveMarkdownSurface
                activeBlockIndex={activeBlockIndex}
                draftMarkdown={draftMarkdown}
                labels={{
                  editTable: labels.tableEdit,
                  emptyBlock: labels.liveEmptyBlock,
                }}
                value={editorValue}
                onBlurBlock={commitActiveBlock}
                onCancelBlock={cancelActiveBlock}
                onChangeDraft={setDraftMarkdown}
                onEditTable={tableEditorController.openExistingTableEditor}
                onFocusBlock={focusBlock}
              />
              <PlateContent className="plate-content notion-plate-content plate-content-hidden" placeholder={labels.placeholder} />
            </div>
          </div>
          {tableEditorController.tableEditor === null ? null : (
            <DocumentTableEditorModal
              labels={labels}
              table={tableEditorController.tableEditor.table}
              onAddColumn={tableEditorController.addTableColumn}
              onAddRow={tableEditorController.addTableRow}
              onCancel={tableEditorController.closeTableEditor}
              onChangeCell={tableEditorController.changeTableCell}
              onChangeHeader={tableEditorController.changeTableHeader}
              onRemoveColumn={tableEditorController.removeTableColumn}
              onRemoveRow={tableEditorController.removeTableRow}
              onSubmit={tableEditorController.submitTableEditor}
            />
          )}
        </Plate>
      </div>
    </section>
  )
}

function shouldKeepRawBlock(node: Value[number], markdown: string): boolean {
  if ((node as { glfmRaw?: unknown }).glfmRaw === true) return true
  if (parseMarkdownTable(markdown) !== null) return true
  if (markdown.startsWith('```mermaid') || markdown.startsWith('```math')) return true
  if (markdown.startsWith('> [!')) return true
  if (markdown === '[[_TOC_]]') return true
  return /^!\[[^\]]*]\([^)]+\)$/.test(markdown)
}
