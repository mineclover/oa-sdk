import type { Value } from 'platejs'
import { plateValueToGitLabMarkdown } from '@oa-sdk/markdown-editor'
import { analyzeMarkdown } from '../editor/markdown-insights.js'
import { parseMarkdownTable } from './markdown-table.js'

export function DocumentLiveMarkdownSurface({
  activeBlockIndex,
  draftMarkdown,
  labels,
  onBlurBlock,
  onCancelBlock,
  onChangeDraft,
  onEditTable,
  onFocusBlock,
  value,
}: {
  readonly activeBlockIndex: number | null
  readonly draftMarkdown: string
  readonly labels: {
    readonly editTable: string
    readonly emptyBlock: string
  }
  readonly onBlurBlock: () => void
  readonly onCancelBlock: () => void
  readonly onChangeDraft: (value: string) => void
  readonly onEditTable: (index: number) => void
  readonly onFocusBlock: (index: number) => void
  readonly value: Value
}) {
  return (
    <div className="live-markdown-surface">
      {value.map((node, index) => {
        const markdown = plateValueToGitLabMarkdown([node])
        const isActive = activeBlockIndex === index
        return (
          <section
            className={'live-markdown-block' + (isActive ? ' live-markdown-block-active' : '')}
            key={`${String(node.type ?? 'p')}-${String(index)}`}
          >
            {isActive ? (
              <textarea
                autoFocus
                className="live-markdown-editor"
                value={draftMarkdown}
                onBlur={onBlurBlock}
                onChange={event => onChangeDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onCancelBlock()
                    return
                  }
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    onBlurBlock()
                  }
                }}
              />
            ) : (
              <div
                className="live-markdown-preview-button"
                role="button"
                tabIndex={0}
                onClick={() => onFocusBlock(index)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onFocusBlock(index)
                  }
                }}
              >
                <MarkdownBlockPreview
                  emptyBlock={labels.emptyBlock}
                  markdown={markdown}
                  onEditTable={() => onEditTable(index)}
                  tableEditLabel={labels.editTable}
                />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function MarkdownBlockPreview({
  emptyBlock,
  markdown,
  onEditTable,
  tableEditLabel,
}: {
  readonly emptyBlock: string
  readonly markdown: string
  readonly onEditTable: () => void
  readonly tableEditLabel: string
}) {
  const trimmed = markdown.trim()
  const table = parseMarkdownTable(trimmed)
  if (table !== null) {
    return (
      <div className="live-markdown-table-preview">
        <div className="live-markdown-table-scroll">
          <table>
            <thead>
              <tr>{table.headers.map((header, index) => <th key={index}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <span
          className="editor-toolbar-button live-markdown-table-edit"
          role="button"
          tabIndex={0}
          onClick={event => {
            event.stopPropagation()
            onEditTable()
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onEditTable()
            }
          }}
        >
          {tableEditLabel}
        </span>
      </div>
    )
  }
  if (trimmed.length === 0) return <p className="live-markdown-empty">{emptyBlock}</p>
  if (trimmed.startsWith('```')) return <pre>{trimmed.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')}</pre>
  if (/^#{1,6}\s/.test(trimmed)) {
    const level = Math.min(6, trimmed.match(/^#+/)?.[0].length ?? 1)
    const text = trimmed.replace(/^#{1,6}\s/, '')
    const Heading = `h${String(level)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    return <Heading>{text}</Heading>
  }
  if (trimmed.startsWith('> ')) {
    return <blockquote>{trimmed.split('\n').map(line => line.replace(/^>\s?/, '')).join('\n')}</blockquote>
  }
  const tasks = analyzeMarkdown(trimmed).tasks
  if (tasks.length > 0) {
    return (
      <ul className="live-markdown-task-list">
        {tasks.map(task => (
          <li key={`${String(task.line)}-${task.text}`}>
            <span className="live-markdown-task-marker">{task.marker}</span>
            <span>{task.text}</span>
          </li>
        ))}
      </ul>
    )
  }
  if (/^!\[[^\]]*]\([^)]+\)$/.test(trimmed)) {
    const match = trimmed.match(/^!\[([^\]]*)]\(([^)]+)\)$/)
    return <img alt={match?.[1] ?? ''} src={match?.[2] ?? ''} />
  }
  return <p>{trimmed.replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1')}</p>
}
