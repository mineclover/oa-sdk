import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { Command, CommandArgValue } from '../lib/types.js'
import type { CodegenConfig } from '../../config.js'
import type { OutputOptions } from '../../types.js'
import { generateComponents } from '../../generator.js'
import { optStr } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'

export const generate: Command = {
  name: 'generate',
  description: 'Config/Drizzle 기반 스키마 생성',
  options: {
    config:           { type: 'string', short: 'c', description: 'codegen.config.mjs 파일 경로' },
    'drizzle-schema': { type: 'string', short: 'd', description: 'Drizzle 스키마 파일 경로' },
    output:           { type: 'string', short: 'o', description: '출력 디렉토리 (기본: .)' },
    'merge-into':     { type: 'string', description: '기존 spec.yaml에 병합' },
    schemas:          { type: 'string', description: '생성 타입 (select,insert,update)' },
  },
  async run(args) {
    const drizzlePath = optStr(args, 'drizzle-schema')
    const configPath = optStr(args, 'config')

    if (drizzlePath) {
      await runDrizzle(drizzlePath, args)
    } else if (configPath) {
      await runConfig(configPath, args)
    } else {
      console.error('오류: --config 또는 --drizzle-schema 옵션이 필요합니다')
      throw new CliExitError(1)
    }
  },
}

type Args = Record<string, CommandArgValue>

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
