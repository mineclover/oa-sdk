import type { MarkdownEditorValue } from '../core/types.js'

export function plateValueToGitLabMarkdown(value: MarkdownEditorValue): string {
  const orderedCounters = new Map<number, number>()
  let previousListStyleType: string | undefined

  return value
    .map(node => {
      const listStyleType = nodeStringProp(node, 'listStyleType')
      const indent = nodeNumberProp(node, 'indent')
      if (listStyleType === 'decimal') {
        const previous = previousListStyleType === 'decimal' ? orderedCounters.get(indent) ?? 0 : 0
        orderedCounters.set(indent, previous + 1)
      } else if (listStyleType !== undefined) {
        orderedCounters.delete(indent)
      } else {
        orderedCounters.clear()
      }
      previousListStyleType = listStyleType
      return plateNodeToMarkdown(node, orderedCounters.get(indent) ?? 1)
    })
    .filter(block => block.trim().length > 0)
    .join('\n\n')
}

function plateNodeToMarkdown(node: MarkdownEditorValue[number], orderedListNumber: number): string {
  const nodeType = typeof node.type === 'string' ? node.type : 'p'
  const isRawGitLabMarkdown = nodeBooleanProp(node, 'glfmRaw')
  const text = isRawGitLabMarkdown
    ? node.children.map(child => plateInlineToRawText(child)).join('')
    : node.children.map(child => plateInlineToMarkdown(child)).join('')
  const indent = nodeNumberProp(node, 'indent')
  const listStyleType = nodeStringProp(node, 'listStyleType')
  const indentPrefix = '  '.repeat(indent)

  if (isRawGitLabMarkdown) return `${indentPrefix}${text}`
  if (nodeType === 'h1') return `# ${text}`
  if (nodeType === 'h2') return `## ${text}`
  if (nodeType === 'h3') return `### ${text}`
  if (nodeType === 'h4') return `#### ${text}`
  if (nodeType === 'h5') return `##### ${text}`
  if (nodeType === 'h6') return `###### ${text}`
  if (nodeType === 'blockquote') return text.split('\n').map(line => `${indentPrefix}> ${line}`).join('\n')
  if (listStyleType === 'todo') return `${indentPrefix}- [${taskListMarkerFor(node)}] ${text}`
  if (listStyleType === 'decimal') return `${indentPrefix}${orderedListNumber}. ${text}`
  if (listStyleType !== undefined) return `${indentPrefix}- ${text}`
  return `${indentPrefix}${text}`
}

function plateInlineToMarkdown(node: unknown): string {
  if (node === null || typeof node !== 'object') return ''
  if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
    const children = (node as { children: unknown[] }).children.map(child => plateInlineToMarkdown(child)).join('')
    const type = (node as { type?: unknown }).type
    const url = (node as { url?: unknown }).url
    if (type === 'a' && typeof url === 'string') return `[${children}](${url})`
    return children
  }
  const text = escapeMarkdownText(String((node as { text?: unknown }).text ?? ''))
  const isBold = (node as { bold?: unknown }).bold === true
  const isItalic = (node as { italic?: unknown }).italic === true
  const isCode = (node as { code?: unknown }).code === true
  const isStrike = (node as { strikethrough?: unknown }).strikethrough === true

  let markdown = text
  if (isCode) markdown = `\`${markdown.replaceAll('`', '\\`')}\``
  if (isBold && isItalic) markdown = `***${markdown}***`
  else if (isBold) markdown = `**${markdown}**`
  else if (isItalic) markdown = `*${markdown}*`
  if (isStrike) markdown = `~~${markdown}~~`
  return markdown
}

function plateInlineToRawText(node: unknown): string {
  if (node === null || typeof node !== 'object') return ''
  if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
    return (node as { children: unknown[] }).children.map(child => plateInlineToRawText(child)).join('')
  }
  return String((node as { text?: unknown }).text ?? '')
}

function nodeStringProp(node: unknown, key: string): string | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const value = (node as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function nodeNumberProp(node: unknown, key: string): number {
  if (node === null || typeof node !== 'object') return 0
  const value = (node as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function nodeBooleanProp(node: unknown, key: string): boolean {
  if (node === null || typeof node !== 'object') return false
  return (node as Record<string, unknown>)[key] === true
}

function taskListMarkerFor(node: unknown): ' ' | 'x' | '~' {
  const taskState = nodeStringProp(node, 'taskState')
  if (taskState === 'inapplicable') return '~'
  if (taskState === 'done') return 'x'
  return nodeBooleanProp(node, 'checked') ? 'x' : ' '
}

function escapeMarkdownText(text: string): string {
  return text.replaceAll('\\', '\\\\')
}
