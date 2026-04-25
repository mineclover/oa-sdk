export type Locale = 'ko' | 'en'

export type Translations = {
  // App nav
  navTimeline: string
  navPaths: string
  navGraph: string
  appFooter: string
  langToggle: string

  // Badge
  noChanges: string

  // SplitDiff
  splitBefore: string
  splitAfter: string
  splitNotExistBefore: string
  splitNoLongerExists: string

  // DiffView
  diffBack: string
  diffLoadError: string
  diffNoData: string
  diffTabChanges: string
  diffTabYaml: string
  diffTabBreaking: string
  diffTabFragments: string
  diffNoSpecDiff: string
  diffCategoryPaths: string
  diffCategoryComponents: string
  diffCategoryRoot: string
  diffCategoryServers: string
  diffCategorySecurity: string
  diffSpecUnavailable: string
  diffSideBySide: string
  diffInline: string
  diffNoBreaking: string
  diffNoFragments: string
  diffFragmentCount: (n: number) => string
  diffSelectFile: string

  // Diff stat badges
  statPathsAdded: (n: number) => string
  statPathsRemoved: (n: number) => string
  statPathsChanged: (n: number) => string
  statSchemasAdded: (n: number) => string
  statSchemasRemoved: (n: number) => string
  statSchemasChanged: (n: number) => string
  statBreaking: (n: number) => string

  // Timeline
  timelineTitle: string
  timelineRevisionCount: (n: number) => string
  timelineRecentN: (n: number) => string
  timelineRefresh: string
  timelineEmpty: string
  timelineNoMessage: string
  timelineMoreFiles: (n: number) => string
  timelineBuildFailed: string
  timelineViewDiff: string

  // Relative time
  relJustNow: string
  relToday: string
  relMinutesAgo: (m: number) => string
  relHoursAgo: (h: number) => string
  relDaysAgo: (d: number) => string

  // PathProvenance
  pathsTitle: string
  pathsCount: (filtered: number, total: number) => string
  pathsSearch: string
  pathsAllScopes: string
  pathsAllDomains: string
  pathsColPath: string
  pathsColMethods: string
  pathsColCanonicalId: string
  pathsColScope: string
  pathsColDomain: string
  pathsColSourceFile: string
  pathsColLastChanged: string
  pathsEmpty: string
  pathsDetailCanonicalId: string
  pathsDetailSourceFile: string
  pathsDetailContentHash: string
  pathsDetailLastRevision: string

  // FragmentGraph
  graphTitle: string
  graphNodeEdgeCount: (n: number, e: number) => string
  graphNoSnapshots: string
  graphAllKinds: string
  graphAllScopes: string
  graphDetailTitle: string
  graphDetailName: string
  graphDetailKind: string
  graphDetailScope: string
  graphDetailDomain: string
  graphDetailId: string
  graphDetailHash: string
  graphDetailSource: string
}

export const ko: Translations = {
  navTimeline: '타임라인',
  navPaths: '경로',
  navGraph: '그래프',
  appFooter: '@oa-sdk/spec-lens',
  langToggle: 'EN',

  noChanges: '변경 없음',

  splitBefore: '이전',
  splitAfter: '이후',
  splitNotExistBefore: '이전에 없었음',
  splitNoLongerExists: '더 이상 없음',

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
  diffFragmentCount: (n) => `${n}개 파일 변경 · 클릭하여 보기`,
  diffSelectFile: '파일을 선택하여 내용을 확인하세요',

  statPathsAdded: (n) => `+${n} 경로`,
  statPathsRemoved: (n) => `−${n} 경로`,
  statPathsChanged: (n) => `~${n} 경로`,
  statSchemasAdded: (n) => `+${n} 스키마`,
  statSchemasRemoved: (n) => `−${n} 스키마`,
  statSchemasChanged: (n) => `~${n} 스키마`,
  statBreaking: (n) => `⚡${n} breaking`,

  timelineTitle: '타임라인',
  timelineRevisionCount: (n) => `revision ${n}개`,
  timelineRecentN: (n) => `최근 ${n}개`,
  timelineRefresh: '↻ 새로고침',
  timelineEmpty: 'revision이 없습니다. 새로고침을 클릭해 소스에서 가져오세요.',
  timelineNoMessage: '(메시지 없음)',
  timelineMoreFiles: (n) => `+${n} 더`,
  timelineBuildFailed: '빌드 실패',
  timelineViewDiff: 'diff 보기 →',

  relJustNow: '방금',
  relToday: '오늘',
  relMinutesAgo: (m) => `${m}분 전`,
  relHoursAgo: (h) => `${h}시간 전`,
  relDaysAgo: (d) => `${d}일 전`,

  pathsTitle: 'Path Provenance',
  pathsCount: (f, total) => `${f} / ${total} 경로`,
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

  graphTitle: '프래그먼트 그래프',
  graphNodeEdgeCount: (n, e) => `노드 ${n} · 엣지 ${e}`,
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

export const en: Translations = {
  navTimeline: 'Timeline',
  navPaths: 'Paths',
  navGraph: 'Graph',
  appFooter: '@oa-sdk/spec-lens',
  langToggle: '한국어',

  noChanges: 'no changes',

  splitBefore: 'Before',
  splitAfter: 'After',
  splitNotExistBefore: 'Did not exist before',
  splitNoLongerExists: 'No longer exists',

  diffBack: '← Timeline',
  diffLoadError: 'Failed to load diff',
  diffNoData: 'No diff data available.',
  diffTabChanges: 'Changes',
  diffTabYaml: 'Full YAML',
  diffTabBreaking: 'Breaking',
  diffTabFragments: 'Fragments',
  diffNoSpecDiff: 'No spec differences between these two revisions.',
  diffCategoryPaths: 'API Paths',
  diffCategoryComponents: 'Components',
  diffCategoryRoot: 'Root',
  diffCategoryServers: 'Servers',
  diffCategorySecurity: 'Security',
  diffSpecUnavailable: 'Spec unavailable — snapshot has build errors.',
  diffSideBySide: 'Side by side',
  diffInline: 'Inline',
  diffNoBreaking: '✓ No breaking changes',
  diffNoFragments: 'No fragment files changed',
  diffFragmentCount: (n) => `${n} file${n !== 1 ? 's' : ''} changed · click to view`,
  diffSelectFile: 'Select a file to view its content',

  statPathsAdded: (n) => `+${n} paths`,
  statPathsRemoved: (n) => `−${n} paths`,
  statPathsChanged: (n) => `~${n} paths`,
  statSchemasAdded: (n) => `+${n} schemas`,
  statSchemasRemoved: (n) => `−${n} schemas`,
  statSchemasChanged: (n) => `~${n} schemas`,
  statBreaking: (n) => `⚡${n} breaking`,

  timelineTitle: 'Timeline',
  timelineRevisionCount: (n) => `${n} revision${n !== 1 ? 's' : ''}`,
  timelineRecentN: (n) => `Recent ${n}`,
  timelineRefresh: '↻ Refresh',
  timelineEmpty: 'No revisions yet. Click Refresh to fetch from the source.',
  timelineNoMessage: '(no message)',
  timelineMoreFiles: (n) => `+${n} more`,
  timelineBuildFailed: 'build failed',
  timelineViewDiff: 'view diff →',

  relJustNow: 'just now',
  relToday: 'today',
  relMinutesAgo: (m) => `${m}m ago`,
  relHoursAgo: (h) => `${h}h ago`,
  relDaysAgo: (d) => `${d}d ago`,

  pathsTitle: 'Path Provenance',
  pathsCount: (f, total) => `${f} / ${total} paths`,
  pathsSearch: 'Search paths…',
  pathsAllScopes: 'All scopes',
  pathsAllDomains: 'All domains',
  pathsColPath: 'Path',
  pathsColMethods: 'Methods',
  pathsColCanonicalId: 'Canonical ID',
  pathsColScope: 'Scope',
  pathsColDomain: 'Domain',
  pathsColSourceFile: 'Source File',
  pathsColLastChanged: 'Last Changed',
  pathsEmpty: 'No paths found. Run a Refresh to build snapshots.',
  pathsDetailCanonicalId: 'Canonical ID',
  pathsDetailSourceFile: 'Source File',
  pathsDetailContentHash: 'Content Hash',
  pathsDetailLastRevision: 'Last Changed Revision',

  graphTitle: 'Fragment Graph',
  graphNodeEdgeCount: (n, e) => `${n} nodes · ${e} edges`,
  graphNoSnapshots: 'No snapshots available',
  graphAllKinds: 'All kinds',
  graphAllScopes: 'All scopes',
  graphDetailTitle: 'Fragment',
  graphDetailName: 'Name',
  graphDetailKind: 'Kind',
  graphDetailScope: 'Scope',
  graphDetailDomain: 'Domain',
  graphDetailId: 'ID',
  graphDetailHash: 'Hash',
  graphDetailSource: 'Source',
}

export const translations: Record<Locale, Translations> = { ko, en }
