# Client SDK Distribution & Mock Server Architecture Guide

이 문서는 `oa-sdk` 생태계에서 생성된 타입 안전 fetch 클라이언트 SDK의 공급(배포) 구조와 상태 관리형(Stateful) Mock 서버 운용 구조, 그리고 TanStack Query v5 통합 패턴을 안내합니다.

---

## 1. 클라이언트 SDK 공급 구조: 2가지 모델

`oa-sdk`의 클라이언트 생성 엔진은 **0-런타임 의존성(`dependencies: {}`)** 원칙을 엄격히 준수합니다. 외부 HTTP 라이브러리(axios, ky 등)나 런타임 검증 엔진에 종속되지 않고, 표준 WHATWG Fetch API 기반의 순수 TypeScript 코드를 생성합니다.

소비자(Consumer) 레포지토리의 특성에 따라 다음 두 가지 공급 모델 중 최적의 방식을 선택합니다.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        OpenAPI / TypeSpec Spec                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
   [Model A: devDependencies]                     [Model B: Standalone Package]
   - 소비자가 직접 codegen 소유                    - CI/배포 파이프라인에서 빌드
   - 프로젝트 내부 src/api/client.ts               - 독립 npm 패키지 (@org/api-client)
   - 모노레포 내부 즉시 반영                        - dist/ 만 포함 (0-tooling 소비자)
```

---

### Model A: `devDependencies` 온디맨드 로컬 생성

단일 레포지토리나 프론트엔드/백엔드가 밀접하게 동기화되는 환경에 적합합니다.

#### 1. 소비자 프로젝트 설정
소비자 프로젝트의 `devDependencies`에 `@oa-sdk/codegen`을 설치합니다:

```bash
pnpm add -D @oa-sdk/codegen
```

#### 2. `package.json` 스크립트 구성
```json
{
  "scripts": {
    "codegen:types": "oa-gen typegen -s ./spec/openapi.json -o ./src/api/types.ts",
    "codegen:client": "oa-gen generate:client -s ./spec/openapi.json --types-import ./types.js -o ./src/api/client.ts",
    "codegen": "pnpm codegen:types && pnpm codegen:client"
  }
}
```

#### 3. 사용
```ts
import { createClient } from './src/api/client.js'

const client = createClient({
  baseUrl: 'https://api.example.com',
})

// 완벽한 타입 안전 호출 및 스트리밍/취소 지원
const users = await client.listUsers()
```

- **장점**: 스펙 수정 시 커맨드 1회로 즉시 프로젝트 소스에 반영됨.
- **적합 대상**: 단일 프론트엔드 앱, 빠른 프로토타이핑, MVP.

---

### Model B: Standalone 사전 빌드 패키지 (`dist/` 전용, 0 의존성)

엔터프라이즈 모노레포, 멀티 레포, 모바일/외주 팀 공급, 사내 npm 레지스트리 배포 환경에 적합합니다. 소비자는 `@oa-sdk/codegen`을 설치할 필요조차 없으며, 사전 컴파일된 `dist/`만 소비합니다.

#### 1. 패키지 패킹 커맨드 실행
CI 파이프라인 또는 스펙 관리 패키지에서 다음 커맨드를 실행합니다:

```bash
# oa-gen generate:client --pack 사용 (또는 oa-gen pack:client)
oa-gen generate:client --spec ./spec/openapi.json --pack --output ./packages/api-client --name @my-org/api-client --package-version 1.0.0
```

#### 2. 생성되는 패키지 구조
```
packages/api-client/
├── dist/
│   ├── index.js        # 순수 ESM 번들
│   ├── index.d.ts      # 타입 선언 파일
│   ├── client.js
│   ├── client.d.ts
│   ├── types.js
│   └── types.d.ts
├── src/                # 원본 TypeScript 소스
├── package.json        # dependencies: {} (0 런타임 의존성)
└── README.md           # 즉시 사용 가능한 가이드
```

생성된 `package.json`:
```json
{
  "name": "@my-org/api-client",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "sideEffects": false,
  "dependencies": {}
}
```

#### 3. 소비자 측 설치 및 사용
소비자는 일반 패키지처럼 설치하여 사용합니다:

```bash
pnpm add @my-org/api-client
```

```ts
import { createClient, type User } from '@my-org/api-client'

const client = createClient({
  baseUrl: 'https://api.example.com',
})

const user: User = await client.getUser('user-123')
```

- **장점**:
  - 소비자 측 빌드 도구 의존성 없음 (0 devDependencies, 0 dependencies).
  - TypeScript 컴파일러 API를 통해 사전 컴파일된 `.d.ts`와 ESM 코드가 포함되어 번들러 설정 없이 즉시 동작.
  - 사내 Verdaccio, npm, GitHub Packages 또는 pnpm workspace 프로토콜(`workspace:*`)로 즉시 배포 가능.

---

## 2. Stateful Mock 서버 운용 구조

스펙 기반 Mock 서버는 기본적으로 요청 스키마를 검증하고 예시(Example) 또는 스키마 기반 정적 응답을 반환합니다. 그러나 통합 테스트, E2E 시나리오, 화면 개발 시에는 **POST로 생성한 데이터를 GET으로 확인하고 DELETE로 삭제하는 인메모리 상태 유지(Stateful)** 동작이 필요합니다.

`@oa-sdk/mock-server`는 비침습적 `MockPlugin` 아키텍처와 내장 `inMemoryStorePlugin`을 통해 이를 완벽히 지원합니다.

### CLI에서 Stateful Mock 서버 실행

```bash
# oa-mock CLI
oa-mock --spec openapi.json --port 4010 --stateful

# oa-gen mock CLI (TypeSpec/OpenAPI 공용)
oa-gen mock --spec openapi.json --port 4010 --stateful
```

### 프로그래밍 방식 운용 (Node HTTP 및 MSW)

```ts
import { createNodeMockServer } from '@oa-sdk/mock-server'

const server = createNodeMockServer(spec, {
  port: 4010,
  stateful: {
    seed: {
      '/users': [
        { id: 'usr-1', name: 'Alice', email: 'alice@example.com' },
        { id: 'usr-2', name: 'Bob', email: 'bob@example.com' },
      ],
    },
  },
})

await server.start()

// 1. GET /users -> 2명 반환
// 2. POST /users (name: 'Charlie') -> id 자동 생성 후 201 반환
// 3. GET /users -> 3명 반환
// 4. GET /users/:id -> 특정 사용자 반환 (없으면 404)
// 5. PATCH /users/:id -> 데이터 병합 후 200 반환
// 6. DELETE /users/:id -> 데이터 삭제 후 204 반환

// 테스트 격리를 위한 리셋 (seed 데이터 상태로 즉시 복원)
server.reset()
```

### 브라우저 & MSW 연동

```ts
import { createMswMockServer } from '@oa-sdk/mock-server/browser'

export const mock = createMswMockServer(spec, {
  stateful: {
    seed: {
      '/todos': [{ id: '1', title: 'Write tests', completed: false }],
    },
  },
})

// Vitest beforeEach 등에서 상태 리셋
beforeEach(() => {
  mock.reset()
})
```

---

## 3. TanStack Query v5 통합 및 보일러플레이트 제거

클라이언트 SDK와 결합하여 UI 레이어에서 반복되는 쿼리 키 선언, `queryOptions` 구성, 인피니트 쿼리 페이지네이션 작업을 자동화합니다.

```bash
# 3-Tier 전체 생성 (Keys, Options, Hooks)
oa-gen generate:tanstack -s spec.json -o ./src/api/queries

# 분할 파일 생성 (keys.ts, queries.ts, hooks.ts)
oa-gen generate:tanstack -s spec.json --split -o ./src/api/queries

# 프레임워크 타겟 지정 (React, Vue, Svelte)
oa-gen generate:tanstack -s spec.json --framework vue -o ./src/api/queries

# 특정 계층만 생성 (예: 순수 options만 필요할 때)
oa-gen generate:tanstack -s spec.json --tier options -o ./src/api/queries
```

### UI 컴포넌트 사용 예시

```tsx
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@my-org/api-client'
import { usersQueries } from './generated/queries.js'

const client = createClient()

export function UserList() {
  // 보일러플레이트 없이 즉시 타입 안전 쿼리 사용
  const { data, isLoading } = useQuery(
    usersQueries.listUsers(client, { query: { role: 'admin' } })
  )

  if (isLoading) return <div>Loading...</div>
  return (
    <ul>
      {data?.map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  )
}
```

---

## 4. 요약: 상황별 권장 패턴 매트릭스

| 사용 사례 | 권장 클라이언트 모델 | Mock 서버 운용 방식 | TanStack Query 설정 |
|---|---|---|---|
| **소규모/단일 앱 빠른 개발** | Model A (`devDependencies`) | `oa-gen mock --stateful` | `generate:tanstack --tier all` |
| **사내 모노레포 (멀티 패키지)** | Model B (`pack:client` workspace 링크) | `createNodeMockServer({ stateful })` | `generate:tanstack --split` |
| **외부 고객사/외주사 공급** | Model B (`npm publish` 배포) | 배포 패키지 내 MSW 핸들러 동봉 | `--tier options` (프레임워크 비종속) |
| **CI E2E 테스트 (Playwright)** | Model A or B | `oa-mock --stateful --port 4010` | N/A |
