# spec-lens UI (`@oa-sdk/spec-lens-ui`)

OpenAPI 3.1/3.2 및 TypeSpec 프로젝트의 변경 이력을 관측하고 시각화하는 React 19 웹 대시보드.

**전체 사용자 가이드 & 핵심 개념**: [`docs/spec-lens/README.md`](../../docs/spec-lens/README.md)

---

## 실행 가이드

### 1. 개발 모드 (Vite HMR)

```bash
# 1. 백엔드 엔진 서버 시작 (별도 터미널, repo 루트에서)
pnpm exec tsx packages/spec-lens/src/cli.ts

# 2. UI dev server 시작
pnpm --filter @oa-sdk/spec-lens-ui dev
# → http://localhost:5174  (/api/* 요청은 백엔드 :4891 포트로 자동 프록시)
```

### 2. 프로덕션 빌드 & 내장 서빙

```bash
# 1. UI 프로덕션 번들 빌드
pnpm --filter @oa-sdk/spec-lens-ui build

# 2. 백엔드 서버 기동
pnpm exec tsx packages/spec-lens/src/cli.ts

# → http://localhost:4891/ui/ 에서 단일 프로세스로 정적 서빙
```

---

## 핵심 뷰 & 기능

| 뷰 | 경로 / URL | 주요 기능 |
|----|-----------|----------|
| **Timeline** | `?view=timeline` | • 임의 2-Commit 비교 모드 (Base/Head 라디오 선택 + 상단 Compare 바 + ⇄ Swap)<br>• ⚡ 브레이킹 체인지 전용 퀵 필터 칩<br>• SHA / 메시지 / 작성자 실시간 텍스트 검색<br>• 인라인 모달 Dialog 기반 캐시 초기화 & Toast 알림 |
| **Diff** | `?view=diff&base=:b&head=:h` | • 구조 카테고리별 OpenAPI Diff (`Changes`)<br>• Monaco Editor Full YAML Diff (나란히/인라인)<br>• 파괴적 변경 격리 (`Breaking`)<br>• 파일별 소스 변경 (`Fragments`) |
| **Path Provenance** | `?view=paths` | • 전체 활성 엔드포인트 데이터그리드<br>• 컬럼 정렬 (경로 알파벳순, 최근 변경 시간순, HTTP 메서드순)<br>• 원클릭 클립보드 복사 (`📋`, 1.8초 Copied! 툴팁)<br>• Scope / Domain 필터링 및 실시간 검색 |
| **Fragment Graph** | `?view=graph` | • D3 force-directed `$ref` 의존성 시각화<br>• 플로팅 캔버스 툴바 (`+`, `−`, `⛶ 화면 맞춤`, `↻ 초기화`)<br>• 심볼 검색 자동완성 & 부드러운 줌 포커스 (`centerOnNode`)<br>• 1-Hop Neighborhood Focus (선택 노드 100%, 비연결 노드 15% Dimming) |

---

## 대시보드 쉘 & UX 패턴

- **URL SearchParams 동기화**: `useUrlState`는 창(window)마다 하나뿐인 URL 스토어(`getUrlStateStore`)를 구독하므로, `ScenarioProvider`와 `AppShell`을 포함한 모든 소비자가 같은 URL 상태를 봅니다. 갱신(`update`)은 항상 최신 상태 위에서 한 번에 적용되어 히스토리 항목을 하나만 남기고, URL이 바뀌지 않으면 항목을 추가하지 않습니다. `view`, `base`, `head`, `scenario`는 FSM이 쓰고, 딥링크의 `revision`과 `search`는 시나리오 컨텍스트 초기값(`revisionId`, `pathPattern`)으로 읽습니다. `scope`, `domain`은 URL에 보존되지만 Path Provenance의 필터는 아직 화면 로컬 상태입니다.
- **유저 시나리오 네비게이션 FSM 엔진 (`?scenario=<id>`)**:
  - 모든 화면 이동은 FSM(`scenarioTransitionReducer`)을 거칩니다. 자유 탐색 모드에서는 리듀서가 그대로 허용하고, 시나리오 안에서는 현재 뷰에서 허용된 전이만 화면을 바꿉니다. 렌더링 뷰, `machineState.currentView`, URL은 항상 같습니다.
  - `ScenarioSelector`: 사이드바 상단에서 `🌐 자유 탐색`과 4대 표준 유저 시나리오(`spec-drift-triage`, `endpoint-exploration`, `breaking-impact-analysis`, `circular-ref-diagnostic`)를 전환합니다. 시나리오는 자신의 초기 뷰에서 시작합니다.
  - `ScenarioProgressHUD`: 페르소나, 현재 단계, **다음 단계 버튼**(현재 뷰에서 허용된 전이), 완료 CTA, `← 이전 단계`(`STEP_BACK`: 직전 단계의 뷰와, diff 단계이면 그 단계가 기록한 리비전 쌍 복원), 거절된 전이의 사유를 표시합니다. 다음 단계의 페이로드는 현재 뷰의 선택에서 옵니다. Timeline의 리비전 비교는 `REQUEST_DIFF`를 바로 보내고, Diff 항목(경로/컴포넌트 포인터), Path Provenance 행(경로와 canonical ID), Fragment Graph 노드(심볼 ID와 이름)는 선택을 게시합니다. 가드가 거절할 단계는 사유와 함께 비활성화됩니다.
  - 딥링크 `?scenario=<id>`의 `view`가 시나리오의 `boundedViews` 밖이면 시나리오 초기 뷰로 시작하고 URL을 그 뷰로 교체(`replaceState`)합니다. 알 수 없는 시나리오 ID는 URL에서 제거됩니다.
  - 브라우저 뒤로가기로 직전 히스토리 항목에 돌아가면, 그 URL을 보여 준 가장 최근 단계까지 `STEP_BACK`으로 되돌립니다. URL을 바꾸지 않은 단계(목표 완료, `FILTER_BREAKING_CHANGES` 같은 자기 전이)는 히스토리 항목을 남기지 않으므로 함께 건너뛰고, `SWITCH_SCENARIO` 이전 시나리오로도 같은 방식으로 돌아갑니다. diff 단계는 브레드크럼에 기록된 리비전 쌍으로 구분하며, 그 쌍은 `STEP_BACK`이 복원하므로 HUD `← 이전 단계`, Diff 뒤로 버튼, 브라우저 뒤로가기 중 무엇으로 돌아가도 같은 단계는 같은 리비전 쌍을 보여 줍니다. 그 밖의 이동(앞으로가기, 직전 항목을 넘는 이동, 직접 고친 뷰)은 URL을 현재 단계로 되돌립니다(`replaceState`). 시나리오 안에서 사이드바 이동은 허용된 전이가 아니면 거절되고 HUD에 사유가 표시되며, 시나리오를 종료하면 자유롭게 이동할 수 있습니다.
  - `ScenarioFlowModal`: 현재 시나리오의 전체 FSM 전이 행렬과 Mermaid 흐름도를 시각화하고 현재 뷰 위치 하이라이트.
- **접이식 사이드바 (Collapsible Sidebar)**: 60px 컴팩트 아이콘 모드로 축소하여 Monaco Editor 가로 해상도 극대화.
- **피드백 시스템**: `FeedbackContext`를 통한 인라인 비동기 `Dialog` 및 알림 `Toast` (네이티브 `alert`/`confirm` 완전 대체).
- **다국어(i18n)**: 영어(EN) 및 한국어(KO) 1:1 완비, `localStorage` 영속화.

---

## 기술 스택

- **프레임워크**: React 19.1 + Vite 6
- **서버 상태 관리**: `@tanstack/react-query` v5
- **코드 & Diff 에디터**: `@monaco-editor/react` (lazy-loaded)
- **데이터 시각화**: D3.js v7 (force simulation, zoom, drag)
- **다국어**: `i18next` + `react-i18next`
- **스타일**: CSS Custom Properties 기반 일관된 GitHub Dark 테마 시스템
