/**
 * 문자열 변환 유틸리티
 */

/** snake_case / kebab-case / space → PascalCase */
export function pascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c: string) => c?.toUpperCase() ?? '')
    .replace(/^(.)/, (_, c: string) => c.toUpperCase())
}

/**
 * 외부 입력을 TypeScript 식별자로 정규화합니다.
 *
 * OpenAPI operationId는 임의 문자열일 수 있으므로, 코드 생성에서 직접
 * pascalCase() 결과를 식별자로 사용하면 문법 오류가 날 수 있습니다.
 * 여러 operation 사이의 충돌 해소는 createOperationTypeNameMap()이 맡습니다.
 */
export function toTypeScriptIdentifier(value: string): string {
  const identifier = (value.match(/[A-Za-z0-9$]+/g) ?? [])
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  const nonEmptyIdentifier = identifier || 'Operation'
  return /^[A-Za-z_$]/.test(nonEmptyIdentifier)
    ? nonEmptyIdentifier
    : `Operation${nonEmptyIdentifier}`
}

/**
 * operationId별 충돌 없는 TypeScript 타입 이름을 만듭니다.
 * operationId 정렬을 기준으로 suffix를 부여해 문서 순서가 달라도 안정적입니다.
 */
export function createOperationTypeNameMap(
  operations: ReadonlyArray<{ operationId?: string }>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  const used = new Set<string>()
  const operationIds = [...new Set(operations.flatMap(op => op.operationId ? [op.operationId] : []))]
    .sort((left, right) => left.localeCompare(right))

  for (const operationId of operationIds) {
    const base = toTypeScriptIdentifier(operationId)
    let name = base
    let suffix = 2
    while (used.has(name)) name = `${base}${suffix++}`
    used.add(name)
    names.set(operationId, name)
  }

  return names
}

/** operation type name을 기존 SDK 관례의 lowerCamelCase 메서드 이름으로 변환합니다. */
export function toOperationMethodName(typeName: string): string {
  return typeName.charAt(0).toLowerCase() + typeName.slice(1)
}

/** JS 식별자가 아닌 키 → 따옴표 이스케이프 */
export function escapeKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : quoteTypeScriptString(key)
}

/** TypeScript single-quoted string literal. Control characters remain escaped. */
export function quoteTypeScriptString(value: string): string {
  const escaped = value.replace(/[\\'\u0000-\u001F\u2028\u2029]/g, character => {
    switch (character) {
      case '\\': return '\\\\'
      case "'": return "\\'"
      case '\n': return '\\n'
      case '\r': return '\\r'
      case '\t': return '\\t'
      case '\b': return '\\b'
      case '\f': return '\\f'
      case '\v': return '\\v'
      default: return `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`
    }
  })
  return `'${escaped}'`
}

/** OpenAPI path → Express/Hono/MSW path: /users/{id} → /users/:id */
export function toColonPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1')
}
