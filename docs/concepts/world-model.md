---
docType: explanation
sourceLocale: ko
canonical: true
question: "World Model Kernel 계약은 World의 고정된 정체성, stimulus 수용, logical time, revision-pinned projection을 어떻게 연결하는가?"
scope:
  includes:
    - "ModelRef와 ExecutionProfileRef가 bootstrap identity를 이루는 방식"
    - "WorldHead, StimulusAccepted, logical time advance, projection의 계약 경계"
    - "인증 경계와 7개 World Model operation의 역할"
  excludes:
    - "런타임 실행 순서와 구현"
    - "저장소·영속성 구현"
    - "인증 토큰 발급·검증 세부사항"
    - "선언된 응답 타입을 넘어선 성공·부작용 의미"
decisionStatus: accepted
owner: "packages/schemas/typespec/"
reviewDue: "2026-11-10"
status: active
lastReviewed: "2026-08-10"
sourceOfTruth:
  - packages/schemas/typespec/world-model.tsp
  - packages/schemas/typespec/metadata/service.tsp
---

# World Model Kernel 계약의 경계와 흐름

World Model Kernel 계약은 World를 하나의 불투명한 상태 덩어리로 다루지 않는다. 생성 시
고정되는 모델·실행 조합, Agenda에 제출되는 stimulus, 외부에 공개되는 control head, 특정
revision에 묶인 semantic projection을 서로 다른 계약으로 나눈다. 따라서 이 계약을 읽을
때는 `worldId` 하나보다 **어떤 모델과 실행 조합으로 bootstrap 되었는가**, **stimulus가
어디까지 받아들여졌는가**, **어느 revision을 읽는가**를 함께 봐야 한다.

이 문서는 [world-model.tsp](../../packages/schemas/typespec/world-model.tsp)와
[metadata/service.tsp](../../packages/schemas/typespec/metadata/service.tsp)의 선언만을
근거로 한다. TypeSpec에 선언되지 않은 런타임 실행, 저장소 구조, 인증 처리 과정, 성공 시
부작용은 설명하지 않는다.

## World의 bootstrap identity는 생성 뒤 고정된다

[`ModelRef`](../../packages/schemas/typespec/world-model.tsp#ModelRef)는 게시된 World Model artifact의 정확한 식별자다. `modelId`, `version`,
`semanticFingerprint`를 함께 가지며, 세 값 모두 비어 있지 않아야 한다. [`ExecutionProfileRef`](../../packages/schemas/typespec/world-model.tsp#ExecutionProfileRef)도
같은 형태로 `profileId`, `version`, `semanticFingerprint`를 가지지만, 그 대상은 World에
고정할 실행 provider 조합이다. 두 참조는 단순한 표시용 이름이 아니라 각각 모델 artifact와
실행 조합을 정확히 가리키는 묶음으로 선언되어 있다.

[`CreateWorldRequest`](../../packages/schemas/typespec/world-model.tsp#CreateWorldRequest)는 이 두 참조를 `worldId`, 필수 `bootstrapSpecRef`, 선택적
`runSeedMaterial`과 함께 받는다. `worldId`는 UUID 형식이고, `bootstrapSpecRef`는 모델이
해석하는 초기 scenario/configuration reference다. 선언의 핵심 제약은 World가 생성된 뒤
[`ModelRef`](../../packages/schemas/typespec/world-model.tsp#ModelRef)와 [`ExecutionProfileRef`](../../packages/schemas/typespec/world-model.tsp#ExecutionProfileRef)를 normal Stimulus로 바꿀 수 없다는 점이다. 그러므로
World의 정체성은 `worldId`만으로 끝나지 않고, bootstrap 시 선택한 모델과 실행 조합까지
포함한다.

`runSeedMaterial`이 없을 때 provider가 생성한 값은 `WorldControlState`에 고정된다고
선언되어 있다. 여기서 계약이 말하는 것은 seed material의 bootstrap 고정 규칙까지이며,
그 값을 어떻게 생성하거나 보관하는지는 이 문서의 근거 범위에 없다.

선택 가능한 실행 profile을 설명하는 [`ExecutionProfileSummary`](../../packages/schemas/typespec/world-model.tsp#ExecutionProfileSummary)는 [`ExecutionProfileRef`](../../packages/schemas/typespec/world-model.tsp#ExecutionProfileRef)와
함께 `persistenceRecovery`, `numericSemantics`, `decisionRandom`, `commitIsolation`,
`conformanceProfiles`를 공개 요약으로 제시한다. 이 필드들은 profile을 비교할 수 있는
계약상의 분류 축을 보여 주지만, TypeSpec 선언만으로 각 provider의 실제 구현 동작을
추가로 확정하지는 않는다.

## WorldHead는 domain graph가 아니라 public control head다

[`WorldHead`](../../packages/schemas/typespec/world-model.tsp#WorldHead)는 World의 public control head로 선언된다. 포함되는 값은 `worldId`, 고정된
`modelRef`, 고정된 `executionProfile`, 0 이상인 `revision`, 현재 logical time을 모델이
선언한 형식으로 직렬화한 `logicalTime`, 그리고 `created`·`active`·`inactive`·`ended` 중
하나인 `lifecycle`이다.

반대로 [`WorldHead`](../../packages/schemas/typespec/world-model.tsp#WorldHead)에는 Domain Property와 raw `StateObject` graph가 포함되지 않는다. 이
제외는 head가 domain state 전체의 표현이라는 오해를 막는다. 계약은 제어에 필요한 식별자와
revision·시간·lifecycle을 head에 두고, 모델이 선언한 의미를 읽는 경로는 별도의 projection
operation과 [`ProjectionEnvelope`](../../packages/schemas/typespec/world-model.tsp#ProjectionEnvelope) 또는 [`ProjectionBundleEnvelope`](../../packages/schemas/typespec/world-model.tsp#ProjectionBundleEnvelope)로 둔다.

## Stimulus accepted는 commit 완료가 아니라 ingress의 의미다

Action은 [`SubmitActionRequest`](../../packages/schemas/typespec/world-model.tsp#SubmitActionRequest)라는 typed envelope로 제출된다. `actionTypeId`가 action의
종류를 가리키고, `roles`는 `ActionRoleDefinition` stable ID에서 active Entity UUID로의
binding이며, 선택적 `parameters`는 `ActionParameterDefinition` stable ID에서 typed JSON
value로의 binding이다. role과 parameter의 상세 contract는 World의 PublishedModel이
검증한다고 선언되어 있다. `stimulusId`, `correlationId`, `causationId`는 stimulus의
식별·연결 맥락을 나타내는 필드로 함께 제공된다.

Action 제출과 logical time advance 제출은 모두 [`StimulusAccepted`](../../packages/schemas/typespec/world-model.tsp#StimulusAccepted)를 body로 선언한다.
이 모델은 Agenda가 Stimulus를 받아들였음을 표현하며, `status`는 `accepted` 또는
`duplicate`다. `acceptedAtRevision`과 `acceptedLogicalTime`은 받아들인 시점에 연결된
revision과 logical time을 함께 노출한다.

여기서 가장 중요한 경계는 모델의 명시적인 설명이다. [`StimulusAccepted`](../../packages/schemas/typespec/world-model.tsp#StimulusAccepted)는 Transaction
commit 성공을 뜻하지 않는다. 따라서 `accepted`를 domain state 변경 완료, 실행 완료,
또는 저장 완료로 확장해 읽을 수 없다. 계약이 보장하는 의미는 Agenda 수용과 그 수용 시점의
식별 정보까지다.

## Logical time advance는 두 가지 의도 중 하나다

[`SubmitTimeAdvanceRequest`](../../packages/schemas/typespec/world-model.tsp#SubmitTimeAdvanceRequest)는 Action과 같은 stimulus envelope 계열에 속하며, `stimulusId`와
선택적 `correlationId`, `causationId`를 가진다. 시간 전진의 내용은 다음 두 형태 중 하나로
표현된다.

- [`AdvanceToLogicalTime`](../../packages/schemas/typespec/world-model.tsp#AdvanceToLogicalTime): `kind`가 `to-logical-time`이고, 현재 logical time에서
  `targetLogicalTime`까지 전진하려는 요청이다.
- [`AdvanceByLogicalDuration`](../../packages/schemas/typespec/world-model.tsp#AdvanceByLogicalDuration): `kind`가 `by-duration`이고, 현재 logical time에서
  `duration`만큼 전진하려는 요청이다.

두 형태는 union으로 묶여 있으므로 한 요청은 target instant와 duration을 동시에 갖지
않는다. `logicalTime`, `targetLogicalTime`, `duration`의 구체적인 직렬화·단위 규칙은 이
선언에 추가로 정의되어 있지 않다. 시간 전진 operation도 [`StimulusAccepted`](../../packages/schemas/typespec/world-model.tsp#StimulusAccepted)를 반환하는
계약이므로, 시간 값이 즉시 바뀌었다는 응답으로 해석하지 않는다.

## Revision-pinned projection은 읽기의 기준점을 계약에 남긴다

[`ProjectionEnvelope`](../../packages/schemas/typespec/world-model.tsp#ProjectionEnvelope)는 특정 `sourceRevision`에서 materialize한 semantic projection이다.
이 envelope는 `worldId`, `modelRef`, 0 이상인 `sourceRevision`, `projectionId`, 그리고
PublishedModel이 선언한 projection result의 typed JSON representation인 `value`를 가진다.
여기서 `modelRef`는 projection이 어느 World Model identity에 속하는지, `sourceRevision`은
어느 revision을 기준으로 읽는지를 함께 나타낸다.

여러 projection을 함께 읽어야 할 때는 [`ProjectionBundleEnvelope`](../../packages/schemas/typespec/world-model.tsp#ProjectionBundleEnvelope)를 사용한다. bundle은
하나의 `worldId`, `modelRef`, `sourceRevision`, `bundleId`, `status`, projection 배열을
가지며, 선언상 같은 revision에서 함께 읽어야 하는 semantic projection 묶음이다. 배열의
[`ProjectionBundleItem`](../../packages/schemas/typespec/world-model.tsp#ProjectionBundleItem)은 `projectionId`와 `value`만 가지므로 outer envelope의 World
identity와 revision을 상속하며 서로 다른 World나 revision을 독립적으로 표기할 수 없다.
`status`의 가능한 값은 `complete`, `incomplete`, `stale`이지만, 각 상태를 판정하는 런타임
조건은 TypeSpec에 정의되어 있지 않다.

두 projection 조회 operation 모두 선택적 `revision` query를 받으며, 값은 0 이상이다.
따라서 조회 계약은 현재 head만을 암묵적으로 읽는 형태에 한정되지 않고, 요청이 지정한
revision과 결과의 `sourceRevision`을 연결할 수 있는 모양을 가진다. 다만 `revision`을
생략했을 때의 선택 규칙이나 요청한 revision을 사용할 수 없을 때의 동작은 선언되어 있지
않다.

## 일곱 operation은 하나의 인증된 World Model 표면을 이룬다

[metadata/service.tsp](../../packages/schemas/typespec/metadata/service.tsp)는 `world-model` tag를 “World bootstrap, stimulus ingress,
revision-pinned projection query”로 설명한다. [world-model.tsp](../../packages/schemas/typespec/world-model.tsp)의 아래 일곱 operation은
모두 `@useAuth([bearerAuth](../../packages/schemas/typespec/common.tsp#bearerAuth))`를 선언한다. 이는 각 operation이 bearer 인증 경계를 가진다는
뜻이며, 토큰 발급·검증·갱신이나 권한 정책까지 정의하는 선언은 아니다.

| operationId | route | 계약상 역할 |
|---|---|---|
| [`listExecutionProfiles`](../../packages/schemas/typespec/world-model.tsp#listExecutionProfiles) | `GET /world-model/execution-profiles` | 선택 가능한 실행 profile 목록 |
| [`createWorld`](../../packages/schemas/typespec/world-model.tsp#createWorld) | `POST /worlds` | 새 World bootstrap |
| [`getWorldHead`](../../packages/schemas/typespec/world-model.tsp#getWorldHead) | `GET /worlds/{worldId}` | World control head 조회 |
| [`submitWorldAction`](../../packages/schemas/typespec/world-model.tsp#submitWorldAction) | `POST /worlds/{worldId}/actions` | Action stimulus 제출 |
| [`submitWorldTimeAdvance`](../../packages/schemas/typespec/world-model.tsp#submitWorldTimeAdvance) | `POST /worlds/{worldId}/time-advances` | Logical time advance stimulus 제출 |
| [`getWorldProjection`](../../packages/schemas/typespec/world-model.tsp#getWorldProjection) | `GET /worlds/{worldId}/projections/{projectionId}` | revision-pinned semantic projection 조회 |
| [`getWorldProjectionBundle`](../../packages/schemas/typespec/world-model.tsp#getWorldProjectionBundle) | `GET /worlds/{worldId}/projection-bundles/{bundleId}` | revision-pinned semantic projection bundle 조회 |

이 표면의 흐름은 “profile 선택 → bootstrap identity를 정한 World 생성 → stimulus 제출과
logical time 의도 제출 → revision 기준의 semantic read”로 읽을 수 있다. 다만 이것은 선언된
operation의 관계를 설명한 개념적 흐름이지, 서버 내부의 실행 순서나 저장소 transaction
흐름을 주장하는 것이 아니다.

## 계약이 말하지 않는 것

이 계약만으로는 다음을 확정할 수 없다.

- Action이나 time advance stimulus가 어떤 순서로 실행되는가
- `persistenceRecovery` profile이 어떤 저장소·복구 구현으로 실현되는가
- `StimulusAccepted` 뒤에 언제 어떤 domain 변경이 일어나는가
- bearer 인증 정보를 어떻게 발급하고 검증하는가
- 선택적 `revision`이 없거나 사용할 수 없을 때 어떤 결과를 내는가
- operation이 선언된 응답 타입을 반환한 뒤 어떤 부작용이나 완료 상태를 보장하는가

이 경계를 지키면 `WorldHead`의 control 정보, stimulus의 ingress 의미, projection의 revision
기준을 각각 계약에 선언된 수준으로 이해할 수 있다. 그 이상은 구현·운영 정본이 추가로
제공될 때만 설명할 수 있다.
