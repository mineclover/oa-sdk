import type { Value } from 'platejs'

export function documentEditorNodeText(node: unknown): string {
  if (node === null || typeof node !== 'object') return ''
  const text = (node as { text?: unknown }).text
  if (typeof text === 'string') return text
  const children = (node as { children?: unknown }).children
  if (!Array.isArray(children)) return ''
  return children.map(child => documentEditorNodeText(child)).join('')
}

export function documentEditorBlockLabel(node: Value[number], index: number): string {
  const text = documentEditorNodeText(node).trim().replace(/\s+/g, ' ')
  return text.length > 0 ? text.slice(0, 72) : `Block ${String(index + 1)}`
}

export function documentEditorBlockTypeLabel(node: Value[number]): string {
  const type = typeof node.type === 'string' ? node.type : 'p'
  if (type === 'p' && typeof node.listStyleType === 'string') return node.listStyleType
  return type
}

export function reorderDocumentEditorBlocks(value: Value, fromIndex: number, toIndex: number): Value {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return value
  if (fromIndex >= value.length || toIndex >= value.length) return value
  const nextValue = [...value]
  const [moved] = nextValue.splice(fromIndex, 1)
  if (moved === undefined) return value
  nextValue.splice(toIndex, 0, moved)
  return nextValue
}
