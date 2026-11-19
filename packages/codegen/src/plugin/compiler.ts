import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { compile, NodeHost, formatDiagnostic, type Diagnostic, type Program } from '@typespec/compiler'
import { getOpenAPI3 } from '@typespec/openapi3'
import type { OasDocument } from '@oa-sdk/parser'
import { extractTypeSpecNamedAliases, type TypeSpecNamedAlias } from '../typespec/aliases.js'
import { createTypeSpecFallbackHost } from '../typespec/host.js'
import type { TspConfigInput } from './types.js'

export interface TypeSpecCompilerOptions {
  /** Existing program for incremental compilation cache */
  oldProgram?: Program | undefined
  /** Target OpenAPI specification version (default: '3.2.0') */
  openApiVersion?: '3.0.0' | '3.1.0' | '3.2.0' | undefined
  /** Set `false` to retain models even when no HTTP routes reference them (data-model-only `.tsp`). */
  omitUnreachableTypes?: boolean | undefined
}

export interface TypeSpecCompilerResult {
  /** In-memory TypeSpec Program AST */
  program: Program
  /** Extracted OpenAPI 3.2 Document */
  document: OasDocument
  /** Total number of discovered route operations */
  routesCount: number
  /** Authored TypeSpec source file paths (excluding node_modules) */
  sourceFiles: string[]
  /** Absolute path to the resolved entrypoint (.tsp) */
  entrypoint: string
  /** Named TypeSpec `alias` declarations preserved from the authored AST */
  namedAliases: TypeSpecNamedAlias[]
}

/**
 * Error thrown by {@link compileTypeSpecInMemory} when the TypeSpec program has errors.
 * `diagnostics` holds the compiler's diagnostics.
 */
export type TypeSpecCompilationError = Error & { readonly diagnostics: readonly Diagnostic[] }

/**
 * Makes a TspConfigInput absolute against `cwd`: a relative string path, a relative `tspDir`,
 * and an `entrypoint` relative to `tspDir` (or to `cwd` without one) are resolved.
 * Shared by the pipeline runner and the project builder so every entry point resolves the same file.
 */
export function absolutizeTspInput(input: TspConfigInput, cwd: string): TspConfigInput {
  if (typeof input === 'string') {
    return isAbsolute(input) ? input : resolve(cwd, input)
  }
  const tspDir = input.tspDir
    ? (isAbsolute(input.tspDir) ? input.tspDir : resolve(cwd, input.tspDir))
    : undefined
  return {
    ...input,
    entrypoint: isAbsolute(input.entrypoint) ? input.entrypoint : resolve(tspDir ?? cwd, input.entrypoint),
    tspDir,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks the top-level shape of an emitted OpenAPI document (the fields the pipeline relies on:
 * `openapi`, `info.title`, `info.version`, and object-valued `paths` / `components` when present).
 */
function isOasDocument(value: unknown): value is OasDocument {
  if (!isRecord(value)) return false
  const { openapi, info, paths, components } = value
  return typeof openapi === 'string'
    && isRecord(info)
    && typeof info.title === 'string'
    && typeof info.version === 'string'
    && (paths === undefined || isRecord(paths))
    && (components === undefined || isRecord(components))
}

/**
 * Resolves the absolute entrypoint path from a TspConfigInput.
 * Relative paths are resolved against `process.cwd()`; use {@link absolutizeTspInput} first to
 * resolve them against another base directory.
 */
export function resolveTypeSpecEntrypoint(input: TspConfigInput): string {
  if (typeof input === 'string') {
    const resolved = resolve(input)
    if (!existsSync(resolved)) {
      throw new Error(`TypeSpec input path does not exist: ${resolved}`)
    }

    const stat = statSync(resolved)
    if (stat.isDirectory()) {
      const mainPath = join(resolved, 'main.tsp')
      if (existsSync(mainPath)) return mainPath

      const indexPath = join(resolved, 'index.tsp')
      if (existsSync(indexPath)) return indexPath

      throw new Error(`TypeSpec directory does not contain "main.tsp" or "index.tsp": ${resolved}`)
    }

    return resolved
  }

  if (typeof input === 'object' && input !== null) {
    const baseDir = input.tspDir ? resolve(input.tspDir) : process.cwd()
    const resolved = resolve(baseDir, input.entrypoint)
    if (!existsSync(resolved)) {
      throw new Error(`TypeSpec entrypoint does not exist: ${resolved}`)
    }
    return resolved
  }

  throw new Error(`Invalid TypeSpec input parameter: ${String(input)}`)
}

/**
 * Compiles a TypeSpec file or directory directly in memory into an OpenAPI 3.2 Document
 * without intermediate disk writes.
 */
export async function compileTypeSpecInMemory(
  input: TspConfigInput,
  options?: TypeSpecCompilerOptions,
): Promise<TypeSpecCompilerResult> {
  const entrypoint = resolveTypeSpecEntrypoint(input)
  const version = options?.openApiVersion ?? '3.2.0'
  const host = createTypeSpecFallbackHost(NodeHost)

  const program = await compile(host, entrypoint, { noEmit: true }, options?.oldProgram)

  if (program.hasError()) {
    const errorDetails = program.diagnostics.map(d => formatDiagnostic(d)).join('\n')
    const error: TypeSpecCompilationError = Object.assign(
      new Error(`TypeSpec compilation failed:\n${errorDetails}`),
      { diagnostics: program.diagnostics },
    )
    throw error
  }

  const records = await getOpenAPI3(program, {
    'openapi-versions': [version],
    ...(options?.omitUnreachableTypes !== undefined ? { 'omit-unreachable-types': options.omitUnreachableTypes } : {}),
  })

  if (!records || records.length === 0) {
    throw new Error(`TypeSpec compilation produced no OpenAPI 3 records for ${entrypoint}`)
  }

  const record = records[0]
  if (!record) {
    throw new Error(`TypeSpec compilation produced no OpenAPI 3 records for ${entrypoint}`)
  }

  const rawDoc: unknown = record.versioned
    ? record.versions[record.versions.length - 1]?.document
    : record.document

  if (!rawDoc) {
    throw new Error(`TypeSpec OpenAPI document is empty for ${entrypoint}`)
  }
  if (!isOasDocument(rawDoc)) {
    throw new Error(`TypeSpec emitted a malformed OpenAPI document for ${entrypoint} (missing openapi/info fields)`)
  }

  const document = rawDoc

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
    sourceFiles: sourceFiles.length > 0 ? sourceFiles : [entrypoint],
    entrypoint,
    namedAliases: extractTypeSpecNamedAliases(program),
  }
}
