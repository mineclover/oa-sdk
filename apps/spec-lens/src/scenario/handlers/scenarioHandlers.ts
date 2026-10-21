import type { DashboardView, LensBehaviorAction, ScenarioTransitionResult } from '@oa-sdk/spec-lens-contract'

export function createScenarioActionHelpers(
  dispatch: (action: LensBehaviorAction) => ScenarioTransitionResult,
) {
  return {
    requestDiff: (baseId: string, headId: string) =>
      dispatch({ type: 'REQUEST_DIFF', baseId, headId }),

    inspectEndpointProvenance: (pathPattern: string) =>
      dispatch({ type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern }),

    selectFragmentSymbol: (symbolId: string) =>
      dispatch({ type: 'SELECT_FRAGMENT_SYMBOL', symbolId }),

    highlightDependencyCycle: (rootSymbolId: string) =>
      dispatch({ type: 'HIGHLIGHT_DEPENDENCY_CYCLE', rootSymbolId }),

    filterBreakingChanges: (onlyBreaking: boolean) =>
      dispatch({ type: 'FILTER_BREAKING_CHANGES', onlyBreaking }),

    selectRevision: (revisionId: string) =>
      dispatch({ type: 'SELECT_REVISION', revisionId }),

    navigateView: (view: DashboardView) =>
      dispatch({ type: 'NAVIGATE_VIEW', view }),

    stepBack: () =>
      dispatch({ type: 'STEP_BACK' }),

    completeGoal: (goalId: string) =>
      dispatch({ type: 'COMPLETE_GOAL', goalId }),
  }
}
