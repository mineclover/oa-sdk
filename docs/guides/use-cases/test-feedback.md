# Use Case: 테스트 피드백 루프

> 커버리지 추적 + API 메타데이터 조회 + 검증 오류 분석으로 테스트 품질 강화.

## 시나리오

테스트 작성 시 어떤 API가 아직 테스트되지 않았는지 파악하고, 검증 오류를 정확히 해석하여 빠르게 수정합니다. `@oa-sdk/parser` 0.4.0과 `@oa-sdk/mock-server` 0.1.5 기준이며, mock 서버 설치와 실행은 [Mock 서버 사용 가이드](../mock-server-usage.md)를 따릅니다.

## 1. API 구조 파악

```typescript
import { readFileSync } from 'node:fs'
import { parseDocument, describeApi } from '@oa-sdk/parser'

const spec = JSON.parse(readFileSync('./openapi.json', 'utf8'))
const doc = parseDocument(spec)
console.log(describeApi(doc))
```

```
Users API v1.0.0

서버: https://api.example.com/v1
스키마: 6개
오퍼레이션: 5개

[users]
  GET /users — listUsers
  POST /users — createUser
  GET /users/{userId} — getUserById
  PATCH /users/{userId} — updateUser

[audit]
  GET /audit/events — streamAuditEvents
```

`info.description`이 있으면 제목 다음 줄에 출력합니다. 각 operation 줄은 `summary`가 있으면 summary를, 없으면 operationId를 보여 줍니다.

## 2. 특정 오퍼레이션 검색

```typescript
import { findOperation, findByTag, getSchema } from '@oa-sdk/parser'

const op = findOperation(doc, 'createUser')
console.log(op?.summary)        // operation의 summary
console.log(op?.requestBody)    // 요청 바디 정의

const userOps = findByTag(doc, 'users')  // users 태그의 모든 오퍼레이션

const userSchema = getSchema(doc, 'User')  // User 스키마
```

→ [`@oa-sdk/parser` README](../../../packages/parser/README.md)

## 3. 커버리지 추적

`createCoverageTracker()`는 호출된 operationId를 모읍니다. Node HTTP 어댑터에는 요청 훅이 없으므로 플러그인의 `onMatch`에서 기록합니다. `onMatch`가 아무것도 반환하지 않으면 mock 서버는 평소처럼 응답합니다. 플러그인은 요청 검증을 통과한 요청에만 실행되므로, 401·422로 거절된 요청은 커버리지에 들어가지 않습니다.

```typescript
import { createCoverageTracker, createNodeMockServer, createTestClient } from '@oa-sdk/mock-server'

const tracker = createCoverageTracker()
const server = createNodeMockServer(spec, {
  port: 0,
  plugins: [{ name: 'coverage', onMatch: ({ entry }) => tracker.onRequest({ operationId: entry.operationId }) }],
})
await server.start()
const client = createTestClient(server)

// ... 테스트 실행 ...

const allOps = doc.operations.flatMap(op => (op.operationId ? [op.operationId] : []))
console.log(`커버리지: ${Math.round(tracker.coverage(allOps) * 100)}%`)
console.log(`미호출: ${tracker.uncalled(allOps).join(', ')}`)
```

MSW 어댑터를 쓴다면 `createMswHandlers(spec, { onRequest: tracker.onRequest })`처럼 `onRequest` 옵션에 바로 연결할 수 있습니다(`@oa-sdk/mock-server/adapters/msw`, `msw` 필요). MSW의 `onRequest`는 검증 전에 호출되므로 거절된 요청도 기록됩니다.

## 4. 검증 오류 해석

검증에 실패한 요청은 422로 거절되고, 위반 항목마다 `error.details`에 코드와 경로가 들어갑니다. 오류 코드 전체 목록과 401·404·405·500 응답 조건은 [요청 검증과 오류 응답](../mock-server-usage.md#6-요청-검증과-오류-응답)을 봅니다. 인증 정보가 없는 요청은 오류 코드 없이 401로 거절됩니다.

```typescript
import type { MockErrorResponse } from '@oa-sdk/mock-server'

const res = await client.post('/users', { nickname: 'A' }, { headers: { authorization: 'Bearer test-token' } })
if (res.status === 422) {
  const { error } = res.json as MockErrorResponse // TestResponse.json은 unknown
  for (const d of error.details) {
    console.log(`[${d.code}] ${d.path}: ${d.message}`)
    // [MISSING_REQUIRED_FIELD] /body/name: 필수 필드 누락: 'name'
  }
}
```

→ [OAS 커버리지 매트릭스](../../internal/oas32-coverage.md) (저장소 기여자용)
→ [Behavior ECS 기본 테스트 케이스](../../internal/behavior-ecs.spec.md#baseline-test-cases) (저장소 기여자용)

## 5. 린트로 스펙 품질 확인

```bash
npx oa-gen lint --spec ./openapi.yaml
```

oa-sdk 저장소의 production 계약은 저장소 루트에서 빌드한 CLI로 검사합니다(저장소 기여자용).

```bash
node packages/codegen/dist/cli/index.js lint --spec packages/schemas/src/.merged.yaml
# 0 errors, 0 warnings, 0 infos
```

→ [린터 규칙 목록](../../internal/spec.md) (저장소 기여자용)
→ [Behavior ECS](../../concepts/behavior-ecs.md)
