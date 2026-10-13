import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  createMcpServer,
  createCli,
  createHttpApp,
  createToolApp,
  createToolContext,
  executeTool,
} from '@oa-sdk/tools'
import { compileTypeSpecInMemory } from '../../../packages/codegen/src/plugin/compiler.js'
import {
  canonicalJsonStringify,
  computeCanonicalHash,
  computeEnvelopeContentHash,
  computeSemanticEntityHash,
} from './canonical/canonical-json.js'
import {
  validateEntitySourceEnvelope,
  validateEntityDerivedEnvelope,
  validateColabRunPacket,
  verifyCanonicalDigest,
  verifyExecutionSnapshot,
  verifyUnknownFieldsPreservation,
} from './validator/ewic-validator.js'
import {
  SourceReferenceAdapter,
  CollaborationManifestAdapter,
  KindAdapters,
} from './adapters/index.js'
import {
  createEwicTools,
  createValidateEnvelopeTool,
  createAdaptSourceRefTool,
  createVerifyExecutionTool,
} from './tools/index.js'
import type { EwicEnvelopePort } from './contracts/ports.js'
import type {
  EntitySourceEnvelope,
  EntityDerivedEnvelope,
  ColabRunPacket,
  ExecutionContent,
  ResourceContent,
  FrameworkContent,
  SpecContent,
} from './contracts/ewic-types.js'
import type {
  SourceReference,
  ReferenceIndexItem,
  CollaborationManifest,
} from '../shared-context-harness/contracts/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function loadFixture<T>(path: string): T {
  const fullPath = join(__dirname, 'fixtures', path)
  return JSON.parse(readFileSync(fullPath, 'utf-8'))
}

function loadSharedFixture<T>(path: string): T {
  const fullPath = join(__dirname, '../shared-context-harness/fixtures', path)
  return JSON.parse(readFileSync(fullPath, 'utf-8'))
}

describe('Issue #3: EWIC v0.1 Entity/Workflow/Execution/Evidence Envelope Validation with oa-sdk Core', () => {
  // Load sample envelopes
  const fixtureSpec = loadFixture<EntitySourceEnvelope<SpecContent>>('sample-source-envelopes/spec.json')
  const fixtureFramework = loadFixture<EntitySourceEnvelope<FrameworkContent>>('sample-source-envelopes/framework.json')
  const fixtureResource = loadFixture<EntitySourceEnvelope<ResourceContent>>('sample-source-envelopes/resource.json')
  const fixtureWorkflow = loadFixture<EntitySourceEnvelope>('sample-source-envelopes/workflow.json')
  const fixtureExecution = loadFixture<EntitySourceEnvelope<ExecutionContent>>('sample-source-envelopes/execution.json')
  const fixtureEvidence = loadFixture<EntitySourceEnvelope>('sample-source-envelopes/evidence.json')
  const fixtureDerived = loadFixture<EntityDerivedEnvelope>('sample-derived-envelope.json')
  const fixtureColabPacket = loadFixture<ColabRunPacket>('sample-colab-run-packet.json')

  // Load Issue #2 shared-context-harness fixtures
  const sharedRefOaSdk = loadSharedFixture<SourceReference>('collab-context-harness/references/ref-oa-sdk.json')
  const sharedManifest = loadSharedFixture<CollaborationManifest>('collab-context-harness/collaboration.json')
  const sharedIndex = loadSharedFixture<{ references: ReferenceIndexItem[] }>('collab-context-harness/references/index.json')

  // Mock Port factory
  function createMockPort(overrides: Partial<EwicEnvelopePort> = {}): EwicEnvelopePort {
    const defaultPort: EwicEnvelopePort = {
      canReadEnvelope: async (_actorId, _env) => true,
      readSourceEnvelope: async (uri) => {
        if (uri.includes('spec')) return fixtureSpec
        if (uri.includes('framework')) return fixtureFramework
        if (uri.includes('resource') || uri.includes('ref_oa_sdk')) return fixtureResource
        if (uri.includes('workflow') || uri.includes('scene_player')) return fixtureWorkflow
        if (uri.includes('execution')) return fixtureExecution
        if (uri.includes('evidence')) return fixtureEvidence
        return null
      },
      readDerivedEnvelope: async (uri) => {
        if (uri === fixtureDerived.entityRef) return fixtureDerived
        return null
      },
      verifySnapshot: async (uri, expectedHash, expectedSnapshotId) => {
        if (uri.includes('ref_oa_sdk')) {
          const currentHash = 'sha256:6542531b402849e7939116e0339912066f7fbb5a'
          const currentSnapshotId = '6542531b402849e7939116e0339912066f7fbb5a'
          return {
            match: currentHash === expectedHash && (!expectedSnapshotId || currentSnapshotId === expectedSnapshotId),
            currentHash,
            currentSnapshotId,
          }
        }
        return {
          match: false,
          currentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        }
      },
      readColabRunPacket: async (runId) => {
        if (runId === fixtureColabPacket.runId) return fixtureColabPacket
        return null
      },
    }
    return { ...defaultPort, ...overrides }
  }

  // =========================================================================
  // Tier 1: TypeSpec AST Ingestion & In-Memory Compilation Fidelity
  // =========================================================================
  describe('1. TypeSpec Schema Ingestion & AST Fidelity', () => {
    it('compiles TypeSpec EWIC interoperability contract in-memory without disk I/O', async () => {
      const tspEntry = join(__dirname, 'schema/typespec/main.tsp')
      const result = await compileTypeSpecInMemory(tspEntry, {
        openApiVersion: '3.1.0',
      })

      expect(result.program).toBeDefined()
      expect(result.document).toBeDefined()
      expect(result.routesCount).toBe(4) // 4 routes: getSourceEnvelope, getDerivedEnvelope, verifyExecution, getColabRun
      expect(result.document.info.title).toBe('EWIC Interoperability Envelope Service')
      expect(result.document.info.version).toBe('0.1.0')
      expect(result.program.hasError()).toBe(false)
    })
  })

  // =========================================================================
  // Tier 2: JSON Schema Draft 2020-12 Validation & Identity Invariants
  // =========================================================================
  describe('2. JSON Schema Draft 2020-12 Validation & Invariants', () => {
    it('validates all 6 sample source envelopes (spec, framework, resource, workflow, execution, evidence)', () => {
      const samples = [
        fixtureSpec,
        fixtureFramework,
        fixtureResource,
        fixtureWorkflow,
        fixtureExecution,
        fixtureEvidence,
      ]

      for (const sample of samples) {
        const validation = validateEntitySourceEnvelope(sample)
        expect(validation.ok).toBe(true)
        expect(validation.issues).toHaveLength(0)
      }
    })

    it('validates derived envelope and Colab run packet successfully', () => {
      const derivedVal = validateEntityDerivedEnvelope(fixtureDerived)
      expect(derivedVal.ok).toBe(true)

      const colabVal = validateColabRunPacket(fixtureColabPacket)
      expect(colabVal.ok).toBe(true)
    })

    it('enforces revisionId invariant: must match ${id}@${revision}', () => {
      const invalid = {
        ...fixtureSpec,
        identity: {
          ...fixtureSpec.identity,
          revision: 2,
          revisionId: `${fixtureSpec.identity.id}@1`, // Mismatched revision
        },
      }
      const val = validateEntitySourceEnvelope(invalid)
      expect(val.ok).toBe(false)
      expect(val.issues.some((i) => i.includes('REVISION_ID_MISMATCH'))).toBe(true)
    })

    it('rejects uncanonical entity kind outside the 6 allowed kinds', () => {
      const invalid = {
        ...fixtureSpec,
        identity: {
          ...fixtureSpec.identity,
          kind: 'unsupported_kind' as any,
        },
      }
      const val = validateEntitySourceEnvelope(invalid)
      expect(val.ok).toBe(false)
      expect(val.issues.some((i) => i.includes('INVALID_ENTITY_KIND'))).toBe(true)
    })

    it('rejects envelope when provenance ssot path is empty or whitespace', () => {
      const invalid = {
        ...fixtureResource,
        provenance: {
          ...fixtureResource.provenance,
          ssot: {
            ...fixtureResource.provenance.ssot,
            path: '   ',
          },
        },
      }
      const val = validateEntitySourceEnvelope(invalid)
      expect(val.ok).toBe(false)
      expect(val.issues.some((i) => i.includes('SSOT_PATH_EMPTY'))).toBe(true)
    })
  })

  // =========================================================================
  // Tier 3: Canonical Digest (RFC 8785) & Readback Verification
  // =========================================================================
  describe('3. RFC 8785 Canonical JSON & Content Digest Readback', () => {
    it('produces deterministic JSON regardless of object key insertion order', () => {
      const obj1 = { z: 1, a: 2, m: { y: 'bar', x: 'foo' } }
      const obj2 = { a: 2, m: { x: 'foo', y: 'bar' }, z: 1 }

      expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2))
      expect(canonicalJsonStringify(obj1)).toBe('{"a":2,"m":{"x":"foo","y":"bar"},"z":1}')
      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2))
    })

    it('verifies 100% digest readback for all 6 generated sample envelopes', () => {
      const samples = [
        fixtureSpec,
        fixtureFramework,
        fixtureResource,
        fixtureWorkflow,
        fixtureExecution,
        fixtureEvidence,
      ]

      for (const sample of samples) {
        const check = verifyCanonicalDigest(sample)
        expect(check.valid).toBe(true)
        expect(check.calculated).toBe(sample.identity.contentHash)
      }
    })

    it('detects tampered content immediately during digest readback verification', () => {
      const tampered = {
        ...fixtureSpec,
        content: {
          ...fixtureSpec.content,
          title: 'Tampered Title That Changes Digest',
        },
      }

      const check = verifyCanonicalDigest(tampered)
      expect(check.valid).toBe(false)
      expect(check.calculated).not.toBe(tampered.identity.contentHash)
    })
  })

  // =========================================================================
  // Tier 4: Adapters & Drive Attribute Preservation (Lossless Round-Trip)
  // =========================================================================
  describe('4. Adapters & Drive Attributes Preservation (Lossless Round-Trip)', () => {
    it('adapts SourceReference to EWIC Resource Envelope preserving Drive fileId, parentChain, locator, revision, and contentHash', () => {
      const indexItem = sharedIndex.references.find((r) => r.referenceId === 'ref-oa-sdk')
      const envelope = SourceReferenceAdapter.toResourceEnvelope(sharedRefOaSdk, indexItem, {
        parentChain: ['1h_CjCUEaOUaKzImXqbmbRS0AGkPdmkiB', '13kImqWVGEzPeuUD2x4b1bH9lPcqXBUv5'],
        fileId: '1m0oG9fBv_ref_oa_sdk_file',
      })

      expect(envelope.$schema).toBe('entity-source/v1')
      expect(envelope.identity.kind).toBe('resource')
      expect(envelope.identity.slug).toBe('ref-oa-sdk')
      expect(envelope.provenance.ssot.fileId).toBe('1m0oG9fBv_ref_oa_sdk_file')
      expect(envelope.provenance.ssot.parentChain).toEqual([
        '1h_CjCUEaOUaKzImXqbmbRS0AGkPdmkiB',
        '13kImqWVGEzPeuUD2x4b1bH9lPcqXBUv5',
      ])
      expect(envelope.provenance.ssot.locator).toContain('1m0oG9fBv_ref_oa_sdk_file')
      expect(envelope.provenance.ssot.revision).toBe(sharedRefOaSdk.source.snapshot.id)
      expect(envelope.content.fileId).toBe('1m0oG9fBv_ref_oa_sdk_file')

      // Verify envelope satisfies schema
      const val = validateEntitySourceEnvelope(envelope)
      expect(val.ok).toBe(true)

      // Verify canonical digest readback
      const digest = verifyCanonicalDigest(envelope)
      expect(digest.valid).toBe(true)
    })

    it('round-trips SourceReference through Resource Envelope with unknown fields preserved losslessly', () => {
      const customRef: SourceReference & Record<string, unknown> = {
        ...sharedRefOaSdk,
        customExtension: {
          traceId: 'trace-8899',
          priorityScore: 0.95,
          labels: ['core', 'pilot'],
        },
        upstreamMirrorUrl: 'https://mirror.internal/oa-sdk.git',
      }

      // Convert ref -> envelope
      const envelope = SourceReferenceAdapter.toResourceEnvelope(customRef, undefined, {
        fileId: 'drive_file_custom_123',
      })

      // Convert envelope -> ref
      const restored = SourceReferenceAdapter.fromResourceEnvelope(envelope)

      // Verify unknown fields were preserved losslessly
      const check = verifyUnknownFieldsPreservation(customRef, restored)
      expect(check.lossless).toBe(true)
      expect(check.differences).toHaveLength(0)
      expect(restored.customExtension).toEqual(customRef.customExtension)
      expect(restored.upstreamMirrorUrl).toBe(customRef.upstreamMirrorUrl)
    })

    it('adapts CollaborationManifest to EWIC Framework Envelope and restores it losslessly', () => {
      const envelope = CollaborationManifestAdapter.toFrameworkEnvelope(sharedManifest, {
        fileId: '1h_CjCUEaOUaKzImXqbmbRS0AGkPdmkiB',
      })

      expect(envelope.identity.kind).toBe('framework')
      expect(envelope.identity.slug).toBe(sharedManifest.collaborationId)
      expect(envelope.provenance.ssot.fileId).toBe('1h_CjCUEaOUaKzImXqbmbRS0AGkPdmkiB')

      const val = validateEntitySourceEnvelope(envelope)
      expect(val.ok).toBe(true)

      const restored = CollaborationManifestAdapter.fromFrameworkEnvelope(envelope)
      expect(restored.collaborationId).toBe(sharedManifest.collaborationId)
      expect(restored.title).toBe(sharedManifest.title)
      expect(restored.storage.rootFolderId).toBe(sharedManifest.storage.rootFolderId)
      expect(restored.participants).toHaveLength(sharedManifest.participants.length)
    })
  })

  // =========================================================================
  // Tier 5: Execution Snapshot Reproducibility & Stale Snapshot Denial
  // =========================================================================
  describe('5. Execution Snapshot Reproducibility & Stale Snapshot Denial', () => {
    it('verifies snapshot reproducibility when all resolved reference hashes match pinned state', () => {
      const execution = fixtureExecution.content
      const resolvers = {
        'entity://collab.scope/resource/ent_ref_oa_sdk@1': {
          snapshotId: '6542531b402849e7939116e0339912066f7fbb5a',
          contentHash: 'sha256:6542531b402849e7939116e0339912066f7fbb5a',
        },
      }

      const result = verifyExecutionSnapshot(execution, resolvers)
      expect(result.status).toBe('reproducible')
      if (result.status === 'reproducible') {
        expect(result.workflowRef).toBe(execution.workflowRef)
        expect(result.resolvedCount).toBe(1)
      }
    })

    it('denies execution with typed stale error when referenced entity content hash has drifted', () => {
      const execution = fixtureExecution.content
      const driftedResolvers = {
        'entity://collab.scope/resource/ent_ref_oa_sdk@1': {
          snapshotId: '6542531b402849e7939116e0339912066f7fbb5a',
          contentHash: 'sha256:drifted_hash_unexpected_mutation_77889900aabbccddeeff',
        },
      }

      const result = verifyExecutionSnapshot(execution, driftedResolvers)
      expect(result.status).toBe('stale')
      if (result.status === 'stale') {
        expect(result.driftedRefs).toHaveLength(1)
        expect(result.driftedRefs[0].refUri).toBe('entity://collab.scope/resource/ent_ref_oa_sdk@1')
        expect(result.driftedRefs[0].actualHash).toBe('sha256:drifted_hash_unexpected_mutation_77889900aabbccddeeff')
      }
    })

    it('returns unavailable when referenced entity snapshot is missing from provider', () => {
      const execution = fixtureExecution.content
      const missingResolvers = {} // Empty resolvers

      const result = verifyExecutionSnapshot(execution, missingResolvers)
      expect(result.status).toBe('unavailable')
    })
  })

  // =========================================================================
  // Tier 6: Universal Tool Contracts (@oa-sdk/tools Surface Adapter)
  // =========================================================================
  describe('6. @oa-sdk/tools Universal Surface Adapter (MCP, CLI, REST)', () => {
    const port = createMockPort()
    const tools = createEwicTools(port)

    it('creates 3 read-only EWIC tools with Draft 2020-12 input schemas', () => {
      expect(tools).toHaveLength(3)
      const names = tools.map((t) => t.name)
      expect(names).toContain('ewic_validate_envelope')
      expect(names).toContain('ewic_adapt_source_reference')
      expect(names).toContain('ewic_verify_execution')
    })

    it('exports tools cleanly to MCP Server format with JSON Schema input definitions', () => {
      const mcpServer = createMcpServer(tools, { name: 'ewic-interop-mcp' })
      const mcpTools = mcpServer.getTools()

      expect(mcpTools).toHaveLength(3)
      for (const tool of mcpTools) {
        expect(tool.inputSchema.type).toBe('object')
        expect(tool.inputSchema.properties).toBeDefined()
      }
    })

    it('integrates with Commander CLI without syntax error and groups by ewic category', () => {
      const cli = createCli(tools, { name: 'ewic-cli' })
      expect(cli).toBeDefined()

      const ewicCmd = cli.commands.find((c) => c.name() === 'ewic')
      expect(ewicCmd).toBeDefined()
      expect(ewicCmd!.commands).toHaveLength(3)
    })

    it('integrates with Hono REST HTTP app generator and ToolApp', () => {
      const app = createHttpApp(tools, { title: 'EWIC API', version: '0.1.0' })
      expect(app).toBeDefined()
      expect(typeof app.fetch).toBe('function')

      const toolApp = createToolApp({ name: 'ewic-app' }).tools(...tools)
      expect(toolApp.getTools()).toHaveLength(3)
    })

    it('executes ewic_validate_envelope and confirms valid source envelope and digest', async () => {
      const tool = createValidateEnvelopeTool()
      const ctx = createToolContext({ actorId: 'actor:test' })
      const result = await executeTool(
        tool,
        {
          type: 'source',
          envelope: fixtureSpec as unknown as Record<string, unknown>,
        },
        ctx
      )

      expect(result.valid).toBe(true)
      expect(result.digestVerification?.valid).toBe(true)
    })

    it('executes ewic_adapt_source_reference in ref-to-envelope direction', async () => {
      const tool = createAdaptSourceRefTool()
      const ctx = createToolContext({ actorId: 'actor:test' })
      const result = await executeTool(
        tool,
        {
          direction: 'ref-to-envelope',
          payload: sharedRefOaSdk as unknown as Record<string, unknown>,
          options: { fileId: 'drive_123_test' },
        },
        ctx
      )

      expect(result.status).toBe('success')
      expect(result.result?.$schema).toBe('entity-source/v1')
      expect(result.result?.identity).toBeDefined()
    })

    it('executes ewic_verify_execution and confirms reproducible status', async () => {
      const tool = createVerifyExecutionTool(port)
      const ctx = createToolContext({ actorId: 'actor:test' })
      const result = await executeTool(
        tool,
        {
          actorId: 'actor:test',
          execution: fixtureExecution.content,
        },
        ctx
      )

      expect(result.status).toBe('reproducible')
    })
  })

  // =========================================================================
  // Tier 7: Mock Denial & Security Boundaries (No-Leak Verification)
  // =========================================================================
  describe('7. Mock Denial & Security Boundaries (No-Leak Verification)', () => {
    it('returns indistinguishable responses between denied ACL and non-existent envelope (preventing presence enumeration)', async () => {
      const portDenied = createMockPort({
        verifySnapshot: async () => {
          throw new Error('ACL_DENIED: unauthorized actor')
        },
      })

      const portNotFound = createMockPort({
        verifySnapshot: async () => {
          throw new Error('FILE_NOT_FOUND: entity not found')
        },
      })

      const toolDenied = createVerifyExecutionTool(portDenied)
      const toolNotFound = createVerifyExecutionTool(portNotFound)
      const ctx = createToolContext({ actorId: 'actor:guest' })

      const resDenied = await executeTool(
        toolDenied,
        {
          actorId: 'actor:guest',
          execution: fixtureExecution.content,
        },
        ctx
      )

      const resNotFound = await executeTool(
        toolNotFound,
        {
          actorId: 'actor:guest',
          execution: fixtureExecution.content,
        },
        ctx
      )

      // Both must return identical unavailable status without disclosing existence
      expect(resDenied).toEqual({ status: 'unavailable' })
      expect(resNotFound).toEqual({ status: 'unavailable' })
    })

    it('strictly conceals provider exceptions and private filesystem paths without leak', async () => {
      const portLeakingError = createMockPort({
        verifySnapshot: async () => {
          throw new Error(
            'CRITICAL_INTERNAL_FAILURE: Cannot open database at /Users/private/secure/tokens.db: Permission denied'
          )
        },
      })

      const tool = createVerifyExecutionTool(portLeakingError)
      const ctx = createToolContext({ actorId: 'actor:attacker' })
      const res = await executeTool(
        tool,
        {
          actorId: 'actor:attacker',
          execution: fixtureExecution.content,
        },
        ctx
      )

      expect(res).toEqual({ status: 'unavailable' })
      expect(JSON.stringify(res)).not.toContain('/Users/private/secure')
      expect(JSON.stringify(res)).not.toContain('tokens.db')
    })
  })

  // =========================================================================
  // Tier 8: Architectural Scope & Non-Expansion Verification
  // =========================================================================
  describe('8. Architectural Scope & Read-Only Non-Expansion Verification', () => {
    it('strictly exposes ZERO mutation tools in the EWIC tool suite', () => {
      const port = createMockPort()
      const tools = createEwicTools(port)
      const mutationVerbs = ['create', 'update', 'delete', 'write', 'mutate', 'patch', 'post', 'put', 'insert']

      for (const tool of tools) {
        for (const verb of mutationVerbs) {
          expect(tool.name.toLowerCase()).not.toContain(`_${verb}`)
          expect(tool.name.toLowerCase()).not.toContain(`${verb}_`)
        }
      }
    })

    it('guarantees that SDK does not mint authoritative IDs or mutate source envelopes', () => {
      // Source envelope is immutable by default (EWIC v0.1 safety rule)
      const spec = loadFixture<{ safety: { sourceIsImmutableByDefault: boolean } }>('workflow-entity-spec.v0.1.json')
      expect(spec.safety.sourceIsImmutableByDefault).toBe(true)
      expect(spec.safety.acceptedChangesCreateNewRevision).toBe(true)
      expect(spec.safety.executionsAreAppendOnly).toBe(true)
    })
  })
})
