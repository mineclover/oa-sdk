/**
 * OpenAPI 3.2 Document → Zod 4 source code generator
 *
 * Emits TypeScript code with:
 *   - import { z } from 'zod'
 *   - export const <Name>Schema = z.object(...)
 *   - export type <Name> = z.infer<typeof <Name>Schema>
 * Formatted with formatGeneratedTs.
 */

import {
  parseDocument,
  foldSchema,
  lintDocument,
  type OasDocument,
  type OasSchema,
  type LintResult,
  type LintSeverity,
  type LintCategory,
} from '@oa-sdk/parser'
import { formatGeneratedTs, toTypeScriptIdentifier, pascalCase } from '@oa-sdk/core'
import { normalizeOpenApiDocument, type OpenApiCollectProfile } from '../cli/lib/openapi-collect.js'
import {
  createZod4Algebra,
  prepareSchemaForZod,
  collectDiscriminatorProperties,
  type Zod4AlgebraOptions,
} from './schema-to-zod.js'

export interface GenerateZodOptions extends Zod4AlgebraOptions {
  /** Include auto-generated banner comment (default: true) */
  banner?: boolean | undefined
  /** Emission style: 'both' exports schemas & inferred types; 'schema' exports only schemas (default: 'both') */
  style?: 'schema' | 'both' | undefined
  /** Explicit flag to enable/disable type exports (defaults to true unless style === 'schema') */
  exportTypes?: boolean | undefined
  /** Run preflight schema validation (default: true) */
  validate?: boolean | undefined
  /** Categories to validate when preflight validation is enabled (default: ['structure', 'refs', 'components']) */
  lintCategories?: LintCategory[] | undefined
  /** Minimum severity that causes preflight validation to fail and halt generation (default: 'error') */
  failOnSeverity?: LintSeverity | undefined
  /** Normalize OpenAPI document before generation (default: true) */
  normalize?: boolean | undefined
  /** Normalization profile to use when normalize is enabled (default: 'generic') */
  normalizeProfile?: OpenApiCollectProfile | undefined
  /** Force generation even if fatal preflight validation issues are detected */
  force?: boolean | undefined
  /** Custom rule configuration for preflight linting ('off' | 'warn' | 'error') */
  rules?: Record<string, 'off' | 'warn' | 'error'> | undefined
  /** Base path for resolving relative external $refs during linting/validation */
  basePath?: string | undefined
  /** Source location lookup function for mapping pointers to line/column */
  lookupSourceLocation?: ((filePath: string, pointer: string) => { line: number; column: number } | undefined) | undefined
  /** Optional cache for schema $ref extraction (defaults to module-scoped WeakMap cache) */
  schemaRefCache?: WeakMap<object, Set<string>> | undefined
}

export class ZodGenerationPreflightError extends Error {
  readonly diagnostics: LintResult[]

  constructor(diagnostics: LintResult[], message?: string) {
    const defaultMessage = formatPreflightErrorMessage(diagnostics)
    super(message ?? defaultMessage)
    this.name = 'ZodGenerationPreflightError'
    this.diagnostics = diagnostics
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

const DEFAULT_LINT_CATEGORIES: LintCategory[] = ['structure', 'refs', 'components']

const SEVERITY_RANKS: Record<LintSeverity, number> = {
  info: 1,
  warning: 2,
  error: 3,
}

function isFatalDiagnostic(diagnostic: LintResult, failOnSeverity: LintSeverity = 'error'): boolean {
  const threshold = SEVERITY_RANKS[failOnSeverity] ?? 3
  const rank = SEVERITY_RANKS[diagnostic.severity] ?? 3
  return rank >= threshold
}

function formatDiagnosticLocation(
  diagnostic: LintResult,
  options?: {
    basePath?: string | undefined
    lookupSourceLocation?: ((filePath: string, pointer: string) => { line: number; column: number } | undefined) | undefined
  } | undefined,
): string {
  if (diagnostic.source?.filePath) {
    const coords = diagnostic.source.line !== undefined
      ? `:${diagnostic.source.line}:${diagnostic.source.column ?? 0}`
      : ''
    return `${diagnostic.path} (${diagnostic.source.filePath}${coords})`
  }
  if (options?.basePath) {
    const resolved = options.lookupSourceLocation?.(options.basePath, diagnostic.path)
    if (resolved) {
      return `${diagnostic.path} (${options.basePath}:${resolved.line}:${resolved.column})`
    }
    return `${diagnostic.path} (${options.basePath})`
  }
  return diagnostic.path
}

function formatPreflightErrorMessage(
  diagnostics: LintResult[],
  options?: Pick<GenerateZodOptions, 'basePath' | 'lookupSourceLocation'>,
): string {
  const lines = diagnostics.map(d => {
    const loc = formatDiagnosticLocation(d, options)
    return `  - [${d.severity.toUpperCase()}] [${d.rule}] ${d.message} (at ${loc})`
  })
  return `Zod 4 code generation aborted due to preflight validation failure (${diagnostics.length} issue(s)):\n${lines.join('\n')}`
}

function formatPreflightDiagnostics(
  diagnostics: LintResult[],
  options?: {
    basePath?: string | undefined
    lookupSourceLocation?: ((filePath: string, pointer: string) => { line: number; column: number } | undefined) | undefined
  } | undefined,
): string {
  return diagnostics
    .map(d => {
      const location = formatDiagnosticLocation(d, options)
      return `  - [${d.severity.toUpperCase()}] [${d.rule}] ${d.message} (at ${location})`
    })
    .join('\n')
}

function createDiagnostic(
  path: string,
  severity: LintSeverity,
  rule: string,
  message: string,
  options?: Pick<GenerateZodOptions, 'basePath' | 'lookupSourceLocation'>,
): LintResult {
  const result: LintResult = { path, severity, rule, message }
  if (options?.basePath) {
    const loc = options.lookupSourceLocation?.(options.basePath, path)
    result.source = {
      filePath: options.basePath,
      pointer: path,
      sourceFilePath: options.basePath,
      sourcePointer: path,
      ...(loc !== undefined ? { line: loc.line, column: loc.column } : {}),
    }
  }
  return result
}

interface ObjectCycle {
  pointer: string
  targetPointer: string
  parent: Record<string, unknown> | unknown[]
  keyOrIndex: string | number
}

function findObjectCycles(root: unknown): ObjectCycle[] {
  if (!root || typeof root !== 'object') return []
  const cycles: ObjectCycle[] = []
  const stack: Array<{ node: unknown; pointer: string }> = []

  function walk(
    node: unknown,
    pointer: string,
    parent?: Record<string, unknown> | unknown[],
    keyOrIndex?: string | number,
  ): void {
    if (!node || typeof node !== 'object') return
    const match = stack.find(entry => entry.node === node)
    if (match) {
      cycles.push({
        pointer: pointer || '/',
        targetPointer: match.pointer || '/',
        parent: parent!,
        keyOrIndex: keyOrIndex!,
      })
      return
    }

    stack.push({ node, pointer })
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${pointer}/${i}`, node, i)
      }
    } else {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const escaped = k.replace(/~/g, '~0').replace(/\//g, '~1')
        walk(v, `${pointer}/${escaped}`, node as Record<string, unknown>, k)
      }
    }
    stack.pop()
  }

  walk(root, '')
  return cycles
}

const GLOBAL_SCHEMA_REF_CACHE = new WeakMap<object, Set<string>>()
const EMPTY_REF_SET: ReadonlySet<string> = new Set<string>()

/**
 * Fast-path extraction of schema target name from a $ref pointer.
 * Matches #/components/schemas/<Target> and #/schemas/<Target> without regex allocations.
 */
export function parseRefTarget(ref: unknown): string | null {
  if (typeof ref !== 'string') return null
  let raw: string | null = null
  if (ref.startsWith('#/components/schemas/')) {
    raw = ref.slice(21)
  } else if (ref.startsWith('#/schemas/')) {
    raw = ref.slice(10)
  }
  if (!raw || raw.length === 0) return null
  try {
    return decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~')
  } catch {
    return raw.replace(/~1/g, '/').replace(/~0/g, '~')
  }
}

/**
 * Traverses an AST node and extracts all referenced component schema names.
 * Uses WeakMap memoization to eliminate redundant traversals and an active stack set
 * to guard against cyclic object graph loops.
 */
export function extractRefsFromNode(
  node: unknown,
  cache: WeakMap<object, Set<string>> = GLOBAL_SCHEMA_REF_CACHE,
  activeStack: Set<unknown> = new Set<unknown>(),
): Set<string> {
  if (!node || typeof node !== 'object') {
    return EMPTY_REF_SET as Set<string>
  }

  const cached = cache.get(node)
  if (cached !== undefined) {
    return cached
  }

  if (activeStack.has(node)) {
    return EMPTY_REF_SET as Set<string>
  }

  activeStack.add(node)
  const refs = new Set<string>()

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const item = node[i]
      if (item && typeof item === 'object') {
        const childRefs = extractRefsFromNode(item, cache, activeStack)
        for (const r of childRefs) {
          refs.add(r)
        }
      }
    }
  } else {
    const obj = node as Record<string, unknown>
    const refVal = obj['$ref']
    if (typeof refVal === 'string') {
      const target = parseRefTarget(refVal)
      if (target !== null) {
        refs.add(target)
      }
    }

    for (const key of Object.keys(obj)) {
      if (key !== '$ref') {
        const val = obj[key]
        if (val && typeof val === 'object') {
          const childRefs = extractRefsFromNode(val, cache, activeStack)
          for (const r of childRefs) {
            refs.add(r)
          }
        }
      }
    }
  }

  activeStack.delete(node)
  cache.set(node, refs)
  return refs
}

/**
 * Identifies all schemas in components.schemas that participate in a directed reference cycle.
 * Uses Tarjan's Strongly Connected Components (SCC) linear O(V + E) algorithm and memoized
 * $ref extraction to eliminate exponential/quadratic traversal blowup.
 */
export function findCircularSchemas(
  schemas: Record<string, OasSchema>,
  cache: WeakMap<object, Set<string>> = GLOBAL_SCHEMA_REF_CACHE,
): Set<string> {
  const graph = new Map<string, Set<string>>()
  const activeStack = new Set<unknown>()

  for (const [name, s] of Object.entries(schemas)) {
    const refs = extractRefsFromNode(s, cache, activeStack)
    graph.set(name, refs)
  }

  const circular = new Set<string>()
  const indices = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const sccStack: string[] = []
  let currentIndex = 0

  function strongConnect(node: string): void {
    indices.set(node, currentIndex)
    lowlink.set(node, currentIndex)
    currentIndex++
    sccStack.push(node)
    onStack.add(node)

    const neighbors = graph.get(node)
    if (neighbors) {
      for (const next of neighbors) {
        if (!graph.has(next)) {
          // Target is not in the components schema graph (external or dangling reference)
          continue
        }
        if (!indices.has(next)) {
          // Successor has not yet been visited; recurse
          strongConnect(next)
          const nextLow = lowlink.get(next)!
          const curLow = lowlink.get(node)!
          if (nextLow < curLow) {
            lowlink.set(node, nextLow)
          }
        } else if (onStack.has(next)) {
          // Successor is on the stack and hence in the current SCC
          const nextIndex = indices.get(next)!
          const curLow = lowlink.get(node)!
          if (nextIndex < curLow) {
            lowlink.set(node, nextIndex)
          }
        }
      }
    }

    // If node is a root node of an SCC, pop the stack and collect component members
    if (lowlink.get(node) === indices.get(node)) {
      const component: string[] = []
      let w: string
      do {
        w = sccStack.pop()!
        onStack.delete(w)
        component.push(w)
      } while (w !== node)

      if (component.length > 1) {
        for (const member of component) {
          circular.add(member)
        }
      } else {
        // Single-node component: participates in a cycle if and only if it has a self-loop
        const singleNeighbors = graph.get(node)
        if (singleNeighbors && singleNeighbors.has(node)) {
          circular.add(node)
        }
      }
    }
  }

  for (const node of Object.keys(schemas)) {
    if (!indices.has(node)) {
      strongConnect(node)
    }
  }

  return circular
}

/**
 * Generates formatted TypeScript source code containing Zod 4 schemas and inferred types
 * from an OpenAPI 3.2 document.
 *
 * @param doc OAS 3.2 document object
 * @param options Generation options
 * @returns Formatted TypeScript source code
 */
export function generateZodFromSpec(doc: OasDocument, options: GenerateZodOptions = {}): string {
  // Cycle detection: identify in-memory circular references (e.g. YAML anchor cycles)
  const rawCycles = (doc && typeof doc === 'object') ? findObjectCycles(doc) : []
  let safeDoc: unknown = doc

  if (rawCycles.length > 0) {
    try {
      safeDoc = structuredClone(doc)
      const clonedCycles = findObjectCycles(safeDoc)
      for (const c of clonedCycles) {
        if (c.parent && c.keyOrIndex !== undefined) {
          if (c.targetPointer.startsWith('/components/schemas/')) {
            (c.parent as any)[c.keyOrIndex] = { $ref: `#${c.targetPointer}` }
          } else {
            (c.parent as any)[c.keyOrIndex] = { description: 'Circular reference pruned' }
          }
        }
      }
    } catch {
      safeDoc = doc
    }
  }

  // R2: Automatic Schema Normalization Before Generation
  let targetDoc = safeDoc as OasDocument
  if (options.normalize !== false && safeDoc && typeof safeDoc === 'object' && !Array.isArray(safeDoc)) {
    try {
      targetDoc = normalizeOpenApiDocument(safeDoc as Record<string, unknown>, {
        profile: options.normalizeProfile ?? 'generic',
      }) as unknown as OasDocument
    } catch {
      targetDoc = safeDoc as OasDocument
    }
  }

  // R1: Preflight Validation & Linting Pipeline
  const shouldValidate = options.validate !== false
  if (shouldValidate) {
    const categories = options.lintCategories ?? DEFAULT_LINT_CATEGORIES
    const allDiagnostics: LintResult[] = []

    // Report circular in-memory object references (YAML anchor loops) as fatal preflight issues
    for (const cycle of rawCycles) {
      allDiagnostics.push(createDiagnostic(
        cycle.pointer,
        'error',
        'structure/circular-anchor',
        `순환 객체 참조(YAML anchor cycle)가 감지되었습니다: ${cycle.pointer} -> ${cycle.targetPointer}. OpenAPI 스키마 재귀는 $ref 포인터를 사용해야 합니다`,
        options,
      ))
    }

    const lintResults = lintDocument(targetDoc, {
      categories,
      ...(options.basePath !== undefined ? { basePath: options.basePath } : {}),
      ...(options.lookupSourceLocation !== undefined ? { lookupSourceLocation: options.lookupSourceLocation } : {}),
      rules: {
        'refs/cycle': 'warn',
        ...options.rules,
      },
    })
    allDiagnostics.push(...lintResults)

    // Additional schema structure validation for components.schemas
    if (categories.includes('components') || categories.includes('structure')) {
      if (targetDoc && typeof targetDoc === 'object' && !Array.isArray(targetDoc)) {
        const specRecord = targetDoc as Record<string, unknown>
        if (specRecord['components'] !== undefined) {
          if (typeof specRecord['components'] !== 'object' || specRecord['components'] === null || Array.isArray(specRecord['components'])) {
            allDiagnostics.push(createDiagnostic(
              '/components',
              'error',
              'structure/components-object',
              'components는 객체여야 합니다',
              options,
            ))
          } else {
            const comps = specRecord['components'] as Record<string, unknown>
            if (comps['schemas'] !== undefined) {
              if (typeof comps['schemas'] !== 'object' || comps['schemas'] === null || Array.isArray(comps['schemas'])) {
                allDiagnostics.push(createDiagnostic(
                  '/components/schemas',
                  'error',
                  'structure/schemas-object',
                  'components.schemas는 객체여야 합니다',
                  options,
                ))
              } else {
                for (const [name, s] of Object.entries(comps['schemas'] as Record<string, unknown>)) {
                  const isValidSchema = typeof s === 'boolean' || (typeof s === 'object' && s !== null && !Array.isArray(s))
                  if (!isValidSchema) {
                    const escapedName = name.replace(/~/g, '~0').replace(/\//g, '~1')
                    allDiagnostics.push(createDiagnostic(
                      `/components/schemas/${escapedName}`,
                      'error',
                      'structure/schema-object',
                      `Schema '${name}'는 객체 또는 boolean이어야 합니다`,
                      options,
                    ))
                  }
                }
              }
            }
          }
        }
      }
    }

    const failSeverity = options.failOnSeverity ?? 'error'
    const fatalDiagnostics = allDiagnostics.filter(d => isFatalDiagnostic(d, failSeverity))

    if (fatalDiagnostics.length > 0) {
      if (options.force) {
        console.warn(
          `[generateZodFromSpec] Warning: Preflight validation detected ${fatalDiagnostics.length} fatal issue(s) (--force enabled, proceeding best-effort):\n` +
          formatPreflightDiagnostics(fatalDiagnostics, options),
        )
      } else {
        throw new ZodGenerationPreflightError(
          fatalDiagnostics,
          formatPreflightErrorMessage(fatalDiagnostics, options),
        )
      }
    }
  }

  const safeTargetDoc = (targetDoc && typeof targetDoc === 'object' && !Array.isArray(targetDoc))
    ? targetDoc
    : ({ openapi: '3.2.0', info: { title: '', version: '' }, paths: {}, components: {} } as unknown as OasDocument)

  const parsed = parseDocument(safeTargetDoc, [])
  const rawSchemas = parsed.schemas
  const schemas: Record<string, OasSchema> = (rawSchemas && typeof rawSchemas === 'object' && !Array.isArray(rawSchemas))
    ? rawSchemas
    : {}

  const circularSchemas = findCircularSchemas(schemas, options.schemaRefCache)
  const discriminatorProperties = new Set<string>(options.discriminatorProperties ?? [])
  for (const s of Object.values(schemas)) {
    collectDiscriminatorProperties(s, discriminatorProperties)
  }

  const suffix = options.schemaSuffix ?? 'Schema'
  const refNameOverrides: Record<string, string> = { ...options.refNameOverrides }

  // Disambiguate schema identifiers if any special character normalizations collide
  const schemaConstNames = new Map<string, string>()
  const typeNames = new Map<string, string>()
  const usedConstNames = new Set<string>()
  const usedTypeNames = new Set<string>()

  const sortedSchemaNames = Object.keys(schemas).sort((a, b) => a.localeCompare(b))
  for (const name of sortedSchemaNames) {
    const baseIdent = toTypeScriptIdentifier(pascalCase(name))
    let ident = baseIdent
    let typeCounter = 2
    while (usedTypeNames.has(ident)) {
      ident = `${baseIdent}${typeCounter++}`
    }
    usedTypeNames.add(ident)
    typeNames.set(name, ident)

    const baseConst = `${ident}${suffix}`
    let schemaConst = baseConst
    let constCounter = 2
    while (usedConstNames.has(schemaConst)) {
      schemaConst = `${baseConst}${constCounter++}`
    }
    usedConstNames.add(schemaConst)
    schemaConstNames.set(name, schemaConst)

    const schemaConstName = schemaConst
    refNameOverrides[`#/components/schemas/${name}`] = `z.lazy(() => ${schemaConstName})`
    const encoded = encodeURIComponent(name)
    if (encoded !== name) {
      refNameOverrides[`#/components/schemas/${encoded}`] = `z.lazy(() => ${schemaConstName})`
    }
    const jsonPointerToken = name.replace(/~/g, '~0').replace(/\//g, '~1')
    if (jsonPointerToken !== name) {
      refNameOverrides[`#/components/schemas/${jsonPointerToken}`] = `z.lazy(() => ${schemaConstName})`
      const encToken = encodeURIComponent(jsonPointerToken)
      if (encToken !== jsonPointerToken) {
        refNameOverrides[`#/components/schemas/${encToken}`] = `z.lazy(() => ${schemaConstName})`
      }
    }
  }

  const defaultValues = options.defaultValues ?? new WeakMap<OasSchema, unknown>()
  const algebra = createZod4Algebra({
    ...options,
    refNameOverrides,
    defaultValues,
    schemaSuffix: suffix,
    discriminatorProperties,
  })

  const lines: string[] = []
  if (options.banner !== false) {
    lines.push('// Auto-generated from OpenAPI 3.2 spec by @oa-sdk/codegen')
    lines.push('// Do not edit directly.')
    lines.push('')
  }
  lines.push("import { z } from 'zod'")
  lines.push('')

  const shouldExportTypes = options.exportTypes !== false && options.style !== 'schema'
  const sortedEntries = Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))

  for (const [name, rawSchema] of sortedEntries) {
    const ident = typeNames.get(name) ?? toTypeScriptIdentifier(pascalCase(name))
    const schemaConstName = schemaConstNames.get(name) ?? `${ident}${suffix}`
    const cleanSchema = prepareSchemaForZod(rawSchema, defaultValues)
    const zodExpr = foldSchema(cleanSchema, algebra)

    const typeAnnotation = circularSchemas.has(name) ? ': z.ZodTypeAny' : ''
    lines.push(`export const ${schemaConstName}${typeAnnotation} = ${zodExpr}`)
    if (shouldExportTypes) {
      lines.push(`export type ${ident} = z.infer<typeof ${schemaConstName}>`)
    }
    lines.push('')
  }

  return formatGeneratedTs(lines.join('\n'))
}
