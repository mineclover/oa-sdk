import { describe, expect, it } from 'vitest'
import {
  SPEC_LENS_DIFF_SCHEMA_VERSION,
  SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
  isSpecLensResponse,
} from './index.js'

describe('@oa-sdk/spec-lens-contract', () => {
  it('pins the wire schema versions', () => {
    expect(SPEC_LENS_SNAPSHOT_SCHEMA_VERSION).toBe('spec-lens.snapshot.v2')
    expect(SPEC_LENS_DIFF_SCHEMA_VERSION).toBe('spec-lens.diff.v2')
  })

  it('guards the response shapes used by the UI boundary', () => {
    expect(isSpecLensResponse('snapshot', validTypeSpecSnapshot())).toBe(true)
    expect(isSpecLensResponse('snapshot', validTypeSpecAstSnapshot())).toBe(true)
    expect(isSpecLensResponse('snapshot', {
      ...validTypeSpecSnapshot(),
      revision: undefined,
    })).toBe(false)
    expect(isSpecLensResponse('snapshot', { schemaVersion: 'wrong', projectKind: 'typespec-bundle' })).toBe(false)
    expect(isSpecLensResponse('graph', { nodes: [], edges: [] })).toBe(true)
    expect(isSpecLensResponse('graph', {
      nodes: [{ id: 'schema:public/users/User', kind: 'schema' }],
      edges: [],
    })).toBe(false)
    expect(isSpecLensResponse('paths', {
      status: 'available',
      projectKind: 'typespec-bundle',
      entries: [],
    })).toBe(true)
  })
})

function validTypeSpecSnapshot() {
  return {
    schemaVersion: 'spec-lens.snapshot.v2',
    projectKey: 'project-key',
    projectKind: 'typespec-bundle',
    sourceRoot: 'typespec',
    revision: {
      id: 'revision-id',
      shortId: 'revision',
      timestamp: 1,
      message: 'initial',
      source: 'local-git',
    },
    spec: {},
    diagnostics: [],
    builtAt: 1,
    manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
    provenance: {
      status: 'unavailable',
      kind: 'typespec-source-files',
      reason: 'output-pointer-mapping-unavailable',
      sourceFiles: [{ relativePath: 'typespec/main.tsp', contentHash: 'hash' }],
      observedInputs: [],
      compile: {
        schemaVersion: 'oa-sdk.spec-lens.typespec-compile.v1',
        manifestSchemaVersion: 'oa-sdk.typespec-bundle.v1',
        entrypoint: 'typespec/main.tsp',
        sourceFiles: ['typespec/main.tsp'],
        compatibilitySource: 'sidecar',
        toolchain: {
          schemaVersion: 'oa-sdk.spec-lens.typespec-toolchain.v1',
          fingerprint: 'fingerprint',
          packages: {
            '@oa-sdk/typespec-decorators': '0.1.0',
            '@typespec/compiler': '1.0.0',
            '@typespec/http': '1.0.0',
            '@typespec/openapi': '1.0.0',
            '@typespec/openapi3': '1.0.0',
          },
          trustedLibraryDigests: {
            '@oa-sdk/typespec-decorators': 'a'.repeat(64),
          },
          restoreContract: 'oa-sdk.codegen.typespec-restore.v1',
          isolationPolicy: 'oa-sdk.spec-lens.typespec-isolation.v2',
          resourcePolicy: {
            compileTimeoutMs: 1,
            compileMaxOutputBytes: 1,
            compileMaxOldSpaceSizeMb: 1,
            sourceReadBudget: {
              schemaVersion: 'oa-sdk.spec-lens.source-read-budget.v1',
              maxFiles: 1,
              maxFileBytes: 1,
              maxTotalBytes: 1,
              maxConcurrency: 1,
            },
            maxArtifactBytes: 1,
          },
        },
        compiler: {
          configSource: 'generated-allowlist',
          emitter: '@typespec/openapi3',
          openapiVersion: '3.2.0',
          packageImports: [],
          resources: {
            timeoutMs: 1,
            maxOutputBytes: 1,
            maxOldSpaceSizeMb: 1,
            sourceReadBudget: {
              schemaVersion: 'oa-sdk.spec-lens.source-read-budget.v1',
              maxFiles: 1,
              maxFileBytes: 1,
              maxTotalBytes: 1,
              maxConcurrency: 1,
            },
            maxArtifactBytes: 1,
            isolationPolicy: 'oa-sdk.spec-lens.typespec-isolation.v2',
          },
        },
        validation: {
          emitted: { valid: true, summary: 'valid' },
          restored: { valid: true, summary: 'valid' },
        },
        gates: {
          compatibilitySidecar: 'pass',
          emittedValidation: 'pass',
          restoredValidation: 'pass',
          provenance: 'pass',
        },
      },
    },
  }
}

function validTypeSpecAstSnapshot() {
  const snapshot = validTypeSpecSnapshot()
  return {
    ...snapshot,
    provenance: {
      status: 'available',
      kind: 'typespec-source-ast',
      entries: {
        '#/paths/~1users': {
          canonicalId: 'operation:typespec/main.tsp/listUsers',
          kind: 'operation',
          sourcePath: 'main.tsp',
          sourcePointer: '#L1:C1',
          contentHash: 'hash',
        },
      },
      sourceFiles: snapshot.provenance.sourceFiles,
      observedInputs: snapshot.provenance.observedInputs,
      compile: snapshot.provenance.compile,
    },
  }
}
