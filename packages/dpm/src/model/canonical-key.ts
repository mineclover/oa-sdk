export type CanonicalKeyValue = string | number | boolean | bigint | Date | null
export type CanonicalKeyValueMap = Record<string, CanonicalKeyValue | undefined>

export type TenantNamespaceInput = {
  columns: string[]
}

export function renderCanonicalKeySegments(input: {
  namespace: string
  separator: string
  tenantColumns?: string[]
  predicate?: string
  columns: string[]
  values: CanonicalKeyValueMap
}): string {
  const segments = [input.namespace]
  for (const column of input.tenantColumns ?? []) {
    segments.push(renderNamedValue(column, requireValue(input.values, column)))
  }
  if (input.predicate) {
    segments.push(`predicate=${encodeCanonicalValue(input.predicate)}`)
  }
  for (const column of input.columns) {
    segments.push(renderNamedValue(column, requireValue(input.values, column)))
  }
  return segments.join(input.separator)
}

function renderNamedValue(name: string, value: CanonicalKeyValue): string {
  return `${name}=${encodeCanonicalValue(value)}`
}

function requireValue(values: CanonicalKeyValueMap, column: string): CanonicalKeyValue {
  const value = values[column]
  if (value === undefined) {
    throw new Error(`canonical key value for ${column} is required`)
  }
  return value
}

function encodeCanonicalValue(value: CanonicalKeyValue): string {
  if (value instanceof Date) return strictEncodeURIComponent(value.toISOString())
  if (value === null) return 'null'
  return strictEncodeURIComponent(String(value))
}

function strictEncodeURIComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}
