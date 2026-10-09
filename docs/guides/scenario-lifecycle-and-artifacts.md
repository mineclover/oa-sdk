# 시나리오 라이프사이클, 아티팩트 및 프리뷰어 거버넌스 가이드 (Scenario Lifecycle, Artifacts & Previewer Governance)

이 문서는 oa-sdk 생태계에서 유저 시나리오를 유한 상태 기계(FSM)와 행동(BEHAVIOR) 흐름으로 정형화하고, 이를 운영·검증·시각화하기 위한 **5단계 시나리오 라이프사이클**, **Scenario CLI 명령 체계**, **정형 아티팩트 규격**, 그리고 **듀얼 프리뷰어(터미널 ASCII & 웹 UI)** 운영 표준을 정의합니다.

상위 개념 아키텍처 및 FSM 수식 모델은 [유저 시나리오 주제 단위 화면 네비게이션 & BEHAVIOR FSM 엔진 가이드](./scenario-navigation-fsm-engine.md)를 참조하십시오.

---

## 1. 아키텍처 개요 및 설계 철학

복잡한 대시보드(Spec-Lens)와 엔지니어링 도구에서 화면 이동(Navigation)을 무제약한 링크 이동에 맡기면, 사용자 작업 맥락(Context)이 유실되고 필수 데이터가 누락된 채 진입하는 런타임 결함이 발생합니다.

oa-sdk 시나리오 거버넌스는 다음 3대 설계 철학을 따릅니다:

1. **단일 진실 공급원 (Single Source of Truth, SSOT)**:
   - 시나리오의 구조, 페르소나, 목표, 전이 규칙, 가드는 TypeSpec 데이터 계약(`@oa-sdk/typespec-decorators/behavior`) 및 `@oa-sdk/spec-lens-contract`에만 선언합니다.
2. **0-Dead-End 및 결정론적 도달 가능성 보장 (Deterministic Reachability)**:
   - 모든 유저 시나리오는 초기 뷰(Initial View)로부터 최소 1개 이상의 완료 목표(Terminal Goal)에 도달하는 유효 경로를 가져야 하며, 빠져나올 수 없는 고아 뷰(Dead End)가 전혀 없어야 합니다.
3. **관측 가능성 및 아티팩트 자동화 (Observability & Automated Artifacts)**:
   - 선언된 시나리오 FSM은 빌드 타임에 정적 분석되어 터미널 ASCII 다이어그램, Mermaid 상태 다이어그램, Graphviz DOT, JSON 전이 행렬 아티팩트로 자동 방출됩니다.

### 1.2 4대 아키텍처 평가 차원 및 정당성 근거

| 평가 차원 | 핵심 정당성 근거 (Why) | 실증 구현 장치 (How) |
| :--- | :--- | :--- |
| **1. 직관성 (Intuitiveness)** | 평면적인 화면 나열을 제거하고 작업 목적(JTBD) 기반으로 진입하도록 유도하여 인지 부하 대폭 감소 | `ScenarioSelector`, `ScenarioProgressHUD`(Step N, 목표), `Rule of 5`(화면 $\le 5$) |
| **2. 관리 가능성 (Maintainability)** | 전체 화면-액션의 데카르트 곱 $O(\|V\| \times \|A\|)$ 상태 폭발을 서브그래프로 원천 차단 | Bounded Subgraph 격리, SSOT 기반 리듀서/CLI 자동 동기화, CI 0 Dead-Ends 게이트 |
| **3. 투명 관제성 (Observability)** | 사용자의 여정, 가드 실패 원인, 공유 링크 재현을 실시간 감사 가능하게 유지 | `breadcrumbs` 불변 스택(Provenance), 명시적 가드 에러 피드백, URL 딥링크 동기화 |
| **4. 고유식별자 관리 (Identifiers)** | 임의 문자열 하드코딩을 배제하고 모든 구성 요소를 엄격한 정형 ID로 통제 | 7계층 Canonical ID (`scenarioId`, `viewId`, `persona`, `actionType`, `guardId`, `goalId`, `stepSequence`) |

---

## 2. 5단계 시나리오 라이프사이클 (5-Stage Scenario Lifecycle)

유저 시나리오는 선언부터 CI 검증까지 엄격한 5단계 라이프사이클을 거쳐 거버넌스됩니다:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage 1. 선언 (Declaration)                                                 │
│   • TypeSpec behavior 데코레이터 및 ScenarioTopicDefinition 작성             │
│   • Bounded Context 격리 (Rule of 5: boundedViews <= 5)                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage 2. 정적 컴파일 및 도달성 분석 (Static Compilation & Reachability)      │
│   • ScenarioFlowEnumerator 정적 그래프 분석 (DFS/BFS)                        │
│   • 0 Dead-Ends, Terminal Paths, Reachable Views 행렬 도출                   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage 3. 런타임 실행 및 가드 보호 (Runtime Execution & Guard Protection)    │
│   • scenarioTransitionReducer 순수 FSM 리듀서 실행                           │
│   • Guard 불만족 시 안전 거절 및 브레드크럼 감사 추적 (Audit Trail)          │
│   • useUrlState를 통한 ?scenario=<id> 딥링크 동기화                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage 4. 시나리오 간 핸드오프 (Cross-Scenario Hand-off)                      │
│   • SWITCH_SCENARIO 액션을 통한 페르소나 및 공유 컨텍스트 인계              │
│   • 이전 시나리오 완료 상태(isCompleted) 보존 및 원활한 여정 연결            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage 5. CI 검증 및 무결성 게이트 (CI Verification & Build Gate)             │
│   • spec-lens scenario verify 명령을 통한 회귀 방지                         │
│   • 고아 뷰 탐지 또는 도달 불가 시 빌드 즉시 실패 (Exit Code 1)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Stage 1: 선언 (Declaration)
- TypeSpec 파일(`packages/spec-lens-contract/src/scenario/scenario.tsp`) 또는 TypeScript 계약 모듈에 시나리오 주제를 선언합니다.
- 각 시나리오는 고유한 ID, 명칭, 설명, 담당 페르소나(`persona`), 초기 뷰(`initialView`), 제한 뷰 집합(`boundedViews`), 완료 목표(`terminalGoals`), 그리고 전이 규칙(`transitions`)을 포함합니다.

### Stage 2: 정적 컴파일 및 도달성 분석 (Static Compilation & Reachability)
- `ScenarioFlowEnumerator.enumerate(scenario)`를 호출하여 시나리오 그래프를 빌드 타임에 검사합니다.
- 선언된 모든 제한 뷰가 실제로 도달 가능한지(`reachableViews === boundedViews`), 목표에 도달하지 못하고 갇히는 고아 뷰가 없는지(`deadEnds.length === 0`), 최소 1개 이상의 터미널 패스가 존재하는지 정적으로 증명합니다.

### Stage 3: 런타임 실행 및 가드 보호 (Runtime Execution & Guard Protection)
- 사용자가 Spec-Lens 대시보드에서 행동(Action)을 트리거하면 순수 FSM 리듀서(`scenarioTransitionReducer`)가 동작합니다.
- 전이 규칙에 등록된 가드(`require-diff-pair`, `require-path-pattern` 등)가 컨텍스트 데이터를 검증하며, 가드 미충족 시 상태 변경을 차단하고 상세 사유를 사용자에게 안내합니다.
- 모든 성공적인 전이는 `breadcrumbs` 스택에 기록되어 무손실 뒤로가기(`STEP_BACK`)를 지원합니다.

### Stage 4: 시나리오 간 핸드오프 (Cross-Scenario Hand-off)
- 한 시나리오(예: `spec-drift-triage`)의 목표를 완료한 후 관련된 후속 시나리오(예: `breaking-impact-analysis`)로 즉시 컨텍스트를 인계할 수 있습니다.
- `SWITCH_SCENARIO` 액션은 기존 시나리오의 완료 이력을 보존하면서 차기 시나리오의 초기 뷰와 페르소나로 매끄럽게 전환합니다.

### Stage 5: CI 검증 및 무결성 게이트 (CI Verification & Build Gate)
- 지속적 통합(CI) 환경에서 `spec-lens scenario verify`를 수행합니다.
- 임의의 PR이 전이 규칙이나 뷰 정의를 변경하여 도달성 깨짐, 가드 모순, 고아 뷰가 발생하면 즉시 빌드가 차단(Fail-Closed)됩니다.

---

## 3. Scenario CLI 명령 체계

`@oa-sdk/spec-lens` 패키지는 시나리오 FSM을 조작하고 검증하기 위한 일급 CLI 서브커맨드(`scenario`)를 제공합니다:

```bash
# 기본 사용법 (저장소 내 직접 실행)
pnpm exec tsx packages/spec-lens/src/cli.ts scenario <command> [options]

# 또는 CLI 바이너리 환경
spec-lens scenario <command> [options]
```

### 3.1 `list` (등록된 시나리오 목록 조회)
등록된 모든 유저 시나리오의 메타데이터, 담당 페르소나, 초기 뷰, 도달성 요약 통계를 출력합니다:

```bash
pnpm exec tsx packages/spec-lens/src/cli.ts scenario list
```

**출력 예시:**
```text
Registered User Scenarios (4):

  spec-drift-triage — 스펙 드리프트 감지 및 원인 규명
    Persona: ApiArchitect | Initial: timeline | Views: [timeline, diff, paths]
    Terminal Goals: drift-resolved
    Reachability: 3 views reachable | 2 goal paths | 0 Dead-Ends

  endpoint-exploration — 엔드포인트 및 타입 계약 탐색
    Persona: ApiConsumer | Initial: paths | Views: [paths, graph]
    Terminal Goals: contract-verified
    Reachability: 2 views reachable | 1 goal paths | 0 Dead-Ends
```

### 3.2 `inspect <id>` (시나리오 심층 검사)
특정 시나리오의 상세 속성, 정적 도달성 분석 결과, 전이 행렬(Transition Matrix) 테이블을 출력합니다:

```bash
pnpm exec tsx packages/spec-lens/src/cli.ts scenario inspect spec-drift-triage
```

**출력 예시:**
```text
Scenario Inspection: 스펙 드리프트 감지 및 원인 규명 (spec-drift-triage)
저장소 커밋 이력에서 발생한 스키마 드리프트를 탐지하고, 변경 diff를 대조하여 원인이 된 엔드포인트 단편을 격리합니다.

  Persona:      ApiArchitect
  Initial View: timeline
  Bounded Views:[timeline, diff, paths]
  Reachable:    [timeline, diff, paths]
  Dead Ends:    None (100% Safe)
  Terminal Paths:2 paths to goal

Transition Matrix (5 rules):
┌───────────────┬───────────────────────────────┬───────────────┬──────────────────────┬───────────┐
│ From View     │ Action (BEHAVIOR)             │ To View       │ Guard IDs            │ Status    │
├───────────────┼───────────────────────────────┼───────────────┼──────────────────────┼───────────┤
│ timeline      │ REQUEST_DIFF                  │ diff          │ require-diff-pair    │ Transition│
│ diff          │ INSPECT_ENDPOINT_PROVENANCE   │ paths         │ require-path-pattern │ Transition│
│ paths         │ COMPLETE_GOAL                 │ paths         │ None                 │ Goal reached
│ paths         │ REQUEST_DIFF                  │ diff          │ require-diff-pair    │ Transition│
│ diff          │ SELECT_REVISION               │ timeline      │ None                 │ Transition│
└───────────────┴───────────────────────────────┴───────────────┴──────────────────────┴───────────┘
```

### 3.3 `preview <id>` (터미널 ASCII 플로우 프리뷰)
시나리오의 주요 목표 도달 여정(Happy Path)을 터미널 상에서 직관적인 ASCII/ANSI 다이어그램으로 시각화합니다:

```bash
pnpm exec tsx packages/spec-lens/src/cli.ts scenario preview endpoint-exploration
```

**출력 예시:**
```text
================================================================
Terminal Flow Preview: 엔드포인트 및 타입 계약 탐색 (endpoint-exploration)
Persona: ApiConsumer | Start: [paths]
================================================================

  ┌─────────────────────────────┐
  │  ● START                    │
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │  View: paths                │
  └──────────────┬──────────────┘
                 │ VIEW_SCHEMA_DEPENDENCIES [require-selected-endpoint]
                 ▼
  ┌─────────────────────────────┐
  │  View: graph                │
  └──────────────┬──────────────┘
                 │ COMPLETE_GOAL
                 ▼
  ╔═════════════════════════════╗
  ║  ★ GOAL REACHED             ║
  ╚═════════════════════════════╝
```

### 3.4 `verify` (전체 시나리오 무결성 CI 게이트)
등록된 모든 시나리오의 정적 모델을 검사하여 고아 뷰, 미도달 뷰, 목표 결손 여부를 판정합니다:

```bash
pnpm exec tsx packages/spec-lens/src/cli.ts scenario verify
```
- 모든 검사를 통과하면 종료 코드 `0`을 반환합니다.
- 결함이 감지되면 결함 목록을 표준 에러(`stderr`)로 출력하고 종료 코드 `1`로 실패합니다.

### 3.5 `export` (다이어그램 및 행렬 아티팩트 추출)
시나리오 모델을 다이어그램 및 기계 가독형 포맷으로 내보냅니다:

```bash
# 특정 시나리오를 Mermaid 포맷으로 파일 저장
pnpm exec tsx packages/spec-lens/src/cli.ts scenario export --format mermaid --id spec-drift-triage --out docs/artifacts/scenarios/spec-drift-triage.mermaid

# 전체 시나리오를 Graphviz DOT 그래프로 파일 저장
pnpm exec tsx packages/spec-lens/src/cli.ts scenario export --format dot --out docs/artifacts/scenarios/all.dot

# 전체 시나리오를 JSON 행렬로 표준 출력
pnpm exec tsx packages/spec-lens/src/cli.ts scenario export --format json
```

| 옵션 | 설명 | 기본값 |
| :--- | :--- | :--- |
| `--format <fmt>` | 출력 포맷 (`mermaid`, `dot`, `json`, `markdown`) | `markdown` |
| `--id <id>` | 특정 시나리오 ID 필터 (생략 시 전체 시나리오 대상) | 전체 (`all`) |
| `--out <file>` | 결과물을 기록할 대상 파일 경로 (생략 시 `stdout` 출력) | 표준 출력 |

---

## 4. 시나리오 아티팩트 규격 및 디렉토리 구조

oa-sdk 저장소는 버전 관리되는 정본 아티팩트 디렉토리(`docs/artifacts/scenarios/`)를 유지합니다:

```text
docs/artifacts/scenarios/
├── spec-drift-triage.mermaid
├── spec-drift-triage.dot
├── spec-drift-triage.matrix.json
├── endpoint-exploration.mermaid
├── endpoint-exploration.dot
├── endpoint-exploration.matrix.json
├── breaking-impact-analysis.mermaid
├── breaking-impact-analysis.dot
├── breaking-impact-analysis.matrix.json
├── circular-ref-diagnostic.mermaid
├── circular-ref-diagnostic.dot
└── circular-ref-diagnostic.matrix.json
```

### 4.1 4대 표준 시나리오 아티팩트 매트릭스

| 시나리오 ID | Mermaid 산출물 | Graphviz DOT 산출물 | JSON Matrix 산출물 |
| :--- | :--- | :--- | :--- |
| `spec-drift-triage` | [spec-drift-triage.mermaid](../artifacts/scenarios/spec-drift-triage.mermaid) | [spec-drift-triage.dot](../artifacts/scenarios/spec-drift-triage.dot) | [spec-drift-triage.matrix.json](../artifacts/scenarios/spec-drift-triage.matrix.json) |
| `endpoint-exploration` | [endpoint-exploration.mermaid](../artifacts/scenarios/endpoint-exploration.mermaid) | [endpoint-exploration.dot](../artifacts/scenarios/endpoint-exploration.dot) | [endpoint-exploration.matrix.json](../artifacts/scenarios/endpoint-exploration.matrix.json) |
| `breaking-impact-analysis` | [breaking-impact-analysis.mermaid](../artifacts/scenarios/breaking-impact-analysis.mermaid) | [breaking-impact-analysis.dot](../artifacts/scenarios/breaking-impact-analysis.dot) | [breaking-impact-analysis.matrix.json](../artifacts/scenarios/breaking-impact-analysis.matrix.json) |
| `circular-ref-diagnostic` | [circular-ref-diagnostic.mermaid](../artifacts/scenarios/circular-ref-diagnostic.mermaid) | [circular-ref-diagnostic.dot](../artifacts/scenarios/circular-ref-diagnostic.dot) | [circular-ref-diagnostic.matrix.json](../artifacts/scenarios/circular-ref-diagnostic.matrix.json) |

### 4.2 JSON Matrix 스키마 명세
`.matrix.json` 파일은 기계 자동화 및 정적 테스트 도구가 소비하는 정형화된 JSON 배열 구조를 가집니다:

```typescript
interface ScenarioAnalysisArtifact {
  scenarioId: string
  title: string
  initialView: string
  boundedViews: string[]
  reachableViews: string[]
  deadEnds: string[]
  paths: Array<{
    steps: Array<{
      from: string
      action: string
      to: string
      guardIds: string[]
      description?: string
    }>
    reachedGoal?: string
    isTerminal: boolean
  }>
  matrix: Array<{
    fromView: string
    actionType: string
    toView: string
    guardIds: string[]
    isTerminal: boolean
  }>
}
```

---

## 5. 듀얼 프리뷰어 워크플로 (Dual Previewer Workflow)

엔지니어와 설계자는 환경에 따라 두 가지 프리뷰 방식을 선택적으로 활용할 수 있습니다:

### 5.1 터미널 프리뷰어 (Terminal Previewer)
- SSH 세션, 원격 서버, 로컬 터미널, CI 로그 환경에서 즉시 확인 가능.
- `spec-lens scenario preview <id>` 명령을 실행하여 컬러풀한 ANSI 박스 다이어그램으로 단계별 전이 흐름 파악.
- 별도의 웹 서버 구동 없이 1초 이내에 시나리오 정합성 시각 확인.

### 5.2 웹 UI 프리뷰어 (Web UI Interactive Previewer)
Spec-Lens 웹 대시보드(`apps/spec-lens`)는 Context-Action 패턴 기반의 반응형 프리뷰 위젯들을 내장합니다:

1. **`ScenarioSelector` (모드 전환 컨트롤러)**:
   - 사이드바 상단에 배치되어 `🌐 자유 탐색 모드`와 4대 시나리오 간 전환을 제어합니다.
2. **`ScenarioProgressHUD` (진행 상황 헤드업 디스플레이)**:
   - 시나리오가 활성화되면 메인 헤더 상단에 고정 표시됩니다.
   - 현재 단계(Step Number), 담당 페르소나 뱃지, 목표 완료(`COMPLETE_GOAL`) CTA 버튼, 무손실 단계 복귀(`STEP_BACK`) 버튼 제공.
3. **`ScenarioFlowModal` (실시간 FSM 상태 다이어그램 모달)**:
   - 언제든 `흐름도 보기` 버튼을 누르면 열리며, 전체 전이 규칙과 전이 행렬 테이블을 시각화합니다.
   - 현재 사용자가 머무르고 있는 뷰(Active View)가 실시간으로 펄스 하이라이트(Pulse Highlight)되어 유저 여정 상의 위치를 직관적으로 파악할 수 있습니다.
4. **URL 상태 동기화 (`useUrlState`)**:
   - `?scenario=spec-drift-triage` 쿼리 파라미터를 통해 브라우저 히스토리 및 북마크와 100% 동기화됩니다.

---

## 6. 시나리오 저작 컨벤션 및 거버넌스 규칙

신규 시나리오를 정의하거나 기존 시나리오를 리팩토링할 때는 다음 규칙을 준수해야 합니다:

### 6.1 인지 부하 제한 (Rule of 5)
- 단일 시나리오의 `boundedViews`는 **최대 5개 이하**로 제한합니다.
- 화면 수가 5개를 초과하는 복잡한 업무는 시나리오를 분할하고 `SWITCH_SCENARIO`를 통한 단계적 인계(Hand-off)를 적용합니다.

### 6.2 가드 명명 규칙 (Guard Naming Conventions)
- 가드 ID는 반드시 `require-<condition>` 케밥 케이스 형식을 사용합니다.
  - 좋은 예: `require-diff-pair`, `require-path-pattern`, `require-selected-endpoint`
  - 나쁜 예: `checkDiff`, `isValid`, `guard1`

### 6.3 목표 완료 명명 규칙 (Goal Naming Conventions)
- 완료 목표 ID는 반드시 `<domain>-<action_past>` 케밥 케이스 형식을 사용합니다.
  - 좋은 예: `drift-resolved`, `contract-verified`, `impact-assessed`, `cycle-isolated`
  - 나쁜 예: `success`, `done`, `finished`

### 6.4 페르소나 매핑 (Persona Taxonomy)
- 시나리오에 참여하는 주체는 사전에 정의된 표준 페르소나 중 하나를 명시해야 합니다:
  - `ApiArchitect`: 전체 API 아키텍처 및 드리프트 거버넌스 담당
  - `ApiConsumer`: 클라이언트 개발자 및 엔드포인트 소비 엔지니어
  - `ReleaseManager`: 릴리스 배포 승인 및 파괴적 변경(Breaking Change) 영향 평가 담당
  - `SpecAuthor`: TypeSpec / OpenAPI 스키마 저작자 및 순환 참조 해결 엔지니어

### 6.5 실전 4대 모범사례 및 4대 안티패턴

#### 1) 4대 황금률 (Golden Rules)
1. **Rule of 5 (제한 뷰 5개 이하)**: 단일 시나리오의 제한 뷰는 최대 5개 이하로 유지하십시오. 화면 수가 초과되면 시나리오를 분할하고 `SWITCH_SCENARIO` 핸드오프를 적용합니다.
2. **Kebab-Case 식별자 컨벤션**: 가드는 `require-<condition>`, 완료 목표는 `<domain>-<action_past>` 표준을 엄격히 준수하십시오.
3. **가드의 순수 함수화 (Pure Guard Evaluation)**: 가드의 `evaluate` 함수는 외부 네트워크 요청이나 DOM 조작 없이 오직 전달된 컨텍스트와 액션 페이로드만을 비교 평가해야 합니다.
4. **가역적 내비게이션 보존 (Preserve Reversibility)**: 모든 순방향 전이는 필수 컨텍스트를 보존하여 `STEP_BACK` 시 100% 원복될 수 있어야 합니다.

#### 2) 피해야 할 4대 안티패턴 (Anti-Patterns to Avoid)
1. ❌ **무제약 뷰 선언 (Unbounded Views)**: `boundedViews`에 4개 이상의 전체 화면을 다 열어두어 평면 모델로 회귀시키는 행위.
2. ❌ **침묵하는 가드 실패 (Silent Guard Failures)**: 가드 실패 시 사유 문구 없이 묵묵부답으로 처리하는 행위.
3. ❌ **루프 데드락 및 고아 뷰 (Cyclic Dead-Ends)**: 목표로 빠져나갈 수 없는 폐쇄 전이 루프 형성 (CI에서 즉시 실패).
4. ❌ **임의 문자열 액션 디스패치 (Ad-hoc String Actions)**: 타입 정의 없는 임의 문자열 액션을 캐스팅하여 우회하는 행위.

---

## 7. 검증 및 CI 통합 가이드

모노레포 빌드 파이프라인에서 시나리오 무결성을 보장하기 위해 `package.json` 스크립트에 통합되어 있습니다:

```json
{
  "scripts": {
    "test:scenarios": "pnpm --filter @oa-sdk/spec-lens test && pnpm exec tsx packages/spec-lens/src/cli.ts scenario verify"
  }
}
```

CI 단계에서 `pnpm exec tsx packages/spec-lens/src/cli.ts scenario verify`가 실행되며, 모든 시나리오의 완결성(도달 가능성 100%, 0 Dead-Ends)이 검증됩니다.

---

## 8. 피드백 수렴 및 확장 거버넌스 프레임워크

시나리오 FSM 엔진의 신규 등록 및 운영 개선을 위해 정기적으로 다음 체크리스트를 점검합니다:

1. **시나리오 범위 (JTBD)**: 신규 추가되는 시나리오가 엔지니어링 팀의 실질적인 작업 흐름을 대변하는가?
2. **HUD & 인터랙션**: 단계별 이동과 목표 달성 피드백이 직관적으로 전달되는가?
3. **거버넌스 연동**: 런타임 감사 추적(`breadcrumbs`)의 세션 로깅 및 외부 텔레메트리(OpenTelemetry Span) 확장이 필요한가?
