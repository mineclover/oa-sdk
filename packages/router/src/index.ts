/**
 * @oa-sdk/router — OAS → 서버 라우터 스텁 및 핸들러 계약 생성
 *
 * 사용 예시:
 *   import { generateRouter, generateHandlerContract } from '@oa-sdk/router'
 *   const contract = generateHandlerContract(spec, { typesImport: './types' })
 *   const code = generateRouter(spec, { target: 'fastify', contractImport: './api.contract' })
 */
export { generateRouter, generateHandlerContract } from './generate-router.js'
export type {
  RouterTarget,
  RouterMode,
  RouterOptions,
  RouterRenderOptions,
  HandlerContractOptions,
} from './generate-router.js'
