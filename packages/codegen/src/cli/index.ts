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

const args = process.argv.slice(2)
const commandName = args[0]

if (!commandName || commandName === '--help' || commandName === '-h') {
  console.log(generateHelp(commands))
  process.exit(0)
}

const cmd = commandMap.get(commandName)
if (!cmd) {
  console.error(`알 수 없는 커맨드: ${commandName}`)
  console.error('oa-gen --help 로 도움말을 확인하세요')
  process.exit(1)
}

await runCommand(cmd, args.slice(1))
