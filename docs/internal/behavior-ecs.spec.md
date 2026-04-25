# Behavior ECS Spec

> 상태: 제안된 SSOT
> 목적: 행동 단위 수집, 로깅, 감사, projection의 공통 모델을 고정한다.
> 개념 정의: [Behavior ECS](../concepts/behavior-ecs.md)

---

## Scope

이 문서는 oa-sdk 또는 이를 사용하는 서비스에서 **행동 데이터(Action Data)** 를 어떻게
정의하고 기록할지 고정한다.

대상:

- command execution logging
- audit trail
- behavior projection
- policy/decision evidence
- metrics correlation

비대상:

- 일반 애플리케이션 debug log 포맷
- ORM schema나 특정 DB driver 선택
- OpenAPI contract 자체의 구조 정의

---

## Architecture Statement

행동 데이터 모델은 **Behavior ECS (Action ECS)** 로 정의한다.

- 행동 인스턴스는 `Entity`
- 행동 의미 데이터는 `Component`
- 행동 처리/수집/투영은 `System`

팀 슬로건:

> 비즈니스 행동은 Entity로 기록하고, 의미는 Component로 붙이고, 처리는 System이 담당한다.

---

## Goals

1. 주요 행동을 append-only record로 남긴다.
2. 감사 가능한 공통 component schema를 고정한다.
3. DB나 ORM보다 행동 의미를 먼저 정의한다.
4. projection/read model을 원본 기록과 분리한다.
5. review/drift/build/publish 같은 운영 행동도 같은 모델로 수집할 수 있게 한다.

---

## Entity Definition

행동 Entity는 한 번 발생한 행동 인스턴스다.

필수 필드:

- `behaviorId`
- `behaviorType`
- `identityKey`
- `status`
- `occurredAt`

권장 필드:

- `schemaVersion`
- `parentBehaviorId`
- `correlationId`
- `causationId`
- `source`

예시:

```json
{
  "behaviorId": "bhv_01J...",
  "behaviorType": "assign_manager_to_process",
  "identityKey": "assign_manager_to_process:targetKey=process-123:targetType=process",
  "status": "received",
  "occurredAt": "2026-04-23T12:00:00.000Z",
  "correlationId": "corr_01J...",
  "source": "api"
}
```

`behaviorId`는 개별 record를 식별하고, `identityKey`는 같은 행동 흐름을 식별한다.
상태 전이와 latest projection의 기준은 `identityKey`다.

---

## Behavior Type Rules

행동 타입은 도메인 언어로 정의한다.

규칙:

- 동사 + 대상 의미를 가져야 한다.
- 테이블/ORM/helper 이름을 쓰지 않는다.
- 기술 동작보다 비즈니스 의미를 우선한다.
- 시작/완료/실패를 감사할 수 있어야 한다.

좋은 예:

- `assign_manager_to_process`
- `approve_assignment_policy`
- `build_openapi_target`
- `publish_review_bundle`
- `sync_runtime_openapi`

나쁜 예:

- `select_user_row`
- `update_table`
- `call_helper`
- `run_sql`

---

## Component Set

공통 component는 아래 8개를 기본 세트로 사용한다.

### 1. `actor`

누가 실행했는가.

예시 필드:

- `actorType`
- `actorId`
- `actorRole`

### 2. `target`

무엇에 대해 실행했는가.

예시 필드:

- `targetType`
- `targetId`
- `targetKey`

### 3. `input`

행동 시작 시 들어온 입력.

예시 필드:

- command payload
- selected path/target
- request params

### 4. `context`

행동이 실행된 맥락.

예시 필드:

- `requestId`
- `traceId`
- `source`
- `environment`
- `tenantId`

### 5. `decision`

정책/룰/판단 근거.

예시 필드:

- `policyVersion`
- `matchedRule`
- `decisionReason`

### 6. `result`

행동 결과.

예시 필드:

- `resultType`
- `changedFields`
- `outputArtifact`
- `errorCode`

### 7. `audit`

감사/보안/추적용 metadata.

예시 필드:

- `ip`
- `userAgent`
- `sessionId`
- `complianceTags`

### 8. `metrics`

운영 수치.

예시 필드:

- `latencyMs`
- `retryCount`
- `queueLatencyMs`

---

## Lifecycle

기본 상태 전이는 다음 순서를 권장한다.

- `received`
- `validated`
- `executing`
- `succeeded`
- `failed`
- `compensated`

규칙:

- 상태 전이는 단방향이어야 한다.
- terminal state는 `succeeded`, `failed`, `compensated`다.
- `validated`를 건너뛸 수는 있지만, `executing` 후 `received`로 되돌아가면 안 된다.

허용 예:

- `received -> executing -> succeeded`
- `received -> validated -> failed`
- `received -> validated -> executing -> failed`

비허용 예:

- `succeeded -> executing`
- `failed -> received`

---

## Logging Model

행동 로그와 앱 로그는 분리한다.

- app log: 디버깅/장애 분석
- behavior log: 감사/운영 분석/정책 추적

규칙:

- 모든 주요 command는 behavior entity를 최소 1건 생성한다.
- 세부 단계는 child behavior 또는 log entry로 남긴다.
- 원본 behavior record는 append-only다.
- 수정은 projection에서 해결하고, 원본 overwrite는 금지한다.

---

## Storage Model

권장 저장 방식은 append-only다.

분리형 테이블:

- `behavior_entities`
- `behavior_components`
- `behavior_logs`
- `behavior_projections`

최소 권장 스키마:

### `behavior_entities`

- `behavior_id`
- `behavior_type`
- `status`
- `occurred_at`
- `correlation_id`
- `parent_behavior_id`

### `behavior_components`

- `behavior_id`
- `component_type`
- `payload_json`
- `recorded_at`

### `behavior_logs`

- `behavior_id`
- `level`
- `message`
- `payload_json`
- `created_at`

### `behavior_projections`

- `projection_key`
- `behavior_type`
- `target_key`
- `summary_json`
- `updated_at`

---

## Projection Rules

projection은 조회 최적화용이다.

규칙:

- projection은 원본 entity/component/log를 대체하지 않는다.
- projection은 재생성 가능해야 한다.
- projection key는 조회 목적 기준으로 설계한다.

예시:

- `latest_assignment_by_process`
- `review_bundle_by_target`
- `build_status_by_target`

---

## Command Instrumentation Rules

주요 command에는 behavior instrumentation을 붙인다.

1차 대상:

- `build-spec`
- `review`
- `review-bundle`
- `check-artifact`
- `drift`

최소 기록 항목:

- `behaviorType`
- `actor`
- `target`
- `input`
- `result`
- `audit`
- `metrics`

예:

- `build-spec` 실행 시 `build_openapi_target`
- `review-bundle` 실행 시 `publish_review_bundle`
- `drift` 실행 시 `sync_runtime_openapi`

---

## Representative Use Cases

현재 oa-sdk에서 바로 재현 가능한 대표 use case는 아래 네 가지다.

| Use Case | Command | Behavior Type | 핵심 evidence |
|---|---|---|---|
| target artifact build 감사 | `oa-gen build-spec` | `build_openapi_target` | diagnostics count, selected node count, output path |
| OpenAPI review 감사 | `oa-gen review` | `review_openapi_change` | breaking/non-breaking count, validation count, artifact/provenance/metadata checked state |
| runtime drift 감사 | `oa-gen drift` | `sync_runtime_openapi` | drift flag, issue count, fetch failure code/message |
| PR review bundle 발행 | `oa-gen review-bundle` | `publish_review_bundle` | review summary reasons, include/checked state, duplicate review validity |

운영 조회 use case는 `oa-gen behavior-query`가 담당한다. 이 read model은 latest query와
summary query를 통해 raw append-only record를 직접 읽지 않고 projection을 읽는다.

---

## Baseline Test Cases

Behavior ECS 관련 변경은 아래 기본 테스트 케이스를 유지해야 한다.

| 범주 | 확인 내용 | 대표 테스트 |
|---|---|---|
| record shape | per-behavior `input/target/decision/result` schema validation | `packages/codegen/src/__tests__/behavior-recorder.test.ts` |
| lifecycle | allowed transition / persisted history transition enforcement | `packages/codegen/src/__tests__/behavior-recorder.test.ts` |
| semantic consistency | decision-result, input-target, targetKey composition, sidecar relation | `packages/codegen/src/__tests__/behavior-recorder.test.ts` |
| durable persistence | JSONL append, SQLite write, projection snapshot update | `packages/codegen/src/__tests__/behavior-recorder.test.ts`, `behavior-projection.test.ts` |
| latest projection | latest-by-type/identity/target/decision/recommendation | `packages/codegen/src/__tests__/behavior-projection.test.ts` |
| CLI logging | `build-spec`/`review`/`drift`/`review-bundle` behavior payload | `packages/codegen/src/__tests__/cli-build-spec.test.ts`, `cli-scenarios.test.ts`, `cli-review-bundle.test.ts` |
| query surface | latest query + summary aggregation + filter 조합 | `packages/codegen/src/__tests__/cli-scenarios.test.ts` |

문서 drift 관점에서는 아래도 같이 유지한다.

- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.md`
- `docs/cli-spec/oa-gen.governance.json`

---

## Local Verification

Behavior ECS 관련 변경 후 최소한 아래 명령은 직접 확인한다.

```bash
pnpm --filter @oa-sdk/codegen test -- \
  src/__tests__/behavior-recorder.test.ts \
  src/__tests__/behavior-projection.test.ts \
  src/__tests__/cli-scenarios.test.ts \
  src/__tests__/cli-review-bundle.test.ts

pnpm --filter @oa-sdk/codegen test
pnpm check:cli-spec
pnpm check:feature-tests
```

use case smoke check가 필요하면 아래를 우선 본다.

```bash
oa-gen build-spec --target <target.yaml> --behavior-db <behavior.sqlite>
oa-gen review --base <base.yaml> --head <head.yaml> --artifact <artifact.yaml> --behavior-db <behavior.sqlite> --format json
oa-gen review-bundle --base <base.yaml> --head <head.yaml> --artifact <artifact.yaml> --behavior-db <behavior.sqlite> --format json
oa-gen drift --runtime-openapi <runtime.yaml> --managed-openapi <managed.yaml> --behavior-db <behavior.sqlite> --format json
oa-gen behavior-query --behavior-db <behavior.sqlite> --mode summary-by-behavior-decision-signal --format json
```

문제가 생기면 먼저 아래 순서로 본다.

1. `behavior-recorder.test.ts`: schema / semantic rule
2. `behavior-projection.test.ts`: latest/projection state
3. `cli-scenarios.test.ts`: command-level behavior payload
4. `cli-review-bundle.test.ts`: aggregate review state

---

## Status In oa-sdk

현재 oa-sdk 구현 상태는 다음과 같다.

이미 있음:

- 행동에 가까운 command surface
- append-only 성격의 sidecar/report artifact
- provenance/metadata diff 같은 감사 evidence
- report/review/render/helper 계층 분리
- `build-spec --behavior-log`를 통한 첫 behavior entity append-only JSONL 기록
- `review --behavior-log`를 통한 review behavior append-only JSONL 기록
- `BehaviorRecorder` port와 `noop`/`jsonl`/`memory` adapter
- `build-spec --behavior-db`를 통한 첫 durable SQLite adapter
- `drift --behavior-log`를 통한 runtime sync behavior 기록
- `review-bundle --behavior-log`를 통한 review bundle publish behavior 기록
- `drift`/`review`/`build-spec`/`review-bundle`에서 공통 recorder option shape 사용
- behavior record schema validator
- lifecycle transition guard utility
- `behavior-registry.ts` 기반 behavior type registry
- SQLite `behavior_records` 기반 recent/latest projection reader
- SQLite `behavior_projections` table 기반 latest-by-type/latest-by-target/latest-failure-by-type/latest-by-recommendation snapshot 유지
- 공통 component 최소 specialization (`actor`, `target`, `context`, `result`, `audit`, `metrics`)
- per-behavior input/target/decision/result schema, identity builder, projection policy 선언형 registry
- per-behavior decision/result semantic consistency validator
- per-behavior targetKey composition 및 input/target cross-field consistency validator
- review/review-bundle sidecar summary relation validator (`artifactFresh`, `provenanceChanges`, `metadataRegistryChanges`, `runtimeDrift`, `duplicateReviewValid`)
- review sidecar checked-state validator (`artifactChecked`, `provenanceChecked`, `metadataRegistryChecked`)
- review-bundle checked/included-state validator (`artifactChecked`, `runtimeDriftIncluded`, `provenanceChecked`, `metadataRegistryChecked`, `duplicateReviewIncluded`)
- review-bundle included section summary validator (`inventoryIncluded`, `compositionIncluded`, `metadataRegistryIncluded`, `metadataRegistryValid`)
- review/review-bundle summary reason validator (`reasonCount`, `reasons[]`)
- command behavior payload에 explicit `decision.primarySignal` / `decisionReason` 기록
- `behavior-query` filtered recent/latest surface와 `latest-failure-by-type`/`latest-by-decision-signal` mode, `decision-signal` filter, summary-by-* 및 composite aggregation (`behavior+status`, `behavior+decision`)
- `identityKey` 기반 latest-by-identity snapshot과 persisted history transition enforcement
- SQLite recorder에서 persisted history transition enforcement

아직 없음:

- multi-command shared durable behavior persistence boundary
- deeper domain-specific component schema specialization (service-specific `target`, richer per-behavior `decision/result` detail)
- richer projection storage model beyond current snapshot set
- general persisted behavior history transition enforcement
- 모든 주요 command에 대한 instrumentation hook
- audit/metrics collection SSOT

즉, 현재는 **Behavior ECS 적용 준비 단계**다.

---

## Next Implementation Slice

다음 구현 단위는 아래 순서를 권장한다.

1. `behaviorType` registry 정의
2. 공통 component schema (`actor`, `target`, `input`, `context`, `decision`, `result`, `audit`, `metrics`)
3. append-only persistence interface
4. `review` / `review-bundle` / `build-spec` instrumentation
5. projection reader

현재 1~5는 모두 최소 구현이 완료됐고, 다음 slice는 registry 세분화와 richer projection 확장이다.

---

## Acceptance Criteria

이 스펙이 충족되려면 다음이 필요하다.

- 행동 타입 목록이 SSOT로 관리된다.
- 공통 component schema가 문서화된다.
- lifecycle이 명시적으로 고정된다.
- append-only 저장 원칙이 문서로 선언된다.
- 최소 1개 command가 behavior entity를 실제로 기록한다.
