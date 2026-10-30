# Contract Governance

이 문서는 OpenAPI contract와 governance gate에서 쓰는 기본 용어를 정의한다. TypeSpec
authoring, OpenAPI artifact/intake, downstream runtime, 외부 owner의 전체 경계는
[Contract Ownership Boundaries](../internal/contract-boundaries.md)를 따른다.

## OpenAPI Contract

OpenAPI contract는 외부 API 사용자가 기대할 수 있는 요청, 응답, 인증, 오류, 예시,
서버, 태그, 스트리밍, webhook 등의 공개 계약이다.

oa-sdk에서 OpenAPI contract는 생성물만이 아니라 검증, 타입 생성, 라우터 스텁,
클라이언트 SDK, mock server, diff/review gate가 함께 소비하는 중심 산출물이다.

## Source Of Truth

Source of truth는 계약을 사람이 고치는 원천이다.

OA SDK production schema pipeline에서는 `packages/schemas/typespec/`의 TypeSpec bundle이
source of truth다. `packages/schemas/src/.merged.yaml`은 그 source에서 생성한 OpenAPI 3.2
canonical artifact이며, `src/fragments`와 `src/targets`는 Definition Builder rollback/reference
경로다. Zod/Drizzle projection은 외부 producer가 OA SDK로 계약을 넘길 때의 source이고, Python
template에서는 Pydantic DTO와 `ContractRegistry` 또는 checked-in `ContractSpec` JSON이 source of
truth다.
DB 가명처리 파이프라인에서는 Data Pseudonymization Manifest가 source DB 범위, catalog,
entity, column transform, vault, validation, publishing 정책의 source of truth다. Logical
relationship의 lifecycle source of truth는 Relationship Registry이며, DPM은 실행 시점의 approved
relationship snapshot을 담는다.

Generated OpenAPI, generated TypeScript, generated client/router, review report는 source
of truth가 아니다.

## Generated Artifact

Generated artifact는 source of truth에서 재생성 가능한 파일이다. 대표 예시는 다음과 같다.

- merged OpenAPI document
- target-specific OpenAPI document
- OpenAPI 3.1 downgrade artifact
- generated TypeScript types
- generated router/client code
- contract snapshot
- review report
- approved relationship registry snapshot
- compiled pseudonymization plan
- pseudonymization validation report
- AI schema context

Generated artifact는 review evidence로 쓰되, drift를 해결하기 위해 직접 수정하지 않는다.

## Snapshot

Snapshot은 비교와 릴리스 기준선을 위해 저장한 deterministic contract document다.

Python template의 `contract.json` snapshot은 application code를 import하지 않고도
`validate`, `diff`, `emit-openapi`, `review`에 넣을 수 있는 release comparison input이다.
TS/JS 쪽에서는 merged OpenAPI 또는 Definition Builder output이 비슷한 baseline 역할을 한다.

## Diff

Diff는 base contract와 head contract의 변경을 분류한다.

Breaking diff는 기존 client가 깨질 수 있는 변경을 막기 위한 gate다. Non-breaking diff는
review 정보로 남기되 보통 merge를 막지 않는다.

## Drift

Drift는 managed contract와 runtime 또는 generated artifact가 서로 어긋난 상태다.

- runtime drift: framework runtime OpenAPI가 managed OpenAPI와 다름
- artifact drift: checked-in generated OpenAPI가 source of truth에서 새로 생성한 결과와 다름
- docs drift: 문서/manifest/test matrix가 실제 코드와 다름

Drift는 가능한 자동 check로 막고, 예외가 필요하면 명시적 report나 accepted difference로 남긴다.

## Artifact Freshness

Artifact freshness check는 generated artifact가 현재 source of truth에서 재생성한 결과와
일치하는지 확인하는 gate다.

Fresh artifact는 현재 source와 일치한다. Stale artifact는 재생성되거나 source 변경이
되돌려져야 한다.

## Review Report

Review report는 여러 governance check를 한 리포트로 묶은 결과다.

기본 recommendation은 다음 세 값이다.

- `APPROVE`: blocking issue가 없음
- `COMMENT`: non-breaking change 또는 미실행 check가 있음
- `REQUEST_CHANGES`: breaking change, validation error, drift, stale artifact가 있음

## Target

Target은 같은 source of truth에서 서로 다른 API audience 또는 배포면을 분리하는 단위다.

예시는 `public`, `admin`, `internal`, `partner`, `local-parity-api`다. Target-specific
artifact는 해당 target에 필요한 paths/components만 포함해야 한다.
