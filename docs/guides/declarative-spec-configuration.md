# 선언적 사양 및 거버넌스 설정 가이드 (oa.config.ts)

> **Canonical Authority**: `@oa-sdk/codegen` & `@oa-sdk/core` (`packages/codegen/src/config.ts`)
> **Supported Config Formats**: `oa.config.ts`, `oa.config.mjs`, `oa.config.json`, `.oarc.json`
> **Core Architecture**: 이중 계층 설정 체계 (Shared Platform Core vs. Product Domain Layer)
> **Lifecycle Archetypes**: `mvp` | `microservice` | `enterprise`
> **Path Sovereignty**: `outputRouting` (Feature-Sliced Design, DDD, Monorepos)

---

## 1. 개요 (Overview)

`@oa-sdk`는 대규모 분산 패키지, 마이크로서비스, 모노레포 환경에서 복수의 도메인 API 사양, 타입 생성, 프론트엔드 쿼리 클라이언트, 백엔드 라우터 바인더, 독립형 타입 가드를 중앙 집중적이면서도 일관되게 관리할 수 있는 **선언적 설정 파일 체계(`oa.config.ts`)**를 제공합니다.

단일 설정 파일을 선언함으로써 다음과 같은 엔터프라이즈 거버넌스가 활성화됩니다:
1. **이중 계층 설정 분리 (Dual-Layer Architecture)**: 전사적 불변 계약 규격(`core`)과 제품별 생애주기 도메인 설정(`product`)을 엄격히 분리하여, 계약 파기 없이 제품의 성장 단계에 맞춘 유연한 확장을 지원합니다.
2. **3대 제품 생애주기 아키타입 (Product Lifecycle Archetypes)**: `mvp`, `microservice`, `enterprise` 프리셋을 통해 원클릭으로 최적의 거버넌스 강도와 런타임 최적화 옵션을 주입합니다.
3. **산출물 경로 라우팅 주권 (`outputRouting`)**: 프레임워크가 강제하는 고정 디렉터리(`src/api/`)의 한계를 극복하고, Feature-Sliced Design(FSD), Clean Architecture, DDD, 멀티 패키지 모노레포 레이아웃으로 생성 아티팩트를 자유롭게 분산 배치합니다.
4. **상대 Import 자동 재계산 및 3단계 안전 고아 파일 정리**: 분산 배치된 아티팩트 간의 TypeScript `import` 경로를 자동으로 재계산하고, 사양 변경 시 개발자의 손코딩 파일을 안전하게 보호하면서 불필요해진 고아 파일만 선별 삭제합니다.
5. **계층적 상향 프로젝트 루트 자동 탐색 (6-Tier Project Root Resolution)**: 모노레포의 깊은 하위 디렉터리나 Git 서브모듈에서도 루트 설정을 오차 없이 식별합니다.

---

## 2. 이중 계층 설정 아키텍처 (Dual-Layer Architecture)

`OaConfig`는 **공유 플랫폼 코어(Shared Platform Core)**와 **제품 특화 도메인 레이어(Product Domain Layer)**의 2개 계층으로 엄격히 분리됩니다.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       OaConfig (oa.config.ts)                               │
├──────────────────────────────────────┬──────────────────────────────────────┤
│    Shared Platform Core (core)       │     Product Domain Layer (product)   │
│    [불변 전사 계약 및 거버넌스 규칙]   │     [제품 생애주기 및 인프라 가변 설정]  │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • dialect: OAS 3.2 & Draft 2020-12   │ • archetype: mvp | microservice |    │
│ • contracts: 순수 핸들러 계약 분리     │              enterprise              │
│ • client: Wire-format JsonPrimitive  │ • framework: fastify | elysia |      │
│ • typegen: DFS 순환 탐색 & 유니온      │              hono | express | nestjs │
│ • gates: 시맨틱 diff 및 드리프트 차단 │ • outputRouting: FSD / DDD 경로 제어  │
│                                      │ • contextInjection: 앱 컨텍스트 주입 │
│                                      │ • personas: 페르소나 거버넌스         │
│                                      │ • jitSchema / zeroCopy: 가속 플래그  │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 2.1 공유 플랫폼 코어 (`core: SharedPlatformCoreConfig`)
전사 플랫폼 레벨에서 준수해야 하는 불변의 단일 진실 공급원(SSOT) 규칙입니다:
- **`dialect`**: OpenAPI 사양 버전(`oasVersion: "3.2.0" | "3.1.0"`) 및 JSON Schema 방언(`jsonSchemaDialect: "draft-2020-12"`), 정규 벤더 확장 투영 여부(`canonicalProjection: true`).
- **`contracts`**: 프레임워크와 비즈니스 로직을 격리하는 순수 TypeScript 핸들러 계약 인터페이스 생성 여부(`pureHandlers: true`), aggregate 인터페이스 이름(`contractName: "ApiHandlers"`), 배너 주입 여부.
- **`client`**: 타입 안전 클라이언트 SDK 생성 및 `JsonPrimitive<T>` 와이어 포맷 안전성 강제 여부(`wireFormatSafety: true` — `Date` $\rightarrow$ `string`, 메서드 및 프로토타입 제거).
- **`typegen`**: TypeChecker 기반 DFS 심볼 순환 감지(`resolveSymbolCycles: true`), OAS 3.2 `discriminator` + `defaultMapping` 유니온 지원, 타겟 어댑터(`ts` | `zod` | `typia`).
- **`gates`**: CI 결정론적 해시 드리프트 차단(`driftCheck: true`), 시맨틱 브레이킹 체인지 차단(`failOnBreaking: true`), 기준 베이스 브랜치(`baseRef: "origin/main"`), 사전 린트 검증 수준(`preflightLint: "off" | "warn" | "error"`).

### 2.2 제품 특화 도메인 확장 레이어 (`product: ProductDomainConfig`)
개별 서비스의 제품 생애주기, 백엔드 프레임워크 및 폴더 구조에 따라 유연하게 구성되는 영역입니다:
- **`archetype`**: 제품 라이프사이클 아키타입 (`"mvp"` | `"microservice"` | `"enterprise"`).
- **`framework`**: 대상 웹 프레임워크 (`"fastify"` | `"elysia"` | `"hono"` | `"express"` | `"nestjs"` | `"generic"`).
- **`runtime`**: 대상 실행 런타임 (`"node"` | `"bun"`).
- **`jitSchema`**: Fastify 전용 `fast-json-stringify` JIT 스키마 인라인 가속 활성화 여부.
- **`zeroCopy`**: Bun Elysia 전용 네이티브 C++ Zero-copy 컨텍스트 구조분해 활성화 여부.
- **`specs`**: 도메인별 OpenAPI 프로젝션 타겟 목록 (`ProfileTargetConfig[]`).
- **`guards`**: 독립형 정적 타입 가드 컴파일 설정 (`GuardTargetConfig`).
- **`contextInjection`**: 핸들러 계약에 애플리케이션 제품 컨텍스트(테넌시, 세션, 트레이싱)를 주입하는 설정 (`HandlerContextInjectionConfig`).
- **`outputRouting`**: 산출물 경로 커스터마이징 및 FSD/DDD 디렉터리 분산 라우팅 설정 (`OutputRoutingConfig`).
- **`personas`**: 페르소나 역량 특성 및 오퍼레이션 커버리지 거버넌스 (`PersonaGovernanceConfig`).

### 2.3 최상위 단축 필드 (Top-Level Aliases)
하위 호환성과 작성 편의성을 위해, `specs`, `guards`, `framework`, `runtime`, `outputRouting`, `contextInjection`, `personas` 등의 필드는 `oa.config.ts`의 최상위에 직접 선언할 수 있습니다. 로더의 `resolveConfigWithDefaults()`가 이를 자동으로 `product.*` 구조로 병합합니다.

---

## 3. 제품 생애주기 3대 아키타입 (Product Lifecycle Archetypes)

`archetype` 설정은 제품의 개발 성숙도에 맞춰 최적의 플랫폼 코어 기본값을 자동으로 주입합니다.

| 설정 항목 | `mvp` (초기 개발 / 빠른 검증) | `microservice` (고성능 마이크로서비스) | `enterprise` (전사 거버넌스 및 엄격한 통제) |
|---|---|---|---|
| **목적** | 빠른 프로토타이핑, Mock 중심 개발 | 고처리량 런타임 최적화, 엄격한 와이어 타이핑 | 다중 팀 협업, 무결점 계약 호환성, 규제 준수 |
| **`core.gates.driftCheck`** | `false` | `true` | `true` |
| **`core.gates.failOnBreaking`** | `false` | `false` | `true` (`baseRef: "origin/main"`) |
| **`core.gates.preflightLint`** | `"warn"` | `"error"` | `"error"` |
| **`core.client.wireFormatSafety`** | `false` | `true` (`JsonPrimitive<T>`) | `true` (`JsonPrimitive<T>`) |
| **`core.typegen.resolveSymbolCycles`**| `false` | `true` | `true` |
| **`product.jitSchema`** | `false` | `true` | `true` |
| **`product.zeroCopy`** | `false` | `true` | `true` |
| **`product.personas.enforceCoverage`** | 비활성 | 비활성 | `true` (`minCoverageRatio: 0.8`) |

> 🚀 **원활한 생애주기 전환**: 서비스가 MVP 단계에서 성장하여 엔터프라이즈 단계로 진입할 때, 공유 코어 계약을 손상시키지 않고 `archetype: "enterprise"`로 선언을 변경하는 것만으로 전사 거버넌스 게이트가 즉시 활성화됩니다.

---

## 4. 산출물 경로 라우팅 커스터마이징 엔진 (`outputRouting`)

`outputRouting` 설정은 생성된 아티팩트(`*.contract.ts`, `*.client.ts`, `*.queries.ts`, `*.keys.ts`, `*.guards.ts`, `*.schemas.ts`)를 Feature-Sliced Design(FSD), Clean Architecture, Domain-Driven Design(DDD), 모노레포 패키지 등 개발팀의 고유한 폴더 아키텍처로 방출하도록 제어합니다.

```typescript
export interface OutputRoutingConfig {
  /** 전역 기본 경로 템플릿 패턴. 토큰 지원: {tag}, {kind}, {operationId}, {method}, {group} */
  pattern?: string | undefined
  /** 아티팩트 종류별 명시적 경로 템플릿 (pattern을 오버라이드) */
  byKind?: ByKindRoutingConfig | undefined
  /** 조건부 규칙 매처 목록 (우선순위 순서대로 매칭; 첫 번째 일치 규칙이 적용됨) */
  rules?: OutputRoutingRule[] | undefined
  /** 상대 경로 기준 기본 디렉터리 (rootDir 기준, 기본값: ".") */
  baseDir?: string | undefined
  /** 임포트 경로 스타일 ("relative" | "alias", 기본값: "relative") */
  importStyle?: "relative" | "alias" | undefined
  /** 경로 별칭 해석용 tsconfig.json 경로 (미지정 시 rootDir에서 자동 탐색) */
  tsconfigPath?: string | undefined
  /** 아티팩트 추적 및 고아 파일 정리를 위한 매니페스트 파일 (기본값: ".oa-manifest.json") */
  manifestPath?: string | undefined
  /** 스펙 변경 시 구 아티팩트 자동 정리 여부 (기본값: true) */
  pruneOrphans?: boolean | undefined
  /** 토큰 치환 케이싱 변환 방식 ("kebab" | "camel" | "pascal" | "preserve", 기본값: "kebab") */
  casing?: "kebab" | "camel" | "pascal" | "preserve" | undefined
}
```

### 4.1 지원되는 5대 템플릿 토큰 및 폴백 계층 구조

경로 템플릿 내부에서 다음 동적 토큰을 자유롭게 조합할 수 있으며, 각 토큰은 값이 누락되었을 때 안전한 폴백(Resilient Fallback Hierarchy)을 보장합니다:

| 토큰 | 의미 | 지원 값 예시 | 다단계 폴백 계층 (Fallback Hierarchy) |
|---|---|---|---|
| **`{tag}`** | 1차 도메인 태그 | `users`, `billing-engine` | `context.tag` $\rightarrow$ `context.group` $\rightarrow$ URL 경로 1차 세그먼트 $\rightarrow$ `"default"` |
| **`{kind}`** | 아티팩트 종류 | `contract`, `client`, `queries`, `keys`, `guards`, `schemas` | 고정 아티팩트 식별자 (6종) |
| **`{operationId}`** | 개별 오퍼레이션 ID | `getUserById`, `createOrder` | `context.operationId` $\rightarrow$ `${method}_${group}` $\rightarrow$ `"operation"` |
| **`{method}`** | 소문자 HTTP 동사 | `get`, `post`, `put`, `delete`, `patch`, `query`, `head` | `(context.method ?? "get").toLowerCase()` |
| **`{group}`** | URL 기반 도메인 그룹 | `users`, `billing`, `v1` | `context.group` $\rightarrow$ URL 경로 1차 세그먼트(중괄호 제거) $\rightarrow$ `tag` $\rightarrow$ `"common"` |

> 🛡️ **안전 보장**: 스펙에 `tags`나 `operationId`가 누락되었더라도 토큰 해석 엔진이 `undefined`나 빈 문자열을 경로에 삽입하지 않고 결정론적 폴백 문자열로 대체합니다.

### 4.2 4대 토큰 케이싱 전략 (`casing`)

토큰으로 치환되는 식별자에 적용할 대소문자 변환 규칙입니다:
- **`"kebab"`** (기본값): 단어를 하이픈으로 연결합니다 (`UserProfile` $\rightarrow$ `user-profile`, `get_user_by_id` $\rightarrow$ `get-user-by-id`).
- **`"camel"`**: 첫 단어는 소문자, 이후 단어는 대문자로 시작합니다 (`user-profile` $\rightarrow$ `userProfile`).
- **`"pascal"`**: 모든 단어의 첫 글자를 대문자로 변환합니다 (`user-profile` $\rightarrow$ `UserProfile`).
- **`"preserve"`**: 원본 문자열의 대소문자를 그대로 유지합니다. 단, 파일시스템 예약 문자(`:`, `*`, `?`, `"`, `<`, `>`, `|`, `\0`)는 안전하게 하이픈(`-`)으로 자동 치환됩니다.

### 4.3 아티팩트 종류별 매핑 (`byKind`)

특정 아티팩트 종류를 전용 디렉터리나 패키지로 격리하고자 할 때 사용하며, 전역 `pattern`보다 우선 적용됩니다:

```typescript
byKind: {
  contract: "packages/contracts/src/{tag}.contract.ts",
  client:   "packages/client-sdk/src/{tag}.client.ts",
  queries:  "apps/web/src/features/{tag}/api/{tag}.queries.ts",
  keys:     "apps/web/src/features/{tag}/api/{tag}.keys.ts",
  guards:   "packages/contracts/src/guards/{tag}.guard.ts",
  schemas:  "packages/contracts/src/schemas.ts",
}
```

### 4.4 조건부 규칙 매처 (`rules`) 및 4단계 우선순위 해소

특정 태그, URL 경로 접두사, HTTP 메서드, 프로파일에 따라 출력 경로를 동적으로 분기할 수 있습니다:

```typescript
export interface OutputRoutingRule {
  /** 태그 필터 (단일 문자열 또는 배열, 대소문자 무관) */
  tag?: string | string[] | undefined
  /** URL 경로 접두사 필터 (예: "/api/v1/billing") */
  pathPrefix?: string | undefined
  /** HTTP 메서드 필터 ("get" | "post" | "put" | "delete" 등) */
  method?: string | string[] | undefined
  /** 아티팩트 종류 필터 (contract, client, queries, keys, guards, schemas) */
  kind?: ArtifactKind | ArtifactKind[] | undefined
  /** 프로파일 또는 타겟 ID 필터 */
  profile?: string | undefined
  /** 대상 출력 템플릿 경로 (토큰 치환 지원) */
  target: string
}
```

#### 4단계 경로 결정 우선순위 (Path Precedence Resolution)
경로 디스패처는 항상 다음 순서로 경로를 결정합니다:
1. **규칙 매처 (`rules`)**: 배열에 등록된 순서대로 검사하며, **가장 먼저 일치하는 규칙**의 `target`이 선택됩니다 (`matchedBy: 'rule'`).
2. **종류별 매핑 (`byKind`)**: 일치하는 규칙이 없고 `byKind[context.kind]`가 선언되어 있다면 해당 템플릿이 선택됩니다 (`matchedBy: 'byKind'`).
3. **전역 패턴 (`pattern`)**: 일치하는 `byKind`가 없으면 전역 `pattern` 템플릿이 적용됩니다 (`matchedBy: 'pattern'`).
4. **기본 관례 (Default Fallback)**: 설정이 전혀 없을 경우 `src/api/{tag}/{tag}.{kind}.ts` (태그 존재 시) 또는 `src/api/generated/{kind}.ts`로 배치됩니다 (`matchedBy: 'default'`).

### 4.5 상대 Import 자동 재계산 및 모노레포 패키지 경계 인식 (`import-resolver.ts`)

아티팩트들이 서로 다른 폴더나 패키지로 분산 방출될 때, `@oa-sdk/codegen`의 임포트 리졸버는 빌드 오류를 방지하기 위해 다음 5대 불변식을 보장합니다:

1. **POSIX 슬래시 정규화**: Windows, macOS, Linux 어디서 실행하더라도 역슬래시(`\`)를 전면 배제하고 표준 POSIX 슬래시(`/`)만을 방출합니다.
2. **현대 ESM `.js` 확장자 자동 부착**: TypeScript 최신 모듈 해석 기준에 맞춰 `import { client } from '../../shared/client.js'`와 같이 `.js` 확장자를 기본 부착합니다 (`extension: ".js"`).
3. **`tsconfig.json` 경로 별칭 매칭 (`importStyle: "alias"`)**: `tsconfig.json`의 `compilerOptions.paths`(`@features/*`, `@shared/*`)를 실시간 매칭하여 깊은 상대 경로 대신 깔끔한 모듈 별칭으로 변환합니다.
4. **모노레포 패키지 경계 인식 (`packageBoundary: true`)**: 상향 순회 중 인접한 `package.json`을 검사하여 대상 모듈이 다른 워크스페이스 패키지(예: `apps/web/` $\rightarrow$ `packages/client-sdk/`)에 위치한 경우, 취약한 깊은 상대 경로(`../../../../packages/client-sdk/...`) 대신 정규 패키지 이름(`@oa-sdk/client` 또는 `@my-org/client-sdk`)이나 서브패스 export로 자동 변환합니다.
5. **자가 임포트 방어 (Self-Import Guard)**: 파일이 자기 자신을 임포트하는 경로(`from === to`)가 형성되면 명시적인 오류를 던져 순환 참조 컴파일 버그를 사전 차단합니다.

### 4.6 3단계 안전 고아 파일 정리 (3-Gate Safe Orphan Pruning)

OpenAPI 스펙에서 특정 엔드포인트가 삭제되거나 태그가 변경되면 더 이상 필요 없는 생성 파일이 디스크에 남아 빌드 실패를 일으킵니다.
`pruneOrphans: true`가 활성화되면 매니페스트(`.oa-manifest.json`)와 대조하여 **3대 안전 게이트를 통과한 파일만 선별 삭제**합니다:

```
[후보 파일 식별] ──> [Gate 1: 매니페스트 출처 검증] ──(통과)──> [Gate 2: SHA-256 해시 일치 검증] ──(통과)──> [Gate 3: 자동 생성 배너 확인] ──> [안전 삭제]
                              │                                          │                                       │
                           (실패)                                     (불일치)                                (누락)
                              ▼                                          ▼                                       ▼
                       [보존: 등록 외 파일]                    [보존: 개발자 수기 편집본]               [보존: 사용자 소유 파일]
```

- **Gate 1 (출처 무결성, Provenance Gate)**: `.oa-manifest.json`에 공식 등록된 아티팩트 경로만 삭제 후보로 선정합니다.
- **Gate 2 (해시 무결성, Content Hash Integrity Guard)**: 디스크 파일의 현재 SHA-256 해시가 매니페스트 기록과 정확히 일치해야 합니다. **개발자가 단 한 줄이라도 수동 편집한 파일은 해시 불일치로 감지되어 절대 삭제되지 않습니다 (`'content-modified'`).**
- **Gate 3 (배너 불변식, Auto-Generated Banner Verification)**: 파일 내용 내에 `@generated`, `Generated by @oa-sdk`, `Auto-generated by oa-sdk`, `DO NOT EDIT` 등 지정된 배너 마커가 반드시 존재해야 합니다 (`'banner-missing'`).
- **빈 부모 디렉터리 재귀 정리**: 파일이 안전하게 삭제된 후, 비어 있게 된 상위 폴더는 `baseDir` 경계까지 재귀적으로 정리하여 프로젝트 트리를 깔끔하게 유지합니다.

---

## 5. 계층적 상향 프로젝트 루트 탐색 (6-Tier Project Root Resolution)

CLI 및 설정 로더는 임의의 하위 디렉터리에서 실행되더라도 다음 6단계 우선순위에 따라 최상위 프로젝트 루트를 식별합니다:

1. **Tier 1 (명시적 CLI 인자)**: `--root <dir>` 또는 `--project-root <dir>`
2. **Tier 2 (환경 변수)**: `process.env.OA_PROJECT_ROOT`
3. **Tier 3 (스펙 설정 파일)**: `oa.config.ts` $\rightarrow$ `oa.config.mjs` $\rightarrow$ `oa.config.json` $\rightarrow$ `.oarc.json`
4. **Tier 4 (모노레포 워크스페이스 마커)**: `pnpm-workspace.yaml`, `turbo.json`, `lerna.json`, `package.json` (workspaces 필드)
5. **Tier 5 (형상 관리 VCS 마커)**: `.git` 디렉터리 또는 Git 서브모듈 포인터 파일
6. **Tier 6 (최종 Fallback)**: `process.cwd()`

### 서브모듈 불변식 (Submodule Invariant)
Tier 3 설정 파일(`oa.config.*`)이 Tier 4 워크스페이스 및 Tier 5 VCS 마커보다 상위 우선순위를 가집니다. 따라서 Git 서브모듈 내부의 깊은 하위 경로에서 CLI를 실행하더라도 서브모듈 경계에서 중단되지 않고 상위 모노레포의 `oa.config.ts`를 올바르게 루트로 식별합니다.

---

## 6. 프로젝션 프로파일 (`specs`) 및 독립형 가드 (`guards`)

### 6.1 OpenAPI 3.1 프로젝션 프로파일 매트릭스
```typescript
export type OpenApiProjectionProfile = "component-bundle" | "operation-contract" | "full-api-document";
```

| 프로파일 (`profile`) | 목적 및 대상 도메인 | `paths` 검증 규칙 | `components.schemas` 검증 규칙 | 주요 산출물 |
|---|---|---|---|---|
| **`component-bundle`** | UI 엔티티, 스타일 블록, AST 메타데이터 모델 | 비어 있거나 생략 가능 | **반드시 존재**해야 하며 1개 이상의 스키마 포함 | `*.openapi.json` (Schemas 번들), Draft 2020-12 `$defs` |
| **`operation-contract`** | Native Messaging RPC, MCP Stdio 등 오퍼레이션 계약 | **반드시 존재**해야 하며 1개 이상의 오퍼레이션과 responses 포함 | 표준 OpenAPI 규칙 준수 | RPC/MCP 오퍼레이션 명세, RFC 9457 오류 응답 |
| **`full-api-document`** | 백엔드 종합 REST/HTTP API 명세서 | 표준 OpenAPI 3.1/3.2 규칙 준수 | 표준 OpenAPI 3.1/3.2 규칙 준수 | 단일 통합 OpenAPI 스펙 문서 |

### 6.2 독립형 정적 타입 가드 (`guards`)
Chrome Extension Manifest V3 등 엄격한 CSP 환경을 위한 순수 정적 가드 함수를 컴파일합니다:
- **무의존성 함수**: 런타임에 `ajv`, `zod`, `@oa-sdk/*`를 일절 import하지 않는 독립형 `is<TypeName>(data)` 함수 및 `.d.ts` 생성.
- **모듈 분할 (`split: true`)**: 트리쉐이킹 최적화를 위해 스키마별 개별 모듈(`guards/<Name>.js`) 분할 방출.
- **CSP 보안 감사 (`auditCsp: true`)**: 생성된 가드가 `eval` 및 `new Function`을 포함하지 않는지 정적으로 검증.

---

## 7. 종합 실무 설정 예제 (Real-World Recipes)

### 예제 1: Full-stack FSD Monorepo (`enterprise` 아키타입)
Fastify 백엔드와 TanStack Query 프론트엔드를 Feature-Sliced Design 디렉터리로 분산 라우팅하는 엔터프라이즈 구성:

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen"

export default defineConfig({
  rootDir: ".",

  // 1. 엔터프라이즈 생애주기 아키타입 선언 (엄격한 CI diff 게이트, 와이어 타이핑 활성화)
  archetype: "enterprise",

  // 2. 공유 플랫폼 코어 불변 규격
  core: {
    dialect: {
      oasVersion: "3.2.0",
      jsonSchemaDialect: "draft-2020-12",
      canonicalProjection: true,
    },
    contracts: {
      pureHandlers: true,
      contractName: "AppApiHandlers",
      banner: true,
    },
    client: {
      enabled: true,
      wireFormatSafety: true, // JsonPrimitive<T> wire-safety 적용
    },
    gates: {
      driftCheck: true,
      failOnBreaking: true,
      baseRef: "origin/main",
      preflightLint: "error",
    },
  },

  // 3. 제품 특화 도메인 확장 레이어
  product: {
    framework: "fastify",
    runtime: "node",
    jitSchema: true, // Fastify fast-json-stringify JIT 스키마 가속

    // 도메인 스펙 타겟
    specs: [
      {
        id: "main-api",
        profile: "full-api-document",
        schemaEntry: "packages/schemas/src/index.ts",
        outDir: "artifacts/specs",
        title: "Enterprise Core API",
        version: "1.0.0",
      },
    ],

    // 독립형 정적 타입 가드
    guards: {
      outDir: "packages/contracts/src/guards",
      split: true,
      moduleFormat: "esm",
      auditCsp: true,
    },

    // Feature-Sliced Design (FSD) 아티팩트 분산 라우팅
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

    // 핸들러 계약에 애플리케이션 컨텍스트 주입
    contextInjection: {
      typeName: "AppContext",
      importPath: "../../server/context.js",
      propertyKey: "app",
      fields: ["tenantId", "currentUser", "traceId"],
    },
  },
})
```

### 예제 2: 고성능 마이크로서비스 (`microservice` 아키타입)
Bun Elysia를 활용하여 제로 카피 컨텍스트 구조분해를 활성화한 마이크로서비스 구성:

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen"

export default defineConfig({
  archetype: "microservice",
  framework: "elysia",
  runtime: "bun",

  product: {
    zeroCopy: true, // Bun Elysia C++ Zero-copy 컨텍스트 구조분해
    specs: [
      {
        id: "order-service",
        profile: "full-api-document",
        schemaEntry: "src/schemas/index.ts",
        outDir: "dist/specs",
      },
    ],
    outputRouting: {
      pattern: "src/modules/{tag}/{tag}.{kind}.ts",
      casing: "camel",
    },
  },
})
```

### 예제 3: 빠른 프로토타이핑 MVP (`mvp` 아키타입)
실시간 목 서버와 빠른 반복을 위한 경량 MVP 구성:

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen"

export default defineConfig({
  archetype: "mvp",
  framework: "hono",
  runtime: "node",

  specs: [
    {
      id: "quick-api",
      profile: "full-api-document",
      schemaEntry: "./openapi.yaml",
      outDir: "./dist",
    },
  ],
})
```

---

## 8. 다중 포맷 비동기 설정 로더 (Multi-Format Config Loader)

`@oa-sdk/codegen`의 `loadOaConfig()` 함수(`packages/codegen/src/cli/lib/config-loader.ts`)는 다양한 개발 환경을 유연하게 수용합니다:

- **지원 포맷**: `oa.config.ts`, `oa.config.mjs`, `oa.config.json`, `.oarc.json`
- **동적/비동기 팩토리 함수**: 정적 객체뿐 아니라 함수(`export default () => ({ ... })`) 및 비동기 함수(`export default async () => ({ ... })`)를 자동 평가합니다.
- **Node.js 네이티브 타입 스트리퍼 Fallback**: Node 22/24의 `strip-only mode`에서 TypeScript `enum`이나 데코레이터 구문으로 인해 에러가 발생할 경우, 자동으로 `typescript.transpileModule`을 통해 메모리/임시 트랜스파일 후 안전하게 평가 및 정리(`finally { unlink }`)합니다.
- **런타임 스키마 무결성 검증 (`assertOaConfig`)**: 타겟 ID 중복(`Duplicate spec target id`), 유효하지 않은 아키타입, 잘못된 프로파일 이름을 로딩 시점에 엄격히 검증하여 안전한 피드백을 제공합니다.

---

## 9. 무인자 CLI 일괄 실행 파이프라인 (Zero-Argument CLI Pipeline)

`oa.config.ts`가 구성된 프로젝트에서는 별도의 복잡한 플래그 없이 다음 명령어로 전체 파이프라인을 구동할 수 있습니다:

```bash
# 1. 모든 등록 스펙 프로파일 일괄 검증
npx oa-gen validate

# 2. 스펙 프로젝션 -> 정적 가드 -> 순수 핸들러 계약 -> 클라이언트 SDK -> TanStack Query 옵션 일괄 생성 및 outputRouting 디스패치
npx oa-gen generate

# 3. CI 스펙 드리프트 게이트 실행 (RFC 8785 결정론적 해시 일치 검증)
npx oa-gen drift:check

# 4. 베이스라인 대비 시맨틱 브레이킹 체인지 차단
npx oa-gen diff --base origin/main --head ./artifacts/specs/main-api.json --fail-on-breaking

# 5. 독립형 정적 타입 가드의 Manifest V3 CSP 보안 감사
npx oa-gen audit:csp --bundle ./packages/contracts/src/guards
```

---

## 10. 다음 단계 및 참조 문서

- [CLI 설치 및 환경 설정 가이드](./cli-setup.md) — 패키지 매니저 매트릭스, 로컬 devDependencies, 런타임 요건
- [Quick Start](./quick-start.md) — 5분 빠른 시작 가이드
- [프로젝트 온보딩 플레이북](./onboarding-playbook.md) — 3계층 온보딩 사다리 (Fastify, Elysia, Express, NestJS)
- [CLI 명령 레퍼런스](./cli-command-reference.md) — 전체 서브커맨드 색인
