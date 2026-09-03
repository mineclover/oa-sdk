import type { ParseArgsConfig } from 'node:util'

type OptionConfig = NonNullable<ParseArgsConfig['options']>[string]
export type CommandArgValue = string | boolean | string[] | boolean[] | undefined

/** 커맨드별 옵션 정의 — parseArgs options + required/description 확장 */
export interface OptionDef extends OptionConfig {
  description: string
  required?: boolean
}

/** 실행 컨텍스트 (루트 디렉토리 및 호출 cwd) */
export interface CommandContext {
  projectRoot: string
  cwd: string
}

/** 커맨드 정의 */
export interface Command {
  name: string
  description: string
  options: Record<string, OptionDef>
  run(args: Record<string, CommandArgValue>, context?: CommandContext): Promise<void>
}

