---
docType: reference
sourceLocale: ko
canonical: true
audience:
  competence: competent
productVersions:
  - "@oa-sdk/codegen 0.10.0"
  - "@oa-sdk/core 0.3.1"
  - "@oa-sdk/router 0.2.5"
  - "@oa-sdk/client 0.3.0"
owner: "OA SDK maintainers"
status: active
lastReviewed: "2026-10-19"
sourceOfTruth:
  - packages/codegen/src/config.ts
  - packages/codegen/src/cli/commands/generate.ts
  - packages/codegen/src/cli/lib/config-loader.ts
---

# 선언적 스펙 설정 가이드 (oa.config.ts)

> `@oa-sdk/codegen`을 설치한 프로젝트의 `oa.config.ts` 설정을 설명합니다. 설치와 `oa-gen init`은
> [Quick Start](./quick-start.md) 0단계를 따릅니다. 이 문서는 `@oa-sdk/codegen` 0.10.0 기준입니다.

---

## 1. 개요

`oa.config.ts`는 spec target(원본 파일과 출력 위치), 함께 만들 생성물(타입 가드, 핸들러 계약, 클라이언트,
TanStack Query 코드), 생성물의 출력 경로를 선언합니다. `oa-gen init`이 이 파일을 만들고, 다음 명령이 인자 없이
실행될 때 이 파일을 읽습니다.

| 명령 | 읽는 설정 |
|---|---|
| `oa-gen generate` | spec target, `guards`, `core.contracts`, `core.router`, `core.client`, `product.framework`(라우터 대상), `contextInjection`, `outputRouting` |
| `oa-gen validate` | spec target(`specs` 또는 `product.specs`)과 `profile` |
| `oa-gen check-artifact`, `oa-gen drift:check` | spec target(`specs` 또는 `product.specs`)과 `profile` |
| `oa-gen mock` | spec target이 정확히 하나일 때 그 원본 |

spec target은 최상위 `specs`에 선언하는 것이 기본입니다(`oa-gen init`도 최상위에 씁니다). `product.specs`에만 선언해도 위 명령이 같은 목록과 `profile` 기본값으로 읽습니다.

설정 항목 중 일부는 타입과 검증만 있고 어떤 명령도 읽지 않습니다(2.3절). 이 항목을 바꿔도 생성 결과나 CI 동작은 달라지지 않습니다.

---

## 2. 설정 구조

`OaConfig`는 공유 코어(`core`)와 제품 설정(`product`)으로 나뉩니다. `specs`, `guards`, `framework`, `runtime`,
`outputRouting`, `contextInjection`, `personas`, `security`는 최상위에 써도 되며, `resolveConfigWithDefaults()`가
`product.*`와 합칩니다. 아키타입이 없으면 `microservice` 기본값이 적용됩니다.

### 2.1 명령이 읽는 설정

| 설정 | 기본값 | 효과 |
|---|---|---|
| `specs[]` | - | spec target 목록. 2.4절 |
| `guards` | 없음 | 지정하면 `generate`가 독립형 타입 가드를 만든다. 6.3절 |
| `core.contracts.pureHandlers` | `true` | 핸들러 계약(`<id>.contract.ts`) 생성 여부. `@oa-sdk/router` 필요 |
| `core.contracts.contractName` | `"ApiHandlers"` | 핸들러 계약의 aggregate 인터페이스 이름 |
| `core.contracts.banner` | `true` | 생성 배너 주석 |
| `core.contracts.outDir` | spec `outDir` | 핸들러 계약 출력 디렉터리. `outputRouting`이 있으면 쓰이지 않음 |
| `core.router.target` | 없음 | 라우터(`<id>.router.ts`)의 대상 프레임워크. 없으면 `specs[].target`, 그다음 `product.framework`. `generic`·`nestjs`면 라우터를 만들지 않는다. 2.2절 |
| `core.router.outDir` | spec `outDir` | 라우터 출력 디렉터리. `outputRouting`이 있으면 쓰이지 않음 |
| `core.router.banner` | `core.contracts.banner` | 라우터 생성 배너 주석 |
| `product.framework` | 없음 (`init`이 감지한 대상을 씀) | `core.router.target`과 `specs[].target`이 없을 때의 라우터 대상. 2.2절 |
| `core.client.enabled` | `true` | fetch 클라이언트(`<id>.client.ts`) 생성 여부. `@oa-sdk/client` 필요 |
| `core.client.outDir` | spec `outDir` | 클라이언트 출력 디렉터리. `outputRouting`이 있으면 쓰이지 않음 |
| `core.client.typesImport` | 없음 | 클라이언트가 타입을 가져올 모듈 지정자(그대로 import 문에 들어감) |
| `contextInjection.typeName`, `.importPath` | 없음 | 핸들러 계약의 `TContext` 기본 타입과 그 import 경로. `importPath`는 계약 파일 기준으로 그대로 쓰인다 |
| `outputRouting` | 없음 | 생성물 출력 경로 규칙. 4절 |

`oa-gen generate`는 TanStack Query 코드(`<id>.keys.ts`, `<id>.queries.ts`)도 만듭니다. 이 출력을 끄는 설정은 없고,
`@oa-sdk/client`가 설치되어 있으면 `core.client.enabled: false`여도 생성되어 존재하지 않는 `<id>.client.js`를
import합니다(알려진 결함). HTTP operation이 없는 모델 전용 프로젝트는 `@oa-sdk/client`를 설치하지 않으면 TanStack
출력을 경고와 함께 건너뜁니다.

#### 명시적 요청과 암시적 기본값 (동반 패키지)

핸들러 계약은 `@oa-sdk/router`, 클라이언트 SDK와 TanStack Query 코드는 `@oa-sdk/client`가 만듭니다. 두 패키지는
`@oa-sdk/codegen` 옆에 따로 설치하는 동반 패키지(companion package)입니다([설치 안내](./cli-setup.md#동반-패키지-companion-packages)).
`oa-gen generate`는 패키지가 없을 때 그 생성물이 어떻게 요청되었는지에 따라 다르게 동작합니다.

| 요청 방식 | 판단 기준 | 패키지가 없을 때 | 생성 중 오류가 날 때 |
|---|---|---|---|
| 명시적 요청 | 설정 파일이 `core.contracts.pureHandlers: true` 또는 `core.client.enabled: true`를 직접 지정(`oa-gen init`이 만든 설정 포함) | 파일을 쓰기 전에 패키지 이름과 설치 명령을 출력하고 종료 코드 1로 실패 | 오류 메시지와 그 산출물을 켠 스위치를 출력하고 종료 코드 1로 실패. 어떤 파일도 쓰지 않고 `.oa-manifest.json`도 바꾸지 않음 |
| 암시적 기본값 | 스위치를 지정하지 않음(아키타입 기본값 포함), TanStack Query 코드, 스펙 확장으로 켜지는 CRDT 모듈, `--spec` 직접 실행 | 패키지 이름과 설치 명령을 담은 경고를 남기고 건너뜀. 이전 실행이 만든 해당 파일은 유지 | 오류 메시지를 담은 경고(`Skipped outputs that failed to generate`)를 남기고 그 산출물만 건너뜀(종료 코드 0). 이전 실행이 만든 해당 파일은 유지 |

산출물은 spec target마다 전부 쓰거나 하나도 쓰지 않습니다. 예를 들어 CRDT 모듈 4개 중 하나를 만들다 오류가 나면
4개 모두 쓰지 않습니다. 건너뛴 산출물은 요약의 `Contracts Generated` 등 개수에 들어가지 않습니다.

스위치를 `false`로 지정하면 해당 생성물을 만들지 않으며 패키지도 필요하지 않습니다. `oa-gen init`은 두 스위치를
`true`로 쓰고, 자신이 쓰는 스크립트에 필요한 동반 패키지(`mock` 스크립트용 `@oa-sdk/mock-server` 포함)를
`devDependencies`에 추가합니다. 출력되는 설치 명령은 사용 중인 codegen이 빌드된 동반 패키지 버전과 호환되는
범위(`^`)를 씁니다.

### 2.2 서버 쪽 생성물의 범위

`oa-gen generate`는 서버 쪽에 프레임워크와 무관한 핸들러 계약(`<id>.contract.ts`)을 만들고, 대상 프레임워크가
정해지면 그 프레임워크용 라우터(`<id>.router.ts`)도 계약 옆에 만듭니다. 둘 다 `@oa-sdk/router`가 생성합니다
([Backend Handler Contracts](./backend-handler-contracts.md)).

| 항목 | 동작 |
|---|---|
| 대상 프레임워크 | `core.router.target`, 없으면 `specs[].target`, 그것도 없으면 `product.framework`. 결과가 `hono`, `express`, `fastify`, `elysia` 중 하나일 때만 라우터를 만든다 |
| 출력 위치 | `outputRouting`이 있으면 kind `router`의 경로 규칙, 없으면 `core.router.outDir`, 그것도 없으면 spec target의 `outDir` |
| 모드 | `core.contracts.pureHandlers`가 `false`가 아니면 계약 모드: 생성된 계약 모듈을 import한다. `pureHandlers: false`이면 계약은 만들지 않고, `core.router.target`을 직접 지정했을 때만 계약 없이 동작하는 스텁 모드 라우터를 만든다 |
| 배너 | `core.router.banner`, 없으면 `core.contracts.banner` (기본 `true`) |

`oa-gen init`은 `specs[].target`과 `product.framework`를 모두 쓰므로, `init`으로 만든 Hono·Express·Fastify·Elysia
프로젝트는 기본으로 라우터 파일을 받습니다. `init`의 기본 경로 패턴(`src/api/{tag}/{tag}.{kind}.ts`)에서는
`src/api/<id>/<id>.router.ts`입니다. 이 파일은 `oa-gen generate`가 실행될 때마다 다시 쓰므로 직접 고치지 않습니다.

라우터 생성을 끄려면 `core.router.target`을 `generic` 또는 `nestjs`로 지정합니다. 이 값은 설정 검증을 통과하지만
지원 목록 밖이라 라우터를 만들지 않으며, `specs[].target`과 `product.framework`보다 먼저 적용됩니다. 빌드 스크립트에서
`@oa-sdk/router`의 `generateRouter()`로 라우터를 직접 만드는 프로젝트는 이렇게 끄거나, `oa-gen generate`가 쓰는
`<id>.router.ts`와 다른 경로에 씁니다.

스펙의 `components.schemas`에 `x-oa-sdk-crdt-entity`나 `x-oa-sdk-crdt`가 있으면 CRDT 모듈 4개
(`<id>.crdt.contract.ts`, `.crdt.router.ts`, `.crdt.client.ts`, `.crdt.hooks.ts`)도 만듭니다. CRDT WebSocket 라우터는
위와 같은 순서(`core.router.target` → `specs[].target` → `product.framework`)로 대상을 정하고, 결과가 `hono`,
`express`, `fastify`, `elysia`가 아니거나 없으면 Hono용으로 만듭니다.

### 2.3 기록만 되는 설정

다음 항목은 설정 검증과 아키타입 기본값에만 쓰이며, 현재 어떤 `oa-gen` 명령도 읽지 않습니다. 팀의 의도를 기록하는
값으로만 다룹니다.

| 설정 | 현재 상태 |
|---|---|
| `archetype` (`mvp`, `microservice`, `enterprise`) | 아래 항목의 기본값만 바꾼다. 명령이 읽는 값(2.1절)은 세 아키타입 모두 같다 |
| `core.dialect.*` (`oasVersion`, `jsonSchemaDialect`, `canonicalProjection`) | 생성되는 OpenAPI 버전은 원본 형식이 정한다(6.1절) |
| `core.client.wireFormatSafety` | 생성 클라이언트는 이 값과 무관하게 같은 코드를 만든다 |
| `core.typegen.*` | `oa-gen typegen`은 설정 파일을 읽지 않는다 |
| `core.gates.*` (`driftCheck`, `failOnBreaking`, `baseRef`, `preflightLint`) | gate는 CI에서 명령으로 직접 실행한다(9절) |
| `product.runtime` | `init`이 감지한 런타임을 기록한다. 다른 명령은 읽지 않는다 |
| `product.jitSchema`, `product.zeroCopy` | 생성 코드에 영향 없음 |
| `product.personas.*` | `@oa-sdk/personas`는 비공개 유지보수 패키지(maintenance-only, 저장소 전용)이며 coverage 강제를 하는 명령은 없다 |

아키타입별 기본값은 다음과 같습니다. 이 값을 바꿔도 위와 같은 이유로 동작이 달라지지 않습니다.

| 설정 항목 | `mvp` | `microservice` | `enterprise` |
|---|---|---|---|
| `core.gates.driftCheck` | `false` | `true` | `true` |
| `core.gates.failOnBreaking` | `false` | `false` | `true` (`baseRef: "origin/main"`) |
| `core.gates.preflightLint` | `"warn"` | `"error"` | `"error"` |
| `core.client.wireFormatSafety` | `false` | `true` | `true` |
| `core.typegen.resolveSymbolCycles` | `false` | `true` | `true` |
| `product.jitSchema`, `product.zeroCopy` | `false` | `true` | `true` |
| `product.personas.enforceCoverage` | - | - | `true` (`minCoverageRatio: 0.8`) |

`oa-gen init --archetype`이 추가하는 `package.json` 스크립트는 이 값들을 읽지 않고 스펙 파일과 명령 옵션으로 동작합니다.
`enterprise`의 breaking change gate도 `baseRef`가 아니라 `init`이 만든 계약 기준선 `openapi.baseline.yaml`과 비교합니다.
스크립트 목록은 [CLI 설치 가이드](./cli-setup.md#packagejson-스크립트)와 [CLI 명령 레퍼런스](./cli-command-reference.md#아키타입---archetype)를 따릅니다.

### 2.4 spec target

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | 예 | 생성물 이름(`<id>.openapi.json` 등)과 `outputRouting`의 `{tag}` 값 |
| `schemaEntry` | 예 | 원본 파일. 6.1절 |
| `outDir` | 예 | `<id>.openapi.json`, `<id>.schema.json`을 쓰는 디렉터리 |
| `profile` | `target`이 없으면 예 | `component-bundle`, `operation-contract`, `full-api-document`. 6.2절 |
| `target` | 아니오 | 프레임워크 이름. 지정하면 `profile`을 생략할 수 있다(`full-api-document`로 처리). `core.router.target`이 없으면 라우터 대상이 된다(2.2절) |
| `title`, `version` | 아니오 | TypeScript 모듈 원본일 때 생성 문서의 `info`에 쓰인다 |

---

## 3. 생성물 위치

`outputRouting`이 없으면 생성물은 spec `outDir`에 `<id>.<kind>.ts` 이름으로 생깁니다(`core.contracts.outDir`,
`core.router.outDir`, `core.client.outDir`를 지정하면 그 디렉터리). `outputRouting`이 있으면 OpenAPI·JSON Schema 생성물을 뺀 코드 생성물이
4절의 규칙을 따릅니다.

| 생성물 | `outputRouting` 없을 때 | `kind` |
|---|---|---|
| `<id>.openapi.json`, `<id>.schema.json` | spec `outDir` (항상) | - |
| 타입 가드 | `guards.outDir` (항상) | - |
| 핸들러 계약 | `core.contracts.outDir` 또는 spec `outDir` | `contract` |
| 라우터 (대상 프레임워크가 있을 때, 2.2절) | `core.router.outDir` 또는 spec `outDir` | `router` |
| 클라이언트 | `core.client.outDir` 또는 spec `outDir` | `client` |
| TanStack Query | spec `outDir` (`<id>.queries.ts` 하나에 키·옵션·훅) | `keys`, `queries` |
| CRDT 모듈 | spec `outDir` | `crdt-contract`, `crdt-router`, `crdt-client`, `crdt-hooks` |

`outputRouting`이 있고 `keys`와 `queries`가 다른 파일로 나뉘면 `<id>.keys.ts`(키)와 `<id>.queries.ts`(옵션)만 쓰고
훅은 쓰지 않습니다. 훅이 필요하면 `outputRouting` 없이 생성합니다.

---

## 4. 출력 경로 규칙 (`outputRouting`)

```typescript
export interface OutputRoutingConfig {
  /** 기본 경로 템플릿. 토큰: {tag}, {kind} */
  pattern?: string | undefined
  /** kind별 경로 템플릿 (pattern보다 우선) */
  byKind?: ByKindRoutingConfig | undefined
  /** 조건부 규칙. 앞에서부터 처음 맞는 규칙이 적용됨 */
  rules?: OutputRoutingRule[] | undefined
  /** 경로 템플릿의 기준 디렉터리 (rootDir 기준, 기본값: ".") */
  baseDir?: string | undefined
  /** 생성물 사이 import 스타일 ("relative" | "alias", 기본값: "relative") */
  importStyle?: "relative" | "alias" | undefined
  /** alias 해석용 tsconfig.json 경로 */
  tsconfigPath?: string | undefined
  /** 선언만 있고 현재 읽지 않음. manifest는 항상 rootDir의 .oa-manifest.json */
  manifestPath?: string | undefined
  /** 생성 파일 정리 여부 (기본값: true). false면 아무 파일도 지우지 않음. 4.5절 */
  pruneOrphans?: boolean | undefined
  /** 토큰 치환 케이싱 ("kebab" | "camel" | "pascal" | "preserve", 기본값: "kebab") */
  casing?: "kebab" | "camel" | "pascal" | "preserve" | undefined
}
```

### 4.1 토큰

`oa-gen generate`는 생성물 하나마다 `{ kind, tag: <spec id> }`만으로 경로를 정합니다. operation 단위로 나누지 않습니다.

| 토큰 | 값 |
|---|---|
| `{tag}` | spec target `id` (OpenAPI tag가 아님) |
| `{kind}` | `contract`, `router`, `client`, `keys`, `queries`, `crdt-contract`, `crdt-router`, `crdt-client`, `crdt-hooks` |
| `{group}` | `{tag}`와 같은 값 |
| `{operationId}`, `{method}` | operation 정보가 없어 고정 값(`get_<id>`, `get`)이 됩니다. 쓰지 않습니다 |

`casing`은 `{tag}`·`{group}` 값에 적용됩니다: `kebab`(기본, `UserProfile` → `user-profile`), `camel`, `pascal`,
`preserve`(파일 시스템 예약 문자 `: * ? " < > |`는 `-`로 바꿈).

### 4.2 `byKind`

kind별로 경로를 지정합니다. 키는 4.1절의 `{kind}` 값입니다. `guards`와 `schemas` 키는 타입상 허용되지만 무시됩니다
(가드는 `guards.outDir`, OpenAPI·JSON Schema 생성물은 spec `outDir`).

```typescript
byKind: {
  contract: "packages/contracts/src/{tag}.contract.ts",
  client:   "packages/client-sdk/src/{tag}.client.ts",
  queries:  "apps/web/src/features/{tag}/api/{tag}.queries.ts",
  keys:     "apps/web/src/features/{tag}/api/{tag}.keys.ts",
}
```

### 4.3 `rules`와 우선순위

```typescript
export interface OutputRoutingRule {
  tag?: string | string[] | undefined          // spec id와 비교 (대소문자 무시)
  kind?: ArtifactKind | ArtifactKind[] | undefined
  pathPrefix?: string | undefined              // 현재 맞는 경우가 없음
  method?: string | string[] | undefined       // 현재 맞는 경우가 없음
  profile?: string | undefined                 // 현재 맞는 경우가 없음
  target: string                               // 경로 템플릿
}
```

경로는 다음 순서로 정해집니다.

1. `rules`: 앞에서부터 검사해 처음 맞는 규칙의 `target`. 실제로 맞출 수 있는 조건은 `kind`와 `tag`(spec id)뿐입니다. `pathPrefix`, `method`, `profile` 조건이 있는 규칙은 맞지 않습니다.
2. `byKind[kind]`
3. `pattern`
4. 기본값 `src/api/{tag}/{tag}.{kind}.ts`

### 4.4 생성물 사이의 import

생성물이 서로 다른 디렉터리에 나뉘면(예: `queries`가 `client`를 import) import 경로를 다시 계산합니다.
POSIX 슬래시와 `.js` 확장자를 쓰고, `importStyle: "alias"`이면 `tsconfig.json`의 `compilerOptions.paths`에 맞는 별칭을,
대상이 다른 워크스페이스 패키지에 있으면 그 패키지 이름을 씁니다. 파일이 자기 자신을 import하게 되면 오류로 멈춥니다.
`contextInjection.importPath`와 `core.client.typesImport`는 다시 계산하지 않고 그대로 씁니다.

### 4.5 생성 파일 정리

`oa-gen generate`와 `oa-gen generate:tanstack`은 쓴 파일을 프로젝트 루트(`rootDir`)의 `.oa-manifest.json`에 기록합니다.
기록에는 내용 hash와 함께 그 파일의 소유자가 들어갑니다.

| 필드 | 값 |
|---|---|
| `producer` | 파일을 쓴 명령: `"generate"` 또는 `"generate:tanstack"`. 빌드 스크립트 등이 `OaManifestManager.writeArtifacts`로 직접 기록하면 넘긴 `producer` 값이고, 넘기지 않으면 `"unspecified"` |
| `configFile` | `oa-gen generate`가 읽은 설정 파일의 `rootDir` 기준 POSIX 경로(예: `"oa.config.ts"`). `--spec` 실행은 설정 파일을 읽지 않으므로 없음 |
| `specFile` | `--spec <파일>` 실행의 스펙 파일 경로. `rootDir` 기준 POSIX 경로(예: `"services/orders/openapi.json"`)로, 절대 경로로 넘겨도 같은 값이 됨. 설정 파일 실행에는 없음 |
| `target` | 파일을 만든 spec target `id`. 모든 spec target을 합쳐 만드는 타입 가드는 없음 |

`oa-gen generate`는 실행을 마칠 때 다음 조건을 **모두** 만족하는 기록의 파일을 지우고 기록에서도 뺍니다. 이 규칙은
`outputRouting` 유무와 관계없이 적용됩니다.

1. `outputRouting.pruneOrphans`가 `false`가 아닙니다(기본값 `true`). `false`면 어떤 파일도 지우지 않고 기록도 그대로
   두므로, 나중에 다시 켜면 그때 남아 있는 기록이 이 규칙으로 판정됩니다.
2. 이번 실행이 소유한 기록입니다.
   - 설정 파일로 실행했으면: `producer`가 `"generate"`이고 `configFile`이 이번 설정 파일과 같은 기록. spec target을
     설정에서 빼거나 `id`를 바꾸면 이전 target의 파일도 여기에 들어가 정리됩니다.
   - `--spec <파일>`로 실행했으면: `producer`가 `"generate"`이고 `specFile`이 이번 스펙 파일과 같은 기록. 같은 스펙
     파일을 `--out-dir`만 바꿔 다시 실행하면 이전 출력이 정리됩니다. spec target `id`는 파일 이름에서 확장자를 뺀
     값이라 `services/orders/openapi.json`과 `services/billing/openapi.json`은 둘 다 `openapi`가 되지만, 경로가 다른
     스펙 파일이므로 한쪽 실행이 다른 쪽 출력을 지우지 않습니다.
3. 이번 실행이 쓰지 않은 파일입니다. 동반 패키지가 없거나 생성 중 오류가 나서 건너뛴 산출물의 이전 파일은 이번 실행이
   쓴 것으로 봅니다(지우지 않음).
4. 디스크 내용의 hash가 기록과 같습니다. 손으로 고친 파일은 지우지 않습니다.
5. 생성 배너가 있습니다.

따라서 `oa-gen generate:tanstack` 등 다른 명령이 쓴 파일, `OaManifestManager`로 직접 기록한 파일(`producer`를
`"generate"`로 넘기지 않은 경우), 다른 설정 파일이나 다른 스펙 파일로 실행한 `oa-gen generate`가 쓴 파일,
`--spec` 실행과 설정 파일 실행이 서로 쓴 파일, manifest에 없는 파일은 지우지 않습니다.
설정 파일이나 스펙 파일의 이름 또는 위치를 바꾸면 이전 경로로 기록된 파일은 새 실행의 것이 아니므로 남습니다. 필요
없으면 직접 지웁니다.

codegen 0.9.0부터는 모든 기록에 `producer`가 들어가므로, `producer`가 없는 항목은 0.9.0보다 먼저 기록된 것입니다.
이런 항목에는 어느 설정 파일이나 스펙 파일로 실행해 썼는지도 남아 있지 않습니다. 그 가운데 `tag`가 있는 항목은
이전 `oa-gen generate`가 `tag`에 spec target `id`를 적어 기록한 것이므로, 설정 파일로 실행해 그 `id`의 spec target을
생성하는 실행이 2번의 설정 파일 조건 없이 소유합니다(이전 `--spec` 실행이 같은 `id`로 쓴 항목도 포함). `kind`가 `"guards"`인 항목은 설정 파일로 실행하면서 `guards`를 설정한 실행이
소유합니다. `--spec` 실행은 이전 항목을 소유하지 않습니다. `--spec` 실행의 spec target `id`는 스펙 파일 이름일 뿐이라
어느 스펙 파일이나 설정의 출력인지 가릴 수 없기 때문입니다. 그래서 업그레이드 전 `--spec` 실행이 쓴 파일 가운데 업그레이드
뒤 다시 쓰지 않는 파일(예: 다른 `--out-dir`로 실행했을 때의 이전 출력)은 남으므로, 필요 없으면 직접 지웁니다. 그 밖의
항목(이전 `generate:tanstack` 출력 등)은 지우지 않습니다. 0.9.0 이전에 `OaManifestManager`로 직접 `tag`를 붙이거나
`kind: "guards"`로 기록한 항목은 이전 `oa-gen generate`의 기록과 구별할 수 없어 같은 규칙을 따릅니다. 이전 항목은 같은
파일을 다시 쓸 때 새 필드로 바뀝니다.

요약 출력의 `Artifacts Pruned`에 지운 파일 수와 경로가 나옵니다. `pruneOrphans: false`면
`Artifacts Pruned:    0 (outputRouting.pruneOrphans: false)`로 표시합니다.

---

## 5. 프로젝트 루트 탐색

CLI와 설정 로더는 하위 디렉터리에서 실행되어도 다음 순서로 프로젝트 루트를 찾습니다(`@oa-sdk/core`의 `findProjectRoot`).

1. 명시적 인자: `--root <dir>` 또는 `--project-root <dir>`
2. 환경 변수: `OA_PROJECT_ROOT`
3. 설정 파일: `oa.config.ts` → `oa.config.mjs` → `oa.config.json` → `.oarc.json`
4. 워크스페이스 표시: `pnpm-workspace.yaml`, `turbo.json`, `lerna.json`, `workspaces` 필드가 있는 `package.json`
5. VCS 표시: `.git`
6. `process.cwd()`

설정 파일(3)을 워크스페이스(4)·VCS(5)보다 먼저 찾으므로, Git 서브모듈 안에서 실행해도 상위 저장소의 `oa.config.ts`를 찾습니다.

---

## 6. 원본 형식, 프로파일, 가드

### 6.1 `schemaEntry` 원본 형식

| 형식 | 확장자 | 생성되는 `<id>.openapi.json` |
|---|---|---|
| TypeSpec | `.tsp` | codegen에 들어 있는 TypeSpec 컴파일러(1.16)로 메모리 컴파일한 OpenAPI **3.2.0** |
| OpenAPI 문서 | `.yaml`, `.yml`, `.json` | 원본에 적힌 버전 그대로 |
| TypeScript 모듈 | `.ts`, `.mts`, `.js` | Zod 스키마에서 만든 OpenAPI **3.1.0** |

모든 형식에서 `<id>.schema.json`(JSON Schema 2020-12, `$defs`)도 함께 생깁니다. TypeScript 모듈은 Zod 스키마를
named export(`OrderSchema` → component `Order`), `schemas` 객체, default 객체로 내보내고, `paths`나 `operations`를
함께 export할 수 있습니다. `buildProjection()`이나 `{ openApiDoc, jsonSchemaDoc }`를 반환하는 default 함수를 export하면
그 결과를 그대로 씁니다.

`oa-gen generate` 요약 출력은 `<id>.openapi.json` 줄에 파일의 `openapi` 필드 버전을 표시하고(`OpenAPI 3.2.0: <파일>`),
`N ops`에 operation 수를 표시합니다. operation 수는 `paths` 아래 모든 HTTP 메서드(OAS 3.2 `query` 포함)와
`additionalOperations` 항목을 세고, webhook은 세지 않습니다. 스펙이 여러 파일로 나뉘어 있으면 다른 파일을 가리키는
`$ref`를 스펙 파일의 위치에서 푼 스펙에서 세므로 다른 파일에 있는 path item의 operation도 셉니다. TypeSpec 원본에 필요한 패키지 설치는
[Quick Start](./quick-start.md)를 따릅니다.

### 6.2 프로젝션 프로파일

| `profile` | 용도 | `paths` | `components.schemas` |
|---|---|---|---|
| `component-bundle` | 모델·DTO 묶음 | 비어 있거나 없어도 됨 | 하나 이상 필요 |
| `operation-contract` | 요청·응답 operation 계약 | operation 하나 이상 필요 | 표준 OpenAPI 규칙 |
| `full-api-document` | 일반 API 문서 | 표준 OpenAPI 규칙 | 표준 OpenAPI 규칙 |

`oa-gen validate`는 설정의 프로파일로 위 조건을 검사합니다(`@oa-sdk/openapi-projection-contract`). 오류 응답 형식은 프로파일이 정하지 않습니다.

### 6.3 독립형 타입 가드 (`guards`)

`guards`를 지정하면 `oa-gen generate`가 모든 spec target의 component schema로 런타임 의존성이 없는 `is<Name>(data)` 함수와
`.d.ts`를 만듭니다(`ajv`, `zod`, `@oa-sdk/*`를 import하지 않음).

| 필드 | 설명 |
|---|---|
| `outDir` | 출력 디렉터리 (필수) |
| `split` | `true`면 스키마별 모듈(`guards/<Name>.js`)로 나눔 |
| `moduleFormat` | 기본 `"esm"` |
| `tiered`, `polymorphicDispatch` | 빠른 경로 predicate, discriminated union dispatch table 생성 |
| `auditCsp` | 생성 후 CSP 감사를 실행하지만 `oa-gen generate`는 결과를 출력하거나 실패로 바꾸지 않습니다. 감사가 필요하면 `oa-gen audit:csp --bundle <outDir>`를 따로 실행합니다 |

component 이름에 `.`이 들어가면 가드 생성이 `invalid export name` 오류로 실패합니다(알려진 결함). TypeSpec 표준 계약
(`ErrorResponse`, `StandardHttpErrors`)을 쓰면 `OaSdkTypeSpec.StandardError` 같은 이름이 생기므로, 이런 원본에는 `guards`를
지정하지 말고 `oa-gen generate:guards --input <파일> --schemas <이름,...>`로 필요한 component만 고릅니다.

---

## 7. 설정 예제

아래 예제는 `npm init -y` 프로젝트(`"type": "commonjs"`)에서 `oa-gen validate`, `oa-gen generate`, `oa-gen check-artifact`가
종료 코드 0으로 끝나는 것을 확인했습니다.

### 예제 1: TypeSpec 원본 + 기능별 디렉터리

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen"

export default defineConfig({
  specs: [
    {
      id: "main-api",
      profile: "full-api-document",
      schemaEntry: "typespec/main.tsp",
      outDir: "artifacts/specs",
    },
  ],
  core: {
    contracts: { pureHandlers: true, contractName: "AppApiHandlers" },
    client: { enabled: true },
  },
  outputRouting: {
    pattern: "src/features/{tag}/api/{tag}.{kind}.ts",
    byKind: {
      contract: "src/server/contracts/{tag}.contract.ts",
      client: "src/shared/api/{tag}.client.ts",
    },
  },
  contextInjection: { typeName: "AppContext", importPath: "../context.js" },
})
```

생성 결과: `artifacts/specs/main-api.{openapi,schema}.json`, `src/server/contracts/main-api.contract.ts`
(`import type { AppContext } from '../context.js'`), `src/shared/api/main-api.client.ts`,
`src/features/main-api/api/main-api.{keys,queries}.ts`. `@oa-sdk/router`와 `@oa-sdk/client`가 필요합니다.

### 예제 2: Zod 모델 + 타입 가드 (HTTP operation 없음)

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen"

export default defineConfig({
  specs: [
    {
      id: "order-model",
      profile: "component-bundle",
      schemaEntry: "src/schemas/index.ts",
      outDir: "artifacts/specs",
      title: "Order Model",
      version: "1.0.0",
    },
  ],
  guards: {
    outDir: "src/generated/guards",
    split: true,
  },
  core: {
    contracts: { pureHandlers: false },
    client: { enabled: false },
  },
})
```

`src/schemas/index.ts`가 `OrderSchema`, `OrderItemSchema`를 export하면 `artifacts/specs/order-model.openapi.json`
(OpenAPI 3.1.0, component `Order`, `OrderItem`)과 `src/generated/guards/guards/{Order,OrderItem}.js`가 생깁니다.
2.1절의 TanStack 결함 때문에 이 프로젝트에는 `@oa-sdk/client`를 설치하지 않습니다.

### 예제 3: `oa-gen init` 기본 설정

`oa-gen init --yes`는 OpenAPI 문서(`openapi.yaml`)를 원본으로 하는 다음 형태를 씁니다(주석과 기록 전용 항목은 줄임).

```typescript
import { defineConfig } from '@oa-sdk/codegen'

export default defineConfig({
  rootDir: '.',
  archetype: 'mvp',
  specs: [
    { id: 'generic-api', schemaEntry: 'openapi.yaml', outDir: './src/generated', target: 'generic' },
  ],
  core: {
    contracts: { pureHandlers: true, contractName: 'ApiHandlers', banner: true },
    client: { enabled: true, outDir: './src/client' },
  },
  product: {
    outputRouting: { pattern: 'src/api/{tag}/{tag}.{kind}.ts' },
  },
})
```

`outputRouting`이 있으므로 `client.outDir`는 쓰이지 않고 클라이언트는 `src/api/generic-api/generic-api.client.ts`에 생깁니다.

---

## 8. 설정 로더

`loadOaConfig()`(`packages/codegen/src/cli/lib/config-loader.ts`)의 동작입니다.

- **지원 형식**: `oa.config.ts`, `oa.config.mjs`, `oa.config.json`, `.oarc.json`.
- **함수 export**: 객체뿐 아니라 함수(`export default () => ({ ... })`)와 async 함수도 평가합니다.
- **TypeScript 설정 파일**: Node의 타입 제거로 먼저 불러오고, `enum`처럼 타입 제거로 실행할 수 없는 문법이 있으면 `typescript.transpileModule`로 변환해 임시 파일로 불러온 뒤 지웁니다.
- **`"type": "commonjs"` 프로젝트**: `npm init -y`가 만드는 `"type": "commonjs"` 패키지 안의 ES module `oa.config.ts`(`import`·`export` 사용)는 Node가 CommonJS로 읽어 실패하므로, 로더가 미리 ES module로 변환해 불러옵니다.
- 위 두 변환에는 `typescript` 패키지(codegen의 선택적 peer dependency)가 필요합니다. 없으면 `'typescript' is not installed for fallback transpilation` 오류가 납니다.
- **설정 검증(`assertOaConfig`)**: spec id 중복(`Duplicate spec target id`), 잘못된 아키타입, `profile`·`target`이 모두 없는 spec target, 잘못된 프로파일 이름을 불러올 때 오류로 보고합니다.

---

## 9. 인자 없이 실행하는 명령

`oa.config.ts`가 있는 프로젝트에서는 다음처럼 실행합니다.

```bash
# 모든 spec target 검증 (생성물이 있으면 그 파일을, 없으면 원본을 메모리에서 투영해 검사)
npx oa-gen validate

# OpenAPI·JSON Schema 생성물, 가드, 핸들러 계약, 클라이언트, TanStack Query 코드 생성
npx oa-gen generate

# 생성물이 원본에서 다시 만든 결과와 같은지 확인 (최상위 specs만 읽음, drift:check와 같음)
npx oa-gen check-artifact

# spec target이 하나일 때 그 원본으로 mock 서버 구동
npx oa-gen mock --watch

# 생성된 가드의 Manifest V3 CSP 감사
npx oa-gen audit:csp --bundle ./src/generated/guards
```

기존 소비자를 깨뜨리는 변경(breaking change)은 별도 명령으로 확인합니다. `oa-gen diff`는 두 OpenAPI **파일**을 비교하며
git ref를 받지 않습니다. 비교 기준을 git에서 꺼낼 때는 먼저 파일로 씁니다.

```bash
git show origin/main:artifacts/specs/main-api.openapi.json > /tmp/main-api.base.json
npx oa-gen diff --base /tmp/main-api.base.json --head artifacts/specs/main-api.openapi.json --fail-on-breaking
```

`oa-gen diff`는 `$ref`가 가리키는 다른 파일의 내용까지 비교하며, 그 파일을 읽지 못하면 실패합니다. 위 예의 `generate` 산출물은 한 파일이지만, 여러 파일로 나뉜 스펙을 git에서 꺼낼 때는 `$ref`가 가리키는 파일도 같은 상대 위치에 함께 꺼내거나, 꺼낸 위치에서 `oa-gen normalize --spec <spec> --output <file>`로 그 파일들을 복사해 넣은 한 문서를 만들어 base로 씁니다.

`oa-gen diff`는 요청·응답·파라미터 스키마가 조금이라도 바뀌면 선택 필드 추가도 breaking으로 판정하는 보수적 규칙입니다.
TypeSpec 원본은 `oa-gen tsp diff`가 선택 속성 추가 같은 호환 변경을 non-breaking으로 구분합니다. git ref를 주면 커밋된
내용을 비교하므로, 커밋 전 변경은 head에 파일 경로를 줍니다.

```bash
npx oa-gen tsp diff --base origin/main:typespec/main.tsp --head typespec/main.tsp --fail-on-breaking
```

---

## 10. 다음 단계

- [CLI 설치 및 환경 설정 가이드](./cli-setup.md) — 패키지 매니저별 설치, 동반 패키지, 런타임 요구사항
- [Quick Start](./quick-start.md) — 처음부터 끝까지 한 번 실행해 보기
- [CLI 명령 레퍼런스](./cli-command-reference.md) — 전체 명령 색인
- [스키마 파이프라인](./schema-architecture-and-conventions.md) — 원본에서 생성물까지의 흐름
