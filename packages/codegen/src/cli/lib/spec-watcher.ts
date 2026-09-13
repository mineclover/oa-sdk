import { readFile } from 'node:fs/promises'
import { watch, statSync, readdirSync, existsSync, type FSWatcher } from 'node:fs'
import { resolve, extname, dirname, basename, join, relative } from 'node:path'
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
  /** Force Linux recursive directory watching fallback strategy (useful for testing and deterministic cross-platform behavior) */
  forceLinuxFallback?: boolean
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

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.turbo',
  '.next',
  'build',
  '.agents',
  '.gemini',
])

/**
 * Recursively collects all nested directories under rootDir excluding ignored paths.
 */
export function collectDirectoriesRecursively(rootDir: string, maxDepth = 10): string[] {
  const dirs: string[] = [rootDir]
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }]

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    if (depth >= maxDepth) continue

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          const subDir = join(dir, entry.name)
          dirs.push(subDir)
          queue.push({ dir: subDir, depth: depth + 1 })
        }
      }
    } catch {
      // ignore unreadable/permission-denied directories
    }
  }
  return dirs
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

  const handleFsEvent = (_eventType: string, filename: string | Buffer | null, eventDir: string = targetDir) => {
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

    const fileToParse = isDir ? (name ? join(eventDir, name) : resolvedPath) : resolvedPath
    if (isDir) {
      const relPath = relative(targetDir, fileToParse)
      const parts = relPath.split(/[/\\]/)
      if (parts.some(p => IGNORED_DIRS.has(p) || (p.startsWith('.') && p !== '.' && p !== '..'))) {
        return
      }
      if (!existsSync(fileToParse)) return
      try {
        if (statSync(fileToParse).isDirectory()) return
      } catch {
        return
      }
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    debounceTimer = setTimeout(async () => {
      if (closed) return
      try {
        const { document, format: detectedFormat } = await parseSpecDocument(fileToParse)
        if (closed) return
        const result = onChange(document, { filePath: fileToParse, format: detectedFormat })
        if (result && typeof (result as Promise<void>).then === 'function') {
          await result
        }
      } catch (err) {
        if (closed) return
        if (onError) {
          onError(err, fileToParse)
        } else {
          console.error(`[spec-watcher] Error reloading ${fileToParse}:`, err)
        }
      }
    }, debounceMs)
  }

  const isLinux = process.platform === 'linux' || Boolean(options.forceLinuxFallback)
  const watchedDirectorySet = new Set<string>()

  function attachWatcherToDir(dir: string): void {
    if (watchedDirectorySet.has(dir) || closed) return
    try {
      const w = watch(dir, (eventType, filename) => {
        if (closed) return
        // Dynamic subdirectory detection on Linux
        if (isLinux && eventType === 'rename' && filename) {
          try {
            const potentialNewDir = join(dir, String(filename))
            if (existsSync(potentialNewDir) && statSync(potentialNewDir).isDirectory()) {
              const base = basename(potentialNewDir)
              if (!IGNORED_DIRS.has(base) && !base.startsWith('.')) {
                const subDirs = collectDirectoriesRecursively(potentialNewDir)
                for (const sub of subDirs) {
                  attachWatcherToDir(sub)
                }
              }
            }
          } catch {
            // ignore race conditions
          }
        }
        handleFsEvent(eventType, filename, dir)
      })
      watchers.push(w)
      watchedDirectorySet.add(dir)
    } catch {
      // ignore individual watch failures
    }
  }

  if (isLinux) {
    // Linux inotify fallback: Attach individual watchers across all directory levels
    const allDirs = isDir ? collectDirectoriesRecursively(targetDir) : [targetDir]
    for (const dir of allDirs) {
      attachWatcherToDir(dir)
    }
  } else {
    // macOS / Windows: Try native recursive watching with fallback
    try {
      const watcher = watch(targetDir, { recursive: true }, handleFsEvent)
      watchers.push(watcher)
      watchedDirectorySet.add(targetDir)
    } catch {
      const allDirs = isDir ? collectDirectoriesRecursively(targetDir) : [targetDir]
      for (const dir of allDirs) {
        attachWatcherToDir(dir)
      }
    }
  }

  return {
    get watchedDirs() {
      return Array.from(watchedDirectorySet)
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
      watchedDirectorySet.clear()
    },
  }
}
