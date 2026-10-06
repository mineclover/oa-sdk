import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as ts from 'typescript'
import { generate } from '../../cli/commands/generate.js'
import { runInit } from '../../cli/lib/init/index.js'
import { init } from '../../cli/commands/init.js'
import {
  TARGET_FRAMEWORK_IDS,
  PRODUCT_LIFECYCLE_ARCHETYPES,
} from '../../config.js'
import type { OutputRoutingPreset } from '../../cli/lib/init/types.js'

describe('Adversarial Challenge: Milestone 3 Requirements R7 & R8', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-challenger-m3-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('Requirement R7: oa-gen generate Unified Declarative Spec Pipeline', () => {
    it('executes full pipeline with oa.config.ts, generates all 5 artifact categories, tracks manifest, and prunes orphans safely', async () => {
      // 1. Spec Source Module returning OpenAPI 3.1 and JSON Schema 2020-12
      const specSourcePath = path.join(tmpDir, 'spec-source.mjs')
      fs.writeFileSync(
        specSourcePath,
        `
export function buildProjection() {
  return {
    openApiDoc: {
      openapi: '3.1.0',
      info: { title: 'Challenger API', version: '1.0.0' },
      paths: {
        '/products': {
          get: {
            tags: ['products'],
            operationId: 'listProducts',
            summary: 'List products',
            responses: {
              '200': {
                description: 'Product list',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Product' },
                    },
                  },
                },
              },
            },
          },
          post: {
            tags: ['products'],
            operationId: 'createProduct',
            summary: 'Create product',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Product' },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Product' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Product: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              sku: { type: 'string' },
              price: { type: 'number' },
            },
            required: ['id', 'sku', 'price'],
          },
        },
      },
    },
    jsonSchemaDoc: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Challenger Schema Bundle',
      $defs: {
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            sku: { type: 'string' },
            price: { type: 'number' },
          },
          required: ['id', 'sku', 'price'],
        },
      },
    },
  }
}
`,
        'utf8',
      )

      // 2. TypeScript configuration file: oa.config.ts
      const configTsPath = path.join(tmpDir, 'oa.config.ts')
      fs.writeFileSync(
        configTsPath,
        `
export default {
  rootDir: '.',
  specs: [
    {
      id: 'products-api',
      profile: 'full-api-document',
      schemaEntry: './spec-source.mjs',
      outDir: './generated/specs',
    },
  ],
  guards: {
    outDir: './generated/guards',
    split: false,
    moduleFormat: 'esm',
  },
  core: {
    contracts: {
      pureHandlers: true,
      contractName: 'ProductHandlers',
    },
    client: {
      enabled: true,
    },
  },
  product: {
    outputRouting: {
      byKind: {
        contract: 'src/contracts/{tag}.contract.ts',
        client: 'src/sdk/{tag}.client.ts',
        keys: 'src/queries/{tag}.keys.ts',
        queries: 'src/queries/{tag}.queries.ts',
      },
    },
  },
}
`,
        'utf8',
      )

      // 3. Run declarative generate pipeline
      await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

      // 4. Verify Projections (Category 1: OpenAPI 3.1 & JSON Schema 2020-12)
      const openApiPath = path.join(tmpDir, 'generated/specs/products-api.openapi.json')
      const jsonSchemaPath = path.join(tmpDir, 'generated/specs/products-api.schema.json')
      expect(fs.existsSync(openApiPath), 'OpenAPI 3.1 spec must exist').toBe(true)
      expect(fs.existsSync(jsonSchemaPath), 'JSON Schema 2020-12 must exist').toBe(true)

      const openApiDoc = JSON.parse(fs.readFileSync(openApiPath, 'utf8'))
      expect(openApiDoc.openapi).toBe('3.1.0')
      expect(openApiDoc.paths['/products']?.get?.operationId).toBe('listProducts')

      // 5. Verify Standalone Type Guards (Category 2: AJV Standalone Guards)
      const guardIndexPath = path.join(tmpDir, 'generated/guards/index.js')
      const guardDtsPath = path.join(tmpDir, 'generated/guards/index.d.ts')
      const guardJsPath = path.join(tmpDir, 'generated/guards/guards.js')
      expect(fs.existsSync(guardIndexPath), 'Standalone guard index.js must exist').toBe(true)
      expect(fs.existsSync(guardDtsPath), 'Standalone guard index.d.ts must exist').toBe(true)
      expect(fs.existsSync(guardJsPath), 'Standalone guard guards.js must exist').toBe(true)

      const guardJs = fs.readFileSync(guardJsPath, 'utf8')
      expect(guardJs).toContain('isProduct')

      // 6. Verify Handler Contracts (Category 3: @oa-sdk/router)
      const contractPath = path.join(tmpDir, 'src/contracts/products-api.contract.ts')
      expect(fs.existsSync(contractPath), 'Handler contract must exist').toBe(true)
      const contractCode = fs.readFileSync(contractPath, 'utf8')
      expect(contractCode).toContain('ProductHandlers')
      expect(contractCode).toContain('listProducts')
      expect(contractCode).toContain('createProduct')

      // 7. Verify Client SDK (Category 4: @oa-sdk/client)
      const clientPath = path.join(tmpDir, 'src/sdk/products-api.client.ts')
      expect(fs.existsSync(clientPath), 'Client SDK must exist').toBe(true)
      const clientCode = fs.readFileSync(clientPath, 'utf8')
      expect(clientCode).toContain('listProducts')
      expect(clientCode).toContain('createProduct')

      // 8. Verify TanStack Query Options & Keys (Category 5: @oa-sdk/client)
      const keysPath = path.join(tmpDir, 'src/queries/products-api.keys.ts')
      const queriesPath = path.join(tmpDir, 'src/queries/products-api.queries.ts')
      expect(fs.existsSync(keysPath), 'Query keys must exist').toBe(true)
      expect(fs.existsSync(queriesPath), 'Query options must exist').toBe(true)

      const keysCode = fs.readFileSync(keysPath, 'utf8')
      expect(keysCode).toContain('productsKeys')

      const queriesCode = fs.readFileSync(queriesPath, 'utf8')
      expect(queriesCode).toContain('listProductsQueryOptions')
      // Cross-directory relative import resolution
      expect(queriesCode).toContain('../sdk/products-api.client.js')
      expect(queriesCode).toContain('./products-api.keys.js')

      // 9. Verify .oa-manifest.json Integrity and SHA-256 Hashes
      const manifestPath = path.join(tmpDir, '.oa-manifest.json')
      expect(fs.existsSync(manifestPath), 'Manifest must exist').toBe(true)

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      expect(manifest.version).toBe(1)
      expect(manifest.generator).toBe('@oa-sdk/codegen')
      expect(manifest.artifacts.length).toBeGreaterThanOrEqual(6)

      const kinds = manifest.artifacts.map((a: any) => a.kind)
      expect(kinds).toContain('schemas')
      expect(kinds).toContain('guards')
      expect(kinds).toContain('contract')
      expect(kinds).toContain('client')
      expect(kinds).toContain('keys')
      expect(kinds).toContain('queries')

      // Verify every single artifact hash independently against disk content
      for (const art of manifest.artifacts) {
        const fullPath = path.resolve(tmpDir, art.path)
        expect(fs.existsSync(fullPath), `Artifact file ${art.path} must exist on disk`).toBe(true)
        const fileContent = fs.readFileSync(fullPath, 'utf8')
        const calculatedHash = 'sha256:' + crypto.createHash('sha256').update(fileContent, 'utf8').digest('hex')
        expect(art.contentHash).toBe(calculatedHash)
      }

      // 10. Adversarial Stress Test: Safe Orphan Pruning & Non-Manifest Protection
      // A: Add a hand-written user file in a separate directory (no banner)
      const userCodePath = path.join(tmpDir, 'src/helpers/utils.ts')
      fs.mkdirSync(path.dirname(userCodePath), { recursive: true })
      fs.writeFileSync(userCodePath, 'export const helper = () => "pure-user-code";\n', 'utf8')

      // B: Add a hand-written user file inside the output directory (no banner)
      const userContractPath = path.join(tmpDir, 'src/contracts/custom-manual.ts')
      fs.writeFileSync(userContractPath, 'export interface ManualInterface { custom: boolean; }\n', 'utf8')

      // C: A second configuration file targeting 'orders-api' instead of 'products-api'
      const configV2Path = path.join(tmpDir, 'oa.config.v2.ts')
      const configV2Source = `
export default {
  rootDir: '.',
  specs: [
    {
      id: 'orders-api',
      profile: 'full-api-document',
      schemaEntry: './spec-source.mjs',
      outDir: './generated/specs',
    },
  ],
  core: {
    contracts: { pureHandlers: true },
    client: { enabled: true },
  },
  product: {
    outputRouting: {
      byKind: {
        contract: 'src/contracts/{tag}.contract.ts',
        client: 'src/sdk/{tag}.client.ts',
        keys: 'src/queries/{tag}.keys.ts',
        queries: 'src/queries/{tag}.queries.ts',
      },
    },
  },
}
`
      fs.writeFileSync(configV2Path, configV2Source, 'utf8')

      // Run the pipeline from the second configuration file. A run owns only the records that
      // runs of its own configuration file wrote, so it must not prune what oa.config.ts generated.
      // (Pruning the outputs of a target replaced within one configuration file is covered by
      // generate-pipeline.test.ts.)
      await generate.run({ config: configV2Path }, { cwd: tmpDir, projectRoot: tmpDir })

      expect(fs.existsSync(contractPath), 'Contract generated from oa.config.ts must survive a run of oa.config.v2.ts').toBe(true)
      expect(fs.existsSync(clientPath), 'Client generated from oa.config.ts must survive a run of oa.config.v2.ts').toBe(true)

      // Verify new orders-api artifacts exist
      const newContractPath = path.join(tmpDir, 'src/contracts/orders-api.contract.ts')
      expect(fs.existsSync(newContractPath), 'New generated contract must exist').toBe(true)

      // CRITICAL SAFETY CHECK: Non-manifest hand-written files MUST NOT be pruned
      expect(fs.existsSync(userCodePath), 'User-authored file outside output must NEVER be touched').toBe(true)
      expect(fs.readFileSync(userCodePath, 'utf8')).toContain('pure-user-code')

      expect(fs.existsSync(userContractPath), 'User-authored file in output dir without banner must NEVER be touched').toBe(true)
      expect(fs.readFileSync(userContractPath, 'utf8')).toContain('ManualInterface')
    })

    it('defends against pruning when an artifact was modified by the developer (Gate 2)', async () => {
      const specSourcePath = path.join(tmpDir, 'spec-source.mjs')
      fs.writeFileSync(
        specSourcePath,
        `
export function buildProjection() {
  return {
    openApiDoc: {
      openapi: '3.1.0',
      info: { title: 'Gate2 API', version: '1.0.0' },
      paths: { '/test': { get: { operationId: 'getTest', responses: { '200': { description: 'ok' } } } } },
      components: { schemas: {} },
    },
    jsonSchemaDoc: { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: {} },
  }
}
`,
        'utf8',
      )

      const configTsPath = path.join(tmpDir, 'oa.config.ts')
      fs.writeFileSync(
        configTsPath,
        `
export default {
  rootDir: '.',
  specs: [{ id: 'target-a', profile: 'full-api-document', schemaEntry: './spec-source.mjs', outDir: './out' }],
  core: { contracts: { pureHandlers: true } },
}
`,
        'utf8',
      )

      await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

      const targetAContract = path.join(tmpDir, 'out/target-a.contract.ts')
      expect(fs.existsSync(targetAContract)).toBe(true)

      // Developer modifies target-a.contract.ts by appending custom logic
      fs.appendFileSync(targetAContract, '\n// Developer manual edit that diverges hash\n')

      // Switch config to target-b via distinct config file to avoid in-memory module caching
      const configV2Path = path.join(tmpDir, 'oa.config.v2.ts')
      fs.writeFileSync(
        configV2Path,
        `
export default {
  rootDir: '.',
  specs: [{ id: 'target-b', profile: 'full-api-document', schemaEntry: './spec-source.mjs', outDir: './out' }],
  core: { contracts: { pureHandlers: true } },
}
`,
        'utf8',
      )

      await generate.run({ config: configV2Path }, { cwd: tmpDir, projectRoot: tmpDir })

      // Gate 2 protection: modified file must NOT be pruned because disk hash !== recorded hash
      expect(fs.existsSync(targetAContract), 'Modified artifact must NOT be pruned (Gate 2 Hash Guard)').toBe(true)
      expect(fs.readFileSync(targetAContract, 'utf8')).toContain('Developer manual edit')
    })
  })

  describe('Requirement R8: oa-gen init --routing Presets and Syntax Integrity', () => {
    const presets: OutputRoutingPreset[] = ['default', 'fsd', 'monorepo', 'by-kind']

    for (const preset of presets) {
      it(`generates syntactically valid TypeScript oa.config.ts with --routing ${preset} (dryRun=true & dryRun=false)`, async () => {
        const pkgPath = path.join(tmpDir, 'package.json')
        fs.writeFileSync(pkgPath, JSON.stringify({ name: `test-${preset}-app`, dependencies: { express: '^4.19.0' } }), 'utf8')

        // 1. Test dryRun: true
        const dryRes = await runInit({
          cwd: tmpDir,
          target: 'express',
          routing: preset,
          dryRun: true,
        })
        expect(dryRes.dryRun).toBe(true)
        expect(dryRes.routing).toBe(preset)
        expect(fs.existsSync(path.join(tmpDir, 'oa.config.ts'))).toBe(false)

        // 2. Test dryRun: false
        const realRes = await runInit({
          cwd: tmpDir,
          target: 'express',
          routing: preset,
          yes: true,
        })
        expect(realRes.routing).toBe(preset)
        expect(fs.existsSync(realRes.configPath)).toBe(true)

        const configContent = fs.readFileSync(realRes.configPath, 'utf8')

        // 3. Empirical AST Syntax Validation using TypeScript compiler
        const sourceFile = ts.createSourceFile(
          'oa.config.ts',
          configContent,
          ts.ScriptTarget.ESNext,
          true,
          ts.ScriptKind.TS,
        )
        const diagnostics = (sourceFile as any).parseDiagnostics ?? []
        expect(diagnostics.length, `Emitted oa.config.ts for preset "${preset}" must have 0 syntax errors`).toBe(0)

        // Also transpile to ensure clean compilation
        const transpileResult = ts.transpileModule(configContent, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        })
        expect(transpileResult.diagnostics?.length ?? 0).toBe(0)

        // 4. Verify Preset-Specific Properties in outputRouting block
        if (preset === 'fsd') {
          expect(configContent).toContain("pattern: 'src/features/{tag}/api/{tag}.{kind}.ts'")
          expect(configContent).toContain("target: 'src/shared/api/{tag}.{kind}.ts'")
          expect(configContent).toContain("client: 'src/shared/api/client.ts'")
          // Must correctly format array of objects with { ... }
          expect(configContent).toMatch(/rules:\s*\[\s*\{\s*tag:/)
        } else if (preset === 'monorepo') {
          expect(configContent).toContain("contract: 'packages/contracts/src/api.contract.ts'")
          expect(configContent).toContain("client: 'packages/client-sdk/src/index.ts'")
          expect(configContent).toContain("queries: 'apps/web/src/api/queries.ts'")
        } else if (preset === 'by-kind') {
          expect(configContent).toContain("contract: 'src/contracts/{tag}.contract.ts'")
          expect(configContent).toContain("client: 'src/client/{tag}.client.ts'")
          expect(configContent).toContain("queries: 'src/queries/{tag}.queries.ts'")
          expect(configContent).toContain("keys: 'src/keys/{tag}.keys.ts'")
        } else if (preset === 'default') {
          expect(configContent).toContain("pattern: 'src/api/{tag}/{tag}.{kind}.ts'")
        }
      })
    }

    it('cross-validates all 72 combinations of [4 Presets x 3 Archetypes x 6 Framework Targets]', async () => {
      const { composeInitConfig } = await import('../../cli/lib/init/composer.js')
      const { getTargetProfile } = await import('../../cli/lib/init/targets/index.js')
      const { getArchetypeProfile } = await import('../../cli/lib/init/archetypes/index.js')

      let count = 0
      for (const preset of presets) {
        for (const archetypeId of PRODUCT_LIFECYCLE_ARCHETYPES) {
          for (const targetId of TARGET_FRAMEWORK_IDS) {
            const target = getTargetProfile(targetId)
            const archetype = getArchetypeProfile(archetypeId)
            const runtime = targetId === 'elysia' ? 'bun' : 'node'

            const configContent = composeInitConfig(target, archetype, {
              frameworkId: targetId,
              routing: preset,
              runtime,
              cwd: tmpDir,
            })

            // TypeScript parser syntax verification
            const sourceFile = ts.createSourceFile(
              'oa.config.ts',
              configContent,
              ts.ScriptTarget.ESNext,
              true,
              ts.ScriptKind.TS,
            )
            const diagnostics = (sourceFile as any).parseDiagnostics ?? []
            if (diagnostics.length > 0) {
              const errors = diagnostics.map((d: any) => d.messageText).join('; ')
              throw new Error(`Syntax error in combination (${preset}, ${archetypeId}, ${targetId}): ${errors}\nConfig:\n${configContent}`)
            }

            expect(diagnostics.length).toBe(0)
            count++
          }
        }
      }

      expect(count).toBe(72)
    })

    it('adversarially rejects invalid routing preset option via CLI and falls back safely in runInit', async () => {
      const pkgPath = path.join(tmpDir, 'package.json')
      fs.writeFileSync(pkgPath, JSON.stringify({ name: 'err-test' }), 'utf8')

      // CLI command strictly rejects invalid routing preset
      await expect(
        init.run({ cwd: tmpDir, routing: 'malformed-preset' }, { cwd: tmpDir, projectRoot: tmpDir }),
      ).rejects.toThrow()

      // Programmatic runInit falls back gracefully to default routing snippet when unrecognized
      const res = await runInit({ cwd: tmpDir, routing: 'unknown-preset' as any, dryRun: true })
      expect(res.routing).toBe('unknown-preset')
    })
  })
})
