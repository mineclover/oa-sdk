import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { parse, SyntaxKind } from '@typespec/compiler/ast'
import { resolveRefGraph, type OasDocument } from '@oa-sdk/parser'
import type { TypeSpecCompatibilitySidecar, TypeSpecCompatibilitySidecarEntry } from './typespec-sidecar.js'

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'])
const RESTORE_EXTENSION_NAMES = new Set([
  'x-oa-sdk-components',
  'x-oa-sdk-info',
  'x-oa-sdk-operation-component-refs',
  'x-oa-sdk-operation-examples',
  'x-oa-sdk-operation-security',
  'x-oa-sdk-security-schemes',
])
const NATIVE_SECURITY_SCHEME_MODELS = new Set([
  'ApiKeyAuth',
  'BasicAuth',
  'BearerAuth',
  'OAuth2Auth',
  'OpenIdConnectAuth',
])
const moduleRequire = createRequire(import.meta.url)

export type TypeSpecRefProvenanceDeclarationKind = 'model' | 'operation' | 'extension'
export type TypeSpecRefProvenanceEdgeKind = 'emits' | 'restores' | 'references'

export type TypeSpecRefProvenanceDeclaration = {
  id: string
  kind: TypeSpecRefProvenanceDeclarationKind
  symbol: string
  source: {
    file: string
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
}

export type TypeSpecRefProvenanceEdge = {
  kind: TypeSpecRefProvenanceEdgeKind
  declarationId: string
  outputPointer: string
  targetRef?: string
  restoreFamily?: string
}

export type TypeSpecRefProvenanceDiagnostic = {
  code:
    | 'typespec-provenance/ambiguous-operation'
    | 'typespec-provenance/ambiguous-restore-source'
    | 'typespec-provenance/missing-output-pointer'
    | 'typespec-provenance/missing-public-owner'
    | 'typespec-provenance/missing-ref-owner'
    | 'typespec-provenance/unresolved-ref'
  pointer: string
  message: string
}

export type TypeSpecRefProvenanceV1 = {
  schemaVersion: 'oa-sdk.typespec-ref-provenance.v1'
  provenanceKind: 'typespec-source-ast'
  inputs: {
    sourceRoot: string
    sourceSha256: string
    restoredOpenApiSha256: string
    toolchainFingerprint: string
  }
  declarations: TypeSpecRefProvenanceDeclaration[]
  edges: TypeSpecRefProvenanceEdge[]
  exclusions: Array<{ pointer: string; reason: string }>
}

export type TypeSpecRefProvenanceReport = {
  schemaVersion: 'oa-sdk.typespec-ref-provenance-report.v1'
  counts: {
    declarations: number
    emitted: number
    restored: number
    references: number
    publicPointers: number
    coveredPublicPointers: number
    refNodes: number
    coveredRefNodes: number
  }
  diagnostics: TypeSpecRefProvenanceDiagnostic[]
  valid: boolean
}

export type TypeSpecRefProvenanceResult = {
  artifact: TypeSpecRefProvenanceV1
  report: TypeSpecRefProvenanceReport
}

/**
 * Builds declaration evidence from the TypeSpec AST and validates it against
 * the restored OpenAPI document. The TypeSpec OpenAPI emitter currently has no
 * public pointer source-map API, so `provenanceKind` deliberately identifies
 * this as source-AST evidence rather than pretending it is emitter metadata.
 */
export function buildTypeSpecRefProvenance(input: {
  sourceRoot: string
  restoredDocument: OasDocument
  sidecar: TypeSpecCompatibilitySidecar
}): TypeSpecRefProvenanceResult {
  const sourceRoot = resolve(input.sourceRoot)
  const sourceFiles = listTypeSpecFiles(sourceRoot)
  const collections = sourceFiles.map(filePath => collectDeclarations(sourceRoot, filePath))
  const declarations = collections.flatMap(collection => collection.declarations).sort(compareDeclarations)
  const nativeSecuritySchemeDeclarationIds = new Set(
    collections.flatMap(collection => collection.nativeSecuritySchemeDeclarationIds),
  )
  const diagnostics: TypeSpecRefProvenanceDiagnostic[] = collections.flatMap(collection => collection.diagnostics)
  const edges: TypeSpecRefProvenanceEdge[] = []
  const pointerOwners = new Map<string, string>()

  const models = declarations.filter((declaration): declaration is SourceDeclaration & { kind: 'model' } => declaration.kind === 'model')
  for (const model of models) {
    const pointer = `#/components/schemas/${escapePointer(model.symbol)}`
    if (!hasPointer(input.restoredDocument, pointer)) continue
    addEdge(edges, { kind: 'emits', declarationId: model.id, outputPointer: pointer })
    pointerOwners.set(pointer, model.id)
  }
  for (const model of models) {
    if (!nativeSecuritySchemeDeclarationIds.has(model.id)) continue
    const pointer = `#/components/securitySchemes/${escapePointer(model.symbol)}`
    if (!hasPointer(input.restoredDocument, pointer)) continue
    addEdge(edges, { kind: 'emits', declarationId: model.id, outputPointer: pointer })
    pointerOwners.set(pointer, model.id)
  }

  const operations = declarations.filter((declaration): declaration is SourceDeclaration & { kind: 'operation' } => declaration.kind === 'operation')
  const operationsById = new Map<string, SourceDeclaration[]>()
  for (const operation of operations) {
    const key = operation.operationId ?? operation.symbol
    const current = operationsById.get(key) ?? []
    current.push(operation)
    operationsById.set(key, current)
  }
  const outputOperations = listOutputOperations(input.restoredDocument)
  for (const output of outputOperations) {
    const candidates = operationsById.get(output.operationId) ?? []
    if (candidates.length === 1) {
      const declaration = candidates[0]!
      addEdge(edges, { kind: 'emits', declarationId: declaration.id, outputPointer: output.pointer })
      pointerOwners.set(output.pointer, declaration.id)
    } else if (candidates.length > 1) {
      diagnostics.push({
        code: 'typespec-provenance/ambiguous-operation',
        pointer: output.pointer,
        message: `OpenAPI operationId ${JSON.stringify(output.operationId)} matches multiple TypeSpec operations.`,
      })
    }
  }

  const extensions = declarations.filter((declaration): declaration is SourceDeclaration & { kind: 'extension' } => declaration.kind === 'extension')
  for (const entry of input.sidecar.entries) {
    const outputPointer = sidecarTargetPointer(entry)
    const candidates = findRestoreDeclarations(entry, outputPointer, extensions, operations, outputOperations)
    if (candidates.length === 1) {
      const declaration = candidates[0]!
      const restoreFamily = extensionNameFromPointer(entry.pointer)
      addEdge(edges, {
        kind: 'restores',
        declarationId: declaration.id,
        outputPointer,
        ...(restoreFamily ? { restoreFamily } : {}),
      })
      pointerOwners.set(outputPointer, declaration.id)
    } else {
      diagnostics.push({
        code: 'typespec-provenance/ambiguous-restore-source',
        pointer: outputPointer,
        message: `Could not identify one TypeSpec extension declaration for ${entry.kind} restored from ${entry.pointer}.`,
      })
    }
  }

  const publicPointers = listPublicPointers(input.restoredDocument)
  for (const pointer of publicPointers) {
    if (findOwner(pointer, pointerOwners)) continue
    diagnostics.push({
      code: 'typespec-provenance/missing-public-owner',
      pointer,
      message: 'Public OpenAPI operation or reusable component has no TypeSpec declaration owner.',
    })
  }

  const refGraph = resolveRefGraph(input.restoredDocument)
  for (const node of refGraph.nodes) {
    const owner = findOwner(node.sourcePointer, pointerOwners)
    if (!owner) {
      diagnostics.push({
        code: 'typespec-provenance/missing-ref-owner',
        pointer: node.sourcePointer,
        message: `OpenAPI $ref ${JSON.stringify(node.ref)} has no owning TypeSpec declaration.`,
      })
      continue
    }
    addEdge(edges, {
      kind: 'references',
      declarationId: owner,
      outputPointer: node.sourcePointer,
      targetRef: node.ref,
    })
    if (!node.resolved) {
      diagnostics.push({
        code: 'typespec-provenance/unresolved-ref',
        pointer: node.sourcePointer,
        message: `OpenAPI $ref ${JSON.stringify(node.ref)} could not be resolved.`,
      })
    }
  }

  for (const edge of edges) {
    if (!hasPointer(input.restoredDocument, stripRefLeaf(edge.outputPointer))) {
      diagnostics.push({
        code: 'typespec-provenance/missing-output-pointer',
        pointer: edge.outputPointer,
        message: `Provenance edge ${edge.kind} targets an absent restored OpenAPI pointer.`,
      })
    }
  }

  const deduplicatedEdges = dedupeEdges(edges)
  const sourceDigest = createHash('sha256')
  for (const filePath of sourceFiles) {
    sourceDigest.update(relative(sourceRoot, filePath).replaceAll('\\', '/'))
    sourceDigest.update('\0')
    sourceDigest.update(readFileSync(filePath))
    sourceDigest.update('\0')
  }
  const artifact: TypeSpecRefProvenanceV1 = {
    schemaVersion: 'oa-sdk.typespec-ref-provenance.v1',
    provenanceKind: 'typespec-source-ast',
    inputs: {
      sourceRoot: '.',
      sourceSha256: sourceDigest.digest('hex'),
      restoredOpenApiSha256: sha256(stableStringify(input.restoredDocument)),
      toolchainFingerprint: getTypeSpecProvenanceToolchainFingerprint(),
    },
    declarations,
    edges: deduplicatedEdges,
    exclusions: [],
  }
  const coveredPublicPointers = publicPointers.filter(pointer => Boolean(findOwner(pointer, pointerOwners))).length
  const coveredRefNodes = refGraph.nodes.filter(node => Boolean(findOwner(node.sourcePointer, pointerOwners))).length
  const report: TypeSpecRefProvenanceReport = {
    schemaVersion: 'oa-sdk.typespec-ref-provenance-report.v1',
    counts: {
      declarations: declarations.length,
      emitted: deduplicatedEdges.filter(edge => edge.kind === 'emits').length,
      restored: deduplicatedEdges.filter(edge => edge.kind === 'restores').length,
      references: deduplicatedEdges.filter(edge => edge.kind === 'references').length,
      publicPointers: publicPointers.length,
      coveredPublicPointers,
      refNodes: refGraph.nodes.length,
      coveredRefNodes,
    },
    diagnostics: dedupeDiagnostics(diagnostics),
    valid: diagnostics.length === 0,
  }
  return { artifact, report: { ...report, valid: report.diagnostics.length === 0 } }
}

type SourceDeclaration = TypeSpecRefProvenanceDeclaration & {
  extensionName?: string
  restoreKey?: string
  operationId?: string
  sourceOffset: number
  sourceEnd: number
}

function collectDeclarations(sourceRoot: string, filePath: string): {
  declarations: SourceDeclaration[]
  diagnostics: TypeSpecRefProvenanceDiagnostic[]
  nativeSecuritySchemeDeclarationIds: string[]
} {
  const content = readFileSync(filePath, 'utf8')
  const ast = parse(content) as unknown as { statements?: Array<Record<string, unknown>> }
  const declarations: SourceDeclaration[] = []
  const diagnostics: TypeSpecRefProvenanceDiagnostic[] = []
  const nativeSecuritySchemeDeclarationIds: string[] = []
  const relativePath = relative(sourceRoot, filePath).replaceAll('\\', '/')
  for (const statement of ast.statements ?? []) {
    const kind = statement.kind
    const id = readIdentifier(statement.id)
    const pos = typeof statement.pos === 'number' ? statement.pos : 0
    const end = typeof statement.end === 'number' ? statement.end : pos
    if (
      kind !== SyntaxKind.OperationStatement
      && kind !== SyntaxKind.ModelStatement
      && kind !== SyntaxKind.AliasStatement
      && kind !== SyntaxKind.ScalarStatement
    ) continue
    if (!id) continue
    const source = createSourceRange(content, relativePath, pos, end)
    if (kind !== SyntaxKind.OperationStatement) {
      const declarationPrefix = kind === SyntaxKind.ModelStatement
        ? 'model'
        : kind === SyntaxKind.AliasStatement
          ? 'alias'
          : 'scalar'
      const declarationId = `${declarationPrefix}:${relativePath}:${id}`
      declarations.push({
        id: declarationId,
        kind: 'model',
        symbol: id,
        source,
        sourceOffset: pos,
        sourceEnd: end,
      })
      if (kind === SyntaxKind.ModelStatement) {
        const modelIs = isRecord(statement.is) ? statement.is : undefined
        const target = modelIs && isRecord(modelIs.target) ? modelIs.target : undefined
        const nativeModelName = target
          ? readIdentifier(target.id) ?? readIdentifier(target)
          : undefined
        if (nativeModelName && NATIVE_SECURITY_SCHEME_MODELS.has(nativeModelName)) {
          nativeSecuritySchemeDeclarationIds.push(declarationId)
        }
      }
      continue
    }
    const body = content.slice(pos, end)
    declarations.push({
      id: `operation:${relativePath}:${id}`,
      kind: 'operation',
      symbol: id,
      operationId: readStringDecorator(body, 'operationId') ?? id,
      source,
      sourceOffset: pos,
      sourceEnd: end,
    })
  }

  const operationByRange = declarations.filter(declaration => declaration.kind === 'operation')
  const extensionPattern = /@extension\(\s*"(x-oa-sdk-[^"]+)"/g
  for (let match = extensionPattern.exec(content); match; match = extensionPattern.exec(content)) {
    const extensionName = match[1]
    if (!extensionName) continue
    if (!RESTORE_EXTENSION_NAMES.has(extensionName)) continue
    const offset = match.index
    const owner = operationByRange.find(operation => offset >= operation.sourceOffset && offset < operation.sourceEnd)
    const location = createSourceRange(content, relativePath, offset, offset + match[0].length)
    const scope = owner ? owner.symbol : 'root'
    const ordinal = declarations.filter(declaration => declaration.kind === 'extension' && declaration.source.file === relativePath && declaration.extensionName === extensionName && declaration.symbol === scope).length
    declarations.push({
      id: `extension:${relativePath}:${scope}:${extensionName}:${ordinal}`,
      kind: 'extension',
      symbol: scope,
      extensionName,
      source: location,
      sourceOffset: offset,
      sourceEnd: offset + match[0].length,
    })
  }
  const responseComponentPattern = /@oaUseResponseComponent\(\s*"([^"\n]+)"/g
  for (let match = responseComponentPattern.exec(content); match; match = responseComponentPattern.exec(content)) {
    const restoreKey = match[1]
    if (!restoreKey) continue
    const offset = match.index
    const owner = operationByRange.find(operation => offset >= operation.sourceOffset && offset < operation.sourceEnd)
    if (!owner) continue
    const extensionName = 'x-oa-sdk-operation-component-refs'
    const location = createSourceRange(content, relativePath, offset, offset + match[0].length)
    const ordinal = declarations.filter(declaration => declaration.kind === 'extension' && declaration.source.file === relativePath && declaration.extensionName === extensionName && declaration.symbol === owner.symbol && declaration.restoreKey === restoreKey).length
    declarations.push({
      id: `extension:${relativePath}:${owner.symbol}:${extensionName}:${restoreKey}:${ordinal}`,
      kind: 'extension',
      symbol: owner.symbol,
      extensionName,
      restoreKey,
      source: location,
      sourceOffset: offset,
      sourceEnd: offset + match[0].length,
    })
  }
  return { declarations, diagnostics, nativeSecuritySchemeDeclarationIds }
}

function findRestoreDeclarations(
  entry: TypeSpecCompatibilitySidecarEntry,
  outputPointer: string,
  extensions: SourceDeclaration[],
  operations: SourceDeclaration[],
  outputOperations: OutputOperation[],
): SourceDeclaration[] {
  const extensionName = extensionNameFromPointer(entry.pointer)
  if (!extensionName) return []
  const pathMatch = /^#\/paths\/([^/]+)\/([^/]+)/.exec(entry.pointer)
  if (pathMatch) {
    const path = unescapePointer(pathMatch[1]!)
    const method = pathMatch[2]!
    const output = outputOperations.find(item => item.path === path && item.method === method)
    const operation = output ? operations.find(item => (item.operationId ?? item.symbol) === output.operationId) : undefined
    const candidates = extensions.filter(item => item.extensionName === extensionName && item.symbol === operation?.symbol)
    if (entry.kind === 'operation-response-ref') {
      const statusCode = String((entry.target as Record<string, unknown>).statusCode)
      const keyed = candidates.filter(item => item.restoreKey === statusCode)
      if (keyed.length > 0) return keyed
    }
    return candidates
  }
  return extensions.filter(item => item.extensionName === extensionName && item.symbol === 'root')
}

type OutputOperation = { operationId: string; path: string; method: string; pointer: string }

function listOutputOperations(document: OasDocument): OutputOperation[] {
  const documentRecord = document as unknown as Record<string, unknown>
  const paths = isRecord(documentRecord.paths) ? documentRecord.paths : {}
  const result: OutputOperation[] = []
  for (const [path, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue)) continue
    for (const [method, operation] of Object.entries(pathValue)) {
      if (!HTTP_METHODS.has(method) || !isRecord(operation) || typeof operation.operationId !== 'string') continue
      result.push({
        operationId: operation.operationId,
        path,
        method,
        pointer: `#/paths/${escapePointer(path)}/${method}`,
      })
    }
  }
  return result.sort((left, right) => left.pointer.localeCompare(right.pointer))
}

function listPublicPointers(document: OasDocument): string[] {
  const documentRecord = document as unknown as Record<string, unknown>
  const pointers = listOutputOperations(document).map(operation => operation.pointer)
  const components = isRecord(documentRecord.components) ? documentRecord.components : {}
  for (const section of ['schemas', 'parameters', 'responses', 'securitySchemes']) {
    const entries = isRecord(components[section]) ? components[section] : {}
    for (const name of Object.keys(entries)) pointers.push(`#/components/${section}/${escapePointer(name)}`)
  }
  return pointers.sort()
}

function sidecarTargetPointer(entry: TypeSpecCompatibilitySidecarEntry): string {
  const target = entry.target as Record<string, unknown>
  if (entry.kind === 'root-info') return '#/info'
  if (entry.kind === 'component-parameter') return `#/components/parameters/${escapePointer(String(target.name))}`
  if (entry.kind === 'component-response') return `#/components/responses/${escapePointer(String(target.name))}`
  if (entry.kind === 'security-scheme') return `#/components/securitySchemes/${escapePointer(String(target.name))}`
  const path = typeof target.path === 'string' ? target.path : ''
  const method = typeof target.method === 'string' ? target.method : undefined
  const operationPointer = `#/paths/${escapePointer(path)}${method ? `/${method}` : ''}`
  if (entry.kind === 'operation-parameter-ref') return `${operationPointer}/parameters/${String(target.index)}`
  if (entry.kind === 'operation-response-ref') return `${operationPointer}/responses/${escapePointer(String(target.statusCode))}`
  if (entry.kind === 'operation-security') return `${operationPointer}/security`
  if (entry.kind === 'request-media-examples') return `${operationPointer}/requestBody/content/${escapePointer(String(target.mediaType))}`
  if (entry.kind === 'response-media-examples' || entry.kind === 'parameter-examples') return operationPointer
  return operationPointer
}

function extensionNameFromPointer(pointer: string): string | undefined {
  const match = /\/(x-oa-sdk-[^/]+)(?:\/|$)/.exec(pointer)
  return match?.[1]
}

function findOwner(pointer: string, owners: Map<string, string>): string | undefined {
  return [...owners.entries()]
    .filter(([candidate]) => pointer === candidate || pointer.startsWith(`${candidate}/`))
    .sort(([left], [right]) => right.length - left.length)[0]?.[1]
}

function hasPointer(document: unknown, pointer: string): boolean {
  const normalized = pointer.replace(/^#\/?/, '')
  if (normalized === '') return true
  let current: unknown = document
  for (const encodedSegment of normalized.split('/')) {
    const segment = unescapePointer(encodedSegment)
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return false
      current = current[index]
      continue
    }
    if (!isRecord(current) || !(segment in current)) return false
    current = current[segment]
  }
  return true
}

function stripRefLeaf(pointer: string): string {
  return pointer.endsWith('/$ref') ? pointer.slice(0, -5) : pointer
}

function addEdge(edges: TypeSpecRefProvenanceEdge[], edge: TypeSpecRefProvenanceEdge): void {
  edges.push(edge)
}

function dedupeEdges(edges: TypeSpecRefProvenanceEdge[]): TypeSpecRefProvenanceEdge[] {
  const unique = new Map<string, TypeSpecRefProvenanceEdge>()
  for (const edge of edges) {
    unique.set(JSON.stringify(edge), edge)
  }
  return [...unique.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

function dedupeDiagnostics(diagnostics: TypeSpecRefProvenanceDiagnostic[]): TypeSpecRefProvenanceDiagnostic[] {
  const unique = new Map<string, TypeSpecRefProvenanceDiagnostic>()
  for (const diagnostic of diagnostics) unique.set(`${diagnostic.code}:${diagnostic.pointer}:${diagnostic.message}`, diagnostic)
  return [...unique.values()].sort((left, right) => `${left.code}:${left.pointer}`.localeCompare(`${right.code}:${right.pointer}`))
}

function compareDeclarations(left: TypeSpecRefProvenanceDeclaration, right: TypeSpecRefProvenanceDeclaration): number {
  return left.id.localeCompare(right.id)
}

function readIdentifier(value: unknown): string | undefined {
  return isRecord(value) && typeof value.sv === 'string' ? value.sv : undefined
}

function readStringDecorator(body: string, name: string): string | undefined {
  return new RegExp(`@${name}\\(\\s*"([^"\\n]+)"\\s*\\)`).exec(body)?.[1]
}

function createSourceRange(content: string, file: string, startOffset: number, endOffset: number): TypeSpecRefProvenanceDeclaration['source'] {
  return {
    file,
    start: offsetToLineColumn(content, startOffset),
    end: offsetToLineColumn(content, endOffset),
  }
}

function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, Math.max(0, offset))
  const line = before.split('\n').length
  const previousNewline = before.lastIndexOf('\n')
  return { line, column: offset - (previousNewline + 1) + 1 }
}

function listTypeSpecFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.tsp')) files.push(path)
    }
  }
  visit(root)
  return files.sort()
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function getTypeSpecProvenanceToolchainFingerprint(): string {
  return sha256(JSON.stringify({
    extractor: 'oa-sdk.typespec-source-ast-provenance.v1',
    compiler: resolvePackageVersion('@typespec/compiler'),
    openapi3: resolvePackageVersion('@typespec/openapi3'),
  }))
}

function resolvePackageVersion(packageName: string): string {
  let directory = dirname(moduleRequire.resolve(packageName))
  while (true) {
    const packagePath = resolve(directory, 'package.json')
    if (existsSync(packagePath)) {
      const value = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: unknown; version?: unknown }
      if (value.name === packageName && typeof value.version === 'string') return value.version
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`could not resolve ${packageName} package version`)
    directory = parent
  }
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function unescapePointer(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
