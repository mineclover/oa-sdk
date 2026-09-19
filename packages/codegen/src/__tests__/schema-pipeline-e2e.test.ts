import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { executeSchemaPipeline } from '../schema-pipeline/index.js'
import type { OaConfig } from '../config.js'

describe('4-Stage Transparent Schema Lifecycle Pipeline (E2E)', () => {
  let tmpDir: string
  let schemaEntryPath: string
  let testConfig: OaConfig

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-schema-pipeline-test-'))
    schemaEntryPath = path.join(tmpDir, 'master-schemas.ts')

    // 1. Create Zod Master Schema file (Stage 1)
    const zodMasterContent = `import { z } from 'zod';

export const UserRoleSchema = z.enum(['admin', 'editor', 'viewer']);

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(2),
  age: z.number().int().min(0).optional(),
  role: UserRoleSchema,
});

export const CardPaymentSchema = z.object({
  paymentType: z.literal('card'),
  cardNumber: z.string().min(16),
  expMonth: z.number().min(1).max(12),
});

export const CryptoPaymentSchema = z.object({
  paymentType: z.literal('crypto'),
  walletAddress: z.string().min(20),
  chain: z.enum(['ethereum', 'polygon', 'solana']),
});

export const PaymentMethodSchema = z.discriminatedUnion('paymentType', [
  CardPaymentSchema,
  CryptoPaymentSchema,
]);
`
    await fs.writeFile(schemaEntryPath, zodMasterContent, 'utf8')

    testConfig = {
      specs: [
        {
          id: 'core-api',
          profile: 'component-bundle',
          title: 'Core Business API',
          version: '1.0.0',
          schemaEntry: schemaEntryPath,
          outDir: path.join(tmpDir, 'dist', 'specs'),
        },
      ],
      guards: {
        outDir: path.join(tmpDir, 'dist', 'guards'),
        split: false,
        moduleFormat: 'esm',
        auditCsp: true,
        tiered: true,
        polymorphicDispatch: true,
      },
    }
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('executes all 4 stages deterministically and produces complete transparency manifest', async () => {
    const { manifest, reportTable } = await executeSchemaPipeline(testConfig, {
      rootDir: tmpDir,
      writeFiles: true,
      auditCsp: true,
      tiered: true,
      polymorphicDispatch: true,
    })

    // Assert Global Alignment
    expect(manifest.summary.allStagesAligned).toBe(true)
    expect(manifest.summary.zeroEvalCspCompliant).toBe(true)
    expect(manifest.summary.provenanceComplete).toBe(true)

    // Stage 1: Zod Master Schema
    const stage1 = manifest.stages.stage1_zodMaster
    expect(stage1.schemaCount).toBeGreaterThanOrEqual(4)
    const userProfile = stage1.schemas.find(s => s.name === 'UserProfile')
    expect(userProfile).toBeDefined()
    expect(userProfile?.properties).toContain('email')
    expect(userProfile?.properties).toContain('role')

    const paymentMethod = stage1.schemas.find(s => s.name === 'PaymentMethod')
    expect(paymentMethod).toBeDefined()
    expect(paymentMethod?.hasDiscriminator).toBe(true)

    // Stage 2: JSON Schema Draft 2020-12
    const stage2 = manifest.stages.stage2_jsonSchema202012
    expect(stage2.dialect).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(stage2.bundles).toHaveLength(1)
    const bundle = stage2.bundles[0]!
    expect(bundle.defsCount).toBeGreaterThanOrEqual(4)
    expect(bundle.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)

    // Stage 3: OpenAPI 3.1
    const stage3 = manifest.stages.stage3_openApi31
    expect(stage3.specVersion).toBe('3.1.0')
    expect(stage3.specs).toHaveLength(1)
    const spec = stage3.specs[0]!
    expect(spec.versionHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(spec.profile).toBe('component-bundle')
    expect(spec.schemas).toContain('UserProfile')
    expect(spec.schemas).toContain('PaymentMethod')

    // Stage 4: Standalone Pre-compiled Type Guards
    const stage4 = manifest.stages.stage4_typeGuards
    expect(stage4.guards).toHaveLength(1)
    const guardInfo = stage4.guards[0]!
    expect(guardInfo.zeroEvalCsp).toBe(true)
    expect(guardInfo.fastPathCount).toBeGreaterThan(0)
    expect(guardInfo.dispatchCount).toBeGreaterThan(0)
    expect(guardInfo.guardNames).toContain('isUserProfile')
    expect(guardInfo.guardNames).toContain('isPaymentMethod')

    // Verify Emitted Guard Files on Disk
    const guardJsPath = path.join(tmpDir, 'dist', 'guards', 'guards.js')
    const guardDtsPath = path.join(tmpDir, 'dist', 'guards', 'guards.d.ts')
    const guardJsContent = await fs.readFile(guardJsPath, 'utf8')
    const guardDtsContent = await fs.readFile(guardDtsPath, 'utf8')

    // 1. Zero-eval CSP check: 0 eval or Function constructor
    expect(guardJsContent).not.toContain('eval(')
    expect(guardJsContent).not.toContain('new Function(')

    // 2. Fast-Path tier 1 predicates emitted
    expect(guardJsContent).toContain('export function isUserProfileFast(data)')
    expect(guardDtsContent).toContain('export declare function isUserProfileFast(data: unknown): boolean;')

    // 3. Polymorphic dispatch hash table emitted
    expect(guardJsContent).toContain('__dispatch_isPaymentMethod')
    expect(guardJsContent).toContain('"card": isCardPayment')
    expect(guardJsContent).toContain('"crypto": isCryptoPayment')

    // 4. Visual table output
    expect(reportTable).toContain('OA-SDK 4-STAGE TRANSPARENT SCHEMA PIPELINE')
    expect(reportTable).toContain('FULLY ALIGNED')
    expect(reportTable).toContain('100% COMPLIANT')
  })

  it('functionally executes generated standalone type guards, fast paths, and polymorphic dispatch', async () => {
    const guardModulePath = path.join(tmpDir, 'dist', 'guards', 'guards.js')
    const guards = await import(guardModulePath)

    // Verify presence of exported functions
    expect(typeof guards.isUserProfile).toBe('function')
    expect(typeof guards.isUserProfileFast).toBe('function')
    expect(typeof guards.isPaymentMethod).toBe('function')

    // Test Tier 1 Fast-Path
    expect(guards.isUserProfileFast(null)).toBe(false)
    expect(guards.isUserProfileFast('not-an-object')).toBe(false)
    expect(guards.isUserProfileFast({ id: 'bad' })).toBe(false) // missing email, role, etc.

    const validUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'admin',
    }

    expect(guards.isUserProfileFast(validUser)).toBe(true)
    expect(guards.isUserProfile(validUser)).toBe(true)

    // Invalid email format (fails full Ajv schema guard)
    const invalidEmailUser = {
      ...validUser,
      email: 'not-an-email',
    }
    expect(guards.isUserProfile(invalidEmailUser)).toBe(false)

    // Test Polymorphic Dispatch (Card vs Crypto)
    const validCard = {
      paymentType: 'card',
      cardNumber: '1234567812345678',
      expMonth: 12,
    }
    const validCrypto = {
      paymentType: 'crypto',
      walletAddress: '0x12345678901234567890',
      chain: 'ethereum',
    }
    const invalidPayment = {
      paymentType: 'cash',
      amount: 100,
    }

    expect(guards.isPaymentMethod(validCard)).toBe(true)
    expect(guards.isPaymentMethod(validCrypto)).toBe(true)
    expect(guards.isPaymentMethod(invalidPayment)).toBe(false)
  })
})
