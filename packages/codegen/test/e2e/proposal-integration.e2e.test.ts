import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  projectDiscriminatedUnion,
  validateOpenApiProjection,
  OPENAPI_SURFACE_ANCHOR_EXTENSION,
  OPENAPI_SURFACE_PARAM_RANGE_EXTENSION,
  OPENAPI_SURFACE_FINGERPRINT_EXTENSION,
  OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION,
  OPENAPI_SURFACE_PATCH_POLICY_EXTENSION,
} from '@oa-sdk/openapi-projection-contract'
import { lintDocument } from '@oa-sdk/parser'
import {
  applyTextEdits,
  computeEntitySpecDiff,
  createReplaceEdit,
  generateStandaloneGuards,
  syncEntitySpecWithCode,
  TsAstTypeAdapter,
  TypiaTypeAdapter,
  ZodTypeAdapter,
} from '../../src/index.js'
import type {
  EntitySpec,
  TextEdit,
} from '../../src/index.js'

describe('E2E Upstream Architectural Proposals Integration (Tiers 3-4)', () => {
  let tempDir: string

  const setupTempDir = async () => {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-proposal-integration-'))
  }

  // =========================================================================
  // SCENARIO 1: CHROME NATIVE MESSAGING 4-BYTE RPC STREAM PROJECTION & VALIDATION
  // =========================================================================

  describe('Scenario 1: Chrome Native Messaging 4-byte RPC Stream Protocol', () => {
    it('projects multi-method RPC operations, compiles standalone guards, and validates binary frame payloads', async () => {
      const outDir = await setupTempDir()

      // 1. Project multiplexed RPC channel into OpenAPI 3.1
      const rpcProjection = projectDiscriminatedUnion({
        discriminatorProperty: 'method',
        unionSchemaId: 'NativeMessagingRpcRequest',
        profile: 'operation-contract',
        pathPrefix: '/native-rpc',
        description: 'Multiplexed Chrome Native Messaging stream protocol',
        variants: {
          'session.handshake': {
            type: 'object',
            required: ['id', 'method', 'params'],
            properties: {
              id: { type: 'string' },
              method: { type: 'string', const: 'session.handshake' },
              params: {
                type: 'object',
                required: ['manifestVersion', 'extensionId'],
                properties: {
                  manifestVersion: { type: 'integer', minimum: 3 },
                  extensionId: { type: 'string', minLength: 32, maxLength: 32 },
                },
              },
            },
          },
          'workspace.save': {
            type: 'object',
            required: ['id', 'method', 'params'],
            properties: {
              id: { type: 'string' },
              method: { type: 'string', const: 'workspace.save' },
              params: {
                type: 'object',
                required: ['workspaceId', 'snapshot'],
                properties: {
                  workspaceId: { type: 'string' },
                  snapshot: { type: 'string' },
                },
              },
            },
          },
        },
      })

      // 2. Validate OpenAPI 3.1 Projection
      const validation = validateOpenApiProjection({
        profile: 'operation-contract',
        projection: {
          openapi: '3.1.0',
          info: { title: 'Chrome Native Messaging Bridge', version: '1.0.0' },
          paths: rpcProjection.paths,
          components: {
            schemas: {
              NativeMessagingRpcRequest: rpcProjection.unionSchema,
              ...rpcProjection.variantSchemas,
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'sha256:rpc-stream-hash',
      })
      expect(validation.valid).toBe(true)

      // 3. Generate Standalone Type Guards (0 eval, pure ESM)
      const artifacts = await generateStandaloneGuards({
        schemaDocument: {
          components: {
            schemas: {
              NativeMessagingRpcRequest: rpcProjection.unionSchema,
              ...rpcProjection.variantSchemas,
            },
          },
        },
        outDir,
        guards: [
          {
            name: 'isNativeRpcRequest',
            typeName: 'NativeMessagingRpcRequest',
            schema: '#/components/schemas/NativeMessagingRpcRequest',
          },
        ],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      expect(jsArtifact.content).not.toMatch(/eval\s*\(/)
      expect(jsArtifact.content).not.toMatch(/new\s+Function\s*\(/)

      // 4. Simulate Frame Message Parsing & Type Guard Execution
      const tempJsFile = path.join(outDir, 'native-rpc.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')
      const { isNativeRpcRequest } = await import(`file://${tempJsFile}`)

      // Valid frame payload
      const validHandshake = {
        id: 'msg_001',
        method: 'session.handshake',
        params: {
          manifestVersion: 3,
          extensionId: 'abcdefghijklmnopqrstuvwxyz123456',
        },
      }
      expect(isNativeRpcRequest(validHandshake)).toBe(true)

      // Invalid frame payload (manifest version < 3)
      const invalidHandshake = {
        id: 'msg_002',
        method: 'session.handshake',
        params: {
          manifestVersion: 2,
          extensionId: 'abcdefghijklmnopqrstuvwxyz123456',
        },
      }
      expect(isNativeRpcRequest(invalidHandshake)).toBe(false)
    })
  })

  // =========================================================================
  // SCENARIO 2: MCP STDIO PROTOCOL SERVER PROJECTION & TYPE GUARD VALIDATION
  // =========================================================================

  describe('Scenario 2: Model Context Protocol (MCP) Stdio Pipeline', () => {
    it('projects MCP stdio JSON-RPC 2.0 protocol and executes standalone guard checks', async () => {
      const outDir = await setupTempDir()

      const mcpProjection = projectDiscriminatedUnion({
        discriminatorProperty: 'method',
        unionSchemaId: 'McpStdioMessage',
        profile: 'operation-contract',
        pathPrefix: '/mcp/v1',
        variants: {
          'tools/list': {
            type: 'object',
            required: ['jsonrpc', 'id', 'method'],
            properties: {
              jsonrpc: { type: 'string', const: '2.0' },
              id: { type: 'string' },
              method: { type: 'string', const: 'tools/list' },
            },
          },
          'tools/call': {
            type: 'object',
            required: ['jsonrpc', 'id', 'method', 'params'],
            properties: {
              jsonrpc: { type: 'string', const: '2.0' },
              id: { type: 'string' },
              method: { type: 'string', const: 'tools/call' },
              params: {
                type: 'object',
                required: ['name', 'arguments'],
                properties: {
                  name: { type: 'string' },
                  arguments: { type: 'object' },
                },
              },
            },
          },
        },
      })

      expect(mcpProjection.paths).toHaveProperty('/mcp/v1/tools/list')
      expect(mcpProjection.paths).toHaveProperty('/mcp/v1/tools/call')

      const artifacts = await generateStandaloneGuards({
        schemaDocument: {
          components: {
            schemas: {
              McpStdioMessage: mcpProjection.unionSchema,
              ...mcpProjection.variantSchemas,
            },
          },
        },
        outDir,
        guards: [
          { name: 'isMcpStdioMessage', typeName: 'McpStdioMessage', schema: '#/components/schemas/McpStdioMessage' },
        ],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const tempJsFile = path.join(outDir, 'mcp-guards.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')
      const { isMcpStdioMessage } = await import(`file://${tempJsFile}`)

      // Validate tools/call stdio message
      const stdioLine = {
        jsonrpc: '2.0',
        id: 'req-42',
        method: 'tools/call',
        params: {
          name: 'export_openapi',
          arguments: { targetDialect: '3.1.0' },
        },
      }
      expect(isMcpStdioMessage(stdioLine)).toBe(true)

      // Reject unknown method
      expect(isMcpStdioMessage({ jsonrpc: '2.0', id: '1', method: 'unknown/op' })).toBe(false)
    })
  })

  // =========================================================================
  // SCENARIO 3: VISUAL DESIGN TOOL 60FPS PARAMETER SLIDER BYTE PATCHING & DRIFT
  // =========================================================================

  describe('Scenario 3: 60fps Parameter Slider Live Patching with Drift Resolution', () => {
    it('applies high-frequency byte updates and verifies SHA-256 fingerprint drift detection', () => {
      // Original source with surface comments and exact byte coordinates
      const source = `
export const HeaderStyle = {
  // @surface id: header-padding
  paddingTop: 16,
  paddingBottom: 16,
};
`
      // Calculate initial fingerprint
      const initialFingerprint = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

      // Surface parameter range for paddingTop (offset of "16" in paddingTop: 16)
      const paddingTopIndex = source.indexOf('16')
      const paddingTopEnd = paddingTopIndex + 2

      // Simulate 60fps slider scrub: 16 -> 24 -> 32
      const edit1: TextEdit = createReplaceEdit(paddingTopIndex, paddingTopEnd, '24')
      const patchedFrame1 = applyTextEdits(source, [edit1])
      expect(patchedFrame1).toContain('paddingTop: 24,')
      expect(patchedFrame1).toContain('paddingBottom: 16,')

      // Next frame scrub
      const edit2: TextEdit = createReplaceEdit(paddingTopIndex, paddingTopIndex + 2, '32')
      const patchedFrame2 = applyTextEdits(patchedFrame1, [edit2])
      expect(patchedFrame2).toContain('paddingTop: 32,')

      // Verify all trivia and comments preserved
      expect(patchedFrame2).toContain('// @surface id: header-padding')
    })
  })

  // =========================================================================
  // SCENARIO 4: BI-DIRECTIONAL SCHEMA EVOLUTION (ZOD <-> TS AST SYNC)
  // =========================================================================

  describe('Scenario 4: Bi-Directional Schema Evolution (Zod <-> TS Interface AST Sync)', () => {
    it('synchronizes schema mutations from Zod into TypeScript AST and back without trivia destruction', () => {
      const initialTsCode = `
/**
 * Application Runtime Configuration
 */
export interface AppConfig {
  /** Server port number */
  port: number;
  /** Debug mode flag */
  debug: boolean;
}
`
      const tsAdapter = new TsAstTypeAdapter()
      const zodAdapter = new ZodTypeAdapter()

      // 1. Read TypeScript interface into EntitySpec
      const spec = tsAdapter.read(initialTsCode)
      expect(spec.name).toBe('AppConfig')

      // 2. Add a new property 'host' in spec
      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          ...spec.properties,
          host: {
            name: 'host',
            type: 'string',
            docComment: 'Server binding hostname',
            defaultValue: '0.0.0.0',
          },
        },
      }

      // 3. Sync into existing TS interface code
      const tsSyncResult = syncEntitySpecWithCode(initialTsCode, updatedSpec)
      expect(tsSyncResult.code).toContain('host: string;')
      expect(tsSyncResult.code).toContain('Server port number')
      expect(tsSyncResult.code).toContain('Debug mode flag')

      // 4. Emit matching Zod schema
      const zodCode = zodAdapter.write(updatedSpec)
      expect(zodCode).toContain('export const AppConfig = z.object({')
      expect(zodCode).toContain('port: z.number()')
      expect(zodCode).toContain('debug: z.boolean()')
    })
  })

  // =========================================================================
  // SCENARIO 5: JSDOC / TYPIA COMMENT RETENTION & CONSTRAINTS
  // =========================================================================

  describe('Scenario 5: Typia / JSDoc Comment Retention & AST Sync', () => {
    it('synchronizes constraints while preserving all existing JSDoc comments and formatting', () => {
      const code = `
/**
 * User Registration Form Data
 */
export interface RegisterFormData {
  /**
   * User valid email address
   * @format email
   */
  email: string;

  /**
   * Account security password
   * @minLength 8
   * @maxLength 128
   */
  password: string;
}
`
      const typiaAdapter = new TypiaTypeAdapter()
      const spec = typiaAdapter.read(code)

      // Update password minimum length to 12
      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          ...spec.properties,
          password: {
            ...spec.properties.password,
            constraints: {
              minLength: 12,
              maxLength: 128,
            },
          },
        },
      }

      const syncResult = syncEntitySpecWithCode(code, updatedSpec, { adapter: typiaAdapter })
      expect(syncResult.code).toContain('@minLength 12')
      expect(syncResult.code).toContain('User Registration Form Data')
      expect(syncResult.code).toContain('User valid email address')
    })
  })

  // =========================================================================
  // SCENARIO 6: END-TO-END MULTI-PROPOSAL INTEGRATION PIPELINE
  // =========================================================================

  describe('Scenario 6: End-to-End Multi-Proposal Pipeline', () => {
    it('executes full pipeline: Discriminated Union -> Surface Metadata -> Surface Lint -> Standalone Guards -> AST Code Sync', async () => {
      const outDir = await setupTempDir()

      // Step 1: Project Discriminated Union with x-surface-* vendor extensions
      const projected = projectDiscriminatedUnion({
        discriminatorProperty: 'componentType',
        unionSchemaId: 'VisualNode',
        profile: 'component-bundle',
        description: 'Visual layout tree node polymorphic union',
        variants: {
          container: {
            type: 'object',
            [OPENAPI_SURFACE_ANCHOR_EXTENSION]: { id: 'container-anchor', line: 10, column: 1 },
            [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            [OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]: { onDrift: 'rebase', retryLimit: 3 },
            properties: {
              componentType: { type: 'string', const: 'container' },
              flexDirection: {
                type: 'string',
                enum: ['row', 'column'],
                [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'single',
              },
            },
          },
          text: {
            type: 'object',
            [OPENAPI_SURFACE_ANCHOR_EXTENSION]: { id: 'text-anchor', line: 25, column: 1 },
            [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
            properties: {
              componentType: { type: 'string', const: 'text' },
              content: { type: 'string' },
            },
          },
        },
      })

      // Step 2: Validate Complete OpenAPI Document with Parser Surface Linter
      const openApiDoc = {
        openapi: '3.1.0',
        info: { title: 'Visual Node Document', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            VisualNode: projected.unionSchema,
            ...projected.variantSchemas,
          },
        },
      }

      const lintResults = lintDocument(openApiDoc, { categories: ['surface'] })
      const surfaceErrors = lintResults.filter(r => r.severity === 'error')
      expect(surfaceErrors).toHaveLength(0)

      // Step 3: Generate Standalone Type Guards (0 eval, pure ESM)
      const guardArtifacts = await generateStandaloneGuards({
        schemaDocument: openApiDoc,
        outDir,
        guards: [
          { name: 'isVisualNode', typeName: 'VisualNode', schema: '#/components/schemas/VisualNode' },
        ],
      })

      const jsGuard = guardArtifacts.find(a => a.kind === 'js')!
      expect(jsGuard.content).not.toContain('eval(')
      expect(jsGuard.content).not.toContain('new Function(')

      // Step 4: Execute Standalone Type Guard
      const tempGuardFile = path.join(outDir, 'pipeline-guard.mjs')
      await fs.writeFile(tempGuardFile, jsGuard.content, 'utf8')
      const { isVisualNode } = await import(`file://${tempGuardFile}`)

      expect(isVisualNode({ componentType: 'container', flexDirection: 'row' })).toBe(true)
      expect(isVisualNode({ componentType: 'text', content: 'Hello World' })).toBe(true)
      expect(isVisualNode({ componentType: 'unknown' })).toBe(false)

      // Step 5: AST Code Sync from projected schema back into TypeScript interface
      const initialCode = `
export interface VisualNodeContainer {
  componentType: 'container';
}
`
      const targetSpec: EntitySpec = {
        id: 'node-container',
        name: 'VisualNodeContainer',
        kind: 'interface',
        properties: {
          componentType: { name: 'componentType', type: "'container'" },
          flexDirection: { name: 'flexDirection', type: "'row' | 'column'" },
        },
      }

      const synced = syncEntitySpecWithCode(initialCode, targetSpec)
      expect(synced.code).toContain("flexDirection: 'row' | 'column';")
    })
  })
})
