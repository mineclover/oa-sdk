# oa-sdk

OpenAPI 3.2를 중심으로 한 양방향 API 인프라 모노레포.

```
Drizzle ORM ──▶                        ──▶ Mock Server
Zod Schema  ──▶  OpenAPI 3.2 Spec      ──▶ TypeScript 타입
               (단일 소스 + 검증)       ──▶ 서버 라우터 스텁
                                        ──▶ 클라이언트 SDK
```

## 패키지

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/core` | 공유 유틸 (문자열, 코드젠, 포맷, 응답 상태) |
| `@oa-sdk/schemas` | 도메인 분리 OAS 3.2 소스 + merge + 3.1↔3.2 변환 |
| `@oa-sdk/parser` | OAS 3.2 파서 + IR + fold + lint + validate + query |
| `@oa-sdk/mock-server` | AJV Mock 서버 (MSW + Node HTTP) + Security + 테스트 헬퍼 |
| `@oa-sdk/codegen` | Zod/Drizzle → OAS + OAS → TS 타입 + CLI 7커맨드 |
| `@oa-sdk/router` | OAS → Hono/Express 라우터 스텁 |
| `@oa-sdk/client` | OAS → fetch 클라이언트 SDK + SSE |

## 사용 방법

```bash
pnpm install

# 스펙 관리
pnpm --filter @oa-sdk/schemas run merge    # 도메인 병합
oa-gen validate --spec .merged.yaml        # 종합 검증 (3.2 + 3.1 호환)
oa-gen lint --spec .merged.yaml            # 린트만

# 코드 생성
oa-gen typegen --spec .merged.yaml -o types.ts
oa-gen router  --spec .merged.yaml -o router.ts --types-import './types'
oa-gen client  --spec .merged.yaml -o client.ts --types-import './types'
oa-gen generate --drizzle-schema ./db/schema.ts --output ./domains/users/

# Mock 테스트
pnpm mock:start

# 3.1 호환 (Swagger UI)
pnpm --filter @oa-sdk/schemas run downgrade:3.1

# 데모 (API 구조 + Mock 서버 12시나리오 + 커버리지)
pnpm demo
```

## 테스트에서 사용

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient, createCoverageTracker } from '@oa-sdk/mock-server'
import { parseDocument, describeApi } from '@oa-sdk/parser'

const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)

const res = await client.post('/users', { name: 'Alice', email: 'a@b.com' },
  { headers: { authorization: 'Bearer token' } })
expect(res.status).toBe(201)

// API 구조 탐색
console.log(describeApi(parseDocument(spec)))
```

## 문서

| 문서 | |
|------|-|
| [Quick Start](./docs/guides/quick-start.md) | 5분 파이프라인 체험 |
| [전체 문서](./docs/README.md) | 유저 가이드 + SSOT |
| [구현 현황](./docs/internal/spec.md) | 7패키지, 833 테스트 |
| [API 인덱스](./docs/internal/api-index.md) | 타입·함수 단일 소스 |
