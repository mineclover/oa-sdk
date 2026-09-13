import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Parsed tsconfig structure containing paths mapping and baseUrl.
 */
export interface ParsedTsconfig {
  compilerOptions?: {
    baseUrl?: string | undefined
    paths?: Record<string, string[]> | undefined
  } | undefined
}

/**
 * Options for resolving TypeScript import module specifiers.
 */
export interface ResolveImportOptions {
  /** File path of the module declaring the import statement */
  fromFilePath: string
  /** File path of the target module being imported */
  toFilePath: string
  /** Project root directory for resolving relative paths (defaults to process.cwd()) */
  rootDir?: string | undefined
  /** Import specifier style: 'relative' (default) or 'alias' */
  importStyle?: 'relative' | 'alias' | undefined
  /** Explicit tsconfig options */
  tsconfig?: ParsedTsconfig | undefined
  /** Explicit path to tsconfig.json file for auto-loading paths */
  tsconfigPath?: string | undefined
  /** Output file extension for the import specifier: '.js' (default for modern ESM) or '' */
  extension?: '.js' | '' | undefined
  /** Whether to resolve cross-package monorepo imports to canonical package names (default: true) */
  packageBoundary?: boolean | undefined
}

/**
 * Strips comments from JSON string (supports line // and block /* *\/ comments).
 */
export function stripJsonComments(jsonString: string): string {
  return jsonString.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1')
}

/**
 * Safely loads and parses a tsconfig.json file.
 */
export function loadTsconfig(tsconfigPath: string): ParsedTsconfig | null {
  try {
    if (!fs.existsSync(tsconfigPath)) return null
    const content = fs.readFileSync(tsconfigPath, 'utf8')
    const stripped = stripJsonComments(content)
    return JSON.parse(stripped) as ParsedTsconfig
  } catch {
    return null
  }
}

/**
 * Normalizes a file path to POSIX format with forward slashes.
 */
export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

/**
 * Formats the module specifier extension (.ts -> .js or stripped).
 */
export function formatExtension(specifier: string, extension: '.js' | ''): string {
  // Strip TS extensions (.ts, .tsx, .mts, .cts) or existing JS extensions
  const stripped = specifier.replace(/\.(?:[mc]?[jt]sx?)$/, '')
  if (extension === '.js') {
    return `${stripped}.js`
  }
  return stripped
}

/**
 * Attempts to match a target file path against tsconfig path aliases.
 */
export function matchTsconfigPathAlias(
  resolvedTo: string,
  tsconfig: ParsedTsconfig,
  rootDir: string,
  tsconfigDir: string,
): string | null {
  const paths = tsconfig.compilerOptions?.paths
  if (!paths || Object.keys(paths).length === 0) return null

  const baseUrl = tsconfig.compilerOptions?.baseUrl ?? '.'
  const baseUrlDir = path.resolve(tsconfigDir, baseUrl)
  const posixTo = toPosixPath(resolvedTo)

  for (const [pattern, targets] of Object.entries(paths)) {
    if (!targets || targets.length === 0) continue

    for (const target of targets) {
      if (pattern.endsWith('/*') && target.endsWith('/*')) {
        const patternPrefix = pattern.slice(0, -2) // e.g. "@features"
        const targetPrefix = target.slice(0, -2)   // e.g. "src/features"
        const absoluteTargetDir = toPosixPath(path.resolve(baseUrlDir, targetPrefix))

        if (posixTo === absoluteTargetDir || posixTo.startsWith(`${absoluteTargetDir}/`)) {
          const remainder = posixTo.slice(absoluteTargetDir.length).replace(/^\//, '')
          return remainder.length > 0 ? `${patternPrefix}/${remainder}` : patternPrefix
        }
      } else if (pattern === target || !pattern.includes('*')) {
        const absoluteTarget = toPosixPath(path.resolve(baseUrlDir, target))
        const posixToWithoutExt = posixTo.replace(/\.(?:[mc]?[jt]sx?)$/, '')
        const targetWithoutExt = absoluteTarget.replace(/\.(?:[mc]?[jt]sx?)$/, '')

        if (posixTo === absoluteTarget || posixToWithoutExt === targetWithoutExt) {
          return pattern
        }
      }
    }
  }

  return null
}

/**
 * Package metadata discovered from the nearest package.json manifest.
 */
export interface NearestPackageInfo {
  dir: string
  packageJsonPath: string
  name: string
  packageJson: Record<string, unknown>
}

/**
 * Searches upwards from a directory to find the nearest package.json with a valid package name.
 * Skips root monorepo manifests that define workspaces (workspaces array/object or pnpm-workspace.yaml).
 */
export function findNearestPackageJson(startPath: string): NearestPackageInfo | null {
  try {
    const resolvedStart = path.resolve(startPath)
    let current = fs.existsSync(resolvedStart) && fs.statSync(resolvedStart).isDirectory()
      ? resolvedStart
      : path.dirname(resolvedStart)

    while (true) {
      const candidate = path.join(current, 'package.json')
      if (fs.existsSync(candidate)) {
        try {
          const content = fs.readFileSync(candidate, 'utf8')
          const json = JSON.parse(content)
          const isWorkspaceRoot = Boolean(json?.workspaces) || fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))
          if (
            json &&
            typeof json === 'object' &&
            typeof json.name === 'string' &&
            json.name.trim().length > 0 &&
            !isWorkspaceRoot
          ) {
            return {
              dir: current,
              packageJsonPath: candidate,
              name: json.name.trim(),
              packageJson: json as Record<string, unknown>,
            }
          }
        } catch {
          // ignore parsing error and continue search upwards
        }
      }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  } catch {
    // ignore filesystem errors
  }
  return null
}

function extractExportTargets(expVal: unknown): string[] {
  if (typeof expVal === 'string') return [expVal]
  if (expVal && typeof expVal === 'object') {
    const results: string[] = []
    for (const val of Object.values(expVal as Record<string, unknown>)) {
      if (typeof val === 'string') {
        results.push(val)
      } else if (val && typeof val === 'object') {
        results.push(...extractExportTargets(val))
      }
    }
    return results
  }
  return []
}

function normalizeExportTarget(target: string): string {
  return toPosixPath(target).replace(/^\.\//, '').replace(/\.(?:[mc]?[jt]sx?)$/, '')
}

/**
 * Resolves canonical package specifier when importing across package boundaries in a monorepo.
 */
export function resolvePackageSpecifier(resolvedTo: string, toPkg: NearestPackageInfo): string {
  const rel = toPosixPath(path.relative(toPkg.dir, resolvedTo))
  const relNoExt = rel.replace(/\.(?:[mc]?[jt]sx?)$/, '')

  // 1. Check if it's the package root entrypoint
  const isMainEntry =
    relNoExt === 'src/index' ||
    relNoExt === 'index' ||
    relNoExt === 'src/client' ||
    relNoExt === 'client' ||
    (typeof toPkg.packageJson.main === 'string' &&
      (relNoExt === normalizeExportTarget(toPkg.packageJson.main) ||
       relNoExt === normalizeExportTarget(toPkg.packageJson.main).replace(/^dist\//, 'src/')))

  if (isMainEntry) {
    return toPkg.name
  }

  // 2. Check package.json exports mapping if defined
  const exports = toPkg.packageJson.exports
  if (exports && typeof exports === 'object') {
    for (const [expKey, expVal] of Object.entries(exports)) {
      const targets = extractExportTargets(expVal)
      for (const t of targets) {
        const norm = normalizeExportTarget(t)
        if (norm === relNoExt || norm.replace(/^dist\//, 'src/') === relNoExt || norm.replace(/^src\//, 'dist/') === relNoExt) {
          if (expKey === '.') {
            return toPkg.name
          }
          const cleanSub = expKey.replace(/^\.\//, '')
          return `${toPkg.name}/${cleanSub}`
        }
      }
    }
  }

  // 3. Subpath fallback (strip leading src/ or dist/)
  const cleanSub = relNoExt.replace(/^(?:src|dist)\//, '')
  if (cleanSub === 'index' || cleanSub === '') {
    return toPkg.name
  }
  return `${toPkg.name}/${cleanSub}`
}

/**
 * Resolves a TypeScript import specifier between two files.
 *
 * Guarantees:
 * 1. Strictly POSIX forward slashes ('/') across Windows, macOS, and Linux.
 * 2. Modern ESM '.js' extension appending by default.
 * 3. Correct relative path computation ('./' or '../') across nested folder hierarchies.
 * 4. Optional tsconfig path alias matching ('@features/*', '@shared/*', etc.).
 * 5. Self-import prevention guard.
 */
export function resolveImportSpecifier(options: ResolveImportOptions): string {
  const {
    fromFilePath,
    toFilePath,
    rootDir = process.cwd(),
    importStyle = 'relative',
    extension = '.js',
  } = options

  // Detect whether inputs are Windows-formatted paths (drive letters or UNC shares)
  const isWindowsPath =
    /^[a-zA-Z]:[\\/]/.test(fromFilePath) ||
    /^[a-zA-Z]:[\\/]/.test(toFilePath) ||
    /^\\\\[^\\]/.test(fromFilePath) ||
    /^\\\\[^\\]/.test(toFilePath)

  const pathModule = isWindowsPath ? path.win32 : path

  // Resolve absolute paths
  const resolvedFrom = pathModule.isAbsolute(fromFilePath)
    ? pathModule.normalize(fromFilePath)
    : pathModule.resolve(rootDir, fromFilePath)

  const resolvedTo = pathModule.isAbsolute(toFilePath)
    ? pathModule.normalize(toFilePath)
    : pathModule.resolve(rootDir, toFilePath)

  // Guard against self-imports
  if (toPosixPath(resolvedFrom).toLowerCase() === toPosixPath(resolvedTo).toLowerCase()) {
    throw new Error(
      `Self-import is not allowed: cannot resolve import from "${fromFilePath}" to itself.`,
    )
  }

  // Check tsconfig alias style
  if (importStyle === 'alias') {
    let tsconfig = options.tsconfig
    let tsconfigDir = rootDir

    if (!tsconfig && options.tsconfigPath) {
      const absTsconfigPath = path.isAbsolute(options.tsconfigPath)
        ? options.tsconfigPath
        : path.resolve(rootDir, options.tsconfigPath)
      tsconfig = loadTsconfig(absTsconfigPath) ?? undefined
      tsconfigDir = path.dirname(absTsconfigPath)
    } else if (!tsconfig) {
      const defaultTsconfigPath = path.resolve(rootDir, 'tsconfig.json')
      tsconfig = loadTsconfig(defaultTsconfigPath) ?? undefined
      tsconfigDir = rootDir
    }

    if (tsconfig) {
      const aliasMatch = matchTsconfigPathAlias(toPosixPath(resolvedTo), tsconfig, rootDir, tsconfigDir)
      if (aliasMatch) {
        return formatExtension(aliasMatch, extension)
      }
    }
  }

  // Check monorepo package boundary awareness
  if (options.packageBoundary !== false) {
    const toPkg = findNearestPackageJson(resolvedTo)
    if (toPkg) {
      const fromPkg = findNearestPackageJson(resolvedFrom)
      // Only resolve to canonical package specifier if crossing package boundaries
      if (!fromPkg || fromPkg.packageJsonPath !== toPkg.packageJsonPath) {
        return resolvePackageSpecifier(resolvedTo, toPkg)
      }
    }
  }

  // Compute POSIX relative import
  const fromDir = pathModule.dirname(resolvedFrom)
  let rel = toPosixPath(pathModule.relative(fromDir, resolvedTo))

  // Ensure leading './' for sibling or child modules
  if (!rel.startsWith('.')) {
    rel = `./${rel}`
  }

  return formatExtension(rel, extension)
}
