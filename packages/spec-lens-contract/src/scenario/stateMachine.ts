import type {
  DashboardView,
  LensBehaviorAction,
  ScenarioGuardEvaluationResult,
  ScenarioMachineContext,
  ScenarioStepProvenance,
  ScenarioTopicDefinition,
  ScenarioTopicId,
  ScenarioTransitionRule,
} from './types.js'
import { ScenarioRegistry } from './definitions.js'

export interface ScenarioTransitionResult {
  ok: boolean
  state: ScenarioMachineContext
  error?: string
  transitionApplied?: ScenarioTransitionRule
}

export function createInitialScenarioState(
  scenario?: ScenarioTopicDefinition | ScenarioTopicId | null,
  initialView: DashboardView = 'timeline',
  seedContext?: Partial<ScenarioMachineContext>,
): ScenarioMachineContext {
  const scenarioId = typeof scenario === 'object' && scenario !== null ? scenario.id : scenario ?? null
  const originBreadcrumbs: ScenarioStepProvenance[] = scenarioId
    ? [
        {
          stepNumber: 1,
          scenarioId,
          view: initialView,
          actionType: 'START_SCENARIO',
          timestamp: Date.now(),
          summary: `시작: ${initialView}`,
        },
      ]
    : []

  return {
    activeScenarioId: scenarioId,
    currentView: initialView,
    breadcrumbs: seedContext?.breadcrumbs ?? originBreadcrumbs,
    completedGoals: [],
    ...seedContext,
  }
}

export function scenarioTransitionReducer(
  state: ScenarioMachineContext,
  action: LensBehaviorAction,
  registry: ScenarioRegistry = new ScenarioRegistry(),
): ScenarioTransitionResult {
  // 1. Direct START_SCENARIO
  if (action.type === 'START_SCENARIO') {
    const target = registry.get(action.scenarioId)
    if (!target) {
      return {
        ok: false,
        state,
        error: `Unknown scenario ID: "${action.scenarioId}"`,
      }
    }

    const nextState: ScenarioMachineContext = {
      ...state,
      ...action.initialContext,
      activeScenarioId: target.id,
      currentView: target.initialView,
      completedGoals: [],
      breadcrumbs: [
        {
          stepNumber: 1,
          scenarioId: target.id,
          view: target.initialView,
          actionType: action.type,
          timestamp: Date.now(),
          summary: `시나리오 "${target.title}" 시작 (${target.initialView})`,
        },
      ],
    }

    return { ok: true, state: nextState }
  }

  // 2. SWITCH_SCENARIO (Hand-off)
  if (action.type === 'SWITCH_SCENARIO') {
    const target = registry.get(action.targetScenarioId)
    if (!target) {
      return {
        ok: false,
        state,
        error: `Cannot switch to unknown scenario: "${action.targetScenarioId}"`,
      }
    }

    const nextBreadcrumb: ScenarioStepProvenance = {
      stepNumber: state.breadcrumbs.length + 1,
      scenarioId: target.id,
      view: target.initialView,
      actionType: action.type,
      timestamp: Date.now(),
      summary: `시나리오 전환 -> "${target.title}" (${target.initialView})`,
    }

    const nextState: ScenarioMachineContext = {
      ...state,
      ...action.handoffContext,
      activeScenarioId: target.id,
      currentView: target.initialView,
      completedGoals: [],
      breadcrumbs: [...state.breadcrumbs, nextBreadcrumb],
    }

    return { ok: true, state: nextState }
  }

  // 3. STEP_BACK (Provenance Stack Unwind)
  if (action.type === 'STEP_BACK') {
    if (state.breadcrumbs.length <= 1) {
      return {
        ok: false,
        state,
        error: 'Cannot step back: at scenario origin',
      }
    }

    const newBreadcrumbs = state.breadcrumbs.slice(0, -1)
    const prevProvenance = newBreadcrumbs[newBreadcrumbs.length - 1]
    if (!prevProvenance) {
      return {
        ok: false,
        state,
        error: 'Cannot step back: at scenario origin',
      }
    }

    const nextState: ScenarioMachineContext = {
      ...state,
      currentView: prevProvenance.view,
      activeScenarioId: prevProvenance.scenarioId as ScenarioTopicId,
      breadcrumbs: newBreadcrumbs,
    }

    return { ok: true, state: nextState }
  }

  // 4. Free Mode or Navigation without active scenario
  if (!state.activeScenarioId) {
    if (action.type === 'NAVIGATE_VIEW') {
      const nextState: ScenarioMachineContext = {
        ...state,
        currentView: action.view,
      }
      return { ok: true, state: nextState }
    }

    if (action.type === 'REQUEST_DIFF') {
      return {
        ok: true,
        state: {
          ...state,
          currentView: 'diff',
          baseId: action.baseId,
          headId: action.headId,
        },
      }
    }

    return {
      ok: true,
      state: {
        ...state,
        currentView: (action as { view?: DashboardView }).view ?? state.currentView,
      },
    }
  }

  // 5. Active Scenario Rules & Guard Evaluation
  const activeScenario = registry.get(state.activeScenarioId)
  if (!activeScenario) {
    return {
      ok: false,
      state,
      error: `Active scenario "${state.activeScenarioId}" not found in registry`,
    }
  }

  // Goal completion
  if (action.type === 'COMPLETE_GOAL') {
    const goal = activeScenario.terminalGoals.find((g) => g.id === action.goalId)
    if (!goal) {
      return {
        ok: false,
        state,
        error: `Goal "${action.goalId}" does not exist in scenario "${activeScenario.id}"`,
      }
    }

    if (state.currentView !== goal.targetView) {
      return {
        ok: false,
        state,
        error: `Cannot complete goal "${goal.id}" from view "${state.currentView}". Required target view: "${goal.targetView}"`,
      }
    }

    const completed = Array.from(new Set([...state.completedGoals, goal.id]))
    const nextBreadcrumb: ScenarioStepProvenance = {
      stepNumber: state.breadcrumbs.length + 1,
      scenarioId: activeScenario.id,
      view: state.currentView,
      actionType: action.type,
      timestamp: Date.now(),
      summary: `목표 달성: ${goal.description}`,
    }

    return {
      ok: true,
      state: {
        ...state,
        completedGoals: completed,
        breadcrumbs: [...state.breadcrumbs, nextBreadcrumb],
      },
    }
  }

  // Find matching transition rule
  const rule = activeScenario.transitions.find(
    (t) => t.fromView === state.currentView && t.actionType === action.type,
  )

  if (!rule) {
    return {
      ok: false,
      state,
      error: `Action "${action.type}" is not permitted from view "${state.currentView}" within scenario "${activeScenario.id}"`,
    }
  }

  // Evaluate Guards
  if (rule.guardIds && rule.guardIds.length > 0) {
    for (const guardId of rule.guardIds) {
      const guard = activeScenario.guards?.[guardId]
      if (!guard) {
        return {
          ok: false,
          state,
          error: `Guard "${guardId}" declared on transition but not found in scenario guards`,
        }
      }

      const evalResult = guard.evaluate(state, action)
      const passed = typeof evalResult === 'boolean' ? evalResult : evalResult.ok
      if (!passed) {
        const reason =
          typeof evalResult === 'object' && evalResult.reason
            ? evalResult.reason
            : `Guard "${guardId}" condition failed`
        return {
          ok: false,
          state,
          error: reason,
        }
      }
    }
  }

  // Apply context mutation if specified
  const transformed = rule.transformContext ? rule.transformContext(state, action) : {}

  const nextBreadcrumb: ScenarioStepProvenance = {
    stepNumber: state.breadcrumbs.length + 1,
    scenarioId: activeScenario.id,
    view: rule.toView,
    actionType: action.type,
    timestamp: Date.now(),
    summary: rule.description ?? `${state.currentView} -> ${rule.toView}`,
  }

  const nextState: ScenarioMachineContext = {
    ...state,
    ...transformed,
    currentView: rule.toView,
    breadcrumbs: [...state.breadcrumbs, nextBreadcrumb],
  }

  return {
    ok: true,
    state: nextState,
    transitionApplied: rule,
  }
}
