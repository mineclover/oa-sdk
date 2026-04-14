import type { LintResult } from '@oa-sdk/parser'

export function formatLintLocation(result: LintResult): string {
  const source = formatLintSource(result)
  return source ? `${result.path} (${source})` : result.path
}

function formatLintSource(result: LintResult): string | undefined {
  const { source } = result
  if (!source?.filePath) return undefined
  return `${source.filePath}${source.pointer ?? ''}`
}
