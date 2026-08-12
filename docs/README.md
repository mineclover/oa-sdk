# oa-sdk 문서

문서 기준 체크포인트: [문서·스펙 거버넌스](./spec-governance/README.md) (2026-07-24). 제품 변경
이력은 [Changelog](./changelog.md)에서 관리한다 (가장 최근 제품 항목: 2026-08-10 — TypeSpec
extension vocabulary v5 consolidation).

## 문서 거버넌스

작업 시작 시 [`.ai/spec-loader.yaml`](../.ai/spec-loader.yaml)을 읽고, 공식 문서 기준은
[문서·스펙 거버넌스](./spec-governance/README.md)를 따른다. 기존 구현·계획 SSOT는
`docs/internal/`에 그대로 두며, 거버넌스 디렉터리는 문서의 소유권·품질·검증·변경 절차만
관리한다.

## 유저 가이드

| 문서 | 대상 |
|------|------|
| [Vision](./vision.md) | 핵심 철학과 주 목표 |
| [Concepts](./concepts.md) | 공통 용어와 계약 경계 정의 |
| [World Model Kernel](./concepts/world-model.md) | World bootstrap, stimulus ingress, logical time, revision-pinned projection 계약의 설명 |
| [Behavior ECS](./concepts/behavior-ecs.md) | 행동 단위 Entity/Component/System 정의, representative use case, 기본 테스트 케이스 |
| [Data Persona](./concepts/data-persona.md) | API audience, access obligation, privacy skill 매트릭스 |
| [Data Pseudonymization Manifest](./concepts/data-pseudonymization-manifest.md) | DB catalog, 관계성, 컬럼별 가명처리 정책, gateway API 경계 |
| [DPM Execution Runtime Design](./concepts/dpm-execution-runtime.md) | compiled plan 이후 row transform, vault, target writer, integrity gate 설계 |
| [Quick Start](./guides/quick-start.md) | 공개 `oa-gen` 설치 또는 private source의 5분 파이프라인 체험 |
| [World Model 계약 소비](./guides/use-cases/world-model-contract-consumption.md) | World Model contract 검증과 generated client/HTTP integration 준비 |
| [System Onboarding](./guides/system-onboarding.md) | 저장소 목적, 정본 선택, 변경 경로와 검증 게이트 |
| [기본 스펙 사용 기준](./guides/basic-spec-usage.md) | TypeSpec source와 생성 OpenAPI artifact의 사용처·소유권·구조 |
| [TypeSpec Authoring Conventions](./guides/typespec-authoring-conventions.md) | TypeSpec source, approved snapshot, extension ownership과 validation 흐름 |
| [TypeScript 호환성](./guides/typescript-compatibility.md) | TS 5 baseline과 TS 7/`ttsc` enhanced 생성 선언 검증 경계 |
| [타입 계약 관리](./concepts/type-contract-management.md) | Type Registry, schema fidelity, TypeSpec promotion gate가 타입·계약 변경을 관찰하는 방식 |
| [Mock 테스팅](./guides/use-cases/mock-testing.md) | 프론트엔드 테스트에서 Mock 서버 활용 |
| [코드젠 워크플로](./guides/use-cases/codegen-workflow.md) | Drizzle → OAS → TS → 라우터 → 클라이언트 |
| [TypeSpec 논리 ERD prototype](./guides/typespec-logical-erd-authoring.md) | 논리 entity/field/relationship artifact와 provenance; 물리 DB와 분리 |
| [OpenAPI Governance Workflow](./guides/use-cases/openapi-governance-workflow.md) | target artifact sidecar, duplicate review, target-check, drift, review bundle |
| [Duplicate Review](./guides/duplicate-review.md) | fragment 중복 탐지 정책, CI gate, review-bundle 연동 |
| [OpenAPI Governance Service Template](./guides/openapi-governance-service-template.md) | 서비스별 governance 설정 템플릿 |
| [OpenAPI 3.2 Contract Management](./guides/openapi32-contract-management.md) | oa-sdk 계약 관리 원칙과 OpenAPI 3.2 strict gate |
| [NestJS Swagger / FastAPI Governance](./guides/use-cases/nestjs-swagger-governance.md) | NestJS Swagger / FastAPI 산출물 → oa-sdk 계약 관리 레퍼런스 (apps/nestjs-ref, apps/fastapi-ref) |
| [Path Fragment Conventions](./guides/path-fragment-conventions.md) | path fragment 폴더, canonical id, feedback 좌표 규칙 |
| [bun-graph-db projection 소비](./guides/use-cases/bun-graph-db-projections.md) | bun-graph-db OpenAPI full document/table projection → OA SDK |
| [테스트 피드백](./guides/use-cases/test-feedback.md) | 커버리지 + 검증 피드백 루프 |
| [CLI 세팅](./guides/cli-setup.md) | 설치 + CLI 명령어 |
| [CLI 명령 레퍼런스](./guides/cli-command-reference.md) | 현재 `oa-gen` 명령의 목적·최소 입력·조건부 옵션 |
| [라이브러리 진입점 지도](./guides/library-entrypoints.md) | package root/subpath와 artifact 경계 |
| [Mock 서버](./guides/mock-server-usage.md) | MSW / Node HTTP |
| [스키마 작성](./guides/schema-authoring.md) | TypeSpec production authoring과 Definition Builder rollback fragment |
| [스키마 어노테이션](./guides/schema-annotations.md) | 소비자 설명, 작성자 메모, 구조화된 내부 메타데이터 컨벤션 |
| [SchemaAlgebra](./guides/schema-algebra.md) | fold 패턴 확장 |
| [Preview App](../apps/preview/) | 브라우저 수동 프리뷰. 자동 E2E 보증은 [playground](../apps/playground/)가 담당 |
| [spec-lens](./spec-lens/README.md) | 커밋별 OpenAPI 변경 이력 관측 도구 — Timeline, Diff, Path Provenance, Fragment Graph |

## CLI Governance Spec

| 문서 | 대상 |
|------|------|
| [CLI Spec](./cli-spec/README.md) | TS/JS와 Python governance CLI 정렬 기준 |
| [CLI command schema](./cli-spec/cli-command.schema.json) | command entity + component JSON Schema |
| [oa-gen governance manifest](./cli-spec/oa-gen.governance.json) | TS/JS `oa-gen` governance 명령 스펙 |
| [oa-contract governance manifest](./cli-spec/oa-contract.governance.json) | Python `oa-contract` governance 명령 스펙 |

## 프로젝트 관리 (SSOT)

> 유저 가이드는 아래 SSOT를 참조합니다. 상세 정보는 여기서 유지됩니다.

| SSOT | 내용 |
|------|------|
| [spec.md](./internal/spec.md) | 구현 현황 |
| [plan.md](./internal/plan.md) | 로드맵 |
| [api-index.md](./internal/api-index.md) | API 단일 소스 |
| [behavior-ecs.spec.md](./internal/behavior-ecs.spec.md) | 행동 데이터 SSOT, representative use case, baseline/local verification |
| [feature-test-matrix.md](./internal/feature-test-matrix.md) | 기능 ↔ 테스트 매핑 |
| [oas32-coverage.md](./internal/oas32-coverage.md) | OAS 3.2 커버리지 |
| [traceability.md](./internal/traceability.md) | 스펙 ↔ 코드 추적 |
| [architecture/](./internal/architecture/) | ADR |

## OAS 3.2 참조

[references/oas32/](./references/oas32/) — 공식 스펙 15개 챕터 + 부록
