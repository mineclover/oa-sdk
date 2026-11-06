/**
 * Language-neutral analysis of `components.schemas`, shared by the Zod and Pydantic generators.
 */
import {
  escapeJsonPointerToken,
  lintDocument,
  parseDocument,
  type LintCategory,
  type LintResult,
  type LintSeverity,
  type OasDocument,
  type OasSchema,
} from '@oa-sdk/parser'
import {
  normalizeOpenApiDocument,
  type OpenApiCollectProfile,
} from '../cli/lib/openapi-collect.js'
import {
  extractRefsFromNode,
  findCircularSchemas,
  findObjectCycles,
  parseRefTarget,
} from './verbatim.js'

export {
  extractRefsFromNode,
  findCircularSchemas,
  parseRefTarget,
} from './verbatim.js'

const SEVERITY_RANK: Record<LintSeverity, number> = {
  info: 1,
  warning: 2,
  error: 3,
}

type ObjectRecord = Record<string, unknown>

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function makeDiagnostic(
  path: string,
  severity: LintSeverity,
  rule: string,
  message: string,
  options: CodegenPreflightOptions,
): LintResult {
  const result: LintResult = { path, severity, rule, message }
  if (options.basePath !== undefined) {
    const location = options.lookupSourceLocation?.(options.basePath, path)
    result.source = {
      filePath: options.basePath,
      pointer: path,
      sourceFilePath: options.basePath,
      sourcePointer: path,
      ...(location === undefined ? {} : { line: location.line, column: location.column }),
    }
  }
  return result
}

/** Preflight settings shared by every schema code generator. */
export interface CodegenPreflightOptions {
  validate?: boolean | undefined
  lintCategories?: LintCategory[] | undefined
  failOnSeverity?: LintSeverity | undefined
  normalize?: boolean | undefined
  normalizeProfile?: OpenApiCollectProfile | undefined
  rules?: Record<string, 'off' | 'warn' | 'error'> | undefined
  basePath?: string | undefined
  lookupSourceLocation?: (
    (filePath: string, pointer: string) => { line: number; column: number } | undefined
  ) | undefined
}

export interface PreparedCodegenDocument {
  /** Pruned and (unless disabled) normalized document. */
  document: OasDocument
  /** `parseDocument(document).schemas`, or `{}` when the document has none. */
  schemas: Record<string, OasSchema>
  /** Every preflight finding, in the order `generateZodFromSpec` produced them. */
  diagnostics: LintResult[]
  /** The subset of `diagnostics` at or above `failOnSeverity` (default `error`). */
  fatal: LintResult[]
}

function cloneAndPruneCycles(doc: unknown, cycles: ReturnType<typeof findObjectCycles>): unknown {
  if (cycles.length === 0) return doc
  try {
    const cloned = structuredClone(doc)
    const clonedCycles = findObjectCycles(cloned)
    for (const cycle of clonedCycles) {
      if (cycle.parent === undefined || cycle.keyOrIndex === undefined) continue
      const replacement = cycle.targetPointer.startsWith('/components/schemas/')
        ? { $ref: `#${cycle.targetPointer}` }
        : { description: 'Circular reference pruned' }
      if (Array.isArray(cycle.parent)) {
        cycle.parent[cycle.keyOrIndex as number] = replacement
      } else {
        cycle.parent[cycle.keyOrIndex as string] = replacement
      }
    }
    return cloned
  } catch {
    return doc
  }
}

function validateComponentShape(
  document: unknown,
  options: CodegenPreflightOptions,
): LintResult[] {
  if (!isObjectRecord(document)) return []
  const components = document.components
  if (components === undefined) return []
  if (!isObjectRecord(components)) {
    return [makeDiagnostic(
      '/components',
      'error',
      'structure/components-object',
      'components는 객체여야 합니다',
      options,
    )]
  }
  const schemas = components.schemas
  if (schemas === undefined) return []
  if (!isObjectRecord(schemas)) {
    return [makeDiagnostic(
      '/components/schemas',
      'error',
      'structure/schemas-object',
      'components.schemas는 객체여야 합니다',
      options,
    )]
  }
  const findings: LintResult[] = []
  for (const [name, schema] of Object.entries(schemas)) {
    const valid = typeof schema === 'boolean' || isObjectRecord(schema)
    if (!valid) {
      findings.push(makeDiagnostic(
        `/components/schemas/${escapeJsonPointerToken(name)}`,
        'error',
        'structure/schema-object',
        `Schema '${name}'는 객체 또는 boolean이어야 합니다`,
        options,
      ))
    }
  }
  return findings
}

export function prepareCodegenDocument(doc: unknown, options?: CodegenPreflightOptions): PreparedCodegenDocument {
  const resolved = options ?? {}
  const rawCycles = doc !== null && typeof doc === 'object' ? findObjectCycles(doc) : []
  const pruned = cloneAndPruneCycles(doc, rawCycles)
  let target = pruned as OasDocument
  if (resolved.normalize !== false && isObjectRecord(pruned)) {
    try {
      target = normalizeOpenApiDocument(pruned, {
        profile: resolved.normalizeProfile ?? 'generic',
      }) as OasDocument
    } catch {
      target = pruned as OasDocument
    }
  }

  const diagnostics: LintResult[] = []
  if (resolved.validate !== false) {
    for (const cycle of rawCycles) {
      diagnostics.push(makeDiagnostic(
        cycle.pointer,
        'error',
        'structure/circular-anchor',
        `순환 객체 참조(YAML anchor cycle)가 감지되었습니다: ${cycle.pointer} -> `
        + `${cycle.targetPointer}. OpenAPI 스키마 재귀는 $ref 포인터를 사용해야 합니다`,
        resolved,
      ))
    }
    diagnostics.push(...lintDocument(target, {
      categories: resolved.lintCategories ?? ['structure', 'refs', 'components'],
      ...(resolved.basePath === undefined ? {} : { basePath: resolved.basePath }),
      ...(resolved.lookupSourceLocation === undefined ? {} : { lookupSourceLocation: resolved.lookupSourceLocation }),
      rules: { 'refs/cycle': 'warn', ...resolved.rules },
    }))
    const categories = resolved.lintCategories ?? ['structure', 'refs', 'components']
    if (categories.includes('components') || categories.includes('structure')) {
      diagnostics.push(...validateComponentShape(target, resolved))
    }
  }

  const safeTarget = isObjectRecord(target)
    ? target as OasDocument
    : ({
      openapi: '3.2.0',
      info: { title: '', version: '' },
      paths: {},
      components: {},
    } as OasDocument)
  const parsed = parseDocument(safeTarget, [])
  const schemas = isObjectRecord(parsed.schemas) ? parsed.schemas as Record<string, OasSchema> : {}
  const threshold = resolved.failOnSeverity ?? 'error'
  const fatal = diagnostics.filter(diagnostic => (
    SEVERITY_RANK[diagnostic.severity] ?? 3
  ) >= (SEVERITY_RANK[threshold] ?? 3))
  return { document: safeTarget, schemas, diagnostics, fatal }
}

export interface DiscriminatorFamily {
  /** Component name that declares `discriminator`. */
  base: string
  propertyName: string
  /** Mapping entries and inferred variants, sorted by tag. */
  variants: Array<{ tag: string; schema: string }>
}

export interface SchemaGraphAnalysis {
  /** Component → components it references (sorted, deduplicated, only names present in the input). */
  edges: Record<string, string[]>
  /** Components on a reference cycle, including self references (sorted). Same set as `findCircularSchemas`. */
  recursive: string[]
  /** Declaration order with dependencies first, except cycle edges. */
  order: string[]
  /** Sorted by `base`. */
  discriminatorFamilies: DiscriminatorFamily[]
}

function schemaRecord(schema: unknown): ObjectRecord {
  return isObjectRecord(schema) ? schema : {}
}

function discriminatorVariants(
  base: string,
  schemas: Record<string, OasSchema>,
  propertyName: string,
  mapping: unknown,
  names: Set<string>,
): Array<{ tag: string; schema: string }> {
  const variants = new Map<string, string>()
  if (isObjectRecord(mapping)) {
    for (const [tag, value] of Object.entries(mapping)) {
      const target = parseRefTarget(value)
      if (target !== null && names.has(target)) variants.set(tag, target)
    }
  }
  for (const [name, rawSchema] of Object.entries(schemas)) {
    if (name === base) continue
    const schema = schemaRecord(rawSchema)
    const allOf = schema.allOf
    if (!Array.isArray(allOf)) continue
    const inherits = allOf.some(branch => parseRefTarget(schemaRecord(branch).$ref) === base)
    if (!inherits || [...variants.values()].includes(name)) continue
    const properties = schemaRecord(schema.properties)
    const property = schemaRecord(properties[propertyName])
    const values = Array.isArray(property.enum) && property.enum.length === 1
      ? property.enum
      : property.const === undefined ? [] : [property.const]
    if (values.length === 1) variants.set(String(values[0]), name)
  }
  return [...variants.entries()]
    .map(([tag, schema]) => ({ tag, schema }))
    .sort((left, right) => left.tag.localeCompare(right.tag))
}

export function analyzeSchemaGraph(
  schemas: Record<string, OasSchema>,
  cache?: WeakMap<object, Set<string>>,
): SchemaGraphAnalysis {
  const names = Object.keys(schemas).sort((left, right) => left.localeCompare(right))
  const nameSet = new Set(names)
  const edges: Record<string, string[]> = {}
  for (const name of names) {
    edges[name] = [...extractRefsFromNode(schemas[name], cache)]
      .filter(target => nameSet.has(target))
      .sort((left, right) => left.localeCompare(right))
  }

  const recursive = [...findCircularSchemas(schemas, cache)].sort((left, right) => left.localeCompare(right))
  const components = stronglyConnectedComponents(names, edges)
  const componentOf = new Map<string, number>()
  components.forEach((members, index) => {
    for (const member of members) componentOf.set(member, index)
  })
  const order: string[] = []
  const visited = new Set<number>()
  const visitComponent = (index: number): void => {
    if (visited.has(index)) return
    visited.add(index)
    const dependencies = new Set<number>()
    for (const member of components[index] ?? []) {
      for (const target of edges[member] ?? []) {
        const targetComponent = componentOf.get(target)
        if (targetComponent !== undefined && targetComponent !== index) dependencies.add(targetComponent)
      }
    }
    for (const dependency of [...dependencies].sort((left, right) => (
      (components[left]?.[0] ?? '').localeCompare(components[right]?.[0] ?? '')
    ))) visitComponent(dependency)
    order.push(...(components[index] ?? []))
  }
  for (let index = 0; index < components.length; index++) visitComponent(index)

  const discriminatorFamilies: DiscriminatorFamily[] = []
  for (const base of names) {
    const discriminator = schemaRecord(schemas[base]).discriminator
    if (!isObjectRecord(discriminator) || typeof discriminator.propertyName !== 'string') continue
    discriminatorFamilies.push({
      base,
      propertyName: discriminator.propertyName,
      variants: discriminatorVariants(
        base,
        schemas,
        discriminator.propertyName,
        discriminator.mapping,
        nameSet,
      ),
    })
  }
  discriminatorFamilies.sort((left, right) => left.base.localeCompare(right.base))
  return { edges, recursive, order, discriminatorFamilies }
}

function stronglyConnectedComponents(
  names: string[],
  edges: Record<string, string[]>,
): string[][] {
  const index = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []
  let nextIndex = 0

  const connect = (name: string): void => {
    index.set(name, nextIndex)
    lowlink.set(name, nextIndex)
    nextIndex++
    stack.push(name)
    onStack.add(name)
    for (const target of edges[name] ?? []) {
      if (!index.has(target)) {
        connect(target)
        lowlink.set(name, Math.min(lowlink.get(name)!, lowlink.get(target)!))
      } else if (onStack.has(target)) {
        lowlink.set(name, Math.min(lowlink.get(name)!, index.get(target)!))
      }
    }
    if (lowlink.get(name) !== index.get(name)) return
    const members: string[] = []
    let member: string
    do {
      member = stack.pop()!
      onStack.delete(member)
      members.push(member)
    } while (member !== name)
    components.push(members.sort((left, right) => left.localeCompare(right)))
  }

  for (const name of names) if (!index.has(name)) connect(name)
  return components
}
