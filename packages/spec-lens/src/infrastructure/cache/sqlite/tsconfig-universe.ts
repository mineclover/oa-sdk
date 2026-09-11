import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export interface ContractConfigDigest {
  readonly file: string
  readonly digest: string
}

export interface ContractConfigUniverse {
  readonly configs: readonly ContractConfigDigest[]
  readonly roots: readonly string[]
  readonly universeDigest: string
}

export interface ConfigurationClosure {
  readonly configs: readonly string[]
  readonly projects: readonly string[]
}

/**
 * Strips single-line (//) and multi-line block (/* ... *\/) comments from JSONC
 * without interpreting comment-shaped tokens inside string literals.
 */
export function stripJsonComments(value: string): string {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]!
    const next = value[index + 1]
    if (inString) {
      output += current
      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (current === '"') {
        inString = false
      }
      continue
    }
    if (current === '"') {
      inString = true
      output += current
      continue
    }
    if (current === '/' && next === '/') {
      output += '  '
      index += 2
      while (index < value.length && value[index] !== '\n' && value[index] !== '\r') {
        output += ' '
        index += 1
      }
      index -= 1
      continue
    }
    if (current === '/' && next === '*') {
      output += '  '
      index += 2
      while (index < value.length && !(value[index] === '*' && value[index + 1] === '/')) {
        output += value[index] === '\n' || value[index] === '\r' ? value[index]! : ' '
        index += 1
      }
      if (index < value.length) {
        output += '  '
        index += 1
      }
      continue
    }
    output += current
  }
  return output
}

/**
 * Removes trailing commas in objects and arrays while preserving string content.
 */
export function removeTrailingCommas(value: string): string {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]!
    if (inString) {
      output += current
      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (current === '"') {
        inString = false
      }
      continue
    }
    if (current === '"') {
      inString = true
      output += current
      continue
    }
    if (current === ',') {
      let next = index + 1
      while (next < value.length && /\s/u.test(value[next]!)) next += 1
      if (value[next] === '}' || value[next] === ']') continue
    }
    output += current
  }
  return output
}

/**
 * Parses JSONC text stripping comments and trailing commas cleanly without third-party dependencies.
 */
export function parseJsonc<T = unknown>(value: string): T {
  const stripped = stripJsonComments(value)
  const cleaned = removeTrailingCommas(stripped)
  return JSON.parse(cleaned) as T
}

function normalizeRelativePath(repositoryRoot: string, targetPath: string): string {
  const rel = path.relative(repositoryRoot, targetPath).replaceAll('\\', '/')
  return rel.replace(/^\.\//, '')
}

function extensionRequests(specifier: string): readonly string[] {
  return specifier.endsWith('.json')
    ? [specifier]
    : [specifier, `${specifier}.json`, `${specifier}/tsconfig.json`]
}

export function resolveConfigurationFile(candidate: string, context: string = candidate): string {
  const normalizedCandidate = candidate.replaceAll('\\', '/')
  const requests = normalizedCandidate.endsWith('.json')
    ? [normalizedCandidate]
    : [normalizedCandidate, `${normalizedCandidate}.json`, path.join(normalizedCandidate, 'tsconfig.json')]

  for (const request of requests) {
    try {
      if (fs.existsSync(request) && fs.statSync(request).isFile()) {
        return fs.realpathSync.native ? fs.realpathSync.native(request) : fs.realpathSync(request)
      }
    } catch {
      // Continue checking next candidate request
    }
  }
  throw new Error(`Unable to resolve ${context}.`)
}

function resolveExtends(
  specifier: string,
  containingConfig: string,
  repositoryRoot?: string,
): string {
  if (
    specifier.startsWith('.') ||
    path.isAbsolute(specifier) ||
    Boolean(path.win32 && path.win32.isAbsolute(specifier))
  ) {
    const resolved = path.resolve(path.dirname(containingConfig), specifier)
    return resolveConfigurationFile(resolved, `tsconfig extends ${specifier} from ${containingConfig}`)
  }

  // Package or module specifier
  try {
    const req = createRequire(containingConfig)
    for (const request of extensionRequests(specifier)) {
      try {
        const resolved = req.resolve(request)
        return resolveConfigurationFile(resolved, `tsconfig extends ${specifier} from ${containingConfig}`)
      } catch {
        // Continue trying
      }
    }
  } catch {
    // Ignore require error
  }

  if (repositoryRoot) {
    for (const request of extensionRequests(specifier)) {
      try {
        const candidate = path.resolve(repositoryRoot, request)
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return fs.realpathSync.native ? fs.realpathSync.native(candidate) : fs.realpathSync(candidate)
        }
      } catch {
        // Continue trying
      }
    }
  }

  throw new Error(`Unable to resolve tsconfig extends "${specifier}" from ${containingConfig}.`)
}

/**
 * Transitive configuration closure walker for tsconfig.json.
 * Follows `extends` (string and array of strings) and project `references`.
 * Uses a canonical path Set to prevent infinite recursion on circular extends.
 */
export function configurationClosure(
  tsconfigPath: string,
  repositoryRoot?: string,
): ConfigurationClosure {
  const configs = new Set<string>()
  const projects = new Set<string>()
  const visited = new Set<string>()

  const visit = (input: string, isProject: boolean): void => {
    let resolvedConfig: string
    try {
      resolvedConfig = resolveConfigurationFile(input, `configuration input ${input}`)
    } catch {
      return
    }

    if (visited.has(resolvedConfig)) {
      if (isProject) projects.add(resolvedConfig)
      return
    }
    visited.add(resolvedConfig)
    configs.add(resolvedConfig)
    if (isProject) projects.add(resolvedConfig)

    let parsed: Record<string, unknown>
    try {
      const raw = fs.readFileSync(resolvedConfig, 'utf8')
      const value = parseJsonc<unknown>(raw)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid tsconfig object: ${resolvedConfig}`)
      }
      parsed = value as Record<string, unknown>
    } catch (err) {
      throw new Error(`Unable to parse tsconfig ${resolvedConfig}: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Follow extends (string or array of strings)
    if (parsed.extends !== undefined) {
      const extendsList: string[] = []
      if (typeof parsed.extends === 'string') {
        if (parsed.extends.trim() !== '') extendsList.push(parsed.extends.trim())
      } else if (Array.isArray(parsed.extends)) {
        for (const item of parsed.extends) {
          if (typeof item === 'string' && item.trim() !== '') {
            extendsList.push(item.trim())
          }
        }
      }
      for (const specifier of extendsList) {
        try {
          const resolvedExtends = resolveExtends(specifier, resolvedConfig, repositoryRoot)
          visit(resolvedExtends, false)
        } catch (err) {
          throw err
        }
      }
    }

    // Follow references
    if (Array.isArray(parsed.references)) {
      for (const reference of parsed.references) {
        if (
          reference !== null &&
          typeof reference === 'object' &&
          'path' in reference &&
          typeof (reference as { path: unknown }).path === 'string'
        ) {
          const refPath = (reference as { path: string }).path.trim()
          if (refPath !== '') {
            const target = path.resolve(path.dirname(resolvedConfig), refPath)
            visit(target, true)
          }
        }
      }
    }
  }

  visit(tsconfigPath, true)

  return {
    configs: [...configs].sort(),
    projects: [...projects].sort(),
  }
}

let cachedTs: typeof import('typescript') | null | undefined

function loadTypeScript(): typeof import('typescript') | null {
  if (cachedTs !== undefined) return cachedTs
  try {
    const req = createRequire(import.meta.url)
    cachedTs = req('typescript') as typeof import('typescript')
    return cachedTs
  } catch {
    cachedTs = null
    return null
  }
}

function walkDirectory(dir: string, callback: (file: string) => void): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
          walkDirectory(full, callback)
        }
      } else if (entry.isFile()) {
        callback(full)
      }
    }
  } catch {
    // Ignore filesystem read errors
  }
}

function resolveProjectRoots(
  projectConfigFile: string,
  repositoryRoot: string,
): string[] {
  const configDir = path.dirname(projectConfigFile)
  let rawContent: string
  let parsedConfig: Record<string, unknown>
  try {
    rawContent = fs.readFileSync(projectConfigFile, 'utf8')
    parsedConfig = parseJsonc<Record<string, unknown>>(rawContent)
  } catch {
    return []
  }

  // 1. Try TypeScript compiler API if available
  const tsModule = loadTypeScript()
  if (tsModule) {
    try {
      const parsed = tsModule.parseJsonConfigFileContent(
        parsedConfig,
        tsModule.sys,
        configDir,
        undefined,
        projectConfigFile,
      )
      if (Array.isArray(parsed.fileNames) && parsed.fileNames.length > 0) {
        return parsed.fileNames.map(f => normalizeRelativePath(repositoryRoot, f))
      }
    } catch {
      // Fallback
    }
  }

  // 2. Fallback: manual scan of files and include
  const roots: string[] = []
  if (Array.isArray(parsedConfig.files)) {
    for (const f of parsedConfig.files) {
      if (typeof f === 'string') {
        const full = path.resolve(configDir, f)
        roots.push(normalizeRelativePath(repositoryRoot, full))
      }
    }
  }

  if (Array.isArray(parsedConfig.include)) {
    const defaultExcludes = ['node_modules', 'dist', '.git']
    const customExcludes = Array.isArray(parsedConfig.exclude)
      ? parsedConfig.exclude.filter((x): x is string => typeof x === 'string')
      : []
    const allExcludes = [...defaultExcludes, ...customExcludes]

    for (const inc of parsedConfig.include) {
      if (typeof inc === 'string') {
        const cleanInc = inc.replace(/\/\*.*$/, '')
        const dirPath = path.resolve(configDir, cleanInc)
        if (fs.existsSync(dirPath)) {
          if (fs.statSync(dirPath).isDirectory()) {
            walkDirectory(dirPath, (filePath) => {
              const relFromConfig = normalizeRelativePath(configDir, filePath)
              const excluded = allExcludes.some(ex => relFromConfig.includes(ex))
              if (!excluded && /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/i.test(filePath)) {
                roots.push(normalizeRelativePath(repositoryRoot, filePath))
              }
            })
          } else if (fs.statSync(dirPath).isFile()) {
            roots.push(normalizeRelativePath(repositoryRoot, dirPath))
          }
        }
      }
    }
  }

  return roots
}

/**
 * Computes the transitive tsconfig configuration universe:
 * - Collects the active tsconfig, all extended tsconfigs, and referenced projects.
 * - Computes SHA-256 digest of each config file.
 * - Resolves compiler root files across projects.
 * - Computes overall universeDigest deterministically.
 *
 * Returns undefined if tsconfigPath does not point to an existing tsconfig.
 */
export function computeTsconfigUniverse(
  tsconfigPath?: string | null,
  repositoryRoot?: string,
): ContractConfigUniverse | undefined {
  if (!tsconfigPath || typeof tsconfigPath !== 'string' || tsconfigPath.trim() === '') {
    return undefined
  }

  let resolvedEntry: string
  try {
    resolvedEntry = resolveConfigurationFile(tsconfigPath)
  } catch {
    return undefined
  }

  const rawRepoRoot = repositoryRoot
    ? path.resolve(repositoryRoot)
    : (fs.existsSync(resolvedEntry) ? path.dirname(resolvedEntry) : process.cwd())

  const effectiveRepoRoot = fs.existsSync(rawRepoRoot)
    ? (fs.realpathSync.native ? fs.realpathSync.native(rawRepoRoot) : fs.realpathSync(rawRepoRoot))
    : rawRepoRoot

  let closure: ConfigurationClosure
  try {
    closure = configurationClosure(resolvedEntry, effectiveRepoRoot)
  } catch {
    return undefined
  }

  const configs: ContractConfigDigest[] = []
  for (const configFile of closure.configs) {
    try {
      const content = fs.readFileSync(configFile)
      const digest = createHash('sha256').update(content).digest('hex')
      const relFile = normalizeRelativePath(effectiveRepoRoot, configFile)
      configs.push({ file: relFile, digest })
    } catch {
      // Ignore unreadable file
    }
  }

  const uniqueConfigs = Array.from(
    new Map(configs.map(item => [item.file, item])).values(),
  ).sort((a, b) => a.file.localeCompare(b.file))

  const allRoots = new Set<string>()
  for (const projectFile of closure.projects) {
    const projectRoots = resolveProjectRoots(projectFile, effectiveRepoRoot)
    for (const root of projectRoots) {
      allRoots.add(root)
    }
  }
  const roots = [...allRoots].sort((a, b) => a.localeCompare(b))

  const universePayload = {
    configs: uniqueConfigs,
    roots,
  }
  const universeDigest = createHash('sha256').update(JSON.stringify(universePayload)).digest('hex')

  return {
    configs: uniqueConfigs,
    roots,
    universeDigest,
  }
}

/**
 * Computes the overall SHA-256 digest of the tsconfig universe, or undefined if no tsconfig exists.
 */
export function computeTsconfigUniverseDigest(
  tsconfigPath?: string | null,
  repositoryRoot?: string,
): string | undefined {
  return computeTsconfigUniverse(tsconfigPath, repositoryRoot)?.universeDigest
}

/**
 * Creates an empty ContractConfigUniverse for projects without tsconfig.
 */
export function createEmptyTsconfigUniverse(): ContractConfigUniverse {
  const configs: ContractConfigDigest[] = []
  const roots: string[] = []
  return {
    configs,
    roots,
    universeDigest: createHash('sha256').update(JSON.stringify({ configs, roots })).digest('hex'),
  }
}
