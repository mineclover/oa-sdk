# oa-sdk 문서

문서 기준 체크포인트: [문서·스펙 거버넌스](./spec-governance/README.md) (2026-07-24). 제품 변경 이력은 [Changelog](./changelog.md)에서 관리한다.

**처음 기능을 고를 때는 [기능 선택 지도](./guides/feature-map.md)부터 읽는다.**
계약 입력 → 코드 생성 → 실행·도구 연결 → 검증·리뷰 → 런타임 지원 순서로 기능을 정리했다.
Core/Downstream, 저장소 전용, maintenance, 외부 제품·미래 TODO는 별도 상태로 표시한다.

세 목표(API 엔드포인트·데이터 구조·소비자 인터페이스)의 격리와 공통 구성 API는
[용도별 파이프라인 구성](./guides/pipeline-configuration.md)을 따른다.
현재 보장 범위와 결함 상태는 [검증·리뷰 현황](./internal/verification/status.md), 최근 구현 변경은 [Changelog](./changelog.md)에서 확인한다.
파이프라인 격리 작업의 검증 범위와 한계는 [2026-10-25 완료 기록](./internal/pipeline-isolation-checkpoint-2026-10-25.md)에 남아 있다.

---

## 🧭 역할 및 작업별 최적 탐색 경로 (Optimal Navigation Journeys)

개발자의 작업 목적과 역할에 따라 가장 효율적인 문서 읽기 및 탐색 순서를 제공합니다. 전체 가이드의 세부 분류 지도는 **[가이드 종합 색인 및 아키텍처 지도](./guides/README.md)**를 참조하십시오:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. 스키마 및 타입 선언자 (Spec & Type Author)                                                          │
│    • HTTP API: TypeSpec 실무 ➔ 데코레이터 레퍼런스 ➔ OAS 3.2 계약 관리 ➔ pnpm schema:validate          │
│    • 순수 모델 (Non-HTTP): 순수 데이터 모델 선언 (.tsp/Zod) ➔ JSON Schema 2020-12 ➔ 무런타임 가드      │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 2. 다운스트림 소비자 (Downstream Consumer)                                                              │
│    • 순수 타입/가드: oa-gen typegen ➔ standalone-guards (MV3 CSP 안전, 초고속 검증)                    │
│    • 프론트엔드: Fetch 클라이언트 초기화 ➔ 듀얼 콜 컨벤션 ➔ TanStack Query v5 (React)                  │
│    • 백엔드 서비스: 순수 핸들러 계약 (*.contract.ts) ➔ 비즈니스 서비스 ➔ 라우터 코드(generateRouter)   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. CLI 및 파이프라인 자동화 (CLI Automation)                                                            │
│    CLI 명령 레퍼런스 ➔ CLI 거버넌스 모델 ➔ 루트 자동 탐색 (--root) ➔ oa-gen diff & drift:check         │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4. 테스트 및 품질 보증 (QA & Test Infrastructure)                                                      │
│    상태 유지 Mock 서버 (oa-mock --stateful) ➔ 4계층 E2E 모델 ➔ Tier 5 적대적 경화 ➔ check:docs          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 🎨 1. 스키마 및 사양 작성자 경로 (Author Track)
1. **HTTP API 선언**: [스키마 작성 가이드](./guides/schema-authoring.md), [TypeSpec 5분 퀵스타트](./guides/typespec/01-quickstart-5min.md), [기본 스펙 사용 기준](./guides/basic-spec-usage.md)
2. **순수 데이터 모델 & DTO 선언 (Non-HTTP)**: [순수 타입 선언 및 가드 실무 가이드](./guides/pure-types-and-guards.md), [스키마 아키텍처 및 작성 규칙](./guides/schema-architecture-and-conventions.md)
3. **멀티 티어 스키마 & 도구 분리**: [멀티 티어 스키마 및 ttsc·Atlas 역할 분리 가이드](./guides/schema-architecture-and-ttsc-guide.md)
4. **선언적 스펙 설정**: [선언적 스펙 설정 (oa.config.ts)](./guides/declarative-spec-configuration.md)
5. **프로그래머블 빌더 플랫폼**: [TypeSpec Builder Platform](./guides/typespec-builder-platform.md), [빌더 사용성 평가 리포트](./reports/typespec-builder-usability-report.md)
6. **Behavior 및 런타임 데이터 스키마 저작**: [TypeSpec Behavior / Runtime Schema 작성 연구](./spec-governance/typespec-behavior-schema-authoring-research.md), [TypeSpec 작성 규칙 부록 9](./guides/typespec-authoring-conventions.md#9-부록-behavior-및-런타임-데이터-스키마-작성-지침-partial-adopt)

### 🔌 2. 다운스트림 소비자 경로 (Consumer Track)
1. **순수 타입 & 제로-런타임 가드**: [순수 타입 선언 및 가드 실무 가이드](./guides/pure-types-and-guards.md), [검증 엔진 성능 벤치마크](./benchmarks/validation-engines.md)
2. **프론트엔드 SDK & TanStack Query**: [프론트엔드 SDK 및 쿼리 소비 가이드](./guides/client-and-query-consumption.md), [클라이언트 SDK 배포 가이드](./guides/client-sdk-distribution.md), [Quick Start](./guides/quick-start.md)
3. **백엔드 서비스 & 핸들러 계약**: [백엔드 핸들러 계약 구현 가이드](./guides/backend-handler-contracts.md), [온보딩 플레이북](./guides/onboarding-playbook.md), [코드젠 워크플로](./guides/use-cases/codegen-workflow.md)
4. **Mock 기반 병렬 개발 & 테스트**: [Mock 서버 사용법](./guides/mock-server-usage.md), [Mock 테스팅 유스케이스](./guides/use-cases/mock-testing.md)
5. **WebMCP 프로젝션 게이트웨이·P2P 중계·동시 편집**: [WebMCP 프로젝션 가이드](./guides/webmcp-projection-and-relay-guide.md), [WebMCP 피어링 및 동시 편집 아키텍처](./concepts/webmcp-peering-mesh-and-collab.md)
6. **Cloudflare Forge SDK/CLI projection**: [Cloudflare Forge 지원](./guides/forge-support.md)
7. **대시보드 시나리오 네비게이션 & BEHAVIOR FSM**: [유저 시나리오 주제 단위 화면 네비게이션 & BEHAVIOR FSM 엔진 가이드](./guides/scenario-navigation-fsm-engine.md)
8. **TypeSpec Builder Platform & openapi-ts SDK**: [TypeSpec Builder Platform](./guides/typespec-builder-platform.md), [빌더 사용성 평가 리포트](./reports/typespec-builder-usability-report.md)

### ⚙️ 3. CLI 및 빌드 자동화 엔지니어 경로
1. [CLI 명령 레퍼런스](./guides/cli-command-reference.md): `oa-gen`의 모든 명령어 옵션, 전역 플래그(`--root`), 프로파일 필터링, 독립형 가드 분할(`--split`).
2. [CLI 거버넌스 및 스펙 검증 모델](./concepts/cli-governance.md): 언어 중립 CLI 매니페스트, 결정론적 SHA-256 해싱, `drift:check` 및 브레이킹 체인지(`diff --fail-on-breaking`) 차단 게이트.
3. [선언적 스펙 설정 (oa.config.ts)](./guides/declarative-spec-configuration.md): 모노레포 루트 자동 탐색(`findProjectRoot()`) 및 6계층 해석 우선순위.
4. [WebMCP & 멀티 MCP CLI 통합](./concepts/webmcp-peering-mesh-and-collab.md): `oa-mesh` / `oa-tools`를 통한 피어 관리, 스킬 하이드레이션, 폴더 CRDT 동시 편집, AI 1등 편집자.
5. [WebMCP 보안 감사 및 경계 계약](./security/webmcp-hardening.md): 인증, 입력 크기, RPC/packet replay, CRDT ingress, MCP/HTTP 검증과 잔여 운영 가정.
6. [로컬 Breaking Diff 및 Drift 검증 도구](../scripts/check-local-diff.ts): 로컬 환경에서 브레이킹 변경(`pnpm check:local-diff`) 및 런타임 스키마 드리프트(`pnpm check:local-drift`) 사전 검출.


### 🛡️ 4. 테스트 및 품질 보증 (QA) 경로

현재 보장 범위와 결함 상태는 [검증·리뷰 현황](./internal/verification/status.md), 근거 등록·종료 절차는 [검증 관리 규칙](./internal/verification/README.md)에서 확인한다.
1. [TEST_INFRA.md](../TEST_INFRA.md): E2E 테스트 빠른 검증 명령어 및 단일 진실 공급원 안내.
2. [테스트 인프라 (Test Infrastructure)](./concepts/test-infrastructure.md): 불투명 상자(Opaque-Box) 검증 원칙, 4계층 E2E 모델(F01~F16), 서브모듈 불변식, Tier 5 적대적 경화 스트레스 테스트.
3. [Mock 서버 사용법](./guides/mock-server-usage.md): REST CRUD 자동 라우팅, seed 및 reset을 지원하는 인메모리 상태 유지 Mock 서버 (`--stateful`).

---

## 🎯 먼저 고르기 (Quick Picks)

| 목적 | 먼저 볼 문서 |
|---|---|
| 어떤 기능을 어디서 쓸 수 있는지, 설치·유지보수·외부 제품 경계 확인 | [기능 선택 지도](./guides/feature-map.md) |
| 전체 가이드 색인 지도와 역할별 추천 경로 확인 | [가이드 종합 색인 및 아키텍처 지도](./guides/README.md) |
| TypeSpec(.tsp) 기반 5분 빠른 API 엔드포인트 선언 및 실시간 Mock 테스트 | [TypeSpec 5분 퀵스타트](./guides/typespec/01-quickstart-5min.md) |
| HTTP 엔드포인트 없는 순수 데이터 모델/DTO 선언 및 가드 생성 | [순수 타입 선언 및 가드 실무 가이드](./guides/pure-types-and-guards.md) |
| React 프론트엔드에서 API 클라이언트 및 TanStack Query 훅 소비 | [프론트엔드 SDK 및 쿼리 소비 가이드](./guides/client-and-query-consumption.md) |
| 백엔드에서 덮어쓰기 위험 없이 비즈니스 핸들러 구현 | [백엔드 핸들러 계약 구현 가이드](./guides/backend-handler-contracts.md) |
| 공개 OpenAPI 문서를 검증하고 TypeScript 타입을 생성 | [Quick Start](./guides/quick-start.md) |
| 상태 유지 Mock 서버 구동 및 프론트엔드 병렬 개발 | [Mock 서버 사용법](./guides/mock-server-usage.md) |
| OpenAPI artifact를 Cloudflare Forge SDK/CLI 표면으로 투영 | [Cloudflare Forge 지원](./guides/forge-support.md) |
| 선언적 다중 프로파일 스펙 및 거버넌스를 설정 | [선언적 스펙 설정 (oa.config.ts)](./guides/declarative-spec-configuration.md) → [스키마 아키텍처 및 작성 규칙](./guides/schema-architecture-and-conventions.md) |
| 브라우저(WebMCP) 도구 노출, 게이트웨이 및 P2P 중계 연동 | [WebMCP 프로젝션 가이드](./guides/webmcp-projection-and-relay-guide.md) → [WebMCP 개념 아키텍처](./concepts/webmcp-peering-mesh-and-collab.md) |
| TypeSpec(.tsp) 단일 정본 인메모리 빌더 및 openapi-ts 스타일 클라이언트·Query 연동 | [TypeSpec Builder Platform](./guides/typespec-builder-platform.md) → [빌더 사용성 평가 리포트](./reports/typespec-builder-usability-report.md) |
| OA SDK production contract를 작성·승인 | [기본 스펙 사용 기준](./guides/basic-spec-usage.md) → [TypeSpec Authoring Conventions](./guides/typespec-authoring-conventions.md) |
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
| [Onboarding Playbook (기여자 온보딩)](./guides/onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩) | 저장소 목적, 정본 선택, 변경 경로와 검증 게이트 |
| [World Model Kernel](./concepts/world-model.md) | World bootstrap, stimulus ingress, logical time, revision-pinned projection 계약 |
| [Behavior ECS](./concepts/behavior-ecs.md) | 행동 단위 Entity/Component/System 정의, representative use case |
| [Data Persona](./concepts/data-persona.md) | API audience, access obligation, privacy skill 매트릭스 |
| [Data Pseudonymization Manifest](./concepts/data-pseudonymization-manifest.md) | DB catalog, 관계성, 컬럼별 가명처리 정책, gateway API 경계 |
| [DPM Execution Runtime Design](./concepts/dpm-execution-runtime.md) | compiled plan 이후 row transform, vault, target writer, integrity gate 설계 |

### 2. 스키마 작성 및 사양 선언
| 문서 | 대상 및 요약 |
|---|---|
| [가이드 종합 색인 및 아키텍처 지도](./guides/README.md) | 전체 가이드의 이원화(선언자 vs 소비자) 탐색 지도 및 추천 읽기 경로 |
| [TypeSpec Builder Platform](./guides/typespec-builder-platform.md) | TypeSpec 단일 정본 인메모리 컴파일, 플러그인 파이프라인, openapi-ts 스타일 클라이언트 및 Vite HMR 연동 |
| [TypeSpec Builder 사용성 평가 리포트](./reports/typespec-builder-usability-report.md) | 18개 E2E 시나리오, 콜드 95ms / 웜 0.18ms, Wire 직렬화 73.74% 압축률, DX 4.92/5.0 벤치마크 |
| [순수 타입 선언 및 가드 실무 가이드](./guides/pure-types-and-guards.md) | HTTP 없는 순수 모델 선언(TypeSpec/Zod), 순수 타입 생성 및 제로-eval 독립형 가드 실무 |
| [선언적 스펙 설정 (oa.config.ts)](./guides/declarative-spec-configuration.md) | 모노레포 다중 프로파일 스펙, 정적 타입 가드, 스펙 드리프트 거버넌스 설정 |
| [스키마 아키텍처 및 작성 규칙](./guides/schema-architecture-and-conventions.md) | TypeSpec SSOT 마스터 스키마, 비디오 트랜지션 다형성 파라미터 표준, 4단계 프로젝션 파이프라인, 엄격한 수치 범위 및 MV3 무런타임 가드 |
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
| [Mock 서버](./guides/mock-server-usage.md) | MSW / Node HTTP 기반 모의 서버 구동 및 상태 유지 플러그인 (`--stateful`) |
| [테스트 피드백](./guides/use-cases/test-feedback.md) | 커버리지 + 검증 피드백 루프 |
| [개별 기능 리뷰 2026-10-26](./reports/feature-review-2026-10-26.md) | 기능 18개의 진입점·회귀 테스트 대조와 FR-01~09 발견·수정 기록 (날짜별 관측, 상태 정본은 검증 원장) |
| [`generate --incremental` 실측 2026-10-30](./reports/generate-incremental-20261030.md) | target bundle 재사용과 입력 변경 감지의 실 실행 기록 및 제한 |
| [TypeSpec → Pydantic v2 변환 검토](./reports/typespec-pydantic-codegen-review.md) | Pydantic 생성기의 구현 전 분석, 매핑 표, 구현 대조 |

### 5. 연동 유스케이스 및 개발 도구
| 문서 | 대상 및 요약 |
|---|---|
| [프론트엔드 SDK 및 쿼리 소비](./guides/client-and-query-consumption.md) | `@oa-sdk/client` 초기화, 듀얼 콜, 스트리밍, 취소 및 TanStack Query v5 통합 |
| [클라이언트 SDK 배포 가이드](./guides/client-sdk-distribution.md) | Model A(로컬 devDependencies) vs Model B(독립 사전 빌드 패키지 배포, 런타임 의존성 0개) |
| [백엔드 핸들러 계약 구현](./guides/backend-handler-contracts.md) | `@oa-sdk/router` 순수 핸들러 계약(`*.contract.ts`), 비즈니스 격리 및 라우터 바인딩 |
| [Quick Start](./guides/quick-start.md) | 공개 `oa-gen` 설치 또는 private source의 5분 파이프라인 체험 |
| [라이브러리 진입점 지도](./guides/library-entrypoints.md) | package root/subpath와 artifact 경계 |
| [기능 선택 지도](./guides/feature-map.md) | 목적별 기능·상태·시작 문서와 DB/저장소 전용/외부 TODO 경계 |
| [코드젠 워크플로](./guides/use-cases/codegen-workflow.md) | Drizzle → OAS → TS → 라우터 → 클라이언트 |
| [NestJS Swagger / FastAPI Governance](./guides/use-cases/nestjs-swagger-governance.md) | NestJS Swagger / FastAPI 산출물 → oa-sdk 계약 관리 레퍼런스 |
| [bun-graph-db projection 소비](./guides/use-cases/bun-graph-db-projections.md) | bun-graph-db OpenAPI full document/table projection → OA SDK |
| [Bun Graph DB / Kuzu 기능 비교](./guides/use-cases/bun-graph-db-kuzu-comparison.md) | 고정 소스 레퍼런스, 기능 차이, 개선 우선순위와 성능 실험 규약 |
| [Kuzu 설계의 복합 분석과 적용](./guides/use-cases/bun-graph-db-kuzu-design-adoption.md) | 알고리즘·문서 관리·계층 분리의 장점과 Bun Graph DB 첫 적용 |
| [World Model 계약 소비](./guides/use-cases/world-model-contract-consumption.md) | World Model contract 검증과 generated client/HTTP integration 준비 |
| [WIREFRAME-BOOK & XState v6 연동](./guides/use-cases/wireframe-xstate-behavior-integration.md) | TypeSpec data shape → ttsc AOT Standard Schema v1 합성 → XState v6 setup({ schemas }) 0KB 무의존성 연동 |
| [유저 시나리오 FSM 네비게이션 엔진](./guides/scenario-navigation-fsm-engine.md) | Bounded Context 4대 시나리오, 0 Dead-Ends, 정적 경로 수집기 및 Spec-Lens HUD |
| [시나리오 라이프사이클 및 아티팩트 거버넌스](./guides/scenario-lifecycle-and-artifacts.md) | 5단계 라이프사이클, spec-lens scenario CLI, 정형 아티팩트 및 듀얼 프리뷰어 |
| [Ariga Atlas 물리 DB 드리프트 거버넌스](./guides/use-cases/atlas-schema-drift-governance.md) | Atlas migrate diff → atlas schema inspect JSON 증거 덤프 → TypeSpec @storageRef 정적 드리프트 CI 검증 |
| [Spec-Lens Platform](./spec-lens/README.md) | OpenAPI 스펙 변경 이력 관측, 임의 커밋 비교, D3 의존성 그래프 및 웹 대시보드 (`@oa-sdk/spec-lens`, `apps/spec-lens`) |
| [공유 컨텍스트 협업 하네스 계약 평가](./spec-governance/shared-context-harness-contract-evaluation.md) | 공유 컨텍스트 협업 하네스와 oa-sdk 코어 간 도구 계약의 안전한 상호 운용성 입증 |
| [TypeSpec Behavior 작성 연구](./spec-governance/typespec-behavior-schema-authoring-research.md) | TypeSpec 기반 Behavior / Runtime Schema SSOT 및 XState v5/v6 프로젝션 연구 (Partial adopt) |
| [Preview App](../apps/preview/) | 브라우저 수동 프리뷰 (자동 E2E 보증은 [playground](../apps/playground/)가 담당) |


---

## 💡 개발자를 위한 탐색 및 운영 불변식 힌트 (Navigation Tips & Invariants)

1. **하위 패키지 및 서브모듈 상향 탐색 불변식 (Subdirectory Upward Traversal)**:
   - 모노레포 내의 깊은 하위 패키지(`packages/codegen`, `packages/parser` 등)나 Git 서브모듈 디렉터리에서 CLI를 실행할 때, 상위 디렉터리를 거슬러 올라가며 `oa.config.ts` 및 프로젝트 루트를 자동 발견합니다.
   - 명시적으로 특정 루트를 강제하려면 전역 플래그 `--root <dir>`을 지정하십시오.
2. **제로 런타임 & Zero-Eval MV3 불변식 (Zero-Eval Runtime Decoupling)**:
   - 브라우저 익스텐션(Manifest V3) 환경에서는 번들 용량 및 보안 정책(CSP) 준수를 위해 런타임 스키마 컴파일러(`eval`, `new Function`, `zod`, `ajv`, `@oa-sdk/*`)를 절대 임포트하지 않습니다.
   - 사전 컴파일된 독립형 타입 가드(`dist/guards/*.js`)만을 임포트하고, 빌드 파이프라인에서 `oa-gen audit:csp --bundle dist/guards`를 수행하십시오.
3. **TypeSpec 계약 정본(SSOT) 및 스펙 드리프트 감지**:
   - **TypeSpec 절대 불변식**: `oa-sdk` 프로덕션 API 계약을 변경할 때는 반드시 `packages/schemas/typespec/**/*.tsp` 원본 파일을 수정해야 합니다. 파생 산출물(`.merged*.yaml`, `dist/openapi.*`)을 수기로 직접 수정하는 것은 엄격히 금지됩니다. 스펙 수정 후 `pnpm schema:validate` 및 `pnpm schema:approve-typespec-reference -- --write`로 승인 베이스라인을 갱신하십시오.
   - **순수 모델 스펙 드리프트**: Zod 기반 순수 모델 스키마가 수정되었으나 OpenAPI/JSON Schema 아티팩트가 새로 빌드되지 않은 경우, CI 빌드에서 `oa-gen drift:check`가 실패(exit code 1)합니다. 스키마 변경 후 항상 `oa-gen generate`를 실행하여 아티팩트를 최신 상태로 동기화하십시오.
4. **로컬 무결성 빠른 검증 명령어**:
   ```bash
   # 로컬 스펙 Breaking Diff 및 Runtime Drift 검증
   pnpm check:local-diff && pnpm check:local-drift

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

## 🏛️ 정본(SSOT) 아키텍처 및 레거시/롤백 경로 격리 기준

oa-sdk 모노레포는 스키마의 수명주기와 단일 진실 공급원(SSOT)을 명확히 보호하기 위해 **정본(Canonical)**과 **격리된 레거시/롤백(Isolated Legacy/Rollback)** 경로를 엄격히 분리합니다.

### 1. 4계층 활성 정본 (Active Canonical SSOT)

| 계층 | 정본 기술 및 도구 | 정본 산출물 위치 | 핵심 역할 |
|---|---|---|---|
| **1. Storage Tier** | **Ariga Atlas** | `db/schema.sql`, `atlas.hcl`, `migrations/` | 물리 DDL, SQLite/PostgreSQL/D1 마이그레이션 관리 (oa-sdk는 DDL을 소유하지 않음) |
| **2. Logical Tier** | **oa-sdk DPM & Logical ERD** | `oa-sdk.logical-erd.v1.json`, `dpm.manifest.json` | 도메인 관계 모델, PII 가명화, 물리 DB ↔ API 스키마 간 정적 드리프트 검증 |
| **3. API Tier** | **TypeSpec & OpenAPI 3.2** | `packages/schemas/typespec/main.tsp`, `approved.openapi.yaml` | HTTP REST API 계약의 단일 정본, 클라이언트 SDK, 라우터 핸들러 계약, Mock 서버 |
| **4. Behavior Tier** | **WIREFRAME-BOOK & ttsc AOT** | Behavior IR, Standard Schema v1 (`~standard`) | FSM 상태 머신 토폴로지, XState v6용 0KB 무의존성 AOT 런타임 스키마 검증 |

상세 가이드는 [멀티 티어 스키마 및 ttsc·Atlas 역할 분리 가이드](./guides/schema-architecture-and-ttsc-guide.md) 및 [ADR-012](./internal/architecture/012-multi-tier-schema-separation-and-ttsc-boundary.md)를 참조하십시오.

### 2. 격리된 레거시 및 롤백 경로 (Isolated Legacy & Rollback Paths)

> [!CAUTION] 레거시 및 롤백 경로 수정 제한
> 아래 경로들은 과거 시스템 호환성 또는 긴급 롤백(Rollback)을 위해 보존된 격리 영역입니다. **신규 도메인 모델이나 API 기능 추가 시 이 경로를 직접 수정하거나 참조하지 마십시오.**

* **Definition Builder YAML Fragments (`packages/schemas/src/fragments`, `src/targets`)**:
  - TypeSpec 도입 이전의 프래그먼트 병합 경로입니다. 현재는 `pnpm schema:rollback-check` 테스트에서만 보존되며, 정본 API 계약 저작에는 사용되지 않습니다 ([Path Fragment Conventions](./guides/path-fragment-conventions.md), [Duplicate Review](./guides/duplicate-review.md)).
* **수작업 4단계 Zod 파이프라인 (Manual Zod Pipeline)**:
  - 과거 수기로 Zod $\leftrightarrow$ TS 타입을 이중 작성하던 패턴은 TypeSpec 직접 JSON Schema 및 TypeScript AST 추출로 완전 대체되었습니다.
* **브라우저 클라이언트 런타임 Ajv 번들링 (Runtime Ajv Bundling)**:
  - 브라우저에 거대한 Ajv 파서를 번들링하던 안티패턴은 `ttsc` 컴파일러 트랜스폼 기반의 AOT Standard Schema v1 (`~standard`) 객체 생성으로 완전 대체되었습니다.
* **API 코드젠의 직접 SQL DDL 생성 (Direct DDL Emission)**:
  - API 스펙으로부터 DDL을 자동 생성하던 위험한 커플링은 Ariga Atlas의 선언적 마이그레이션 및 정적 카탈로그 인스펙션(`atlas schema inspect`) 체계로 완전 분리되었습니다.

---

## 🏛️ 프로젝트 관리 (SSOT)


> 유저 가이드는 아래 SSOT를 참조합니다. 상세 정보는 여기서 유지됩니다.

| SSOT | 내용 |
|---|---|
| [spec.md](./internal/spec.md) | 구현 현황 |
| [plan.md](./internal/plan.md) | 로드맵 |
| [todo.md](./internal/todo.md) | 열린 작업과 결정 대기 backlog (완료 이력은 [todo-archive.md](./internal/todo-archive.md)) |
| [verification/status.md](./internal/verification/status.md) | 보장 항목·결함 상태의 읽기용 현황 (정본은 `registry.json`, 자동 생성) |
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
