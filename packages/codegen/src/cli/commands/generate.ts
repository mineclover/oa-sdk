import { resolve, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { parseDocument, type OasDocument, type ParsedDocument } from '@oa-sdk/parser'
import type { Command, CommandArgValue } from '../lib/types.js'
import type { CodegenConfig, OaConfig } from '../../config.js'
import { resolveConfigWithDefaults } from '../../config.js'
import type { OutputOptions } from '../../types.js'
import { generateComponents } from '../../generator.js'
import { bool, optStr } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import type { StandaloneGuardGeneratorOptions } from '../../standalone-guards/types.js'
import { loadOaConfig, resolveProfileTarget } from '../lib/config-loader.js'
import { projectTargetSpec, projectTargetGuards, type TargetSpecProjectionResult } from '../../spec-projector.js'
import {
  createPathDispatcher,
  OaManifestManager,
  DEFAULT_BANNER_MARKERS,
  type WriteArtifactInput,
} from '../../routing/index.js'

import { runStandaloneGuards } from './generate-guards.js'
import { runDrizzle } from './generate-drizzle.js'

export const generate: Command = {
  name: 'generate',
  description: 'Config/Drizzle 기반 스키마, 멀티 타겟 스펙 또는 독립형 타입 가드(standalone-guards) 생성',
  options: {
    target:           { type: 'string', description: '생성 타겟 (standalone-guards)' },
    input:            { type: 'string', short: 'i', description: '입력 스키마 또는 OpenAPI spec 파일 경로' },
    'out-dir':        { type: 'string', description: '출력 디렉토리 경로' },
    'type-import':    { type: 'string', description: 'TypeScript 타입 import 지정자 (예: @oa-sdk/models)' },
    'module-format':  { type: 'string', description: '모듈 포맷 (esm)' },
    config:           { type: 'string', short: 'c', description: 'oa.config.ts 또는 codegen.config.mjs 파일 경로' },
    'drizzle-schema': { type: 'string', short: 'd', description: 'Drizzle 스키마 파일 경로' },
    output:           { type: 'string', short: 'o', description: '출력 디렉토리 (기본: .)' },
    'merge-into':     { type: 'string', description: '기존 spec.yaml에 병합' },
    schemas:          { type: 'string', description: '생성 대상 필터 (Drizzle: select,insert,update / 가드: 컴포넌트/가드명 목록)' },
    split:            { type: 'boolean', description: '개별 가드 모듈 분할 생성 (guards/<TypeName>.js)' },
    tanstack:         { type: 'boolean', description: 'TanStack Query 클라이언트 옵션/키 팩토리 생성 (권장: oa-gen generate:tanstack)' },
    spec:             { type: 'string', short: 's', description: 'OpenAPI 3.1/3.2 spec 파일 경로' },
    tier:             { type: 'string', description: '생성 티어 필터 (all, keys, options, hooks)' },
    framework:        { type: 'string', description: '대상 UI 프레임워크 (react, vue, svelte)' },
    'types-import':   { type: 'string', description: '타입 import 지정자' },
    'client-import':  { type: 'string', description: '클라이언트 SDK import 지정자' },
  },
  async run(args, context) {
    const isTanstack = bool(args, 'tanstack')
    if (isTanstack) {
      console.log('[oa-gen] Note: "oa-gen generate --tanstack" is deprecated. Please use "oa-gen generate:tanstack" directly.')
      const { generateTanstackCommand } = await import('./generate-tanstack.js')
      const mappedArgs = { ...args }
      if (!mappedArgs['spec'] && (mappedArgs['input'] || mappedArgs['target'])) {
        mappedArgs['spec'] = mappedArgs['input'] ?? mappedArgs['target']
      }
      await generateTanstackCommand.run(mappedArgs, context)
      return
    }

    const target = optStr(args, 'target')
    const drizzlePath = optStr(args, 'drizzle-schema')
    const configPath = optStr(args, 'config')
    const inputPath = optStr(args, 'input')
    const specPath = optStr(args, 'spec')

    // 1. Explicit single-target flags
    if (target === 'standalone-guards' || (inputPath && !drizzlePath && !configPath && !specPath && !inputPath.endsWith('.tsp'))) {
      await runStandaloneGuards(args)
      return
    }
    if (drizzlePath) {
      await runDrizzle(drizzlePath, args)
      return
    }

    // 1.5. Direct spec/input execution without explicit config
    const directSpecPath = specPath ?? (inputPath && (inputPath.endsWith('.tsp') || inputPath.endsWith('.yaml') || inputPath.endsWith('.yml') || inputPath.endsWith('.json')) ? inputPath : undefined)
    if (directSpecPath && !drizzlePath && !configPath) {
      const outDir = optStr(args, 'out-dir') ?? optStr(args, 'output') ?? './dist'
      const id = directSpecPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.(tsp|yaml|yml|json)$/, '') ?? 'api'
      const syntheticConfig: OaConfig = {
        specs: [
          {
            id,
            schemaEntry: directSpecPath,
            outDir,
          },
        ],
      }
      const rootDir = context?.projectRoot ?? (context as any)?.rootDir ?? context?.cwd ?? process.cwd()
      await runConfigDrivenPipeline(syntheticConfig, rootDir)
      return
    }

    // 2. Config-driven execution (via explicit --config or no-arg discovery)
    const loaded = await loadOaConfig({
      ...(configPath ? { configPath } : {}),
      ...(context?.cwd !== undefined ? { cwd: context.cwd } : {}),
      ...(context?.projectRoot !== undefined ? { explicitRoot: context.projectRoot } : {}),
    })

    if (loaded) {
      // Check if loaded config is extended OaConfig with specs, guards, core, or product
      if (loaded.config.specs || loaded.config.guards || loaded.config.core || loaded.config.product) {
        await runConfigDrivenPipeline(loaded.config, loaded.rootDir)
        return
      }
      // Legacy config with schemas
      if (loaded.config.schemas) {
        await runConfigWithObject(loaded.config, args)
        return
      }
    }

    // 3. If explicit --config was passed but not handled by loadOaConfig
    if (configPath) {
      await runConfig(configPath, args)
      return
    }

    // 4. No targeting arguments and no config found
    console.error('오류: oa.config.ts 설정 파일을 찾을 수 없으며, --config, --drizzle-schema 또는 --target standalone-guards (--input) 옵션이 필요합니다')
    throw new CliExitError(1)
  },
}

type Args = Record<string, CommandArgValue>

/**
 * Executes declarative multi-target generation driven by oa.config.ts.
 */
async function runConfigDrivenPipeline(config: OaConfig, rootDir: string): Promise<void> {
  const resolvedConfig = resolveConfigWithDefaults(config)
  const specs = resolvedConfig.specs ?? []
  const specResults: TargetSpecProjectionResult[] = []

  const outputRouting = resolvedConfig.product?.outputRouting ?? resolvedConfig.outputRouting
  const dispatcher = createPathDispatcher(outputRouting, rootDir)
  const bannerMarkers = [
    ...DEFAULT_BANNER_MARKERS,
    '@oa-sdk',
    'Auto-generated',
    'Do not edit',
    'openapi',
    '$schema',
  ]
  const manifestManager = new OaManifestManager(rootDir, undefined, bannerMarkers)
  const artifactsToWrite: WriteArtifactInput[] = []

  console.log('\n🚀 [oa-gen generate] Executing Declarative Spec Pipeline...')
  console.log(`   Project Root: ${rootDir}\n`)

  // Every downstream generator consumes the same projected document. Parse it
  // once per target, on first use, instead of once per generator.
  const parsedSpecs = new Map<TargetSpecProjectionResult, ParsedDocument>()
  const parsedSpec = (res: TargetSpecProjectionResult): ParsedDocument => {
    let parsed = parsedSpecs.get(res)
    if (!parsed) {
      parsed = parseDocument(res.openApiDoc as OasDocument)
      parsedSpecs.set(res, parsed)
    }
    return parsed
  }

  // Step 1: Schema Projection (OpenAPI 3.1/3.2 and JSON Schema 2020-12)
  for (const target of specs) {
    const resolved = resolveProfileTarget(target, rootDir)
    await mkdir(resolved.resolvedOutDir, { recursive: true })

    const result = await projectTargetSpec(target, rootDir)
    const openApiJson = JSON.stringify(result.openApiDoc, null, 2) + '\n'
    const jsonSchemaJson = JSON.stringify(result.jsonSchemaDoc, null, 2) + '\n'

    await writeFile(result.openApiPath, openApiJson, 'utf8')
    await writeFile(result.jsonSchemaPath, jsonSchemaJson, 'utf8')

    artifactsToWrite.push({
      path: result.openApiPath,
      kind: 'schemas',
      tag: target.id,
      content: openApiJson,
      sourceSpec: target.schemaEntry,
    })
    artifactsToWrite.push({
      path: result.jsonSchemaPath,
      kind: 'schemas',
      tag: target.id,
      content: jsonSchemaJson,
      sourceSpec: target.schemaEntry,
    })

    specResults.push(result)
  }

  // Step 2: Standalone Type Guards
  let guardSummary: string | undefined
  if (resolvedConfig.guards) {
    const guardRes = await projectTargetGuards(resolvedConfig.guards, specResults, rootDir)
    guardSummary = `${guardRes.artifacts.length} guard artifacts (${guardRes.guardCount} types) -> ${relative(rootDir, guardRes.outDir)}`
    for (const artifact of guardRes.artifacts) {
      artifactsToWrite.push({
        path: artifact.filePath,
        kind: 'guards',
        content: artifact.content,
      })
    }
  }

  // Step 3: Handler Contracts (@oa-sdk/router)
  const contractsConfig = resolvedConfig.core?.contracts
  let contractsGeneratedCount = 0
  if (contractsConfig?.pureHandlers !== false && specResults.length > 0) {
    try {
      const { generateHandlerContract } = await import('@oa-sdk/router')
      for (const res of specResults) {
        const contractCode = generateHandlerContract(parsedSpec(res), {
          contractName: contractsConfig?.contractName ?? 'ApiHandlers',
          banner: contractsConfig?.banner ?? true,
          contextImport: resolvedConfig.product?.contextInjection?.importPath,
          contextTypeName: resolvedConfig.product?.contextInjection?.typeName,
        })

        let contractPath: string
        if (outputRouting) {
          contractPath = dispatcher.dispatch({ kind: 'contract', tag: res.target.id }).absolutePath
        } else if (contractsConfig?.outDir) {
          contractPath = resolve(rootDir, contractsConfig.outDir, `${res.target.id}.contract.ts`)
        } else {
          const targetResolved = resolveProfileTarget(res.target, rootDir)
          contractPath = resolve(targetResolved.resolvedOutDir, `${res.target.id}.contract.ts`)
        }

        artifactsToWrite.push({
          path: contractPath,
          kind: 'contract',
          tag: res.target.id,
          content: contractCode,
          sourceSpec: res.openApiPath,
        })
        contractsGeneratedCount++
      }
    } catch (err) {
      console.warn('⚠️  Failed to generate handler contracts via @oa-sdk/router:', err instanceof Error ? err.message : String(err))
    }
  }

  // Step 4: Client SDK (@oa-sdk/client)
  const clientConfig = resolvedConfig.core?.client
  let clientGeneratedCount = 0
  if (clientConfig?.enabled !== false && specResults.length > 0) {
    try {
      const { generateClient } = await import('@oa-sdk/client')
      for (const res of specResults) {
        const typesImport = clientConfig?.typesImport ?? (res.target as any).typesImport
        const clientCode = generateClient(parsedSpec(res), {
          banner: true,
          ...(typesImport ? { typesImport } : {}),
        })

        let clientPath: string
        if (outputRouting) {
          clientPath = dispatcher.dispatch({ kind: 'client', tag: res.target.id }).absolutePath
        } else if (clientConfig?.outDir) {
          clientPath = resolve(rootDir, clientConfig.outDir, `${res.target.id}.client.ts`)
        } else {
          const targetResolved = resolveProfileTarget(res.target, rootDir)
          clientPath = resolve(targetResolved.resolvedOutDir, `${res.target.id}.client.ts`)
        }

        artifactsToWrite.push({
          path: clientPath,
          kind: 'client',
          tag: res.target.id,
          content: clientCode,
          sourceSpec: res.openApiPath,
        })
        clientGeneratedCount++
      }
    } catch (err) {
      console.warn('⚠️  Failed to generate client SDK via @oa-sdk/client:', err instanceof Error ? err.message : String(err))
    }
  }

  // Step 5: TanStack Query options (@oa-sdk/client)
  let tanstackGeneratedCount = 0
  if (specResults.length > 0) {
    try {
      const { generateTanstackQuery } = await import('@oa-sdk/client')
      for (const res of specResults) {
        let clientImport: string | undefined
        let keysPath: string
        let queriesPath: string

        if (outputRouting) {
          keysPath = dispatcher.dispatch({ kind: 'keys', tag: res.target.id }).absolutePath
          queriesPath = dispatcher.dispatch({ kind: 'queries', tag: res.target.id }).absolutePath
          clientImport = dispatcher.resolveImport(
            { kind: 'queries', tag: res.target.id },
            { kind: 'client', tag: res.target.id },
          )
        } else {
          const targetResolved = resolveProfileTarget(res.target, rootDir)
          keysPath = resolve(targetResolved.resolvedOutDir, `${res.target.id}.keys.ts`)
          queriesPath = resolve(targetResolved.resolvedOutDir, `${res.target.id}.queries.ts`)
          clientImport = `./${res.target.id}.client.js`
        }

        if (outputRouting && keysPath !== queriesPath) {
          const keysImport = dispatcher.resolveImport(
            { kind: 'queries', tag: res.target.id },
            { kind: 'keys', tag: res.target.id },
          )
          const tanstackResult = generateTanstackQuery(parsedSpec(res), {
            queryPackage: '@tanstack/react-query',
            includeHooks: true,
            clientImport,
            keysImport,
            tier: 'all',
          })

          artifactsToWrite.push({
            path: keysPath,
            kind: 'keys',
            tag: res.target.id,
            content: tanstackResult.keysCode,
            sourceSpec: res.openApiPath,
          })
          artifactsToWrite.push({
            path: queriesPath,
            kind: 'queries',
            tag: res.target.id,
            content: tanstackResult.queriesCode,
            sourceSpec: res.openApiPath,
          })
        } else {
          const tanstackResult = generateTanstackQuery(parsedSpec(res), {
            queryPackage: '@tanstack/react-query',
            includeHooks: true,
            clientImport,
          })

          artifactsToWrite.push({
            path: queriesPath,
            kind: 'queries',
            tag: res.target.id,
            content: tanstackResult.combinedCode,
            sourceSpec: res.openApiPath,
          })
        }
        tanstackGeneratedCount++
      }
    } catch (err) {
      console.warn('⚠️  Failed to generate TanStack Query options via @oa-sdk/client:', err instanceof Error ? err.message : String(err))
    }
  }

  // Step 5.5: CRDT Collaboration Modules (@oa-sdk/router & @oa-sdk/client)
  let crdtGeneratedCount = 0
  for (const res of specResults) {
    const schemas = (res.openApiDoc as any)?.components?.schemas ?? {}
    const hasCrdtEntity = Object.values(schemas).some(
      (s: any) => s && typeof s === 'object' && ('x-oa-sdk-crdt-entity' in s || 'x-oa-sdk-crdt' in s),
    )

    if (hasCrdtEntity) {
      try {
        const { generateCrdtHandlerContract, generateCrdtRouter } = await import('@oa-sdk/router')
        const { generateCrdtClient, generateCrdtHooks } = await import('@oa-sdk/client')

        const targetResolved = resolveProfileTarget(res.target, rootDir)
        const targetDir = targetResolved.resolvedOutDir

        // 1. CRDT contract
        const crdtContractCode = generateCrdtHandlerContract(parsedSpec(res), { banner: true })
        const crdtContractPath = outputRouting
          ? dispatcher.dispatch({ kind: 'crdt-contract', tag: res.target.id }).absolutePath
          : resolve(targetDir, `${res.target.id}.crdt.contract.ts`)
        artifactsToWrite.push({
          path: crdtContractPath,
          kind: 'crdt-contract',
          tag: res.target.id,
          content: crdtContractCode,
          sourceSpec: res.openApiPath,
        })

        // 2. CRDT router
        const crdtRouterCode = generateCrdtRouter(parsedSpec(res), {
          target: ((resolvedConfig.core as any)?.router as any)?.target ?? 'hono',
          contractImport: outputRouting
            ? dispatcher.resolveImport(
                { kind: 'crdt-router', tag: res.target.id },
                { kind: 'crdt-contract', tag: res.target.id },
              )
            : `./${res.target.id}.crdt.contract.js`,
          banner: true,
        })
        const crdtRouterPath = outputRouting
          ? dispatcher.dispatch({ kind: 'crdt-router', tag: res.target.id }).absolutePath
          : resolve(targetDir, `${res.target.id}.crdt.router.ts`)
        artifactsToWrite.push({
          path: crdtRouterPath,
          kind: 'crdt-router',
          tag: res.target.id,
          content: crdtRouterCode,
          sourceSpec: res.openApiPath,
        })

        // 3. CRDT client
        const crdtClientCode = generateCrdtClient(parsedSpec(res), { banner: true })
        const crdtClientPath = outputRouting
          ? dispatcher.dispatch({ kind: 'crdt-client', tag: res.target.id }).absolutePath
          : resolve(targetDir, `${res.target.id}.crdt.client.ts`)
        artifactsToWrite.push({
          path: crdtClientPath,
          kind: 'crdt-client',
          tag: res.target.id,
          content: crdtClientCode,
          sourceSpec: res.openApiPath,
        })

        // 4. CRDT hooks
        const crdtHooksCode = generateCrdtHooks(parsedSpec(res), {
          clientImport: outputRouting
            ? dispatcher.resolveImport(
                { kind: 'crdt-hooks', tag: res.target.id },
                { kind: 'crdt-client', tag: res.target.id },
              )
            : `./${res.target.id}.crdt.client.js`,
          banner: true,
        })
        const crdtHooksPath = outputRouting
          ? dispatcher.dispatch({ kind: 'crdt-hooks', tag: res.target.id }).absolutePath
          : resolve(targetDir, `${res.target.id}.crdt.hooks.ts`)
        artifactsToWrite.push({
          path: crdtHooksPath,
          kind: 'crdt-hooks',
          tag: res.target.id,
          content: crdtHooksCode,
          sourceSpec: res.openApiPath,
        })

        crdtGeneratedCount++
      } catch (err) {
        console.warn('⚠️  Failed to generate CRDT modules:', err instanceof Error ? err.message : String(err))
      }
    }
  }

  // Step 6: Commit all artifacts through OaManifestManager and prune orphans
  const writeResult = await manifestManager.writeArtifacts(artifactsToWrite)
  const activePaths = artifactsToWrite.map((a) =>
    relative(rootDir, resolve(rootDir, a.path)),
  )
  await manifestManager.pruneOrphans(activePaths)

  // Step 7: Formatted Summary
  console.log('================================================================================')
  console.log('                 OA-SDK GENERATE: SPEC & GUARD SUMMARY                          ')
  console.log('                 OA-SDK GENERATE: DECLARATIVE PIPELINE SUMMARY                  ')
  console.log('================================================================================')
  console.log(`Specs Processed:     ${specResults.length}`)
  console.log(`Contracts Generated: ${contractsGeneratedCount}`)
  console.log(`Clients Generated:   ${clientGeneratedCount}`)
  console.log(`TanStack Generated:  ${tanstackGeneratedCount}`)
  if (crdtGeneratedCount > 0) {
    console.log(`CRDT Modules:        ${crdtGeneratedCount}`)
  }
  console.log(`Artifacts Written:   ${writeResult.written.length}`)
  console.log(`Artifacts Cached:    ${writeResult.skipped.length}`)
  for (const res of specResults) {
    const relOpenApi = relative(rootDir, res.openApiPath)
    const relSchema = relative(rootDir, res.jsonSchemaPath)
    const opInfo = res.operationCount > 0 ? `${res.operationCount} ops, ` : ''
    const titleInfo = res.target.title ? `(${res.target.title}) ` : ''
    console.log(` ✅ ${res.target.id.padEnd(20)} [${(res.target.profile ?? 'full-api-document').padEnd(18)}] ${titleInfo}-> ${opInfo}${res.schemaCount} schemas`)
    console.log(`    - OpenAPI 3.1: ${relOpenApi}`)
    console.log(`    - JSON Schema: ${relSchema}`)
  }

  if (guardSummary) {
    console.log(`\nGuards Generated:`)
    console.log(` ✅ ${guardSummary}`)
  }
  console.log('================================================================================\n')
}

async function runConfigWithObject(config: OaConfig, args: Args): Promise<void> {
  if (!config?.schemas) {
    console.error('오류: 설정 파일에 schemas 필드가 없습니다')
    throw new CliExitError(1)
  }

  const genOptions: OutputOptions = { output: optStr(args, 'output') ?? config.output ?? '.' }
  if (config.grouping !== undefined) genOptions.grouping = config.grouping
  if (config.filename !== undefined) genOptions.filename = config.filename
  if (config.mergeIntoSpec !== undefined) genOptions.mergeIntoSpec = config.mergeIntoSpec
  if (config.specPath !== undefined) genOptions.specPath = config.specPath

  const result = generateComponents(config.schemas, genOptions)
  console.log(`✅ ${result.files.length}개 파일 생성 완료:`)
  for (const file of result.files) console.log(`   ${file}`)
  printWarnings(result.warnings)
}

async function runConfig(configPath: string, args: Args): Promise<void> {
  const resolvedConfig = resolve(process.cwd(), configPath)
  if (!existsSync(resolvedConfig)) {
    console.error(`오류: 설정 파일을 찾을 수 없습니다: ${resolvedConfig}`)
    throw new CliExitError(1)
  }

  const mod = await import(resolvedConfig) as { default?: CodegenConfig } | CodegenConfig
  const config: CodegenConfig = (mod as { default?: CodegenConfig }).default ?? (mod as CodegenConfig)

  if (!config?.schemas) {
    console.error('오류: 설정 파일에 schemas 필드가 없습니다')
    throw new CliExitError(1)
  }

  const genOptions: OutputOptions = { output: optStr(args, 'output') ?? config.output ?? '.' }
  if (config.grouping !== undefined) genOptions.grouping = config.grouping
  if (config.filename !== undefined) genOptions.filename = config.filename
  if (config.mergeIntoSpec !== undefined) genOptions.mergeIntoSpec = config.mergeIntoSpec
  if (config.specPath !== undefined) genOptions.specPath = config.specPath

  const result = generateComponents(config.schemas, genOptions)
  console.log(`✅ ${result.files.length}개 파일 생성 완료:`)
  for (const file of result.files) console.log(`   ${file}`)
  printWarnings(result.warnings)
}

function printWarnings(warnings: string[]): void {
  if (warnings.length > 0) {
    console.warn('\n경고:')
    for (const w of warnings) console.warn(`  ⚠️  ${w}`)
  }
}
