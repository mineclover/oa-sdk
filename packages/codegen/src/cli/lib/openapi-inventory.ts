import {
  OPENAPI_PROJECTION_PROFILE_EXTENSION,
  OPENAPI_PROJECTION_REFS_EXTENSION,
  OPENAPI_PROJECTION_SOURCES_EXTENSION,
  OPENAPI_PROJECTION_VERSION_HASH_EXTENSION,
} from '@oa-sdk/openapi-projection-contract'

const OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
] as const

const COMPONENT_SECTIONS = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
  'mediaTypes',
] as const

const DEFINITION_OUTPUT_NAMES_EXTENSION = 'x-oa-sdk-definition-output-names'
const DEFINITION_COLLISION_REPORT_EXTENSION = 'x-oa-sdk-definition-collision-report'
const UNTAGGED_GROUP = '(untagged)'
const ROOT_DOMAIN = '(root)'

type JsonRecord = Record<string, unknown>
type ComponentSection = typeof COMPONENT_SECTIONS[number]

export type OpenApiInventoryOperation = {
  path: string
  method: string
  tags: string[]
  domain: string
  security: string[]
  operationId?: string
}

export type OpenApiInventoryGroup = {
  name: string
  pathCount: number
  operationCount: number
  paths: string[]
}

export type OpenApiInventoryComponentSection = {
  section: ComponentSection
  count: number
  names: string[]
}

export type OpenApiInventorySecurityScheme = {
  name: string
  used: boolean
  usedByOperations: number
  usedGlobally: boolean
  type?: string
  in?: string
  scheme?: string
  bearerFormat?: string
  flows?: string[]
}

export type OpenApiInventoryUnusedComponent = {
  section: ComponentSection
  name: string
  pointer: string
}

export type OpenApiInventorySourceSummary = {
  sourceCount: number
  refCount: number
  fileCount: number
  sourceKinds: Record<string, number>
  definitionKinds: Record<string, number>
  outputAliasCount: number
  renamedOutputAliasCount: number
  collisionReportCount: number
  collisionSeverities: Record<string, number>
  profile?: string
  versionHash?: string
}

export type OpenApiInventory = {
  schemaVersion: 'oa-gen.inventory.v1'
  document: {
    openapi?: string
    title?: string
    version?: string
    path?: string
  }
  totals: {
    paths: number
    operations: number
    components: number
    unusedComponentCandidates: number
  }
  operationCounts: Record<string, number>
  componentCounts: Record<ComponentSection, number>
  componentSections: OpenApiInventoryComponentSection[]
  tagGroups: OpenApiInventoryGroup[]
  domainGroups: OpenApiInventoryGroup[]
  securitySchemes: OpenApiInventorySecurityScheme[]
  unusedComponents: OpenApiInventoryUnusedComponent[]
  operations: OpenApiInventoryOperation[]
  sourceSummary?: OpenApiInventorySourceSummary
}

export type OpenApiInventoryOptions = {
  documentPath?: string
}

type ComponentEntry = {
  section: ComponentSection
  name: string
  value: unknown
}

type SecurityUsage = {
  usedGlobally: boolean
  usedByOperations: number
}

export function createOpenApiInventory(
  document: unknown,
  options: OpenApiInventoryOptions = {},
): OpenApiInventory {
  const root = readRecord(document) ?? {}
  const info = readRecord(root.info)
  const paths = readRecord(root.paths) ?? {}
  const pathEntries = sortedEntries(paths)
    .filter(([path]) => path.startsWith('/'))
  const operations = collectOperations(root, pathEntries)
  const componentSections = collectComponentSections(root)
  const componentCounts = componentSections.reduce(
    (counts, section) => {
      counts[section.section] = section.count
      return counts
    },
    createZeroComponentCounts(),
  )
  const componentTotal = componentSections.reduce((total, section) => total + section.count, 0)
  const operationCounts = collectOperationCounts(operations)
  const securityUsage = collectSecurityUsage(root, operations)
  const reachableComponents = collectReachableComponents(root, securityUsage)
  const unusedComponents = collectUnusedComponents(root, reachableComponents)
  const documentInfo: OpenApiInventory['document'] = {}
  if (typeof root.openapi === 'string') documentInfo.openapi = root.openapi
  if (info && typeof info.title === 'string') documentInfo.title = info.title
  if (info && typeof info.version === 'string') documentInfo.version = info.version
  if (options.documentPath !== undefined) documentInfo.path = options.documentPath

  const inventory: OpenApiInventory = {
    schemaVersion: 'oa-gen.inventory.v1',
    document: documentInfo,
    totals: {
      paths: pathEntries.length,
      operations: operations.length,
      components: componentTotal,
      unusedComponentCandidates: unusedComponents.length,
    },
    operationCounts,
    componentCounts,
    componentSections,
    tagGroups: collectGroups(
      operations.flatMap(operation => (
        operation.tags.length > 0
          ? operation.tags.map(tag => ({ name: tag, operation }))
          : [{ name: UNTAGGED_GROUP, operation }]
      )),
    ),
    domainGroups: collectGroups(
      operations.map(operation => ({ name: operation.domain, operation })),
    ),
    securitySchemes: collectSecuritySchemes(root, securityUsage),
    unusedComponents,
    operations,
  }

  const sourceSummary = collectSourceSummary(root)
  if (sourceSummary !== undefined) inventory.sourceSummary = sourceSummary

  return inventory
}

export function formatOpenApiInventoryMarkdown(inventory: OpenApiInventory): string {
  const title = inventory.document.title ?? inventory.document.path ?? 'OpenAPI document'
  const version = inventory.document.version ? ` ${inventory.document.version}` : ''
  const openapi = inventory.document.openapi ? `OpenAPI ${inventory.document.openapi}` : 'OpenAPI'
  const lines = [
    '## OpenAPI Inventory',
    '',
    `- Document: ${markdownText(title)}${markdownText(version)} (${markdownText(openapi)})`,
    `- Paths: ${inventory.totals.paths}`,
    `- Operations: ${inventory.totals.operations}`,
    `- Components: ${inventory.totals.components}`,
    `- Unused component candidates: ${inventory.totals.unusedComponentCandidates}`,
    '',
    '### Component Counts',
    '',
    markdownTable(
      ['Section', 'Count'],
      inventory.componentSections.map(section => [section.section, String(section.count)]),
    ),
    '',
    '### Operations By Tag',
    '',
    formatGroupTable(inventory.tagGroups),
    '',
    '### Operations By Domain',
    '',
    formatGroupTable(inventory.domainGroups),
    '',
    '### Security Schemes',
    '',
    formatSecurityTable(inventory.securitySchemes),
  ]

  if (inventory.sourceSummary !== undefined) {
    const summary = inventory.sourceSummary
    lines.push(
      '',
      '### Source Metadata',
      '',
      `- Sources: ${summary.sourceCount}`,
      `- Source files: ${summary.fileCount}`,
      `- Refs: ${summary.refCount}`,
      `- Output aliases: ${summary.outputAliasCount}`,
      `- Renamed aliases: ${summary.renamedOutputAliasCount}`,
      `- Collision report rows: ${summary.collisionReportCount}`,
    )
    if (summary.profile !== undefined) lines.push(`- Projection profile: ${markdownText(summary.profile)}`)
    if (summary.versionHash !== undefined) lines.push(`- Version hash: ${markdownText(summary.versionHash)}`)
  }

  lines.push(
    '',
    '### Unused Component Candidates',
    '',
    formatUnusedComponents(inventory.unusedComponents),
  )

  return lines.join('\n')
}

function collectOperations(
  root: JsonRecord,
  pathEntries: Array<[string, unknown]>,
): OpenApiInventoryOperation[] {
  const globalSecurity = Array.isArray(root.security) ? root.security : []
  const operations: OpenApiInventoryOperation[] = []

  for (const [path, pathItem] of pathEntries) {
    const item = readRecord(pathItem)
    if (!item) continue
    for (const [method, operation] of operationEntries(item)) {
      const securityRequirements = Array.isArray(operation.security)
        ? operation.security
        : globalSecurity
      const entry: OpenApiInventoryOperation = {
        path,
        method,
        tags: readStringArray(operation.tags).sort((left, right) => left.localeCompare(right)),
        domain: domainForPath(path),
        security: securityNames(securityRequirements),
      }
      if (typeof operation.operationId === 'string') entry.operationId = operation.operationId
      operations.push(entry)
    }
  }

  return operations.sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.method.localeCompare(right.method)
    || (left.operationId ?? '').localeCompare(right.operationId ?? '')
  ))
}

function operationEntries(pathItem: JsonRecord): Array<[string, JsonRecord]> {
  const entries: Array<[string, JsonRecord]> = []
  for (const method of OPERATION_METHODS) {
    const operation = readRecord(pathItem[method])
    if (operation) entries.push([method, operation])
  }

  const additionalOperations = readRecord(pathItem.additionalOperations)
  if (additionalOperations) {
    for (const [method, operation] of sortedEntries(additionalOperations)) {
      const record = readRecord(operation)
      if (record) entries.push([method, record])
    }
  }

  return entries
}

function collectOperationCounts(operations: readonly OpenApiInventoryOperation[]): Record<string, number> {
  const counts = new Map<string, number>()
  for (const method of OPERATION_METHODS) counts.set(method, 0)
  for (const operation of operations) counts.set(operation.method, (counts.get(operation.method) ?? 0) + 1)

  return Object.fromEntries(
    [...counts.entries()]
      .filter(([, count]) => count > 0)
      .sort(([left], [right]) => methodSortKey(left).localeCompare(methodSortKey(right))),
  )
}

function collectComponentSections(root: JsonRecord): OpenApiInventoryComponentSection[] {
  const components = readRecord(root.components) ?? {}
  return COMPONENT_SECTIONS.map(section => {
    const sectionRecord = readRecord(components[section]) ?? {}
    const names = Object.keys(sectionRecord).sort((left, right) => left.localeCompare(right))
    return { section, count: names.length, names }
  })
}

function collectSecurityUsage(
  root: JsonRecord,
  operations: readonly OpenApiInventoryOperation[],
): Map<string, SecurityUsage> {
  const usage = new Map<string, SecurityUsage>()
  for (const name of securityNames(Array.isArray(root.security) ? root.security : [])) {
    usage.set(name, { usedGlobally: true, usedByOperations: 0 })
  }

  for (const operation of operations) {
    for (const name of operation.security) {
      const current = usage.get(name) ?? { usedGlobally: false, usedByOperations: 0 }
      current.usedByOperations += 1
      usage.set(name, current)
    }
  }

  return usage
}

function collectSecuritySchemes(
  root: JsonRecord,
  securityUsage: ReadonlyMap<string, SecurityUsage>,
): OpenApiInventorySecurityScheme[] {
  const securitySchemes = readRecord(readRecord(root.components)?.securitySchemes) ?? {}
  return sortedEntries(securitySchemes).map(([name, scheme]) => {
    const record = readRecord(scheme) ?? {}
    const usage = securityUsage.get(name)
    const result: OpenApiInventorySecurityScheme = {
      name,
      used: usage !== undefined,
      usedByOperations: usage?.usedByOperations ?? 0,
      usedGlobally: usage?.usedGlobally ?? false,
    }
    if (typeof record.type === 'string') result.type = record.type
    if (typeof record.in === 'string') result.in = record.in
    if (typeof record.scheme === 'string') result.scheme = record.scheme
    if (typeof record.bearerFormat === 'string') result.bearerFormat = record.bearerFormat
    const flows = readRecord(record.flows)
    if (flows) result.flows = Object.keys(flows).sort((left, right) => left.localeCompare(right))
    return result
  })
}

function collectReachableComponents(
  root: JsonRecord,
  securityUsage: ReadonlyMap<string, SecurityUsage>,
): Set<string> {
  const components = collectComponentEntries(root)
  const reachable = new Set<string>()

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const record = readRecord(value)
    if (!record) return

    if (typeof record.$ref === 'string') {
      const key = componentKeyFromLocalRef(record.$ref)
      const component = key !== undefined ? components.get(key) : undefined
      if (key !== undefined && component && !reachable.has(key)) {
        reachable.add(key)
        visit(component.value)
      }
    }

    for (const item of Object.values(record)) visit(item)
  }

  visit(root.paths)
  visit(root.webhooks)

  for (const name of securityUsage.keys()) {
    const key = componentKey('securitySchemes', name)
    if (components.has(key)) reachable.add(key)
  }

  return reachable
}

function collectUnusedComponents(
  root: JsonRecord,
  reachable: ReadonlySet<string>,
): OpenApiInventoryUnusedComponent[] {
  return [...collectComponentEntries(root).values()]
    .filter(component => !reachable.has(componentKey(component.section, component.name)))
    .map(component => ({
      section: component.section,
      name: component.name,
      pointer: componentPointer(component.section, component.name),
    }))
    .sort((left, right) => (
      left.section.localeCompare(right.section)
      || left.name.localeCompare(right.name)
    ))
}

function collectComponentEntries(root: JsonRecord): Map<string, ComponentEntry> {
  const components = readRecord(root.components) ?? {}
  const entries = new Map<string, ComponentEntry>()
  for (const section of COMPONENT_SECTIONS) {
    const sectionRecord = readRecord(components[section])
    if (!sectionRecord) continue
    for (const [name, value] of sortedEntries(sectionRecord)) {
      entries.set(componentKey(section, name), { section, name, value })
    }
  }
  return entries
}

function collectGroups(entries: Array<{ name: string; operation: OpenApiInventoryOperation }>): OpenApiInventoryGroup[] {
  const groups = new Map<string, { paths: Set<string>; operations: number }>()
  for (const entry of entries) {
    const group = groups.get(entry.name) ?? { paths: new Set<string>(), operations: 0 }
    group.paths.add(entry.operation.path)
    group.operations += 1
    groups.set(entry.name, group)
  }

  return [...groups.entries()]
    .map(([name, group]) => ({
      name,
      pathCount: group.paths.size,
      operationCount: group.operations,
      paths: [...group.paths].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => (
      right.operationCount - left.operationCount
      || left.name.localeCompare(right.name)
    ))
}

function collectSourceSummary(root: JsonRecord): OpenApiInventorySourceSummary | undefined {
  const sources = readRecord(root[OPENAPI_PROJECTION_SOURCES_EXTENSION])
  const refs = Array.isArray(root[OPENAPI_PROJECTION_REFS_EXTENSION])
    ? root[OPENAPI_PROJECTION_REFS_EXTENSION]
    : undefined
  const aliases = Array.isArray(root[DEFINITION_OUTPUT_NAMES_EXTENSION])
    ? root[DEFINITION_OUTPUT_NAMES_EXTENSION]
    : undefined
  const collisions = Array.isArray(root[DEFINITION_COLLISION_REPORT_EXTENSION])
    ? root[DEFINITION_COLLISION_REPORT_EXTENSION]
    : undefined
  const profile = typeof root[OPENAPI_PROJECTION_PROFILE_EXTENSION] === 'string'
    ? root[OPENAPI_PROJECTION_PROFILE_EXTENSION]
    : undefined
  const versionHash = typeof root[OPENAPI_PROJECTION_VERSION_HASH_EXTENSION] === 'string'
    ? root[OPENAPI_PROJECTION_VERSION_HASH_EXTENSION]
    : undefined

  if (
    sources === undefined
    && refs === undefined
    && aliases === undefined
    && collisions === undefined
    && profile === undefined
    && versionHash === undefined
  ) {
    return undefined
  }

  const sourceEntries = sources ? sortedEntries(sources) : []
  const sourceKinds = new Map<string, number>()
  const definitionKinds = new Map<string, number>()
  const filePaths = new Set<string>()

  for (const [id, source] of sourceEntries) {
    const sourceRecord = readRecord(source)
    const sourceKind = sourceRecord && typeof sourceRecord.kind === 'string'
      ? sourceRecord.kind
      : 'unknown'
    increment(sourceKinds, sourceKind)

    const separator = id.indexOf(':')
    increment(definitionKinds, separator > 0 ? id.slice(0, separator) : 'unknown')

    if (sourceRecord && sourceRecord.kind === 'file' && typeof sourceRecord.filePath === 'string') {
      filePaths.add(sourceRecord.filePath)
    }
  }

  const collisionSeverities = new Map<string, number>()
  for (const collision of collisions ?? []) {
    const record = readRecord(collision)
    const severity = record && typeof record.severity === 'string' ? record.severity : 'unknown'
    increment(collisionSeverities, severity)
  }

  const summary: OpenApiInventorySourceSummary = {
    sourceCount: sourceEntries.length,
    refCount: refs?.length ?? 0,
    fileCount: filePaths.size,
    sourceKinds: sortedNumberRecord(sourceKinds),
    definitionKinds: sortedNumberRecord(definitionKinds),
    outputAliasCount: aliases?.length ?? 0,
    renamedOutputAliasCount: (aliases ?? []).filter(isRenamedAlias).length,
    collisionReportCount: collisions?.length ?? 0,
    collisionSeverities: sortedNumberRecord(collisionSeverities),
  }
  if (profile !== undefined) summary.profile = profile
  if (versionHash !== undefined) summary.versionHash = versionHash
  return summary
}

function isRenamedAlias(value: unknown): boolean {
  const record = readRecord(value)
  return !!record
    && typeof record.outputName === 'string'
    && typeof record.localName === 'string'
    && record.outputName !== record.localName
}

function securityNames(requirements: unknown): string[] {
  if (!Array.isArray(requirements)) return []
  const names = new Set<string>()
  for (const requirement of requirements) {
    const record = readRecord(requirement)
    if (!record) continue
    for (const name of Object.keys(record)) names.add(name)
  }
  return [...names].sort((left, right) => left.localeCompare(right))
}

function domainForPath(path: string): string {
  const firstSegment = path.split('/').filter(Boolean)[0]
  return firstSegment ?? ROOT_DOMAIN
}

function componentKeyFromLocalRef(ref: string): string | undefined {
  if (!ref.startsWith('#/components/')) return undefined
  const tokens = ref.slice(2).split('/').map(decodePointerToken)
  const section = tokens[1]
  const name = tokens.slice(2).join('/')
  if (!isComponentSection(section) || name.length === 0) return undefined
  return componentKey(section, name)
}

function componentKey(section: ComponentSection, name: string): string {
  return `${section}\0${name}`
}

function componentPointer(section: ComponentSection, name: string): string {
  return `#/components/${section}/${encodePointerToken(name)}`
}

function isComponentSection(value: unknown): value is ComponentSection {
  return typeof value === 'string' && (COMPONENT_SECTIONS as readonly string[]).includes(value)
}

function readRecord(value: unknown): JsonRecord | undefined {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function sortedEntries(record: JsonRecord): Array<[string, unknown]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
}

function createZeroComponentCounts(): Record<ComponentSection, number> {
  return Object.fromEntries(COMPONENT_SECTIONS.map(section => [section, 0])) as Record<ComponentSection, number>
}

function methodSortKey(method: string): string {
  const standardIndex = (OPERATION_METHODS as readonly string[]).indexOf(method)
  return standardIndex === -1 ? `z:${method}` : `a:${String(standardIndex).padStart(2, '0')}`
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function sortedNumberRecord(map: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function encodePointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function decodePointerToken(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~')
}

function formatGroupTable(groups: readonly OpenApiInventoryGroup[]): string {
  if (groups.length === 0) return 'No operations.'
  return markdownTable(
    ['Name', 'Operations', 'Paths'],
    groups.map(group => [
      group.name,
      String(group.operationCount),
      group.paths.join(', '),
    ]),
  )
}

function formatSecurityTable(schemes: readonly OpenApiInventorySecurityScheme[]): string {
  if (schemes.length === 0) return 'No security schemes.'
  return markdownTable(
    ['Name', 'Type', 'Used', 'Operations'],
    schemes.map(scheme => [
      scheme.name,
      [scheme.type, scheme.scheme].filter(Boolean).join(' ') || '-',
      scheme.used ? 'yes' : 'no',
      String(scheme.usedByOperations),
    ]),
  )
}

function formatUnusedComponents(components: readonly OpenApiInventoryUnusedComponent[]): string {
  if (components.length === 0) return 'No unused component candidates.'
  const visible = components.slice(0, 25)
  const table = markdownTable(
    ['Section', 'Name', 'Pointer'],
    visible.map(component => [component.section, component.name, component.pointer]),
  )
  const omitted = components.length - visible.length
  return omitted > 0 ? `${table}\n\n${omitted} more candidates omitted.` : table
}

function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(markdownCell).join(' | ')} |`),
  ].join('\n')
}

function markdownCell(value: string): string {
  return markdownText(value).replace(/\|/g, '\\|')
}

function markdownText(value: string): string {
  return value.replace(/\n/g, ' ')
}
