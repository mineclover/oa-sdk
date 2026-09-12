import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as crypto from 'node:crypto'

export const ARTIFACT_KINDS = [
  'contract',
  'client',
  'queries',
  'keys',
  'guards',
  'schemas',
] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export type CasingStyle = 'kebab' | 'camel' | 'pascal' | 'preserve'

export interface TokenContext {
  tag?: string | undefined
  kind: ArtifactKind | string
  operationId?: string | undefined
  method?: string | undefined
  group?: string | undefined
  path?: string | undefined
  profile?: string | undefined
}

export interface OutputRoutingRule {
  tag?: string | string[] | undefined
  pathPrefix?: string | undefined
  method?: string | string[] | undefined
  kind?: ArtifactKind | ArtifactKind[] | undefined
  profile?: string | undefined
  target: string
}

export type ByKindRoutingConfig = Partial<Record<ArtifactKind, string>>

export interface OutputRoutingConfig {
  pattern?: string | undefined
  byKind?: ByKindRoutingConfig | undefined
  rules?: OutputRoutingRule[] | undefined
  baseDir?: string | undefined
  importStyle?: 'relative' | 'alias' | undefined
  tsconfigPath?: string | undefined
  manifestPath?: string | undefined
  pruneOrphans?: boolean | undefined
  casing?: CasingStyle | undefined
}

export interface ManifestArtifactEntry {
  path: string
  kind: string
  tag?: string | undefined
  contentHash: string
  sourceSpec?: string | undefined
  generatedAt: string
}

export interface OaManifest {
  $schema?: string | undefined
  version: number
  generator: string
  lastRun: string
  specFingerprint: string
  artifacts: ManifestArtifactEntry[]
}

// ---------------------------------------------------------------------------
// Casing Transformers
// ---------------------------------------------------------------------------

function splitWords(str: string): string[] {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function toKebabCase(str: string): string {
  const words = splitWords(str)
  if (words.length === 0) return 'default'
  return words.map(w => w.toLowerCase()).join('-')
}

export function toCamelCase(str: string): string {
  const words = splitWords(str)
  const first = words[0]
  if (!first) return 'default'
  return (
    first.toLowerCase() +
    words
      .slice(1)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('')
  )
}

export function toPascalCase(str: string): string {
  const words = splitWords(str)
  if (words.length === 0) return 'Default'
  return words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
}

export function sanitizePreserve(str: string): string {
  // Strip filesystem illegal characters: : * ? " < > | \0
  return str.replace(/[:*?"<>|\0]/g, '').trim() || 'default'
}

export function getCasingTransformer(casing: CasingStyle = 'kebab'): (s: string) => string {
  switch (casing) {
    case 'camel':
      return toCamelCase
    case 'pascal':
      return toPascalCase
    case 'preserve':
      return sanitizePreserve
    case 'kebab':
    default:
      return toKebabCase
  }
}

// ---------------------------------------------------------------------------
// Token Resolver
// ---------------------------------------------------------------------------

export function resolvePathPattern(
  template: string,
  context: TokenContext,
  options: { casing?: CasingStyle } = {},
): string {
  const casing = options.casing ?? 'kebab'
  const transform = getCasingTransformer(casing)

  // 1. Tag fallback hierarchy: tag -> group -> 'default'
  const rawTag = context.tag ?? context.group ?? 'default'
  const tagValue = transform(rawTag)

  // 2. Kind is preserved as-is
  const kindValue = context.kind

  // 3. OperationId fallback: operationId -> `${method}_${group}` -> 'operation'
  const rawOp =
    context.operationId ??
    (context.method && context.group ? `${context.method}_${context.group}` : undefined) ??
    'operation'
  const opValue = transform(rawOp)

  // 4. Method: lowercase verb -> 'get'
  const methodValue = (context.method ?? 'get').toLowerCase()

  // 5. Group fallback: group -> tag -> 'common'
  const rawGroup = context.group ?? context.tag ?? 'common'
  const groupValue = transform(rawGroup)

  let resolved = template
    .replace(/\{tag\}/g, tagValue)
    .replace(/\{kind\}/g, kindValue)
    .replace(/\{operationId\}/g, opValue)
    .replace(/\{method\}/g, methodValue)
    .replace(/\{group\}/g, groupValue)

  // Normalize Windows backslashes to POSIX slashes and collapse redundant slashes
  resolved = resolved.replace(/\\/g, '/').replace(/\/+/g, '/')
  return resolved
}

// ---------------------------------------------------------------------------
// Path Dispatcher (Precedence: rules -> byKind -> pattern -> default)
// ---------------------------------------------------------------------------

export function dispatchArtifactPath(
  context: TokenContext,
  config: OutputRoutingConfig = {},
): string {
  const casing = config.casing ?? 'kebab'

  // 1. Evaluate conditional rules
  if (config.rules && config.rules.length > 0) {
    for (const rule of config.rules) {
      // Check tag match
      if (rule.tag !== undefined) {
        const allowedTags = Array.isArray(rule.tag) ? rule.tag : [rule.tag]
        if (!context.tag || !allowedTags.includes(context.tag)) continue
      }
      // Check path prefix
      if (rule.pathPrefix !== undefined) {
        if (!context.path || !context.path.startsWith(rule.pathPrefix)) continue
      }
      // Check HTTP method
      if (rule.method !== undefined) {
        const allowedMethods = Array.isArray(rule.method)
          ? rule.method.map(m => m.toLowerCase())
          : [rule.method.toLowerCase()]
        if (!context.method || !allowedMethods.includes(context.method.toLowerCase())) continue
      }
      // Check artifact kind
      if (rule.kind !== undefined) {
        const allowedKinds = Array.isArray(rule.kind) ? rule.kind : [rule.kind]
        if (!allowedKinds.includes(context.kind as ArtifactKind)) continue
      }
      // Check profile
      if (rule.profile !== undefined) {
        if (!context.profile || context.profile !== rule.profile) continue
      }

      // Rule matched!
      return resolvePathPattern(rule.target, context, { casing })
    }
  }

  // 2. Evaluate byKind mapping
  if (config.byKind && context.kind in config.byKind) {
    const targetTemplate = config.byKind[context.kind as ArtifactKind]
    if (targetTemplate) {
      return resolvePathPattern(targetTemplate, context, { casing })
    }
  }

  // 3. Evaluate pattern
  if (config.pattern) {
    return resolvePathPattern(config.pattern, context, { casing })
  }

  // 4. Default convention
  const defaultTemplate = 'src/api/{tag}/{tag}.{kind}.ts'
  return resolvePathPattern(defaultTemplate, context, { casing })
}

// ---------------------------------------------------------------------------
// Relative Import Specifier Resolver
// ---------------------------------------------------------------------------

export interface ResolveImportOptions {
  fromFilePath: string
  toFilePath: string
  rootDir?: string | undefined
  importStyle?: 'relative' | 'alias' | undefined
  tsconfigPaths?: Record<string, string[]> | undefined
  extension?: '.js' | '' | undefined
}

export function resolveImportSpecifier(options: ResolveImportOptions): string {
  const {
    fromFilePath,
    toFilePath,
    rootDir = process.cwd(),
    importStyle = 'relative',
    tsconfigPaths,
    extension = '.js',
  } = options

  // Self-import guard
  const normFrom = path.resolve(rootDir, fromFilePath)
  const normTo = path.resolve(rootDir, toFilePath)
  if (normFrom === normTo) {
    throw new Error(`Self-import detected: '${fromFilePath}' cannot import itself`)
  }

  // Check tsconfig path alias matching if importStyle is 'alias'
  if (importStyle === 'alias' && tsconfigPaths) {
    const relToRoot = path.relative(rootDir, normTo).replace(/\\/g, '/')
    for (const [aliasPattern, targetList] of Object.entries(tsconfigPaths)) {
      for (const targetPattern of targetList) {
        const cleanTarget = targetPattern.replace(/\*$/, '').replace(/^\.\//, '')
        if (relToRoot.startsWith(cleanTarget)) {
          const suffix = relToRoot.slice(cleanTarget.length).replace(/\.tsx?$/, '')
          const cleanAlias = aliasPattern.replace(/\*$/, '')
          const aliasSpecifier = `${cleanAlias}${suffix}`
          return extension === '.js' ? `${aliasSpecifier}.js` : aliasSpecifier
        }
      }
    }
  }

  // Relative path calculation
  const fromDir = path.dirname(normFrom)
  let rel = path.relative(fromDir, normTo).replace(/\\/g, '/')

  // Ensure leading './' or '../'
  if (!rel.startsWith('.')) {
    rel = `./${rel}`
  }

  // Strip .ts / .tsx extension and append target extension
  rel = rel.replace(/\.tsx?$/, '')
  if (extension) {
    rel = `${rel}${extension}`
  }

  return rel
}

// ---------------------------------------------------------------------------
// Safe Manifest Manager & 3-Gate Orphan Pruner
// ---------------------------------------------------------------------------

export const OA_BANNER = '// @oa-sdk'
export const OA_AUTO_GEN_TEXT = 'Auto-generated'

export function computeSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

export interface PruneResult {
  prunedFiles: string[]
  skippedModified: string[]
  skippedNoBanner: string[]
  skippedUnlisted: string[]
}

export class OaManifestManager {
  private manifest: OaManifest | null = null
  private manifestFilePath: string

  constructor(
    private rootDir: string,
    manifestRelPath = '.oa-manifest.json',
  ) {
    this.manifestFilePath = path.resolve(rootDir, manifestRelPath)
  }

  async loadManifest(): Promise<OaManifest | null> {
    try {
      const content = await fs.readFile(this.manifestFilePath, 'utf8')
      this.manifest = JSON.parse(content) as OaManifest
      return this.manifest
    } catch {
      this.manifest = null
      return null
    }
  }

  getManifest(): OaManifest | null {
    return this.manifest
  }

  createManifest(specFingerprint: string, artifacts: ManifestArtifactEntry[]): OaManifest {
    this.manifest = {
      $schema: 'https://oa-sdk.dev/schemas/v1/oa-manifest.schema.json',
      version: 1,
      generator: '@oa-sdk/codegen',
      lastRun: new Date().toISOString(),
      specFingerprint,
      artifacts,
    }
    return this.manifest
  }

  async saveManifest(manifest?: OaManifest): Promise<void> {
    const toWrite = manifest ?? this.manifest
    if (!toWrite) return
    const tmpPath = `${this.manifestFilePath}.tmp.${Date.now()}`
    await fs.mkdir(path.dirname(this.manifestFilePath), { recursive: true })
    await fs.writeFile(tmpPath, JSON.stringify(toWrite, null, 2) + '\n', 'utf8')
    await fs.rename(tmpPath, this.manifestFilePath)
    this.manifest = toWrite
  }

  /**
   * 3-Gate Safety Orphan Pruner:
   * Gate 1: Historical Manifest Provenance (file in previous manifest)
   * Gate 2: Content Hash Parity (disk content unchanged by developer)
   * Gate 3: Auto-Generated Banner Guard (contains @oa-sdk banner)
   */
  async pruneOrphans(
    activeRelativePaths: string[],
    options: { dryRun?: boolean; baseDir?: string } = {},
  ): Promise<PruneResult> {
    const previousManifest = this.manifest ?? (await this.loadManifest())
    const result: PruneResult = {
      prunedFiles: [],
      skippedModified: [],
      skippedNoBanner: [],
      skippedUnlisted: [],
    }

    if (!previousManifest || !previousManifest.artifacts) {
      return result
    }

    const activeSet = new Set(activeRelativePaths.map(p => p.replace(/\\/g, '/')))
    const baseStopDir = path.resolve(this.rootDir, options.baseDir ?? '.')

    for (const prevArtifact of previousManifest.artifacts) {
      const normalizedPath = prevArtifact.path.replace(/\\/g, '/')
      if (activeSet.has(normalizedPath)) {
        continue // Still active
      }

      // Candidate orphan!
      const diskPath = path.resolve(this.rootDir, normalizedPath)

      // Check if file exists on disk
      let diskContent: string
      try {
        diskContent = await fs.readFile(diskPath, 'utf8')
      } catch {
        // File already deleted or does not exist
        continue
      }

      // Gate 2: Hash Integrity Guard
      const currentDiskHash = computeSha256(diskContent)
      if (currentDiskHash !== prevArtifact.contentHash) {
        result.skippedModified.push(normalizedPath)
        continue // Skip: developer manually modified this file!
      }

      // Gate 3: Auto-Generated Banner Guard
      const hasBanner = diskContent.includes(OA_BANNER) || diskContent.includes(OA_AUTO_GEN_TEXT)
      if (!hasBanner) {
        result.skippedNoBanner.push(normalizedPath)
        continue // Skip: developer removed banner or hand-written file!
      }

      // All 3 gates passed! Safe to prune
      if (!options.dryRun) {
        await fs.unlink(diskPath)
        // Clean empty parent directories up to baseDir
        await this.cleanEmptyParents(path.dirname(diskPath), baseStopDir)
      }
      result.prunedFiles.push(normalizedPath)
    }

    return result
  }

  private async cleanEmptyParents(dir: string, stopDir: string): Promise<void> {
    if (!dir.startsWith(stopDir) || dir === stopDir) return
    try {
      const files = await fs.readdir(dir)
      if (files.length === 0) {
        await fs.rmdir(dir)
        await this.cleanEmptyParents(path.dirname(dir), stopDir)
      }
    } catch {
      // Directory not empty or permissions issue; ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Zero-Throw OutputRoutingConfig Validator
// ---------------------------------------------------------------------------

export interface ConfigIssue {
  path: string
  message: string
}

export function validateOutputRoutingConfig(config: unknown): { valid: boolean; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = []
  if (!config || typeof config !== 'object') {
    issues.push({ path: 'outputRouting', message: 'outputRouting must be an object' })
    return { valid: false, issues }
  }

  const obj = config as Record<string, unknown>

  if (obj.pattern !== undefined && (typeof obj.pattern !== 'string' || obj.pattern.trim() === '')) {
    issues.push({ path: 'outputRouting.pattern', message: 'pattern must be a non-empty string' })
  }

  if (obj.casing !== undefined) {
    const validCasings = ['kebab', 'camel', 'pascal', 'preserve']
    if (!validCasings.includes(obj.casing as string)) {
      issues.push({
        path: 'outputRouting.casing',
        message: `casing must be one of: ${validCasings.join(', ')}`,
      })
    }
  }

  if (obj.importStyle !== undefined) {
    const validStyles = ['relative', 'alias']
    if (!validStyles.includes(obj.importStyle as string)) {
      issues.push({
        path: 'outputRouting.importStyle',
        message: `importStyle must be one of: ${validStyles.join(', ')}`,
      })
    }
  }

  if (obj.byKind !== undefined) {
    if (typeof obj.byKind !== 'object' || obj.byKind === null) {
      issues.push({ path: 'outputRouting.byKind', message: 'byKind must be an object' })
    } else {
      const byKind = obj.byKind as Record<string, unknown>
      for (const [key, val] of Object.entries(byKind)) {
        if (!ARTIFACT_KINDS.includes(key as ArtifactKind)) {
          issues.push({
            path: `outputRouting.byKind.${key}`,
            message: `Unknown artifact kind '${key}'. Allowed: ${ARTIFACT_KINDS.join(', ')}`,
          })
        } else if (typeof val !== 'string' || val.trim() === '') {
          issues.push({
            path: `outputRouting.byKind.${key}`,
            message: `template for kind '${key}' must be a non-empty string`,
          })
        }
      }
    }
  }

  if (obj.rules !== undefined) {
    if (!Array.isArray(obj.rules)) {
      issues.push({ path: 'outputRouting.rules', message: 'rules must be an array' })
    } else {
      obj.rules.forEach((rule, idx) => {
        if (!rule || typeof rule !== 'object') {
          issues.push({ path: `outputRouting.rules[${idx}]`, message: 'rule must be an object' })
        } else {
          const r = rule as Record<string, unknown>
          if (typeof r.target !== 'string' || r.target.trim() === '') {
            issues.push({
              path: `outputRouting.rules[${idx}].target`,
              message: 'target template is required and must be a non-empty string',
            })
          }
        }
      })
    }
  }

  return { valid: issues.length === 0, issues }
}
