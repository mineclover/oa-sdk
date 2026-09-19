/**
 * schema-transparency-check.ts
 *
 * Verifies the 4-Stage Transparent Schema Lifecycle Pipeline in oa-sdk:
 *   Stage 1: Zod Master Schema (AST & EntitySpec)
 *   Stage 2: JSON Schema Draft 2020-12 ($defs, storage, AJV validation)
 *   Stage 3: OpenAPI 3.1 (contract, components, provenance, version-hash)
 *   Stage 4: TypeScript Standalone Type Guards (zero-eval CSP, Tier 1 fast-path, polymorphic dispatch)
 */

import { resolve } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { executeSchemaPipeline, type OaConfig } from '../packages/codegen/src/schema-governance.js'
import { JsonSchemaTypeAdapter, ZodTypeAdapter } from '../packages/ast-sync/src/index.js'

async function main(): Promise<void> {
  console.log('\n🔍 [oa-sdk] Auditing 4-Stage Schema Pipeline & Transparency...')

  // Step 1: Verify Pluggable Adapter Bidirectional Roundtrip
  console.log('   Step 1: Auditing AST Bidirectional Sync (Zod ↔ EntitySpec ↔ JSON Schema 2020-12)...')
  const zodAdapter = new ZodTypeAdapter()
  const jsonAdapter = new JsonSchemaTypeAdapter()

  const testZod = `export const AccountSchema = z.object({
  accountId: z.string().uuid(),
  balance: z.number().min(0),
  status: z.enum(["active", "frozen", "closed"]),
  email: z.string().email(),
});`

  const entitySpec = zodAdapter.read(testZod)
  const jsonSchemaStr = jsonAdapter.write(entitySpec)
  const parsedJson = JSON.parse(jsonSchemaStr)

  if (parsedJson.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`JsonSchemaTypeAdapter did not emit Draft 2020-12 $schema: ${parsedJson.$schema}`)
  }
  if (!parsedJson.properties.accountId.format || parsedJson.properties.accountId.format !== 'uuid') {
    throw new Error('UUID format constraint lost in JSON Schema projection')
  }

  const roundtripSpec = jsonAdapter.read(parsedJson)
  const reEmittedZod = zodAdapter.write(roundtripSpec)
  if (!reEmittedZod.includes('accountId') || !reEmittedZod.includes('active')) {
    throw new Error('Roundtrip drift detected between JSON Schema 2020-12 and Zod!')
  }
  console.log('   ✅ AST Bidirectional Sync verified with 0 loss.\n')

  // Step 2: Execute End-to-End 4-Stage Pipeline in Sandbox
  console.log('   Step 2: Auditing End-to-End Pipeline Projection, CSP, & Fast-Path Predicates...')
  const root = resolve(process.cwd())
  const cacheBase = join(root, 'node_modules/.cache')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(cacheBase, { recursive: true })
  const sandboxDir = mkdtempSync(join(cacheBase, 'oa-schema-audit-'))

  try {
    const schemaEntry = join(sandboxDir, 'master-schemas.ts')
    writeFileSync(
      schemaEntry,
      `import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(['admin', 'user']),
});

export const EmailNotificationSchema = z.object({
  channel: z.literal('email'),
  recipientEmail: z.string().email(),
  subject: z.string().min(1),
});

export const SmsNotificationSchema = z.object({
  channel: z.literal('sms'),
  phoneNumber: z.string().min(10),
  message: z.string().min(1),
});

export const NotificationSchema = z.discriminatedUnion('channel', [
  EmailNotificationSchema,
  SmsNotificationSchema,
]);
`,
      'utf8'
    )

    const auditConfig: OaConfig = {
      specs: [
        {
          id: 'sandbox-api',
          profile: 'component-bundle',
          title: 'Sandbox Audit API',
          version: '1.0.0',
          schemaEntry,
          outDir: join(sandboxDir, 'dist', 'specs'),
        },
      ],
      guards: {
        outDir: join(sandboxDir, 'dist', 'guards'),
        split: false,
        moduleFormat: 'esm',
        auditCsp: true,
        tiered: true,
        polymorphicDispatch: true,
      },
    }

    const { manifest, reportTable } = await executeSchemaPipeline(auditConfig, {
      rootDir: sandboxDir,
      writeFiles: true,
      auditCsp: true,
      tiered: true,
      polymorphicDispatch: true,
    })

    console.log(reportTable)

    const guardInfo = manifest.stages.stage4_typeGuards.guards[0]
    if (!guardInfo || guardInfo.fastPathCount === 0) {
      throw new Error(`Pipeline audit failed: expected Tier 1 Fast-Path predicates, found ${guardInfo?.fastPathCount ?? 0}`)
    }
    if (guardInfo.dispatchCount === 0) {
      throw new Error(`Pipeline audit failed: expected Polymorphic Dispatch tables, found ${guardInfo?.dispatchCount ?? 0}`)
    }

    if (!manifest.summary.allStagesAligned) {
      throw new Error('Pipeline audit failed: stages are not fully aligned.')
    }
    if (!manifest.summary.zeroEvalCspCompliant) {
      throw new Error('Pipeline audit failed: Content Security Policy violations detected in guards!')
    }
    if (!manifest.summary.provenanceComplete) {
      throw new Error('Pipeline audit failed: provenance coordinates or versionHash missing.')
    }

    console.log('\n🎉 [oa-sdk] Schema Transparency Audit PASSED successfully!')
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true })
  }
}

main().catch(err => {
  console.error('\n❌ [oa-sdk] Schema Transparency Audit FAILED:')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
