import { useState } from 'react'
import type { Value } from 'platejs'
import { plateValueToGitLabMarkdown } from '@oa-sdk/markdown-editor'
import {
  createDefaultMarkdownTable,
  markdownTableToMarkdown,
  parseMarkdownTable,
  type MarkdownTable,
} from './markdown-table.js'

interface TableEditorState {
  readonly blockIndex: number | null
  readonly table: MarkdownTable
}

export function useDocumentTableEditor({
  commitActiveBlock,
  syncEditorValue,
  value,
}: {
  readonly commitActiveBlock: () => void
  readonly syncEditorValue: (value: Value) => void
  readonly value: Value
}) {
  const [tableEditor, setTableEditor] = useState<TableEditorState | null>(null)

  function openTableEditor(blockIndex: number | null, markdown: string) {
    commitActiveBlock()
    setTableEditor({
      blockIndex,
      table: parseMarkdownTable(markdown) ?? createDefaultMarkdownTable(),
    })
  }

  function openExistingTableEditor(index: number) {
    const node = value[index]
    if (node === undefined) return
    openTableEditor(index, plateValueToGitLabMarkdown([node]))
  }

  function updateTableEditor(nextTable: MarkdownTable) {
    setTableEditor(current => current === null ? null : { ...current, table: nextTable })
  }

  function changeTableHeader(index: number, nextValue: string) {
    if (tableEditor === null) return
    updateTableEditor({
      ...tableEditor.table,
      headers: tableEditor.table.headers.map((header, headerIndex) => headerIndex === index ? nextValue : header),
    })
  }

  function changeTableCell(rowIndex: number, cellIndex: number, nextValue: string) {
    if (tableEditor === null) return
    updateTableEditor({
      ...tableEditor.table,
      rows: tableEditor.table.rows.map((row, index) => index === rowIndex
        ? row.map((cell, currentCellIndex) => currentCellIndex === cellIndex ? nextValue : cell)
        : row),
    })
  }

  function addTableRow() {
    if (tableEditor === null) return
    updateTableEditor({
      ...tableEditor.table,
      rows: [...tableEditor.table.rows, tableEditor.table.headers.map(() => '')],
    })
  }

  function addTableColumn() {
    if (tableEditor === null) return
    updateTableEditor({
      headers: [...tableEditor.table.headers, 'Column'],
      rows: tableEditor.table.rows.map(row => [...row, '']),
    })
  }

  function removeTableRow(index: number) {
    if (tableEditor === null) return
    updateTableEditor({
      ...tableEditor.table,
      rows: tableEditor.table.rows.filter((_, rowIndex) => rowIndex !== index),
    })
  }

  function removeTableColumn(index: number) {
    if (tableEditor === null || tableEditor.table.headers.length <= 1) return
    updateTableEditor({
      headers: tableEditor.table.headers.filter((_, headerIndex) => headerIndex !== index),
      rows: tableEditor.table.rows.map(row => row.filter((_, cellIndex) => cellIndex !== index)),
    })
  }

  function submitTableEditor() {
    if (tableEditor === null) return
    const markdown = markdownTableToMarkdown(tableEditor.table)
    const tableNode = { children: [{ text: markdown }], glfmRaw: true, type: 'p' } as Value[number]
    if (tableEditor.blockIndex === null) {
      syncEditorValue([...value, tableNode])
    } else {
      const nextValue = [...value]
      nextValue[tableEditor.blockIndex] = tableNode
      syncEditorValue(nextValue)
    }
    setTableEditor(null)
  }

  return {
    addTableColumn,
    addTableRow,
    changeTableCell,
    changeTableHeader,
    closeTableEditor: () => setTableEditor(null),
    openExistingTableEditor,
    openTableEditor,
    removeTableColumn,
    removeTableRow,
    submitTableEditor,
    tableEditor,
  }
}
