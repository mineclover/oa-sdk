#!/usr/bin/env node
/**
 * oa-gen CLI — OpenAPI code generator
 *
 * 커맨드 모듈 기반 디스패치. 각 커맨드는 commands/*.ts에 정의.
 */

import { runCommand } from './lib/run.js'
import { generateHelp } from './lib/help.js'
import { commands } from './commands.js'
import { tspDiff } from './commands/tsp-diff.js'
import { mock } from './commands/mock.js'

const commandList = [...commands]
if (!commandList.some(c => c.name === 'tsp diff')) {
  commandList.push(tspDiff)
}
if (!commandList.some(c => c.name === 'mock')) {
  commandList.push(mock)
}

const commandMap = new Map(commandList.map(c => [c.name, c]))
commandMap.set('tsp diff', tspDiff)
commandMap.set('tsp-diff', tspDiff)
commandMap.set('tsp:diff', tspDiff)
commandMap.set('mock', mock)


// ── 디스패치 ────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)

  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    console.log(generateHelp(commandList))
    return
  }

  // Pre-parse global options if passed before subcommand
  // e.g. `oa-gen --root /repo generate` or `oa-gen --project-root=/repo validate`
  let commandIndex = -1
  const leadingGlobalArgs: string[] = []
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (!arg) break
    if (arg === '--root' || arg === '--project-root') {
      leadingGlobalArgs.push(arg)
      const nextArg = rawArgs[i + 1]
      if (nextArg && !nextArg.startsWith('-')) {
        leadingGlobalArgs.push(nextArg)
        i++
      }
    } else if (arg.startsWith('--root=') || arg.startsWith('--project-root=')) {
      leadingGlobalArgs.push(arg)
    } else if (!arg.startsWith('-')) {
      commandIndex = i
      break
    } else {
      break
    }
  }

  // If no subcommand was found in arguments
  if (commandIndex === -1) {
    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
      console.log(generateHelp(commandList))
      return
    }
    const fallbackName = rawArgs[0] ?? ''
    const fallbackCmd = fallbackName ? commandMap.get(fallbackName) : undefined
    if (!fallbackCmd) {
      console.error(`알 수 없는 커맨드: ${fallbackName}`)
      console.error('oa-gen --help 로 도움말을 확인하세요')
      process.exitCode = 1
      return
    }
  }

  let commandName = (commandIndex !== -1 ? rawArgs[commandIndex] : rawArgs[0]) ?? ''
  let consumedTokens = 1

  // Multi-token lookahead for compound commands like `tsp diff`
  const nextToken = commandIndex !== -1 ? rawArgs[commandIndex + 1] : undefined
  if (commandIndex !== -1 && nextToken && !nextToken.startsWith('-')) {
    const compoundCandidate = `${rawArgs[commandIndex]} ${nextToken}`
    if (commandMap.has(compoundCandidate)) {
      commandName = compoundCandidate
      consumedTokens = 2
    }
  }

  if (!commandName || commandName === '--help' || commandName === '-h') {
    console.log(generateHelp(commandList))
    return
  }

  const cmd = commandMap.get(commandName)
  if (!cmd) {
    console.error(`알 수 없는 커맨드: ${commandName}`)
    console.error('oa-gen --help 로 도움말을 확인하세요')
    process.exitCode = 1
    return
  }

  const commandArgs = [
    ...rawArgs.slice(commandIndex + consumedTokens),
    ...leadingGlobalArgs,
  ]

  await runCommand(cmd, commandArgs)
}

try {
  await main()
} catch (error) {
  console.error(`oa-gen 오류: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
