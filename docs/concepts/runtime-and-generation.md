# Runtime And Generation

## Runtime Adapter

Runtime adapter는 framework runtime에서 OpenAPI document를 추출하는 경계다.

Python template의 FastAPI adapter가 첫 구현체다. TS/JS 쪽은 Hono, Express, Fastify,
Nest 등으로 확장할 수 있다.

## Workspace Index

Workspace Index는 파일 hash, component, `$ref`, source location, diagnostic, generated type
alias metadata를 저장하는 증분 최적화 계층이다.

정확성의 최종 기준은 항상 현재 파일을 다시 읽어 계산한 parser/codegen output이다. Index는
dirty detection과 영향도 계산을 돕지만 source of truth가 아니다.

구현 상세는 [ADR-006](../internal/architecture/006-incremental-workspace-index.md)을 참조한다.

## SchemaAlgebra

SchemaAlgebra는 OpenAPI schema tree를 타입별로 fold하는 해석 패턴이다.

typegen, mock data generation, validation support logic처럼 schema를 여러 방식으로 해석하는
코드가 같은 순회 규칙을 공유할 때 사용한다.

사용 패턴은 [SchemaAlgebra guide](../guides/schema-algebra.md)를 참조한다.

---

## Validation Engine Architecture: Standalone Type Guards vs. Typia AOT

`@oa-sdk`는 사양의 단일 원천(SSOT)에서 생성된 계약 코드가 런타임에서 초고속으로 검증될 수 있도록 정적 코드 생성 및 AOT(Ahead-Of-Time) 검증 아키텍처를 지원한다.

### 1. 3계층 검증 연속체 (Validation Continuum)

```
┌────────────────────────────────────────────────────────────────────────┐
│ 계층 1: 저작 원천 (Authoring SSOT)                                      │
│ • 저장소 production API: TypeSpec + versioned decorators/provenance      │
│ • 외부 TS-first 프로젝트: TypeScript/Zod source를 adapter로 수용        │
│ • source ownership은 project 설정이 정하며 repository path는 TypeSpec-first│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ [oa-gen generate]
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 계층 2: 사양 표준 프로젝션 (Specification Projection)                  │
│ • JSON Schema Draft 2020-12 ($defs, numeric exclusiveMinimum: 0)       │
│ • OpenAPI 3.2 canonical artifact/intake (component-bundle, operation)   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
┌───────────────────────────────────┐┌───────────────────────────────────┐
│ 계층 3A: 독립형 타입 가드          ││ 계층 3B: Typia AOT 검증           │
│ (Standalone Type Guards)          ││ (Ahead-of-Time Transformation)    │
│ • ajv/dist/standalone 사전 컴파일  ││ • TypeScript AST 변환기 (ts-patch)│
│ • 표준 tsc/esbuild/swc 호환       ││ • 인라인 JS 조건문 직접 주입      │
│ • 0 KB 런타임 의존성, 100% CSP 안전 ││ • 극대화된 throughput, 0 KB 런타임 │
└───────────────────────────────────┘└───────────────────────────────────┘
```

계층 1의 source는 project ownership에 따라 달라진다. 이 저장소의 production API는
`packages/schemas/typespec`가 정본이고, OpenAPI/JSON Schema/TypeScript declaration은
promotion·build로 관찰되는 artifact다. 외부 project는 OpenAPI나 TypeScript/Zod를 source로
계속 사용할 수 있지만, 그 입력은 oa-sdk의 projection/validation boundary를 통과한다.

### 2. Standalone Type Guards (AJV Standalone ESM)

- **생성 메커니즘**: JSON Schema Draft 2020-12 중간 표현을 입력받아 `ajv/dist/standalone`을 통해 순수 ECMAScript 함수(`dist/guards/*.js`) 및 `.d.ts` 타입 가드 시그니처(`data is T`)를 빌드 타임에 pre-compiled 형태로 방출한다.
- **도구 체인 단순성**: 일반 JavaScript 파일로 출력되므로, 다운스트림 프로젝트는 `tsc`, `vite`, `esbuild`, `swc`, `turbopack` 등 임의의 번들러를 수정 없이 그대로 사용한다.
- **CSP 및 무런타임 보증**: 문자열 길이(`__ucs2length`)와 동등성 비교(`__equal`) 함수를 자체 인라인하여 외부 런타임 의존성이 0 KB이며, `eval()` 또는 `new Function()`을 일체 호출하지 않는 zero-eval 아키텍처로 Chrome 확장 프로그램 Manifest V3 CSP를 100% 준수한다 (`oa-gen audit:csp` 통과).
- **성능 특성 (Performance & Latency)**: p99 지연시간 0.21 ~ 6.13 µs, 100만 ~ 235만 ops/sec 유효 처리량을 기록하여 60fps 애니메이션 버짓(<500 µs)을 안정적으로 달성한다.

### 3. Typia AOT Validation (`typia.is<T>`)

- **생성 메커니즘**: TypeScript 컴파일러 변환기(`ts-patch` 또는 `ttsc`)를 활용하여 소스 코드의 `typia.is<T>(data)` 호출부를 직접 분석하고, 해당 타입 구조에 최적화된 인라인 조건문을 AST 레벨에서 생성·치환한다.
- **성능 이점**: 함수 호출 오버헤드와 중간 점프 테이블을 생략하여 235만 ~ 504만 ops/sec의 최상위 원시 처리량을 달성한다.
- **빌드 체인 복잡성 및 trade-off**:
  - TypeScript 컴파일러 내부 AST API에 강하게 결합되므로, 순수 `esbuild`나 `swc` 환경에서 추가 변환 파이프라인 없이 직접 구동할 수 없다.
  - TypeScript 메이저 버전 변경 시 변환기 호환성 유지를 기다려야 하는 유지보수 오버헤드가 발생한다.
- **@oa-sdk 내 역할**:
  - `TypiaTypeAdapter`를 통해 V3 Unified Architecture의 양방향 AST 동기화 타깃으로 지원된다.
  - LLM 함수 호출 목 검증을 위한 `@oa-sdk/typia-mock` 패키지로 경계가 격리되어 유지보수된다.

### 4. 아키텍처 결정 기준 요약 (Architectural Decision Matrix)

| 평가 기준 | Standalone Type Guards (AJV) | Typia AOT (`typia.is<T>`) |
|---|---|---|
| **권장 사용처** | 브라우저 익스텐션, SDK 배포 라이브러리, 엔터프라이즈 모노레포 | 대용량 마이크로서비스 내부 핫패스, LLM 목 검증 서버 |
| **빌드 도구 종속성** | 없음 (표준 JS 방출, `tsc` / `esbuild` / `swc` 즉시 호환) | 있음 (`ts-patch`, `ttsc` 컴파일러 트랜스포머 필수) |
| **번들 의존성** | 0 KB (순수 함수) | 0 KB (인라인 코드) |
| **Manifest V3 CSP** | 100% 적합 (`audit:csp` 통과, zero-eval browser security) | 적합 (인라인 코드, zero-eval) |
| **스키마 파이프라인** | Zod ➔ JSON Schema ➔ OAS ➔ Standalone Guards (완전 통합) | TypeScript 인터페이스 ➔ Typia (별도 컴파일러 경로) |

상세 벤치마크 수치 및 번들 측정 결과는 [검증 엔진 성능 벤치마크 리포트](../benchmarks/validation-engines.md)를 참조한다.
