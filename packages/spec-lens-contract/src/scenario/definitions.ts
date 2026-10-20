import type {
  DashboardView,
  LensBehaviorAction,
  ScenarioGuard,
  ScenarioMachineContext,
  ScenarioTopicDefinition,
  ScenarioTopicId,
  ScenarioTransitionRule,
} from './types.js'

// Standard Reusable Guards
export const guardRequireDiffPair: ScenarioGuard = {
  id: 'require-diff-pair',
  description: 'Diff 비교를 위해 baseId와 headId가 모두 지정되어야 하며 서로 달라야 합니다.',
  evaluate: (ctx, action) => {
    let base = ctx.baseId
    let head = ctx.headId
    if (action.type === 'REQUEST_DIFF') {
      base = action.baseId
      head = action.headId
    }
    if (!base || !head) {
      return { ok: false, reason: 'baseId and headId are required for diff view' }
    }
    if (base === head) {
      return { ok: false, reason: 'baseId and headId must be distinct for comparison' }
    }
    return { ok: true }
  },
}

export const guardRequirePathPattern: ScenarioGuard = {
  id: 'require-path-pattern',
  description: '경로 역추적(Path Provenance)을 위해 유효한 경로 패턴이 필요합니다.',
  evaluate: (ctx, action) => {
    let pattern = ctx.pathPattern
    if (action.type === 'INSPECT_ENDPOINT_PROVENANCE') {
      pattern = action.pathPattern
    }
    if (!pattern || pattern.trim().length === 0) {
      return { ok: false, reason: 'pathPattern cannot be empty' }
    }
    return { ok: true }
  },
}

export const guardRequireSymbolId: ScenarioGuard = {
  id: 'require-symbol-id',
  description: '스키마 그래프 조회를 위해 대상 심볼 식별자가 필요합니다.',
  evaluate: (ctx, action) => {
    let symbol = ctx.selectedSymbol
    if (action.type === 'SELECT_FRAGMENT_SYMBOL') {
      symbol = action.symbolId
    } else if (action.type === 'HIGHLIGHT_DEPENDENCY_CYCLE') {
      symbol = action.rootSymbolId
    }
    if (!symbol || symbol.trim().length === 0) {
      return { ok: false, reason: 'target symbolId is required' }
    }
    return { ok: true }
  },
}

// Standard Reusable Context Transforms
//
// A guard validates the payload an action carries; the paired transform is what
// lands that payload in the machine context. Every rule whose action carries a
// payload must use one, otherwise a re-entry transition (e.g. paths -> diff with
// a new revision pair) passes its guard but leaves the context on stale values.
export type ScenarioContextTransform = NonNullable<ScenarioTransitionRule['transformContext']>

/** REQUEST_DIFF -> `baseId` / `headId`. */
export const applyDiffPair: ScenarioContextTransform = (_ctx, action) =>
  action.type === 'REQUEST_DIFF' ? { baseId: action.baseId, headId: action.headId } : {}

/** INSPECT_ENDPOINT_PROVENANCE -> `pathPattern`. */
export const applyPathPattern: ScenarioContextTransform = (_ctx, action) =>
  action.type === 'INSPECT_ENDPOINT_PROVENANCE' ? { pathPattern: action.pathPattern } : {}

/** SELECT_FRAGMENT_SYMBOL / HIGHLIGHT_DEPENDENCY_CYCLE -> `selectedSymbol`. */
export const applySelectedSymbol: ScenarioContextTransform = (_ctx, action) => {
  if (action.type === 'SELECT_FRAGMENT_SYMBOL') return { selectedSymbol: action.symbolId }
  if (action.type === 'HIGHLIGHT_DEPENDENCY_CYCLE') return { selectedSymbol: action.rootSymbolId }
  return {}
}

/** SELECT_REVISION -> `revisionId`. */
export const applyRevision: ScenarioContextTransform = (_ctx, action) =>
  action.type === 'SELECT_REVISION' ? { revisionId: action.revisionId } : {}

/** FILTER_BREAKING_CHANGES -> `onlyBreaking`. */
export const applyBreakingFilter: ScenarioContextTransform = (_ctx, action) =>
  action.type === 'FILTER_BREAKING_CHANGES' ? { onlyBreaking: action.onlyBreaking } : {}

// 1. Spec Drift Triage Scenario
export const SPEC_DRIFT_TRIAGE_SCENARIO: ScenarioTopicDefinition = {
  id: 'spec-drift-triage',
  title: '스펙 드리프트 감지 및 원인 규명',
  description: '타임라인에서 감지된 드리프트 리비전의 변경 내역을 확인하고 원인 단편의 커밋 이력을 추적하여 해결합니다.',
  persona: 'ApiArchitect',
  initialView: 'timeline',
  boundedViews: ['timeline', 'diff', 'paths'] as const,
  terminalGoals: [
    {
      id: 'drift-resolved',
      description: '드리프트 발생 원인 단편 및 책임 커밋 식별 완료',
      targetView: 'paths',
    },
  ],
  guards: {
    'require-diff-pair': guardRequireDiffPair,
    'require-path-pattern': guardRequirePathPattern,
  },
  transitions: [
    {
      fromView: 'timeline',
      actionType: 'REQUEST_DIFF',
      toView: 'diff',
      guardIds: ['require-diff-pair'],
      description: '드리프트 리비전과 기준 스펙 간의 Diff 화면으로 진입합니다.',
      transformContext: applyDiffPair,
    },
    {
      fromView: 'diff',
      actionType: 'INSPECT_ENDPOINT_PROVENANCE',
      toView: 'paths',
      guardIds: ['require-path-pattern'],
      description: '파손된 엔드포인트 단편의 생성 및 수정 이력을 역추적합니다.',
      transformContext: applyPathPattern,
    },
    {
      fromView: 'paths',
      actionType: 'COMPLETE_GOAL',
      toView: 'paths',
      description: '드리프트 원인 규명 및 해결 확인 완료.',
    },
    {
      fromView: 'paths',
      actionType: 'REQUEST_DIFF',
      toView: 'diff',
      guardIds: ['require-diff-pair'],
      description: '단편 확인 후 다시 Diff 화면으로 복귀하여 잔여 변경 검토.',
      transformContext: applyDiffPair,
    },
    {
      fromView: 'diff',
      actionType: 'SELECT_REVISION',
      toView: 'timeline',
      description: '다른 리비전을 추가 검토하기 위해 타임라인으로 복귀합니다.',
      transformContext: applyRevision,
    },
  ],
}

// 2. Endpoint Exploration Scenario
export const ENDPOINT_EXPLORATION_SCENARIO: ScenarioTopicDefinition = {
  id: 'endpoint-exploration',
  title: '엔드포인트 및 타입 계약 탐색',
  description: '엔드포인트 카탈로그에서 대상 API를 검색하고 참조된 스키마 DTO 모델 의존 그래프를 분석합니다.',
  persona: 'ApiConsumer',
  initialView: 'paths',
  boundedViews: ['paths', 'graph'] as const,
  terminalGoals: [
    {
      id: 'contract-verified',
      description: '엔드포인트 입출력 DTO 및 스키마 의존성 검증 완료',
      targetView: 'graph',
    },
  ],
  guards: {
    'require-symbol-id': guardRequireSymbolId,
    'require-path-pattern': guardRequirePathPattern,
  },
  transitions: [
    {
      fromView: 'paths',
      actionType: 'SELECT_FRAGMENT_SYMBOL',
      toView: 'graph',
      guardIds: ['require-symbol-id'],
      description: '선택한 엔드포인트가 사용하는 스키마 DTO의 의존 그래프를 엽니다.',
      transformContext: applySelectedSymbol,
    },
    {
      fromView: 'graph',
      actionType: 'INSPECT_ENDPOINT_PROVENANCE',
      toView: 'paths',
      guardIds: ['require-path-pattern'],
      description: '스키마 노드에서 해당 모델을 사용하는 엔드포인트 목록으로 복귀.',
      transformContext: applyPathPattern,
    },
    {
      fromView: 'graph',
      actionType: 'COMPLETE_GOAL',
      toView: 'graph',
      description: '계약 및 의존 구조 검증 완료.',
    },
  ],
}

// 3. Breaking Impact Analysis Scenario
export const BREAKING_IMPACT_ANALYSIS_SCENARIO: ScenarioTopicDefinition = {
  id: 'breaking-impact-analysis',
  title: '스키마 변경 파급 효과 분석',
  description: '신규 릴리즈와 이전 안정 버전 간의 파괴적 변경사항(BREAKING)을 격리하고, 영향받는 DTO 그래프를 산출합니다.',
  persona: 'ReleaseManager',
  initialView: 'timeline',
  boundedViews: ['timeline', 'diff', 'graph'] as const,
  terminalGoals: [
    {
      id: 'impact-assessed',
      description: '파괴적 변경 영향 도메인 그래프 분석 및 영향 범위 산출 완료',
      targetView: 'graph',
    },
  ],
  guards: {
    'require-diff-pair': guardRequireDiffPair,
    'require-symbol-id': guardRequireSymbolId,
  },
  transitions: [
    {
      fromView: 'timeline',
      actionType: 'REQUEST_DIFF',
      toView: 'diff',
      guardIds: ['require-diff-pair'],
      description: '비교 대상 리비전 간의 변경사항 분석 화면으로 진입.',
      transformContext: applyDiffPair,
    },
    {
      fromView: 'diff',
      actionType: 'FILTER_BREAKING_CHANGES',
      toView: 'diff',
      description: '파괴적 변경사항(Breaking changes)만 필터링 활성화.',
      transformContext: applyBreakingFilter,
    },
    {
      fromView: 'diff',
      actionType: 'SELECT_FRAGMENT_SYMBOL',
      toView: 'graph',
      guardIds: ['require-symbol-id'],
      description: '변경된 DTO 심볼의 다운스트림 파급 영향 그래프 탐색.',
      transformContext: applySelectedSymbol,
    },
    {
      fromView: 'graph',
      actionType: 'COMPLETE_GOAL',
      toView: 'graph',
      description: '영향 범위 분석 리포트 산출 완료.',
    },
    {
      fromView: 'graph',
      actionType: 'REQUEST_DIFF',
      toView: 'diff',
      guardIds: ['require-diff-pair'],
      description: '영향 확인 후 다른 변경 필드 검토를 위해 Diff로 복귀.',
      transformContext: applyDiffPair,
    },
  ],
}

// 4. Circular Reference Diagnostic Scenario
export const CIRCULAR_REF_DIAGNOSTIC_SCENARIO: ScenarioTopicDefinition = {
  id: 'circular-ref-diagnostic',
  title: '순환 참조 및 고아 스키마 진단',
  description: '전체 스키마 토폴로지 그래프에서 순환 의존 고리를 격리하고, 파일 출처를 추적하여 리팩터링 계획을 수립합니다.',
  persona: 'SpecAuthor',
  initialView: 'graph',
  boundedViews: ['graph', 'paths'] as const,
  terminalGoals: [
    {
      id: 'cycle-isolated',
      description: '순환 참조 의존 경로 및 책임 스키마 파일 격리 완료',
      targetView: 'paths',
    },
  ],
  guards: {
    'require-symbol-id': guardRequireSymbolId,
    'require-path-pattern': guardRequirePathPattern,
  },
  transitions: [
    {
      fromView: 'graph',
      actionType: 'HIGHLIGHT_DEPENDENCY_CYCLE',
      toView: 'graph',
      guardIds: ['require-symbol-id'],
      description: '순환 참조를 유발하는 루트 심볼 노드와 폐곡선 하이라이트.',
      transformContext: applySelectedSymbol,
    },
    {
      fromView: 'graph',
      actionType: 'INSPECT_ENDPOINT_PROVENANCE',
      toView: 'paths',
      guardIds: ['require-path-pattern'],
      description: '순환 참조에 연루된 엔드포인트/모델 파일의 소스 출처 및 커밋 이력 추적.',
      transformContext: applyPathPattern,
    },
    {
      fromView: 'paths',
      actionType: 'COMPLETE_GOAL',
      toView: 'paths',
      description: '순환 참조 격리 및 리팩터링 계획 확정.',
    },
    {
      fromView: 'paths',
      actionType: 'SELECT_FRAGMENT_SYMBOL',
      toView: 'graph',
      guardIds: ['require-symbol-id'],
      description: '추적 후 그래프로 복귀하여 폐곡선 분리 검증.',
      transformContext: applySelectedSymbol,
    },
  ],
}

export const DEFAULT_SCENARIOS: readonly ScenarioTopicDefinition[] = [
  SPEC_DRIFT_TRIAGE_SCENARIO,
  ENDPOINT_EXPLORATION_SCENARIO,
  BREAKING_IMPACT_ANALYSIS_SCENARIO,
  CIRCULAR_REF_DIAGNOSTIC_SCENARIO,
]

export class ScenarioRegistry {
  private readonly scenarios = new Map<ScenarioTopicId, ScenarioTopicDefinition>()

  constructor(initialScenarios: readonly ScenarioTopicDefinition[] = DEFAULT_SCENARIOS) {
    for (const s of initialScenarios) {
      this.scenarios.set(s.id, s)
    }
  }

  public register(scenario: ScenarioTopicDefinition): void {
    this.scenarios.set(scenario.id, scenario)
  }

  public get(id: ScenarioTopicId): ScenarioTopicDefinition | undefined {
    return this.scenarios.get(id)
  }

  public getAll(): readonly ScenarioTopicDefinition[] {
    return Array.from(this.scenarios.values())
  }

  public has(id: ScenarioTopicId): boolean {
    return this.scenarios.has(id)
  }
}
