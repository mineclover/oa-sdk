import {
  createInitialScenarioState,
  evaluateTransitionGuards,
  scenarioTransitionReducer,
  type DashboardView,
  type LensBehaviorAction,
  type ScenarioMachineContext,
  type ScenarioRegistry,
  type ScenarioStepProvenance,
  type ScenarioTerminalGoal,
  type ScenarioTopicDefinition,
  type ScenarioTransitionRule,
} from '@oa-sdk/spec-lens-contract'
import type { DashboardUrlPatch, DashboardUrlState } from '../hooks/useUrlState.js'

/*
 * Pure glue between the scenario FSM, the URL and the rendered view.
 *
 * Invariant kept by ScenarioProvider: the URL is derived from the machine
 * (`machineUrlPatch`) whenever the machine moves, and a URL that moves on its
 * own (back/forward, a pasted deep link) is reconciled into the machine
 * (`reconcileMachineWithUrl`). AppShell renders `resolveShellView`, so the
 * rendered view, `machineState.currentView` and the URL stay equal.
 */

export interface ShellView {
  view: DashboardView
  diff: { baseId: string; headId: string } | null
}

/**
 * What the shell renders. Inside a scenario the machine is authoritative (the
 * provider rewrites a diverging URL to match it), so its view is shown directly
 * and never flashes a view the scenario is not in. In free mode the machine
 * follows the URL, so the URL view is shown.
 */
export function resolveShellView(url: DashboardUrlState, machine: ScenarioMachineContext): ShellView {
  if (machine.activeScenarioId !== null) {
    const diff =
      machine.currentView === 'diff' && machine.baseId && machine.headId
        ? { baseId: machine.baseId, headId: machine.headId }
        : null
    return { view: machine.currentView, diff }
  }
  const baseId = url.baseId ?? url.base
  const headId = url.headId ?? url.head
  return { view: url.view, diff: url.view === 'diff' && baseId && headId ? { baseId, headId } : null }
}

/**
 * The machine-owned URL fields for a view in a scenario. A `diff` view without
 * both ids is shown (and written) as `timeline`, as `parseUrlState` reads it.
 */
function urlPatchFor(
  view: DashboardView,
  scenarioId: string | null,
  baseId: string | undefined,
  headId: string | undefined,
): DashboardUrlPatch {
  const shown: DashboardView = view === 'diff' && !(baseId && headId) ? 'timeline' : view
  return {
    view: shown,
    baseId: shown === 'diff' ? baseId : undefined,
    headId: shown === 'diff' ? headId : undefined,
    scenario: scenarioId ?? undefined,
  }
}

/** URL fields owned by the scenario machine. Other URL fields (filters) are left alone. */
export function machineUrlPatch(state: ScenarioMachineContext): DashboardUrlPatch {
  return urlPatchFor(state.currentView, state.activeScenarioId, state.baseId, state.headId)
}

/** The URL a breadcrumb's step was shown under (its view, scenario and recorded diff pair). */
function breadcrumbUrlPatch(step: ScenarioStepProvenance): DashboardUrlPatch {
  return urlPatchFor(step.view, step.scenarioId, step.baseId, step.headId)
}

/** Whether two URLs agree on every machine-owned field. */
function sameMachineUrl(a: DashboardUrlPatch, b: DashboardUrlPatch): boolean {
  return (
    a.view === b.view
    && (a.scenario ?? undefined) === (b.scenario ?? undefined)
    && (a.view !== 'diff' || (a.baseId === b.baseId && a.headId === b.headId))
  )
}

/** Whether the URL already shows exactly what the machine state describes. */
export function machineMatchesUrl(state: ScenarioMachineContext, url: DashboardUrlState): boolean {
  return sameMachineUrl(machineUrlPatch(state), url)
}

function contextSeedFromUrl(url: DashboardUrlState): Partial<ScenarioMachineContext> {
  const seed: Partial<ScenarioMachineContext> = {}
  const baseId = url.baseId ?? url.base
  const headId = url.headId ?? url.head
  const revisionId = url.revisionId ?? url.revision
  if (baseId) seed.baseId = baseId
  if (headId) seed.headId = headId
  if (revisionId) seed.revisionId = revisionId
  if (url.search) seed.pathPattern = url.search
  return seed
}

/**
 * The machine state a page load starts from. A `?scenario=<id>` deep link seeds
 * that scenario; its URL view is kept only when it lies inside the scenario's
 * bounded views (see `createInitialScenarioState`).
 */
export function initialMachineStateFromUrl(
  url: DashboardUrlState,
  registry: ScenarioRegistry,
): ScenarioMachineContext {
  const scenario = url.scenario ? registry.get(url.scenario) : undefined
  return createInitialScenarioState(scenario ?? null, url.view, contextSeedFromUrl(url))
}

function freeModeState(machine: ScenarioMachineContext, url: DashboardUrlState): ScenarioMachineContext {
  return {
    ...machine,
    ...contextSeedFromUrl(url),
    activeScenarioId: null,
    currentView: url.view,
    completedGoals: [],
    breadcrumbs: [],
  }
}

export type UrlReconciliation =
  /** URL and machine already agree. */
  | { kind: 'in-sync' }
  /** The machine follows the URL (the URL is left as it is). */
  | { kind: 'adopt'; state: ScenarioMachineContext }
  /** The machine wins: rewrite the URL (with `replace`) from this state. */
  | { kind: 'restore-url'; state: ScenarioMachineContext }

/**
 * The breadcrumb that the previous browser history entry shows: the nearest
 * earlier step whose URL differs from the machine's current URL. Steps that
 * kept the URL (a goal completion, a self-loop such as
 * `FILTER_BREAKING_CHANGES`) wrote no history entry, so they are skipped.
 * Returns -1 when no earlier step changed the URL.
 */
function previousHistoryStep(machine: ScenarioMachineContext): number {
  const current = machineUrlPatch(machine)
  for (let index = machine.breadcrumbs.length - 2; index >= 0; index--) {
    const step = machine.breadcrumbs[index]
    if (step && !sameMachineUrl(breadcrumbUrlPatch(step), current)) return index
  }
  return -1
}

/**
 * Unwinds the machine to the breadcrumb at `index` with repeated `STEP_BACK`,
 * the same transition the HUD and Diff back buttons dispatch, so "go back to
 * step N" means one thing (view, scenario and the diff pair the step showed)
 * whichever back is used. Returns `null` if the reducer refuses a step.
 */
function unwindTo(
  machine: ScenarioMachineContext,
  index: number,
  registry: ScenarioRegistry,
): ScenarioMachineContext | null {
  let state = machine
  while (state.breadcrumbs.length > index + 1) {
    const back = scenarioTransitionReducer(state, { type: 'STEP_BACK' }, registry)
    if (!back.ok) return null
    state = back.state
  }
  return state
}

/**
 * Decides how a URL change the machine did not make (browser back/forward, an
 * edited or pasted URL) is folded back into the scenario machine.
 *
 * - Inside a scenario, a URL equal to the previous history entry is a browser
 *   back: the machine unwinds with `STEP_BACK` to the latest step shown under
 *   that URL, skipping steps that wrote no history entry (goal completions,
 *   self-loops that kept the URL). This also steps back across a
 *   `SWITCH_SCENARIO` hand-off.
 * - Otherwise a different `scenario=` starts that scenario (or, when unknown,
 *   drops it), and losing `scenario=` returns to free mode on the URL's view.
 * - In free mode the machine simply follows the URL view.
 * - Any other move inside a scenario (forward, a jump past the previous entry,
 *   an edited view) is not a transition the FSM allows, so the URL is restored
 *   to the machine's view.
 */
export function reconcileMachineWithUrl(
  url: DashboardUrlState,
  machine: ScenarioMachineContext,
  registry: ScenarioRegistry,
): UrlReconciliation {
  if (machineMatchesUrl(machine, url)) return { kind: 'in-sync' }

  if (machine.activeScenarioId !== null) {
    const previous = previousHistoryStep(machine)
    const step = previous >= 0 ? machine.breadcrumbs[previous] : undefined
    if (step && sameMachineUrl(breadcrumbUrlPatch(step), url)) {
      const unwound = unwindTo(machine, previous, registry)
      if (unwound) {
        return machineMatchesUrl(unwound, url)
          ? { kind: 'adopt', state: unwound }
          : { kind: 'restore-url', state: unwound }
      }
    }
  }

  const urlScenario = url.scenario ?? null
  if (urlScenario !== machine.activeScenarioId) {
    if (urlScenario === null) {
      return { kind: 'adopt', state: freeModeState(machine, url) }
    }
    const target = registry.get(urlScenario)
    if (!target) {
      return { kind: 'restore-url', state: freeModeState(machine, { ...url, scenario: undefined }) }
    }
    const started = createInitialScenarioState(target, url.view, contextSeedFromUrl(url))
    return machineMatchesUrl(started, url)
      ? { kind: 'adopt', state: started }
      : { kind: 'restore-url', state: started }
  }

  if (machine.activeScenarioId === null) {
    return { kind: 'adopt', state: freeModeState(machine, url) }
  }

  return { kind: 'restore-url', state: machine }
}

/** Goals that can be completed from the machine's current view. */
export function availableGoalsFor(
  scenario: ScenarioTopicDefinition | null,
  machine: ScenarioMachineContext,
): readonly ScenarioTerminalGoal[] {
  if (!scenario) return []
  return scenario.terminalGoals.filter((g) => g.targetView === machine.currentView)
}

/**
 * What the current view has selected, published by the views so a scenario
 * step can carry it as its action payload.
 */
export interface ScenarioSelection {
  baseId?: string | undefined
  headId?: string | undefined
  revisionId?: string | undefined
  pathPattern?: string | undefined
  symbolId?: string | undefined
}

export interface ScenarioIntent {
  readonly rule: ScenarioTransitionRule
  /** The concrete action to dispatch, or `null` when the payload is missing. */
  readonly action: LensBehaviorAction | null
  /** Why the step cannot run now (missing selection or a failing guard). */
  readonly blockedReason?: string | undefined
}

const PAYLOAD_HINTS: Partial<Record<LensBehaviorAction['type'], string>> = {
  REQUEST_DIFF: '비교할 두 리비전을 선택하세요 (Timeline).',
  INSPECT_ENDPOINT_PROVENANCE: '추적할 엔드포인트 경로를 선택하세요 (Diff 항목 또는 그래프 노드).',
  SELECT_FRAGMENT_SYMBOL: '대상 스키마 심볼을 선택하세요 (엔드포인트 행, Diff 컴포넌트 항목 또는 그래프 노드).',
  HIGHLIGHT_DEPENDENCY_CYCLE: '순환 고리의 루트 심볼 노드를 그래프에서 선택하세요.',
  SELECT_REVISION: '검토할 리비전을 선택하세요.',
}

/** Builds the action a rule needs from the current selection, falling back to the machine context. */
function actionForRule(
  rule: ScenarioTransitionRule,
  machine: ScenarioMachineContext,
  selection: ScenarioSelection,
): LensBehaviorAction | null {
  switch (rule.actionType) {
    case 'REQUEST_DIFF': {
      const baseId = selection.baseId ?? machine.baseId
      const headId = selection.headId ?? machine.headId
      return baseId && headId ? { type: 'REQUEST_DIFF', baseId, headId } : null
    }
    case 'INSPECT_ENDPOINT_PROVENANCE': {
      const pathPattern = selection.pathPattern ?? machine.pathPattern
      return pathPattern ? { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern } : null
    }
    case 'SELECT_FRAGMENT_SYMBOL': {
      const symbolId = selection.symbolId ?? machine.selectedSymbol
      return symbolId ? { type: 'SELECT_FRAGMENT_SYMBOL', symbolId } : null
    }
    case 'HIGHLIGHT_DEPENDENCY_CYCLE': {
      const rootSymbolId = selection.symbolId ?? machine.selectedSymbol
      return rootSymbolId ? { type: 'HIGHLIGHT_DEPENDENCY_CYCLE', rootSymbolId } : null
    }
    case 'SELECT_REVISION': {
      const revisionId = selection.revisionId ?? machine.revisionId ?? machine.headId
      return revisionId ? { type: 'SELECT_REVISION', revisionId } : null
    }
    case 'FILTER_BREAKING_CHANGES':
      return { type: 'FILTER_BREAKING_CHANGES', onlyBreaking: !(machine.onlyBreaking ?? false) }
    case 'NAVIGATE_VIEW':
      return { type: 'NAVIGATE_VIEW', view: rule.toView }
    case 'STEP_BACK':
      return { type: 'STEP_BACK' }
    default:
      // START/SWITCH_SCENARIO and COMPLETE_GOAL are driven by the selector and goal CTA.
      return null
  }
}

const NON_STEP_ACTIONS: ReadonlySet<LensBehaviorAction['type']> = new Set([
  'COMPLETE_GOAL',
  'START_SCENARIO',
  'SWITCH_SCENARIO',
])

/**
 * The scenario steps available from the current view, each resolved to a
 * dispatchable action when the selection (or context) supplies its payload and
 * its guards accept it. Works for any scenario definition, not just the defaults.
 */
export function resolveScenarioIntents(
  scenario: ScenarioTopicDefinition | null,
  machine: ScenarioMachineContext,
  selection: ScenarioSelection,
): ScenarioIntent[] {
  if (!scenario) return []
  return scenario.transitions
    .filter((rule) => rule.fromView === machine.currentView && !NON_STEP_ACTIONS.has(rule.actionType))
    .map((rule) => {
      const action = actionForRule(rule, machine, selection)
      if (!action) {
        return { rule, action: null, blockedReason: PAYLOAD_HINTS[rule.actionType] ?? '필요한 선택이 없습니다.' }
      }
      const guards = evaluateTransitionGuards(scenario, rule, machine, action)
      return guards.ok ? { rule, action } : { rule, action, blockedReason: guards.reason }
    })
}

/** Selection published by a Path Provenance row. Graph node ids are canonical ids. */
export function selectionFromPathEntry(entry: { path: string; canonicalId: string }): ScenarioSelection {
  return { pathPattern: entry.path, symbolId: entry.canonicalId }
}

/**
 * Selection published by a Fragment Graph node. The node's local name doubles
 * as the endpoint search pattern, so graph -> paths lists the endpoints whose
 * path mentions that model.
 */
export function selectionFromGraphNode(node: { id: string; localName: string }): ScenarioSelection {
  return { symbolId: node.id, pathPattern: node.localName }
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

/**
 * Selection published by a Diff entry, from its JSON Pointer: a `/paths/<path>`
 * pointer selects that endpoint path, a `/components/<kind>/<name>` pointer
 * selects that component symbol.
 */
export function selectionFromDiffPointer(pointer: string): ScenarioSelection {
  const segments = pointer.replace(/^#/, '').split('/').filter((s) => s.length > 0)
  if (segments[0] === 'paths' && segments[1]) {
    return { pathPattern: decodePointerSegment(segments[1]) }
  }
  if (segments[0] === 'components' && segments[2]) {
    return { symbolId: decodePointerSegment(segments[2]) }
  }
  return {}
}
