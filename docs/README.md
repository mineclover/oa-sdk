# oa-sdk 문서

## 유저 가이드

| 문서 | 대상 |
|------|------|
| [Vision](./vision.md) | 핵심 철학과 주 목표 |
| [Concepts](./concepts.md) | 공통 용어와 계약 경계 정의 |
| [Behavior ECS](./concepts/behavior-ecs.md) | 행동 단위 Entity/Component/System 정의, representative use case, 기본 테스트 케이스 |
| [Quick Start](./guides/quick-start.md) | 5분 안에 전 파이프라인 체험 |
| [Mock 테스팅](./guides/use-cases/mock-testing.md) | 프론트엔드 테스트에서 Mock 서버 활용 |
| [코드젠 워크플로](./guides/use-cases/codegen-workflow.md) | Drizzle → OAS → TS → 라우터 → 클라이언트 |
| [OpenAPI Governance Workflow](./guides/use-cases/openapi-governance-workflow.md) | target artifact sidecar, duplicate review, target-check, drift, review bundle |
| [OpenAPI Governance Service Template](./guides/openapi-governance-service-template.md) | 서비스별 governance 설정 템플릿 |
| [NestJS Swagger Governance](./guides/use-cases/nestjs-swagger-governance.md) | NestJS 스웨거 산출물 → oa-sdk 계약 관리 레퍼런스 |
| [Path Fragment Conventions](./guides/path-fragment-conventions.md) | path fragment 폴더, canonical id, feedback 좌표 규칙 |
| [bun-graph-db projection 소비](./guides/use-cases/bun-graph-db-projections.md) | bun-graph-db OpenAPI full document/table projection → OA SDK |
| [테스트 피드백](./guides/use-cases/test-feedback.md) | 커버리지 + 검증 피드백 루프 |
| [CLI 세팅](./guides/cli-setup.md) | 설치 + CLI 명령어 |
| [Mock 서버](./guides/mock-server-usage.md) | MSW / Node HTTP |
| [스키마 작성](./guides/schema-authoring.md) | 도메인 분리 spec.yaml |
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
