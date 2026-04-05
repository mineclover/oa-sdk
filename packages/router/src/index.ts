/**
 * @oa-sdk/router — OAS → 서버 라우터 스텁 생성
 *
 * 사용 예시:
 *   import { generateRouter } from '@oa-sdk/router'
 *   const code = generateRouter(spec, { target: 'hono', typesImport: './types' })
 */
export { generateRouter } from './generate-router.js'
export type { RouterTarget, RouterOptions } from './generate-router.js'
