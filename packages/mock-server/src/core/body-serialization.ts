import type { OasSchema } from '@oa-sdk/parser'
import { isXmlMediaType, serializeXmlBody } from './xml.js'

export function serializeResponseBody(contentType: string, body: unknown, schema?: OasSchema): string {
  if (isXmlMediaType(contentType)) return serializeXmlBody(body, schema)
  if (contentType.includes('application/json') || typeof body !== 'string') return JSON.stringify(body) ?? ''
  return body
}
