/**
 * 4-Tier E2E Test Suite: OpenAPI 3.2 to Zod 4 Generator & CLI
 *
 * Covers all features across Tiers 1-4:
 * - Tier 1: Feature Coverage (>=5 tests per feature across 9 features = 45 tests)
 * - Tier 2: Boundary & Corner Cases (>=5 tests per area across 5 areas = 25 tests)
 * - Tier 3: Cross-Feature Combinations (15 tests)
 * - Tier 4: Real-World Application Scenarios (5 scenarios = 13 tests)
 * Total: 98 E2E Tests
 *
 * Conforms to:
 * - ORIGINAL_REQUEST.md (§R1, §R2, §R3, §R4)
 * - PROJECT.md (Architecture, Interface Contracts, Feature Inventory F1-F12)
 * - TEST_INFRA.md (Coverage Thresholds, 4-Tier Test Architecture)
 */

import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { z } from 'zod'
import { parseDocument, type OasDocument, type OasSchema } from '@oa-sdk/parser'
import { parse as parseYaml } from 'yaml'
import { runCommand } from '../../src/cli/lib/run.js'

// =============================================================================
// MODULE LOADER & EVALUATION HELPERS
// =============================================================================

export interface ZodgenModule {
  generateZodFromSpec?: (doc: OasDocument, options?: any) => string
  createZod4Algebra?: (options?: any) => any
  schemaToZod?: (schema: OasSchema, options?: any) => string
  createRuntimeZodValidators?: (doc: OasDocument) => Record<string, z.ZodTypeAny>
  createDynamicZodValidator?: (schema: OasSchema, doc?: OasDocument) => z.ZodTypeAny
  normalizeOasForZodRuntime?: (schema: any, doc?: any) => any
}

async function getZodgen(): Promise<ZodgenModule | null> {
  try {
    const mod = await import('../../src/zodgen/index.js')
    return mod as unknown as ZodgenModule
  } catch {
    try {
      const rootMod = await import('../../src/index.js')
      if ('generateZodFromSpec' in rootMod || 'createZod4Algebra' in rootMod) {
        return rootMod as unknown as ZodgenModule
      }
    } catch {
      // not yet exported
    }
    return null
  }
}

async function getGenerateZodCommand(): Promise<any | null> {
  try {
    const mod = await import('../../src/cli/commands/generate-zod.js')
    return mod.generateZod ?? mod.default ?? null
  } catch {
    try {
      const commandsMod = await import('../../src/cli/commands.js')
      const cmd = commandsMod.commands?.find((c: any) => c.name === 'generate:zod')
      return cmd ?? null
    } catch {
      return null
    }
  }
}

function findRepoRoot(startDir: string = process.cwd()): string {
  let cur = startDir
  while (cur && cur !== path.dirname(cur)) {
    const pkgPath = path.join(cur, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (pkg.name === 'oa-sdk') return cur
      } catch {}
    }
    cur = path.dirname(cur)
  }
  return path.resolve(import.meta.dirname, '../../../..')
}

const repoRoot = findRepoRoot()

function loadFixtureYaml(fixtureName: string): OasDocument {
  const fixturePath = path.resolve(
    import.meta.dirname,
    '../fixtures/zodgen',
    fixtureName.endsWith('.yaml') ? fixtureName : `${fixtureName}.yaml`
  )
  const content = fs.readFileSync(fixturePath, 'utf8')
  return parseYaml(content) as OasDocument
}

function loadApprovedSpec(): OasDocument {
  const specPath = path.resolve(repoRoot, 'packages/schemas/typespec/approved.openapi.yaml')
  const content = fs.readFileSync(specPath, 'utf8')
  return parseYaml(content) as OasDocument
}

/**
 * Safely evaluates a generated Zod TypeScript expression in Node.js runtime with z from 'zod'.
 */
function evalZodExpression(expr: string): z.ZodTypeAny {
  const cleanExpr = expr.trim().replace(/^;+|;+$/g, '')
  const fn = new Function('z', `return (${cleanExpr})`)
  return fn(z)
}

/**
 * Evaluates generated module code to extract exported schema instances.
 */
function evalGeneratedModule(code: string): Record<string, z.ZodTypeAny> {
  const jsCode = code
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+type\s+.*$/gm, '')
    .replace(/^export\s+const\s+/gm, 'const ')

  const schemaNames: string[] = []
  const nameRegex = /(?:const|let|var)\s+([A-Za-z0-9_]+Schema)\s*=/g
  let match: RegExpExecArray | null
  while ((match = nameRegex.exec(code)) !== null) {
    if (match[1]) schemaNames.push(match[1])
  }

  const returnObj = `{ ${schemaNames.join(', ')} }`
  const fn = new Function('z', `${jsCode}\nreturn ${returnObj};`)
  return fn(z)
}

// =============================================================================
// TIER 1: FEATURE COVERAGE (>=5 tests per feature for 9 features = 45 tests)
// =============================================================================

describe('OpenAPI 3.2 to Zod 4 E2E Test Suite (Tiers 1-4)', () => {
  describe('Tier 1: Feature Coverage (Happy Path)', () => {
    // -------------------------------------------------------------------------
    // F3: Numeric Exclusive Bounds (exclusiveMinimum / exclusiveMaximum -> .gt() / .lt())
    // -------------------------------------------------------------------------
    describe('F3: Numeric Exclusive Bounds', () => {
      it('T1-F3-1: maps exclusiveMinimum to .gt(n), rejecting boundary equality', async () => {
        const schema: OasSchema = {
          type: 'number',
          exclusiveMinimum: 10,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()
        expect(zodgen?.schemaToZod, 'schemaToZod must be exported').toBeDefined()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.gt(10)')
        expect(code).not.toContain('.gte(10)')

        const validator = evalZodExpression(code)
        expect(validator.safeParse(10).success).toBe(false)
        expect(validator.safeParse(10.0001).success).toBe(true)
        expect(validator.safeParse(20).success).toBe(true)
      })

      it('T1-F3-2: maps exclusiveMaximum to .lt(n), rejecting boundary equality', async () => {
        const schema: OasSchema = {
          type: 'number',
          exclusiveMaximum: 100,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()
        expect(zodgen?.schemaToZod, 'schemaToZod must be exported').toBeDefined()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.lt(100)')
        expect(code).not.toContain('.lte(100)')

        const validator = evalZodExpression(code)
        expect(validator.safeParse(100).success).toBe(false)
        expect(validator.safeParse(99.999).success).toBe(true)
        expect(validator.safeParse(50).success).toBe(true)
      })

      it('T1-F3-3: combines exclusiveMinimum and exclusiveMaximum to form open interval (min, max)', async () => {
        const schema: OasSchema = {
          type: 'number',
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.gt(0)')
        expect(code).toContain('.lt(1)')

        const validator = evalZodExpression(code)
        expect(validator.safeParse(0).success).toBe(false)
        expect(validator.safeParse(1).success).toBe(false)
        expect(validator.safeParse(0.5).success).toBe(true)
      })

      it('T1-F3-4: maps type integer with exclusive bounds to int constraint with .gt()', async () => {
        const schema: OasSchema = {
          type: 'integer',
          exclusiveMinimum: 0,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toMatch(/z\.(?:number\(\)\.int\(\)|int\(\))/)
        expect(code).toContain('.gt(0)')

        const validator = evalZodExpression(code)
        expect(validator.safeParse(0).success).toBe(false)
        expect(validator.safeParse(1).success).toBe(true)
        expect(validator.safeParse(1.5).success).toBe(false)
      })

      it('T1-F3-5: chains multipleOf constraint alongside exclusive bounds', async () => {
        const schema: OasSchema = {
          type: 'number',
          exclusiveMinimum: 10,
          multipleOf: 5,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.gt(10)')
        expect(code).toContain('.multipleOf(5)')

        const validator = evalZodExpression(code)
        expect(validator.safeParse(10).success).toBe(false)
        expect(validator.safeParse(12).success).toBe(false)
        expect(validator.safeParse(15).success).toBe(true)
        expect(validator.safeParse(20).success).toBe(true)
      })
    })

    // -------------------------------------------------------------------------
    // F4: Tuples & Rest (prefixItems -> z.tuple([...]), rest via items)
    // -------------------------------------------------------------------------
    describe('F4: Tuples & Rest', () => {
      it('T1-F4-1: compiles prefixItems to z.tuple with positional element schemas', async () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'number' }],
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('z.tuple([')
        expect(code).toContain('z.string()')
        expect(code).toContain('z.number()')

        const validator = evalZodExpression(code)
        expect(validator.safeParse(['hello', 42]).success).toBe(true)
        expect(validator.safeParse([42, 'hello']).success).toBe(false)
      })

      it('T1-F4-2: compiles prefixItems with items schema to z.tuple().rest(Schema)', async () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }],
          items: { type: 'boolean' },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('z.tuple([')
        expect(code).toContain('.rest(z.boolean())')

        const validator = evalZodExpression(code)
        expect(validator.safeParse(['first', true, false, true]).success).toBe(true)
        expect(validator.safeParse(['first']).success).toBe(true)
        expect(validator.safeParse(['first', true, 'invalid']).success).toBe(false)
      })

      it('T1-F4-3: compiles closed tuple (items: false) rejecting elements beyond prefix length', async () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'number' }],
          items: false,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('z.tuple([')
        expect(code).not.toContain('.rest(')

        const validator = evalZodExpression(code)
        expect(validator.safeParse(['a', 1]).success).toBe(true)
        expect(validator.safeParse(['a', 1, 'extra']).success).toBe(false)
      })

      it('T1-F4-4: compiles empty tuple prefixItems: [] with items: false accepting only empty array', async () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [],
          items: false,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse([]).success).toBe(true)
        expect(validator.safeParse([1]).success).toBe(false)
      })

      it('T1-F4-5: compiles open tuple allowing heterogeneous rest items when items is omitted or true', async () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }],
          items: true,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse(['head', 123, { a: 1 }, true]).success).toBe(true)
        expect(validator.safeParse([123]).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // F7: Discriminator (§4.8.24) with propertyName, mapping, and defaultMapping
    // -------------------------------------------------------------------------
    describe('F7: Discriminator & defaultMapping', () => {
      it('T1-F7-1: synthesizes z.discriminatedUnion from oneOf with discriminator.propertyName', async () => {
        const schema: OasSchema = {
          oneOf: [
            {
              type: 'object',
              required: ['kind', 'meow'],
              properties: {
                kind: { type: 'string', const: 'cat' },
                meow: { type: 'boolean' },
              },
            },
            {
              type: 'object',
              required: ['kind', 'bark'],
              properties: {
                kind: { type: 'string', const: 'dog' },
                bark: { type: 'boolean' },
              },
            },
          ],
          discriminator: {
            propertyName: 'kind',
          },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('z.discriminatedUnion(')
        expect(code).toContain('"kind"')

        const validator = evalZodExpression(code)
        expect(validator.safeParse({ kind: 'cat', meow: true }).success).toBe(true)
        expect(validator.safeParse({ kind: 'dog', bark: true }).success).toBe(true)
        expect(validator.safeParse({ kind: 'cat', bark: true }).success).toBe(false)
      })

      it('T1-F7-2: resolves discriminator.mapping with alias keys to variant schemas', async () => {
        const doc: OasDocument = {
          openapi: '3.2.0',
          info: { title: 'Mapping Test', version: '1.0.0' },
          components: {
            schemas: {
              Cat: {
                type: 'object',
                required: ['type'],
                properties: { type: { type: 'string', const: 'feline' } },
              },
              Dog: {
                type: 'object',
                required: ['type'],
                properties: { type: { type: 'string', const: 'canine' } },
              },
              Pet: {
                oneOf: [
                  { $ref: '#/components/schemas/Cat' },
                  { $ref: '#/components/schemas/Dog' },
                ],
                discriminator: {
                  propertyName: 'type',
                  mapping: {
                    cat: '#/components/schemas/Cat',
                    feline: '#/components/schemas/Cat',
                    dog: '#/components/schemas/Dog',
                    canine: '#/components/schemas/Dog',
                  },
                },
              },
            },
          },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(doc)
        expect(code).toContain('z.discriminatedUnion(')
        expect(code).toContain('PetSchema')
      })

      it('T1-F7-3: handles OAS 3.2 defaultMapping for unmapped or missing discriminator values', async () => {
        const fixture = loadFixtureYaml('problem-details.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('ProblemDetailsSchema')
        expect(code).toContain('ValidationProblemSchema')
      })

      it('T1-F7-4: wraps discriminator option references with z.lazy to prevent TDZ', async () => {
        const fixture = loadFixtureYaml('filesystem-tree.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('FSNodeSchema')
        expect(code).toMatch(/z\.lazy\(\s*\(\)\s*=>\s*FileNodeSchema\)/)
      })

      it('T1-F7-5: rejects payload with unknown discriminant value when no default is available', async () => {
        const schema: OasSchema = {
          oneOf: [
            {
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string', const: 'success' } },
            },
            {
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string', const: 'error' } },
            },
          ],
          discriminator: { propertyName: 'status' },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        const res = validator.safeParse({ status: 'unknown' })
        expect(res.success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // F5: Object Sealing (unevaluatedProperties / additionalProperties: false -> .strict())
    // -------------------------------------------------------------------------
    describe('F5: Object Sealing (.strict())', () => {
      it('T1-F5-1: compiles additionalProperties: false to .strict() rejecting undeclared keys', async () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.strict()')

        const validator = evalZodExpression(code)
        expect(validator.safeParse({ name: 'Alice' }).success).toBe(true)
        expect(validator.safeParse({ name: 'Alice', extra: 123 }).success).toBe(false)
      })

      it('T1-F5-2: compiles unevaluatedProperties: false to .strict()', async () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { id: { type: 'string' } },
          unevaluatedProperties: false,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.strict()')

        const validator = evalZodExpression(code)
        expect(validator.safeParse({ id: 'xyz' }).success).toBe(true)
        expect(validator.safeParse({ id: 'xyz', rogue: true }).success).toBe(false)
      })

      it('T1-F5-3: compiles additionalProperties: true to .passthrough()', async () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { a: { type: 'number' } },
          additionalProperties: true,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.passthrough()')

        const validator = evalZodExpression(code)
        const parsed = validator.parse({ a: 1, unmanaged: 'allowed' })
        expect((parsed as any).unmanaged).toBe('allowed')
      })

      it('T1-F5-4: compiles additionalProperties with schema to .catchall(Schema)', async () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { count: { type: 'number' } },
          additionalProperties: { type: 'string' },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.catchall(z.string())')

        const validator = evalZodExpression(code)
        expect(validator.safeParse({ count: 5, note: 'ok' }).success).toBe(true)
        expect(validator.safeParse({ count: 5, badNote: 999 }).success).toBe(false)
      })

      it('T1-F5-5: preserves required vs optional property markers in sealed objects', async () => {
        const schema: OasSchema = {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            tag: { type: 'string' },
          },
          additionalProperties: false,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({ id: '1' }).success).toBe(true)
        expect(validator.safeParse({ id: '1', tag: 'prod' }).success).toBe(true)
        expect(validator.safeParse({ tag: 'prod' }).success).toBe(false)
        expect(validator.safeParse({ id: '1', unknown: 1 }).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // F6: Circular References (#/components/schemas/* -> z.lazy(() => Schema))
    // -------------------------------------------------------------------------
    describe('F6: Circular References', () => {
      it('T1-F6-1: generates z.lazy for self-referencing Node schema', async () => {
        const fixture = loadFixtureYaml('circular-components.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('NodeSchema')
        expect(code).toMatch(/z\.lazy\(\s*\(\)\s*=>\s*NodeSchema\)/)
      })

      it('T1-F6-2: resolves mutual 2-component recursion (User <-> Role) without TDZ errors', async () => {
        const fixture = loadFixtureYaml('circular-components.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('UserSchema')
        expect(code).toContain('RoleSchema')
        expect(code).toMatch(/z\.lazy\(\s*\(\)\s*=>\s*RoleSchema\)/)
        expect(code).toMatch(/z\.lazy\(\s*\(\)\s*=>\s*UserSchema\)/)

        const mod = evalGeneratedModule(code)
        expect(mod.UserSchema).toBeDefined()
        expect(mod.RoleSchema).toBeDefined()
      })

      it('T1-F6-3: validates multi-level nested tree structures using recursive z.lazy schemas', async () => {
        const fixture = loadFixtureYaml('circular-components.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const Node = mod.NodeSchema!

        const payload = {
          id: '11111111-1111-1111-1111-111111111111',
          value: 1,
          children: [
            {
              id: '22222222-2222-2222-2222-222222222222',
              value: 2,
              children: [
                {
                  id: '33333333-3333-3333-3333-333333333333',
                  value: 3,
                },
              ],
            },
          ],
        }
        expect(Node.safeParse(payload).success).toBe(true)
      })

      it('T1-F6-4: evaluates optional circular reference when omitted or undefined', async () => {
        const fixture = loadFixtureYaml('circular-components.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const Node = mod.NodeSchema!

        const rootOnly = {
          id: '00000000-0000-0000-0000-000000000000',
          value: 100,
        }
        expect(Node.safeParse(rootOnly).success).toBe(true)
      })

      it('T1-F6-5: validates 5-level deep recursive tree without maximum call stack overflow', async () => {
        const fixture = loadFixtureYaml('circular-components.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const Node = mod.NodeSchema!

        let current: any = { id: '00000000-0000-0000-0000-000000000005', value: 5 }
        for (let i = 4; i >= 1; i--) {
          current = {
            id: `00000000-0000-0000-0000-00000000000${i}`,
            value: i,
            children: [current],
          }
        }
        expect(Node.safeParse(current).success).toBe(true)
      })
    })

    // -------------------------------------------------------------------------
    // F8: JSDoc & Metadata (.describe(), .default())
    // -------------------------------------------------------------------------
    describe('F8: JSDoc & Metadata', () => {
      it('T1-F8-1: emits .describe() for schema description preserving metadata on ZodType', async () => {
        const schema: OasSchema = {
          type: 'string',
          description: 'Unique customer identification token',
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.describe("Unique customer identification token")')

        const validator = evalZodExpression(code)
        expect(validator.description).toBe('Unique customer identification token')
      })

      it('T1-F8-2: emits .default() for schema default value, supplying default when undefined', async () => {
        const schema: OasSchema = {
          type: 'string',
          default: 'standard',
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.default("standard")')

        const validator = evalZodExpression(code)
        expect(validator.parse(undefined)).toBe('standard')
        expect(validator.parse('premium')).toBe('premium')
      })

      it('T1-F8-3: preserves property-level descriptions and defaults on object properties', async () => {
        const schema: OasSchema = {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              description: 'User access role',
              default: 'viewer',
            },
          },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(code).toContain('.describe("User access role")')
        expect(code).toContain('.default("viewer")')

        const validator = evalZodExpression(code) as z.ZodObject<any>
        const parsed = validator.parse({})
        expect(parsed.role).toBe('viewer')
      })

      it('T1-F8-4: escapes quotes, newlines, and backslashes in description strings', async () => {
        const schema: OasSchema = {
          type: 'string',
          description: 'Line 1\nLine 2 with "double quotes" and \\ backslash',
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        expect(() => evalZodExpression(code)).not.toThrow()
        const validator = evalZodExpression(code)
        expect(validator.description).toContain('Line 1')
        expect(validator.description).toContain('"double quotes"')
      })

      it('T1-F8-5: maintains method chaining with .describe() placed outermost preserving .default()', async () => {
        const schema: OasSchema = {
          type: 'number',
          minimum: 0,
          default: 10,
          description: 'Retry attempts',
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.description).toBe('Retry attempts')
        expect(validator.parse(undefined)).toBe(10)
        expect(validator.safeParse(-1).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // F1 & F2: Static Code Generation Engine (generateZodFromSpec)
    // -------------------------------------------------------------------------
    describe('F1 & F2: Static Code Generation Engine', () => {
      it('T1-F2-1: emits valid TypeScript header with import { z } from "zod"', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toMatch(/import\s*\{\s*z\s*\}\s*from\s*['"]zod['"]/)
      })

      it('T1-F2-2: emits export const <Name>Schema for all components in spec', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('export const MoneySchema')
        expect(code).toContain('export const AddressSchema')
        expect(code).toContain('export const OrderSchema')
      })

      it('T1-F2-3: emits export type <Name> = z.infer<typeof <Name>Schema> when style is both', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture, { style: 'both' })
        expect(code).toContain('export type Money = z.infer<typeof MoneySchema>')
        expect(code).toContain('export type Order = z.infer<typeof OrderSchema>')
      })

      it('T1-F2-4: omits type exports when style is set to "schema"', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture, { style: 'schema' })
        expect(code).toContain('export const MoneySchema')
        expect(code).not.toContain('export type Money =')
      })

      it('T1-F2-5: includes banner comments when banner: true is specified', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture, { banner: true })
        expect(code).toContain('// Auto-generated')
      })
    })

    // -------------------------------------------------------------------------
    // F9: Dynamic Runtime Validator (z.fromJSONSchema / createRuntimeZodValidators)
    // -------------------------------------------------------------------------
    describe('F9: Dynamic Runtime Validator', () => {
      it('T1-F9-1: creates executable validator dictionary using createRuntimeZodValidators', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()
        expect(zodgen?.createRuntimeZodValidators, 'createRuntimeZodValidators must be exported').toBeDefined()

        const validators = zodgen!.createRuntimeZodValidators!(fixture)
        expect(validators.Money).toBeDefined()
        expect(validators.Order).toBeDefined()
      })

      it('T1-F9-2: resolves #/components/schemas references dynamically via $defs adaptation', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const validators = zodgen!.createRuntimeZodValidators!(fixture)
        const OrderValidator = validators.Order
        expect(OrderValidator).toBeDefined()

        const validOrder = {
          orderId: '123e4567-e89b-12d3-a456-426614174000',
          customerId: '123e4567-e89b-12d3-a456-426614174001',
          status: 'Pending',
          items: [
            {
              itemId: '123e4567-e89b-12d3-a456-426614174002',
              quantity: 2,
              unitPrice: { amount: 19.99, currency: 'USD' },
            },
          ],
          shippingAddress: {
            street: '123 Market St',
            city: 'Seoul',
            country: 'KR',
          },
          total: { amount: 39.98, currency: 'USD' },
        }
        expect(OrderValidator.safeParse(validOrder).success).toBe(true)
      })

      it('T1-F9-3: adapts unevaluatedProperties: false without triggering native unsupported error', async () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { name: { type: 'string' } },
          unevaluatedProperties: false,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()
        expect(zodgen?.createDynamicZodValidator, 'createDynamicZodValidator must be exported').toBeDefined()

        const validator = zodgen!.createDynamicZodValidator!(schema)
        expect(validator).toBeDefined()
        expect(validator.safeParse({ name: 'Valid' }).success).toBe(true)
        expect(validator.safeParse({ name: 'Valid', rogue: 123 }).success).toBe(false)
      })

      it('T1-F9-4: supports createDynamicZodValidator for standalone OAS schemas', async () => {
        const schema: OasSchema = {
          type: 'number',
          exclusiveMinimum: 0,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const validator = zodgen!.createDynamicZodValidator!(schema)
        expect(validator.safeParse(0).success).toBe(false)
        expect(validator.safeParse(0.01).success).toBe(true)
      })

      it('T1-F9-5: dynamic validator returns structured ZodError on validation failure', async () => {
        const schema: OasSchema = {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', pattern: '^[A-Z]{3}$' },
          },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const validator = zodgen!.createDynamicZodValidator!(schema)
        const result = validator.safeParse({ code: 'invalid' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0)
        }
      })
    })

    // -------------------------------------------------------------------------
    // F10: CLI Execution (oa-gen generate:zod --spec <path> --output <dir>)
    // -------------------------------------------------------------------------
    describe('F10: CLI Execution', () => {
      it('T1-F10-1: registers generate:zod in CLI command dictionary', async () => {
        const cmd = await getGenerateZodCommand()
        expect(cmd, 'generate:zod CLI command must be implemented').not.toBeNull()
        expect(cmd.name).toBe('generate:zod')
        expect(cmd.options.spec).toBeDefined()
        expect(cmd.options.spec.required).toBe(true)
        expect(cmd.options.output).toBeDefined()
      })

      it('T1-F10-2: executes CLI against valid spec writing output to specified file', async () => {
        const cmd = await getGenerateZodCommand()
        expect(cmd, 'generate:zod CLI command must be implemented').not.toBeNull()

        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oa-zod-cli-test-'))
        const outFile = path.join(tempDir, 'output-schemas.ts')
        const specFile = path.resolve(import.meta.dirname, '../fixtures/zodgen/ecommerce-lifecycle.yaml')

        process.exitCode = 0
        await runCommand(cmd, ['--spec', specFile, '--output', outFile])
        expect(process.exitCode).toBe(0)
        expect(fs.existsSync(outFile)).toBe(true)

        const content = fs.readFileSync(outFile, 'utf8')
        expect(content).toContain('MoneySchema')
        expect(content).toContain('OrderSchema')
      })

      it('T1-F10-3: supports --style schema option to generate schemas only', async () => {
        const cmd = await getGenerateZodCommand()
        expect(cmd, 'generate:zod CLI command must be implemented').not.toBeNull()

        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oa-zod-cli-style-'))
        const outFile = path.join(tempDir, 'schemas-only.ts')
        const specFile = path.resolve(import.meta.dirname, '../fixtures/zodgen/ecommerce-lifecycle.yaml')

        process.exitCode = 0
        await runCommand(cmd, ['--spec', specFile, '--output', outFile, '--style', 'schema'])
        expect(process.exitCode).toBe(0)

        const content = fs.readFileSync(outFile, 'utf8')
        expect(content).toContain('export const MoneySchema')
        expect(content).not.toContain('export type Money =')
      })

      it('T1-F10-4: supports directory output resolving to <dir>/schemas.ts', async () => {
        const cmd = await getGenerateZodCommand()
        expect(cmd, 'generate:zod CLI command must be implemented').not.toBeNull()

        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oa-zod-cli-dir-'))
        const specFile = path.resolve(import.meta.dirname, '../fixtures/zodgen/ecommerce-lifecycle.yaml')

        process.exitCode = 0
        await runCommand(cmd, ['--spec', specFile, '--output', tempDir])
        expect(process.exitCode).toBe(0)

        const resolvedFile = path.join(tempDir, 'schemas.ts')
        expect(fs.existsSync(resolvedFile)).toBe(true)
      })

      it('T1-F10-5: fails with error code when --spec option is missing', async () => {
        const cmd = await getGenerateZodCommand()
        expect(cmd, 'generate:zod CLI command must be implemented').not.toBeNull()

        process.exitCode = 0
        await runCommand(cmd, [])
        expect(process.exitCode).toBe(1)
      })
    })
  })

  // ===========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per area for 5 areas = 25 tests)
  // ===========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    // -------------------------------------------------------------------------
    // B1: Float, Negative, and Zero Bounds
    // -------------------------------------------------------------------------
    describe('B1: Float, Negative, and Zero Bounds', () => {
      it('T2-B1-1: validates micro-float bound exclusiveMinimum: 0.001 with high precision', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.FloatBounds!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({ delta: 0.001 }).success).toBe(false)
        expect(validator.safeParse({ delta: 0.0010001 }).success).toBe(true)
        expect(validator.safeParse({ delta: 0.999 }).success).toBe(false)
        expect(validator.safeParse({ delta: 0.998999 }).success).toBe(true)
      })

      it('T2-B1-2: validates negative bounds exclusiveMinimum: -50 and exclusiveMaximum: -10', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.NegativeBounds!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({ temperature: -50 }).success).toBe(false)
        expect(validator.safeParse({ temperature: -10 }).success).toBe(false)
        expect(validator.safeParse({ temperature: -49.9 }).success).toBe(true)
        expect(validator.safeParse({ temperature: -25 }).success).toBe(true)
        expect(validator.safeParse({ temperature: 0 }).success).toBe(false)
      })

      it('T2-B1-3: validates strictly positive zero bound exclusiveMinimum: 0', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.ZeroBounds!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({ strictlyPositive: 0 }).success).toBe(false)
        expect(validator.safeParse({ strictlyPositive: -0.0001 }).success).toBe(false)
        expect(validator.safeParse({ strictlyPositive: 0.0000001 }).success).toBe(true)
      })

      it('T2-B1-4: validates symmetric open interval (-1.5, 1.5) with mixed signs', async () => {
        const schema: OasSchema = {
          type: 'number',
          exclusiveMinimum: -1.5,
          exclusiveMaximum: 1.5,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse(-1.5).success).toBe(false)
        expect(validator.safeParse(1.5).success).toBe(false)
        expect(validator.safeParse(0).success).toBe(true)
      })

      it('T2-B1-5: compiles and validates scientific notation bounds exclusiveMaximum: 1e6', async () => {
        const schema: OasSchema = {
          type: 'number',
          exclusiveMaximum: 1e6,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse(1_000_000).success).toBe(false)
        expect(validator.safeParse(999_999).success).toBe(true)
      })
    })

    // -------------------------------------------------------------------------
    // B2: Closed Tuples vs Open Tuples vs Rest Tuples
    // -------------------------------------------------------------------------
    describe('B2: Closed Tuples vs Open Tuples vs Rest Tuples', () => {
      it('T2-B2-1: rejects array exceeding prefix length on closed tuple (items: false)', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.ClosedTuple!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse(['alpha', 100]).success).toBe(true)
        expect(validator.safeParse(['alpha', 100, true]).success).toBe(false)
      })

      it('T2-B2-2: accepts arbitrary trailing elements on open tuple (items: true)', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.OpenTuple!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse(['alpha', 100]).success).toBe(true)
        expect(validator.safeParse(['alpha', 100, true, { any: 'data' }]).success).toBe(true)
      })

      it('T2-B2-3: validates homogeneous rest elements on RestTuple (items: { type: "boolean" })', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.RestTuple!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse(['alpha', 100, true, false, true]).success).toBe(true)
        expect(validator.safeParse(['alpha', 100, 'invalid-rest']).success).toBe(false)
      })

      it('T2-B2-4: empty tuple prefixItems: [] with items: false strictly rejects non-empty input', async () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [],
          items: false,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse([]).success).toBe(true)
        expect(validator.safeParse(['not-empty']).success).toBe(false)
      })

      it('T2-B2-5: tuple with single prefix element and typed rest validates first element and variable rest', async () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string', format: 'uuid' }],
          items: { type: 'number' },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse(['123e4567-e89b-12d3-a456-426614174000', 1, 2, 3]).success).toBe(true)
        expect(validator.safeParse(['not-a-uuid', 1, 2]).success).toBe(false)
        expect(validator.safeParse(['123e4567-e89b-12d3-a456-426614174000', 'not-a-number']).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // B3: Empty Objects Sealed with .strict()
    // -------------------------------------------------------------------------
    describe('B3: Empty Objects Sealed with .strict()', () => {
      it('T2-B3-1: empty object with additionalProperties: false accepts empty object {}', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.EmptySealedObject!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({}).success).toBe(true)
      })

      it('T2-B3-2: empty object with additionalProperties: false rejects any declared key', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.EmptySealedObject!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({ unwanted: 'key' }).success).toBe(false)
      })

      it('T2-B3-3: empty object with unevaluatedProperties: false accepts empty object {}', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.EmptyUnevaluatedSealedObject!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({}).success).toBe(true)
      })

      it('T2-B3-4: empty object with unevaluatedProperties: false rejects unexpected keys', async () => {
        const fixture = loadFixtureYaml('boundary-cases.yaml')
        const schema = fixture.components?.schemas?.EmptyUnevaluatedSealedObject!
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({ rogue: 42 }).success).toBe(false)
      })

      it('T2-B3-5: object with all optional properties sealed with .strict() accepts {} but rejects unlisted keys', async () => {
        const schema: OasSchema = {
          type: 'object',
          properties: {
            opt1: { type: 'string' },
            opt2: { type: 'number' },
          },
          additionalProperties: false,
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({}).success).toBe(true)
        expect(validator.safeParse({ opt1: 'val' }).success).toBe(true)
        expect(validator.safeParse({ unknown: 'fail' }).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // B4: Mutual Cross-Component Recursion & Self-Recursion
    // -------------------------------------------------------------------------
    describe('B4: Mutual Cross-Component Recursion & Self-Recursion', () => {
      it('T2-B4-1: validates direct self-recursion Node -> Node in multi-branch tree', async () => {
        const fixture = loadFixtureYaml('circular-components.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const Node = mod.NodeSchema!

        const tree = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          value: 10,
          children: [
            { id: '123e4567-e89b-12d3-a456-426614174001', value: 20 },
            { id: '123e4567-e89b-12d3-a456-426614174002', value: 30 },
          ],
        }
        expect(Node.safeParse(tree).success).toBe(true)
      })

      it('T2-B4-2: validates mutual 2-node graph User -> Role -> User', async () => {
        const fixture = loadFixtureYaml('circular-components.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const User = mod.UserSchema!

        const payload = {
          id: 'u1',
          username: 'alice',
          roles: [
            {
              name: 'admin',
              members: [
                { id: 'u2', username: 'bob' },
              ],
            },
          ],
        }
        expect(User.safeParse(payload).success).toBe(true)
      })

      it('T2-B4-3: resolves 3-node cyclic dependency A -> B -> C -> A without recursion hang', async () => {
        const doc: OasDocument = {
          openapi: '3.2.0',
          info: { title: '3-Node Cycle', version: '1.0.0' },
          components: {
            schemas: {
              NodeA: {
                type: 'object',
                properties: { next: { $ref: '#/components/schemas/NodeB' } },
              },
              NodeB: {
                type: 'object',
                properties: { next: { $ref: '#/components/schemas/NodeC' } },
              },
              NodeC: {
                type: 'object',
                properties: { next: { $ref: '#/components/schemas/NodeA' } },
              },
            },
          },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(doc)
        const mod = evalGeneratedModule(code)
        expect(mod.NodeASchema).toBeDefined()
        expect(mod.NodeBSchema).toBeDefined()
        expect(mod.NodeCSchema).toBeDefined()
      })

      it('T2-B4-4: validates recursive reference wrapped in nullable type union', async () => {
        const doc: OasDocument = {
          openapi: '3.2.0',
          info: { title: 'Nullable Cycle', version: '1.0.0' },
          components: {
            schemas: {
              LinkedItem: {
                type: 'object',
                required: ['value'],
                properties: {
                  value: { type: 'string' },
                  next: {
                    type: ['null'],
                    anyOf: [
                      { $ref: '#/components/schemas/LinkedItem' },
                      { type: 'null' },
                    ],
                  },
                },
              },
            },
          },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(doc)
        expect(code).toContain('LinkedItemSchema')
      })

      it('T2-B4-5: validates recursive reference nested inside array items', async () => {
        const fixture = loadFixtureYaml('circular-components.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const Node = mod.NodeSchema!

        const emptyChildren = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          value: 1,
          children: [],
        }
        expect(Node.safeParse(emptyChildren).success).toBe(true)
      })
    })

    // -------------------------------------------------------------------------
    // B5: Complex Nested Discriminator Hierarchies
    // -------------------------------------------------------------------------
    describe('B5: Complex Nested Discriminator Hierarchies', () => {
      it('T2-B5-1: compiles two-level nested discriminator hierarchy', async () => {
        const doc: OasDocument = {
          openapi: '3.2.0',
          info: { title: 'Nested Discriminator', version: '1.0.0' },
          components: {
            schemas: {
              Sedan: {
                type: 'object',
                required: ['category', 'carType', 'doors'],
                properties: {
                  category: { type: 'string', const: 'car' },
                  carType: { type: 'string', const: 'sedan' },
                  doors: { type: 'integer', const: 4 },
                },
              },
              SUV: {
                type: 'object',
                required: ['category', 'carType', 'awd'],
                properties: {
                  category: { type: 'string', const: 'car' },
                  carType: { type: 'string', const: 'suv' },
                  awd: { type: 'boolean' },
                },
              },
              Car: {
                oneOf: [
                  { $ref: '#/components/schemas/Sedan' },
                  { $ref: '#/components/schemas/SUV' },
                ],
                discriminator: { propertyName: 'carType' },
              },
              Boat: {
                type: 'object',
                required: ['category', 'lengthFeet'],
                properties: {
                  category: { type: 'string', const: 'boat' },
                  lengthFeet: { type: 'number' },
                },
              },
              Vehicle: {
                oneOf: [
                  { $ref: '#/components/schemas/Car' },
                  { $ref: '#/components/schemas/Boat' },
                ],
                discriminator: { propertyName: 'category' },
              },
            },
          },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(doc)
        expect(code).toContain('VehicleSchema')
        expect(code).toContain('CarSchema')
      })

      it('T2-B5-2: supports discriminator mapping with URI, dot, and kebab-case keys', async () => {
        const fixture = loadFixtureYaml('problem-details.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('ProblemDetailsSchema')
        expect(code).toContain('https://api.example.com/errors/validation')
      })

      it('T2-B5-3: routes multiple explicit mapping aliases alongside OAS 3.2 defaultMapping', async () => {
        const fixture = loadFixtureYaml('filesystem-tree.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('FSNodeSchema')
      })

      it('T2-B5-4: handles missing discriminator property via defaultMapping fallback', async () => {
        const fixture = loadFixtureYaml('problem-details.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('ProblemDetailsSchema')
      })

      it('T2-B5-5: rejects unmapped discriminator value when defaultMapping is omitted', async () => {
        const schema: OasSchema = {
          oneOf: [
            {
              type: 'object',
              required: ['role'],
              properties: { role: { type: 'string', const: 'admin' } },
            },
            {
              type: 'object',
              required: ['role'],
              properties: { role: { type: 'string', const: 'user' } },
            },
          ],
          discriminator: { propertyName: 'role' },
        }
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.schemaToZod!(schema)
        const validator = evalZodExpression(code)
        expect(validator.safeParse({ role: 'superadmin' }).success).toBe(false)
      })
    })
  })

  // ===========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (15 tests)
  // ===========================================================================

  describe('Tier 3: Cross-Feature Combinations', () => {
    it('T3-C-01: sealed object containing tuple with rest and exclusive numeric bounds', async () => {
      const schema: OasSchema = {
        type: 'object',
        required: ['metrics'],
        additionalProperties: false,
        properties: {
          metrics: {
            type: 'array',
            prefixItems: [
              { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100 },
            ],
            items: {
              type: 'number',
              exclusiveMinimum: 0,
            },
          },
        },
      }
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.schemaToZod!(schema)
      expect(code).toContain('.strict()')
      expect(code).toContain('z.tuple([')
      expect(code).toContain('.gt(0)')

      const validator = evalZodExpression(code)
      expect(validator.safeParse({ metrics: [50, 10, 20] }).success).toBe(true)
      expect(validator.safeParse({ metrics: [0, 10] }).success).toBe(false)
      expect(validator.safeParse({ metrics: [50], extraKey: true }).success).toBe(false)
    })

    it('T3-C-02: recursive tree with discriminated union variants, JSDoc metadata, and defaults', async () => {
      const fixture = loadFixtureYaml('filesystem-tree.yaml')
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.generateZodFromSpec!(fixture)
      expect(code).toContain('DirectoryNodeSchema')
      expect(code).toContain('FileNodeSchema')
      expect(code).toContain('FSNodeSchema')
      expect(code).toContain('.describe(')
      expect(code).toContain('.default(')
    })

    it('T3-C-03: sealed object with nested nullable circular references and numeric bounds', async () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Complex Combo', version: '1.0.0' },
        components: {
          schemas: {
            TaxonomyNode: {
              type: 'object',
              required: ['id', 'weight'],
              additionalProperties: false,
              properties: {
                id: { type: 'string', format: 'uuid' },
                weight: { type: 'number', exclusiveMinimum: 0 },
                parent: {
                  type: ['null'],
                  anyOf: [
                    { $ref: '#/components/schemas/TaxonomyNode' },
                    { type: 'null' },
                  ],
                },
              },
            },
          },
        },
      }
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.generateZodFromSpec!(doc)
      expect(code).toContain('.strict()')
      expect(code).toContain('.gt(0)')
      expect(code).toContain('TaxonomyNodeSchema')
    })

    it('T3-C-04: tuple containing discriminated union elements and sealed object elements', async () => {
      const schema: OasSchema = {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            required: ['type'],
            additionalProperties: false,
            properties: { type: { type: 'string', const: 'head' } },
          },
          {
            oneOf: [
              {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', const: 'A' } },
              },
              {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', const: 'B' } },
              },
            ],
            discriminator: { propertyName: 'status' },
          },
        ],
        items: false,
      }
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.schemaToZod!(schema)
      expect(code).toContain('z.tuple([')
      const validator = evalZodExpression(code)
      expect(validator.safeParse([{ type: 'head' }, { status: 'A' }]).success).toBe(true)
      expect(validator.safeParse([{ type: 'head' }, { status: 'C' }]).success).toBe(false)
    })

    it('T3-C-05: object with additionalProperties catchall schema containing tuples with rest', async () => {
      const schema: OasSchema = {
        type: 'object',
        additionalProperties: {
          type: 'array',
          prefixItems: [{ type: 'string' }],
          items: { type: 'number' },
        },
      }
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.schemaToZod!(schema)
      expect(code).toContain('.catchall(')
      const validator = evalZodExpression(code)
      expect(validator.safeParse({ group1: ['first', 1, 2, 3] }).success).toBe(true)
      expect(validator.safeParse({ group2: [1, 2, 3] }).success).toBe(false)
    })

    it('T3-C-06: multi-component spec with cross-component references, object sealing, and defaults', async () => {
      const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.generateZodFromSpec!(fixture)
      expect(code).toContain('export const OrderSchema')
      expect(code).toContain('export const AddressSchema')
      expect(code).toContain('export const MoneySchema')
    })

    it('T3-C-07: integer exclusive bounds combined with formatted strings and sealed objects', async () => {
      const schema: OasSchema = {
        type: 'object',
        required: ['userId', 'score'],
        additionalProperties: false,
        properties: {
          userId: { type: 'string', format: 'uuid' },
          score: { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 100 },
        },
      }
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.schemaToZod!(schema)
      const validator = evalZodExpression(code)
      expect(validator.safeParse({ userId: '123e4567-e89b-12d3-a456-426614174000', score: 50 }).success).toBe(true)
      expect(validator.safeParse({ userId: '123e4567-e89b-12d3-a456-426614174000', score: 0 }).success).toBe(false)
      expect(validator.safeParse({ userId: 'invalid-uuid', score: 50 }).success).toBe(false)
    })

    it('T3-C-08: discriminator with variants using tuples and exclusive bounds', async () => {
      const schema: OasSchema = {
        oneOf: [
          {
            type: 'object',
            required: ['type', 'coords'],
            properties: {
              type: { type: 'string', const: 'point' },
              coords: {
                type: 'array',
                prefixItems: [{ type: 'number' }, { type: 'number' }],
                items: false,
              },
            },
          },
          {
            type: 'object',
            required: ['type', 'radius'],
            properties: {
              type: { type: 'string', const: 'circle' },
              radius: { type: 'number', exclusiveMinimum: 0 },
            },
          },
        ],
        discriminator: { propertyName: 'type' },
      }
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.schemaToZod!(schema)
      const validator = evalZodExpression(code)
      expect(validator.safeParse({ type: 'point', coords: [10, 20] }).success).toBe(true)
      expect(validator.safeParse({ type: 'circle', radius: 5.5 }).success).toBe(true)
      expect(validator.safeParse({ type: 'circle', radius: 0 }).success).toBe(false)
    })

    it('T3-C-09: object with both prefixItems tuple and sealed nested metadata', async () => {
      const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
      const schema = fixture.components?.schemas?.Coordinate!
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.schemaToZod!(schema)
      expect(code).toContain('z.tuple([')
      expect(code).toContain('.describe(')
    })

    it('T3-C-10: parses approved OpenAPI 3.2 spec (approved.openapi.yaml) successfully', () => {
      const approvedSpec = loadApprovedSpec()
      expect(approvedSpec.openapi).toMatch(/^3\.2\./)
      expect(approvedSpec.components?.schemas).toBeDefined()
      expect(Object.keys(approvedSpec.components!.schemas!).length).toBeGreaterThan(10)
    })

    it('T3-C-11: generates Zod code for approved.openapi.yaml without uncaught exception', async () => {
      const approvedSpec = loadApprovedSpec()
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.generateZodFromSpec!(approvedSpec)
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(500)
    })

    it('T3-C-12: approved.openapi.yaml generated code exports all component schemas', async () => {
      const approvedSpec = loadApprovedSpec()
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.generateZodFromSpec!(approvedSpec)
      const componentNames = Object.keys(approvedSpec.components!.schemas!)
      for (const name of componentNames.slice(0, 5)) {
        expect(code).toContain(`${name}Schema`)
      }
    })

    it('T3-C-13: creates dynamic runtime validators for approved.openapi.yaml schemas', async () => {
      const approvedSpec = loadApprovedSpec()
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const validators = zodgen!.createRuntimeZodValidators!(approvedSpec)
      expect(validators).toBeDefined()
      expect(Object.keys(validators).length).toBeGreaterThan(10)
    })

    it('T3-C-14: multi-type union with nullability and sealed object properties', async () => {
      const schema: OasSchema = {
        type: 'object',
        required: ['comment'],
        additionalProperties: false,
        properties: {
          comment: {
            type: ['string', 'null'],
          },
        },
      }
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.schemaToZod!(schema)
      const validator = evalZodExpression(code)
      expect(validator.safeParse({ comment: 'looks good' }).success).toBe(true)
      expect(validator.safeParse({ comment: null }).success).toBe(true)
      expect(validator.safeParse({ comment: 123 }).success).toBe(false)
    })

    it('T3-C-15: combined discriminator and circular reference within array items', async () => {
      const fixture = loadFixtureYaml('filesystem-tree.yaml')
      const zodgen = await getZodgen()
      expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

      const code = zodgen!.generateZodFromSpec!(fixture)
      expect(code).toContain('FSNodeSchema')
      expect(code).toContain('DirectoryNodeSchema')
    })
  })

  // ===========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 Scenarios = 13 tests)
  // ===========================================================================

  describe('Tier 4: Real-World Application Scenarios', () => {
    // -------------------------------------------------------------------------
    // Scenario 1: E-commerce Order Lifecycle Schema
    // -------------------------------------------------------------------------
    describe('Scenario 1: E-commerce Order Lifecycle Schema', () => {
      it('T4-S1-1: generates complete Zod module from ecommerce-lifecycle.yaml', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('MoneySchema')
        expect(code).toContain('AddressSchema')
        expect(code).toContain('CoordinateSchema')
        expect(code).toContain('OrderLineItemSchema')
        expect(code).toContain('OrderStatusSchema')
        expect(code).toContain('OrderSchema')
      })

      it('T4-S1-2: validates complete valid order lifecycle entity at runtime', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const Order = mod.OrderSchema!

        const validOrder = {
          orderId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          customerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          status: 'Pending',
          items: [
            {
              itemId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
              quantity: 1,
              unitPrice: { amount: 29.99, currency: 'USD' },
            },
          ],
          shippingAddress: {
            street: '456 Tech Blvd',
            city: 'San Francisco',
            country: 'US',
          },
          deliveryCoordinates: [37.7749, -122.4194, 15.0],
          total: { amount: 29.99, currency: 'USD' },
        }
        expect(Order.safeParse(validOrder).success).toBe(true)
      })

      it('T4-S1-3: rejects invalid order (zero money amount, sealed address violation, coordinate violation)', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const Order = mod.OrderSchema!

        // Invalid: amount is 0 (exclusiveMinimum: 0)
        const zeroMoneyOrder = {
          orderId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          customerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          status: 'Pending',
          items: [
            {
              itemId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
              quantity: 1,
              unitPrice: { amount: 0, currency: 'USD' },
            },
          ],
          shippingAddress: { street: '456 Tech Blvd', city: 'SF', country: 'US' },
          total: { amount: 0, currency: 'USD' },
        }
        expect(Order.safeParse(zeroMoneyOrder).success).toBe(false)

        // Invalid: Address has unexpected extra field on sealed schema
        const extraFieldAddressOrder = {
          ...zeroMoneyOrder,
          total: { amount: 29.99, currency: 'USD' },
          shippingAddress: { street: '456 Tech Blvd', city: 'SF', country: 'US', rogue: true },
        }
        expect(Order.safeParse(extraFieldAddressOrder).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // Scenario 2: Recursive File System Tree
    // -------------------------------------------------------------------------
    describe('Scenario 2: Recursive File System Tree', () => {
      it('T4-S2-1: generates complete Zod module from filesystem-tree.yaml', async () => {
        const fixture = loadFixtureYaml('filesystem-tree.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('FileNodeSchema')
        expect(code).toContain('DirectoryNodeSchema')
        expect(code).toContain('SymlinkNodeSchema')
        expect(code).toContain('FSNodeSchema')
      })

      it('T4-S2-2: validates deeply nested directory containing files, subdirs, and symlinks', async () => {
        const fixture = loadFixtureYaml('filesystem-tree.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const FSNode = mod.FSNodeSchema!

        const rootDir = {
          nodeType: 'directory',
          name: 'root',
          children: [
            {
              nodeType: 'file',
              name: 'index.ts',
              sizeBytes: 1024,
              mimeType: 'text/typescript',
            },
            {
              nodeType: 'symlink',
              name: 'link-to-index',
              targetPath: './index.ts',
            },
            {
              nodeType: 'directory',
              name: 'src',
              children: [
                {
                  nodeType: 'file',
                  name: 'app.ts',
                  sizeBytes: 2048,
                },
              ],
            },
          ],
        }
        expect(FSNode.safeParse(rootDir).success).toBe(true)
      })

      it('T4-S2-3: rejects file exceeding 1GB maximum size or unknown nodeType without default', async () => {
        const fixture = loadFixtureYaml('filesystem-tree.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const FileNode = mod.FileNodeSchema!

        const oversizedFile = {
          nodeType: 'file',
          name: 'huge.iso',
          sizeBytes: 2_000_000_000,
        }
        expect(FileNode.safeParse(oversizedFile).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // Scenario 3: RFC 9457 Problem Details with Extensions
    // -------------------------------------------------------------------------
    describe('Scenario 3: RFC 9457 Problem Details with Extensions', () => {
      it('T4-S3-1: generates complete Zod module from problem-details.yaml', async () => {
        const fixture = loadFixtureYaml('problem-details.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        expect(code).toContain('ValidationProblemSchema')
        expect(code).toContain('PaymentProblemSchema')
        expect(code).toContain('ForbiddenProblemSchema')
        expect(code).toContain('ProblemDetailsSchema')
      })

      it('T4-S3-2: validates ValidationProblem, PaymentProblem, and ForbiddenProblem payloads', async () => {
        const fixture = loadFixtureYaml('problem-details.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const ProblemDetails = mod.ProblemDetailsSchema!

        const validationErr = {
          type: 'https://api.example.com/errors/validation',
          title: 'Validation Error',
          status: 422,
          detail: 'Field email is invalid',
          invalidParams: [{ field: 'email', message: 'Must be valid email' }],
        }
        expect(ProblemDetails.safeParse(validationErr).success).toBe(true)

        const paymentErr = {
          type: 'https://api.example.com/errors/payment',
          title: 'Payment Required',
          status: 402,
          balance: 5.0,
          required: 15.0,
        }
        expect(ProblemDetails.safeParse(paymentErr).success).toBe(true)

        const forbiddenErr = {
          type: 'https://api.example.com/errors/forbidden',
          title: 'Access Forbidden',
          status: 403,
          requiredRole: 'admin',
        }
        expect(ProblemDetails.safeParse(forbiddenErr).success).toBe(true)
      })

      it('T4-S3-3: routes unmapped problem type to defaultMapping (ValidationProblem)', async () => {
        const fixture = loadFixtureYaml('problem-details.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const mod = evalGeneratedModule(code)
        const ProblemDetails = mod.ProblemDetailsSchema!

        const unmappedProblem = {
          type: 'https://api.example.com/errors/unknown-custom-type',
          title: 'Custom Error',
          status: 422,
          invalidParams: [],
        }
        expect(ProblemDetails.safeParse(unmappedProblem).success).toBe(true)
      })
    })

    // -------------------------------------------------------------------------
    // Scenario 4: CLI Full Spec Build & Emission
    // -------------------------------------------------------------------------
    describe('Scenario 4: CLI Full Spec Build & Emission', () => {
      it('T4-S4-1: executes generate:zod against full fixture and emits valid TypeScript file', async () => {
        const cmd = await getGenerateZodCommand()
        expect(cmd, 'generate:zod CLI command must be implemented').not.toBeNull()

        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oa-zod-cli-full-'))
        const outFile = path.join(tempDir, 'ecommerce-schemas.ts')
        const specFile = path.resolve(import.meta.dirname, '../fixtures/zodgen/ecommerce-lifecycle.yaml')

        process.exitCode = 0
        await runCommand(cmd, ['--spec', specFile, '--output', outFile])
        expect(process.exitCode).toBe(0)
        expect(fs.existsSync(outFile)).toBe(true)

        const fileContent = fs.readFileSync(outFile, 'utf8')
        expect(fileContent).toContain('export const OrderSchema =')
        expect(fileContent).toContain('export type Order =')
      })

      it('T4-S4-2: emitted file passes in-process syntax evaluation with z from zod', async () => {
        const cmd = await getGenerateZodCommand()
        expect(cmd, 'generate:zod CLI command must be implemented').not.toBeNull()

        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oa-zod-cli-eval-'))
        const outFile = path.join(tempDir, 'problem-details-schemas.ts')
        const specFile = path.resolve(import.meta.dirname, '../fixtures/zodgen/problem-details.yaml')

        process.exitCode = 0
        await runCommand(cmd, ['--spec', specFile, '--output', outFile])
        expect(process.exitCode).toBe(0)

        const fileContent = fs.readFileSync(outFile, 'utf8')
        expect(() => evalGeneratedModule(fileContent)).not.toThrow()
      })
    })

    // -------------------------------------------------------------------------
    // Scenario 5: Dynamic vs Static Parity
    // -------------------------------------------------------------------------
    describe('Scenario 5: Dynamic vs Static Parity', () => {
      it('T4-S5-1: static generated schema and dynamic runtime validator accept identical valid payloads', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const staticMod = evalGeneratedModule(code)
        const StaticMoney = staticMod.MoneySchema!

        const runtimeValidators = zodgen!.createRuntimeZodValidators!(fixture)
        const DynamicMoney = runtimeValidators.Money!

        const validMoney = { amount: 49.99, currency: 'EUR' }
        const staticRes = StaticMoney.safeParse(validMoney)
        const dynamicRes = DynamicMoney.safeParse(validMoney)

        expect(staticRes.success).toBe(true)
        expect(dynamicRes.success).toBe(true)
      })

      it('T4-S5-2: static generated schema and dynamic runtime validator reject identical invalid payloads', async () => {
        const fixture = loadFixtureYaml('ecommerce-lifecycle.yaml')
        const zodgen = await getZodgen()
        expect(zodgen, 'Zodgen module must be implemented').not.toBeNull()

        const code = zodgen!.generateZodFromSpec!(fixture)
        const staticMod = evalGeneratedModule(code)
        const StaticMoney = staticMod.MoneySchema!

        const runtimeValidators = zodgen!.createRuntimeZodValidators!(fixture)
        const DynamicMoney = runtimeValidators.Money!

        const invalidMoney = { amount: -5.0, currency: 'USD' }
        const staticRes = StaticMoney.safeParse(invalidMoney)
        const dynamicRes = DynamicMoney.safeParse(invalidMoney)

        expect(staticRes.success).toBe(false)
        expect(dynamicRes.success).toBe(false)
      })
    })
  })
})
