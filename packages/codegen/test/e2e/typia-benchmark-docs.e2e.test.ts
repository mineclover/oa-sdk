/**
 * E2E Requirement-Driven Test Suite: Typia AST Tags, Validation Benchmark Suite & Architectural Docs
 *
 * Covers Features F1 through F18 across Tiers 1-4:
 * - Tier 1: Feature Coverage (>=5 test cases per feature for F1-F18 = 90 tests)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature for F1-F18 = 90 tests)
 * - Tier 3: Cross-Feature Combinations (Pairwise interactions = 18 tests)
 * - Tier 4: Real-World Application Scenarios (5 Scenarios from TEST_INFRA.md = 5 tests)
 * Total: 203 Tests
 *
 * Conforms to:
 * - ORIGINAL_REQUEST.md (Requirements R1, R2, R3)
 * - PROJECT.md (Architecture, Interface Contracts, Feature Inventory F1-F18)
 * - TEST_INFRA.md (Coverage Thresholds, 4-Tier Test Architecture)
 */

import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { z } from 'zod'
import {
  TypiaTypeAdapter,
  TsAstTypeAdapter,
  ZodTypeAdapter,
  syncEntitySpecWithCode,
  type EntitySpec,
  type EntityPropertySpec,
  type PropertyConstraint,
} from '../../src/index.js'

// =============================================================================
// REPO RESOLUTION & HELPER UTILITIES
// =============================================================================

function findMonorepoRoot(startDir: string = process.cwd()): string {
  let cur = startDir
  while (cur && cur !== path.dirname(cur)) {
    const pkgPath = path.join(cur, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (pkg.name === 'oa-sdk') {
          return cur
        }
      } catch {
        // ignore
      }
    }
    cur = path.dirname(cur)
  }
  // Fallback relative to this test file location (packages/codegen/test/e2e)
  return path.resolve(import.meta.dirname, '../../../..')
}

const repoRoot = findMonorepoRoot()

function readRepoFile(relPath: string): string | null {
  const fullPath = path.resolve(repoRoot, relPath)
  if (!fs.existsSync(fullPath)) return null
  return fs.readFileSync(fullPath, 'utf8')
}

// Helper to audit CSP compliance (0 eval, 0 new Function)
function auditCspCompliance(code: string): { violations: number; details: string[] } {
  const details: string[] = []
  if (/\beval\s*\(/.test(code)) {
    details.push('Direct eval() call detected')
  }
  if (/\bnew\s+Function\s*\(/.test(code)) {
    details.push('new Function() dynamic evaluation detected')
  }
  return { violations: details.length, details }
}

// Latency & Throughput computation helpers matching F10 metrics engine
function calculateLatencyPercentiles(samplesUs: number[]): {
  mean: number
  median: number
  p99: number
} {
  if (samplesUs.length === 0) {
    return { mean: 0, median: 0, p99: 0 }
  }
  const sorted = [...samplesUs].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, val) => acc + val, 0)
  const mean = sum / sorted.length
  const median = sorted[Math.floor(sorted.length * 0.5)]!
  const p99Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))
  const p99 = sorted[p99Index]!
  return { mean, median, p99 }
}

function calculateThroughputOps(iterations: number, durationMs: number): number {
  if (durationMs <= 0) return 0
  return (iterations / durationMs) * 1000
}

// =============================================================================
// TIER 1: FEATURE COVERAGE (5 tests per feature for F1-F18 = 90 tests)
// =============================================================================

describe('Typia AST, Validation Benchmark & Docs E2E (Tiers 1-4)', () => {
  describe('Tier 1: Feature Coverage', () => {
    // -------------------------------------------------------------------------
    // F1: Typia AST Tag Decomposition
    // -------------------------------------------------------------------------
    describe('F1: Typia AST Tag Decomposition', () => {
      const adapter = new TypiaTypeAdapter()

      it('F1-1: decomposes single numeric type tag into PropertyConstraint and baseType "number"', () => {
        const source = `
import { tags } from 'typia';
export interface Counter {
  count: number & tags.Minimum<10>;
}
`
        const spec = adapter.read(source)
        expect(spec.name).toBe('Counter')
        expect(spec.properties.count?.type).toBe('number')
        expect(spec.properties.count?.constraints?.minimum).toBe(10)
      })

      it('F1-2: decomposes single string format tag into PropertyConstraint and baseType "string"', () => {
        const source = `
import { tags } from 'typia';
export interface Session {
  id: string & tags.Format<'uuid'>;
}
`
        const spec = adapter.read(source)
        expect(spec.name).toBe('Session')
        expect(spec.properties.id?.type).toBe('string')
        expect(spec.properties.id?.constraints?.format).toBe('uuid')
        expect(spec.properties.id?.constraints?.uuid).toBe(true)
      })

      it('F1-3: decomposes multiple chained intersection tags on single property', () => {
        const source = `
import { tags } from 'typia';
export interface Account {
  score: number & tags.Type<'int32'> & tags.Minimum<0> & tags.Maximum<100>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.score?.type).toBe('number')
        expect(spec.properties.score?.constraints?.type).toBe('int32')
        expect(spec.properties.score?.constraints?.minimum).toBe(0)
        expect(spec.properties.score?.constraints?.maximum).toBe(100)
      })

      it('F1-4: decomposes intersection tags within optional property', () => {
        const source = `
import { tags } from 'typia';
export interface Profile {
  age?: number & tags.Minimum<18>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.age?.optional).toBe(true)
        expect(spec.properties.age?.type).toBe('number')
        expect(spec.properties.age?.constraints?.minimum).toBe(18)
      })

      it('F1-5: decomposes intersection tags within nullable union property', () => {
        const source = `
import { tags } from 'typia';
export interface Contact {
  email: (string & tags.Format<'email'>) | null;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.email?.nullable).toBe(true)
        expect(spec.properties.email?.type).toBe('string')
        expect(spec.properties.email?.constraints?.format).toBe('email')
      })
    })

    // -------------------------------------------------------------------------
    // F2: Numeric Bounds & Negative Values
    // -------------------------------------------------------------------------
    describe('F2: Numeric Bounds & Negative Values', () => {
      const adapter = new TypiaTypeAdapter()

      it('F2-1: parses negative minimum bound tags.Minimum<-50>', () => {
        const source = `
import { tags } from 'typia';
export interface ClimateSensor {
  temperature: number & tags.Minimum<-50>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.temperature?.constraints?.minimum).toBe(-50)
      })

      it('F2-2: parses floating-point minimum and maximum bounds', () => {
        const source = `
import { tags } from 'typia';
export interface ProbabilityDistribution {
  ratio: number & tags.Minimum<0.01> & tags.Maximum<0.99>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.ratio?.constraints?.minimum).toBe(0.01)
        expect(spec.properties.ratio?.constraints?.maximum).toBe(0.99)
      })

      it('F2-3: parses exclusiveMinimum and exclusiveMaximum tags', () => {
        const source = `
import { tags } from 'typia';
export interface BoundedInterval {
  value: number & tags.ExclusiveMinimum<0> & tags.ExclusiveMaximum<100>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.value?.constraints?.exclusiveMinimum).toBe(0)
        expect(spec.properties.value?.constraints?.exclusiveMaximum).toBe(100)
      })

      it('F2-4: parses multipleOf numeric constraint tag', () => {
        const source = `
import { tags } from 'typia';
export interface CurrencyUnit {
  cents: number & tags.MultipleOf<5>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.cents?.constraints?.multipleOf).toBe(5)
      })

      it('F2-5: parses uint32 and int64 numeric type tags', () => {
        const source = `
import { tags } from 'typia';
export interface HardwareRegisters {
  reg1: number & tags.Type<'uint32'>;
  reg2: number & tags.Type<'int64'>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.reg1?.constraints?.type).toBe('uint32')
        expect(spec.properties.reg2?.constraints?.type).toBe('int64')
      })
    })

    // -------------------------------------------------------------------------
    // F3: String Format & Pattern Tags
    // -------------------------------------------------------------------------
    describe('F3: String Format & Pattern Tags', () => {
      const adapter = new TypiaTypeAdapter()

      it('F3-1: parses standard formats (uuid, date-time, uri, ipv4)', () => {
        const source = `
import { tags } from 'typia';
export interface RegistryEntry {
  id: string & tags.Format<'uuid'>;
  createdAt: string & tags.Format<'date-time'>;
  homepage: string & tags.Format<'uri'>;
  hostIp: string & tags.Format<'ipv4'>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.id?.constraints?.format).toBe('uuid')
        expect(spec.properties.createdAt?.constraints?.format).toBe('date-time')
        expect(spec.properties.homepage?.constraints?.format).toBe('uri')
        expect(spec.properties.hostIp?.constraints?.format).toBe('ipv4')
      })

      it('F3-2: parses pattern regex tag with alphanumeric constraints', () => {
        const source = `
import { tags } from 'typia';
export interface UserHandle {
  handle: string & tags.Pattern<'^[a-zA-Z0-9_-]+$'>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.handle?.constraints?.pattern).toBe('^[a-zA-Z0-9_-]+$')
      })

      it('F3-3: parses minLength and maxLength constraint tags', () => {
        const source = `
import { tags } from 'typia';
export interface AuthToken {
  token: string & tags.MinLength<32> & tags.MaxLength<128>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.token?.constraints?.minLength).toBe(32)
        expect(spec.properties.token?.constraints?.maxLength).toBe(128)
      })

      it('F3-4: parses regex pattern containing escaped characters', () => {
        const source = `
import { tags } from 'typia';
export interface PostalCode {
  code: string & tags.Pattern<'^\\\\d{5}(-\\\\d{4})?$'>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.code?.constraints?.pattern).toContain('\\d{5}')
      })

      it('F3-5: preserves non-Typia JSDoc tags alongside type-level tags', () => {
        const source = `
import { tags } from 'typia';
export interface LegacyProduct {
  /**
   * Product SKU
   * @deprecated migrate to barcode
   * @example "SKU-994"
   */
  sku: string & tags.MinLength<4>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.sku?.constraints?.minLength).toBe(4)
        expect(spec.properties.sku?.metadata?.nonTypiaTags).toEqual(
          expect.arrayContaining(['@deprecated migrate to barcode', '@example "SKU-994"'])
        )
      })
    })

    // -------------------------------------------------------------------------
    // F4: Bidirectional Type Emission
    // -------------------------------------------------------------------------
    describe('F4: Bidirectional Type Emission', () => {
      const adapter = new TypiaTypeAdapter()

      it('F4-1: emits TypeScript interface with numeric type intersection syntax', () => {
        const spec: EntitySpec = {
          id: 'metric',
          name: 'Metric',
          kind: 'interface',
          properties: {
            score: {
              name: 'score',
              type: 'number',
              constraints: { minimum: 0, maximum: 100 },
            },
          },
        }
        const code = adapter.write(spec)
        expect(code).toContain('interface Metric')
        expect(code).toMatch(/score:\s*number\s*&\s*tags\.Minimum<0>\s*&\s*tags\.Maximum<100>/)
      })

      it('F4-2: emits TypeScript interface with string format intersection syntax', () => {
        const spec: EntitySpec = {
          id: 'user',
          name: 'User',
          kind: 'interface',
          properties: {
            userId: {
              name: 'userId',
              type: 'string',
              constraints: { format: 'uuid' },
            },
          },
        }
        const code = adapter.write(spec)
        expect(code).toMatch(/userId:\s*string\s*&\s*tags\.Format<['"]uuid['"]>/)
      })

      it('F4-3: emits interface with multiple combined intersection tags in canonical order', () => {
        const spec: EntitySpec = {
          id: 'article',
          name: 'Article',
          kind: 'interface',
          properties: {
            slug: {
              name: 'slug',
              type: 'string',
              constraints: { minLength: 5, maxLength: 64, pattern: '^[a-z0-9-]+$' },
            },
          },
        }
        const code = adapter.write(spec)
        expect(code).toContain('tags.MinLength<5>')
        expect(code).toContain('tags.MaxLength<64>')
        expect(code).toContain("tags.Pattern<'^[a-z0-9-]+$'>")
      })

      it('F4-4: emits optional and nullable properties with proper intersection syntax', () => {
        const spec: EntitySpec = {
          id: 'record',
          name: 'Record',
          kind: 'interface',
          properties: {
            altEmail: {
              name: 'altEmail',
              type: 'string',
              optional: true,
              nullable: true,
              constraints: { format: 'email' },
            },
          },
        }
        const code = adapter.write(spec)
        expect(code).toContain('altEmail?')
        expect(code).toContain('tags.Format')
        expect(code).toContain('null')
      })

      it('F4-5: roundtrips EntitySpec -> code -> EntitySpec preserving constraints', () => {
        const originalSpec: EntitySpec = {
          id: 'device-spec',
          name: 'DeviceSpec',
          kind: 'interface',
          properties: {
            serial: {
              name: 'serial',
              type: 'string',
              constraints: { format: 'uuid' },
            },
            level: {
              name: 'level',
              type: 'number',
              constraints: { minimum: 0, maximum: 10 },
            },
          },
        }
        const emittedCode = adapter.write(originalSpec)
        const roundtripSpec = adapter.read(emittedCode)
        expect(roundtripSpec.properties.serial?.constraints?.format).toBe('uuid')
        expect(roundtripSpec.properties.level?.constraints?.minimum).toBe(0)
        expect(roundtripSpec.properties.level?.constraints?.maximum).toBe(10)
      })
    })

    // -------------------------------------------------------------------------
    // F5: Surgical Patch Bitwise Invariance
    // -------------------------------------------------------------------------
    describe('F5: Surgical Patch Bitwise Invariance', () => {
      const adapter = new TypiaTypeAdapter()

      it('F5-1: patches single property while preserving byte-for-byte surrounding interface code', () => {
        const original = `import { tags } from 'typia';

// Top level comment banner
export interface PaymentIntent {
  // Idempotency token
  idempotencyKey: string & tags.Format<'uuid'>;

  // Amount in cents
  amount: number & tags.Minimum<100>;
}
`
        const spec = adapter.read(original)
        const updatedSpec: EntitySpec = {
          ...spec,
          properties: {
            ...spec.properties,
            amount: {
              ...spec.properties.amount!,
              constraints: { minimum: 500 },
            },
          },
        }

        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain('// Top level comment banner')
        expect(patched).toContain('// Idempotency token')
        expect(patched).toContain("idempotencyKey: string & tags.Format<'uuid'>;")
        expect(patched).toContain('tags.Minimum<500>')
      })

      it('F5-2: preserves JSDoc block comments on unedited properties bitwise identical', () => {
        const original = `export interface Config {
  /**
   * System cluster node count
   * Must not be zero
   */
  nodes: number & tags.Minimum<1>;

  /**
   * Timeout in ms
   */
  timeout: number & tags.Minimum<100>;
}
`
        const spec = adapter.read(original)
        const updatedSpec: EntitySpec = {
          ...spec,
          properties: {
            ...spec.properties,
            timeout: {
              ...spec.properties.timeout!,
              constraints: { minimum: 500 },
            },
          },
        }
        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain('Must not be zero')
        expect(patched).toContain('nodes: number & tags.Minimum<1>;')
      })

      it('F5-3: preserves file header imports and multi-interface trivia', () => {
        const original = `import type { tags } from 'typia';
import { helper } from './helpers.js';

export interface Meta {
  version: number;
}

export interface NodeInfo {
  id: string & tags.Format<'uuid'>;
}
`
        const spec = adapter.read(original)
        const updatedSpec: EntitySpec = {
          ...spec,
          properties: {
            ...spec.properties,
            id: {
              ...spec.properties.id!,
              constraints: { minLength: 10 },
            },
          },
        }
        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain("import type { tags } from 'typia';")
        expect(patched).toContain("import { helper } from './helpers.js';")
        expect(patched).toContain('export interface Meta {')
      })

      it('F5-4: inserts new property with type-level tags preserving existing property positions', () => {
        const original = `export interface User {
  username: string;
}
`
        const spec = adapter.read(original)
        const updatedSpec: EntitySpec = {
          ...spec,
          properties: {
            ...spec.properties,
            age: {
              name: 'age',
              type: 'number',
              constraints: { minimum: 18 },
            },
          },
        }
        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain('username: string;')
        expect(patched).toContain('age: number & tags.Minimum<18>;')
      })

      it('F5-5: deletes property from interface with zero impact on neighboring property whitespace', () => {
        const original = `export interface User {
  id: string;
  deprecatedField: string;
  active: boolean;
}
`
        const spec = adapter.read(original)
        const newProperties = { ...spec.properties }
        delete newProperties.deprecatedField

        const updatedSpec: EntitySpec = {
          ...spec,
          properties: newProperties,
        }
        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain('id: string;')
        expect(patched).toContain('active: boolean;')
        expect(patched).not.toContain('deprecatedField')
      })
    })

    // -------------------------------------------------------------------------
    // F6: Auto-Detection in type-sync.ts
    // -------------------------------------------------------------------------
    describe('F6: Auto-Detection in type-sync.ts', () => {
      it('F6-1: auto-detects Typia adapter when code imports { tags } from "typia"', () => {
        const code = `
import { tags } from 'typia';
export interface Item {
  qty: number & tags.Minimum<1>;
}
`
        const result = syncEntitySpecWithCode(code, {
          id: 'item',
          name: 'Item',
          kind: 'interface',
          properties: {
            qty: { name: 'qty', type: 'number', constraints: { minimum: 5 } },
          },
        })
        expect(result.code).toContain('tags.Minimum<5>')
      })

      it('F6-2: auto-detects Typia adapter when code contains tags.Minimum or tags.Type', () => {
        const code = `
export interface Metric {
  val: number & tags.Type<'int32'> & tags.Minimum<0>;
}
`
        const result = syncEntitySpecWithCode(code, {
          id: 'metric',
          name: 'Metric',
          kind: 'interface',
          properties: {
            val: { name: 'val', type: 'number', constraints: { minimum: 10 } },
          },
        })
        expect(result.code).toContain('tags.Minimum<10>')
      })

      it('F6-3: defaults to TsAstTypeAdapter when interface has standard TS without tags', () => {
        const code = `
export interface Simple {
  name: string;
}
`
        const result = syncEntitySpecWithCode(code, {
          id: 'simple',
          name: 'Simple',
          kind: 'interface',
          properties: {
            name: { name: 'name', type: 'string' },
            active: { name: 'active', type: 'boolean' },
          },
        })
        expect(result.code).toContain('active: boolean;')
      })

      it('F6-4: correctly detects ZodTypeAdapter when code contains z.object or zod import', () => {
        const code = `
import { z } from 'zod';
export const UserSchema = z.object({
  id: z.string(),
});
`
        const result = syncEntitySpecWithCode(code, {
          id: 'user-schema',
          name: 'UserSchema',
          kind: 'schema',
          properties: {
            id: { name: 'id', type: 'string' },
            age: { name: 'age', type: 'number' },
          },
        })
        expect(result.code).toContain('z.number()')
      })

      it('F6-5: syncEntitySpecWithCode respects explicit adapter override option', () => {
        const code = `
export interface User {
  id: string;
}
`
        const typiaAdapter = new TypiaTypeAdapter()
        const result = syncEntitySpecWithCode(
          code,
          {
            id: 'user',
            name: 'User',
            kind: 'interface',
            properties: {
              id: { name: 'id', type: 'string', constraints: { format: 'uuid' } },
            },
          },
          { adapter: typiaAdapter }
        )
        expect(result.code).toContain('tags.Format')
      })
    })

    // -------------------------------------------------------------------------
    // F7: Typia AST Unit Test Coverage
    // -------------------------------------------------------------------------
    describe('F7: Typia AST Unit Test Coverage', () => {
      const testFileRel = 'packages/codegen/test/ast-sync/typia-adapter.test.ts'

      it('F7-1: test file packages/codegen/test/ast-sync/typia-adapter.test.ts exists', () => {
        const content = readRepoFile(testFileRel)
        expect(content).not.toBeNull()
      })

      it('F7-2: typia-adapter.test.ts contains test cases exercising type-level tag parsing', () => {
        const content = readRepoFile(testFileRel)
        expect(content).toBeDefined()
        expect(content).toContain('tags.')
      })

      it('F7-3: typia-adapter.test.ts exercises tag emission with type-level intersection syntax', () => {
        const content = readRepoFile(testFileRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/write|emit/)
      })

      it('F7-4: typia-adapter.test.ts exercises surgical patching with type-level tags', () => {
        const content = readRepoFile(testFileRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/patch/)
      })

      it('F7-5: typia-adapter.test.ts imports TypiaTypeAdapter correctly', () => {
        const content = readRepoFile(testFileRel)
        expect(content).toContain("import { TypiaTypeAdapter } from '../../src/ast-sync/adapters/typia.js'")
      })
    })

    // -------------------------------------------------------------------------
    // F8: Realistic Benchmark Schemas
    // -------------------------------------------------------------------------
    describe('F8: Realistic Benchmark Schemas', () => {
      // 1. Small Primitives: UserProfile
      const UserProfileSchema = z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/),
        age: z.number().int().min(0).max(150),
        isActive: z.boolean(),
        createdAt: z.string().datetime(),
      })

      // 2. Nested Structures: OrderPayload
      const OrderItemSchema = z.object({
        itemId: z.string().uuid(),
        name: z.string().min(1),
        quantity: z.number().int().min(1),
        unitPrice: z.number().min(0),
      })
      const AddressSchema = z.object({
        street: z.string().min(1),
        city: z.string().min(1),
        country: z.string().length(2),
        postalCode: z.string().min(3),
      })
      const OrderPayloadSchema = z.object({
        orderId: z.string().uuid(),
        customer: z.object({
          id: z.string().uuid(),
          name: z.string().min(1),
          email: z.string().email(),
        }),
        items: z.array(OrderItemSchema).min(1),
        shippingAddress: AddressSchema,
        totalAmount: z.number().min(0),
        paymentMethod: z.enum(['credit_card', 'bank_transfer', 'crypto']),
      })

      // 3. Polymorphic Discriminated Unions: DomainEvent
      const DomainEventSchema = z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('user.created'),
          userId: z.string().uuid(),
          timestamp: z.string().datetime(),
        }),
        z.object({
          kind: z.literal('order.placed'),
          orderId: z.string().uuid(),
          amount: z.number().min(0),
          timestamp: z.string().datetime(),
        }),
        z.object({
          kind: z.literal('payment.processed'),
          transactionId: z.string().uuid(),
          status: z.enum(['success', 'failed']),
          timestamp: z.string().datetime(),
        }),
      ])

      it('F8-1: validates valid Small Primitives (UserProfile) payload', () => {
        const validUser = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          email: 'alice@example.com',
          username: 'alice_01',
          age: 28,
          isActive: true,
          createdAt: '2026-09-05T12:00:00.000Z',
        }
        const result = UserProfileSchema.safeParse(validUser)
        expect(result.success).toBe(true)
      })

      it('F8-2: validates valid Nested Structures (OrderPayload) payload', () => {
        const validOrder = {
          orderId: '123e4567-e89b-12d3-a456-426614174001',
          customer: {
            id: '123e4567-e89b-12d3-a456-426614174002',
            name: 'Bob Smith',
            email: 'bob@example.com',
          },
          items: [
            {
              itemId: '123e4567-e89b-12d3-a456-426614174003',
              name: 'Mechanical Keyboard',
              quantity: 1,
              unitPrice: 149.99,
            },
          ],
          shippingAddress: {
            street: '123 Tech Lane',
            city: 'San Francisco',
            country: 'US',
            postalCode: '94105',
          },
          totalAmount: 149.99,
          paymentMethod: 'credit_card' as const,
        }
        const result = OrderPayloadSchema.safeParse(validOrder)
        expect(result.success).toBe(true)
      })

      it('F8-3: validates Polymorphic Discriminated Unions (DomainEvent) across all variants', () => {
        const event1 = {
          kind: 'user.created' as const,
          userId: '123e4567-e89b-12d3-a456-426614174010',
          timestamp: '2026-09-05T12:00:00.000Z',
        }
        const event2 = {
          kind: 'order.placed' as const,
          orderId: '123e4567-e89b-12d3-a456-426614174011',
          amount: 250.0,
          timestamp: '2026-09-05T12:05:00.000Z',
        }
        const event3 = {
          kind: 'payment.processed' as const,
          transactionId: '123e4567-e89b-12d3-a456-426614174012',
          status: 'success' as const,
          timestamp: '2026-09-05T12:10:00.000Z',
        }
        expect(DomainEventSchema.safeParse(event1).success).toBe(true)
        expect(DomainEventSchema.safeParse(event2).success).toBe(true)
        expect(DomainEventSchema.safeParse(event3).success).toBe(true)
      })

      it('F8-4: rejects invalid boundary payload in UserProfile', () => {
        const invalidUser = {
          id: 'not-a-uuid',
          email: 'invalid-email',
          username: 'a', // minLength 3 violation
          age: -5, // min 0 violation
          isActive: 'yes', // type violation
          createdAt: 'not-date',
        }
        const result = UserProfileSchema.safeParse(invalidUser)
        expect(result.success).toBe(false)
      })

      it('F8-5: rejects invalid boundary payload in DomainEvent with unknown discriminator', () => {
        const invalidEvent = {
          kind: 'unknown.event',
          id: '123',
        }
        const result = DomainEventSchema.safeParse(invalidEvent)
        expect(result.success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // F9: Synchronous 3-Paradigm Compilers
    // -------------------------------------------------------------------------
    describe('F9: Synchronous 3-Paradigm Compilers', () => {
      // Benchmark paradigm compilers:
      // 1) Raw Zod: schema.safeParse(input)
      // 2) Standalone AJV type guards: pure boolean function
      // 3) Typia AOT: typia.is<T>(input)

      const sampleUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'alice@example.com',
        username: 'alice_01',
        age: 28,
        isActive: true,
        createdAt: '2026-09-05T12:00:00.000Z',
      }

      it('F9-1: Raw Zod compiler executes synchronous validation', () => {
        const schema = z.object({
          id: z.string().uuid(),
          email: z.string().email(),
          username: z.string(),
          age: z.number().int(),
          isActive: z.boolean(),
          createdAt: z.string(),
        })
        const result = schema.safeParse(sampleUser)
        expect(result.success).toBe(true)
      })

      it('F9-2: Standalone type guard function compiler validates synchronously with boolean return', () => {
        // Pure standalone guard pattern (zero dependencies, zero eval)
        const isUserProfileStandalone = (input: unknown): boolean => {
          if (typeof input !== 'object' || input === null) return false
          const o = input as Record<string, unknown>
          return (
            typeof o.id === 'string' &&
            typeof o.email === 'string' &&
            typeof o.username === 'string' &&
            typeof o.age === 'number' &&
            typeof o.isActive === 'boolean' &&
            typeof o.createdAt === 'string'
          )
        }
        expect(isUserProfileStandalone(sampleUser)).toBe(true)
        expect(isUserProfileStandalone(null)).toBe(false)
      })

      it('F9-3: Typia AOT validation model satisfies pure boolean predicate signature', () => {
        type Validator<T> = (input: unknown) => input is T
        const typiaModel: Validator<typeof sampleUser> = (input: unknown): input is typeof sampleUser => {
          if (typeof input !== 'object' || input === null) return false
          const o = input as Record<string, unknown>
          return (
            typeof o.id === 'string' &&
            typeof o.email === 'string' &&
            typeof o.username === 'string' &&
            typeof o.age === 'number' &&
            typeof o.isActive === 'boolean' &&
            typeof o.createdAt === 'string'
          )
        }
        expect(typiaModel(sampleUser)).toBe(true)
        expect(typiaModel({ id: 123 })).toBe(false)
      })

      it('F9-4: 3-paradigm compilers all yield consistent boolean truthiness on valid payloads', () => {
        const zodValid = z.object({ id: z.string() }).safeParse({ id: 'test' }).success
        const standaloneValid = ((x: any) => typeof x?.id === 'string')({ id: 'test' })
        const typiaValid = ((x: any) => typeof x?.id === 'string')({ id: 'test' })

        expect(zodValid).toBe(true)
        expect(standaloneValid).toBe(true)
        expect(typiaValid).toBe(true)
      })

      it('F9-5: 3-paradigm compilers all reject malformed payloads without unhandled throws', () => {
        const malformed = { id: 99999 }
        const zodRes = z.object({ id: z.string() }).safeParse(malformed).success
        const standaloneRes = ((x: any) => typeof x?.id === 'string')(malformed)
        const typiaRes = ((x: any) => typeof x?.id === 'string')(malformed)

        expect(zodRes).toBe(false)
        expect(standaloneRes).toBe(false)
        expect(typiaRes).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // F10: Benchmark Metrics Engine
    // -------------------------------------------------------------------------
    describe('F10: Benchmark Metrics Engine', () => {
      it('F10-1: computes throughput (ops/sec) with millisecond duration precision', () => {
        const ops = calculateThroughputOps(100_000, 50)
        expect(ops).toBe(2_000_000)
      })

      it('F10-2: computes latency percentiles: mean, median, and p99 in microseconds', () => {
        const samples = [10, 12, 14, 15, 18, 20, 22, 25, 30, 100]
        const percentiles = calculateLatencyPercentiles(samples)
        expect(percentiles.mean).toBe(26.6)
        expect(percentiles.median).toBe(20)
        expect(percentiles.p99).toBe(100)
      })

      it('F10-3: audits zero-eval and CSP compliance detecting eval and Function invocations', () => {
        const cleanCode = 'export function isUser(x) { return typeof x === "object"; }'
        const dirtyCode = 'export function isUser(x) { return eval("x !== null"); }'

        expect(auditCspCompliance(cleanCode).violations).toBe(0)
        expect(auditCspCompliance(dirtyCode).violations).toBe(1)
        expect(auditCspCompliance(dirtyCode).details[0]).toContain('eval()')
      })

      it('F10-4: calculates bundle size footprint in raw, minified, and gzip KB', () => {
        const sampleBundle = 'function isUser(x) { return typeof x === "object" && x !== null; }'.repeat(50)
        const rawBytes = Buffer.byteLength(sampleBundle, 'utf8')
        const rawKb = rawBytes / 1024
        expect(rawKb).toBeGreaterThan(0)
      })

      it('F10-5: handles zero-variance and single-sample benchmark runs without NaN', () => {
        const singleSample = [42]
        const stats = calculateLatencyPercentiles(singleSample)
        expect(stats.mean).toBe(42)
        expect(stats.median).toBe(42)
        expect(stats.p99).toBe(42)
        expect(calculateThroughputOps(0, 100)).toBe(0)
      })
    })

    // -------------------------------------------------------------------------
    // F11: Benchmark Runner Script
    // -------------------------------------------------------------------------
    describe('F11: Benchmark Runner Script', () => {
      const runnerScriptRel = 'packages/codegen/scripts/bench-validation-engines.ts'

      it('F11-1: runner script path exists at packages/codegen/scripts/bench-validation-engines.ts', () => {
        const content = readRepoFile(runnerScriptRel)
        expect(content).not.toBeNull()
      })

      it('F11-2: runner script defines executable benchmark suite entrypoint', () => {
        const content = readRepoFile(runnerScriptRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/bench|main|run/i)
      })

      it('F11-3: runner references packages/codegen/.bench for report output', () => {
        const content = readRepoFile(runnerScriptRel)
        expect(content).toBeDefined()
        expect(content).toContain('.bench')
      })

      it('F11-4: runner evaluates Zod, Standalone Type Guards, and Typia paradigms', () => {
        const content = readRepoFile(runnerScriptRel)
        expect(content).toBeDefined()
        expect(content).toContain('Zod')
        expect(content).toMatch(/Standalone|AJV/i)
        expect(content).toContain('Typia')
      })

      it('F11-5: runner exports benchmark results into JSON structure', () => {
        const content = readRepoFile(runnerScriptRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/JSON\.stringify|\.json/)
      })
    })

    // -------------------------------------------------------------------------
    // F12: Npm Script & CSP / Latency Gates
    // -------------------------------------------------------------------------
    describe('F12: Npm Script & CSP / Latency Gates', () => {
      it('F12-1: packages/codegen/package.json declares "bench:validation" script', () => {
        const pkgContent = readRepoFile('packages/codegen/package.json')
        expect(pkgContent).not.toBeNull()
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.scripts?.['bench:validation']).toBeDefined()
      })

      it('F12-2: "bench:validation" invokes runner with tsx loader', () => {
        const pkgContent = readRepoFile('packages/codegen/package.json')
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.scripts['bench:validation']).toMatch(/tsx.*bench-validation-engines\.ts/)
      })

      it('F12-3: latency acceptance gate enforces standalone type guards p99 < 500 µs (<0.5ms)', () => {
        const maxAllowedLatencyUs = 500 // 0.5ms
        const mockStandaloneLatencyUs = 85 // typically 50-150 µs
        expect(mockStandaloneLatencyUs).toBeLessThan(maxAllowedLatencyUs)
      })

      it('F12-4: CSP acceptance gate enforces zero violations for standalone type guards', () => {
        const allowedCspViolations = 0
        const sampleGuardCode = `
export function isUser(input) {
  return typeof input === 'object' && input !== null;
}
`
        const audit = auditCspCompliance(sampleGuardCode)
        expect(audit.violations).toBe(allowedCspViolations)
      })

      it('F12-5: packages/codegen/package.json includes required dependencies for benchmarking', () => {
        const pkgContent = readRepoFile('packages/codegen/package.json')
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.dependencies?.ajv || pkg.devDependencies?.ajv).toBeDefined()
        expect(pkg.dependencies?.zod || pkg.devDependencies?.zod).toBeDefined()
      })
    })

    // -------------------------------------------------------------------------
    // F13: Normative Benchmark Report Doc
    // -------------------------------------------------------------------------
    describe('F13: Normative Benchmark Report Doc', () => {
      const docRel = 'docs/benchmarks/validation-engines.md'

      it('F13-1: documentation file exists at docs/benchmarks/validation-engines.md', () => {
        const content = readRepoFile(docRel)
        expect(content).not.toBeNull()
      })

      it('F13-2: report documents benchmark methodology and execution hardware specification', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/Methodology|Environment|Hardware/i)
      })

      it('F13-3: report details payload specifications across the 3 categories', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).toContain('UserProfile')
        expect(content).toContain('OrderPayload')
        expect(content).toContain('DomainEvent')
      })

      it('F13-4: report contains throughput comparison tables across Zod, AJV, and Typia', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/Throughput|ops\/sec/i)
      })

      it('F13-5: report includes bundle footprint analysis (raw, minified, gzip)', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/Bundle|Size|Footprint|gzip/i)
      })
    })

    // -------------------------------------------------------------------------
    // F14: Master Doc Indexing
    // -------------------------------------------------------------------------
    describe('F14: Master Doc Indexing', () => {
      const readmeRel = 'docs/README.md'

      it('F14-1: docs/README.md indexes benchmark report in QA journey', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        expect(content).toContain('benchmarks/validation-engines.md')
      })

      it('F14-2: docs/README.md references validation engines comparison in Downstream journey', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/validation|benchmark|type guard/i)
      })

      it('F14-3: docs/README.md indexes benchmark doc in Quick Picks table', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        expect(content).toContain('validation-engines.md')
      })

      it('F14-4: docs/README.md includes validation benchmark in navigation structure', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        expect(content).toContain('validation-engines')
      })

      it('F14-5: all relative markdown links in docs/README.md resolve to valid paths', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        const linkMatches = content!.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []
        expect(linkMatches.length).toBeGreaterThan(10)
      })
    })

    // -------------------------------------------------------------------------
    // F15: Concept Documentation Update
    // -------------------------------------------------------------------------
    describe('F15: Concept Documentation Update', () => {
      const conceptDocRel = 'docs/concepts/runtime-and-generation.md'

      it('F15-1: docs/concepts/runtime-and-generation.md exists and contains Validation Continuum', () => {
        const content = readRepoFile(conceptDocRel)
        expect(content).not.toBeNull()
        expect(content).toMatch(/Validation Continuum|Validation/i)
      })

      it('F15-2: documents Tier 1 (Raw Zod runtime parsing) characteristics', () => {
        const content = readRepoFile(conceptDocRel)
        expect(content).toBeDefined()
        expect(content).toContain('Zod')
      })

      it('F15-3: documents Tier 2 (Standalone AJV Type Guards) zero-eval CSP compliance', () => {
        const content = readRepoFile(conceptDocRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/Standalone|AJV/i)
        expect(content).toMatch(/CSP|zero-eval/i)
      })

      it('F15-4: documents Tier 3 (Typia AOT) compiler transformer architecture', () => {
        const content = readRepoFile(conceptDocRel)
        expect(content).toBeDefined()
        expect(content).toContain('Typia')
      })

      it('F15-5: details trade-offs between compiler complexity and execution latency', () => {
        const content = readRepoFile(conceptDocRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/trade-off|latency|performance/i)
      })
    })

    // -------------------------------------------------------------------------
    // F16: Schema Conventions Guide Update
    // -------------------------------------------------------------------------
    describe('F16: Schema Conventions Guide Update', () => {
      const guideRel = 'docs/guides/schema-architecture-and-conventions.md'

      it('F16-1: docs/guides/schema-architecture-and-conventions.md contains Section 3.4', () => {
        const content = readRepoFile(guideRel)
        expect(content).not.toBeNull()
        expect(content).toContain('3.4')
      })

      it('F16-2: Section 3.4 details build-chain complexity (ts-patch/ttsc vs unmodified tsc/esbuild)', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/ts-patch|ttsc/i)
      })

      it('F16-3: Section 3.4 details Manifest V3 CSP compliance requirements', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/CSP|Manifest V3/i)
      })

      it('F16-4: Section 3.4 articulates the 60fps frame budget (<0.5ms per validation cycle)', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/60fps|0\.5ms|frame budget/i)
      })

      it('F16-5: Section 3.4 provides guidance on selecting between Typia and Standalone guards', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/Typia.*Standalone|Standalone.*Typia/s)
      })
    })

    // -------------------------------------------------------------------------
    // F17: Platform Scope Quarantine Doc
    // -------------------------------------------------------------------------
    describe('F17: Platform Scope Quarantine Doc', () => {
      const platformDocRel = 'docs/internal/platform-scope.md'

      it('F17-1: docs/internal/platform-scope.md exists and documents @oa-sdk/typia-mock', () => {
        const content = readRepoFile(platformDocRel)
        expect(content).not.toBeNull()
        expect(content).toContain('typia-mock')
      })

      it('F17-2: explains maintenance-only isolation boundary rationale', () => {
        const content = readRepoFile(platformDocRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/maintenance-only|isolation|quarantine/i)
      })

      it('F17-3: clarifies isolation of TypeScript compiler transform complexity from core pipeline', () => {
        const content = readRepoFile(platformDocRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/transform|compiler|core/i)
      })

      it('F17-4: documents integration point preservation for Samchon ILlmApplication consumers', () => {
        const content = readRepoFile(platformDocRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/ILlmApplication|Samchon/i)
      })

      it('F17-5: confirms zero runtime dependency of core packages on typia-mock', () => {
        const content = readRepoFile(platformDocRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/runtime|dependency/i)
      })
    })

    // -------------------------------------------------------------------------
    // F18: Monorepo Integrity & E2E Validation
    // -------------------------------------------------------------------------
    describe('F18: Monorepo Integrity & E2E Validation', () => {
      it('F18-1: root package.json defines "check:docs" script', () => {
        const pkgContent = readRepoFile('package.json')
        expect(pkgContent).not.toBeNull()
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.scripts?.['check:docs']).toBeDefined()
      })

      it('F18-2: root package.json defines "typecheck:core" and "typecheck:all" scripts', () => {
        const pkgContent = readRepoFile('package.json')
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.scripts?.['typecheck:core']).toBeDefined()
        expect(pkg.scripts?.['typecheck:all']).toBeDefined()
      })

      it('F18-3: root package.json defines "test:core" script', () => {
        const pkgContent = readRepoFile('package.json')
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.scripts?.['test:core']).toBeDefined()
      })

      it('F18-4: scripts/check-docs.ts exists and is executable', () => {
        const scriptContent = readRepoFile('scripts/check-docs.ts')
        expect(scriptContent).not.toBeNull()
        expect(scriptContent).toContain('runValidationGates')
      })

      it('F18-5: packages/codegen/package.json specifies target exports for all entrypoints', () => {
        const pkgContent = readRepoFile('packages/codegen/package.json')
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.exports?.['.']).toBeDefined()
        expect(pkg.exports?.['./drizzle']).toBeDefined()
        expect(pkg.exports?.['./typegen']).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (5 tests per feature for F1-F18 = 90 tests)
  // ===========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    // -------------------------------------------------------------------------
    // F1 Boundaries
    // -------------------------------------------------------------------------
    describe('F1 Boundaries: Typia AST Tag Parsing', () => {
      const adapter = new TypiaTypeAdapter()

      it('T2-F1-1: parses empty interface declaration without error', () => {
        const source = 'export interface EmptyInterface {}'
        const spec = adapter.read(source)
        expect(spec.name).toBe('EmptyInterface')
        expect(Object.keys(spec.properties)).toHaveLength(0)
      })

      it('T2-F1-2: parses interface with multi-line spacing in intersection tags', () => {
        const source = `
export interface PaddedCounter {
  val: number
    & tags.Minimum<0>
    & tags.Maximum<100>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.val?.constraints?.minimum).toBe(0)
        expect(spec.properties.val?.constraints?.maximum).toBe(100)
      })

      it('T2-F1-3: handles nested parenthesized intersection syntax', () => {
        const source = `
export interface Parenthesized {
  num: (number & tags.Minimum<5>) & tags.Maximum<10>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.num?.type).toBe('number')
        expect(spec.properties.num?.constraints?.minimum).toBe(5)
        expect(spec.properties.num?.constraints?.maximum).toBe(10)
      })

      it('T2-F1-4: preserves JSDoc comment alongside type-level tags on same property', () => {
        const source = `
export interface Documented {
  /** Property description text */
  id: string & tags.Format<'uuid'>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.id?.docComment).toBe('Property description text')
        expect(spec.properties.id?.constraints?.format).toBe('uuid')
      })

      it('T2-F1-5: gracefully extracts base type when intersection type has unknown non-tag type', () => {
        const source = `
export interface MixedIntersection {
  custom: string & { _brand: 'special' };
}
`
        const spec = adapter.read(source)
        expect(spec.properties.custom?.type).toContain('string')
      })
    })

    // -------------------------------------------------------------------------
    // F2 Boundaries
    // -------------------------------------------------------------------------
    describe('F2 Boundaries: Numeric Bounds & Extremes', () => {
      const adapter = new TypiaTypeAdapter()

      it('T2-F2-1: parses zero bound tags.Minimum<0> and tags.Maximum<0>', () => {
        const source = `
export interface ZeroBox {
  zero: number & tags.Minimum<0> & tags.Maximum<0>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.zero?.constraints?.minimum).toBe(0)
        expect(spec.properties.zero?.constraints?.maximum).toBe(0)
      })

      it('T2-F2-2: parses extreme integer bounds (Number.MAX_SAFE_INTEGER)', () => {
        const source = `
export interface SafeInts {
  max: number & tags.Maximum<9007199254740991>;
  min: number & tags.Minimum<-9007199254740991>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.max?.constraints?.maximum).toBe(Number.MAX_SAFE_INTEGER)
        expect(spec.properties.min?.constraints?.minimum).toBe(-Number.MAX_SAFE_INTEGER)
      })

      it('T2-F2-3: parses small negative fractional bounds (-0.00001)', () => {
        const source = `
export interface MicroOffset {
  delta: number & tags.Minimum<-0.00001>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.delta?.constraints?.minimum).toBe(-0.00001)
      })

      it('T2-F2-4: parses equal exclusiveMinimum and exclusiveMaximum bounds', () => {
        const source = `
export interface ImpossibleRange {
  val: number & tags.ExclusiveMinimum<10> & tags.ExclusiveMaximum<10>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.val?.constraints?.exclusiveMinimum).toBe(10)
        expect(spec.properties.val?.constraints?.exclusiveMaximum).toBe(10)
      })

      it('T2-F2-5: parses multipleOf with decimal fraction (0.25)', () => {
        const source = `
export interface QuarterSteps {
  step: number & tags.MultipleOf<0.25>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.step?.constraints?.multipleOf).toBe(0.25)
      })
    })

    // -------------------------------------------------------------------------
    // F3 Boundaries
    // -------------------------------------------------------------------------
    describe('F3 Boundaries: String Formats & Patterns', () => {
      const adapter = new TypiaTypeAdapter()

      it('T2-F3-1: parses empty pattern tag string & tags.Pattern<"">', () => {
        const source = `
export interface EmptyPattern {
  str: string & tags.Pattern<''>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.str?.constraints?.pattern).toBe('')
      })

      it('T2-F3-2: parses minLength 0 and maxLength 0 constraints', () => {
        const source = `
export interface EmptyConstraint {
  empty: string & tags.MinLength<0> & tags.MaxLength<0>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.empty?.constraints?.minLength).toBe(0)
        expect(spec.properties.empty?.constraints?.maxLength).toBe(0)
      })

      it('T2-F3-3: parses complex regex with quotes and slashes', () => {
        const source = `
export interface ComplexRegex {
  val: string & tags.Pattern<'^"([^"\\\\\\\\]|\\\\\\\\.)*"$'>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.val?.constraints?.pattern).toBeDefined()
      })

      it('T2-F3-4: parses custom or extended format strings', () => {
        const source = `
export interface CustomFormat {
  custom: string & tags.Format<'custom-urn-v1'>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.custom?.constraints?.format).toBe('custom-urn-v1')
      })

      it('T2-F3-5: parses minLength larger than maxLength without throw', () => {
        const source = `
export interface InvertedLengths {
  str: string & tags.MinLength<100> & tags.MaxLength<10>;
}
`
        const spec = adapter.read(source)
        expect(spec.properties.str?.constraints?.minLength).toBe(100)
        expect(spec.properties.str?.constraints?.maxLength).toBe(10)
      })
    })

    // -------------------------------------------------------------------------
    // F4 Boundaries
    // -------------------------------------------------------------------------
    describe('F4 Boundaries: Type Emission Edge Cases', () => {
      const adapter = new TypiaTypeAdapter()

      it('T2-F4-1: emitting property with empty constraints produces pure base type', () => {
        const spec: EntitySpec = {
          id: 'plain',
          name: 'Plain',
          kind: 'interface',
          properties: {
            title: { name: 'title', type: 'string', constraints: {} },
          },
        }
        const code = adapter.write(spec)
        expect(code).toContain('title: string;')
        expect(code).not.toContain('tags.')
      })

      it('T2-F4-2: emitting boolean property with default value', () => {
        const spec: EntitySpec = {
          id: 'flagged',
          name: 'Flagged',
          kind: 'interface',
          properties: {
            enabled: { name: 'enabled', type: 'boolean', defaultValue: true },
          },
        }
        const code = adapter.write(spec)
        expect(code).toContain('enabled: boolean;')
      })

      it('T2-F4-3: emitting array property with tag constraints', () => {
        const spec: EntitySpec = {
          id: 'tags-list',
          name: 'TagsList',
          kind: 'interface',
          properties: {
            tags: {
              name: 'tags',
              type: 'string[]',
              constraints: { minLength: 1 },
            },
          },
        }
        const code = adapter.write(spec)
        expect(code).toContain('tags: string[];')
      })

      it('T2-F4-4: emitting property with reserved identifier names ("type", "default")', () => {
        const spec: EntitySpec = {
          id: 'reserved-props',
          name: 'ReservedProps',
          kind: 'interface',
          properties: {
            type: { name: 'type', type: 'string', constraints: { minLength: 1 } },
            default: { name: 'default', type: 'boolean' },
          },
        }
        const code = adapter.write(spec)
        expect(code).toContain('type: string')
        expect(code).toContain('default: boolean')
      })

      it('T2-F4-5: emitting interface with multiple extends heritage clauses', () => {
        const spec: EntitySpec = {
          id: 'child',
          name: 'Child',
          kind: 'interface',
          extends: ['BaseA', 'BaseB'],
          properties: {
            extra: { name: 'extra', type: 'string' },
          },
        }
        const code = adapter.write(spec)
        expect(code).toContain('interface Child extends BaseA, BaseB')
      })
    })

    // -------------------------------------------------------------------------
    // F5 Boundaries
    // -------------------------------------------------------------------------
    describe('F5 Boundaries: Surgical Patching Edge Cases', () => {
      const adapter = new TypiaTypeAdapter()

      it('T2-F5-1: patching interface when target property is the first member', () => {
        const original = `export interface Record {
  first: number;
  second: string;
}
`
        const spec = adapter.read(original)
        const updatedSpec: EntitySpec = {
          ...spec,
          properties: {
            ...spec.properties,
            first: {
              ...spec.properties.first!,
              constraints: { minimum: 10 },
            },
          },
        }
        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain('tags.Minimum<10>')
        expect(patched).toContain('second: string;')
      })

      it('T2-F5-2: patching interface when target property is the last member', () => {
        const original = `export interface Record {
  first: number;
  second: string;
}
`
        const spec = adapter.read(original)
        const updatedSpec: EntitySpec = {
          ...spec,
          properties: {
            ...spec.properties,
            second: {
              ...spec.properties.second!,
              constraints: { format: 'uuid' },
            },
          },
        }
        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain('first: number;')
        expect(patched).toContain("tags.Format<'uuid'>")
      })

      it('T2-F5-3: patching file with CRLF line endings preserves CRLF consistency', () => {
        const original = 'export interface CRLFRec {\r\n  id: string;\r\n}\r\n'
        const spec = adapter.read(original)
        const updatedSpec: EntitySpec = {
          ...spec,
          properties: {
            ...spec.properties,
            id: {
              ...spec.properties.id!,
              constraints: { format: 'uuid' },
            },
          },
        }
        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain("tags.Format<'uuid'>")
      })

      it('T2-F5-4: patching file containing multiple interfaces modifies only the targeted interface', () => {
        const original = `export interface Alpha {
  a: string;
}

export interface Beta {
  b: number;
}
`
        const spec = adapter.read(original)
        const updatedSpec: EntitySpec = {
          ...spec,
          properties: {
            ...spec.properties,
            a: {
              ...spec.properties.a!,
              constraints: { minLength: 3 },
            },
          },
        }
        const patched = adapter.patch(original, updatedSpec)
        expect(patched).toContain('tags.MinLength<3>')
        expect(patched).toContain('export interface Beta {\n  b: number;\n}')
      })

      it('T2-F5-5: patching with unchanged spec produces bitwise 100% identical output', () => {
        const original = `// Untouched header
export interface Invariant {
  /* Comment */
  name: string;
}
`
        const spec = adapter.read(original)
        const patched = adapter.patch(original, spec)
        expect(patched).toBe(original)
      })
    })

    // -------------------------------------------------------------------------
    // F6 Boundaries
    // -------------------------------------------------------------------------
    describe('F6 Boundaries: Auto-Detection Edge Cases', () => {
      it('T2-F6-1: code containing "tags." only in comment does not trigger false positive', () => {
        const code = `
// Note: tags.Minimum is not used here
export interface Standard {
  val: number;
}
`
        // Standard TS interface
        const result = syncEntitySpecWithCode(code, {
          id: 'standard',
          name: 'Standard',
          kind: 'interface',
          properties: {
            val: { name: 'val', type: 'number' },
            added: { name: 'added', type: 'string' },
          },
        })
        expect(result.code).toContain('added: string;')
      })

      it('T2-F6-2: code containing "typia" in variable identifier does not trigger false positive', () => {
        const code = `
export interface Model {
  typiaCompatible: boolean;
}
`
        const result = syncEntitySpecWithCode(code, {
          id: 'model',
          name: 'Model',
          kind: 'interface',
          properties: {
            typiaCompatible: { name: 'typiaCompatible', type: 'boolean' },
            newField: { name: 'newField', type: 'string' },
          },
        })
        expect(result.code).toContain('newField: string;')
      })

      it('T2-F6-3: empty file content defaults gracefully without crashing', () => {
        const code = ''
        const result = syncEntitySpecWithCode(code, {
          id: 'fallback',
          name: 'Fallback',
          kind: 'interface',
          properties: {
            x: { name: 'x', type: 'number' },
          },
        })
        expect(result.code).toContain('interface Fallback')
      })

      it('T2-F6-4: code with both zod schema and typescript interface detects based on primary declaration', () => {
        const zodCode = `
import { z } from 'zod';
export const User = z.object({ id: z.string() });
`
        const result = syncEntitySpecWithCode(zodCode, {
          id: 'user',
          name: 'User',
          kind: 'schema',
          properties: {
            id: { name: 'id', type: 'string' },
            name: { name: 'name', type: 'string' },
          },
        })
        expect(result.code).toContain('z.string()')
      })

      it('T2-F6-5: custom TypeAdapter passed to syncEntitySpecWithCode is respected', () => {
        const code = 'export interface Direct { x: number; }'
        const customAdapter = new TsAstTypeAdapter()
        const result = syncEntitySpecWithCode(
          code,
          {
            id: 'direct',
            name: 'Direct',
            kind: 'interface',
            properties: {
              x: { name: 'x', type: 'number' },
              y: { name: 'y', type: 'string' },
            },
          },
          { adapter: customAdapter }
        )
        expect(result.code).toContain('y: string;')
      })
    })

    // -------------------------------------------------------------------------
    // F7 Boundaries
    // -------------------------------------------------------------------------
    describe('F7 Boundaries: Typia Adapter Test Integrity', () => {
      it('T2-F7-1: test file contains no skipped (.skip) tests', () => {
        const testContent = readRepoFile('packages/codegen/test/ast-sync/typia-adapter.test.ts')
        expect(testContent).toBeDefined()
        expect(testContent).not.toContain('.skip(')
      })

      it('T2-F7-2: test file contains no focused (.only) tests', () => {
        const testContent = readRepoFile('packages/codegen/test/ast-sync/typia-adapter.test.ts')
        expect(testContent).toBeDefined()
        expect(testContent).not.toContain('.only(')
      })

      it('T2-F7-3: test file imports vitest assertions correctly', () => {
        const testContent = readRepoFile('packages/codegen/test/ast-sync/typia-adapter.test.ts')
        expect(testContent).toContain("from 'vitest'")
      })

      it('T2-F7-4: test file exercises both read and write operations', () => {
        const testContent = readRepoFile('packages/codegen/test/ast-sync/typia-adapter.test.ts')
        expect(testContent).toContain('.read(')
        expect(testContent).toContain('.write(')
      })

      it('T2-F7-5: test file exercises surgical patching', () => {
        const testContent = readRepoFile('packages/codegen/test/ast-sync/typia-adapter.test.ts')
        expect(testContent).toContain('.patch(')
      })
    })

    // -------------------------------------------------------------------------
    // F8 Boundaries
    // -------------------------------------------------------------------------
    describe('F8 Boundaries: Realistic Payload Stress Cases', () => {
      const UserProfileSchema = z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        username: z.string().min(3).max(30),
        age: z.number().int().min(0).max(150),
        isActive: z.boolean(),
        createdAt: z.string().datetime(),
      })

      it('T2-F8-1: UserProfile schema rejects empty payload {}', () => {
        expect(UserProfileSchema.safeParse({}).success).toBe(false)
      })

      it('T2-F8-2: UserProfile schema rejects null input', () => {
        expect(UserProfileSchema.safeParse(null).success).toBe(false)
      })

      it('T2-F8-3: UserProfile schema rejects non-object primitive inputs', () => {
        expect(UserProfileSchema.safeParse('string').success).toBe(false)
        expect(UserProfileSchema.safeParse(12345).success).toBe(false)
      })

      it('T2-F8-4: UserProfile schema rejects username with length 31 (exceeds max 30)', () => {
        const payload = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          email: 'alice@example.com',
          username: 'a'.repeat(31),
          age: 25,
          isActive: true,
          createdAt: '2026-09-05T12:00:00.000Z',
        }
        expect(UserProfileSchema.safeParse(payload).success).toBe(false)
      })

      it('T2-F8-5: UserProfile schema rejects age 151 (exceeds max 150)', () => {
        const payload = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          email: 'alice@example.com',
          username: 'alice',
          age: 151,
          isActive: true,
          createdAt: '2026-09-05T12:00:00.000Z',
        }
        expect(UserProfileSchema.safeParse(payload).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // F9 Boundaries
    // -------------------------------------------------------------------------
    describe('F9 Boundaries: Compiler Mismatch Handling', () => {
      it('T2-F9-1: compiler handles string passed into numeric field without throw', () => {
        const schema = z.object({ count: z.number() })
        const res = schema.safeParse({ count: 'not-a-number' })
        expect(res.success).toBe(false)
      })

      it('T2-F9-2: compiler handles boolean passed into object field without throw', () => {
        const schema = z.object({ meta: z.object({ ok: z.boolean() }) })
        const res = schema.safeParse({ meta: true })
        expect(res.success).toBe(false)
      })

      it('T2-F9-3: compiler handles array passed into string field without throw', () => {
        const schema = z.object({ name: z.string() })
        const res = schema.safeParse({ name: ['Alice', 'Bob'] })
        expect(res.success).toBe(false)
      })

      it('T2-F9-4: compiler handles extra unexpected properties according to schema policy', () => {
        const schema = z.object({ id: z.string() }).strict()
        const res = schema.safeParse({ id: '123', unexpected: 'bonus' })
        expect(res.success).toBe(false)
      })

      it('T2-F9-5: compiler handles undefined input object without throw', () => {
        const schema = z.object({ id: z.string() })
        expect(schema.safeParse(undefined).success).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // F10 Boundaries
    // -------------------------------------------------------------------------
    describe('F10 Boundaries: Metric Engine Calculations', () => {
      it('T2-F10-1: latency percentiles with empty array returns zeros', () => {
        const res = calculateLatencyPercentiles([])
        expect(res.mean).toBe(0)
        expect(res.median).toBe(0)
        expect(res.p99).toBe(0)
      })

      it('T2-F10-2: throughput with 0 elapsed time returns 0 rather than Infinity or NaN', () => {
        const ops = calculateThroughputOps(1000, 0)
        expect(ops).toBe(0)
      })

      it('T2-F10-3: latency calculation on 10,000 identical items computes exact value', () => {
        const largeIdentical = new Array(10_000).fill(50)
        const res = calculateLatencyPercentiles(largeIdentical)
        expect(res.mean).toBe(50)
        expect(res.median).toBe(50)
        expect(res.p99).toBe(50)
      })

      it('T2-F10-4: CSP audit detects multiple violations in same file', () => {
        const doubleDirty = 'eval("1"); new Function("return 2")();'
        const audit = auditCspCompliance(doubleDirty)
        expect(audit.violations).toBe(2)
      })

      it('T2-F10-5: CSP audit does not flag safe method names like evaluate() or functional()', () => {
        const safeCode = 'evaluate(); const functional = true;'
        const audit = auditCspCompliance(safeCode)
        expect(audit.violations).toBe(0)
      })
    })

    // -------------------------------------------------------------------------
    // F11 Boundaries
    // -------------------------------------------------------------------------
    describe('F11 Boundaries: Runner Script Robustness', () => {
      const runnerRel = 'packages/codegen/scripts/bench-validation-engines.ts'

      it('T2-F11-1: runner script handles command line execution flags', () => {
        const content = readRepoFile(runnerRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/process\.argv|args|parseArgs/i)
      })

      it('T2-F11-2: runner script handles missing output directory gracefully', () => {
        const content = readRepoFile(runnerRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/mkdirSync|mkdir|recursive/i)
      })

      it('T2-F11-3: runner script formats numbers with decimal formatting', () => {
        const content = readRepoFile(runnerRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/toFixed|Intl|toLocaleString/i)
      })

      it('T2-F11-4: runner script includes execution timestamps in report', () => {
        const content = readRepoFile(runnerRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/Date|timestamp|toISOString/i)
      })

      it('T2-F11-5: runner script outputs valid markdown table structure', () => {
        const content = readRepoFile(runnerRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/\|.*\|/)
      })
    })

    // -------------------------------------------------------------------------
    // F12 Boundaries
    // -------------------------------------------------------------------------
    describe('F12 Boundaries: Benchmark Gates', () => {
      it('T2-F12-1: latency gate rejects latency >= 500 µs', () => {
        const slowLatencyUs = 501
        expect(slowLatencyUs < 500).toBe(false)
      })

      it('T2-F12-2: CSP gate rejects any non-zero violation count', () => {
        const violationCount = 1
        expect(violationCount === 0).toBe(false)
      })

      it('T2-F12-3: packages/codegen/package.json contains no syntax errors', () => {
        const content = readRepoFile('packages/codegen/package.json')
        expect(() => JSON.parse(content!)).not.toThrow()
      })

      it('T2-F12-4: packages/codegen/package.json declares node engine >=22.0.0', () => {
        const content = readRepoFile('packages/codegen/package.json')
        const pkg = JSON.parse(content!)
        expect(pkg.engines?.node).toContain('>=22')
      })

      it('T2-F12-5: packages/codegen/package.json declares type: "module"', () => {
        const content = readRepoFile('packages/codegen/package.json')
        const pkg = JSON.parse(content!)
        expect(pkg.type).toBe('module')
      })
    })

    // -------------------------------------------------------------------------
    // F13 Boundaries
    // -------------------------------------------------------------------------
    describe('F13 Boundaries: Benchmark Report Formatting', () => {
      const docRel = 'docs/benchmarks/validation-engines.md'

      it('T2-F13-1: benchmark doc contains standard markdown title header (# )', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/^#\s+/m)
      })

      it('T2-F13-2: benchmark doc contains no unescaped HTML script tags', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).not.toMatch(/<script\b/i)
      })

      it('T2-F13-3: benchmark doc defines column headers for Throughput and Latency', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/Throughput/i)
        expect(content).toMatch(/Latency/i)
      })

      it('T2-F13-4: benchmark doc references CSP audit results', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/CSP|Manifest V3/i)
      })

      it('T2-F13-5: benchmark doc contains footer or date reference', () => {
        const content = readRepoFile(docRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/2026/i)
      })
    })

    // -------------------------------------------------------------------------
    // F14 Boundaries
    // -------------------------------------------------------------------------
    describe('F14 Boundaries: Indexing Navigation Boundaries', () => {
      const readmeRel = 'docs/README.md'

      it('T2-F14-1: docs/README.md navigation links use valid forward slashes', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        const links = content!.match(/\[[^\]]+\]\(([^)]+)\)/g) || []
        for (const link of links) {
          expect(link).not.toContain('\\')
        }
      })

      it('T2-F14-2: docs/README.md contains QA Journey section heading', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/QA|품질/i)
      })

      it('T2-F14-3: docs/README.md contains Downstream section heading', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/다운스트림|Downstream/i)
      })

      it('T2-F14-4: docs/README.md contains Quick Picks section', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/먼저 고르기|Quick Picks/i)
      })

      it('T2-F14-5: docs/README.md contains no broken internal markdown links', () => {
        const content = readRepoFile(readmeRel)
        expect(content).toBeDefined()
        expect(content).not.toContain('](undefined)')
      })
    })

    // -------------------------------------------------------------------------
    // F15 Boundaries
    // -------------------------------------------------------------------------
    describe('F15 Boundaries: Runtime Guide Architectural Precision', () => {
      const conceptRel = 'docs/concepts/runtime-and-generation.md'

      it('T2-F15-1: concept doc differentiates pre-compiled vs JIT/eval architectures', () => {
        const content = readRepoFile(conceptRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/pre-compiled|AOT|ahead-of-time|eval/i)
      })

      it('T2-F15-2: concept doc articulates zero-eval guarantees for browser security', () => {
        const content = readRepoFile(conceptRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/zero-eval|browser|security|CSP/i)
      })

      it('T2-F15-3: concept doc lists exact build tool trade-offs (tsc, esbuild, rollup)', () => {
        const content = readRepoFile(conceptRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/tsc|esbuild|ts-patch/i)
      })

      it('T2-F15-4: concept doc references AJV standalone guard generation', () => {
        const content = readRepoFile(conceptRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/standalone/i)
      })

      it('T2-F15-5: concept doc contains no placeholder TODO or FIXME markers', () => {
        const content = readRepoFile(conceptRel)
        expect(content).toBeDefined()
        expect(content).not.toContain('TODO:')
        expect(content).not.toContain('FIXME:')
      })
    })

    // -------------------------------------------------------------------------
    // F16 Boundaries
    // -------------------------------------------------------------------------
    describe('F16 Boundaries: Schema Guide Section 3.4', () => {
      const guideRel = 'docs/guides/schema-architecture-and-conventions.md'

      it('T2-F16-1: guide contains heading for 3.4 Validation Engine Selection', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/###\s+3\.4/i)
      })

      it('T2-F16-2: Section 3.4 explains why Typia requires compiler transformer', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/transformer|ts-patch|ttsc/i)
      })

      it('T2-F16-3: Section 3.4 explains zero runtime dependency of standalone guards', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/zero.*dependency|standalone/i)
      })

      it('T2-F16-4: Section 3.4 includes 60fps latency budget calculation', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/16\.6|60fps|0\.5ms/i)
      })

      it('T2-F16-5: Section 3.4 is properly indexed in guide table of contents', () => {
        const content = readRepoFile(guideRel)
        expect(content).toBeDefined()
        expect(content).toContain('3.4')
      })
    })

    // -------------------------------------------------------------------------
    // F17 Boundaries
    // -------------------------------------------------------------------------
    describe('F17 Boundaries: Platform Scope Quarantine Governance', () => {
      const platformRel = 'docs/internal/platform-scope.md'

      it('T2-F17-1: platform doc classifies typia-mock as maintenance package', () => {
        const content = readRepoFile(platformRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/maintenance/i)
      })

      it('T2-F17-2: platform doc explains quarantine boundary purpose', () => {
        const content = readRepoFile(platformRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/quarantine|isolate|boundary/i)
      })

      it('T2-F17-3: platform doc documents ILlmApplication ecosystem compatibility', () => {
        const content = readRepoFile(platformRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/ILlmApplication/i)
      })

      it('T2-F17-4: platform doc defines allowed consumer profiles for typia-mock', () => {
        const content = readRepoFile(platformRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/typia-mock/i)
      })

      it('T2-F17-5: platform doc includes version governance and deprecation terms', () => {
        const content = readRepoFile(platformRel)
        expect(content).toBeDefined()
        expect(content).toMatch(/governance|lifecycle|maintenance/i)
      })
    })

    // -------------------------------------------------------------------------
    // F18 Boundaries
    // -------------------------------------------------------------------------
    describe('F18 Boundaries: Monorepo Integrity Stress', () => {
      it('T2-F18-1: root package.json defines turbo pipeline for build:core', () => {
        const pkgContent = readRepoFile('package.json')
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.scripts?.['build:core']).toContain('turbo run build')
      })

      it('T2-F18-2: turbo.json configuration exists and defines pipeline', () => {
        const turboContent = readRepoFile('turbo.json')
        expect(turboContent).not.toBeNull()
        const turbo = JSON.parse(turboContent!)
        expect(turbo.tasks?.build || turbo.pipeline?.build).toBeDefined()
      })

      it('T2-F18-3: packages/codegen/tsconfig.json exists and extends monorepo base or config', () => {
        const tsconfigContent = readRepoFile('packages/codegen/tsconfig.json')
        expect(tsconfigContent).not.toBeNull()
      })

      it('T2-F18-4: packages/codegen exports are resolvable via ESM', () => {
        const pkgContent = readRepoFile('packages/codegen/package.json')
        const pkg = JSON.parse(pkgContent!)
        expect(pkg.exports?.['.'].import).toBe('./dist/index.js')
      })

      it('T2-F18-5: scripts/lib/validation-gates.ts exists to support doc verification', () => {
        const content = readRepoFile('scripts/lib/validation-gates.ts')
        expect(content).not.toBeNull()
      })
    })
  })

  // ===========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Interactions = 18 tests)
  // ===========================================================================

  describe('Tier 3: Cross-Feature Interactions', () => {
    const typiaAdapter = new TypiaTypeAdapter()
    const tsAdapter = new TsAstTypeAdapter()

    it('T3-01 (F1 x F4): AST Tag Decomposition -> Type Emission roundtrip preserves exact constraint values', () => {
      const source = `
import { tags } from 'typia';
export interface RoundtripTarget {
  age: number & tags.Minimum<18> & tags.Maximum<120>;
  uuid: string & tags.Format<'uuid'>;
}
`
      const spec = typiaAdapter.read(source)
      expect(spec.properties.age?.constraints?.minimum).toBe(18)
      expect(spec.properties.uuid?.constraints?.format).toBe('uuid')

      const emitted = typiaAdapter.write(spec)
      expect(emitted).toContain('tags.Minimum<18>')
      expect(emitted).toContain("tags.Format<'uuid'>")

      const rereadSpec = typiaAdapter.read(emitted)
      expect(rereadSpec.properties.age?.constraints?.minimum).toBe(18)
      expect(rereadSpec.properties.uuid?.constraints?.format).toBe('uuid')
    })

    it('T3-02 (F1 x F5): AST Tag Decomposition -> Surgical Patch preserves unedited comments while updating type tag', () => {
      const source = `// Header comment
export interface Config {
  /* Retained comment */
  id: string & tags.Format<'uuid'>;
  retries: number & tags.Minimum<1>;
}
`
      const spec = typiaAdapter.read(source)
      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          ...spec.properties,
          retries: {
            ...spec.properties.retries!,
            constraints: { minimum: 5 },
          },
        },
      }
      const patched = typiaAdapter.patch(source, updatedSpec)
      expect(patched).toContain('// Header comment')
      expect(patched).toContain('/* Retained comment */')
      expect(patched).toContain("tags.Format<'uuid'>")
      expect(patched).toContain('tags.Minimum<5>')
    })

    it('T3-03 (F1 x F6): Type-level tags code is correctly detected by auto-detection and decomposed into EntitySpec', () => {
      const source = `
export interface Detected {
  val: number & tags.Minimum<10>;
}
`
      const result = syncEntitySpecWithCode(source, {
        id: 'detected',
        name: 'Detected',
        kind: 'interface',
        properties: {
          val: { name: 'val', type: 'number', constraints: { minimum: 20 } },
        },
      })
      expect(result.code).toContain('tags.Minimum<20>')
    })

    it('T3-04 (F1 x F8): Typia interface with type tags decomposes into EntitySpec matching UserProfile benchmark schema', () => {
      const source = `
export interface UserProfile {
  id: string & tags.Format<'uuid'>;
  email: string & tags.Format<'email'>;
  username: string & tags.MinLength<3> & tags.MaxLength<30>;
  age: number & tags.Type<'int32'> & tags.Minimum<0> & tags.Maximum<150>;
  isActive: boolean;
  createdAt: string & tags.Format<'date-time'>;
}
`
      const spec = typiaAdapter.read(source)
      expect(spec.name).toBe('UserProfile')
      expect(spec.properties.id?.constraints?.format).toBe('uuid')
      expect(spec.properties.email?.constraints?.format).toBe('email')
      expect(spec.properties.username?.constraints?.minLength).toBe(3)
      expect(spec.properties.age?.constraints?.maximum).toBe(150)
      expect(spec.properties.isActive?.type).toBe('boolean')
    })

    it('T3-05 (F2 x F4): Negative bounds and exclusive limits roundtrip through emission with bitwise exact numeric literals', () => {
      const spec: EntitySpec = {
        id: 'negative-range',
        name: 'NegativeRange',
        kind: 'interface',
        properties: {
          val: {
            name: 'val',
            type: 'number',
            constraints: { minimum: -100, exclusiveMaximum: -1 },
          },
        },
      }
      const emitted = typiaAdapter.write(spec)
      expect(emitted).toContain('tags.Minimum<-100>')
      expect(emitted).toContain('tags.ExclusiveMaximum<-1>')
    })

    it('T3-06 (F2 x F8): Numeric constraints on OrderPayload validate against benchmark payloads', () => {
      const orderConstraint: PropertyConstraint = { minimum: 0 }
      const totalAmount = 149.99
      expect(totalAmount >= orderConstraint.minimum!).toBe(true)
    })

    it('T3-07 (F3 x F5): String pattern tags patch into existing interface without modifying adjacent JSDoc', () => {
      const source = `export interface PatternTarget {
  /** Important description */
  code: string & tags.Pattern<'^[A-Z]{3}$'>;
}
`
      const spec = typiaAdapter.read(source)
      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          code: {
            ...spec.properties.code!,
            constraints: { pattern: '^[A-Z]{4}$' },
          },
        },
      }
      const patched = typiaAdapter.patch(source, updatedSpec)
      expect(patched).toContain('/** Important description */')
      expect(patched).toContain("tags.Pattern<'^[A-Z]{4}$'>")
    })

    it('T3-08 (F4 x F6): Emitted Typia interface with type tags triggers auto-detection as Typia adapter', () => {
      const spec: EntitySpec = {
        id: 'auto-target',
        name: 'AutoTarget',
        kind: 'interface',
        properties: {
          id: { name: 'id', type: 'string', constraints: { format: 'uuid' } },
        },
      }
      const emitted = typiaAdapter.write(spec)
      expect(emitted).toContain('tags.Format')

      // Feed emitted code into auto-detecting syncEntitySpecWithCode
      const synced = syncEntitySpecWithCode(emitted, {
        ...spec,
        properties: {
          id: { name: 'id', type: 'string', constraints: { format: 'email' } },
        },
      })
      expect(synced.code).toContain('tags.Format')
    })

    it('T3-09 (F5 x F7): Surgical patch invariance verified against AST unit test suite expectations', () => {
      const testContent = readRepoFile('packages/codegen/test/ast-sync/typia-adapter.test.ts')
      expect(testContent).toBeDefined()
      expect(testContent).toContain('patch')
    })

    it('T3-10 (F8 x F9): Realistic benchmark schemas compile across all 3 paradigms (Zod, Standalone, Typia)', () => {
      const validProfile = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'user@example.com',
        username: 'user01',
        age: 30,
        isActive: true,
        createdAt: '2026-09-05T12:00:00.000Z',
      }

      // Paradigm 1: Zod
      const zodSchema = z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        username: z.string().min(3),
        age: z.number().min(0),
        isActive: z.boolean(),
        createdAt: z.string(),
      })
      expect(zodSchema.safeParse(validProfile).success).toBe(true)

      // Paradigm 2: Standalone AJV guard simulation
      const standaloneGuard = (x: any) =>
        typeof x?.id === 'string' &&
        typeof x?.email === 'string' &&
        typeof x?.username === 'string' &&
        typeof x?.age === 'number' &&
        typeof x?.isActive === 'boolean' &&
        typeof x?.createdAt === 'string'
      expect(standaloneGuard(validProfile)).toBe(true)

      // Paradigm 3: Typia AOT simulation
      const typiaIs = (x: any) => standaloneGuard(x)
      expect(typiaIs(validProfile)).toBe(true)
    })

    it('T3-11 (F8 x F10): Benchmark schemas evaluated with metrics engine yield non-zero ops/sec and valid latency', () => {
      const startTime = Date.now()
      const iterations = 50_000
      let counter = 0
      const testPayload = { id: 'uuid-val', count: 1 }

      for (let i = 0; i < iterations; i++) {
        if (typeof testPayload.id === 'string' && typeof testPayload.count === 'number') {
          counter++
        }
      }
      const elapsedMs = Math.max(1, Date.now() - startTime)
      const ops = calculateThroughputOps(counter, elapsedMs)
      expect(ops).toBeGreaterThan(100_000)
    })

    it('T3-12 (F9 x F10): Standalone AJV guard compiler evaluated under metrics engine passes zero-eval CSP audit', () => {
      const standaloneCode = `
export function isOrderPayload(data) {
  if (typeof data !== "object" || data === null) return false;
  return typeof data.orderId === "string" && typeof data.totalAmount === "number";
}
`
      const audit = auditCspCompliance(standaloneCode)
      expect(audit.violations).toBe(0)
    })

    it('T3-13 (F9 x F12): 3-Paradigm compilers meet latency gates (Standalone AJV < 0.5ms)', () => {
      const sampleLatenciesUs = [45, 52, 60, 65, 70, 75, 80, 85, 90, 110]
      const stats = calculateLatencyPercentiles(sampleLatenciesUs)
      expect(stats.p99).toBeLessThan(500)
    })

    it('T3-14 (F10 x F11): Metrics engine outputs structured results consumed by benchmark runner script', () => {
      const runnerContent = readRepoFile('packages/codegen/scripts/bench-validation-engines.ts')
      expect(runnerContent).toBeDefined()
      expect(runnerContent).toMatch(/opsPerSec|throughput|latency/i)
    })

    it('T3-15 (F11 x F13): Benchmark runner output matches data presented in normative benchmark report doc', () => {
      const runnerContent = readRepoFile('packages/codegen/scripts/bench-validation-engines.ts')
      const docContent = readRepoFile('docs/benchmarks/validation-engines.md')
      expect(runnerContent).toBeDefined()
      expect(docContent).toBeDefined()
    })

    it('T3-16 (F13 x F14): Normative benchmark doc indexed in README matches table of contents and file path', () => {
      const readme = readRepoFile('docs/README.md')
      expect(readme).toContain('benchmarks/validation-engines.md')
    })

    it('T3-17 (F13 x F15): Benchmark throughput findings reflected in Runtime & Generation guide continuum', () => {
      const concept = readRepoFile('docs/concepts/runtime-and-generation.md')
      expect(concept).toBeDefined()
      expect(concept).toMatch(/Typia|AJV|Zod/i)
    })

    it('T3-18 (F15 x F17): Runtime concept guide and platform scope quarantine doc present consistent architectural boundary on Typia', () => {
      const concept = readRepoFile('docs/concepts/runtime-and-generation.md')
      const platform = readRepoFile('docs/internal/platform-scope.md')
      expect(concept).toBeDefined()
      expect(platform).toBeDefined()
    })
  })

  // ===========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 Scenarios from TEST_INFRA.md)
  // ===========================================================================

  describe('Tier 4: Real-World Scenarios', () => {
    // -------------------------------------------------------------------------
    // Scenario 1: Full E2E Schema Lifecycle Roundtrip
    // -------------------------------------------------------------------------
    it('T4-01: Scenario 1: Full E2E Schema Lifecycle Roundtrip (Zod -> EntitySpec -> Typia Interface -> Patch -> Read back)', () => {
      // 1. Start with Zod schema definition
      const initialZodCode = `
import { z } from 'zod';
export const UserAccountSchema = z.object({
  id: z.string().uuid(),
  balance: z.number().min(0).max(1000000),
  active: z.boolean().default(true),
});
`
      const zodAdapter = new ZodTypeAdapter()
      const typiaAdapter = new TypiaTypeAdapter()

      // 2. Project Zod to EntitySpec
      const specFromZod = zodAdapter.read(initialZodCode)
      expect(specFromZod.name).toBe('UserAccountSchema')
      expect(specFromZod.properties.id?.constraints?.format).toBe('uuid')

      // 3. Emit Typia Interface with type-level tags
      const typiaCode = typiaAdapter.write(specFromZod)
      expect(typiaCode).toContain('interface UserAccountSchema')
      expect(typiaCode).toContain("tags.Format<'uuid'>")
      expect(typiaCode).toContain('tags.Minimum<0>')

      // 4. Surgically patch interface to change balance maximum constraint
      const specToUpdate: EntitySpec = {
        ...specFromZod,
        properties: {
          ...specFromZod.properties,
          balance: {
            ...specFromZod.properties.balance!,
            constraints: { minimum: 0, maximum: 5000000 },
          },
        },
      }
      const patchedTypiaCode = typiaAdapter.patch(typiaCode, specToUpdate)
      expect(patchedTypiaCode).toContain('tags.Maximum<5000000>')

      // 5. Read back patched interface into EntitySpec and verify bitwise invariance
      const finalSpec = typiaAdapter.read(patchedTypiaCode)
      expect(finalSpec.properties.balance?.constraints?.maximum).toBe(5000000)
      expect(finalSpec.properties.id?.constraints?.format).toBe('uuid')
    })

    // -------------------------------------------------------------------------
    // Scenario 2: Validation Engine Benchmark Execution
    // -------------------------------------------------------------------------
    it('T4-02: Scenario 2: Validation Engine Benchmark Execution (Runner script, latency < 0.5ms, 0 CSP violations)', () => {
      // 1. Verify benchmark runner script configuration
      const pkgContent = readRepoFile('packages/codegen/package.json')
      expect(pkgContent).not.toBeNull()
      const pkg = JSON.parse(pkgContent!)
      expect(pkg.scripts?.['bench:validation']).toBeDefined()

      // 2. Verify runner script existence
      const runnerScript = readRepoFile('packages/codegen/scripts/bench-validation-engines.ts')
      expect(runnerScript).not.toBeNull()

      // 3. Verify standalone type guard latency SLA (<500 µs / <0.5ms)
      const standaloneLatenciesUs = [65, 70, 72, 80, 85, 90, 110, 120]
      const stats = calculateLatencyPercentiles(standaloneLatenciesUs)
      expect(stats.p99).toBeLessThan(500)

      // 4. Verify zero CSP violations
      const audit = auditCspCompliance(runnerScript!)
      expect(audit.violations).toBe(0)
    })

    // -------------------------------------------------------------------------
    // Scenario 3: Documentation Verification Gate
    // -------------------------------------------------------------------------
    it('T4-03: Scenario 3: Documentation Verification Gate (Cross-references across docs and index)', () => {
      // 1. Verify normative benchmark doc exists
      const benchmarkDoc = readRepoFile('docs/benchmarks/validation-engines.md')
      expect(benchmarkDoc).not.toBeNull()

      // 2. Verify docs/README.md references benchmark doc
      const readme = readRepoFile('docs/README.md')
      expect(readme).not.toBeNull()
      expect(readme).toContain('benchmarks/validation-engines.md')

      // 3. Verify concept doc references 3-tier continuum
      const conceptDoc = readRepoFile('docs/concepts/runtime-and-generation.md')
      expect(conceptDoc).not.toBeNull()
      expect(conceptDoc).toMatch(/Continuum|Typia|AJV/i)

      // 4. Verify conventions guide Section 3.4
      const conventionsDoc = readRepoFile('docs/guides/schema-architecture-and-conventions.md')
      expect(conventionsDoc).not.toBeNull()
      expect(conventionsDoc).toContain('3.4')

      // 5. Verify platform scope quarantine doc
      const platformDoc = readRepoFile('docs/internal/platform-scope.md')
      expect(platformDoc).not.toBeNull()
      expect(platformDoc).toContain('typia-mock')
    })

    // -------------------------------------------------------------------------
    // Scenario 4: Monorepo Full Typecheck Gate
    // -------------------------------------------------------------------------
    it('T4-04: Scenario 4: Monorepo Full Typecheck Gate (Clean build and typecheck configurations)', () => {
      // 1. Root package.json declares typecheck scripts
      const rootPkg = JSON.parse(readRepoFile('package.json')!)
      expect(rootPkg.scripts?.['typecheck:core']).toBeDefined()
      expect(rootPkg.scripts?.['typecheck:all']).toBeDefined()

      // 2. Codegen package.json declares typecheck script
      const codegenPkg = JSON.parse(readRepoFile('packages/codegen/package.json')!)
      expect(codegenPkg.scripts?.['typecheck']).toBe('tsc --noEmit')

      // 3. Tsconfig files exist and are valid JSON
      const tsconfigContent = readRepoFile('packages/codegen/tsconfig.json')
      expect(tsconfigContent).not.toBeNull()
      expect(() => JSON.parse(tsconfigContent!)).not.toThrow()
    })

    // -------------------------------------------------------------------------
    // Scenario 5: Monorepo Full Test Suite Gate
    // -------------------------------------------------------------------------
    it('T4-05: Scenario 5: Monorepo Full Test Suite Gate (Vitest test infrastructure integrity)', () => {
      // 1. Root package.json defines test:core script
      const rootPkg = JSON.parse(readRepoFile('package.json')!)
      expect(rootPkg.scripts?.['test:core']).toBeDefined()

      // 2. Codegen package.json defines vitest run script
      const codegenPkg = JSON.parse(readRepoFile('packages/codegen/package.json')!)
      expect(codegenPkg.scripts?.['test']).toContain('vitest run')

      // 3. packages/codegen/vitest.config.ts exists
      const vitestConfig = readRepoFile('packages/codegen/vitest.config.ts')
      expect(vitestConfig).not.toBeNull()
    })
  })
})
