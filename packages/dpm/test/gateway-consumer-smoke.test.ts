import { describe, expect, it } from 'vitest'

import {
  createDpmGatewayRuntime,
  getDpmGatewayOpenApiDocument,
  type DpmGatewayRuntime,
  type DpmGatewayRuntimeOperationId,
} from '../src/index.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'
import { createRuntimeInput } from './support/gateway-runtime-manifest-fixtures.js'

type ManifestConsumerOperation = {
  operationId: Extract<
    DpmGatewayRuntimeOperationId,
    'validateDpmManifest' | 'compileDpmManifest' | 'dryRunDpmManifest'
  >
  command: 'validate' | 'compile' | 'dry-run'
  path: '/dpm/manifests/validate' | '/dpm/manifests/compile' | '/dpm/manifests/dry-run'
  requestSchemaName: 'DpmManifestValidationRequest' | 'DpmManifestCompileRequest' | 'DpmManifestDryRunRequest'
  invoke: (runtime: DpmGatewayRuntime) => DpmGatewayRuntime[keyof DpmGatewayRuntime]
}

const manifestConsumerOperations = [
  {
    operationId: 'validateDpmManifest',
    command: 'validate',
    path: '/dpm/manifests/validate',
    requestSchemaName: 'DpmManifestValidationRequest',
    invoke: runtime => runtime.validateDpmManifest,
  },
  {
    operationId: 'compileDpmManifest',
    command: 'compile',
    path: '/dpm/manifests/compile',
    requestSchemaName: 'DpmManifestCompileRequest',
    invoke: runtime => runtime.compileDpmManifest,
  },
  {
    operationId: 'dryRunDpmManifest',
    command: 'dry-run',
    path: '/dpm/manifests/dry-run',
    requestSchemaName: 'DpmManifestDryRunRequest',
    invoke: runtime => runtime.dryRunDpmManifest,
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

      const responseSchemaName = extractResponseSchemaName(operation)
      const response = await operationCase.invoke(runtime)(createRuntimeInput())
      const responseSchema = compileGatewayComponentSchema(responseSchemaName)

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
