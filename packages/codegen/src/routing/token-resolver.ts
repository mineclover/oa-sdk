import type { ArtifactKind } from '../config.js'

/**
 * Supported casing styles for token substitution.
 */
export type CasingStyle = 'kebab' | 'camel' | 'pascal' | 'preserve'

/**
 * Contextual metadata supplied for token substitution.
 */
export interface TokenContext {
  /** Primary OpenAPI tag or domain entity name */
  tag?: string | undefined
  /** Generated artifact kind */
  kind: ArtifactKind
  /** Unique OpenAPI operation ID */
  operationId?: string | undefined
  /** HTTP method verb (GET, POST, etc.) */
  method?: string | undefined
  /** Domain group or top-level URL path segment */
  group?: string | undefined
  /** Full URL path (e.g. "/api/v1/users/{id}") */
  path?: string | undefined
  /** Target profile or bundle ID */
  profile?: string | undefined
}

/**
 * Options for token pattern resolution.
 */
export interface ResolveTokenOptions {
  /** Casing transformation style (defaults to "kebab") */
  casing?: CasingStyle | undefined
}

/**
 * Splits a string into constituent words based on camelCase, PascalCase,
 * snake_case, kebab-case, dots, and whitespace boundaries.
 */
export function splitWords(str: string): string[] {
  if (!str) return []
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Converts a string into kebab-case (e.g. "UserManagement" -> "user-management").
 */
export function toKebabCase(str: string): string {
  const words = splitWords(str)
  if (words.length === 0) return ''
  return words.map((w) => w.toLowerCase()).join('-')
}

/**
 * Converts a string into camelCase (e.g. "user-profile" -> "userProfile").
 */
export function toCamelCase(str: string): string {
  const words = splitWords(str)
  if (words.length === 0) return ''
  return words
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('')
}

/**
 * Converts a string into PascalCase (e.g. "user-profile" -> "UserProfile").
 */
export function toPascalCase(str: string): string {
  const words = splitWords(str)
  if (words.length === 0) return ''
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
}

/**
 * Preserves the original string casing while sanitizing characters invalid in filesystem paths.
 */
export function sanitizePathPreserve(str: string): string {
  return str.replace(/[:*?"<>|\0]+/g, '-').trim()
}

/**
 * Casing transformer map.
 */
export const casingTransformers: Record<CasingStyle, (str: string) => string> = {
  kebab: toKebabCase,
  camel: toCamelCase,
  pascal: toPascalCase,
  preserve: sanitizePathPreserve,
}

/**
 * Extracts the primary domain group from a URL path.
 * Returns the first non-empty segment (stripping curly braces for path parameters).
 * E.g. "/users/{id}" -> "users", "/healthz" -> "healthz", "/" -> "default"
 */
export function extractGroupFromPath(urlPath?: string): string {
  if (!urlPath) return 'default'
  const segments = urlPath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return 'default'
  const first = segments[0]!.replace(/^\{|\}$/g, '')
  return first || 'default'
}

/**
 * Resolves a template path pattern by substituting tokens ({tag}, {kind}, {operationId}, {method}, {group})
 * and applying casing transformations.
 *
 * Supported tokens:
 * - `{tag}`: Primary tag with fallback hierarchy: tag -> group -> path 1st segment -> "default"
 * - `{kind}`: Artifact kind (contract, client, queries, keys, guards, schemas)
 * - `{operationId}`: Operation ID with fallback hierarchy: operationId -> `${method}_${group}` -> "operation"
 * - `{method}`: Lowercase HTTP verb (get, post, etc.)
 * - `{group}`: URL path 1st segment with fallback hierarchy: group -> path 1st segment -> tag -> "common"
 */
export function resolvePathPattern(
  template: string,
  context: TokenContext,
  options: ResolveTokenOptions = {},
): string {
  const casing = options.casing ?? 'kebab'
  const transform = casingTransformers[casing] ?? toKebabCase

  // Determine raw token values with resilient fallback hierarchies
  const rawPathGroup = context.path ? extractGroupFromPath(context.path) : undefined

  const rawTag =
    context.tag && context.tag.trim().length > 0
      ? context.tag.trim()
      : context.group && context.group.trim().length > 0
        ? context.group.trim()
        : rawPathGroup && rawPathGroup !== 'default'
          ? rawPathGroup
          : 'default'

  const rawGroup =
    context.group && context.group.trim().length > 0
      ? context.group.trim()
      : rawPathGroup && rawPathGroup !== 'default'
        ? rawPathGroup
        : context.tag && context.tag.trim().length > 0
          ? context.tag.trim()
          : 'common'

  const rawMethod = (context.method ?? 'get').toLowerCase()

  const rawOperationId =
    context.operationId && context.operationId.trim().length > 0
      ? context.operationId.trim()
      : `${rawMethod}_${rawGroup}`

  // Apply casing transformation
  const tagValue = transform(rawTag)
  const kindValue = context.kind
  const opValue = transform(rawOperationId)
  const methodValue = rawMethod
  const groupValue = transform(rawGroup)

  let resolved = template
    .replace(/\{tag\}/g, tagValue)
    .replace(/\{kind\}/g, kindValue)
    .replace(/\{operationId\}/g, opValue)
    .replace(/\{method\}/g, methodValue)
    .replace(/\{group\}/g, groupValue)

  // Normalize path separators to POSIX forward slash and deduplicate consecutive slashes
  resolved = resolved.replace(/\\/g, '/').replace(/\/+/g, '/')

  return resolved
}
