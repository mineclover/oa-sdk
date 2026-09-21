# TypeSpec 아티팩트 생성 토폴로지, 아키텍처 규칙 및 작성 컨벤션

> **Canonical Authority**: `@oa-sdk/codegen`, `@oa-sdk/router`, `@oa-sdk/client`  
> **Applicable Specs**: TypeSpec (`.tsp`), OpenAPI 3.2, JSON Schema Draft 2020-12  
> **Target Topologies**: Co-located (피처 인접), Feature-Sliced Design (FSD), Monorepo Clean Architecture, Packaged SDK  

---

## 1. 개요 (Overview)

`oa-sdk`는 단일 진실 공급원(Single Source of Truth, SSOT)인 **TypeSpec(`.tsp`)** 계약으로부터 백엔드 라우터 핸들러, 프론트엔드 쿼리, 클라이언트 SDK, 런타임 스키마를 결정론적(Deterministic)으로 파생 생성합니다.

현대 웹 및 대규모 모노레포 프로젝트는 팀의 조직 구조나 아키텍처에 따라 다양한 파일 배치 방식을 요구합니다. `oa-sdk`는 다음과 같은 유연성을 완벽히 지원합니다:
1. **다양한 생성 토폴로지 지원**: 도메인/피처 구현부 바로 옆에 `.tsp`를 두는 **코로케이션(Co-location)**부터, **Feature-Sliced Design(FSD)** 분산 배치, 계층별 패키지로 격리하는 **Monorepo Clean Architecture**까지 자유롭게 선택할 수 있습니다.
2. **엄격한 아키텍처 규칙 (5대 원칙)**: 프레임워크 결합도 제거, 네트워크 와이어 타입 안전성, 계층별 모듈 분리를 강제하여 장기적인 유지보수성을 보장합니다.
3. **일관된 TypeSpec 작성 규칙 (5대 컨벤션)**: 메타데이터, 제네릭 엔벨롭, 네이밍 규칙을 표준화하여 예측 가능한 코드를 자동 생성합니다.

---

## 2. 지원되는 4대 생성 토폴로지 (Generation Topologies)

```
[토폴로지 1: Co-located 피처 인접]    [토폴로지 2: Feature-Sliced Design]   [토폴로지 3: Monorepo Clean Architecture]
src/features/billing/                src/features/billing/api/           packages/contracts/ (순수 계약)
├── billing.tsp                      ├── billing.contract.ts             packages/client-sdk/ (클라이언트)
├── billing.contract.ts              ├── billing.client.ts               apps/web/src/queries/ (TanStack)
├── billing.client.ts                └── billing.queries.ts              apps/server/src/routes/ (서버 바인더)
├── billing.queries.ts
└── billing.openapi.json
```

| 토폴로지 | 추천 환경 | 설정 핵심 (`oa.config.ts`) | 주요 특징 |
|---|---|---|---|
| **1. Co-located (피처 인접)** | DDD, 모듈형 모놀리스, 빠른 기능 단위 개발 | `specs: [{ schemaEntry: ".../billing.tsp", outDir: ".../billing" }]` | `.tsp` 바로 옆에 `contract`, `client`, `queries`, `json`이 함께 위치하여 극대화된 응집도 제공 |
| **2. FSD (Feature-Sliced Design)** | 대규모 프론트엔드/풀스택 웹 애플리케이션 | `outputRouting.pattern: "src/features/{tag}/api/{tag}.{kind}.ts"` | `{tag}` 토큰을 기준으로 기능 폴더의 `api/` 디렉터리로 아티팩트 자동 분산 배치 |
| **3. Monorepo Clean Architecture** | 엔터프라이즈 멀티 패키지 모노레포 | `outputRouting.byKind: { contract: "packages/contracts/...", client: "packages/client/..." }` | 계약, 클라이언트 SDK, 쿼리 훅을 계층별 워크스페이스 패키지로 완전 분리 방출 |
| **4. Standalone Packaged SDK** | 사내 프라이빗 패키지 또는 오픈소스 배포 | `oa-gen generate:client --pack --output ./packages/api-client` | 0-런타임 의존성의 배포 가능한 독립 NPM 패키지(`dist/`, `package.json`, `README.md`, `.d.ts`) 빌드 |

---

### 2.1 토폴로지 1: Co-located / Feature-Adjacent (도메인/피처 인접 생성)

개별 기능/도메인 폴더 내에 구현 코드와 함께 `.tsp`를 배치하는 방식입니다.

#### 정적 선언 방식
```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen";

export default defineConfig({
  product: {
    specs: [
      {
        id: "billing",
        schemaEntry: "src/features/billing/billing.tsp",
        outDir: "src/features/billing", // .tsp 파일 바로 옆
      },
      {
        id: "users",
        schemaEntry: "src/features/users/users.tsp",
        outDir: "src/features/users",
      },
    ],
  },
});
```

#### 동적 Glob 자동 탐색 방식 (Auto-discovery)
`oa.config.ts`는 **비동기 팩토리 함수(`export default async () => ...`)**를 지원하므로, 프로젝트 내의 모든 `**/*.tsp` 파일을 자동으로 탐색하여 `specs` 타겟 배열로 즉석 매핑할 수 있습니다:

```typescript
// oa.config.ts (동적 탐색 패턴)
import { defineConfig } from "@oa-sdk/codegen";
import { glob } from "fast-glob";
import path from "node:path";

export default defineConfig(async () => {
  const tspFiles = await glob("src/features/**/*.tsp");

  return {
    product: {
      specs: tspFiles.map((tspPath) => ({
        id: path.basename(tspPath, ".tsp"),
        schemaEntry: tspPath,
        outDir: path.dirname(tspPath), // 각 .tsp 파일이 위치한 폴더 바로 옆
      })),
    },
  };
});
```

**생성 산출물 트리**:
```
src/features/billing/
├── billing.tsp            # 개발자가 작성한 TypeSpec 계약
├── billing.openapi.json   # OpenAPI 3.2 사양
├── billing.schema.json    # JSON Schema Draft 2020-12 ($defs)
├── billing.contract.ts    # 백엔드 라우터 연동용 순수 핸들러 계약
├── billing.client.ts      # 경량 fetch 클라이언트 SDK
├── billing.queries.ts     # TanStack Query v5 훅
└── billing.keys.ts        # TanStack Query 키 팩토리
```

---

### 2.2 토폴로지 2: Feature-Sliced Design (FSD 분산 라우팅)

프론트엔드와 풀스택 팀에서 선호하는 FSD 구조에 맞춰 생성 아티팩트를 레이어별로 분산 방출합니다.

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen";

export default defineConfig({
  product: {
    specs: [
      {
        id: "main-api",
        profile: "full-api-document",
        schemaEntry: "packages/schemas/typespec/main.tsp",
        outDir: "dist/specs",
      },
    ],
    outputRouting: {
      pattern: "src/features/{tag}/api/{tag}.{kind}.ts",
      casing: "kebab",
      pruneOrphans: true,
      byKind: {
        contract: "packages/server/src/contracts/{tag}.contract.ts",
        client:   "packages/client/src/sdk/{tag}.client.ts",
        queries:  "apps/web/src/features/{tag}/api/{tag}.queries.ts",
        keys:     "apps/web/src/features/{tag}/api/{tag}.keys.ts",
      },
    },
  },
});
```

> [!TIP]
> **상대 Import 자동 재계산 (`import-resolver.ts`)**: 아티팩트가 서로 다른 폴더나 패키지로 분산 배치되더라도, `client` ↔ `queries` 간의 상대 TypeScript `import` 문을 엔진이 표준 POSIX 경로와 현대 ESM `.js` 확장자로 자동 재계산합니다.

---

### 2.3 토폴로지 3: Monorepo Clean Architecture (계층별 패키지 격리)

모노레포 환경에서 백엔드 핸들러 인터페이스, 클라이언트 SDK, 프론트엔드 쿼리 훅을 독립된 워크스페이스 패키지로 격리합니다:

- `packages/contracts/`: 순수 핸들러 계약 인터페이스 (`*.contract.ts`) 및 무런타임 타입 가드 (`*.guard.ts`).
- `packages/client-sdk/`: 0-런타임 의존성 브라우저/Node 겸용 클라이언트 SDK (`*.client.ts`).
- `apps/web/src/api/`: TanStack Query 훅 및 키 팩토리 (`*.queries.ts`, `*.keys.ts`).
- `apps/server/src/routes/`: `@oa-sdk/router`를 통한 Fastify/Hono/Express 프레임워크 라우터 바인더.

---

### 2.4 토폴로지 4: Standalone Packaged SDK (`--pack`)

사내 타 팀이나 외부 고객사에 배포할 수 있는 0-런타임 의존성 단독 패키지를 생성합니다.

```bash
oa-gen generate:client \
  --spec packages/schemas/typespec/main.tsp \
  --pack \
  --output packages/api-client \
  --name @my-org/api-client \
  --package-version 1.0.0
```

**생성 산출물**:
```
packages/api-client/
├── package.json           # 배포용 package.json (0 runtime dependencies)
├── README.md              # SDK 빠른 시작 사용법 안내 마크다운
└── dist/
    ├── index.js           # ESM 번들
    └── index.d.ts         # TypeScript 선언 및 JSDoc
```

---

## 3. 아키텍처 규칙 (5대 핵심 설계 원칙)

생성된 코드가 런타임 환경과 프레임워크에 종속되지 않고 영구적인 하위 호환성을 유지할 수 있도록 5대 불변 규칙이 적용됩니다.

### 규칙 1: TypeSpec 단일 진실 공급원 (SSOT Invariance)
- **불변 원칙**: 생성된 산출물(`*.contract.ts`, `*.client.ts`, `*.openapi.json`, `dist/`)을 개발자가 직접 수정(Hand-edit)하지 않습니다.
- 모든 스키마 및 API 계약의 변경은 오직 `.tsp` 파일에서만 이루어지며, 빌드 파이프라인(`oa-gen generate`)을 통해 하류 아티팩트로 일방향 투영됩니다.

### 규칙 2: 프레임워크 비의존 순수 핸들러 계약 (`@oa-sdk/router`)
- `*.contract.ts`는 Fastify, Express, Hono, NestJS 등 특정 웹 프레임워크의 라이브러리를 일절 import하지 않는 순수 TypeScript 인터페이스입니다.
- **멀티 상태 유니온 (`HandlerResponse<Status, Body>`)**: 비즈니스 로직 핸들러는 응답 상태코드와 바디가 결합된 유니온을 반환합니다.
- **Envelope 충돌 방어 (Collision Defense)**: 핸들러 응답 필드와 HTTP 엔벨롭 메타데이터가 충돌하지 않도록 명시적 구조를 보장합니다:
  ```typescript
  // billing.contract.ts (프레임워크 무관 순수 계약 인터페이스)
  export interface BillingHandlers {
    getInvoice(req: { params: { id: string } }): Promise<
      | HandlerResponse<200, Invoice>
      | HandlerResponse<404, NotFoundError>
    >;
  }
  ```

### 규칙 3: 와이어 포맷 안전성 강제 (`JsonPrimitive<T>`)
- TypeScript 상에서 `Date` 객체나 프로토타입 메서드가 포함된 모델이라도 네트워크 전송 시에는 JSON 문자열(`string`)로 직렬화됩니다.
- 클라이언트 SDK(`*.client.ts`)는 `JsonPrimitive<T>`를 강제하여 `Date` $\rightarrow$ `string`, 함수 및 프로토타입 메서드 제거를 정적으로 검증합니다. 런타임 역직렬화 오류를 원천 차단합니다.

### 규칙 4: 3계층 TanStack Query 분리 (Keys $\rightarrow$ Options $\rightarrow$ Hooks)
TanStack Query 생성물은 결합도에 따라 3개 계층으로 엄격히 분리됩니다:
1. **Tier 1 (Query Key Factory)**: 캐시 무효화 및 쿼리 식별을 위한 불변 튜플 키 팩토리 (`keys.ts`).
2. **Tier 2 (Pure Options Factory)**: React에 종속되지 않고 Next.js Server Components(RSC) `prefetchQuery` 및 Vue/Svelte에서도 재사용 가능한 순수 `queryOptions` / `mutationOptions` (`options.ts`).
3. **Tier 3 (Composition Hooks)**: UI 프레임워크 전용 훅 (`useGetInvoice`, `useCreateInvoice`).

### 규칙 5: 3단계 안전 고아 파일 정리 (3-Gate Safe Orphan Pruning)
스펙 변경으로 인해 엔드포인트나 태그가 삭제될 때 개발자의 수기 작성 파일을 보호하기 위해 `.oa-manifest.json` 기반의 3대 게이트를 통과한 파일만 삭제합니다:
1. **Gate 1 (출처 무결성)**: 매니페스트에 공식 등록된 아티팩트인가?
2. **Gate 2 (해시 무결성)**: 디스크 파일 내용이 수정되지 않았는가? (개발자가 한 줄이라도 수동 편집한 파일은 보존)
3. **Gate 3 (배너 불변식)**: `@generated`, `Auto-generated by oa-sdk` 배너 마커가 존재하는가?

---

## 4. TypeSpec 작성 규칙 (5대 컨벤션 표준)

`.tsp` 코드를 작성할 때 일관된 OpenAPI 3.2 및 클라이언트 코드를 얻기 위한 표준 컨벤션입니다.

### 컨벤션 1: 파일 및 모듈 오너십
- **코로케이션 모드**: 개별 피처 위치에 `<feature>.tsp`로 독립 작성 (예: `src/features/billing/billing.tsp`).
- **중앙 통합 모드**: `packages/schemas/typespec/` 기준:
  - `main.tsp`: `import` 및 루트 `namespace` 선언만 포함 (모델 직접 작성 금지).
  - `<domain>.tsp`: 도메인별 리소스 모델 및 HTTP Operation 선언 (`users.tsp`, `orders.tsp`).
  - `common.tsp`: 공통 에러 및 제네릭 래퍼.

### 컨벤션 2: HTTP Operation 필수 4대 메타데이터
모든 HTTP 엔드포인트(`op`)는 다음 4종의 메타데이터를 반드시 선언해야 합니다:
```typespec
@summary("인보이스 단건 조회")                               // 1. 사람을 위한 한 줄 요약
@doc("인보이스 ID를 기반으로 결제 상세 및 품목 목록을 반환합니다.") // 2. 상세 설명
@tag("billing")                                             // 3. 도메인 분류 태그 (라우팅 기준)
@operationId("getInvoiceById")                              // 4. camelCase 동사+명사 고유 ID
@route("/invoices/{id}")
@get
op getInvoiceById(@path id: string): Ok<Invoice>;
```

### 컨벤션 3: 표준 제네릭 응답 엔벨롭 필수 사용 (No Ad-hoc Responses)
개별 엔드포인트마다 일회성 `200Response` 모델을 만들지 않고, `@oa-sdk/typespec-decorators`의 표준 템플릿을 사용합니다:
```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkContracts; // 전역 표준 템플릿 사용

op getInvoice(@path id: string): Ok<Invoice>;                         // 200 OK
op createInvoice(@body req: CreateInvoiceRequest): Created<Invoice>;  // 201 Created
op deleteInvoice(@path id: string): NoContent;                       // 204 No Content
op listInvoices(@query page?: integer): Ok<PageResult<Invoice>>;      // 200 페이징 목록
```

### 컨벤션 4: DTO 및 모델 명명 컨벤션
- **엔티티 모델**: `PascalCase` 단수형 명사 (`Invoice`, `PaymentMethod`, `Customer`).
- **생성 요청 DTO**: `Create<Resource>Request` (`CreateInvoiceRequest`).
- **수정 요청 DTO**: `Update<Resource>Request` (`UpdateInvoiceRequest`).
- **상태 열거형**: 네이티브 문자열 리터럴 유니온 사용:
  ```typespec
  alias InvoiceStatus = "draft" | "issued" | "paid" | "void";
  ```

### 컨벤션 5: 정밀 타입 제약 어노테이션
단순 `string`, `integer` 선언을 지양하고 의도가 명확한 제약 데코레이터를 적용합니다:
```typespec
model Customer {
  @format("uuid")
  id: string;

  @format("email")
  email: string;

  @minLength(1)
  @maxLength(100)
  name: string;

  @minValue(0)
  creditBalance: integer;

  createdAt: utcDateTime;
}
```

---

## 5. 실행 명령 및 워크플로우 색인

| 목적 | 실행 명령 | 산출물 위치 |
|---|---|---|
| **선언적 일괄 재생성** | `oa-gen generate` | `oa.config.ts`에 정의된 각 타겟 디렉터리 또는 `outputRouting` 경로 |
| **CLI 원라인 개별 생성** | `oa-gen generate --spec <path.tsp> --output <dir>` | 지정된 `--output` 디렉터리에 계약, 클라이언트, 스펙 일괄 생성 |
| **독립형 정적 타입 가드 및 `.d.ts`** | `oa-gen generate:guards --input <path.tsp> --out-dir <dir> --split` | CSP Zero-eval 순수 정적 가드 함수 및 TypeScript `.d.ts` 정의 |
| **순수 TypeScript 타입 선언** | `oa-gen typegen --spec <path.tsp> --output <file.ts>` | 순수 TypeScript 타입 정의 파일 |
| **0-런타임 의존성 패키지 빌드** | `oa-gen generate:client --spec <path.tsp> --pack --output <dir>` | 배포 가능한 독립 NPM 패키지 (`dist/`, `package.json`, `README.md`) |
| **실시간 핫 리로드 목 서버** | `oa-gen mock --tsp <path.tsp> --watch --port 4010` | 100ms 디바운싱 인메모리 Mock HTTP 서버 |

---

## 6. 실무 권장 팁 및 안티패턴 방어 (Best Practices & Pitfalls)

실제 프로덕션 환경에서 코로케이션 및 아티팩트 생성을 운영할 때 마주치는 문제들과 이를 방지하는 실무 베스트 프랙티스입니다.

### 팁 1: TypeSpec 4대 필수 헤더 보일러플레이트 누락 방지
- **주의**: HTTP API를 작성할 때 `@route`, `@get`, `@path`, `@body`는 `@typespec/http`에 속하지만, **`@operationId`는 `@typespec/openapi`에 속합니다.**
- 개발자가 `import "@typespec/http";`만 선언하고 `@operationId`를 쓰면 `error invalid-ref: Unknown decorator @operationId` 에러가 발생합니다.
- **권장 규칙**: 독립적인 `.tsp` 파일을 작성할 때는 항상 상단에 다음 4줄을 세트로 선언하십시오:
  ```typespec
  import "@typespec/http";
  import "@typespec/openapi";

  using Http;
  using OpenAPI;
  ```

### 팁 2: TypeSpec 0.60+ 문법 (`#{}` 오브젝트 표기법)
- 서비스나 확장의 메타데이터 객체를 선언할 때, 일반 JSON 객체 리터럴(`{ title: "..." }`)을 사용하면 컴파일러가 모델 표현식으로 오인하여 `error expect-value: Use #{}` 에러를 발생시킵니다.
- **권장 규칙**: 반드시 `#{}` 표기법을 사용하십시오:
  ```typespec
  @service(#{
    title: "Order Service",
    version: "1.0.0"
  })
  namespace OrderService;
  ```

### 팁 3: 디렉터리 과밀화(File Crowding) 방지 — 서브폴더 패턴
- **안티패턴**: `src/features/orders/` 폴더 루트에 모든 아티팩트를 쏟아내면, 한 폴더에 `.tsp`, `.client.ts`, `.contract.ts`, `.queries.ts`, `.openapi.json`, `.schema.json` 총 6개 파일이 생성되어 손코딩된 UI 컴포넌트(`OrdersPage.tsx`)나 훅과 섞여 유지보수가 어려워집니다.
- **권장 레이아웃**:
  - **패턴 A (서브폴더 패턴, 권장)**: `outDir: "src/features/orders/generated"` 또는 `outDir: "src/features/orders/api"`를 지정하여 생성 코드를 한 단계 하위 폴더로 격리합니다.
  - **패턴 B (`byKind` 분산)**: 스펙 JSON 파일은 `dist/specs/`로 배출하고, 프론트엔드 쿼리(`queries.ts`, `keys.ts`)만 `src/features/{tag}/api/`에 배치합니다.

### 팁 4: 프론트엔드 소비 프로젝트의 피어 의존성 (Peer Dependencies)
- 생성된 순수 계약(`*.contract.ts`)은 프레임워크 비의존 순수 TypeScript로 런타임 의존성이 0개이지만,
- 클라이언트(`*.client.ts`)는 `@oa-sdk/client`의 타입을, TanStack Query(`*.queries.ts`)는 `@tanstack/react-query`의 훅과 타입을 참조합니다.
- **권장 조치**: 생성된 쿼리 및 클라이언트를 사용하는 프론트엔드 프로젝트의 `package.json`에 다음 의존성을 추가하십시오:
  ```bash
  pnpm add @tanstack/react-query
  pnpm add -D @oa-sdk/client
  ```

### 팁 5: `@oa-sdk/typespec-decorators` 활용을 통한 중복 코드 제거
- 파일마다 `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`를 직접 반복 정의하는 대신, 사내 플랫폼 표준인 `@oa-sdk/typespec-decorators`를 임포트하면 수십 줄의 중복을 제거할 수 있습니다:
  ```typespec
  import "@oa-sdk/typespec-decorators";
  using OaSdkContracts;
  ```

---

## 7. TypeSpec JSON Schema ➔ MCP Tool & CLI 경량 스키마 브릿지 패턴 (Lightweight Schema Bridge)

TypeSpec(`.tsp`)의 API 계약을 AI Agent(MCP Tool) 및 개발자용 CLI로 확장할 때 적용하는 **최고 ROI의 아키텍처 패턴**입니다.

### 7.1 완전 자동 생성기 vs 경량 스키마 브릿지 (Trade-off 분석)

| 비교 항목 | ❌ `.tsp` ➔ MCP/CLI 완전 자동 생성기 (Naive Gen) | ✅ 경량 스키마 브릿지 (`@oa-sdk/tools` Bridge) |
|---|---|---|
| **도구 개수** | 120+개 마이크로 REST 엔드포인트 기계적 생성 | **도메인당 15~25개 고수준 태스크 툴 큐레이션** |
| **에이전트 품질** | 컨텍스트 토큰 폭증, 유사 툴 간 환각/오호출 급증 | LLM 인텐트에 최적화되어 도구 호출 성공률 극대화 |
| **스키마 유지보수** | 제너레이터 예외 처리 수천 줄 유지보수 부채 | **TypeSpec 컴파일 산출물(JSON Schema) 1줄 참조로 드리프트 0** |
| **CLI 사용성** | 비인간적인 긴 명령어 (`gt delete-drive-files-by...`) | 직관적인 동사-명사 트리 + **대화형 프롬프트 폴백(TTY)** |
| **도입 공수** | 수 주간의 제너레이터 개발 및 엣지 케이스 디버깅 | **반나절 (30~50줄 헬퍼 활용)** |

### 7.2 경량 스키마 브릿지 동작 원리

`oa-gen` / TypeSpec 컴파일러는 이미 완전한 **JSON Schema Draft 2020-12**와 TypeScript 타입을 배출합니다.
`@oa-sdk/tools`의 `createSchemaTool`을 사용하면, Zod 등으로 스키마를 이중 작성할 필요 없이 TypeSpec의 DTO 스키마를 그대로 주입할 수 있습니다:

```typescript
// src/mcp/tools/drive.ts
import { createSchemaTool } from "@oa-sdk/tools";
import { schemas } from "../generated/schemas.js"; // TypeSpec 컴파일 산출물

export const driveUploadTool = createSchemaTool({
  name: "drive_upload_file",
  description: "클라우드 드라이브에 파일을 업로드합니다.",
  category: "drive",
  // 1. TypeSpec의 UploadFileRequest DTO 스키마를 그대로 재활용 (스키마 이중 선언 0)
  schema: schemas.UploadFileRequest,
  // 2. 에이전트에게 불필요한 내부 ID/감사 필드는 간편하게 제외 (Omit)
  omit: ["internalDatabaseId", "auditSecret"],
  // 3. LLM 맞춤형 가이드라인 설명 오버라이드
  overrides: {
    content: {
      description: "파일 본문 내용 (일반 텍스트, 마크다운 또는 Base64 문자열)",
    },
  },
  // 4. 에이전트 편의를 위한 헬퍼 필드 확장
  extend: {
    isBase64: {
      type: "boolean",
      default: false,
      description: "바이너리 파일 등 base64 인코딩 데이터인 경우 true",
    },
  },
  // 5. 비즈니스 실행 핸들러 (입력 타입은 TypeSpec DTO와 100% 일치)
  async execute(ctx, input) {
    const file = await driveService.upload(input);
    // 에이전트 친화적인 Markdown 응답 반환
    return `✅ 파일 업로드 성공: **${file.name}** (ID: \`${file.id}\`)`;
  },
});
```

### 7.3 CLI 인터랙티브 대화형 입력 (Interactive Prompt Fallback)

CLI 명령어 실행 시 필수 플래그가 누락된 경우, 에러를 내고 종료하는 대신 터미널 환경(TTY)을 감지하여 Node.js 표준 `readline` 기반으로 즉시 대화형 프롬프트를 작동시킵니다:

```bash
# 1. CI / 스크립트 환경: 모든 플래그를 넘기면 즉시 실행
gt drive upload --name report.md --role editor

# 2. 터미널 인터랙티브 환경: 인자를 빠뜨리면 스키마를 분석해 자동으로 질문!
gt drive upload
? Select role (Initial permission role):
  1) viewer
  2) editor
  3) owner
Choice (1-3): 2
? name (File name with extension): report.md
? content (File body content): # Project Status
✅ 파일 업로드 성공: report.md
```

---

## 다음 단계 및 관련 가이드
- [선언적 스펙 설정 가이드 (oa.config.ts)](../declarative-spec-configuration.md)
- [스키마 아키텍처 및 작성 규칙 (4-Stage TypeSpec SSOT & 비디오 트랜지션 파라미터 다양화)](../schema-architecture-and-conventions.md)
- [TypeSpec 스캐폴딩 및 Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [순수 타입 선언 및 제로-런타임 가드 가이드](../pure-types-and-guards.md)
- [TypeSpec 데코레이터 상세 레퍼런스](./03-decorators-reference.md)
- [TypeSpec 트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)

