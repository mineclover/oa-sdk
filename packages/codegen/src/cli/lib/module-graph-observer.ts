/**
 * Observes the JavaScript module graph a TypeSpec compilation loads (decorator
 * and library entries and everything they import), so `--incremental` can
 * track the modules an entry pulls in, not only the entry file itself.
 *
 * Node.js module customization hooks (`module.registerHooks`, synchronous and
 * in-thread) report every module loaded and every import resolved from an
 * authored module once observation has started. The graph is kept for the
 * rest of the process: Node caches modules, so a later compilation that
 * imports the same entry again loads nothing new, and its graph is the one
 * recorded when the modules were first loaded.
 *
 * Tracking policy, by where a module's real path lives:
 *   - authored (outside `node_modules`): its bytes, the `package.json` that
 *     scopes it, and how each of its imports resolved;
 *   - installed (inside `node_modules`): its package's `package.json` (the
 *     installed version stands for every file the package ships).
 * An authored module whose imports were not observed (loaded before
 * observation started, or no hook support) is reported unverified.
 */
import { createHash } from 'node:crypto'
import * as nodeModule from 'node:module'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { observeEntry, observeRealpath, type InputObservation } from './input-observations.js'

type ModuleGraph = {
  /** Authored module URL -> sha256 of the source Node loaded (undefined when the loader did not expose it). */
  loaded: Map<string, string | undefined>
  /** Authored module URL -> specifier -> URL it resolved to. */
  imports: Map<string, Map<string, string>>
}

let graph: ModuleGraph | undefined

/**
 * Start observing module loading for the rest of the process (idempotent).
 * Returns false when the runtime has no synchronous module hooks
 * (`module.registerHooks`, Node.js >= 22.15).
 */
export function observeModuleLoading(): boolean {
  if (graph) return true
  const registerHooks = (nodeModule as { registerHooks?: typeof nodeModule.registerHooks }).registerHooks
  if (typeof registerHooks !== 'function') return false

  const observed: ModuleGraph = { loaded: new Map(), imports: new Map() }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      const parentURL = context.parentURL
      if (parentURL && isAuthoredModuleUrl(parentURL)) {
        let imports = observed.imports.get(parentURL)
        if (!imports) observed.imports.set(parentURL, imports = new Map())
        imports.set(specifier, resolved.url)
      }
      return resolved
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context)
      if (isAuthoredModuleUrl(url)) observed.loaded.set(url, hashModuleSource(loaded.source))
      return loaded
    },
  })
  graph = observed
  return true
}

/**
 * Observations for the module graphs rooted at `entryPaths` (JS files the
 * compiler imported), as described in the module comment.
 */
export function observeModuleGraph(entryPaths: Iterable<string>): InputObservation[] {
  const observations: InputObservation[] = []
  const pending = [...entryPaths].map(entryPath => pathToFileURL(observeRealpath(entryPath) ?? entryPath).href)
  const visited = new Set<string>()

  for (let url = pending.pop(); url !== undefined; url = pending.pop()) {
    if (visited.has(url) || !url.startsWith('file:')) continue
    visited.add(url)
    const filePath = fileURLToPath(url)

    const packageRoot = installedPackageRoot(filePath)
    if (packageRoot) {
      observations.push({ kind: 'content', path: join(packageRoot, 'package.json') })
      continue
    }

    if (!graph?.loaded.has(url)) {
      observations.push({
        kind: 'content',
        path: filePath,
        unverified: graph ? 'module imports not observed' : 'module imports not observable on this Node.js version',
      })
      continue
    }

    const sourceHash = graph.loaded.get(url)
    observations.push({ kind: 'content', path: filePath, ...(sourceHash ? { consumed: { sha256: sourceHash } } : {}) })
    observations.push(...packageScopeObservations(dirname(filePath)))
    for (const [specifier, resolvedUrl] of graph.imports.get(url) ?? []) {
      observations.push(...resolutionObservations(specifier, filePath, resolvedUrl))
      pending.push(resolvedUrl)
    }
  }
  return observations
}

/**
 * The root directory of the installed package `filePath` belongs to (the
 * directory right below its innermost `node_modules`, or `@scope/name`), or
 * undefined for a file outside `node_modules`.
 */
function installedPackageRoot(filePath: string): string | undefined {
  const segments = filePath.split(sep)
  const nodeModulesIndex = segments.lastIndexOf('node_modules')
  if (nodeModulesIndex < 0) return undefined
  const nameLength = segments[nodeModulesIndex + 1]?.startsWith('@') ? 2 : 1
  const packageRootEnd = nodeModulesIndex + 1 + nameLength
  // A file directly inside node_modules (or @scope/) is not part of a package.
  if (packageRootEnd >= segments.length) return undefined
  return segments.slice(0, packageRootEnd).join(sep) || sep
}

function isAuthoredModuleUrl(url: string): boolean {
  if (!url.startsWith('file:')) return false
  try {
    return installedPackageRoot(fileURLToPath(url)) === undefined
  } catch {
    return false
  }
}

function hashModuleSource(source: unknown): string | undefined {
  if (typeof source === 'string') return createHash('sha256').update(source).digest('hex')
  if (ArrayBuffer.isView(source)) {
    return createHash('sha256').update(new Uint8Array(source.buffer, source.byteOffset, source.byteLength)).digest('hex')
  }
  if (source instanceof ArrayBuffer) return createHash('sha256').update(new Uint8Array(source)).digest('hex')
  return undefined
}

/**
 * The `package.json` lookup Node.js makes for a module in `moduleDir` (its
 * package scope: module format, `imports`, self-references): each candidate up
 * to the nearest existing one, absent candidates included.
 */
function packageScopeObservations(moduleDir: string): InputObservation[] {
  const observations: InputObservation[] = []
  for (let directory = moduleDir; basename(directory) !== 'node_modules'; directory = dirname(directory)) {
    const manifestPath = join(directory, 'package.json')
    observations.push({ kind: 'content', path: manifestPath })
    if (observeEntry(manifestPath) === 'file' || dirname(directory) === directory) break
  }
  return observations
}

/**
 * How `specifier`, imported by the authored module `parentPath`, resolved to
 * `resolvedUrl`, re-checkable without the module loader:
 *   - a relative or absolute path: the real path of the path it names
 *     (ES module resolution adds no extension and follows symlinks);
 *   - a bare package name: Node's `node_modules` lookup from the importing
 *     directory upwards (each candidate that is not a directory, then the one
 *     found, where it links to, and its `package.json`).
 * The observations are taken now, so each is checked against the resolution
 * that actually happened: one that no longer leads to `resolvedUrl` (or a
 * resolution these rules do not model, such as CommonJS extension probing or
 * package `imports`) is reported unverified.
 */
function resolutionObservations(specifier: string, parentPath: string, resolvedUrl: string): InputObservation[] {
  if (resolvedUrl.startsWith('node:') || resolvedUrl.startsWith('data:')) return []
  if (!resolvedUrl.startsWith('file:')) return [{ kind: 'content', path: resolvedUrl, unverified: 'remote module' }]
  const resolvedPath = fileURLToPath(resolvedUrl)
  const unmodeled: InputObservation = { kind: 'realpath', path: resolvedPath, unverified: `cannot re-check import "${specifier}"` }

  if (isPathSpecifier(specifier)) {
    const namedPath = fileURLToPath(new URL(specifier, pathToFileURL(parentPath)))
    return observeRealpath(namedPath) === resolvedPath
      ? [{ kind: 'realpath', path: namedPath, value: resolvedPath }]
      : [unmodeled]
  }

  const packageName = bareSpecifierPackageName(specifier)
  if (!packageName) return [unmodeled]
  const observations: InputObservation[] = []
  for (let directory = dirname(parentPath); ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', packageName)
    const entry = observeEntry(candidate)
    if (entry === 'directory') {
      const packageDir = observeRealpath(candidate)
      if (!packageDir || !isInside(resolvedPath, packageDir)) return [unmodeled]
      return [
        ...observations,
        { kind: 'entry', path: candidate, value: entry },
        { kind: 'realpath', path: candidate, value: packageDir },
        { kind: 'content', path: join(candidate, 'package.json') },
      ]
    }
    observations.push({ kind: 'entry', path: candidate, value: entry })
    if (dirname(directory) === directory) return [unmodeled]
  }
}

function isPathSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/') || specifier.startsWith('file:')
}

/** `name` or `@scope/name` of a bare specifier; undefined for package `imports` (`#...`) and malformed names. */
function bareSpecifierPackageName(specifier: string): string | undefined {
  if (specifier.startsWith('#') || specifier === '' || specifier.includes('\\')) return undefined
  const segments = specifier.split('/')
  const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  return name && !(specifier.startsWith('@') && segments.length < 2) ? name : undefined
}

function isInside(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(directory.endsWith(sep) ? directory : `${directory}${sep}`)
}
