import { compile, NodeHost, formatDiagnostic, type Program } from '@typespec/compiler'
import { getOpenAPI3 } from '@typespec/openapi3'
import type { OasDocument } from '@oa-sdk/parser'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface TypeSpecCompilationOptions {
  oldProgram?: Program
  openApiVersion?: '3.0.0' | '3.1.0' | '3.2.0'
}

export interface TypeSpecCompilationResult {
  program: Program
  document: OasDocument
  routesCount: number
  sourceFiles: string[]
}

export interface TypeSpecWatcher {
  close(): void
}

/**
 * Compile a TypeSpec entrypoint in-memory directly to OpenAPI 3.2 without intermediate disk writes.
 * Supports incremental compilation when `options.oldProgram` is provided.
 */
export async function compileTypeSpecInMemory(
  tspPath: string,
  options?: TypeSpecCompilationOptions,
): Promise<TypeSpecCompilationResult> {
  const version = options?.openApiVersion ?? '3.2.0'
  const resolvedPath = resolve(tspPath)

  const program = await compile(NodeHost, resolvedPath, { noEmit: true }, options?.oldProgram)

  if (program.hasError()) {
    const errorDetails = program.diagnostics.map(d => formatDiagnostic(d)).join('\n')
    const error = new Error(`TypeSpec compilation failed:\n${errorDetails}`)
    ;(error as any).diagnostics = program.diagnostics
    throw error
  }

  const records = await getOpenAPI3(program, {
    'openapi-versions': [version],
  })

  if (!records || records.length === 0) {
    throw new Error(`TypeSpec compilation produced no OpenAPI 3 records for ${tspPath}`)
  }

  const record = records[0]
  if (!record) {
    throw new Error(`TypeSpec compilation produced no OpenAPI 3 records for ${tspPath}`)
  }

  const rawDoc = record.versioned
    ? record.versions[record.versions.length - 1]?.document
    : record.document

  if (!rawDoc) {
    throw new Error(`TypeSpec OpenAPI document is empty for ${tspPath}`)
  }

  const document = rawDoc as unknown as OasDocument
  let routesCount = 0
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (pathItem && typeof pathItem === 'object') {
      for (const verb of ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace', 'query']) {
        if (verb in pathItem) routesCount++
      }
    }
  }

  const sourceFiles = Array.from(program.sourceFiles.keys()).filter(
    file => Boolean(file) && !file.includes('node_modules'),
  )

  return {
    program,
    document,
    routesCount,
    sourceFiles: sourceFiles.length > 0 ? sourceFiles : [resolvedPath],
  }
}

/**
 * Watch TypeSpec source directories for changes and debounce re-compilations (default 100ms).
 */
export function watchTypeSpec(
  sourceFiles: string[],
  onChange: () => Promise<void> | void,
  onError?: (err: unknown) => void,
  debounceMs = 100,
): TypeSpecWatcher {
  const watchedDirs = new Set<string>()
  for (const file of sourceFiles) {
    try {
      watchedDirs.add(dirname(resolve(file)))
    } catch {
      // ignore unresolvable paths
    }
  }

  const watchers: FSWatcher[] = []
  let debounceTimer: NodeJS.Timeout | null = null

  const handleFsEvent = (_eventType: string, filename: string | Buffer | null) => {
    const name = typeof filename === 'string' ? filename : filename ? String(filename) : ''
    if (name && !name.endsWith('.tsp')) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      try {
        const result = onChange()
        if (result && typeof (result as Promise<void>).then === 'function') {
          ;(result as Promise<void>).catch(err => {
            if (onError) onError(err)
            else console.error(err)
          })
        }
      } catch (err) {
        if (onError) onError(err)
        else console.error(err)
      }
    }, debounceMs)
  }

  for (const dir of watchedDirs) {
    try {
      const watcher = watch(dir, { recursive: true }, handleFsEvent)
      watchers.push(watcher)
    } catch {
      try {
        const watcher = watch(dir, handleFsEvent)
        watchers.push(watcher)
      } catch {
        // directory might be inaccessible
      }
    }
  }

  return {
    close() {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      for (const w of watchers) {
        try {
          w.close()
        } catch {
          // ignore close errors
        }
      }
      watchers.length = 0
    },
  }
}
