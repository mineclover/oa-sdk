import type { z } from 'zod'
import {
  OPENAPI_PROJECTION_PROFILE_EXTENSION,
  OPENAPI_PROJECTION_REFS_EXTENSION,
  OPENAPI_PROJECTION_SOURCES_EXTENSION,
  OPENAPI_PROJECTION_VERSION_HASH_EXTENSION,
} from '@oa-sdk/openapi-projection-contract'
import type { ExtractedTable } from '../../drizzle/extractor.js'
import {
  convertTables,
  type DrizzleSchemaType,
} from '../../drizzle/converter.js'
import type { TableNaming } from '../../drizzle/naming.js'
import { zodToSchema } from '../../zod-to-schema.js'
import {
  collectOpenApiDocumentSourceFragments,
  createOpenApiSourceAdapterDiagnostic,
  createOpenApiSourceFragment,
  type OpenApiSourceAdapterDiagnostic,
  type OpenApiSourceFragment,
  type OpenApiSourceFragmentMetadata,
} from './openapi-source-fragments.js'

type JsonRecord = Record<string, unknown>

export type CodegenSourceAdapterResult<
  TDiagnostic extends OpenApiSourceAdapterDiagnostic = OpenApiSourceAdapterDiagnostic,
> = {
  fragments: OpenApiSourceFragment[]
  diagnostics: TDiagnostic[]
}

export type CodegenSourceAdapterOptions = {
  sourcePath?: string
  sourcePointerBase?: string
  metadata?: OpenApiSourceFragmentMetadata
}

export type ZodSchemaSourceAdapterOptions = CodegenSourceAdapterOptions
export type DrizzleTableSourceAdapterOptions = CodegenSourceAdapterOptions
export type OpenApiProjectionEnvelopeAdapterOptions = CodegenSourceAdapterOptions
export type PythonContractSpecSnapshotAdapterOptions = CodegenSourceAdapterOptions

export type OpenApiProjectionEnvelopeAdapterDiagnostic =
  OpenApiSourceAdapterDiagnostic<'openapi-projection-envelope/invalid-envelope', 'error'>

export type PythonContractSpecSnapshotAdapterDiagnostic =
  OpenApiSourceAdapterDiagnostic<'python-contract-spec/invalid-snapshot', 'error'>

export function adaptZodSchemas(
  schemas: Record<string, z.ZodTypeAny>,
  options: ZodSchemaSourceAdapterOptions = {},
): CodegenSourceAdapterResult {
  const refs = new Map<z.ZodTypeAny, string>()
  for (const [name, schema] of Object.entries(schemas)) {
    refs.set(schema, name)
  }
  const context = { refs }
  const pointerBase = options.sourcePointerBase ?? '#/schemas'

  return {
    fragments: Object.entries(schemas)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, schema]) => createOpenApiSourceFragment({
        kind: 'schema',
        ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
        sourcePointer: pointerChild(pointerBase, name),
        content: zodToSchema(schema, context),
        metadata: mergeMetadata(options.metadata, {
          sourceAdapter: 'zod',
          schemaName: name,
        }),
      })),
    diagnostics: [],
  }
}

export async function adaptDrizzleTables(
  tables: ExtractedTable[],
  schemaTypes: DrizzleSchemaType[],
  naming: TableNaming,
  options: DrizzleTableSourceAdapterOptions = {},
): Promise<CodegenSourceAdapterResult> {
  const dialectByTable = new Map(tables.map(table => [table.sqlName, table.dialect]))
  const schemas = await convertTables(tables, schemaTypes, naming)
  const pointerBase = options.sourcePointerBase ?? '#/tables'

  return {
    fragments: schemas
      .map(schema => createOpenApiSourceFragment({
        kind: 'schema',
        ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
        sourcePointer: pointerChild(pointerChild(pointerChild(pointerBase, schema.sourceTable), 'schemas'), schema.schemaType),
        content: schema.schema,
        metadata: mergeMetadata(options.metadata, {
          sourceAdapter: 'drizzle',
          table: schema.sourceTable,
          schemaType: schema.schemaType,
          componentName: schema.name,
          ...(dialectByTable.get(schema.sourceTable) !== undefined
            ? { dialect: dialectByTable.get(schema.sourceTable) }
            : {}),
        }),
      }))
      .sort(compareFragments),
    diagnostics: [],
  }
}

export function adaptOpenApiProjectionEnvelope(
  envelope: unknown,
  options: OpenApiProjectionEnvelopeAdapterOptions = {},
): CodegenSourceAdapterResult<OpenApiProjectionEnvelopeAdapterDiagnostic> {
  const sourcePath = diagnosticSourcePath(options.sourcePath, 'openapi-projection-envelope')
  const pointerBase = options.sourcePointerBase ?? '#'
  const diagnostics: OpenApiProjectionEnvelopeAdapterDiagnostic[] = []

  if (!isRecord(envelope)) {
    diagnostics.push(openApiProjectionEnvelopeDiagnostic(sourcePath, 'OpenAPI projection envelope must be an object.', pointerBase))
    return { fragments: [], diagnostics }
  }

  const projection = envelope.projection
  const projectionPointer = pointerChild(pointerBase, 'projection')
  if (!isRecord(projection)) {
    diagnostics.push(openApiProjectionEnvelopeDiagnostic(
      sourcePath,
      'OpenAPI projection envelope must declare an object projection.',
      projectionPointer,
    ))
    return { fragments: [], diagnostics }
  }

  const envelopeMetadata = mergeMetadata(options.metadata, projectionEnvelopeMetadata(envelope))
  const rootFragment = createOpenApiSourceFragment({
    kind: 'openapi-projection',
    ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
    sourcePointer: projectionPointer,
    content: projection,
    metadata: envelopeMetadata,
  })
  const collected = collectOpenApiDocumentSourceFragments(projection, {
    ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
    sourcePointerBase: projectionPointer,
    metadata: envelopeMetadata,
  })
  for (const issue of collected.issues) {
    diagnostics.push(openApiProjectionEnvelopeDiagnostic(sourcePath, issue.message, issue.sourcePointer))
  }

  return {
    fragments: [rootFragment, ...collected.fragments],
    diagnostics,
  }
}

export function adaptPythonContractSpecSnapshot(
  snapshotOrContract: unknown,
  options: PythonContractSpecSnapshotAdapterOptions = {},
): CodegenSourceAdapterResult<PythonContractSpecSnapshotAdapterDiagnostic> {
  const sourcePath = diagnosticSourcePath(options.sourcePath, 'python-contract-spec')
  const pointerBase = options.sourcePointerBase ?? '#'
  const diagnostics: PythonContractSpecSnapshotAdapterDiagnostic[] = []

  if (!isRecord(snapshotOrContract)) {
    diagnostics.push(pythonContractSpecDiagnostic(sourcePath, 'Python ContractSpec snapshot must be an object.', pointerBase))
    return { fragments: [], diagnostics }
  }

  const snapshotMetadata = readPythonSnapshotMetadata(snapshotOrContract)
  const contractPointer = snapshotMetadata.snapshotFormat === 'oa-contract-snapshot'
    ? pointerChild(pointerBase, 'contract')
    : pointerBase
  const contract = snapshotMetadata.snapshotFormat === 'oa-contract-snapshot'
    ? snapshotOrContract.contract
    : snapshotOrContract
  if (!isRecord(contract)) {
    diagnostics.push(pythonContractSpecDiagnostic(
      sourcePath,
      'Python ContractSpec snapshot must declare an object contract.',
      contractPointer,
    ))
    return { fragments: [], diagnostics }
  }

  const metadata = mergeMetadata(options.metadata, {
    sourceAdapter: 'python-contract-spec-snapshot',
    ...snapshotMetadata,
    ...(typeof contract.name === 'string' ? { contractName: contract.name } : {}),
    ...(typeof contract.version === 'string' ? { contractVersion: contract.version } : {}),
  })
  const fragments: OpenApiSourceFragment[] = []

  collectPythonContractSchemas(contract.schemas, pointerChild(contractPointer, 'schemas'), options, metadata, fragments, diagnostics)
  collectPythonContractEndpoints(contract.endpoints, pointerChild(contractPointer, 'endpoints'), options, metadata, fragments, diagnostics)
  collectPythonContractRecord(
    contract.security_schemes,
    pointerChild(contractPointer, 'security_schemes'),
    'securityScheme',
    'securitySchemeName',
    options,
    metadata,
    fragments,
    diagnostics,
  )
  collectPythonContractRecord(
    contract.standard_error_responses,
    pointerChild(contractPointer, 'standard_error_responses'),
    'response',
    'responseName',
    options,
    metadata,
    fragments,
    diagnostics,
  )
  collectPythonContractRecord(
    contract.examples,
    pointerChild(contractPointer, 'examples'),
    'example',
    'exampleName',
    options,
    metadata,
    fragments,
    diagnostics,
  )
  collectPythonContractTargets(contract.targets, pointerChild(contractPointer, 'targets'), options, metadata, fragments, diagnostics)

  return {
    fragments: fragments.sort(compareFragments),
    diagnostics,
  }
}

function collectPythonContractSchemas(
  schemas: unknown,
  pointer: string,
  options: PythonContractSpecSnapshotAdapterOptions,
  metadata: OpenApiSourceFragmentMetadata,
  fragments: OpenApiSourceFragment[],
  diagnostics: PythonContractSpecSnapshotAdapterDiagnostic[],
): void {
  if (schemas === undefined) return
  if (!isRecord(schemas)) {
    diagnostics.push(pythonContractSpecDiagnostic(
      diagnosticSourcePath(options.sourcePath, 'python-contract-spec'),
      'Python ContractSpec schemas must be an object.',
      pointer,
    ))
    return
  }

  for (const [name, schema] of sortedEntries(schemas)) {
    fragments.push(createOpenApiSourceFragment({
      kind: 'schema',
      ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
      sourcePointer: pointerChild(pointer, name),
      content: schema,
      metadata: mergeMetadata(metadata, { schemaName: name }),
    }))
  }
}

function collectPythonContractEndpoints(
  endpoints: unknown,
  pointer: string,
  options: PythonContractSpecSnapshotAdapterOptions,
  metadata: OpenApiSourceFragmentMetadata,
  fragments: OpenApiSourceFragment[],
  diagnostics: PythonContractSpecSnapshotAdapterDiagnostic[],
): void {
  if (endpoints === undefined) return
  if (!Array.isArray(endpoints)) {
    diagnostics.push(pythonContractSpecDiagnostic(
      diagnosticSourcePath(options.sourcePath, 'python-contract-spec'),
      'Python ContractSpec endpoints must be an array.',
      pointer,
    ))
    return
  }

  endpoints.forEach((endpoint, index) => {
    const endpointPointer = pointerChild(pointer, String(index))
    if (!isRecord(endpoint)) {
      diagnostics.push(pythonContractSpecDiagnostic(
        diagnosticSourcePath(options.sourcePath, 'python-contract-spec'),
        'Python ContractSpec endpoint entries must be objects.',
        endpointPointer,
      ))
      return
    }

    const endpointMetadata = mergeMetadata(metadata, {
      ...(typeof endpoint.operation_id === 'string' ? { operationId: endpoint.operation_id } : {}),
      ...(typeof endpoint.method === 'string' ? { method: endpoint.method } : {}),
      ...(typeof endpoint.path === 'string' ? { path: endpoint.path } : {}),
    })
    fragments.push(createOpenApiSourceFragment({
      kind: 'operation',
      ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
      sourcePointer: endpointPointer,
      content: endpoint,
      metadata: endpointMetadata,
    }))

    const successResponses = endpoint.success_responses
    if (successResponses === undefined) return
    const responsesPointer = pointerChild(endpointPointer, 'success_responses')
    if (!Array.isArray(successResponses)) {
      diagnostics.push(pythonContractSpecDiagnostic(
        diagnosticSourcePath(options.sourcePath, 'python-contract-spec'),
        'Python ContractSpec endpoint success_responses must be an array.',
        responsesPointer,
      ))
      return
    }
    successResponses.forEach((response, responseIndex) => {
      fragments.push(createOpenApiSourceFragment({
        kind: 'response',
        ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
        sourcePointer: pointerChild(responsesPointer, String(responseIndex)),
        content: response,
        metadata: mergeMetadata(endpointMetadata, {
          ...(isRecord(response) && typeof response.status_code === 'string'
            ? { statusCode: response.status_code }
            : {}),
        }),
      }))
    })
  })
}

function collectPythonContractRecord(
  value: unknown,
  pointer: string,
  kind: string,
  nameMetadataKey: string,
  options: PythonContractSpecSnapshotAdapterOptions,
  metadata: OpenApiSourceFragmentMetadata,
  fragments: OpenApiSourceFragment[],
  diagnostics: PythonContractSpecSnapshotAdapterDiagnostic[],
): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    diagnostics.push(pythonContractSpecDiagnostic(
      diagnosticSourcePath(options.sourcePath, 'python-contract-spec'),
      `Python ContractSpec ${pointer.split('/').at(-1) ?? 'section'} must be an object.`,
      pointer,
    ))
    return
  }

  for (const [name, content] of sortedEntries(value)) {
    fragments.push(createOpenApiSourceFragment({
      kind,
      ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
      sourcePointer: pointerChild(pointer, name),
      content,
      metadata: mergeMetadata(metadata, { [nameMetadataKey]: name }),
    }))
  }
}

function collectPythonContractTargets(
  targets: unknown,
  pointer: string,
  options: PythonContractSpecSnapshotAdapterOptions,
  metadata: OpenApiSourceFragmentMetadata,
  fragments: OpenApiSourceFragment[],
  diagnostics: PythonContractSpecSnapshotAdapterDiagnostic[],
): void {
  if (targets === undefined) return
  if (!Array.isArray(targets)) {
    diagnostics.push(pythonContractSpecDiagnostic(
      diagnosticSourcePath(options.sourcePath, 'python-contract-spec'),
      'Python ContractSpec targets must be an array.',
      pointer,
    ))
    return
  }

  targets.forEach((target, index) => {
    fragments.push(createOpenApiSourceFragment({
      kind: 'target',
      ...(options.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
      sourcePointer: pointerChild(pointer, String(index)),
      content: target,
      metadata: mergeMetadata(metadata, {
        ...(isRecord(target) && typeof target.name === 'string' ? { targetName: target.name } : {}),
      }),
    }))
  })
}

function projectionEnvelopeMetadata(envelope: JsonRecord): OpenApiSourceFragmentMetadata {
  const metadata: JsonRecord = {
    sourceAdapter: 'openapi-projection-envelope',
  }
  copyIfPresent(envelope, metadata, 'profile')
  copyIfPresent(envelope, metadata, 'versionHash')
  copyIfPresent(envelope, metadata, 'sources')
  copyIfPresent(envelope, metadata, 'refs')
  copyIfPresent(envelope, metadata, 'diagnostics')
  copyIfPresent(envelope, metadata, 'typeTargets')

  if (isRecord(envelope.projection)) {
    const extensions = readProjectionExtensions(envelope.projection)
    if (Object.keys(extensions).length > 0) {
      metadata.projectionExtensions = extensions
    }
  }

  return metadata
}

function readProjectionExtensions(projection: JsonRecord): JsonRecord {
  const extensions: JsonRecord = {}
  for (const key of [
    OPENAPI_PROJECTION_PROFILE_EXTENSION,
    OPENAPI_PROJECTION_VERSION_HASH_EXTENSION,
    OPENAPI_PROJECTION_SOURCES_EXTENSION,
    OPENAPI_PROJECTION_REFS_EXTENSION,
  ]) {
    copyIfPresent(projection, extensions, key)
  }
  return extensions
}

function readPythonSnapshotMetadata(snapshotOrContract: JsonRecord): JsonRecord {
  if (snapshotOrContract.format !== 'oa-contract-snapshot') return {}

  const metadata: JsonRecord = {
    snapshotFormat: snapshotOrContract.format,
  }
  copyIfPresent(snapshotOrContract, metadata, 'snapshot_version', 'snapshotVersion')
  copyIfPresent(snapshotOrContract, metadata, 'toolkit')
  return metadata
}

function copyIfPresent(
  source: JsonRecord,
  target: JsonRecord,
  sourceKey: string,
  targetKey = sourceKey,
): void {
  if (source[sourceKey] !== undefined) target[targetKey] = source[sourceKey]
}

function openApiProjectionEnvelopeDiagnostic(
  sourcePath: string,
  message: string,
  sourcePointer: string,
): OpenApiProjectionEnvelopeAdapterDiagnostic {
  return createOpenApiSourceAdapterDiagnostic({
    code: 'openapi-projection-envelope/invalid-envelope',
    severity: 'error',
    message,
    sourcePath,
    sourcePointer,
  })
}

function pythonContractSpecDiagnostic(
  sourcePath: string,
  message: string,
  sourcePointer: string,
): PythonContractSpecSnapshotAdapterDiagnostic {
  return createOpenApiSourceAdapterDiagnostic({
    code: 'python-contract-spec/invalid-snapshot',
    severity: 'error',
    message,
    sourcePath,
    sourcePointer,
  })
}

function diagnosticSourcePath(sourcePath: string | undefined, fallback: string): string {
  return sourcePath ?? `<${fallback}>`
}

function compareFragments(left: OpenApiSourceFragment, right: OpenApiSourceFragment): number {
  return (left.sourcePointer ?? '').localeCompare(right.sourcePointer ?? '')
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id)
}

function sortedEntries(record: JsonRecord): Array<[string, unknown]> {
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

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
