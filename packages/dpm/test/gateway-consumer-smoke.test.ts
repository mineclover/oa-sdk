import { describe, expect, it, vi } from 'vitest'

import {
  createDpmProfileBaselineRow,
  createDpmGatewayRuntime,
  getDpmGatewayOpenApiDocument,
  resolveDpmGatewayManifestRuntimeInput,
  summarizeDpmProfileBaselineRow,
  type DpmGatewayRuntime,
  type DpmGatewayRuntimeManifestInput,
  type DpmGatewayRuntimeOperationId,
  type DpmGatewayRuntimeResponse,
  type DpmGatewayManifestRequest,
} from '../src/index.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'
import { createRuntimeInput } from './support/gateway-runtime-manifest-fixtures.js'
import {
  createKafkaProfileArtifactWithCustomerNoPresence,
} from './support/profile-analysis-fixtures.js'

type ManifestConsumerOperation = {
  operationId: Extract<
    DpmGatewayRuntimeOperationId,
    'validateDpmManifest' | 'compileDpmManifest' | 'dryRunDpmManifest'
  >
  command: 'validate' | 'compile' | 'dry-run'
  path: '/dpm/manifests/validate' | '/dpm/manifests/compile' | '/dpm/manifests/dry-run'
  requestSchemaName: 'DpmManifestValidationRequest' | 'DpmManifestCompileRequest' | 'DpmManifestDryRunRequest'
  createRequest: (input: DpmGatewayRuntimeManifestInput) => DpmGatewayManifestRequest
  invoke: (
    runtime: DpmGatewayRuntime,
    input: DpmGatewayRuntimeManifestInput,
  ) => Promise<DpmGatewayRuntimeResponse<unknown>>
}

const manifestConsumerOperations = [
  {
    operationId: 'validateDpmManifest',
    command: 'validate',
    path: '/dpm/manifests/validate',
    requestSchemaName: 'DpmManifestValidationRequest',
    createRequest: createManifestRequest,
    invoke: (runtime, input) => runtime.validateDpmManifest(input),
  },
  {
    operationId: 'compileDpmManifest',
    command: 'compile',
    path: '/dpm/manifests/compile',
    requestSchemaName: 'DpmManifestCompileRequest',
    createRequest: createManifestRequest,
    invoke: (runtime, input) => runtime.compileDpmManifest(input),
  },
  {
    operationId: 'dryRunDpmManifest',
    command: 'dry-run',
    path: '/dpm/manifests/dry-run',
    requestSchemaName: 'DpmManifestDryRunRequest',
    createRequest: input => ({
      ...createManifestRequest(input),
      estimatedRows: {
        'public.orders': 7000,
      },
    }),
    invoke: (runtime, input) => runtime.dryRunDpmManifest(input),
  },
] as const satisfies readonly ManifestConsumerOperation[]

describe('DPM gateway consumer smoke', () => {
  it('routes documented manifest operationIds to runtime handlers and schema-valid responses', async () => {
    const document = getDpmGatewayOpenApiDocument()
    const runtime = createDpmGatewayRuntime()

    for (const operationCase of manifestConsumerOperations) {
      const operation = document.paths[operationCase.path].post
      expect(operation.operationId).toBe(operationCase.operationId)
      expect(extractRequestSchemaName(operation)).toBe(operationCase.requestSchemaName)

      const loadedInput = createRuntimeInput()
      const request = operationCase.createRequest(loadedInput)
      const requestSchema = compileGatewayComponentSchema(operationCase.requestSchemaName)
      const runtimeInput = await resolveDpmGatewayManifestRuntimeInput({
        request,
        resolver: createManifestSnapshotResolver(loadedInput),
      })
      const responseSchemaName = extractResponseSchemaName(operation)
      const response = await operationCase.invoke(runtime, runtimeInput)
      const responseSchema = compileGatewayComponentSchema(responseSchemaName)

      expect(requestSchema(request), JSON.stringify(requestSchema.errors, null, 2)).toBe(true)
      expect(response.operationId).toBe(operationCase.operationId)
      expect(response.statusCode).toBe(200)
      expect(response.body.command).toBe(operationCase.command)
      expect(responseSchema(response.body.result)).toBe(true)
    }
  })

  it('keeps the manifest consumer path relationship-first and raw-value-free', async () => {
    const runtime = createDpmGatewayRuntime()
    const validate = await runtime.validateDpmManifest(createRuntimeInput())
    const compile = await runtime.compileDpmManifest(createRuntimeInput())
    const dryRun = await runtime.dryRunDpmManifest(createRuntimeInput())

    expect(validate.body.result.summary.errors).toBe(0)
    expect(compile.body.result.ok).toBe(true)
    expect(dryRun.body.result).toMatchObject({
      kind: 'dpm.dry-run-report.v1',
      rawValuesIncluded: false,
      impact: {
        namespaces: 1,
        relationships: 1,
        columns: 2,
        piiColumns: 2,
      },
    })
    expect(JSON.stringify(dryRun.body.result)).not.toContain('C-001')
  })

  it('routes the documented profile baseline summary operation to a schema-valid runtime response', async () => {
    const document = getDpmGatewayOpenApiDocument()
    const runtime = createDpmGatewayRuntime()
    const operation = document.paths['/dpm/profiles/baselines/summaries'].post
    const requestSchemaName = extractRequestSchemaName(operation)
    const responseSchemaName = extractResponseSchemaName(operation)
    const baseline = createDpmProfileBaselineRow({
      profileArtifact: createKafkaProfileArtifactWithCustomerNoPresence(0.91),
      measuredAt: '2026-07-07T00:00:00.000Z',
      measurementRunHash: 'sha256:consumer-smoke-run',
      storedAt: '2026-07-07T00:05:00.000Z',
    })
    const adapterSummary = summarizeDpmProfileBaselineRow(baseline)
    const request = {
      datasetId: baseline.datasetId,
      profileId: baseline.profileId,
      limit: 1,
    }
    const listProfileBaselineSummaries = vi.fn(async () => [adapterSummary])
    const requestSchema = compileGatewayComponentSchema(requestSchemaName)
    const responseSchema = compileGatewayComponentSchema(responseSchemaName)

    const response = await runtime.listDpmProfileBaselineSummaries({
      ...request,
      profileBaselineRepository: {
        listProfileBaselineSummaries,
      },
    })

    expect(operation.operationId).toBe('listDpmProfileBaselineSummaries')
    expect(requestSchemaName).toBe('DpmProfileBaselineSummaryListRequest')
    expect(responseSchemaName).toBe('DpmProfileBaselineSummaryListResponse')
    expect(requestSchema(request), JSON.stringify(requestSchema.errors, null, 2)).toBe(true)
    expect(response.operationId).toBe('listDpmProfileBaselineSummaries')
    expect(response.statusCode).toBe(200)
    expect(response.body.command).toBe('list-profile-baseline-summaries')
    expect(listProfileBaselineSummaries).toHaveBeenCalledWith(request)
    expect(
      responseSchema(response.body.result),
      JSON.stringify(responseSchema.errors, null, 2),
    ).toBe(true)
    expect(response.body.result.baselineSummaries).toEqual([
      expect.objectContaining({
        baselineRef: baseline.baselineRef,
        measurementId: baseline.measurementId,
        hasAnalysisReport: false,
      }),
    ])
    expect(JSON.stringify(response.body.result)).not.toContain('profileArtifact')
    expect(JSON.stringify(response.body.result)).not.toContain('analysisReport')
  })
})

function extractRequestSchemaName(operation: {
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: {
          $ref?: string
        }
      }
    }
  }
}): string {
  return extractComponentName(operation.requestBody?.content?.['application/json']?.schema?.$ref)
}

function extractResponseSchemaName(operation: {
  responses: {
    '200': {
      content: {
        'application/json': {
          schema: {
            $ref: string
          }
        }
      }
    }
  }
}): string {
  return extractComponentName(operation.responses['200'].content['application/json'].schema.$ref)
}

function extractComponentName(refPath: string | undefined): string {
  const prefix = '#/components/schemas/'
  if (!refPath?.startsWith(prefix)) {
    throw new Error(`Expected component schema ref, got ${refPath ?? '<missing>'}`)
  }
  return refPath.slice(prefix.length)
}

function createManifestRequest(input: DpmGatewayRuntimeManifestInput): DpmGatewayManifestRequest {
  return {
    manifest: input.manifest,
    catalogSnapshot: {
      ref: 'catalog://commerce/v1',
      versionHash: input.catalog.kind === 'dpm.catalog.snapshot.v1'
        ? input.catalog.freshness.versionHash
        : 'sha256:postgres-input',
    },
    registrySnapshot: {
      ref: 'registry://commerce/v1',
      versionHash: input.registry.registryVersion,
    },
  }
}

function createManifestSnapshotResolver(input: DpmGatewayRuntimeManifestInput) {
  const request = createManifestRequest(input)
  return {
    resolveCatalogSnapshot: vi.fn(snapshot => {
      expect(snapshot).toEqual(request.catalogSnapshot)
      return input.catalog
    }),
    resolveRegistrySnapshot: vi.fn(snapshot => {
      expect(snapshot).toEqual(request.registrySnapshot)
      return input.registry
    }),
  }
}
