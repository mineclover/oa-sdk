# Behavior ECS

Behavior ECS는 행동 단위를 1급 데이터로 취급하는 모델이다.

여기서 ECS는 게임 엔진 스타일 최적화 구조라기보다, **행동 Entity에 의미 Component를 붙이고
System이 처리한다**는 운영 모델을 뜻한다.

이 문서는 DB 테이블이나 ORM 모델보다 먼저 **무슨 행동이 있었는가**, **그 행동을 어떤
맥락으로 감사할 것인가**, **어떤 시스템이 그 행동을 처리할 것인가**를 정의한다.

## Why ECS Here

oa-sdk 같은 governance/runtime tool chain에서는 테이블 중심 모델보다 행동 중심 모델이 더
적합할 때가 있다.

- review, drift, build, publish 같은 행위 자체가 감사 단위다.
- 같은 행동에 actor, target, input, decision, result, audit metadata가 함께 붙는다.
- append-only 기록과 projection이 자연스럽다.
- DB 기술이나 ORM보다 행동 의미와 lifecycle이 먼저 나온다.

이 경우 아키텍처 설명은 "헥사고날"보다 **Behavior ECS** 또는 **Action ECS**가 더 직접적이다.

## Core Model

### Entity

Entity는 한 번 발생한 **행동 인스턴스**다.

예시:

- `assign_manager_to_process`
- `approve_assignment_policy`
- `build_openapi_target`
- `publish_review_bundle`

Entity는 최소한 다음을 가진다.

- `behaviorId`
- `behaviorType`
- `status`
- `occurredAt`

### Component

Component는 행동에 붙는 의미 단위 데이터다.

권장 공통 컴포넌트:

- `actor`: 누가 실행했는가
- `target`: 무엇에 대해 실행했는가
- `input`: 어떤 입력으로 시작했는가
- `context`: 요청/세션/환경 맥락은 무엇인가
- `decision`: 어떤 규칙이나 정책이 적용됐는가
- `result`: 무엇이 바뀌었고 어떤 결과가 나왔는가
- `audit`: 추적, 보안, 컴플라이언스 관점 metadata
- `metrics`: latency, retry, error class 같은 운영 수치

### System

System은 Entity와 Component를 읽고 행동을 처리하는 실행 경계다.

예시:

- `CollectorSystem`
- `PolicySystem`
- `ExecutionSystem`
- `AuditLogSystem`
- `ProjectionSystem`
- `AlertSystem`

System은 비즈니스 의미를 만들지 않는다. 의미는 `behaviorType`과 component schema가 만든다.

## Action Unit Rules

행동 타입은 아래 조건을 만족해야 한다.

- 도메인 언어로 이름 붙일 수 있어야 한다.
- 시작과 완료 시점이 분명해야 한다.
- 성공/실패/보상 여부를 감사할 수 있어야 한다.
- 재처리 기준을 정의할 수 있어야 한다.
- 한 건의 append-only 기록으로 남길 가치가 있어야 한다.

좋은 예:

- `assign_manager_to_process`
- `approve_assignment_policy`
- `sync_runtime_openapi`
- `publish_review_bundle`

나쁜 예:

- `select_user_row`
- `update_table`
- `call_helper`
- `run_sql`

테이블 작업이나 함수 호출은 행동 타입이 아니라 구현 detail이다.

## Logging Rules

행동 로그와 애플리케이션 로그는 분리한다.

- 애플리케이션 로그: 디버깅과 장애 분석용
- 행동 로그: 감사, 운영 분석, 추적, 지표용

권장 규칙:

- 주요 command는 반드시 `behavior entity`를 1건 생성한다.
- 하위 단계는 child behavior 또는 component/log entry로 남긴다.
- 원본 행동 로그는 append-only로 유지한다.
- 조회 최적화는 projection에서 담당한다.

## Representative Use Cases

대표 use case는 아래 축으로 본다.

- target artifact build 감사
- OpenAPI review 감사
- runtime drift 감사
- PR review bundle 발행
- behavior query read model 조회

운영 흐름과 command별 evidence는
[Behavior ECS Spec](../internal/behavior-ecs.spec.md#representative-use-cases)과
[OpenAPI Governance Workflow](../guides/use-cases/openapi-governance-workflow.md)를 따른다.

## Lifecycle

기본 lifecycle은 다음 순서를 권장한다.

- `received`
- `validated`
- `executing`
- `succeeded`
- `failed`
- `compensated`

모든 행동이 모든 상태를 거칠 필요는 없지만, 상태 전이는 deterministic해야 한다.

## Storage Model

행동 수집과 로깅 목적이라면 append-only 저장을 기본으로 둔다.

분리형 예시:

- `behavior_entities`
- `behavior_components`
- `behavior_logs`
- `behavior_projections`

단일 document 예시:

```json
{
  "behaviorId": "bhv_01...",
  "behaviorType": "assign_manager_to_process",
  "status": "succeeded",
  "actor": { "type": "user", "id": "u_123" },
  "target": { "type": "process", "id": "p_456" },
  "input": { "projectId": "prj_1", "processType": "qa" },
  "context": { "requestId": "req_1", "source": "api" },
  "decision": { "policyVersion": "v3", "matchedRule": "rule_7" },
  "result": { "assignedManagerId": "m_12" },
  "audit": { "ip": "10.0.0.1", "traceId": "tr_1" },
  "metrics": { "latencyMs": 83 }
}
```

## Current Status In oa-sdk

현재 oa-sdk는 **Behavior ECS를 구현한 런타임 서비스**라기보다, OpenAPI governance/build/review
platform에 가깝다.

현재 구현 범위와 남은 항목은
[Behavior ECS Spec](../internal/behavior-ecs.spec.md#status-in-oa-sdk)를 단일 소스로 본다.

## Basic Test Cases

기본 테스트 케이스와 대표 테스트 파일은
[Behavior ECS Spec](../internal/behavior-ecs.spec.md#baseline-test-cases)를 따른다.

## Where To Start In oa-sdk

처음 따라갈 때는 이 순서를 권장한다.

1. 개념: 이 문서
2. SSOT: [Behavior ECS Spec](../internal/behavior-ecs.spec.md)
3. 운영 흐름: [OpenAPI Governance Workflow](../guides/use-cases/openapi-governance-workflow.md)
4. 함수/타입 인덱스: [API Index](../internal/api-index.md)

## Team Rule

팀 슬로건은 다음처럼 정의하면 된다.

> 비즈니스 행동은 Entity로 기록하고, 의미는 Component로 붙이고, 처리는 System이 담당한다.

그리고 저장 원칙은 다음 한 줄로 고정하면 된다.

> 모든 주요 행동은 append-only behavior record로 남기고, 조회는 projection에서 해결한다.
