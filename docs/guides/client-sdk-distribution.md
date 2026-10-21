# 클라이언트 SDK 배포 가이드 (Client SDK Distribution)

생성한 fetch 클라이언트를 소비자 프로젝트에 공급하는 두 가지 방법을 비교하고, 클라이언트를 독립 npm 패키지로 만드는 절차를 설명합니다. 이 문서는 `@oa-sdk/codegen` 0.9.0과 `@oa-sdk/client` 0.2.2 기준입니다.

- 생성된 클라이언트의 설정, 호출 규칙, 오류 처리, 스트리밍, TanStack Query 코드는 [생성 클라이언트와 TanStack Query 사용 가이드](./client-and-query-consumption.md)가 정본입니다.
- 클라이언트 개발·테스트에 쓰는 mock 서버(상태 유지 CRUD 포함)는 [Mock 서버 사용 가이드](./mock-server-usage.md)를 따릅니다.

---

## 1. 두 가지 공급 모델

생성된 클라이언트는 표준 `fetch`만 쓰는 TypeScript 코드이고, 런타임 의존성이 없습니다. 이 코드를 소비자에게 전달하는 방법은 두 가지입니다.

```
                     OpenAPI 문서 / TypeSpec(.tsp)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   Model A: 앱에서 직접 생성                   Model B: 패키지로 배포
   - 앱 devDependencies에 codegen·client       - 계약을 관리하는 쪽이 생성·빌드
   - src/api/client.ts 소스 생성               - dist/만 담은 npm 패키지
   - 스펙이 바뀌면 앱에서 다시 생성             - 소비자는 패키지만 설치
```

| | Model A | Model B |
|---|---|---|
| 생성 위치 | 소비자 앱 | 계약 관리 저장소, CI |
| 소비자가 설치하는 것 | `@oa-sdk/codegen`, `@oa-sdk/client`(개발 의존성) | 생성된 클라이언트 패키지 |
| 적합한 경우 | 앱 하나, 스펙과 앱이 같은 저장소 | 여러 앱·팀·저장소가 같은 클라이언트를 공유 |

---

## 2. Model A: 앱에서 직접 생성

```bash
npm install --save-dev @oa-sdk/codegen @oa-sdk/client
```

`@oa-sdk/client`는 `oa-gen`이 클라이언트 생성기를 불러오는 동반 패키지(companion package)입니다. `@oa-sdk/codegen`을 설치해도 함께 설치되지 않으며, 없으면 `generate:client`가 설치 명령을 출력하고 종료 코드 1로 실패합니다([동반 패키지](./cli-setup.md#동반-패키지-companion-packages)). `@oa-sdk/client`는 `@oa-sdk/codegen` 0.9.0 릴리스에서 처음 npm에 배포됩니다. 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은 [변경 이력](../changelog.md)에서 확인합니다.

`package.json` 스크립트로 타입과 클라이언트를 함께 다시 만듭니다.

```json
{
  "scripts": {
    "codegen:types": "oa-gen typegen -s ./spec/openapi.json -o ./src/api/types.ts",
    "codegen:client": "oa-gen generate:client -s ./spec/openapi.json --types-import ./types.js -o ./src/api/client.ts",
    "codegen": "npm run codegen:types && npm run codegen:client"
  }
}
```

```typescript
import { createClient } from './src/api/client.js'

const client = createClient({ baseUrl: 'https://api.example.com' })
const page = await client.listUsers({ limit: 20 })
```

TanStack Query 코드도 같은 앱에서 생성합니다([TanStack Query v5](./client-and-query-consumption.md#7-tanstack-query-v5)). 위 스크립트는 타입 있는 클라이언트를 만들므로, TanStack 코드도 같은 typegen 출력을 `--types-import`로 지정해 생성합니다([7.4절](./client-and-query-consumption.md#74-응답-타입을-붙이기---types-import)). `--types-import` 없이 생성한 TanStack 코드는 타입 있는 클라이언트와 함께 컴파일되지 않습니다(`TS2345`). 같은 프로젝트에서 `oa-gen generate`를 실행해도 `generate:tanstack` 출력은 지워지지 않습니다. `oa-gen generate`는 `.oa-manifest.json`에서 자신이 기록한 생성 파일만 정리합니다([생성 파일 정리](./declarative-spec-configuration.md#45-생성-파일-정리), [`oa-gen generate`가 만드는 TanStack 코드](./client-and-query-consumption.md#75-oa-gen-generate가-만드는-tanstack-코드)).

---

## 3. Model B: 사전 빌드 패키지

계약을 관리하는 쪽(스펙 저장소나 CI)에서 클라이언트를 `dist/`가 들어 있는 패키지로 만들고, 사내 레지스트리나 워크스페이스로 배포합니다. 소비자는 `@oa-sdk/codegen`이나 `@oa-sdk/client` 없이 그 패키지만 설치합니다.

### 3.1 패키지 만들기

패키지를 만드는 환경에 다음을 설치합니다.

```bash
npm install --save-dev @oa-sdk/codegen @oa-sdk/client typescript
```

`--pack`은 TypeScript 컴파일러 API로 `dist/`를 빌드합니다. `typescript`는 `@oa-sdk/codegen`의 선택적 peer dependency라서 자동으로 설치된다고 보장되지 않으므로(pnpm처럼 엄격한 레이아웃에서는 찾지 못함) 직접 설치합니다.

```bash
npx oa-gen generate:client --spec ./spec/openapi.json --pack --output ./packages/api-client --name @my-org/api-client --package-version 1.0.0
```

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--output` | `./packages/api-client` | 패키지 디렉터리 |
| `--name` | 출력 디렉터리 이름 | `package.json`의 `name` |
| `--package-version` | `0.1.0` | `package.json`의 `version` |
| `--description` | 생성 기본 문구 | `package.json`의 `description` |

`oa-gen pack:client`(별칭 `pack-client`)는 `generate:client --pack`과 같은 명령입니다. `oa-gen --help` 목록에는 나오지 않습니다. `--pack`은 typegen을 내부에서 함께 실행하므로 `--types-import`가 필요 없고, 만들어진 클라이언트는 타입 있는 클라이언트입니다.

### 3.2 생성되는 패키지

```
packages/api-client/
├── dist/
│   ├── index.js, index.d.ts     # types와 client를 다시 export
│   ├── client.js, client.d.ts
│   └── types.js, types.d.ts
├── src/                         # 생성된 TypeScript 소스 (index.ts, client.ts, types.ts)
├── package.json
└── README.md
```

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

패키지는 ESM 전용입니다. Verdaccio, npm, GitHub Packages 같은 레지스트리에 `npm publish`하거나, pnpm 워크스페이스에서는 `workspace:*`로 연결합니다.

### 3.3 소비자 측 사용

```bash
npm install @my-org/api-client
```

```typescript
import { createClient, type User } from '@my-org/api-client'

const client = createClient({ baseUrl: 'https://api.example.com' })

const user: User = await client.getUser({ userId: 'user-123' }) // path 파라미터는 객체로 전달
```

클라이언트 패키지 자체는 `dependencies`가 비어 있습니다. 다만 소비자가 이 패키지로 TanStack Query 코드를 생성하면, 그 코드가 `@oa-sdk/client`의 타입과 `@tanstack/react-query`를 import하므로 소비자 프로젝트에 둘 다 설치합니다(3.4절).

### 3.4 Model B 클라이언트로 TanStack Query 코드 만들기

TanStack 생성 코드는 기본적으로 `./client.js`에서 `ApiClient` 타입을 가져옵니다. 배포 패키지를 쓰려면 `--client-import`로 패키지 이름을 지정하고, `--types-import`에도 같은 패키지를 지정합니다. 3.2의 패키지 루트(`index`)가 typegen 타입과 클라이언트 오류 타입을 함께 export하므로 별도 별칭 모듈이 필요 없습니다.

```bash
npm install @tanstack/react-query
npm install --save-dev @oa-sdk/codegen @oa-sdk/client
npx oa-gen generate:tanstack -s ./spec/openapi.json -o ./src/api/queries.ts \
  --client-import @my-org/api-client --types-import @my-org/api-client
```

```tsx
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@my-org/api-client'
import { listUsersQueryOptions } from './api/queries.js'

const client = createClient({ baseUrl: 'https://api.example.com' })

export function AdminCount() {
  const { data, isLoading } = useQuery(listUsersQueryOptions(client, { role: 'admin' }))
  if (isLoading) return <div>Loading...</div>
  return <div>{data?.items.length}</div>
}
```

`-o`가 `.ts`로 끝나면 그 파일에 씁니다. 키·옵션·훅 이름과 `--tier` 같은 나머지 옵션은 [TanStack Query v5](./client-and-query-consumption.md#7-tanstack-query-v5)를 따릅니다. 기본 대상은 `@tanstack/react-query`이고, `--framework vue|svelte`는 keys+options를 생성합니다(훅은 React 전용).

---

## 4. 상황별 권장 구성

| 사용 사례 | 클라이언트 모델 | 개발·테스트 mock | TanStack Query |
|---|---|---|---|
| 앱 하나, 빠른 개발 | Model A | `oa-gen mock --stateful` | 앱에서 `generate:tanstack` |
| 사내 모노레포(여러 패키지) | Model B(`workspace:*`로 연결) | `createNodeMockServer(spec, { stateful })` | 각 앱에서 `--client-import`로 생성 |
| 외부 고객사·외주사 공급 | Model B(`npm publish`) | 스펙 문서를 함께 전달하고, 소비자가 `oa-gen mock`이나 MSW 어댑터(`@oa-sdk/mock-server/adapters/msw`, `msw` 필요)로 띄움 | React 앱에서 `--client-import`로 생성(3.4절) |
| CI E2E 테스트(Playwright) | Model A 또는 B | `oa-mock --spec <file> --stateful --port 4010` | 해당 없음 |

mock 서버 구성은 [Mock 서버 사용 가이드](./mock-server-usage.md)를 따릅니다.
