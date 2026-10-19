import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SCENARIOS,
  ScenarioFlowEnumerator,
  type FlowStep,
  type LensBehaviorAction,
  type ScenarioMachineContext,
  type ScenarioTopicDefinition,
} from '@oa-sdk/spec-lens-contract'
import {
  applyUrlStatePatch,
  parseUrlState,
  serializeUrlState,
  useUrlState,
  type UrlStateWindow,
} from '../hooks/useUrlState.js'
import {
  ScenarioProvider,
  useScenario,
  ScenarioProgressHUD,
  ScenarioFlowModal,
  ScenarioSelector,
  availableGoalsFor,
  machineUrlPatch,
  resolveScenarioIntents,
  resolveShellView,
  selectionFromDiffPointer,
  selectionFromGraphNode,
  selectionFromPathEntry,
  type ScenarioContextValue,
  type ScenarioSelection,
} from './index.js'

/** A window stub whose history writes move `location`, like a browser. */
function createFakeWindow(search = '') {
  const location = { pathname: '/', search }
  const moveTo = (url?: string | null) => {
    if (!url) return
    const next = new URL(url, 'http://spec-lens.test')
    location.pathname = next.pathname
    location.search = next.search
  }
  return {
    location,
    history: {
      pushState: vi.fn((_data: unknown, _unused: string, url?: string | null) => moveTo(url)),
      replaceState: vi.fn((_data: unknown, _unused: string, url?: string | null) => moveTo(url)),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } satisfies UrlStateWindow
}

/** Renders the provider with a shell that reads the URL and the FSM the way AppShell does. */
function renderShell() {
  let captured: ScenarioContextValue | null = null
  function Shell() {
    const ctx = useScenario()
    captured = ctx
    const { state } = useUrlState()
    const shell = resolveShellView(state, ctx.machineState)
    return (
      <main data-rendered-view={shell.view} data-machine-view={ctx.machineState.currentView}>
        <ScenarioProgressHUD />
      </main>
    )
  }
  const html = renderToStaticMarkup(createElement(ScenarioProvider, null, createElement(Shell, null)))
  return { html, ctx: captured! as ScenarioContextValue }
}

/** The selection each view publishes when the user picks something in it. */
function selectionPublishedBy(step: FlowStep): ScenarioSelection {
  if (step.from === 'paths') return selectionFromPathEntry({ path: '/users/{id}', canonicalId: 'path:public/users/getUser' })
  if (step.from === 'graph') return selectionFromGraphNode({ id: 'schema:public/users/User', localName: 'User' })
  if (step.from === 'diff') {
    return selectionFromDiffPointer(
      step.action === 'INSPECT_ENDPOINT_PROVENANCE' ? '#/paths/~1users~1{id}/get' : '#/components/schemas/User',
    )
  }
  return {}
}

/** The action the UI dispatches for a flow step (Timeline diff pick, HUD step, or goal CTA). */
function uiActionFor(
  scenario: ScenarioTopicDefinition,
  state: ScenarioMachineContext,
  step: FlowStep,
): LensBehaviorAction {
  if (step.action === 'COMPLETE_GOAL') {
    return { type: 'COMPLETE_GOAL', goalId: availableGoalsFor(scenario, state)[0]!.id }
  }
  if (step.from === 'timeline' && step.action === 'REQUEST_DIFF') {
    return { type: 'REQUEST_DIFF', baseId: 'rev-a', headId: 'rev-b' }
  }
  const intent = resolveScenarioIntents(scenario, state, selectionPublishedBy(step)).find(
    (i) => i.rule.actionType === step.action && i.rule.toView === step.to,
  )
  expect(intent?.blockedReason).toBeUndefined()
  return intent!.action!
}

describe('Spec-Lens UI Scenario Context-Action Layer', () => {
  it('renders free mode by default', () => {
    function Consumer() {
      const { activeScenario, machineState } = useScenario()
      return (
        <div>
          <span data-testid="scenario">{activeScenario ? activeScenario.id : 'none'}</span>
          <span data-testid="view">{machineState.currentView}</span>
          <ScenarioSelector />
          <ScenarioProgressHUD />
        </div>
      )
    }

    const html = renderToStaticMarkup(
      createElement(
        ScenarioProvider,
        null,
        createElement(Consumer, null),
      ),
    )

    expect(html).toContain('none')
    expect(html).toContain('자유 탐색 (Free Mode)')
    // HUD should not render when scenario is null
    expect(html).not.toContain('Scenario Progress Rail')
  })

  it('does not render ScenarioFlowModal while closed (free mode)', () => {
    // The open modal is covered in views/ScenarioFlowModal.test.tsx; SSR never fires click handlers.
    const html = renderToStaticMarkup(
      createElement(ScenarioProvider, null, createElement(ScenarioFlowModal, null)),
    )

    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('FSM 전이 행렬')
  })
})

describe('ScenarioProvider keeps the FSM, the URL and the rendered view together', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(DEFAULT_SCENARIOS)('deep link ?scenario=$id renders the scenario initial view, not the URL default', (scenario) => {
    vi.stubGlobal('window', createFakeWindow(`?scenario=${scenario.id}`))
    const { html } = renderShell()

    expect(html).toContain(`data-rendered-view="${scenario.initialView}"`)
    expect(html).toContain(`data-machine-view="${scenario.initialView}"`)
    expect(html).toContain(scenario.title)
  })

  it.each(DEFAULT_SCENARIOS)('drives "$id" to its goal through the provider and one shared URL store', (scenario) => {
    const win = createFakeWindow('')
    vi.stubGlobal('window', win)
    const { ctx } = renderShell()
    const [path] = ScenarioFlowEnumerator.enumerate(scenario).terminalPaths
    const goal = scenario.terminalGoals.find((g) => g.id === path!.reachedGoal)!
    // Stop before any COMPLETE_GOAL step: the goal view must still offer its CTA.
    const goalStep = path!.steps.findIndex((s) => s.action === 'COMPLETE_GOAL')
    const steps = goalStep === -1 ? path!.steps : path!.steps.slice(0, goalStep)

    // Handlers captured from one render: each dispatch must build on the previous one.
    const urlOf = (state: ScenarioMachineContext) =>
      serializeUrlState(applyUrlStatePatch({ view: 'timeline' }, machineUrlPatch(state)), '')
    let result = ctx.dispatch({ type: 'START_SCENARIO', scenarioId: scenario.id })
    expect(result.ok).toBe(true)
    let urlChanges = 1
    for (const step of steps) {
      const before = urlOf(result.state)
      result = ctx.dispatch(uiActionFor(scenario, result.state, step))
      expect(result.ok, result.error).toBe(true)
      expect(result.state.currentView).toBe(step.to)
      if (urlOf(result.state) !== before) urlChanges++
    }
    expect(result.state.currentView).toBe(goal.targetView)

    // One history entry per URL-changing transition (self-loops such as a filter toggle add
    // none), each carrying both the scenario and the view.
    expect(win.history.pushState).toHaveBeenCalledTimes(urlChanges)
    for (const [, , url] of win.history.pushState.mock.calls) {
      expect(parseUrlState(String(url).replace(/^[^?]*/, '')).scenario).toBe(scenario.id)
    }
    expect(parseUrlState(win.location.search)).toMatchObject({ scenario: scenario.id, view: goal.targetView })

    // Any other reader of the URL (AppShell) sees the same state, and a render from it
    // shows the goal view with its completion CTA.
    const { html } = renderShell()
    expect(html).toContain(`data-rendered-view="${goal.targetView}"`)
    expect(html).toContain(`data-machine-view="${goal.targetView}"`)
    expect(html).toContain(goal.description)
  })
})
