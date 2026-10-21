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
  validateCollaborationManifest,
  validateSourceReference,
  validateReferenceIndex,
  validateManagementProjection,
  validateCollaborationsRegistry,
} from './validator/context-harness-validator.js'
import {
  createCollaborationTools,
  createBootstrapTool,
  createResolveReferenceTool,
  createQueryManagementTool,
} from './tools/index.js'
import type { SharedContextHarnessPort } from './contracts/ports.js'
import type {
  CollaborationManifest,
  SourceReference,
  CollaborationReferenceIndex,
  CollaborationManagementProjection,
  CollaborationsRegistry,
} from './contracts/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Helpers to load fixtures
function loadFixture<T>(path: string): T {
  const fullPath = join(__dirname, 'fixtures', path)
  return JSON.parse(readFileSync(fullPath, 'utf-8'))
}

describe('Issue #2: Shared Context Harness Contract Validation with oa-sdk Core', () => {
  const fixtureManifest = loadFixture<CollaborationManifest>('collab-context-harness/collaboration.json')
  const fixtureRefOaSdk = loadFixture<SourceReference>('collab-context-harness/references/ref-oa-sdk.json')
  const fixtureRefGwt = loadFixture<SourceReference>('collab-context-harness/references/ref-google-workspace-toolkit.json')
  const fixtureRefSem = loadFixture<SourceReference>('collab-context-harness/references/ref-semantic-platform.json')
  const fixtureIndex = loadFixture<CollaborationReferenceIndex>('collab-context-harness/references/index.json')
  const fixtureManagement = loadFixture<CollaborationManagementProjection>('collab-context-harness/management.json')
  const fixtureRegistry = loadFixture<CollaborationsRegistry>('collaborations-registry.json')

  // Mock Port factory
  function createMockPort(overrides: Partial<SharedContextHarnessPort> = {}): SharedContextHarnessPort {
    const defaultPort: SharedContextHarnessPort = {
      canReadCollaboration: async (_actorId, _collab) => true,
      isRegisteredReference: async (_collab, ref) => {
        return fixtureIndex.references.some((r) => r.referenceId === ref.referenceId)
      },
      canReadSource: async (_actorId, _ref) => true,
      readSource: async (ref) => {
        return {
          content: `# Mock source for ${ref.referenceId}\nPackage documentation.`,
          snapshotId: ref.source.snapshot.id,
        }
      },
      readCollaboration: async (id) => {
        return id === fixtureManifest.collaborationId ? fixtureManifest : null
      },
      readReferenceIndex: async (id) => {
        return id === fixtureManifest.collaborationId ? fixtureIndex : null
      },
      readManagementProjection: async (id) => {
        return id === fixtureManifest.collaborationId ? fixtureManagement : null
      },
      readReference: async (collabId, refId) => {
        if (collabId !== fixtureManifest.collaborationId) return null
        if (refId === 'ref-oa-sdk') return fixtureRefOaSdk
        if (refId === 'ref-google-workspace-toolkit') return fixtureRefGwt
        if (refId === 'ref-semantic-platform') return fixtureRefSem
        return null
      },
    }
    return { ...defaultPort, ...overrides }
  }

  // =========================================================================
  // Tier 1: TypeSpec AST Ingestion & In-Memory Compilation Fidelity
  // =========================================================================
  describe('1. TypeSpec Schema Ingestion & AST Fidelity', () => {
    it('compiles TypeSpec context harness contract in-memory without disk I/O', async () => {
      const tspEntry = join(__dirname, 'schema/typespec/main.tsp')
      const result = await compileTypeSpecInMemory(tspEntry, {
        openApiVersion: '3.1.0',
      })

      expect(result.program).toBeDefined()
      expect(result.document).toBeDefined()
      expect(result.routesCount).toBe(4) // 4 GET routes defined in main.tsp

      // Verify discovered operations
      const paths = Object.keys(result.document.paths || {})
      expect(paths).toContain('/collaborations/{collaborationId}')
      expect(paths).toContain('/collaborations/{collaborationId}/references')
      expect(paths).toContain('/collaborations/{collaborationId}/references/{referenceId}')
      expect(paths).toContain('/collaborations/{collaborationId}/management')
    })
  })

  // =========================================================================
  // Tier 2: JSON Schema Draft 2020-12 Validation & Boundary Invariants
  // =========================================================================
  describe('2. JSON Schema Draft 2020-12 Validation & Invariants', () => {
    it('validates well-formed real-world pilot fixtures successfully', () => {
      expect(validateCollaborationManifest(fixtureManifest).ok).toBe(true)
      expect(validateSourceReference(fixtureRefOaSdk).ok).toBe(true)
      expect(validateSourceReference(fixtureRefGwt).ok).toBe(true)
      expect(validateSourceReference(fixtureRefSem).ok).toBe(true)
      expect(validateReferenceIndex(fixtureIndex).ok).toBe(true)
      expect(validateManagementProjection(fixtureManagement).ok).toBe(true)
      expect(validateCollaborationsRegistry(fixtureRegistry).ok).toBe(true)
    })

    it('enforces fail-closed validation on extra unknown fields (additionalProperties: false)', () => {
      const invalidManifest = { ...fixtureManifest, unexpectedField: 'leak' }
      const res = validateCollaborationManifest(invalidManifest)
      expect(res.ok).toBe(false)
      expect(res.issues.some((i) => i.toLowerCase().includes('unknown field') || i.toLowerCase().includes('additionalproperties'))).toBe(true)
    })

    it('fails closed on duplicate category folder IDs or root folder reuse', () => {
      const reusedFolderManifest = JSON.parse(JSON.stringify(fixtureManifest))
      reusedFolderManifest.storage.folderIds.proposals = reusedFolderManifest.storage.folderIds.discussions
      expect(validateCollaborationManifest(reusedFolderManifest).ok).toBe(false)

      const rootReusedManifest = JSON.parse(JSON.stringify(fixtureManifest))
      rootReusedManifest.storage.folderIds.proposals = rootReusedManifest.storage.rootFolderId
      expect(validateCollaborationManifest(rootReusedManifest).ok).toBe(false)
    })

    it('fails closed when rootFolderId is "root" or violates Drive ID format', () => {
      const rootFallbackManifest = JSON.parse(JSON.stringify(fixtureManifest))
      rootFallbackManifest.storage.rootFolderId = 'root'
      expect(validateCollaborationManifest(rootFallbackManifest).ok).toBe(false)
    })

    it('fails closed on duplicate participant workspace IDs', () => {
      const dupParticipantManifest = JSON.parse(JSON.stringify(fixtureManifest))
      dupParticipantManifest.participants.push({ ...dupParticipantManifest.participants[0] })
      const res = validateCollaborationManifest(dupParticipantManifest)
      expect(res.ok).toBe(false)
      expect(res.issues).toContain('DUPLICATE_PARTICIPANT_WORKSPACE_ID')
    })

    it('enforces strict git snapshot rules (rejects mutable branches/placeholders, enforces 40-char SHA)', () => {
      const mutableRef = JSON.parse(JSON.stringify(fixtureRefOaSdk))
      mutableRef.source.snapshot.id = 'main'
      expect(validateSourceReference(mutableRef).ok).toBe(false)

      const placeholderRef = JSON.parse(JSON.stringify(fixtureRefOaSdk))
      placeholderRef.source.snapshot.id = '<verified-commit-sha>'
      expect(validateSourceReference(placeholderRef).ok).toBe(false)

      const nonHexShaRef = JSON.parse(JSON.stringify(fixtureRefOaSdk))
      nonHexShaRef.source.snapshot.id = 'not-a-40-character-hex-string-at-all!!'
      expect(validateSourceReference(nonHexShaRef).ok).toBe(false)
    })
  })

  // =========================================================================
  // Tier 3: Read-Only Tool Contracts with @oa-sdk/tools
  // =========================================================================
  describe('3. @oa-sdk/tools Read-Only Interfaces (MCP, CLI, REST)', () => {
    it('creates 3 read-only collaboration tools matching public 0.1.1 contract', () => {
      const port = createMockPort()
      const tools = createCollaborationTools(port)

      expect(tools).toHaveLength(3)
      const names = tools.map((t) => t.name)
      expect(names).toEqual(['collab_bootstrap', 'collab_resolve_reference', 'collab_query_management'])
    })

    it('exports tools cleanly to MCP Server format with Draft 2020-12 inputSchema', () => {
      const port = createMockPort()
      const tools = createCollaborationTools(port)
      const mcpServer = createMcpServer(tools, { name: 'context-harness-mcp' })
      const mcpTools = mcpServer.getTools()

      expect(mcpTools).toHaveLength(3)
      for (const tool of mcpTools) {
        expect(tool.inputSchema.type).toBe('object')
        expect(tool.inputSchema.properties).toBeDefined()
      }
    })

    it('integrates with Commander CLI without syntax error and groups by category', () => {
      const port = createMockPort()
      const tools = createCollaborationTools(port)
      const cli = createCli(tools, { name: 'collab-cli' })
      expect(cli).toBeDefined()

      const collabCmd = cli.commands.find((c) => c.name() === 'collaboration')
      expect(collabCmd).toBeDefined()
      expect(collabCmd!.commands).toHaveLength(3)
    })

    it('integrates with Hono REST HTTP app generator and ToolApp', () => {
      const port = createMockPort()
      const tools = createCollaborationTools(port)
      const app = createHttpApp(tools, { title: 'Collaboration API', version: '0.1.0' })
      expect(app).toBeDefined()
      expect(typeof app.fetch).toBe('function')

      const toolApp = createToolApp({ name: 'collab-hub' }).tools(...tools)
      expect(toolApp.getTools()).toHaveLength(3)
    })

    it('executes collab_bootstrap and returns verified manifest and references', async () => {
      const port = createMockPort()
      const bootstrapTool = createBootstrapTool(port)
      const ctx = createToolContext()

      const result = await executeTool(
        bootstrapTool,
        { collaborationId: 'collab-context-harness', actorId: 'actor:dev1' },
        ctx,
      )

      expect(result.status).toBe('ready')
      expect(result.collaborationId).toBe('collab-context-harness')
      expect(result.title).toBe('Context Harness Shared Collaboration Pilot')
      expect(result.references).toHaveLength(3)
    })

    it('executes collab_resolve_reference and returns resolved pinned source material', async () => {
      const port = createMockPort()
      const resolveTool = createResolveReferenceTool(port)
      const ctx = createToolContext()

      const result = await executeTool(
        resolveTool,
        {
          collaborationId: 'collab-context-harness',
          referenceId: 'ref-oa-sdk',
          actorId: 'actor:dev1',
        },
        ctx,
      )

      expect(result.status).toBe('resolved')
      expect(result.referenceId).toBe('ref-oa-sdk')
      expect(result.snapshotId).toBe('6542531b402849e7939116e0339912066f7fbb5a')
      expect(result.content).toContain('Package documentation')
    })

    it('executes collab_query_management and returns active workstreams and milestones', async () => {
      const port = createMockPort()
      const queryTool = createQueryManagementTool(port)
      const ctx = createToolContext()

      const result = await executeTool(
        queryTool,
        { collaborationId: 'collab-context-harness', actorId: 'actor:dev1' },
        ctx,
      )

      expect(result.status).toBe('ready')
      expect(result.management.workstreams).toHaveLength(3)
      expect(result.management.milestones).toHaveLength(3)
    })
  })

  // =========================================================================
  // Tier 4: Mock Denial & Security Boundaries (No-Leak Verification)
  // =========================================================================
  describe('4. Mock Denial & Security Boundaries (No-Leak Verification)', () => {
    it('aborts without reading source when collaboration ACL is denied', async () => {
      let sourceReadCalls = 0
      const port = createMockPort({
        canReadCollaboration: async () => false,
        readSource: async () => {
          sourceReadCalls++
          return { content: 'secret', snapshotId: 'any' }
        },
      })

      const resolveTool = createResolveReferenceTool(port)
      const result = await executeTool(
        resolveTool,
        { collaborationId: 'collab-context-harness', referenceId: 'ref-oa-sdk', actorId: 'unauthorized-actor' },
        createToolContext(),
      )

      expect(result).toEqual({ status: 'unavailable' })
      expect(sourceReadCalls).toBe(0)
    })

    it('aborts without reading source when source repo ACL is denied', async () => {
      let sourceReadCalls = 0
      const port = createMockPort({
        canReadCollaboration: async () => true,
        canReadSource: async () => false,
        readSource: async () => {
          sourceReadCalls++
          return { content: 'secret', snapshotId: 'any' }
        },
      })

      const resolveTool = createResolveReferenceTool(port)
      const result = await executeTool(
        resolveTool,
        { collaborationId: 'collab-context-harness', referenceId: 'ref-oa-sdk', actorId: 'actor:guest' },
        createToolContext(),
      )

      expect(result).toEqual({ status: 'unavailable' })
      expect(sourceReadCalls).toBe(0)
    })

    it('returns indistinguishable responses between denied ACL and non-existent reference (preventing presence enumeration)', async () => {
      const deniedPort = createMockPort({
        canReadSource: async () => false,
      })
      const notFoundPort = createMockPort({
        readReference: async () => null,
      })

      const resolveToolDenied = createResolveReferenceTool(deniedPort)
      const resolveToolNotFound = createResolveReferenceTool(notFoundPort)

      const resultDenied = await executeTool(
        resolveToolDenied,
        { collaborationId: 'collab-context-harness', referenceId: 'ref-oa-sdk', actorId: 'actor:dev1' },
        createToolContext(),
      )

      const resultNotFound = await executeTool(
        resolveToolNotFound,
        { collaborationId: 'collab-context-harness', referenceId: 'ref-non-existent', actorId: 'actor:dev1' },
        createToolContext(),
      )

      // MUST be strictly indistinguishable { status: 'unavailable' }
      expect(resultDenied).toEqual(resultNotFound)
      expect(resultDenied).toEqual({ status: 'unavailable' })
    })

    it('detects stale snapshot when source provider returns different commit SHA', async () => {
      const port = createMockPort({
        readSource: async () => {
          return {
            content: '# Stale content from new HEAD',
            snapshotId: 'ffffffffffffffffffffffffffffffffffffffff', // different commit
          }
        },
      })

      const resolveTool = createResolveReferenceTool(port)
      const result = await executeTool(
        resolveTool,
        { collaborationId: 'collab-context-harness', referenceId: 'ref-oa-sdk', actorId: 'actor:dev1' },
        createToolContext(),
      )

      expect(result).toEqual({ status: 'stale' })
    })

    it('strictly conceals provider exceptions and internal filesystem paths without leak', async () => {
      const port = createMockPort({
        readSource: async () => {
          throw new Error('Database error at /Users/private/secure/token.key: permission denied')
        },
      })

      const resolveTool = createResolveReferenceTool(port)
      const result = await executeTool(
        resolveTool,
        { collaborationId: 'collab-context-harness', referenceId: 'ref-oa-sdk', actorId: 'actor:dev1' },
        createToolContext(),
      )

      // Masked as unavailable, no raw exception propagated or path leaked
      expect(result).toEqual({ status: 'unavailable' })
    })

    describe('conceals a throwing provider method in every tool that calls it', () => {
      const SECRET_PATH = '/Users/private/secure/token.key'
      const throwing = async (): Promise<never> => {
        throw new Error(`Drive API error at ${SECRET_PATH}: permission denied`)
      }
      const resolveInput = { collaborationId: 'collab-context-harness', referenceId: 'ref-oa-sdk', actorId: 'actor:dev1' }
      const collabInput = { collaborationId: 'collab-context-harness', actorId: 'actor:dev1' }

      it.each([
        'readCollaboration',
        'canReadCollaboration',
        'readReference',
        'isRegisteredReference',
        'canReadSource',
        'readSource',
      ] as const)('collab_resolve_reference resolves to unavailable when %s throws', async (method) => {
        const tool = createResolveReferenceTool(createMockPort({ [method]: throwing }))
        const result = await executeTool(tool, resolveInput, createToolContext())

        expect(result).toEqual({ status: 'unavailable' })
        expect(JSON.stringify(result)).not.toContain(SECRET_PATH)
      })

      it.each(['readCollaboration', 'canReadCollaboration', 'readReferenceIndex'] as const)(
        'collab_bootstrap resolves to unavailable when %s throws',
        async (method) => {
          const tool = createBootstrapTool(createMockPort({ [method]: throwing }))
          const result = await executeTool(tool, collabInput, createToolContext())

          expect(result).toEqual({ status: 'unavailable', collaborationId: 'collab-context-harness' })
          expect(JSON.stringify(result)).not.toContain(SECRET_PATH)
        },
      )

      it.each(['readCollaboration', 'canReadCollaboration', 'readManagementProjection'] as const)(
        'collab_query_management resolves to unavailable when %s throws',
        async (method) => {
          const tool = createQueryManagementTool(createMockPort({ [method]: throwing }))
          const result = await executeTool(tool, collabInput, createToolContext())

          expect(result).toEqual({ status: 'unavailable' })
          expect(JSON.stringify(result)).not.toContain(SECRET_PATH)
        },
      )

      it('every tool succeeds with a healthy port (the throwing cases are not vacuous)', async () => {
        const port = createMockPort()
        const resolved = await executeTool(createResolveReferenceTool(port), resolveInput, createToolContext())
        const bootstrap = await executeTool(createBootstrapTool(port), collabInput, createToolContext())
        const management = await executeTool(createQueryManagementTool(port), collabInput, createToolContext())

        expect(resolved.status).toBe('resolved')
        expect(bootstrap.status).toBe('ready')
        expect(management.status).toBe('ready')
      })
    })

    it('blocks forged reference cards before source ACL or readSource call', async () => {
      let sourceAclChecks = 0
      let sourceReadCalls = 0

      const port = createMockPort({
        isRegisteredReference: async () => false, // Not registered in index
        canReadSource: async () => {
          sourceAclChecks++
          return true
        },
        readSource: async () => {
          sourceReadCalls++
          return { content: 'forged', snapshotId: 'any' }
        },
      })

      const resolveTool = createResolveReferenceTool(port)
      const result = await executeTool(
        resolveTool,
        { collaborationId: 'collab-context-harness', referenceId: 'ref-oa-sdk', actorId: 'actor:dev1' },
        createToolContext(),
      )

      expect(result).toEqual({ status: 'unavailable' })
      expect(sourceAclChecks).toBe(0)
      expect(sourceReadCalls).toBe(0)
    })
  })

  // =========================================================================
  // Tier 5: Architectural Scope & Non-Expansion Verification
  // =========================================================================
  describe('5. Architectural Scope & Read-Only Non-Expansion Verification', () => {
    it('strictly exposes ZERO mutation tools in collaboration tools suite', () => {
      const port = createMockPort()
      const tools = createCollaborationTools(port)

      const mutationKeywords = ['write', 'create', 'update', 'delete', 'mutate', 'patch', 'post', 'put']
      const mutationTools = tools.filter((t) =>
        mutationKeywords.some((keyword) => t.name.toLowerCase().includes(keyword)),
      )

      // Acceptance: "Separate review needed before exposing any mutation tools."
      expect(mutationTools).toHaveLength(0)
    })

    it('confirms schema validation alone does not grant authorization', async () => {
      // Data is 100% valid schema-wise
      expect(validateCollaborationManifest(fixtureManifest).ok).toBe(true)
      expect(validateSourceReference(fixtureRefOaSdk).ok).toBe(true)

      // But port denies authorization
      const denyingPort = createMockPort({
        canReadCollaboration: async () => false,
      })

      const resolveTool = createResolveReferenceTool(denyingPort)
      const result = await executeTool(
        resolveTool,
        { collaborationId: 'collab-context-harness', referenceId: 'ref-oa-sdk', actorId: 'unauthorized-user' },
        createToolContext(),
      )

      expect(result.status).toBe('unavailable')
    })
  })
})
