import * as path from 'node:path'
import type { ArtifactKind, OutputRoutingConfig, OutputRoutingRule } from '../config.js'
import { resolveImportSpecifier, type ResolveImportOptions } from './import-resolver.js'
import { resolvePathPattern, type TokenContext } from './token-resolver.js'

/**
 * Options for dispatching artifact paths.
 */
export interface DispatchPathOptions {
  /** Output routing configuration */
  config?: OutputRoutingConfig | undefined
  /** Base root directory for the project */
  rootDir?: string | undefined
}

/**
 * Result of resolving an artifact output path.
 */
export interface DispatchedArtifactPath {
  /** Relative path from rootDir, POSIX normalized */
  relativePath: string
  /** Absolute filesystem path */
  absolutePath: string
  /** Which configuration strategy produced this path */
  matchedBy: 'rule' | 'byKind' | 'pattern' | 'default'
  /** Index of matching rule if matchedBy === 'rule' */
  ruleIndex?: number | undefined
  /** The unresolved template string used */
  template: string
}

/**
 * Checks if a value matches a string or array of strings (case-insensitive).
 */
function matchStringOrArray(ruleVal: string | string[] | undefined, actualVal: string | undefined): boolean {
  if (ruleVal === undefined) return true
  if (actualVal === undefined) return false

  const lowerActual = actualVal.toLowerCase()
  if (Array.isArray(ruleVal)) {
    return ruleVal.some((r) => r.toLowerCase() === lowerActual)
  }
  return ruleVal.toLowerCase() === lowerActual
}

/**
 * Checks if a rule matches a given token context.
 */
export function matchesRoutingRule(rule: OutputRoutingRule, context: TokenContext): boolean {
  // 1. Tag match
  if (rule.tag !== undefined) {
    if (!matchStringOrArray(rule.tag, context.tag)) {
      return false
    }
  }

  // 2. URL Path prefix match
  if (rule.pathPrefix !== undefined) {
    if (!context.path || !context.path.startsWith(rule.pathPrefix)) {
      return false
    }
  }

  // 3. HTTP Method match
  if (rule.method !== undefined) {
    if (!matchStringOrArray(rule.method, context.method)) {
      return false
    }
  }

  // 4. Artifact Kind match
  if (rule.kind !== undefined) {
    if (Array.isArray(rule.kind)) {
      if (!rule.kind.includes(context.kind)) {
        return false
      }
    } else if (rule.kind !== context.kind) {
      return false
    }
  }

  // 5. Target / Profile match
  if (rule.profile !== undefined) {
    if (context.profile !== rule.profile) {
      return false
    }
  }

  return true
}

/**
 * Central path dispatcher that evaluates output routing rules with deterministic precedence:
 * 1. Conditional Rules (`rules`) - first matching rule wins
 * 2. By-Kind Mapping (`byKind`) - specific to artifact kind
 * 3. Global Template Pattern (`pattern`)
 * 4. Default Convention (`src/api/{tag}/{tag}.{kind}.ts` or `src/api/generated/{kind}.ts`)
 */
export function dispatchArtifactPath(
  context: TokenContext,
  options: DispatchPathOptions = {},
): DispatchedArtifactPath {
  const config = options.config
  const rootDir = options.rootDir ?? process.cwd()

  let template: string | undefined
  let matchedBy: 'rule' | 'byKind' | 'pattern' | 'default' = 'default'
  let ruleIndex: number | undefined

  // 1. Check rules
  if (config?.rules && config.rules.length > 0) {
    for (let i = 0; i < config.rules.length; i++) {
      const rule = config.rules[i]!
      if (matchesRoutingRule(rule, context)) {
        template = rule.target
        matchedBy = 'rule'
        ruleIndex = i
        break
      }
    }
  }

  // 2. Check byKind
  if (!template && config?.byKind && config.byKind[context.kind]) {
    template = config.byKind[context.kind]
    matchedBy = 'byKind'
  }

  // 3. Check pattern
  if (!template && config?.pattern) {
    template = config.pattern
    matchedBy = 'pattern'
  }

  // 4. Default fallback
  if (!template) {
    matchedBy = 'default'
    if (context.tag) {
      template = 'src/api/{tag}/{tag}.{kind}.ts'
    } else {
      template = 'src/api/generated/{kind}.ts'
    }
  }

  // Resolve tokens in template
  const resolvedTemplate = resolvePathPattern(template, context, { casing: config?.casing })

  // Combine with baseDir if provided
  const baseDir = config?.baseDir ?? '.'
  const posixBaseDir = baseDir.replace(/\\/g, '/')

  let relativePath = path.posix.normalize(path.posix.join(posixBaseDir, resolvedTemplate))
  if (relativePath.startsWith('./')) {
    relativePath = relativePath.slice(2)
  }

  const absolutePath = path.resolve(rootDir, relativePath)

  return {
    relativePath,
    absolutePath,
    matchedBy,
    ruleIndex,
    template,
  }
}

/**
 * Reusable coordinator that manages output path resolution and relative imports.
 */
export class PathDispatcher {
  public readonly config: OutputRoutingConfig
  public readonly rootDir: string

  public constructor(config: OutputRoutingConfig = {}, rootDir: string = process.cwd()) {
    this.config = config
    this.rootDir = path.resolve(rootDir)
  }

  /**
   * Resolves the output file path for an artifact.
   */
  public dispatch(context: TokenContext): DispatchedArtifactPath {
    return dispatchArtifactPath(context, { config: this.config, rootDir: this.rootDir })
  }

  /**
   * Calculates the relative TypeScript import specifier between two artifact contexts.
   */
  public resolveImport(
    fromContext: TokenContext,
    toContext: TokenContext,
    options: Partial<ResolveImportOptions> = {},
  ): string {
    const from = this.dispatch(fromContext)
    const to = this.dispatch(toContext)
    return resolveImportSpecifier({
      fromFilePath: from.absolutePath,
      toFilePath: to.absolutePath,
      rootDir: this.rootDir,
      importStyle: options.importStyle ?? this.config.importStyle ?? 'relative',
      tsconfig: options.tsconfig,
      tsconfigPath: options.tsconfigPath ?? this.config.tsconfigPath,
      extension: options.extension ?? '.js',
    })
  }
}

/**
 * Creates a new PathDispatcher instance.
 */
export function createPathDispatcher(
  config?: OutputRoutingConfig,
  rootDir?: string,
): PathDispatcher {
  return new PathDispatcher(config, rootDir)
}
