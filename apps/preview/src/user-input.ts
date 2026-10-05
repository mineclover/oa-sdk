/**
 * Decoding of the text the user types into the preview: the OpenAPI spec and
 * the custom mock request headers. No DOM access, so it can be tested in Node.
 */
import { parse as parseYaml } from 'yaml'
import type { OasDocument } from '@oa-sdk/parser/browser'

/** Accepts a decoded document only when it declares an OpenAPI version; anything else reads as null. */
export const OpenApiDocumentSchema = {
  parse(value: unknown): OasDocument | null {
    if (typeof value !== 'object' || value === null || !('openapi' in value) || !value.openapi) return null
    // The parser treats the rest of the document as untrusted input during codegen.
    return value as OasDocument
  },
}

/**
 * Reads the spec editor text as YAML, or as JSON when the YAML parser rejects
 * it (for example JSON with duplicate keys). Either way the document must
 * declare `openapi`; otherwise the result is null.
 */
export function parseSpec(input: string): OasDocument | null {
  try {
    return OpenApiDocumentSchema.parse(parseYaml(input))
  } catch {
    try {
      return OpenApiDocumentSchema.parse(JSON.parse(input))
    } catch {
      return null
    }
  }
}

/**
 * Custom mock request headers: a JSON object whose values are strings,
 * numbers, or booleans, stringified as fetch would. The result has no
 * prototype, so a header named `__proto__` stays an ordinary entry.
 */
export const HeaderMapSchema = {
  parse(value: unknown): Record<string, string> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('Headers must be a JSON object of header names to values')
    }
    const headers: Record<string, string> = Object.create(null)
    for (const [name, headerValue] of Object.entries(value)) {
      if (typeof headerValue !== 'string' && typeof headerValue !== 'number' && typeof headerValue !== 'boolean') {
        const found = headerValue === null ? 'null' : Array.isArray(headerValue) ? 'array' : typeof headerValue
        throw new TypeError(`Header "${name}" must be a string, number, or boolean (got ${found})`)
      }
      headers[name] = String(headerValue)
    }
    return headers
  },
}

/**
 * Reads the custom headers text. Blank text means no custom headers; text
 * that is not valid JSON or not a header map throws an error that names the
 * problem, so the caller can report it instead of sending without headers.
 */
export function parseMockHeaders(text: string): Record<string, string> {
  if (text.trim() === '') return Object.create(null)
  try {
    return HeaderMapSchema.parse(JSON.parse(text))
  } catch (error) {
    // JSON.parse reports malformed text as a SyntaxError; HeaderMapSchema reports a TypeError.
    if (error instanceof SyntaxError) throw new SyntaxError(`Headers must be valid JSON: ${error.message}`)
    throw error
  }
}
