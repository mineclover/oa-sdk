/**
 * packages/codegen/src/cli/lib/config-loader.ts
 *
 * Asynchronous configuration loader for @oa-sdk/codegen.
 * Supports oa.config.ts, oa.config.mjs, oa.config.json, .oarc.json.
 */

import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { findProjectRootDetail, DEFAULT_CONFIG_FILES } from '@oa-sdk/core'
import { assertOaConfig, type OaConfig, type ProfileTargetConfig, type GuardTargetConfig } from '../../config.js'

export const CANDIDATE_CONFIG_FILES: readonly string[] = [
  'oa.config.ts',
  'oa.config.mjs',
  'oa.config.json',
  '.oarc.json',
]

export interface LoadOaConfigOptions {
  /** Explicit path to configuration file (overrides automatic search) */
  configPath?: string | undefined
  /** Starting directory for discovery (defaults to process.cwd()) */
  cwd?: string | undefined
  /** Explicit project root directory (overrides root discovery) */
  explicitRoot?: string | undefined
  /** Whether to append cache-busting timestamp to ESM dynamic imports (default: true) */
  cacheBust?: boolean | undefined
}

export type LoadedOaConfig = OaConfig & {
  config: OaConfig
  configPath: string
  rootDir: string
}

export interface ResolvedProfileTarget extends ProfileTargetConfig {
  resolvedSchemaEntry: string
  resolvedOutDir: string
}

export interface ResolvedGuardTarget extends GuardTargetConfig {
  resolvedOutDir: string
}

/**
 * Finds the config file path and associated project root directory.
 */
export function findConfigFile(options?: {
  cwd?: string | undefined
  explicitRoot?: string | undefined
  configFiles?: readonly string[] | undefined
}): { configPath: string; rootDir: string } | null {
  const cwd = path.resolve(options?.cwd ?? process.cwd())
  const detail = findProjectRootDetail({
    cwd,
    explicitRoot: options?.explicitRoot,
  })

  // 1. If findProjectRootDetail matched a config file directly during upward search:
  if (detail.reason === 'config' && detail.matchedMarker) {
    const candidatePath = path.join(detail.root, detail.matchedMarker)
    if (fs.existsSync(candidatePath)) {
      return { configPath: candidatePath, rootDir: detail.root }
    }
  }

  // 2. Otherwise (workspace / vcs / explicit / env / fallback), check root for candidates:
  const candidateNames = options?.configFiles ?? CANDIDATE_CONFIG_FILES
  for (const name of candidateNames) {
    const candidatePath = path.join(detail.root, name)
    try {
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        return { configPath: candidatePath, rootDir: detail.root }
      }
    } catch {
      // ignore stat errors
    }
  }

  return null
}

/**
 * Checks whether an import error requires TypeScript fallback compilation.
 */
function isTsTranspileRequired(err: unknown, filePath: string): boolean {
  if (!err || typeof err !== 'object') return false
  const msg = String((err as any).message || '')
  const code = String((err as any).code || '')
  const ext = path.extname(filePath).toLowerCase()
  const isTs = ext === '.ts' || ext === '.mts' || ext === '.cts'

  return isTs && (
    msg.includes('strip-only mode') ||
    msg.includes('TypeScript enum is not supported') ||
    msg.includes('Unknown file extension') ||
    code === 'ERR_UNKNOWN_FILE_EXTENSION' ||
    code === 'ERR_UNSUPPORTED_NODE_FEATURE'
  )
}

/** The TypeScript compiler, or null when it is not installed. */
async function importTypeScript(): Promise<typeof import('typescript') | null> {
  try {
    const tsMod = await import('typescript')
    return (tsMod as any).default ?? tsMod
  } catch {
    return null
  }
}

/**
 * The `type` field of the package.json nearest to `filePath`. Node loads a `.ts`
 * file as it loads a `.js` file: as CommonJS under `"type": "commonjs"`, as an
 * ES module under `"type": "module"`, and by its syntax when the field is absent.
 */
function packageScopeType(filePath: string): unknown {
  let directory = path.dirname(filePath)
  for (;;) {
    const manifestPath = path.join(directory, 'package.json')
    if (fs.existsSync(manifestPath)) {
      try {
        return (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { type?: unknown }).type
      } catch {
        return undefined
      }
    }
    const parent = path.dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** True when `statement` is ES module syntax that remains after Node strips the types. */
function isRuntimeModuleSyntax(ts: typeof import('typescript'), statement: import('typescript').Statement): boolean {
  if (ts.isImportDeclaration(statement)) return !statement.importClause?.isTypeOnly
  if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly
  if (ts.isExportAssignment(statement)) return !statement.isExportEquals
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return false
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
  return modifiers !== undefined
    && modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    && !modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)
}

/**
 * True when Node would load the TypeScript file `filePath` as CommonJS although
 * it is written as an ES module: a `.ts` file with `import` or `export`
 * statements under a package.json with `"type": "commonjs"`, which `npm init`
 * writes since npm 11. Node's type stripping then fails on the first of them
 * ("Cannot use import statement outside a module"), so such a file is
 * transpiled to an ES module instead. Type-only imports and exports and the
 * declarations Node strips are not counted: a configuration written as
 * CommonJS may use them and still loads natively.
 */
export async function isEsModuleTypeScriptInCommonJsScope(filePath: string): Promise<boolean> {
  if (path.extname(filePath).toLowerCase() !== '.ts') return false
  if (packageScopeType(filePath) !== 'commonjs') return false
  const ts = await importTypeScript()
  if (!ts) return false
  const source = ts.createSourceFile(
    filePath,
    await fs.promises.readFile(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  )
  return source.statements.some(statement => isRuntimeModuleSyntax(ts, statement))
}

/**
 * Defensive fallback: Transpiles TypeScript using the TypeScript compiler,
 * writes a temporary .mjs module, imports it, and cleans up.
 */
async function transpileAndImport<T>(filePath: string, cacheBust: boolean): Promise<T> {
  const ts = await importTypeScript()

  if (!ts) {
    throw new Error(
      `Failed to load TypeScript file "${filePath}": Node's native type stripper cannot execute this file ` +
      `(e.g. contains enums or unsupported syntax) and 'typescript' is not installed for fallback transpilation.`
    )
  }

  const sourceCode = await fs.promises.readFile(filePath, 'utf8')
  const transpiled = ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText

  const dir = path.dirname(filePath)
  const tmpName = `.tmp-oa-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.mjs`
  let tmpPath = path.join(dir, tmpName)

  try {
    await fs.promises.writeFile(tmpPath, transpiled, 'utf8')
  } catch {
    // Fallback to tmpdir if directory is read-only
    tmpPath = path.join(tmpdir(), tmpName)
    await fs.promises.writeFile(tmpPath, transpiled, 'utf8')
  }

  try {
    const tmpUrl = pathToFileURL(tmpPath).href + (cacheBust ? `?t=${Date.now()}` : '')
    return await import(tmpUrl)
  } catch (err: any) {
    throw new Error(`Failed to load transpiled module "${filePath}": ${err.message}`, { cause: err })
  } finally {
    try {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath)
      }
    } catch {
      // ignore cleanup error
    }
  }
}

/**
 * Dynamically loads an ESM or TypeScript module with fallback transpilation.
 */
export async function loadModule<T = unknown>(
  filePath: string,
  options?: { cacheBust?: boolean | undefined } | undefined
): Promise<T> {
  const resolvedPath = path.resolve(filePath)
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Module not found: ${resolvedPath}`)
  }

  const cacheBust = options?.cacheBust ?? true
  if (await isEsModuleTypeScriptInCommonJsScope(resolvedPath)) {
    return await transpileAndImport<T>(resolvedPath, cacheBust)
  }

  const fileUrl = pathToFileURL(resolvedPath).href + (cacheBust ? `?t=${Date.now()}` : '')

  try {
    return await import(fileUrl)
  } catch (err: any) {
    if (isTsTranspileRequired(err, resolvedPath)) {
      return await transpileAndImport<T>(resolvedPath, cacheBust)
    }
    throw new Error(`Failed to load module "${resolvedPath}": ${err.message}`, { cause: err })
  }
}

/**
 * Parses static JSON configuration file with detailed syntax error reporting.
 */
async function loadJsonConfig(filePath: string): Promise<unknown> {
  const content = await fs.promises.readFile(filePath, 'utf8')
  try {
    return JSON.parse(content)
  } catch (err: any) {
    throw new Error(`Failed to parse JSON config file "${filePath}": ${err.message}`, { cause: err })
  }
}

/**
 * Asynchronously loads and normalizes the oa-sdk declarative configuration.
 */
export async function loadOaConfig(
  optionsOrPath?: LoadOaConfigOptions | string,
  explicitCwd?: string,
): Promise<LoadedOaConfig | null> {
  let options: LoadOaConfigOptions
  if (typeof optionsOrPath === 'string') {
    let isDir = false
    try {
      isDir = fs.existsSync(optionsOrPath) && fs.statSync(optionsOrPath).isDirectory()
    } catch {
      // ignore
    }
    if (isDir) {
      options = { cwd: optionsOrPath }
    } else {
      options = { configPath: optionsOrPath, ...(explicitCwd !== undefined ? { cwd: explicitCwd } : {}) }
    }
  } else {
    options = optionsOrPath ?? {}
  }

  const cwd = path.resolve(options.cwd ?? process.cwd())
  let resolvedConfigPath: string
  let discoveredRootDir: string

  if (options.configPath) {
    resolvedConfigPath = path.resolve(cwd, options.configPath)
    if (!fs.existsSync(resolvedConfigPath)) {
      throw new Error(`설정 파일을 찾을 수 없습니다 (Configuration file not found): ${resolvedConfigPath}`)
    }
    discoveredRootDir = path.dirname(resolvedConfigPath)
  } else {
    const found = findConfigFile({
      cwd,
      explicitRoot: options.explicitRoot,
    })
    if (!found) {
      return null
    }
    resolvedConfigPath = found.configPath
    discoveredRootDir = found.rootDir
  }

  const ext = path.extname(resolvedConfigPath).toLowerCase()
  let rawConfig: unknown

  if (ext === '.json' || resolvedConfigPath.endsWith('.oarc.json')) {
    rawConfig = await loadJsonConfig(resolvedConfigPath)
  } else {
    const mod = await loadModule<any>(resolvedConfigPath, { cacheBust: options.cacheBust })
    rawConfig = mod?.default ?? mod?.config ?? mod
  }

  // Support function config (e.g. export default () => ({ ... }))
  if (typeof rawConfig === 'function') {
    rawConfig = await rawConfig()
  }

  // Handle double-wrapped default (e.g. { default: { ... } })
  if (
    rawConfig &&
    typeof rawConfig === 'object' &&
    'default' in rawConfig &&
    Object.keys(rawConfig as object).length === 1
  ) {
    rawConfig = (rawConfig as any).default
  }

  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new Error(
      `Configuration exported from "${resolvedConfigPath}" must be an object, but received ${
        rawConfig === null ? 'null' : Array.isArray(rawConfig) ? 'array' : typeof rawConfig
      }`
    )
  }

  const config = rawConfig as OaConfig

  // Path normalization: resolve rootDir relative to config file directory
  const configDir = path.dirname(resolvedConfigPath)
  let normalizedRootDir: string
  if (typeof config.rootDir === 'string' && config.rootDir.trim() !== '') {
    normalizedRootDir = path.isAbsolute(config.rootDir)
      ? path.resolve(config.rootDir)
      : path.resolve(configDir, config.rootDir)
  } else {
    normalizedRootDir = configDir
  }

  config.rootDir = normalizedRootDir

  // Runtime schema validation: enforce valid specs, unique target IDs, valid profiles and guards
  assertOaConfig(config)

  return {
    ...config,
    config,
    configPath: resolvedConfigPath,
    rootDir: normalizedRootDir,
  }
}

/**
 * Resolves schemaEntry and outDir of a ProfileTargetConfig relative to rootDir.
 */
export function resolveProfileTarget(
  target: ProfileTargetConfig,
  rootDir: string
): ResolvedProfileTarget {
  return {
    ...target,
    resolvedSchemaEntry: path.isAbsolute(target.schemaEntry)
      ? path.resolve(target.schemaEntry)
      : path.resolve(rootDir, target.schemaEntry),
    resolvedOutDir: path.isAbsolute(target.outDir)
      ? path.resolve(target.outDir)
      : path.resolve(rootDir, target.outDir),
  }
}

/**
 * Resolves outDir of GuardTargetConfig relative to rootDir.
 */
export function resolveGuardTarget(
  guards: GuardTargetConfig,
  rootDir: string
): ResolvedGuardTarget {
  return {
    ...guards,
    resolvedOutDir: path.isAbsolute(guards.outDir)
      ? path.resolve(guards.outDir)
      : path.resolve(rootDir, guards.outDir),
  }
}
