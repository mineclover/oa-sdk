import type { OasParameter } from './oas32-types.js'

/**
 * Resolve the one OAS 3.2 whole-query parameter for an operation.
 *
 * Generation consumers use this guard because they may receive a raw document
 * without a prior lint pass. It prevents an ambiguous document from being
 * silently narrowed by `Array.find()`.
 */
export function getQuerystringParameter(parameters: readonly OasParameter[]): OasParameter | undefined {
  const querystrings = parameters.filter(parameter => parameter.in === 'querystring')
  if (querystrings.length === 0) return undefined
  if (querystrings.length > 1) throw new Error('Invalid OpenAPI querystring parameters: at most one querystring parameter is allowed')
  if (parameters.some(parameter => parameter.in === 'query')) {
    throw new Error('Invalid OpenAPI querystring parameters: query and querystring cannot be used together')
  }

  const parameter = querystrings[0]!
  const content = parameter.content
  if (!content || typeof content !== 'object' || Array.isArray(content) || Object.keys(content).length !== 1) {
    throw new Error('Invalid OpenAPI querystring parameter: exactly one content media type is required')
  }
  if (parameter.schema !== undefined || parameter.style !== undefined || parameter.explode !== undefined || parameter.allowReserved !== undefined) {
    throw new Error('Invalid OpenAPI querystring parameter: schema/style/explode/allowReserved are not supported')
  }
  return parameter
}
