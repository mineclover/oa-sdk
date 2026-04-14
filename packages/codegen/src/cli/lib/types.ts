import type { ParseArgsConfig } from 'node:util'

type OptionConfig = NonNullable<ParseArgsConfig['options']>[string]

/** 커맨드별 옵션 정의 — parseArgs options + required/description 확장 */
export interface OptionDef extends OptionConfig {
  description: string
  required?: boolean
}

/** 커맨드 정의 */
export interface Command {
  name: string
  description: string
  options: Record<string, OptionDef>
  run(args: Record<string, string | boolean | undefined>): Promise<void>
}
