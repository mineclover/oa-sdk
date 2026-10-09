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
})
