import { toTypeScriptIdentifier } from '@oa-sdk/core/browser'
import { escapeJsonPointerToken, unescapeJsonPointerToken, type OasSchema } from '@oa-sdk/parser/browser'
import { compareTypegenKeys } from './stable-order.js'

const TYPESCRIPT_KEYWORDS = new Set([
  'abstract', 'any', 'as', 'asserts', 'async', 'await', 'bigint', 'boolean',
  'break', 'case', 'catch', 'class', 'const', 'constructor', 'continue',
  'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if',
  'implements', 'import', 'in', 'infer', 'instanceof', 'interface', 'is',
  'keyof', 'let', 'module', 'namespace', 'never', 'new', 'null', 'number',
  'object', 'of', 'package', 'private', 'protected', 'public', 'readonly',
  'return', 'set', 'static', 'string', 'super', 'switch', 'symbol', 'this',
  'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'unique', 'unknown',
  'var', 'void', 'while', 'with', 'yield',
])

export type ComponentTypeNameMap = {
  byComponentName: ReadonlyMap<string, string>
  typeNames: ReadonlySet<string>
  refNameOverrides: Readonly<Record<string, string>>
}

export type LocalNestedSchemaAlias = {
  aliasName: string
  ref: string
  schema: OasSchema
}

export type LocalNestedSchemaAliasMap = {
  aliases: readonly LocalNestedSchemaAlias[]
  refNameOverrides: Readonly<Record<string, string>>
  typeNames: ReadonlySet<string>
}

/**
 * OpenAPI component keys are JSON object keys, not TypeScript identifiers.
 * Allocate stable, valid declaration names and make local $refs use them.
 */
export function createComponentTypeNameMap(componentNames: Iterable<string>): ComponentTypeNameMap {
  const byComponentName = new Map<string, string>()
  const typeNames = new Set<string>()
  const refNameOverrides: Record<string, string> = {}

  for (const componentName of [...componentNames].sort(compareTypegenKeys)) {
    const baseName = isSafeTypeScriptIdentifier(componentName)
      ? componentName
      : toTypeScriptIdentifier(componentName)
    const typeName = uniqueTypeName(baseName, typeNames)
    byComponentName.set(componentName, typeName)
    typeNames.add(typeName)
    const pointerSegment = escapeJsonPointerToken(componentName)
    refNameOverrides[`#/components/schemas/${pointerSegment}`] = typeName
    // RFC 3986 fragment encoding is also accepted by OpenAPI tooling. Keep it
    // as an alias so a space/non-ASCII component key resolves identically.
    refNameOverrides[`#/components/schemas/${encodeURIComponent(pointerSegment)}`] = typeName
  }

  return { byComponentName, typeNames, refNameOverrides }
}

/**
 * Allocate declarations for reachable local schema pointers below a component
 * root. schemaToTs cannot safely turn `#/components/schemas/A/properties/b`
 * into its last path segment because no declaration named `B` necessarily
 * exists.  Keep a stable alias for the resolved nested schema instead.
 */
export function createLocalNestedSchemaAliasMap(
  schemas: Record<string, OasSchema>,
  roots: Iterable<unknown>,
  componentTypeNames: ComponentTypeNameMap,
  reservedNames: Iterable<string> = [],
): LocalNestedSchemaAliasMap {
  const refs = new Set<string>()
  for (const root of roots) collectNestedComponentRefs(root, refs)

  const usedNames = new Set([...componentTypeNames.typeNames, ...reservedNames])
  const aliases: LocalNestedSchemaAlias[] = []
  const refNameOverrides: Record<string, string> = {}

  for (const ref of [...refs].sort(compareTypegenKeys)) {
    const resolved = resolveNestedComponentSchema(schemas, ref)
    if (!resolved) continue

    const aliasName = uniqueTypeName(nestedAliasBase(ref, componentTypeNames), usedNames)
    usedNames.add(aliasName)
    aliases.push({ aliasName, ref, schema: resolved })
    refNameOverrides[ref] = aliasName
  }

  return {
    aliases,
    refNameOverrides,
    typeNames: new Set([...componentTypeNames.typeNames, ...aliases.map(alias => alias.aliasName)]),
  }
}

/** Return a syntax-safe fallback for a $ref that has no explicit mapping. */
export function typeNameFromRef(ref: string): string {
  const rawName = ref.split('/').at(-1)
  if (!rawName) return 'unknown'
  return toTypeScriptIdentifier(unescapeJsonPointerToken(decodeUriSegment(rawName)))
}

function isSafeTypeScriptIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !TYPESCRIPT_KEYWORDS.has(value)
}

function uniqueTypeName(baseName: string, usedNames: ReadonlySet<string>): string {
  if (!usedNames.has(baseName)) return baseName
  let suffix = 2
  while (usedNames.has(`${baseName}${suffix}`)) suffix++
  return `${baseName}${suffix}`
}

function collectNestedComponentRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNestedComponentRefs(item, refs)
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  if (typeof record.$ref === 'string' && isNestedComponentRef(record.$ref)) refs.add(record.$ref)
  for (const child of Object.values(record)) collectNestedComponentRefs(child, refs)
}

function resolveNestedComponentSchema(
  schemas: Record<string, OasSchema>,
  ref: string,
): OasSchema | undefined {
  const segments = localPointerSegments(ref)
  if (segments.length < 4 || segments[0] !== 'components' || segments[1] !== 'schemas') return undefined

  let current: unknown = schemas[segments[2]!]
  for (const segment of segments.slice(3)) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current && typeof current === 'object' && !Array.isArray(current)
    ? current as OasSchema
    : undefined
}

function isNestedComponentRef(ref: string): boolean {
  const segments = localPointerSegments(ref)
  return segments.length > 3 && segments[0] === 'components' && segments[1] === 'schemas'
}

function nestedAliasBase(ref: string, componentTypeNames: ComponentTypeNameMap): string {
  const segments = localPointerSegments(ref)
  const componentName = segments[2] ?? 'Schema'
  const rootName = componentTypeNames.byComponentName.get(componentName)
    ?? toTypeScriptIdentifier(componentName)
  const suffix = segments.slice(3).map(toTypeScriptIdentifier).join('') || 'Nested'
  return `${rootName}${suffix}`
}

function localPointerSegments(ref: string): string[] {
  if (!ref.startsWith('#/')) return []
  return ref.slice(2).split('/').map(segment => unescapeJsonPointerToken(decodeUriSegment(segment)))
}

function decodeUriSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
