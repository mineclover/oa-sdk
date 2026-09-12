/**
 * Emits helper functions for serializing and setting response headers.
 */
export function renderResponseHeaderHelpers(): string {
  return [
    `function __setOaResponseHeaders<THeaders extends object>(setHeader: (name: string, value: string) => void, headers: Partial<THeaders>): void {`,
    `  for (const [name, value] of Object.entries(headers)) {`,
    `    const serialized = __serializeOaResponseHeader(value)`,
    `    if (serialized !== undefined) setHeader(name, serialized)`,
    `  }`,
    `}`,
    ``,
    `function __serializeOaResponseHeader(value: unknown): string | undefined {`,
    `  if (value === undefined || value === null) return undefined`,
    `  if (Array.isArray(value)) return value.map(String).join(', ')`,
    `  return String(value)`,
    `}`,
  ].join('\n')
}
