import { describe, expect, it } from 'vitest'

import {
  computeDpmApiArtifactVersionHash,
  compileDpmPlan,
  validateDpmManifest,
} from '../src/index.js'
import {
  createValidationInput,
} from './support/validator-fixtures.js'

describe('DPM semantic data binding validator', () => {
  it('resolves v1.1 logical, catalog, and API bindings without name inference', () => {
    const { input, apiArtifacts } = createIdentityBindingInput()
    const result = validateDpmManifest({
      ...input,
      apiArtifacts,
    })

    expect(result.valid).toBe(true)
    expect(result.diagnostics.some(diagnostic => diagnostic.code.startsWith('DAT'))).toBe(false)
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['SAF007'])
  })

  it('blocks undeclared entities and stale catalog references with coordinates', () => {
    const { input, apiArtifacts } = createIdentityBindingInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.data_definitions.fields[0].entity.namespace = 'unknown'
    manifest.data_definitions.fields[0].storage_ref.catalog.version_hash = 'sha256:stale-catalog'

    const result = validateDpmManifest({
      ...input,
      manifest,
      apiArtifacts,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'DAT001',
        sourcePointer: '/data_definitions/fields/0/entity',
      }),
      expect.objectContaining({
        code: 'DAT004',
        sourcePointer: '/data_definitions/fields/0/storage_ref/catalog/version_hash',
        catalogCoordinate: {
          table: 'public.customers',
          column: 'customer_no',
        },
      }),
    ]))
  })

  it('blocks missing API artifacts, stale hashes, pointers, and operation metadata', () => {
    const { input, apiArtifacts } = createIdentityBindingInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.data_definitions.api_bindings[0].api.version_hash = 'sha256:wrong-api'
    manifest.data_definitions.api_bindings[0].api.pointer = '#/paths/~1missing/get/responses/200'
    manifest.data_definitions.api_bindings[0].api.operation_id = 'wrongOperation'

    const result = validateDpmManifest({
      ...input,
      manifest,
      apiArtifacts,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DAT007', apiCoordinate: expect.objectContaining({ artifactId: 'commerce-api' }) }),
      expect.objectContaining({ code: 'DAT008', sourcePointer: '/data_definitions/api_bindings/0/api/pointer' }),
      expect.objectContaining({ code: 'DAT009', sourcePointer: '/data_definitions/api_bindings/0/api/operation_id' }),
    ]))

    const missingArtifactManifest = structuredClone(input.manifest) as Record<string, any>
    missingArtifactManifest.data_definitions.api_bindings[0].api.artifact_id = 'missing-api'
    const missingArtifactResult = validateDpmManifest({
      ...input,
      manifest: missingArtifactManifest,
      apiArtifacts,
    })
    expect(missingArtifactResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'DAT006',
        apiCoordinate: expect.objectContaining({ artifactId: 'missing-api' }),
      }),
    ]))

    const provenanceInput = createIdentityBindingInput()
    const provenanceArtifacts = structuredClone(provenanceInput.apiArtifacts) as typeof provenanceInput.apiArtifacts
    provenanceArtifacts[0].provenance!.versionHash = 'sha256:wrong-provenance'
    const provenanceResult = validateDpmManifest({
      ...provenanceInput.input,
      apiArtifacts: provenanceArtifacts,
    })
    expect(provenanceResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DAT010' }),
    ]))
  })

  it('blocks one API target from binding to multiple logical fields', () => {
    const { input, apiArtifacts } = createIdentityBindingInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.data_definitions.fields.push({
      ...manifest.data_definitions.fields[0],
      object_id: 'order-customer-number',
      revision_id: 'order-customer-number-rev-1',
      entity: {
        dataset_id: 'commerce_ai',
        namespace: 'order',
        name: 'order',
      },
      name: 'customerNo',
      origin: 'api_only',
      storage_ref: undefined,
    })
    delete manifest.data_definitions.fields[1].storage_ref
    manifest.data_definitions.api_bindings.push({
      ...manifest.data_definitions.api_bindings[0],
      binding_id: 'order-customer-number-response',
      data_field: {
        object_id: 'order-customer-number',
        revision_id: 'order-customer-number-rev-1',
      },
    })

    const result = validateDpmManifest({
      ...input,
      manifest,
      apiArtifacts,
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DAT012', sourcePointer: '/data_definitions' }),
    ]))
  })

  it('blocks compilation when a v1.1 API binding is stale or unverifiable', () => {
    const { input, apiArtifacts } = createIdentityBindingInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.data_definitions.api_bindings[0].api.version_hash = 'sha256:stale-api'

    const result = compileDpmPlan({
      ...input,
      manifest,
      apiArtifacts,
      phase: 'compile',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DAT007' }),
    ]))
  })
})

function createIdentityBindingInput() {
  const input = createValidationInput()
  const manifest = structuredClone(input.manifest) as Record<string, any>
  const catalogVersionHash = input.catalog.freshness.versionHash
  const apiDocument = {
    openapi: '3.2.0',
    paths: {
      '/customers/{customerId}': {
        get: {
          operationId: 'getCustomer',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      customerNo: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
  const apiVersionHash = computeDpmApiArtifactVersionHash(apiDocument)
  manifest.catalog.version_hash = catalogVersionHash
  manifest.data_definitions = {
    version: '1.1',
    fields: [{
      object_id: 'customer-number',
      revision_id: 'customer-number-rev-1',
      entity: {
        dataset_id: 'commerce_ai',
        namespace: 'customer',
        name: 'customer',
      },
      name: 'customerNo',
      type: 'string',
      origin: 'persisted',
      storage_ref: {
        table: 'public.customers',
        column: 'customer_no',
        catalog: {
          snapshot_id: 'catalogs/commerce-postgres.json',
          version_hash: catalogVersionHash,
        },
      },
    }],
    api_bindings: [{
      binding_id: 'customer-number-response',
      data_field: {
        object_id: 'customer-number',
        revision_id: 'customer-number-rev-1',
      },
      api: {
        artifact_id: 'commerce-api',
        operation_id: 'getCustomer',
        pointer: '#/paths/~1customers~1%7BcustomerId%7D/get/responses/200/content/application~1json/schema/properties/customerNo',
        version_hash: apiVersionHash,
      },
      direction: 'response',
    }],
  }

  return {
    input: { ...input, manifest },
    apiArtifacts: [{
      artifactId: 'commerce-api',
      document: apiDocument,
      provenance: {
        versionHash: apiVersionHash,
        sourceCoordinate: {
          kind: 'file' as const,
          filePath: 'artifacts/commerce-api.yaml',
          pointer: '#/paths/~1customers~1{customerId}/get',
        },
      },
    }],
  }
}
