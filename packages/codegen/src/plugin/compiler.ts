import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compile, NodeHost, formatDiagnostic, type Program } from '@typespec/compiler'
import { getOpenAPI3 } from '@typespec/openapi3'
import type { OasDocument } from '@oa-sdk/parser'
import type { TspConfigInput } from './types.js'

export interface TypeSpecCompilerOptions {
  /** Existing program for incremental compilation cache */
  oldProgram?: Program | undefined
  /** Target OpenAPI specification version (default: '3.2.0') */
  openApiVersion?: '3.0.0' | '3.1.0' | '3.2.0' | undefined
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
}

/**
 * Resolves the absolute entrypoint path from a TspConfigInput.
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

  const program = await compile(NodeHost, entrypoint, { noEmit: true }, options?.oldProgram)

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
    throw new Error(`TypeSpec compilation produced no OpenAPI 3 records for ${entrypoint}`)
  }

  const record = records[0]
  if (!record) {
    throw new Error(`TypeSpec compilation produced no OpenAPI 3 records for ${entrypoint}`)
  }

  const rawDoc = record.versioned
    ? record.versions[record.versions.length - 1]?.document
    : record.document

  if (!rawDoc) {
    throw new Error(`TypeSpec OpenAPI document is empty for ${entrypoint}`)
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
    sourceFiles: sourceFiles.length > 0 ? sourceFiles : [entrypoint],
    entrypoint,
  }
}
