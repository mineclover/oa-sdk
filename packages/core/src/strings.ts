/**
 * 문자열 변환 유틸리티
 */

/** snake_case / kebab-case / space → PascalCase */
export function pascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c: string) => c?.toUpperCase() ?? '')
    .replace(/^(.)/, (_, c: string) => c.toUpperCase())
}

/** JS 식별자가 아닌 키 → 따옴표 이스케이프 */
export function escapeKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** OpenAPI path → Express/Hono/MSW path: /users/{id} → /users/:id */
export function toColonPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1')
}
