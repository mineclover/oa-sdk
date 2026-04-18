import { createHash } from 'node:crypto'

export type OpenApiSourceFragmentMetadata = Readonly<Record<string, unknown>>

export type OpenApiSourceFragment = {
  id: string
  kind: string
  sourcePath?: string
  sourcePointer?: string
  contentHash: string
  content: unknown
  metadata?: OpenApiSourceFragmentMetadata
}

export type OpenApiSourceFragmentInput = {
  id?: string
  kind: string
  sourcePath?: string
  sourcePointer?: string
  contentHash?: string
  content: unknown
  metadata?: OpenApiSourceFragmentMetadata
}

export type OpenApiSourceFragmentIdInput = {
  kind: string
  sourcePath?: string
  sourcePointer?: string
  contentHash: string
}

export type OpenApiDocumentSourceFragmentIssue = {
  message: string
  sourcePointer: string
}

export type OpenApiDocumentSourceFragmentResult = {
  fragments: OpenApiSourceFragment[]
  issues: OpenApiDocumentSourceFragmentIssue[]
}

export type OpenApiDocumentSourceFragmentOptions = {
  sourcePath?: string
  sourcePointerBase?: string
  metadata?: OpenApiSourceFragmentMetadata
}

export type OpenApiSourceAdapterDiagnosticSeverity = 'error' | 'warning' | 'info'

export type OpenApiSourceAdapterDiagnostic<
  TCode extends string = string,
  TSeverity extends OpenApiSourceAdapterDiagnosticSeverity = OpenApiSourceAdapterDiagnosticSeverity,
> = {
  code: TCode
  severity: TSeverity
  message: string
  sourcePath: string
  sourcePointer: string
  metadata?: OpenApiSourceFragmentMetadata
}

export type OpenApiSourceAdapterDiagnosticInput<
  TCode extends string = string,
  TSeverity extends OpenApiSourceAdapterDiagnosticSeverity = OpenApiSourceAdapterDiagnosticSeverity,
> = OpenApiSourceAdapterDiagnostic<TCode, TSeverity>

export function createOpenApiSourceFragment(input: OpenApiSourceFragmentInput): OpenApiSourceFragment {
  const contentHash = input.contentHash ?? createOpenApiSourceContentHash(input.content)
  const id = input.id ?? createOpenApiSourceFragmentId({
    kind: input.kind,
    contentHash,
    ...(input.sourcePath !== undefined ? { sourcePath: input.sourcePath } : {}),
    ...(input.sourcePointer !== undefined ? { sourcePointer: input.sourcePointer } : {}),
  })

  const fragment: OpenApiSourceFragment = {
    id,
    kind: input.kind,
    contentHash,
    content: input.content,
  }
  if (input.sourcePath !== undefined) fragment.sourcePath = input.sourcePath
  if (input.sourcePointer !== undefined) fragment.sourcePointer = input.sourcePointer
  if (input.metadata !== undefined) fragment.metadata = input.metadata
  return fragment
}

export function createOpenApiSourceFragmentId(input: OpenApiSourceFragmentIdInput): string {
  const digest = createOpenApiSourceDigest({
    kind: input.kind,
    contentHash: input.contentHash,
    ...(input.sourcePath !== undefined ? { sourcePath: input.sourcePath } : {}),
    ...(input.sourcePointer !== undefined ? { sourcePointer: input.sourcePointer } : {}),
  })
  return `openapi-source:${input.kind}:${digest}`
}

export function createOpenApiSourceContentHash(value: unknown): string {
  return `sha256:${createOpenApiSourceDigest(value)}`
}

export function createOpenApiSourceAdapterDiagnostic<
  TCode extends string,
  TSeverity extends OpenApiSourceAdapterDiagnosticSeverity,
>(
  input: OpenApiSourceAdapterDiagnosticInput<TCode, TSeverity>,
): OpenApiSourceAdapterDiagnostic<TCode, TSeverity> {
  const diagnostic: OpenApiSourceAdapterDiagnostic<TCode, TSeverity> = {
    code: input.code,
    severity: input.severity,
    message: input.message,
    sourcePath: input.sourcePath,
    sourcePointer: input.sourcePointer,
  }
  if (input.metadata !== undefined) diagnostic.metadata = input.metadata
  return diagnostic
}

export function collectOpenApiDocumentSourceFragments(
  document: Record<string, unknown>,
  options: OpenApiDocumentSourceFragmentOptions = {},
): OpenApiDocumentSourceFragmentResult {
  const fragments: OpenApiSourceFragment[] = []
  const issues: OpenApiDocumentSourceFragmentIssue[] = []
  const pointerBase = options.sourcePointerBase ?? '#'

  collectPathFragments(pointerChild(pointerBase, 'paths'), document.paths, fragments, issues, options)
  collectPathFragments(pointerChild(pointerBase, 'webhooks'), document.webhooks, fragments, issues, options)

  const componentsPointer = pointerChild(pointerBase, 'components')
  const components = document.components
  if (components !== undefined && !isRecord(components)) {
    issues.push({
      message: 'OpenAPI components must be an object.',
      sourcePointer: componentsPointer,
    })
  } else if (components !== undefined) {
    collectComponentFragments(componentsPointer, components, fragments, issues, options)
  }

  return {
    fragments: fragments.sort((left, right) => (
      (left.sourcePointer ?? '').localeCompare(right.sourcePointer ?? '')
      || left.kind.localeCompare(right.kind)
    )),
    issues,
  }
}

function createOpenApiSourceDigest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function collectPathFragments(
  sectionPointer: string,
  value: unknown,
  fragments: OpenApiSourceFragment[],
  issues: OpenApiDocumentSourceFragmentIssue[],
  options: OpenApiDocumentSourceFragmentOptions,
): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    issues.push({
      message: 'OpenAPI paths/webhooks section must be an object.',
      sourcePointer: sectionPointer,
    })
    return
  }

  for (const [path, pathItem] of sortedEntries(value)) {
    const pathPointer = pointerChild(sectionPointer, path)
    if (!isRecord(pathItem)) {
      issues.push({
        message: 'OpenAPI path item must be an object.',
        sourcePointer: pathPointer,
      })
      continue
    }

    fragments.push(createOpenApiSourceFragment({
      kind: sectionPointer.endsWith('/webhooks') ? 'webhook' : 'path',
      ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
      sourcePointer: pathPointer,
      content: pathItem,
      metadata: mergeMetadata(
        options.metadata,
        sectionPointer.endsWith('/webhooks') ? { webhook: path } : { path },
      ),
    }))

    for (const method of sortedOpenApiOperationMethods(pathItem)) {
      fragments.push(createOpenApiSourceFragment({
        kind: 'operation',
        ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
        sourcePointer: pointerChild(pathPointer, method),
        content: pathItem[method],
        metadata: mergeMetadata(
          options.metadata,
          sectionPointer.endsWith('/webhooks') ? { webhook: path, method } : { path, method },
        ),
      }))
    }
  }
}

function collectComponentFragments(
  sectionPointer: string,
  components: Record<string, unknown>,
  fragments: OpenApiSourceFragment[],
  issues: OpenApiDocumentSourceFragmentIssue[],
  options: OpenApiDocumentSourceFragmentOptions,
): void {
  for (const [section, values] of sortedEntries(components)) {
    const componentSectionPointer = pointerChild(sectionPointer, section)
    if (!isRecord(values)) {
      issues.push({
        message: 'OpenAPI component section must be an object.',
        sourcePointer: componentSectionPointer,
      })
      continue
    }

    for (const [name, content] of sortedEntries(values)) {
      const pointer = pointerChild(componentSectionPointer, name)
      if (!isOpenApiComponentContent(section, content)) {
        issues.push({
          message: 'OpenAPI component entry must be an object, array, or boolean schema.',
          sourcePointer: pointer,
        })
        continue
      }

      fragments.push(createOpenApiSourceFragment({
        kind: componentSectionKind(section),
        ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
        sourcePointer: pointer,
        content,
        metadata: mergeMetadata(options.metadata, {
          componentSection: section,
          name,
        }),
      }))
    }
  }
}

const OPENAPI_OPERATION_METHODS = [
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

const COMPONENT_SECTION_KINDS: Record<string, string> = {
  schemas: 'schema',
  responses: 'response',
  parameters: 'parameter',
  examples: 'example',
  requestBodies: 'requestBody',
  headers: 'header',
  securitySchemes: 'securityScheme',
  links: 'link',
  callbacks: 'callback',
  pathItems: 'pathItem',
  mediaTypes: 'mediaType',
}

function sortedOpenApiOperationMethods(pathItem: Record<string, unknown>): string[] {
  return OPENAPI_OPERATION_METHODS.filter(method => isRecord(pathItem[method]))
}

function componentSectionKind(section: string): string {
  return COMPONENT_SECTION_KINDS[section] ?? `component:${section}`
}

function isOpenApiComponentContent(section: string, content: unknown): boolean {
  return isRecord(content) || Array.isArray(content) || (section === 'schemas' && typeof content === 'boolean')
}

function sortedEntries(record: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
}

function pointerChild(pointer: string, token: string): string {
  return pointer === '#'
    ? `#/${encodePointerToken(token)}`
    : `${pointer}/${encodePointerToken(token)}`
}

function encodePointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function mergeMetadata(
  base: OpenApiSourceFragmentMetadata | undefined,
  extension: OpenApiSourceFragmentMetadata,
): OpenApiSourceFragmentMetadata {
  return base === undefined ? extension : { ...base, ...extension }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return 'null'
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`

  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined && typeof child !== 'function' && typeof child !== 'symbol')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`
}
