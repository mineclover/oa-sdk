# oa-sdk 문서

문서 기준 체크포인트: [문서·스펙 거버넌스](./spec-governance/README.md) (2026-07-24). 제품 변경 이력은 [Changelog](./changelog.md)에서 관리한다.

---

## 🧭 역할 및 작업별 최적 탐색 경로 (Optimal Navigation Journeys)

개발자의 작업 목적과 역할에 따라 가장 효율적인 문서 읽기 및 탐색 순서를 제공합니다:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. 스키마 및 사양 작성 (Schema Author)                                                                 │
│    Zod SSOT 마스터 스키마 ➔ 스키마 아키텍처 규칙 ➔ oa.config.ts 설정 ➔ oa-gen validate / generate       │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 2. CLI 및 파이프라인 자동화 (CLI Automation)                                                            │
│    CLI 명령 레퍼런스 ➔ CLI 거버넌스 모델 ➔ 루트 자동 탐색 (--root) ➔ oa-gen drift:check & audit:csp     │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. 테스트 및 품질 보증 (QA & Test Infrastructure)                                                      │
│    TEST_INFRA 포인터 ➔ 4계층 E2E 테스트 모델 ➔ Tier 5 적대적 경화 ➔ check:docs & typecheck               │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4. 다운스트림 연동 개발자 (Downstream Integration)                                                      │
│    Quick Start ➔ 라이브러리 진입점 지도 ➔ Mock 서버 활용 ➔ 코드젠 워크플로 및 무런타임 타입 가드 임포트 │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 🎨 1. 스키마 및 사양 작성자 경로
1. [스키마 아키텍처 및 작성 규칙](./guides/schema-architecture-and-conventions.md): Zod Single Source of Truth (SSOT), 4단계 프로젝션 파이프라인, 엄격한 수치 경계(`exclusiveMinimum: 0`), RFC 9457 에러 표준, `z.lazy` 재귀 구조.
2. [선언적 스펙 설정 (oa.config.ts)](./guides/declarative-spec-configuration.md): `component-bundle`, `operation-contract`, `full-api-document` 프로파일 선언 및 정적 타입 가드 출력 설정.
3. [TypeSpec Authoring Conventions](./guides/typespec-authoring-conventions.md): TypeSpec 계약 작성 표준 및 스냅샷 관리.

### ⚙️ 2. CLI 및 빌드 자동화 엔지니어 경로
1. [CLI 명령 레퍼런스](./guides/cli-command-reference.md): `oa-gen`의 모든 명령어 옵션, 전역 플래그(`--root`), 프로파일 필터링, 독립형 가드 분할(`--split`).
2. [CLI 거버넌스 및 스펙 검증 모델](./concepts/cli-governance.md): 언어 중립 CLI 매니페스트, 결정론적 SHA-256 해싱, `drift:check` 및 브레이킹 체인지(`diff --fail-on-breaking`) 차단 게이트.
3. [선언적 스펙 설정 (oa.config.ts)](./guides/declarative-spec-configuration.md): 모노레포 루트 자동 탐색(`findProjectRoot()`) 및 6계층 해석 우선순위.

### 🛡️ 3. 테스트 및 품질 보증 (QA) 경로
1. [TEST_INFRA.md](../TEST_INFRA.md): E2E 테스트 빠른 검증 명령어 및 단일 진실 공급원 안내.
2. [테스트 인프라 (Test Infrastructure)](./concepts/test-infrastructure.md): 불투명 상자(Opaque-Box) 검증 원칙, 4계층 E2E 모델(F01~F16), 서브모듈 불변식, Tier 5 적대적 경화 스트레스 테스트.
3. [테스트 피드백](./guides/use-cases/test-feedback.md): 테스트 피드백 루프 및 커버리지 관리.
4. [검증 엔진 성능 벤치마크](./benchmarks/validation-engines.md): Zod vs Standalone Type Guards vs Typia AOT 처리량, 지연시간, 번들 크기 및 CSP 감사 리포트.

### 🔌 4. 다운스트림 통합 개발자 경로
1. [Quick Start](./guides/quick-start.md): 5분 만에 공개 OpenAPI 검증 및 TypeScript 클라이언트 생성.
2. [라이브러리 진입점 지도](./guides/library-entrypoints.md): `@oa-sdk/*` 모노레포 패키지 루트 및 서브패스 export 경계.
3. [Mock 테스팅](./guides/use-cases/mock-testing.md) 및 [Mock 서버 사용법](./guides/mock-server-usage.md): MSW 및 Headless Node.js CI 환경에서의 RPC/HTTP 모의 서버 시뮬레이션.
4. [코드젠 워크플로](./guides/use-cases/codegen-workflow.md) 및 [검증 엔진 성능 벤치마크](./benchmarks/validation-engines.md): OAS ➔ TS 라우터 ➔ 클라이언트 파이프라인 및 고성능 무런타임 가드 선택 가이드.

---

## 🎯 먼저 고르기 (Quick Picks)

| 목적 | 먼저 볼 문서 |
|---|---|
| 공개 OpenAPI 문서를 검증하고 TypeScript 타입을 생성 | [Quick Start](./guides/quick-start.md) |
| 선언적 다중 프로파일 스펙 및 거버넌스를 설정 | [선언적 스펙 설정 (oa.config.ts)](./guides/declarative-spec-configuration.md) → [스키마 아키텍처 및 작성 규칙](./guides/schema-architecture-and-conventions.md) |
| OA SDK production contract를 작성·승인 | [기본 스펙 사용 기준](./guides/basic-spec-usage.md) → [TypeSpec Authoring Conventions](./guides/typespec-authoring-conventions.md) |
| 외부 서비스/OpenAPI projection을 OA SDK로 소비 | [코드젠 워크플로](./guides/use-cases/codegen-workflow.md) 또는 [bun-graph-db projection 소비](./guides/use-cases/bun-graph-db-projections.md) |
| 4계층 E2E 테스트 모델 및 드리프트 거버넌스를 확인 | [테스트 인프라](./concepts/test-infrastructure.md) → [CLI 거버넌스 및 스펙 검증 모델](./concepts/cli-governance.md) |
| 런타임 검증 엔진별 성능(ops/sec, 지연시간) 및 번들/CSP 비교 리포트 확인 | [검증 엔진 성능 벤치마크](./benchmarks/validation-engines.md) |
| public package artifact release를 준비 | [Artifact Release Preparation](./guides/release-preparation.md) |
| 구현 현황·현재 우선순위·장기 이력을 확인 | [Spec](./internal/spec.md) → [Plan](./internal/plan.md) → [Release Readiness](./internal/release-readiness.md) |

---

## 📚 분야별 유저 가이드 (Documentation Matrix)

### 1. 핵심 아키텍처 및 철학
| 문서 | 대상 및 요약 |
|---|---|
| [Vision](./vision.md) | 핵심 철학과 주 목표 |
| [Concepts](./concepts.md) | 공통 용어와 계약 경계 정의 |
| [System Onboarding](./guides/system-onboarding.md) | 저장소 목적, 정본 선택, 변경 경로와 검증 게이트 |
| [World Model Kernel](./concepts/world-model.md) | World bootstrap, stimulus ingress, logical time, revision-pinned projection 계약 |
| [Behavior ECS](./concepts/behavior-ecs.md) | 행동 단위 Entity/Component/System 정의, representative use case |
| [Data Persona](./concepts/data-persona.md) | API audience, access obligation, privacy skill 매트릭스 |
| [Data Pseudonymization Manifest](./concepts/data-pseudonymization-manifest.md) | DB catalog, 관계성, 컬럼별 가명처리 정책, gateway API 경계 |
| [DPM Execution Runtime Design](./concepts/dpm-execution-runtime.md) | compiled plan 이후 row transform, vault, target writer, integrity gate 설계 |

### 2. 스키마 작성 및 사양 선언
| 문서 | 대상 및 요약 |
|---|---|
| [선언적 스펙 설정 (oa.config.ts)](./guides/declarative-spec-configuration.md) | 모노레포 다중 프로파일 스펙, 정적 타입 가드, 스펙 드리프트 거버넌스 설정 |
| [스키마 아키텍처 및 작성 규칙](./guides/schema-architecture-and-conventions.md) | Zod SSOT 마스터 스키마, 4단계 프로젝션 파이프라인, 엄격한 수치 범위 및 MV3 무런타임 가드 |
| [기본 스펙 사용 기준](./guides/basic-spec-usage.md) | TypeSpec source와 생성 OpenAPI artifact의 사용처·소유권·구조 |
| [TypeSpec Authoring Conventions](./guides/typespec-authoring-conventions.md) | TypeSpec source, approved snapshot, extension ownership과 validation 흐름 |
| [타입 계약 관리](./concepts/type-contract-management.md) | Type Registry, schema fidelity, TypeSpec promotion gate |
| [TypeScript 호환성](./guides/typescript-compatibility.md) | TS 5 baseline과 TS 7/`ttsc` enhanced 생성 선언 검증 경계 |
| [스키마 작성](./guides/schema-authoring.md) | TypeSpec production authoring과 Definition Builder rollback fragment |
| [스키마 어노테이션](./guides/schema-annotations.md) | 소비자 설명, 작성자 메모, 구조화된 내부 메타데이터 컨벤션 |
| [SchemaAlgebra](./guides/schema-algebra.md) | fold 패턴 확장 |
| [TypeSpec 논리 ERD prototype](./guides/typespec-logical-erd-authoring.md) | 논리 entity/field/relationship artifact와 provenance |

### 3. CLI 및 자동화 거버넌스
| 문서 | 대상 및 요약 |
|---|---|
| [CLI 명령 레퍼런스](./guides/cli-command-reference.md) | 현재 `oa-gen` 명령의 목적·최소 입력·전역 `--root` 및 세부 조건부 옵션 |
| [CLI 세팅](./guides/cli-setup.md) | 설치 + CLI 명령어 기초 |
| [CLI 거버넌스 및 스펙 검증 모델](./concepts/cli-governance.md) | Language-neutral CLI 매니페스트, 결정론적 해싱, 드리프트 및 브레이킹 체인지 CI 게이트 |
| [Artifact Release Preparation](./guides/release-preparation.md) | artifact-only package release의 version intent, preflight, external promotion 경계 |
| [OpenAPI Governance Workflow](./guides/use-cases/openapi-governance-workflow.md) | target artifact sidecar, duplicate review, target-check, drift, review bundle |
| [OpenAPI 3.2 Contract Management](./guides/openapi32-contract-management.md) | oa-sdk 계약 관리 원칙과 OpenAPI 3.2 strict gate |
| [Path Fragment Conventions](./guides/path-fragment-conventions.md) | path fragment 폴더, canonical id, feedback 좌표 규칙 |
| [Duplicate Review](./guides/duplicate-review.md) | fragment 중복 탐지 정책, CI gate, review-bundle 연동 |
| [OpenAPI Governance Service Template](./guides/openapi-governance-service-template.md) | 서비스별 governance 설정 템플릿 |

### 4. 테스트, 검증 및 보안
| 문서 | 대상 및 요약 |
|---|---|
| [테스트 인프라 (Test Infrastructure)](./concepts/test-infrastructure.md) | 4계층 E2E 검증 모델(F01~F16), 스펙 신선도/드리프트 감지, 결정론적 SHA-256 해시, CSP 감사 게이트 |
| [검증 엔진 성능 벤치마크](./benchmarks/validation-engines.md) | Zod runtime vs Standalone Guards vs Typia AOT 성능, CSP, 번들 비교 리포트 |
| [Mock 테스팅](./guides/use-cases/mock-testing.md) | 프론트엔드 및 CI 통합 테스트에서 Mock 서버 활용 |
| [Mock 서버](./guides/mock-server-usage.md) | MSW / Node HTTP 기반 모의 서버 구동 |
| [테스트 피드백](./guides/use-cases/test-feedback.md) | 커버리지 + 검증 피드백 루프 |

### 5. 연동 유스케이스 및 개발 도구
| 문서 | 대상 및 요약 |
|---|---|
| [Quick Start](./guides/quick-start.md) | 공개 `oa-gen` 설치 또는 private source의 5분 파이프라인 체험 |
| [라이브러리 진입점 지도](./guides/library-entrypoints.md) | package root/subpath와 artifact 경계 |
| [코드젠 워크플로](./guides/use-cases/codegen-workflow.md) | Drizzle → OAS → TS → 라우터 → 클라이언트 |
| [NestJS Swagger / FastAPI Governance](./guides/use-cases/nestjs-swagger-governance.md) | NestJS Swagger / FastAPI 산출물 → oa-sdk 계약 관리 레퍼런스 |
| [bun-graph-db projection 소비](./guides/use-cases/bun-graph-db-projections.md) | bun-graph-db OpenAPI full document/table projection → OA SDK |
| [World Model 계약 소비](./guides/use-cases/world-model-contract-consumption.md) | World Model contract 검증과 generated client/HTTP integration 준비 |
| [Spec-Lens Platform](./spec-lens/README.md) | OpenAPI 스펙 변경 이력 관측, 임의 커밋 비교, D3 의존성 그래프 및 웹 대시보드 (`@oa-sdk/spec-lens`, `apps/spec-lens`) |
| [Preview App](../apps/preview/) | 브라우저 수동 프리뷰 (자동 E2E 보증은 [playground](../apps/playground/)가 담당) |

---

## 💡 개발자를 위한 탐색 및 운영 불변식 힌트 (Navigation Tips & Invariants)

1. **하위 패키지 및 서브모듈 상향 탐색 불변식 (Subdirectory Upward Traversal)**:
   - 모노레포 내의 깊은 하위 패키지(`packages/codegen`, `packages/parser` 등)나 Git 서브모듈 디렉터리에서 CLI를 실행할 때, 상위 디렉터리를 거슬러 올라가며 `oa.config.ts` 및 프로젝트 루트를 자동 발견합니다.
   - 명시적으로 특정 루트를 강제하려면 전역 플래그 `--root <dir>`을 지정하십시오.
2. **제로 런타임 & Zero-Eval MV3 불변식 (Zero-Eval Runtime Decoupling)**:
   - 브라우저 익스텐션(Manifest V3) 환경에서는 번들 용량 및 보안 정책(CSP) 준수를 위해 런타임 스키마 컴파일러(`eval`, `new Function`, `zod`, `ajv`, `@oa-sdk/*`)를 절대 임포트하지 않습니다.
   - 사전 컴파일된 독립형 타입 가드(`dist/guards/*.js`)만을 임포트하고, 빌드 파이프라인에서 `oa-gen audit:csp --bundle dist/guards`를 수행하십시오.
3. **스펙 드리프트 감지 (Spec Drift & Freshness Gate)**:
   - Zod 소스 스키마가 수정되었으나 OpenAPI/JSON Schema 아티팩트가 새로 빌드되지 않은 경우, CI 빌드에서 `oa-gen drift:check`가 실패(exit code 1)합니다.
   - 스키마 변경 후 항상 `oa-gen generate`를 실행하여 아티팩트를 최신 상태로 동기화하십시오.
4. **로컬 무결성 빠른 검증 명령어**:
   ```bash
   # 문서 링크 및 CLI 명세 정렬 검사 (0 broken links)
   pnpm check:docs && pnpm exec tsx scripts/check-cli-spec.ts

   # 모노레포 전체 TypeScript 타입체크
   pnpm -r typecheck

   # 4계층 E2E 회귀 테스트 실행
   pnpm --filter @oa-sdk/codegen test src/__tests__/e2e
   ```

---

## 📋 CLI Governance Spec

| 문서 | 대상 |
|---|---|
| [CLI Governance 개념 및 검증 모델](./concepts/cli-governance.md) | Language-neutral CLI manifest, components, checks, exit policy 개요 및 검증 모델 |
| [CLI Spec](./cli-spec/README.md) | TS/JS와 Python governance CLI 정렬 기준 |
| [CLI command schema](./cli-spec/cli-command.schema.json) | command entity + component JSON Schema |
| [oa-gen governance manifest](./cli-spec/oa-gen.governance.json) | TS/JS `oa-gen` governance 명령 스펙 |
| [oa-contract governance manifest](./cli-spec/oa-contract.governance.json) | Python `oa-contract` governance 명령 스펙 |

---

## 🏛️ 프로젝트 관리 (SSOT)

> 유저 가이드는 아래 SSOT를 참조합니다. 상세 정보는 여기서 유지됩니다.

| SSOT | 내용 |
|---|---|
| [spec.md](./internal/spec.md) | 구현 현황 |
| [plan.md](./internal/plan.md) | 로드맵 |
| [release-readiness.md](./internal/release-readiness.md) | artifact release 판단 입력과 source/external 책임 경계 |
| [api-index.md](./internal/api-index.md) | API 단일 소스 |
| [behavior-ecs.spec.md](./internal/behavior-ecs.spec.md) | 행동 데이터 SSOT, representative use case, baseline/local verification |
| [feature-test-matrix.md](./internal/feature-test-matrix.md) | 기능 ↔ 테스트 매핑 |
| [oas32-coverage.md](./internal/oas32-coverage.md) | OAS 3.2 커버리지 |
| [traceability.md](./internal/traceability.md) | 스펙 ↔ 코드 추적 |
| [architecture/](./internal/architecture/) | ADR |
| [test-infrastructure.md](./concepts/test-infrastructure.md) | 4계층 E2E 테스트 인프라 및 불변식 SSOT |

---

## 📖 OAS 3.2 참조

[references/oas32/](./references/oas32/) — 공식 스펙 15개 챕터 + 부록
