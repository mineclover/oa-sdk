/**
 * Validation rules:
 *   v0.1
 *     1. Identity PK uniqueness — within a domain, no two personas share the same
 *        (actor, data, intent, trigger, skill?, consumer?) tuple.
 *     2. Reference vocabulary matching — every regulation/channel value exists in its trait file.
 *        (Identity dimensions with vocabularies — actor, intent, skill — also checked.)
 *     3. maps_to operationId existence — for status: implemented rows, every operationId
 *        must exist in the merged OpenAPI spec.
 *     4. Required field presence — identity.{actor,data,intent,trigger} must be set.
 *     5. Status enum — must be one of registry.statuses.
 *   v0.3
 *     6. registry.constraints enforcement — supported predicates only. Unsupported
 *        predicates are reported as a single skip-warn per constraint.
 *     7. Bidirectional drift detection (optional) — if a bound spec is provided,
 *        x-persona on each operation must match the personas that map to it.
 *   v0.4-prep
 *     8. expects ⊆ operation.responses — every status code listed in
 *        outcome.expects must be declared in the operation's responses block.
 *   v0.9
 *     9. links integrity — every persona link target must reference an existing
 *        persona id (across all domains). depends_on cycles are errors;
 *        self-links are errors; supersedes target should not be 'implemented'.
 */

import type {
  DomainMatrix,
  Persona,
  Registry,
  RegistryConstraint,
  TraitVocabulary,
  ValidationIssue,
  ValidationReport,
} from './types.js'
import type { OperationInfo } from './load.js'
import type { MinimalOpenApiDoc } from './bind.js'
import { detectDrift } from './bind.js'

export interface ValidateOptions {
  registry: Registry
  traits: Map<string, TraitVocabulary>
  domains: DomainMatrix[]
  /** Operations from .merged.yaml — null if spec not loaded (downgrades to warn). */
  knownOperations: Map<string, OperationInfo> | null
  /** Optional bound spec for v0.3 drift detection. */
  boundSpec?: MinimalOpenApiDoc | null
}

export function validate(opts: ValidateOptions): ValidationReport {
  const issues: ValidationIssue[] = []
  let implementedCount = 0
  let proposedCount = 0

  const validStatuses = new Set(opts.registry.statuses.map(s => s.id))
  const traitValueSets = buildTraitValueSets(opts.traits)

  // Track constraints that hit an unsupported predicate so we emit one warn per constraint
  // (not per persona — the predicate gap is a registry-level issue, not a persona issue).
  const unsupportedConstraints = new Map<string, string>()    // constraintId → predicate path

  // Pre-build (id → persona) index for v0.9 link integrity
  const personaById = new Map<string, Persona>()
  for (const m of opts.domains) {
    for (const p of m.personas) personaById.set(p.id, p)
  }

  for (const matrix of opts.domains) {
    const seenIdentityKeys = new Map<string, string>()    // PK string → personaId

    for (const persona of matrix.personas) {
      // ── 4. required identity fields ─────────────────────────────────
      checkRequiredIdentity(persona, matrix.domain, issues)

      // ── 5. status enum ──────────────────────────────────────────────
      if (!validStatuses.has(persona.status)) {
        issues.push({
          severity: 'error',
          domain: matrix.domain,
          personaId: persona.id,
          message: `unknown status '${persona.status}' (allowed: ${[...validStatuses].join(', ')})`,
        })
      } else {
        if (persona.status === 'implemented') implementedCount++
        else if (persona.status === 'proposed') proposedCount++
      }

      // ── 1. identity PK uniqueness ───────────────────────────────────
      const pk = identityKey(persona)
      const previous = seenIdentityKeys.get(pk)
      if (previous !== undefined) {
        issues.push({
          severity: 'error',
          domain: matrix.domain,
          personaId: persona.id,
          bucket: 'identity',
          message: `identity PK collides with persona '${previous}' — same (actor, data, intent, trigger, skill) tuple`,
        })
      } else {
        seenIdentityKeys.set(pk, persona.id)
      }

      // ── 2. vocabulary matching ──────────────────────────────────────
      checkVocabularyMatch(persona, opts.registry, traitValueSets, matrix.domain, issues)

      // ── 3. maps_to operationId existence ────────────────────────────
      checkMapsTo(persona, matrix.domain, opts.knownOperations, issues)

      // ── 8. expects ⊆ operation.responses ────────────────────────────
      checkExpects(persona, matrix.domain, opts.knownOperations, issues)

      // ── 6. constraints ──────────────────────────────────────────────
      for (const constraint of opts.registry.constraints) {
        applyConstraint(persona, matrix.domain, constraint, issues, unsupportedConstraints)
      }

      // ── 9. link integrity (target exists, no self-link, supersedes deprecated) ─
      checkLinks(persona, matrix.domain, personaById, issues)

      // ── 15. v0.11: skills vocabulary 매칭 ───────────────────────────
      checkSkills(persona, matrix.domain, opts.traits, issues)
    }
  }

  // ── 9b. depends_on cycle detection (graph-level) ────────────────────────
  detectDependsOnCycles(personaById, issues)

  // Emit one warn per constraint that hit an unsupported predicate (deduped)
  for (const [id, predicate] of unsupportedConstraints.entries()) {
    issues.push({
      severity: 'warn',
      domain: '(registry)',
      message: `constraint '${id}' skipped — unsupported predicate '${predicate}' (define a trait or remove the constraint)`,
    })
  }

  // ── 7. drift detection (optional) ─────────────────────────────────────
  if (opts.boundSpec) {
    const drifts = detectDrift(opts.boundSpec, opts.domains)
    for (const d of drifts) {
      issues.push({
        severity: 'error',
        domain: '(spec)',
        message: `x-persona drift on operation '${d.operationId}': expected [${d.expected.join(', ')}], got [${d.actual.join(', ')}] — run 'pnpm bind'`,
      })
    }
  }

  return {
    ok: issues.every(i => i.severity !== 'error'),
    domains: opts.domains.map(d => d.domain),
    personaCount: opts.domains.reduce((sum, d) => sum + d.personas.length, 0),
    implementedCount,
    proposedCount,
    issues,
  }
}

// ─── constraint engine ────────────────────────────────────────────────────

/**
 * Predicate paths supported in v0.3:
 *   identity.<dim>      string match
 *   reference.<dim>     contained-in / "any" / list-overlap
 *   outcome.<dim>       depends on cardinality
 *
 * Unsupported predicate → a single skip-warn per constraint per persona.
 * Tracked here is per-persona; future versions can dedupe at the constraint level.
 */
function applyConstraint(
  persona: Persona,
  domain: string,
  constraint: RegistryConstraint,
  issues: ValidationIssue[],
  unsupportedConstraints: Map<string, string>,
): void {
  const whenMatch = evaluateWhen(persona, constraint.when)
  if (whenMatch.unsupported) {
    if (!unsupportedConstraints.has(constraint.id)) {
      unsupportedConstraints.set(constraint.id, whenMatch.unsupported)
    }
    return
  }
  if (!whenMatch.matched) return

  if (constraint.forbid) {
    issues.push({
      severity: constraint.severity,
      domain,
      personaId: persona.id,
      message: `constraint '${constraint.id}' violated — ${constraint.description ?? 'forbidden combination'}`,
    })
    return
  }

  if (constraint.require) {
    for (const [path, expected] of Object.entries(constraint.require)) {
      const actual = readPath(persona, path)
      if (actual.unsupported) {
        if (!unsupportedConstraints.has(constraint.id)) {
          unsupportedConstraints.set(constraint.id, path)
        }
        return
      }
      const want = expected as string[]
      const have = actual.values
      const ok = want.includes('any') ? have.length > 0 : want.some(w => have.includes(w))
      if (!ok) {
        issues.push({
          severity: constraint.severity,
          domain,
          personaId: persona.id,
          message: `constraint '${constraint.id}' violated — ${path} must include ${JSON.stringify(want)} (got ${JSON.stringify(have)})`,
        })
      }
    }
  }
}

interface WhenResult {
  matched: boolean
  unsupported?: string
}

function evaluateWhen(persona: Persona, when: Record<string, unknown>): WhenResult {
  for (const [path, expected] of Object.entries(when)) {
    const actual = readPath(persona, path)
    if (actual.unsupported) return { matched: false, unsupported: path }
    // for identity.<dim> single-value paths, expected is a string
    if (typeof expected === 'string') {
      if (!actual.values.includes(expected)) return { matched: false }
    } else if (Array.isArray(expected)) {
      if (!expected.some(e => actual.values.includes(String(e)))) return { matched: false }
    } else {
      // unknown predicate shape — treat as unsupported
      return { matched: false, unsupported: path }
    }
  }
  return { matched: true }
}

interface PathRead {
  values: string[]
  unsupported?: boolean
}

function readPath(persona: Persona, path: string): PathRead {
  const [bucket, dim] = path.split('.')
  if (!bucket || !dim) return { values: [], unsupported: true }

  if (bucket === 'identity') {
    const v = (persona.identity as unknown as Record<string, string | undefined>)[dim]
    return { values: v ? [v] : [] }
  }
  if (bucket === 'reference') {
    const v = persona.reference?.[dim as keyof NonNullable<Persona['reference']>] as string[] | undefined
    return { values: v ?? [] }
  }
  if (bucket === 'outcome') {
    const v = persona.outcome?.[dim as keyof NonNullable<Persona['outcome']>]
    if (Array.isArray(v)) return { values: v.map(String) }
    if (typeof v === 'string') return { values: [v] }
    if (typeof v === 'number') return { values: [String(v)] }
    return { values: [] }
  }
  return { values: [], unsupported: true }
}

function checkRequiredIdentity(persona: Persona, domain: string, issues: ValidationIssue[]): void {
  const id = persona.identity ?? ({} as Persona['identity'])
  for (const field of ['actor', 'data', 'intent', 'trigger'] as const) {
    if (!id[field]) {
      issues.push({
        severity: 'error',
        domain,
        personaId: persona.id,
        bucket: 'identity',
        dimension: field,
        message: `required identity dimension '${field}' is missing`,
      })
    }
  }
}

function identityKey(p: Persona): string {
  const i = p.identity ?? ({} as Persona['identity'])
  return [i.actor, i.data, i.intent, i.trigger, i.proficiency ?? '', i.consumer ?? ''].join('|')
}

function buildTraitValueSets(traits: Map<string, TraitVocabulary>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [dim, vocab] of traits.entries()) {
    out.set(dim, new Set(vocab.values.map(v => v.id)))
  }
  return out
}

function checkVocabularyMatch(
  persona: Persona,
  registry: Registry,
  traitValueSets: Map<string, Set<string>>,
  domain: string,
  issues: ValidationIssue[],
): void {
  const buckets = registry.buckets

  // identity dimensions with a vocabulary
  for (const [dim, spec] of Object.entries(buckets.identity.dimensions)) {
    if (!spec.vocabulary) continue
    const value = (persona.identity as unknown as Record<string, string | undefined>)[dim]
    if (value === undefined || value === '') continue
    const known = traitValueSets.get(dim)
    if (known && !known.has(value)) {
      issues.push({
        severity: 'error',
        domain,
        personaId: persona.id,
        bucket: 'identity',
        dimension: dim,
        message: `value '${value}' not in vocabulary '${spec.vocabulary}'`,
      })
    }
  }

  // reference dimensions
  for (const [dim, spec] of Object.entries(buckets.reference.dimensions)) {
    if (!spec.vocabulary) continue
    const values = (persona.reference?.[dim as keyof typeof persona.reference] as string[] | undefined) ?? []
    const known = traitValueSets.get(dim)
    if (!known) continue
    for (const v of values) {
      if (!known.has(v)) {
        issues.push({
          severity: 'error',
          domain,
          personaId: persona.id,
          bucket: 'reference',
          dimension: dim,
          message: `value '${v}' not in vocabulary '${spec.vocabulary}'`,
        })
      }
    }
  }

  // outcome dimensions with a vocabulary (shape, access)
  for (const [dim, spec] of Object.entries(buckets.outcome.dimensions)) {
    if (!spec.vocabulary) continue
    const known = traitValueSets.get(dim)
    if (!known) continue
    if (spec.cardinality === 'single') {
      const value = persona.outcome?.[dim as keyof typeof persona.outcome] as string | undefined
      if (value && !known.has(value)) {
        issues.push({
          severity: 'error',
          domain,
          personaId: persona.id,
          bucket: 'outcome',
          dimension: dim,
          message: `value '${value}' not in vocabulary '${spec.vocabulary}'`,
        })
      }
    } else {
      const values = (persona.outcome?.[dim as keyof typeof persona.outcome] as string[] | undefined) ?? []
      for (const v of values) {
        if (!known.has(v)) {
          issues.push({
            severity: 'error',
            domain,
            personaId: persona.id,
            bucket: 'outcome',
            dimension: dim,
            message: `value '${v}' not in vocabulary '${spec.vocabulary}'`,
          })
        }
      }
    }
  }
}

function checkMapsTo(
  persona: Persona,
  domain: string,
  knownOperations: Map<string, OperationInfo> | null,
  issues: ValidationIssue[],
): void {
  const ids = persona.outcome?.maps_to ?? []

  if (persona.status === 'implemented') {
    if (ids.length === 0) {
      issues.push({
        severity: 'error',
        domain,
        personaId: persona.id,
        bucket: 'outcome',
        dimension: 'maps_to',
        message: 'status=implemented requires at least one operationId in maps_to',
      })
      return
    }
    if (knownOperations === null) {
      issues.push({
        severity: 'warn',
        domain,
        personaId: persona.id,
        bucket: 'outcome',
        dimension: 'maps_to',
        message: 'merged spec not found — cannot verify operationId existence',
      })
      return
    }
    for (const id of ids) {
      if (!knownOperations.has(id)) {
        issues.push({
          severity: 'error',
          domain,
          personaId: persona.id,
          bucket: 'outcome',
          dimension: 'maps_to',
          message: `operationId '${id}' not found in merged spec`,
        })
      }
    }
  }
}

function checkExpects(
  persona: Persona,
  domain: string,
  knownOperations: Map<string, OperationInfo> | null,
  issues: ValidationIssue[],
): void {
  const expects = persona.outcome?.expects ?? []

  // Implemented persona without expects = lossy — we cannot bridge to mock-server / e2e.
  if (persona.status === 'implemented' && expects.length === 0) {
    issues.push({
      severity: 'warn',
      domain,
      personaId: persona.id,
      bucket: 'outcome',
      dimension: 'expects',
      message: 'implemented persona has no expects — unable to claim a response status. v0.4 mock-server cannot route this persona.',
    })
    return
  }

  if (expects.length === 0) return                  // proposed/deprecated empty — defer
  if (persona.status !== 'implemented') return      // proposed/deprecated — defer until status flips
  if (knownOperations === null) return              // cannot verify

  const ids = persona.outcome?.maps_to ?? []
  for (const id of ids) {
    const op = knownOperations.get(id)
    if (!op) continue                               // already flagged by checkMapsTo
    for (const code of expects) {
      if (!statusMatches(code, op.responses)) {
        issues.push({
          severity: 'error',
          domain,
          personaId: persona.id,
          bucket: 'outcome',
          dimension: 'expects',
          message: `expected status ${code} not declared in operation '${id}' (declared: ${[...op.responses].sort().join(', ')})`,
        })
      }
    }
  }
}

// ─── v0.11: skill vocabulary matching ─────────────────────────────────────

function checkSkills(
  persona: Persona,
  domain: string,
  traits: Map<string, TraitVocabulary>,
  issues: ValidationIssue[],
): void {
  const skills = persona.skills ?? []
  if (skills.length === 0) return
  const vocab = traits.get('skill')
  if (!vocab) return                              // skill vocab not registered
  const known = new Set(vocab.values.map(v => v.id))
  for (const s of skills) {
    if (!known.has(s)) {
      issues.push({
        severity: 'error',
        domain,
        personaId: persona.id,
        message: `skill '${s}' not in vocabulary 'traits/skill.yaml'`,
      })
    }
  }
}

// ─── v0.9: link integrity ─────────────────────────────────────────────────

function checkLinks(
  persona: Persona,
  domain: string,
  personaById: Map<string, Persona>,
  issues: ValidationIssue[],
): void {
  const links = persona.links ?? []
  if (links.length === 0) return

  for (const link of links) {
    if (link.target === persona.id) {
      issues.push({
        severity: 'error',
        domain,
        personaId: persona.id,
        message: `link targets self (${link.linkType} → ${link.target}) — self-references not allowed`,
      })
      continue
    }
    const target = personaById.get(link.target)
    if (!target) {
      issues.push({
        severity: 'error',
        domain,
        personaId: persona.id,
        message: `link target '${link.target}' (linkType: ${link.linkType}) is not a known persona id`,
      })
      continue
    }
    if (link.linkType === 'supersedes' && target.status === 'implemented') {
      issues.push({
        severity: 'warn',
        domain,
        personaId: persona.id,
        message: `supersedes target '${link.target}' is still 'implemented' — mark it 'deprecated' or remove it`,
      })
    }
  }
}

function detectDependsOnCycles(
  personaById: Map<string, Persona>,
  issues: ValidationIssue[],
): void {
  // Build adjacency: persona id → depends_on targets
  const adj = new Map<string, string[]>()
  for (const [id, p] of personaById.entries()) {
    const targets = (p.links ?? [])
      .filter(l => l.linkType === 'depends_on')
      .map(l => l.target)
      .filter(t => personaById.has(t))           // skip unknown — already errored above
    adj.set(id, targets)
  }

  // 3-state DFS: 0 = unvisited, 1 = on stack, 2 = done
  const state = new Map<string, 0 | 1 | 2>()
  for (const id of adj.keys()) state.set(id, 0)
  const reportedCycles = new Set<string>()        // dedupe — one report per cycle

  for (const start of adj.keys()) {
    if (state.get(start) !== 0) continue
    const stack: string[] = []
    const visit = (node: string): void => {
      state.set(node, 1)
      stack.push(node)
      for (const next of adj.get(node) ?? []) {
        if (state.get(next) === 1) {
          // cycle — extract slice
          const idx = stack.indexOf(next)
          const cycle = stack.slice(idx).concat(next)
          const key = [...cycle].sort().join('|')
          if (!reportedCycles.has(key)) {
            reportedCycles.add(key)
            issues.push({
              severity: 'error',
              domain: '(graph)',
              message: `depends_on cycle: ${cycle.join(' → ')}`,
            })
          }
        } else if (state.get(next) === 0) {
          visit(next)
        }
      }
      stack.pop()
      state.set(node, 2)
    }
    visit(start)
  }
}

/**
 * OpenAPI 3.x status declaration semantics:
 *   - exact code (e.g. "200")
 *   - range (e.g. "2XX" matches 200-299)
 *   - "default" (catch-all — matches anything as a fallback)
 */
export function statusMatches(expected: number, declared: Set<string>): boolean {
  const codeStr = String(expected)
  if (declared.has(codeStr)) return true
  // OpenAPI range: 2XX, 3XX, 4XX, 5XX
  if (expected >= 100 && expected <= 599) {
    const rangeKey = `${Math.floor(expected / 100)}XX`
    if (declared.has(rangeKey)) return true
  }
  if (declared.has('default')) return true
  return false
}
