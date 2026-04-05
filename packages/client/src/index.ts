/**
 * @oa-sdk/client — OAS → fetch 기반 타입 안전 클라이언트 SDK
 *
 * 사용 예시:
 *   import { generateClient } from '@oa-sdk/client'
 *   const code = generateClient(spec, { typesImport: './types' })
 */
export { generateClient } from './generate-client.js'
export type { ClientOptions } from './generate-client.js'
