/**
 * S4 — ordered IR passes. Each pass declares the build options it reads (`reads`) and receives
 * only those keys; it must return a new IR and never mutate its input (the runner deep-freezes the
 * input, so a mutation throws).
 */
import type { SchemaGraphAnalysis } from '../../schema-graph/index.js'
import type { PyModuleIR } from '../ir.js'
import type { PydanticSemanticOptions, ResolvedPydanticBuildOptions } from '../options.js'
import { collectImportsPass } from './collect-imports.js'
import { extensionsPass } from './extensions.js'
import { frozenPass } from './frozen.js'
import { docstringsPass } from './docstrings.js'
import { extraPolicyPass } from './extra-policy.js'
import { namingPass } from './naming.js'
import { operationNamingPass } from './operation-naming.js'
import { operationScopePass } from './operation-scope.js'
import { optionalPolicyPass } from './optional-policy.js'
import { polymorphicRefsPass } from './polymorphic-refs.js'
import { regexPass } from './regex.js'
import { scalarPolicyPass } from './scalar-policy.js'

export type PyPassName =
  | 'polymorphicRefs'
  | 'extraPolicy'
  | 'optionalPolicy'
  | 'naming'
  | 'regex'
  | 'scalarPolicy'
  | 'extensions'
  | 'docstrings'
  | 'frozen'
  | 'collectImports'
  | 'operationNaming'
  | 'operationScope'

export interface PyPass<K extends keyof PydanticSemanticOptions> {
  readonly name: PyPassName
  readonly reads: readonly K[]
  run(ir: PyModuleIR, options: Readonly<Pick<PydanticSemanticOptions, K>>, analysis: SchemaGraphAnalysis): PyModuleIR
}

export type AnyPyPass = PyPass<keyof PydanticSemanticOptions>

/** Execution order. */
export const PY_PASSES: readonly AnyPyPass[] = Object.freeze([
  polymorphicRefsPass,
  extraPolicyPass,
  optionalPolicyPass,
  namingPass,
  operationNamingPass,
  operationScopePass,
  regexPass,
  scalarPolicyPass,
  extensionsPass,
  docstringsPass,
  frozenPass,
  collectImportsPass,
])

/** The options object a pass receives: exactly the keys it declares. */
export function pickPassOptions(
  pass: AnyPyPass,
  options: PydanticSemanticOptions,
): Readonly<Partial<PydanticSemanticOptions>> {
  const picked: Partial<Record<keyof PydanticSemanticOptions, unknown>> = {}
  for (const key of pass.reads) picked[key] = options[key]
  return Object.freeze(picked) as Readonly<Partial<PydanticSemanticOptions>>
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

export interface RunPyPassesSettings {
  /** Run only these passes (still in `PY_PASSES` order). */
  only?: readonly PyPassName[] | undefined
  /** Record the IR after every pass. */
  trace?: boolean | undefined
}

export interface RunPyPassesResult {
  ir: PyModuleIR
  trace: Array<{ pass: PyPassName; ir: PyModuleIR }>
}

export function runPyPasses(
  ir: PyModuleIR,
  options: ResolvedPydanticBuildOptions,
  analysis: SchemaGraphAnalysis,
  settings: RunPyPassesSettings = {},
): RunPyPassesResult {
  const trace: RunPyPassesResult['trace'] = []
  const frozenAnalysis = deepFreeze(structuredClone(analysis))
  let current = ir
  for (const pass of PY_PASSES) {
    if (settings.only && !settings.only.includes(pass.name)) continue
    const input = deepFreeze(structuredClone(current))
    const passOptions = pickPassOptions(pass, options) as PydanticSemanticOptions
    current = pass.run(input, passOptions, frozenAnalysis)
    if (settings.trace) trace.push({ pass: pass.name, ir: current })
  }
  return { ir: current, trace }
}
