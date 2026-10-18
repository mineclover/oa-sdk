/**
 * @fileoverview Sub-Intent Module: Unified TypeSpec @evidence, @evidenceReview, @intent, and @derivedFrom Decorators
 * @intent INTENT-OA-DEC-EVIDENCE-INTENT
 * @parentIntent INTENT-OA-DEC-GOVERNANCE
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-01
 */

import type { DecoratorContext } from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import {
  DERIVED_FROM_EXTENSION,
  EVIDENCE_EXTENSION,
  INTENT_EXTENSION,
  TRACE_EXTENSION,
  VALID_DOC_ANCHOR_PATTERN,
  VALID_INTENT_ID_PATTERN,
  VALID_REPLACES_ID_PATTERN,
} from './constants.js'
import type { LineageTarget, TraceabilityTarget } from './governance.js'
import { reportDiagnostic } from './lib.js'

export function readExistingTraceExtension(
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
