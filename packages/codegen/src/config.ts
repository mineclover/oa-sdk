import type { z } from 'zod'
import type { OutputOptions } from './types.js'

export type CodegenConfig = OutputOptions & {
  /** 변환할 Zod 스키마 맵 (이름 → ZodTypeAny) */
  schemas: Record<string, z.ZodTypeAny>
}

/** codegen.config.ts에서 타입 안전하게 설정을 정의합니다. */
export function defineConfig(config: CodegenConfig): CodegenConfig {
  return config
}
