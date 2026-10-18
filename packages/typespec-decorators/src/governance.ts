import type {
  DecoratorContext,
  Enum,
  Interface,
  Model,
  ModelProperty,
  Operation,
  Scalar,
  Union,
} from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import { reportDiagnostic } from './lib.js'
import {
  DERIVED_FROM_EXTENSION,
  EVIDENCE_EXTENSION,
  INTENT_EXTENSION,
  TRACE_EXTENSION,
  VALID_DOC_ANCHOR_PATTERN,
  VALID_DPM_ROLES,
  VALID_DPM_TRANSFORMS,
  VALID_INTENT_ID_PATTERN,
  VALID_PERSONA_TRAITS,
  VALID_REPLACES_ID_PATTERN,
  VALID_REQUIREMENT_ID_PATTERN,
  VALID_TRACE_ID_PATTERN,
  namespace,
} from './constants.js'

export {
  DERIVED_FROM_EXTENSION,
  EVIDENCE_EXTENSION,
  INTENT_EXTENSION,
  TRACE_EXTENSION,
  VALID_DOC_ANCHOR_PATTERN,
  VALID_DPM_ROLES,
  VALID_DPM_TRANSFORMS,
  VALID_INTENT_ID_PATTERN,
  VALID_PERSONA_TRAITS,
  VALID_REPLACES_ID_PATTERN,
  VALID_REQUIREMENT_ID_PATTERN,
  VALID_TRACE_ID_PATTERN,
  namespace,
} from './constants.js'

export const PERSONA_TRAITS_EXTENSION = 'x-oa-sdk-persona-traits'
export const DPM_PROJECTION_EXTENSION = 'x-oa-sdk-dpm-projection'

const TRACE_ID_STATE_KEY = Symbol.for('@oa-sdk/typespec-decorators/traceIdRegistry')

export type TraceabilityTarget = Model | Operation | Interface | Enum | Union | Scalar | ModelProperty
export type LineageTarget = Model | Operation | Interface | Enum | Union | Scalar

/**
 * Declares one or more persona capability traits supported by an operation,
 * validated against packages/personas/src/traits/skill.yaml.
 * Merges, sorts, and emits `x-oa-sdk-persona-traits: string[]` under the OpenAPI Operation Object.
 */
export function $personaCapability(
  context: DecoratorContext,
  target: Operation,
  ...traits: string[]
): void {
  let hasInvalid = false
  for (let idx = 0; idx < traits.length; idx++) {
    const trait = traits[idx]
    if (trait === undefined || !VALID_PERSONA_TRAITS.has(trait)) {
      hasInvalid = true
      reportDiagnostic(context.program, {
        code: 'invalid-persona-trait',
        target: context.getArgumentTarget(idx) ?? target,
        format: { trait: trait ?? '' },
      })
    }
  }
  if (hasInvalid) return

  const existing = getExtensions(context.program, target).get(PERSONA_TRAITS_EXTENSION)
  const existingTraits = Array.isArray(existing)
    ? existing.filter((t): t is string => typeof t === 'string')
    : []

  const merged = Array.from(new Set([...existingTraits, ...traits])).sort()
  setExtension(context.program, target, PERSONA_TRAITS_EXTENSION, merged)
}

/**
 * Attaches pseudonymization transform rules and privacy controls to a model property.
 * Enforces DPM safety invariants (SAF001, SAF002, SAF010) and emits
 * `x-oa-sdk-dpm-projection` under the property Schema Object.
 */
export function $pseudonymize(
  context: DecoratorContext,
  target: ModelProperty,
  transform: string,
  role?: string,
  pii?: boolean,
  relationship?: string,
): void {
  if (!VALID_DPM_TRANSFORMS.has(transform)) {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid transform "${transform}". Expected one of: ${[...VALID_DPM_TRANSFORMS].join(', ')}.`,
      },
    })
    return
  }

  if (role !== undefined && !VALID_DPM_ROLES.has(role)) {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(1) ?? target,
      format: {
        message: `Invalid role "${role}". Expected one of: ${[...VALID_DPM_ROLES].join(', ')}.`,
      },
    })
    return
  }

  // SAF001: direct_identifier cannot use keep
  if (role === 'direct_identifier' && transform === 'keep') {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: 'direct_identifier cannot use keep transform (SAF001).',
      },
    })
    return
  }

  // SAF002: foreign_identifier with pii requires relationship
  if (role === 'foreign_identifier' && pii === true && !relationship) {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(1) ?? target,
      format: {
        message: 'pii=true foreign_identifier requires relationship reference (SAF002).',
      },
    })
    return
  }

  // SAF010: pii field cannot use keep
  if (pii === true && transform === 'keep') {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: 'pii=true field cannot use keep transform (SAF010).',
      },
    })
    return
  }

  const payload: Record<string, unknown> = {
    transform,
    ...(role !== undefined ? { role } : {}),
    ...(pii !== undefined ? { pii } : {}),
    ...(relationship !== undefined ? { relationship } : {}),
  }

  setExtension(context.program, target, DPM_PROJECTION_EXTENSION, payload)
}

/**
 * Assigns a stable, immutable tracking identifier to a specification element
 * that survives file moves and symbol renames.
 * Emits `x-oa-sdk-trace.trackingId`.
 */
export function $traceId(
  context: DecoratorContext,
  target: TraceabilityTarget,
  id: string,
): void {
  const normalized = typeof id === 'string' ? id.trim() : ''
  if (!VALID_TRACE_ID_PATTERN.test(normalized)) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid traceId "${id}". Expected 2-128 characters matching ${VALID_TRACE_ID_PATTERN.source}.`,
      },
    })
    return
  }

  const stateMap = context.program.stateMap(TRACE_ID_STATE_KEY)
  const existingOwner = stateMap.get(normalized as never)
  if (existingOwner !== undefined && existingOwner !== target) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Duplicate traceId "${normalized}". Each @traceId within a TypeSpec program must be unique.`,
      },
    })
    return
  }
  stateMap.set(normalized as never, target)

  const existing = readExistingTraceExtension(context, target)
  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existing,
    trackingId: normalized,
  })
}

/**
 * Declares one or more canonical definition IDs or symbol identifiers that this
 * specification element replaces (refactoring / migration lineage).
 * Emits `x-oa-sdk-trace.replaces`.
 */
export function $replaces(
  context: DecoratorContext,
  target: LineageTarget,
  ...replacedIds: string[]
): void {
  if (replacedIds.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target,
      format: {
        message: '@replaces requires at least one non-empty target identifier.',
      },
    })
    return
  }

  const validated: string[] = []
  let hasInvalid = false
  for (let idx = 0; idx < replacedIds.length; idx++) {
    const raw = replacedIds[idx]
    const normalized = typeof raw === 'string' ? raw.trim() : ''
    if (!VALID_REPLACES_ID_PATTERN.test(normalized)) {
      hasInvalid = true
      reportDiagnostic(context.program, {
        code: 'invalid-trace-rule',
        target: context.getArgumentTarget(idx) ?? target,
        format: {
          message: `Invalid replacement identifier "${raw ?? ''}". Expected non-empty canonical ID or symbol identifier matching ${VALID_REPLACES_ID_PATTERN.source}.`,
        },
      })
    } else {
      validated.push(normalized)
    }
  }
  if (hasInvalid) return

  const existing = readExistingTraceExtension(context, target)
  const existingReplaces = Array.isArray(existing.replaces)
    ? existing.replaces.filter((item): item is string => typeof item === 'string')
    : []
  const merged = Array.from(new Set([...existingReplaces, ...validated])).sort()

  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existing,
    replaces: merged,
  })
}

/**
 * Links a specification element to one or more external requirement, compliance,
 * or issue identifiers (e.g. "GDPR-ART-15", "SPEC-USER-001").
 * Emits `x-oa-sdk-trace.requirements`.
 */
export function $requirement(
  context: DecoratorContext,
  target: TraceabilityTarget,
  ...requirementIds: string[]
): void {
  if (requirementIds.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target,
      format: {
        message: '@requirement requires at least one non-empty requirement identifier.',
      },
    })
    return
  }

  const validated: string[] = []
  let hasInvalid = false
  for (let idx = 0; idx < requirementIds.length; idx++) {
    const raw = requirementIds[idx]
    const normalized = typeof raw === 'string' ? raw.trim() : ''
    if (!VALID_REQUIREMENT_ID_PATTERN.test(normalized)) {
      hasInvalid = true
      reportDiagnostic(context.program, {
        code: 'invalid-trace-rule',
        target: context.getArgumentTarget(idx) ?? target,
        format: {
          message: `Invalid requirement identifier "${raw ?? ''}". Expected 2-128 characters matching ${VALID_REQUIREMENT_ID_PATTERN.source}.`,
        },
      })
    } else {
      validated.push(normalized)
    }
  }
  if (hasInvalid) return

  const existing = readExistingTraceExtension(context, target)
  const existingRequirements = Array.isArray(existing.requirements)
    ? existing.requirements.filter((item): item is string => typeof item === 'string')
    : []
  const merged = Array.from(new Set([...existingRequirements, ...validated])).sort()

  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existing,
    requirements: merged,
  })
}

function readExistingTraceExtension(
  context: DecoratorContext,
  target: TraceabilityTarget,
): Record<string, unknown> {
  const existing = getExtensions(context.program, target).get(TRACE_EXTENSION)
  if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    return { ...(existing as Record<string, unknown>) }
  }
  return {}
}

/**
 * Attaches evidence references (string locators like "contracts/common.md#lease",
 * requirement claims like "REQ-01:Verified", or structured record metadata) to a
 * TypeSpec declaration.
 * Emits `x-oa-sdk-evidence` and merges `evidence` into `x-oa-sdk-trace`.
 */
export function $evidence(
  context: DecoratorContext,
  target: TraceabilityTarget,
  ...evidenceArgs: unknown[]
): void {
  if (evidenceArgs.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-evidence-rule',
      target,
      format: {
        message: '@evidence requires at least one non-empty evidence reference or record.',
      },
    })
    return
  }

  const refs: string[] = []
  const records: Record<string, unknown>[] = []
  let hasInvalid = false

  for (let idx = 0; idx < evidenceArgs.length; idx++) {
    const arg = evidenceArgs[idx]
    if (typeof arg === 'string') {
      const trimmed = arg.trim()
      if (!trimmed) {
        hasInvalid = true
        reportDiagnostic(context.program, {
          code: 'invalid-evidence-rule',
          target: context.getArgumentTarget(idx) ?? target,
          format: {
            message: '@evidence string reference cannot be empty.',
          },
        })
      } else {
        refs.push(trimmed)
      }
    } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
      records.push(arg as Record<string, unknown>)
    } else {
      hasInvalid = true
      reportDiagnostic(context.program, {
        code: 'invalid-evidence-rule',
        target: context.getArgumentTarget(idx) ?? target,
        format: {
          message: `Invalid @evidence argument at index ${idx}. Expected non-empty string or object record.`,
        },
      })
    }
  }
  if (hasInvalid) return

  const existingEvidenceRaw = getExtensions(context.program, target).get(EVIDENCE_EXTENSION)
  const existingEvidence =
    typeof existingEvidenceRaw === 'object' && existingEvidenceRaw !== null && !Array.isArray(existingEvidenceRaw)
      ? { ...(existingEvidenceRaw as Record<string, unknown>) }
      : {}

  const prevRefs = Array.isArray(existingEvidence.requirements)
    ? existingEvidence.requirements.filter((item): item is string => typeof item === 'string')
    : []
  const mergedRefs = Array.from(new Set([...prevRefs, ...refs])).sort()

  const mergedPayload: Record<string, unknown> = {
    ...existingEvidence,
    ...(mergedRefs.length > 0 ? { requirements: mergedRefs } : {}),
  }
  for (const rec of records) {
    Object.assign(mergedPayload, rec)
  }

  setExtension(context.program, target, EVIDENCE_EXTENSION, mergedPayload)

  const existingTrace = readExistingTraceExtension(context, target)
  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existingTrace,
    evidence: mergedPayload,
  })
}

/**
 * Binds a detached evidence review document (`evidence/*.md#anchor`) or verification status
 * to a TypeSpec declaration without bloating implementation code comments.
 * Emits `x-oa-sdk-evidence.review`.
 */
export function $evidenceReview(
  context: DecoratorContext,
  target: TraceabilityTarget,
  reviewLocator: string,
  summary?: string,
): void {
  const normalized = typeof reviewLocator === 'string' ? reviewLocator.trim() : ''
  if (!normalized || !VALID_DOC_ANCHOR_PATTERN.test(normalized)) {
    reportDiagnostic(context.program, {
      code: 'invalid-evidence-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid @evidenceReview locator "${reviewLocator}". Expected non-empty path or path#anchor matching ${VALID_DOC_ANCHOR_PATTERN.source}.`,
      },
    })
    return
  }

  const existingEvidenceRaw = getExtensions(context.program, target).get(EVIDENCE_EXTENSION)
  const existingEvidence =
    typeof existingEvidenceRaw === 'object' && existingEvidenceRaw !== null && !Array.isArray(existingEvidenceRaw)
      ? { ...(existingEvidenceRaw as Record<string, unknown>) }
      : {}

  const reviewPayload: Record<string, unknown> = {
    locator: normalized,
    ...(summary !== undefined && summary.trim().length > 0 ? { summary: summary.trim() } : {}),
  }

  const updated = {
    ...existingEvidence,
    review: reviewPayload,
  }
  setExtension(context.program, target, EVIDENCE_EXTENSION, updated)

  const existingTrace = readExistingTraceExtension(context, target)
  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existingTrace,
    evidence: updated,
  })
}

/**
 * Declares the single functional Intent-Unit ID (`@intent`) and optional 1:1 co-decomposed
 * documentation anchor (`@doc` locator) owned by a TypeSpec model, interface, or operation (`IUD-02`).
 * Emits `x-oa-sdk-intent` and merges `intent` into `x-oa-sdk-trace`.
 */
export function $intent(
  context: DecoratorContext,
  target: TraceabilityTarget,
  intentId: string,
  docAnchor?: string,
): void {
  const normalizedId = typeof intentId === 'string' ? intentId.trim() : ''
  if (!VALID_INTENT_ID_PATTERN.test(normalizedId)) {
    reportDiagnostic(context.program, {
      code: 'invalid-intent-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid @intent identifier "${intentId}". Expected 2-128 characters matching ${VALID_INTENT_ID_PATTERN.source}.`,
      },
    })
    return
  }

  let normalizedDoc: string | undefined
  if (docAnchor !== undefined) {
    normalizedDoc = typeof docAnchor === 'string' ? docAnchor.trim() : ''
    if (!normalizedDoc || !VALID_DOC_ANCHOR_PATTERN.test(normalizedDoc)) {
      reportDiagnostic(context.program, {
        code: 'invalid-intent-rule',
        target: context.getArgumentTarget(1) ?? target,
        format: {
          message: `Invalid @intent docAnchor "${docAnchor}". Expected path#anchor matching ${VALID_DOC_ANCHOR_PATTERN.source}.`,
        },
      })
      return
    }
  }

  const payload: Record<string, unknown> = {
    intentId: normalizedId,
    ...(normalizedDoc ? { docAnchor: normalizedDoc } : {}),
  }
  setExtension(context.program, target, INTENT_EXTENSION, payload)

  const existingTrace = readExistingTraceExtension(context, target)
  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existingTrace,
    intent: payload,
  })
}

/**
 * Declares Base A -> Derived B contract lineage (`@derivedFrom("BaseA", "reason")`) when an
 * intent unit derives a specialized contract (`model B is A`) rather than polluting `Layer 1 Base A`
 * with mode flags or intent-specific optional fields (`IUD-05`).
 * Emits `x-oa-sdk-derived-from` and merges `derivedFrom` into `x-oa-sdk-trace`.
 */
export function $derivedFrom(
  context: DecoratorContext,
  target: LineageTarget,
  baseSymbol: string,
  reason: string,
): void {
  const normalizedBase = typeof baseSymbol === 'string' ? baseSymbol.trim() : ''
  const normalizedReason = typeof reason === 'string' ? reason.trim() : ''

  if (!normalizedBase || !VALID_REPLACES_ID_PATTERN.test(normalizedBase)) {
    reportDiagnostic(context.program, {
      code: 'invalid-derived-from-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid @derivedFrom baseSymbol "${baseSymbol}". Expected non-empty model/interface identifier matching ${VALID_REPLACES_ID_PATTERN.source}.`,
      },
    })
    return
  }

  if (!normalizedReason) {
    reportDiagnostic(context.program, {
      code: 'invalid-derived-from-rule',
      target: context.getArgumentTarget(1) ?? target,
      format: {
        message: '@derivedFrom requires a non-empty derivation rationale explaining why Derived B was split from Base A.',
      },
    })
    return
  }

  const payload = {
    baseSymbol: normalizedBase,
    reason: normalizedReason,
  }
  setExtension(context.program, target, DERIVED_FROM_EXTENSION, payload)

  const existingTrace = readExistingTraceExtension(context, target)
  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existingTrace,
    derivedFrom: payload,
  })
}

/**
 * Extracts Heading-Form JSDoc evidence locators (`## @evidence <path#anchor>`)
 * from a raw doc comment block (`IUD-07` unified TypeSpec evidence convention).
 */
export function extractHeadingFormEvidence(docComment: string): string[] {
  if (!docComment) return []
  const results: string[] = []
  const regex = /^\s*(?:\*\s*)?##\s+@evidence\s+([^\s*]+)/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(docComment)) !== null) {
    const locator = match[1]?.trim()
    if (locator && !results.includes(locator)) {
      results.push(locator)
    }
  }
  return results
}

