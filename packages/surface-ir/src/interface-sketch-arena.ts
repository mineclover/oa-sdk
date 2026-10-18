/**
 * @fileoverview Sub-Intent Module: Interface Depth Calculator, 8 Design Red Flags Gate & Arena Candidate Comparator
 * @intent INTENT-OA-SKETCH-ARENA
 * @parentIntent INTENT-OA-SKETCH-IR
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-02
 */

import type {
  DesignRedFlagFinding,
  InterfaceDepthMetrics,
  InterfaceSketchIr,
  SketchArenaCandidateScore,
  SketchArenaComparison,
  SketchInterfaceIr,
  SketchModelIr,
  SketchUnionOrEnumIr,
} from './interface-sketch.js'

export function computeInterfaceDepth(
  models: ReadonlyArray<SketchModelIr>,
  interfaces: ReadonlyArray<SketchInterfaceIr>,
  unionsAndEnums: ReadonlyArray<SketchUnionOrEnumIr>,
): InterfaceDepthMetrics {
  const opCount = interfaces.reduce((acc, i) => acc + i.operations.length, 0)
  const exportedSurfaceCount = Math.max(1, opCount || models.length)

  const fieldCount = models.reduce((acc, m) => acc + m.fields.length, 0)
  const variantCount = unionsAndEnums.reduce((acc, u) => acc + u.variants.length, 0)
  const evidenceCount =
    models.reduce((acc, m) => acc + m.evidence.length, 0) +
    interfaces.reduce(
      (acc, i) => acc + i.evidence.length + i.operations.reduce((oa, o) => oa + o.evidence.length, 0),
      0,
    )

  const hiddenConceptCount = fieldCount + variantCount + evidenceCount + models.length
  const interfaceDepth = Number((hiddenConceptCount / exportedSurfaceCount).toFixed(2))

  return {
    exportedSurfaceCount,
    hiddenConceptCount,
    interfaceDepth,
    isDeep: interfaceDepth >= 2.5,
  }
}

export function evaluateDesignRedFlags(
  models: ReadonlyArray<SketchModelIr>,
  interfaces: ReadonlyArray<SketchInterfaceIr>,
  unionsAndEnums: ReadonlyArray<SketchUnionOrEnumIr>,
  depthMetrics: InterfaceDepthMetrics,
): DesignRedFlagFinding[] {
  const findings: DesignRedFlagFinding[] = []

  // 1. shallow-module
  if (!depthMetrics.isDeep) {
    findings.push({
      ruleId: 'shallow-module',
      severity: 'error',
      symbol: interfaces[0]?.name ?? models[0]?.name ?? 'spec',
      message: `Interface depth ${depthMetrics.interfaceDepth} is below the required >= 2.5 threshold.`,
    })
  }

  // 2. temporal-decomposition (step1/step2/init/finalize raw lifecycle triplets)
  const temporalPrefixes = /^(?:step\d+|phase\d+|pre_|post_|before_|after_)/i
  for (const iface of interfaces) {
    for (const op of iface.operations) {
      if (temporalPrefixes.test(op.name)) {
        findings.push({
          ruleId: 'temporal-decomposition',
          severity: 'error',
          symbol: `${iface.name}.${op.name}`,
          message: `Operation "${op.name}" exposes temporal step ordering instead of an atomic domain intent.`,
        })
      }
      // 3. pass-through-method
      if (/^(?:passthrough|forward|proxy|delegate)_/i.test(op.name)) {
        findings.push({
          ruleId: 'pass-through-method',
          severity: 'error',
          symbol: `${iface.name}.${op.name}`,
          message: `Operation "${op.name}" is a shallow pass-through wrapper.`,
        })
      }
      // 4. importable-internals
      if (op.name.startsWith('_') || /Internal|PrivateHelper/.test(op.returnType)) {
        findings.push({
          ruleId: 'importable-internals',
          severity: 'error',
          symbol: `${iface.name}.${op.name}`,
          message: `Public interface exposes internal helper symbol "${op.name}".`,
        })
      }
    }
  }

  // 5. information-leakage (internal storage/regex/sql implementation details leaked in model fields)
  for (const model of models) {
    for (const field of model.fields) {
      if (/^(?:_internal|raw_sql|sqlite_rowid|regex_pattern|mutex_handle)$/i.test(field.name)) {
        findings.push({
          ruleId: 'information-leakage',
          severity: 'error',
          symbol: `${model.name}.${field.name}`,
          message: `Model field "${field.name}" leaks internal representation details across the boundary.`,
        })
      }
    }
    // 6. split-ownership (derived model using `is` without `@derivedFrom` reason)
    if (model.baseModel && !model.derivedFrom?.reason) {
      findings.push({
        ruleId: 'split-ownership',
        severity: 'warning',
        symbol: model.name,
        message: `Derived model "${model.name} is ${model.baseModel}" should declare @derivedFrom("${model.baseModel}", "reason").`,
      })
    }
  }

  // 7. two-ways-to-do-one-task (duplicate operation signatures with overlapping verbs)
  for (const iface of interfaces) {
    const seenSignatures = new Map<string, string>()
    for (const op of iface.operations) {
      const sigKey = `${op.params.map(p => p.typeName).join(',')}->${op.returnType}`
      const normName = op.name.replace(/^(?:get|fetch|load|read|retrieve)/i, 'READ')
      const key = `${normName}:${sigKey}`
      const prev = seenSignatures.get(key)
      if (prev && prev !== op.name) {
        findings.push({
          ruleId: 'two-ways-to-do-one-task',
          severity: 'error',
          symbol: `${iface.name}.${op.name}`,
          message: `Operations "${prev}" and "${op.name}" provide two parallel ways to perform the same task.`,
        })
      } else {
        seenSignatures.set(key, op.name)
      }
    }
  }

  // 8. hand-synced-list
  for (const u of unionsAndEnums) {
    const unique = new Set(u.variants)
    if (unique.size !== u.variants.length) {
      findings.push({
        ruleId: 'hand-synced-list',
        severity: 'error',
        symbol: u.name,
        message: `Union/Enum "${u.name}" contains duplicate hand-synced variants.`,
      })
    }
  }

  return findings
}

export function scoreSketchCandidatesWithParser(
  candidates: ReadonlyArray<{ name: string; source: string }>,
  parseFn: (source: string, specName?: string) => InterfaceSketchIr,
): SketchArenaComparison {
  const scored: SketchArenaCandidateScore[] = []
  const allSymbols = new Set<string>()

  for (const candidate of candidates) {
    const ir = parseFn(candidate.source, candidate.name)
    for (const sym of ir.graftedSymbols) {
      allSymbols.add(sym)
    }
    const score = Number(
      (ir.depthMetrics.interfaceDepth * 10 - ir.redFlags.length * 15).toFixed(2),
    )
    scored.push({
      name: candidate.name,
      interfaceDepth: ir.depthMetrics.interfaceDepth,
      isDeep: ir.depthMetrics.isDeep,
      redFlagCount: ir.redFlags.length,
      exportedSurfaceCount: ir.depthMetrics.exportedSurfaceCount,
      hiddenConceptCount: ir.depthMetrics.hiddenConceptCount,
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  return {
    candidates: scored,
    recommendedWinner: scored[0]?.name ?? '',
    graftedSymbols: [...allSymbols],
  }
}
