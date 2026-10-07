# TypeSpec 기반 Behavior / Runtime Schema 작성 연구

상태: planned  
최종 검토: 2026-10-07  
정본 후보: 본 문서의 결론이 채택되면 `docs/guides/typespec-authoring-conventions.md` 및 별도 Behavior schema source에 반영

## 1. 목적

oa-sdk의 TypeSpec-first 작성 체계를 HTTP/OpenAPI 계약뿐 아니라 **Behavior / runtime schema 작성**에도 사용할 수 있는지 검토한다.

이번 연구의 직접 사용 사례는 XState 온보딩·저작 컨벤션이다. 런타임은 당분간 XState v5를 사용하되, 작성 모델은 XState v6의 `schemas` 및 state-level schema까지 수용할 수 있어야 한다.

핵심 질문은 다음과 같다.

> TypeSpec을 Behavior 계약의 사람이 작성하는 schema source로 두고, XState v5의 타입 계약과 XState v6의 Standard Schema/runtime validation 계약으로 안전하게 projection할 수 있는가?

이 문서는 **도입 결정 문서가 아니다.** 기존 production API TypeSpec 정본의 범위를 즉시 확장하지 않으며, 연구 결과와 PoC 증거를 기준으로 후속 컨벤션 변경 여부를 판단한다.

---

## 2. 현재 oa-sdk 기준선

현재 oa-sdk는 이미 TypeSpec-first production API 계약 체계를 사용한다.

- 사람이 작성하는 production API 계약 정본: `packages/schemas/typespec/**/*.tsp`
- 검토 baseline: `packages/schemas/typespec/approved.openapi.yaml`
- 기본 projection: TypeSpec → OpenAPI 3.2 → parser/codegen/router/client/mock downstream
- 작성 규칙: `docs/guides/typespec-authoring-conventions.md`
- 전환 결정: `docs/internal/architecture/009-typespec-first-authoring.md`
- OA SDK 전용 의미는 `@oa-sdk/typespec-decorators`의 좁고 버전된 decorator/extension으로 관리

따라서 이번 연구는 **TypeSpec 도입 여부**가 아니라 다음 경계 확장 여부를 판단한다.

```text
현재
TypeSpec
  └─ HTTP / OpenAPI Contract
       └─ OpenAPI 3.2
            └─ oa-sdk downstream

후보
TypeSpec
  ├─ HTTP / OpenAPI Contract
  │    └─ OpenAPI projection
  │
  └─ Behavior / Runtime Schema
       ├─ JSON Schema projection
       ├─ TypeScript type projection
       └─ XState runtime-schema projection
```

HTTP 계약과 Behavior schema는 같은 TypeSpec 도구를 사용할 수 있어도 **동일한 소유 범위라고 가정하지 않는다.**

---

## 3. 외부 기술 기준

### 3.1 TypeSpec

TypeSpec 자체는 model, optional property, template, union, enum, scalar constraint 등을 이용해 데이터 구조를 선언할 수 있다.

- Models: https://typespec.io/docs/language-basics/models/
- Unions: https://typespec.io/docs/language-basics/unions/
- JSON Schema emitter: https://typespec.io/docs/emitters/json-schema/reference/
- Emitter 작성: https://typespec.io/docs/extending-typespec/emitters-basics/

공식 `@typespec/json-schema` emitter는 TypeSpec model을 JSON Schema로 투영할 수 있고, `emitAllModels`, bundled `$defs`, discriminator strategy 등의 옵션을 제공한다.

또한 TypeSpec은 custom emitter를 통해 TypeScript 등 별도 산출물을 생성할 수 있다.

### 3.2 XState v5 → v6

XState v6는 현재 alpha이며 API 변경 가능성이 있다.

- setup / schemas: https://stately.ai/docs/xstate/v6/setup-and-provide
- State input: https://stately.ai/docs/xstate/v6/state-input
- TypeScript/schema model: https://dev.stately.ai/docs/xstate/v6/typescript

v6에서는 `setup({ schemas: ... })`가 root-level context/events/input/output뿐 아니라 state-level input/context/output 계약을 받을 수 있다. runtime validation은 Standard Schema 호환 schema를 통해 수행한다.

따라서 **TypeSpec → JSON Schema만으로 XState v6에 바로 연결된다고 가정하면 안 된다.** XState runtime에 전달할 Standard Schema object 또는 그에 상응하는 runtime validator adapter가 추가로 필요하다.

---

## 4. 목표 Authoring Model

연구 대상 Behavior schema의 최소 vocabulary는 다음과 같다.

```text
BehaviorSchema
├─ ActorInput
├─ Context
├─ Event
│   ├─ external
│   └─ internal
├─ ActorOutput
├─ EmittedEvent
│
├─ StateContract
│   ├─ StateInput
│   ├─ ContextRefinement
│   └─ StateOutput
│
└─ SourceContract
    ├─ ActionParams
    ├─ GuardParams
    ├─ ActorInput / Output
    └─ DelayParams
```

XState 문법 자체를 정본으로 저장하지 않는다.

예를 들어 아래 의미를 정본으로 둔다.

```text
Event: SEEK
  time: number

State: Playing
  input:
    animationId: string
    startTime: number

Action: playAnimation
  params:
    animationId: string
    speed: number
```

그 뒤 버전별 adapter가 XState v5/v6 표현으로 내린다.

---

## 5. 검토할 TypeSpec 표현

PoC에서는 최소 다음 의미가 TypeSpec에서 손실 없이 작성·투영되는지 확인한다.

### 5.1 기본 모델

```typespec
namespace Behavior;

model ScenePlayerInput {
  sceneId: string;
  autoplay?: boolean;
}

model PlayerContext {
  sceneId: string;
  currentTime: float64;
  playing: boolean;
}
```

검증 항목:

- required / optional
- default
- string/number/boolean
- array / record
- nested model
- reusable named model
- model extension/composition

### 5.2 Event vocabulary

XState event는 `type` literal로 식별되는 discriminated message로 다루는 것이 일반적이므로 다음 표현의 안정성을 검토한다.

```typespec
model PlayEvent {
  type: "PLAY";
}

model SeekEvent {
  type: "SEEK";
  time: float64;
}

union PlayerEvent {
  play: PlayEvent,
  seek: SeekEvent,
}
```

검증 항목:

- literal discriminator 보존
- union → JSON Schema `oneOf`/적절한 분기 표현
- XState v5 discriminated union TypeScript 생성 가능 여부
- XState v6 `events: { PLAY: schema, SEEK: schema }` registry 생성 가능 여부
- event 이름과 model 이름을 별도 관리해야 하는지 여부

### 5.3 State contract

TypeSpec이 state 자체를 상태 머신으로 표현해야 하는 것은 아니다. 이번 연구에서는 **state의 데이터 계약**을 표현하는 역할만 우선 검토한다.

예시 후보:

```typespec
model PlayingStateInput {
  animationId: string;
  startTime: float64;
}

model PlayingContextRefinement {
  playing: true;
}

model PlayingStateOutput {
  completedAt: float64;
}
```

State ID ↔ schema 연결은 별도 manifest/decorator/Behavior IR 중 어디가 소유해야 하는지 비교한다.

---

## 6. Projection 후보

### A. TypeSpec → JSON Schema → Standard Schema adapter

```text
TypeSpec
  ↓ @typespec/json-schema
JSON Schema
  ↓ runtime adapter / validator
Standard Schema
  ↓
XState v6
```

검토 포인트:

- 가장 표준적인 중간 표현
- JSON Schema validator를 runtime에 추가해야 함
- Standard Schema interface를 직접 만족하는 adapter가 필요한지 확인
- bundle/reference resolution 및 startup cost 확인

### B. TypeSpec → JSON Schema → Zod generation

```text
TypeSpec
  ↓
JSON Schema
  ↓ generated
Zod
  ↓
XState v6 Standard Schema
```

검토 포인트:

- XState 문서 예제와 가까움
- JSON Schema → Zod 변환에서 의미 손실 가능성
- generated code freshness/drift gate 필요
- Zod를 oa-sdk 공개 계약에 강제할지 여부

### C. TypeSpec → custom emitter → Standard Schema/Zod

```text
TypeSpec
  ↓ custom oa-sdk emitter
TypeScript runtime schemas
  ↓
XState v6
```

검토 포인트:

- 가장 직접적인 lowering 가능
- TypeSpec emitter framework/API에 대한 유지보수 비용
- emitter framework의 experimental 부분 의존 여부
- oa-sdk가 XState 전용 생성기를 소유하게 되는 결합도

### D. TypeSpec은 data schema만 소유하고 Behavior registry는 별도 IR

```text
TypeSpec                     Behavior IR
  └─ data shape                 ├─ event registry
       │                        ├─ state ↔ schema binding
       └──────── reference ─────┤
                                └─ source registry
```

이 구조는 TypeSpec이 잘하는 **data shape 정의**와 상태 머신의 **topology/behavior semantics**를 분리한다.

현재 기준으로는 이 후보를 우선 비교 대상으로 둔다. TypeSpec에 state transition/action semantics까지 억지로 넣는 것은 이번 연구 범위가 아니다.

---

## 7. v5 / v6 Projection 요구사항

### XState v5

최소 목표:

```text
TypeSpec
  ↓
generated TypeScript types
  ↓
setup({
  types: {
    input,
    context,
    events,
    output
  }
})
```

확인할 것:

- generated type import UX
- event discriminated union
- Action/Guard params 타입 연결
- source registry와 generated types의 연결 방식

### XState v6

최소 목표:

```text
TypeSpec
  ↓
runtime schema projection
  ↓
setup({
  schemas: {
    input,
    context,
    events,
    output
  },
  states: {
    playing: {
      schemas: {
        input,
        context,
        output
      }
    }
  }
})
```

확인할 것:

- Standard Schema runtime object 생성
- root schemas
- event map
- state input
- state context refinement
- state output
- runtime validation
- schema transformation이 아닌 assertion-only validation 제약

---

## 8. oa-sdk 경계에서 반드시 판단할 사항

### 8.1 API TypeSpec bundle과 분리

현재 `packages/schemas/typespec/main.tsp`는 OA SDK production HTTP API 계약 정본이다.

Behavior 연구용 model을 기존 main bundle에 import해서는 안 된다. 연구 단계에서는 다음 중 하나를 비교한다.

1. `packages/schemas/typespec-behavior/` 같은 별도 bundle
2. 별도 package
3. 소비 프로젝트가 own TypeSpec bundle을 갖고 oa-sdk emitter/toolchain만 사용

판단 기준:

- HTTP/OpenAPI artifact 오염 여부
- 독립 versioning 가능 여부
- bundle별 validation/gate 가능 여부
- downstream dependency 방향
- 다른 프로젝트에서 재사용 가능한가

### 8.2 기존 `@oa-sdk/typespec-decorators` 확장 여부

기본 TypeSpec 문법과 JSON Schema emitter만으로 표현 가능한 데이터 의미에는 새 OA SDK decorator를 추가하지 않는다.

추가 decorator가 필요하다면 예를 들어 다음 수준만 후보가 될 수 있다.

```text
@behaviorEvent("SEEK")
@behaviorStateInput("playing")
@behaviorActionParams("playAnimation")
```

그러나 이런 binding metadata를 TypeSpec이 소유해야 하는지, 별도 Behavior IR/manifest가 소유해야 하는지 먼저 비교한다.

### 8.3 OpenAPI를 중간 IR로 강제하지 않기

Behavior schema는 HTTP API가 아니므로 다음 경로를 기본 전제로 삼지 않는다.

```text
TypeSpec → OpenAPI → Behavior Schema
```

가능하면:

```text
TypeSpec → JSON Schema / TypeSpec semantic graph → Runtime Schema
```

를 우선 검토한다.

---

## 9. PoC 범위

대표 fixture 하나를 만든다.

### Fixture: Scene Player

포함할 계약:

- ActorInput: `sceneId`, `autoplay`
- Context: `sceneId`, `currentTime`, `playing`, optional `selectedObjectId`
- Events:
  - `PLAY`
  - `PAUSE`
  - `SEEK { time }`
  - `SELECT_OBJECT { objectId }`
- StateInput:
  - `playing { animationId, startTime }`
- StateContextRefinement:
  - `playing: true`
- StateOutput:
  - `completedAt`
- ActionParams:
  - `playAnimation { animationId, speed }`

### PoC 산출물

1. TypeSpec source
2. emitted JSON Schema
3. generated TypeScript types
4. XState v5 adapter 예제
5. XState v6 adapter 예제
6. schema fidelity report
7. build/runtime dependency report

---

## 10. 검증 매트릭스

| 항목 | TypeSpec source | JSON Schema | TS type | XState v5 | XState v6 runtime |
|---|---|---|---|---|---|
| required/optional | 확인 | 확인 | 확인 | 확인 | 확인 |
| literal | 확인 | 확인 | 확인 | 확인 | 확인 |
| discriminated event | 확인 | 확인 | 확인 | 확인 | 확인 |
| union | 확인 | 확인 | 확인 | 확인 | 확인 |
| enum/value vocabulary | 확인 | 확인 | 확인 | 확인 | 확인 |
| min/max | 확인 | 확인 | 확인 | 타입 외 검증 별도 | runtime 확인 |
| pattern/format | 확인 | 확인 | 타입 외 검증 별도 | 별도 | runtime 확인 |
| recursive/reference | 확인 | 확인 | 확인 | 확인 | runtime 확인 |
| closed/open object | 확인 | 확인 | 확인 | 타입 한계 기록 | runtime 확인 |
| state input binding | 별도 binding 필요 여부 | N/A | 확인 | adapter | 확인 |
| context refinement | 표현 방식 확인 | 확인 | 확인 | compile-time only | runtime 확인 |

---

## 11. 채택 판단 기준

### 채택 가능

다음을 모두 만족하면 TypeSpec을 Behavior schema source 후보로 채택할 수 있다.

- Behavior data shape가 TypeSpec에서 자연스럽게 작성된다.
- HTTP/OpenAPI bundle과 독립적인 소유 경계를 유지할 수 있다.
- v5에서 안정적인 TypeScript type projection이 가능하다.
- v6에서 Standard Schema runtime validation까지 재현 가능하다.
- event discriminant, state input, context refinement의 의미 손실이 없다.
- 생성 artifact freshness/drift를 자동 검증할 수 있다.
- XState 버전 문법을 TypeSpec 정본에 직접 박지 않아도 된다.

### 부분 채택

다음 경우에는 TypeSpec을 **data schema 전용 SSOT**로만 사용한다.

- data shape는 안정적이지만 state/action/event registry binding까지 TypeSpec에 넣으면 결합도가 높아진다.
- 별도 Behavior IR가 topology와 binding을 소유하는 편이 명확하다.

### 기각

다음 경우에는 TypeSpec을 XState runtime schema source로 사용하지 않는다.

- Standard Schema lowering이 복잡하거나 의미 손실이 크다.
- JSON Schema/Zod/codegen chain이 runtime schema를 직접 작성하는 것보다 운영 비용이 높다.
- XState v6 alpha 변화에 emitter가 과도하게 종속된다.
- current oa-sdk schema governance를 HTTP 외 영역으로 확장하면서 책임 경계가 불명확해진다.

---

## 12. 연구 완료 조건

연구 완료는 구현 완료와 다르다.

다음 증거가 모두 있어야 연구를 닫는다.

- [ ] Scene Player fixture 작성
- [ ] TypeSpec → JSON Schema 결과 확인
- [ ] TypeSpec → TypeScript type 결과 확인
- [ ] v5 `setup.types` adapter 검증
- [ ] v6 `setup.schemas` adapter 검증
- [ ] state input/context refinement/output 검증
- [ ] A/B/C/D projection 비용 비교
- [ ] bundle/package ownership 결정안 작성
- [ ] dependency 및 build impact 기록
- [ ] schema drift/freshness gate 설계
- [ ] 최종 판정: 채택 / 부분 채택 / 기각
- [ ] 채택 시 `typespec-authoring-conventions.md`에 반영할 변경안 작성

---

## 13. 비범위

이번 연구에서 하지 않는다.

- XState state/transition topology 전체를 TypeSpec으로 표현
- XState v6를 production runtime으로 즉시 전환
- 기존 production API TypeSpec bundle 변경
- 기존 OpenAPI 계약 의미 변경
- 새로운 OA SDK decorator의 즉시 채택
- WIREFRAME-BOOK Behavior Contract 구현

결론이 채택된 뒤 별도 구현 이슈에서 다룬다.
