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

다른 프로젝트에 공개 패키지를 설치해 `@oa-sdk`의 전체 흐름(온보딩 $\rightarrow$ 스펙 검증 $\rightarrow$ 정적 타입 생성 $\rightarrow$ Zod 4 검증 스키마 $\rightarrow$ TanStack Query 프론트엔드 $\rightarrow$ 핸들러 계약·클라이언트 일괄 생성 $\rightarrow$ mock 서버)을 직접 실행합니다. 이 문서는 `@oa-sdk/codegen` 0.9.0 기준입니다.

> 💡 **TypeSpec(`.tsp`)으로 작성하는 경우**: 이 가이드의 예시는 `openapi.yaml`을 원본으로 쓰지만, `validate`, `typegen`, `generate:zod`, `generate:client`, `generate:tanstack`의 `--spec`에는 `.tsp` 파일을 그대로 넘길 수 있고 `mock`은 `--tsp`로 받습니다. TypeSpec 작성에 필요한 패키지는 [CLI 설치 및 설정 가이드](./cli-setup.md#typespec-작성-의존성)를 따릅니다.
>
> 💡 **oa-sdk 저장소 기여자**: 저장소의 production TypeSpec 계약(`packages/schemas`)을 고치는 흐름은 이 가이드가 아니라 [TypeSpec 기여 워크플로](./typespec/01-quickstart-5min.md)를 따릅니다.
>
> 💡 **패키지 매니저별 설치 및 런타임 설정 상세**: [CLI 설치 및 설정 가이드](./cli-setup.md)
>
> 💡 **선언적 설정 파일(`oa.config.ts`) 상세 스펙**: [선언적 사양 설정 가이드](./declarative-spec-configuration.md)

---

## 0단계: 30초 제로 마찰 온보딩 (`oa-gen init`)

프로젝트 루트에서 `oa-gen init`을 실행하면 프레임워크(Fastify, Elysia, Hono, Express, NestJS)와 스펙 소스(`.tsp`, `openapi.yaml`, `openapi.json`, `@oaOperation` JSDoc)를 감지하여 `oa.config.ts`와 `package.json` 스크립트를 구성합니다.

> **준비**
> - Node.js 22 이상. CI가 Node.js 22·24·26에서 배포 후보를 설치해 확인합니다.
> - `@oa-sdk/codegen` 0.9.0 이상. `@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`는 `@oa-sdk/codegen` 0.9.0 릴리스에서 처음 npm에 배포됩니다. 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은 [변경 이력](../changelog.md)에서 확인합니다.
> - Bun은 CI에서 검증하지 않습니다. `oa-gen init`이 Bun용 스크립트를 쓸 수는 있지만 지원 환경으로 약속하지 않습니다.

```bash
# 로컬 개발 의존성 설치: CLI와 4~6단계가 사용하는 동반 패키지
npm install --save-dev @oa-sdk/codegen @oa-sdk/router @oa-sdk/client @oa-sdk/mock-server

# 비대화형 자동 감지 온보딩 실행
npx oa-gen init --yes
```

`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`는 `oa-gen`이 필요할 때 불러오는 **동반 패키지(companion package)**입니다. `@oa-sdk/codegen`을 설치해도 함께 설치되지 않으므로 위처럼 같이 설치합니다.

- `init`이 생성하는 `oa.config.ts`는 핸들러 계약과 클라이언트 SDK를 켭니다(`core.contracts.pureHandlers: true`, `core.client.enabled: true`). 그래서 5단계의 `oa-gen generate`에는 `@oa-sdk/router`와 `@oa-sdk/client`가 필요합니다.
- 4단계의 `generate:client`·`generate:tanstack`에는 `@oa-sdk/client`가, 6단계의 `mock`과 `init`이 추가하는 `mock` 스크립트에는 `@oa-sdk/mock-server`가 필요합니다. mock-server는 MSW 어댑터를 `@oa-sdk/mock-server/adapters/msw`·`/browser`에만 두고 `oa-gen mock`은 Node HTTP 어댑터만 쓰므로, MSW(`msw`)는 설치하지 않아도 됩니다.
- `init`도 이 패키지들을 `devDependencies`에 기록하지만, `package.json`에 이미 있는 버전은 바꾸지 않습니다(`--force` 제외). 기록하는 버전은 이 codegen이 빌드된 릴리스와 호환되는 범위(`^<버전>`)이고, 해당 패키지를 멤버로 가진 pnpm 워크스페이스 안에서만 `workspace:*`입니다.
- 동반 패키지 없이 이 명령들을 실행하면, 출력을 건너뛰지 않고 설치 명령을 출력한 뒤 종료 코드 1로 실패합니다.
- `init`이 쓰는 `oa.config.ts`는 ES module입니다. `npm init -y`가 만드는 `"type": "commonjs"` 프로젝트에서도 `oa-gen`이 ES module로 변환해 불러오므로 `package.json`을 바꿀 필요가 없습니다.

자세한 규칙은 [동반 패키지 안내](./cli-setup.md#동반-패키지-companion-packages)를 참고하세요.

---

## 1단계: OpenAPI·TypeSpec 스펙 검증 (`oa-gen validate`)

사람이 고치는 원본은 OpenAPI 문서나 TypeSpec(`.tsp`) 파일 하나입니다. `oa-gen validate`는 원본의 문법, 컴포넌트 참조(`$ref`), OpenAPI 3.2 전용 기능의 정합성을 검사합니다.

이 가이드의 예시 출력은 프로젝트 루트에 둔 다음 `openapi.yaml`(사용자 API)을 기준으로 합니다. 0단계의 `init`은 스펙이 없으면 이 경로를 `schemaEntry`로 기록합니다. TypeSpec으로 작성한다면 `.tsp` 진입점을 `--spec`에 그대로 넘깁니다.

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
# 관리 대상 계약은 OpenAPI 3.2.x를 요구 (.tsp 진입점도 같은 옵션으로 검증)
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

OpenAPI 스펙으로부터 런타임 코드가 없는 TypeScript 타입 선언 파일을 만듭니다.

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

OpenAPI 3.2 사양(JSON Schema Draft 2020-12 어휘)을 Zod 4 코드로 변환합니다. 수치 배타적 경계(`.gt()`, `.lt()`), 튜플 프리픽스(`z.tuple()`), 순환 참조(`z.lazy()`)를 지원합니다. 생성된 파일은 `zod`(4.x)를 import하므로 프로젝트에 `zod`를 설치합니다.

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
  // Tier 2 순수 옵션 팩토리를 그대로 useQuery에 전달
  const { data: user, isLoading } = useQuery(getUserQueryOptions(client, { userId }))

  if (isLoading) return <div>로딩 중...</div>
  return <pre>{JSON.stringify(user, null, 2)}</pre>
}
```

`tanstack-query.ts`는 훅을 담고 있어 첫머리에 `'use client'` 지시문이 있으므로 Next.js Server Component에서는 이 파일의 옵션 팩토리를 호출할 수 없습니다. Server Component의 `queryClient.prefetchQuery`에는 `'use client'`가 없는 옵션 파일을 씁니다([온보딩 플레이북의 Next.js App Router SSR 프리페칭](./onboarding-playbook.md#410-nextjs-app-router-ssr-프리페칭--하이드레이션)).

---

## 5단계: 핸들러 계약·클라이언트 일괄 생성 (`oa-gen generate`)

선언적 `oa.config.ts` 설정에 따라 OpenAPI 문서, 핸들러 계약, 클라이언트 SDK, TanStack Query 키·옵션을 한 번에 생성합니다. 핸들러 계약은 `@oa-sdk/router`, 클라이언트 SDK는 `@oa-sdk/client`가 생성합니다. `init`이 만든 설정은 두 산출물을 명시적으로 켜므로, 둘 중 하나라도 설치되어 있지 않으면 `oa-gen generate`는 파일을 쓰기 전에 설치 명령을 출력하고 종료 코드 1로 실패합니다.

```bash
npx oa-gen generate
```

`init`이 프레임워크를 감지하지 못한 프로젝트(`target: 'generic'`, spec target id `generic-api`)에서는 다음 파일을 씁니다. 프레임워크를 감지한 프로젝트는 파일 이름의 id만 다릅니다(예: `fastify-api`).

- `src/generated/generic-api.openapi.json`, `src/generated/generic-api.schema.json`: OpenAPI 문서(설정의 `core.dialect.oasVersion`, init 기본 3.2.0)와 JSON Schema
- `src/api/generic-api/generic-api.contract.ts`: 프레임워크와 무관한 핸들러 계약(`ApiHandlers`, `<Operation>Context`, `HandlerResponse`). 구현은 이 파일이 아니라 별도 파일에 쓰므로 다시 생성해도 구현 코드는 덮어쓰이지 않습니다.
- `src/api/generic-api/generic-api.client.ts`: 클라이언트 SDK
- `src/api/generic-api/generic-api.keys.ts`, `src/api/generic-api/generic-api.queries.ts`: TanStack Query 키·옵션 팩토리

`oa-gen generate`는 서버 쪽에 프레임워크와 무관한 핸들러 계약(`<id>.contract.ts`)만 생성합니다. Fastify·Express·Hono·Elysia 라우터 코드가 필요하면 빌드 스크립트에서 `@oa-sdk/router`의 `generateRouter()`를 호출해 파일로 씁니다. `oa-gen` 명령으로는 라우터 파일을 만들지 않으며, `init`이 프레임워크 대상에 추가하는 `generate:router` 스크립트도 `oa-gen generate`와 같은 일을 할 뿐 라우터 파일을 만들지 않습니다. 빌드 스크립트 예시는 [온보딩 플레이북의 프레임워크 연결 레시피](./onboarding-playbook.md#4-프레임워크-연결-레시피-framework-recipes)에 있습니다.

`oa-gen generate`가 만든 핸들러 계약과 클라이언트의 요청·응답 타입은 `unknown`입니다. 타입이 있는 핸들러 계약이 필요하면 위 레시피처럼 `oa-gen typegen` 출력과 `generateHandlerContract(spec, { typesImport })`를 함께 씁니다.

`oa-gen generate`는 `.oa-manifest.json`에 기록된 생성 파일 중 이번 실행이 만들지 않고 내용도 바뀌지 않은 파일을 지웁니다. `oa-gen generate:tanstack` 등 다른 명령이 같은 프로젝트에 쓴 파일도 지워지므로, `oa-gen generate`를 쓰는 프로젝트에서는 TanStack 코드도 `generate`가 만드는 `<id>.queries.ts`에서 가져옵니다. `outputRouting.pruneOrphans: false`는 현재 이 삭제를 막지 못합니다(알려진 결함). 그래서 4단계의 `src/api/tanstack-query.ts`가 지워지며, 4단계 예제는 같은 팩토리를 담은 `./api/generic-api/generic-api.queries.js`와 `./api/generic-api/generic-api.client.js`에서 `getUserQueryOptions`와 `createClient`를 import하도록 바꿉니다. outputRouting을 쓰는 `init` 설정의 `<id>.queries.ts`에는 `use*` 훅이 없으므로, 훅이 필요하면 4단계처럼 `useQuery(getUserQueryOptions(client, { userId }))`로 씁니다.

---

## 6단계: mock HTTP 서버 (`oa-gen mock`)

별도의 사전 빌드 없이 TypeSpec 소스(`.tsp`) 또는 OpenAPI 스펙 문서를 메모리에서 바로 서빙하며, `--watch`를 주면 스펙 파일이 바뀔 때 서버를 재시작하지 않고 route를 교체합니다. 요청은 계약으로 검증해 잘못된 본문은 422로 거절합니다. 서버는 0단계에서 설치한 동반 패키지 `@oa-sdk/mock-server`가 구동합니다.

```bash
# A. TypeSpec 원본을 직접 서빙 (프로젝트의 TypeSpec 진입점 경로)
npx oa-gen mock --tsp typespec/main.tsp --watch --port 4010

# B. OpenAPI 스펙 문서를 서빙
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

다른 터미널에서 mock 요청을 테스트할 수 있습니다:

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

- [CLI 설치 및 환경 설정 가이드](./cli-setup.md) — 패키지 매니저 매트릭스, 런타임 요건, 동반 패키지, TypeSpec 작성 의존성
- [CLI 명령 레퍼런스](./cli-command-reference.md) — 전체 명령어, 옵션 플래그 및 조건부 파라미터 규격
- [프로젝트 온보딩 플레이북](./onboarding-playbook.md) — 단계별 도입 순서와 Fastify, Express, Hono, Elysia, NestJS 연결 레시피
- [선언적 사양 설정 가이드 (oa.config.ts)](./declarative-spec-configuration.md) — 이중 계층 설정(`core` vs `product`), 아키타입, `outputRouting` 상세
- oa-sdk 저장소 기여자용: [TypeSpec 기여 워크플로](./typespec/01-quickstart-5min.md), [기본 스펙 사용 기준](./basic-spec-usage.md), [TypeSpec 작성 규칙 가이드](./typespec-authoring-conventions.md), [TypeSpec 아티팩트 생성 토폴로지 및 아키텍처 규칙](./typespec/06-generation-topologies-and-rules.md)
