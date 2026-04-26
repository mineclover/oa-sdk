/**
 * English (en) translation resource.
 * This file is the source-of-truth for TypeScript key types.
 *
 * Pluralisation: i18next resolves _one / _other automatically via CLDR rules.
 * Interpolation: use {{variableName}} syntax.
 */
const en = {
  // ── App nav ────────────────────────────────────────────────
  navTimeline: 'Timeline',
  navPaths: 'Paths',
  navGraph: 'Graph',
  appFooter: '@oa-sdk/spec-lens',
  langToggle: '한국어',

  // ── Target info ────────────────────────────────────────────
  configTarget: 'Target',
  configFragments: 'Fragments',
  configSource: 'Source',
  configBranch: 'Branch',

  // ── Badge ──────────────────────────────────────────────────
  noChanges: 'no changes',

  // ── SplitDiff ──────────────────────────────────────────────
  splitBefore: 'Before',
  splitAfter: 'After',
  splitNotExistBefore: 'Did not exist before',
  splitNoLongerExists: 'No longer exists',

  // ── DiffView ───────────────────────────────────────────────
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
  diffFragmentCount: '{{count}} files changed · click to view',
  diffFragmentCount_one: '{{count}} file changed · click to view',
  diffFragmentCount_other: '{{count}} files changed · click to view',
  diffSelectFile: 'Select a file to view its content',

  // ── Diff stat badges ───────────────────────────────────────
  statPathsAdded: '+{{count}} paths',
  statPathsRemoved: '−{{count}} paths',
  statPathsChanged: '~{{count}} paths',
  statSchemasAdded: '+{{count}} schemas',
  statSchemasRemoved: '−{{count}} schemas',
  statSchemasChanged: '~{{count}} schemas',
  statBreaking: '⚡{{count}} breaking',

  // ── Timeline ───────────────────────────────────────────────
  timelineTitle: 'Timeline',
  timelineRevisionCount: '{{count}} revisions',
  timelineRevisionCount_one: '{{count}} revision',
  timelineRevisionCount_other: '{{count}} revisions',
  timelineRecentN: 'Recent {{count}}',
  timelineRefresh: '↻ Refresh',
  timelineEmpty: 'No revisions yet. Click Refresh to fetch from the source.',
  timelineNoMessage: '(no message)',
  timelineMoreFiles: '+{{count}} more',
  timelineBuildFailed: 'build failed',
  timelineViewDiff: 'view diff →',

  // ── Relative time ──────────────────────────────────────────
  relJustNow: 'just now',
  relToday: 'today',
  relMinutesAgo: '{{count}}m ago',
  relHoursAgo: '{{count}}h ago',
  relDaysAgo: '{{count}}d ago',

  // ── PathProvenance ─────────────────────────────────────────
  pathsTitle: 'Path Provenance',
  pathsCount: '{{filtered}} / {{total}} paths',
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

  // ── Breaking panel ─────────────────────────────────────────
  breakingFilterAll: 'All',
  breakingFilterBreaking: 'Breaking',
  breakingFilterNonBreaking: 'Non-breaking',
  breakingCountSummary: '{{breaking}} breaking · {{nonBreaking}} non-breaking',
  breakingFilterEmpty: 'No items match this filter.',

  // ── FragmentGraph ──────────────────────────────────────────
  graphTitle: 'Fragment Graph',
  graphNodeEdgeCount: '{{nodes}} nodes · {{edges}} edges',
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
  graphDetailRefs: 'References ({{count}})',
  graphDetailRefdBy: 'Referenced by ({{count}})',
} as const

export default en
export type TranslationKeys = typeof en
