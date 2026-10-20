import type {
  DashboardView,
  LensBehaviorAction,
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

/**
 * Resolves the view a scenario starts in.
 *
 * With a scenario definition, a requested view is honoured only when it lies
 * inside the scenario's `boundedViews`; otherwise the scenario's own
 * `initialView` is used, so a deep link such as `?scenario=<id>` (whose URL view
 * defaults to `timeline`) never seeds the machine in a view the scenario has no
 * transitions from. Without a definition (free mode, or a bare scenario ID that
 * cannot be looked up here) the requested view is used, defaulting to `timeline`.
 */
export function resolveScenarioInitialView(
  definition: ScenarioTopicDefinition | undefined,
  requestedView?: DashboardView,
): DashboardView {
  if (!definition) return requestedView ?? 'timeline'
  return requestedView !== undefined && definition.boundedViews.includes(requestedView)
    ? requestedView
    : definition.initialView
}

/**
 * The revision pair a step on `view` shows: only a `diff` view with both ids
 * has one. Read from the context when a breadcrumb is recorded, and from the
 * breadcrumb itself when `STEP_BACK` returns to it.
 */
function diffPairShown(
  view: DashboardView,
  context: Pick<ScenarioMachineContext, 'baseId' | 'headId'> | undefined,
): Pick<ScenarioStepProvenance, 'baseId' | 'headId'> {
  return view === 'diff' && context?.baseId && context.headId
    ? { baseId: context.baseId, headId: context.headId }
    : {}
}

export function createInitialScenarioState(
  scenario?: ScenarioTopicDefinition | ScenarioTopicId | null,
  requestedView?: DashboardView,
  seedContext?: Partial<ScenarioMachineContext>,
): ScenarioMachineContext {
  const definition = typeof scenario === 'object' && scenario !== null ? scenario : undefined
  const scenarioId: ScenarioTopicId | null =
    typeof scenario === 'object' && scenario !== null ? scenario.id : scenario ?? null
  const initialView = resolveScenarioInitialView(definition, requestedView)
  const originBreadcrumbs: ScenarioStepProvenance[] = scenarioId
    ? [
        {
          stepNumber: 1,
          scenarioId,
          view: initialView,
          actionType: 'START_SCENARIO',
          timestamp: Date.now(),
          summary: `시작: ${initialView}`,
          ...diffPairShown(initialView, seedContext),
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

/** Outcome of {@link evaluateTransitionGuards}: a failure always carries a reason. */
export type ScenarioGuardCheck = { ok: true } | { ok: false; reason: string }

/**
 * Evaluates every guard a transition rule declares, in order, against the
 * current context and the action. Stops at the first failure. A guard ID with
 * no declaration in `scenario.guards` fails closed. The reducer uses this, and
 * a UI can call it to pre-check whether a transition would be accepted.
 */
export function evaluateTransitionGuards(
  scenario: ScenarioTopicDefinition,
  rule: ScenarioTransitionRule,
  state: ScenarioMachineContext,
  action: LensBehaviorAction,
): ScenarioGuardCheck {
  for (const guardId of rule.guardIds ?? []) {
    const guard = scenario.guards?.[guardId]
    if (!guard) {
      return { ok: false, reason: `Guard "${guardId}" declared on transition but not found in scenario guards` }
    }

    const evalResult = guard.evaluate(state, action)
    const passed = typeof evalResult === 'boolean' ? evalResult : evalResult.ok
    if (!passed) {
      const reason =
        typeof evalResult === 'object' && evalResult.reason
          ? evalResult.reason
          : `Guard "${guardId}" condition failed`
      return { ok: false, reason }
    }
  }
  return { ok: true }
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

    const context: ScenarioMachineContext = { ...state, ...action.initialContext }
    const nextState: ScenarioMachineContext = {
      ...context,
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
          ...diffPairShown(target.initialView, context),
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

    const context: ScenarioMachineContext = { ...state, ...action.handoffContext }
    const nextBreadcrumb: ScenarioStepProvenance = {
      stepNumber: state.breadcrumbs.length + 1,
      scenarioId: target.id,
      view: target.initialView,
      actionType: action.type,
      timestamp: Date.now(),
      summary: `시나리오 전환 -> "${target.title}" (${target.initialView})`,
      ...diffPairShown(target.initialView, context),
    }

    const nextState: ScenarioMachineContext = {
      ...context,
      activeScenarioId: target.id,
      currentView: target.initialView,
      completedGoals: [],
      breadcrumbs: [...state.breadcrumbs, nextBreadcrumb],
    }

    return { ok: true, state: nextState }
  }

  // 3. STEP_BACK (Provenance Stack Unwind): return to the previous breadcrumb's
  // step, i.e. its view and scenario and, for a diff step that recorded one, the
  // revision pair it showed. Other context fields are kept as they are.
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
      ...diffPairShown(prevProvenance.view, prevProvenance),
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
      ...diffPairShown(state.currentView, state),
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
  const guardResult = evaluateTransitionGuards(activeScenario, rule, state, action)
  if (!guardResult.ok) {
    return {
      ok: false,
      state,
      error: guardResult.reason,
    }
  }

  // Apply context mutation if specified
  const transformed = rule.transformContext ? rule.transformContext(state, action) : {}

  const context: ScenarioMachineContext = { ...state, ...transformed }
  const nextBreadcrumb: ScenarioStepProvenance = {
    stepNumber: state.breadcrumbs.length + 1,
    scenarioId: activeScenario.id,
    view: rule.toView,
    actionType: action.type,
    timestamp: Date.now(),
    summary: rule.description ?? `${state.currentView} -> ${rule.toView}`,
    ...diffPairShown(rule.toView, context),
  }

  const nextState: ScenarioMachineContext = {
    ...context,
    currentView: rule.toView,
    breadcrumbs: [...state.breadcrumbs, nextBreadcrumb],
  }

  return {
    ok: true,
    state: nextState,
    transitionApplied: rule,
  }
}
