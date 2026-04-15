import type { LintResult } from '@oa-sdk/parser'

export type SourceLocationLookup = (filePath: string, pointer: string) => { line: number; column: number } | undefined

export type FormatLintLocationOptions = {
  defaultFilePath?: string
  lookupSourceLocation?: SourceLocationLookup
}

export function formatLintLocation(result: LintResult, options: FormatLintLocationOptions = {}): string {
  const source = formatLintSource(result, options)
  return source ? `${result.path} (${source})` : result.path
}

function formatLintSource(result: LintResult, options: FormatLintLocationOptions): string | undefined {
  const { source } = result
  const primary = source?.sourceFilePath && source.sourcePointer
    ? { filePath: source.sourceFilePath, pointer: source.sourcePointer }
    : source?.filePath
      ? { filePath: source.filePath, pointer: source.pointer ?? '#' }
      : options.defaultFilePath
        ? { filePath: options.defaultFilePath, pointer: result.path }
        : undefined
  const fallback = source?.filePath
    ? { filePath: source.filePath, pointer: source.pointer ?? '#' }
    : primary

  if (!primary) return undefined

  const location = options.lookupSourceLocation?.(primary.filePath, primary.pointer)
  const fallbackText = fallback ? formatFilePointer(fallback.filePath, fallback.pointer) : undefined

  if (location) {
    const locationText = `${primary.filePath}:${location.line}:${location.column}`
    if (fallbackText && fallbackText !== formatFilePointer(primary.filePath, primary.pointer)) {
      return `${locationText} -> ${fallbackText}`
    }
    return locationText
  }

  return fallbackText ?? formatFilePointer(primary.filePath, primary.pointer)
}

function formatFilePointer(filePath: string, pointer: string): string {
  if (pointer === '' || pointer === '#' || pointer === '/') return `${filePath}#`
  if (pointer.startsWith('#/')) return `${filePath}${pointer}`
  if (pointer.startsWith('/')) return `${filePath}#${pointer}`
  return `${filePath}#/${pointer}`
}
