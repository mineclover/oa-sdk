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

function createOpenApiSourceDigest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
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
