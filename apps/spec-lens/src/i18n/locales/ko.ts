/**
 * Korean (ko) translation resource.
 *
 * Korean has no plural distinction (CLDR category: "other" for all counts).
 * i18next falls back from _one/_other to the base key automatically,
 * so plural variants are not needed here.
 *
 * Missing keys fall back to English via i18next fallbackLng.
 */
import type { TranslationKeys } from './en.js'

// Omit _one/_other plural variant keys — not needed for Korean
type KoKeys = { [K in keyof TranslationKeys as K extends `${string}_one` | `${string}_other` ? never : K]: string }

const ko: KoKeys = {
  // ── App nav ─────────────────────────────────────────────────
  navTimeline: '타임라인',
  navPaths: '경로',
  navGraph: '그래프',
  appFooter: '@oa-sdk/spec-lens',
  langToggle: 'EN',
  sidebarCollapse: '사이드바 접기',
  sidebarExpand: '사이드바 펼치기',

  // ── Feedback ───────────────────────────────────────────────
  dialogConfirmTitle: '동작 확인',
  dialogConfirm: '확인',
  dialogCancel: '취소',
  toastDismiss: '닫기',

  // ── Target info ─────────────────────────────────────────────
  configTarget: '대상',
  configFragments: '프래그먼트',
  configSource: '소스',

  // ── Badge ───────────────────────────────────────────────────
  noChanges: '변경 없음',

  // ── SplitDiff ───────────────────────────────────────────────
  splitBefore: '이전',
  splitAfter: '이후',
  splitNotExistBefore: '이전에 없었음',
  splitNoLongerExists: '더 이상 없음',

  // ── DiffView ────────────────────────────────────────────────
  diffBack: '← 타임라인',
  diffLoadError: 'diff 로드 실패',
  diffNoData: 'diff 데이터 없음',
  diffTabChanges: '변경사항',
  diffTabYaml: '전체 YAML',
  diffTabBreaking: 'Breaking',
  diffTabFragments: '프래그먼트',
  diffNoSpecDiff: '두 revision 간 스펙 차이가 없습니다.',
  diffCategoryPaths: 'API 경로',
  diffCategoryComponents: '컴포넌트',
  diffCategoryRoot: '루트',
  diffCategoryServers: '서버',
  diffCategorySecurity: '보안',
  diffSpecUnavailable: '스펙 없음 — 스냅샷 빌드 오류',
  diffSideBySide: '나란히',
  diffInline: '인라인',
  diffNoBreaking: '✓ Breaking 변경 없음',
  diffNoFragments: '변경된 프래그먼트 파일 없음',
  diffFragmentCount: '{{count}}개 파일 변경 · 클릭하여 보기',
  diffSelectFile: '파일을 선택하여 내용을 확인하세요',

  // ── Diff stat badges ────────────────────────────────────────
  statPathsAdded: '+{{count}} 경로',
  statPathsRemoved: '−{{count}} 경로',
  statPathsChanged: '~{{count}} 경로',
  statSchemasAdded: '+{{count}} 스키마',
  statSchemasRemoved: '−{{count}} 스키마',
  statSchemasChanged: '~{{count}} 스키마',
  statBreaking: '⚡{{count}} breaking',

  // ── Timeline ────────────────────────────────────────────────
  timelineTitle: '타임라인',
  timelineRevisionCount: 'revision {{count}}개',
  timelineRecentN: '최근 {{count}}개',
  timelineRefresh: '↻ 새로고침',
  timelineClearCache: '캐시 초기화',
  timelineClearCacheConfirm: '모든 스냅샷과 diff 캐시를 삭제합니다. 되돌릴 수 없습니다.',
  timelineClearCacheDone: '캐시 삭제 완료 (스냅샷 {{snapshots}}개, diff {{diffs}}개)',
  timelineEmpty: 'revision이 없습니다. 새로고침을 클릭해 소스에서 가져오세요.',
  timelineNoMessage: '(메시지 없음)',
  timelineMoreFiles: '+{{count}} 더',
  timelineBuildFailed: '빌드 실패',
  timelineViewDiff: 'diff 보기 →',
  timelineFilterBreaking: 'Breaking만 (⚡)',
  timelineSearchPlaceholder: '커밋 검색 (메시지, SHA, 작성자)…',
  timelineCompareMode: '선택 비교 모드',
  timelineCompareCancel: '선택 취소',
  timelineCompareBarPrompt: '비교할 커밋 2개를 선택하세요',
  timelineCompareAction: '비교하기 ({{base}} … {{head}})',
  timelineCompareBase: 'Base',
  timelineCompareHead: 'Head',
  timelineClearCacheError: '캐시 초기화에 실패했습니다.',
  timelineFilterCount: '{{count}}개 리비전 일치',
  timelineSwapButton: 'Base ⇄ Head 맞바꾸기',
  timelineDistinctError: 'Base와 Head는 서로 다른 리비전이어야 합니다',
  timelineNoMatch: '필터 조건과 일치하는 리비전이 없습니다.',
  timelineClearFilters: '필터 초기화',

  // ── Relative time ───────────────────────────────────────────
  relJustNow: '방금',
  relToday: '오늘',
  relMinutesAgo: '{{count}}분 전',
  relHoursAgo: '{{count}}시간 전',
  relDaysAgo: '{{count}}일 전',

  // ── PathProvenance ──────────────────────────────────────────
  pathsTitle: '경로 출처',
  pathsCount: '{{filtered}} / {{total}} 경로',
  pathsSearch: '경로 검색…',
  pathsAllScopes: '모든 scope',
  pathsAllDomains: '모든 domain',
  pathsColPath: '경로',
  pathsColMethods: '메서드',
  pathsColCanonicalId: 'Canonical ID',
  pathsColScope: 'Scope',
  pathsColDomain: 'Domain',
  pathsColSourceFile: '소스 파일',
  pathsColLastChanged: '마지막 변경',
  pathsEmpty: '경로가 없습니다. 새로고침을 실행하세요.',
  pathsUnavailableTypeSpec: 'TypeSpec 번들은 출력 포인터 출처를 제공하지 않습니다. 도달 가능한 소스 파일 증거는 스냅샷과 diff에서 확인할 수 있습니다.',
  pathsDetailCanonicalId: 'Canonical ID',
  pathsDetailSourceFile: '소스 파일',
  pathsDetailContentHash: '콘텐츠 해시',
  pathsDetailLastRevision: '마지막 변경 revision',
  pathsSortPath: '경로순 정렬',
  pathsSortMethods: '메서드순 정렬',
  pathsSortLastChanged: '최근 변경순 정렬',
  pathsCopyPath: '경로 복사',
  pathsCopyCanonicalId: 'Canonical ID 복사',
  pathsCopied: '클립보드에 복사되었습니다!',

  // ── Breaking panel ──────────────────────────────────────────
  breakingFilterAll: '전체',
  breakingFilterBreaking: 'Breaking',
  breakingFilterNonBreaking: 'Non-breaking',
  breakingCountSummary: 'breaking {{breaking}}개 · non-breaking {{nonBreaking}}개',
  breakingFilterEmpty: '해당 필터에 맞는 항목이 없습니다.',

  // ── FragmentGraph ───────────────────────────────────────────
  graphTitle: '프래그먼트 그래프',
  graphNodeEdgeCount: '노드 {{nodes}} · 엣지 {{edges}}',
  graphNoSnapshots: '스냅샷 없음',
  graphAllKinds: '모든 종류',
  graphAllScopes: '모든 scope',
  graphZoomIn: '확대',
  graphZoomOut: '축소',
  graphFit: '화면에 맞추기',
  graphReset: '레이아웃 초기화',
  graphSearchPlaceholder: '심볼 / 노드 검색…',
  graphFocusActive: '이웃 노드 포커스: {{name}}',
  graphFocusReset: '포커스 해제',
  graphDetailTitle: '프래그먼트',
  graphDetailName: '이름',
  graphDetailKind: '종류',
  graphDetailScope: 'Scope',
  graphDetailDomain: 'Domain',
  graphDetailId: 'ID',
  graphDetailHash: '해시',
  graphDetailSource: '소스',
  graphDetailRefs: '참조 ({{count}})',
  graphDetailRefdBy: '참조됨 ({{count}})',
}

export default ko
