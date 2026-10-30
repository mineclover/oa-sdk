/**
 * Source-level impact planning for incremental generation.
 *
 * This module only plans the regeneration scope. Generators still own parsing,
 * validation, atomic writes, and full-rebuild fallback. Keeping the planner
 * pure makes it safe to introduce before wiring it into CLI commands.
 */

export type ImpactScopeReason =
  | 'source-change'
  | 'ref-change'
  | 'config-change'
  | 'cache-miss'
  | 'fallback'

export type GenerationUnit = {
  readonly unitId: string
  /** Files and source pointers that directly feed this unit. */
  readonly sourceFiles: readonly string[]
  /** Files emitted together; overlapping ownership is rejected. */
  readonly outputFiles: readonly string[]
  /** Units consumed by this unit. Dirty dependencies propagate to dependents. */
  readonly dependencyUnitIds?: readonly string[] | undefined
}

export type ImpactScopePlan = {
  readonly reason: ImpactScopeReason
  readonly changedFiles: readonly string[]
  readonly dirtyUnitIds: readonly string[]
  readonly dirtyUnits: readonly GenerationUnit[]
  readonly preservedUnitIds: readonly string[]
  readonly preservedFiles: readonly string[]
}

export type ImpactScopeOptions = {
  readonly reason?: ImpactScopeReason | undefined
  /** Regenerate every unit when cache/index evidence is not trustworthy. */
  readonly forceFull?: boolean | undefined
}

/**
 * Compute a deterministic regeneration plan from dirty files and unit edges.
 *
 * `dependencyUnitIds` points from a consumer to the units it reads. The
 * planner walks the reverse relation so a changed leaf or shared component
 * invalidates every consumer transitively.
 */
export function planImpactScope(
  units: readonly GenerationUnit[],
  changedFiles: readonly string[],
  options: ImpactScopeOptions = {},
): ImpactScopePlan {
  const byId = new Map<string, GenerationUnit>()
  const outputOwners = new Map<string, string>()

  for (const unit of units) {
    if (!unit.unitId) throw new Error('Generation unit id must not be empty')
    if (byId.has(unit.unitId)) throw new Error(`Duplicate generation unit: ${unit.unitId}`)
    byId.set(unit.unitId, normalizeUnit(unit))
    for (const outputFile of unit.outputFiles) {
      const owner = outputOwners.get(outputFile)
      if (owner && owner !== unit.unitId) {
        throw new Error(`Generation output "${outputFile}" has multiple owners: ${owner}, ${unit.unitId}`)
      }
      outputOwners.set(outputFile, unit.unitId)
    }
  }

  for (const unit of units) {
    for (const dependencyId of unit.dependencyUnitIds ?? []) {
      if (!byId.has(dependencyId)) {
        throw new Error(`Generation unit "${unit.unitId}" references missing dependency "${dependencyId}"`)
      }
    }
  }

  const normalizedChangedFiles = sortedUnique(changedFiles)
  const dirty = new Set<string>()
  if (options.forceFull) {
    for (const unit of units) dirty.add(unit.unitId)
  } else {
    for (const unit of units) {
      if (unit.sourceFiles.some(file => normalizedChangedFiles.includes(file))) dirty.add(unit.unitId)
    }
  }

  // A unit is dirty when one of its dependencies is dirty. Repeat until the
  // reverse dependency closure is stable; cycles are handled deterministically.
  let changed = true
  while (changed) {
    changed = false
    for (const unit of units) {
      if (dirty.has(unit.unitId)) continue
      if ((unit.dependencyUnitIds ?? []).some(dependencyId => dirty.has(dependencyId))) {
        dirty.add(unit.unitId)
        changed = true
      }
    }
  }

  const dirtyUnitIds = [...dirty].sort(compareStrings)
  const dirtyUnits = dirtyUnitIds.map(unitId => byId.get(unitId)!)
  const preservedUnitIds = units
    .map(unit => unit.unitId)
    .filter(unitId => !dirty.has(unitId))
    .sort(compareStrings)
  const preservedFiles = preservedUnitIds
    .flatMap(unitId => byId.get(unitId)!.outputFiles)
    .sort(compareStrings)

  return {
    reason: options.reason ?? (options.forceFull ? 'fallback' : 'source-change'),
    changedFiles: normalizedChangedFiles,
    dirtyUnitIds,
    dirtyUnits,
    preservedUnitIds,
    preservedFiles,
  }
}

function normalizeUnit(unit: GenerationUnit): GenerationUnit {
  return {
    unitId: unit.unitId,
    sourceFiles: sortedUnique(unit.sourceFiles),
    outputFiles: sortedUnique(unit.outputFiles),
    ...(unit.dependencyUnitIds && unit.dependencyUnitIds.length > 0
      ? { dependencyUnitIds: sortedUnique(unit.dependencyUnitIds) }
      : {}),
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
