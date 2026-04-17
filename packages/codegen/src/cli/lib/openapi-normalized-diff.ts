export type OpenApiDiffCategory =
  | 'root'
  | 'server'
  | 'path'
  | 'component'
  | 'security'

export type OpenApiDiffKind = 'added' | 'removed' | 'changed'

export type OpenApiNormalizedDiffEntry = {
  category: OpenApiDiffCategory
  kind: OpenApiDiffKind
  pointer: string
  message: string
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const
const COMPONENT_SECTION_LABELS: Record<string, string> = {
  schemas: 'schema',
  responses: 'response',
  parameters: 'parameter',
  requestBodies: 'request body',
  headers: 'header',
  links: 'link',
  callbacks: 'callback',
  securitySchemes: 'security scheme',
}

export function diffOpenApiDocuments(
  baseSpec: Record<string, unknown>,
  headSpec: Record<string, unknown>,
): OpenApiNormalizedDiffEntry[] {
  const entries: OpenApiNormalizedDiffEntry[] = []

  compareRoot(baseSpec, headSpec, entries)
  compareServers(baseSpec, headSpec, entries)
  compareSecurityRequirements(baseSpec, headSpec, entries)
  comparePaths(baseSpec, headSpec, entries)
  compareComponents(baseSpec, headSpec, entries)

  return entries
}

export function formatOpenApiDiff(entries: readonly OpenApiNormalizedDiffEntry[]): string {
  if (entries.length === 0) {
    return [
      '### Builder Parity Diff',
      '',
      'No path/component/security/server differences detected.',
    ].join('\n')
  }

  const lines = [
    '### Builder Parity Diff',
    '',
    `${entries.length} difference${entries.length === 1 ? '' : 's'} detected.`,
    '',
  ]
  const categoryOrder: OpenApiDiffCategory[] = ['root', 'server', 'path', 'component', 'security']

  for (const category of categoryOrder) {
    const categoryEntries = entries.filter(entry => entry.category === category)
    if (categoryEntries.length === 0) continue
    lines.push(`#### ${titleCase(category)}`)
    for (const entry of categoryEntries) {
      lines.push(`- ${entry.kind} \`${entry.pointer}\`: ${entry.message}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

export function normalizeOpenApiValue(value: unknown, pointer = '#'): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item, index) => normalizeOpenApiValue(item, `${pointer}/${index}`))
    if (isOrderInsensitiveArray(pointer)) {
      return [...normalized].sort((left, right) => stableStringifyNormalized(left)
        .localeCompare(stableStringifyNormalized(right)))
    }
    return normalized
  }

  if (!isRecord(value)) return value

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const child = value[key]
    if (child === undefined) continue
    output[key] = normalizeOpenApiValue(child, `${pointer}/${escapeJsonPointer(key)}`)
  }
  return output
}

export function stableOpenApiStringify(value: unknown, pointer = '#'): string {
  return stableStringifyNormalized(normalizeOpenApiValue(value, pointer))
}

function compareRoot(
  baseSpec: Record<string, unknown>,
  headSpec: Record<string, unknown>,
  entries: OpenApiNormalizedDiffEntry[],
): void {
  for (const key of ['openapi', 'info', 'tags', 'jsonSchemaDialect']) {
    const pointer = `#/${escapeJsonPointer(key)}`
    if (equalOpenApiValues(baseSpec[key], headSpec[key], pointer)) continue
    entries.push({
      category: 'root',
      kind: readDiffKind(baseSpec[key], headSpec[key]),
      pointer,
      message: `Root ${key} differs.`,
    })
  }
}

function compareServers(
  baseSpec: Record<string, unknown>,
  headSpec: Record<string, unknown>,
  entries: OpenApiNormalizedDiffEntry[],
): void {
  if (equalOpenApiValues(baseSpec.servers, headSpec.servers, '#/servers')) return
  entries.push({
    category: 'server',
    kind: readDiffKind(baseSpec.servers, headSpec.servers),
    pointer: '#/servers',
    message: 'Server list differs.',
  })
}

function compareSecurityRequirements(
  baseSpec: Record<string, unknown>,
  headSpec: Record<string, unknown>,
  entries: OpenApiNormalizedDiffEntry[],
): void {
  const baseSecurity = collectSecurityRequirements(baseSpec)
  const headSecurity = collectSecurityRequirements(headSpec)
  compareValueMaps(baseSecurity, headSecurity, entries, {
    category: 'security',
    added: 'Security requirement added.',
    removed: 'Security requirement removed.',
    changed: 'Security requirement differs.',
  })
}

function comparePaths(
  baseSpec: Record<string, unknown>,
  headSpec: Record<string, unknown>,
  entries: OpenApiNormalizedDiffEntry[],
): void {
  const basePaths = readRecord(baseSpec.paths)
  const headPaths = readRecord(headSpec.paths)
  const baseKeys = new Set(Object.keys(basePaths))
  const headKeys = new Set(Object.keys(headPaths))

  for (const path of [...baseKeys].sort()) {
    if (headKeys.has(path)) continue
    entries.push({
      category: 'path',
      kind: 'removed',
      pointer: `#/paths/${escapeJsonPointer(path)}`,
      message: `Path removed: ${path}.`,
    })
  }

  for (const path of [...headKeys].sort()) {
    const pointer = `#/paths/${escapeJsonPointer(path)}`
    if (!baseKeys.has(path)) {
      entries.push({
        category: 'path',
        kind: 'added',
        pointer,
        message: `Path added: ${path}.`,
      })
      continue
    }

    if (equalOpenApiValues(stripSecurityFields(basePaths[path]), stripSecurityFields(headPaths[path]), pointer)) continue
    entries.push({
      category: 'path',
      kind: 'changed',
      pointer,
      message: `Path item differs: ${path}.`,
    })
  }
}

function compareComponents(
  baseSpec: Record<string, unknown>,
  headSpec: Record<string, unknown>,
  entries: OpenApiNormalizedDiffEntry[],
): void {
  const baseComponents = readComponentSections(baseSpec.components)
  const headComponents = readComponentSections(headSpec.components)
  const sections = [...new Set([
    ...Object.keys(baseComponents),
    ...Object.keys(headComponents),
  ])].sort()

  for (const section of sections) {
    const category: OpenApiDiffCategory = section === 'securitySchemes' ? 'security' : 'component'
    const label = COMPONENT_SECTION_LABELS[section] ?? section
    compareValueMaps(
      componentPointerMap(section, baseComponents[section]),
      componentPointerMap(section, headComponents[section]),
      entries,
      {
        category,
        added: `${label} added.`,
        removed: `${label} removed.`,
        changed: `${label} differs.`,
      },
    )
  }
}

function compareValueMaps(
  baseValues: ReadonlyMap<string, unknown>,
  headValues: ReadonlyMap<string, unknown>,
  entries: OpenApiNormalizedDiffEntry[],
  messages: {
    category: OpenApiDiffCategory
    added: string
    removed: string
    changed: string
  },
): void {
  const baseKeys = new Set(baseValues.keys())
  const headKeys = new Set(headValues.keys())

  for (const pointer of [...baseKeys].sort()) {
    if (headKeys.has(pointer)) continue
    entries.push({
      category: messages.category,
      kind: 'removed',
      pointer,
      message: messages.removed,
    })
  }

  for (const pointer of [...headKeys].sort()) {
    if (!baseKeys.has(pointer)) {
      entries.push({
        category: messages.category,
        kind: 'added',
        pointer,
        message: messages.added,
      })
      continue
    }

    if (equalOpenApiValues(baseValues.get(pointer), headValues.get(pointer), pointer)) continue
    entries.push({
      category: messages.category,
      kind: 'changed',
      pointer,
      message: messages.changed,
    })
  }
}

function collectSecurityRequirements(spec: Record<string, unknown>): Map<string, unknown> {
  const requirements = new Map<string, unknown>()
  if (Object.prototype.hasOwnProperty.call(spec, 'security')) {
    requirements.set('#/security', spec.security)
  }

  const paths = readRecord(spec.paths)
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue
    const pathPointer = `#/paths/${escapeJsonPointer(path)}`
    if (Object.prototype.hasOwnProperty.call(pathItem, 'security')) {
      requirements.set(`${pathPointer}/security`, pathItem.security)
    }

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (!isRecord(operation) || !Object.prototype.hasOwnProperty.call(operation, 'security')) continue
      requirements.set(`${pathPointer}/${method}/security`, operation.security)
    }
  }

  return requirements
}

function readComponentSections(value: unknown): Record<string, Record<string, unknown>> {
  const components = readRecord(value)
  const output: Record<string, Record<string, unknown>> = {}

  for (const [section, rawItems] of Object.entries(components)) {
    const items = readRecord(rawItems)
    if (Object.keys(items).length === 0) continue
    output[section] = items
  }

  return output
}

function componentPointerMap(
  section: string,
  components: Record<string, unknown> | undefined,
): Map<string, unknown> {
  const output = new Map<string, unknown>()
  for (const [name, value] of Object.entries(components ?? {})) {
    output.set(`#/components/${escapeJsonPointer(section)}/${escapeJsonPointer(name)}`, value)
  }
  return output
}

function stripSecurityFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => stripSecurityFields(item))
  if (!isRecord(value)) return value

  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'security') continue
    output[key] = stripSecurityFields(child)
  }
  return output
}

function equalOpenApiValues(left: unknown, right: unknown, pointer = '#'): boolean {
  return stableOpenApiStringify(left, pointer) === stableOpenApiStringify(right, pointer)
}

function readDiffKind(left: unknown, right: unknown): OpenApiDiffKind {
  if (left === undefined) return 'added'
  if (right === undefined) return 'removed'
  return 'changed'
}

function isOrderInsensitiveArray(pointer: string): boolean {
  return pointer === '#/servers'
    || pointer === '#/tags'
    || pointer.endsWith('/parameters')
    || pointer.endsWith('/required')
    || pointer.endsWith('/security')
    || pointer.includes('/security/')
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function stableStringifyNormalized(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined'
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
