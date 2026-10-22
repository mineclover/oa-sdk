---
docType: guide
sourceLocale: ko
canonical: true
audience:
  competence: intermediate
productVersions:
  - "@oa-sdk/codegen 0.10.0"
  - "@oa-sdk/router 0.2.4"
  - "@oa-sdk/client 0.3.0"
owner: "OA SDK maintainers"
status: active
---

# TypeSpec 생성물 배치 토폴로지와 아키텍처 규칙

> **관련 패키지**: `@oa-sdk/codegen`, 동반 패키지(companion package) `@oa-sdk/router`, `@oa-sdk/client`
> **입력**: TypeSpec(`.tsp`), OpenAPI 3.2
> **토폴로지**: Co-located(피처 인접), Feature-Sliced Design(FSD), Monorepo 계층 분리, 배포용 클라이언트 패키지

이 문서는 `@oa-sdk/codegen`을 설치한 프로젝트에서 `oa.config.ts`로 생성물 위치를 정하는 방법과, 생성물이 지키는 규칙을 설명합니다. 이 문서는 `@oa-sdk/codegen` 0.10.0 기준이며 명령은 `npx oa-gen` 형태로 씁니다. 설정 필드 전체는 [선언적 스펙 설정 가이드](../declarative-spec-configuration.md)가 정본입니다.

---

## 1. 개요

`oa-gen generate`는 `.tsp` 계약 원본에서 OpenAPI 문서, JSON Schema, 핸들러 계약, fetch 클라이언트, TanStack Query 코드를 만듭니다. 같은 원본과 설정이면 같은 파일을 만들므로, 생성물은 언제든 다시 만들 수 있습니다. 생성물을 어디에 둘지는 `oa.config.ts`의 spec target(`specs[]`)과 `outputRouting`으로 정합니다.

- **spec target 단위 출력**: 생성물은 spec target마다 한 벌씩 만들어집니다. 파일 이름과 `outputRouting`의 `{tag}` 토큰은 spec target id입니다. OpenAPI `@tag` 값은 경로에 쓰이지 않습니다.
- **핸들러 계약까지만 생성**: `oa-gen generate`는 서버 쪽에 프레임워크와 무관한 핸들러 계약(`<id>.contract.ts`)만 생성합니다. Fastify·Express·Hono·Elysia 라우터 코드가 필요하면 빌드 스크립트에서 `@oa-sdk/router`의 `generateRouter()`를 호출해 파일로 씁니다. `oa-gen` 명령으로는 라우터 파일을 만들지 않습니다.

---

## 2. 지원되는 4가지 배치 토폴로지

```
[토폴로지 1: Co-located 피처 인접]   [토폴로지 2: FSD]                    [토폴로지 3: Monorepo 계층 분리]
src/features/billing/               src/features/billing/api/          packages/contracts/ (핸들러 계약)
├── billing.tsp                     ├── billing.client.ts              packages/client-sdk/ (클라이언트)
├── billing.openapi.json            ├── billing.keys.ts                apps/web/src/queries/ (TanStack)
├── billing.schema.json             └── billing.queries.ts             apps/server/ (generateRouter()로 만든 라우터)
├── billing.contract.ts
├── billing.client.ts
└── billing.queries.ts
```

| 토폴로지 | 추천 환경 | 설정 핵심 (`oa.config.ts`) | 특징 |
|---|---|---|---|
| **1. Co-located** | DDD, 모듈형 모놀리스 | 피처마다 spec target: `{ id: "billing", profile: "full-api-document", schemaEntry: ".../billing.tsp", outDir: ".../billing" }` | `.tsp` 옆에 모든 생성물이 놓임 |
| **2. FSD** | 대규모 프론트엔드·풀스택 앱 | 피처마다 spec target + `outputRouting.pattern: "src/features/{tag}/api/{tag}.{kind}.ts"` | `{tag}`가 spec target id이므로 피처 폴더가 나뉘려면 spec target도 피처별로 둠 |
| **3. Monorepo 계층 분리** | 멀티 패키지 모노레포 | `outputRouting.byKind: { contract: "packages/contracts/...", client: "packages/client-sdk/..." }` | 계약, 클라이언트, 쿼리를 계층별 패키지로 분리 |
| **4. 배포용 클라이언트 패키지** | 사내·외부 배포 SDK | `oa-gen generate:client --pack --output ./packages/api-client` | 런타임 의존성 없는 독립 패키지(`src/`, `dist/`, `package.json`, `README.md`) |

---

### 2.1 토폴로지 1: Co-located (피처 인접)

피처 폴더에 구현 코드와 `.tsp`를 함께 둡니다. spec target에는 `profile`(또는 `target`)이 필요합니다. 없으면 `profile is required` 설정 오류로 실패합니다.

#### 정적 선언
```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen";

export default defineConfig({
  product: {
    specs: [
      {
        id: "billing",
        profile: "full-api-document",
        schemaEntry: "src/features/billing/billing.tsp",
        outDir: "src/features/billing", // .tsp 파일 바로 옆
      },
      {
        id: "users",
        profile: "full-api-document",
        schemaEntry: "src/features/users/users.tsp",
        outDir: "src/features/users",
      },
    ],
  },
});
```

#### 파일 탐색으로 spec target 만들기
설정 모듈의 default export가 함수이면 `oa-gen`이 그 함수를 호출해 결과를 설정으로 씁니다. `defineConfig`는 객체를 받으므로 함수 안에서 호출합니다. 아래 예제의 `fast-glob`은 프로젝트에 직접 설치합니다.

```typescript
// oa.config.ts (동적 탐색 패턴)
import path from "node:path";
import fg from "fast-glob";
import { defineConfig } from "@oa-sdk/codegen";

export default async () => {
  const tspFiles = await fg("src/features/**/*.tsp");

  return defineConfig({
    specs: tspFiles.map((tspPath) => ({
      id: path.basename(tspPath, ".tsp"),
      profile: "full-api-document" as const,
      schemaEntry: tspPath,
      outDir: path.dirname(tspPath), // 각 .tsp 파일이 위치한 폴더 바로 옆
    })),
  });
};
```

**생성물** (`npx oa-gen generate`):
```
src/features/billing/
├── billing.tsp            # 개발자가 작성한 TypeSpec 계약
├── billing.openapi.json   # OpenAPI 문서
├── billing.schema.json    # JSON Schema 2020-12 ($defs)
├── billing.contract.ts    # 프레임워크와 무관한 핸들러 계약
├── billing.client.ts      # fetch 클라이언트
└── billing.queries.ts     # TanStack Query 키·옵션·훅 (outputRouting이 없으면 한 파일)
```

---

### 2.2 토폴로지 2: Feature-Sliced Design (FSD)

생성물을 피처 폴더의 `api/`로 보냅니다. `{tag}`가 spec target id이므로 피처마다 spec target을 둡니다. spec target이 `main-api` 하나뿐이면 모든 생성물이 `src/features/main-api/api/`에 모입니다.

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen";

export default defineConfig({
  specs: [
    { id: "billing", profile: "full-api-document", schemaEntry: "src/features/billing/billing.tsp", outDir: "dist/specs" },
    { id: "users", profile: "full-api-document", schemaEntry: "src/features/users/users.tsp", outDir: "dist/specs" },
  ],
  outputRouting: {
    pattern: "src/features/{tag}/api/{tag}.{kind}.ts",
    byKind: {
      contract: "packages/server/src/contracts/{tag}.contract.ts",
    },
  },
});
```

**생성물**: `dist/specs/{billing,users}.openapi.json`과 `.schema.json`, `packages/server/src/contracts/{billing,users}.contract.ts`, `src/features/{billing,users}/api/`의 `<id>.client.ts`·`<id>.keys.ts`·`<id>.queries.ts`. `outputRouting`이 있으면 `<id>.queries.ts`에는 키를 import하는 옵션 팩토리만 있고 훅은 생성되지 않습니다.

> [!TIP]
> **상대 import 재계산**: `queries`가 import하는 `client`와 `keys`의 경로는 배치 위치에 맞춰 ESM `.js` 확장자로 계산됩니다(예: `import type { ApiClient } from './billing.client.js'`). 토큰, `byKind`, `rules`의 우선순위는 [outputRouting 설정](../declarative-spec-configuration.md#4-산출물-경로-라우팅-커스터마이징-엔진-outputrouting)을 봅니다.

---

### 2.3 토폴로지 3: Monorepo 계층 분리

핸들러 계약, 클라이언트, TanStack Query 코드를 `outputRouting.byKind`로 서로 다른 워크스페이스 패키지에 보냅니다.

- `packages/contracts/`: 핸들러 계약(`*.contract.ts`).
- `packages/client-sdk/`: 런타임 의존성 없는 fetch 클라이언트(`*.client.ts`).
- `apps/web/src/api/`: TanStack Query 키와 옵션(`*.keys.ts`, `*.queries.ts`).
- `apps/server/`: 프레임워크 라우터. `oa-gen`이 만들지 않으므로 빌드 스크립트에서 `@oa-sdk/router`의 `generateRouter(spec, { target: 'hono' | 'express' | 'fastify' | 'elysia', ... })`를 호출해 씁니다([`@oa-sdk/router` README](../../../packages/router/README.md)).

---

### 2.4 토폴로지 4: 배포용 클라이언트 패키지 (`--pack`)

다른 팀이나 외부 고객에게 배포할 클라이언트 패키지를 만듭니다. `@oa-sdk/client`가 필요합니다.

```bash
npx oa-gen generate:client \
  --spec ./main.tsp \
  --pack \
  --output packages/api-client \
  --name @my-org/api-client \
  --package-version 1.0.0
```

**생성물**:
```
packages/api-client/
├── package.json           # 배포용 package.json (런타임 의존성 없음)
├── README.md              # 사용법
├── src/                   # client.ts, types.ts, index.ts
└── dist/                  # index.js, client.js, types.js와 .d.ts
```

---

## 3. 생성물이 지키는 규칙

### 규칙 1: 생성물은 원본에서만 바뀐다
- 생성물(`*.contract.ts`, `*.client.ts`, `*.openapi.json`, `dist/`)을 손으로 고치지 않습니다. 생성물이 틀리면 `.tsp`를 고치고 다시 생성합니다.
- 생성된 TypeScript 파일 첫 줄에는 `Auto-generated ... Do not edit.` 배너가 들어갑니다.

### 규칙 2: 핸들러 계약은 프레임워크와 무관하다 (`@oa-sdk/router`)
`*.contract.ts`는 웹 프레임워크를 import하지 않는 TypeScript 타입입니다. operation마다 `<Op>Context`와 `<Op>Handler`를 두고, 전체를 `ApiHandlers`로 묶습니다. 다음은 `getInvoiceById`, `createInvoice` 두 operation에서 생성된 파일의 일부입니다.

```typescript
export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =
| TSuccess
| { status: 200; body: TSuccess; headers?: THeaders }
| { status: 206; body: StreamingBody | TSuccess; headers?: THeaders }
| StreamingResponse<THeaders>
| { [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]

/** 인보이스 단건 조회 */
export interface GetInvoiceByIdContext<TContext = unknown> {
  params: Record<string, string>
  context?: TContext
}

/** Handler signature for GET /invoices/{id} */
export type GetInvoiceByIdHandler<TContext = unknown> = (
  ctx: GetInvoiceByIdContext<TContext>
) => HandlerResponse<unknown> | Promise<HandlerResponse<unknown>>

export interface ApiHandlers<TContext = unknown> {
  /** 인보이스 단건 조회 */
  getInvoiceById: GetInvoiceByIdHandler<TContext>
  /** 인보이스 생성 */
  createInvoice: CreateInvoiceHandler<TContext>
}
```

`oa-gen generate`는 계약에 타입 import를 넘기지 않으므로 본문과 응답은 `unknown`입니다. 타입이 있는 계약이 필요하면 빌드 스크립트에서 `@oa-sdk/router`의 `generateHandlerContract(spec, { typesImport })`를 직접 호출합니다.

### 규칙 3: 응답 타입은 JSON으로 바뀐 형태로 표현한다 (`JsonPrimitive<T>`)
네트워크로 받은 값에는 `Date`나 메서드가 없습니다. 생성된 클라이언트는 응답 타입을 `JsonPrimitive<T>`로 감싸 `Date`를 `string`으로 바꾸고 함수·symbol 필드를 제외한 타입을 돌려줍니다. 클라이언트에 타입을 연결하지 않으면(`--types-import`, `core.client.typesImport` 없음) 응답 타입은 `unknown`입니다.

### 규칙 4: TanStack Query 코드는 키 → 옵션 → 훅 3계층이다
1. **키(Tier 1)**: 캐시 무효화와 쿼리 식별용 키 팩토리(`<camelTag>Keys`, `queryKeys`).
2. **옵션(Tier 2)**: `<operationId>QueryOptions`, `<operationId>MutationOptions`. 첫 인자는 생성된 클라이언트입니다. `queryClient.prefetchQuery()`처럼 훅 밖에서도 씁니다. 훅까지 담은 한 파일 출력은 맨 앞에 `'use client'`가 있으므로, React Server Component에서는 `outputRouting`을 둔 `oa-gen generate`의 `<id>.queries.ts`(훅 없음, 지시문 없음)를 import합니다.
3. **훅(Tier 3)**: `use<OperationId>Query`, `use<OperationId>Mutation`, `createApiHooks`.

어느 파일에 들어가는지는 명령에 따라 다릅니다.

| 명령 | 파일 |
|---|---|
| `oa-gen generate` (`outputRouting` 있음) | `<id>.keys.ts`(키), `<id>.queries.ts`(옵션). 훅 없음 |
| `oa-gen generate` (`outputRouting` 없음) | `<id>.queries.ts` 한 파일에 3계층 |
| `oa-gen generate:tanstack --output <dir>` | `<dir>/tanstack-query.ts` 한 파일에 3계층. `--tier keys`면 키만 |

키와 옵션 팩토리는 프레임워크 중립입니다. 키는 프레임워크를 import하지 않고, 옵션은 모든 어댑터가 `@tanstack/query-core`에서 재노출하는 `QueryObserverOptions`·`MutationObserverOptions`·`InfiniteQueryObserverOptions`만 씁니다. 따라서 `generate:tanstack --framework vue|svelte`의 keys+options 출력은 `tsc`를 통과합니다. 훅(Tier 3)은 `useQuery`·`UseQueryResult` 같은 React 훅 타입을 쓰므로 React 전용이며, `--framework vue|svelte --tier hooks`는 오류로 끝납니다. `oa-gen generate`는 항상 React(`@tanstack/react-query`)를 대상으로 합니다. `--split`에서 `--tier options|hooks`를 쓰면 하위 계층(keys, 필요하면 queries)을 의존성으로 함께 생성하므로 단독 출력도 컴파일됩니다([생성물별 명령](./04-scaffolding-and-diff.md#43-경로-3-생성물별-명령)).

### 규칙 5: 오래된 생성물 정리
`oa-gen generate`는 `.oa-manifest.json`에 기록된 생성 파일 중 같은 설정 파일로 실행한 `oa-gen generate`가 만들었던 파일(`--spec` 실행이면 같은 스펙 파일로 만들었던 파일) 가운데 이번 실행이 만들지 않고 내용도 바뀌지 않은 파일을 지웁니다. 손으로 고친 파일, 생성 배너가 없는 파일, `oa-gen generate:tanstack` 등 다른 명령이 쓴 파일은 지우지 않습니다. `outputRouting.pruneOrphans: false`면 아무 파일도 지우지 않습니다. 판정 조건은 [생성 파일 정리](../declarative-spec-configuration.md#45-생성-파일-정리)를 봅니다.

---

## 4. TypeSpec 작성 규칙

이름, 필수 메타데이터, 응답 템플릿, 데이터 타입 제약 규칙은 [TypeSpec 작성 규칙](../typespec-authoring-conventions.md)이 정본입니다. 그 문서의 파일 오너십은 oa-sdk 저장소의 중앙 번들(`packages/schemas/typespec/`) 기준이고, 코로케이션 프로젝트에서는 피처마다 `<feature>.tsp`를 독립 서비스로 둡니다.

```typespec
// src/features/billing/billing.tsp
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using Http;
using OpenAPI;
using OaSdkTypeSpec;

@service(#{ title: "Billing" })
namespace BillingApi;

model Invoice {
  @visibility(Lifecycle.Read) id: string;
  amount: int64;
}
model CreateInvoiceRequest { amount: int64; }

@summary("인보이스 단건 조회")
@doc("인보이스 ID를 기반으로 결제 상세를 반환합니다.")
@tag("billing")
@operationId("getInvoiceById")
@route("/invoices/{id}")
@get
op getInvoiceById(@path id: string): Ok<Invoice> | ErrorResponse<404>;

@summary("인보이스 생성")
@tag("billing")
@operationId("createInvoice")
@route("/invoices")
@post
op createInvoice(@body body: CreateInvoiceRequest): Created<Invoice> | ErrorResponse<400>;
```

`@tag`는 OpenAPI의 `tags`에만 쓰이고 생성물 경로에는 영향을 주지 않습니다.

---

## 5. 실행 명령 색인

| 목적 | 명령 | 생성물 위치 |
|---|---|---|
| **설정 기반 일괄 생성** | `oa-gen generate` | spec target의 `outDir` 또는 `outputRouting` 경로 |
| **설정 없이 한 스펙 생성** | `oa-gen generate --spec <path.tsp> --out-dir <dir>` | `<dir>`에 OpenAPI, JSON Schema, 계약, 클라이언트, TanStack Query |
| **런타임 의존성 없는 타입 가드** | `oa-gen generate:guards --input <path.tsp> --out-dir <dir> --split` | `<dir>`의 가드 함수와 `.d.ts` |
| **TypeScript 타입** | `oa-gen typegen --spec <path.tsp> --output <file.ts>` | 타입 정의 파일 |
| **배포용 클라이언트 패키지** | `oa-gen generate:client --spec <path.tsp> --pack --output <dir>` | `<dir>`의 패키지 (`src/`, `dist/`, `package.json`, `README.md`) |
| **mock 서버** | `oa-gen mock --tsp <path.tsp> --watch` | 디스크에 쓰지 않음. `http://127.0.0.1:4010` |

명령별 제약(동반 패키지, `generate:guards`의 컴포넌트 이름 제약 등)은 [스캐폴딩 및 생성 가이드](./04-scaffolding-and-diff.md#4-tsp-수정-후-생성물-다시-만들기)를 봅니다.

---

## 6. 실무 팁과 안티패턴

### 팁 1: TypeSpec 머리말 누락 방지
`@route`, `@get`, `@path`, `@body`는 `@typespec/http`, `@operationId`·`@extension`·`@info`는 `@typespec/openapi`에 있습니다. `import "@typespec/http";`만 선언하고 `@operationId`를 쓰면 `error invalid-ref: Unknown decorator @operationId`가 납니다. 독립 `.tsp` 파일은 다음 네 줄로 시작합니다.
```typespec
import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;
```

### 팁 2: TypeSpec 1.x의 `#{}` 값 문법과 서비스 버전
decorator에 객체를 넘길 때 `{ title: "..." }`를 쓰면 `error expect-value: ... Use #{} to create an object value.`가 납니다. `#{}`를 씁니다. 서비스 버전은 `@service`가 아니라 `@info`에 둡니다.
```typespec
@service(#{ title: "Order Service" })
@info(#{ version: "1.0.0" })
namespace OrderService;
```

### 팁 3: 폴더 과밀 방지 (서브폴더 패턴)
- **안티패턴**: 피처 폴더 루트에 생성물을 모두 두면 `.tsp`, `.contract.ts`, `.client.ts`, `.queries.ts`, `.openapi.json`, `.schema.json`이 손으로 쓴 컴포넌트(`OrdersPage.tsx`)와 섞입니다.
- **권장 배치**:
  - **패턴 A (서브폴더)**: `outDir: "src/features/orders/generated"`처럼 생성물을 한 단계 아래 폴더에 둡니다.
  - **패턴 B (`byKind` 분산)**: 스펙 JSON은 spec target의 `outDir`(예: `dist/specs/`)에 두고 TanStack Query 코드(`queries`, `keys`)만 `byKind`로 피처 폴더에 보냅니다.

### 팁 4: 생성물을 쓰는 프로젝트의 의존성
- 핸들러 계약(`*.contract.ts`)과 fetch 클라이언트(`*.client.ts`)는 import가 없습니다.
- TanStack Query 코드(`*.queries.ts`)는 `@tanstack/react-query`와 `@oa-sdk/client`의 타입을 import합니다.
- 이 코드를 쓰는 프로젝트에 설치합니다. `@oa-sdk/client`는 `@oa-sdk/codegen` 0.9.0 릴리스부터 npm에서 제공됩니다.
  ```bash
  npm install @tanstack/react-query
  npm install --save-dev @oa-sdk/client
  ```

### 팁 5: `@oa-sdk/typespec-decorators`로 중복 제거
파일마다 `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`를 정의하지 않고 표준 계약을 import합니다(0.3.0부터, [설치 안내](../../../packages/typespec-decorators/README.md#install)).
```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkTypeSpec;
```

---

## 7. JSON Schema 생성물을 MCP·CLI 도구 입력으로 쓰기

`@oa-sdk/tools`의 `createSchemaTool`은 JSON Schema를 받아 MCP·CLI·HTTP 도구 정의를 만듭니다. 도구를 계약에서 자동 생성하지는 않으며, 도구는 직접 고르고 정의합니다. 입력 schema만 `oa-gen generate`가 만든 `<id>.schema.json`의 `$defs`에서 가져오면 TypeSpec 모델과 도구 입력을 따로 관리하지 않아도 됩니다.

```typescript
// src/mcp/tools/drive.ts
import { readFileSync } from "node:fs";
import { createSchemaTool } from "@oa-sdk/tools";

// oa-gen generate가 만든 JSON Schema 2020-12 생성물 (<id>.schema.json)
const { $defs } = JSON.parse(
  readFileSync(new URL("../../generated/drive.schema.json", import.meta.url), "utf8"),
);

export const driveUploadTool = createSchemaTool({
  name: "drive_upload_file",
  description: "클라우드 드라이브에 파일을 업로드합니다.",
  category: "drive",
  // TypeSpec의 UploadFileRequest 모델 schema를 그대로 사용
  schema: $defs.UploadFileRequest,
  // 에이전트에게 노출하지 않을 필드 제외
  omit: ["internalDatabaseId"],
  // LLM용 설명 덮어쓰기
  overrides: {
    content: { description: "파일 본문 (일반 텍스트, Markdown 또는 Base64 문자열)" },
  },
  async execute(ctx, input) {
    return `파일 업로드 요청: ${input.name}`;
  },
});
```

- `createSchemaTool`은 schema 안의 `$ref`(`#/$defs/...`)를 풀지 않습니다. 다른 모델을 참조하지 않는 요청 모델에 씁니다.
- `pick`, `extend`, `required`, CLI에서 필수 값이 빠졌을 때의 대화형 입력 등 옵션 전체는 [`@oa-sdk/tools` README](../../../packages/tools/README.md)를 봅니다.

---

## 다음 단계 및 관련 가이드
- [선언적 스펙 설정 가이드 (oa.config.ts)](../declarative-spec-configuration.md)
- [TypeSpec 작성 규칙](../typespec-authoring-conventions.md)
- [TypeSpec 스캐폴딩 및 Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [순수 타입 선언 및 제로-런타임 가드 가이드](../pure-types-and-guards.md)
- [TypeSpec 데코레이터 레퍼런스](./03-decorators-reference.md)
- [TypeSpec 트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)
