/**
 * @fileoverview Intent-Unit Module: OpenAPI Governance, DPM Privacy, Traceability & Evidence/Intent Decorator Barrel
 * @intent INTENT-OA-DEC-GOVERNANCE
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-01
 */

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
import {
  $derivedFrom,
  $evidence,
  $evidenceReview,
  $intent,
  extractHeadingFormEvidence,
  readExistingTraceExtension,
} from './evidence-and-intent-decorators.js'
import { reportDiagnostic } from './lib.js'

export {
  $derivedFrom,
  $evidence,
  $evidenceReview,
  $intent,
  DERIVED_FROM_EXTENSION,
  EVIDENCE_EXTENSION,
  extractHeadingFormEvidence,
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
}

export const PERSONA_TRAITS_EXTENSION = 'x-oa-sdk-persona-traits'
export const DPM_PROJECTION_EXTENSION = 'x-oa-sdk-dpm-projection'

const TRACE_ID_STATE_KEY = Symbol.for('@oa-sdk/typespec-decorators/traceIdRegistry')

export type TraceabilityTarget = Model | Operation | Interface | Enum | Union | Scalar | ModelProperty
export type LineageTarget = Model | Operation | Interface | Enum | Union | Scalar

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

  if (role === 'direct_identifier' && transform === 'keep') {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: { message: 'direct_identifier cannot use keep transform (SAF001).' },
    })
    return
  }

  if (role === 'foreign_identifier' && pii === true && !relationship) {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(1) ?? target,
      format: { message: 'pii=true foreign_identifier requires relationship reference (SAF002).' },
    })
    return
  }

  if (pii === true && transform === 'keep') {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: { message: 'pii=true field cannot use keep transform (SAF010).' },
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

export function $replaces(
  context: DecoratorContext,
  target: LineageTarget,
  ...replacedIds: string[]
): void {
  if (replacedIds.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target,
      format: { message: '@replaces requires at least one non-empty target identifier.' },
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

export function $requirement(
  context: DecoratorContext,
  target: TraceabilityTarget,
  ...requirementIds: string[]
): void {
  if (requirementIds.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target,
      format: { message: '@requirement requires at least one non-empty requirement identifier.' },
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
