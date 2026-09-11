import type { DecoratorContext, ModelProperty, Operation } from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import { reportDiagnostic } from './lib.js'

const OPERATION_COMPONENT_REFS_EXTENSION = 'x-oa-sdk-operation-component-refs'
const PERSONA_TRAITS_EXTENSION = 'x-oa-sdk-persona-traits'
const DPM_PROJECTION_EXTENSION = 'x-oa-sdk-dpm-projection'

const STATUS_CODE = /^(?:[1-5][0-9]{2}|default)$/
const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9._-]*$/

export const namespace = 'OaSdkTypeSpec'

// ── Persona Capability Traits (from packages/personas/src/traits/skill.yaml) ──
export const VALID_PERSONA_TRAITS: ReadonlySet<string> = new Set([
  // request-shape (5)
  'pagination',
  'filter-by-role',
  'filter-by-status',
  'full-text-search',
  'batch',
  // response-shape (3)
  'sse-stream',
  'etag-supported',
  'partial-response',
  // lifecycle (3)
  'idempotent',
  'retryable',
  'cacheable',
  // observability (3)
  'audit-emission',
  'metrics-emission',
  'trace-context',
  // security (5)
  'pii-visible-admin',
  'pii-masked-default',
  'pseudonymized',
  'signed-response',
  'mtls',
  // integration (5)
  'webhook-source',
  'webhook-target',
  'oauth-scope-aware',
  'rate-limit-honored',
  'idempotency-key-required',
])

// ── DPM Transforms & Roles (from packages/dpm schema & safety validators) ─────
export const VALID_DPM_TRANSFORMS: ReadonlySet<string> = new Set([
  'keep',
  'redact',
  'mask',
  'null',
  'hash',
  'generalize',
  'relationship_token',
  'polymorphic_relationship_token',
])

export const VALID_DPM_ROLES: ReadonlySet<string> = new Set([
  'direct_identifier',
  'foreign_identifier',
  'business_identifier',
  'business_metric',
  'unstructured_text',
  'code_lookup',
])

type ResponseReference = { statusCode: string; ref: string }
type ComponentReferences = { responses?: ResponseReference[]; parameters?: unknown }

/**
 * Emits the existing v5 operation-component-refs response shape. This is a
 * deliberately narrow helper: callers cannot select an arbitrary extension or
 * supply an arbitrary JSON payload.
 */
export function $oaUseResponseComponent(
  context: DecoratorContext,
  target: Operation,
  statusCode: string,
  componentName: string,
): void {
  if (!STATUS_CODE.test(statusCode) || !COMPONENT_NAME.test(componentName)) {
    reportDiagnostic(context.program, {
      code: 'invalid-response-component-reference',
      target: context.getArgumentTarget(1) ?? target,
      format: { statusCode, componentName },
    })
    return
  }

  const existing = getExtensions(context.program, target)
    .get(OPERATION_COMPONENT_REFS_EXTENSION)
  const references = isComponentReferences(existing) ? existing : {}
  const response = {
    statusCode,
    ref: `#/components/responses/${componentName}`,
  }
  const responses = [...(references.responses ?? [])]
  const duplicate = responses.some(item => item.statusCode === response.statusCode)
  if (!duplicate) responses.push(response)

  setExtension(context.program, target, OPERATION_COMPONENT_REFS_EXTENSION, {
    ...(references.parameters === undefined ? {} : { parameters: references.parameters }),
    responses,
  })
}

function isComponentReferences(value: unknown): value is ComponentReferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.responses !== undefined && !Array.isArray(candidate.responses)) return false
  if (Array.isArray(candidate.responses) && !candidate.responses.every(isResponseReference)) return false
  return true
}

function isResponseReference(value: unknown): value is ResponseReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.statusCode === 'string' && typeof candidate.ref === 'string'
}

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
