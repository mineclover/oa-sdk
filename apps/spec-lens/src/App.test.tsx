import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  DEFAULT_SCENARIOS,
  ScenarioFlowEnumerator,
  type FlowStep,
  type ScenarioTopicDefinition,
} from '@oa-sdk/spec-lens-contract'
import { api } from './api/client.js'
import { i18n } from './i18n/config.js'
import { parseUrlState } from './hooks/useUrlState.js'
import { App } from './App.js'

/*
 * Interaction test of the real AppShell + ScenarioProvider + HUD + URL store,
 * mounted with react-dom/client on a minimal DOM (no DOM library dependency).
 * The data-heavy leaf views are replaced by stubs that expose the same callback
 * props AppShell wires, so a "click" in a view is exactly the handler AppShell
 * passes to it. The views' own behaviour is covered by their own tests.
 */

vi.mock('./views/Timeline.js', async () => {
  const { createElement: h } = await import('react')
  return {
    Timeline: ({ onSelectDiff }: { onSelectDiff: (base: string, head: string) => void }) =>
      h('section', { 'data-view': 'timeline' },
        h('button', { 'data-stub': 'timeline-diff', onClick: () => onSelectDiff('rev-a', 'rev-b') }, 'compare'),
        h('button', { 'data-stub': 'timeline-diff-next', onClick: () => onSelectDiff('rev-c', 'rev-d') }, 'compare next')),
  }
})

vi.mock('./views/DiffView.js', async () => {
  const { createElement: h } = await import('react')
  return {
    DiffView: (props: {
      baseId: string
      headId: string
      onBack: () => void
      onSelectEntry?: (pointer: string) => void
      breakingOnly?: boolean
    }) =>
      h('section', { 'data-view': 'diff', 'data-range': `${props.baseId}..${props.headId}`, 'data-breaking': String(props.breakingOnly ?? false) },
        h('button', { 'data-stub': 'diff-path', onClick: () => props.onSelectEntry?.('#/paths/~1users~1{id}/get') }, 'path'),
        h('button', { 'data-stub': 'diff-component', onClick: () => props.onSelectEntry?.('#/components/schemas/User') }, 'schema'),
        h('button', { 'data-stub': 'diff-back', onClick: props.onBack }, 'back')),
  }
})

vi.mock('./views/PathProvenance.js', async () => {
  const { createElement: h } = await import('react')
  return {
    PathProvenance: (props: { initialSearch?: string; onSelectEntry?: (entry: unknown) => void }) =>
      h('section', { 'data-view': 'paths', 'data-search': props.initialSearch ?? '' },
        h('button', {
          'data-stub': 'path-row',
          onClick: () => props.onSelectEntry?.({
            path: '/users/{id}',
            methods: ['GET'],
            canonicalId: 'path:public/users/getUser',
            scope: 'public',
            domain: 'users',
            sourceFile: 'users.yaml',
            contentHash: 'h',
            lastChangedRevisionId: 'rev-b',
            lastChangedTimestamp: 0,
          }),
        }, 'row')),
  }
})

vi.mock('./views/FragmentGraph.js', async () => {
  const { createElement: h } = await import('react')
  return {
    FragmentGraph: (props: { focusSymbolId?: string; onSelectNode?: (node: unknown) => void }) =>
      h('section', { 'data-view': 'graph', 'data-focus': props.focusSymbolId ?? '' },
        h('button', {
          'data-stub': 'graph-node',
          onClick: () => props.onSelectNode?.({
            id: 'schema:public/users/User',
            kind: 'schema',
            scope: 'public',
            domain: 'users',
            localName: 'User',
            sourcePath: 'users.yaml',
            contentHash: 'h',
          }),
        }, 'node')),
  }
})

// ─────────────── Minimal DOM for react-dom/client in Node ───────────────

class FakeNode {
  // React stores its fiber/props under generated keys.
  [key: string]: unknown
  childNodes: FakeNode[] = []
  options: FakeNode[] = []
  parentNode: FakeNode | null = null
  attributes: Record<string, string> = {}
  listeners: Record<string, Array<(event: unknown) => void>> = {}
  style: Record<string, string | ((name: string, value: string) => void)> = {
    setProperty: (name: string, value: string) => {
      this.style[name] = value
    },
  }
  ownerDocument: FakeDocument | null = null
  nodeValue: string | null = null
  textContent = ''
  selected = false

  constructor(
    public nodeType: number,
    public nodeName: string,
  ) {}

  get tagName(): string {
    return this.nodeName
  }
  appendChild(child: FakeNode) {
    return this.insertBefore(child, null)
  }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode?.removeChild(child)
    const index = before ? this.childNodes.indexOf(before) : -1
    if (index >= 0) this.childNodes.splice(index, 0, child)
    else this.childNodes.push(child)
    if (child.nodeName === 'OPTION') this.options.push(child)
    child.parentNode = this
    return child
  }
  removeChild(child: FakeNode) {
    this.childNodes = this.childNodes.filter((c) => c !== child)
    this.options = this.options.filter((c) => c !== child)
    child.parentNode = null
    return child
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value)
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }
  removeAttribute(name: string) {
    delete this.attributes[name]
  }
  hasAttribute(name: string) {
    return name in this.attributes
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener)
  }
  focus() {}
  blur() {}
}

class FakeDocument extends FakeNode {
  documentElement = new FakeNode(1, 'HTML')
  head = new FakeNode(1, 'HEAD')
  body = new FakeNode(1, 'BODY')
  activeElement: FakeNode = this.body

  constructor() {
    super(9, '#document')
    for (const node of [this, this.documentElement, this.head, this.body]) node.ownerDocument = this
  }
  createElement(tag: string) {
    const element = new FakeNode(1, tag.toUpperCase())
    element.ownerDocument = this
    return element
  }
  createElementNS(_namespace: string, tag: string) {
    return this.createElement(tag)
  }
  createTextNode(text: string) {
    const node = new FakeNode(3, '#text')
    node.nodeValue = text
    node.ownerDocument = this
    return node
  }
}

/** Browser-like window: history writes move `location`; `popTo` simulates back/forward. */
function createBrowser(search: string) {
  const document = new FakeDocument()
  const location = { pathname: '/', search }
  const popListeners = new Set<() => void>()
  const moveTo = (url?: string | null) => {
    if (!url) return
    const next = new URL(url, 'http://spec-lens.test')
    location.pathname = next.pathname
    location.search = next.search
  }
  const window = {
    document,
    location,
    history: {
      length: 1,
      pushState: vi.fn((_d: unknown, _u: string, url?: string | null) => moveTo(url)),
      replaceState: vi.fn((_d: unknown, _u: string, url?: string | null) => moveTo(url)),
      back: vi.fn(),
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'popstate') popListeners.add(listener)
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'popstate') popListeners.delete(listener)
    },
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
    HTMLIFrameElement: class {},
    popTo(nextSearch: string) {
      location.search = nextSearch
      for (const listener of [...popListeners]) listener()
    },
  }
  return window
}

type Browser = ReturnType<typeof createBrowser>

function walk(node: FakeNode, visit: (n: FakeNode) => void) {
  visit(node)
  for (const child of node.childNodes) walk(child, visit)
}

function findAll(root: FakeNode, predicate: (n: FakeNode) => boolean): FakeNode[] {
  const found: FakeNode[] = []
  walk(root, (n) => {
    if (predicate(n)) found.push(n)
  })
  return found
}

function textOf(node: FakeNode): string {
  if (node.nodeType === 3) return node.nodeValue ?? ''
  return node.childNodes.length > 0 ? node.childNodes.map(textOf).join('') : node.textContent
}

function reactProps(node: FakeNode): Record<string, unknown> {
  const key = Object.keys(node).find((k) => k.startsWith('__reactProps'))
  const props = key ? node[key] : undefined
  if (typeof props !== 'object' || props === null) throw new Error(`no React props on ${node.nodeName}`)
  return props as Record<string, unknown>
}

// ─────────────────────────────── Harness ───────────────────────────────

class Harness {
  readonly container: FakeNode
  private root: Root | null = null

  constructor(readonly browser: Browser) {
    this.container = browser.document.createElement('div')
  }

  async mount() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    this.root = createRoot(this.container as unknown as Element)
    await act(async () => {
      this.root!.render(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>,
      )
    })
  }

  async unmount() {
    await act(async () => this.root?.unmount())
  }

  /** The single main view AppShell renders right now. */
  renderedView(): string {
    const views = findAll(this.container, (n) => n.attributes['data-view'] !== undefined)
    expect(views).toHaveLength(1)
    return views[0]!.attributes['data-view']!
  }

  url() {
    return parseUrlState(this.browser.location.search)
  }

  hudText(): string {
    const [hud] = findAll(this.container, (n) => n.attributes['aria-label'] === 'Scenario Progress Rail')
    return hud ? textOf(hud) : ''
  }

  button(predicate: (n: FakeNode) => boolean): FakeNode | undefined {
    return findAll(this.container, (n) => n.nodeName === 'BUTTON' && predicate(n))[0]
  }

  async click(node: FakeNode | undefined, label: string) {
    expect(node, `button ${label}`).toBeDefined()
    expect(node!.attributes['disabled'], `button ${label} is disabled`).toBeUndefined()
    const onClick = reactProps(node!)['onClick']
    expect(typeof onClick).toBe('function')
    await act(async () => {
      ;(onClick as (event: unknown) => void)({ preventDefault() {}, stopPropagation() {} })
    })
  }

  async clickStub(stub: string) {
    await this.click(this.button((n) => n.attributes['data-stub'] === stub), stub)
  }

  async clickStep(step: FlowStep) {
    await this.click(this.button((n) => n.attributes['data-scenario-step'] === step.action), `step ${step.action}`)
  }

  async chooseScenario(id: string) {
    const [select] = findAll(this.container, (n) => n.nodeName === 'SELECT' && n.attributes['id'] === 'scenario-select')
    const onChange = reactProps(select!)['onChange']
    await act(async () => {
      ;(onChange as (event: unknown) => void)({ target: { value: id } })
    })
  }

  async browserBack(search: string) {
    await act(async () => {
      this.browser.popTo(search)
    })
  }
}

/** The view click that publishes the selection a flow step needs, then the step itself. */
async function performStep(h: Harness, step: FlowStep) {
  if (step.from === 'timeline' && step.action === 'REQUEST_DIFF') {
    await h.clickStub('timeline-diff')
    return
  }
  if (step.from === 'paths') await h.clickStub('path-row')
  if (step.from === 'graph') await h.clickStub('graph-node')
  if (step.from === 'diff') {
    await h.clickStub(step.action === 'INSPECT_ENDPOINT_PROVENANCE' ? 'diff-path' : 'diff-component')
  }
  await h.clickStep(step)
}

function goalSteps(scenario: ScenarioTopicDefinition) {
  const [path] = ScenarioFlowEnumerator.enumerate(scenario).terminalPaths
  const goal = scenario.terminalGoals.find((g) => g.id === path!.reachedGoal)!
  const goalStep = path!.steps.findIndex((s) => s.action === 'COMPLETE_GOAL')
  return { goal, steps: goalStep === -1 ? path!.steps : path!.steps.slice(0, goalStep) }
}

describe('AppShell scenario wiring (interaction)', () => {
  let harness: Harness | null = null

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.spyOn(api, 'config').mockReturnValue(new Promise(() => {}))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await harness?.unmount()
    harness = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function open(search: string) {
    const browser = createBrowser(search)
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', browser.document)
    harness = new Harness(browser)
    await harness.mount()
    return harness
  }

  it.each(DEFAULT_SCENARIOS)('drives "$id" from the selector to its goal CTA through the UI', async (scenario) => {
    const h = await open('')
    const { goal, steps } = goalSteps(scenario)

    await h.chooseScenario(scenario.id)
    expect(h.renderedView()).toBe(scenario.initialView)
    expect(h.url()).toMatchObject({ scenario: scenario.id, view: scenario.initialView })
    expect(h.hudText()).toContain(`Step 1: ${scenario.initialView}`)

    for (const step of steps) {
      await performStep(h, step)
      // Rendered view, FSM view (HUD) and URL move together.
      expect(h.renderedView()).toBe(step.to)
      expect(h.hudText()).toContain(`: ${step.to}`)
      expect(h.url()).toMatchObject({ scenario: scenario.id, view: step.to })
    }

    expect(h.renderedView()).toBe(goal.targetView)
    const cta = h.button((n) => textOf(n).includes(goal.description))
    await h.click(cta, `goal ${goal.id}`)
    expect(h.hudText()).toContain('완료 목표 달성')
  })

  it('opens a ?scenario= deep link in the scenario initial view and rewrites the URL to match', async () => {
    const h = await open('?scenario=endpoint-exploration')
    expect(h.renderedView()).toBe('paths')
    expect(h.hudText()).toContain('Step 1: paths')
    expect(h.url()).toMatchObject({ scenario: 'endpoint-exploration', view: 'paths' })
    expect(h.browser.history.replaceState).toHaveBeenCalledTimes(1)
    expect(h.browser.history.pushState).not.toHaveBeenCalled()
  })

  it('steps back on browser back and keeps the rendered view, FSM and URL equal', async () => {
    const h = await open('?scenario=endpoint-exploration&view=paths')
    const start = h.browser.location.search
    await h.clickStub('path-row')
    await h.clickStep({ from: 'paths', action: 'SELECT_FRAGMENT_SYMBOL', to: 'graph' })
    expect(h.renderedView()).toBe('graph')
    // The graph focuses the symbol the paths step selected.
    const [graph] = findAll(h.container, (n) => n.attributes['data-view'] === 'graph')
    expect(graph!.attributes['data-focus']).toBe('path:public/users/getUser')

    await h.browserBack(start)
    expect(h.renderedView()).toBe('paths')
    expect(h.hudText()).toContain('Step 1: paths')
    expect(h.url()).toMatchObject({ scenario: 'endpoint-exploration', view: 'paths' })
  })

  it('steps back over the goal CTA on browser back without rewriting history', async () => {
    const h = await open('?scenario=endpoint-exploration&view=paths')
    const start = h.browser.location.search
    await h.clickStub('path-row')
    await h.clickStep({ from: 'paths', action: 'SELECT_FRAGMENT_SYMBOL', to: 'graph' })
    const goal = DEFAULT_SCENARIOS.find((s) => s.id === 'endpoint-exploration')!.terminalGoals[0]!
    const pushes = h.browser.history.pushState.mock.calls.length
    await h.click(h.button((n) => textOf(n).includes(goal.description)), `goal ${goal.id}`)
    expect(h.hudText()).toContain('완료 목표 달성')
    // Completing the goal keeps the URL, so it adds no history entry to step back over.
    expect(h.browser.history.pushState.mock.calls.length).toBe(pushes)

    const replaces = h.browser.history.replaceState.mock.calls.length
    await h.browserBack(start)
    expect(h.renderedView()).toBe('paths')
    expect(h.hudText()).toContain('Step 1: paths')
    expect(h.browser.location.search).toBe(start)
    expect(h.browser.history.replaceState.mock.calls.length).toBe(replaces)
  })

  it('steps back over FILTER_BREAKING_CHANGES on browser back without rewriting history', async () => {
    const h = await open('?scenario=breaking-impact-analysis')
    const start = h.browser.location.search
    await h.clickStub('timeline-diff')
    expect(h.renderedView()).toBe('diff')
    const pushes = h.browser.history.pushState.mock.calls.length
    await h.clickStep({ from: 'diff', action: 'FILTER_BREAKING_CHANGES', to: 'diff' })
    const [diff] = findAll(h.container, (n) => n.attributes['data-view'] === 'diff')
    expect(diff!.attributes['data-breaking']).toBe('true')
    expect(h.browser.history.pushState.mock.calls.length).toBe(pushes)

    const replaces = h.browser.history.replaceState.mock.calls.length
    await h.browserBack(start)
    expect(h.renderedView()).toBe('timeline')
    expect(h.hudText()).toContain('Step 1: timeline')
    expect(h.browser.location.search).toBe(start)
    expect(h.browser.history.replaceState.mock.calls.length).toBe(replaces)
  })

  describe('every back lands on the same step, with the diff pair that step showed', () => {
    // spec-drift-triage: timeline -> diff(a..b) -> timeline -> diff(c..d), then two backs to step 2.
    async function twoComparisons() {
      const h = await open('?scenario=spec-drift-triage')
      const history = [h.browser.location.search]
      await h.clickStub('timeline-diff')
      history.push(h.browser.location.search)
      await h.clickStep({ from: 'diff', action: 'SELECT_REVISION', to: 'timeline' })
      history.push(h.browser.location.search)
      await h.clickStub('timeline-diff-next')
      history.push(h.browser.location.search)
      expect(h.renderedView()).toBe('diff')
      expect(h.hudText()).toContain('Step 4: diff')
      return { h, history }
    }

    const backs: Array<[string, (h: Harness, history: string[]) => Promise<void>]> = [
      ['the HUD step-back button', async (h) => {
        await h.click(h.button((n) => textOf(n).includes('이전 단계')), 'HUD step back')
        await h.click(h.button((n) => textOf(n).includes('이전 단계')), 'HUD step back')
      }],
      ['the Diff back button, then the HUD', async (h) => {
        await h.clickStub('diff-back')
        await h.click(h.button((n) => textOf(n).includes('이전 단계')), 'HUD step back')
      }],
      ['browser back', async (h, history) => {
        await h.browserBack(history[2]!)
        await h.browserBack(history[1]!)
      }],
    ]

    it.each(backs)('%s renders step 2 as it was shown (rev-a..rev-b)', async (_label, goBack) => {
      const { h, history } = await twoComparisons()
      await goBack(h, history)

      expect(h.hudText()).toContain('Step 2: diff')
      expect(h.renderedView()).toBe('diff')
      const [diff] = findAll(h.container, (n) => n.attributes['data-view'] === 'diff')
      expect(diff!.attributes['data-range']).toBe('rev-a..rev-b')
      expect(h.browser.location.search).toBe(history[1])
    })
  })

  it('rejects sidebar navigation the scenario does not permit and shows why', async () => {
    const h = await open('?scenario=endpoint-exploration&view=paths')
    const pushesBefore = h.browser.history.pushState.mock.calls.length
    await h.click(h.button((n) => n.attributes['aria-label'] === 'Timeline'), 'nav Timeline')

    expect(h.renderedView()).toBe('paths')
    expect(h.url()).toMatchObject({ scenario: 'endpoint-exploration', view: 'paths' })
    expect(h.browser.history.pushState.mock.calls.length).toBe(pushesBefore)
    expect(h.hudText()).toContain('NAVIGATE_VIEW')
  })

  it('navigates freely and atomically outside a scenario', async () => {
    const h = await open('')
    await h.click(h.button((n) => n.attributes['aria-label'] === 'Graph'), 'nav Graph')
    expect(h.renderedView()).toBe('graph')
    expect(h.browser.location.search).toBe('?view=graph')

    await h.click(h.button((n) => n.attributes['aria-label'] === 'Timeline'), 'nav Timeline')
    await h.clickStub('timeline-diff')
    expect(h.renderedView()).toBe('diff')
    expect(h.browser.location.search).toBe('?view=diff&base=rev-a&head=rev-b')
    expect(h.browser.history.pushState).toHaveBeenCalledTimes(3)
  })
})
