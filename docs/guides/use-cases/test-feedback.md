# Use Case: 테스트 피드백 루프

> 커버리지 추적 + API 메타데이터 조회 + 검증 에러 분석으로 테스트 품질 강화.

## 시나리오

테스트 작성 시 어떤 API가 아직 테스트되지 않았는지 파악하고,
검증 에러를 정확히 해석하여 빠르게 수정.

## 1. API 구조 파악

```typescript
import { parseDocument, describeApi } from '@oa-sdk/parser'

const doc = parseDocument(spec)
console.log(describeApi(doc))
```

```
OA SDK API v0.2.0
[health] GET /health — 서버 상태 확인
[users]  GET /users — 사용자 목록 조회
         POST /users — 사용자 생성
         ...
```

## 2. 특정 오퍼레이션 검색

```typescript
import { findOperation, findByTag, getSchema } from '@oa-sdk/parser'

const op = findOperation(doc, 'createUser')
console.log(op?.summary)        // '사용자 생성'
console.log(op?.requestBody)    // 요청 바디 스키마

const userOps = findByTag(doc, 'users')  // users 태그의 모든 오퍼레이션

const userSchema = getSchema(doc, 'User')  // User 스키마
```

→ [Query API 상세](../../internal/api-index.md#함수-oa-sdkparser)

## 3. 커버리지 추적

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient, createCoverageTracker } from '@oa-sdk/mock-server'

const tracker = createCoverageTracker()
const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)

// 테스트 실행 중 tracker.onRequest 호출
// (또는 mock-server onRequest 훅에 연결)

// 테스트 종료 후
const allOps = doc.operations.map(o => o.operationId).filter(Boolean)
console.log(`커버리지: ${Math.round(tracker.coverage(allOps) * 100)}%`)
console.log(`미호출: ${tracker.uncalled(allOps).join(', ')}`)
```

## 4. 검증 에러 해석

Mock 서버는 8가지 에러 코드로 분류합니다:

| 코드 | 의미 | 대응 |
|------|------|------|
| `TYPE_ERROR` | 타입 불일치 | body/param 타입 확인 |
| `MISSING_REQUIRED_FIELD` | 필수 필드 누락 | 요청 데이터 보완 |
| `FORMAT_MISMATCH` | format 위반 (uuid, email) | 형식 수정 |
| `CONSTRAINT_VIOLATION` | min/max 등 제약 위반 | 값 범위 확인 |
| `INVALID_ENUM_VALUE` | enum 외 값 | 허용 값 목록 확인 |
| `PATTERN_MISMATCH` | regex 불일치 | 패턴 확인 |
| `PROTOCOL_MISMATCH` | Content-Type 오류 | 헤더 수정 |
| `NOT_FOUND` | 경로 없음 | URL 확인 |

```typescript
const res = await client.post('/users', { name: 'A' })
if (!res.ok) {
  const details = res.json.error.details
  for (const d of details) {
    console.log(`[${d.code}] ${d.path}: ${d.message}`)
    // [MISSING_REQUIRED_FIELD] /body/email: 필수 필드 누락: 'email'
  }
}
```

→ [에러 분류 상세](../../internal/spec.md)
→ [OAS 커버리지 매트릭스](../../internal/oas32-coverage.md)
→ [Behavior ECS 기본 테스트 케이스](../../internal/behavior-ecs.spec.md#baseline-test-cases)

## 5. 린트로 스펙 품질 확인

```bash
oa-gen lint --spec packages/schemas/src/.merged.yaml
# 0 errors, 0 warnings, 0 infos
```

→ [린터 규칙 목록](../../internal/spec.md)
→ [Behavior ECS](../../concepts/behavior-ecs.md)
