# 유저 시나리오 주제 단위 화면 네비게이션 & BEHAVIOR FSM 엔진 가이드

이 문서는 복잡한 웹 대시보드 및 API 도구 생태계에서 화면 간 이동 경로(Navigation Paths)를 무분별하게 나열하여 발생하는 **상태 공간 폭발(State Explosion)**을 방지하고, **유저 시나리오 주제(User Scenario Topics)** 단위로 Bounded Context를 형성하여 유한 상태 기계(FSM) 및 행동(BEHAVIOR) 흐름을 정형화하는 아키텍처 및 구현 표준을 정의합니다.

---

## 1. 아키텍처 배경 및 해결 과제

### 1.1 평면적 화면 전이 모델의 한계
전통적인 SPA 프론트엔드 라우팅 및 단순 상태 머신은 화면 뷰 집합($V$)과 이벤트/버튼 액션($A$)을 단일 평면 그래프로 다룹니다:
* 화면 수가 증가할수록 잠재적 전이 경로가 $O(|V| \times |A|)$로 폭발합니다.
* 사용자가 **어떤 목적(JTBD: Jobs To Be Done)**을 가지고 특정 화면에 도달했는지에 대한 맥락이 상실되어, 필수 데이터(예: Diff 비교를 위한 base/head 파라미터)가 누락된 채 진입하는 오류가 런타임에 빈번하게 발생합니다.
* 전체 전이 흐름을 나열(Enumeration)하더라도 수백 개의 간선이 얽힌 스파게티 다이어그램이 되어 유저 여정(User Journey)의 완결성을 정적으로 검증할 수 없습니다.

### 1.2 해결책: 유저 시나리오 주제 단위 개념 추상화 (Thematic Scenario Abstraction)
* **목표 지향적 격리 (Bounded View Subgraph)**: 전체 화면 뷰 중 해당 유저 시나리오의 목적 달성에 필요한 화면들만 서브그래프로 선언합니다.
* **행동 계약 (BEHAVIOR Contract)**: 단순 클릭 이벤트(`onClick`)가 아닌 도메인 의도가 명시된 `LensBehaviorAction`(`REQUEST_DIFF`, `INSPECT_ENDPOINT_PROVENANCE`, `HIGHLIGHT_DEPENDENCY_CYCLE` 등)을 디스패치합니다.
* **결정론적 경로 수집기 (Flow Enumerator)**: 빌드 타임 및 런타임에 시나리오별 유효 전이 행렬(Transition Matrix), 미완료 고아 뷰(Dead Ends), 목표 도달 경로(Terminal Paths)를 100% 정적 분석하고 Mermaid/DOT 다이어그램으로 시각화합니다.

---

## 2. 3계층 아키텍처 모델 (3-Tier Model)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Tier 1: Scenario Domain Abstraction (주제 단위 개념 추상화)                 │
│  - ScenarioTopicDefinition (id, title, persona, initialView, boundedViews)  │
│  - ScenarioRegistry: 시나리오 카탈로그 및 동적 등록 관리                   │
│  - Terminal Goals: 완료 조건 명시 (drift-resolved, impact-assessed 등)      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ compiles / enforces
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Tier 2: Hierarchical FSM & Action (BEHAVIOR) Engine (전이 및 흐름 수집)    │
│  - scenarioTransitionReducer: 순수 FSM 리듀서 (순수 TypeScript)             │
│  - ScenarioFlowEnumerator: DFS/BFS 기반 도달 가능성 및 전이 행렬 수집       │
│  - ScenarioBreadcrumbs: 단순 브라우저 뒤로가기를 넘어선 시나리오 스텝백     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ typed by / executed in
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Tier 3: Context-Action Runtime & Schema Contracts (실행 및 화면 연동)      │
│  - @oa-sdk/spec-lens-contract: 순수 FSM 엔진 및 타입 계약                   │
│  - apps/spec-lens/src/scenario/: Context-Action 패턴 React 컴포넌트         │
│  - ScenarioProgressHUD, ScenarioSelector, ScenarioFlowModal                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 4대 표준 시나리오 주제 정의

Spec-Lens 대시보드는 다음 4가지 핵심 시나리오 주제를 기본 내장합니다:

| 시나리오 ID | 시나리오 명칭 | 페르소나 | 초기 뷰 | 제한 뷰 서브그래프 | 완료 목표 (Terminal Goal) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `spec-drift-triage` | 스펙 드리프트 감지 및 원인 규명 | `ApiArchitect` | `timeline` | `timeline` $\to$ `diff` $\to$ `paths` | 드리프트 발생 원인 단편 및 책임 커밋 식별 완료 (`drift-resolved`) |
| `endpoint-exploration` | 엔드포인트 및 타입 계약 탐색 | `ApiConsumer` | `paths` | `paths` $\to$ `graph` | 엔드포인트 입출력 DTO 및 스키마 의존성 검증 완료 (`contract-verified`) |
| `breaking-impact-analysis` | 스키마 변경 파급 효과 분석 | `ReleaseManager` | `timeline` | `timeline` $\to$ `diff` $\to$ `graph` | 파괴적 변경 영향 도메인 그래프 분석 완료 (`impact-assessed`) |
| `circular-ref-diagnostic` | 순환 참조 및 고아 스키마 진단 | `SpecAuthor` | `graph` | `graph` $\to$ `paths` | 순환 참조 의존 경로 및 책임 스키마 파일 격리 완료 (`cycle-isolated`) |

---

## 4. 핵심 구현 컴포넌트

### 4.1 순수 FSM 전이 리듀서 (`stateMachine.ts`)
```typescript
import {
  type LensBehaviorAction,
  type ScenarioMachineContext,
  type ScenarioTransitionResult,
  ScenarioRegistry,
} from '@oa-sdk/spec-lens-contract'

export function scenarioTransitionReducer(
  state: ScenarioMachineContext,
  action: LensBehaviorAction,
  registry: ScenarioRegistry = new ScenarioRegistry(),
): ScenarioTransitionResult {
  // 1. START_SCENARIO / SWITCH_SCENARIO / STEP_BACK
  // 2. 가드(Guards) 평가 (미충족 시 에러 반환 및 전이 차단)
  // 3. 브레드크럼(Breadcrumbs) 감사 추적 기록
  // 4. 컨텍스트 변환(TransformContext) 및 차기 뷰 전이
}
```

### 4.2 정적 경로 및 흐름 수집기 (`flowEnumerator.ts`)
`ScenarioFlowEnumerator`는 선언된 시나리오 규칙을 분석하여 빌드 타임 및 런타임에 다이어그램과 전이 행렬을 생성합니다:
```typescript
import { ScenarioFlowEnumerator, SPEC_DRIFT_TRIAGE_SCENARIO } from '@oa-sdk/spec-lens-contract'

// 1. 도달 가능성 및 미완료 고아 뷰 검사
const analysis = ScenarioFlowEnumerator.enumerate(SPEC_DRIFT_TRIAGE_SCENARIO)
console.log(analysis.deadEnds) // [] (안전: 고아 상태 없음)
console.log(analysis.terminalPaths.length) // 최소 1개 이상의 완료 경로 보장

// 2. Mermaid stateDiagram-v2 추출
const mermaid = ScenarioFlowEnumerator.toMermaidStateDiagram(SPEC_DRIFT_TRIAGE_SCENARIO)
```

#### 생성되는 Mermaid 흐름도 예시:
```mermaid
stateDiagram-v2
    [*] --> timeline: START_SCENARIO ("spec-drift-triage")
    timeline --> diff: REQUEST_DIFF [require-diff-pair]
    diff --> paths: INSPECT_ENDPOINT_PROVENANCE [require-path-pattern]
    paths --> paths: COMPLETE_GOAL
    paths --> diff: REQUEST_DIFF [require-diff-pair]
    diff --> timeline: SELECT_REVISION
    paths --> [*]: COMPLETE_GOAL (drift-resolved)
```

---

## 5. UI 계층 연동 (Context-Action Architecture)

`apps/spec-lens/src/scenario/`에 구현된 Context-Action 레이어는 기존 자유 탐색(Free Exploration) 모드와 완벽하게 하이브리드로 동작합니다:

1. **`ScenarioSelector`**:
   - 사이드바 상단에서 사용자가 `🌐 자유 탐색` 또는 `🎯 시나리오 주제`를 드롭다운으로 선택합니다.
2. **`ScenarioProgressHUD`**:
   - 시나리오가 활성화되면 메인 화면 최상단에 페르소나 뱃지, 현재 단계(Step N), 목표 달성 CTA 버튼, 이전 단계 복귀(Step Back), 흐름도 보기 버튼이 노출됩니다.
3. **`ScenarioFlowModal`**:
   - 사용자가 언제든지 클릭하여 현재 시나리오의 전체 FSM 전이 행렬과 Mermaid 다이어그램을 조회하고, 현재 위치한 뷰를 하이라이트로 확인할 수 있습니다.
4. **URL 동기화 (`useUrlState.ts`)**:
   - `?scenario=spec-drift-triage` 쿼리 파라미터와 양방향 동기화되어 새로고침 및 딥링크가 완벽히 보존됩니다.

---

## 6. 검증 및 품질 보장

* **100% 경로 커버리지 테스트**: `packages/spec-lens-contract/src/scenario.test.ts`
  - 4대 표준 시나리오의 도달 가능성 및 고아 뷰(0 Dead Ends) 검증.
  - 가드 실패 시 전이 거절 및 컨텍스트 보존 검증.
  - 브레드크럼 스택 기반 `STEP_BACK` 및 시나리오 간 `SWITCH_SCENARIO` 핸드오프 검증.
* **UI 통합 테스트**: `apps/spec-lens/src/scenario/scenario.test.tsx`
  - 기본 모드와 시나리오 활성화 모드의 정적 마크업 및 모달 렌더링 검증.
