---
docType: guide
sourceLocale: ko
canonical: true
audience:
  competence: intermediate
productVersions:
  - "@oa-sdk/codegen 0.9.0"
  - "@oa-sdk/client 0.2.2"
  - "@oa-sdk/router 0.2.2"
  - "@typespec/compiler 1.16.0"
owner: "OA SDK maintainers"
status: active
---

# TypeSpec 빌더 플랫폼 및 openapi-ts SDK 가이드 (TypeSpec Builder Platform Guide)

TypeSpec(`.tsp`)을 단일 정본(SSOT: Single Source of Truth)으로 삼고, 디스크 중간 아티팩트 없이 인메모리 컴파일과 플러그인 위상 정렬(DAG)을 거쳐 openapi-ts 스타일의 타입 안전 클라이언트 SDK, TanStack Query v5 3계층 코드, 백엔드 라우터 및 바이너리 코덱을 생성하는 **TypeSpec 빌더 플랫폼(TypeSpec Builder Platform)** 공식 가이드입니다.

이 문서는 `@oa-sdk/codegen` 0.9.0, `@oa-sdk/client` 0.2.2, `@oa-sdk/router` 0.2.2, `@typespec/compiler` 1.16.0 기준입니다.

- 저장소 전반의 빠른 시작 및 CLI 사용법은 [Quick Start](./quick-start.md)를 참고하십시오.
- TypeSpec 정본 작성 규칙과 네임스페이스 구조는 [TypeSpec 작성 규칙](./typespec-authoring-conventions.md)을 참고하십시오.
- 생성된 클라이언트 및 TanStack Query의 일반 소비 패턴은 [클라이언트 및 쿼리 소비 가이드](./client-and-query-consumption.md)를 참고하십시오.
- 서버 프레임워크 라우터 및 순수 핸들러 계약은 [백엔드 핸들러 계약 가이드](./backend-handler-contracts.md)를 참고하십시오.
- 목 서버(Mock Server) 연동은 [Mock 서버 사용 가이드](./mock-server-usage.md)를 참고하십시오.

---

## 1. 아키텍처 및 파이프라인 라이프사이클 (Architecture & Lifecycle)

TypeSpec 빌더 플랫폼은 기존의 파일 기반 CLI(`tsp compile -> openapi.yaml -> codegen`) 파편화를 해결하고, 하나의 빌더 인스턴스에서 스펙 분석, 프로그래머블 인트로스펙션, 가상 파일 시스템(VFS) 기반 다중 타겟 코드 생성을 단일 인메모리 파이프라인으로 처리합니다.

### 1.1 플랫폼 토폴로지 (Platform Architecture Topology)

```mermaid
flowchart TD
    subgraph SSOT [1. TypeSpec 단일 정본 (SSOT)]
        TSP["TypeSpec 스펙 (.tsp)\nmain.tsp / models.tsp"]
    end

    subgraph CoreEngine [2. 인메모리 컴파일 & 인트로스펙션 엔진]
        Compiler["compileTypeSpecInMemory()\nNodeHost + OpenAPI 3.2 Emitter"]
        AST["TypeSpec Program AST & OasDocument"]
        Introspect["TspProjectBuilder.introspect()\n캐시 기반 고속 메타데이터 분석 (<5ms)"]
    end

    subgraph PluginPipeline [3. 플러그인 DAG 및 가상 파일 시스템 (VFS)]
        Sorter["sortPlugins()\nKahn 알고리즘 기반 위상 정렬 & 순환 탐지"]
        Context["TspPluginContext\n가상 파일 맵 / 상대 경로 임포트 해석 / 플러그인 상태 공유"]
        
        P_TS["pluginTypescript\nmodels / enums / guards"]
        P_Client["pluginClient (pluginSdk)\nopenapi-ts 스타일 SDK"]
        P_Query["pluginTanstackQuery\nKeys / Options / Hooks"]
        P_Router["pluginRouter\nContracts / Hono / Express / Fastify / Elysia"]
        P_Wire["pluginWire\nProtobuf / MessagePack / RPC"]
    end

    subgraph OutputTargets [4. 출력 대상 및 런타임 연동]
        DiskOut["디스크 파일 출력 (Disk Emission)\ntypes.ts, client.ts, queries.ts, router.ts"]
        ViteDev["Vite 개발 서버 (vitePluginTsp)\n파일 감시 (watch) & 브라우저 HMR full-reload"]
    end

    TSP --> Compiler
    Compiler --> AST
    AST --> Introspect
    AST --> Sorter
    Sorter --> Context
    Context --> P_TS
    P_TS --> P_Client
    P_Client --> P_Query
    P_TS --> P_Router
    P_TS --> P_Wire
    Context --> DiskOut
    Context --> ViteDev
```

### 1.2 핵심 설계 원칙 (Core Architectural Invariants)

1. **Zero-Disk In-Memory SSOT**:
   중간 `.yaml` 또는 `.json` 파일을 디스크에 기록하지 않고 메모리 상에서 직접 TypeSpec AST를 컴파일하고 `OasDocument`를 추출합니다. 컴파일 결과는 `oldProgram` 캐시로 보존되어 변경이 없을 시 0ms에 가깝게 인트로스펙션을 반환합니다.
2. **Kahn 위상 정렬 기반 플러그인 DAG**:
   플러그인은 자신의 `dependencies`(`['typescript']`, `['typescript', 'client']`)를 선언하며, 빌더는 Kahn 알고리즘으로 실행 순서를 보장합니다. 상호 순환 참조(`A -> B -> A`)가 발생하면 `TspPluginCycleError`를 발생시켜 빌드를 안전하게 차단합니다.
3. **가상 파일 시스템(VFS) 격리 및 상대 경로 임포트 자동 해석**:
   모든 플러그인은 `context.addFile()`을 통해 메모리 상의 `TspGeneratedFile`로 아티팩트를 등록합니다. `context.resolveImport(fromFile, targetFile)`는 두 가상 파일 간의 정확한 상대 ESM 경로(예: `./types.js`)를 계산하므로, 사용자가 수동으로 파일 경로를 조합할 필요가 없습니다.
4. **openapi-ts 규격 호출 인터페이스**:
   개별 인자 나열 방식 대신 단일 파라미터 객체 `{ path, query, body, headers }` 패턴을 적용하고, 반환값을 `{ data, error, response }` Discriminated Union으로 정의하여 런타임 `isErrorStatus()` 가드와 함께 컴파일 타임 에러 타입 축소를 보장합니다.

---

## 2. 프로그래머블 빌더 API 명세 (Builder API Reference)

빌더 플랫폼의 핵심 진입점은 `createTspBuilder` 팩토리 함수와 `TspProjectBuilder` 클래스입니다.

### 2.1 `createTspBuilder` 및 `TspProjectBuilder`

```typescript
import { createTspBuilder, defineTspConfig } from '@oa-sdk/codegen';

// 1. 단일 .tsp 파일 또는 디렉터리 경로로 초기화
const builder = createTspBuilder('./api/main.tsp', {
  openApiVersion: '3.2.0',
  cwd: process.cwd(),
});

// 2. 또는 완전한 TspConfig 객체로 초기화
const configuredBuilder = createTspBuilder(
  defineTspConfig({
    input: './api/main.tsp',
    output: './src/generated',
    openApiVersion: '3.2.0',
  }),
);
```

#### 메서드 시그니처 상세

| 메서드 | 시그니처 | 설명 |
|---|---|---|
| `use(plugin)` | `use(plugin: TspPluginEntry): this` | 플러그인을 파이프라인에 체이닝 등록합니다. 메서드 체이닝(`builder.use(...).use(...)`)을 지원합니다. |
| `introspect(forceFresh?)` | `introspect(forceFresh?: boolean): Promise<TspIntrospectionReport>` | TypeSpec을 인메모리 컴파일하고 엔드포인트, 모델, 제약조건, 파라미터 메타데이터 리포트를 반환합니다. 결과는 캐시됩니다. |
| `getOperations()` | `getOperations(): Promise<readonly TspIntrospectedOperation[]>` | 스펙에 정의된 모든 HTTP 오퍼레이션 목록을 반환합니다. |
| `getModels()` | `getModels(): Promise<readonly TspIntrospectedModel[]>` | 스펙에 정의된 모든 스키마 모델 목록 및 필드 제약조건을 반환합니다. |
| `getOperation(idOrPath)` | `getOperation(idOrPath: string): Promise<TspIntrospectedOperation \| undefined>` | operationId 또는 URL 경로로 특정 오퍼레이션을 조회합니다. |
| `getModel(name)` | `getModel(name: string): Promise<TspIntrospectedModel \| undefined>` | 모델명으로 특정 데이터 모델을 조회합니다. |
| `build(overrideConfig?)` | `build(overrideConfig?: Partial<TspConfig>): Promise<TspPipelineResult>` | 등록된 모든 플러그인을 위상 정렬 순서로 실행하고 산출물을 생성합니다. |
| `watch(listener, options?)` | `watch(listener: (event: TspWatchEvent) => void, options?: TspWatchOptions): TspWatcherHandle` | `.tsp` 파일 변경을 감시하여 캐시 무효화 및 자동 리빌드를 수행합니다. |
| `getConfig()` | `getConfig(): TspConfig` | 정규화 및 검증된 빌더 설정을 반환합니다. |

### 2.2 인트로스펙션 데이터 모델 (`TspIntrospectionReport`)

`builder.introspect()`는 외부 코드 생성기, 문서 생성 도구, 테스트 러너에서 즉시 소비할 수 있는 표준화된 메타데이터 객체를 제공합니다.

```typescript
const report = await builder.introspect();

console.log(`API 타이틀: ${report.title} (${report.version})`);
console.log(`라우트 수: ${report.routesCount}`);
console.log(`참조 파일: ${report.sourceFiles.join(', ')}`);

for (const op of report.operations) {
  console.log(`[${op.method}] ${op.path} (ID: ${op.id})`);
  console.log(`- 통신 포맷: ${op.wireFormat}`); // 'json' | 'protobuf' | 'msgpack'
  console.log(`- 에러 상태 맵:`, op.errorStatusMap); // { '404': 'NotFoundError', '400': 'ValidationError' }
}

for (const model of report.models) {
  console.log(`모델: ${model.name}`);
  for (const prop of model.properties) {
    console.log(`  - ${prop.name}: ${prop.type} (필수: ${prop.required})`);
    if (prop.constraints?.minimum !== undefined) {
      console.log(`    제약조건: min=${prop.constraints.minimum}`);
    }
  }
}
```

### 2.3 플러그인 인터페이스 및 라이프사이클 (`TspPlugin`)

커스텀 플러그인을 제작할 때는 `TspPlugin` 인터페이스를 구현합니다:

```typescript
import type { TspPlugin, TspPluginContext } from '@oa-sdk/codegen';

export function myCustomPlugin(): TspPlugin {
  return {
    name: 'my-custom-plugin',
    dependencies: ['typescript'], // pluginTypescript가 먼저 실행되어야 함
    enforce: 'post', // 'pre' | 'post' (선택 사항)

    setup(context: TspPluginContext) {
      context.log('info', '초기화 단계 실행');
    },

    transform(context: TspPluginContext) {
      // 컴파일된 context.document (OpenAPI 3.2) 수정 또는 어노테이션 추가
    },

    generate(context: TspPluginContext) {
      // 가상 파일 생성 및 VFS 등록
      const typesImport = context.resolveImport('custom-helper.ts', 'types.ts');
      
      context.addFile({
        path: 'custom-helper.ts',
        content: `import type * as Types from '${typesImport}';\n\nexport const helperVersion = '1.0.0';\n`,
        sourcePlugin: 'my-custom-plugin',
        kind: 'helper',
        exports: ['helperVersion'],
      });
    },

    emit(context: TspPluginContext) {
      // 최종 번들링 또는 포맷팅 단계
    },
  };
}
```

---

## 3. openapi-ts 스타일 클라이언트 SDK 컨벤션 (Client SDK Conventions)

`pluginClient`는 현대 웹 번들러 환경과 TypeScript 개발자 경험에 최적화된 **openapi-ts(Hey API)** 호출 규격을 준수합니다.

### 3.1 단일 객체 파라미터 호출 규격 (`RequestParameters`)

기존의 복잡한 다중 인자 나열(`client.getPetById(id, tag, headers, abortSignal)`) 대신, 단일 객체 인자로 경로, 쿼리, 본문, 헤더를 명확하게 전달합니다:

```typescript
// 생성된 RequestParameters 기반 인터페이스
export interface GetPetByIdData {
  path: { petId: number };
  query?: { verbose?: boolean };
  headers?: { 'X-Trace-Id'?: string };
}

// 1. 트리셰이킹 가능한 독립 함수 호출
import { getPetById } from './src/generated/client.js';

const res = await getPetById({
  path: { petId: 42 },
  query: { verbose: true },
});
```

### 3.2 `{ data, error, response }` Discriminated Union 반환 구조

`ClientResult<TData, TError>`는 성공과 실패 상태가 타입 레벨에서 배타적으로 좁혀지는 Discriminated Union입니다:

```typescript
export type ClientResult<TData = unknown, TError = unknown> =
  | {
      data: TData;
      error: undefined;
      response: Response;
    }
  | {
      data: undefined;
      error: TError;
      response: Response;
    };
```

#### 소비 예시 (안전한 타입 좁힘)

```typescript
const result = await getPetById({ path: { petId: 101 } });

if (result.error === undefined) {
  // result.data는 엄격하게 Pet 타입으로 보장됩니다.
  console.log(`반환된 펫: ${result.data.name}, 상태: ${result.data.status}`);
} else {
  // result.data는 undefined이며, result.error는 에러 페이로드입니다.
  console.error(`요청 실패 (HTTP ${result.response.status}):`, result.error);
}
```

### 3.3 HTTP 상태 코드별 에러 타입 축소 (`isErrorStatus` & `ErrorUnion`)

스펙에 정의된 4xx/5xx 상태 코드별 모델을 세부적으로 구별할 수 있도록 `ErrorUnion`과 `isErrorStatus()` 타입 가드를 제공합니다:

```typescript
import { getPetById, isErrorStatus } from './src/generated/client.js';

const res = await getPetById({ path: { petId: 999 } });

if (res.error !== undefined) {
  if (isErrorStatus(res, 404)) {
    // res.response.status === 404가 타입 레벨에서 증명됩니다.
    // 404 NotFound 전용 UI 처리
    console.warn('해당 펫을 찾을 수 없습니다.');
  } else if (isErrorStatus(res, 400)) {
    // 400 Validation Error 처리
    console.error('잘못된 요청 인자입니다:', res.error);
  } else {
    // 기타 HTTP 오류
    console.error(`서버 에러 (${res.response.status}):`, res.error);
  }
}
```

### 3.4 트리셰이킹 독립 함수와 `Client` 클래스 듀얼 익스포트

`pluginClient`는 번들러 최적화를 위해 두 가지 사용 모드를 모두 제공합니다:

1. **독립 함수 (`standalone: true`)**: 사용한 엔드포인트 함수만 번들에 포함되므로 마이크로 프론트엔드나 번들 크기에 민감한 환경에 이상적입니다.
2. **중앙 `Client` 인스턴스 (`clientClass: true`)**: 인증 토큰 인터셉터, 기본 헤더, 베이스 URL을 단일 위치에서 관리할 수 있습니다.

```typescript
import { createClient, setClientToken } from './src/generated/client.js';

// 중앙 클라이언트 인스턴스 구성
const client = createClient({
  baseUrl: 'https://api.petstore.example.com/v1',
  headers: {
    'Accept-Language': 'ko-KR',
  },
});

// 클라이언트를 명시적으로 전달하여 호출
const res = await getPetById({
  client,
  path: { petId: 10 },
});
```

---

## 4. 다중 타겟 플러그인 매트릭스 (Multi-Target Plugin Matrix)

TypeSpec 빌더 플랫폼은 프론트엔드부터 백엔드까지 필요한 모든 계층의 산출물을 생성할 수 있는 5대 공식 플러그인을 제공합니다.

| 플러그인 명칭 | 의존성 | 기본 산출물 | 핵심 기능 |
|---|---|---|---|
| `pluginTypescript` | 없음 | `types.ts`, `guards.ts` | 순수 TypeScript 모델, Enum(union/ts/js), JSDoc 보존, Standalone Zero-Eval 타입 가드 |
| `pluginClient` (`pluginSdk`) | `typescript` | `client.ts` | openapi-ts 규격 Fetch/Axios SDK, 단일 객체 파라미터, Discriminated Union 반환 |
| `pluginTanstackQuery` | `typescript`, `client` | `queries.ts` (또는 split 3파일) | TanStack Query v5 3계층 (Keys, Options, React Hooks), 무한 스크롤 쿼리 지원 |
| `pluginRouter` | `typescript` | `api.contract.ts`, `router.ts` | 순수 TypeScript 핸들러 계약(`ApiHandlers`), Hono/Express/Fastify/Elysia 바인딩, 충돌 방지 휴리스틱 |
| `pluginWire` | `typescript` | `wire.ts`, `schema.proto` | Zero-eval CSP 준수 Protobuf/MessagePack 코덱, proto3 스키마 내보내기, 바이너리 협상 어댑터 |

---

### 4.1 `pluginTypescript` 상세

```typescript
import { pluginTypescript } from '@oa-sdk/codegen';

builder.use(
  pluginTypescript({
    output: 'types.ts',
    enums: 'union',            // 'union' | 'typescript' | 'javascript'
    typeGuards: true,          // Zero-eval 런타임 타입 가드 생성 (guards.ts)
    guardsOutput: 'guards.ts',
    comments: true,            // TypeSpec @doc 주석을 JSDoc으로 변환
    style: 'type',             // 'type' | 'interface'
  }),
);
```

- **Standalone 타입 가드**: `typeGuards: true`를 지정하면 외부 의존성(Zod/Typia 등)이 전혀 없는 순수 TypeScript 함수(예: `isPet(v: unknown): v is Pet`)를 생성합니다.

### 4.2 `pluginClient` (`pluginSdk`) 상세

```typescript
import { pluginClient } from '@oa-sdk/codegen';

builder.use(
  pluginClient({
    output: 'client.ts',
    httpClient: 'fetch',       // 'fetch' | 'axios'
    baseUrl: 'https://api.example.com',
    standalone: true,          // 트리셰이킹 가능한 개별 함수 생성
    clientClass: true,         // Client 클래스 및 createClient 생성
    clientName: 'ApiClient',
  }),
);
```

### 4.3 `pluginTanstackQuery` 상세 (3-Tier Architecture)

TanStack Query v5 어댑터는 관심사 분리를 위해 3단계 계층 구조를 지원합니다:

```typescript
import { pluginTanstackQuery } from '@oa-sdk/codegen';

builder.use(
  pluginTanstackQuery({
    output: 'queries.ts',
    tier: 'all',               // 'all' | 'keys' | 'options' | 'hooks'
    split: true,               // keys.ts, queries.ts, hooks.ts 3개 파일로 분할
    keysOutput: 'keys.ts',
    optionsOutput: 'queries.ts',
    hooksOutput: 'hooks.ts',
    queryPackage: '@tanstack/react-query',
    includeHooks: true,        // React 컴포넌트 훅 (use*Query) 포함
  }),
);
```

#### 계층별 생성물 및 사용법

1. **Tier 1 (Query Keys)**:
   ```typescript
   import { petstoreKeys } from './src/generated/keys.js';
   // 쿼리 무효화(Invalidation)에 최적화된 튜플 키 반환
   queryClient.invalidateQueries({ queryKey: petstoreKeys.pet.all() });
   ```
2. **Tier 2 (Query Options)**:
   ```typescript
   import { getPetByIdQueryOptions } from './src/generated/queries.js';
   // 프레임워크 비종속 Prefetching 및 라우터 로더 연동
   await queryClient.prefetchQuery(getPetByIdQueryOptions({ path: { petId: 1 } }));
   ```
3. **Tier 3 (React Hooks)**:
   ```typescript
   import { useGetPetByIdQuery } from './src/generated/hooks.js';

   function PetProfile({ id }: { id: number }) {
     const { data, isLoading, error } = useGetPetByIdQuery({ path: { petId: id } });
     if (isLoading) return <div>로딩 중...</div>;
     return <h1>{data?.name}</h1>;
   }
   ```

### 4.4 `pluginRouter` 상세 (백엔드 핸들러 계약 & 라우터 바인딩)

```typescript
import { pluginRouter } from '@oa-sdk/codegen';

builder.use(
  pluginRouter({
    contractOutput: 'api.contract.ts',
    output: 'router.ts',
    target: 'hono',            // 'hono' | 'express' | 'fastify' | 'elysia'
    mode: 'contract',          // 'contract' (순수 계약 + 라우터) | 'stub' (목업 스텁)
    contractName: 'ApiHandlers',
    contextInjection: true,    // Hono/Express 등의 Context 객체 주입 활성화
    contextTypeName: 'AppContext',
    contextImport: './context.js',
  }),
);
```

#### 프레임워크 런타임 비종속 순수 핸들러 계약 (`api.contract.ts`)

`HandlerResponse<TSuccess, TErrorMap, THeaders>` 유니온 타입을 기반으로 작성되어, 백엔드 비즈니스 로직이 특정 웹 프레임워크에 종속되지 않습니다:

```typescript
// 순수 비즈니스 로직 구현체
export const handlers: ApiHandlers = {
  async getPetById({ params }) {
    const pet = await db.pets.findById(params.petId);
    if (!pet) {
      return { status: 404, body: { message: '펫이 존재하지 않습니다.' } };
    }
    return { status: 200, body: pet };
  },
};
```

- **3중 응답 엔벨로프 충돌 방지 휴리스틱**: 핸들러의 반환값이 순수 모델 DTO인지 또는 `{ status, body, headers }` 엔벨로프 객체인지 정밀하게 판별하여 직렬화 충돌을 방지합니다.

### 4.5 `pluginWire` 상세 (Zero-Eval 바이너리 코덱 바인딩)

```typescript
import { pluginWire } from '@oa-sdk/codegen';

builder.use(
  pluginWire({
    output: 'wire.ts',
    codecs: ['protobuf', 'msgpack', 'proto3', 'rpc-contract'],
    proto3Output: 'schema.proto',
    zeroEval: true,            // Manifest V3 및 CSP strict 환경을 위한 zero-eval 보장
  }),
);
```

#### 바이너리 RPC 클라이언트 (`rpc-contract`)

`rpc-contract` codec은 서비스별 `<Service>ServerHandlers` 인터페이스와 `<Service>RpcClient`를 만든다.
서비스와 메서드 이름은 `@rpc(#{ serviceName, methodName })`, 없으면 첫 tag와 operationId에서 온다.
클라이언트는 선언된 route를 path·query·header·cookie 파라미터로 채우고, body와 응답은 선언된 media type에
맞춰 처리한다. JSON은 그대로 직렬화하고, Protobuf·MessagePack 메시지는 model 이름으로 찾은 codec으로
인코딩·디코딩한다. 요청 메시지의 codec이 없으면 요청을 보내지 않고 실패하고, 응답 메시지의 codec이 없으면
`TypeError`로 reject된다. 2xx가 아닌 응답은 `status`와 디코딩한 `body`를
가진 `WireRpcError`로 reject된다.

```typescript
import { getGeneratedProtobufCodecs, OrderServiceRpcClient, WireRpcError } from './src/generated/wire.js';

const orders = new OrderServiceRpcClient({
  baseUrl: 'https://api.example.com',
  codecs: getGeneratedProtobufCodecs(), // model 이름 → codec. 여러 map을 배열로 넘길 수 있다
});

// body가 있으면 (request, params, options), 없으면 (params, options)
const order = await orders.getOrder({ orderId: 'o-1', expand: ['items'] });
await orders.createOrder({ id: 'draft', amount: 7 });
```

서버 핸들러는 `(request, context, params)`를 받으며, 파라미터가 없는 메서드는 `params` 인자가 없다.
JSON 계약을 dotted-name procedure로 호출하거나 JSON-RPC 2.0으로 제공하려면 `pluginRpc`와
[`@oa-sdk/rpc`](../../packages/rpc/README.md)를 사용한다. 두 경로의 비교, Protobuf 타입 매핑과 한계는
[TypeSpec 계약을 RPC로 쓰기](./typespec-rpc.md)에 정리되어 있다.

#### 동적 미디어 타입 협상 헬퍼

```typescript
import { resolveBinaryCodec } from './src/generated/wire.js';

// HTTP 헤더의 Content-Type에 맞춰 알맞은 코덱을 자동 조회
const codec = resolveBinaryCodec('application/x-protobuf', 'TelemetryData');
if (codec) {
  const binaryPayload = codec.encode(data);
  const decodedData = codec.decode(binaryPayload);
}
```

---

## 5. Vite 개발 루프 통합 (`vitePluginTsp`)

TypeSpec 빌더 플랫폼은 Vite 개발 서버 및 빌드 파이프라인과 완벽하게 통합되는 `vitePluginTsp` 플러그인을 제공합니다.

### 5.1 `vite.config.ts` 설정

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  vitePluginTsp,
  pluginTypescript,
  pluginClient,
  pluginTanstackQuery,
} from '@oa-sdk/codegen';

export default defineConfig({
  plugins: [
    react(),
    vitePluginTsp({
      config: {
        input: './api/main.tsp',
        output: './src/generated',
        plugins: [
          pluginTypescript(),
          pluginClient(),
          pluginTanstackQuery(),
        ],
      },
      runOnDev: true,          // 개발 서버 기동 시 초기 코드 생성 실행
      runOnBuild: true,        // 프로덕션 vite build 시 최신 코드 생성 보장
      watch: true,             // .tsp 파일 실시간 감시 활성화
      debounceMs: 150,         // 파일 변경 감지 디바운스 밀리초 (기본값: 150)
      onBuildSuccess(result) {
        console.log(`[oa-sdk:tsp] 생성 완료: ${result.files.length}개 파일`);
      },
    }),
  ],
});
```

### 5.2 개발 서버 핫 리로드 라이프사이클 (HMR Dev Loop)

```mermaid
sequenceDiagram
    participant Dev as 개발자 (VS Code / IDE)
    participant FS as 파일 시스템 (.tsp)
    participant VitePlugin as vitePluginTsp
    participant Builder as TspProjectBuilder
    participant ViteServer as Vite Dev Server (HMR)
    participant Browser as 브라우저 (React App)

    Dev->>FS: models.tsp 파일 수정 및 저장
    FS-->>VitePlugin: fs.watch 이벤트 발생 (debounced 150ms)
    VitePlugin->>Builder: builder.build() 트리거
    Builder->>Builder: 인메모리 재컴파일 및 VFS 파일 갱신
    Builder-->>VitePlugin: 빌드 성공 이벤트 (TspPipelineResult)
    VitePlugin->>ViteServer: server.ws.send({ type: 'full-reload' })
    ViteServer-->>Browser: WebSocket full-reload 신호 전송
    Browser->>Browser: 갱신된 TypeScript 타입 및 SDK 기반 자동 리프레시!
```

- 개발 서버가 종료되거나 번들이 닫힐 때(`closeBundle`), 내부의 `watcherHandle.unwatch()`가 호출되어 파일 디스크립터 누수 없이 깔끔하게 종료됩니다.

---

## 6. 5분 빠른 시작 (5-Minute Quickstart)

TypeSpec 스펙 작성부터 클라이언트 호출까지 5분 만에 구축하는 엔드-투-엔드 튜토리얼입니다.

### 1단계: TypeSpec 스펙 작성 (`api/main.tsp`)

```typespec
import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@service(#{ title: "Petstore Service", version: "1.0.0" })
namespace Petstore;

model Pet {
  id: int32;
  name: string;
  tag?: string;
}

model PetError {
  code: int32;
  message: string;
}

@route("/pets")
namespace Pets {
  @get op listPets(): Pet[];

  @get op getPetById(@path petId: int32): Pet | PetError;

  @post op createPet(@body pet: Pet): {
    @statusCode statusCode: 201;
    @body body: Pet;
  };
}
```

### 2단계: 빌드 스크립트 작성 (`scripts/build-api.ts`)

```typescript
import {
  createTspBuilder,
  pluginTypescript,
  pluginClient,
  pluginTanstackQuery,
  pluginRouter,
} from '@oa-sdk/codegen';

async function main() {
  const builder = createTspBuilder('./api/main.tsp', {
    openApiVersion: '3.2.0',
  });

  builder
    .use(pluginTypescript({ output: 'types.ts', typeGuards: true }))
    .use(pluginClient({ output: 'client.ts' }))
    .use(pluginTanstackQuery({ output: 'queries.ts' }))
    .use(pluginRouter({ target: 'hono', output: 'router.ts' }));

  const result = await builder.build({
    output: './src/generated',
    clean: true,
  });

  console.log(`성공적으로 생성된 파일 (${result.files.length}개):`);
  for (const f of result.files) {
    console.log(`- ${f.path} (작성자: ${f.sourcePlugin})`);
  }
}

main().catch(console.error);
```

### 3단계: 빌드 실행 및 클라이언트 코드 소비

빌드 실행 후 프론트엔드 코드에서 즉시 임포트하여 사용합니다:

```typescript
import { listPets, createPet } from './src/generated/client.js';

// 1. 목록 조회
const listRes = await listPets({});
if (listRes.data) {
  console.log('펫 목록:', listRes.data);
}

// 2. 신규 생성
const createRes = await createPet({
  body: { id: 1, name: '초코', tag: 'dog' },
});
if (createRes.data) {
  console.log('생성 완료:', createRes.data.name);
}
```

---

## 7. 기존 워크플로우에서의 마이그레이션 안내 (Migration Guide)

기존의 파편화된 코드 생성 방식에서 TypeSpec 빌더 플랫폼으로 전환하는 절차입니다.

### 7.1 레거시 CLI 방식 vs 빌더 플랫폼 비교

| 항목 | 레거시 CLI 워크플로우 | TypeSpec 빌더 플랫폼 |
|---|---|---|
| **스펙 컴파일** | `tsp compile`로 디스크에 `openapi.yaml` 기록 필요 | `compileTypeSpecInMemory`로 0-disk 인메모리 컴파일 |
| **코드 생성 파이프라인** | `oa-gen typegen`, `generate:client`, `generate:tanstack`을 순차 셸 스크립트로 호출 | 단일 `builder.build()` 파이프라인 내 위상 정렬 일괄 생성 |
| **타입 동기화** | 파일 생성 시점마다 상대 경로 import 깨짐 발생 가능 | `context.resolveImport()`를 통한 VFS 자동 경로 정규화 |
| **HMR 개발 루프** | nodemon 등으로 CLI 전체 프로세스 재시작 필요 | `vitePluginTsp`의 인메모리 캐시 재사용 및 브라우저 full-reload |
| **인터페이스 컨벤션** | 다중 인자 전달 및 예외 try/catch 의존 | `{ path, query, body }` 단일 인자 및 `{ data, error }` 유니온 |

### 7.2 마이그레이션 단계별 가이드

1. **빌드 스크립트 단일화**:
   기존 `package.json`의 연속된 CLI 생성 스크립트를 `createTspBuilder` 기반 단일 빌드 함수로 통합합니다.
2. **클라이언트 호출부 마이그레이션**:
   - 기존: `await client.getPetById(petId)`
   - 변경: `await getPetById({ path: { petId } })` (트리셰이킹 함수 활용)
3. **에러 핸들링 패턴 개선**:
   - 기존: `try { ... } catch (err) { ... }`
   - 변경: `if (res.error) { if (isErrorStatus(res, 404)) { ... } }`
4. **Vite 플러그인 등록**:
   - `vite.config.ts`에 `vitePluginTsp`를 등록하여 스펙 파일 수정 시 별도의 빌드 명령 없이 브라우저에서 최신 API 계약이 즉시 반영되도록 구성합니다.

---

## 8. 관련 문서 및 레퍼런스 (Related References)

- [가이드 색인 및 아키텍처 지도](./README.md)
- [시작하기 (Quick Start)](./quick-start.md)
- [CLI 설정 및 명령어 체계](./cli-setup.md)
- [CLI 전체 명령어 레퍼런스](./cli-command-reference.md)
- [TypeSpec 작성 규칙 (SSOT)](./typespec-authoring-conventions.md)
- [클라이언트 및 TanStack Query 소비 가이드](./client-and-query-consumption.md)
- [백엔드 핸들러 계약 및 멀티 프레임워크 라우터 가이드](./backend-handler-contracts.md)
- [Mock 서버 개발 가이드](./mock-server-usage.md)
- [선언적 스펙 설정 (oa.config.ts)](./declarative-spec-configuration.md)
- [@oa-sdk/codegen 패키지 안내](../../packages/codegen/README.md)
