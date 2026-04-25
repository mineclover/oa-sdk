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
  timelineEmpty: 'revision이 없습니다. 새로고침을 클릭해 소스에서 가져오세요.',
  timelineNoMessage: '(메시지 없음)',
  timelineMoreFiles: '+{{count}} 더',
  timelineBuildFailed: '빌드 실패',
  timelineViewDiff: 'diff 보기 →',

  // ── Relative time ───────────────────────────────────────────
  relJustNow: '방금',
  relToday: '오늘',
  relMinutesAgo: '{{count}}분 전',
  relHoursAgo: '{{count}}시간 전',
  relDaysAgo: '{{count}}일 전',

  // ── PathProvenance ──────────────────────────────────────────
  pathsTitle: 'Path Provenance',
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
  pathsDetailCanonicalId: 'Canonical ID',
  pathsDetailSourceFile: '소스 파일',
  pathsDetailContentHash: '콘텐츠 해시',
  pathsDetailLastRevision: '마지막 변경 revision',

  // ── FragmentGraph ───────────────────────────────────────────
  graphTitle: '프래그먼트 그래프',
  graphNodeEdgeCount: '노드 {{nodes}} · 엣지 {{edges}}',
  graphNoSnapshots: '스냅샷 없음',
  graphAllKinds: '모든 종류',
  graphAllScopes: '모든 scope',
  graphDetailTitle: '프래그먼트',
  graphDetailName: '이름',
  graphDetailKind: '종류',
  graphDetailScope: 'Scope',
  graphDetailDomain: 'Domain',
  graphDetailId: 'ID',
  graphDetailHash: '해시',
  graphDetailSource: '소스',
}

export default ko
