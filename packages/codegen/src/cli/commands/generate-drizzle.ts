import type { Command, CommandArgValue } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'

type Args = Record<string, CommandArgValue>

function printWarnings(warnings: string[]): void {
  if (warnings.length > 0) {
    console.warn('\n경고:')
    for (const w of warnings) console.warn(`  ⚠️  ${w}`)
  }
}

export async function runDrizzle(schemaPath: string, args: Args): Promise<void> {
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

export const generateDrizzleCommand: Command = {
  name: 'generate:drizzle',
  description: 'Drizzle ORM 스키마 파일로부터 OpenAPI 3.2 스키마 컴포넌트 생성',
  options: {
    'drizzle-schema': { type: 'string', short: 'd', required: true, description: 'Drizzle 스키마 파일 (.ts) 경로' },
    output: { type: 'string', short: 'o', description: '출력 디렉토리 (기본: .)' },
    'merge-into': { type: 'string', description: '기존 spec.yaml 파일에 병합' },
    schemas: { type: 'string', description: '생성 대상 필터 (select,insert,update 쉼표 구분)' },
  },
  async run(args) {
    const drizzlePath = str(args, 'drizzle-schema')
    await runDrizzle(drizzlePath, args)
  },
}
