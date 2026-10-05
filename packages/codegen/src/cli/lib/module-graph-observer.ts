/**
 * Observes the JavaScript module graph a TypeSpec compilation loads (decorator
 * and library entries and everything they import), so `--incremental` can
 * track the modules an entry pulls in, not only the entry file itself.
 *
 * Node.js module customization hooks (`module.registerHooks`, synchronous and
 * in-thread) report every module loaded once observation has started, and
 * every import such a module resolves, including the ones that fail (an
 * optional `import()` or `require()` inside `try`). The graph is kept for the
 * rest of the process: Node caches modules, so a later compilation that
 * imports the same entry again loads nothing new, and its graph is the one
 * recorded when the modules were first loaded.
 *
 * Tracking policy, by where a module's real path lives:
 *   - authored (outside `node_modules`): its bytes, the `package.json` that
 *     scopes it, and how each of its imports resolved or failed;
 *   - installed (inside `node_modules`): its package's `package.json` (the
 *     installed version stands for every file the package ships), and how
 *     each import that leaves the package resolved or failed, so the packages
 *     an installed dependency itself depends on are tracked the same way.
 * How an import resolved is described in `module-resolution-observations.ts`.
 *
 * A module observation could not follow:
 *   - an authored module loaded before observation started (or with no hook
 *     support) is reported unverified;
 *   - an installed module loaded before observation started was loaded by the
 *     running generator itself (oa-gen and the TypeSpec compiler it runs, with
 *     their dependencies), so it is identified by its package manifest only,
 *     and its own dependencies belong to the generator installation.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { observeEntry, observeRealpath, type InputObservation } from './input-observations.js'
import {
  installedPackageRoot,
  resolutionObservations,
  type ImportResolution,
  type ModuleImporter,
} from './module-resolution-observations.js'

/** One import a module made: its specifier under one set of conditions, and every outcome seen for it. */
type ImportRecord = {
  specifier: string
  conditions: readonly string[]
  /** Resolved URLs, null for a failed resolution; more than one means it resolved differently over time. */
  outcomes: Set<string | null>
}

/** The bytes an authored module was loaded from (see `loadedModuleSource`). */
type LoadedSource = { sha256: string } | { unverified: string }

type ModuleGraph = {
  /**
   * Every file module loaded since observation started -> the bytes it was
   * loaded from, for authored modules (installed modules are tracked by
   * version: undefined).
   */
  loaded: Map<string, LoadedSource | undefined>
  /** Importing module URL (one of `loaded`) -> imports it made. */
  imports: Map<string, Map<string, ImportRecord>>
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
      const parentURL = context.parentURL
      // Only the imports of modules loaded under observation: a module's imports resolve after it loads.
      const observedParent = parentURL !== undefined && observed.loaded.has(parentURL)
      const conditions = context.conditions ?? []
      let resolved: ReturnType<typeof nextResolve>
      try {
        resolved = nextResolve(specifier, context)
      } catch (error) {
        if (observedParent) recordImport(observed, parentURL, specifier, conditions, null)
        throw error
      }
      if (observedParent) recordImport(observed, parentURL, specifier, conditions, resolved.url)
      return resolved
    },
    load(url, context, nextLoad) {
      if (!url.startsWith('file:') || !isAuthoredModuleUrl(url)) {
        const loaded = nextLoad(url, context)
        if (url.startsWith('file:')) observed.loaded.set(url, undefined)
        return loaded
      }
      const filePath = fileURLToPath(url)
      const before = readModuleBytes(filePath)
      const loaded = nextLoad(url, context)
      const source = loadedModuleSource(loaded.source, before, () => readModuleBytes(filePath))
      // A module loaded again (a cleared require cache) must have been loaded from the same bytes.
      const previous = observed.loaded.get(url)
      observed.loaded.set(url, previous && !sameLoadedSource(previous, source)
        ? { unverified: 'loaded more than once with different content' }
        : source)
      return loaded
    },
  })
  graph = observed
  return true
}

function recordImport(
  observed: ModuleGraph,
  parentURL: string,
  specifier: string,
  conditions: readonly string[],
  outcome: string | null,
): void {
  let imports = observed.imports.get(parentURL)
  if (!imports) observed.imports.set(parentURL, imports = new Map())
  const key = `${conditions.join(',')}\0${specifier}`
  const record = imports.get(key)
  if (record) record.outcomes.add(outcome)
  else imports.set(key, { specifier, conditions: [...conditions], outcomes: new Set([outcome]) })
}

/**
 * Observations for the module graphs rooted at `entryPaths` (JS files the
 * compiler imported), as described in the module comment.
 */
export function observeModuleGraph(entryPaths: Iterable<string>): InputObservation[] {
  const observations: InputObservation[] = []
  const pending = [...entryPaths].map(entryPath => pathToFileURL(observeRealpath(entryPath) ?? entryPath).href)
  const visited = new Set<string>()
  const recordedPackages = new Set<string>()
  // Imports with the same outcome from the same lookup base are described once (every module of an installed package).
  const describedImports = new Set<string>()

  for (let url = pending.pop(); url !== undefined; url = pending.pop()) {
    if (visited.has(url) || !url.startsWith('file:')) continue
    visited.add(url)
    const filePath = fileURLToPath(url)

    let importer: ModuleImporter
    const packageRoot = installedPackageRoot(filePath)
    if (packageRoot) {
      if (!recordedPackages.has(packageRoot)) {
        recordedPackages.add(packageRoot)
        observations.push({ kind: 'content', path: join(packageRoot, 'package.json') })
      }
      // Loaded before observation started: part of the running generator (see the module comment).
      if (!graph?.loaded.has(url)) continue
      importer = { kind: 'installed', path: filePath, packageRoot }
    } else {
      if (!graph?.loaded.has(url)) {
        observations.push({
          kind: 'content',
          path: filePath,
          unverified: graph ? 'module imports not observed' : 'module imports not observable on this Node.js version',
        })
        continue
      }
      const source = graph.loaded.get(url)
      observations.push(source && 'unverified' in source
        ? { kind: 'content', path: filePath, unverified: source.unverified }
        : { kind: 'content', path: filePath, ...(source ? { consumed: { sha256: source.sha256 } } : {}) })
      const scope = packageScope(dirname(filePath))
      observations.push(...scope.observations)
      importer = { kind: 'authored', path: filePath, scopeManifestPath: scope.manifestPath }
    }

    const lookupBase = importer.kind === 'installed' ? importer.packageRoot : importer.path
    for (const record of graph.imports.get(url)?.values() ?? []) {
      if (record.outcomes.size > 1) {
        observations.push({
          kind: 'content',
          path: filePath,
          unverified: `import "${record.specifier}" resolved differently while the process ran`,
        })
      }
      for (const resolvedUrl of record.outcomes) {
        if (resolvedUrl !== null) pending.push(resolvedUrl)
        const resolution: ImportResolution = { specifier: record.specifier, conditions: record.conditions, resolvedUrl }
        const key = JSON.stringify([lookupBase, resolution])
        if (describedImports.has(key)) continue
        describedImports.add(key)
        observations.push(...resolutionObservations(importer, resolution))
      }
    }
  }
  return observations
}

function isAuthoredModuleUrl(url: string): boolean {
  try {
    return installedPackageRoot(fileURLToPath(url)) === undefined
  } catch {
    return false
  }
}

/**
 * The file bytes an authored module was loaded from. The loader reads the
 * file during the load, between `before` and the read `readAfter` makes:
 *   - a source identical to the bytes read before is those bytes;
 *   - otherwise a loader transformed what it read (tsx rewrites `import()`,
 *     a byte order mark may be dropped) or did not expose the source: the
 *     bytes read before, provided the file was the same after the load;
 *   - a file that differs after the load changed while it was loaded.
 */
function loadedModuleSource(source: unknown, before: Buffer | undefined, readAfter: () => Buffer | undefined): LoadedSource {
  if (!before) return { unverified: 'not readable when it was loaded' }
  if (moduleSourceBytes(source)?.equals(before) || readAfter()?.equals(before)) {
    return { sha256: createHash('sha256').update(before).digest('hex') }
  }
  return { unverified: 'changed while it was loaded' }
}

function sameLoadedSource(a: LoadedSource, b: LoadedSource): boolean {
  return 'sha256' in a && 'sha256' in b && a.sha256 === b.sha256
}

function moduleSourceBytes(source: unknown): Buffer | undefined {
  if (typeof source === 'string') return Buffer.from(source, 'utf8')
  if (ArrayBuffer.isView(source)) return Buffer.from(source.buffer, source.byteOffset, source.byteLength)
  if (source instanceof ArrayBuffer) return Buffer.from(source)
  return undefined
}

function readModuleBytes(filePath: string): Buffer | undefined {
  try {
    return readFileSync(filePath)
  } catch {
    return undefined
  }
}

/**
 * The `package.json` lookup Node.js makes for a module in `moduleDir` (its
 * package scope: module format, `imports`, self-references): each candidate up
 * to the nearest existing one, absent candidates included, and that one.
 */
function packageScope(moduleDir: string): { observations: InputObservation[]; manifestPath: string | undefined } {
  const observations: InputObservation[] = []
  for (let directory = moduleDir; basename(directory) !== 'node_modules'; directory = dirname(directory)) {
    const manifestPath = join(directory, 'package.json')
    observations.push({ kind: 'content', path: manifestPath })
    if (observeEntry(manifestPath) === 'file') return { observations, manifestPath }
    if (dirname(directory) === directory) break
  }
  return { observations, manifestPath: undefined }
}
