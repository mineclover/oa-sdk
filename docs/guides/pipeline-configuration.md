# 용도별 파이프라인 구성

API 엔드포인트, 데이터 구조, 소비자 인터페이스는 서로 다른 목표다. **출력과 용도는 분리하고,
스키마 검증·타입 이름·가드 엔진·실패 처리는 공유**한다. 이 문서는 checkout의 신규 구현 기준이며
npm 배포 완료를 뜻하지 않는다.

## 1. 용도 선택

`PipelinePurpose`는 `api | data | interface`다. TypeSpec 플러그인 설정의 `purpose`와
`oa.config.ts`의 `specs[].purpose`가 같은 입력 검사 규칙을 사용한다.

| 용도 | 입력과 경계 | 출력 구성 |
| --- | --- | --- |
| `api` | 최소 한 개의 HTTP operation 필요 | 타입·핸들러·라우터·SDK 등 필요한 플러그인을 명시 |
| `data` | 모델 필요, HTTP operation 금지 | 타입·가드·데이터 코덱. client/router/query/RPC 플러그인은 거부하고 CLI의 HTTP companion 출력도 제외 |
| `interface` | 모델 또는 operation 필요 | 소비자 타입·핸들러·SDK·RPC 중 필요한 출력만 명시 |
| 미지정 | 기존 혼합 파이프라인 동작 유지 | 기존 설정 호환용. 신규 구성은 용도를 명시하는 것을 권장 |

용도는 새 원본을 만드는 기능이 아니다. API 계약의 원본은 `.tsp`, 수기 작성한 TypeScript public
interface의 원본은 해당 `.ts`다. Type Registry 검증을 codegen으로 대체하지 않는다.
커스텀 플러그인은 선택적으로 `purposes`를 선언할 수 있다. 생략한 커스텀 플러그인의 용도 적합성과
직접 수행하는 파일 쓰기·외부 부작용은 작성자 책임이다.

## 2. 공통 구성 API

설정 방식에 따라 진입점은 다르지만, `purpose`의 의미는 같다. **구성 → 입력 검사 → 생성 → 출력**
순서로 실행하며 용도마다 새 실행 엔진을 만들지 않는다.

| 역할 | API | 설정 위치 |
| --- | --- | --- |
| TypeSpec 플러그인 구성 | `defineTspConfig` from `@oa-sdk/codegen/plugin` | `TspConfig.purpose` |
| 재사용 가능한 빌더 | `createTspBuilder(config)` | 위 TypeSpec 설정을 그대로 전달 |
| 단일 실행 | `runTspPluginPipeline(config)` | 위 TypeSpec 설정을 그대로 전달 |
| Vite 연동 | `vitePluginTsp({ config })` | 위 TypeSpec 설정을 그대로 전달 |
| CLI 대상 구성 | `defineConfig` from `@oa-sdk/codegen` | `specs[].purpose` 또는 `product.specs[].purpose` |

`@oa-sdk/codegen/plugin`에도 `defineConfig` 별칭이 있지만, 이 가이드에서는 CLI 설정과 혼동하지
않도록 TypeSpec 설정에 `defineTspConfig`라는 이름을 사용한다.

## 3. TypeSpec 용도별 구성

다음 예시는 같은 API로 세 용도를 구성하되 출력 디렉터리를 분리한다. 공통 import는 다음과 같다.

```typescript
import {
  createTspBuilder,
  defineTspConfig,
  pluginRouter,
  pluginTypescript,
  runTspPluginPipeline,
  vitePluginTsp,
} from '@oa-sdk/codegen/plugin'
```

### 3.1 API 엔드포인트

```typescript
export const apiPipeline = defineTspConfig({
  purpose: 'api',
  input: './api/main.tsp',
  output: './src/generated/api',
  plugins: [pluginTypescript(), pluginRouter({ target: 'hono' })],
})
```

HTTP operation이 있는 원본에서 타입·핸들러 계약·Hono 라우터를 만든다. 라우터 생성에는
동반 패키지 `@oa-sdk/router`가 필요하며, 실제 서버 실행과 비즈니스 구현은 이 빌드에 포함하지 않는다.

### 3.2 데이터 구조

```typescript
export const dataPipeline = defineTspConfig({
  purpose: 'data',
  input: './models/main.tsp',
  output: './src/generated/data',
  plugins: [pluginTypescript({ typeGuards: true })],
})
```

HTTP operation 없이 타입·가드를 만든다. CLI/`TspConfig` 플러그인의 `.tsp` 로더는 OpenAPI emitter 기본 동작을 사용하므로 모델 전용 파일에도 `@service`가 필요하다(이는 HTTP operation을 선언하라는 뜻이 아니다). 반면 프로그래밍 방식의 `@oa-sdk/codegen/typespec` `compileTypeSpecToJsonSchemas()`는 `omitUnreachableTypes: false`로 동작하므로 `@service`·`@route` 없는 순수 데이터 모델 `.tsp`에서도 Draft 2020-12 JSON Schema, named `alias` 보존 `.d.ts`, 독립형 가드를 직접 생성할 수 있다([순수 타입과 가드](./pure-types-and-guards.md#33-프로그래밍-api-oa-sdkcodegentypespec-oa-sdkcodegenguards--zod-free)).

```typespec
@service
namespace Events;

model Event {
  id: string;
  @minValue(0) sequence: int32;
}
```

`data`/`interface` 모드(`TspConfig`)에서 모델·operation이 모두 비면 오류로 처리한다. `@service` 누락으로
모델이 방출되지 않았는데 빈 타입 파일을 정상 결과로 취급하지 않는다. (`@service` 없는 순수 데이터 모델 컴파일에는 `compileTypeSpecToJsonSchemas()`를 사용한다.)

### 3.3 소비자 인터페이스

```typescript
export const interfacePipeline = defineTspConfig({
  purpose: 'interface',
  input: './api/main.tsp',
  output: './src/generated/interfaces',
  plugins: [pluginTypescript({ style: 'interface' })],
})
```

같은 API 원본에서 소비자용 타입만 별도 출력한다. 호출 계약도 필요하면 `pluginClient()`나
`pluginRpc()` 등을 명시한다. RPC contract 생성과 runtime 배포 경계는
[TypeSpec 계약 RPC](./typespec-rpc.md)를 따른다. 수기 `.ts` interface의 관리는
[Type Registry](../internal/type-registry-governance.md) 경로로 유지한다.

### 3.4 실행 경로 선택

앞에서 정의한 설정을 그대로 전달한다. 아래 세 방법 중 프로젝트에 맞는 경로를 선택하며,
예시를 모두 실행해 같은 출력을 중복 생성할 필요는 없다.

```typescript
// 빌더를 사용하는 경우
const result = await createTspBuilder(dataPipeline).build()
if (!result.success) {
  throw new Error(result.diagnostics.map(d => d.message).join('\n'))
}

// 단일 실행을 사용하는 경우
// const result = await runTspPluginPipeline(dataPipeline)

// Vite를 사용하는 경우
// const vitePlugin = vitePluginTsp({ config: dataPipeline })
```

`apiPipeline`과 `interfacePipeline`도 같은 방식으로 전달한다. `clean`의 기본값은 `true`이므로
수기 코드나 다른 빌드의 출력을 같은 디렉터리에 두지 않는다.

## 4. CLI target 구성

```typescript
import { defineConfig } from '@oa-sdk/codegen'

export default defineConfig({
  specs: [{
    id: 'events',
    purpose: 'data',
    profile: 'component-bundle',
    schemaEntry: './models/main.tsp',
    outDir: './generated/data',
  }],
  guards: { outDir: './generated/data/guards', auditCsp: true },
})
```

`oa-gen generate`는 이 data target에 대해 OpenAPI/JSON Schema와 설정한 가드를 생성하지만
handler/client/query/CRDT HTTP 출력이나 그 companion 패키지는 불러오지 않는다.
가드 선언용 `types.d.ts`도 함께 생성하므로 별도 미정의 타입을 참조하지 않는다.
`oa-gen validate`도 동일한 용도 규칙을 적용하며, 저장된 artifact가 있어도 검사를 생략하지 않는다.

여러 spec을 하나의 guard target으로 묶을 때, 같은 이름의 서로 다른 스키마는 출력 전에 실패한다.
상이한 `User` 계약을 합치지 말고 별도 설정·출력 디렉터리로 나눈다. 완전히 동일한 정의는 중복 제거한다.

## 5. 생성물과 타입 연결

- CLI·설정 기반 가드와 `pluginTypescript({ typeGuards: true })`는 같은 Ajv standalone 엔진을 사용한다.
- 생성된 `is<Name>` 가드는 검증 실패 시 `is<Name>.errors`(`StandaloneGuardError[] | null`)를 채우고 성공 시 `null`로 초기화한다. `includeAssertions: true`를 지정하면 `validate<Name>`(`{ valid, data, errors }`)과 `assert<Name>`(`TypeError` throw) 헬퍼·`.d.ts` 선언도 함께 생성된다.
- 프로그래밍 방식의 `writePackageJson` 옵션(기본 `'auto'`)은 상위 디렉터리 체인에 이미 `"type": "module"` `package.json`이 있는 경우(`hasAncestorModulePackage`) 가드 디렉터리 내 중복 `{ "type": "module" }` `package.json` 생성을 건너뛴다.
- `Domain.User` 같은 component 이름의 선언은 typegen과 같은 이름 매핑(`DomainUser`)을 사용한다.
- `generate:guards`에서 `--type-import`를 생략하면 `types.d.ts`를 함께 생성한다. 지정하면 외부 타입
  모듈을 사용하며 그 모듈은 typegen과 같은 선언 이름을 export해야 한다.
- 플러그인의 기존 `guards.ts`는 typed wrapper로 유지하고 `guards.runtime.js`와
  `guards.runtime.d.ts`를 함께 생성한다. 소비자 패키지에는 runtime 파일도 포함해야 한다.
- 프로그램 방식의 `generateStandaloneGuards({ ..., dryRun: true })`는 파일·디렉터리·package metadata를
  쓰지 않고 artifact 목록을 반환한다. `typeNames`는 고급 소비자가 선언 이름을 명시적으로 연결할 때 쓴다.
- `typeNames`로 자동 typegen 이름을 바꾸면 해당 선언을 제공하는 `typeImportSpecifier`도 지정한다.
  외부 모듈 없이 자체 `types.d.ts`와 다른 이름을 요청하면 쓰기 전에 실패한다.
- 스키마 이름의 `/`, `~`, `#`, `%`는 JSON Pointer/URI fragment 규칙에 맞게 처리한다. 분할 가드의
  파일명은 정규화 후 충돌·대소문자 충돌을 피하도록 suffix를 배정하며, 기존의 충돌 없는 파일명은 유지한다.
- `$`가 포함된 유효 TypeScript 선언 이름도 플러그인 wrapper와 runtime 양쪽에서 유지한다.

## 6. 실패 처리와 출력 보존

플러그인 오류 진단이 있으면 runner는 `success: false`와 빈 `emittedFiles`를 반환하고 기존 출력을
정리·교체하지 않는다. Vite의 최초 build/dev 실행도 오류 진단을 실패로 처리하고 성공 callback을
호출하지 않는다. 이 보장은 runner가 관리하는 출력에 대한 것이며 커스텀 플러그인의 외부 부작용이나
디스크 I/O 장애 전체에 대한 transaction을 의미하지 않는다.

## 7. 검증과 유지보수 위치

용도별 검증은 다음을 함께 확인한다.

1. API: `.tsp → OpenAPI → endpoint 소비자` compile·요청 검증.
2. 데이터: HTTP 없이 모델이 생성되고 잘못된 값이 모든 가드 경로에서 동일하게 거부되는지 확인.
3. 인터페이스: 생성 타입·가드·consumer를 `skipLibCheck: false`로 함께 compile.
4. 공통: 실패 시 이전 출력 보존, dry-run 무쓰기, 타깃 간 충돌 차단.

| 책임 | 구현 위치 |
| --- | --- |
| 공통 용도 검사 | [pipeline-purpose.ts](../../packages/codegen/src/pipeline-purpose.ts) |
| 플러그인 실행·출력 관리 | [plugin/runner.ts](../../packages/codegen/src/plugin/runner.ts) |
| CLI 대상 투영·충돌 검사 | [spec-projector.ts](../../packages/codegen/src/spec-projector.ts) |
| 가드와 typegen 이름 연결 | [standalone-guards/generator.ts](../../packages/codegen/src/standalone-guards/generator.ts) |
| 공유 standalone 검증 엔진 | [ast-sync guard generator](../../packages/ast-sync/src/guards/generator.ts) |

대표 회귀: `packages/codegen/src/__tests__/pipeline-isolation.test.ts`,
`packages/ast-sync/test/guards-rendering.test.ts`. 상세 빌더 API는
[TypeSpec 빌더 플랫폼](./typespec-builder-platform.md), 원본과 타입 가드 사용은
[순수 타입 가이드](./pure-types-and-guards.md)를 따른다.
