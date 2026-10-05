---
docType: tutorial
sourceLocale: ko
canonical: true
audience:
  competence: novice
productVersions:
  - "@oa-sdk/codegen 0.9.0"
  - "@oa-sdk/ast-sync 0.2.0"
  - "@oa-sdk/core 0.3.1"
  - "@oa-sdk/parser 0.4.0"
  - "@oa-sdk/client 0.2.2"
  - "@oa-sdk/router 0.2.2"
  - "@oa-sdk/mock-server 0.1.4"
tested:
  environment: "Node.js 24.19, npm 11.17"
  at: "2026-10-06"
  # The 2026-10-06 run followed steps 0-7 in order, as written, in a project made
  # with `npm init -y` ("type": "commonjs"), with the step 1 openapi.yaml and, for
  # step 6A, a typespec/main.tsp holding one model and one route. The @oa-sdk
  # packages were tarballs that `release:export --dry-run` packed from commit
  # 645d2fee, not npm releases; ast-sync and openapi-projection-contract 0.2.0
  # came from npm. Every command exited 0 without msw installed, the validate,
  # generate and mock scripts that step 0 adds passed, and the step 4 component
  # type-checked (TypeScript 5.9.3, @tanstack/react-query 5.104.1, @types/react
  # 19.3) before step 5 and, with the imports step 5 names, after it. Bun and
  # pnpm were not re-run for these versions.
  owner: "OA SDK maintainers"
  reviewDue: "2026-12-10"
  status: active
sourceOfTruth:
  - package.json
  - packages/codegen/package.json
  - packages/ast-sync/package.json
  - packages/router/package.json
  - packages/client/package.json
  - packages/mock-server/package.json
---

# Quick Start (5분 빠른 시작 가이드)

5분 안에 `@oa-sdk`의 전체 엔드투엔드 파이프라인(온보딩 $\rightarrow$ TypeSpec 선언 및 스펙 검증 $\rightarrow$ 정적 타입 생성 $\rightarrow$ Zod 4 검증 스키마 $\rightarrow$ TanStack Query 프론트엔드 $\rightarrow$ 순수 핸들러 계약 및 고성능 백엔드 라우터 $\rightarrow$ 실시간 목 서버 핫리로드)을 직접 체험합니다.

> 🚀 **TypeSpec 기반 API 개발 5분 퀵스타트**: `oa-sdk` 모노레포의 API 계약 단일 진실 공급원(SSOT)은 **TypeSpec(`.tsp`)**입니다. 엔드포인트 스캐폴딩, 실시간 핫리로드 목 서버, AST 시맨틱 브레이킹 체인지 검사의 전체 개발 루프는 **[TypeSpec 5분 퀵스타트 가이드](./typespec/01-quickstart-5min.md)**를 참조하십시오.
> 💡 **패키지 매니저별 설치 및 런타임 설정 상세**: [CLI 설치 및 설정 가이드](./cli-setup.md)
> 💡 **선언적 설정 파일(`oa.config.ts`) 상세 스펙**: [선언적 사양 설정 가이드](./declarative-spec-configuration.md)

---

## 0단계: 30초 제로 마찰 온보딩 (`oa-gen init`)

프로젝트 루트에서 `oa-gen init`을 실행하면 프레임워크(Fastify, Bun Elysia, Hono, Express, NestJS)와 스펙 소스(`.tsp`, `openapi.yaml`, `openapi.json`, `@oaOperation` JSDoc)를 자동으로 감지하여 최적화된 `oa.config.ts`와 `package.json` 스크립트를 즉시 구성합니다.

```bash
# 로컬 개발 의존성 설치: CLI와 4~6단계가 사용하는 동반 패키지
npm install --save-dev @oa-sdk/codegen @oa-sdk/router @oa-sdk/client @oa-sdk/mock-server

# 비대화형 자동 감지 온보딩 실행
npx oa-gen init --yes
```

> **Bun 환경**: `bun add -d @oa-sdk/codegen @oa-sdk/router @oa-sdk/client @oa-sdk/mock-server && bunx oa-gen init --yes`

`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`는 `oa-gen`이 필요할 때 불러오는 **동반 패키지**입니다. `@oa-sdk/codegen`을 설치해도 함께 설치되지 않으므로 위처럼 같이 설치합니다.

- `init`이 생성하는 `oa.config.ts`는 핸들러 계약과 클라이언트 SDK를 켭니다(`core.contracts.pureHandlers: true`, `core.client.enabled: true`). 그래서 5단계의 `oa-gen generate`에는 `@oa-sdk/router`와 `@oa-sdk/client`가 필요합니다.
- 4단계의 `generate:client`·`generate:tanstack`에는 `@oa-sdk/client`가, 6단계의 `mock`과 `init`이 추가하는 `mock` 스크립트에는 `@oa-sdk/mock-server`가 필요합니다. `oa-gen mock`은 mock-server의 Node HTTP 어댑터만 쓰므로 MSW(`msw`)는 설치하지 않아도 됩니다.
- `init`도 이 패키지들을 `devDependencies`에 기록하지만, `package.json`에 이미 있는 버전은 바꾸지 않습니다(`--force` 제외). 기록하는 버전은 이 codegen이 빌드된 릴리스와 호환되는 범위(`^<버전>`)이고, 해당 패키지를 멤버로 가진 pnpm 워크스페이스 안에서만 `workspace:*`입니다.
- 동반 패키지 없이 이 명령들을 실행하면, 출력을 건너뛰지 않고 설치 명령을 출력한 뒤 종료 코드 1로 실패합니다.
- `init`이 쓰는 `oa.config.ts`는 ES module입니다. `npm init -y`가 만드는 `"type": "commonjs"` 프로젝트에서도 `oa-gen`이 ES module로 변환해 불러오므로 `package.json`을 바꿀 필요가 없습니다.

자세한 규칙은 [동반 패키지 안내](./cli-setup.md#동반-패키지-companion-packages)를 참고하세요.

---

## 1단계: TypeSpec 계약 작성 및 OpenAPI 3.2 스펙 유효성 검증 (`oa-gen validate`)

`oa-sdk`는 **TypeSpec(`.tsp`)** 소스를 단일 진실 공급원으로 사용합니다. 엔드포인트 선언 및 변경은 `.tsp` 파일에서 수행하며, 컴파일된 OpenAPI 3.2 사양 문서의 문법, 컴포넌트 참조($ref), OpenAPI 3.2 전용 확장 기능의 정합성을 사전 검증합니다.

이 가이드의 예시 출력은 프로젝트 루트에 둔 다음 `openapi.yaml`(사용자 API)을 기준으로 합니다. 0단계의 `init`은 스펙이 없으면 이 경로를 `schemaEntry`로 기록합니다. TypeSpec으로 관리한다면 컴파일된 OpenAPI 문서를 이 위치에 둡니다.

```yaml
openapi: 3.2.0
info: { title: Users API, version: 1.0.0 }
paths:
  /users:
    get:
      operationId: listUsers
      summary: List users
      tags: [users]
      responses:
        '200':
          description: Users
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ListUsersResponse' }
    post:
      operationId: createUser
      summary: Create a user
      tags: [users]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateUserBody' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/User' }
  /users/{userId}:
    get:
      operationId: getUser
      summary: Get a user
      tags: [users]
      parameters:
        - { name: userId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: User
          content:
            application/json:
              schema: { $ref: '#/components/schemas/User' }
components:
  schemas:
    User:
      type: object
      required: [id, email, name, role, createdAt]
      properties:
        id: { type: string }
        email: { type: string, format: email }
        name: { type: string }
        role: { type: string, enum: [admin, user, guest] }
        createdAt: { type: string, format: date-time }
    ListUsersResponse:
      type: object
      required: [items, total]
      properties:
        items: { type: array, items: { $ref: '#/components/schemas/User' } }
        total: { type: integer }
    CreateUserBody:
      type: object
      required: [email, name]
      properties:
        email: { type: string, format: email }
        name: { type: string }
        role: { type: string, enum: [admin, user] }
```

```bash
# TypeSpec에서 파생된 프로덕션 스펙 또는 관리 대상 스펙 검증
npx oa-gen validate --spec ./openapi.yaml --require-32
```

```text
━━━ Step 1: 파싱 + 구조 검증 ━━━
✅ Valid — 0 warnings, 0 infos

━━━ Step 2: 3.1 호환성 ━━━
  3.2 전용 필드 미사용 — 3.1과 완전 호환
```

`init`이 추가한 `validate` 스크립트(`npm run validate`)는 `--spec` 없이 `oa.config.ts`의 모든 spec target을 검증합니다.

---

## 2단계: 순수 TypeScript AST 정적 타입 생성 (`oa-gen typegen`)

OpenAPI 스펙으로부터 런타임 오버헤드가 전혀 없는 100% 순수 TypeScript 타입 선언 파일을 방출합니다.

```bash
npx oa-gen typegen --spec ./openapi.yaml -o types.ts
```

생성된 `types.ts` 파일에는 스펙의 모든 스키마 모델과 오퍼레이션 파라미터가 정확한 TypeScript 타입으로 변환됩니다(속성은 이름 순, `format`은 JSDoc으로 남습니다). 일부를 발췌하면 다음과 같습니다:

```typescript
export type CreateUserBody = {
  /** @format email */
  email: string
  name: string
  role?: 'admin' | 'user'
}

export type ListUsersResponse = {
  items: User[]
  total: number
}

export type User = {
  /** @format date-time */
  createdAt: string
  /** @format email */
  email: string
  id: string
  name: string
  role: 'admin' | 'user' | 'guest'
}
```

---

## 3단계: Zod 4 검증 스키마 생성 (`oa-gen generate:zod`)

OpenAPI 3.2 사양(JSON Schema Draft 2020-12 어휘)을 관용적인 Zod 4 코드로 컴파일합니다. 수치 배타적 경계(`.gt()`, `.lt()`), 튜플 프리픽스(`z.tuple()`), 순환 참조(`z.lazy()`)를 완벽히 지원합니다.

```bash
npx oa-gen generate:zod --spec ./openapi.yaml -o schemas.ts
```

```typescript
import { z } from 'zod'

export const ListUsersResponseSchema = z.object({
  items: z.array(z.lazy(() => UserSchema)),
  total: z.int(),
})
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>

export const UserSchema = z.object({
  createdAt: z.string().datetime(),
  email: z.string().email(),
  id: z.string(),
  name: z.string(),
  role: z.enum(["admin", "user", "guest"]),
})
export type User = z.infer<typeof UserSchema>
```

---

## 4단계: TanStack Query v5 3계층 클라이언트 생성 (`oa-gen generate:tanstack`)

프론트엔드 통신을 위해 3계층(Tier 1 계층적 쿼리 키 팩토리, Tier 2 순수 옵션 팩토리, Tier 3 리액트 훅 래퍼) 클라이언트를 방출합니다. 코드는 0단계에서 설치한 동반 패키지 `@oa-sdk/client`가 생성합니다.

```bash
# 옵션 팩토리가 import하는 fetch 클라이언트(./client.js)를 같은 디렉터리에 생성
npx oa-gen generate:client --spec ./openapi.yaml -o src/api/client.ts
npx oa-gen generate:tanstack --spec ./openapi.yaml -o src/api

# 생성된 코드가 사용하는 TanStack Query (React 프로젝트 기준)
npm install @tanstack/react-query
```

`generate:tanstack`은 `src/api/tanstack-query.ts` 한 파일에 Tier 1 키 팩토리(`usersKeys`), Tier 2 옵션 팩토리(`listUsersQueryOptions`, `getUserQueryOptions`, `createUserMutationOptions`), Tier 3 훅(`useGetUserQuery` 등과 `createApiHooks`)을 씁니다. 옵션 팩토리와 `use*` 훅은 첫 인자로 `createClient()`가 만든 클라이언트를 받고(`createApiHooks`는 클라이언트를 돌려주는 훅을 받아 이 인자가 없는 훅을 만듭니다), 이 명령이 생성하는 응답 데이터의 타입은 `unknown`입니다.

```tsx
// src/UserProfile.tsx
import { useQuery } from '@tanstack/react-query'
import { createClient } from './api/client.js'
import { getUserQueryOptions } from './api/tanstack-query.js'

const client = createClient({ baseUrl: 'http://localhost:4010' })

export function UserProfile({ userId }: { userId: string }) {
  // Tier 2 순수 옵션 팩토리를 그대로 useQuery에 전달 (SSR의 queryClient.prefetchQuery에도 같은 팩토리 사용)
  const { data: user, isLoading } = useQuery(getUserQueryOptions(client, { userId }))

  if (isLoading) return <div>로딩 중...</div>
  return <pre>{JSON.stringify(user, null, 2)}</pre>
}
```

---

## 5단계: 백엔드 순수 핸들러 계약 및 라우터 방출 (`oa-gen generate`)

선언적 `oa.config.ts` 설정에 따라 백엔드 라우터와 순수 핸들러 계약을 방출합니다. 핸들러 계약은 `@oa-sdk/router`, 클라이언트 SDK는 `@oa-sdk/client`가 생성합니다. `init`이 만든 설정은 두 산출물을 명시적으로 켜므로, 둘 중 하나라도 설치되어 있지 않으면 `oa-gen generate`는 파일을 쓰기 전에 설치 명령을 출력하고 종료 코드 1로 실패합니다.

```bash
npx oa-gen generate
```

- **핸들러 계약 분리 (`*.contract.ts`)**: 프레임워크 런타임 종속성이 전혀 없는 순수 TypeScript 인터페이스(`ApiHandlers`, `Context`, `HandlerResponse`)를 생성합니다. 스펙을 재생성하더라도 개발자가 구현한 비즈니스 로직 파일이 덮어쓰여지지 않습니다.
- **고성능 프레임워크 바인더 (`*.router.ts`)**: Fastify(JIT 스키마 가속) 또는 Bun Elysia(Zero-copy 컨텍스트 구조분해) 바인더가 생성되어 비즈니스 핸들러와 라우트를 물리적으로 결합합니다.

`init`이 프레임워크를 감지하지 못한 프로젝트(`target: 'generic'`, spec target id `generic-api`)에서는 `*.router.ts` 바인더 없이 다음 파일을 씁니다.

- `src/generated/generic-api.openapi.json`, `src/generated/generic-api.schema.json`: OpenAPI 3.1 projection과 JSON Schema
- `src/api/generic-api/generic-api.contract.ts`: 핸들러 계약
- `src/api/generic-api/generic-api.client.ts`: 클라이언트 SDK
- `src/api/generic-api/generic-api.keys.ts`, `src/api/generic-api/generic-api.queries.ts`: TanStack Query 키·옵션 팩토리

`oa-gen generate`는 `.oa-manifest.json`에 기록된 생성 파일 중 이번 실행이 만들지 않은 파일을 지웁니다. 4단계의 `generate:tanstack`이 기록한 `src/api/tanstack-query.ts`도 지워지므로, 4단계 예제는 같은 팩토리를 담은 `./api/generic-api/generic-api.queries.js`와 `./api/generic-api/generic-api.client.js`에서 `getUserQueryOptions`와 `createClient`를 import하도록 바꿉니다.

---

## 6단계: 제로 빌드 실시간 목(Mock) HTTP 서버 (`oa-gen mock`)

별도의 사전 빌드 없이 TypeSpec 소스(`.tsp`) 또는 OpenAPI 스펙 문서를 메모리 상에서 직접 서빙하며, 사양 파일이 수정되면 소켓 연결을 끊지 않고 원자적으로 라우트를 핫스왑합니다. 서버는 0단계에서 설치한 동반 패키지 `@oa-sdk/mock-server`가 구동합니다.

```bash
# A. TypeSpec 소스 직접 관측 및 실시간 핫리로드 (권장 SSOT 워크플로, 프로젝트의 TypeSpec 진입점 경로)
npx oa-gen mock --tsp typespec/main.tsp --watch --port 4010

# B. OpenAPI 스펙 문서 관측 및 실시간 핫리로드
npx oa-gen mock --spec ./openapi.yaml --watch --port 4010
```

B의 출력은 다음과 같습니다(경로는 절대 경로로 표시됩니다):

```text
[oa-gen mock] Loading specification: /path/to/project/openapi.yaml...
🚀 Zero-Build Mock Server running at: http://127.0.0.1:4010
📄 Specification: /path/to/project/openapi.yaml
👀 Watch mode enabled: monitoring /path/to/project/openapi.yaml for changes...
```

`init`이 추가한 `mock` 스크립트(`npm run mock`, 즉 `oa-gen mock --watch`)는 경로 옵션 없이 `oa.config.ts`의 spec target(`openapi.yaml`)을 같은 방식으로 서빙합니다.

다른 터미널에서 즉시 목 요청을 테스트할 수 있습니다:

```bash
curl http://localhost:4010/users
# {"items":[],"total":0}
```

---

## 7단계: TypeScript AST 구문 적합성 감사 (`oa-gen audit:shape`)

작성된 TypeScript 모델이 OpenAPI 3.2 및 TypeSpec 계약으로 직접 투영될 수 있는지 24가지 구문 카테고리를 정적 검사합니다.

```bash
npx oa-gen audit:shape --source ./types.ts
```

```text
✅ 0 shape issues found across 9 declaration(s) in 1 file(s). Fully direct TypeSpec/OpenAPI projection.
```

---

## 모노레포 기여자 전용 워크플로 안내

`oa-sdk` 모노레포 자체의 소스 코드 기여자 및 내부 패키지(`@oa-sdk/core`, `@oa-sdk/router`, `@oa-sdk/client` 등)를 빌드·테스트하려는 개발자는 다음 전용 안내서를 따르십시오:

👉 [oa-sdk 모노레포 기여자 온보딩 가이드](./onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩)

---

## 다음 단계 및 권장 문서

- [TypeSpec 5분 퀵스타트 가이드](./typespec/01-quickstart-5min.md) — `.tsp` 엔드포인트 스캐폴딩, 실시간 목 서버, AST diff 및 스냅샷 승인
- [TypeSpec 아티팩트 생성 토폴로지 및 아키텍처 규칙](./typespec/06-generation-topologies-and-rules.md) — Co-located(피처 인접), FSD, Monorepo 4대 생성 방식 및 실무 권장 팁
- [기본 스펙 사용 기준](./basic-spec-usage.md) — 저장소 스펙 거버넌스 및 TypeSpec 정본/산출물 소유권 SSOT
- [TypeSpec 작성 규칙 가이드](./typespec-authoring-conventions.md) — 프로덕션 스펙 작성 규칙, 익스텐션 및 승인 기준
- [CLI 설치 및 환경 설정 가이드](./cli-setup.md) — 패키지 매니저 매트릭스, 런타임 요건, 6단계 루트 탐색
- [프로젝트 온보딩 플레이북](./onboarding-playbook.md) — Fastify, Bun Elysia, Express, NestJS 3계층 온보딩 사다리
- [선언적 사양 설정 가이드 (oa.config.ts)](./declarative-spec-configuration.md) — 이중 계층 설정(`core` vs `product`), 3대 아키타입, `outputRouting` 상세
- [CLI 명령 레퍼런스](./cli-command-reference.md) — 전체 명령어, 옵션 플래그 및 조건부 파라미터 규격
