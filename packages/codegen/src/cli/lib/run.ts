import { parseArgs } from 'node:util'
import type { Command } from './types.js'

/**
 * 커맨드를 parseArgs로 파싱하고 실행.
 * required 옵션 검증 + 에러 래핑 포함.
 */
export async function runCommand(cmd: Command, argv: string[]): Promise<void> {
  // parseArgs options 구성 (확장 필드 제거)
  const parseOptions: Record<string, { type: 'string' | 'boolean'; short?: string }> = {}
  for (const [key, opt] of Object.entries(cmd.options)) {
    parseOptions[key] = { type: opt.type, ...(opt.short ? { short: opt.short } : {}) }
  }

  const { values } = parseArgs({ args: argv, options: parseOptions, allowPositionals: false })

  // required 검증
  for (const [key, opt] of Object.entries(cmd.options)) {
    if (opt.required && values[key] === undefined) {
      console.error(`오류: --${key} 옵션이 필요합니다 (${opt.description})`)
      process.exit(1)
    }
  }

  try {
    await cmd.run(values as Record<string, string | boolean | undefined>)
  } catch (err) {
    console.error(`${cmd.name} 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
