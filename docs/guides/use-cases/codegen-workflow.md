# Use Case: 코드젠 워크플로

> Drizzle ORM → OAS spec → TypeScript 타입 → 서버 라우터 → 클라이언트 SDK 전체 파이프라인.

## 시나리오

DB 스키마(Drizzle)에서 시작하여 API 전 계층의 코드를 자동 생성.

이 문서는 oa-sdk source checkout에서 실행하는 maintainer workflow다. 처음에는
`pnpm install && pnpm build:core`를 실행한다. 이후 shell 예시는
`node packages/codegen/dist/cli/index.js`를 직접 호출한다. 공개 npm consumer가 같은 CLI 기능만
사용할 때는 [Quick Start](../quick-start.md)의 `npx oa-gen` 경로를 사용한다.

## 핵심 계약 경계

공통 용어는 [Concepts](../../concepts.md)를 따른다. OA SDK 자체의 현재 production API
contract는 TypeSpec-first다. `packages/schemas/typespec/main.tsp`와 domain/metadata module을
수정하고 `pnpm schema:validate`로 canonical `.merged.yaml`을 생성·검증한다. 자세한 변경·승인
절차는 [TypeSpec authoring conventions](../typespec-authoring-conventions.md)를 따른다.

아래의 Drizzle/Zod/manual fragment 예시는 user-owned OpenAPI contract 또는 명시적인
Definition Builder rollback/reference 경로를 위한 것이다. 이 예시로 OA SDK production
TypeSpec source, approved snapshot, 또는 기본 `.merged.yaml` authoring 경로를 대체하지 않는다.
Definition Builder를 사용해 TypeSpec artifact를 비교·복구해야 할 때만
`pnpm schema:validate:openapi`를 실행한다.

그 경계 안에서 OpenAPI contract는 외부 API 계약이고, Drizzle/Zod/manual fragments는 그
contract를 만드는 입력이다.

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

## 1. Drizzle → OAS components.yaml (Definition Builder rollback/reference)

이 절의 fragment output은 현재 OA SDK production source가 아니다. TypeSpec을 고치는 동안
fallback artifact를 비교하거나, 별도의 OpenAPI contract를 소유하는 경우에만 사용한다. production
계약 변경은 위 TypeSpec 경로에서 시작한다.

```bash
node packages/codegen/dist/cli/index.js generate --drizzle-schema ./src/db/schema.ts --output ./packages/schemas/src/fragments/schema/public/users/
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
node packages/codegen/dist/cli/index.js generate --config codegen.config.mjs
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

현재 OA SDK production 흐름에서는 `packages/schemas/src/.merged.yaml`을 먼저
`pnpm schema:validate`로 materialize한 뒤, 여기의 typegen 소비 단계로 넘긴다. typegen은
artifact를 읽을 뿐 production source를 갱신하지 않는다.

```bash
node packages/codegen/dist/cli/index.js typegen --spec packages/schemas/src/.merged.yaml -o src/types.ts
```

CI처럼 같은 입력으로 반복 실행하는 곳에서는 `--incremental`을 붙이면 입력·옵션·출력이 그대로인
대상의 재생성을 건너뜁니다(캐시 위치는 `--cache-dir`, 기본 `./.oa-cache`).

```bash
node packages/codegen/dist/cli/index.js typegen --spec packages/schemas/src/.merged.yaml -o src/types.ts --incremental
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

## 3. OAS → Hono 라우터 스텁 (`@oa-sdk/router` 동반 패키지)

`@oa-sdk/router`는 `@oa-sdk/codegen` 옆에 설치하는 공개 동반 패키지다
([설치 안내](../cli-setup.md#동반-패키지-companion-packages)). `oa-gen generate`는 이 패키지로
핸들러 계약(`*.contract.ts`)을 생성하지만 라우터 스텁을 만드는 `oa-gen` 명령은 없으므로,
아래처럼 package API를 호출하는 script가 출력을 소유한다.

```typescript
import { readFileSync, writeFileSync } from 'node:fs'
import { generateRouter } from '@oa-sdk/router'
import type { OasDocument } from '@oa-sdk/parser'
import { parse } from 'yaml'

const spec = parse(readFileSync('packages/schemas/src/.merged.yaml', 'utf8')) as OasDocument
writeFileSync('src/router.ts', generateRouter(spec, { typesImport: './types.js' }))
```

`contractImport` 없이 호출하면 route마다 `// TODO` 자리만 있는 독립 라우터 스텁(`mode: 'stub'`,
기본 대상 Hono)이 나온다. 핸들러 계약(`ApiHandlers`)에 묶인 라우터를 만들고 구현을 연결하는 방법은
[백엔드 핸들러 계약 구현 가이드](../backend-handler-contracts.md)를 따른다.

생성된 라우터와 타입은 API 계약을 구현하기 위한 골격이다. 생성 파일을 직접 수정하기보다
handler/use-case/service에서 실제 로직을 구현하고, 반환값이 generated response type을
만족하도록 유지한다.

## 4. OAS → fetch 클라이언트 (`@oa-sdk/client` 동반 패키지)

`@oa-sdk/client`도 `@oa-sdk/codegen` 옆에 설치하는 동반 패키지다. CLI에서는
`generate:client`가 이 패키지의 같은 생성기를 실행한다.

```bash
node packages/codegen/dist/cli/index.js generate:client \
  --spec packages/schemas/src/.merged.yaml --types-import ./types.js -o src/client.ts
```

script에서는 package API를 직접 호출한다. `spec`은 3절과 같이 읽는다.

```typescript
import { readFileSync, writeFileSync } from 'node:fs'
import { generateClient } from '@oa-sdk/client'
import type { OasDocument } from '@oa-sdk/parser'
import { parse } from 'yaml'

const spec = parse(readFileSync('packages/schemas/src/.merged.yaml', 'utf8')) as OasDocument
writeFileSync('src/client.ts', generateClient(spec, { typesImport: './types.js' }))
```

생성된 클라이언트의 설정과 호출 규칙은 [생성 클라이언트와 TanStack Query 사용 가이드](../client-and-query-consumption.md)를 따른다.

SSE 스트리밍 엔드포인트는 `async *` 제너레이터로 생성된다. 현재 native OpenAPI 3.2
`itemSchema`의 payload 타입은 typegen alias로 투영되지 않으므로 iterator 원소는 안전하게
`unknown`으로 유지된다. consumer는 자신의 runtime validator로 좁힌 뒤 사용한다.

```typescript
const events: AsyncGenerator<unknown> = client.streamHealthEvents()

for await (const event of events) {
  // validate/narrow `event` before use
}
```

## 계약 검증 게이트

OpenAPI를 문서로만 두면 쉽게 실제 구현과 어긋난다. 아래 명령을 CI 게이트로 두고,
breaking change는 spec diff에서 먼저 확인한다.

OA SDK production 계약의 기본 gate는 `pnpm schema:validate`다. 아래의
`duplicate-review`와 `target-check`는 Definition Builder fragment/target을 위한
rollback/reference 검증이며, TypeSpec-first production composition을 대신하지 않는다.

아래 `contracts/baselines/v1.openapi.yaml`(이전 릴리스에서 저장해 둔 기준 계약)과
`runtime.openapi.yaml`(실행 중인 서버가 내보낸 OpenAPI)은 예시 경로다. 저장소에 들어 있는 파일이
아니므로 자기 기준선과 runtime 산출물 경로로 바꾼다.

```bash
pnpm schema:validate
node packages/codegen/dist/cli/index.js validate --spec packages/schemas/src/.merged.yaml
node packages/codegen/dist/cli/index.js lint --spec packages/schemas/src/.merged.yaml
node packages/codegen/dist/cli/index.js diff \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --fail-on-breaking
node packages/codegen/dist/cli/index.js check-artifact \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml
node packages/codegen/dist/cli/index.js check-artifact \
  --head packages/schemas/src/.merged.yaml \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --artifact packages/schemas/src/.builder/local-parity-api.yaml
node packages/codegen/dist/cli/index.js drift \
  --runtime-openapi "$PWD/runtime.openapi.yaml" \
  --managed-openapi "$PWD/packages/schemas/src/.merged.yaml" \
  --format markdown
# Definition Builder fallback/reference governance
node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy ci \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --format markdown
node packages/codegen/dist/cli/index.js target-check \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --must-include-path /health \
  --must-exclude-path /admin
node packages/codegen/dist/cli/index.js review \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml \
  --format markdown
```

TypeSpec output을 수리하는 동안 Definition Builder artifact를 재생성해야 한다면
`pnpm schema:validate:openapi`를 사용한다. 이 명시적 rollback/reference command의 범위와
복귀 조건은 [Definition Builder validation gates](../../internal/definition-builder-compatibility-gates.md)에
정의되어 있다.

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

## 전체 파이프라인 검증

현재 production contract에서는 먼저 `pnpm schema:validate`를 실행한다. 아래 typegen은 그
검증된 generated artifact를 읽는 consumer 단계다.

```bash
pnpm schema:validate
node packages/codegen/dist/cli/index.js typegen --spec packages/schemas/src/.merged.yaml -o src/types.ts
pnpm --filter @oa-sdk/playground test -- codegen-pipeline.test.ts
```

→ [CLI 전체 명령어](../cli-command-reference.md)
→ [API 상세](../../internal/api-index.md)
→ [Zod 타입 커버리지](../../internal/spec.md)
→ [Behavior ECS](../../concepts/behavior-ecs.md)
