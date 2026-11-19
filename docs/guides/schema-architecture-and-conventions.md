---
docType: explanation
sourceLocale: ko
canonical: true
audience:
  competence: competent
productVersions:
  - "@oa-sdk/codegen 0.10.0"
  - "@oa-sdk/openapi-projection-contract 0.2.0"
owner: "OA SDK maintainers"
status: active
lastReviewed: "2026-10-06"
sourceOfTruth:
  - packages/codegen/src/spec-projector.ts
  - packages/codegen/src/cli/commands/generate.ts
  - packages/openapi-projection-contract/src/index.ts
---

# 스키마 아키텍처와 파이프라인

이 문서는 두 부분으로 나뉩니다.

- **1부 oa-sdk 스키마 파이프라인**: `oa-gen`이 원본에서 OpenAPI 문서, JSON Schema, 타입 가드, 클라이언트, 핸들러 계약을
  만드는 실제 흐름입니다. `@oa-sdk/codegen` 0.10.0 기준이며 외부 프로젝트와 이 저장소 모두에 해당합니다.
- **[부록 Browser Studio 스키마 표준](#부록-browser-studio-스키마-표준-외부-저장소-사례)**: oa-sdk를 쓰는 외부 저장소
  Browser Studio의 규범 문서를 사례로 옮긴 것입니다. 그 안의 패키지와 경로(`@browser-studio/*`, `packages/devlink-contracts`,
  `packages/surface-engine`, `schemas/transitions/video-transitions.tsp` 등)는 이 저장소에 없으며, RFC 9457 오류 형식 같은
  규칙은 Browser Studio의 선택입니다.

oa-sdk가 해결하는 문제와 가치는 [가이드 색인](./README.md#oa-sdk가-해결하는-문제와-핵심-가치)에, 이 저장소의 production
계약을 다루는 방법은 [기본 스펙 사용 기준](./basic-spec-usage.md)에, `oa.config.ts` 항목별 동작은
[선언적 스펙 설정 가이드](./declarative-spec-configuration.md)에 있으며,
Storage(Atlas), Logical(DPM), API(TypeSpec), Behavior(XState) 4계층 분리와 ttsc/Atlas 연계 경계는
[멀티 티어 스키마 및 ttsc·Atlas 가이드](./schema-architecture-and-ttsc-guide.md)에 있습니다.


---

# 1부. oa-sdk 스키마 파이프라인

## 원본에서 생성물까지

사람이 고치는 원본은 `oa.config.ts` spec target의 `schemaEntry`입니다. 나머지는 모두 원본에서 다시 만들 수 있는 생성물입니다.

```text
원본 (schemaEntry)
  .tsp  |  OpenAPI YAML·JSON  |  Zod 스키마를 export하는 TypeScript 모듈
     │
     │  oa-gen generate  (spec target마다)
     ▼
<id>.openapi.json   OpenAPI 문서 + x-schema-engine-* 메타데이터
<id>.schema.json    JSON Schema 2020-12 ($defs)
     │
     ├─ guards 설정             → 독립형 타입 가드 is<Name>() + .d.ts
     ├─ @oa-sdk/router          → 핸들러 계약 <id>.contract.ts, 대상 프레임워크가 있으면 라우터 <id>.router.ts
     ├─ @oa-sdk/client          → fetch 클라이언트 <id>.client.ts, TanStack Query <id>.keys.ts·<id>.queries.ts
     └─ x-oa-sdk-crdt-entity    → CRDT 모듈 4개 (스펙에 있을 때만)
```

`@oa-sdk/router`, `@oa-sdk/client`는 `oa-gen`이 실행 중 불러오는 동반 패키지(companion package)입니다. 없을 때의 동작은
[선언적 스펙 설정 가이드](./declarative-spec-configuration.md#명시적-요청과-암시적-기본값-동반-패키지)에 있습니다.
`oa-gen generate`는 대상 프레임워크(`core.router.target`, 없으면 `specs[].target`, 그다음 `product.framework`)가
`hono`·`express`·`fastify`·`elysia`이면 계약 옆에 라우터(`<id>.router.ts`)도 만들고, 실행할 때마다 다시 씁니다. 빌드
스크립트에서 `@oa-sdk/router`의 `generateRouter()`로 라우터를 직접 만들 때는 `core.router.target`을 `generic`으로 두어
끄거나 다른 경로에 씁니다([선언적 스펙 설정 가이드 2.2절](./declarative-spec-configuration.md#22-서버-쪽-생성물의-범위)).

`oa-gen generate`는 `<id>.openapi.json`에 다음 메타데이터를 붙입니다(`@oa-sdk/openapi-projection-contract`의 상수).

| 확장 | 내용 |
|---|---|
| `x-schema-engine-profile` | spec target의 `profile` |
| `x-schema-engine-version-hash` | 메타데이터를 뺀 문서의 결정적 hash (`sha256:...`, 키 순서는 RFC 8785) |
| `x-schema-engine-sources` | component 이름별 원본 위치 (`kind`, `filePath`, `pointer`) |
| `x-schema-engine-refs` | 문서 안 `$ref` 엣지 (`from`, `to`, `ref`) |
| `x-oa-sdk-trace` / `x-samchon-evidence` | 불변 추적 ID(`trackingId`), 대체 계보(`replaces`), 요구사항(`requirements`), TypeSpec 원본 좌표(`typeSpecSource`) |

명령별로 보면 다음과 같습니다. 설정 파일이 필요한 명령과 파일 경로를 받는 명령이 섞여 있습니다.

| 단계 | 명령 | 결과 |
|---|---|---|
| 검증 | `oa-gen validate`(설정의 모든 target), `oa-gen validate --spec <파일> --require-32` | 구조·참조·린트 오류, OpenAPI 3.2 강제 |
| 투영과 코드 생성 | `oa-gen generate` | 위 그림의 생성물 (`.oa-trace.json`은 쓰지 않음) |
| 타입 | `oa-gen typegen --spec <파일> -o <파일>` | TypeScript 타입 (설정 파일을 읽지 않음) |
| 런타임 검증 스키마 | `oa-gen generate:zod --spec <파일> -o <경로>` | Zod 4 스키마 |
| 가드만 | `oa-gen generate:guards --input <파일> -o <디렉터리>` | 독립형 타입 가드 |
| mock 서버 | `oa-gen mock` | 원본을 읽어 요청을 검증하는 서버 (디스크에 생성물을 쓰지 않음) |
| 생성물 최신 여부 | `oa-gen check-artifact` | `<id>.openapi.json`이 원본에서 다시 만든 결과와 다르면 종료 코드 1 |
| 추적성·영향도 분석 | `oa-gen trace --spec <파일> [--impact <대상>] [-o .oa-trace.json]` | 스펙 정의 ↔ TypeSpec AST ↔ 요구사항 ↔ 생성 코드 심볼 추적 및 Blast Radius 계산. `.oa-trace.json` 추적성 사이드카는 `-o`(`--output`)를 준 이 명령만 씁니다 |
| 변경 분류 | `oa-gen diff`, `oa-gen tsp diff` | `--fail-on-breaking`이면 breaking change에서 종료 코드 1 |
| runtime drift | `oa-gen drift` | 실행 중 서버가 내보내는 OpenAPI와 관리 중인 계약의 차이 |
| 번들 감사 | `oa-gen audit:csp --bundle <경로>` | `eval`, `new Function`, 금지된 런타임 import 검사 |

```bash
# 설정의 spec target 전체를 생성하고, 생성물이 원본과 일치하는지 확인
npx oa-gen generate
npx oa-gen check-artifact
# 생성된 가드 디렉터리 감사
npx oa-gen audit:csp --bundle ./src/generated/guards
```

## 원본 형식별 결과

| 원본 | `<id>.openapi.json`의 OpenAPI 버전 | 주의 |
|---|---|---|
| `.tsp` | 3.2.0 / 3.1.0 | codegen에 들어 있는 TypeSpec 컴파일러(1.16)로 메모리 컴파일합니다(`createTypeSpecFallbackHost` 폴백 지원). `oa-gen` CLI / `TspConfig` 경로에서는 `@service`가 없으면 model만 선언한 파일이 component를 내보내지 않으며, `@service` 없는 순수 데이터 모델은 `@oa-sdk/codegen/typespec`의 `compileTypeSpecToJsonSchemas()`를 사용합니다. `@oaUseResponseComponent` 같은 OA SDK extension은 이 경로에서 응답으로 바뀌지 않습니다([스키마 작성 가이드 1절](./schema-authoring.md#1-새-api-작성-경로-저장소)). |
| OpenAPI YAML·JSON | 원본에 적힌 버전 | 3.2를 강제하려면 `oa-gen validate --spec <파일> --require-32`를 씁니다. |
| TypeScript 모듈(Zod) | 3.1.0 | export한 Zod 스키마가 component가 됩니다(`OrderSchema` → `Order`). |

`oa-gen generate` 요약 출력은 파일의 `openapi` 필드 버전(`OpenAPI 3.2.0` 등)과 operation 수(`N ops`)를 표시합니다.

## 검증 엔진 고르기

| 엔진 | 만드는 명령 | 런타임 의존성 | 맞는 곳 |
|---|---|---|---|
| Zod 4 스키마 | `oa-gen generate:zod` | `zod` | 서버 입력 검증, 필드별 오류 메시지가 필요한 곳 |
| 독립형 타입 가드 | `guards` 설정, `oa-gen generate:guards` | 없음 (`ajv`, `zod`, `@oa-sdk/*`를 import하지 않음) | Manifest V3 확장처럼 `eval`을 금지하는 CSP 환경, 번들 크기가 중요한 곳 |

선택 기준과 측정값은 [순수 타입 선언 및 가드 실무 가이드](./pure-types-and-guards.md)와
[Validation Engine Benchmark Report](../benchmarks/validation-engines.md)에 있습니다. Typia까지 비교한 Browser Studio의
결정은 부록 3.4절에 있습니다. 가드 생성의 알려진 제한(component 이름에 `.`이 있으면 실패)은
[선언적 스펙 설정 가이드 6.3절](./declarative-spec-configuration.md#63-독립형-타입-가드-guards)에 있습니다.

## 오류 응답 형식

oa-sdk의 표준 오류 스키마인 TypeSpec `StandardError`와 이 저장소 production 계약의 `Error`는 같은
`{ code, message, details?, _meta? }` 모양이며, RFC 9457(`application/problem+json`) 형식이 아닙니다. mock 서버가
계약에 없는 오류 응답을 스스로 만들 때는 이 모양을 쓰지 않으므로, 프론트엔드 오류 처리를 mock 서버로 확인할 때는
아래 봉투 차이를 구분합니다.

| 위치 | 형식 |
|---|---|
| `@oa-sdk/typespec-decorators`의 `StandardError` (`ErrorResponse<Status>`, `StandardHttpErrors`가 사용) | `{ code, message, details?, _meta? }` |
| 이 저장소 production 계약의 `Error` (`packages/schemas/typespec/common.tsp`) | `{ code, message, details?, _meta? }` (`code`는 enum) |
| `oa-gen mock`·`@oa-sdk/mock-server`의 요청 검증 오류 (operation에 422 응답이 없을 때) | 422 + `{ "error": { "code": "CONSTRAINT_VIOLATION", "message", "details", "_meta" } }` |
| 같은 mock 서버의 정의되지 않은 경로 | 404 + `{ "error": { "code": "NOT_FOUND", "message", "details" } }` |
| 같은 mock 서버의 인증 실패 (security가 있고 operation에 401 응답이 없을 때) | 401 + `{ "code": "UNAUTHORIZED", "message" }` (`error` 봉투 없음) |

operation이 422나 401 응답을 선언하면 mock 서버는 그 응답 스키마로 본문을 만듭니다. 검증 오류 `details`의 항목과
코드는 [Mock 서버 사용 가이드](./mock-server-usage.md#검증-실패-응답-형식)에 있습니다. RFC 9457 본문이 필요하면 계약에
직접 선언합니다. Browser Studio가 그렇게 한 예가 부록 4.4절입니다.

## "surface"의 세 가지 뜻

| 표기 | 뜻 | 문서 |
|---|---|---|
| `x-surface-*` vendor extension | Browser Studio Surface Engine의 live-patch 메타데이터. 타입은 `@oa-sdk/openapi-projection-contract`의 `SurfaceExtensionFields` | 부록 6.6절 |
| lint 카테고리 `surface` | `oa-gen lint --categories surface`가 `x-surface-*` 형식과 `targetProperty`를 검사 | [CLI 명령 레퍼런스](./cli-command-reference.md) |
| `oa-gen surface` | 계약에서 Surface IR과 Cloudflare Forge용 SDK·CLI projection 생성 (`@oa-sdk/surface-ir`) | [Cloudflare Forge 지원](./forge-support.md) |

## 이 저장소의 production 계약

이 저장소는 `oa-gen generate` 대신 TypeSpec 번들 restore 경로를 씁니다: `packages/schemas/typespec`의 TypeSpec 모듈 →
승인 snapshot(`approved.openapi.yaml`) → `packages/schemas/src/.merged.yaml`(OpenAPI 3.2) → parser, codegen, mock 서버,
downstream gate. 이 경로에서는 OA SDK extension이 실제 응답·예제로 바뀝니다. 명령과 작업 순서는
[기본 스펙 사용 기준](./basic-spec-usage.md)에 있습니다.

---

# 부록. Browser Studio 스키마 표준 (외부 저장소 사례)

> **읽기 전에**
>
> - 아래는 Browser Studio 저장소의 규범 문서(원문 버전 1.2.0)를 사례로 옮긴 것입니다. 원문 머리말: *Canonical Authority: Browser Studio Core Architecture & Schema Governance. Target: `@browser-studio/*` applications that use `@oa-sdk/*`. Environments: Chrome Extension (Manifest V3), Node.js Session Host, MCP Stdio Daemons, DevTools Panel, Headless CI, CLI Tools.*
> - `@browser-studio/*`, `packages/devlink-*`, `packages/surface-engine`, `packages/inspector-controls`, `packages/visual-ir`, `schemas/` 경로는 이 저장소에 없습니다.
> - RFC 9457 Problem Details(4.4절), DevLink RPC·MCP operation 목록(4.1·4.2절), 60fps 예산(3절), Zod 스키마 명명 규칙(6.2절)은 Browser Studio의 규칙입니다. oa-sdk의 기본 오류 형식은 1부의 [오류 응답 형식](#오류-응답-형식)입니다.
> - `pnpm exec oa-gen ...` 명령은 `@oa-sdk/codegen`을 devDependency로 설치한 Browser Studio 저장소에서 실행하는 형태입니다.
> - 옮기면서 현재 oa-sdk 동작과 다른 서술은 고쳤습니다. `@oa-sdk/ast-sync`는 TypeSpec을 읽거나 쓰지 않습니다(Zod, TypeScript interface, Typia, JSON Schema 어댑터만 있음). `.tsp` 원본에서 `oa-gen generate`가 만드는 OpenAPI 문서는 3.2.0입니다. `@oa-sdk/mock-server`의 검증 오류는 RFC 9457 형식이 아닙니다. 아래 JSON·YAML 예시 중 `openapi: 3.1.0` 문서는 Zod 모듈 원본에서 나온 형태입니다.

## 1. Executive Summary & Architectural Scope

### 1.1 Mission & Core Tenet
The **Browser Studio Schema Architecture** establishes a strictly decoupled, deterministic, high-throughput schema pipeline that bridges **TypeSpec (`.tsp`) master specifications** with `@oa-sdk/*` specification governance, zero-runtime-weight browser extensions (Manifest V3), headless CI protocol mock testing, and AI Agent MCP/CLI bridges.

#### Unified Architectural Scope:
- **Primary Single Source of Truth (SSOT)**: Master domain models, polymorphic entities (such as video transition parameters, visual IR nodes, and surface blocks), RPC operations, and data exchange contracts are authored in **TypeSpec (`.tsp`)**.
- **Zod & TypeScript Bi-directional Interoperability**: In TypeScript-centric application codebases or runtime daemon hosts, Zod schemas (`zod@^4.4.3`) serve as an official adapter layer via **V3 AST Sync (`@oa-sdk/ast-sync`)**. `EntitySpec` translates between Zod schemas, TypeScript interfaces, Typia types, and JSON Schema. `@oa-sdk/ast-sync` has no TypeSpec adapter, so a Zod schema and a `.tsp` model are two sources that review must keep equal.
- **Universal Build-Time Projection**: All downstream artifacts—JSON Schema Draft 2020-12, OpenAPI 3.1/3.2 specifications, pre-compiled standalone AJV type guards, protocol mock endpoints, and MCP/CLI tools—are projected deterministically at **build time**.

The fundamental tenet of this architecture is:
> **Single Source of Truth (SSOT)**: Domain schemas and polymorphic parameter contracts are authored once, in TypeSpec (`.tsp`) or, for TypeScript-first packages, in Zod. All downstream artifacts—JSON Schema Draft 2020-12, OpenAPI 3.1/3.2 specifications, pre-compiled standalone AJV type guards, and MCP/CLI tools—are projected deterministically at **build time**.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: MASTER TYPESPEC SCHEMAS (.tsp SSOT) & ZOD AST ADAPTER                         │
│   • schemas/transitions/video-transitions.tsp (Polymorphic Fade, Wipe, Slide, GL, etc.)│
│   • packages/devlink-contracts (Native RPC, MCP Stdio, Timeline, Journal, Leases)       │
│   • packages/surface-engine (SurfaceBlock, SurfaceParam, PatchOp, DriftCheck)            │
│   • packages/inspector-controls (10 Controller parameter serializers & configs)         │
│   • packages/visual-ir (UniversalDocument, VisualNode, Geometry, Paints, Effects)       │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                                            ▼ [oa.config.ts / oa-gen generate]
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: BUILD-TIME PROJECTION TO JSON SCHEMA DRAFT 2020-12 & OPENAPI 3.1 / 3.2         │
│   • JSON Schema Draft 2020-12 ($defs, strict numeric exclusiveMinimum: 0)               │
│   • OpenAPI 3.1/3.2 'operation-contract' profile (DevLink Native RPC & MCP stdio)       │
│   • OpenAPI 3.1/3.2 'component-bundle' profile (SurfaceEngine, Visual-IR, Inspector)    │
│   • Canonical Metadata: x-schema-engine-profile, version-hash, sources, refs            │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
┌──────────────────────────────┐┌──────────────────────────┐┌───────────────────────────┐
│ STAGE 3: SPEC GOVERNANCE     ││ STAGE 4: STANDALONE TYPE ││ STAGE 5 (BRIDGE): MCP/CLI │
│ • @oa-sdk/parser (validation)││ • Build-time AJV 2020    ││ • @oa-sdk/tools           │
│ • @oa-sdk/openapi-projection ││ • Pre-compiled ESM guards││ • createSchemaTool bridge │
│ • @oa-sdk/mock-server (CI)   ││ • 0 KB runtime weight    ││ • AI Agent & CLI execution│
│ • Native RPC & MCP simulation││ • 100% Chrome MV3 CSP    ││ • Bitwise zero drift      │
└──────────────────────────────┘└──────────────────────────┘└───────────────────────────┘
```

### 1.2 Architectural Boundaries & Environment Matrix

| Execution Environment | Permitted Schema Artifacts | Strict Prohibitions | Performance Requirement |
|---|---|---|---|
| **Chrome Extension (MV3)**: Content Scripts, Side Panel, DevTools Panel | Standalone ESM Type Guards (`dist/guards/*.js`), Static TypeScript interfaces | ❌ `@oa-sdk/*`<br>❌ Runtime `zod`<br>❌ Runtime `ajv` compiler<br>❌ Dynamic `eval()` / `new Function()` | 60fps animation budget ($<0.5\text{ms}$ validation latency) |
| **Node.js Session Host**: `packages/devlink-session-host` | Native RPC Zod schemas, Standalone Type Guards, JSON Schema 2020-12 | ❌ `@oa-sdk/*` in runtime dependencies | $<2\text{ms}$ IPC message deserialization |
| **MCP Stdio Daemon**: `packages/devlink-mcp` | MCP Zod schemas, JSON Schema 2020-12 | ❌ Heavy build-time spec generators | $<5\text{ms}$ tool call response |
| **Build Tools & CI**: `oa.config.ts` / `oa-gen` CLI | `@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`, `@oa-sdk/mock-server`, `@oa-sdk/codegen`, `ajv/dist/standalone` | None (Full Node.js build-time toolchain) | Deterministic output, 100% schema validation |

---

## 2. The 4-Stage Schema Pipeline

### 2.1 Stage 1: Master TypeSpec Schemas (SSOT) & Zod Interoperability Adapter
In the modern architecture, domain entities, polymorphic parameter sets, and RPC contracts are authored in **TypeSpec (`.tsp`)**. TypeSpec provides a declarative, expressive language with native namespaces, model inheritance (`extends`), discriminator tags (`@discriminator`), documentation tags (`@doc`), and strict numeric boundary decorators (`@minValue`, `@maxValue`, `@pattern`):

```tsp
// Example: schemas/surface-engine/surface-param.tsp
namespace Studio.SurfaceEngine;

@doc("UTF-16 source character range")
model CharRange {
  @doc("0-based UTF-16 start offset")
  @minValue(0)
  start: int32;

  @doc("0-based UTF-16 end offset (exclusive)")
  @minValue(0)
  end: int32;

  @doc("Character span length")
  @minValue(0)
  length: int32;
}

@doc("Inspectable Surface Parameter representation")
model SurfaceParam {
  @doc("Unique parameter identifier")
  @minLength(1)
  id: string;

  @doc("CSS property name or JS property key")
  @minLength(1)
  name: string;

  @doc("Formatted code representation of parameter value")
  value: string;

  @doc("Exact source range of parameter value in document")
  range: CharRange;

  @doc("Inferred parameter semantic type")
  inferredType: "color" | "dimension" | "typography" | "shadow" | "spacing" | "flex" | "keyword" | "raw";

  @doc("UI inspector widget binding")
  uiEditor: "color-picker" | "scrubber" | "select" | "toggle" | "box-model" | "text-input";
}
```

#### TypeScript & Zod Interoperability Adapter:
In TypeScript-first packages, frontend libraries, or legacy codebases, Zod (`zod@^4.4.3`) is the authoring format. The **V3 AST Sync Engine (`@oa-sdk/ast-sync`)** and its `EntitySpec` intermediate representation roundtrip between Zod, TypeScript interfaces, Typia, and JSON Schema. It does not read or write TypeSpec, so the Zod schema below is a second source that must match the `.tsp` model above:

```typescript
// Example: packages/surface-engine/src/types/schemas.ts
import { z } from 'zod';

export const CharRangeSchema = z.object({
  start: z.number().int().nonnegative().describe('0-based UTF-16 start offset'),
  end: z.number().int().nonnegative().describe('0-based UTF-16 end offset (exclusive)'),
  length: z.number().int().nonnegative().describe('Character span length'),
});

export const SurfaceParamSchema = z.object({
  id: z.string().min(1).describe('Unique parameter identifier'),
  name: z.string().min(1).describe('CSS property name or JS property key'),
  value: z.string().describe('Formatted code representation of parameter value'),
  range: CharRangeSchema.describe('Exact source range of parameter value in document'),
  inferredType: z.enum(['color', 'dimension', 'typography', 'shadow', 'spacing', 'flex', 'keyword', 'raw']),
  uiEditor: z.enum(['color-picker', 'scrubber', 'select', 'toggle', 'box-model', 'text-input']),
});

export type SurfaceParam = z.infer<typeof SurfaceParamSchema>;
```

### 2.2 Stage 2: JSON Schema Draft 2020-12 Projection
JSON Schema Draft 2020-12 is the universal intermediate representation used for storage, cataloging, and pre-compilation.

#### Strict Dialect Rules:
1. **Target Dialect**: The generator must explicitly target `draft-2020-12` (`$schema: "https://json-schema.org/draft/2020-12/schema"`).
2. **Numeric Exclusive Bounds**: JSON Schema Draft 2020-12 and OpenAPI 3.1 mandate that `exclusiveMinimum` and `exclusiveMaximum` must be numeric values (e.g. `exclusiveMinimum: 0`), **never** boolean values (e.g. `minimum: 0, exclusiveMinimum: true` from Draft 04 / OpenAPI 3.0).
3. **Definition Indexing**: All shared schema definitions must reside under `$defs` (e.g. `#/$defs/SurfaceParam`) rather than legacy `definitions`.
4. **Deterministic Key Ordering**: Object properties, required arrays, and enum elements must be sorted deterministically to ensure bitwise-identical builds.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://browser-studio.dev/schemas/v1/surface-param.json",
  "title": "SurfaceParam",
  "type": "object",
  "properties": {
    "id": { "type": "string", "minLength": 1, "description": "Unique parameter identifier" },
    "name": { "type": "string", "minLength": 1, "description": "CSS property name or JS property key" },
    "value": { "type": "string", "description": "Formatted code representation of parameter value" },
    "range": { "$ref": "#/$defs/CharRange" },
    "inferredType": {
      "type": "string",
      "enum": ["color", "dimension", "typography", "shadow", "spacing", "flex", "keyword", "raw"]
    },
    "uiEditor": {
      "type": "string",
      "enum": ["color-picker", "scrubber", "select", "toggle", "box-model", "text-input"]
    }
  },
  "required": ["id", "name", "value", "range", "inferredType", "uiEditor"],
  "additionalProperties": false,
  "$defs": {
    "CharRange": {
      "type": "object",
      "properties": {
        "start": { "type": "integer", "minimum": 0 },
        "end": { "type": "integer", "minimum": 0 },
        "length": { "type": "integer", "minimum": 0 }
      },
      "required": ["start", "end", "length"],
      "additionalProperties": false
    }
  }
}
```

### 2.3 Stage 3: OpenAPI Specification Projections (`@oa-sdk`)
OpenAPI projections wrap schemas into standardized governance envelopes defined by `@oa-sdk/openapi-projection-contract`. `oa-gen generate` emits OpenAPI 3.2.0 for `.tsp` sources, the source's own version for OpenAPI files, and 3.1.0 for Zod/TypeScript modules; the 3.1 examples below come from Zod modules.

#### Profile Semantics:
- **`component-bundle` Profile**:
  - Used for standalone domain entity schemas (`SurfaceBlock`, `ResourceManifestV1`, `UniversalDocument`, `VisualNode`).
  - `paths: {}` (empty object or omitted).
  - `components.schemas` is **required** and contains all domain models with internal `$defs` remapped to `#/components/schemas/<Name>`.
  - Relaxed path validation; strict JSON Schema 2020-12 meta-validation.
- **`operation-contract` Profile**:
  - Used for DevLink Native RPC methods (`/rpc/{method}`) and MCP stdio operations (`/mcp/{operation}`).
  - `paths` is **required** and must declare at least one HTTP operation method (POST).
  - Every operation must declare a `requestBody` (referencing param schemas) and a `responses` object with `200` (success), `409` (conflict/lease error), `422` (validation error), and `500` (internal error) conforming to RFC 9457 `application/problem+json`. This is a Browser Studio rule: `@oa-sdk/openapi-projection-contract` only requires at least one operation under `paths`.
- **`full-api-document` Profile**:
  - Complete REST/RPC API documentation including info, servers, paths, operations, security requirements, and components.

#### Required Extension Metadata (`x-schema-engine-*`):
`oa-gen generate` attaches canonical `@oa-sdk` metadata to every projected document:
- `x-schema-engine-profile`: `'component-bundle' | 'operation-contract' | 'full-api-document'`
- `x-schema-engine-version-hash`: Deterministic SHA-256 hash of the schema content.
- `x-schema-engine-sources`: Map from component name to its source coordinate (`kind: 'file'`, `filePath`, `pointer`).
- `x-schema-engine-refs`: Reference graph edges tracking inter-schema dependencies.

```yaml
openapi: 3.1.0
info:
  title: DevLink Native RPC Operation Contract
  version: 1.0.0
  description: Canonical OpenAPI 3.1 contract for DevLink Native Messaging RPC methods.
x-schema-engine-profile: operation-contract
x-schema-engine-version-hash: sha256:8f9a2b...
paths:
  /rpc/session.hello:
    post:
      summary: Session Discovery & Extension Handshake
      operationId: sessionHello
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SessionHelloParams'
      responses:
        '200':
          description: Session handshake established successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SessionHelloResult'
        '422':
          description: Invalid handshake parameters
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
        '500':
          description: Internal host error
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
components:
  schemas:
    SessionHelloParams: { ... }
    SessionHelloResult: { ... }
    ProblemDetails: { ... }
```

### 2.4 Stage 4: Standalone AJV Type Guards
For high-frequency runtime validation in browser extension contexts (Content Scripts, DevTools Panel, Side Panel), JSON Schema Draft 2020-12 files are compiled at build time into pure JavaScript standalone functions using `ajv/dist/2020` and `ajv/dist/standalone`, either through the `guards` setting of `oa.config.ts` (`oa-gen generate`) or `oa-gen generate:guards --input <spec>`.

#### Properties of Standalone Guards:
- **Zero Runtime Dependencies**: The generated `.js` files contain static verification logic with no runtime dependency on `ajv`, `zod`, or `@oa-sdk`.
- **Zero Dynamic Code Generation**: **100% CSP-safe**; does not use `eval()` or `new Function()`.
- **TypeScript Type Narrowing**: Emits accompanying `.d.ts` files containing custom type guard signatures:
  ```typescript
  export function isSurfaceBlock(data: unknown): data is SurfaceBlock;
  export function isPatchOp(data: unknown): data is PatchOp;
  export function isDevLinkMcpControlRequest(data: unknown): data is DevLinkMcpControlRequestV1;
  export function isProblemDetails(data: unknown): data is ProblemDetails;
  ```

### 2.5 Stage 5 (Bridge): Zero-Drift MCP Tools & Interactive CLI (`@oa-sdk/tools`)
To bridge specifications directly to AI Agents (via Model Context Protocol) and human developers (via Terminal CLIs) without maintaining duplicated schema definitions, `@oa-sdk/tools` consumes Stage 2 JSON Schema Draft 2020-12 representations at runtime or build time via `createSchemaTool`:

#### Core Tenets of the Tool Bridge:
1. **Zero Schema Drift**: The exact JSON Schema Draft 2020-12 projected from TypeSpec is passed to MCP clients as the tool `inputSchema`, eliminating hand-written `z.string().describe(...)` duplication.
2. **Dual-Channel Consumption**: A single tool definition can be mounted into an MCP Stdio server for AI agents and simultaneously invoked via a CLI command runner for human engineers.
3. **Execution Safety**: Execution payloads are validated against the compiled schema prior to invoking the underlying action handler.

```typescript
import { createSchemaTool } from '@oa-sdk/tools';

export const surfaceParamTool = createSchemaTool({
  name: 'inspect_surface_param',
  description: 'Inspects and updates surface parameter attributes within workspace files.',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1 },
      value: { type: 'string' },
    },
    required: ['id', 'name', 'value'],
  },
  // execute receives (ctx: ToolContext, input) — the validated input is the second argument
  execute: async (_ctx, input) => {
    return {
      success: true,
      result: `Parameter ${input.name} updated to ${input.value}`,
    };
  },
});
```

---

## 3. Strict Separation of Concerns & Bundle Decoupling

### 3.1 Manifest V3 CSP & Bundle Decoupling Invariant
Chrome Extensions under Manifest V3 enforce a strict Content Security Policy:
```
script-src 'self'; object-src 'self';
```
Under this policy, any attempt to invoke `eval()`, `new Function(...)`, `setTimeout(string)`, or dynamic WebAssembly compilation causes immediate script termination and extension failure.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ BUILD TIME (Node.js / CI) — Heavy Tooling & Specification Governance                     │
│                                                                                         │
│   • @oa-sdk/openapi-projection-contract (Profile verification)                          │
│   • @oa-sdk/parser (OAS 3.1 / JSON Schema 2020-12 meta-validator)                      │
│   • @oa-sdk/mock-server (Headless CI protocol endpoints)                                │
│   • @oa-sdk/codegen (Standalone guards generation & CSP audit)                          │
│   • ajv v8 + ajv-formats + ajv/dist/standalone (Guard compiler)                        │
│   • zod v4 (Master schema definition & static type inference)                           │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ (Static Code Generation)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ RUNTIME BUNDLE (Browser Extension Manifest V3 & Content Scripts)                        │
│                                                                                         │
│   ✅ 0 KB @oa-sdk runtime footprint                                                     │
│   ✅ 0 KB AJV compiler engine or JSON Schema AST                                        │
│   ✅ 0 calls to eval() or new Function()                                                │
│   ✅ Sub-millisecond execution for 60fps DevTools slider scrubbing                      │
│   ✅ Pure ESM standalone type guards (dist/guards/*.js)                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 60fps Live-Scrubbing Performance
During interactive inspector manipulation (e.g. dragging a color picker or scrubbing dimension values at 60fps), style mutation payloads must be validated in $<0.5\text{ms}$. Pre-compiled standalone type guards execute direct property type checks and boundary comparisons ($O(1)$ algorithmic complexity), avoiding the multi-millisecond overhead of runtime AST parsing or dynamic schema compilation.

### 3.3 Automated CI Bundle Audit Gate (`oa-gen audit:csp`)
To ensure decoupling is never accidentally broken by developer imports, CI enforces an automated bundle audit command (`oa-gen audit:csp --bundle <dir>`):

```bash
# Scan extension production bundle output directory
pnpm exec oa-gen audit:csp --bundle dist/extension
```

The scanner analyzes bundle ASTs and verifies:
1. **Zero Unsafe Dynamic Execution**: Rejects `eval(`, `new Function(`, and string arguments in `setTimeout` / `setInterval`.
2. **Zero Heavy Runtime Engine Dependencies**: Rejects runtime imports or bundled modules from `ajv`, `zod`, or `@oa-sdk`.
3. **Structured Diagnostics**: Emits violation locations, problematic source tokens, and exits with code 1 upon failure.

### 3.4 Validation Engine Selection: Standalone Type Guards vs. Typia AOT Compilation

While both **Standalone Type Guards** (via `ajv/dist/standalone` ESM) and **Typia AOT** (`typia.is<T>`) achieve zero runtime library dependencies and sub-microsecond validation latency, `@oa-sdk` standardizes on **Standalone Type Guards** as its primary production delivery vehicle. This decision is grounded in four critical architectural trade-offs:

#### 3.4.1 Build-Chain Complexity & Toolchain Portability
- **Standalone Type Guards**:
  - Code generation occurs as an isolated build-time step (`oa-gen generate`), producing pure static ECMAScript modules (`dist/guards/*.js`) and TypeScript declaration files (`.d.ts`).
  - Downstream applications, consumers, and monorepo packages consume these outputs using standard, unmodified tooling—including `tsc`, `esbuild`, `swc`, `vite`, `webpack`, or `turbopack`—with **zero compiler monkey-patching or plugins**.
  - Delivers zero runtime dependency (`zero dependency` guarantee), inlining small helper routines (`__ucs2length`, `__equal`) directly.
- **Typia AOT Compilation**:
  - Relies on TypeScript compiler AST transformers (`ttsc`, `ts-patch`, or `unplugin-typia`) executed during the compilation process itself.
  - Native ultra-fast bundlers (`esbuild`, `swc`) cannot run TypeScript AST transformers directly without two-pass compilation architectures.
  - Upgrading TypeScript major versions (e.g. TS 5.x to future TS releases) introduces significant lag and maintenance friction while waiting for compiler hook transformer patches.

#### 3.4.2 Manifest V3 CSP Safety & Automated Security Audits
- Browser Extensions under Manifest V3 enforce strict `script-src 'self'`.
- Standalone Type Guards emitted by `@oa-sdk/codegen` inline critical helpers (`__ucs2length`, `__equal`) to eliminate all external module requirements, achieving 0 KB runtime dependencies.
- CI guarantees compliance via `oa-gen audit:csp --bundle dist/guards`, ensuring 0 `eval()` calls, 0 `new Function()` invocations, and 0 disallowed imports (`ajv`, `zod`, `@oa-sdk`).
- While Typia's generated JavaScript is also eval-free, managing compiler transformer outputs across complex multi-target packaging poses higher risk of accidental helper leaks or compiler transform drift.

#### 3.4.3 Runtime Speed vs. 60fps Frame Budget
- **The Frame Budget**: Smooth 60fps UI scrubbing in DevTools and Inspector panels grants a 16.6ms total frame budget, allocating a maximum budget of **$<0.5\text{ms}$ ($500\mu\text{s}$)** for style mutation validation per animation frame cycle.
- **Empirical Measurements**:
  - Standalone Type Guards achieve mean latency of $0.198\mu\text{s} - 1.016\mu\text{s}$ and median latency of $0.167\mu\text{s} - 0.541\mu\text{s}$.
  - Typia achieves mean latency of $0.284\mu\text{s} - 1.373\mu\text{s}$ and median latency of $0.167\mu\text{s} - 0.667\mu\text{s}$.
- Both engines operate within sub-microsecond regimes ($<0.5\text{ms}$ budget), outperforming the $500\mu\text{s}$ ceiling by over **$500\times$ to $1,000\times$**. Because DOM layout recalculations ($1-5\text{ms}$) and IPC messaging ($0.5-2\text{ms}$) dominate overall frame latency within the 16.6ms window, Typia's marginal throughput lead does not justify the associated compiler transformer complexity. Selecting between Typia and Standalone guards favors Standalone for client stability.

#### 3.4.4 Normative Engine Decision Matrix

Guidance on selecting between Typia and Standalone guards:

| Evaluation Dimension | Raw Zod Runtime | Standalone Type Guards (AJV) | Typia AOT (`typia.is<T>`) |
|---|---|---|---|
| **Authoring SSOT** | ✅ Native Zod syntax | Derived from Stage 2 JSON Schema | Pluggable AST Adapter |
| **Pipeline Stage** | Stage 1 (Authoring & Ingress) | Stage 4 (Production Guards) | Isolated Tooling / Mock |
| **Build-Time Tooling** | Standard `tsc` | Standard `tsc` / `esbuild` / `swc` | `ts-patch` / `ttsc` AST transformer |
| **Runtime Footprint** | ~64.05 KB gzip (322.97 KB min) | **0 KB runtime dependency** (5.62 KB gzip) | **0 KB runtime dependency** (1.13 KB gzip) |
| **Manifest V3 CSP Safety** | ❌ Disallowed runtime import | **✅ 100% Zero-Eval Pass** | **✅ Zero-Eval Pass** |
| **Valid Throughput (ops/s)** | 0.12M – 0.47M ops/s | **1.07M – 2.35M ops/sec** | **2.35M – 5.04M ops/sec** |
| **Valid Median Latency** | 0.50 – 7.08 µs | **0.17 – 0.54 µs** | **0.17 – 0.67 µs** |
| **60fps Frame Budget (<0.5ms)**| PASS (<0.5ms) | **PASS (<0.5ms)** | **PASS (<0.5ms)** |
| **Monorepo Ergonomics** | High (Universal TS) | **High (Zero toolchain lock)** | Moderate (Transformer coupling) |

> 📊 For raw throughput data, latency percentiles, and memory footprint tables, refer to [Validation Engine Benchmark Report](../benchmarks/validation-engines.md).

---

## 4. DevLink Protocol, RFC 9457 Problem Details & Operation Contract Formalization

### 4.1 Native RPC Methods (17 Operations)
DevLink Native RPC communicates over Chrome Native Messaging using 4-byte little-endian length-prefixed JSON envelopes (`NativeRpcRequestSchema` and `NativeRpcResponseSchema`).

In the OpenAPI 3.1 `operation-contract` profile, each method is formalized as `POST /rpc/{method}`:

| # | RPC Method Name | OpenAPI Path & Operation ID | Summary & Scope | Request Schema | Response Schema |
|---|---|---|---|---|---|
| 1 | `session.hello` | `POST /rpc/session.hello`<br>`sessionHello` | Native host discovery, protocol version handshake, and extension authentication. | `SessionHelloParamsSchema` | `SessionHelloResultSchema` |
| 2 | `workspace.list` | `POST /rpc/workspace.list`<br>`workspaceList` | Enumerate registered, authorized local workspace roots. | `{}` | `WorkspaceListResultSchema` |
| 3 | `workspace.approve` | `POST /rpc/workspace.approve`<br>`workspaceApprove` | Authorize and register a local workspace directory for live editing. | `WorkspaceApproveParamsSchema` | `WorkspaceApproveResultSchema` |
| 4 | `workspace.snapshot.save` | `POST /rpc/workspace.snapshot.save`<br>`workspaceSnapshotSave` | Persist baseline HTML/CSS snapshot and resource manifest to workspace disk. | `WorkspaceSnapshotSaveParamsSchema` | `WorkspaceSnapshotSaveResultSchema` |
| 5 | `binding.resolve` | `POST /rpc/binding.resolve`<br>`bindingResolve` | Resolve live DOM element evidence to local file binding and base revision. | `BindingResolveParamsSchema` | `BindingResolveResultSchema` |
| 6 | `binding.verify-style` | `POST /rpc/binding.verify-style`<br>`bindingVerifyStyle` | Verify and authorize style mutation persistence for a resolved binding. | `BindingVerifyStyleParamsSchema` | `BindingVerifyStyleResultSchema` |
| 7 | `source.inspect` | `POST /rpc/source.inspect`<br>`sourceInspect` | Inspect local stylesheet candidates matching selector, property, and source maps. | `SourceInspectParamsSchema` | `SourceInspectResultSchema` |
| 8 | `materialize.css` | `POST /rpc/materialize.css`<br>`materializeCss` | Direct character-level CSS materialization to workspace source files on disk. | `EditCommitRequestV1Schema` | `EditMaterializationResultV1Schema` |
| 9 | `materialize.rollback` | `POST /rpc/materialize.rollback`<br>`materializeRollback` | Atomic rollback of single or multi-file materialization transactions. | `MaterializeRollbackParamsSchema` | `MaterializeRollbackResultSchema` |
| 10 | `mcp.control` | `POST /rpc/mcp.control`<br>`mcpControl` | Multiplexed MCP control request tunneling between Native Host and Extension. | `McpControlParamsSchema` | `DevLinkMcpControlResultV1Schema` |
| 11 | `journal.get` | `POST /rpc/journal.get`<br>`journalGet` | Query append-only commit, rollback, and lease journal records. | `DevLinkHistoryQueryOptionsSchema` | `DevLinkHistoryResultV1Schema` |
| 12 | `diff.preview` | `POST /rpc/diff.preview`<br>`diffPreview` | Unified diff preview and predicted SHA-256 fingerprint computation before commit. | `DevLinkDiffPreviewParamsSchema` | `DevLinkDiffPreviewResultV1Schema` |
| 13 | `lease.acquire` | `POST /rpc/lease.acquire`<br>`leaseAcquire` | Acquire optimistic workspace or file-level concurrency lease locks. | `LeaseAcquireParamsSchema` | `LeaseAcquireResultSchema` |
| 14 | `lease.renew` | `POST /rpc/lease.renew`<br>`leaseRenew` | Extend TTL on an active concurrency lease lock token. | `LeaseRenewParamsSchema` | `LeaseRenewResultSchema` |
| 15 | `lease.release` | `POST /rpc/lease.release`<br>`leaseRelease` | Explicitly surrender and release an active lease lock token. | `LeaseReleaseParamsSchema` | `LeaseReleaseResultSchema` |
| 16 | `lease.inspect` | `POST /rpc/lease.inspect`<br>`leaseInspect` | Inspect active concurrency leases across workspace and file scopes. | `LeaseInspectParamsSchema` | `LeaseInspectResultSchema` |
| 17 | `utility.patch` | `POST /rpc/utility.patch`<br>`utilityPatch` | Perform AST/regex class surgery on Tailwind and utility classes in source code. | `UtilityClassPatchOptionsSchema` | `UtilityClassPatchResultSchema` |

### 4.2 DevLink MCP Stdio Operations (14 Operations)
The DevLink MCP Stdio interface allows external AI agents and automation tools to control browser inspection, live preview, and style commits via standard Model Context Protocol (MCP) JSON-RPC 2.0.

In the OpenAPI 3.1 `operation-contract` profile, each MCP operation is formalized as `POST /mcp/{operation}`:

| # | MCP Operation Name | OpenAPI Path & Operation ID | Summary & Description |
|---|---|---|---|
| 1 | `session.status` | `POST /mcp/session.status`<br>`mcpSessionStatus` | Query active DevLink extension connection, tabs, and workspace binding status. |
| 2 | `tabs.list` | `POST /mcp/tabs.list`<br>`mcpTabsList` | Enumerate inspectable browser tabs with URL, title, and DevLink readiness. |
| 3 | `targets.list` | `POST /mcp/targets.list`<br>`mcpTargetsList` | List available live DOM inspection targets and element address sets. |
| 4 | `selection.select` | `POST /mcp/selection.select`<br>`mcpSelectionSelect` | Programmatically select DOM element by selector, XPath, or component address. |
| 5 | `style.inspect` | `POST /mcp/style.inspect`<br>`mcpStyleInspect` | Retrieve computed styles, matched CSS rules, and surface parameters for target. |
| 6 | `preview.style` | `POST /mcp/preview.style`<br>`mcpPreviewStyle` | Apply ephemeral, non-destructive 60fps style mutation preview in browser. |
| 7 | `commit.style` | `POST /mcp/commit.style`<br>`mcpCommitStyle` | Commit previewed style mutations to disk via non-AST range patcher. |
| 8 | `rollback` | `POST /mcp/rollback`<br>`mcpRollback` | Revert applied mutations using atomic journal transaction history. |
| 9 | `history.get` | `POST /mcp/history.get`<br>`mcpHistoryGet` | Retrieve commit journal records and revision snapshots for active session. |
| 10 | `diff.preview` | `POST /mcp/diff.preview`<br>`mcpDiffPreview` | Generate character-level visual diff between baseline and mutated style rules. |
| 11 | `lease.acquire` | `POST /mcp/lease.acquire`<br>`mcpLeaseAcquire` | Acquire optimistic editing lease lock before executing agent mutations. |
| 12 | `lease.renew` | `POST /mcp/lease.renew`<br>`mcpLeaseRenew` | Heartbeat renew active editing lease lock during multi-step reasoning. |
| 13 | `lease.release` | `POST /mcp/lease.release`<br>`mcpLeaseRelease` | Explicitly release editing lease lock upon task completion. |
| 14 | `lease.inspect` | `POST /mcp/lease.inspect`<br>`mcpLeaseInspect` | Inspect existing active leases to avoid agent concurrency collisions. |

### 4.3 Domain Entity Component Bundles
Domain models that represent shared data interchange structures are projected under the `component-bundle` profile:
- **`SurfaceBlock` & `SurfaceParam`**: Non-AST editable code blocks, character spans, quote styles, and parameters.
- **`PatchOp`**: Discriminated union of atomic range patch operations (`UpdateParamOp`, `InsertParamOp`, `DeleteParamOp`, `RawReplaceOp`).
- **`ResourceManifestV1`**: Snapshot manifest containing baseline HTML/CSS hashes and file paths.
- **`UniversalDocument` & `VisualNode`**: Canonical visual intermediate representation tree.
- **`TimelineStepV1` & `DevLinkJournalRecordV1`**: Undo/redo timeline frames and commit journal entries.

---

### 4.4 RFC 9457 Problem Details Error Payload Convention

In Browser Studio, all error responses across HTTP/RPC endpoints and DevLink operation contracts must conform to **RFC 9457: Problem Details for HTTP APIs** (`application/problem+json`). This is a Browser Studio convention, not an oa-sdk default: oa-sdk's `StandardError` and the oa-sdk production `Error` schema use `{ code, message, details?, _meta? }`, while `@oa-sdk/mock-server` request-validation errors for an operation without a declared 422 response use a different envelope, `{ error: { code, message, details, _meta } }`, and its default 401 is a bare `{ code, message }` (see Part 1, [오류 응답 형식](#오류-응답-형식)). None of these is RFC 9457, so mock responses in RFC 9457 form come from `override()` (7.3) or from the 4xx responses and examples declared in the contract.

#### Standard RFC 9457 Fields:
1. `type` (`string`, format `uri`): A URI reference that identifies the problem type. When dereferenced, it should provide human-readable documentation. Defaults to `"about:blank"` if unspecified.
2. `title` (`string`): A short, human-readable summary of the problem type (e.g. `"Unprocessable Content"`, `"Lease Conflict"`, `"Internal Server Error"`).
3. `status` (`integer`, bounds $100 \le \text{status} \le 599$): The HTTP status code generated by the origin server for this occurrence of the problem.
4. `detail` (`string`, optional): A human-readable explanation specific to this occurrence of the problem.
5. `instance` (`string`, format `uri-reference`, optional): A URI reference that identifies the specific occurrence of the problem (e.g. `"/rpc/materialize.css#tx-9a8b"`).

#### Standard Extension Members:
To support rich automated error recovery and agentic reasoning without breaking RFC 9457 conformance, the following standard extension members are defined:
- `code` (`string`): Machine-readable error identifier (e.g. `"VALIDATION_ERROR"`, `"LEASE_CONFLICT"`, `"RESOURCE_UNAVAILABLE"`).
- `invalidParams` (`array` of objects): Array of granular parameter validation failures containing:
  - `name` (`string`): Name of the invalid field or parameter.
  - `reason` (`string`): Explanation of why validation failed.
  - `path` (`string`, optional): JSON pointer or dot-separated path to the invalid property.
  - `code` (`string`, optional): Machine-readable failure sub-code (e.g. `"MINIMUM_VIOLATION"`).
- `details` (`record` or `unknown`, optional): Structured contextual metadata specific to the error condition (e.g. `{ lockedUntil: 1725300000, currentOwner: "agent-session-42" }`).

#### Complete Master Schema Definition (TypeScript & Zod):

```typescript
// packages/devlink-contracts/src/problem-details.ts
import { z } from 'zod';

/**
 * Individual field validation error member in RFC 9457 extension.
 */
export const InvalidParamSchema = z.object({
  name: z.string().min(1).describe('Name of the invalid parameter or property'),
  reason: z.string().min(1).describe('Human-readable description of the constraint violation'),
  path: z.string().optional().describe('JSON pointer or path to the invalid property (e.g. "/range/start")'),
  code: z.string().optional().describe('Machine-readable validation code (e.g. "MINIMUM_VIOLATION")'),
});
export type InvalidParam = z.infer<typeof InvalidParamSchema>;

/**
 * RFC 9457 Problem Details Schema for standardized HTTP/RPC error payloads.
 * Content-Type: application/problem+json
 */
export const ProblemDetailsSchema = z.object({
  type: z
    .string()
    .url()
    .default('about:blank')
    .describe('URI reference identifying the problem type specification'),
  title: z
    .string()
    .min(1)
    .describe('Short, human-readable summary of the problem type'),
  status: z
    .number()
    .int()
    .min(100)
    .max(599)
    .describe('HTTP status code associated with this problem occurrence'),
  detail: z
    .string()
    .optional()
    .describe('Human-readable explanation specific to this occurrence of the problem'),
  instance: z
    .string()
    .optional()
    .describe('URI reference identifying the specific occurrence of the problem'),
  // Extension members
  code: z
    .string()
    .min(1)
    .optional()
    .describe('Machine-readable domain error code (e.g. "LEASE_CONFLICT", "VALIDATION_ERROR")'),
  invalidParams: z
    .array(InvalidParamSchema)
    .optional()
    .describe('List of invalid parameter errors for 422 Unprocessable Content responses'),
  details: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Arbitrary contextual metadata associated with the error condition'),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/**
 * Helper factory function for constructing typed RFC 9457 error instances.
 */
export function createProblemDetails(options: {
  status: number;
  title: string;
  detail?: string;
  type?: string;
  instance?: string;
  code?: string;
  invalidParams?: InvalidParam[];
  details?: Record<string, unknown>;
}): ProblemDetails {
  return ProblemDetailsSchema.parse({
    type: options.type ?? 'about:blank',
    title: options.title,
    status: options.status,
    detail: options.detail,
    instance: options.instance,
    code: options.code,
    invalidParams: options.invalidParams,
    details: options.details,
  });
}
```

#### JSON Schema Draft 2020-12 Representation:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://browser-studio.dev/schemas/v1/problem-details.json",
  "title": "ProblemDetails",
  "description": "RFC 9457 Problem Details for HTTP APIs (application/problem+json)",
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "default": "about:blank",
      "description": "URI reference identifying the problem type specification"
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "description": "Short, human-readable summary of the problem type"
    },
    "status": {
      "type": "integer",
      "minimum": 100,
      "maximum": 599,
      "description": "HTTP status code associated with this problem occurrence"
    },
    "detail": {
      "type": "string",
      "description": "Human-readable explanation specific to this occurrence of the problem"
    },
    "instance": {
      "type": "string",
      "description": "URI reference identifying the specific occurrence of the problem"
    },
    "code": {
      "type": "string",
      "minLength": 1,
      "description": "Machine-readable domain error code"
    },
    "invalidParams": {
      "type": "array",
      "items": { "$ref": "#/$defs/InvalidParam" },
      "description": "List of invalid parameter errors for 422 Unprocessable Content responses"
    },
    "details": {
      "type": "object",
      "additionalProperties": true,
      "description": "Arbitrary contextual metadata associated with the error condition"
    }
  },
  "required": ["title", "status"],
  "additionalProperties": false,
  "$defs": {
    "InvalidParam": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "reason": { "type": "string", "minLength": 1 },
        "path": { "type": "string" },
        "code": { "type": "string" }
      },
      "required": ["name", "reason"],
      "additionalProperties": false
    }
  }
}
```

---

### 4.5 Multi-Status Error Response Mapping in OpenAPI 3.1

In the `operation-contract` profile, every API/RPC operation must declare standard RFC 9457 error response mappings under `responses` for:
- **`422` (Unprocessable Content)**: Syntactic or semantic parameter validation failure (`invalidParams` populated).
- **`409` (Conflict)**: Optimistic concurrency lock collision, lease contention, or baseline file drift.
- **`500` (Internal Server Error)**: Unexpected daemon crash, unhandled exception, or I/O failure.

#### Normative OpenAPI 3.1 Operation Specification:

```yaml
openapi: 3.1.0
info:
  title: DevLink Materialization Service Contract
  version: 1.0.0
x-schema-engine-profile: operation-contract
paths:
  /rpc/materialize.css:
    post:
      summary: Materialize CSS mutations to disk
      operationId: materializeCss
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/EditCommitRequestV1'
      responses:
        '200':
          description: Materialization committed successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EditMaterializationResultV1'
        '409':
          description: Concurrency lease conflict or baseline source drift detected
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
              example:
                type: 'https://browser-studio.dev/errors/lease-conflict'
                title: 'Lease Conflict'
                status: 409
                detail: 'Target file is locked under lease by agent-session-42 until TTL expiry.'
                instance: '/rpc/materialize.css#lease-check'
                code: 'LEASE_CONFLICT'
                details:
                  lockedUntil: 1725300045000
                  leaseHolder: 'agent-session-42'
                  targetPath: '/src/components/Header.tsx'
        '422':
          description: Request body validation failed (schema constraint violation)
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
              example:
                type: 'https://browser-studio.dev/errors/validation-error'
                title: 'Unprocessable Content'
                status: 422
                detail: 'The submitted patch operations failed schema validation.'
                instance: '/rpc/materialize.css#validation'
                code: 'INVALID_REQUEST'
                invalidParams:
                  - name: 'range.start'
                    reason: 'Value must be greater than or equal to 0'
                    path: '/patches/0/range/start'
                    code: 'MINIMUM_VIOLATION'
        '500':
          description: Internal server error or disk I/O failure
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
              example:
                type: 'https://browser-studio.dev/errors/internal-error'
                title: 'Internal Server Error'
                status: 500
                detail: 'Disk write permission denied on target stylesheet.'
                code: 'WRITE_FAILED'
components:
  schemas:
    EditCommitRequestV1: { ... }
    EditMaterializationResultV1: { ... }
    ProblemDetails: { ... }
```

---

## 5. V3 Unified Architecture & TypeScript AST Bidirectional Synchronization

### 5.1 The EntitySpec Intermediate Representation
The **V3 Unified Architecture** eliminates impedance mismatch between schema representations, TypeScript code, and visual editing interfaces through `EntitySpec`—a lossless, AST-agnostic intermediate specification.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                ENTITYSPEC (Canonical SSOT)                              │
│  • id, name, kind ('schema' | 'interface' | 'type-alias' | 'node')                      │
│  • properties: Record<string, EntityPropertySpec>                                       │
│  • constraints: PropertyConstraint[] (min, max, length, regex, format, int, positive)   │
│  • discriminator: { propertyName: string, value?: string, mapping?: Record }            │
│  • docComment: JSDoc description & metadata tags                                        │
└───────────────────▲─────────────────────────────────────────────────┬───────────────────┘
                    │                                                 │
          CodeToSpec│                                       SpecToCode│
                    │                                                 ▼
┌───────────────────┴─────────────────┐             ┌─────────────────────────────────────┐
│ PLUGGABLE TYPE ADAPTERS             │             │ GRANULAR AST DIFF & TEXT EDITS      │
│  • ZodTypeAdapter: z.object({...})  │             │  • computeEntitySpecDiff(old, new)  │
│  • TsAstTypeAdapter: interface/type │             │  • Reverse-Offset Patch Application │
│  • TypiaTypeAdapter, JsonSchema...  │             │  • Zero-loss formatting retention   │
└─────────────────────────────────────┘             └─────────────────────────────────────┘
```

### 5.2 Pluggable Type Adapter Pattern
The `TypeAdapter` interface allows arbitrary schema and code representations to seamlessly roundtrip into `EntitySpec`:

```typescript
export interface TypeAdapter<TSource = string, TTarget = string> {
  readonly name: string; // 'zod' | 'ts-ast' | 'typia' | 'json-schema'
  readonly supportedDialects: string[];

  read(source: TSource): EntitySpec;
  write(spec: EntitySpec, originalSource?: TSource): TTarget;
}
```

1. **Zod Adapter (`ZodTypeAdapter`, `packages/ast-sync/src/adapters/zod.ts`)**:
   - Parses `z.object()`, `z.discriminatedUnion()`, `.min()`, `.max()`, `.describe()`.
   - Generates idiomatic Zod schema code with method chaining.
2. **TypeScript AST Adapter (`TsAstTypeAdapter`, `packages/ast-sync/src/adapters/ts-ast.ts`)**:
   - Uses `typescript` compiler API to parse `interface` and `type` declarations.
   - Extracts JSDoc validation and documentation tags into `EntityPropertySpec`.
3. **Typia Adapter (`TypiaTypeAdapter`, `packages/ast-sync/src/adapters/typia.ts`)**:
   - Parses Typia comment validation tags (`@minimum`, `@format`).
   - Generates ultra-fast Typia validation interfaces.
4. **JSON Schema Adapter (`JsonSchemaTypeAdapter`, `packages/ast-sync/src/adapters/json-schema.ts`)**:
   - Reads and writes JSON Schema objects or strings.

There is no TypeSpec adapter.

### 5.3 Granular AST Diff Engine & Bitwise Invariance
When an `EntitySpec` is modified in memory (e.g. adding a property or updating a constraint), `computeEntitySpecDiff()` computes granular diff operations:
- `add-property`, `remove-property`, `update-property`, `update-entity`, `add-extends`, `remove-extends`, `update-doc-comment`, `update-discriminator`.

Instead of regenerating the entire file from scratch (which wipes out comments, whitespace, and formatting), the diff engine produces precise `TextEdit` spans (`applyTextEdits()`) applied in **reverse-offset bottom-up order** ($s_i \ge s_{i+1}$), guaranteeing **100% bitwise invariance** across all unedited regions of the source file.

---

### 5.4 Normative JSDoc Validation Tag Parsing Specification

In the V3 Unified Architecture, TypeScript interfaces and type aliases can be annotated with standard JSDoc validation tags. The AST sync engine (`ts-ast` and `typia` adapters) parses these tags into normalized `PropertyConstraint` records.

#### Canonical JSDoc Tag Mapping Table:

| JSDoc Tag Syntax | Target `PropertyConstraint` Field | Zod Master Schema Equivalent | JSON Schema 2020-12 / OAS 3.1 Keyword |
|---|---|---|---|
| `@minimum <n>` or `@min <n>` | `constraints.minimum = n`<br>`constraints.min = n` | `z.number().min(n)` or `.nonnegative()` (for 0) | `"minimum": n` |
| `@maximum <n>` or `@max <n>` | `constraints.maximum = n`<br>`constraints.max = n` | `z.number().max(n)` or `.nonpositive()` (for 0) | `"maximum": n` |
| `@exclusiveMinimum <n>` | `constraints.exclusiveMinimum = n` | `z.number().gt(n)` or `.positive()` (for 0) | `"exclusiveMinimum": n` |
| `@exclusiveMaximum <n>` | `constraints.exclusiveMaximum = n` | `z.number().lt(n)` or `.negative()` (for 0) | `"exclusiveMaximum": n` |
| `@minLength <n>` | `constraints.minLength = n` | `z.string().min(n)` | `"minLength": n` |
| `@maxLength <n>` | `constraints.maxLength = n` | `z.string().max(n)` | `"maxLength": n` |
| `@pattern <regex>` | `constraints.pattern = "<regex>"` | `z.string().regex(/<regex>/)` | `"pattern": "<regex>"` |
| `@format email` | `constraints.format = 'email'`<br>`constraints.email = true` | `z.string().email()` | `"format": "email"` |
| `@format uri` or `@format url` | `constraints.format = 'uri'`<br>`constraints.url = true` | `z.string().url()` | `"format": "uri"` |
| `@format uuid` | `constraints.format = 'uuid'`<br>`constraints.uuid = true` | `z.string().uuid()` | `"format": "uuid"` |
| `@format date-time` | `constraints.format = 'date-time'`<br>`constraints.datetime = true` | `z.string().datetime()` | `"format": "date-time"` |
| `@format date` | `constraints.format = 'date'` | `z.string().date()` | `"format": "date"` |
| `@format time` | `constraints.format = 'time'` | `z.string().time()` | `"format": "time"` |
| `@format duration` | `constraints.format = 'duration'` | `z.string().duration()` | `"format": "duration"` |
| `@multipleOf <n>` | `constraints.multipleOf = n` | `z.number().multipleOf(n)` | `"multipleOf": n` |
| `@default <literal>` | `constraints.default = parsedJSON` | `z.schema.default(parsedJSON)` | `"default": parsedJSON` |
| `@type <primitive>` | `constraints.type = "<primitive>"` | `z.<primitive>()` | `"type": "<primitive>"` |

#### Non-Validation JSDoc Tags (Preserved as Documentation):
Tags that do not define structural schema constraints are isolated and preserved in `EntityPropertySpec.docComment` and `ParsedJSDoc.nonTypiaTags`:
- `@description <text>`: Primary description text.
- `@deprecated [<reason>]`: Marks the property as deprecated.
- `@example <sample>`: Example payload or property value.
- `@see <reference>`: Cross-reference link or pointer.
- `@note <text>`: Developer notes and context.

---

### 5.5 Discriminated Union AST Mapping (`@discriminator`)

The `@discriminator <propertyName>` tag placed above a TypeScript interface or union type alias declares the explicit tag property for polymorphic variant dispatch.

```typescript
/**
 * Discriminated union of visual canvas elements.
 * @discriminator kind
 */
export type CanvasElement = TextCanvasElement | ShapeCanvasElement | ImageCanvasElement;
```

#### Bidirectional Mapping Pipeline:
1. **TypeScript AST $\to$ `EntitySpec`**:
   The AST adapter extracts `@discriminator kind` and populates `EntitySpec.discriminator = { propertyName: 'kind' }`.
2. **`EntitySpec` $\to$ Zod**:
   The Zod adapter emits `z.discriminatedUnion('kind', [TextCanvasElementSchema, ShapeCanvasElementSchema, ImageCanvasElementSchema])`.
3. **`EntitySpec` $\to$ OpenAPI 3.1**:
   The OpenAPI projector emits `oneOf` with `discriminator: { propertyName: 'kind', mapping: { ... } }`.

---

### 5.6 Complete Runnable Bidirectional Synchronization Example

#### Step 1: Input TypeScript Interface with JSDoc Validation Tags

```typescript
// input-interface.ts
export interface VisualLayerSpec {
  /**
   * Unique identifier of the visual layer
   * @format uuid
   * @minLength 1
   */
  id: string;

  /**
   * Layer display name in tree
   * @minLength 1
   * @maxLength 128
   */
  name: string;

  /**
   * Layer opacity fraction
   * @minimum 0
   * @maximum 1
   * @default 1
   */
  opacity: number;

  /**
   * Layer z-index order in stack
   * @exclusiveMinimum 0
   */
  zIndex: number;

  /**
   * Visual paint background color in hex
   * @pattern ^#(?:[0-9a-fA-F]{3}){1,2}$
   * @example "#ff0000"
   */
  backgroundColor?: string;
}
```

#### Step 2: Parsed Intermediate `EntitySpec` Representation

```json
{
  "id": "visuallayerspec",
  "name": "VisualLayerSpec",
  "kind": "interface",
  "properties": {
    "id": {
      "name": "id",
      "type": "string",
      "docComment": "Unique identifier of the visual layer",
      "constraints": {
        "format": "uuid",
        "uuid": true,
        "minLength": 1
      }
    },
    "name": {
      "name": "name",
      "type": "string",
      "docComment": "Layer display name in tree",
      "constraints": {
        "minLength": 1,
        "maxLength": 128
      }
    },
    "opacity": {
      "name": "opacity",
      "type": "number",
      "docComment": "Layer opacity fraction",
      "constraints": {
        "minimum": 0,
        "maximum": 1,
        "default": 1
      }
    },
    "zIndex": {
      "name": "zIndex",
      "type": "number",
      "docComment": "Layer z-index order in stack",
      "constraints": {
        "exclusiveMinimum": 0
      }
    },
    "backgroundColor": {
      "name": "backgroundColor",
      "type": "string",
      "optional": true,
      "docComment": "Visual paint background color in hex\n@example \"#ff0000\"",
      "constraints": {
        "pattern": "^#(?:[0-9a-fA-F]{3}){1,2}$"
      }
    }
  }
}
```

#### Step 3: Generated Zod Master Schema Output

```typescript
// generated-zod.ts
import { z } from 'zod';

export const VisualLayerSpecSchema = z.object({
  id: z.string().uuid().min(1).describe('Unique identifier of the visual layer'),
  name: z.string().min(1).max(128).describe('Layer display name in tree'),
  opacity: z.number().min(0).max(1).default(1).describe('Layer opacity fraction'),
  zIndex: z.number().gt(0).describe('Layer z-index order in stack'),
  backgroundColor: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/)
    .optional()
    .describe('Visual paint background color in hex\n@example "#ff0000"'),
});

export type VisualLayerSpec = z.infer<typeof VisualLayerSpecSchema>;
```

---

## 6. Schema Authoring Best Practices & Guidelines

### 6.1 비디오 트랜지션 파라미터 다양화 및 다형성 스키마 모델링 (Video Transition Parameter Diversification Standard)

비디오 편집 엔진, 캔버스 타임라인, WebGL/WebGPU 렌더러 기반 애플리케이션에서는 트랜지션 효과마다 요구되는 제어 파라미터의 형태와 수치 제약이 극단적으로 상이합니다. 다운스트림 프로젝트들이 가장 빈번하게 겪는 스키마 설계 병목은 **트랜지션 파라미터 다양화(Parameter Diversification)**와 **다형성 모델링(Polymorphic Modeling)**입니다.

#### 1. 도메인 과제: 왜 Zod 기반 마스터 스키마에서 병목이 발생하는가?
1. **타입 추론 깊이 초과 (`TS2589`)**: 복잡한 중첩 객체(Point2D, Bezier 곡선, 셰이더 유니폼 맵)를 포함하는 6종 이상의 유니언을 `z.discriminatedUnion`으로 합성하면 TypeScript 컴파일러의 타입 인스턴스화 깊이가 급증합니다.
2. **수치 경계 메타데이터 손실**: `$0.0 \le x \le 1.0$`이나 `$angle < 360.0$` 등의 제약을 Zod의 `.refine()`으로 작성하면 JSON Schema 및 OpenAPI 3.1의 `minimum`, `maximum`, `exclusiveMinimum` 키워드로 정적 투영되지 못합니다.
3. **런타임 번들 페널티**: Chrome MV3 확장 프로그램이나 고성능 DevTools 패널에서 Zod 런타임 엔진을 직접 참조하면 CSP 위반 및 프레임 드랍이 유발됩니다.

#### 2. 해결책: TypeSpec (`.tsp`) Stage 1 SSOT 중심 4단계 파이프라인
TypeSpec의 `@discriminator("type")`과 모델 상속(`extends VideoTransitionBase`), 그리고 내장 데코레이터(`@minValue`, `@maxValue`, `@pattern`, `@doc`)를 적용하면 모든 트랜지션 파라미터를 단일 정본 스펙으로 선언하고 4단계 산출물로 완전 자동 투영할 수 있습니다.

```tsp
// schemas/transitions/video-transitions.tsp
// @service가 있어야 OpenAPI emitter가 operation에서 참조하지 않는 model도 components.schemas로 내보낸다.
@service(#{ title: "Studio Media Transitions" })
namespace Studio.Media.Transitions;

@doc("Standard interpolation curve and easing timing functions")
enum TimingFunction {
  linear: "linear",
  easeIn: "ease-in",
  easeOut: "ease-out",
  easeInOut: "ease-in-out",
  cubicBezier: "cubic-bezier",
}

@doc("Normalized 2D point coordinate in unit interval [0.0, 1.0]")
model Point2D {
  @doc("X coordinate fraction [0.0, 1.0]")
  @minValue(0.0)
  @maxValue(1.0)
  x: float64;

  @doc("Y coordinate fraction [0.0, 1.0]")
  @minValue(0.0)
  @maxValue(1.0)
  y: float64;
}

@doc("Custom cubic-bezier curve control points P1(x1, y1) and P2(x2, y2)")
model CubicBezierTiming {
  @doc("Timing function discriminator")
  type: TimingFunction.cubicBezier;

  @doc("P1 X control point [0.0, 1.0]")
  @minValue(0.0)
  @maxValue(1.0)
  x1: float64;

  @doc("P1 Y control point")
  y1: float64;

  @doc("P2 X control point [0.0, 1.0]")
  @minValue(0.0)
  @maxValue(1.0)
  x2: float64;

  @doc("P2 Y control point")
  y2: float64;
}

@doc("Base polymorphic video transition contract")
@discriminator("type")
model VideoTransitionBase {
  @doc("Unique transition instance identifier (UUID v4)")
  @pattern("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
  id: string;

  @doc("Discriminator tag identifying transition variant")
  type: string;

  @doc("Transition duration in milliseconds (strictly positive integer)")
  @minValue(1)
  durationMs: int32 = 500;

  @doc("Interpolation curve or custom cubic-bezier timing")
  timing?: TimingFunction | CubicBezierTiming = TimingFunction.easeInOut;

  @doc("Whether audio channels should crossfade synchronously with video")
  audioCrossfade?: boolean = true;

  @doc("Cut-point alignment anchor on timeline")
  alignment?: "center" | "start-at-cut" | "end-at-cut" = "center";
}

@doc("Fade transition variant (fade-in, fade-out, or crossfade to solid color)")
model FadeTransition extends VideoTransitionBase {
  type: "fade";

  @doc("Fade behavior mode")
  mode: "fade-in" | "fade-out" | "crossfade" = "crossfade";

  @doc("Target fade color formatted as 3-, 6-, or 8-digit hexadecimal string")
  @pattern("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
  color?: string = "#000000";
}

@doc("Wipe transition variant with directional or radial boundary sweep")
model WipeTransition extends VideoTransitionBase {
  type: "wipe";

  @doc("Primary sweep direction or pattern")
  direction: "left" | "right" | "up" | "down" | "radial" | "diagonal" = "left";

  @doc("Edge feathering softness fraction [0.0, 1.0]")
  @minValue(0.0)
  @maxValue(1.0)
  softness?: float64 = 0.1;

  @doc("Rotation angle in degrees [0.0, 360.0]")
  @minValue(0.0)
  @maxValue(360.0)
  angleDeg?: float64 = 0.0;
}

@doc("Slide transition variant where new clip translates into frame")
model SlideTransition extends VideoTransitionBase {
  type: "slide";

  @doc("Slide entrance direction")
  direction: "left" | "right" | "up" | "down" = "left";

  @doc("When true, outgoing clip is pushed out; when false, incoming clip slides over")
  push?: boolean = false;

  @doc("Normalized travel distance fraction [0.0, 1.0]")
  @minValue(0.0)
  @maxValue(1.0)
  distanceFraction?: float64 = 1.0;
}

@doc("Dissolve transition variant using mathematical noise or grain blending")
model DissolveTransition extends VideoTransitionBase {
  type: "dissolve";

  @doc("Algorithmic dissolve pattern")
  pattern: "cross" | "dither" | "additive" | "film-grain" = "cross";

  @doc("Noise texture frequency scale factor [0.1, 10.0]")
  @minValue(0.1)
  @maxValue(10.0)
  noiseScale?: float64 = 1.0;

  @doc("Blend intensity multiplier [0.0, 1.0]")
  @minValue(0.0)
  @maxValue(1.0)
  intensity?: float64 = 1.0;
}

@doc("Zoom transition variant scaling from origin anchor point")
model ZoomTransition extends VideoTransitionBase {
  type: "zoom";

  @doc("Normalized focal origin coordinate [0.0, 1.0]")
  origin?: Point2D;

  @doc("Initial scale factor (> 0.0)")
  @minValueExclusive(0.0)
  scaleStart?: float64 = 1.0;

  @doc("Final scale factor (> 0.0)")
  @minValueExclusive(0.0)
  scaleEnd?: float64 = 2.0;

  @doc("Simulate directional camera motion blur during zoom")
  motionBlur?: boolean = true;
}

@doc("Custom hardware-accelerated GLSL fragment shader transition")
model GlTransition extends VideoTransitionBase {
  type: "gl";

  @doc("GLSL fragment shader source code or asset URI")
  @minLength(10)
  shaderSource: string;

  @doc("Arbitrary shader uniform values passed to WebGL/WebGPU pipeline")
  uniforms?: Record<unknown>;

  @doc("Texture sampling filter mode for clip framebuffers")
  textureFiltering?: "linear" | "nearest" = "linear";
}

// Exhaustive polymorphic union of all video transition types (alias에는 decorator를 붙일 수 없다)
alias VideoTransition =
  | FadeTransition
  | WipeTransition
  | SlideTransition
  | DissolveTransition
  | ZoomTransition
  | GlTransition;
```

#### 3. Stage 2 산출물: JSON Schema Draft 2020-12 투영 (`video-transitions.json`)
아래 JSON은 Browser Studio 표준이 기대하는 Draft 2020-12 형태입니다. 위 `.tsp`로 `oa-gen generate`(TypeSpec 1.16)를 실행하면 실제로는 OpenAPI 3.2.0 문서와 `$defs` 번들이 생기고, `discriminator.mapping`은 `VideoTransitionBase`에 붙으며 각 변형은 `allOf`로 base를 참조합니다. alias `VideoTransition`은 component가 되지 않습니다:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://browser-studio.dev/schemas/v1/video-transitions.json",
  "title": "VideoTransition",
  "oneOf": [
    { "$ref": "#/$defs/FadeTransition" },
    { "$ref": "#/$defs/WipeTransition" },
    { "$ref": "#/$defs/SlideTransition" },
    { "$ref": "#/$defs/DissolveTransition" },
    { "$ref": "#/$defs/ZoomTransition" },
    { "$ref": "#/$defs/GlTransition" }
  ],
  "discriminator": {
    "propertyName": "type"
  },
  "$defs": {
    "FadeTransition": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
        },
        "type": { "type": "string", "const": "fade" },
        "durationMs": { "type": "integer", "minimum": 1 },
        "mode": { "type": "string", "enum": ["fade-in", "fade-out", "crossfade"] },
        "color": { "type": "string", "pattern": "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$" }
      },
      "required": ["id", "type", "durationMs", "mode"],
      "additionalProperties": false
    },
    "WipeTransition": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "const": "wipe" },
        "durationMs": { "type": "integer", "minimum": 1 },
        "direction": { "type": "string", "enum": ["left", "right", "up", "down", "radial", "diagonal"] },
        "softness": { "type": "number", "minimum": 0, "maximum": 1 },
        "angleDeg": { "type": "number", "minimum": 0, "maximum": 360 }
      },
      "required": ["id", "type", "durationMs", "direction"],
      "additionalProperties": false
    },
    "SlideTransition": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "const": "slide" },
        "durationMs": { "type": "integer", "minimum": 1 },
        "direction": { "type": "string", "enum": ["left", "right", "up", "down"] },
        "push": { "type": "boolean" },
        "distanceFraction": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["id", "type", "durationMs", "direction"],
      "additionalProperties": false
    },
    "DissolveTransition": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "const": "dissolve" },
        "durationMs": { "type": "integer", "minimum": 1 },
        "pattern": { "type": "string", "enum": ["cross", "dither", "additive", "film-grain"] },
        "noiseScale": { "type": "number", "minimum": 0.1, "maximum": 10 },
        "intensity": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["id", "type", "durationMs", "pattern"],
      "additionalProperties": false
    },
    "ZoomTransition": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "const": "zoom" },
        "durationMs": { "type": "integer", "minimum": 1 },
        "origin": {
          "type": "object",
          "properties": {
            "x": { "type": "number", "minimum": 0, "maximum": 1 },
            "y": { "type": "number", "minimum": 0, "maximum": 1 }
          },
          "required": ["x", "y"]
        },
        "scaleStart": { "type": "number", "exclusiveMinimum": 0 },
        "scaleEnd": { "type": "number", "exclusiveMinimum": 0 },
        "motionBlur": { "type": "boolean" }
      },
      "required": ["id", "type", "durationMs"],
      "additionalProperties": false
    },
    "GlTransition": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "const": "gl" },
        "durationMs": { "type": "integer", "minimum": 1 },
        "shaderSource": { "type": "string", "minLength": 10 },
        "uniforms": { "type": "object", "additionalProperties": true },
        "textureFiltering": { "type": "string", "enum": ["linear", "nearest"] }
      },
      "required": ["id", "type", "durationMs", "shaderSource"],
      "additionalProperties": false
    }
  }
}
```

#### 4. Stage 3 산출물: OpenAPI 3.1 오퍼레이션 컨트랙트 투영
트랜지션 미리보기 렌더링 RPC/REST 엔드포인트는 RFC 9457 `ProblemDetails` 오류 응답과 함께 엄격한 오퍼레이션 컨트랙트로 선언합니다(아래는 Zod 모듈 원본에서 나온 3.1 형태의 예시입니다):

```yaml
openapi: 3.1.0
info:
  title: Studio Timeline Transition Preview API
  version: 1.0.0
  description: OpenAPI 3.1 operation contract for real-time video transition rendering.
x-schema-engine-profile: operation-contract
x-schema-engine-version-hash: sha256:d4e8b3...
paths:
  /api/v1/timeline/transitions/preview:
    post:
      summary: Render Video Transition Preview Frame
      operationId: previewTimelineTransition
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VideoTransition'
      responses:
        '200':
          description: Preview frame rendered successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  previewUrl:
                    type: string
                    format: uri
                  renderTimeMs:
                    type: number
                    minimum: 0
                required:
                  - previewUrl
                  - renderTimeMs
        '422':
          description: Invalid transition parameter configuration
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
components:
  schemas:
    VideoTransition:
      oneOf:
        - $ref: '#/components/schemas/FadeTransition'
        - $ref: '#/components/schemas/WipeTransition'
        - $ref: '#/components/schemas/SlideTransition'
        - $ref: '#/components/schemas/DissolveTransition'
        - $ref: '#/components/schemas/ZoomTransition'
        - $ref: '#/components/schemas/GlTransition'
      discriminator:
        propertyName: type
```

#### 5. Stage 4 산출물: Standalone Zero-Eval Type Guards (`dist/guards/guards/VideoTransition.js`)
Chrome MV3 브라우저 확장 프로그램의 Content Scripts나 WebGL 렌더러는 60fps 렌더링 주기 안에서 트랜지션 페이로드를 검증해야 합니다. `@oa-sdk/codegen`은 점프 테이블(`switch`) 기반의 고속 타입 가드를 생성합니다:

```typescript
// dist/guards/guards/VideoTransition.d.ts
export interface FadeTransition {
  id: string;
  type: 'fade';
  durationMs: number;
  mode: 'fade-in' | 'fade-out' | 'crossfade';
  color?: string;
}

export interface WipeTransition {
  id: string;
  type: 'wipe';
  durationMs: number;
  direction: 'left' | 'right' | 'up' | 'down' | 'radial' | 'diagonal';
  softness?: number;
  angleDeg?: number;
}

export interface SlideTransition {
  id: string;
  type: 'slide';
  durationMs: number;
  direction: 'left' | 'right' | 'up' | 'down';
  push?: boolean;
  distanceFraction?: number;
}

export interface DissolveTransition {
  id: string;
  type: 'dissolve';
  durationMs: number;
  pattern: 'cross' | 'dither' | 'additive' | 'film-grain';
  noiseScale?: number;
  intensity?: number;
}

export interface ZoomTransition {
  id: string;
  type: 'zoom';
  durationMs: number;
  origin?: { x: number; y: number };
  scaleStart?: number;
  scaleEnd?: number;
  motionBlur?: boolean;
}

export interface GlTransition {
  id: string;
  type: 'gl';
  durationMs: number;
  shaderSource: string;
  uniforms?: Record<string, unknown>;
  textureFiltering?: 'linear' | 'nearest';
}

export type VideoTransition =
  | FadeTransition
  | WipeTransition
  | SlideTransition
  | DissolveTransition
  | ZoomTransition
  | GlTransition;

export function isVideoTransition(data: unknown): data is VideoTransition;
export function isFadeTransition(data: unknown): data is FadeTransition;
export function isGlTransition(data: unknown): data is GlTransition;
```

#### 6. Stage 5 (Bridge): Zero-Drift MCP Tools & Interactive CLI (`@oa-sdk/tools`)
빌드된 JSON Schema Draft 2020-12는 `@oa-sdk/tools`의 `createSchemaTool`을 통해 AI 에이전트와 CLI 명령어에 즉각 바인딩됩니다. 추가 스키마 선언 없이 완벽한 0-드리프트를 달성합니다:

```typescript
import { createSchemaTool } from '@oa-sdk/tools';

export const previewVideoTransitionTool = createSchemaTool({
  name: 'preview_video_transition',
  description: 'Renders and verifies a polymorphic video transition configuration across timeline clips.',
  schema: {
    type: 'object',
    properties: {
      timelineId: { type: 'string', minLength: 1 },
      transition: { $ref: '#/$defs/VideoTransition' },
      frameOffsetMs: { type: 'integer', minimum: 0 },
    },
    required: ['timelineId', 'transition'],
  },
  execute: async (_ctx, { timelineId, transition, frameOffsetMs = 0 }) => {
    return {
      success: true,
      previewUrl: `https://studio.local/previews/${timelineId}/frame_${frameOffsetMs}.webp`,
      transitionType: (transition as { type: string }).type,
    };
  },
});
```

#### 7. 아키텍처 비교 요약: TypeSpec vs. Zod
| 평가 차원 | TypeSpec (`.tsp`) Stage 1 SSOT | Zod Master Schema (레거시/어댑터) |
|---|---|---|
| **다형성 유니언 작성 편의성** | `@discriminator("type")` + `model extends`로 선언적 작성 | `z.discriminatedUnion([...])` 긴 배열 수작업 나열 |
| **타입 추론 복잡도** | 컴파일 타임 네이티브 AST 심볼 색인 (컴파일 속도 최적) | 깊은 제네릭 체인으로 `TS2589` 유발 위험 |
| **엄격한 수치 경계 투영** | `@minValue`, `@maxValue`, `@minValueExclusive`, `@maxValueExclusive`가 Draft 2020-12 / OpenAPI 키워드로 매핑 | `.refine()` 사용 시 정적 OpenAPI 메타데이터 누락 |
| **번들 디커플링 & CSP** | 0 KB 런타임 (정적 컴파일 산출물만 배포) | 런타임 번들 포함 시 번들 비대화 및 MV3 CSP 위험 |
| **MCP Tool & CLI 브릿지** | Stage 2 JSON Schema를 `createSchemaTool`에 전달 | 매번 수작업 인풋 스키마 재작성 필요 |

---

### 6.2 Naming & Export Conventions
All schema definitions in Browser Studio must adhere to strict naming conventions:

| Category | Schema Variable Name | Inferred TypeScript Type | Example |
|---|---|---|---|
| **Domain Model** | `<Name>Schema` | `<Name>` | `SurfaceBlockSchema` $\to$ `SurfaceBlock` |
| **Versioned Model** | `<Name>V<Major>Schema` | `<Name>V<Major>` | `ResourceManifestV1Schema` $\to$ `ResourceManifestV1` |
| **RPC Request Params** | `<Method>ParamsSchema` | `<Method>Params` | `SessionHelloParamsSchema` $\to$ `SessionHelloParams` |
| **RPC Response Result** | `<Method>ResultSchema` | `<Method>Result` | `SessionHelloResultSchema` $\to$ `SessionHelloResult` |
| **MCP Input Contract** | `<Tool>InputSchema` | `<Tool>Input` | `InspectElementInputSchema` $\to$ `InspectElementInput` |
| **Discriminated Union** | `<Entity>UnionSchema` or `<Entity>Schema` | `<Entity>` | `PatchOpSchema` $\to$ `PatchOp` |

---

### 6.3 Discriminated Unions for Polymorphic Payloads
When defining polymorphic data structures (e.g. `PatchOp`, `BrowserActionStepV1`, `DevLinkMcpControlRequestV1`), always use `z.discriminatedUnion()` with a single literal discriminator field (`type`, `action`, `operation`, or `op`):

```typescript
// Correct: Discriminated Union with tag 'op'
export const UpdateParamOpSchema = z.object({
  op: z.literal('update-param'),
  paramId: z.string().min(1),
  newValue: z.string(),
  previousValue: z.string().optional(),
});

export const InsertParamOpSchema = z.object({
  op: z.literal('insert-param'),
  paramName: z.string().min(1),
  value: z.string(),
  afterParamId: z.string().optional(),
});

export const DeleteParamOpSchema = z.object({
  op: z.literal('delete-param'),
  paramId: z.string().min(1),
});

export const PatchOpSchema = z.discriminatedUnion('op', [
  UpdateParamOpSchema,
  InsertParamOpSchema,
  DeleteParamOpSchema,
]);

export type PatchOp = z.infer<typeof PatchOpSchema>;
```

#### Why `z.discriminatedUnion` is Mandatory:
1. **$O(1)$ Dispatch**: Standalone AJV generators emit direct `switch (data.op)` jump tables instead of trying all union members sequentially ($O(N)$).
2. **OpenAPI 3.1 Mapping**: Translates cleanly to `oneOf` with `discriminator: { propertyName: 'op' }`.
3. **Exhaustive Type Narrowing**: TypeScript compiler performs 100% exhaustive switch checks (`never` branch).

---

### 6.4 Strict Numeric Bounds Drafting Patterns (Inclusive vs. Exclusive)

In OpenAPI 3.0 and JSON Schema Draft 04, exclusive boundaries were expressed using a boolean flag modifier (`minimum: 0, exclusiveMinimum: true`).

In **JSON Schema Draft 2020-12** and **OpenAPI 3.1**, `exclusiveMinimum` and `exclusiveMaximum` are **strictly numeric values**. Providing a boolean value is a meta-schema validation violation and will fail `@oa-sdk/parser` lint checks.

#### Comparative Numeric Constraint Matrix:

| Mathematical Condition | Zod Master Schema Chain | JSON Schema 2020-12 / OAS 3.1 Keyword | Legacy Draft 04 / OAS 3.0 (Forbidden) |
|---|---|---|---|
| $x \ge 0$ (Non-negative float) | `z.number().min(0)` or `z.number().nonnegative()` | `{"type": "number", "minimum": 0}` | `{"minimum": 0}` |
| $n \ge 0$ (Non-negative integer) | `z.number().int().min(0)` or `.int().nonnegative()` | `{"type": "integer", "minimum": 0}` | `{"type": "integer", "minimum": 0}` |
| $x > 0$ (Strictly positive float) | `z.number().gt(0)` or `z.number().positive()` | `{"type": "number", "exclusiveMinimum": 0}` | `{"minimum": 0, "exclusiveMinimum": true}` ❌ |
| $n > 0$ (Strictly positive integer) | `z.number().int().gt(0)` or `.int().positive()` | `{"type": "integer", "exclusiveMinimum": 0}` | `{"type": "integer", "minimum": 0, "exclusiveMinimum": true}` ❌ |
| $x \le 100$ (Upper bound float) | `z.number().max(100)` or `z.number().nonpositive()` (for 0) | `{"type": "number", "maximum": 100}` | `{"maximum": 100}` |
| $x < 100$ (Strict upper bound float)| `z.number().lt(100)` or `z.number().negative()` (for 0) | `{"type": "number", "exclusiveMaximum": 100}` | `{"maximum": 100, "exclusiveMaximum": true}` ❌ |
| $0 \le x \le 1$ (Closed unit interval)| `z.number().min(0).max(1)` | `{"minimum": 0, "maximum": 1}` | `{"minimum": 0, "maximum": 1}` |
| $0 < x < 1$ (Open unit interval) | `z.number().gt(0).lt(1)` | `{"exclusiveMinimum": 0, "exclusiveMaximum": 1}` | `{"minimum": 0, "exclusiveMinimum": true, "maximum": 1, "exclusiveMaximum": true}` ❌ |
| $0 \le x < 1$ (Half-open interval) | `z.number().min(0).lt(1)` | `{"minimum": 0, "exclusiveMaximum": 1}` | `{"minimum": 0, "maximum": 1, "exclusiveMaximum": true}` ❌ |

#### Authoring Rules: DOs and DON'Ts

```typescript
// ❌ DON'T: Using custom .refine() for numeric boundaries or boolean flags
// Custom refinements cannot be statically analyzed into JSON Schema / OpenAPI bounds!
export const BadNumericBoundsSchema = z.object({
  // ❌ Cannot be projected to OpenAPI minimum/exclusiveMinimum:
  customPositive: z.number().refine((val) => val > 0, { message: 'Must be positive' }),
  // ❌ Ambiguous boundary: using .min(1) for a float when 0.1 should be valid
  pixelRatio: z.number().min(1),
  // ❌ Misinterpreting exclusive boundary in Draft 2020-12
  zeroExcluded: z.number().nonnegative(), // allows 0!
});

// ✅ DO: Using declarative Zod chain methods that compile to Draft 2020-12 / OAS 3.1 keywords
export const GoodNumericBoundsSchema = z.object({
  // Non-negative float (x >= 0): compiles to { type: 'number', minimum: 0 }
  opacity: z.number().min(0).max(1).describe('Opacity fraction [0.0, 1.0]'),
  // or equivalently:
  scale: z.number().nonnegative().describe('Scale factor >= 0.0'),

  // Strictly positive float (x > 0): compiles to { type: 'number', exclusiveMinimum: 0 }
  zoomFactor: z.number().gt(0).describe('Zoom factor strictly greater than 0.0'),
  // or equivalently:
  width: z.number().positive().describe('Width strictly greater than 0.0'),

  // Non-negative integer (n >= 0): compiles to { type: 'integer', minimum: 0 }
  startOffset: z.number().int().nonnegative().describe('0-based UTF-16 character offset'),

  // Strictly positive integer (n > 0): compiles to { type: 'integer', exclusiveMinimum: 0 }
  pageSize: z.number().int().positive().describe('Page size must be >= 1'),

  // Half-open interval [0, 1): compiles to { minimum: 0, exclusiveMaximum: 1 }
  progress: z.number().min(0).lt(1).describe('Progress fraction in range [0.0, 1.0)'),
});
```

#### Complete Runnable Code Example:

```typescript
// packages/inspector-controls/src/numeric-bounds-example.ts
import { z } from 'zod';

export const TransformControlsSchema = z.object({
  // Inclusive: 0 <= scale <= 10
  scale: z
    .number()
    .min(0)
    .max(10)
    .describe('Scale factor between 0.0 (inclusive) and 10.0 (inclusive)'),

  // Strictly positive: width > 0
  widthPx: z
    .number()
    .positive()
    .describe('Pixel width must be strictly greater than 0'),

  // Strictly positive integer: frameCount > 0, integer
  frameCount: z
    .number()
    .int()
    .positive()
    .describe('Total rendering frame count must be a positive non-zero integer'),

  // Half-open interval: 0.0 <= normalizedProgress < 1.0
  normalizedProgress: z
    .number()
    .min(0)
    .lt(1)
    .describe('Animation progress fraction in range [0.0, 1.0)'),

  // Non-negative integer index: 0, 1, 2, ...
  layerIndex: z
    .number()
    .int()
    .nonnegative()
    .describe('0-based layer index'),
});

export type TransformControls = z.infer<typeof TransformControlsSchema>;
```

---

### 6.5 Self-Referencing Recursive Schemas (`z.lazy` + Registry Cycle-Safe Projection)

When modeling hierarchical tree structures (such as `VisualTreeNode`, `SurfaceBlockTree`, or recursive expression ASTs), naive recursive type inference triggers TypeScript errors:
- **TS7022**: *'NodeSchema' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.*
- **TS2456**: *Type alias circularly references itself.*

#### Authoring Rules: DOs and DON'Ts

```typescript
// ❌ DON'T: Recursive schema without explicit interface and type annotation
// TypeScript cannot infer self-referential types without explicit typing,
// resulting in TS7022 / TS2456 errors or infinite compiler type instantiation loops!
export const BadVisualTreeNodeSchema = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    // ❌ Error TS7022: 'BadVisualTreeNodeSchema' implicitly has type 'any'
    children: z.array(BadVisualTreeNodeSchema).optional(),
  })
);

// ✅ DO: Normative 4-step pattern for self-referencing recursive models
// 1. Declare explicit recursive TypeScript interface
// 2. Explicitly annotate the schema variable with z.ZodType<T>
// 3. Wrap definition in z.lazy(() => z.object({ ... }))
// 4. Register in projection registry refs map for cycle-safe $ref emission
```

#### The Normative Pattern for Recursive Schemas:
1. **Explicit TypeScript Interface**: Define the explicit recursive interface first.
2. **Explicit `z.ZodType<T>` Annotation**: Annotate the schema variable with `z.ZodType<T>`.
3. **Wrap in `z.lazy(() => ...)`**: Lazy-evaluate the recursive child reference.
4. **Registry Registration**: Register the schema in the projection registry (`refs` map) to ensure cyclic references are converted to local `$ref` pointers (`#/$defs/<Name>` or `#/components/schemas/<Name>`) rather than causing infinite expansion during build-time serialization.

#### Complete Runnable Code Example (Recursive Tree):

```typescript
// packages/visual-ir/src/types/visual-tree.ts
import { z } from 'zod';

/**
 * Step 1: Explicit recursive TypeScript interface.
 */
export interface VisualTreeNode {
  id: string;
  type: 'frame' | 'group' | 'text' | 'shape';
  name: string;
  visible: boolean;
  children?: VisualTreeNode[];
  metadata?: Record<string, unknown>;
}

/**
 * Step 2 & 3: Annotated recursive Zod schema using z.lazy.
 */
export const VisualTreeNodeSchema: z.ZodType<VisualTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid().describe('Unique visual tree node identifier'),
    type: z.enum(['frame', 'group', 'text', 'shape']).describe('Visual node categorization'),
    name: z.string().min(1).describe('Human-readable node label'),
    visible: z.boolean().default(true).describe('Node visibility flag in viewport'),
    children: z
      .array(VisualTreeNodeSchema)
      .optional()
      .describe('Hierarchical child nodes in paint render order'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arbitrary plugin or toolchain metadata'),
  })
);

/**
 * Document root wrapping recursive nodes.
 */
export const VisualTreeDocumentSchema = z.object({
  documentId: z.string().uuid(),
  version: z.number().int().positive(),
  root: VisualTreeNodeSchema,
});
export type VisualTreeDocument = z.infer<typeof VisualTreeDocumentSchema>;
```

#### Cycle-Safe Projection Engine Mechanics:
During projection to JSON Schema Draft 2020-12 or OpenAPI 3.1:
1. The projection engine registers `VisualTreeNodeSchema` in `context.refs.set(VisualTreeNodeSchema, 'VisualTreeNode')`.
2. Only the root of each component conversion is expanded. Below the root, every registered schema, including the recursive `VisualTreeNodeSchema` child, is emitted as `{ $ref: "#/components/schemas/VisualTreeNode" }`, so the recursion stops at its registered entry.
3. This completely prevents call stack overflow and produces clean, compliant cyclic reference graphs:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://browser-studio.dev/schemas/v1/visual-tree.json",
  "title": "VisualTreeNode",
  "type": "object",
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "type": { "type": "string", "enum": ["frame", "group", "text", "shape"] },
    "name": { "type": "string", "minLength": 1 },
    "visible": { "type": "boolean", "default": true },
    "children": {
      "type": "array",
      "items": { "$ref": "#/$defs/VisualTreeNode" }
    },
    "metadata": { "type": "object", "additionalProperties": true }
  },
  "required": ["id", "type", "name", "visible"],
  "additionalProperties": false,
  "$defs": {
    "VisualTreeNode": {
      "$ref": "#"
    }
  }
}
```

#### OpenAPI 3.1 Cyclic `$ref` Validation Behavior
OpenAPI 3.1 and JSON Schema Draft 2020-12 natively support cyclic `$ref` structures within `components.schemas` and `$defs`. `@oa-sdk/parser` treats a cycle that passes through an instance-descending keyword (`properties`, `items`, ...) as valid recursion and reports nothing; only a cycle that never descends (e.g. `A: { $ref: B }`, `B: { $ref: A }`) is a `refs/cycle` error, which `oa-gen lint` reports. `oa-gen validate` currently filters out every `refs/cycle` diagnostic (known defect), so run `oa-gen lint` to catch the non-descending kind.

---

### 6.6 `x-surface-*` Scoping Rules (Object-Level vs. Inline Property-Level)

The Surface Engine powers non-AST live-patching and inspector interaction. Formal surface metadata extensions are declared in `@oa-sdk/openapi-projection-contract` and validated by `@oa-sdk/parser`.

#### The 5 Canonical Surface Vendor Extensions:

1. **`x-surface-anchor`**: AST synchronization and code anchor coordinates:
   - `id` (`string`, required): Unique anchor identifier.
   - `line` (`integer`, required, $\ge 1$): 1-based source line number.
   - `column` (`integer`, required, $\ge 1$): 1-based source column number.
   - `raw` (`string`, optional): Original raw source token text.
   - `commentType` (`string`, optional): `'line' | 'block' | 'doc' | string`.
2. **`x-surface-param-range`**: Non-AST character range and live-patching boundaries:
   - `targetProperty` (`string`, required in object-level scope): Primary property target for live mutations.
   - `start` (`integer`, optional, $\ge 0$): 0-based UTF-16 character start offset.
   - `end` (`integer`, optional, $\ge 0$): 0-based UTF-16 character end offset.
   - `unquotedStart` (`integer`, optional): Start offset excluding enclosing quotes.
   - `unquotedEnd` (`integer`, optional): End offset excluding enclosing quotes.
   - `supportsLivePatch` (`boolean`, optional): Enables 60fps live range patching.
   - `maxFramerateHz` (`number`, optional, $> 0$): Throttling cap for slider scrubbing (e.g. 60 or 120).
3. **`x-surface-fingerprint`**: Deterministic SHA-256 fingerprint for AST/content drift detection:
   - String matching regex `^sha256:[a-f0-9]{64}$` (e.g. `"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`).
4. **`x-surface-quote-style`**: Preferred code string literal quote style:
   - Enum: `'single' | 'double' | 'backtick' | 'none'`.
5. **`x-surface-patch-policy`**: Rebase and drift recovery strategy when editing out-of-sync documents:
   - `onDrift` (`enum`: `'abort' | 'rebase' | 'force'`, required): Action taken on baseline drift.
   - `retryLimit` (`integer`, optional, $\ge 0$): Maximum rebase retry attempts.

#### Two Distinct Scoping Tiers:

##### 1. Object-Level Scope (`targetProperty`)
Declared at the top-level of an object schema to bind multi-property live-patching coordinates (e.g. associating `name`, `nameRange`, `value`, `valueRange`, and `unquotedValue`):
- `targetProperty` (`string`, **required for object scope**): Designates which property in `properties` is the primary target for live-patch mutations.
- `supportsLivePatch` (`boolean`): Indicates whether this entity supports 60fps non-AST live range patching.
- `maxFramerateHz` (`number`): Throttling cap for slider scrubbing (e.g. 60 or 120).
- `driftCheckAlgorithm` (`enum`: `'sha256' | 'character-count' | 'none'`): Integrity verification method.

##### 2. Inline Property-Level Scope
Attached directly inside individual property definitions in `properties` to configure editor behavior for that specific property:
- `x-surface-quote-style` (`enum`: `'single' | 'double' | 'backtick' | 'none'`): Preferred code string quote style.
- `x-surface-live-patch` (`boolean`): Whether this specific property accepts live patch transactions.
- `x-surface-ui-editor` (`enum`: `'color-picker' | 'scrubber' | 'select' | 'toggle' | 'box-model' | 'text-input'`): UI inspector controller component binding.
- `x-surface-formatter` (`string`): Formatter pipe identifier (e.g. `'px'`, `'rem'`, `'hex-color'`).

#### Scoping Precedence & Governance Invariants:
1. **Precedence**: Property-level inline annotations override object-level defaults.
2. **Lint Validation**: `@oa-sdk/parser` and `oa-gen lint --categories surface` verify that any `targetProperty` declared in an object-level `x-surface-*` extension **must exist** as a defined key in the schema's `properties` map.
3. **Format Validation**: `x-surface-fingerprint` must strictly conform to `^sha256:[a-f0-9]{64}$`.

#### Complete Runnable Example with Both Scopes:

```json
{
  "SurfaceParam": {
    "type": "object",
    "required": ["id", "name", "nameRange", "value", "valueRange", "unquotedValue", "unquotedRange", "inferredType"],
    "properties": {
      "id": { "type": "string", "minLength": 1 },
      "name": { "type": "string", "minLength": 1 },
      "nameRange": { "$ref": "#/$defs/CharRange" },
      "value": {
        "type": "string",
        "description": "Formatted CSS parameter value representation",
        "x-surface-quote-style": "double",
        "x-surface-live-patch": true
      },
      "valueRange": { "$ref": "#/$defs/CharRange" },
      "unquotedValue": { "type": "string" },
      "unquotedRange": { "$ref": "#/$defs/CharRange" },
      "inferredType": {
        "type": "string",
        "enum": ["color", "dimension", "typography", "shadow", "spacing", "flex", "keyword", "raw"]
      },
      "colorFormat": {
        "type": "string",
        "enum": ["hex", "rgb", "hsl", "oklch"],
        "x-surface-ui-editor": "color-picker"
      }
    },
    "x-surface-param-range": {
      "targetProperty": "value",
      "supportsLivePatch": true,
      "maxFramerateHz": 120,
      "driftCheckAlgorithm": "sha256"
    },
    "x-surface-patch-policy": {
      "onDrift": "rebase",
      "retryLimit": 3
    },
    "x-surface-fingerprint": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

```typescript
import { z } from 'zod';
import type { SurfaceExtensionFields } from '@oa-sdk/openapi-projection-contract';

// Reusable character range schema
export const CharRangeSchema = z.object({
  start: z.number().int().nonnegative().describe('0-based UTF-16 start offset'),
  end: z.number().int().nonnegative().describe('0-based UTF-16 end offset (exclusive)'),
  length: z.number().int().nonnegative().describe('Character span length'),
});

// Zod Authoring schema for SurfaceParam
export const SurfaceParamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameRange: CharRangeSchema,
  value: z.string().describe('Formatted CSS parameter value representation'),
  valueRange: CharRangeSchema,
  unquotedValue: z.string(),
  unquotedRange: CharRangeSchema,
  inferredType: z.enum(['color', 'dimension', 'typography', 'shadow', 'spacing', 'flex', 'keyword', 'raw']),
  colorFormat: z.enum(['hex', 'rgb', 'hsl', 'oklch']).optional(),
});

export type SurfaceParam = z.infer<typeof SurfaceParamSchema>;

// OpenAPI projection metadata attaching x-surface-* vendor extensions
export const surfaceParamExtensions: SurfaceExtensionFields = {
  'x-surface-param-range': {
    targetProperty: 'value',
    supportsLivePatch: true,
    maxFramerateHz: 120,
  },
  'x-surface-patch-policy': {
    onDrift: 'rebase',
    retryLimit: 3,
  },
  'x-surface-fingerprint': 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};
```

---

### 6.7 Rich JSDoc Metadata & Description Annotations
Every property and schema must declare `.describe()` metadata. This description is preserved across JSON Schema 2020-12, OpenAPI 3.1 docs, and generated TypeScript JSDoc:

```typescript
export const WorkspaceLeaseV1Schema = z.object({
  leaseToken: z.string().uuid().describe('Unique UUIDv4 optimistic concurrency lease token'),
  scope: z.enum(['workspace', 'file']).describe('Granularity of concurrency lock'),
  targetPath: z.string().min(1).describe('Absolute or workspace-relative path locked by lease'),
  acquiredAt: z.number().int().positive().describe('Epoch millisecond timestamp when lease was granted'),
  expiresAt: z.number().int().positive().describe('Epoch millisecond timestamp when lease expires'),
  owner: z.string().min(1).describe('Identifier of the client, agent, or extension holding the lease'),
});
```

---

## 7. Mock Testing Strategy & Headless CI Verification

### 7.1 Headless CI Protocol Simulation
To test DevLink extensions, MCP tools, and session hosts without launching real Chrome browser binaries or spawning desktop host processes, tests leverage `@oa-sdk/mock-server` coupled with protocol framing stream adapters.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                HEADLESS CI TEST RUNNER                                  │
│   • Native RPC Tests (session.hello -> lease.acquire -> materialize.css)                │
│   • MCP Stdio Tool Tests (selection.select -> style.inspect -> commit.style)            │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ (Protocol Framing)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PROTOCOL FRAMING ADAPTERS (packages/devlink-session-host/test/mock)                     │
│   1. NativeMessagingMockStream: Encodes/decodes 4-byte LE length-prefixed JSON buffers  │
│   2. McpStdioMockStream: Encodes/decodes line-delimited JSON-RPC 2.0 frames             │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ (Normalized RequestParts: POST /rpc/...)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ @oa-sdk/mock-server ENGINE (createNodeMockServer / handleRequest)                       │
│   • Validates incoming parameters & body against OpenAPI 3.1 schema (AJV 2020)          │
│   • Evaluates programmatic overrides (server.override('materializeCss', { status: 200 }))│
│   • Generates realistic mock responses matching schema definitions (generateAlgebra)    │
│   • Emits 422 { error: { code, message, details } } on invalid payloads (RFC 9457 via   │
│     override() only)                                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Native Host Framing Adapter Example
```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server';
import { Readable, Writable } from 'node:stream';

export class NativeMessagingMockStream {
  public static encodeMessage(obj: unknown): Buffer {
    const json = JSON.stringify(obj);
    const bodyBuf = Buffer.from(json, 'utf8');
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32LE(bodyBuf.length, 0);
    return Buffer.concat([headerBuf, bodyBuf]);
  }

  public static decodeMessage(buffer: Buffer): unknown {
    const length = buffer.readUInt32LE(0);
    const body = buffer.subarray(4, 4 + length).toString('utf8');
    return JSON.parse(body);
  }
}
```

### 7.3 Programmatic Scenario Overrides for CI
`@oa-sdk/mock-server` allows CI tests to deterministically simulate error scenarios without complex test fixtures:

```typescript
// Simulate optimistic lease conflict error conforming to RFC 9457
mockServer.override('leaseAcquire', {
  status: 409,
  headers: { 'Content-Type': 'application/problem+json' },
  body: {
    type: 'https://browser-studio.dev/errors/lease-conflict',
    title: 'Lease Conflict',
    status: 409,
    detail: 'Target file is currently locked under lease by agent-session-42',
    instance: '/rpc/lease.acquire#conflict',
    code: 'LEASE_CONFLICT',
    details: {
      lockedUntil: Date.now() + 30000,
      currentOwner: 'agent-session-42',
    },
  },
});
```

### 7.4 The 5-Tier CI Verification Matrix

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: Schema Projection & Dialect Conformance                                         │
│   Command: pnpm exec oa-gen validate                                                    │
│   Assert: All Zod schemas project to JSON Schema 2020-12 and OpenAPI 3.1 with 0 errors. │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: OA-SDK Specification Governance & Linting                                       │
│   Command: pnpm exec oa-gen lint --spec <spec> --categories surface,structure,operations│
│   Assert: Zero structural, parameter, reference, surface, or meta-schema violations.    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: Pre-Compiled Type Guard Integrity & Modular Split                               │
│   Command: pnpm exec oa-gen generate && pnpm test:guards                                │
│   Assert: Split ESM type guards reject invalid fixtures and narrow valid types.         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 4: Headless Native RPC & MCP CI Mock Suite                                         │
│   Command: pnpm --filter @browser-studio/devlink-session-host test:mock                 │
│   Assert: Full 17-method RPC and 14-operation MCP workflows complete in <500ms.         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 5: Extension Bundle Decoupling & CSP Audit                                         │
│   Command: pnpm exec oa-gen audit:csp --bundle dist/extension                           │
│   Assert: 0 bytes @oa-sdk/ajv/zod runtime weight; 0 eval / new Function calls.          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Developer Workflow & CLI Reference

### 8.1 Declarative Specification Workflow (`oa.config.ts` & `oa-gen`)

Browser Studio and OA SDK monorepos manage all specification projections, schema drift verification, standalone type guards, and CSP security audits through declarative configuration files (`oa.config.ts`).

> 📖 **Authoritative Guides**:
> - Dual-Layer Configuration (`core` vs `product`), 3 Lifecycle Archetypes (`mvp`, `microservice`, `enterprise`), and Output Path Routing (`outputRouting`): [선언적 스펙 설정 가이드 (oa.config.ts)](./declarative-spec-configuration.md)
> - Complete CLI commands, options, and exit codes: [CLI 명령어 레퍼런스 (oa-gen)](./cli-command-reference.md)

#### Essential `oa.config.ts` Configuration:

```typescript
// oa.config.ts
import { defineConfig } from '@oa-sdk/codegen';

export default defineConfig({
  rootDir: '.',
  specs: [
    {
      id: 'video-transitions',
      profile: 'component-bundle',
      schemaEntry: 'schemas/transitions/video-transitions.tsp',
      outDir: 'artifacts/specs',
      title: 'Studio Media Transitions Specification',
      version: '1.0.0',
    },
    {
      id: 'surface-engine',
      profile: 'component-bundle',
      schemaEntry: 'packages/surface-engine/src/types/schemas.ts',
      outDir: 'artifacts/specs',
      title: 'Surface Engine Component Bundle',
      version: '1.0.0',
    },
    {
      id: 'devlink-contracts',
      profile: 'operation-contract',
      schemaEntry: 'packages/devlink-contracts/src/index.ts',
      outDir: 'artifacts/specs',
      title: 'DevLink Native RPC Operation Contract',
      version: '1.0.0',
    },
    {
      id: 'gateway-api',
      profile: 'full-api-document',
      schemaEntry: 'packages/gateway/src/schema/index.ts',
      outDir: 'artifacts/specs',
      title: 'Browser Studio Gateway REST API',
      version: '1.0.0',
    },
  ],
  guards: {
    outDir: 'dist/guards',
    split: true,
    moduleFormat: 'esm',
    auditCsp: true,
  },
});
```

#### Unified CLI Commands:
```bash
# 1. Validate all declared specification targets (executable from any nested subdirectory)
pnpm exec oa-gen validate

# 2. Export all OpenAPI specifications, JSON Schemas, and standalone type guards
pnpm exec oa-gen generate

# 3. Generate TypeScript type definitions from a projected artifact
pnpm exec oa-gen typegen --spec artifacts/specs/gateway-api.openapi.json --output src/generated/gateway-api.types.ts

# 4. Verify deterministic hash drift between source AST and committed artifacts (CI Gate)
pnpm exec oa-gen drift:check

# 5. Static AST security audit for Manifest V3 CSP compliance
pnpm exec oa-gen audit:csp --bundle dist/guards

# 6. Detect semantic backward compatibility breaking changes
pnpm exec oa-gen diff --base <old.json> --head <new.json> --fail-on-breaking
```

### 8.2 Adding or Modifying a Domain Schema (Step-by-Step)
When introducing a new data model, polymorphic transition parameter, or RPC method:

1. **Define Master Schema in TypeSpec (`.tsp`)**:
   Add or update the model in `schemas/.../*.tsp` using native TypeSpec syntax, decorators (`@discriminator`, `@minValue`, `@maxValue`, `@pattern`, `@doc`). If authoring in TypeScript, define using Zod and leverage `@oa-sdk/ast-sync` for bidirectional AST sync.
2. **Register in `oa.config.ts`**:
   Ensure the schema entry module is declared under `specs` in `oa.config.ts` with the appropriate profile (`component-bundle`, `operation-contract`, or `full-api-document`).
3. **Execute Projection Pipeline**:
   ```bash
   pnpm exec oa-gen validate
   pnpm exec oa-gen generate
   ```
4. **Verify Standalone Type Guards & Zero-Eval CSP**:
   Verify that `dist/guards/guards/<name>.js` and `dist/guards/guards/<name>.d.ts` are generated without compiler warnings, and run `oa-gen audit:csp`.
5. **Bridge to MCP & CLI (`@oa-sdk/tools`)**:
   Pass the generated Stage 2 JSON Schema to `createSchemaTool` for instant AI Agent and CLI availability with zero drift.
6. **Execute Monorepo Tests**:
   ```bash
   pnpm test
   pnpm -r typecheck
   ```

### 8.3 Troubleshooting Common Schema Errors

| Error Symptom | Root Cause | Resolution |
|---|---|---|
| `exclusiveMinimum must be number` | Zod schema used `.positive()` or `.min()` in legacy OpenAPI 3.0 mode (emitting boolean `exclusiveMinimum: true`). | Ensure `targetDialect: '2020-12'` is passed to the converter so numeric `exclusiveMinimum: 0` is emitted. |
| `Unresolved reference #/$defs/X` | OpenAPI 3.1 document references `#/$defs/X` instead of `#/components/schemas/X`. | Ensure spec projector re-maps all internal reference pointers using `remapRefsToOpenApi` to `#/components/schemas/<Name>`. |
| `Circular reference stack overflow` | Recursive schema with `z.lazy` was projected without registering in schema registry `refs` map. | Register the recursive schema instance in `refs` map before projection so cycle-breaking `$ref` is emitted. |
| `targetProperty "foo" not found` | Object-level `x-surface-param-range` specified `targetProperty: "foo"`, but `"foo"` is not in `properties`. | Add `"foo"` to `properties` or correct `targetProperty` name to match an existing property. |
| `Invalid ProblemDetails status` | Error response status code was outside the range $100 \le \text{status} \le 599$. | Ensure HTTP status is a valid 3-digit integer (e.g. 422, 409, 500). |
| `Uncaught EvalError: Refused to evaluate a string as JavaScript` | Browser extension bundle accidentally imported runtime `ajv` or `zod` schema validator. | Replace runtime schema validator with pre-compiled standalone type guard (`import { is<Name> } from '.../dist/guards/...'`). |
| `operationId must be unique` | Duplicate `operationId` across OpenAPI path operations. | Ensure each Native RPC (`sessionHello`, `materializeCss`) and MCP operation (`mcpSessionStatus`) has a unique identifier. |

---

## 9. Normative Reference Matrix & Verification Checklist

Before submitting schema changes or pull requests, verify compliance against this normative checklist:

- [ ] **SSOT**: Master schema is authored in TypeSpec (`.tsp`) (or synchronized via Zod adapter with static `z.infer` TypeScript type).
- [ ] **RFC 9457** (Browser Studio convention): Error responses use `ProblemDetailsSchema` with `application/problem+json` Content-Type for 422, 409, 500.
- [ ] **Numeric Bounds**: $x \ge 0$ authored as `minimum: 0` (`.nonnegative()`); $x > 0$ authored as `exclusiveMinimum: 0` (`.positive()`).
- [ ] **Recursive Trees**: Authored using `z.ZodType<T> = z.lazy(...)` with explicit interface and registered in registry `refs`.
- [ ] **Surface Scope**: Object-level `x-surface-*` specifies valid `targetProperty`; property-level overrides are correctly scoped.
- [ ] **V3 JSDoc Tags**: TypeScript interfaces use canonical validation tags (`@minimum`, `@format`, `@discriminator`).
- [ ] **Zero Eval**: Standalone guards build with 0 `eval()`, 0 `new Function()`, and passes `oa-gen audit:csp`.
- [ ] **Clean Pipeline**: `pnpm test`, `pnpm -r typecheck`, and `pnpm exec oa-gen validate` exit with code 0.

---

## 10. Conclusion

By adhering strictly to the **4-Stage Schema Pipeline**, establishing **TypeSpec (`.tsp`) as the Primary Single Source of Truth** (with Zod as the TypeScript-first authoring format and `@oa-sdk/ast-sync` for Zod, TypeScript, Typia, and JSON Schema roundtrips), standardizing on **RFC 9457 Problem Details** for its own error bodies, and enforcing **Zero-Runtime-Weight Bundle Decoupling**, Browser Studio and downstream projects achieve enterprise-grade specification governance through `@oa-sdk/*` while delivering sub-millisecond 60fps performance and 100% Manifest V3 CSP compliance in browser extensions.
