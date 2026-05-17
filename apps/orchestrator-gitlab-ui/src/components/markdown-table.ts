export interface MarkdownTable {
  readonly headers: string[]
  readonly rows: string[][]
}

export function parseMarkdownTable(markdown: string): MarkdownTable | null {
  const lines = markdown.trim().split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length < 2) return null
  const headerLine = lines[0]
  const separatorLine = lines[1]
  if (headerLine === undefined || separatorLine === undefined) return null
  const headers = parseTableRow(headerLine)
  const separator = parseTableRow(separatorLine)
  if (headers.length === 0 || separator.length !== headers.length) return null
  if (!separator.every(cell => /^:?-{3,}:?$/.test(cell.trim()))) return null
  const rows = lines.slice(2).map(line => normalizeRow(parseTableRow(line), headers.length))
  return { headers, rows }
}

export function markdownTableToMarkdown(table: MarkdownTable): string {
  const headers = table.headers.map(header => header.trim().length > 0 ? header.trim() : 'Column')
  const rows = table.rows.map(row => normalizeRow(row, headers.length))
  return [
    formatTableRow(headers),
    formatTableRow(headers.map(() => '---')),
    ...rows.map(formatTableRow),
  ].join('\n')
}

export function createDefaultMarkdownTable(): MarkdownTable {
  return {
    headers: ['Status', 'Owner', 'Reference'],
    rows: [['Open', '@user', '#123']],
  }
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed.slice(1, -1).split('|').map(cell => cell.trim())
}

function normalizeRow(row: readonly string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => row[index] ?? '')
}

function formatTableRow(row: readonly string[]): string {
  return `| ${row.map(cell => cell.trim()).join(' | ')} |`
}
