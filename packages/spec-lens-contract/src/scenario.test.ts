import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ScenarioRegistry,
  DEFAULT_SCENARIOS,
  SPEC_DRIFT_TRIAGE_SCENARIO,
  ENDPOINT_EXPLORATION_SCENARIO,
  BREAKING_IMPACT_ANALYSIS_SCENARIO,
  CIRCULAR_REF_DIAGNOSTIC_SCENARIO,
  ScenarioFlowEnumerator,
  createInitialScenarioState,
  evaluateTransitionGuards,
  resolveScenarioInitialView,
  scenarioTransitionReducer,
} from './index.js'

describe('Scenario Topic Navigation & BEHAVIOR FSM Engine', () => {
  describe('Scenario Registry & Definitions', () => {
    it('registers all 4 standard scenarios with correct metadata', () => {
      const registry = new ScenarioRegistry()
      expect(registry.getAll()).toHaveLength(4)
      expect(registry.has('spec-drift-triage')).toBe(true)
      expect(registry.has('endpoint-exploration')).toBe(true)
      expect(registry.has('breaking-impact-analysis')).toBe(true)
      expect(registry.has('circular-ref-diagnostic')).toBe(true)

      const driftScenario = registry.get('spec-drift-triage')!
      expect(driftScenario.persona).toBe('ApiArchitect')
      expect(driftScenario.initialView).toBe('timeline')
      expect(driftScenario.boundedViews).toEqual(['timeline', 'diff', 'paths'])
    })
  })

  describe('Static Flow Enumerator (Path & Reachability Analysis)', () => {
    it.each(DEFAULT_SCENARIOS)('enumerates scenario "$id" without unhandled dead-ends', (scenario) => {
      const result = ScenarioFlowEnumerator.enumerate(scenario)

      expect(result.scenarioId).toBe(scenario.id)
      expect(result.initialView).toBe(scenario.initialView)
      expect(result.reachableViews.length).toBeGreaterThan(0)
      expect(result.deadEnds).toHaveLength(0) // No trapped orphan views
      expect(result.terminalPaths.length).toBeGreaterThanOrEqual(1) // At least 1 path reaches completion
      expect(result.matrix.length).toBeGreaterThan(0)
    })

    it('generates valid Mermaid stateDiagram-v2 representation', () => {
      const mermaid = ScenarioFlowEnumerator.toMermaidStateDiagram(SPEC_DRIFT_TRIAGE_SCENARIO)
      expect(mermaid).toContain('stateDiagram-v2')
      expect(mermaid).toContain('[*] --> timeline')
      expect(mermaid).toContain('timeline --> diff: REQUEST_DIFF [require-diff-pair]')
      expect(mermaid).toContain('diff --> paths: INSPECT_ENDPOINT_PROVENANCE [require-path-pattern]')
      expect(mermaid).toContain('paths --> [*]: COMPLETE_GOAL (drift-resolved)')
    })

    it('generates valid Graphviz DOT representation', () => {
      const dot = ScenarioFlowEnumerator.toDotGraph(ENDPOINT_EXPLORATION_SCENARIO)
      expect(dot).toContain('digraph "endpoint-exploration"')
      expect(dot).toContain('"paths" -> "graph"')
      expect(dot).toContain('__end_contract-verified')
    })

    it('generates comprehensive markdown report with transition matrix', () => {
      const md = ScenarioFlowEnumerator.toMarkdownReport(BREAKING_IMPACT_ANALYSIS_SCENARIO)
      expect(md).toContain('유저 시나리오: 스키마 변경 파급 효과 분석')
      expect(md).toContain('전이 행렬 (Transition Matrix)')
      expect(md).toContain('`FILTER_BREAKING_CHANGES`')
    })
  })

  describe('State Machine Transitions & Guard Validation', () => {
    const registry = new ScenarioRegistry()

    it('initializes and starts a scenario properly', () => {
      let state = createInitialScenarioState()
      expect(state.activeScenarioId).toBeNull()

      const res = scenarioTransitionReducer(
        state,
        { type: 'START_SCENARIO', scenarioId: 'spec-drift-triage' },
        registry,
      )

      expect(res.ok).toBe(true)
      state = res.state
      expect(state.activeScenarioId).toBe('spec-drift-triage')
      expect(state.currentView).toBe('timeline')
      expect(state.breadcrumbs).toHaveLength(1)
      expect(state.breadcrumbs[0]?.view).toBe('timeline')
    })

    it('blocks transition when guard requirements fail', () => {
      const state = createInitialScenarioState('spec-drift-triage', 'timeline')

      // REQUEST_DIFF with identical base and head should fail guard
      const res = scenarioTransitionReducer(
        state,
        { type: 'REQUEST_DIFF', baseId: 'rev-1', headId: 'rev-1' },
        registry,
      )

      expect(res.ok).toBe(false)
      expect(res.error).toContain('baseId and headId must be distinct')
      expect(res.state.currentView).toBe('timeline')
    })

    it('allows transition when guard passes and mutates context', () => {
      let state = createInitialScenarioState('spec-drift-triage', 'timeline')

      const diffRes = scenarioTransitionReducer(
        state,
        { type: 'REQUEST_DIFF', baseId: 'rev-1', headId: 'rev-2' },
        registry,
      )

      expect(diffRes.ok).toBe(true)
      state = diffRes.state
      expect(state.currentView).toBe('diff')
      expect(state.baseId).toBe('rev-1')
      expect(state.headId).toBe('rev-2')

      // Now from diff -> paths via INSPECT_ENDPOINT_PROVENANCE
      const pathsRes = scenarioTransitionReducer(
        state,
        { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: '/users/{id}' },
        registry,
      )

      expect(pathsRes.ok).toBe(true)
      state = pathsRes.state
      expect(state.currentView).toBe('paths')
      expect(state.pathPattern).toBe('/users/{id}')
      expect(state.breadcrumbs).toHaveLength(3)

      // Complete Goal
      const goalRes = scenarioTransitionReducer(
        state,
        { type: 'COMPLETE_GOAL', goalId: 'drift-resolved' },
        registry,
      )

      expect(goalRes.ok).toBe(true)
      state = goalRes.state
      expect(state.completedGoals).toContain('drift-resolved')
    })

    it('supports STEP_BACK through breadcrumb stack', () => {
      let state = createInitialScenarioState('endpoint-exploration', 'paths')

      // paths -> graph
      const step1 = scenarioTransitionReducer(
        state,
        { type: 'SELECT_FRAGMENT_SYMBOL', symbolId: 'UserDto' },
        registry,
      )
      expect(step1.ok).toBe(true)
      state = step1.state
      expect(state.currentView).toBe('graph')

      // step back
      const backRes = scenarioTransitionReducer(state, { type: 'STEP_BACK' }, registry)
      expect(backRes.ok).toBe(true)
      expect(backRes.state.currentView).toBe('paths')
    })

    it('supports SWITCH_SCENARIO with handoff context', () => {
      let state = createInitialScenarioState('spec-drift-triage', 'diff', {
        baseId: 'v1.0',
        headId: 'v2.0',
      })

      const switchRes = scenarioTransitionReducer(
        state,
        {
          type: 'SWITCH_SCENARIO',
          targetScenarioId: 'breaking-impact-analysis',
          handoffContext: { onlyBreaking: true },
        },
        registry,
      )

      expect(switchRes.ok).toBe(true)
      state = switchRes.state
      expect(state.activeScenarioId).toBe('breaking-impact-analysis')
      expect(state.currentView).toBe('timeline') // initialView of breaking-impact-analysis
      expect(state.baseId).toBe('v1.0') // preserved
      expect(state.headId).toBe('v2.0') // preserved
      expect(state.onlyBreaking).toBe(true)
    })
  })

  describe('Initial state resolution against the scenario definition', () => {
    const registry = new ScenarioRegistry()

    it('seeds a deep-linked scenario in its own initialView when the requested view is outside boundedViews', () => {
      // `?scenario=endpoint-exploration` parses to view "timeline", which the scenario does not bound.
      const state = createInitialScenarioState(ENDPOINT_EXPLORATION_SCENARIO, 'timeline')
      expect(state.activeScenarioId).toBe('endpoint-exploration')
      expect(state.currentView).toBe('paths')
      expect(state.breadcrumbs).toHaveLength(1)
      expect(state.breadcrumbs[0]?.view).toBe('paths')

      const next = scenarioTransitionReducer(
        state,
        { type: 'SELECT_FRAGMENT_SYMBOL', symbolId: 'schema:public/users/User' },
        registry,
      )
      expect(next.ok).toBe(true)
      expect(next.state.currentView).toBe('graph')
    })

    it.each(DEFAULT_SCENARIOS)('starts "$id" with outgoing transitions when no view is requested', (scenario) => {
      const state = createInitialScenarioState(scenario)
      expect(state.currentView).toBe(scenario.initialView)
      expect(scenario.transitions.some((t) => t.fromView === state.currentView)).toBe(true)
    })

    it('honours a requested view that lies inside boundedViews', () => {
      const state = createInitialScenarioState(SPEC_DRIFT_TRIAGE_SCENARIO, 'diff')
      expect(state.currentView).toBe('diff')
      expect(state.breadcrumbs[0]?.view).toBe('diff')
    })

    it('keeps the requested view (default timeline) for free mode and bare scenario IDs', () => {
      expect(createInitialScenarioState().currentView).toBe('timeline')
      expect(createInitialScenarioState(null, 'graph').currentView).toBe('graph')
      expect(createInitialScenarioState('endpoint-exploration', 'paths').currentView).toBe('paths')
    })

    it('resolveScenarioInitialView falls back to the definition initialView', () => {
      expect(resolveScenarioInitialView(CIRCULAR_REF_DIAGNOSTIC_SCENARIO, 'timeline')).toBe('graph')
      expect(resolveScenarioInitialView(CIRCULAR_REF_DIAGNOSTIC_SCENARIO, 'paths')).toBe('paths')
      expect(resolveScenarioInitialView(undefined, undefined)).toBe('timeline')
    })
  })

  describe('evaluateTransitionGuards', () => {
    const rule = SPEC_DRIFT_TRIAGE_SCENARIO.transitions.find(
      (t) => t.fromView === 'timeline' && t.actionType === 'REQUEST_DIFF',
    )!
    const state = createInitialScenarioState(SPEC_DRIFT_TRIAGE_SCENARIO)

    it('passes when every guard accepts the action payload', () => {
      expect(
        evaluateTransitionGuards(SPEC_DRIFT_TRIAGE_SCENARIO, rule, state, { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' }),
      ).toEqual({ ok: true })
    })

    it('reports the failing guard reason', () => {
      expect(
        evaluateTransitionGuards(SPEC_DRIFT_TRIAGE_SCENARIO, rule, state, { type: 'REQUEST_DIFF', baseId: 'a', headId: 'a' }),
      ).toEqual({ ok: false, reason: 'baseId and headId must be distinct for comparison' })
    })

    it('fails closed on a guard ID that has no declaration', () => {
      const result = evaluateTransitionGuards(
        { ...SPEC_DRIFT_TRIAGE_SCENARIO, guards: {} },
        rule,
        state,
        { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
      )
      expect(result.ok).toBe(false)
      expect(result.ok ? '' : result.reason).toContain('require-diff-pair')
    })
  })

  describe('Re-entry transitions land the new payload in the context', () => {
    const registry = new ScenarioRegistry()

    function run(
      scenarioId: string,
      actions: Parameters<typeof scenarioTransitionReducer>[1][],
    ) {
      let state = scenarioTransitionReducer(
        createInitialScenarioState(),
        { type: 'START_SCENARIO', scenarioId },
        registry,
      ).state
      for (const action of actions) {
        const res = scenarioTransitionReducer(state, action, registry)
        expect(res.ok, `${action.type}: ${res.error ?? ''}`).toBe(true)
        state = res.state
      }
      return state
    }

    it('spec-drift-triage: paths -> diff with a new revision pair replaces baseId/headId', () => {
      const state = run('spec-drift-triage', [
        { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
        { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: '/x' },
        { type: 'REQUEST_DIFF', baseId: 'c', headId: 'd' },
      ])
      expect(state.currentView).toBe('diff')
      expect(state.baseId).toBe('c')
      expect(state.headId).toBe('d')
    })

    it('endpoint-exploration: graph -> paths records the inspected pathPattern', () => {
      const state = run('endpoint-exploration', [
        { type: 'SELECT_FRAGMENT_SYMBOL', symbolId: 'User' },
        { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: '/users' },
      ])
      expect(state.currentView).toBe('paths')
      expect(state.pathPattern).toBe('/users')
    })

    it('breaking-impact-analysis: graph -> diff with a new revision pair replaces baseId/headId', () => {
      const state = run('breaking-impact-analysis', [
        { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
        { type: 'SELECT_FRAGMENT_SYMBOL', symbolId: 'User' },
        { type: 'REQUEST_DIFF', baseId: 'c', headId: 'd' },
      ])
      expect(state.currentView).toBe('diff')
      expect(state.baseId).toBe('c')
      expect(state.headId).toBe('d')
    })

    it('circular-ref-diagnostic: paths -> graph records the newly selected symbol', () => {
      const state = run('circular-ref-diagnostic', [
        { type: 'HIGHLIGHT_DEPENDENCY_CYCLE', rootSymbolId: 'A' },
        { type: 'INSPECT_ENDPOINT_PROVENANCE', pathPattern: '/p' },
        { type: 'SELECT_FRAGMENT_SYMBOL', symbolId: 'B' },
      ])
      expect(state.currentView).toBe('graph')
      expect(state.selectedSymbol).toBe('B')
    })

    it.each(DEFAULT_SCENARIOS)('"$id": every guarded payload-carrying rule writes its payload to the context', (scenario) => {
      const payloadActions = new Set([
        'REQUEST_DIFF',
        'INSPECT_ENDPOINT_PROVENANCE',
        'SELECT_FRAGMENT_SYMBOL',
        'HIGHLIGHT_DEPENDENCY_CYCLE',
        'SELECT_REVISION',
        'FILTER_BREAKING_CHANGES',
      ])
      for (const rule of scenario.transitions) {
        if (payloadActions.has(rule.actionType)) {
          expect(rule.transformContext, `${scenario.id} ${rule.fromView} -${rule.actionType}-> ${rule.toView}`).toBeTypeOf('function')
        }
      }
    })
  })

  describe('Breadcrumbs record the diff pair a step showed', () => {
    const registry = new ScenarioRegistry()
    const pairOf = (step: { baseId?: string | undefined; headId?: string | undefined } | undefined) =>
      step ? { baseId: step.baseId, headId: step.headId } : undefined
    const NO_PAIR = { baseId: undefined, headId: undefined }

    it('records the pair on every diff step, including self-loops, and on no other step', () => {
      let state = scenarioTransitionReducer(
        createInitialScenarioState(),
        { type: 'START_SCENARIO', scenarioId: 'breaking-impact-analysis', initialContext: { baseId: 'x', headId: 'y' } },
        registry,
      ).state
      for (const action of [
        { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
        { type: 'FILTER_BREAKING_CHANGES', onlyBreaking: true },
        { type: 'SELECT_FRAGMENT_SYMBOL', symbolId: 'User' },
        { type: 'COMPLETE_GOAL', goalId: 'impact-assessed' },
        { type: 'REQUEST_DIFF', baseId: 'c', headId: 'd' },
      ] as const) {
        const res = scenarioTransitionReducer(state, action, registry)
        expect(res.ok, `${action.type}: ${res.error ?? ''}`).toBe(true)
        state = res.state
      }
      expect(state.breadcrumbs.map((b) => [b.view, pairOf(b)])).toEqual([
        ['timeline', NO_PAIR],
        ['diff', { baseId: 'a', headId: 'b' }],
        ['diff', { baseId: 'a', headId: 'b' }],
        ['graph', NO_PAIR],
        ['graph', NO_PAIR],
        ['diff', { baseId: 'c', headId: 'd' }],
      ])
    })

    it('records the seeded pair on a deep-linked diff origin and on a hand-off into diff', () => {
      const origin = createInitialScenarioState(SPEC_DRIFT_TRIAGE_SCENARIO, 'diff', { baseId: 'a', headId: 'b' })
      expect(pairOf(origin.breadcrumbs[0])).toEqual({ baseId: 'a', headId: 'b' })
      expect(pairOf(createInitialScenarioState(SPEC_DRIFT_TRIAGE_SCENARIO, 'diff').breadcrumbs[0])).toEqual(NO_PAIR)

      const diffFirst = { ...SPEC_DRIFT_TRIAGE_SCENARIO, id: 'diff-first', initialView: 'diff' as const }
      const handoff = scenarioTransitionReducer(
        createInitialScenarioState(ENDPOINT_EXPLORATION_SCENARIO),
        { type: 'SWITCH_SCENARIO', targetScenarioId: 'diff-first', handoffContext: { baseId: 'c', headId: 'd' } },
        new ScenarioRegistry([diffFirst]),
      )
      expect(handoff.ok).toBe(true)
      expect(pairOf(handoff.state.breadcrumbs.at(-1))).toEqual({ baseId: 'c', headId: 'd' })
    })

    it('declares every recorded breadcrumb field on ScenarioStepProvenance in scenario.tsp', () => {
      const tsp = readFileSync(fileURLToPath(new URL('./scenario/scenario.tsp', import.meta.url)), 'utf8')
      const body = /model ScenarioStepProvenance \{([\s\S]*?)\n\}/.exec(tsp)?.[1]
      expect(body, 'model ScenarioStepProvenance in scenario.tsp').toBeDefined()
      const declared = [...(body ?? '').matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1])

      // A START_SCENARIO into a diff-first scenario with a seeded pair fills every field.
      const diffFirst = { ...SPEC_DRIFT_TRIAGE_SCENARIO, id: 'diff-first', initialView: 'diff' as const }
      const started = scenarioTransitionReducer(
        createInitialScenarioState(),
        { type: 'START_SCENARIO', scenarioId: 'diff-first', initialContext: { baseId: 'a', headId: 'b' } },
        new ScenarioRegistry([diffFirst]),
      )
      expect(started.ok).toBe(true)
      const recorded = Object.keys(started.state.breadcrumbs[0] ?? {})
      expect(new Set(declared)).toEqual(new Set(recorded))
    })
  })

  describe('STEP_BACK returns to the step a breadcrumb recorded', () => {
    const registry = new ScenarioRegistry()

    function run(scenarioId: string, actions: Parameters<typeof scenarioTransitionReducer>[1][]) {
      let state = scenarioTransitionReducer(
        createInitialScenarioState(),
        { type: 'START_SCENARIO', scenarioId },
        registry,
      ).state
      for (const action of actions) {
        const res = scenarioTransitionReducer(state, action, registry)
        expect(res.ok, `${action.type}: ${res.error ?? ''}`).toBe(true)
        state = res.state
      }
      return state
    }

    it('restores the revision pair of the diff step it lands on', () => {
      // spec-drift-triage: timeline -> diff(a..b) -> timeline -> diff(c..d), then back twice.
      const state = run('spec-drift-triage', [
        { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
        { type: 'SELECT_REVISION', revisionId: 'b' },
        { type: 'REQUEST_DIFF', baseId: 'c', headId: 'd' },
        { type: 'STEP_BACK' },
        { type: 'STEP_BACK' },
      ])
      expect(state.breadcrumbs).toHaveLength(2)
      expect(state.currentView).toBe('diff')
      expect({ baseId: state.baseId, headId: state.headId }).toEqual({ baseId: 'a', headId: 'b' })
      expect(state.breadcrumbs.at(-1)).toMatchObject({ view: 'diff', baseId: 'a', headId: 'b' })
    })

    it('keeps the context pair when the step it lands on recorded none', () => {
      const onTimeline = run('spec-drift-triage', [
        { type: 'REQUEST_DIFF', baseId: 'a', headId: 'b' },
        { type: 'SELECT_REVISION', revisionId: 'b' },
        { type: 'REQUEST_DIFF', baseId: 'c', headId: 'd' },
        { type: 'STEP_BACK' },
      ])
      expect(onTimeline.currentView).toBe('timeline')
      expect({ baseId: onTimeline.baseId, headId: onTimeline.headId }).toEqual({ baseId: 'c', headId: 'd' })

      // A diff breadcrumb without a recorded pair (e.g. persisted before the field existed).
      const legacy = createInitialScenarioState('spec-drift-triage', 'diff', {
        baseId: 'c',
        headId: 'd',
        breadcrumbs: [
          { stepNumber: 1, scenarioId: 'spec-drift-triage', view: 'diff', actionType: 'START_SCENARIO', timestamp: 0 },
          { stepNumber: 2, scenarioId: 'spec-drift-triage', view: 'paths', actionType: 'INSPECT_ENDPOINT_PROVENANCE', timestamp: 0 },
        ],
      })
      const back = scenarioTransitionReducer({ ...legacy, currentView: 'paths' }, { type: 'STEP_BACK' }, registry)
      expect(back.ok).toBe(true)
      expect(back.state.currentView).toBe('diff')
      expect({ baseId: back.state.baseId, headId: back.state.headId }).toEqual({ baseId: 'c', headId: 'd' })
    })
  })
})
