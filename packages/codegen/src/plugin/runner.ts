import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { formatGeneratedTs } from '@oa-sdk/core'
import type { OasDocument } from '@oa-sdk/parser'
import type { Program } from '@typespec/compiler'
import { absolutizeTspInput, compileTypeSpecInMemory } from './compiler.js'
import { validateTspConfig } from './config.js'
import { createPluginContext } from './context.js'
import { sortPluginEntries } from './sorter.js'
import type {
  TspConfig,
  TspGeneratedFile,
  TspPluginContext,
  TspPluginDiagnostic,
} from './types.js'

export interface RunTspPluginPipelineOptions {
  /** Base working directory for resolving relative paths. Default: process.cwd() */
  cwd?: string | undefined
  /** Pre-compiled or in-memory OpenAPI document override */
  document?: OasDocument | undefined
  /** Pre-compiled or in-memory TypeSpec Program AST override (used together with `document`) */
  program?: Program | unknown | undefined
  /**
   * Previous TypeSpec program, passed to the compiler as an incremental-compilation hint.
   * Unlike `document`, it never replaces compilation: the input is always recompiled.
   */
  oldProgram?: Program | undefined
}

export interface TspPipelineResult {
  /** Whether the pipeline completed without fatal error diagnostics */
  success: boolean
  /** All virtual files generated across all plugins */
  files: readonly TspGeneratedFile[]
  /** Absolute paths of files physically emitted to disk (empty if dryRun) */
  emittedFiles: readonly string[]
  /** Total pipeline execution time in milliseconds */
  durationMs: number
  /** All diagnostics reported by plugins and runner */
  diagnostics: readonly TspPluginDiagnostic[]
  /** The plugin context at the end of the pipeline execution */
  context: TspPluginContext
  /** Discovered route operation count */
  routesCount: number
  /** Absolute path to the resolved entrypoint */
  entrypoint: string
  /** Resolved destination directory */
  outputDir: string
}

function countDocumentRoutes(document: OasDocument): number {
  let count = 0
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (pathItem && typeof pathItem === 'object') {
      for (const verb of ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace', 'query']) {
        if (verb in pathItem) count++
      }
    }
  }
  return count
}

function realPath(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    // Not on disk (yet): resolve the closest existing ancestor so symlinked roots (macOS /var -> /private/var) compare equal.
    const parent = dirname(absolute)
    return parent === absolute ? absolute : resolve(realPath(parent), relative(parent, absolute))
  }
}

/** Whether `child` is strictly inside `parent` (not equal to it, not outside it). */
function isStrictDescendant(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * The output directory is removed recursively only when it lies strictly inside the working
 * directory or the OS temp directory, is not the working directory or one of its ancestors,
 * and neither is nor contains the TypeSpec entrypoint (a .tsp file or a project directory).
 */
function isSafeToClean(targetDir: string, rootDir: string, entrypoint: string): boolean {
  const target = realPath(targetDir)
  const root = realPath(rootDir)
  if (!isStrictDescendant(target, root) && !isStrictDescendant(target, realPath(tmpdir()))) {
    return false
  }
  if (target === root || isStrictDescendant(root, target)) return false
  // Never wipe the directory that holds the TypeSpec sources (the entrypoint may be a project directory).
  const source = realPath(entrypoint)
  return source !== target && !isStrictDescendant(source, target)
}

/**
 * Executes the complete TypeSpec SSOT plugin pipeline:
 * 1. Validates configuration.
 * 2. Compiles TypeSpec in-memory into OpenAPI 3.2 AST.
 * 3. Topologically sorts plugins via Kahn's algorithm.
 * 4. Orchestrates lifecycle phases: setup -> transform -> generate -> emit.
 * 5. Flushes non-virtual files to disk (or retains in memory when dryRun).
 * 6. Returns structured pipeline execution summary.
 */
export async function runTspPluginPipeline(
  rawConfig: unknown,
  options?: RunTspPluginPipelineOptions,
): Promise<TspPipelineResult> {
  const startTime = Date.now()
  const cwd = options?.cwd ?? process.cwd()

  // 1. Configuration validation
  const config: TspConfig = validateTspConfig(rawConfig)

  // 2. Topological sort
  const sortedRegistrations = sortPluginEntries(config.plugins)

  // 3. In-memory TypeSpec compilation (or override)
  let document: OasDocument
  let program: Program | unknown | undefined
  let entrypoint: string
  let routesCount: number

  const input = absolutizeTspInput(config.input, cwd)

  if (options?.document) {
    document = options.document
    program = options.program
    entrypoint = typeof input === 'string' ? input : input.entrypoint
    routesCount = countDocumentRoutes(document)
  } else {
    const compileResult = await compileTypeSpecInMemory(input, {
      openApiVersion: config.openApiVersion,
      oldProgram: options?.oldProgram,
    })
    document = compileResult.document
    program = compileResult.program
    entrypoint = compileResult.entrypoint
    routesCount = compileResult.routesCount
  }

  // 4. Resolve destination output directory
  const rawOut = config.outputDir ?? config.output ?? './src/generated'
  const outputDir = isAbsolute(rawOut) ? rawOut : resolve(cwd, rawOut)

  // 5. Initialize context
  const context = createPluginContext({
    entrypoint,
    outputDir,
    document,
    program,
    config,
    openApiVersion: config.openApiVersion,
  })

  // 6. Orchestrate lifecycle phases: setup -> transform -> generate -> emit
  // Phase 1: setup
  for (const reg of sortedRegistrations) {
    await reg.plugin.setup?.(context, reg.options)
  }

  // Phase 2: transform
  for (const reg of sortedRegistrations) {
    await reg.plugin.transform?.(context, reg.options)
  }

  // Phase 3: generate
  for (const reg of sortedRegistrations) {
    await reg.plugin.generate?.(context, reg.options)
  }

  // Phase 4: emit
  for (const reg of sortedRegistrations) {
    await reg.plugin.emit?.(context, reg.options)
  }

  // 7. Flush virtual files to disk
  const emittedFiles: string[] = []
  const files = context.getFiles()

  if (!config.dryRun) {
    if (config.clean && existsSync(outputDir)) {
      if (isSafeToClean(outputDir, cwd, entrypoint)) {
        rmSync(outputDir, { recursive: true, force: true })
      } else {
        context.reportDiagnostic({
          code: 'TSP_CLEAN_SKIPPED',
          severity: 'warning',
          file: outputDir,
          message: `Did not clean output directory ${outputDir}: clean only removes a directory strictly inside `
            + `the working directory (${cwd}) or the OS temp directory that does not contain the TypeSpec sources. `
            + 'Stale files are left in place; set clean: false to silence this warning.',
        })
      }
    }

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    for (const file of files) {
      if (file.isVirtual) {
        continue
      }

      const fullPath = resolve(outputDir, file.path)
      const fileDir = dirname(fullPath)
      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true })
      }

      let content = file.content
      if (file.banner && !content.startsWith(file.banner)) {
        content = `${file.banner}\n\n${content}`
      }

      if (config.format !== false && (file.path.endsWith('.ts') || file.path.endsWith('.tsx'))) {
        try {
          content = formatGeneratedTs(content)
        } catch {
          // Keep content intact if syntax parser encounters custom formatting issue
        }
      }

      writeFileSync(fullPath, content, 'utf8')
      emittedFiles.push(fullPath)
    }
  }

  const durationMs = Date.now() - startTime
  const hasErrorDiagnostic = context.diagnostics.some(d => d.severity === 'error')

  return {
    success: !hasErrorDiagnostic,
    files,
    emittedFiles,
    durationMs,
    diagnostics: context.diagnostics,
    context,
    routesCount,
    entrypoint,
    outputDir,
  }
}
