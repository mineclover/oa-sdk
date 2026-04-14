import type { Command } from './types.js'

/** Command 정의 배열에서 help 텍스트 자동 생성 */
export function generateHelp(commands: Command[]): string {
  const lines: string[] = [
    '',
    'oa-gen — OpenAPI code generator',
    '',
    'Commands:',
  ]

  for (const cmd of commands) {
    const opts = Object.entries(cmd.options)
      .filter(([, o]) => o.required)
      .map(([k, o]) => `--${k}${o.short ? `, -${o.short}` : ''} <${k}>`)
      .join(' ')
    lines.push(`  oa-gen ${cmd.name.padEnd(10)} ${opts.padEnd(40)} ${cmd.description}`)
  }

  lines.push('  oa-gen --help                                              도움말')
  lines.push('')
  lines.push('Option details:')

  // 커맨드별 옵션 모아서 중복 제거
  const seen = new Map<string, string>()
  for (const cmd of commands) {
    for (const [key, opt] of Object.entries(cmd.options)) {
      if (!seen.has(key)) {
        const flag = opt.short ? `--${key}, -${opt.short}` : `--${key}`
        seen.set(key, `  ${flag.padEnd(24)} ${opt.description}`)
      }
    }
  }
  for (const line of seen.values()) lines.push(line)

  lines.push('')
  return lines.join('\n')
}
