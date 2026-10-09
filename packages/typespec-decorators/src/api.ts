import type { DecoratorContext, Operation } from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import { reportDiagnostic } from './lib.js'
import { namespace } from './constants.js'

export { namespace }
export const OPERATION_COMPONENT_REFS_EXTENSION = 'x-oa-sdk-operation-component-refs'

const STATUS_CODE = /^(?:[1-5][0-9]{2}|default)$/
const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9._-]*$/

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
