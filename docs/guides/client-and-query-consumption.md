# 생성 클라이언트와 TanStack Query 사용 가이드

`oa-gen generate:client`가 만드는 fetch 클라이언트와 `oa-gen generate:tanstack`이 만드는 TanStack Query v5 코드를 앱에서 쓰는 방법을 설명합니다. 생성 명령, `createClient` 설정, 메서드 호출 규칙, 오류 처리, 스트리밍, TanStack Query의 키·옵션·훅 이름과 알려진 한계를 다룹니다. 이 문서는 `@oa-sdk/codegen` 0.9.0과 `@oa-sdk/client` 0.2.2 기준입니다.

- 클라이언트를 별도 npm 패키지로 만들어 배포하는 방법은 [클라이언트 SDK 배포 가이드](./client-sdk-distribution.md)를 따릅니다.
- 백엔드 없이 예제를 실행할 mock 서버는 [Mock 서버 사용 가이드](./mock-server-usage.md)를 따릅니다.
- TypeSpec(`.tsp`) 단일 정본 기반의 인메모리 빌더, openapi-ts 스타일 단일 객체 인자 호출, `isErrorStatus` 판별 에러 유니온은 [8절](#8-typespec-builder-platform-및-openapi-ts-스타일-파이프라인) 및 [TypeSpec Builder Platform 가이드](./typespec-builder-platform.md)를 따릅니다.

예제는 다음 operation을 가진 OpenAPI 문서를 기준으로 합니다. 모든 operation은 `bearerAuth`(HTTP bearer) 보안 스킴을 요구합니다.

| operationId | 요청 | 특징 |
|---|---|---|
| `listUsers` | `GET /users` | 쿼리 `limit`, `cursor`, `role`. 응답 `{ items, nextCursor? }`, 응답 헤더 `X-Total-Count` |
| `createUser` | `POST /users` | 본문 `{ name }`. 201 `User`, 409 `Error` |
| `getUserById` | `GET /users/{userId}` | 200 `User`, 404 `Error` |
| `updateUser` | `PATCH /users/{userId}` | 본문 `{ name?, status? }`, 쿼리 `notify`, 헤더 `X-Audit-Reason` |
| `streamAuditEvents` | `GET /audit/events` | `text/event-stream` 응답, `itemSchema`는 `AuditEvent` |

---

## 1. 설치와 생성

### 1.1 설치

```bash
npm install --save-dev @oa-sdk/codegen @oa-sdk/client
```

`@oa-sdk/client`는 `oa-gen`이 실행 중에 불러오는 동반 패키지(companion package)입니다. `generate:client`와 `generate:tanstack`은 생성기를 이 패키지에서 불러오므로, 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다([동반 패키지](./cli-setup.md#동반-패키지-companion-packages)). `@oa-sdk/client`는 `@oa-sdk/codegen` 0.9.0 릴리스에서 처음 npm에 배포됩니다. 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은 [변경 이력](../changelog.md)에서 확인합니다.

### 1.2 타입 없는 클라이언트와 타입 있는 클라이언트

`generate:client`는 `--types-import`를 주었는지에 따라 두 가지 클라이언트를 만듭니다.

| | 타입 없는 클라이언트 | 타입 있는 클라이언트 |
|---|---|---|
| 생성 | `generate:client`만 실행 | `typegen`으로 타입 파일을 만든 뒤 `generate:client --types-import` |
| 메서드 인자 | `Record<string, string>`, `Record<string, unknown>`, `unknown` | `GetUserByIdPathParams`, `ListUsersQueryParams` 등 typegen 타입 |
| 반환 타입 | `JsonPrimitive<unknown>`(`unknown`과 같음) | `JsonPrimitive<GetUserByIdResponse>` 등 |
| operation별 오류 타입과 가드 | 없음 | 오류 응답을 선언한 operation마다 `<Operation>ClientError`, `is<Operation>ClientError()`, `is<Operation>ErrorBody()` |

```bash
# 타입 있는 클라이언트: 타입 파일과 클라이언트를 같은 디렉터리에 생성
npx oa-gen typegen --spec ./openapi.yaml -o src/api/types.ts
npx oa-gen generate:client --spec ./openapi.yaml --types-import ./types.js -o src/api/client.ts
```

- `--types-import`는 생성된 `client.ts` 파일에서 본 import 경로입니다. 위처럼 같은 디렉터리에 두면 `./types.js`입니다.
- `-o`를 생략하면 코드를 stdout으로 출력합니다. `--spec`에는 OpenAPI 3.1/3.2 문서나 TypeSpec(`.tsp`) 파일을 줄 수 있습니다.
- 생성된 클라이언트는 `--types-import` 모듈 외에는 아무것도 import하지 않습니다. 앱이 런타임에 `@oa-sdk/client`를 import할 필요는 없고, 7절의 TanStack Query 코드만 이 패키지에서 타입을 가져옵니다.

`oa.config.ts`를 쓰는 프로젝트에서 `oa-gen generate`가 만드는 `<spec target id>.client.ts`도 같은 생성기로 만듭니다. `core.client.typesImport`를 설정하지 않으면 타입 없는 클라이언트이고, `oa-gen generate`는 typegen을 실행하지 않으므로 타입 파일은 `oa-gen typegen`으로 따로 만듭니다.

---

## 2. `createClient` 설정

```typescript
import { createClient, bearerAuth } from './api/client.js'

const accessToken = sessionStorage.getItem('access_token') ?? ''

export const apiClient = createClient({
  baseUrl: 'https://api.example.com/v1',
  timeout: 10_000,
  retry: { maxRetries: 3, baseDelay: 500 },
  validate: true,
  middleware: [
    bearerAuth(accessToken), // 스펙의 bearerAuth 보안 스킴에서 생성된 함수
    {
      onRequest: (url, init) => {
        console.log(`[HTTP] ${init.method ?? 'GET'} ${url}`)
        return init // onRequest는 RequestInit을 반환해야 합니다
      },
      onError: (error) => console.error('[HTTP failure]', error),
    },
  ],
})
```

| 설정 | 동작 |
|---|---|
| `baseUrl` | 요청 URL의 기준. 생략하면 스펙의 `servers[0]` URL을 씁니다. |
| `headers` | 모든 요청에 넣는 기본 헤더. |
| `timeout` | 시도 한 번에 적용하는 제한 시간(ms). 넘으면 요청을 중단합니다. |
| `retry` | `{ maxRetries, baseDelay }`. 기본값은 `maxRetries: 0`(재시도 안 함), `baseDelay: 1000`. 재시도 대상 operation에서 네트워크 오류와 5xx 응답만 다시 보내고, `baseDelay * 2^n`ms를 기다립니다. 5xx 응답에 `Retry-After` 헤더가 있으면 그 값을 따릅니다. |
| `validate` | `true`이면 요청을 보내기 전에 path·query·header 파라미터와 본문을 스펙 스키마로 검사하고, 맞지 않으면 `TypeError`(`Invalid body` 등)를 던집니다. |
| `middleware` | `{ onRequest?, onResponse?, onError? }` 배열. `onRequest(url, init)`는 `RequestInit`을, `onResponse(response)`는 `Response`를 반환합니다. `onError(error)`는 요청이 실패로 끝날 때 호출됩니다. |

- 재시도 대상은 GET·HEAD·OPTIONS·DELETE operation과 `x-oa-sdk-retryable: true`를 표시한 operation입니다. `x-oa-sdk-retryable: false`는 GET이라도 재시도하지 않습니다. 스트리밍 메서드는 재시도하지 않습니다.
- `onRequest`는 재시도 전에 한 번만 실행됩니다. 재시도마다 헤더를 다시 계산하지 않습니다.

### 2.1 인증 헬퍼

생성된 클라이언트는 스펙의 `components.securitySchemes`에 선언된 스킴마다 미들웨어 함수를 export합니다. 함수 이름은 스킴 키이고, 키가 `auth`로 끝나지 않으면 `Auth`를 붙입니다(`api_key` → `api_keyAuth`).

| 스킴 | 생성되는 함수 |
|---|---|
| `http` + `bearer`, `oauth2`, `openIdConnect` | `(token: string)` → `Authorization: Bearer <token>` |
| `http` + `basic` | `(username: string, password: string)` |
| `apiKey` (`in: header` 또는 `cookie`) | `(key: string)` |
| `apiKey` (`in: query`) | 함수 없음. 쿼리 파라미터로 직접 전달합니다. |

스펙에 보안 스킴이 없으면 인증 함수도 생성되지 않습니다. 같은 동작의 `bearerAuth(token)`, `basicAuth(username, password)`, `apiKeyAuth(...)`는 `@oa-sdk/client` 패키지도 export하므로 어떤 생성 클라이언트에도 넘길 수 있습니다. 다만 이렇게 쓰면 앱이 런타임에 `@oa-sdk/client`를 의존합니다.

헬퍼는 만들 때 받은 토큰 문자열을 고정합니다. 토큰이 바뀌는 앱은 요청할 때마다 토큰을 읽는 미들웨어를 직접 씁니다.

```typescript
const currentTokenAuth = {
  onRequest: (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${localStorage.getItem('access_token') ?? ''}`)
    return { ...init, headers }
  },
}
```

---

## 3. 메서드 호출 규칙

operation마다 operationId와 같은 이름의 메서드가 하나 생성됩니다. 인자는 다음 순서이고, operation에 없는 항목은 빠집니다.

1. path 파라미터 객체 (`{ userId: 'usr_123' }`, 문자열 하나가 아니라 항상 객체)
2. 요청 본문
3. 쿼리 파라미터 객체
4. 헤더 파라미터 객체
5. 옵션 `{ signal?, headers? }`

예제 스펙에서 생성되는 시그니처는 `listUsers(query?, options?)`, `createUser(body, options?)`, `getUserById(params, options?)`, `updateUser(params, body, query?, headers?, options?)`, `streamAuditEvents(query?, options?)`입니다.

```typescript
const controller = new AbortController()

const user = await apiClient.getUserById({ userId: 'usr_123' })
const page = await apiClient.listUsers({ role: 'admin', limit: 20 }, { signal: controller.signal })
const updated = await apiClient.updateUser(
  { userId: 'usr_123' },
  { name: 'Alice' },
  { notify: true },
  { 'X-Audit-Reason': 'profile_update' },
  { signal: controller.signal },
)
```

선택 인자를 건너뛸 때는 그 자리에 `undefined`를 넘깁니다(`apiClient.listUsers(undefined, { signal })`).

생성된 런타임 코드는 다음 호출도 받아들입니다. 하지만 타입 있는 클라이언트의 TypeScript 시그니처에는 이 형태가 없어 컴파일 오류가 나므로(알려진 한계), TypeScript 코드에서는 위의 위치 인자 형태를 씁니다.

- 선택 인자 자리에 `{ signal, headers }`만 가진 객체를 넘기면 옵션으로 해석합니다(`apiClient.listUsers({ signal })`).
- 쿼리 객체 안의 `signal`은 쿼리 문자열로 보내지 않고 요청의 `signal`로 씁니다.
- path 파라미터가 있는 operation은 `{ params, body, query, querystring, headers, signal }` 객체 하나로 호출할 수 있습니다.

---

## 4. 응답 헤더 읽기 (`withResponse`)

기본 메서드는 응답 본문만 반환합니다. 스펙이 응답 헤더를 선언한 operation(스트리밍 operation 제외)에는 `apiClient.withResponse.<operationId>`가 함께 생성되고, 본문·헤더·원본 `Response`를 반환합니다. 응답 헤더를 선언하지 않은 operation에는 `withResponse` 메서드가 없습니다.

```typescript
const { body, headers, response } = await apiClient.withResponse.listUsers({ limit: 20 })

console.log(response.status)
console.log(headers['X-Total-Count']) // 스펙에 적은 이름 그대로, 선언한 타입(integer → number)으로 변환
console.log(body.items.length)
```

`headers`의 키는 스펙에 선언한 대소문자를 그대로 씁니다(`headers['x-total-count']`는 없음). 응답에서 헤더를 찾을 때는 대소문자를 구분하지 않습니다.

---

## 5. 오류 처리

2xx가 아닌 응답은 `ClientError`로 던집니다. `ClientError`는 `status`, `statusText`, `body`(`data`도 같은 값), `response`, `operationId`를 가집니다. `isClientError(error)`는 `instanceof`가 실패하는 환경(iframe, 다른 번들)에서도 `name`, `status`, `body`/`data`, `response` 속성으로 `ClientError`를 알아봅니다.

타입 있는 클라이언트는 오류 응답을 선언한 operation마다 오류 타입과 가드를 함께 export합니다. 상태 코드를 넘기면 그 상태의 본문 타입으로 좁혀집니다.

```typescript
import { isClientError, isGetUserByIdClientError } from './api/client.js'

try {
  await apiClient.getUserById({ userId: 'missing' })
} catch (error) {
  if (isGetUserByIdClientError(error, 404)) {
    console.error(error.body.code, error.body.message) // 404 응답의 Error 스키마
  } else if (isClientError(error)) {
    console.error(`HTTP ${error.status} ${error.statusText}`, error.data, error.operationId)
  } else {
    throw error // 네트워크 오류, 타임아웃, validate 실패(TypeError) 등
  }
}
```

`is<Operation>ErrorBody(body, status?)`는 본문만 검사합니다. 두 가드 모두 스펙의 오류 응답 스키마로 본문을 실제 검사합니다.

---

## 6. 스트리밍 (SSE, NDJSON)

`text/event-stream`이나 NDJSON 응답을 선언한 operation은 `AsyncGenerator`를 반환하는 메서드로 생성되어 `for await ... of`로 읽습니다. 항목 타입은 `--types-import`를 주어도 `unknown`이므로, 쓰기 전에 좁힙니다. 타입 가드는 [순수 타입과 타입 가드 가이드](./pure-types-and-guards.md)의 `oa-gen generate:guards`로 만들 수 있습니다.

```typescript
const controller = new AbortController()

try {
  for await (const event of apiClient.streamAuditEvents({ channel: 'security' }, { signal: controller.signal })) {
    if (!isAuditEvent(event)) continue // 직접 작성하거나 generate:guards로 만든 가드
    console.log(`[${event.level}] ${event.message}`)
    if (event.level === 'critical') {
      controller.abort() // 응답 스트림 읽기를 취소
      break
    }
  }
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    console.log('Stream cancelled')
  } else {
    throw error
  }
}
```

SSE에서는 `data:` 줄만 읽습니다. JSON으로 파싱되지 않는 `data` 프레임과 `[DONE]` 프레임은 오류 없이 건너뜁니다. `timeout`은 응답 헤더를 받을 때까지만 적용됩니다.

---

## 7. TanStack Query v5

`oa-gen generate:tanstack`은 TanStack Query v5용 코드를 3계층으로 만듭니다. Tier 1은 쿼리 키 팩토리, Tier 2는 `queryOptions()`·`mutationOptions()` 팩토리, Tier 3은 React 훅입니다.

### 7.1 생성

```bash
# fetch 클라이언트를 같은 디렉터리에 먼저 생성 (TanStack 코드가 ./client.js에서 ApiClient 타입을 가져옵니다)
npx oa-gen generate:client --spec ./openapi.yaml -o src/api/client.ts
npx oa-gen generate:tanstack --spec ./openapi.yaml -o src/api

# 생성된 코드가 import하는 TanStack Query (React 기준)
npm install @tanstack/react-query
```

생성된 파일은 `@tanstack/react-query`와 `@oa-sdk/client`의 타입(`JsonPrimitive`, `Resolved`)을 import합니다. 따라서 1.1절처럼 앱 프로젝트에 `@oa-sdk/client`가 설치되어 있어야 합니다(타입만 쓰므로 `devDependencies`로 충분합니다).

| 옵션 | 동작 |
|---|---|
| `-o, --output` | `.ts`로 끝나면 그 파일, 디렉터리면 `<디렉터리>/tanstack-query.ts`에 씁니다. 생략하면 `oa.config.ts`의 `outputRouting` 경로, 그것도 없으면 `src/api/generated/tanstack-query.ts`입니다. |
| `--tier` | `all`(기본), `keys`, `options`, `hooks`. `--split`에서는 계층이 누적됩니다: `options`는 `keys`를, `hooks`는 `keys`와 `queries`를 의존성으로 함께 씁니다. 단일 파일 모드(`--split` 없음)에서는 선택한 계층까지 인라인되어 imports 없이 자기완결적입니다. |
| `--framework` | `react`(기본), `vue`, `svelte`. `vue`·`svelte`는 **keys와 options**를 생성합니다. 옵션 계층은 모든 어댑터가 `@tanstack/query-core`에서 재노출하는 프레임워크 중립 타입(`QueryObserverOptions`, `MutationObserverOptions`, `InfiniteQueryObserverOptions`)을 씁니다. Tier 3 훅은 React 훅 타입(`useQuery`, `UseQueryResult` 등)을 쓰므로 `vue`·`svelte`에서는 생성하지 않으며, `--tier hooks`와 함께 쓰면 오류로 끝납니다. |
| `--client-import` | `ApiClient` 타입을 가져올 모듈. 기본값은 `./client.js`입니다. 배포된 클라이언트 패키지를 쓸 때 지정합니다. |
| `--types-import` | typegen 타입을 가져올 모듈. 7.4절의 한계를 먼저 확인합니다. |
| `--split` | 출력 디렉터리에 `keys.ts`, `queries.ts`, `hooks.ts`를 따로 씁니다. `outputRouting`이 있으면 keys/queries는 라우팅된 경로에 쓰고 hooks는 queries 옆에 쓰며, 상대 import는 실제 경로 차이에서 계산합니다. |

`generate:tanstack`이 쓴 파일은 `.oa-manifest.json`에 `producer: "generate:tanstack"`으로 기록됩니다. `oa-gen generate`는 자신이 기록한 생성 파일만 정리하므로, 같은 프로젝트에서 `oa-gen generate`를 실행해도 `generate:tanstack` 출력은 지워지지 않습니다([생성 파일 정리](./declarative-spec-configuration.md#45-생성-파일-정리)). `oa-gen generate`가 함께 만드는 TanStack 코드는 7.5절을 봅니다.

### 7.2 생성되는 이름

이름은 operationId와 OpenAPI tag에서 만듭니다(tag가 `users`, operationId가 `getUserById`인 경우).

| 계층 | 이름 | 예 |
|---|---|---|
| Tier 1 키 | `<camelCase tag>Keys`와 단수·복수 별칭, 모든 키를 묶은 `queryKeys`, `QueryKeys` 타입. tag가 없으면 경로의 첫 세그먼트를 씁니다. | `usersKeys`(별칭 `userKeys`), `usersKeys.detail(id)`, `usersKeys.getUserById(params)` |
| Tier 2 옵션 | `<operationId>QueryOptions`, `<operationId>MutationOptions`, 페이지네이션 operation의 `<operationId>InfiniteQueryOptions`, 뮤테이션 변수 타입 `<OperationId>Variables` | `getUserByIdQueryOptions`, `updateUserMutationOptions`, `listUsersInfiniteQueryOptions`, `UpdateUserVariables` |
| Tier 3 훅 | `use<OperationId>Query`, `use<OperationId>Mutation`, `use<OperationId>InfiniteQuery`, `createApiHooks` | `useGetUserByIdQuery`, `useUpdateUserMutation` |

- 옵션 팩토리와 훅의 첫 인자는 `createClient()`가 만든 클라이언트입니다. 그 뒤 인자는 클라이언트 메서드와 같은 순서(path 파라미터, 본문, 쿼리, 헤더)이고 마지막이 TanStack 옵션입니다.
- 뮤테이션 변수는 `{ params, body, query?, headers? }` 형태입니다(operation에 있는 항목만).
- `createApiHooks(useClient)`는 클라이언트를 돌려주는 훅(예: React Context에서 클라이언트를 읽는 `useApiClient`)을 받아, 클라이언트 인자가 없는 훅 묶음(`useGetUserById`, `useUpdateUser` 등)을 반환합니다.
- 키는 tag별 `all → lists/list(filters) → details/detail(id) → subresource` 계층이라 `queryClient.invalidateQueries({ queryKey: usersKeys.all })`처럼 계층 단위로 무효화할 수 있습니다.

### 7.3 React 예제

`--types-import` 없이 생성한 코드는 응답 데이터 타입이 `unknown`입니다. 화면에 그대로 출력하거나, 쓰기 전에 좁힙니다.

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from './api/client.js'
import { getUserByIdQueryOptions, useUpdateUserMutation, usersKeys } from './api/tanstack-query.js'

const apiClient = createClient({ baseUrl: 'http://localhost:4010' })

export function UserProfile({ userId }: { userId: string }) {
  const queryClient = useQueryClient()

  // queryFn이 TanStack의 AbortSignal을 클라이언트에 넘기므로 언마운트 시 요청이 취소됩니다
  const { data: user, isLoading, error } = useQuery(getUserByIdQueryOptions(apiClient, { userId }))

  const mutation = useUpdateUserMutation(apiClient, {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.detail(userId) }),
  })

  if (isLoading) return <div>로딩 중...</div>
  if (error) return <div>오류: {error.message}</div>

  return (
    <div>
      <pre>{JSON.stringify(user, null, 2)}</pre>
      <button onClick={() => mutation.mutate({ params: { userId }, body: { status: 'active' } })}>활성화</button>
    </div>
  )
}
```

옵션 팩토리는 `queryClient.prefetchQuery()`·`fetchQuery()`에도 그대로 넘길 수 있습니다. 다만 기본 생성 파일(`tanstack-query.ts`)은 훅을 담고 있어 맨 위에 `'use client'` 지시문이 있습니다. React Server Component(Next.js App Router 등)에서 이 파일의 옵션 팩토리를 호출하면 `Attempted to call getUserByIdQueryOptions() from the server but getUserByIdQueryOptions is on the client` 오류가 납니다. 서버에서 prefetch하려면 7.1절 `--tier` 설명처럼 `keys.ts`와 `queries.ts`를 따로 생성하고, 지시문이 없는 `queries.ts`에서 옵션 팩토리를 import합니다(Next.js 15 App Router에서 확인).

### 7.4 응답 타입을 붙이기 (`--types-import`)

`oa-gen typegen` 출력을 클라이언트와 TanStack 코드에 같은 `--types-import`로 넘깁니다. 세 생성물이 같은 operation 이름 규칙을 쓰므로 `<Operation>Response`, `<Operation>Body`, `<Operation>Error`, `<Operation>ErrorByStatus`, `<Operation>PathParams` 등을 그대로 import하며 `tsc`를 통과합니다. 오류 응답이 있는 operation의 `<Operation>ClientError`는 클라이언트가 스스로 선언하므로 typegen에 없어도 됩니다. `--split`으로 keys/queries/hooks를 나눠도 같습니다.

```bash
oa-gen typegen --spec ./openapi.yaml -o ./src/api/types.ts
oa-gen generate:client --spec ./openapi.yaml -o ./src/api/client.ts --types-import ./types.js
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api --types-import ./types.js
```

한쪽에만 `--types-import`를 주면 컴파일되지 않습니다. TanStack에만 생략하면 키·파라미터가 `Record<string, …>`로 생성되어 typed 클라이언트의 시그니처와 맞지 않고(`TS2345`), 클라이언트에만 생략하면 응답 타입이 `unknown`이 됩니다. 같은 모듈을 둘 다에 넘기세요.

typegen이 응답/본문 타입을 만들지 않는 경우(스트리밍, 비-JSON media type, 본문 없는 응답)에는 TanStack도 같은 규칙으로 그 이름을 import하지 않으므로 별칭 모듈이 필요 없습니다. 해당 operation은 클라이언트 메서드를 직접 쓰거나 별도 타입을 붙입니다.

`oa-gen generate`의 `<id>.queries.ts`는 `ApiClient` 타입을 `<id>.client.ts`에서 가져오므로, 타입이 있는 클라이언트를 넘겨도 응답 타입은 `JsonPrimitive<unknown>`입니다.

### 7.5 `oa-gen generate`가 만드는 TanStack 코드

`oa.config.ts`를 쓰는 프로젝트에서는 `oa-gen generate`가 spec target마다 TanStack 코드를 함께 씁니다(항상 `@tanstack/react-query` 대상).

- `outputRouting`이 있으면(`oa-gen init` 기본 설정) `<id>.keys.ts`(키)와 `<id>.queries.ts`(옵션 팩토리)만 쓰고 훅은 쓰지 않습니다. 옵션 팩토리를 `useQuery`에 넘겨 씁니다.
- `outputRouting`이 없으면 `<id>.queries.ts` 한 파일에 키·옵션·훅을 모두 씁니다.

이 코드도 `--types-import` 없이 생성하므로 데이터 타입은 `unknown`입니다.

---

## 8. 무한 스크롤 (Infinite Query)

조회 operation에 다음 이름의 쿼리 파라미터가 있으면 `<operationId>InfiniteQueryOptions`와 `use<OperationId>InfiniteQuery`를 함께 생성합니다(대소문자 무시).

| 방식 | 파라미터 이름 | 첫 페이지 값 |
|---|---|---|
| 커서 | `cursor`, `starting_after`, `after`, `next_cursor`, `page_token`, `pageToken` | `null` |
| 페이지 번호 | `page`, `page_number`, `pageNumber`, `page_index`, `pageIndex`, `page_no`, `pageNo` | `1` |
| 오프셋 | `offset`, `skip` | `0` |

기본 `getNextPageParam`은 마지막 응답에서 다음 값을 추측합니다. 커서 방식은 `next_cursor`, `nextCursor`, `next_page_token`, `nextPageToken`, `cursor`, `starting_after`를 읽고, 없으면 `hasMore: false` 등에서 멈추며, 그것도 없으면 `items`·`data`·`results` 배열의 마지막 항목 `id`를 다음 커서로 씁니다. 페이지 번호 방식은 `nextPage`·`totalPages` 등을, 오프셋 방식은 `total`과 항목 수를 봅니다.

```tsx
import { useInfiniteQuery } from '@tanstack/react-query'
import { listUsersInfiniteQueryOptions } from './api/tanstack-query.js'

const { data, fetchNextPage, hasNextPage } = useInfiniteQuery(
  listUsersInfiniteQueryOptions(apiClient, { limit: 10 }),
)
```

무한 쿼리는 목록 쿼리와 다른 키(`[...usersKeys.listUsers(query), 'infinite']`)를 씁니다. 따라서 같은 필터로 두 쿼리를 함께 써도 캐시 항목이 섞이지 않습니다. 키 앞부분이 같으므로 `usersKeys.listUsers(filters)`로 무효화하면 두 캐시가 함께 무효화됩니다.

알려진 한계는 다음과 같습니다.

- 커서 방식의 첫 요청은 `cursor=null`을 쿼리 문자열로 보냅니다. 서버가 이 값을 거부하면 `initialPageParam`을 `undefined`로 바꿉니다(아래 예).
- 세 번째 인자(TanStack 옵션)를 넘길 때는 타입상 `initialPageParam`과 `getNextPageParam`을 함께 넘겨야 합니다.

`cursor=null`을 보내지 않으려면 `initialPageParam`을 바꿉니다.

```tsx
import type { InfiniteData } from '@tanstack/react-query'
import type { JsonPrimitive } from '@oa-sdk/client'
import type { ListUsersResponse } from './api/types.js'

// 7.4절처럼 타입을 붙여 생성한 코드 기준
const options = listUsersInfiniteQueryOptions<InfiniteData<JsonPrimitive<ListUsersResponse>>, string | undefined>(
  apiClient,
  { limit: 10 },
  { initialPageParam: undefined, getNextPageParam: (lastPage) => lastPage.nextCursor },
)
```

스트리밍 operation(`text/event-stream`, `application/x-ndjson`, `application/jsonl`, `application/stream+json` 응답 또는 요청 본문)은 키 팩토리에만 나타나고 `<operationId>QueryOptions`·`MutationOptions`·훅은 생성하지 않습니다. `queryFn`이 `AsyncGenerator`를 데이터로 반환하는 캐시는 TanStack 모델에 맞지 않기 때문입니다. 스트리밍 operation은 6절처럼 클라이언트 메서드를 직접 쓰고, 무효화가 필요하면 생성된 키를 사용하세요.

---

## 8. TypeSpec Builder Platform 및 openapi-ts 스타일 파이프라인

CLI를 통한 파일 생성(`oa-gen generate:client`) 외에도, TypeSpec(`.tsp`)을 단일 정본으로 사용하는 프로젝트에서는 `@oa-sdk/codegen`의 **프로그래머블 인메모리 빌더 API**(`createTspBuilder`)를 활용할 수 있습니다.

### 8.1 호출 규약 비교: 위치 인자 vs openapi-ts 단일 객체 인자

| 항목 | CLI 생성 클라이언트 (`@oa-sdk/client`) | openapi-ts 스타일 클라이언트 (`pluginClient`) |
|---|---|---|
| 메서드 형태 | `client.getUserById({ userId }, { signal })` | 독립 함수 `getUserById({ path: { userId }, signal })` 또는 `client.get({ url: '/users/{userId}', path: { userId }, signal })` |
| 클라이언트 생성 | `createClient(config)` | `createClient(config)` (`setDefaultClient(client)`로 기본 클라이언트 교체) |
| 엔드포인트 명시성 | operationId 기반 메서드 | operationId 기반 독립 함수(짧은 이름 `getUserById`와 전체 이름 `usersGetUserById`) 또는 HTTP 메서드 + URL 경로 |
| 인자 바인딩 | 파라미터별 분리 인자 | `{ path, query, body, headers }` 단일 객체 |
| 오류 식별 패턴 | try-catch + `<Op>ClientError` | `{ data, error, response }` + `isErrorStatus(res, code)` (선언된 상태는 `res.error`까지 축소) |
| 빌드 파이프라인 | CLI 사전 생성 파일 디스크 저장 | 인메모리 프로그래머블 빌더 / Vite dev loop 실시간 HMR |

### 8.2 멀티 상태 에러 식별 유니온 (`isErrorStatus`)

openapi-ts 스타일 클라이언트의 결과 타입 `ClientResult<TData, TError, TErrors>`는 오퍼레이션이 선언한 에러 상태마다 분기를 가집니다. `isErrorStatus(res, status)`는 선언된 상태라면 `res.error`를 그 상태의 모델(`<Op>Errors[status]`)로, 선언되지 않은 상태라면 `response.status`만 좁힙니다. 아래 예시는 TypeSpec `Users` 네임스페이스에 `op getUserById(@path userId: string): User | NotFound | Conflict`(`NotFound`는 `@statusCode code: 404`, `Conflict`는 `@statusCode code: 409`인 `@error` 모델)를 선언한 경우입니다(operationId `Users_getUserById`):

```typescript
import { createClient, getUserById, isErrorStatus } from './api/client.js'

const client = createClient({ baseUrl: 'https://api.example.com' })

const res = await getUserById({
  client,
  path: { userId: 'user-123' },
})

if (res.error) {
  if (isErrorStatus(res, 404)) {
    // res.error는 NotFound (= GetUserByIdErrors[404])로 축소됩니다
    console.error('사용자를 찾을 수 없습니다:', res.error.message)
  } else if (isErrorStatus(res, 409)) {
    // res.error는 Conflict (= GetUserByIdErrors[409])로 축소됩니다
    console.warn('충돌 발생:', res.error.conflictKey)
  } else {
    // 그 밖의 상태: res.error는 에러 유니온 NotFound | Conflict
    console.error(`HTTP ${res.response.status}`, res.error)
  }
  return
}

// res.data는 200 OK User 페이로드로 추론됩니다
console.log('조회 성공:', res.data.name)
```

- `GetUserByIdErrors`는 `pluginTypescript`가 만든 `<BaseName>ErrorByStatus`(예: `UsersGetUserByIdErrorByStatus`)의 별칭이고, `GetUserByIdErrorUnion`(`ErrorUnion<GetUserByIdErrors>`)은 `{ status: 404; error: NotFound } | { status: 409; error: Conflict }`입니다. `default` 응답이 있으면 `{ status: number; error: ... }` 멤버가 추가됩니다.
- `isErrorStatus`는 에러 본문이 있는 응답(`res.error !== undefined`)에서만 참입니다. `fetch`와 `axios` 전송 모두 빈 본문을 `undefined`로, JSON 본문을 파싱한 값으로, 그 밖의 텍스트를 문자열로 읽으므로 전송 방식과 관계없이 같은 결과가 나옵니다(`axios`는 이를 위해 `responseType: 'text'`로 요청합니다).

### 8.2.1 TanStack Query와 함께 쓰기

빌더에서 `pluginTanstackQuery`를 `pluginClient`와 함께 쓰면, 생성된 TanStack 코드가 받는 오퍼레이션 메서드 클라이언트(`ApiClient`)를 `pluginClient` SDK 위에 구현한 `api-client.ts`가 함께 생성됩니다. TanStack 심볼은 operationId의 전체 이름(`usersGetUserById*`)을 씁니다:

```typescript
import { createClient } from './api/client.js'
import { ApiClientResponseError, createApiClient } from './api/api-client.js'
import { usersGetUserByIdQueryOptions } from './api/queries.js'

const apiClient = createApiClient(createClient({ baseUrl: 'https://api.example.com' }))

try {
  // 성공 응답은 payload로 resolve됩니다
  const user = await queryClient.fetchQuery(usersGetUserByIdQueryOptions(apiClient, { userId: 'user-123' }))
  console.log(user.name)
} catch (error) {
  if (error instanceof ApiClientResponseError) {
    // 에러 모델이 선언되지 않은 상태(예: 500)나 빈 본문: status, body, response를 가집니다
    console.error(`HTTP ${error.status}`, error.body)
  } else {
    // 선언된 상태(404/409)는 파싱한 에러 본문 자체로 reject됩니다: NotFound | Conflict (= UsersGetUserByIdError)
    console.error(error)
  }
}
```

- reject 값은 생성된 TanStack 코드가 선언한 에러 타입(`QueryObserverOptions<..., UsersGetUserByIdError | Error, ...>`)과 맞춰집니다. 응답 상태에 `application/json` 에러 모델이 선언되어 있으면(명시적 4xx/5xx, 또는 다른 응답 항목이 다루지 않는 상태의 `default`) 파싱한 본문으로, 아니면 `ApiClientResponseError`로 reject됩니다. 에러 모델이 없는 오퍼레이션의 TanStack 에러 타입은 `Error`이고 항상 `ApiClientResponseError`로 reject됩니다.
- 에러 모델이 있는 오퍼레이션의 `TError`는 `<Op>Error | Error`입니다. 네트워크 오류, abort, `ApiClientResponseError`가 모두 포함되므로 `query.error`/`onError`에서는 `instanceof ApiClientResponseError`(또는 `isClientError`)로 HTTP 오류를 먼저 좁히고 나머지를 transport 오류로 다룹니다.
- 어댑터는 SDK 함수를 `throwOnError: false`로 호출하므로 `createClient({ throwOnError: true })` 설정과 무관하게 같은 값으로 reject됩니다.

### 8.3 Vite dev loop 통합 및 상세 가이드

인메모리 빌더 및 Vite 플러그인(`vitePluginTsp`), TanStack Query 3계층 자동 생성, Wire 통신 압축 연동에 관한 상세 내용은 다음 문서를 참조하십시오:
- **[TypeSpec Builder Platform 가이드](./typespec-builder-platform.md)**: 전체 아키텍처, 빌더 라이프사이클, 플러그인 작성법, Vite HMR 설정.
- **[TypeSpec Builder 사용성 평가 리포트](../reports/typespec-builder-usability-report.md)**: DX 4.92 / 5.0, 18개 E2E 시나리오 검증, 콜드 95ms / 웜 0.18ms 벤치마크.

