import type { MarkdownEditorValue } from './types.js'

export function parseStoredEditorValue(
  rawValue: string | null,
  fallbackValue: MarkdownEditorValue,
): MarkdownEditorValue {
  if (rawValue === null) return fallbackValue

  try {
    const parsed = JSON.parse(rawValue)
    return isMarkdownEditorValue(parsed) ? parsed : fallbackValue
  } catch {
    return fallbackValue
  }
}

export function serializeEditorValue(value: MarkdownEditorValue): string {
  return JSON.stringify(value)
}

export function isMarkdownEditorValue(value: unknown): value is MarkdownEditorValue {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(node => isMarkdownEditorNode(node))
}

function isMarkdownEditorNode(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const children = (value as { children?: unknown }).children
  return Array.isArray(children)
}

