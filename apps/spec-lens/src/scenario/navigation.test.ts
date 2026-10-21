import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCENARIOS,
  ScenarioFlowEnumerator,
  ScenarioRegistry,
  applyDiffPair,
  createInitialScenarioState,
  scenarioTransitionReducer,
  type FlowStep,
  type LensBehaviorAction,
  type ScenarioMachineContext,
  type ScenarioTopicDefinition,
} from '@oa-sdk/spec-lens-contract'
import { applyUrlStatePatch, parseUrlState, serializeUrlState } from '../hooks/useUrlState.js'
import {
  availableGoalsFor,
  initialMachineStateFromUrl,
  machineMatchesUrl,
  machineUrlPatch,
  reconcileMachineWithUrl,
  resolveScenarioIntents,
  resolveShellView,
  selectionFromDiffPointer,
  selectionFromGraphNode,
  selectionFromPathEntry,
  type ScenarioSelection,
} from './navigation.js'

const registry = new ScenarioRegistry(DEFAULT_SCENARIOS)

// What each view publishes when the user picks something in it (the same helpers AppShell uses).
const PATH_ROW = { path: '/users/{id}', canonicalId: 'path:public/users/getUser' }
const GRAPH_NODE = { id: 'schema:public/users/User', localName: 'User' }
const DIFF_PATH_POINTER = '#/paths/~1users~1{id}/get'
const DIFF_COMPONENT_POINTER = '#/components/schemas/User'

function selectionPublishedBy(step: FlowStep): ScenarioSelection {
  switch (step.from) {
    case 'paths':
      return selectionFromPathEntry(PATH_ROW)
    case 'graph':
      return selectionFromGraphNode(GRAPH_NODE)
    case 'diff':
      return selectionFromDiffPointer(
        step.action === 'INSPECT_ENDPOINT_PROVENANCE' ? DIFF_PATH_POINTER : DIFF_COMPONENT_POINTER,
      )
    default:
      return {}
  }
}

function dispatch(state: ScenarioMachineContext, action: LensBehaviorAction): ScenarioMachineContext {
  const res = scenarioTransitionReducer(state, action, registry)
  expect(res.ok, `${action.type}: ${res.error ?? ''}`).toBe(true)
  return res.state
}

function urlFor(state: ScenarioMachineContext): string {
  return serializeUrlState(applyUrlStatePatch({ view: 'timeline' }, machineUrlPatch(state)), '')
}

/** Drives one scenario along a terminal path the way the UI does, and returns the end state. */
function driveThroughUi(scenario: ScenarioTopicDefinition, steps: readonly FlowStep[]): ScenarioMachineContext {
  let state = dispatch(createInitialScenarioState(), { type: 'START_SCENARIO', scenarioId: scenario.id })
  for (const step of steps) {
    if (step.action === 'COMPLETE_GOAL') {
      // The HUD goal CTA: offered on the goal view, completes the goal in place.
      const [goal] = availableGoalsFor(scenario, state)
      expect(goal, `${scenario.id}: no goal CTA on ${state.currentView}`).toBeDefined()
      state = dispatch(state, { type: 'COMPLETE_GOAL', goalId: goal!.id })
      expect(state.currentView).toBe(step.to)
      continue
    }
    if (step.from === 'timeline' && step.action === 'REQUEST_DIFF') {
      // Timeline's onSelectDiff dispatches REQUEST_DIFF directly.
      state = dispatch(state, { type: 'REQUEST_DIFF', baseId: 'rev-a', headId: 'rev-b' })
      continue
    }
    // Every other step is a HUD "next step" whose payload comes from the view's selection.
    const intents = resolveScenarioIntents(scenario, state, selectionPublishedBy(step))
    const intent = intents.find((i) => i.rule.actionType === step.action && i.rule.toView === step.to)
    expect(intent, `${scenario.id}: no step ${step.from} -${step.action}-> ${step.to}`).toBeDefined()
    expect(intent!.blockedReason).toBeUndefined()
    state = dispatch(state, intent!.action!)
    expect(state.currentView).toBe(step.to)
  }
  return state
}

describe('Scenario goals are reachable through the UI handlers', () => {
  describe.each(DEFAULT_SCENARIOS)('$id', (scenario) => {
    const analysis = ScenarioFlowEnumerator.enumerate(scenario)

    it('has at least one terminal path to drive', () => {
      expect(analysis.terminalPaths.length).toBeGreaterThan(0)
    })

    it.each(analysis.terminalPaths.map((p, i) => ({ i, path: p })))('terminal path #$i reaches its goal', ({ path }) => {
      const state = driveThroughUi(scenario, path.steps)
      const goal = scenario.terminalGoals.find((g) => g.id === path.reachedGoal)!

      // Machine, rendered view and URL agree on the goal view, with the scenario in the URL.
      expect(state.currentView).toBe(goal.targetView)
      const url = parseUrlState(urlFor(state))
      expect(machineMatchesUrl(state, url)).toBe(true)
      expect(resolveShellView(url, state).view).toBe(goal.targetView)
      expect(url.scenario).toBe(scenario.id)

      // The completion CTA is offered and completing it succeeds.
      expect(availableGoalsFor(scenario, state).map((g) => g.id)).toContain(goal.id)
      const done = dispatch(state, { type: 'COMPLETE_GOAL', goalId: goal.id })
      expect(done.completedGoals).toContain(goal.id)
    })
  })
})

describe('machineUrlPatch', () => {
  it('writes view, scenario and the diff pair in one patch', () => {
    const state = createInitialScenarioState(registry.get('spec-drift-triage'), 'diff', { baseId: 'a', headId: 'b' })
    expect(urlFor(state)).toBe('?scenario=spec-drift-triage&view=diff&base=a&head=b')
  })

  it('drops the scenario and diff ids in free mode off the diff view', () => {
    expect(urlFor(createInitialScenarioState(null, 'graph', { baseId: 'a', headId: 'b' }))).toBe('?view=graph')
  })
})

describe('reconcileMachineWithUrl', () => {
  it('rewrites a deep link whose view is outside the scenario to the scenario initial view', () => {
    const url = parseUrlState('?scenario=endpoint-exploration')
    const machine = initialMachineStateFromUrl(url, registry)
    expect(machine.currentView).toBe('paths')
    // The shell shows the scenario view immediately, not the URL default.
    expect(resolveShellView(url, machine).view).toBe('paths')

    const decision = reconcileMachineWithUrl(url, machine, registry)
    expect(decision.kind).toBe('restore-url')
    expect(decision.kind !== 'in-sync' && urlFor(decision.state)).toBe('?scenario=endpoint-exploration&view=paths')
  })

  it('treats browser back to the previous breadcrumb view as STEP_BACK', () => {
    let machine = initialMachineStateFromUrl(parseUrlState('?scenario=endpoint-exploration&view=paths'), registry)
    machine = dispatch(machine, { type: 'SELECT_FRAGMENT_SYMBOL', symbolId: 'User' })
    expect(machine.currentView).toBe('graph')

    const decision = reconcileMachineWithUrl(parseUrlState('?scenario=endpoint-exploration&view=paths'), machine, registry)
    expect(decision.kind).toBe('adopt')
    expect(decision.kind === 'adopt' && decision.state.currentView).toBe('paths')
    expect(decision.kind === 'adopt' && decision.state.breadcrumbs).toHaveLength(1)
  })

  it('restores the URL when it moves to a view the FSM cannot reach from here', () => {
    const machine = initialMachineStateFromUrl(parseUrlState('?scenario=endpoint-exploration&view=paths'), registry)
    const decision = reconcileMachineWithUrl(parseUrlState('?scenario=endpoint-exploration&view=graph'), machine, registry)
    expect(decision).toEqual({ kind: 'restore-url', state: machine })
  })

  it('starts the scenario named by a changed URL and leaves free mode when it is removed', () => {
    const free = createInitialScenarioState(null, 'timeline')
    const started = reconcileMachineWithUrl(parseUrlState('?scenario=circular-ref-diagnostic&view=graph'), free, registry)
    expect(started.kind).toBe('adopt')
    expect(started.kind === 'adopt' && started.state.activeScenarioId).toBe('circular-ref-diagnostic')

    const active = initialMachineStateFromUrl(parseUrlState('?scenario=circular-ref-diagnostic&view=graph'), registry)
    const left = reconcileMachineWithUrl(parseUrlState('?view=graph'), active, registry)
    expect(left.kind).toBe('adopt')
    expect(left.kind === 'adopt' && left.state.activeScenarioId).toBeNull()
    expect(left.kind === 'adopt' && left.state.breadcrumbs).toEqual([])
  })

  it('drops an unknown scenario from the URL', () => {
    const free = createInitialScenarioState(null, 'paths')
    const decision = reconcileMachineWithUrl(parseUrlState('?scenario=nope&view=paths'), free, registry)
    expect(decision.kind).toBe('restore-url')
    expect(decision.kind !== 'in-sync' && urlFor(decision.state)).toBe('?view=paths')
  })

  it('lets the free-mode machine follow the URL view', () => {
    const free = createInitialScenarioState(null, 'timeline')
    const decision = reconcileMachineWithUrl(parseUrlState('?view=diff&base=a&head=b'), free, registry)
    expect(decision.kind).toBe('adopt')
    expect(decision.kind === 'adopt' && decision.state).toMatchObject({ currentView: 'diff', baseId: 'a', headId: 'b' })
  })

  it('is in sync when the URL already shows the machine state', () => {
    const machine = initialMachineStateFromUrl(parseUrlState('?scenario=spec-drift-triage'), registry)
    expect(reconcileMachineWithUrl(parseUrlState('?scenario=spec-drift-triage'), machine, registry)).toEqual({ kind: 'in-sync' })
  })
})

describe('reconcileMachineWithUrl: browser back over steps that wrote no history entry', () => {
  /**
   * Runs the actions from `start` and returns every state with the browser
   * history the provider leaves behind: one entry per URL change (the URL store
   * skips no-op writes, so a step that keeps the URL adds no entry).
   */
  function run(start: ScenarioMachineContext, actions: readonly LensBehaviorAction[], reg = registry) {
    const states = [start]
    for (const action of actions) {
      const res = scenarioTransitionReducer(states[states.length - 1]!, action, reg)
      expect(res.ok, `${action.type}: ${res.error ?? ''}`).toBe(true)
      states.push(res.state)
    }
    const history: string[] = []
    for (const state of states) {
      const url = urlFor(state)
      if (history[history.length - 1] !== url) history.push(url)
    }
    return { states, history }
  }

  /** Browser back pops the last history entry; the machine must land on the latest state that showed it. */
  function expectBackAdoptsPreviousEntry(states: readonly ScenarioMachineContext[], history: readonly string[], reg = registry) {
    const previous = history[history.length - 2]!
    const expected = [...states].reverse().find((s) => urlFor(s) === previous)!
    const decision = reconcileMachineWithUrl(parseUrlState(previous), states[states.length - 1]!, reg)

    expect(decision.kind).toBe('adopt')
    if (decision.kind !== 'adopt') return
    expect(urlFor(decision.state)).toBe(previous)
    expect(decision.state.currentView).toBe(expected.currentView)
    expect(decision.state.activeScenarioId).toBe(expected.activeScenarioId)
    expect(decision.state.breadcrumbs).toEqual(expected.breadcrumbs)
  }

  const fromUrl = (search: string) => initialMachineStateFromUrl(parseUrlState(search), registry)

  it('steps back over a goal completion (endpoint-exploration: paths -> graph -> goal)', () => {
    const { states, history } = run(fromUrl('?scenario=endpoint-exploration&view=paths'), [
      { type: 'SELECT_FRAGMENT_SYMBOL', symbolId: 'User' },
      { type: 'COMPLETE_GOAL', goalId: 'contract-verified' },
    ])
    expect(history).toEqual(['?scenario=endpoint-exploration&view=paths', '?scenario=endpoint-exploration&view=graph'])
    expectBackAdoptsPreviousEntry(states, history)
  })

  it('steps back over a self-loop that kept the URL (breaking-impact-analysis: FILTER_BREAKING_CHANGES)', () => {
    const { states, history } = run(fromUrl('?scenario=breaking-impact-analysis'), [
      { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
      { type: 'FILTER_BREAKING_CHANGES', onlyBreaking: true },
      { type: 'FILTER_BREAKING_CHANGES', onlyBreaking: false },
    ])
    expect(history).toHaveLength(2)
    expectBackAdoptsPreviousEntry(states, history)
  })

  it('lands on the latest step that showed the previous URL (circular-ref-diagnostic: graph self-loop)', () => {
    const { states, history } = run(fromUrl('?scenario=circular-ref-diagnostic&view=graph'), [
      { type: 'HIGHLIGHT_DEPENDENCY_CYCLE', rootSymbolId: 'Node' },
      { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: 'Node' },
      { type: 'COMPLETE_GOAL', goalId: 'cycle-isolated' },
    ])
    expectBackAdoptsPreviousEntry(states, history)
  })

  it('treats a same-view step that changed the diff pair as its own history entry', () => {
    const base = registry.get('breaking-impact-analysis')!
    const rediff: ScenarioTopicDefinition = {
      ...base,
      id: 'rediff',
      transitions: [
        ...base.transitions,
        { fromView: 'diff', actionType: 'REQUEST_DIFF', toView: 'diff', transformContext: applyDiffPair },
      ],
    }
    const reg = new ScenarioRegistry([rediff])
    const start = createInitialScenarioState(rediff)
    const { states, history } = run(start, [
      { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
      { type: 'REQUEST_DIFF', baseId: 'c', headId: 'd' },
      { type: 'FILTER_BREAKING_CHANGES', onlyBreaking: true },
    ], reg)
    expect(history).toEqual(['?scenario=rediff', '?scenario=rediff&view=diff&base=a&head=b', '?scenario=rediff&view=diff&base=c&head=d'])
    expectBackAdoptsPreviousEntry(states, history, reg)
  })

  it('steps back across a SWITCH_SCENARIO hand-off into the previous scenario', () => {
    const { states, history } = run(fromUrl('?scenario=spec-drift-triage'), [
      { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
      { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: '/users' },
      { type: 'COMPLETE_GOAL', goalId: 'drift-resolved' },
      { type: 'SWITCH_SCENARIO', targetScenarioId: 'breaking-impact-analysis' },
    ])
    expect(history.slice(-2)).toEqual(['?scenario=spec-drift-triage&view=paths', '?scenario=breaking-impact-analysis'])
    expectBackAdoptsPreviousEntry(states, history)
  })

  it('still restores the URL when it jumps past the previous history entry', () => {
    const { states, history } = run(fromUrl('?scenario=spec-drift-triage'), [
      { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
      { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: '/users' },
    ])
    const machine = states[states.length - 1]!
    const decision = reconcileMachineWithUrl(parseUrlState(history[0]!), machine, registry)
    expect(decision).toEqual({ kind: 'restore-url', state: machine })
  })
})

describe('resolveScenarioIntents', () => {
  const drift = registry.get('spec-drift-triage')!

  it('lists the non-goal transitions of the current view and blocks those without a payload', () => {
    const machine = dispatch(createInitialScenarioState(), { type: 'START_SCENARIO', scenarioId: drift.id })
    const intents = resolveScenarioIntents(drift, machine, {})
    expect(intents.map((i) => i.rule.actionType)).toEqual(['REQUEST_DIFF'])
    expect(intents[0]!.action).toBeNull()
    expect(intents[0]!.blockedReason).toBeTruthy()
  })

  it('reports a failing guard instead of offering the step', () => {
    const machine = dispatch(createInitialScenarioState(), { type: 'START_SCENARIO', scenarioId: drift.id })
    const [intent] = resolveScenarioIntents(drift, machine, { baseId: 'same', headId: 'same' })
    expect(intent!.action).toEqual({ type: 'REQUEST_DIFF', baseId: 'same', headId: 'same' })
    expect(intent!.blockedReason).toContain('distinct')
  })

  it('never lists COMPLETE_GOAL (the goal CTA owns it) and is empty in free mode', () => {
    let machine = dispatch(createInitialScenarioState(), { type: 'START_SCENARIO', scenarioId: drift.id })
    machine = dispatch(machine, { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' })
    machine = dispatch(machine, { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: '/x' })
    expect(resolveScenarioIntents(drift, machine, {}).map((i) => i.rule.actionType)).not.toContain('COMPLETE_GOAL')
    expect(resolveScenarioIntents(null, machine, {})).toEqual([])
  })

  it('falls back to the context for re-entry steps (paths -> diff reuses the last pair)', () => {
    let machine = dispatch(createInitialScenarioState(), { type: 'START_SCENARIO', scenarioId: drift.id })
    machine = dispatch(machine, { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' })
    machine = dispatch(machine, { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: '/x' })
    const back = resolveScenarioIntents(drift, machine, {}).find((i) => i.rule.actionType === 'REQUEST_DIFF')
    expect(back?.action).toEqual({ type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' })
  })
})

describe('selection helpers', () => {
  it('derives an endpoint path or a component symbol from a diff pointer', () => {
    expect(selectionFromDiffPointer('#/paths/~1users~1{id}/get')).toEqual({ pathPattern: '/users/{id}' })
    expect(selectionFromDiffPointer('/components/schemas/User/properties/id')).toEqual({ symbolId: 'User' })
    expect(selectionFromDiffPointer('#/info/title')).toEqual({})
  })

  it('maps path rows and graph nodes to scenario payloads', () => {
    expect(selectionFromPathEntry(PATH_ROW)).toEqual({ pathPattern: '/users/{id}', symbolId: 'path:public/users/getUser' })
    expect(selectionFromGraphNode(GRAPH_NODE)).toEqual({ symbolId: 'schema:public/users/User', pathPattern: 'User' })
  })
})

describe('resolveShellView', () => {
  it('renders the URL view in free mode and the machine view inside a scenario', () => {
    const url = parseUrlState('?view=diff&base=a&head=b')
    expect(resolveShellView(url, createInitialScenarioState(null, 'timeline'))).toEqual({
      view: 'diff',
      diff: { baseId: 'a', headId: 'b' },
    })
    const machine = createInitialScenarioState(registry.get('spec-drift-triage'), 'diff', { baseId: 'c', headId: 'd' })
    expect(resolveShellView(url, machine)).toEqual({ view: 'diff', diff: { baseId: 'c', headId: 'd' } })
  })
})
