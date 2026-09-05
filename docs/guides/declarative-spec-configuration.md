# 선언적 사양 설정 가이드 (oa.config.ts)

> **Canonical Authority**: `@oa-sdk/codegen` & `@oa-sdk/core`  
> **Schema Governance Specification**: `oa.config.ts` / `oa.config.mjs` / `oa.config.json` / `.oarc.json`  
> **Supported Profiles**: `component-bundle`, `operation-contract`, `full-api-document`  
> **Target Environments**: Monorepos, Deep Nested Subdirectories, Git Submodules, Headless CI  

---

## 1. 개요 (Overview)

`@oa-sdk`는 모노레포 및 대규모 분산 패키지 환경에서 수십 개의 도메인 스펙과 독립형 정적 타입 가드를 중앙 집중적이면서도 일관되게 관리할 수 있는 **선언적 설정 파일(`oa.config.ts`)** 체계를 제공합니다.

루트 또는 패키지 디렉터리에 `oa.config.ts`를 선언하면 다음과 같은 핵심 거버넌스 파이프라인이 활성화됩니다:

1. **계층적 상향 프로젝트 루트 자동 탐색**: 어느 깊이의 하위 디렉터리(`packages/*`)나 중첩 Git 서브모듈에서 CLI를 실행하더라도 최상위 프로젝트 루트를 안정적으로 식별하여 상대 경로 깨짐을 방지합니다.
2. **CLI 무인자 일괄 디스패치**: 별도의 인자 없이 `oa-gen validate` 또는 `oa-gen generate`를 호출하는 것만으로 설정에 등록된 모든 도메인 프로파일(`specs`)과 독립형 타입 가드(`guards`)를 일괄 처리합니다.
3. **다중 포맷 비동기 설정 로더**: TypeScript(`.ts`), ESM(`.mjs`), CommonJS(`.cjs`), JSON(`.json`, `.oarc.json`)뿐만 아니라 동적 팩토리 함수(`export default () => ({ ... })` 및 비동기 `async () => ({ ... })`)를 투명하게 지원합니다.
4. **결정론적 스펙 해시 및 드리프트 감지**: 소스 스키마(Zod AST)와 커밋된 스펙 아티팩트 간의 일치 여부를 RFC 8785 기반 정규화 해시(`x-schema-engine-version-hash`)로 감지하여 CI에서 변경 누락을 차단합니다.
5. **Manifest V3 CSP 보안 감사**: 생성된 독립형 타입 가드가 Chrome Extension Manifest V3 Content Security Policy(`eval` 및 `new Function` 금지)를 100% 준수하는지 정적으로 검증합니다.

---

## 2. 계층적 상향 프로젝트 루트 탐색 (Project Root Resolution)

`@oa-sdk/core`의 `findProjectRoot()` 및 `findProjectRootDetail()` 함수는 임의의 작업 디렉터리(`cwd`)에서 상향 디렉터리 순회(Upward Traversal)를 수행하여 아래의 **6단계 우선순위(6-Tier Precedence)**에 따라 루트 디렉터리를 결정합니다.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    프로젝트 루트 식별 6단계 우선순위 (6 Tiers)               │
├───────────────────────────────────────────────────────────────────────────┤
│ Tier 1. CLI 명시 옵션: --project-root <dir> 또는 --root <dir>              │
│    ⬇ (미지정 시)                                                          │
│ Tier 2. 환경 변수: process.env.OA_PROJECT_ROOT                            │
│    ⬇ (미설정 또는 공백 시)                                                 │
│ Tier 3. 스펙 설정 파일: oa.config.ts, oa.config.mjs, oa.config.json,      │
│         .oarc.json                                                        │
│    ⬇ (전체 조상 디렉터리 탐색 후 미발견 시)                                  │
│ Tier 4. 모노레포 워크스페이스 마커: pnpm-workspace.yaml, turbo.json,       │
│         lerna.json, package.json (workspaces 필드 정의)                   │
│    ⬇ (미발견 시)                                                          │
│ Tier 5. 형상 관리(VCS) 마커: .git 디렉터리 또는 .git 서브모듈 포인터 파일   │
│    ⬇ (미발견 시)                                                          │
│ Tier 6. 최종 Fallback: process.cwd()                                      │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2.1 계층별 상세 탐색 규칙

1. **Tier 1 (명시적 CLI 인자)**:
   - CLI 플래그 `--root <path>` 또는 `--project-root <path>`(또는 프로그래밍 방식의 `explicitRoot`)가 전달되면 최우선으로 적용됩니다.
   - 인자로 파일 경로(예: `packages/codegen/oa.config.ts`)가 전달된 경우 `path.dirname()`을 통해 해당 파일이 위치한 디렉터리를 자동으로 루트로 계산합니다.
   - CLI 실행기(`runCommand`)는 빈 문자열(`--root ""`) 입력을 거부하며, 올바른 경로를 요구하는 명확한 진단 메시지를 반환합니다.
2. **Tier 2 (환경 변수)**:
   - `process.env.OA_PROJECT_ROOT`(또는 커스텀 지정된 `envVarName`)를 검사합니다.
   - 파일 경로인 경우 `path.dirname()`으로 디렉터리를 추출하며, 공백만으로 구성된 값은 무시하고 Tier 3으로 넘어갑니다.
3. **Tier 3 (스펙 설정 파일 후보)**:
   - 조상 디렉터리를 순회하며 `oa.config.ts` → `oa.config.mjs` → `oa.config.json` → `.oarc.json` 순서로 파일 존재 여부를 검사합니다.
   - 가장 가까운 조상 디렉터리에서 발견된 설정 파일의 위치를 루트로 반환합니다.
4. **Tier 4 (모노레포 워크스페이스 마커)**:
   - `pnpm-workspace.yaml`, `turbo.json`, `lerna.json`, 그리고 `workspaces` 속성(배열 또는 `{ packages: [...] }` 객체)이 포함된 `package.json`을 검사합니다.
   - 워크스페이스 속성이 없는 리프 패키지의 `package.json`이나 파싱 불가능한 JSON은 건너뜁니다.
5. **Tier 5 (VCS 마커)**:
   - 디렉터리 형태의 `.git` 또는 Git 서브모듈 포인터 파일(`gitdir: ../../.git/modules/...` 형식)을 검사합니다.
6. **Tier 6 (Fallback)**:
   - 어떠한 마커도 발견되지 않으면 현재 실행 디렉터리 `process.cwd()`를 최종 루트로 사용합니다.

### 2.2 서브모듈 불변식 (Submodule Invariant)

대규모 모노레포에서는 하위 디렉터리에 Git 서브모듈(예: `browser-studio` 내의 `packages/browser-mapper`)이 포함될 수 있습니다. 서브모듈 디렉터리 내부에는 자체 `.git` 파일과 `pnpm-workspace.yaml` 마커가 존재합니다.

`findProjectRootDetail()`은 **서브모듈 불변식**을 보장하도록 설계되었습니다:
- 조상 디렉터리 전체를 파일시스템 루트까지 상향 검색하면서 **Tier 3 설정 파일(`oa.config.*`)을 Tier 4(워크스페이스) 및 Tier 5(VCS) 마커보다 먼저 확인**합니다.
- 따라서 서브모듈 내부의 깊은 하위 경로에서 CLI를 실행하더라도, 서브모듈 경계에서 조기 중단되지 않고 상위 모노레포에 위치한 `oa.config.ts`가 존재하는 디렉터리를 올바르게 루트로 식별합니다.
- 단, 서브모듈 자체 디렉터리에 별도의 `oa.config.*`가 명시되어 있다면 가장 가까운 서브모듈 루트가 선택됩니다.

### 2.3 전역 CLI 플래그 (`--root` / `--project-root`)

모든 `oa-gen` 명령어(`generate`, `validate`, `lint`, `audit:csp`, `typegen`, `diff`, `collect`)는 글로벌 옵션으로 `--root` 및 `--project-root`를 지원합니다.

CLI 러너(`packages/codegen/src/cli/lib/run.ts`)는 하위 명령어가 디스패치되기 전에 이 플래그를 가로채어:
1. `findProjectRoot({ cwd, explicitRoot })`로 프로젝트 루트를 계산합니다.
2. `process.chdir(projectRoot)`를 호출하여 프로세스 작업 디렉터리를 프로젝트 루트로 일시 전환합니다.
3. 명령 실행이 완료되거나 예외가 발생하더라도 `finally { process.chdir(originalCwd) }` 블록을 통해 원래의 작업 디렉터리를 안전하게 복원합니다.

---

## 3. 설정 파일 작성법 (Authoring oa.config.ts)

### 3.1 `defineConfig` 및 타입 인터페이스

`@oa-sdk/codegen`은 완벽한 TypeScript 타입 추론과 IDE 자동 완성을 제공하는 `defineConfig` 헬퍼 함수를 제공합니다.

```typescript
import { z } from "zod";

/** 지원되는 3가지 OpenAPI 3.1 프로젝션 프로파일 */
export const OPENAPI_PROJECTION_PROFILES = [
  "component-bundle",
  "operation-contract",
  "full-api-document",
] as const;

export type OpenApiProjectionProfile = (typeof OPENAPI_PROJECTION_PROFILES)[number];

/** 도메인별 OpenAPI 프로젝션 타겟 설정 */
export interface ProfileTargetConfig {
  /** 타겟 고유 식별자 (specs 배열 내 유일해야 함) */
  id: string;
  /** 프로젝션 프로파일 유형 */
  profile: OpenApiProjectionProfile;
  /** Zod 스키마 진입점 모듈 경로 (rootDir 상대 경로 또는 절대 경로) */
  schemaEntry: string;
  /** 결과물이 방출될 출력 디렉터리 경로 */
  outDir: string;
  /** 생성될 OpenAPI 문서의 제목 (선택) */
  title?: string | undefined;
  /** 생성될 스펙 문서 버전 (선택, 예: '1.0.0') */
  version?: string | undefined;
}

/** 독립형 정적 타입 가드 컴파일 설정 */
export interface GuardTargetConfig {
  /** 독립형 가드 코드가 방출될 출력 디렉터리 (예: 'dist/guards') */
  outDir: string;
  /** 개별 스키마별 모듈(guards/<Name>.js) 분할 방출 여부 (기본값: false) */
  split?: boolean | undefined;
  /** 방출될 모듈 포맷 ('esm' | 'cjs', 기본값: 'esm') */
  moduleFormat?: "esm" | "cjs" | undefined;
  /** Chrome Extension Manifest V3 CSP 정적 보안 검사 수행 여부 */
  auditCsp?: boolean | undefined;
}

/** oa-sdk 통합 선언적 거버넌스 설정 */
export interface OaConfig {
  /** 상대 경로 해석의 기준 디렉터리 (기본값: 설정 파일이 위치한 디렉터리) */
  rootDir?: string | undefined;
  /** 도메인별 스펙 프로젝션 타겟 목록 */
  specs?: ProfileTargetConfig[] | undefined;
  /** 독립형 정적 타입 가드 생성 설정 */
  guards?: GuardTargetConfig | undefined;
  /** 하위 호환용 레거시 스키마 맵 (선택) */
  schemas?: Record<string, z.ZodTypeAny> | undefined;
}

/** 타입 세이프 설정 헬퍼 */
export function defineConfig(config: OaConfig): OaConfig {
  return config;
}
```

### 3.2 3가지 프로젝션 프로파일 및 가드 전체 설정 예제

다음은 3가지 프로젝션 프로파일(`component-bundle`, `operation-contract`, `full-api-document`)과 독립형 타입 가드(`guards`)를 모두 포함한 완전한 `oa.config.ts` 작성 예제입니다.

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen";

export default defineConfig({
  // 상대 경로 해석의 기준 디렉터리 (기본값: 설정 파일 위치 디렉터리)
  rootDir: ".",

  // 도메인별 OpenAPI 3.1 프로젝션 타겟 목록
  specs: [
    // 1. 컴포넌트 번들 프로파일 (Component Bundle)
    // - UI 컴포넌트, Visual-IR, 엔티티 모델 등 재사용 가능한 스키마 번들
    // - components.schemas 필수, paths는 비어 있거나 생략 가능
    {
      id: "surface-engine",
      profile: "component-bundle",
      schemaEntry: "packages/surface-engine/src/schema/index.ts",
      outDir: "artifacts/specs",
      title: "Surface Engine Component Bundle",
      version: "1.0.0",
    },

    // 2. 오퍼레이션 계약 프로파일 (Operation Contract)
    // - Chrome Native Messaging RPC, MCP Stdio 등 단일 스트림 작업 계약
    // - paths 필수 (최소 1개 이상의 오퍼레이션과 responses 선언 필요)
    {
      id: "devlink-contracts",
      profile: "operation-contract",
      schemaEntry: "packages/devlink-contracts/src/schema/index.ts",
      outDir: "artifacts/specs",
      title: "DevLink Native RPC Operation Contract",
      version: "1.0.0",
    },

    // 3. 전체 API 문서 프로파일 (Full API Document)
    // - 외부 개발자용 REST/HTTP 종합 OpenAPI 3.1 명세서
    // - info, servers, paths, components가 포함된 표준 OpenAPI 3.1 문서
    {
      id: "gateway-api",
      profile: "full-api-document",
      schemaEntry: "packages/gateway/src/schema/index.ts",
      outDir: "artifacts/specs",
      title: "Browser Studio Gateway REST API",
      version: "1.0.0",
    },
  ],

  // 독립형 정적 타입 가드(Standalone Type Guards) 생성 설정
  guards: {
    outDir: "dist/guards",
    split: true,          // 스키마별 개별 모듈(guards/<Name>.js, guards/<Name>.d.ts) 분할 방출
    moduleFormat: "esm",  // 'esm' (순수 정적 ES 모듈) 또는 'cjs' (CommonJS)
    auditCsp: true,       // 빌드 직후 Manifest V3 CSP(eval, new Function 방지) 자동 감사
  },
});
```

### 3.3 프로젝션 프로파일 비교 매트릭스

| 프로파일 (`profile`) | 목적 및 대상 도메인 | `paths` 검증 규칙 | `components.schemas` 검증 규칙 | 주요 산출물 |
|---|---|---|---|---|
| **`component-bundle`** | UI 엔티티, 스타일 블록, AST 메타데이터 모델 (`surface-engine`, `visual-ir`, `inspector-controls`) | `paths`가 없거나 빈 객체(`{}`)여도 유효 | `components.schemas`가 **반드시 존재**해야 하며 1개 이상의 스키마를 포함해야 함 | `*.openapi.json` (Schemas 번들), Draft 2020-12 `$defs` |
| **`operation-contract`** | DevLink Native Messaging RPC (`/rpc/{method}`), MCP stdio 도구 (`/mcp/{operation}`) | `paths`가 **반드시 존재**해야 하며 최소 1개 이상의 HTTP Operation과 `responses`를 선언해야 함 | 표준 OpenAPI 3.1 규칙 준수 (선택) | RPC/MCP 오퍼레이션 명세, RFC 9457 `ProblemDetails` 오류 응답 |
| **`full-api-document`** | 모놀리식 백엔드 REST API, 공개 Gateway API | 표준 호스트 레벨 OpenAPI 3.1 유효성 규칙 준수 | 표준 OpenAPI 3.1 유효성 규칙 준수 | 단일 통합 OpenAPI 3.1 스펙 문서 |

### 3.4 독립형 정적 타입 가드 (Standalone Guards)

`guards` 블록이 설정되면, `@oa-sdk/codegen`은 모든 타겟의 스키마를 수집하여 AJV 2020 엔진 기반의 정적 가드 코드를 방출합니다:

1. **무의존성 정적 함수**: 런타임에 `zod`, `ajv`, `@oa-sdk/*`를 일절 import하지 않는 순수 정적 JavaScript 함수(`is<TypeName>(data)`)와 TypeScript 타입 선언(`.d.ts`)을 생성합니다.
2. **내장 포맷 정규식**: `date-time`, `date`, `time`, `duration`, `uri`, `uri-reference`, `email`, `hostname`, `ipv4`, `ipv6`, `uuid` 등 Draft 2020-12 / OAS 3.1 표준 포맷 검사 함수를 번들 내부에 자체 인라인화합니다.
3. **모듈 분할 (`split: true`)**: 루트 `index.js`와 함께 `guards/<Name>.js` 및 `guards/<Name>.d.ts`로 개별 분할 방출하여 브라우저 확장 프로그램의 트리쉐이킹 효율을 극대화합니다.
4. **Manifest V3 100% 준수**: 동적 코드 컴파일(`eval`, `new Function`)을 사용하지 않아 Chrome Extension Manifest V3 CSP 환경에서 즉시 실행 가능합니다.

### 3.5 다중 포맷 비동기 설정 로더 (Multi-Format Config Loader)

`@oa-sdk/codegen`의 `loadOaConfig()` 함수(`packages/codegen/src/cli/lib/config-loader.ts`)는 대규모 개발 환경의 다양한 빌드 셋업을 수용합니다:

- **다중 파일 포맷 지원**:
  1. `oa.config.ts` (TypeScript)
  2. `oa.config.mjs` (ES Module)
  3. `oa.config.json` (JSON)
  4. `.oarc.json` (도트 접두사 JSON)
- **동적 팩토리 함수 지원**:
  정적 객체뿐 아니라 함수형 설정(`export default () => ({ ... })`) 및 비동기 함수형 설정(`export default async () => ({ ... })`)을 지원하며, 로더가 자동으로 `await`하여 평가합니다.
- **Node.js 네이티브 타입 스트리퍼 Fallback**:
  Node.js의 기본 TS 실행 환경에서 TypeScript `enum`, 데코레이터 등 미지원 구문으로 인해 `ERR_UNKNOWN_FILE_EXTENSION` 또는 `strip-only mode` 에러가 발생하는 경우, 로더가 자동으로 감지하여 `typescript.transpileModule`을 통한 안전한 메모리/임시 트랜스파일(`.tmp-oa-*.mjs`)로 폴백 실행 후 즉시 정리(`finally { unlink }`)합니다.
- **경로 정규화 (`rootDir`)**:
  `config.rootDir`가 상대 경로인 경우 설정 파일이 위치한 디렉터리를 기준으로 절대 경로로 정규화되며, 각 타겟의 `schemaEntry` 및 `outDir` 역시 정규화된 `rootDir`를 기준으로 안정적으로 해석됩니다.
- **런타임 스키마 무결성 검증 (`assertOaConfig`)**:
  `id` 중복 등록 여부(중복 시 `Duplicate spec target id ...` 에러 발생), 허용된 프로파일 이름, 필수 경로 필드의 유효성을 로딩 시점에 엄격하게 검증합니다.

---

## 4. CLI 무인자 실행 파이프라인 (Zero-Argument CLI Dispatch)

`oa.config.ts`가 구성된 환경에서는 별도의 CLI 파라미터를 입력하지 않아도 모노레포 전체 파이프라인이 유기적으로 구동됩니다.

### 1) 일괄 유효성 검증 (`oa-gen validate`)

```bash
# 프로젝트 루트 또는 임의의 하위 디렉터리에서 실행
pnpm exec oa-gen validate
```

- `oa.config.ts`의 모든 `specs` 타겟을 로드합니다.
- 각 프로파일 규칙(`component-bundle`의 `components.schemas` 존재 여부, `operation-contract`의 오퍼레이션 및 응답 정의 여부)을 진단합니다.
- 전체 타겟에 대한 종합 진단 테이블과 성공/실패 여부를 출력합니다.

### 2) 일괄 아티팩트 및 가드 생성 (`oa-gen generate`)

```bash
pnpm exec oa-gen generate
```

- 모든 타겟의 Zod 스키마를 평가하여 OpenAPI 3.1 문서 및 JSON Schema Draft 2020-12 아티팩트를 `outDir`에 방출합니다.
- `guards` 설정이 존재할 경우, 모든 도메인 스키마를 집합하여 독립형 정적 타입 가드(`dist/guards`)를 즉시 컴파일합니다.

### 3) CSP 보안 감사 (`oa-gen audit:csp`)

```bash
pnpm exec oa-gen audit:csp --bundle dist/guards
```

- 방출된 모든 정적 자바스크립트 파일의 AST를 검사하여 `eval()`, `new Function()`, 문자열 `setTimeout`/`setInterval`, 그리고 금지된 런타임 패키지(`zod`, `ajv`, `@oa-sdk/*`)의 유입 여부를 전수 검사합니다.

---

## 5. 스펙 드리프트 감지 & 시맨틱 브레이킹 제어

### 1) 결정론적 스펙 해시 (`x-schema-engine-version-hash`)

`spec-projector.ts`는 운영체제(Windows CRLF vs macOS/Linux LF)나 빌드 시점의 타임스탬프 차이로 인해 스펙 해시가 달라지는 문제를 방지하기 위해 결정론적 해시 계산을 수행합니다:

1. 문서 내 모든 가변 메타데이터 및 `x-schema-engine-*` 확장 속성을 해시 대상에서 사전에 제거(`stripSchemaEngineExtensions`).
2. RFC 8785(JSON Canonicalization Scheme) 표준에 따라 모든 객체 키를 UTF-16 코드 유닛 순서로 정렬.
3. 줄바꿈 문자를 `\n`(LF)으로 표준화한 후 SHA-256 해시(`sha256:<64자 16진수>`)를 산출.

### 2) 신선도 및 드리프트 검증 (`oa-gen drift:check`)

```bash
# CI 파이프라인에서 실행
pnpm exec oa-gen drift:check
# 또는
pnpm exec oa-gen check-artifact
```

- 소스 코드(Zod TS 정의)를 메모리 상에서 프로젝션하여 최신 해시를 산출합니다.
- 이미 커밋되어 있는 아티팩트 파일(`artifacts/specs/*.openapi.json`)의 `x-schema-engine-version-hash`와 대조합니다.
- 소스 코드가 수정되었는데 아티팩트가 재생성되지 않은 경우, 즉시 실패(exit code 1) 처리하여 스펙 불일치를 방지합니다.

### 3) 시맨틱 브레이킹 체인지 차단 (`oa-gen diff --fail-on-breaking`)

```bash
pnpm exec oa-gen diff --base artifacts/specs/base.json --head artifacts/specs/head.json --fail-on-breaking
```

- 두 스펙 버전 간의 구조적 차이를 시맨틱 수준에서 비교합니다:
  - **11가지 엔드포인트 규칙**: 엔드포인트 삭제, 오퍼레이션 ID 변경, 필수 요청 바디 추가, 성공 응답 코드 제거 등.
  - **7가지 컴포넌트 스키마 규칙**: 프로퍼티 타입 변경, 필수 프로퍼티 추가, 열거형(enum) 값 제거, 수치 경계 축소(`minimum` 증가 등).
- 하위 호환성을 파괴하는 변경 사항이 감지되면 빌드를 중단하여 클라이언트 및 런타임 호환성을 보장합니다.
