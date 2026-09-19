import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import type { Command, CommandArgValue } from '../lib/types.js'
import { bool, optStr } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import type { StandaloneGuardGeneratorOptions } from '../../standalone-guards/types.js'

type Args = Record<string, CommandArgValue>

export async function runStandaloneGuards(args: Args): Promise<void> {
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
    if (resolvedInput.endsWith('.tsp')) {
      const { compileTypeSpecInMemory } = await import('../lib/typespec-mock-compiler.js')
      const compiled = await compileTypeSpecInMemory(resolvedInput)
      schemaDocument = compiled.document as unknown as Record<string, unknown>
    } else {
      const raw = await readFile(resolvedInput, 'utf8')
      if (resolvedInput.endsWith('.yaml') || resolvedInput.endsWith('.yml')) {
        schemaDocument = parseYaml(raw) as Record<string, unknown>
      } else {
        schemaDocument = JSON.parse(raw) as Record<string, unknown>
      }
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

export const generateGuardsCommand: Command = {
  name: 'generate:guards',
  description: 'OpenAPI 3.1/3.2 또는 TypeSpec(.tsp)으로부터 독립형 무런타임 타입 가드(Standalone Type Guards) 생성',
  options: {
    input: { type: 'string', short: 'i', required: true, description: '입력 스키마 또는 OpenAPI spec (.yaml, .json, .tsp) 파일 경로' },
    'out-dir': { type: 'string', short: 'o', description: '출력 디렉토리 경로 (기본: .)' },
    output: { type: 'string', description: '--out-dir 별칭' },
    'type-import': { type: 'string', description: 'TypeScript 타입 import 지정자 (예: @oa-sdk/models)' },
    'module-format': { type: 'string', description: '모듈 포맷 (esm)' },
    split: { type: 'boolean', description: '개별 가드 모듈 분할 생성 (guards/<TypeName>.js)' },
    schemas: { type: 'string', description: '생성 대상 컴포넌트/가드명 목록 (쉼표 구분)' },
  },
  async run(args) {
    await runStandaloneGuards(args)
  },
}
