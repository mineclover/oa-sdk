/**
 * Re-checkable observations of how Node.js resolved one import (or failed to),
 * for the module graph `--incremental` tracks (see `module-graph-observer.ts`).
 *
 * An import's outcome is described by the file-system facts Node's resolver
 * consulted, observed now and checked against the outcome that actually
 * happened. The outcome is recorded only when these facts explain it;
 * otherwise (a resolution feature not modeled here, or facts that already
 * changed) the import is reported unverified, which is never reused.
 *
 * Modeled, for ES module `import` and CommonJS `require` (told apart by the
 * `require` resolution condition):
 *   - a relative or absolute path: the path it names (`require` also tries
 *     the registered extensions; a directory is not modeled for `require`);
 *   - a bare package name: the `node_modules` lookup from the importing
 *     directory upwards (`require` also tries `<name><ext>` files and the
 *     global folders), then, in the package found:
 *       - installed (its real path is inside `node_modules`): its
 *         `package.json`, whose version stands for every file it ships;
 *       - authored (a workspace package linked into `node_modules`): its
 *         `package.json` and the file it resolved to: the `exports` target,
 *         the subpath, or the legacy `main` / `index` candidates in the order
 *         Node probes them (earlier candidates must still not be files);
 *   - a failed import: every candidate it probed is still not a file (and no
 *     package directory is found), so creating the module invalidates it.
 * Not modeled: package `imports` (`#...`), self-references, remote URLs,
 * `require` of a directory, and a package that was found but failed to
 * resolve inside.
 *
 * An import made by an installed module is resolved from its package root:
 * candidates inside the package are part of what the package ships.
 */
import { readFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { observeEntry, observeRealpath, type InputObservation } from './input-observations.js'

/** The module that made an import, by real path. */
export type ModuleImporter =
  /** Outside `node_modules`; `scopeManifestPath` is the `package.json` that scopes it, if any. */
  | { kind: 'authored'; path: string; scopeManifestPath: string | undefined }
  /** Inside the installed package rooted at `packageRoot`. */
  | { kind: 'installed'; path: string; packageRoot: string }

export type ImportResolution = {
  specifier: string
  /** Resolution conditions Node used (`import` or `require`, plus user conditions). */
  conditions: readonly string[]
  /** URL the specifier resolved to; null when resolution failed. */
  resolvedUrl: string | null
}

type ResolutionMode = 'import' | 'require'

export function resolutionObservations(importer: ModuleImporter, resolution: ImportResolution): InputObservation[] {
  const { specifier, resolvedUrl } = resolution
  if (resolvedUrl !== null && !resolvedUrl.startsWith('file:')) {
    if (resolvedUrl.startsWith('node:') || resolvedUrl.startsWith('data:')) return []
    return [{ kind: 'content', path: resolvedUrl, unverified: 'remote module' }]
  }
  const resolvedPath = resolvedUrl === null ? null : fileURLToPath(resolvedUrl)
  // Within one installed package, its version stands for every file it ships.
  if (importer.kind === 'installed' && resolvedPath !== null && isInside(resolvedPath, importer.packageRoot)) return []

  const mode: ResolutionMode = resolution.conditions.includes('require') ? 'require' : 'import'
  let modeled: InputObservation[] | undefined
  try {
    modeled = isPathSpecifier(specifier, mode)
      ? pathResolution(importer, specifier, mode, resolvedPath)
      : bareResolution(importer, specifier, mode, resolution.conditions, resolvedPath)
  } catch {
    // A path the model cannot form (for example a file URL Node would reject): not modeled.
    modeled = undefined
  }
  if (modeled) return modeled
  return [resolvedPath === null
    ? { kind: 'content', path: importer.path, unverified: `cannot re-check failed import "${specifier}"` }
    : { kind: 'realpath', path: resolvedPath, unverified: `cannot re-check import "${specifier}"` }]
}

/**
 * The root directory of the installed package `filePath` belongs to (the
 * directory right below its innermost `node_modules`, or `@scope/name`), or
 * undefined for a file outside `node_modules`.
 */
export function installedPackageRoot(filePath: string): string | undefined {
  const segments = filePath.split(sep)
  const nodeModulesIndex = segments.lastIndexOf('node_modules')
  if (nodeModulesIndex < 0) return undefined
  const nameLength = segments[nodeModulesIndex + 1]?.startsWith('@') ? 2 : 1
  const packageRootEnd = nodeModulesIndex + 1 + nameLength
  // A file directly inside node_modules (or @scope/) is not part of a package.
  if (packageRootEnd >= segments.length) return undefined
  return segments.slice(0, packageRootEnd).join(sep) || sep
}

function pathResolution(
  importer: ModuleImporter,
  specifier: string,
  mode: ResolutionMode,
  resolvedPath: string | null,
): InputObservation[] | undefined {
  const namedPath = mode === 'require'
    ? resolvePath(dirname(importer.path), specifier)
    : fileURLToPath(new URL(specifier, pathToFileURL(importer.path)))
  // A file an installed module failed to find inside its own package is part of what the package ships.
  if (importer.kind === 'installed' && resolvedPath === null && isInside(namedPath, importer.packageRoot)) return []
  if (mode === 'import') return firstFileObservations([namedPath], resolvedPath)
  // `require('./dir/')` resolves a directory only, which is not modeled.
  if (specifier.endsWith('/')) return undefined
  return firstFileObservations(withRequireExtensions(namedPath), resolvedPath, namedPath)
}

function bareResolution(
  importer: ModuleImporter,
  specifier: string,
  mode: ResolutionMode,
  conditions: readonly string[],
  resolvedPath: string | null,
): InputObservation[] | undefined {
  const packageName = bareSpecifierPackageName(specifier)
  if (!packageName || mayResolveToSelf(importer, packageName)) return undefined
  const subpath = specifier.slice(packageName.length)

  const startDirectory = importer.kind === 'installed' ? importer.packageRoot : dirname(importer.path)
  const lookupDirectories = [
    ...ancestorDirectories(startDirectory).map(directory => join(directory, 'node_modules')),
    ...(mode === 'require' ? requireGlobalFolders() : []),
  ]
  const observations: InputObservation[] = []
  for (const lookupDirectory of lookupDirectories) {
    const candidate = join(lookupDirectory, packageName)
    const entry = observeEntry(candidate)
    if (mode === 'require' && subpath === '') {
      // require('<name>') takes a `<name>` or `<name><ext>` file in the lookup directory first.
      if (entry === 'file') return undefined
      for (const extensionCandidate of withRequireExtensions(candidate).slice(1)) {
        const extensionEntry = observeEntry(extensionCandidate)
        if (extensionEntry === 'file') return undefined
        observations.push({ kind: 'entry', path: extensionCandidate, value: extensionEntry })
      }
    }
    if (entry === 'directory') {
      // A package found that then failed to resolve is not modeled.
      return resolvedPath === null ? undefined : packageResolution(observations, candidate, subpath, mode, conditions, resolvedPath)
    }
    observations.push({ kind: 'entry', path: candidate, value: entry })
  }
  return resolvedPath === null ? observations : undefined
}

/** How `resolvedPath` was resolved inside the package directory found at `candidate`. */
function packageResolution(
  lookup: readonly InputObservation[],
  candidate: string,
  subpath: string,
  mode: ResolutionMode,
  conditions: readonly string[],
  resolvedPath: string,
): InputObservation[] | undefined {
  const packageDirectory = observeRealpath(candidate)
  if (!packageDirectory || !isInside(resolvedPath, packageDirectory)) return undefined
  const manifestPath = join(candidate, 'package.json')
  const found: InputObservation[] = [
    ...lookup,
    { kind: 'entry', path: candidate, value: 'directory' },
    { kind: 'realpath', path: candidate, value: packageDirectory },
    { kind: 'content', path: manifestPath },
  ]
  // An installed package: its version stands for how a specifier resolves inside it.
  if (installedPackageRoot(join(packageDirectory, 'package.json')) !== undefined) return found

  const manifest = readManifest(manifestPath)
  if (!manifest) return undefined
  const inside = packageEntryObservations(manifest, candidate, subpath, mode, conditions, resolvedPath)
  return inside && [...found, ...inside]
}

function packageEntryObservations(
  manifest: PackageManifest,
  candidate: string,
  subpath: string,
  mode: ResolutionMode,
  conditions: readonly string[],
  resolvedPath: string,
): InputObservation[] | undefined {
  const inPackage = (relativePath: string) => packageFilePath(candidate, relativePath, mode)

  if (manifest.exports !== undefined && manifest.exports !== null) {
    // `exports` maps the subpath to one target without probing; Node then requires a file there.
    const target = exportsTarget(manifest.exports, `.${subpath}`, new Set(conditions))
    if (target === undefined) return undefined
    const targetPath = inPackage(target)
    return observeRealpath(targetPath) === resolvedPath
      ? [{ kind: 'realpath', path: targetPath, value: resolvedPath }]
      : undefined
  }
  if (subpath !== '') {
    const subpathPath = inPackage(`.${subpath}`)
    return mode === 'import'
      ? firstFileObservations([subpathPath], resolvedPath)
      : firstFileObservations(withRequireExtensions(subpathPath), resolvedPath, subpathPath)
  }
  // The legacy main entry: `main` with Node's extension and index probes, then `index`.
  const main = typeof manifest.main === 'string' ? manifest.main : undefined
  const candidates = mode === 'import'
    ? [
        ...(main !== undefined
          ? ['', '.js', '.json', '.node', '/index.js', '/index.json', '/index.node'].map(suffix => inPackage(`./${main}${suffix}`))
          : []),
        ...['index.js', 'index.json', 'index.node'].map(file => inPackage(`./${file}`)),
      ]
    : [
        // require() skips an empty `main`.
        ...(main ? [...withRequireExtensions(inPackage(main)), ...withRequireExtensions(join(inPackage(main), 'index')).slice(1)] : []),
        ...withRequireExtensions(inPackage('index')).slice(1),
      ]
  return firstFileObservations(candidates, resolvedPath)
}

/**
 * Observations for a resolver that takes the first of `candidates` that is a
 * file, following symlinks, or fails when none is: every candidate before
 * that file is not a file, and that file's real path is `resolvedPath`; for a
 * failure, no candidate is a file. Undefined when the candidates do not
 * explain the outcome, or when `unmodeledDirectory` is a directory (a
 * `require` that would go on to resolve it as a package).
 */
function firstFileObservations(
  candidates: readonly string[],
  resolvedPath: string | null,
  unmodeledDirectory?: string,
): InputObservation[] | undefined {
  const observations: InputObservation[] = []
  for (const candidate of candidates) {
    const entry = observeEntry(candidate)
    if (entry === 'file') {
      return resolvedPath !== null && observeRealpath(candidate) === resolvedPath
        ? [...observations, { kind: 'realpath', path: candidate, value: resolvedPath }]
        : undefined
    }
    if (candidate === unmodeledDirectory && entry === 'directory') return undefined
    observations.push({ kind: 'entry', path: candidate, value: entry })
  }
  return resolvedPath === null ? observations : undefined
}

/**
 * The exports target for `subpath` (`.` or `./...`) under `conditions`,
 * following Node's PACKAGE_EXPORTS_RESOLVE; undefined when there is none or
 * the map uses forms this does not model.
 */
function exportsTarget(exportsField: unknown, subpath: string, conditions: ReadonlySet<string>): string | undefined {
  let exportsMap = exportsField
  if (typeof exportsMap === 'string' || Array.isArray(exportsMap)) exportsMap = { '.': exportsMap }
  if (typeof exportsMap !== 'object' || exportsMap === null) return undefined
  const keys = Object.keys(exportsMap)
  const subpathKeys = keys.filter(key => key.startsWith('.'))
  if (subpathKeys.length === 0) exportsMap = { '.': exportsMap }
  else if (subpathKeys.length !== keys.length) return undefined
  const map = exportsMap as Record<string, unknown>

  if (Object.hasOwn(map, subpath) && !subpath.includes('*') && !subpath.endsWith('/')) {
    const target = packageTarget(map[subpath], undefined, conditions)
    return typeof target === 'string' ? target : undefined
  }
  let bestMatch = ''
  let bestMatchSubpath = ''
  for (const key of Object.keys(map)) {
    const patternIndex = key.indexOf('*')
    if (patternIndex === -1 || key.lastIndexOf('*') !== patternIndex || !subpath.startsWith(key.slice(0, patternIndex))) continue
    const trailer = key.slice(patternIndex + 1)
    if (subpath.length >= key.length && subpath.endsWith(trailer) && patternKeyCompare(bestMatch, key) === 1) {
      bestMatch = key
      bestMatchSubpath = subpath.slice(patternIndex, subpath.length - trailer.length)
    }
  }
  if (!bestMatch) return undefined
  const target = packageTarget(map[bestMatch], bestMatchSubpath, conditions)
  return typeof target === 'string' ? target : undefined
}

/**
 * PACKAGE_TARGET_RESOLVE for an exports target: a relative path (with the
 * pattern match substituted), null when the target excludes the subpath,
 * undefined when no condition matches or the target is invalid.
 */
function packageTarget(target: unknown, patternMatch: string | undefined, conditions: ReadonlySet<string>): string | null | undefined {
  if (typeof target === 'string') {
    if (!target.startsWith('./') || hasInvalidTargetSegment(target.slice(2))) return undefined
    if (patternMatch === undefined) return target
    if (hasInvalidTargetSegment(patternMatch)) return undefined
    return target.replaceAll('*', patternMatch)
  }
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = packageTarget(item, patternMatch, conditions)
      if (typeof resolved === 'string') return resolved
    }
    return undefined
  }
  if (typeof target === 'object' && target !== null) {
    for (const [condition, conditionalTarget] of Object.entries(target)) {
      if (condition !== 'default' && !conditions.has(condition)) continue
      const resolved = packageTarget(conditionalTarget, patternMatch, conditions)
      if (resolved !== undefined) return resolved
    }
    return undefined
  }
  return target === null ? null : undefined
}

/**
 * A `.`, `..` or `node_modules` path segment, case-insensitively and in
 * percent-encoded form: Node rejects an exports target or pattern match that
 * contains one (its `deprecatedInvalidSegmentRegEx`).
 */
const INVALID_TARGET_SEGMENT = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i

function hasInvalidTargetSegment(path: string): boolean {
  return INVALID_TARGET_SEGMENT.test(path)
}

function patternKeyCompare(a: string, b: string): number {
  const aPatternIndex = a.indexOf('*')
  const bPatternIndex = b.indexOf('*')
  const baseLengthA = aPatternIndex === -1 ? a.length : aPatternIndex + 1
  const baseLengthB = bPatternIndex === -1 ? b.length : bPatternIndex + 1
  if (baseLengthA > baseLengthB) return -1
  if (baseLengthB > baseLengthA) return 1
  if (aPatternIndex === -1) return 1
  if (bPatternIndex === -1) return -1
  if (a.length > b.length) return -1
  if (b.length > a.length) return 1
  return 0
}

type PackageManifest = { name?: unknown; main?: unknown; exports?: unknown }

/** The parsed manifest; `{}` when there is none (Node then has no `exports` or `main`), undefined when unreadable. */
function readManifest(manifestPath: string): PackageManifest | undefined {
  let text: string
  try {
    text = readFileSync(manifestPath, 'utf8')
  } catch {
    return observeEntry(manifestPath) === 'absent' ? {} : undefined
  }
  try {
    const manifest: unknown = JSON.parse(text)
    return typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest) ? manifest as PackageManifest : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a bare `packageName` import may resolve through the importer's own
 * package scope (a self-reference: its scope manifest names that package and
 * has `exports`), which is not modeled. An unreadable manifest counts as yes.
 */
function mayResolveToSelf(importer: ModuleImporter, packageName: string): boolean {
  const manifestPath = importer.kind === 'installed'
    ? join(importer.packageRoot, 'package.json')
    : importer.scopeManifestPath
  if (manifestPath === undefined) return false
  const manifest = readManifest(manifestPath)
  return !manifest || (manifest.name === packageName && manifest.exports !== undefined && manifest.exports !== null)
}

/** A path inside the package directory named by `packageDirectory` (not resolved through symlinks), as Node forms it. */
function packageFilePath(packageDirectory: string, relativePath: string, mode: ResolutionMode): string {
  return mode === 'require'
    ? resolvePath(packageDirectory, relativePath)
    : fileURLToPath(new URL(relativePath, pathToFileURL(join(packageDirectory, 'package.json'))))
}

/** `path` itself, then `path<ext>` for each extension `require` currently handles. */
function withRequireExtensions(path: string): string[] {
  return [path, ...requireExtensions().map(extension => `${path}${extension}`)]
}

function requireExtensions(): string[] {
  const extensions = nodeModule.createRequire(import.meta.url).extensions as Record<string, unknown> | undefined
  return extensions ? Object.keys(extensions) : ['.js', '.json', '.node']
}

/** The global folders `require` searches after `node_modules` (NODE_PATH, ~/.node_modules, ...). */
function requireGlobalFolders(): string[] {
  const globalPaths = (nodeModule as { globalPaths?: unknown }).globalPaths
  return Array.isArray(globalPaths) ? globalPaths.filter((path): path is string => typeof path === 'string') : []
}

/** `directory` and each of its ancestors up to the file-system root. */
function ancestorDirectories(directory: string): string[] {
  const directories: string[] = []
  for (let current = directory; ; current = dirname(current)) {
    directories.push(current)
    if (dirname(current) === current) return directories
  }
}

function isPathSpecifier(specifier: string, mode: ResolutionMode): boolean {
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) return true
  if (mode === 'import') return specifier.startsWith('file:')
  return specifier === '.' || specifier === '..'
}

/** `name` or `@scope/name` of a bare specifier; undefined for package `imports` (`#...`), URLs and malformed names. */
function bareSpecifierPackageName(specifier: string): string | undefined {
  if (specifier === '' || specifier.startsWith('#') || specifier.startsWith('.') || specifier.includes('\\') || specifier.includes(':')) {
    return undefined
  }
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) return segments.length >= 2 && segments[1] !== '' ? `${segments[0]}/${segments[1]}` : undefined
  return segments[0]
}

function isInside(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(directory.endsWith(sep) ? directory : `${directory}${sep}`)
}
