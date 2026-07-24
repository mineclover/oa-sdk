# Quick Start

5분 안에 oa-sdk 전 파이프라인을 체험합니다.

## 1. 설치

```bash
git clone <repo> && cd oa-sdk
pnpm install
```

## 2. 스키마 빌드 + 검증

```bash
pnpm schema:validate
oa-gen validate --spec packages/schemas/src/.merged.yaml
```

```
━━━ Step 1: 파싱 + 구조 검증 ━━━
✅ Valid — 0 warnings, 0 infos
━━━ Step 2: 3.1 호환성 ━━━
  3.2 전용 필드 사용: dataValue 20회, itemSchema 1회 ...
```

## 3. TypeScript 타입 생성

```bash
oa-gen typegen --spec packages/schemas/src/.merged.yaml
```

```typescript
/** 사용자 정보 */
export type User = {
  id: string
  /** 이메일 주소 */
  email: string
  name: string
  role: 'admin' | 'user' | 'guest'
}

export type ListUsersResponse = { items: User[]; total: number }
export type CreateUserBody = CreateUserRequest
export type CreateUserResponse = User
export type CreateUserOp = { method: 'post'; path: '/users'; body: CreateUserBody; response: CreateUserResponse }
```

## 4. 라우터 + 클라이언트 생성

```bash
oa-gen router --spec packages/schemas/src/.merged.yaml --types-import './types' -o router.ts
oa-gen client --spec packages/schemas/src/.merged.yaml --types-import './types' -o client.ts
```

## 5. Mock 서버 테스트

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient } from '@oa-sdk/mock-server'

const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)

// 유효 요청 → 201
const res = await client.post('/users',
  { name: 'Alice', email: 'a@b.com', password: 'secure1234' },
  { headers: { authorization: 'Bearer token' } }
)
expect(res.status).toBe(201)

// 검증 실패 → 422 + 에러 상세
const bad = await client.post('/users', {})
// → [MISSING_REQUIRED_FIELD] /body/email: 필수 필드 누락
```

## 6. API 탐색

```typescript
import { parseDocument, describeApi } from '@oa-sdk/parser'

console.log(describeApi(parseDocument(spec)))
```

```
OA SDK API v0.1.0
[health] GET /health — 서버 상태 확인
[users]  GET /users — 사용자 목록 조회
         POST /users — 사용자 생성
```

## 7. 데모

```bash
pnpm demo
```

## 8. 3.1 호환 (Swagger UI)

```bash
pnpm --filter @oa-sdk/schemas run downgrade:3.1
# → .merged.3.1.yaml (순수 3.1) + .merged.3.1.meta.json (사이드카)
```

## 다음 단계

→ [Mock 테스팅](./use-cases/mock-testing.md) — 테스트 패턴 + 커버리지 추적
→ [코드젠 워크플로](./use-cases/codegen-workflow.md) — 전체 파이프라인
→ [테스트 피드백](./use-cases/test-feedback.md) — 에러 분석 + API 탐색
→ [CLI 세팅](./cli-setup.md) — 전 커맨드 상세
→ [기본 스펙 사용 기준](./basic-spec-usage.md) — source/artifact/사용처와 구조 경계
→ [API 인덱스](../internal/api-index.md) — 타입·함수 SSOT
