import type { DragEvent, ReactNode } from 'react'
import type { Value } from 'platejs'
import {
  documentEditorBlockLabel,
  documentEditorBlockTypeLabel,
} from './document-editor-blocks.js'
import type {
  PlateDocumentEditorDocument,
  PlateDocumentEditorLabels,
} from './PlateDocumentEditor.types.js'

export function ToolbarButton({
  children,
  onClick,
}: {
  readonly children: string
  readonly onClick: () => void
}) {
  return (
    <button className="editor-toolbar-button" type="button" onClick={onClick}>
      {children}
    </button>
  )
}

export function DocumentProperties({
  document,
  labels,
}: {
  readonly document: PlateDocumentEditorDocument
  readonly labels: PlateDocumentEditorLabels
}) {
  return (
    <>
      <div className="notion-page-kicker">
        <span className="badge badge-info">{labels.saved}</span>
        <span>{labels.title}</span>
      </div>
      <h1 className="notion-page-title">{document.title}</h1>
      <dl className="notion-property-grid">
        <div>
          <dt>{labels.project}</dt>
          <dd>{document.project}</dd>
        </div>
        <div>
          <dt>{labels.path}</dt>
          <dd>{document.path}</dd>
        </div>
        <div>
          <dt>{labels.owner}</dt>
          <dd>{document.owner}</dd>
        </div>
        <div>
          <dt>{labels.status}</dt>
          <dd>{labels.saved}</dd>
        </div>
      </dl>
    </>
  )
}

export function DocumentCommandBar({
  labels,
  onAddLink,
  onIndent,
  onOutdent,
  onReset,
  onToggleBlockquote,
  onToggleBold,
  onToggleBulletList,
  onToggleHeading,
  onToggleInlineCode,
  onToggleItalic,
  onToggleStrikethrough,
  onToggleTodoList,
}: {
  readonly labels: PlateDocumentEditorLabels
  readonly onAddLink: () => void
  readonly onIndent: () => void
  readonly onOutdent: () => void
  readonly onReset: () => void
  readonly onToggleBlockquote: () => void
  readonly onToggleBold: () => void
  readonly onToggleBulletList: () => void
  readonly onToggleHeading: (level: 1 | 2 | 3) => void
  readonly onToggleInlineCode: () => void
  readonly onToggleItalic: () => void
  readonly onToggleStrikethrough: () => void
  readonly onToggleTodoList: () => void
}) {
  return (
    <div className="notion-command-bar" aria-label="Document editor toolbar">
      <div className="notion-command-group">
        <span>{labels.blocks}</span>
        <ToolbarButton onClick={() => onToggleHeading(1)}>{labels.toolbar.heading1}</ToolbarButton>
        <ToolbarButton onClick={() => onToggleHeading(2)}>{labels.toolbar.heading2}</ToolbarButton>
        <ToolbarButton onClick={() => onToggleHeading(3)}>{labels.toolbar.heading3}</ToolbarButton>
        <ToolbarButton onClick={onToggleBlockquote}>{labels.toolbar.quote}</ToolbarButton>
        <ToolbarButton onClick={onToggleBulletList}>{labels.toolbar.bulletList}</ToolbarButton>
        <ToolbarButton onClick={onToggleTodoList}>{labels.toolbar.todoList}</ToolbarButton>
      </div>
      <div className="notion-command-group">
        <span>{labels.formatting}</span>
        <ToolbarButton onClick={onToggleBold}>{labels.toolbar.bold}</ToolbarButton>
        <ToolbarButton onClick={onToggleItalic}>{labels.toolbar.italic}</ToolbarButton>
        <ToolbarButton onClick={onToggleInlineCode}>{labels.toolbar.code}</ToolbarButton>
        <ToolbarButton onClick={onToggleStrikethrough}>{labels.toolbar.strike}</ToolbarButton>
        <ToolbarButton onClick={onAddLink}>{labels.toolbar.link}</ToolbarButton>
        <ToolbarButton onClick={onIndent}>{labels.toolbar.indent}</ToolbarButton>
        <ToolbarButton onClick={onOutdent}>{labels.toolbar.outdent}</ToolbarButton>
      </div>
      <button className="editor-toolbar-button editor-toolbar-reset" type="button" onClick={onReset}>
        {labels.reset}
      </button>
    </div>
  )
}

export function DocumentSnippetMenu({
  labels,
  children,
}: {
  readonly labels: PlateDocumentEditorLabels
  readonly children: ReactNode
}) {
  return (
    <div className="notion-block-menu" aria-label="GitLab Markdown snippets">
      <div className="notion-block-menu-title">{labels.references}</div>
      <div className="notion-block-menu-actions">{children}</div>
    </div>
  )
}

export function DocumentBlockRail({
  dragOverBlockIndex,
  draggedBlockIndex,
  labels,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  value,
}: {
  readonly dragOverBlockIndex: number | null
  readonly draggedBlockIndex: number | null
  readonly labels: PlateDocumentEditorLabels
  readonly onDragEnd: () => void
  readonly onDragOver: (event: DragEvent<HTMLButtonElement>, index: number) => void
  readonly onDragStart: (event: DragEvent<HTMLButtonElement>, index: number) => void
  readonly onDrop: (event: DragEvent<HTMLButtonElement>, index: number) => void
  readonly value: Value
}) {
  return (
    <aside className="notion-block-rail" aria-label={labels.blockOrder}>
      <div className="notion-block-rail-title">{labels.blockOrder}</div>
      <div className="notion-block-list">
        {value.map((node, index) => (
          <button
            className={
              'notion-block-handle' +
              (draggedBlockIndex === index ? ' notion-block-handle-dragging' : '') +
              (dragOverBlockIndex === index && draggedBlockIndex !== index ? ' notion-block-handle-over' : '')
            }
            draggable
            key={`${String(node.type ?? 'p')}-${String(index)}`}
            title={labels.dragBlock}
            type="button"
            onDragEnd={onDragEnd}
            onDragOver={event => onDragOver(event, index)}
            onDragStart={event => onDragStart(event, index)}
            onDrop={event => onDrop(event, index)}
          >
            <span className="notion-block-grip" aria-hidden="true">::</span>
            <span className="notion-block-summary">
              <span>{documentEditorBlockLabel(node, index)}</span>
              <small>{documentEditorBlockTypeLabel(node)}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
