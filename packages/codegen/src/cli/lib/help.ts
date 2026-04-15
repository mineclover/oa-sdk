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

  // 커맨드별 옵션을 모으되, 같은 flag가 다른 의미로 쓰이면 커맨드 scope를 표시한다.
  const seen = new Map<string, {
    flag: string
    descriptions: Map<string, string[]>
  }>()
  for (const cmd of commands) {
    for (const [key, opt] of Object.entries(cmd.options)) {
      const flag = opt.short ? `--${key}, -${opt.short}` : `--${key}`
      const entry = seen.get(key) ?? { flag, descriptions: new Map<string, string[]>() }
      const commandsForDescription = entry.descriptions.get(opt.description)
      if (commandsForDescription) {
        commandsForDescription.push(cmd.name)
      } else {
        entry.descriptions.set(opt.description, [cmd.name])
      }
      seen.set(key, entry)
    }
  }
  for (const entry of seen.values()) {
    if (entry.descriptions.size === 1) {
      const [description] = entry.descriptions.keys()
      lines.push(`  ${entry.flag.padEnd(24)} ${description}`)
      continue
    }

    for (const [description, commandNames] of entry.descriptions) {
      lines.push(`  ${entry.flag.padEnd(24)} [${commandNames.join(', ')}] ${description}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
