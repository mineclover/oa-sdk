import { getQuerystringParameter, type OasParameter, type OasRequestBody, type OasSchema } from '@oa-sdk/parser/browser'
import { serializeValidationSchema } from './runtime-schema.js'

export function getRequestBodySchema(requestBody: OasRequestBody | undefined): OasSchema | undefined {
  const media = requestBody?.content?.['application/json']
  if (!media || '$ref' in media) return undefined
  return media.schema
}

export function requestValidationLines(
  operation: {
    parameters: OasParameter[]
    requestBody?: OasRequestBody
  },
  indent = '      ',
  headerValueName = 'headers',
): string[] {
  const pathParams = operation.parameters.filter(parameter => parameter.in === 'path')
  const queryParams = operation.parameters.filter(parameter => parameter.in === 'query')
  const querystringParam = getQuerystringParameter(operation.parameters)
  const headerParams = operation.parameters.filter(parameter => parameter.in === 'header')
  const bodySchema = getRequestBodySchema(operation.requestBody)
  const bodyRequired = operation.requestBody?.required === true
  const queryNeedsValidation = queryParams.some(parameter => parameter.required || parameter.schema)
  const headerNeedsValidation = headerParams.some(parameter => parameter.required || parameter.schema)
  const needsValidation = pathParams.length > 0 || queryNeedsValidation || querystringParam !== undefined || headerNeedsValidation || bodySchema !== undefined || bodyRequired
  if (!needsValidation) return []

  const lines = [indent + 'if (config.validate) {']
  for (const parameter of pathParams) {
    const name = JSON.stringify(parameter.name)
    lines.push(indent + "  if (params[" + name + "] === undefined) throw new Error('Missing required path parameter: " + parameter.name + "')")
    const schema = serializeValidationSchema(parameter.schema)
    if (schema) lines.push(indent + "  __oaAssertValid(params[" + name + "], " + schema + ", 'params." + parameter.name + "', true)")
  }
  for (const parameter of queryParams) {
    const name = JSON.stringify(parameter.name)
    if (parameter.required) lines.push(indent + "  if (query?.[" + name + "] === undefined) throw new Error('Missing required query parameter: " + parameter.name + "')")
    const schema = serializeValidationSchema(parameter.schema)
    if (schema) lines.push(indent + "  if (query?.[" + name + "] !== undefined) __oaAssertValid(query[" + name + "], " + schema + ", 'query." + parameter.name + "', true)")
  }
  if (querystringParam) {
    if (querystringParam.required) lines.push(indent + "  if (querystring === undefined) throw new Error('Missing required querystring parameter')")
    lines.push(indent + "  if (querystring !== undefined && typeof querystring !== 'string') throw new TypeError('Invalid querystring')")
  }
  for (const parameter of headerParams) {
    const name = JSON.stringify(parameter.name)
    if (parameter.required) lines.push(indent + "  if (__getOaRequestHeader(" + headerValueName + ", " + name + ") === undefined) throw new Error('Missing required header parameter: " + parameter.name + "')")
    const schema = serializeValidationSchema(parameter.schema)
    if (schema) lines.push(indent + "  { const value = __getOaRequestHeader(" + headerValueName + ", " + name + "); if (value !== undefined) __oaAssertValid(value, " + schema + ", 'headers." + parameter.name + "', true) }")
  }
  if (bodyRequired) lines.push(indent + "  if (body === undefined) throw new Error('Missing required request body')")
  if (bodySchema) {
    const schema = serializeValidationSchema(bodySchema)
    if (schema) lines.push(indent + "  if (body !== undefined) __oaAssertValid(body, " + schema + ", 'body')")
  }
  lines.push(indent + '}')
  return lines
}
