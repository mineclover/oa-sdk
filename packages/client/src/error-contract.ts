import type { OasResponse, OasSchema } from '@oa-sdk/parser/browser'

export type ErrorValidationEntry = {
  key: string
  schema: OasSchema
}

/** ClientError가 다른 generated bundle/realm에서 만들어져도 식별할 수 있게 합니다. */
export function appendClientErrorGuard(lines: string[]): void {
  lines.push('export function isClientError(error: unknown): error is ClientError {')
  lines.push('  if (error instanceof ClientError) return true')
  lines.push("  if (typeof error !== 'object' || error === null) return false")
  lines.push('  const candidate = error as { name?: unknown; status?: unknown; body?: unknown; response?: unknown }')
  lines.push("  return candidate.name === 'ClientError' && typeof candidate.status === 'number' && 'body' in candidate && 'response' in candidate")
  lines.push('}')
  lines.push('')
}

export function getErrorValidationEntries(responses: Record<string, OasResponse>): ErrorValidationEntry[] {
  const keys = [
    ...Object.keys(responses).filter(key => /^[45]\d{2}$/.test(key)).sort(),
    'default',
  ]
  const entries: ErrorValidationEntry[] = []
  for (const key of keys) {
    const media = responses[key]?.content?.['application/json']
    if (!media || '$ref' in media || !media.schema) continue
    entries.push({ key, schema: media.schema })
  }
  return entries
}
