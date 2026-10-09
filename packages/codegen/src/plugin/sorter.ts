import {
  type TspPlugin,
  type TspPluginEntry,
  TspPluginCycleError,
  TspPluginDuplicateError,
  TspPluginMissingDependencyError,
} from './types.js'

export interface NormalizedPluginRegistration<TOptions = unknown> {
  plugin: TspPlugin<TOptions>
  options?: TOptions
  stage: number
  declarationIndex: number
}

function getStageValue(plugin: TspPlugin): number {
  if (plugin.enforce === 'pre') return 0
  if (plugin.enforce === 'post') return 2
  return 1
}

/**
 * Traces a cycle in the dependency graph of remaining unsorted plugins using DFS.
 */
function traceDependencyCycle(
  remainingNames: Set<string>,
  depsMap: Map<string, string[]>,
): string[] {
  const visited = new Set<string>()
  const recursionStack: string[] = []
  const inStack = new Set<string>()

  function dfs(node: string): string[] | null {
    visited.add(node)
    recursionStack.push(node)
    inStack.add(node)

    const deps = depsMap.get(node) ?? []
    for (const dep of deps) {
      if (!remainingNames.has(dep)) continue
      if (inStack.has(dep)) {
        const cycleStartIndex = recursionStack.indexOf(dep)
        return [...recursionStack.slice(cycleStartIndex), dep]
      }
      if (!visited.has(dep)) {
        const found = dfs(dep)
        if (found) return found
      }
    }

    recursionStack.pop()
    inStack.delete(node)
    return null
  }

  for (const name of remainingNames) {
    if (!visited.has(name)) {
      const cycle = dfs(name)
      if (cycle) return cycle
    }
  }

  return Array.from(remainingNames)
}

/**
 * Topologically sorts plugin entries according to their declared dependencies
 * and enforcement stages ('pre' | undefined | 'post').
 */
export function sortPluginEntries(
  entries: readonly TspPluginEntry[] | TspPluginEntry[] | undefined,
): NormalizedPluginRegistration[] {
  if (!entries || entries.length === 0) {
    return []
  }

  // 1. Filter out falsy values and normalize into standard registrations
  const normalized: NormalizedPluginRegistration[] = []
  let index = 0

  for (const entry of entries) {
    if (!entry) continue

    let plugin: TspPlugin
    let options: unknown

    if (Array.isArray(entry)) {
      plugin = entry[0]
      options = entry[1]
    } else {
      plugin = entry
      options = undefined
    }

    if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
      continue
    }

    normalized.push({
      plugin,
      options,
      stage: getStageValue(plugin),
      declarationIndex: index++,
    })
  }

  if (normalized.length === 0) {
    return []
  }

  // 2. Duplicate detection
  const pluginMap = new Map<string, NormalizedPluginRegistration>()
  for (const reg of normalized) {
    const name = reg.plugin.name
    if (pluginMap.has(name)) {
      throw new TspPluginDuplicateError(name)
    }
    pluginMap.set(name, reg)
  }

  // 3. Missing dependency & Stage conflict check
  const depsMap = new Map<string, string[]>()
  for (const reg of normalized) {
    const declaredDeps = Array.from(reg.plugin.dependencies ?? [])
    depsMap.set(reg.plugin.name, declaredDeps)

    for (const dep of declaredDeps) {
      const depReg = pluginMap.get(dep)
      if (!depReg) {
        throw new TspPluginMissingDependencyError(reg.plugin.name, dep)
      }

      // Check stage invalidity: pre cannot depend on normal/post; normal cannot depend on post
      if (depReg.stage > reg.stage) {
        throw new TspPluginCycleError([reg.plugin.name, dep, reg.plugin.name])
      }
    }
  }

  // 4. Build Directed Acyclic Graph (DAG) for Kahn's Algorithm
  // If B depends on A, edge is A -> B (A must execute before B)
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const reg of normalized) {
    const name = reg.plugin.name
    inDegree.set(name, (reg.plugin.dependencies ?? []).length)
    dependents.set(name, [])
  }

  for (const reg of normalized) {
    const name = reg.plugin.name
    for (const dep of reg.plugin.dependencies ?? []) {
      dependents.get(dep)!.push(name)
    }
  }

  // 5. Kahn's Algorithm with Stage & Declaration Priority Queue
  // Available nodes: inDegree === 0
  const available: string[] = []
  for (const [name, deg] of inDegree.entries()) {
    if (deg === 0) {
      available.push(name)
    }
  }

  // Comparator: lowest stage first, then earliest declaration index
  const compareNodes = (a: string, b: string): number => {
    const regA = pluginMap.get(a)!
    const regB = pluginMap.get(b)!
    if (regA.stage !== regB.stage) {
      return regA.stage - regB.stage
    }
    return regA.declarationIndex - regB.declarationIndex
  }

  available.sort(compareNodes)

  const sorted: NormalizedPluginRegistration[] = []

  while (available.length > 0) {
    const currentName = available.shift()!
    const currentReg = pluginMap.get(currentName)!
    sorted.push(currentReg)

    const nextDependents = dependents.get(currentName) ?? []
    for (const depName of nextDependents) {
      const currentDeg = inDegree.get(depName)! - 1
      inDegree.set(depName, currentDeg)
      if (currentDeg === 0) {
        available.push(depName)
      }
    }

    available.sort(compareNodes)
  }

  // 6. Cycle verification
  if (sorted.length !== normalized.length) {
    const remainingNames = new Set<string>()
    for (const [name, deg] of inDegree.entries()) {
      if (deg > 0) {
        remainingNames.add(name)
      }
    }

    const cycle = traceDependencyCycle(remainingNames, depsMap)
    throw new TspPluginCycleError(cycle)
  }

  return sorted
}

/**
 * Convenience helper returning topologically sorted TspPlugin array.
 */
export function sortPlugins(
  entries: readonly TspPluginEntry[] | TspPluginEntry[] | undefined,
): TspPlugin[] {
  return sortPluginEntries(entries).map(r => r.plugin)
}
