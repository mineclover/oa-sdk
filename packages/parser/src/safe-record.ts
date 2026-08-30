/** Build a dictionary that safely retains arbitrary OpenAPI/JSON Schema keys. */
export function createSafeRecord<T = unknown>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

/** Read a string-valued own property without consulting the prototype chain. */
export function getOwnString(record: Record<string, unknown>, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}
