import type { Program } from '@typespec/compiler'
import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import type { SurfaceIr } from '@oa-sdk/surface-ir'

export type SurfaceIR = SurfaceIr
export type { SurfaceIr }

/**
 * In-memory representation of a generated file before emission to disk.
 */
export interface TspGeneratedFile {
  /** Relative POSIX path from the output directory (e.g. 'types.ts', 'client.ts') */
  path: string
  /** Generated text content */
  content: string
  /** Name of the plugin that authored this file */
  sourcePlugin: string
  /** If true, retained only in memory for downstream plugins and not emitted to disk */
  isVirtual?: boolean | undefined
  /** Exported symbol names declared in this file */
  exports?: readonly string[] | string[] | undefined
  /** Custom header banner for this specific file */
  banner?: string | undefined
  /** Artifact kind (e.g. 'models', 'client', 'queries', 'contract', 'router', 'codecs') */
  kind?: string | undefined
  /** Associated tag or domain */
  tag?: string | undefined
  /** Arbitrary plugin metadata attached to this virtual file */
  metadata?: Record<string, unknown> | undefined
}

/**
 * Diagnostic message reported by plugins during execution.
 */
export interface TspPluginDiagnostic {
  code?: string | undefined
  message: string
  severity: 'info' | 'warning' | 'error'
  file?: string | undefined
  line?: number | undefined
}

/**
 * Execution context injected into every plugin lifecycle hook.
 */
export interface TspPluginContext {
  /** Absolute path to the resolved TypeSpec entrypoint file (.tsp) */
  readonly entrypoint: string
  /** Absolute path to the destination output directory on disk */
  readonly outputDir: string
  /** In-memory TypeSpec Program AST */
  readonly program?: Program | unknown | undefined
  /** OpenAPI 3.2 Document */
  readonly document: OasDocument
  /** Normalized ParsedDocument IR from @oa-sdk/parser (lazy) */
  readonly parsed: ParsedDocument
  /** Optional Surface IR if target-neutral projection is enabled */
  readonly surfaceIR?: SurfaceIr | undefined
  /** The complete resolved configuration object */
  readonly config: TspConfig
  /** Target OpenAPI version (default '3.2.0') */
  readonly openApiVersion: '3.0.0' | '3.1.0' | '3.2.0'
  /** Virtual file system map */
  readonly files: Map<string, TspGeneratedFile>

  // ── Virtual File System Methods ──
  addFile(file: TspGeneratedFile): void
  getFile(path: string): TspGeneratedFile | undefined
  getFiles(): readonly TspGeneratedFile[]
  updateFile(path: string, updater: (existing: TspGeneratedFile) => TspGeneratedFile): void
  removeFile(path: string): boolean
  hasFile(path: string): boolean

  // ── Virtual Import Resolution ──
  resolveImport(fromFile: string, targetFile: string): string

  // ── Inter-Plugin Shared State ──
  readonly sharedData: Map<string, unknown>
  setPluginData<T>(key: string, value: T): void
  getPluginData<T>(key: string): T | undefined

  // ── Logging & Diagnostics ──
  log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void
  reportDiagnostic(diagnostic: TspPluginDiagnostic): void
  readonly diagnostics: readonly TspPluginDiagnostic[]
}

/**
 * Core Plugin interface for the TypeSpec SSOT Code Generation Engine.
 */
export interface TspPlugin<TOptions = unknown> {
  /**
   * Unique name identifying the plugin (e.g. 'typescript', 'client', 'tanstack-query', 'router', 'wire').
   */
  readonly name: string

  /**
   * List of plugin names that MUST run prior to this plugin.
   */
  readonly dependencies?: readonly string[] | string[] | undefined

  /**
   * Optional execution stage hint:
   * - 'pre': executed before standard plugins
   * - 'post': executed after standard plugins
   */
  readonly enforce?: 'pre' | 'post' | undefined

  /**
   * Lifecycle Hook 1: Setup
   * Called once when the plugin pipeline initializes, before TypeSpec compilation.
   */
  setup?: ((context: TspPluginContext, options?: TOptions) => Promise<void> | void) | undefined

  /**
   * Lifecycle Hook 2: Transform
   * Called after TypeSpec compilation succeeds with the extracted OasDocument.
   */
  transform?: ((context: TspPluginContext, options?: TOptions) => Promise<void> | void) | undefined

  /**
   * Lifecycle Hook 3: Generate
   * Core generation hook where files are produced and added via context.addFile().
   */
  generate?: ((context: TspPluginContext, options?: TOptions) => Promise<void> | void) | undefined

  /**
   * Lifecycle Hook 4: Emit
   * Final inspection, virtual import verification, banner application, or formatting.
   */
  emit?: ((context: TspPluginContext, options?: TOptions) => Promise<void> | void) | undefined
}

/**
 * Detailed object input configuration.
 */
export interface TspConfigInputObject {
  /** Path to entrypoint .tsp file (e.g. 'main.tsp' or 'src/index.tsp') */
  entrypoint: string
  /** Base TypeSpec project root directory if different from dirname(entrypoint) */
  tspDir?: string | undefined
}

export type TspConfigInput = string | TspConfigInputObject

export type TspPluginEntry =
  | TspPlugin<any>
  | [TspPlugin<any>, unknown]
  | false
  | null
  | undefined

/**
 * Configuration options for TypeSpec SSOT plugin pipeline.
 */
export interface TspConfig {
  /** Input TypeSpec file path (.tsp) or project folder containing main.tsp */
  input: TspConfigInput
  /** Output directory where generated files will be written */
  output?: string | undefined
  /** Destination directory alias matching output */
  outputDir?: string | undefined
  /** Target OpenAPI version (default: '3.2.0') */
  openApiVersion?: '3.0.0' | '3.1.0' | '3.2.0' | undefined
  /** Array of plugins to execute */
  plugins?: readonly TspPluginEntry[] | TspPluginEntry[] | undefined
  /** Dry run mode: do not write files to disk */
  dryRun?: boolean | undefined
  /** Clean stale files in output directory */
  clean?: boolean | undefined
  /** Format generated TypeScript files */
  format?: boolean | undefined
}

// ── Error Classes ───────────────────────────────────────────────────────────

export class TspPluginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TspPluginError'
  }
}

export class TspPluginCycleError extends TspPluginError {
  public readonly cycle: readonly string[]
  constructor(cycle: readonly string[]) {
    super(`Circular plugin dependency detected: ${cycle.join(' -> ')}`)
    this.name = 'TspPluginCycleError'
    this.cycle = cycle
  }
}

export class TspPluginMissingDependencyError extends TspPluginError {
  public readonly pluginName: string
  public readonly missingDependency: string
  constructor(pluginName: string, missingDependency: string) {
    super(`Plugin "${pluginName}" requires missing dependency "${missingDependency}"`)
    this.name = 'TspPluginMissingDependencyError'
    this.pluginName = pluginName
    this.missingDependency = missingDependency
  }
}

export class TspPluginDuplicateError extends TspPluginError {
  public readonly pluginName: string
  constructor(pluginName: string) {
    super(`Duplicate plugin name detected: "${pluginName}"`)
    this.name = 'TspPluginDuplicateError'
    this.pluginName = pluginName
  }
}

export class TspFileConflictError extends TspPluginError {
  public readonly filePath: string
  public readonly existingPlugin: string
  public readonly conflictingPlugin: string
  constructor(filePath: string, existingPlugin: string, conflictingPlugin: string) {
    super(
      `File conflict at "${filePath}": already registered by "${existingPlugin}", cannot be overwritten by "${conflictingPlugin}"`,
    )
    this.name = 'TspFileConflictError'
    this.filePath = filePath
    this.existingPlugin = existingPlugin
    this.conflictingPlugin = conflictingPlugin
  }
}

export class TspConfigValidationError extends TspPluginError {
  public readonly details?: string[] | undefined
  constructor(message: string, details?: string[] | undefined) {
    super(message)
    this.name = 'TspConfigValidationError'
    this.details = details
  }
}
