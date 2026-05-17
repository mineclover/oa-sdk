import type { DragEvent, ReactNode } from 'react'
import type { Value } from 'platejs'
import {
  documentEditorBlockLabel,
  documentEditorBlockTypeLabel,
} from './document-editor-blocks.js'
import type { MarkdownTable } from './markdown-table.js'
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

export function DocumentLinkPanel({
  labels,
  onCancel,
  onSubmit,
  setText,
  setUrl,
  text,
  url,
}: {
  readonly labels: PlateDocumentEditorLabels
  readonly onCancel: () => void
  readonly onSubmit: () => void
  readonly setText: (value: string) => void
  readonly setUrl: (value: string) => void
  readonly text: string
  readonly url: string
}) {
  return (
    <form
      className="document-link-panel"
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div>
        <h3>{labels.linkTitle}</h3>
      </div>
      <label className="document-link-field">
        <span>{labels.linkText}</span>
        <input
          value={text}
          onChange={event => setText(event.target.value)}
        />
      </label>
      <label className="document-link-field">
        <span>{labels.linkUrl}</span>
        <input
          autoFocus
          inputMode="url"
          placeholder="https://"
          value={url}
          onChange={event => setUrl(event.target.value)}
        />
      </label>
      <div className="document-link-actions">
        <button className="editor-toolbar-button" type="submit">{labels.linkApply}</button>
        <button className="editor-toolbar-button" type="button" onClick={onCancel}>{labels.linkCancel}</button>
      </div>
    </form>
  )
}

export function DocumentMarkdownInsertPanel({
  labels,
  markdown,
  onCancel,
  onSubmit,
  setMarkdown,
  title,
}: {
  readonly labels: PlateDocumentEditorLabels
  readonly markdown: string
  readonly onCancel: () => void
  readonly onSubmit: () => void
  readonly setMarkdown: (value: string) => void
  readonly title: string
}) {
  return (
    <form
      className="document-insert-panel"
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div>
        <h3>{title.length > 0 ? title : labels.insertMarkdownTitle}</h3>
      </div>
      <label className="document-insert-field">
        <span>{labels.insertMarkdownLabel}</span>
        <textarea
          autoFocus
          rows={4}
          value={markdown}
          onChange={event => setMarkdown(event.target.value)}
        />
      </label>
      <div className="document-insert-actions">
        <button className="editor-toolbar-button" type="submit">{labels.insertMarkdownApply}</button>
        <button className="editor-toolbar-button" type="button" onClick={onCancel}>{labels.insertMarkdownCancel}</button>
      </div>
    </form>
  )
}

export function DocumentImageInsertPanel({
  alt,
  labels,
  onCancel,
  onSubmit,
  setAlt,
  setUrl,
  url,
}: {
  readonly alt: string
  readonly labels: PlateDocumentEditorLabels
  readonly onCancel: () => void
  readonly onSubmit: () => void
  readonly setAlt: (value: string) => void
  readonly setUrl: (value: string) => void
  readonly url: string
}) {
  return (
    <form
      className="document-insert-panel"
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div>
        <h3>{labels.imageTitle}</h3>
      </div>
      <label className="document-insert-field">
        <span>{labels.imageUrl}</span>
        <input
          autoFocus
          inputMode="url"
          placeholder="https://"
          value={url}
          onChange={event => setUrl(event.target.value)}
        />
      </label>
      <label className="document-insert-field">
        <span>{labels.imageAlt}</span>
        <input
          value={alt}
          onChange={event => setAlt(event.target.value)}
        />
      </label>
      <div className="document-insert-actions">
        <button className="editor-toolbar-button" type="submit">{labels.imageApply}</button>
        <button className="editor-toolbar-button" type="button" onClick={onCancel}>{labels.imageCancel}</button>
      </div>
    </form>
  )
}

export function DocumentTableEditorModal({
  labels,
  onAddColumn,
  onAddRow,
  onCancel,
  onChangeCell,
  onChangeHeader,
  onRemoveColumn,
  onRemoveRow,
  onSubmit,
  table,
}: {
  readonly labels: PlateDocumentEditorLabels
  readonly onAddColumn: () => void
  readonly onAddRow: () => void
  readonly onCancel: () => void
  readonly onChangeCell: (rowIndex: number, cellIndex: number, value: string) => void
  readonly onChangeHeader: (index: number, value: string) => void
  readonly onRemoveColumn: (index: number) => void
  readonly onRemoveRow: (index: number) => void
  readonly onSubmit: () => void
  readonly table: MarkdownTable
}) {
  return (
    <div className="document-modal-backdrop" role="presentation">
      <form
        className="document-table-modal"
        aria-label={labels.tableTitle}
        onSubmit={event => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="document-table-modal-header">
          <h3>{labels.tableTitle}</h3>
          <div className="document-table-modal-actions">
            <button className="editor-toolbar-button" type="button" onClick={onAddColumn}>{labels.tableAddColumn}</button>
            <button className="editor-toolbar-button" type="button" onClick={onAddRow}>{labels.tableAddRow}</button>
          </div>
        </div>
        <div className="document-table-editor-scroll">
          <table className="document-table-editor-grid">
            <thead>
              <tr>
                {table.headers.map((header, index) => (
                  <th key={index}>
                    <input
                      value={header}
                      onChange={event => onChangeHeader(index, event.target.value)}
                    />
                    <button className="document-table-remove" type="button" onClick={() => onRemoveColumn(index)}>
                      {labels.tableRemoveColumn}
                    </button>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {table.headers.map((_, cellIndex) => (
                    <td key={cellIndex}>
                      <input
                        value={row[cellIndex] ?? ''}
                        onChange={event => onChangeCell(rowIndex, cellIndex, event.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button className="document-table-remove" type="button" onClick={() => onRemoveRow(rowIndex)}>
                      {labels.tableRemoveRow}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="document-table-submit-row">
          <button className="editor-toolbar-button" type="submit">{labels.tableApply}</button>
          <button className="editor-toolbar-button" type="button" onClick={onCancel}>{labels.tableCancel}</button>
        </div>
      </form>
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
