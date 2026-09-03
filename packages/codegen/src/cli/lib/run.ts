import { parseArgs } from 'node:util'
import { findProjectRoot } from '@oa-sdk/core'
import type { Command, CommandArgValue, CommandContext, OptionDef } from './types.js'
import { CliExitError } from './errors.js'
import { generateCommandHelp } from './help.js'

export interface GlobalCliOptions {
  root?: string
  'project-root'?: string
}

export const GLOBAL_OPTIONS: Record<string, OptionDef> = {
  root: {
    type: 'string',
    description: 'Explicit project root directory (overrides automatic discovery)',
  },
  'project-root': {
    type: 'string',
    description: 'Explicit project root directory (alias for --root)',
  },
}

/**
 * 커맨드를 parseArgs로 파싱하고 실행.
 * 글로벌 --root / --project-root 가로채기, projectRoot 해석, required 옵션 검증,
 * 그리고 process.chdir(projectRoot) try/finally 경로 스코핑 포함.
 */
export async function runCommand(cmd: Command, argv: string[]): Promise<void> {
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      console.log(generateCommandHelp(cmd))
      return
    }

    // 1. parseArgs options 구성 (GLOBAL_OPTIONS + cmd.options 결합, cmd.options 우선)
    const parseOptions: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }> = {}
    for (const [key, opt] of Object.entries(GLOBAL_OPTIONS)) {
      parseOptions[key] = {
        type: opt.type,
        ...(opt.short ? { short: opt.short } : {}),
        ...(opt.multiple ? { multiple: opt.multiple } : {}),
      }
    }
    for (const [key, opt] of Object.entries(cmd.options)) {
      parseOptions[key] = {
        type: opt.type,
        ...(opt.short ? { short: opt.short } : {}),
        ...(opt.multiple ? { multiple: opt.multiple } : {}),
      }
    }

    const { values } = parseArgs({ args: argv, options: parseOptions, allowPositionals: false })

    // 2. required 검증 (커맨드 옵션 대상만)
    for (const [key, opt] of Object.entries(cmd.options)) {
      if (opt.required && values[key] === undefined) {
        throw new Error(`--${key} 옵션이 필요합니다 (${opt.description})`)
      }
    }

    // 3. projectRoot 해석 (scaffold-governance 예외 처리)
    const explicitRoot = (values['project-root'] as string | undefined)
      ?? (cmd.name === 'scaffold-governance' ? undefined : (values.root as string | undefined))

    if (explicitRoot !== undefined && explicitRoot.trim() === '') {
      throw new Error('--root 또는 --project-root 값은 비어 있을 수 없습니다.')
    }

    const invocationCwd = process.cwd()
    const projectRoot = findProjectRoot({
      cwd: invocationCwd,
      ...(explicitRoot !== undefined ? { explicitRoot } : {}),
    })


    // 4. values 및 context 에 projectRoot 주입
    values['project-root'] = projectRoot
    if (cmd.name !== 'scaffold-governance' || values.root === undefined) {
      values.root = projectRoot
    }
    values.projectRoot = projectRoot

    const context: CommandContext = {
      projectRoot,
      cwd: invocationCwd,
    }

    // 5. 2계층 경로 해석: process.chdir(projectRoot) + try/finally 원복
    const originalCwd = process.cwd()
    try {
      process.chdir(projectRoot)
      await cmd.run(values as Record<string, CommandArgValue>, context)
    } finally {
      try {
        process.chdir(originalCwd)
      } catch {
        // 원래 cwd가 삭제된 경우 방어
      }
    }
  } catch (err) {
    if (err instanceof CliExitError) {
      process.exitCode = err.exitCode
      return
    }
    console.error(`${cmd.name} 오류: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
