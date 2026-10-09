# TypeSpec 기반 Behavior / Runtime Schema 작성 연구

상태: completed  
최종 검토: 2026-10-09  
최종 판정: **Partial adopt (부분 채택)** — TypeSpec을 Behavior Data Schema SSOT로 채택하되, State Transition Topology와 FSM Binding은 독립 Behavior IR / XState setup이 소유  
정본 후보: `docs/guides/typespec-authoring-conventions.md` 부록 반영 및 소비자 프로젝트(WIREFRAME-BOOK, Scene Player)의 독립 schema authoring 가이드로 공급

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

1. **TypeSpec source**:
   - [`test/fixtures/behavior-typespec/scene-player.tsp`](file:///Users/junwoobang/workflow/oa-sdk/test/fixtures/behavior-typespec/scene-player.tsp): Scene Player 도메인 모델 정의
   - [`test/fixtures/behavior-typespec/main.tsp`](file:///Users/junwoobang/workflow/oa-sdk/test/fixtures/behavior-typespec/main.tsp): Behavior 번들 엔트리포인트 (API 번들과 완전 격리)
2. **emitted JSON Schema**:
   - `@typespec/json-schema` 컴파일러를 통한 인메모리 Draft 2020-12 스키마 방출 검증 ([`behavior-typespec-poc.test.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/behavior-typespec-poc.test.ts))
3. **generated TypeScript types & type guards**:
   - [`test/e2e/behavior-typespec/contracts/types.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/contracts/types.ts): `ScenePlayerContext`, `ScenePlayerEvent` 유니온 및 discriminated type guard (`isPlayEvent`, `isPauseEvent`, `isSeekEvent`, `isSelectObjectEvent`, `isScenePlayerEvent`)
4. **Standard Schema v1 어댑터**:
   - [`test/e2e/behavior-typespec/adapters/standard-schema-adapter.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/adapters/standard-schema-adapter.ts): `~standard` 규격 준수, Draft 2020-12 JSON Schema 유효성 검사 어댑터 (`createStandardSchema`)
5. **XState v5 adapter**:
   - [`test/e2e/behavior-typespec/adapters/xstate-v5-machine.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/adapters/xstate-v5-machine.ts): 정적 TypeScript 타입 계약 바인딩 (`createScenePlayerV5Machine()`)
6. **XState v6 adapter**:
   - [`test/e2e/behavior-typespec/adapters/xstate-v6-machine.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/adapters/xstate-v6-machine.ts): 런타임 Standard Schema 및 State-level schemas 바인딩 (`createScenePlayerV6Machine()`)
7. **schema fidelity report & automated test suite**:
   - [`test/e2e/behavior-typespec/behavior-typespec-poc.test.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/behavior-typespec-poc.test.ts): 14/14 테스트 통과 (226ms). 필수/옵셔널, 범위 제약, 이벤트 디스크리미네이션, 런타임 유효성 검사 전 항목 검증 완료.
8. **build/runtime dependency report**:
   - `xstate` 패키지를 oa-sdk 프로덕션 의존성에 추가하지 않고 번들 오염도 0 유지.
   - Standard Schema v1 명세 기반 인터페이스를 통해 런타임 독립성 확보.

---

## 10. 검증 매트릭스

| 항목 | TypeSpec source | JSON Schema (2020-12) | TS type / Guard | XState v5 | XState v6 runtime | PoC 검증 상태 |
|---|---|---|---|---|---|---|
| required/optional | 선언 확인 | `required: [...]` 방출 | 인터페이스 optional (`?`) 반영 | 정적 검사 통과 | 런타임 missing prop 검증 통과 | **PASS** (테스트 2, 7) |
| literal | string literal 선언 | `const` 방출 | 리터럴 타입 반영 | 정적 검사 통과 | 런타임 리터럴 검증 통과 | **PASS** (테스트 2, 4, 8) |
| discriminated event | `type: "PLAY"` 등 선언 | `anyOf` / `oneOf` 방출 | `type` 태그 유니온 가드 | 정적 타입 분기 지원 | 이벤트 페이로드 런타임 검증 | **PASS** (테스트 4, 8) |
| union | `ScenePlayerEvent` | `anyOf` schema | TS Union 타입 | 분기 완벽 지원 | 디스크리미네이터 유효성 검증 | **PASS** (테스트 4, 8) |
| enum/value vocabulary | string literal union | `enum: [...]` 방출 | 타입 유니온 | 정적 검사 통과 | 런타임 검증 통과 | **PASS** (테스트 2, 7) |
| min/max | `@minValue(0)` 등 | `minimum: 0` 방출 | number 타입 | 컴파일 타임 외 별도 | 런타임 음수 에러 검증 통과 | **PASS** (테스트 2, 8, 12) |
| pattern/format | 지원 | 방출 확인 | string 타입 | 컴파일 타임 외 별도 | 런타임 패턴 검증 지원 | **PASS** (테스트 2) |
| recursive/reference | `$ref` 지원 | `#/components/schemas/*` | TS 타입 참조 | 참조 정상 연결 | Ajv components $ref deref 통과 | **PASS** (테스트 2, 8) |
| closed/open object | `@closed` / 기본 | `additionalProperties: false` | TS 인터페이스 | 런타임 외 별도 | 초과 필드 방어 검증 통과 | **PASS** (테스트 7) |
| state input binding | `PlayingStateInput` | 스키마 생성 | 입력 타입 정의 | v5 타입 정의 매핑 | v6 state schema 런타임 검증 | **PASS** (테스트 9, 10) |
| context refinement | `PlayingContextRefinement` | 스키마 생성 | boolean literal `true` | 정적 타입 refinement | 런타임 refinement assertion | **PASS** (테스트 11, 12) |
| state output | `PlayingStateOutput` | 스키마 생성 | 출력 타입 정의 | v5 output 매핑 | v6 output schema 런타임 검증 | **PASS** (테스트 13, 14) |

---

## 11. 채택 판단 기준 및 최종 판정

### 최종 판정: Partial adopt (부분 채택)

> **"TypeSpec을 Behavior / Runtime Data Schema의 단일 진실 공급원(SSOT)으로 채택하되, FSM 전이 그래프(Topology)와 상태 머신 바인딩은 TypeSpec 내부 데코레이터가 아닌 독립 Behavior IR 및 XState setup 코드가 소유한다 (Approach D)."**

#### 1. 채택 근거 (Data Schema SSOT)
- **높은 작성 생산성 및 어휘력**: ActorInput, Context, Event discriminated union, State Input/Output 등의 데이터 형태를 TypeSpec으로 간결하고 명확하게 작성할 수 있음.
- **표준 JSON Schema Draft 2020-12 방출**: `@typespec/json-schema` 표준 에미터만으로 무손실 스키마 방출이 가능하여 추가적인 독점 데코레이터나 커스텀 에미터 유지보수 부담이 없음.
- **XState v5/v6 이중 지원 완벽 실현**:
  - v5: TypeScript 타입 정의(`contracts/types.ts`)로 정적 `setup.types`에 결함 없이 주입됨.
  - v6: Standard Schema v1 어댑터(`standard-schema-adapter.ts`)를 통해 런타임 `setup.schemas` 및 state-level 스키마로 즉시 동작함.
- **안전한 경계 격리**: 기존 HTTP OpenAPI 계약(`packages/schemas/typespec/main.tsp`)과 완전히 분리된 독립 번들/소비자 번들로 운영되어 API 계약 오염이 전혀 없음.

#### 2. 비채택 근거 (Topology/Binding을 TypeSpec에 넣지 않는 이유)
- **과도한 메타데이터 결합**: 상태 전이(State Transition), 가드(Guard), 액션 실행(Action Implementation), 히스토리/병렬 상태(Parallel/History States) 등의 런타임 상태 머신 토폴로지까지 TypeSpec에 넣으려 할 경우 복잡한 비표준 데코레이터(`@behaviorStateTransition`, `@onEvent` 등)가 남발되어 스키마 본연의 가독성이 급격히 저하됨.
- **런타임 프레임워크 종속 방지**: TypeSpec 계약이 XState 버전 변화(v5 → v6)에 직접 노출되지 않고, Standard Schema v1이라는 중립적 런타임 인터페이스를 매개로 느슨한 결합을 유지하는 것이 모노레포 장기 거버넌스상 안전함.

---

## 12. 연구 완료 조건 체크리스트

- [x] Scene Player fixture 작성 ([`test/fixtures/behavior-typespec/scene-player.tsp`](file:///Users/junwoobang/workflow/oa-sdk/test/fixtures/behavior-typespec/scene-player.tsp))
- [x] TypeSpec → JSON Schema 결과 확인 (`@typespec/json-schema` Draft 2020-12 인메모리 컴파일 통과)
- [x] TypeSpec → TypeScript type 결과 확인 ([`test/e2e/behavior-typespec/contracts/types.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/contracts/types.ts))
- [x] v5 `setup.types` adapter 검증 ([`test/e2e/behavior-typespec/adapters/xstate-v5-machine.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/adapters/xstate-v5-machine.ts), 테스트 3~5 통과)
- [x] v6 `setup.schemas` adapter 검증 ([`test/e2e/behavior-typespec/adapters/xstate-v6-machine.ts`](file:///Users/junwoobang/workflow/oa-sdk/test/e2e/behavior-typespec/adapters/xstate-v6-machine.ts), 테스트 6~14 통과)
- [x] state input/context refinement/output 검증 (State-level schemas 및 invariant validation 통과)
- [x] A/B/C/D projection 비용 비교 (Approach D 선정: TypeSpec data shape + 독립 Behavior IR)
- [x] bundle/package ownership 결정안 작성 (API 번들과 완전 분리, 독자 번들 또는 소비자 소유 번들로 배포)
- [x] dependency 및 build impact 기록 (`xstate` 런타임 의존성 추가 없음, Standard Schema v1 기반 제로 런타임 오염)
- [x] schema drift/freshness gate 설계 (`scripts/check-local-diff.ts`, `scripts/check-local-drift.ts` 로컬 스크립트 완비)
- [x] 최종 판정: Partial adopt (부분 채택)
- [x] 채택 시 `typespec-authoring-conventions.md`에 반영할 변경안 작성 (`docs/guides/typespec-authoring-conventions.md` 부록)

---


---

## 예상 소비자: WIREFRAME-BOOK

이 연구의 우선 소비 후보 중 하나는 `mineclover/wireframe-storyboard-toolkit`의 WIREFRAME-BOOK / Framebook Behavior Contract이다.

관련 이슈:

- Behavior / Flow canonical 의미 계층: https://github.com/mineclover/wireframe-storyboard-toolkit/issues/15
- Canvas / Sequence / Timeline / Behavior / Evidence projection 및 runtime lowering 경계: https://github.com/mineclover/wireframe-storyboard-toolkit/issues/17

예상 책임 경계는 다음과 같다.

```text
oa-sdk
  └─ TypeSpec schema authoring / projection toolchain 후보
       │
       │ 공급 가능한 것
       ├─ data schema vocabulary
       ├─ JSON Schema / TypeScript projection
       ├─ runtime-schema adapter/tooling
       └─ schema validation / drift gate
                │
                ▼
WIREFRAME-BOOK
  └─ Storyboard / Behavior Contract 소유
       ├─ Subject / Input / State
       ├─ Transition / Action / Effect
       ├─ state ↔ schema binding
       ├─ authoring projection
       └─ XState runtime lowering
```

중요한 경계:

- WIREFRAME-BOOK의 Behavior 의미·topology·binding 소유권이 oa-sdk로 이동하는 것은 아니다.
- oa-sdk는 **재사용 가능한 schema authoring/projection capability를 공급하는 후보**다.
- WIREFRAME-BOOK은 해당 capability를 소비할 수 있지만, TypeSpec이나 XState에 canonical contract가 종속되어서는 안 된다.
- oa-sdk 연구 결과가 `Reject`여도 WIREFRAME-BOOK Behavior Contract 자체는 유효해야 한다.
- `Adopt` 또는 `Partial adopt` 판정 시 WIREFRAME-BOOK의 실제 소비 경로는 별도 integration/implementation 이슈에서 확정한다.

## 13. 비범위

이번 연구에서 하지 않는다.

- XState state/transition topology 전체를 TypeSpec으로 표현
- XState v6를 production runtime으로 즉시 전환
- 기존 production API TypeSpec bundle 변경
- 기존 OpenAPI 계약 의미 변경
- 새로운 OA SDK decorator의 즉시 채택
- WIREFRAME-BOOK Behavior Contract 구현

결론이 채택된 뒤 별도 구현 이슈에서 다룬다.
