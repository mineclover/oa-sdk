import { BridgeError, type BridgeErrorCode } from '../protocol/errors.js'

/**
 * Anything that checks an untrusted value and returns it typed, or throws.
 * Zod schemas (`parse`), typia assertions and hand-written guards all fit, so the package stays
 * validator-agnostic.
 */
export type Schema<T> = { parse(value: unknown): T }
export type SchemaLike<T> = Schema<T> | ((value: unknown) => T)

export type ValidationIssue = { path: string; message: string }

/** Runs a schema and converts whatever it throws into a `BridgeError` with the given code. */
export function runSchema<T>(schema: SchemaLike<T>, value: unknown, code: BridgeErrorCode, subject: string): T {
  try {
    return typeof schema === 'function' ? schema(value) : schema.parse(value)
  } catch (error) {
    if (error instanceof BridgeError) throw error
    const issues = collectIssues(error)
    throw new BridgeError(code, `${subject} is invalid${issues.length > 0 ? `: ${issues[0]!.message}` : ''}`, {
      data: { issues },
      cause: error,
    })
  }
}

/** Reads the `issues` array that Zod-style errors carry; other errors yield one message issue. */
function collectIssues(error: unknown): ValidationIssue[] {
  const raw = (error as { issues?: unknown })?.issues
  if (Array.isArray(raw)) {
    return raw.map(issue => {
      const entry = issue as { path?: unknown; message?: unknown }
      const path = Array.isArray(entry.path) ? entry.path.map(String).join('.') : ''
      return { path, message: typeof entry.message === 'string' ? entry.message : 'Invalid value' }
    })
  }
  return [{ path: '', message: error instanceof Error ? error.message : 'Invalid value' }]
}
