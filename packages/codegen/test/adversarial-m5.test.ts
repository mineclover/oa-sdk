import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createRuntimeZodValidators,
  createDynamicZodValidator,
  normalizeOasForZodRuntime,
  generateZodFromSpec,
  schemaToZod,
} from '../src/zodgen/index.js'
import { generateZod } from '../src/cli/commands/generate-zod.js'
import { runCommand } from '../src/cli/lib/run.js'
import type { OasDocument, OasSchema } from '@oa-sdk/parser'

describe('Milestone 5 Adversarial Stress Test Suite', () => {
  describe('Adversarial 1: Circular $refs in Dynamic Runtime Validator', () => {
    it('handles self-referential schema with array items (Tree)', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Tree API', version: '1.0.0' },
        components: {
          schemas: {
            TreeNode: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
                children: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TreeNode' },
                },
              },
            },
          },
        },
      }

      const validators = createRuntimeZodValidators(doc)
      const TreeNode = validators.TreeNode
      expect(TreeNode).toBeDefined()

      // 5-level nested tree
      const nestedTree = {
        id: 'L0',
        children: [
          {
            id: 'L1',
            children: [
              {
                id: 'L2',
                children: [
                  {
                    id: 'L3',
                    children: [{ id: 'L4', children: [] }],
                  },
                ],
              },
            ],
          },
        ],
      }
      expect(TreeNode!.safeParse(nestedTree).success).toBe(true)

      // Invalid at deep level
      const invalidNestedTree = {
        id: 'L0',
        children: [
          {
            id: 'L1',
            children: [{ id: 12345 }], // invalid id
          },
        ],
      }
      expect(TreeNode!.safeParse(invalidNestedTree).success).toBe(false)
    })

    it('handles direct self-referential linked list schema', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'LinkedList API', version: '1.0.0' },
        components: {
          schemas: {
            ListNode: {
              type: 'object',
              required: ['value'],
              properties: {
                value: { type: 'number' },
                next: { $ref: '#/components/schemas/ListNode' },
              },
            },
          },
        },
      }

      const validators = createRuntimeZodValidators(doc)
      const ListNode = validators.ListNode
      expect(ListNode).toBeDefined()

      // 10-node linked list
      let list: any = { value: 10 }
      for (let i = 9; i >= 1; i--) {
        list = { value: i, next: list }
      }
      expect(ListNode!.safeParse(list).success).toBe(true)

      // Corrupt list at node 5
      let corruptList: any = { value: 'not-a-number' }
      for (let i = 4; i >= 1; i--) {
        corruptList = { value: i, next: corruptList }
      }
      expect(ListNode!.safeParse(corruptList).success).toBe(false)
    })

    it('handles mutual circular references (2-cycle: GraphNodeA <-> GraphNodeB)', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Graph API', version: '1.0.0' },
        components: {
          schemas: {
            GraphNodeA: {
              type: 'object',
              required: ['nameA'],
              properties: {
                nameA: { type: 'string' },
                peerB: { $ref: '#/components/schemas/GraphNodeB' },
              },
            },
            GraphNodeB: {
              type: 'object',
              required: ['nameB'],
              properties: {
                nameB: { type: 'string' },
                peerA: { $ref: '#/components/schemas/GraphNodeA' },
              },
            },
          },
        },
      }

      const validators = createRuntimeZodValidators(doc)
      const NodeA = validators.GraphNodeA
      const NodeB = validators.GraphNodeB
      expect(NodeA).toBeDefined()
      expect(NodeB).toBeDefined()

      const validA = {
        nameA: 'A1',
        peerB: {
          nameB: 'B1',
          peerA: {
            nameA: 'A2',
            peerB: { nameB: 'B2' },
          },
        },
      }
      expect(NodeA!.safeParse(validA).success).toBe(true)

      const invalidA = {
        nameA: 'A1',
        peerB: {
          nameB: 'B1',
          peerA: { nameA: 999 }, // invalid
        },
      }
      expect(NodeA!.safeParse(invalidA).success).toBe(false)
    })

    it('handles 3-node cyclic dependency (A -> B -> C -> A)', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: '3-Cycle API', version: '1.0.0' },
        components: {
          schemas: {
            A: {
              type: 'object',
              required: ['a'],
              properties: { a: { type: 'string' }, toB: { $ref: '#/components/schemas/B' } },
            },
            B: {
              type: 'object',
              required: ['b'],
              properties: { b: { type: 'number' }, toC: { $ref: '#/components/schemas/C' } },
            },
            C: {
              type: 'object',
              required: ['c'],
              properties: { c: { type: 'boolean' }, toA: { $ref: '#/components/schemas/A' } },
            },
          },
        },
      }

      const v = createRuntimeZodValidators(doc)
      const data = {
        a: 'hello',
        toB: {
          b: 42,
          toC: {
            c: true,
            toA: {
              a: 'world',
            },
          },
        },
      }
      expect(v.A!.safeParse(data).success).toBe(true)
      expect(v.A!.safeParse({ a: 'hello', toB: { b: 'not-a-number' } }).success).toBe(false)
    })
  })

  describe('Adversarial 2: Deep $defs Hierarchies', () => {
    it('handles 12-level deep reference delegation chain', () => {
      const schemas: Record<string, any> = {}
      for (let i = 1; i <= 12; i++) {
        if (i === 12) {
          schemas[`Level${i}`] = {
            type: 'object',
            required: ['terminal'],
            properties: {
              terminal: { type: 'string', minLength: 8, pattern: '^[A-Z0-9_-]+$' },
            },
          }
        } else {
          schemas[`Level${i}`] = {
            type: 'object',
            required: ['down'],
            properties: {
              down: { $ref: `#/components/schemas/Level${i + 1}` },
            },
          }
        }
      }

      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Deep Delegation', version: '1.0.0' },
        components: { schemas },
      }

      const validators = createRuntimeZodValidators(doc)
      const rootValidator = validators.Level1
      expect(rootValidator).toBeDefined()

      // Build 12-level valid payload
      let validPayload: any = { terminal: 'VALID_TERMINAL_123' }
      for (let i = 11; i >= 1; i--) {
        validPayload = { down: validPayload }
      }
      expect(rootValidator!.safeParse(validPayload).success).toBe(true)

      // Build payload with invalid terminal (lowercase fails pattern)
      let invalidPayload: any = { terminal: 'invalid_lowercase' }
      for (let i = 11; i >= 1; i--) {
        invalidPayload = { down: invalidPayload }
      }
      expect(rootValidator!.safeParse(invalidPayload).success).toBe(false)
    })

    it('handles diamond reference topology (A -> B, C -> D)', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Diamond', version: '1.0.0' },
        components: {
          schemas: {
            DiamondRoot: {
              type: 'object',
              required: ['left', 'right'],
              properties: {
                left: { $ref: '#/components/schemas/LeftArm' },
                right: { $ref: '#/components/schemas/RightArm' },
              },
            },
            LeftArm: {
              type: 'object',
              required: ['target'],
              properties: { target: { $ref: '#/components/schemas/SharedLeaf' } },
            },
            RightArm: {
              type: 'object',
              required: ['target'],
              properties: { target: { $ref: '#/components/schemas/SharedLeaf' } },
            },
            SharedLeaf: {
              type: 'object',
              required: ['leafId'],
              properties: { leafId: { type: 'integer', minimum: 1 } },
            },
          },
        },
      }

      const v = createRuntimeZodValidators(doc)
      const diamond = v.DiamondRoot!
      const valid = {
        left: { target: { leafId: 10 } },
        right: { target: { leafId: 20 } },
      }
      expect(diamond.safeParse(valid).success).toBe(true)

      const invalid = {
        left: { target: { leafId: 0 } }, // minimum 1 violation
        right: { target: { leafId: 20 } },
      }
      expect(diamond.safeParse(invalid).success).toBe(false)
    })
  })

  describe('Adversarial 3: unevaluatedProperties: { not: {} } and Object Sealing', () => {
    it('enforces strict sealing with unevaluatedProperties: { not: {} }', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Sealing', version: '1.0.0' },
        components: {
          schemas: {
            SealedNot: {
              type: 'object',
              required: ['allowed'],
              properties: {
                allowed: { type: 'string' },
              },
              unevaluatedProperties: { not: {} },
            },
          },
        },
      }

      const v = createRuntimeZodValidators(doc)
      const schema = v.SealedNot!

      // Exact properties pass
      expect(schema.safeParse({ allowed: 'yes' }).success).toBe(true)

      // Extra property fails
      const extraRes = schema.safeParse({ allowed: 'yes', unexpected: 123 })
      expect(extraRes.success).toBe(false)
    })

    it('enforces strict sealing with additionalProperties: { not: {} }', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Sealing', version: '1.0.0' },
        components: {
          schemas: {
            SealedAddNot: {
              type: 'object',
              required: ['allowed'],
              properties: {
                allowed: { type: 'string' },
              },
              additionalProperties: { not: {} },
            },
          },
        },
      }

      const v = createRuntimeZodValidators(doc)
      const schema = v.SealedAddNot!

      expect(schema.safeParse({ allowed: 'yes' }).success).toBe(true)
      expect(schema.safeParse({ allowed: 'yes', extra: 'bad' }).success).toBe(false)
    })

    it('supports typed unevaluatedProperties catchall', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Typed Catchall', version: '1.0.0' },
        components: {
          schemas: {
            DictSchema: {
              type: 'object',
              properties: {
                fixed: { type: 'string' },
              },
              unevaluatedProperties: { type: 'number' },
            },
          },
        },
      }

      const v = createRuntimeZodValidators(doc)
      const schema = v.DictSchema!

      expect(schema.safeParse({ fixed: 'text', count: 10, ratio: 0.5 }).success).toBe(true)
      expect(schema.safeParse({ fixed: 'text', extraBad: 'must-be-number' }).success).toBe(false)
    })
  })

  describe('Adversarial 4: Nullability (OAS 3.0 & Draft 2020-12)', () => {
    it('correctly handles OAS 3.0 nullable: true with primitives', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Null Test', version: '1.0.0' },
        components: {
          schemas: {
            NullableString: {
              type: 'object',
              required: ['val'],
              properties: {
                val: { type: 'string', nullable: true },
              },
            },
            NullableInteger: {
              type: 'object',
              required: ['count'],
              properties: {
                count: { type: 'integer', nullable: true },
              },
            },
          },
        },
      }

      const v = createRuntimeZodValidators(doc)
      const sVal = v.NullableString!
      const iVal = v.NullableInteger!

      // String
      expect(sVal.safeParse({ val: 'str' }).success).toBe(true)
      expect(sVal.safeParse({ val: null }).success).toBe(true)
      expect(sVal.safeParse({ val: 123 }).success).toBe(false)
      expect(sVal.safeParse({}).success).toBe(false) // required

      // Integer
      expect(iVal.safeParse({ count: 42 }).success).toBe(true)
      expect(iVal.safeParse({ count: null }).success).toBe(true)
      expect(iVal.safeParse({ count: '42' }).success).toBe(false)
    })

    it('correctly handles Draft 2020-12 type: ["string", "null"]', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Draft2020 Null', version: '1.0.0' },
        components: {
          schemas: {
            DraftNull: {
              type: 'object',
              required: ['data'],
              properties: {
                data: { type: ['string', 'null'] },
              },
            },
          },
        },
      }

      const v = createRuntimeZodValidators(doc)
      const schema = v.DraftNull!

      expect(schema.safeParse({ data: 'hello' }).success).toBe(true)
      expect(schema.safeParse({ data: null }).success).toBe(true)
      expect(schema.safeParse({ data: false }).success).toBe(false)
    })
  })

  describe('Adversarial 5: Static Codegen vs Dynamic Runtime Parity', () => {
    it('maintains parity on object sealing (extra fields rejection)', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Parity Sealing', version: '1.0.0' },
        components: {
          schemas: {
            StrictItem: {
              type: 'object',
              required: ['sku'],
              properties: {
                sku: { type: 'string' },
              },
              unevaluatedProperties: false,
            },
          },
        },
      }

      // Dynamic
      const dynValidators = createRuntimeZodValidators(doc)
      const dynSchema = dynValidators.StrictItem!

      // Static code generation
      const staticCode = generateZodFromSpec(doc, { banner: false })
      expect(staticCode).toContain('export const StrictItemSchema = z.object({')
      expect(staticCode).toContain('.strict()')

      // Static Zod schema evaluation
      const staticSchemaExpr = schemaToZod(doc.components!.schemas!.StrictItem!)
      const staticZod = new Function('z', `return ${staticSchemaExpr}`)(z)

      const validPayload = { sku: 'SKU-001' }
      const invalidPayload = { sku: 'SKU-001', badProp: 'not-allowed' }

      // Both must accept validPayload
      expect(dynSchema.safeParse(validPayload).success).toBe(true)
      expect(staticZod.safeParse(validPayload).success).toBe(true)

      // Both must reject invalidPayload
      expect(dynSchema.safeParse(invalidPayload).success).toBe(false)
      expect(staticZod.safeParse(invalidPayload).success).toBe(false)
    })

    it('maintains parity on numeric exclusive bounds (.gt / .lt)', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Parity Bounds', version: '1.0.0' },
        components: {
          schemas: {
            BoundedNumber: {
              type: 'object',
              required: ['score'],
              properties: {
                score: {
                  type: 'number',
                  exclusiveMinimum: 0,
                  exclusiveMaximum: 100,
                },
              },
            },
          },
        },
      }

      const dynValidators = createRuntimeZodValidators(doc)
      const dynSchema = dynValidators.BoundedNumber!

      const staticCode = generateZodFromSpec(doc, { banner: false })
      expect(staticCode).toContain('.gt(0)')
      expect(staticCode).toContain('.lt(100)')

      const staticSchemaExpr = schemaToZod(doc.components!.schemas!.BoundedNumber!)
      const staticZod = new Function('z', `return ${staticSchemaExpr}`)(z)

      // In bounds: 50 -> pass
      expect(dynSchema.safeParse({ score: 50 }).success).toBe(true)
      expect(staticZod.safeParse({ score: 50 }).success).toBe(true)

      // Exact boundaries: 0 and 100 -> fail
      expect(dynSchema.safeParse({ score: 0 }).success).toBe(false)
      expect(staticZod.safeParse({ score: 0 }).success).toBe(false)
      expect(dynSchema.safeParse({ score: 100 }).success).toBe(false)
      expect(staticZod.safeParse({ score: 100 }).success).toBe(false)
    })

    it('maintains parity on nullable properties', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Parity Nullable', version: '1.0.0' },
        components: {
          schemas: {
            NullablePayload: {
              type: 'object',
              required: ['tag'],
              properties: {
                tag: { type: 'string', nullable: true },
              },
            },
          },
        },
      }

      const dynValidators = createRuntimeZodValidators(doc)
      const dynSchema = dynValidators.NullablePayload!

      const staticSchemaExpr = schemaToZod(doc.components!.schemas!.NullablePayload!)
      const staticZod = new Function('z', `return ${staticSchemaExpr}`)(z)

      // string -> pass
      expect(dynSchema.safeParse({ tag: 'v1' }).success).toBe(true)
      expect(staticZod.safeParse({ tag: 'v1' }).success).toBe(true)

      // null -> pass
      expect(dynSchema.safeParse({ tag: null }).success).toBe(true)
      expect(staticZod.safeParse({ tag: null }).success).toBe(true)

      // number -> fail
      expect(dynSchema.safeParse({ tag: 999 }).success).toBe(false)
      expect(staticZod.safeParse({ tag: 999 }).success).toBe(false)
    })

    it('handles anyOf nullable union referencing another schema (Draft 2020-12 standard)', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Nullable Union', version: '1.0.0' },
        components: {
          schemas: {
            User: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
            PostWithAnyOf: {
              type: 'object',
              required: ['author'],
              properties: {
                author: {
                  anyOf: [
                    { $ref: '#/components/schemas/User' },
                    { type: 'null' },
                  ],
                },
              },
            },
          },
        },
      }

      const v = createRuntimeZodValidators(doc)
      const postSchema = v.PostWithAnyOf!
      const staticCode = generateZodFromSpec(doc, { banner: false })

      // Static code should contain union
      expect(staticCode).toContain('z.union([z.lazy(() => UserSchema), z.null()])')

      // Dynamic validator tests
      expect(postSchema.safeParse({ author: null }).success).toBe(true)
      expect(postSchema.safeParse({ author: { name: 'Bob' } }).success).toBe(true)
      expect(postSchema.safeParse({ author: 123 }).success).toBe(false)
    })

    it('documents OAS 3.0 $ref sibling nullable behavior (pure $ref overrides sibling nullable per OAS 3.0)', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Ref Sibling Nullable', version: '1.0.0' },
        components: {
          schemas: {
            User: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
            Post: {
              type: 'object',
              required: ['author'],
              properties: {
                author: {
                  $ref: '#/components/schemas/User',
                  nullable: true,
                },
              },
            },
          },
        },
      }

      const dynValidators = createRuntimeZodValidators(doc)
      const PostSchema = dynValidators.Post!
      const staticCode = generateZodFromSpec(doc, { banner: false })

      // Both static codegen and dynamic runtime validator treat pure $ref as resolving to target schema
      // without attaching .nullable(), strictly preserving OAS 3.0 $ref precedence
      expect(staticCode).toContain('author: z.lazy(() => UserSchema)')
      expect(PostSchema.safeParse({ author: { name: 'Alice' } }).success).toBe(true)
      expect(PostSchema.safeParse({ author: null }).success).toBe(false)
    })
  })

  describe('Adversarial 6: CLI Command Stress Testing (generate:zod)', () => {
    const realSpecPath = 'packages/schemas/typespec/approved.openapi.yaml'

    it('executes CLI against complex real-world approved.openapi.yaml', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cli-test-real-'))
      const outputFile = path.join(tempDir, 'approved-schemas.ts')

      process.exitCode = 0
      await runCommand(generateZod, ['--spec', realSpecPath, '--output', outputFile])

      expect(process.exitCode).toBe(0)
      expect(fs.existsSync(outputFile)).toBe(true)
      const content = fs.readFileSync(outputFile, 'utf8')
      expect(content).toContain('export const ActiveEntityIdSchema =')
      expect(content).toContain('export const AdminUsersExportRequestSchema =')
      expect(content).toContain('export const AuthSessionSchema =')
      expect(content).toContain('tokens: z.lazy(() => TokenPairSchema)')
      expect(content).toContain('user: z.lazy(() => UserSchema)')

      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('gracefully handles missing required --spec flag with exitCode 1 and error message', async () => {
      const origError = console.error
      let errorMsg = ''
      console.error = (msg: string) => {
        errorMsg += msg
      }

      process.exitCode = 0
      try {
        await runCommand(generateZod, [])
      } finally {
        console.error = origError
      }

      expect(process.exitCode).toBe(1)
      expect(errorMsg).toContain('--spec 옵션이 필요합니다')
      process.exitCode = 0
    })

    it('gracefully handles non-existent spec path with exitCode 1', async () => {
      const origError = console.error
      let errorMsg = ''
      console.error = (msg: string) => {
        errorMsg += msg
      }

      process.exitCode = 0
      try {
        await runCommand(generateZod, ['--spec', 'non/existent/path/spec.yaml'])
      } finally {
        console.error = origError
      }

      expect(process.exitCode).toBe(1)
      expect(errorMsg).toContain('스펙 파일 읽기 실패')
      process.exitCode = 0
    })

    it('gracefully handles malformed YAML spec with exitCode 1', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cli-malformed-'))
      const malformedPath = path.join(tempDir, 'broken.yaml')
      fs.writeFileSync(malformedPath, 'openapi: 3.2.0\ncomponents:\n  schemas:\n    Broken: [invalid yaml', 'utf8')

      const origError = console.error
      let errorMsg = ''
      console.error = (msg: string) => {
        errorMsg += msg
      }

      process.exitCode = 0
      try {
        await runCommand(generateZod, ['--spec', malformedPath])
      } finally {
        console.error = origError
      }

      expect(process.exitCode).toBe(1)
      expect(errorMsg).toContain('스펙 파일 읽기 실패')
      process.exitCode = 0

      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('supports directory output resolving to <dir>/schemas.ts', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cli-dir-'))

      process.exitCode = 0
      await runCommand(generateZod, ['--spec', realSpecPath, '--output', tempDir])

      expect(process.exitCode).toBe(0)
      const expectedPath = path.join(tempDir, 'schemas.ts')
      expect(fs.existsSync(expectedPath)).toBe(true)

      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('supports explicit file output path', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cli-file-'))
      const explicitFile = path.join(tempDir, 'custom-names.ts')

      process.exitCode = 0
      await runCommand(generateZod, ['--spec', realSpecPath, '--output', explicitFile])

      expect(process.exitCode).toBe(0)
      expect(fs.existsSync(explicitFile)).toBe(true)

      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('supports --style schema vs --style both', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cli-style-'))
      const schemaOnlyFile = path.join(tempDir, 'schema-only.ts')
      const bothFile = path.join(tempDir, 'both.ts')

      process.exitCode = 0
      await runCommand(generateZod, ['--spec', realSpecPath, '--output', schemaOnlyFile, '--style', 'schema'])
      expect(process.exitCode).toBe(0)

      await runCommand(generateZod, ['--spec', realSpecPath, '--output', bothFile, '--style', 'both'])
      expect(process.exitCode).toBe(0)

      const schemaOnlyContent = fs.readFileSync(schemaOnlyFile, 'utf8')
      const bothContent = fs.readFileSync(bothFile, 'utf8')

      // schema style: has export const, NO export type
      expect(schemaOnlyContent).toContain('export const ActiveEntityIdSchema =')
      expect(schemaOnlyContent).not.toContain('export type ActiveEntityId =')

      // both style: has both export const and export type
      expect(bothContent).toContain('export const ActiveEntityIdSchema =')
      expect(bothContent).toContain('export type ActiveEntityId =')

      fs.rmSync(tempDir, { recursive: true, force: true })
    })
  })
})
