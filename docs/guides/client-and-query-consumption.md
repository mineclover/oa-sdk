# 프론트엔드 SDK 및 TanStack Query v5 소비 가이드 (Frontend Client SDK & TanStack Query v5 Consumption)

`@oa-sdk/client`는 OpenAPI 3.1/3.2 스펙으로부터 파생된 **타입 안전한 Fetch 기반 HTTP 클라이언트 SDK** 및 **TanStack Query v5 통합 코드**를 제공합니다.

이 가이드는 프론트엔드 및 풀스택 애플리케이션 개발자가 생성된 클라이언트를 초기화하고, 듀얼 호출 컨벤션, AbortSignal 취소, 에러 핸들링, 스트리밍 및 TanStack Query v5 훅을 실무에서 효율적으로 소비하는 방법을 설명합니다.

---

## 1. 클라이언트 SDK 생성 및 공급 모델 선택

소비 환경에 따라 두 가지 방식으로 클라이언트를 프로젝트에 공급할 수 있습니다 (상세 내용은 [클라이언트 SDK 배포 가이드](./client-sdk-distribution.md) 참조):

- **Model A (로컬 온디맨드 생성)**: 앱 프로젝트의 `devDependencies`에 `@oa-sdk/codegen`을 두고 소스코드(`src/api/client.ts`)를 직접 생성.
  ```bash
  oa-gen generate:client --spec ./openapi.json --output src/api/client.ts
  ```
- **Model B (사전 빌드 패키지 배포)**: `dist/index.js`와 `dist/index.d.ts`로 빌드된 독립 패키지로 생성하여 사내 npm 레지스트리에 배포 (런타임 의존성 0개).
  ```bash
  oa-gen generate:client --spec ./openapi.json --pack --output ./packages/api-client --name @myorg/api-client
  ```

---

## 2. 클라이언트 초기화 및 인증 미들웨어

`createClient` 팩토리 함수를 사용하여 기본 URL, 요청 타임아웃, 지수 백오프 재시도 및 인증 미들웨어를 구성합니다.

```typescript
import { createClient, bearerAuth, apiKeyAuth } from '@myorg/api-client';

export const apiClient = createClient({
  baseUrl: 'https://api.example.com/v1',
  timeout: 10000, // 10초 타임아웃
  retry: 3,       // 네트워크 실패 및 5xx 응답 시 최대 3회 지수 백오프 재시도
  middleware: [
    // Bearer JWT 토큰 주입 미들웨어
    bearerAuth(() => localStorage.getItem('access_token') ?? ''),
    
    // 커스텀 로깅/관측 미들웨어
    {
      onRequest: async ({ url, init }) => {
        console.log(`[HTTP Request] ${init.method ?? 'GET'} ${url}`);
      },
      onError: async ({ error, url }) => {
        console.error(`[HTTP Failure] ${url}:`, error);
      }
    }
  ]
});
```

---

## 3. 듀얼 호출 컨벤션 (Dual Calling Conventions)

`oa-sdk` 클라이언트는 개발자의 취향과 상황에 맞게 **위치 인자 스타일**과 **단일 객체 스타일**을 모두 완벽하게 지원합니다.

### 3.1 위치 인자 스타일 (Positional Style)
단순한 파라미터 전달 시 직관적입니다.
```typescript
// 1. 단순 파라미터
const user = await apiClient.getUserById('usr_123');

// 2. 파라미터 + 쿼리 필터 + AbortSignal
const users = await apiClient.listUsers(
  { role: 'admin', page: 1 }, // query
  { signal: abortController.signal } // options
);
```

### 3.2 단일 객체 스타일 (Unified Object Style)
복합 파라미터나 옵션이 많은 경우 매개변수 순서를 외울 필요 없이 안전하게 호출할 수 있습니다.
```typescript
const updatedUser = await apiClient.updateUser({
  params: { userId: 'usr_123' },
  body: { displayName: 'Alice In Wonderland' },
  query: { notify: true },
  headers: { 'X-Audit-Reason': 'profile_update' },
  signal: abortController.signal
});
```

### 3.3 쿼리 파라미터 오염 방지 (Query Option Disambiguation)
`options.signal`이나 `options.headers`가 URL 쿼리 스트링으로 잘못 직렬화되는 문제(`?signal=[object+AbortSignal]`)를 코드 생성기 수준에서 완전히 방지합니다. 쿼리 객체 안에 `signal`을 혼용해 넣더라도 안전하게 옵션 슬롯으로 분리 추출됩니다.

---

## 4. 메타데이터 접근 (`withResponse`)

기본 메서드는 언래핑된 응답 데이터(`body`)만을 반환합니다. 페이지네이션 헤더(`X-Total-Count`), 캐시 헤더(`ETag`), 또는 원본 `Response` 객체가 필요한 경우 `withResponse` 프로퍼티를 사용합니다.

```typescript
const { body, headers, response } = await apiClient.withResponse.listUsers({ limit: 20 });

console.log(`HTTP Status: ${response.status}`);
console.log(`Total Count: ${headers['x-total-count']}`);
console.log(`Returned Users: ${body.items.length}`);
```

---

## 5. 다중 영역(Multi-Realm) 에러 핸들링

`ClientError`와 타입 가드 `isClientError`를 통해 4xx/5xx HTTP 에러를 안전하게 처리합니다. iframe, 웹 워커, 마이크로 프론트엔드 환경에서도 구조적 덕 타이핑(Duck-Typing)으로 에러를 식별합니다.

```typescript
import { isClientError } from '@myorg/api-client';

try {
  await apiClient.getUserById('non_existent_id');
} catch (error) {
  if (isClientError(error)) {
    console.error(`API Error HTTP ${error.status} (${error.statusText})`);
    console.error(`Error Payload:`, error.data); // error.body와 동일
    console.error(`Failed Operation:`, error.operationId);
  } else {
    console.error(`Network or Unknown Error:`, error);
  }
}
```

---

## 6. 실시간 스트리밍 및 자동 취소 (AsyncGenerators)

SSE(`text/event-stream`) 및 NDJSON 스트리밍 엔드포인트는 표준 `AsyncGenerator<T>`로 방출되어 `for await ... of` 구문으로 간결하게 소비할 수 있습니다.

```typescript
const controller = new AbortController();

try {
  const eventStream = apiClient.streamAuditEvents({
    query: { channel: 'security' },
    signal: controller.signal
  });

  for await (const event of eventStream) {
    console.log(`New Audit Event: [${event.level}] ${event.message}`);
    
    // 특정 조건 만족 시 조기 탈출
    if (event.level === 'critical') {
      controller.abort(); // 스트림 리더가 소켓을 즉시 취소하고 메모리를 해제함
      break;
    }
  }
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Stream cancelled cleanly.');
  }
}
```

---

## 7. TanStack Query v5 3계층 통합 (React / Vue / Svelte)

`oa-gen generate:tanstack`을 사용하면 쿼리 키(Keys), 쿼리 옵션(Options), 훅 래퍼(Hooks)가 계층별로 자동 생성됩니다.

### 7.1 코드 생성 옵션
```bash
# React Query 전체 계층 생성
oa-gen generate:tanstack --spec openapi.json --output src/api/queries.ts --framework react

# 파일 분할 (--split) 및 프레임워크 독립 쿼리 옵션만 생성 (--tier options)
oa-gen generate:tanstack --spec openapi.json --output src/api/ --tier options --split
```

| 옵션 | 선택지 | 용도 |
|---|---|---|
| `--tier` | `all` (기본값), `keys`, `options`, `hooks` | 필요한 계층만 선택 방출 (SSR prefetch나 Nuxt/SvelteKit에서는 `options` 권장) |
| `--framework` | `react`, `vue`, `svelte` | 대상 프레임워크 패키지 바인딩 지정 |
| `--split` | boolean 플래그 | `<resource>.keys.ts`, `<resource>.options.ts`, `<resource>.queries.ts` 분할 방출 |

---

### 7.2 React 실무 활용 예시

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './api/client';
import { 
  userKeys, 
  getUserQueryOptions, 
  useUpdateUserMutation 
} from './api/queries';

export function UserProfileView({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  // 1. 쿼리 옵션 소비 (AbortSignal이 자동으로 클라이언트에 전파되어 컴포넌트 언마운트 시 자동 취소)
  const { data: user, isLoading, error } = useQuery(
    getUserQueryOptions(apiClient, { userId })
  );

  // 2. 뮤테이션 소비 및 쿼리 무효화 (Invalidation)
  const mutation = useUpdateUserMutation(apiClient, {
    onSuccess: () => {
      // 구조화된 쿼리 키를 사용한 안전한 캐시 갱신
      queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
    }
  });

  if (isLoading) return <div>로딩 중...</div>;
  if (error) return <div>에러 발생: {error.message}</div>;

  return (
    <div>
      <h1>{user.name}</h1>
      <button onClick={() => mutation.mutate({ userId, body: { status: 'active' } })}>
        활성화
      </button>
    </div>
  );
}
```

---

## 8. 무한 스크롤 (Infinite Query) 지원

OpenAPI 스펙에 `cursor`, `page`, `offset` 파라미터가 정의되어 있다면, 생성기가 이를 자동으로 감지하여 `getInfiniteUsersQueryOptions`를 함께 생성합니다.

```tsx
import { useInfiniteQuery } from '@tanstack/react-query';
import { getListUsersInfiniteQueryOptions } from './api/queries';

const { data, fetchNextPage, hasNextPage } = useInfiniteQuery(
  getListUsersInfiniteQueryOptions(apiClient, {
    query: { limit: 10 },
    getNextPageParam: (lastPage) => lastPage.nextCursor
  })
);
```
