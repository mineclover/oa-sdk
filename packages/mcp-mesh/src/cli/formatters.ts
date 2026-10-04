/**
 * @oa-sdk/mcp-mesh — CLI Output Formatters
 */

export function formatOutput(data: unknown, format: 'json' | 'table' = 'table'): string {
  if (data === null || data === undefined) return ''
  if (typeof data === 'string') return data

  if (format === 'json') {
    return JSON.stringify(data, null, 2)
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return 'No entries found.'
    if (typeof data[0] === 'object' && data[0] !== null) {
      return formatTable(data as Record<string, unknown>[])
    }
    return data.join('\n')
  }

  if (typeof data === 'object') {
    return JSON.stringify(data, null, 2)
  }

  return String(data)
}

export function formatTable(items: Record<string, unknown>[]): string {
  if (items.length === 0) return 'No entries found.'
  const keys = Object.keys(items[0]!)
  if (keys.length === 0) return 'No entries found.'

  const widths = keys.map((k) =>
    Math.max(
      k.length,
      ...items.map((it) => {
        const val = it[k]
        const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')
        return str.length
      }),
    ),
  )

  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join('  ')
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  const rows = items.map((it) =>
    keys
      .map((k, i) => {
        const val = it[k]
        const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')
        return str.padEnd(widths[i]!)
      })
      .join('  '),
  )

  return [header, separator, ...rows].join('\n')
}
