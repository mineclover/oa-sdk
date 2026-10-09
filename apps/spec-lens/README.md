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

- **URL SearchParams 양방향 동기화**: `view`, `base`, `head`, `revision`, `search`, `scope`, `domain`, `scenario` 등의 모든 상태가 쿼리 파라미터에 실시간 반영되어 딥링크 공유 및 브라우저 뒤로가기/앞으로가기 네비게이션 완벽 지원.
- **유저 시나리오 네비게이션 FSM 엔진 (`?scenario=<id>`)**:
  - `ScenarioSelector`: 사이드바 상단에서 `🌐 자유 탐색`과 4대 표준 유저 시나리오(`spec-drift-triage`, `endpoint-exploration`, `breaking-impact-analysis`, `circular-ref-diagnostic`)를 즉시 전환.
  - `ScenarioProgressHUD`: 활성 시나리오의 페르소나, 목표 진행 상태, 완료 CTA 버튼, 원자적 되돌리기(`← 이전 단계`)를 상단 헤더 바로 실시간 안내.
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
