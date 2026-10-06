# 생성 클라이언트와 TanStack Query 사용 가이드

`oa-gen generate:client`가 만드는 fetch 클라이언트와 `oa-gen generate:tanstack`이 만드는 TanStack Query v5 코드를 앱에서 쓰는 방법을 설명합니다. 생성 명령, `createClient` 설정, 메서드 호출 규칙, 오류 처리, 스트리밍, TanStack Query의 키·옵션·훅 이름과 알려진 한계를 다룹니다. 이 문서는 `@oa-sdk/codegen` 0.9.0과 `@oa-sdk/client` 0.2.2 기준입니다.

- 클라이언트를 별도 npm 패키지로 만들어 배포하는 방법은 [클라이언트 SDK 배포 가이드](./client-sdk-distribution.md)를 따릅니다.
- 백엔드 없이 예제를 실행할 mock 서버는 [Mock 서버 사용 가이드](./mock-server-usage.md)를 따릅니다.

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
| `--tier` | `all`(기본), `keys`, `options`, `hooks`. 고른 계층만 씁니다. `options` 파일은 `./keys.js`를, `hooks` 파일은 `./keys.js`와 `./queries.js`를 import하지만 그 파일을 쓰지 않으므로, 혼자 생성하면 `TS2307`로 실패합니다. 계층을 나눠 쓰려면 같은 디렉터리에 `--tier keys -o src/api/keys.ts`, `--tier options -o src/api/queries.ts`(필요하면 `--tier hooks -o src/api/hooks.ts`)를 차례로 생성합니다. |
| `--framework` | `react`(기본), `vue`, `svelte`. `vue`·`svelte` 출력은 컴파일되지 않습니다(알려진 결함). 생성기가 어떤 프레임워크든 React용 타입 이름(`UndefinedInitialDataOptions`, `UseMutationOptions` 등)을 import하므로 `@tanstack/vue-query`에서는 `TS2724`·`TS2769`, `@tanstack/svelte-query`(5·6)에서는 `TS2724`(`UseMutationOptions` 등이 없음)로 실패합니다. 지금 쓸 수 있는 대상은 React뿐입니다. |
| `--client-import` | `ApiClient` 타입을 가져올 모듈. 기본값은 `./client.js`입니다. 배포된 클라이언트 패키지를 쓸 때 지정합니다. |
| `--types-import` | typegen 타입을 가져올 모듈. 7.4절의 한계를 먼저 확인합니다. |
| `--split` | 출력 디렉터리에 `keys.ts`, `queries.ts`, `hooks.ts`를 따로 씁니다. `oa.config.ts`에 `outputRouting`이 있는 프로젝트(`oa-gen init`이 만든 설정)에서는 생성 파일의 상대 import가 깨지므로(`TS2307`) 쓰지 않습니다. |

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

`generate:tanstack --types-import`에 `oa-gen typegen` 출력만 넘기면 생성 코드가 import하는 타입 중 일부가 없어 `tsc`가 실패합니다(`TS2305`/`TS2724`, 알려진 결함). 생성 코드는 `--types-import` 모듈에서 다음 이름을 import하는데, typegen은 그중 일부만 만듭니다.

| 생성 코드가 import하는 이름 | 대상 operation | typegen이 만드는 경우 |
|---|---|---|
| `<Operation>ClientError` | 모든 operation | 만들지 않음 |
| `<Operation>Response` | 응답을 하나라도 선언한 operation | 성공 응답(가장 작은 2xx 상태, 2xx가 없으면 `default`)에 `application/json` 스키마가 있을 때만. 스트리밍 응답, 본문 없는 응답(`204` 등), `text/csv` 같은 다른 media type이면 만들지 않음 |
| `<Operation>Body` | 요청 본문이 있는 operation | 요청 본문에 `application/json` 스키마가 있을 때만. `application/octet-stream`, `multipart/form-data` 같은 다른 media type이면 만들지 않음 |

타입 있는 클라이언트와 `--types-import` 없는 TanStack 코드를 섞어도 `TS2345`로 실패합니다.

타입 없이 쓰려면 클라이언트와 TanStack 코드를 모두 `--types-import` 없이 생성합니다(7.1~7.3절). 타입이 필요하면 typegen 출력을 다시 export하고 빠진 이름을 더한 모듈을 만들어 `--types-import`로 지정합니다. 클라이언트는 typegen 출력(`./types.js`)을 그대로 씁니다.

```typescript
// src/api/wire-types.ts
export * from './types.js'
// 오류 응답을 선언한 operation: 타입 있는 클라이언트가 export하는 오류 타입
export type { CreateUserClientError, GetUserByIdClientError } from './client.js'
// 오류 응답이 없는 operation: 공통 ClientError로 별칭
import type { ClientError } from './client.js'
export type ListUsersClientError = ClientError
export type UpdateUserClientError = ClientError
export type StreamAuditEventsClientError = ClientError
// 성공 응답에 application/json 스키마가 없는 operation(여기서는 스트리밍 응답): typegen이 응답 타입을 만들지 않음
export type StreamAuditEventsResponse = unknown
```

```bash
npx oa-gen typegen --spec ./openapi.yaml -o src/api/types.ts
npx oa-gen generate:client --spec ./openapi.yaml --types-import ./types.js -o src/api/client.ts
npx oa-gen generate:tanstack --spec ./openapi.yaml -o src/api --types-import ./wire-types.js
```

`wire-types.ts`에 넣을 이름은 생성된 `tanstack-query.ts`의 `import type { ... } from './wire-types.js'` 줄에서 확인하고, 그중 `types.ts`가 export하지 않는 이름을 모두 더합니다. 빠진 `<Operation>Response`는 성공 응답에 본문이 없으면 `void`, 그 밖에는 `unknown`으로, 빠진 `<Operation>Body`는 `unknown`으로 별칭합니다. 예를 들어 예제 문서에 `204`만 답하는 `deleteUser`(`DELETE /users/{userId}`)와 `application/octet-stream` 본문을 받고 `204`로 답하는 `uploadAvatar`(`PUT /users/{userId}/avatar`)를 더하면 다음 별칭도 필요합니다.

```typescript
export type DeleteUserClientError = ClientError
export type UploadAvatarClientError = ClientError
// 본문 없는 성공 응답(204)
export type DeleteUserResponse = void
export type UploadAvatarResponse = void
// application/json이 아닌 요청 본문
export type UploadAvatarBody = unknown
```

operation이 바뀌면 이 모듈도 함께 고칩니다. 이렇게 생성하면 `getUserByIdQueryOptions(client, params: GetUserByIdPathParams, ...)`의 데이터 타입이 `JsonPrimitive<GetUserByIdResponse>`가 됩니다.

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

알려진 한계는 다음과 같습니다.

- `<operationId>QueryOptions`와 `<operationId>InfiniteQueryOptions`(그리고 이를 쓰는 `use<OperationId>Query`·`use<OperationId>InfiniteQuery`)가 같은 `queryKey`(`usersKeys.listUsers(query)`)를 씁니다. 같은 필터로 목록 쿼리와 무한 쿼리를 함께 쓰면 TanStack 캐시 항목 하나를 공유하므로, 목록 쿼리가 먼저 받은 `{ items, nextCursor }`가 무한 쿼리의 데이터로 나오고 `pages` 배열이 없습니다(알려진 결함). 두 쿼리를 같은 필터로 함께 쓰지 않거나, 아래처럼 무한 쿼리에 다른 키를 줍니다.
- 커서 방식의 첫 요청은 `cursor=null`을 쿼리 문자열로 보냅니다. 서버가 이 값을 거부하면 `initialPageParam`을 `undefined`로 바꿉니다(아래 예).
- 세 번째 인자(TanStack 옵션)를 넘길 때는 타입상 `initialPageParam`과 `getNextPageParam`을 함께 넘겨야 합니다.

무한 쿼리에 다른 키를 주려면 생성된 옵션을 펼친 뒤 `queryKey`를 바꿉니다. 세 번째 인자와 생성 훅은 `queryKey`를 받지 않으므로 `useInfiniteQuery`를 직접 씁니다. 생성된 `queryFn`은 키를 읽지 않으므로 키만 바뀝니다. 키 앞부분이 같아서 `usersKeys.listUsers(filters)`로 무효화하면 두 쿼리가 함께 무효화됩니다.

```tsx
import { useInfiniteQuery } from '@tanstack/react-query'
import { listUsersInfiniteQueryOptions } from './api/tanstack-query.js'

const infinite = listUsersInfiniteQueryOptions(apiClient, { limit: 10 })
const feed = useInfiniteQuery({
  ...infinite,
  // 생성된 키 타입은 끝 요소를 허용하지 않으므로 단언한다
  queryKey: [...infinite.queryKey, 'infinite'] as unknown as typeof infinite.queryKey,
})
```

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

스트리밍 operation에도 `<operationId>QueryOptions`와 훅이 생성되지만, `queryFn`이 `AsyncGenerator`를 데이터로 반환하므로 TanStack Query로 스트림을 읽을 수 없습니다(알려진 결함). 스트리밍 operation은 6절처럼 클라이언트 메서드를 직접 씁니다.
