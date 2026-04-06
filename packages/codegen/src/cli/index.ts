#!/usr/bin/env node
/**
 * oa-gen CLI
 *
 * 사용법:
 *   oa-gen generate --config ./codegen.config.mjs
 *   oa-gen generate --drizzle-schema ./src/db/schema.ts --output ./output/
 */

import { parseArgs } from 'node:util'
import { resolve, join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, watch } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { generateComponents } from '../generator.js'
import type { CodegenConfig } from '../config.js'
import type { OutputOptions } from '../types.js'

const HELP = `
oa-gen — OpenAPI code generator

Commands:
  oa-gen generate --config <path>                        Config file 기반 스키마 생성
  oa-gen generate --drizzle-schema <path> --output <dir> Drizzle 스키마 직접 생성
  oa-gen typegen  --spec <path> --output <path>          OAS spec → TypeScript 타입
  oa-gen router   --spec <path> --output <path>          OAS spec → 라우터 스텁
  oa-gen client   --spec <path> --output <path>          OAS spec → 클라이언트 SDK
  oa-gen dev      --spec <path> --output <dir>           Watch mode — spec 변경 시 자동 재생성
  oa-gen lint     --spec <path>                          OAS 3.2 스펙 린트
  oa-gen validate --spec <path>                          종합 검증 (파싱 + 린트 + 3.1 호환)
  oa-gen --help                                          도움말

Common options:
  --spec, -s            OAS spec 파일 경로 (YAML/JSON)
  --output, -o          출력 파일/디렉토리 경로 (기본: stdout)
  --style               type | interface (typegen, 기본: type)
  --target              hono | express (router, 기본: hono)
  --types-import        typegen 타입 import 경로 (router/client)

Generate options:
  --config, -c          codegen.config.mjs 파일 경로
  --drizzle-schema, -d  Drizzle 스키마 파일 경로 (.ts/.js)
  --merge-into <path>   기존 spec.yaml에 병합
  --schemas             생성할 타입 (select,insert,update)

Config file (codegen.config.mjs):
  import { defineConfig } from '@oa-sdk/codegen'
  import { z } from 'zod'

  export default defineConfig({
    mergeIntoSpec: true,
    specPath: './packages/schemas/src/domains/users/spec.yaml',
    schemas: {
      User: z.object({ id: z.string().uuid(), name: z.string() }),
    },
  })
`

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: 'string', short: 'c' },
    'drizzle-schema': { type: 'string', short: 'd' },
    spec: { type: 'string', short: 's' },
    output: { type: 'string', short: 'o' },
    'merge-into': { type: 'string' },
    schemas: { type: 'string' },
    style: { type: 'string' },
    target: { type: 'string' },
    'types-import': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
})

if (values.help) {
  console.log(HELP)
  process.exit(0)
}

const command = positionals[0]

if (command === 'validate') {
  await runValidateMode()
} else if (command === 'lint') {
  await runLintMode()
} else if (command === 'typegen') {
  await runTypegenMode()
} else if (command === 'router') {
  await runCodegenMode('router')
} else if (command === 'client') {
  await runCodegenMode('client')
} else if (command === 'dev') {
  await runDevMode()
} else if (command === 'generate') {
  const drizzleSchemaPath = values['drizzle-schema']
  if (drizzleSchemaPath) {
    await runDrizzleMode(drizzleSchemaPath)
  } else {
    await runConfigMode()
  }
} else {
  console.error(`알 수 없는 커맨드: ${command ?? '(없음)'}`)
  console.error('oa-gen --help 로 도움말을 확인하세요')
  process.exit(1)
}

async function runDrizzleMode(schemaPath: string): Promise<void> {
  const { generateFromDrizzle } = await import('../drizzle/index.js')
  const output = values.output ?? '.'
  const mergeInto = values['merge-into']
  const schemaTypes = values.schemas?.split(',').map(s => s.trim()) as
    Array<'select' | 'insert' | 'update'> | undefined

  try {
    const options: Parameters<typeof generateFromDrizzle>[0] = {
      schemaPath,
      output,
    }
    if (schemaTypes !== undefined) options.schemas = schemaTypes
    if (mergeInto !== undefined) {
      options.mergeIntoSpec = true
      options.specPath = mergeInto
    }

    const result = await generateFromDrizzle(options)

    if (result.components.length === 0) {
      console.warn('⚠️  스키마 파일에서 Drizzle 테이블을 찾을 수 없습니다.')
      process.exit(1)
    }

    console.log(`✅ ${result.components.length}개 스키마, ${result.files.length}개 파일 생성:`)
    for (const file of result.files) {
      console.log(`   ${file}`)
    }

    printWarnings(result.warnings)
  } catch (err) {
    console.error(`Drizzle 스키마 처리 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function runConfigMode(): Promise<void> {
  const configPath = values.config
  if (!configPath) {
    console.error('오류: --config 또는 --drizzle-schema 옵션이 필요합니다')
    process.exit(1)
  }

  const resolvedConfig = resolve(process.cwd(), configPath)
  if (!existsSync(resolvedConfig)) {
    console.error(`오류: 설정 파일을 찾을 수 없습니다: ${resolvedConfig}`)
    process.exit(1)
  }

  try {
    const mod = await import(resolvedConfig) as { default?: CodegenConfig } | CodegenConfig
    const config: CodegenConfig = (mod as { default?: CodegenConfig }).default ?? (mod as CodegenConfig)

    if (!config?.schemas) {
      console.error('오류: 설정 파일에 schemas 필드가 없습니다')
      process.exit(1)
    }

    const genOptions: OutputOptions = {
      output: values.output ?? config.output ?? '.',
    }
    if (config.grouping !== undefined) genOptions.grouping = config.grouping
    if (config.filename !== undefined) genOptions.filename = config.filename
    if (config.mergeIntoSpec !== undefined) genOptions.mergeIntoSpec = config.mergeIntoSpec
    if (config.specPath !== undefined) genOptions.specPath = config.specPath

    const result = generateComponents(config.schemas, genOptions)

    console.log(`✅ ${result.files.length}개 파일 생성 완료:`)
    for (const file of result.files) {
      console.log(`   ${file}`)
    }

    printWarnings(result.warnings)
  } catch (err) {
    console.error(`설정 파일 로드 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

function printWarnings(warnings: string[]): void {
  if (warnings.length > 0) {
    console.warn('\n경고:')
    for (const w of warnings) {
      console.warn(`  ⚠️  ${w}`)
    }
  }
}

async function runTypegenMode(): Promise<void> {
  const specPath = values.spec
  if (!specPath) {
    console.error('오류: --spec 옵션이 필요합니다')
    process.exit(1)
  }

  const { generateTypesFromSpec } = await import('../typegen/generate-types.js')
  const resolvedSpec = resolve(process.cwd(), specPath)
  try {
    const raw = readFileSync(resolvedSpec, 'utf8')
    const doc = specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)

    const style = (values.style === 'interface' ? 'interface' : 'type') as 'type' | 'interface'
    const ts = generateTypesFromSpec(doc, { style })

    if (values.output) {
      const outPath = resolve(process.cwd(), values.output)
      writeFileSync(outPath, ts, 'utf8')
      console.log(`✅ TypeScript 타입 생성: ${outPath}`)
    } else {
      process.stdout.write(ts)
    }
  } catch (err) {
    console.error(`typegen 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function runCodegenMode(mode: 'router' | 'client'): Promise<void> {
  const specPath = values.spec
  if (!specPath) {
    console.error(`오류: --spec 옵션이 필요합니다`)
    process.exit(1)
  }

  const resolvedSpec = resolve(process.cwd(), specPath)
  try {
    const raw = readFileSync(resolvedSpec, 'utf8')
    const doc = specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
    const typesImport = values['types-import']

    let code: string
    if (mode === 'router') {
      const { generateRouter } = await import('@oa-sdk/router')
      const target = (values.target === 'express' ? 'express' : 'hono') as 'hono' | 'express'
      const opts: Parameters<typeof generateRouter>[1] = { target }
      if (typesImport !== undefined) opts.typesImport = typesImport
      code = generateRouter(doc, opts)
    } else {
      const { generateClient } = await import('@oa-sdk/client')
      const opts: Parameters<typeof generateClient>[1] = {}
      if (typesImport !== undefined) opts.typesImport = typesImport
      code = generateClient(doc, opts)
    }

    if (values.output) {
      const outPath = resolve(process.cwd(), values.output)
      writeFileSync(outPath, code, 'utf8')
      console.log(`✅ ${mode} 코드 생성: ${outPath}`)
    } else {
      process.stdout.write(code)
    }
  } catch (err) {
    console.error(`${mode} 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function runLintMode(): Promise<void> {
  const specPath = values.spec
  if (!specPath) {
    console.error('오류: --spec 옵션이 필요합니다')
    process.exit(1)
  }

  const { lintDocument } = await import('@oa-sdk/parser')
  const resolvedSpec = resolve(process.cwd(), specPath)
  try {
    const raw = readFileSync(resolvedSpec, 'utf8')
    const doc = specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
    const results = lintDocument(doc)

    const errors = results.filter(r => r.severity === 'error')
    const warnings = results.filter(r => r.severity === 'warning')
    const infos = results.filter(r => r.severity === 'info')

    for (const r of results) {
      const icon = r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${r.rule}] ${r.message}`)
      console.log(`    at ${r.path}`)
    }

    console.log(`\n${errors.length} errors, ${warnings.length} warnings, ${infos.length} infos`)

    if (errors.length > 0) process.exit(1)
  } catch (err) {
    console.error(`lint 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function runValidateMode(): Promise<void> {
  const specPath = values.spec
  if (!specPath) {
    console.error('오류: --spec 옵션이 필요합니다')
    process.exit(1)
  }

  const { validateDocument } = await import('@oa-sdk/parser')
  const resolvedSpec = resolve(process.cwd(), specPath)
  try {
    const raw = readFileSync(resolvedSpec, 'utf8')
    const doc = specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)

    console.log('━━━ Step 1: 파싱 + 구조 검증 ━━━')
    const result = validateDocument(doc)

    for (const r of [...result.errors, ...result.warnings, ...result.infos]) {
      const icon = r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${r.rule}] ${r.message}`)
    }
    console.log(result.summary)

    // Step 2: 3.1 다운그레이드 가능성
    console.log('\n━━━ Step 2: 3.1 호환성 ━━━')
    const version = (doc as Record<string, unknown>)['openapi'] as string
    if (version === '3.2.0') {
      // 3.2 전용 필드 사용 현황
      const rawStr = raw
      const features32 = [
        { name: 'dataValue', count: (rawStr.match(/dataValue/g) ?? []).length },
        { name: 'serializedValue', count: (rawStr.match(/serializedValue/g) ?? []).length },
        { name: 'itemSchema', count: (rawStr.match(/itemSchema/g) ?? []).length },
        { name: 'deviceAuthorization', count: (rawStr.match(/deviceAuthorization/g) ?? []).length },
        { name: 'oauth2MetadataUrl', count: (rawStr.match(/oauth2MetadataUrl/g) ?? []).length },
      ].filter(f => f.count > 0)

      if (features32.length > 0) {
        console.log('  3.2 전용 필드 사용:')
        for (const f of features32) console.log(`    ${f.name}: ${f.count}회`)
        console.log('  → pnpm --filter @oa-sdk/schemas run downgrade:3.1 로 3.1 변환 가능')
      } else {
        console.log('  3.2 전용 필드 미사용 — 3.1과 완전 호환')
      }
    } else {
      console.log(`  이미 OAS ${version} — 3.1 호환`)
    }

    if (!result.valid) process.exit(1)
  } catch (err) {
    console.error(`validate 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function runDevMode(): Promise<void> {
  const specPath = values.spec
  if (!specPath) {
    console.error('오류: --spec 옵션이 필요합니다')
    process.exit(1)
  }

  const output = values.output ?? './generated'
  const resolvedSpec = resolve(process.cwd(), specPath)
  const resolvedOutput = resolve(process.cwd(), output)
  const typesImport = values['types-import'] ?? './types'

  if (!existsSync(resolvedSpec)) {
    console.error(`오류: 스펙 파일을 찾을 수 없습니다: ${resolvedSpec}`)
    process.exit(1)
  }

  const generate = async () => {
    try {
      const raw = readFileSync(resolvedSpec, 'utf8')
      const doc = specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)

      mkdirSync(resolvedOutput, { recursive: true })

      // typegen
      const { generateTypesFromSpec } = await import('../typegen/generate-types.js')
      const style = (values.style === 'interface' ? 'interface' : 'type') as 'type' | 'interface'
      const types = generateTypesFromSpec(doc, { style })
      writeFileSync(join(resolvedOutput, 'types.ts'), types, 'utf8')

      // router
      const { generateRouter } = await import('@oa-sdk/router')
      const target = (values.target === 'express' ? 'express' : 'hono') as 'hono' | 'express'
      const router = generateRouter(doc, { target, typesImport })
      writeFileSync(join(resolvedOutput, 'router.ts'), router, 'utf8')

      // client
      const { generateClient } = await import('@oa-sdk/client')
      const client = generateClient(doc, { typesImport })
      writeFileSync(join(resolvedOutput, 'client.ts'), client, 'utf8')

      console.log(`[oa-gen] generated → ${resolvedOutput}/`)
    } catch (e) {
      console.error('[oa-gen] error:', e)
    }
  }

  await generate()

  console.log(`[oa-gen] watching ${resolvedSpec}...`)
  const watcher = watch(resolvedSpec, { persistent: true }, async (eventType) => {
    if (eventType === 'change') {
      console.log('[oa-gen] spec changed, regenerating...')
      await generate()
    }
  })

  process.on('SIGINT', () => { watcher.close(); process.exit(0) })
}
