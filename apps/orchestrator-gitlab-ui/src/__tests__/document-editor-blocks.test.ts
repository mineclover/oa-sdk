import { describe, expect, it } from 'vitest'
import {
  documentEditorBlockLabel,
  documentEditorBlockTypeLabel,
  documentEditorNodeText,
  reorderDocumentEditorBlocks,
} from '../components/document-editor-blocks.js'

describe('document editor block helpers', () => {
  it('extracts nested block text for block rail labels', () => {
    expect(documentEditorNodeText({
      children: [
        { text: 'Release ' },
        { children: [{ text: 'pipeline' }], type: 'a' },
      ],
      type: 'p',
    })).toBe('Release pipeline')
  })

  it('formats block labels and type labels', () => {
    expect(documentEditorBlockLabel({ children: [{ text: '  Release   notes  ' }], type: 'h2' }, 0)).toBe('Release notes')
    expect(documentEditorBlockLabel({ children: [{ text: '' }], type: 'p' }, 2)).toBe('Block 3')
    expect(documentEditorBlockTypeLabel({ children: [{ text: 'Task' }], listStyleType: 'todo', type: 'p' })).toBe('todo')
  })

  it('reorders top-level editor blocks without mutating the source value', () => {
    const value = [
      { children: [{ text: 'A' }], type: 'p' },
      { children: [{ text: 'B' }], type: 'p' },
      { children: [{ text: 'C' }], type: 'p' },
    ]

    const nextValue = reorderDocumentEditorBlocks(value, 0, 2)

    expect(nextValue.map(node => documentEditorNodeText(node))).toEqual(['B', 'C', 'A'])
    expect(value.map(node => documentEditorNodeText(node))).toEqual(['A', 'B', 'C'])
  })

  it('returns the same value for invalid reorder requests', () => {
    const value = [{ children: [{ text: 'A' }], type: 'p' }]

    expect(reorderDocumentEditorBlocks(value, 0, 0)).toBe(value)
    expect(reorderDocumentEditorBlocks(value, -1, 0)).toBe(value)
    expect(reorderDocumentEditorBlocks(value, 0, 2)).toBe(value)
  })
})
