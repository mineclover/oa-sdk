# Use Case: 코드젠 워크플로

> Drizzle ORM → OAS spec → TypeScript 타입 → 서버 라우터 → 클라이언트 SDK 전체 파이프라인.

## 시나리오

DB 스키마(Drizzle)에서 시작하여 API 전 계층의 코드를 자동 생성.

## 1. Drizzle → OAS components.yaml

```bash
oa-gen generate --drizzle-schema ./src/db/schema.ts --output ./packages/schemas/src/domains/users/
```

또는 config 파일:

```javascript
// codegen.config.mjs
import { defineConfig } from '@oa-sdk/codegen'
import { z } from 'zod'

export default defineConfig({
  mergeIntoSpec: true,
  specPath: './packages/schemas/src/domains/users/spec.yaml',
  schemas: {
    User: z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100),
      email: z.string().email(),
    }),
  },
})
```

```bash
oa-gen generate --config codegen.config.mjs
```

## 2. OAS → TypeScript 타입

```bash
oa-gen typegen --spec packages/schemas/src/.merged.yaml -o src/types.ts
```

생성 결과 (JSDoc + $ref 참조):

```typescript
/** 사용자 정보 */
export type User = {
  id: string
  /** 이메일 주소 */
  email: string
  name: string
}

export type CreateUserBody = CreateUserRequest
export type CreateUserResponse = User
```

## 3. OAS → Hono 라우터 스텁

```bash
oa-gen router --spec packages/schemas/src/.merged.yaml --types-import './types' -o src/router.ts
```

## 4. OAS → fetch 클라이언트

```bash
oa-gen client --spec packages/schemas/src/.merged.yaml --types-import './types' -o src/client.ts
```

SSE 스트리밍 엔드포인트는 `async *` 제너레이터로 생성:

```typescript
async *streamHealthEvents(): AsyncGenerator<StreamHealthEventsResponse> {
  yield* stream('GET', '/health/stream')
}
```

## 전체 파이프라인 한 줄

```bash
pnpm --filter @oa-sdk/schemas run merge && \
oa-gen typegen --spec packages/schemas/src/.merged.yaml -o src/types.ts && \
oa-gen router  --spec packages/schemas/src/.merged.yaml --types-import './types' -o src/router.ts && \
oa-gen client  --spec packages/schemas/src/.merged.yaml --types-import './types' -o src/client.ts
```

→ [CLI 전체 명령어](../cli-setup.md)
→ [API 상세](../../internal/api-index.md)
→ [Zod 타입 커버리지](../../internal/spec.md)
