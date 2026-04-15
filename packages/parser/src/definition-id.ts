export const CANONICAL_DEFINITION_KINDS = [
  'schema',
  'response',
  'parameter',
  'requestBody',
  'header',
  'link',
  'callback',
  'path',
  'operation',
  'server',
  'tag',
  'securityScheme',
] as const

export type DefinitionKind = typeof CANONICAL_DEFINITION_KINDS[number]

export const COMPONENT_LIKE_DEFINITION_KINDS = [
  'schema',
  'response',
  'parameter',
  'requestBody',
  'header',
  'link',
  'callback',
  'securityScheme',
] as const

export type ComponentLikeDefinitionKind = typeof COMPONENT_LIKE_DEFINITION_KINDS[number]

export type CanonicalDefinitionId = `${DefinitionKind}:${string}/${string}/${string}`

export type DefinitionId = {
  id: CanonicalDefinitionId
  kind: DefinitionKind
  scope: string
  domain: string
  name: string
}

export type DefinitionIdDiagnosticCode =
  | 'definition-id/malformed'
  | 'definition-id/unsupported-kind'
  | 'definition-id/invalid-scope'
  | 'definition-id/invalid-domain'
  | 'definition-id/invalid-name'
  | 'definition-id/component-name-pascal-case'
  | 'definition-id/duplicate'

export type DefinitionIdDiagnostic = {
  id: string
  code: DefinitionIdDiagnosticCode
  message: string
  index?: number
  firstIndex?: number
}

export type DefinitionIdValidationResult =
  | { valid: true; id: DefinitionId; diagnostics: [] }
  | { valid: false; diagnostics: DefinitionIdDiagnostic[] }

export type DefinitionIdListValidationResult = {
  valid: boolean
  ids: DefinitionId[]
  diagnostics: DefinitionIdDiagnostic[]
}

const DEFINITION_KIND_SET = new Set<string>(CANONICAL_DEFINITION_KINDS)
const COMPONENT_LIKE_DEFINITION_KIND_SET = new Set<string>(COMPONENT_LIKE_DEFINITION_KINDS)

const CANONICAL_DEFINITION_ID_PATTERN = /^([^:/]+):([^/]+)\/([^/]+)\/([^/]+)$/
const LOWER_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/
const NAME_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/
const PASCAL_CASE_PATTERN = /^[A-Z][A-Za-z0-9]*$/

export function validateDefinitionId(input: string): DefinitionIdValidationResult {
  const match = CANONICAL_DEFINITION_ID_PATTERN.exec(input)
  if (!match) {
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          input,
          'definition-id/malformed',
          `Definition id "${input}" must use kind:scope/domain/name with exactly three path segments.`,
        ),
      ],
    }
  }

  const kind = match[1] ?? ''
  const scope = match[2] ?? ''
  const domain = match[3] ?? ''
  const name = match[4] ?? ''
  const diagnostics: DefinitionIdDiagnostic[] = []

  if (!DEFINITION_KIND_SET.has(kind)) {
    diagnostics.push(diagnostic(
      input,
      'definition-id/unsupported-kind',
      `Unsupported definition kind "${kind}". Supported kinds: ${CANONICAL_DEFINITION_KINDS.join(', ')}.`,
    ))
  }

  if (!LOWER_SEGMENT_PATTERN.test(scope)) {
    diagnostics.push(diagnostic(
      input,
      'definition-id/invalid-scope',
      `Definition id scope "${scope}" must be a lower-case segment such as shared, public, admin, internal, or partner.`,
    ))
  }

  if (!LOWER_SEGMENT_PATTERN.test(domain)) {
    diagnostics.push(diagnostic(
      input,
      'definition-id/invalid-domain',
      `Definition id domain "${domain}" must be a lower-case bounded-context segment such as common, book, notebook, auth, user, or health.`,
    ))
  }

  if (!NAME_SEGMENT_PATTERN.test(name)) {
    diagnostics.push(diagnostic(
      input,
      'definition-id/invalid-name',
      `Definition id name "${name}" must be a single domain-local segment.`,
    ))
  } else if (COMPONENT_LIKE_DEFINITION_KIND_SET.has(kind) && !PASCAL_CASE_PATTERN.test(name)) {
    diagnostics.push(diagnostic(
      input,
      'definition-id/component-name-pascal-case',
      `Component-like definition id name "${name}" should be PascalCase.`,
    ))
  }

  if (diagnostics.length > 0) return { valid: false, diagnostics }

  return {
    valid: true,
    id: {
      id: input as CanonicalDefinitionId,
      kind: kind as DefinitionKind,
      scope,
      domain,
      name,
    },
    diagnostics: [],
  }
}

export function parseDefinitionId(input: string): DefinitionId {
  const result = validateDefinitionId(input)
  if (result.valid) return result.id
  throw new Error(
    `Invalid definition id "${input}": ${result.diagnostics.map(d => d.message).join('; ')}`,
  )
}

export function validateDefinitionIds(inputs: readonly string[]): DefinitionIdListValidationResult {
  const ids: DefinitionId[] = []
  const diagnostics: DefinitionIdDiagnostic[] = []
  const seen = new Map<string, number>()

  inputs.forEach((input, index) => {
    const result = validateDefinitionId(input)
    if (!result.valid) {
      diagnostics.push(...result.diagnostics.map(d => withIndex(d, index)))
      return
    }

    ids.push(result.id)
    const firstIndex = seen.get(result.id.id)
    if (firstIndex !== undefined) {
      diagnostics.push(diagnostic(
        result.id.id,
        'definition-id/duplicate',
        `Duplicate definition id "${result.id.id}" first appeared at index ${firstIndex}.`,
        index,
        firstIndex,
      ))
      return
    }
    seen.set(result.id.id, index)
  })

  return {
    valid: diagnostics.length === 0,
    ids,
    diagnostics,
  }
}

function diagnostic(
  id: string,
  code: DefinitionIdDiagnosticCode,
  message: string,
  index?: number,
  firstIndex?: number,
): DefinitionIdDiagnostic {
  const result: DefinitionIdDiagnostic = { id, code, message }
  if (index !== undefined) result.index = index
  if (firstIndex !== undefined) result.firstIndex = firstIndex
  return result
}

function withIndex(diagnostic: DefinitionIdDiagnostic, index: number): DefinitionIdDiagnostic {
  return { ...diagnostic, index }
}
