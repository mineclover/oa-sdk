import { parseArgs } from 'node:util'
import type { Command, CommandArgValue } from './types.js'
import { CliExitError } from './errors.js'
import { generateCommandHelp } from './help.js'

/**
 * 커맨드를 parseArgs로 파싱하고 실행.
 * required 옵션 검증 + 에러 래핑 포함.
 */
export async function runCommand(cmd: Command, argv: string[]): Promise<void> {
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      console.log(generateCommandHelp(cmd))
      return
    }

    // parseArgs options 구성 (확장 필드 제거)
    const parseOptions: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }> = {}
    for (const [key, opt] of Object.entries(cmd.options)) {
      parseOptions[key] = {
        type: opt.type,
        ...(opt.short ? { short: opt.short } : {}),
        ...(opt.multiple ? { multiple: opt.multiple } : {}),
      }
    }

    const { values } = parseArgs({ args: argv, options: parseOptions, allowPositionals: false })

    // required 검증
    for (const [key, opt] of Object.entries(cmd.options)) {
      if (opt.required && values[key] === undefined) {
        throw new Error(`--${key} 옵션이 필요합니다 (${opt.description})`)
      }
    }

    await cmd.run(values as Record<string, CommandArgValue>)
  } catch (err) {
    if (err instanceof CliExitError) {
      process.exitCode = err.exitCode
      return
    }
    console.error(`${cmd.name} 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
