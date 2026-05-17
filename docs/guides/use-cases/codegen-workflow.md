# Use Case: 코드젠 워크플로

> Drizzle ORM → OAS spec → TypeScript 타입 → 서버 라우터 → 클라이언트 SDK 전체 파이프라인.

## 시나리오

DB 스키마(Drizzle)에서 시작하여 API 전 계층의 코드를 자동 생성.

## 핵심 계약 경계

공통 용어는 [Concepts](../../concepts.md)를 따른다. 이 워크플로우에서는 OpenAPI contract가
외부 API 계약이고, Drizzle/Zod/manual fragments는 그 계약을 만드는 입력이다.

```txt
Drizzle schema / Zod schema / 수동 OpenAPI fragment
  -> OpenAPI 3.2 components + paths
  -> validate / lint / spec diff
  -> typegen / router stub / client / mock server
  -> 실제 API handler 구현
```

Drizzle DB 모델과 OpenAPI contract는 서로 다른 source of truth다. 둘을 같은 타입으로
취급하지 말고 API DTO와 mapper를 통해 연결한다.

```txt
DB 내부 모델: Drizzle
API 외부 계약: OpenAPI
런타임 검증/파생 스키마: Zod 또는 OpenAPI validator
타입 생성: oa-sdk typegen
서버 골격: oa-sdk router
클라이언트/테스트: oa-sdk client + mock-server
```

bun-graph-db처럼 OpenAPI projection을 외부에서 생산하는 시스템도 같은 소비 파이프라인에
들어올 수 있다. 자세한 fetch/validate/typegen/client/mock-server 절차는
[bun-graph-db projection 소비](./bun-graph-db-projections.md)를 따른다.

PR에서 target artifact, provenance, duplicate review, runtime drift, review bundle까지
한 번에 검토하는 절차는 [OpenAPI Governance Workflow](./openapi-governance-workflow.md)를
따른다.

command execution logging과 projection/read model은 [Behavior ECS](../../concepts/behavior-ecs.md)를
따르고, baseline/local verification은
[Behavior ECS Spec](../../internal/behavior-ecs.spec.md)를 단일 소스로 본다.

## 1. Drizzle → OAS components.yaml

```bash
oa-gen generate --drizzle-schema ./src/db/schema.ts --output ./packages/schemas/src/fragments/schema/public/users/
```

또는 config 파일:

```javascript
// codegen.config.mjs
import { defineConfig } from '@oa-sdk/codegen'
import { z } from 'zod'

export default defineConfig({
  mergeIntoSpec: true,
  specPath: './packages/schemas/src/fragments/schema/public/users/User.yaml',
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

### Drizzle 스키마 관리 원칙

Drizzle에서 생성한 `select`, `insert`, `update` schema는 OpenAPI component의 초안으로
사용한다. 공개 API의 request/response DTO는 DB 테이블과 달라질 수 있으므로 필요한
경우 spec fragment에서 보정한다.

예를 들어 DB row가 다음 필드를 가진다고 해도:

```typescript
type UserRow = {
  id: string
  email: string
  passwordHash: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}
```

외부 response DTO는 내부 컬럼을 그대로 노출하지 않는다.

```typescript
type UserResponse = {
  id: string
  email: string
  createdAt: string
}
```

handler에서는 DB row를 generated API 타입으로 명시적으로 변환한다.

```typescript
function toUserResponse(row: UserRow): UserResponse {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  }
}
```

운영 규칙:

- `passwordHash`, internal flag, soft delete 컬럼은 response에 노출하지 않는다.
- `id`, `createdAt`, `updatedAt`처럼 서버가 관리하는 값은 create request에서 제외한다.
- DB nullable과 API optional은 같은 개념이 아니므로 request/response별로 명시한다.
- DB default와 API default도 분리해서 문서화한다.
- `numeric`, `decimal`, `bigint`, `json`, enum은 OpenAPI 표현을 명확히 정한다.
- relation은 테이블 구조 그대로 내보내지 말고 use-case별 DTO로 만든다.
- DB migration은 저장 구조 변경 기록이고, OpenAPI diff는 API 계약 변경 기록이다.

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

생성된 라우터와 타입은 API 계약을 구현하기 위한 골격이다. 생성 파일을 직접 수정하기보다
handler/use-case/service에서 실제 로직을 구현하고, 반환값이 generated response type을
만족하도록 유지한다.

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

## 계약 검증 게이트

OpenAPI를 문서로만 두면 쉽게 실제 구현과 어긋난다. 아래 명령을 CI 게이트로 두고,
breaking change는 spec diff에서 먼저 확인한다.

```bash
pnpm --filter @oa-sdk/schemas run build:merged
oa-gen validate --spec packages/schemas/src/.merged.yaml
oa-gen lint --spec packages/schemas/src/.merged.yaml
oa-gen diff \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --fail-on-breaking
oa-gen check-artifact \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml
oa-gen check-artifact \
  --head packages/schemas/src/.merged.yaml \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --artifact packages/schemas/src/.builder/local-parity-api.yaml
oa-gen drift \
  --runtime-openapi runtime.openapi.yaml \
  --managed-openapi packages/schemas/src/.merged.yaml \
  --format markdown
oa-gen duplicate-review \
  --fragments packages/schemas/src/fragments \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --format markdown
oa-gen target-check \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --must-include-path /health \
  --must-exclude-path /admin
oa-gen review \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml \
  --format markdown
```

API 문서로 사용할 정보는 README에 따로 흩어두지 말고 spec에 둔다.

- `summary`, `description`
- 안정적인 `operationId`
- request/response examples
- 공통 error response component
- auth/security scheme
- pagination, filter, sort 규칙
- nullable, optional, default, readOnly, writeOnly 구분

공통 query parameter와 metadata schema 예시는 [스키마 작성 가이드](../schema-authoring.md)의
`공통 parameters 운영 시나리오`를 따른다.

## 전체 파이프라인 한 줄

```bash
pnpm --filter @oa-sdk/schemas run build:merged && \
oa-gen typegen --spec packages/schemas/src/.merged.yaml -o src/types.ts && \
oa-gen router  --spec packages/schemas/src/.merged.yaml --types-import './types' -o src/router.ts && \
oa-gen client  --spec packages/schemas/src/.merged.yaml --types-import './types' -o src/client.ts
```

→ [CLI 전체 명령어](../cli-setup.md)
→ [API 상세](../../internal/api-index.md)
→ [Zod 타입 커버리지](../../internal/spec.md)
→ [Behavior ECS](../../concepts/behavior-ecs.md)
