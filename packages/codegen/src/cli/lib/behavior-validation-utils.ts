import type {
  BehaviorRegistryComponents,
  BehaviorRegistryValidationIssue,
} from './behavior-registry.js'

export function issue(
  path: string,
  message: string,
): BehaviorRegistryValidationIssue {
  return { path, message }
}

export function readDecisionSignal(
  components: BehaviorRegistryComponents,
): string | undefined {
  return readString(components.decision, 'primarySignal')
}

export function readString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key]
  return typeof field === 'string' ? field : undefined
}

export function readBoolean(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const field = value?.[key]
  return typeof field === 'boolean' ? field : undefined
}

export function readNullableBoolean(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean | null {
  const field = value?.[key]
  if (field === null || field === undefined) return null
  return typeof field === 'boolean' ? field : null
}

export function readNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const field = value?.[key]
  return typeof field === 'number' ? field : undefined
}

export function readStringArray(
  value: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const field = value?.[key]
  if (!Array.isArray(field) || !field.every(item => typeof item === 'string')) return undefined
  return field
}

export function readNullableNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const field = value?.[key]
  if (field === null || field === undefined) return null
  return typeof field === 'number' ? field : null
}

export function readSidecarPairState(
  components: BehaviorRegistryComponents,
  baseField: string,
  headField: string,
): 'none' | 'partial' | 'complete' {
  const hasBase = readString(components.input, baseField) !== undefined
  const hasHead = readString(components.input, headField) !== undefined
  if (hasBase && hasHead) return 'complete'
  if (hasBase || hasHead) return 'partial'
  return 'none'
}

export function validateSameStringField(
  components: BehaviorRegistryComponents,
  field: string,
): BehaviorRegistryValidationIssue[] {
  return validateCrossStringField(
    components,
    'input',
    field,
    'target',
    field,
    `${field} must match between input and target`,
  )
}

export function validateCrossStringField(
  components: BehaviorRegistryComponents,
  leftComponent: keyof BehaviorRegistryComponents,
  leftField: string,
  rightComponent: keyof BehaviorRegistryComponents,
  rightField: string,
  message: string,
): BehaviorRegistryValidationIssue[] {
  const leftValue = readString(components[leftComponent], leftField)
  const rightValue = readString(components[rightComponent], rightField)
  if (leftValue === undefined || rightValue === undefined || leftValue === rightValue) {
    return []
  }
  return [
    {
      path: `components.${leftComponent}.${leftField}`,
      message,
    },
  ]
}
