# 선언적 스펙 및 거버넌스 설정 (oa.config.ts)

> **Canonical Authority**: @oa-sdk/codegen & @oa-sdk/core  
> **Schema Governance Specification**: oa.config.ts / oa.config.json  
> **Supported Profiles**: `component-bundle`, `operation-contract`, `full-api-document`  
> **Target Environments**: Monorepos, Deep Nested Subdirectories, Git Submodules, Headless CI  

---

## 1. 개요 (Overview)

`oa-sdk`는 모노레포 및 대규모 분산 패키지 환경에서 수십 개의 도메인 스펙과 타입 가드를 중앙 집중적이면서도 일관되게 관리할 수 있는 **선언적 설정 파일(`oa.config.ts`)** 체계를 제공합니다.

루트 또는 각 패키지 루트에 `oa.config.ts`를 선언하면:
1. 어느 깊이의 하위 디렉터리(`packages/*`)나 중첩 서브모듈에서 CLI를 실행하더라도 **프로젝트 루트가 자동으로 탐색**됩니다.
2. CLI 옵션 인자 없이 `oa-gen validate` 또는 `oa-gen generate`를 실행하는 것만으로 **설정된 모든 도메인 프로파일이 일괄 처리**됩니다.
3. 빌드 타임에 소스 스키마(Zod AST)와 커밋된 스펙 아티팩트 간의 **스펙 드리프트(Drift)가 결정론적 SHA-256 해시로 자동 감지**됩니다.

---

## 2. 계층적 상향 프로젝트 루트 탐색 (Project Root Resolution)

`@oa-sdk/core`의 `findProjectRoot()` 함수는 임의의 작업 디렉터리(cwd)에서 상향 탐색(Upward Traversal)을 수행하여 아래의 **6단계 우선순위**에 따라 루트 디렉터리를 결정합니다.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    프로젝트 루트 식별 6단계 우선순위                        │
├───────────────────────────────────────────────────────────────────────────┤
│ 1. CLI 명시 옵션: --project-root <dir> 또는 --root <dir>                  │
│    ⬇ (미지정 시)                                                          │
│ 2. 환경 변수: process.env.OA_PROJECT_ROOT                                  │
│    ⬇ (미설정 시)                                                          │
│ 3. 스펙 설정 파일: oa.config.ts, oa.config.mjs, oa.config.json, .oarc.json│
│    ⬇ (미발견 시)                                                          │
│ 4. 모노레포 워크스페이스 마커: pnpm-workspace.yaml, turbo.json, lerna.json│
│    ⬇ (미발견 시)                                                          │
│ 5. 형상 관리(VCS) 마커: .git                                              │
│    ⬇ (미발견 시)                                                          │
│ 6. 최종 Fallback: process.cwd()                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 서브모듈 불변식 (Submodule Invariant)
중첩된 Git 서브모듈(예: `packages/browser-mapper`) 내부에 자체 `.git` 파일이나 워크스페이스 마커가 존재하더라도, 상위 디렉터리에 `oa.config.ts`가 선언되어 있다면 **상위 모노레포의 루트가 우선 식별**되어 상대 경로 깨짐 없이 정상 동작합니다.

---

## 3. 설정 파일 작성법 (Authoring oa.config.ts)

`defineConfig` 헬퍼를 사용하여 완벽한 타입 추론과 검증을 지원합니다.

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen";

export default defineConfig({
  // 상대 경로 해석의 기준 디렉터리 (기본값: oa.config.ts가 위치한 디렉터리)
  rootDir: ".",

  // 도메인별 OpenAPI 프로젝션 타겟 목록
  specs: [
    {
      id: "devlink-contracts",
      profile: "operation-contract", // 단일 스트림 RPC 및 MCP stdio 프로파일
      schemaEntry: "packages/devlink-contracts/src/schema/index.ts",
      outDir: "artifacts/specs",
      title: "DevLink Native RPC Operation Contract",
      version: "1.0.0",
    },
    {
      id: "surface-engine",
      profile: "component-bundle", // 컴포넌트 재사용 스키마 번들 프로파일
      schemaEntry: "packages/surface-engine/src/schema/index.ts",
      outDir: "artifacts/specs",
      title: "Surface Engine Component Bundle",
      version: "1.0.0",
    },
  ],

  // 독립형 정적 타입 가드(Standalone Type Guards) 생성 설정
  guards: {
    outDir: "dist/guards",
    split: true,          // 스키마별 개별 모듈(guards/<Name>.js) 분할 방출
    moduleFormat: "esm",  // 순수 정적 ESM 포맷
    auditCsp: true,       // Manifest V3 CSP(eval, new Function 방지) 자동 감사
  },
});
```

### 프로파일 종류 (`profile`)
1. **`component-bundle`**: UI 컴포넌트, Visual-IR, 엔티티 스펙 등 재사용 가능한 스키마 번들 (`paths`가 비어 있어도 유효).
2. **`operation-contract`**: Native RPC, Webhook, MCP Tool 등 최소 1개 이상의 오퍼레이션을 포함하는 단일 스트림 작업 계약.
3. **`full-api-document`**: 표준적인 REST/HTTP OpenAPI 3.1 전체 문서.

---

## 4. CLI 무인자 실행 파이프라인 (Zero-Argument CLI Dispatch)

`oa.config.ts`가 존재하는 환경에서는 옵션 없이 명령어를 실행하여 모노레포 전역 파이프라인을 구동합니다.

### 1) 일괄 유효성 검증 (`oa-gen validate`)
```bash
# 프로젝트 루트 또는 임의의 하위 디렉터리에서 실행
pnpm exec oa-gen validate
```
설정 파일에 등록된 모든 `specs` 타겟을 순차적으로 검증하고, 프로파일 제약 조건(`profile`) 및 스키마 구조를 진단하여 종합 테이블 리포트를 출력합니다.

### 2) 일괄 아티팩트 및 가드 생성 (`oa-gen generate`)
```bash
pnpm exec oa-gen generate
```
설정된 모든 도메인의 OpenAPI 스펙과 JSON Schema 2020-12를 프로젝션하고, `guards` 설정에 따라 순수 정적 타입 가드를 자동 컴파일합니다.

### 3) CSP 보안 감사 (`oa-gen audit:csp`)
```bash
pnpm exec oa-gen audit:csp --bundle dist/guards
```
생성된 자바스크립트 번들에 `eval()`, `new Function()`, 문자열 `setTimeout`, 런타임 `zod`/`ajv` 등 Manifest V3 보안 위반 패턴이 포함되어 있는지 정적 분석합니다.

---

## 5. 스펙 드리프트 감지 & 시맨틱 브레이킹 제어

### 1) 결정론적 스펙 해시 (`x-schema-engine-version-hash`)
`spec-projector.ts`는 플랫폼(Windows CRLF, macOS/Linux LF)에 무관하게 동일한 결과가 나오도록 RFC 8785 기반 키 정렬, 줄바꿈 정규화, 가변 타임스탬프 제거를 거쳐 결정론적 SHA-256 해시를 생성합니다.

### 2) 신선도 및 드리프트 검증 (`oa-gen drift:check`)
```bash
# CI 파이프라인에서 실행 권장
pnpm exec oa-gen drift:check
# 또는
pnpm exec oa-gen check-artifact
```
소스 코드(Zod AST)를 인메모리 프로젝션한 해시와 커밋된 `artifacts/specs/*.openapi.json`의 해시를 대조하여, 소스 코드가 수정되었음에도 스펙 아티팩트가 갱신되지 않은 드리프트를 감지(exit code 1)합니다.

### 3) 시맨틱 브레이킹 체인지 차단 (`oa-gen diff --fail-on-breaking`)
```bash
pnpm exec oa-gen diff --base artifacts/specs/base.json --head artifacts/specs/head.json --fail-on-breaking
```
11가지 엔드포인트 규칙 및 7가지 컴포넌트 스키마 규칙(타입 변경, 프로퍼티 제거, 제약 조건 축소 등)을 검사하여 하위 호환성을 파괴하는 변경이 감지되면 빌드를 중단합니다.
