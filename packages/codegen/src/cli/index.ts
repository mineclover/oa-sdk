#!/usr/bin/env node
/**
 * oa-gen CLI — OpenAPI code generator
 *
 * 커맨드 모듈 기반 디스패치. 각 커맨드는 commands/*.ts에 정의.
 */

import { runCommand } from './lib/run.js'
import { generateHelp } from './lib/help.js'
import { commands } from './commands.js'

const commandMap = new Map(commands.map(c => [c.name, c]))

// ── 디스패치 ────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const commandName = args[0]

  if (!commandName || commandName === '--help' || commandName === '-h') {
    console.log(generateHelp(commands))
    return
  }

  const cmd = commandMap.get(commandName)
  if (!cmd) {
    console.error(`알 수 없는 커맨드: ${commandName}`)
    console.error('oa-gen --help 로 도움말을 확인하세요')
    process.exitCode = 1
    return
  }

  await runCommand(cmd, args.slice(1))
}

try {
  await main()
} catch (error) {
  console.error(`oa-gen 오류: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
