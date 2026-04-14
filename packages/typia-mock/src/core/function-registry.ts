/**
 * Function registry — ILlmApplication 함수 조회 헬퍼.
 */

import type { ILlmApplication, ILlmFunction, FunctionInfo } from '../types.js'

/** 사용 가능한 모든 함수 목록 + 스키마 (GET /functions 용) */
export function listFunctions(app: ILlmApplication): FunctionInfo[] {
  return app.functions.map((fn) => ({
    name: fn.name,
    description: fn.description,
    parameters: fn.parameters,
    output: fn.output,
  }))
}

/** 이름으로 함수 조회 */
export function getFunction(app: ILlmApplication, name: string): ILlmFunction | undefined {
  return app.functions.find((f) => f.name === name)
}
