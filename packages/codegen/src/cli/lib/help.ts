import type { Command } from './types.js'

interface CategorySpec {
  title: string
  names: string[]
}

const CATEGORIES: CategorySpec[] = [
  {
    title: 'Core Code Generation',
    names: ['init', 'generate', 'generate:client', 'generate:tanstack', 'generate:zod', 'generate:guards', 'generate:drizzle', 'typegen'],
  },
  {
    title: 'Validation & Audit',
    names: ['validate', 'lint', 'audit:csp', 'audit:shape', 'mock'],
  },
  {
    title: 'Diff & Freshness',
    names: ['diff', 'drift:check', 'check-artifact', 'drift:live', 'drift'],
  },
  {
    title: 'Spec Pipeline',
    names: [
      'build-spec',
      'normalize',
      'upgrade',
      'collect',
      'tsp-export',
      'tsp-restore',
      'tsp-bundle-check',
      'tsp diff',
      'tsp-scaffold',
      'reference-check',
    ],
  },
  {
    title: 'Advanced & Governance',
    names: [
      'scaffold-governance',
      'inventory',
      'behavior-query',
      'duplicate-review',
      'target-check',
      'review',
      'review-bundle',
      'parallel-evidence',
    ],
  },
]

function formatCommandLine(cmd: Command): string {
  const opts = Object.entries(cmd.options)
    .filter(([, o]) => o.required)
    .map(([k, o]) => `--${k}${o.short ? `, -${o.short}` : ''} <${k}>`)
    .join(' ')
  return `  oa-gen ${cmd.name.padEnd(20)} ${opts.padEnd(40)} ${cmd.description}`
}

/** Command 정의 배열에서 help 텍스트 자동 생성 */
export function generateHelp(commands: Command[]): string {
  const lines: string[] = [
    '',
    'oa-gen — OpenAPI code generator',
    '',
  ]

  const commandMap = new Map(commands.map(cmd => [cmd.name, cmd]))
  const rendered = new Set<string>()

  for (const cat of CATEGORIES) {
    const catCommands = cat.names
      .map(name => commandMap.get(name))
      .filter((c): c is Command => c !== undefined)

    if (catCommands.length > 0) {
      lines.push(`${cat.title}:`)
      for (const cmd of catCommands) {
        lines.push(formatCommandLine(cmd))
        rendered.add(cmd.name)
      }
      lines.push('')
    }
  }

  // Any remaining commands not covered in predefined categories
  const remaining = commands.filter(c => !rendered.has(c.name))
  if (remaining.length > 0) {
    lines.push('Other Commands:')
    for (const cmd of remaining) {
      lines.push(formatCommandLine(cmd))
    }
    lines.push('')
  }

  lines.push('General:')
  lines.push('  oa-gen --help, -h                                         도움말')
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

/** 단일 명령의 usage와 옵션을 출력합니다. */
export function generateCommandHelp(command: Command): string {
  const required = Object.entries(command.options)
    .filter(([, option]) => option.required)
    .map(([name, option]) => `--${name}${option.short ? `, -${option.short}` : ''} <${name}>`)
    .join(' ')
  const lines = [
    `oa-gen ${command.name}${required ? ` ${required}` : ''} [options]`,
    '',
    command.description,
    '',
    'Options:',
  ]
  for (const [name, option] of Object.entries(command.options)) {
    const value = option.type === 'boolean' ? '' : ` <${name}>`
    const requiredLabel = option.required ? ' (required)' : ''
    lines.push(`  --${name}${option.short ? `, -${option.short}` : ''}${value}${requiredLabel}`)
    lines.push(`      ${option.description}`)
  }
  lines.push('  --help, -h')
  lines.push('      Show this command help.')
  return lines.join('\n')
}
