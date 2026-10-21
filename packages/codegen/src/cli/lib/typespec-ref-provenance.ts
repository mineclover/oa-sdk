import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { parse, SyntaxKind } from '@typespec/compiler/ast'
import { escapeJsonPointerToken, resolveRefGraph, unescapeJsonPointerToken, type OasDocument } from '@oa-sdk/parser'
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
    | 'typespec-provenance/duplicate-declaration-id'
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
  diagnostics.push(...findDuplicateDeclarationIds(declarations))
  const edges: TypeSpecRefProvenanceEdge[] = []
  const pointerOwners = new Map<string, string>()

  const models = declarations.filter((declaration): declaration is SourceDeclaration & { kind: 'model' } => declaration.kind === 'model')
  for (const model of models) {
    const pointer = `#/components/schemas/${escapeJsonPointerToken(model.symbol)}`
    if (!hasPointer(input.restoredDocument, pointer)) continue
    addEdge(edges, { kind: 'emits', declarationId: model.id, outputPointer: pointer })
    pointerOwners.set(pointer, model.id)
  }
  for (const model of models) {
    if (!nativeSecuritySchemeDeclarationIds.has(model.id)) continue
    const pointer = `#/components/securitySchemes/${escapeJsonPointerToken(model.symbol)}`
    if (!hasPointer(input.restoredDocument, pointer)) continue
    addEdge(edges, { kind: 'emits', declarationId: model.id, outputPointer: pointer })
    pointerOwners.set(pointer, model.id)
  }

  const operations = declarations.filter((declaration): declaration is SourceDeclaration & { kind: 'operation' } => declaration.kind === 'operation')
  const operationsById = new Map<string, SourceDeclaration[]>()
  for (const operation of operations) {
    const keys = new Set<string>([operation.operationId ?? operation.symbol])
    if (operation.alternateOperationId) {
      keys.add(operation.alternateOperationId)
    }
    for (const key of keys) {
      const current = operationsById.get(key) ?? []
      current.push(operation)
      operationsById.set(key, current)
    }
  }
  const outputOperations = listOutputOperations(input.restoredDocument)
  // Kept apart from `pointerOwners`: a sidecar restore that targets the
  // operation pointer itself replaces that entry below, but must not change
  // which operation declaration owns the path item's shared parameters.
  const operationOwners = new Map<string, string>()
  for (const output of outputOperations) {
    const candidates = operationsById.get(output.operationId) ?? []
    if (candidates.length === 1) {
      const declaration = candidates[0]!
      addEdge(edges, { kind: 'emits', declarationId: declaration.id, outputPointer: output.pointer })
      pointerOwners.set(output.pointer, declaration.id)
      operationOwners.set(output.pointer, declaration.id)
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

  const pathParameterOwners = listPathParameterOwners(input.restoredDocument, operationOwners)
  const findRefOwners = (pointer: string): readonly string[] => {
    const owner = findOwner(pointer, pointerOwners)
    return owner ? [owner] : findPathParameterOwners(pointer, pathParameterOwners)
  }

  const refGraph = resolveRefGraph(input.restoredDocument)
  for (const node of refGraph.nodes) {
    const owners = findRefOwners(node.sourcePointer)
    if (owners.length === 0) {
      diagnostics.push({
        code: 'typespec-provenance/missing-ref-owner',
        pointer: node.sourcePointer,
        message: `OpenAPI $ref ${JSON.stringify(node.ref)} has no owning TypeSpec declaration.`,
      })
      continue
    }
    for (const owner of owners) {
      addEdge(edges, {
        kind: 'references',
        declarationId: owner,
        outputPointer: node.sourcePointer,
        targetRef: node.ref,
      })
    }
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
  const coveredRefNodes = refGraph.nodes.filter(node => findRefOwners(node.sourcePointer).length > 0).length
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
  alternateOperationId?: string
  /**
   * Operations: the name qualified by the enclosing interface (`Users.list`), unique per file.
   * Extensions: the `ownerKey` of the operation they decorate, or `root`.
   */
  ownerKey?: string
  sourceOffset: number
  sourceEnd: number
}

function collectDeclarations(sourceRoot: string, filePath: string): {
  declarations: SourceDeclaration[]
  diagnostics: TypeSpecRefProvenanceDiagnostic[]
  nativeSecuritySchemeDeclarationIds: string[]
} {
  const content = readFileSync(filePath, 'utf8')
  const parsed: unknown = parse(content)
  const ast = isRecord(parsed) && Array.isArray(parsed.statements)
    ? { statements: parsed.statements.filter(isRecord) }
    : { statements: [] }
  const declarations: SourceDeclaration[] = []
  const diagnostics: TypeSpecRefProvenanceDiagnostic[] = []
  const nativeSecuritySchemeDeclarationIds: string[] = []
  const relativePath = relative(sourceRoot, filePath).replaceAll('\\', '/')

  const visitStatements = (
    statements: Array<Record<string, unknown>> | undefined,
    enclosingInterface?: string,
  ): void => {
    for (const statement of statements ?? []) {
      const kind = statement.kind
      const id = readIdentifier(statement.id)
      const pos = typeof statement.pos === 'number' ? statement.pos : 0
      const end = typeof statement.end === 'number' ? statement.end : pos

      if (kind === SyntaxKind.NamespaceStatement && Array.isArray(statement.statements)) {
        visitStatements(statement.statements as Array<Record<string, unknown>>, enclosingInterface)
        continue
      }
      if (kind === SyntaxKind.InterfaceStatement && Array.isArray(statement.operations)) {
        visitStatements(statement.operations as Array<Record<string, unknown>>, id ?? enclosingInterface)
        continue
      }

      if (
        kind !== SyntaxKind.OperationStatement
        && kind !== SyntaxKind.ModelStatement
        && kind !== SyntaxKind.AliasStatement
        && kind !== SyntaxKind.ScalarStatement
        && kind !== SyntaxKind.UnionStatement
        && kind !== SyntaxKind.EnumStatement
      ) continue
      if (!id) continue
      const source = createSourceRange(content, relativePath, pos, end)
      if (kind !== SyntaxKind.OperationStatement) {
        const declarationPrefix = kind === SyntaxKind.ModelStatement
          ? 'model'
          : kind === SyntaxKind.AliasStatement
            ? 'alias'
            : kind === SyntaxKind.ScalarStatement
              ? 'scalar'
              : kind === SyntaxKind.EnumStatement
                ? 'enum'
              : 'union'
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
      const explicitOperationId = readStringDecorator(body, 'operationId')
      const defaultOperationId = enclosingInterface ? `${enclosingInterface}_${id}` : id
      // Interfaces may reuse an operation name (`Users.list`, `Orders.list`), so the declaration
      // id carries the interface; `symbol` stays the operation's own name.
      const ownerKey = enclosingInterface ? `${enclosingInterface}.${id}` : id
      declarations.push({
        id: `operation:${relativePath}:${ownerKey}`,
        kind: 'operation',
        symbol: id,
        ownerKey,
        operationId: explicitOperationId ?? defaultOperationId,
        ...(!explicitOperationId && enclosingInterface ? { alternateOperationId: id } : {}),
        source,
        sourceOffset: pos,
        sourceEnd: end,
      })
    }
  }

  visitStatements(ast.statements)

  const operationByRange = declarations.filter(declaration => declaration.kind === 'operation')
  const extensionPattern = /@extension\(\s*"(x-oa-sdk-[^"]+)"/g
  for (let match = extensionPattern.exec(content); match; match = extensionPattern.exec(content)) {
    const extensionName = match[1]
    if (!extensionName) continue
    if (!RESTORE_EXTENSION_NAMES.has(extensionName)) continue
    const offset = match.index
    const owner = operationByRange.find(operation => offset >= operation.sourceOffset && offset < operation.sourceEnd)
    const location = createSourceRange(content, relativePath, offset, offset + match[0].length)
    const scope = owner?.ownerKey ?? 'root'
    const ordinal = declarations.filter(declaration => declaration.kind === 'extension' && declaration.source.file === relativePath && declaration.extensionName === extensionName && declaration.ownerKey === scope).length
    declarations.push({
      id: `extension:${relativePath}:${scope}:${extensionName}:${ordinal}`,
      kind: 'extension',
      symbol: owner ? owner.symbol : 'root',
      ownerKey: scope,
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
    const scope = owner.ownerKey ?? owner.symbol
    const ordinal = declarations.filter(declaration => declaration.kind === 'extension' && declaration.source.file === relativePath && declaration.extensionName === extensionName && declaration.ownerKey === scope && declaration.restoreKey === restoreKey).length
    declarations.push({
      id: `extension:${relativePath}:${scope}:${extensionName}:${restoreKey}:${ordinal}`,
      kind: 'extension',
      symbol: owner.symbol,
      ownerKey: scope,
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
    const path = unescapeJsonPointerToken(pathMatch[1]!)
    const method = pathMatch[2]!
    const output = outputOperations.find(item => item.path === path && item.method === method)
    const operation = output ? operations.find(item => (item.operationId ?? item.symbol) === output.operationId) : undefined
    const candidates = operation
      ? extensions.filter(item => item.extensionName === extensionName && item.ownerKey === operation.ownerKey && item.source.file === operation.source.file)
      : []
    if (entry.kind === 'operation-response-ref') {
      const statusCode = String((entry.target as Record<string, unknown>).statusCode)
      const keyed = candidates.filter(item => item.restoreKey === statusCode)
      if (keyed.length > 0) return keyed
    }
    return candidates
  }
  return extensions.filter(item => item.extensionName === extensionName && item.ownerKey === 'root')
}

type OutputOperation = { operationId: string; path: string; method: string; pointer: string }

function listOutputOperations(document: OasDocument): OutputOperation[] {
  const documentPaths: unknown = document.paths
  const paths = isRecord(documentPaths) ? documentPaths : {}
  const result: OutputOperation[] = []
  for (const [path, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue)) continue
    for (const [method, operation] of Object.entries(pathValue)) {
      if (!HTTP_METHODS.has(method) || !isRecord(operation) || typeof operation.operationId !== 'string') continue
      result.push({
        operationId: operation.operationId,
        path,
        method,
        pointer: `#/paths/${escapeJsonPointerToken(path)}/${method}`,
      })
    }
  }
  return result.sort((left, right) => left.pointer.localeCompare(right.pointer))
}

function listPublicPointers(document: OasDocument): string[] {
  const pointers = listOutputOperations(document).map(operation => operation.pointer)
  const documentComponents: unknown = document.components
  const components = isRecord(documentComponents) ? documentComponents : {}
  for (const section of ['schemas', 'parameters', 'responses', 'securitySchemes']) {
    const entries = isRecord(components[section]) ? components[section] : {}
    for (const name of Object.keys(entries)) pointers.push(`#/components/${section}/${escapeJsonPointerToken(name)}`)
  }
  return pointers.sort()
}

/**
 * Owners of each Path Item `parameters` array, keyed by
 * `#/paths/<path>/parameters`. OpenAPI applies Path Item parameters to every
 * operation of the path, and OA's restored-document normalization
 * (`hoistCommonPathParameters` in `typespec-bundle-check.ts`, not the TypeSpec
 * emitter) moves a path parameter there only when every operation of the path
 * declares it identically. A `$ref` inside that array is therefore no
 * descendant of an operation pointer, yet each operation of the path declared
 * it, so it belongs to all of their declarations. The rule fails closed per
 * path item: a path item without operations, or with any operation that has no
 * TypeSpec owner, gets no entry and its parameter refs stay unowned.
 */
function listPathParameterOwners(document: OasDocument, operationOwners: ReadonlyMap<string, string>): Map<string, string[]> {
  const documentPaths: unknown = document.paths
  const paths = isRecord(documentPaths) ? documentPaths : {}
  const result = new Map<string, string[]>()
  for (const [path, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue) || !Array.isArray(pathValue.parameters)) continue
    const pathPointer = `#/paths/${escapeJsonPointerToken(path)}`
    const methods = Object.keys(pathValue).filter(method => HTTP_METHODS.has(method) && isRecord(pathValue[method]))
    const owners = methods.flatMap(method => operationOwners.get(`${pathPointer}/${method}`) ?? [])
    if (methods.length === 0 || owners.length !== methods.length) continue
    result.set(`${pathPointer}/parameters`, [...new Set(owners)].sort())
  }
  return result
}

function sidecarTargetPointer(entry: TypeSpecCompatibilitySidecarEntry): string {
  const target = entry.target as Record<string, unknown>
  if (entry.kind === 'root-info') return '#/info'
  if (entry.kind === 'component-parameter') return `#/components/parameters/${escapeJsonPointerToken(String(target.name))}`
  if (entry.kind === 'component-response') return `#/components/responses/${escapeJsonPointerToken(String(target.name))}`
  if (entry.kind === 'security-scheme') return `#/components/securitySchemes/${escapeJsonPointerToken(String(target.name))}`
  const path = typeof target.path === 'string' ? target.path : ''
  const method = typeof target.method === 'string' ? target.method : undefined
  const operationPointer = `#/paths/${escapeJsonPointerToken(path)}${method ? `/${method}` : ''}`
  if (entry.kind === 'operation-parameter-ref') return `${operationPointer}/parameters/${String(target.index)}`
  if (entry.kind === 'operation-response-ref') return `${operationPointer}/responses/${escapeJsonPointerToken(String(target.statusCode))}`
  if (entry.kind === 'operation-security') return `${operationPointer}/security`
  if (entry.kind === 'request-media-examples') return `${operationPointer}/requestBody/content/${escapeJsonPointerToken(String(target.mediaType))}`
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

function findPathParameterOwners(pointer: string, owners: ReadonlyMap<string, readonly string[]>): readonly string[] {
  // An escaped path token never contains `/`, so the first segment after
  // `#/paths/` is the whole path key.
  const match = /^#\/paths\/[^/]+\/parameters(?=\/|$)/.exec(pointer)
  return match ? owners.get(match[0]) ?? [] : []
}

function hasPointer(document: unknown, pointer: string): boolean {
  const normalized = pointer.replace(/^#\/?/, '')
  if (normalized === '') return true
  let current: unknown = document
  for (const encodedSegment of normalized.split('/')) {
    const segment = unescapeJsonPointerToken(encodedSegment)
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

/**
 * Declarations that share an id would overwrite each other wherever provenance is indexed by
 * id (the trace graph does), giving one declaration's source range to another's output.
 */
function findDuplicateDeclarationIds(declarations: readonly SourceDeclaration[]): TypeSpecRefProvenanceDiagnostic[] {
  const byId = new Map<string, SourceDeclaration[]>()
  for (const declaration of declarations) {
    byId.set(declaration.id, [...(byId.get(declaration.id) ?? []), declaration])
  }
  const diagnostics: TypeSpecRefProvenanceDiagnostic[] = []
  for (const [id, group] of byId) {
    if (group.length < 2) continue
    const locations = group.map(declaration => `${declaration.source.file}:${declaration.source.start.line}`).join(', ')
    diagnostics.push({
      code: 'typespec-provenance/duplicate-declaration-id',
      pointer: id,
      message: `TypeSpec declaration id ${JSON.stringify(id)} is shared by ${group.length} declarations (${locations}).`,
    })
  }
  return diagnostics
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
      const value = PackageIdentitySchema.parse(JSON.parse(readFileSync(packagePath, 'utf8')))
      if (value.name === packageName && value.version !== undefined) return value.version
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`could not resolve ${packageName} package version`)
    directory = parent
  }
}

/** The `name` and `version` of a `package.json`; other members are ignored. */
const PackageIdentitySchema = {
  parse(value: unknown): { name?: string; version?: string } {
    if (!isRecord(value)) throw new TypeError('package.json must be a JSON object')
    return {
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
      ...(typeof value.version === 'string' ? { version: value.version } : {}),
    }
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
