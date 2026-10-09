import type { DecoratorContext, ModelProperty, Operation } from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import { reportDiagnostic } from './lib.js'
import {
  VALID_DPM_ROLES,
  VALID_DPM_TRANSFORMS,
  VALID_PERSONA_TRAITS,
  namespace,
} from './constants.js'

export {
  VALID_DPM_ROLES,
  VALID_DPM_TRANSFORMS,
  VALID_PERSONA_TRAITS,
  namespace,
} from './constants.js'

export const PERSONA_TRAITS_EXTENSION = 'x-oa-sdk-persona-traits'
export const DPM_PROJECTION_EXTENSION = 'x-oa-sdk-dpm-projection'

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
