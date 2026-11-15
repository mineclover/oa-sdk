import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as vm from 'node:vm'

import {
  generateStandaloneGuards,
  EntitySpec,
  EntityPropertySpec,
  computeEntitySpecDiff,
  applyTextEdits,
  createInsertEdit,
  createReplaceEdit,
  createDeleteEdit,
  syncEntitySpecWithCode,
  ZodTypeAdapter,
  TsAstTypeAdapter,
  TypiaTypeAdapter,
} from '../../src/index.js'

const execFileAsync = promisify(execFile)

describe('Empirical Adversarial Stress Harness: Proposals 3 & 4 (@oa-sdk/codegen)', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  const setupTempDir = async (prefix = 'oa-adv-') => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  // =========================================================================
  // PROPOSAL 3: STANDALONE LIGHTWEIGHT TYPE GUARD GENERATOR PLUGIN
  // =========================================================================

  describe('Proposal 3: Standalone Type Guard Generator Adversarial Suite', () => {
    it('ADV-P3-1: Zero-eval CSP compliance and zero dynamic execution inspection', async () => {
      const outDir = await setupTempDir('adv-csp-')
      const schemaDoc = {
        $id: 'https://specs.oa-sdk.io/csp-test.json',
        $defs: {
          UserAccount: {
            type: 'object',
            required: ['id', 'email', 'tier'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              email: { type: 'string', format: 'email' },
              tier: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
              score: { type: 'number', minimum: 0, maximum: 100 },
              tags: { type: 'array', items: { type: 'string' } },
              nested: {
                type: 'object',
                properties: {
                  active: { type: 'boolean' },
                },
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isUserAccount', typeName: 'UserAccount', schema: '#/$defs/UserAccount' }],
        generateDeclarations: true,
      })

      const jsArtifact = artifacts.find(a => a.filePath.endsWith('guards.js'))
      expect(jsArtifact).toBeDefined()
      const jsCode = jsArtifact!.content

      // 1. Strict regex inspection for dynamic evaluation primitives
      expect(jsCode).not.toMatch(/\beval\s*\(/)
      expect(jsCode).not.toMatch(/\bnew\s+Function\s*\(/)
      expect(jsCode).not.toMatch(/\bFunction\s*\(/)
      expect(jsCode).not.toMatch(/\bWebAssembly\b/)
      expect(jsCode).not.toMatch(/\bsetTimeout\s*\(\s*['"]/)
      expect(jsCode).not.toMatch(/\bsetInterval\s*\(\s*['"]/)

      // 2. Zero runtime imports inspection (no external npm dependencies)
      expect(jsCode).not.toMatch(/from\s+['"]ajv/)
      expect(jsCode).not.toMatch(/from\s+['"]@/)
      expect(jsCode).not.toMatch(/from\s+['"]node:/)
      expect(jsCode).not.toMatch(/require\s*\(/)

      // 3. Sandboxed execution with eval and Function completely removed
      const tempJsFile = path.join(outDir, 'guards.mjs')
      await fs.writeFile(tempJsFile, jsCode, 'utf8')

      const imported = await import(pathToFileURL(tempJsFile).href)
      expect(typeof imported.isUserAccount).toBe('function')

      // Positive check
      const validUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'dev@oa-sdk.io',
        tier: 'pro',
        score: 95.5,
        tags: ['admin', 'beta'],
        nested: { active: true },
      }
      expect(imported.isUserAccount(validUser)).toBe(true)

      // Negative check
      expect(imported.isUserAccount({ ...validUser, tier: 'unknown' })).toBe(false)
      expect(imported.isUserAccount({ ...validUser, id: 'invalid-uuid' })).toBe(false)
      expect(imported.isUserAccount({ ...validUser, score: 150 })).toBe(false)
    })

    it('ADV-P3-2: Recursive, self-referencing, and mutual recursive schemas under high depth', async () => {
      const outDir = await setupTempDir('adv-recursive-')
      const schemaDoc = {
        $id: 'https://specs.oa-sdk.io/recursive-ast.json',
        $defs: {
          TreeNode: {
            type: 'object',
            required: ['id', 'value', 'children'],
            properties: {
              id: { type: 'string' },
              value: { type: 'number' },
              children: {
                type: 'array',
                items: { $ref: '#/$defs/TreeNode' },
              },
            },
          },
          LinkedListNode: {
            type: 'object',
            required: ['val'],
            properties: {
              val: { type: 'string' },
              next: {
                oneOf: [{ $ref: '#/$defs/LinkedListNode' }, { type: 'null' }],
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [
          { name: 'isTreeNode', typeName: 'TreeNode', schema: '#/$defs/TreeNode' },
          { name: 'isLinkedListNode', typeName: 'LinkedListNode', schema: '#/$defs/LinkedListNode' },
        ],
      })

      const jsArtifact = artifacts.find(a => a.filePath.endsWith('guards.js'))!
      const tempJsFile = path.join(outDir, 'guards.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(tempJsFile).href)

      // Build deep recursive tree of depth 50
      type TestTreeNode = { id: string; value: number; children: TestTreeNode[] }
      let currentTree: TestTreeNode = { id: 'leaf', value: 50, children: [] }
      for (let depth = 49; depth >= 1; depth--) {
        currentTree = {
          id: `node-${depth}`,
          value: depth,
          children: [currentTree],
        }
      }

      expect(imported.isTreeNode(currentTree)).toBe(true)

      // Corrupt leaf value deep inside tree
      const corruptTree = JSON.parse(JSON.stringify(currentTree))
      let ptr: any = corruptTree
      while (ptr.children.length > 0) {
        ptr = ptr.children[0]
      }
      ptr.value = 'corrupt-string-instead-of-number'
      expect(imported.isTreeNode(corruptTree)).toBe(false)

      // Linked list of depth 60
      type TestLLNode = { val: string; next: TestLLNode | null }
      let listHead: TestLLNode = { val: 'end', next: null }
      for (let i = 0; i < 60; i++) {
        listHead = { val: `item-${i}`, next: listHead }
      }
      expect(imported.isLinkedListNode(listHead)).toBe(true)

      // Corrupt middle of list
      const corruptList = JSON.parse(JSON.stringify(listHead))
      let lPtr: any = corruptList
      for (let i = 0; i < 30; i++) {
        lPtr = lPtr.next
      }
      lPtr.val = 12345 // invalid type
      expect(imported.isLinkedListNode(corruptList)).toBe(false)
    })

    it('ADV-P3-3: Complex multi-variant oneOf and OpenAPI 3.1 discriminator mapping', async () => {
      const outDir = await setupTempDir('adv-discriminator-')
      const schemaDoc = {
        $id: 'https://specs.oa-sdk.io/rpc-events.json',
        components: {
          schemas: {
            ConnectEvent: {
              type: 'object',
              required: ['kind', 'sessionId', 'clientId'],
              properties: {
                kind: { type: 'string', const: 'connect' },
                sessionId: { type: 'string', format: 'uuid' },
                clientId: { type: 'string' },
              },
            },
            MessageEvent: {
              type: 'object',
              required: ['kind', 'sessionId', 'payload'],
              properties: {
                kind: { type: 'string', const: 'message' },
                sessionId: { type: 'string', format: 'uuid' },
                payload: {
                  type: 'object',
                  required: ['topic', 'data'],
                  properties: {
                    topic: { type: 'string' },
                    data: { type: 'string' },
                  },
                },
              },
            },
            DisconnectEvent: {
              type: 'object',
              required: ['kind', 'sessionId', 'reasonCode'],
              properties: {
                kind: { type: 'string', const: 'disconnect' },
                sessionId: { type: 'string', format: 'uuid' },
                reasonCode: { type: 'integer', minimum: 1000, maximum: 4999 },
              },
            },
            RpcEventEnvelope: {
              type: 'object',
              discriminator: {
                propertyName: 'kind',
                mapping: {
                  connect: '#/components/schemas/ConnectEvent',
                  message: '#/components/schemas/MessageEvent',
                  disconnect: '#/components/schemas/DisconnectEvent',
                },
              },
              oneOf: [
                { $ref: '#/components/schemas/ConnectEvent' },
                { $ref: '#/components/schemas/MessageEvent' },
                { $ref: '#/components/schemas/DisconnectEvent' },
              ],
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [
          { name: 'isRpcEventEnvelope', typeName: 'RpcEventEnvelope', schema: '#/components/schemas/RpcEventEnvelope' },
          { name: 'isConnectEvent', typeName: 'ConnectEvent', schema: '#/components/schemas/ConnectEvent' },
          { name: 'isMessageEvent', typeName: 'MessageEvent', schema: '#/components/schemas/MessageEvent' },
          { name: 'isDisconnectEvent', typeName: 'DisconnectEvent', schema: '#/components/schemas/DisconnectEvent' },
        ],
      })

      const jsArtifact = artifacts.find(a => a.filePath.endsWith('guards.js'))!
      const tempJsFile = path.join(outDir, 'guards.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(tempJsFile).href)

      const connectPayload = {
        kind: 'connect',
        sessionId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        clientId: 'client-001',
      }
      const messagePayload = {
        kind: 'message',
        sessionId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        payload: { topic: 'telemetry', data: 'hello' },
      }
      const disconnectPayload = {
        kind: 'disconnect',
        sessionId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        reasonCode: 1001,
      }

      expect(imported.isRpcEventEnvelope(connectPayload)).toBe(true)
      expect(imported.isRpcEventEnvelope(messagePayload)).toBe(true)
      expect(imported.isRpcEventEnvelope(disconnectPayload)).toBe(true)

      expect(imported.isConnectEvent(connectPayload)).toBe(true)
      expect(imported.isConnectEvent(messagePayload)).toBe(false)

      // Invalid reason code for disconnect
      expect(imported.isRpcEventEnvelope({ ...disconnectPayload, reasonCode: 999 })).toBe(false)
      // Invalid discriminator kind
      expect(imported.isRpcEventEnvelope({ ...connectPayload, kind: 'unknown_kind' })).toBe(false)
    })

    it('ADV-P3-4: Exhaustive format validation (uuid, email, date-time, uri, ipv4, ipv6)', async () => {
      const outDir = await setupTempDir('adv-formats-')
      const schemaDoc = {
        $id: 'https://specs.oa-sdk.io/formats.json',
        $defs: {
          NetworkEntity: {
            type: 'object',
            required: ['uuid', 'email', 'createdAt', 'endpoint', 'ipv4', 'ipv6'],
            properties: {
              uuid: { type: 'string', format: 'uuid' },
              email: { type: 'string', format: 'email' },
              createdAt: { type: 'string', format: 'date-time' },
              endpoint: { type: 'string', format: 'uri' },
              ipv4: { type: 'string', format: 'ipv4' },
              ipv6: { type: 'string', format: 'ipv6' },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isNetworkEntity', typeName: 'NetworkEntity', schema: '#/$defs/NetworkEntity' }],
      })

      const jsArtifact = artifacts.find(a => a.filePath.endsWith('guards.js'))!
      const tempJsFile = path.join(outDir, 'guards.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(tempJsFile).href)

      const validEntity = {
        uuid: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        email: 'infra-team@service.internal.oa-sdk.org',
        createdAt: '2026-09-03T00:09:09.123+09:00',
        endpoint: 'https://api.oa-sdk.org/v1/stream?query=1#frag',
        ipv4: '192.168.1.100',
        ipv6: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      }

      expect(imported.isNetworkEntity(validEntity)).toBe(true)

      // Test format violations:
      expect(imported.isNetworkEntity({ ...validEntity, uuid: 'not-a-valid-uuid' })).toBe(false)
      expect(imported.isNetworkEntity({ ...validEntity, email: 'missing-at-domain.com' })).toBe(false)
      expect(imported.isNetworkEntity({ ...validEntity, createdAt: '2026-02-31T25:00:00Z' })).toBe(false)
      expect(imported.isNetworkEntity({ ...validEntity, endpoint: 'not-a-uri with spaces' })).toBe(false)
      expect(imported.isNetworkEntity({ ...validEntity, endpoint: '://missing-scheme' })).toBe(false)
      expect(imported.isNetworkEntity({ ...validEntity, ipv4: '256.1.2.3' })).toBe(false)
      expect(imported.isNetworkEntity({ ...validEntity, ipv6: '2001:xyz::1' })).toBe(false)
    })

    it('ADV-P3-5: CLI generation command execution and module re-export bundling integrity', async () => {
      const outDir = await setupTempDir('adv-cli-')
      const schemaPath = path.join(outDir, 'spec.json')

      const specContent = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $defs: {
          AppSession: {
            type: 'object',
            required: ['token', 'ttlSeconds'],
            properties: {
              token: { type: 'string', minLength: 16 },
              ttlSeconds: { type: 'integer', minimum: 60 },
            },
          },
        },
      }
      await fs.writeFile(schemaPath, JSON.stringify(specContent, null, 2), 'utf8')

      // Invoke CLI directly
      const cliBin = path.resolve(__dirname, '../../dist/cli/index.js')
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [
          cliBin,
          'generate',
          '--input',
          schemaPath,
          '--target',
          'standalone-guards',
          '--out-dir',
          outDir,
          '--type-import',
          '@oa-sdk/models',
          '--module-format',
          'esm',
        ],
        { cwd: process.cwd() }
      )

      expect(stdout).toContain('가드 아티팩트 생성 완료')

      // Verify all 4 files are generated
      const guardsJs = await fs.readFile(path.join(outDir, 'guards.js'), 'utf8')
      const guardsDts = await fs.readFile(path.join(outDir, 'guards.d.ts'), 'utf8')
      const indexJs = await fs.readFile(path.join(outDir, 'index.js'), 'utf8')
      const indexDts = await fs.readFile(path.join(outDir, 'index.d.ts'), 'utf8')

      expect(guardsJs).toContain('function isAppSession')
      expect(guardsDts).toContain("import type { AppSession } from '@oa-sdk/models';")
      expect(guardsDts).toContain('export declare function isAppSession(data: unknown): data is AppSession;')
      expect(indexJs).toContain("export * from './guards.js';")
      expect(indexDts).toContain("export * from './guards.js';")

      // Dynamic import from index.js
      const indexImport = await import(pathToFileURL(path.join(outDir, 'index.js')).href)
      expect(typeof indexImport.isAppSession).toBe('function')
      expect(indexImport.isAppSession({ token: 'secret-token-12345678', ttlSeconds: 3600 })).toBe(true)
      expect(indexImport.isAppSession({ token: 'short', ttlSeconds: 30 })).toBe(false)
    })
  })

  // =========================================================================
  // PROPOSAL 4: TYPESCRIPT AST BIDIRECTIONAL SYNCHRONIZATION (V3 UNIFIED ARCHITECTURE)
  // =========================================================================

  describe('Proposal 4: AST Bidirectional Synchronization Adversarial Suite', () => {
    it('ADV-P4-1: Multi-dialect roundtrip chain (Zod -> EntitySpec -> TS -> EntitySpec -> Typia -> EntitySpec -> Zod)', () => {
      const zodAdapter = new ZodTypeAdapter()
      const tsAdapter = new TsAstTypeAdapter()
      const typiaAdapter = new TypiaTypeAdapter()

      const initialZodCode = `
export const DeviceTelemetrySchema = z.object({
  deviceId: z.string().uuid(),
  batteryLevel: z.number().min(0).max(100),
  isOnline: z.boolean(),
  firmwareVersion: z.string().regex(/^v\\d+\\.\\d+\\.\\d+$/),
  tags: z.array(z.string()),
  lastPing: z.date().optional(),
});
`.trim()

      // Step 1: Zod -> EntitySpec (spec1)
      const spec1 = zodAdapter.read(initialZodCode)
      expect(spec1.name).toBe('DeviceTelemetrySchema')
      expect(spec1.kind).toBe('schema')
      expect(spec1.properties.deviceId?.type).toBe('string')
      expect(spec1.properties.deviceId?.constraints?.format).toBe('uuid')
      expect(spec1.properties.batteryLevel?.constraints?.min).toBe(0)
      expect(spec1.properties.batteryLevel?.constraints?.max).toBe(100)
      expect(spec1.properties.isOnline?.type).toBe('boolean')
      expect(spec1.properties.tags?.type).toBe('string[]')
      expect(spec1.properties.lastPing?.optional).toBe(true)

      // Step 2: EntitySpec -> TypeScript Interface (tsCode)
      const tsCode = tsAdapter.write(spec1)
      expect(tsCode).toContain('export interface DeviceTelemetrySchema {')
      expect(tsCode).toContain('deviceId: string;')
      expect(tsCode).toContain('batteryLevel: number;')
      expect(tsCode).toContain('lastPing?: Date;')

      // Step 3: TypeScript Interface -> EntitySpec (spec2)
      const spec2 = tsAdapter.read(tsCode)
      expect(spec2.name).toBe('DeviceTelemetrySchema')
      expect(spec2.properties.deviceId?.name).toBe('deviceId')
      expect(spec2.properties.deviceId?.type).toBe('string')
      expect(spec2.properties.lastPing?.optional).toBe(true)

      // Step 4: EntitySpec (spec1 with rich constraints) -> Typia Interface (typiaCode)
      const typiaCode = typiaAdapter.write(spec1)
      expect(typiaCode).toContain('@format uuid')
      expect(typiaCode).toContain('@minimum 0')
      expect(typiaCode).toContain('@maximum 100')
      expect(typiaCode).toContain('export interface DeviceTelemetrySchema {')

      // Step 5: Typia Interface -> EntitySpec (spec3)
      const spec3 = typiaAdapter.read(typiaCode)
      expect(spec3.name).toBe('DeviceTelemetrySchema')
      expect(spec3.properties.deviceId?.constraints?.format).toBe('uuid')
      expect(spec3.properties.batteryLevel?.constraints?.minimum).toBe(0)
      expect(spec3.properties.batteryLevel?.constraints?.maximum).toBe(100)

      // Step 6: EntitySpec (spec3) -> Zod Schema (finalZodCode)
      const finalZodCode = zodAdapter.write(spec3)
      expect(finalZodCode).toContain('export const DeviceTelemetrySchema = z.object({')
      expect(finalZodCode).toContain('deviceId: z.string().uuid(),')
      expect(finalZodCode).toContain('batteryLevel: z.number().min(0).max(100),')
      expect(finalZodCode).toContain('isOnline: z.boolean(),')
      expect(finalZodCode).toContain('tags: z.array(z.string()),')

      // Step 7: Parse final Zod code back into EntitySpec (spec4)
      const spec4 = zodAdapter.read(finalZodCode)

      // Compare original Zod spec1 with final roundtripped Zod spec4
      const roundtripDiffs = computeEntitySpecDiff(spec1, spec4)
      expect(roundtripDiffs.length).toBe(0)
    })

    it('ADV-P4-2: Complex JSDoc comment preservation, indentation (tabs/spaces), and trailing commas', () => {
      const originalTypiaSource = `
/**
 * Master configuration for high-frequency live rendering engine.
 * @author Tooling Architecture Team
 * @version 3.1.0
 */
export interface SurfaceEngineConfig {
	/**
	 * Unique identifier for the canvas node.
	 * @format uuid
	 * @deprecated Use nodeHandle instead in v4
	 * @example "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
	 */
	nodeId: string;

	/**
	 * Target refresh rate in Hertz.
	 * @minimum 30
	 * @maximum 144
	 * @default 60
	 */
	framerateHz: number;
}
`

      const typiaAdapter = new TypiaTypeAdapter()
      const spec = typiaAdapter.read(originalTypiaSource)

      expect(spec.docComment).toContain('Master configuration for high-frequency live rendering engine.')
      expect(spec.properties.nodeId?.docComment).toContain('Unique identifier for the canvas node.')
      expect(spec.properties.nodeId?.metadata?.nonTypiaTags).toContain('@deprecated Use nodeHandle instead in v4')
      expect(spec.properties.nodeId?.metadata?.nonTypiaTags).toContain('@example "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"')
      expect(spec.properties.framerateHz?.constraints?.minimum).toBe(30)
      expect(spec.properties.framerateHz?.constraints?.maximum).toBe(144)

      // Surgically update framerateHz constraint to minimum 60, maximum 240
      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          ...spec.properties,
          framerateHz: {
            ...spec.properties.framerateHz!,
            constraints: {
              ...spec.properties.framerateHz!.constraints,
              minimum: 60,
              min: 60,
              maximum: 240,
              max: 240,
            },
          },
        },
      }

      const syncResult = syncEntitySpecWithCode(originalTypiaSource, updatedSpec, { adapter: 'typia' })

      // Verify non-Typia tags survived untouched
      expect(syncResult.code).toContain('@deprecated Use nodeHandle instead in v4')
      expect(syncResult.code).toContain('@example "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"')
      expect(syncResult.code).toContain('@minimum 60')
      expect(syncResult.code).toContain('@maximum 240')
      expect(syncResult.diffs.length).toBe(1)
      expect(syncResult.diffs[0]?.kind).toBe('update-property')
    })

    it('ADV-P4-3: Reverse-offset bottom-up TextEdit patching integrity and overlapping range rejection', () => {
      const baseSource = 'const greeting = "Hello, World!";'

      // 1. Valid non-overlapping multiple edits
      // "const" -> "let" (0..5), "greeting" -> "message" (6..14), "World" -> "Vitest" (25..30)
      const validEdits = [
        createReplaceEdit(0, 5, 'let'),
        createReplaceEdit(6, 14, 'message'),
        createReplaceEdit(25, 30, 'Vitest'),
      ]

      const patched = applyTextEdits(baseSource, validEdits)
      expect(patched).toBe('let message = "Hello, Vitest!";')

      // 2. Overlapping ranges detection: [0, 10] and [5, 15] must throw Error
      const overlappingEdits = [
        createReplaceEdit(0, 10, 'A'),
        createReplaceEdit(5, 15, 'B'),
      ]
      expect(() => applyTextEdits(baseSource, overlappingEdits)).toThrow(/Overlapping text edit ranges/)

      // 3. Out of bounds range detection: end > source length must throw Error
      const outOfBoundsEdits = [
        createReplaceEdit(0, 100, 'Overflow'),
      ]
      expect(() => applyTextEdits(baseSource, outOfBoundsEdits)).toThrow(/exceeds source length/)

      // 4. Inverted range: start > end must throw Error
      const invertedEdits = [
        { start: 10, end: 5, newText: 'Inverted' },
      ]
      expect(() => applyTextEdits(baseSource, invertedEdits)).toThrow(/Invalid text edit range/)

      // 5. Negative start offset must throw Error
      const negativeEdits = [
        { start: -5, end: 10, newText: 'Negative' },
      ]
      expect(() => applyTextEdits(baseSource, negativeEdits)).toThrow(/Invalid text edit range/)
    })

    it('ADV-P4-4: Surgical property addition and removal across Zod schema preserving trivia', () => {
      const originalZod = `
// Core user schema
export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2),
  role: z.enum(["admin", "member"]),
});
`

      const zodAdapter = new ZodTypeAdapter()
      const spec = zodAdapter.read(originalZod)

      // Add 'email' property, remove 'role'
      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          id: spec.properties.id!,
          name: spec.properties.name!,
          email: {
            name: 'email',
            type: 'string',
            constraints: { format: 'email', email: true },
          },
        },
      }

      const syncResult = syncEntitySpecWithCode(originalZod, updatedSpec, { adapter: 'zod' })

      expect(syncResult.code).toContain('id: z.string().uuid(),')
      expect(syncResult.code).toContain('name: z.string().min(2),')
      expect(syncResult.code).toContain('email: z.string().email(),')
      expect(syncResult.code).not.toContain('role: z.enum')
      expect(syncResult.code).toContain('// Core user schema')
    })

    it('ADV-P4-5: TypeScript type-alias vs interface conversion and complex union type parsing', () => {
      const tsAdapter = new TsAstTypeAdapter()

      const typeAliasSource = `
/**
 * Complex type alias with union types and optional nullability
 */
export type PolymorphicResult = {
  status: 'success' | 'error' | 'pending';
  payload: string | null;
  retryCount?: number;
};
`
      const spec = tsAdapter.read(typeAliasSource)
      expect(spec.kind).toBe('type-alias')
      expect(spec.name).toBe('PolymorphicResult')
      expect(spec.properties.status?.type).toBe("'success' | 'error' | 'pending'")
      expect(spec.properties.payload?.type).toBe('string')
      expect(spec.properties.payload?.nullable).toBe(true)
      expect(spec.properties.retryCount?.optional).toBe(true)

      // Convert to interface
      const interfaceSpec: EntitySpec = {
        ...spec,
        kind: 'interface',
      }
      const emittedInterface = tsAdapter.write(interfaceSpec)
      expect(emittedInterface).toContain('export interface PolymorphicResult {')
      expect(emittedInterface).toContain("status: 'success' | 'error' | 'pending';")
      expect(emittedInterface).toContain('payload: string | null;')
      expect(emittedInterface).toContain('retryCount?: number;')
    })

    it('ADV-P4-6: computeEntitySpecDiff granular change tracking (extends, docComment, discriminator, props)', () => {
      const baseSpec: EntitySpec = {
        id: 'user',
        name: 'User',
        kind: 'interface',
        docComment: 'Initial User Entity',
        extends: ['BaseEntity'],
        discriminator: { propertyName: 'type', value: 'user' },
        properties: {
          id: { name: 'id', type: 'string' },
          age: { name: 'age', type: 'number', constraints: { min: 0 } },
        },
      }

      const modifiedSpec: EntitySpec = {
        id: 'user',
        name: 'UserProfile',
        kind: 'type-alias',
        docComment: 'Updated User Profile Entity',
        extends: ['BaseEntity', 'Auditable'],
        discriminator: { propertyName: 'kind', value: 'user-profile' },
        properties: {
          id: { name: 'id', type: 'string' },
          age: { name: 'age', type: 'number', constraints: { min: 18 } },
          email: { name: 'email', type: 'string', constraints: { format: 'email' } },
        },
      }

      const diffs = computeEntitySpecDiff(baseSpec, modifiedSpec)

      expect(diffs.some(d => d.kind === 'update-entity' && d.path === 'name')).toBe(true)
      expect(diffs.some(d => d.kind === 'update-entity' && d.path === 'kind')).toBe(true)
      expect(diffs.some(d => d.kind === 'update-doc-comment')).toBe(true)
      expect(diffs.some(d => d.kind === 'update-discriminator')).toBe(true)
      expect(diffs.some(d => d.kind === 'add-extends' && d.newValue === 'Auditable')).toBe(true)
      expect(diffs.some(d => d.kind === 'update-property' && d.propertyName === 'age')).toBe(true)
      expect(diffs.some(d => d.kind === 'add-property' && d.propertyName === 'email')).toBe(true)
    })
  })
})

