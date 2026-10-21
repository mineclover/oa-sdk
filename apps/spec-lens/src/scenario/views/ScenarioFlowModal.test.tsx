import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ScenarioFlowModal } from './ScenarioFlowModal.js'

// Kept in its own file so this mock never reaches the provider tests. SSR cannot
// click "흐름도 보기", so the open state is supplied by the mocked context.
const fixture = vi.hoisted(() => ({ open: true, scenarioId: 'spec-drift-triage' }))

vi.mock('../contexts/ScenarioContext.js', async () => {
  const contract = await import('@oa-sdk/spec-lens-contract')
  const scenario = new contract.ScenarioRegistry(contract.DEFAULT_SCENARIOS).get(fixture.scenarioId)!
  return {
    useScenario: () => ({
      activeScenario: scenario,
      machineState: contract.createInitialScenarioState(scenario),
      flowAnalysis: contract.ScenarioFlowEnumerator.enumerate(scenario),
      isFlowModalOpen: fixture.open,
      closeFlowModal: () => {},
    }),
  }
})

describe('ScenarioFlowModal', () => {
  it('renders the dialog with the transition matrix and Mermaid diagram when open', () => {
    fixture.open = true
    const html = renderToStaticMarkup(<ScenarioFlowModal />)

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('FSM 전이 행렬')
    expect(html).toContain('스펙 드리프트 감지 및 원인 규명')
    expect(html).toContain('stateDiagram-v2')
    // The current view is highlighted in the diagram and listed in the matrix.
    expect(html).toContain('class timeline current')
    expect(html).toContain('REQUEST_DIFF')
  })

  it('renders nothing while closed', () => {
    fixture.open = false
    expect(renderToStaticMarkup(<ScenarioFlowModal />)).toBe('')
  })
})
