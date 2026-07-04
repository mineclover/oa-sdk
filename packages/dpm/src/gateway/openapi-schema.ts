export function ref(schemaName: string) {
  return { $ref: `#/components/schemas/${schemaName}` }
}

export function objectSchema(properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
  }
}

export function requiredObjectSchema(
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) {
  return {
    ...objectSchema(properties),
    required,
  }
}

export function informativeObjectSchema(properties: Record<string, unknown>) {
  return {
    ...objectSchema(properties),
    minProperties: 1,
  }
}

export function arrayOf(items: unknown) {
  return {
    type: 'array',
    items,
  }
}

export function recordOf(additionalProperties: unknown) {
  return {
    type: 'object',
    additionalProperties,
  }
}

export function stringSchema() {
  return { type: 'string', minLength: 1 }
}

export function numberSchema() {
  return { type: 'number' }
}

export function ratioSchema() {
  return { type: 'number', minimum: 0, maximum: 1 }
}

export function integerSchema() {
  return { type: 'integer', minimum: 0 }
}

export function countRecordSchema(keys: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(keys.map(key => [key, integerSchema()])),
  }
}
