import { readFile } from 'node:fs/promises'
import { watch, statSync, type FSWatcher } from 'node:fs'
import { resolve, extname, dirname, basename } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  extractOperationsFromSource,
  type ExtractedOperation,
  type OasDocument,
} from '@oa-sdk/parser'

export type SpecFileFormat = 'yaml' | 'json' | 'typescript' | 'typespec'

export interface SpecWatcherOptions {
  /** Debounce delay in milliseconds (default: 100ms) */
  debounceMs?: number
  /** Callback invoked when a specification is successfully parsed and ready for hot-swap */
  onChange: (doc: OasDocument, context: { filePath: string; format: SpecFileFormat }) => Promise<void> | void
  /** Callback invoked when a parse or compilation error occurs (prevents process crashes) */
  onError?: (error: unknown, filePath: string) => void
}

export interface SpecWatcher {
  /** Stop watching files and clear pending debounce timers */
  close(): void
  /** Readonly list of monitored directory paths */
  readonly watchedDirs: readonly string[]
  /** Readonly list of explicitly monitored target files */
  readonly targetFiles: readonly string[]
}

/**
 * Detect specification file format from file extension.
 * Supported: 'yaml' (.yaml, .yml), 'json' (.json), 'typescript' (.ts, .tsx), 'typespec' (.tsp).
 */
export function detectSpecFormat(filePath: string): SpecFileFormat {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  if (ext === '.json') return 'json'
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  if (ext === '.tsp') return 'typespec'
  throw new Error(`Unsupported specification file extension: ${ext || '(no extension)'} (${filePath})`)
}

/**
 * Assembles a valid OpenAPI 3.2.0 document from extracted @oaOperation metadata.
 * Synthesizes a fallback 200 OK JSON response for operations without responses.
 */
export function buildDocumentFromOperations(
  operations: readonly ExtractedOperation[],
  sourceFile?: string,
): OasDocument {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const op of operations) {
    let pathItem = paths[op.path]
    if (!pathItem) {
      pathItem = {}
      paths[op.path] = pathItem
    }
    const operationId = op.operationEntry.operationId ?? op.declarationName
    const method = op.method.toLowerCase()

    pathItem[method] = {
      operationId,
      ...(op.summary ? { summary: op.summary } : {}),
      ...(op.description ? { description: op.description } : {}),
      ...(op.deprecated ? { deprecated: true } : {}),
      ...(op.operationEntry.tags && op.operationEntry.tags.length > 0 ? { tags: [...op.operationEntry.tags] } : {}),
      ...(op.operationEntry.parameters && op.operationEntry.parameters.length > 0
        ? { parameters: [...op.operationEntry.parameters] }
        : {}),
      ...(op.operationEntry.requestBody ? { requestBody: op.operationEntry.requestBody } : {}),
      responses:
        op.operationEntry.responses && Object.keys(op.operationEntry.responses).length > 0
          ? op.operationEntry.responses
          : {
              '200': {
                description: 'Generated mock response for @oaOperation',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                    example: {
                      status: 'ok',
                      operationId,
                      method: op.method.toUpperCase(),
                      path: op.path,
                    },
                  },
                },
              },
            },
    }
  }

  return {
    openapi: '3.2.0',
    info: {
      title: sourceFile ? `Mock from ${sourceFile}` : 'Mock Server API',
      version: '1.0.0',
    },
    paths: paths as any,
  }
}

/**
 * Reads and parses an OpenAPI document from a YAML, JSON, or TypeScript file.
 */
export async function parseSpecDocument(
  filePath: string,
): Promise<{ document: OasDocument; format: SpecFileFormat }> {
  const resolved = resolve(filePath)
  const format = detectSpecFormat(resolved)

  if (format === 'typescript') {
    const sourceText = await readFile(resolved, 'utf-8')
    const result = extractOperationsFromSource(sourceText, resolved)
    const errorDiagnostics = result.diagnostics.filter(d => d.severity === 'error')
    if (errorDiagnostics.length > 0) {
      const messages = errorDiagnostics.map(d => `[line ${d.line}:${d.column}] ${d.message}`).join('\n')
      throw new Error(`Failed to extract @oaOperation annotations from ${resolved}:\n${messages}`)
    }
    const document = buildDocumentFromOperations(result.operations, resolved)
    return { document, format }
  }

  if (format === 'json') {
    const raw = await readFile(resolved, 'utf-8')
    try {
      const document = JSON.parse(raw) as OasDocument
      if (!document || typeof document !== 'object') {
        throw new Error('Parsed JSON content is not an object')
      }
      return { document, format }
    } catch (err: any) {
      throw new Error(`Failed to parse OpenAPI JSON from ${resolved}: ${err.message}`)
    }
  }

  if (format === 'yaml') {
    const raw = await readFile(resolved, 'utf-8')
    try {
      const document = parseYaml(raw) as OasDocument
      if (!document || typeof document !== 'object') {
        throw new Error('Parsed YAML content is not an object')
      }
      return { document, format }
    } catch (err: any) {
      throw new Error(`Failed to parse OpenAPI YAML from ${resolved}: ${err.message}`)
    }
  }

  throw new Error(
    `Format ${format} not supported directly in parseSpecDocument; use compileTypeSpecInMemory for .tsp`,
  )
}

/**
 * Watches target specification file or directory, debounces edits, and triggers callbacks.
 */
export function watchSpec(
  targetPath: string,
  options: SpecWatcherOptions,
): SpecWatcher {
  const { debounceMs = 100, onChange, onError } = options
  const resolvedPath = resolve(targetPath)

  let isDir = false
  try {
    isDir = statSync(resolvedPath).isDirectory()
  } catch {}

  const targetDir = isDir ? resolvedPath : dirname(resolvedPath)
  const targetBase = basename(resolvedPath)

  const watchers: FSWatcher[] = []
  let debounceTimer: NodeJS.Timeout | null = null
  let closed = false

  const handleFsEvent = (_eventType: string, filename: string | Buffer | null) => {
    if (closed) return
    const name = typeof filename === 'string' ? filename : filename ? String(filename) : ''
    if (!isDir && name) {
      const matchesTarget =
        name === targetBase ||
        name.endsWith('/' + targetBase) ||
        name.endsWith('\\' + targetBase)
      if (!matchesTarget) {
        return
      }
    } else if (isDir && name) {
      if (
        !name.endsWith('.yaml') &&
        !name.endsWith('.yml') &&
        !name.endsWith('.json') &&
        !name.endsWith('.ts') &&
        !name.endsWith('.tsx')
      ) {
        return
      }
      if (name.endsWith('.d.ts')) return
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    debounceTimer = setTimeout(async () => {
      if (closed) return
      try {
        const { document, format: detectedFormat } = await parseSpecDocument(resolvedPath)
        if (closed) return
        const result = onChange(document, { filePath: resolvedPath, format: detectedFormat })
        if (result && typeof (result as Promise<void>).then === 'function') {
          await result
        }
      } catch (err) {
        if (closed) return
        if (onError) {
          onError(err, resolvedPath)
        } else {
          console.error(`[spec-watcher] Error reloading ${resolvedPath}:`, err)
        }
      }
    }, debounceMs)
  }

  try {
    const watcher = watch(targetDir, { recursive: true }, handleFsEvent)
    watchers.push(watcher)
  } catch {
    try {
      const watcher = watch(targetDir, handleFsEvent)
      watchers.push(watcher)
    } catch {
      try {
        const watcher = watch(resolvedPath, handleFsEvent)
        watchers.push(watcher)
      } catch {
        // Fallback if filesystem watch fails
      }
    }
  }

  return {
    get watchedDirs() {
      return [targetDir]
    },
    get targetFiles() {
      return [resolvedPath]
    },
    close() {
      closed = true
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      for (const w of watchers) {
        try {
          w.close()
        } catch {}
      }
      watchers.length = 0
    },
  }
}
