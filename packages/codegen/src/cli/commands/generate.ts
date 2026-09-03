import { resolve, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import type { Command, CommandArgValue } from '../lib/types.js'
import type { CodegenConfig, OaConfig } from '../../config.js'
import type { OutputOptions } from '../../types.js'
import { generateComponents } from '../../generator.js'
import { bool, optStr } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import type { StandaloneGuardGeneratorOptions } from '../../standalone-guards/types.js'
import { loadOaConfig, resolveProfileTarget } from '../lib/config-loader.js'
import { projectTargetSpec, projectTargetGuards, type TargetSpecProjectionResult } from '../../spec-projector.js'

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
  },
  async run(args, context) {
    const target = optStr(args, 'target')
    const drizzlePath = optStr(args, 'drizzle-schema')
    const configPath = optStr(args, 'config')
    const inputPath = optStr(args, 'input')

    // 1. Explicit single-target flags
    if (target === 'standalone-guards' || (inputPath && !drizzlePath && !configPath)) {
      await runStandaloneGuards(args)
      return
    }
    if (drizzlePath) {
      await runDrizzle(drizzlePath, args)
      return
    }

    // 2. Config-driven execution (via explicit --config or no-arg discovery)
    const loaded = await loadOaConfig({
      ...(configPath ? { configPath } : {}),
      ...(context?.cwd !== undefined ? { cwd: context.cwd } : {}),
      ...(context?.projectRoot !== undefined ? { explicitRoot: context.projectRoot } : {}),
    })

    if (loaded) {
      // Check if loaded config is extended OaConfig with specs or guards
      if (loaded.config.specs || loaded.config.guards) {
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
  const specs = config.specs ?? []
  const specResults: TargetSpecProjectionResult[] = []

  console.log('\n🚀 [oa-gen generate] Executing Declarative Spec Pipeline...')
  console.log(`   Project Root: ${rootDir}\n`)

  // Step A: Iterate over each profile target spec
  for (const target of specs) {
    const resolved = resolveProfileTarget(target, rootDir)
    await mkdir(resolved.resolvedOutDir, { recursive: true })

    const result = await projectTargetSpec(target, rootDir)
    await writeFile(result.openApiPath, JSON.stringify(result.openApiDoc, null, 2) + '\n', 'utf8')
    await writeFile(result.jsonSchemaPath, JSON.stringify(result.jsonSchemaDoc, null, 2) + '\n', 'utf8')

    specResults.push(result)
  }

  // Step B: Generate standalone type guards if configured
  let guardSummary: string | undefined
  if (config.guards) {
    const guardRes = await projectTargetGuards(config.guards, specResults, rootDir)
    guardSummary = `${guardRes.artifacts.length} guard artifacts (${guardRes.guardCount} types) -> ${relative(rootDir, guardRes.outDir)}`
  }

  // Step C: Formatted Summary
  console.log('================================================================================')
  console.log('                    OA-SDK GENERATE: SPEC & GUARD SUMMARY                       ')
  console.log('================================================================================')
  console.log(`Specs Processed: ${specResults.length}`)
  for (const res of specResults) {
    const relOpenApi = relative(rootDir, res.openApiPath)
    const relSchema = relative(rootDir, res.jsonSchemaPath)
    const opInfo = res.operationCount > 0 ? `${res.operationCount} ops, ` : ''
    const titleInfo = res.target.title ? `(${res.target.title}) ` : ''
    console.log(` ✅ ${res.target.id.padEnd(20)} [${res.target.profile.padEnd(18)}] ${titleInfo}-> ${opInfo}${res.schemaCount} schemas`)
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

async function runStandaloneGuards(args: Args): Promise<void> {
  const input = optStr(args, 'input') ?? optStr(args, 'config')
  if (!input) {
    console.error('오류: --input <파일 경로> 옵션이 필요합니다')
    throw new CliExitError(1)
  }

  const outDir = optStr(args, 'out-dir') ?? optStr(args, 'output') ?? '.'
  const typeImport = optStr(args, 'type-import')
  const moduleFormat = optStr(args, 'module-format') as 'esm' | undefined
  const split = bool(args, 'split')
  const schemasRaw = optStr(args, 'schemas')
  const schemas = schemasRaw
    ? schemasRaw.split(',').map(s => s.trim()).filter(Boolean)
    : undefined

  const resolvedInput = resolve(process.cwd(), input)
  if (!existsSync(resolvedInput)) {
    console.error(`오류: 입력 파일을 찾을 수 없습니다: ${resolvedInput}`)
    throw new CliExitError(1)
  }

  let schemaDocument: Record<string, unknown>
  try {
    const raw = await readFile(resolvedInput, 'utf8')
    if (resolvedInput.endsWith('.yaml') || resolvedInput.endsWith('.yml')) {
      schemaDocument = parseYaml(raw) as Record<string, unknown>
    } else {
      schemaDocument = JSON.parse(raw) as Record<string, unknown>
    }
  } catch (err) {
    console.error(`오류: 스키마 파일 파싱 실패: ${resolvedInput}\n${err instanceof Error ? err.message : String(err)}`)
    throw new CliExitError(1)
  }

  const { generateStandaloneGuards } = await import('../../standalone-guards/index.js')
  const generatorOptions: StandaloneGuardGeneratorOptions = {
    schemaDocument,
    outDir: resolve(process.cwd(), outDir),
    moduleFormat: moduleFormat ?? 'esm',
    split,
    schemas,
  }
  if (typeImport !== undefined) {
    generatorOptions.typeImportSpecifier = typeImport
  }

  const artifacts = await generateStandaloneGuards(generatorOptions)

  console.log(`✅ ${artifacts.length}개 가드 아티팩트 생성 완료:`)
  for (const artifact of artifacts) {
    console.log(`   ${artifact.filePath}`)
  }
}

async function runDrizzle(schemaPath: string, args: Args): Promise<void> {
  const { generateFromDrizzle } = await import('../../drizzle/index.js')
  const output = optStr(args, 'output') ?? '.'
  const mergeInto = optStr(args, 'merge-into')
  const schemaTypes = optStr(args, 'schemas')?.split(',').map(s => s.trim()) as
    Array<'select' | 'insert' | 'update'> | undefined

  const options: Parameters<typeof generateFromDrizzle>[0] = { schemaPath, output }
  if (schemaTypes) options.schemas = schemaTypes
  if (mergeInto) { options.mergeIntoSpec = true; options.specPath = mergeInto }

  const result = await generateFromDrizzle(options)

  if (result.components.length === 0) {
    console.warn('⚠️  Drizzle 테이블을 찾을 수 없습니다.')
    throw new CliExitError(1)
  }

  console.log(`✅ ${result.components.length}개 스키마, ${result.files.length}개 파일 생성:`)
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
