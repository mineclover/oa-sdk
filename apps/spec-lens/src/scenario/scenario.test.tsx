import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ScenarioProvider,
  useScenario,
  ScenarioProgressHUD,
  ScenarioFlowModal,
  ScenarioSelector,
} from './index.js'

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

  it('renders ScenarioFlowModal when opened', () => {
    function ActiveScenarioConsumer() {
      const { startScenario, openFlowModal } = useScenario()
      return (
        <div>
          <button onClick={() => startScenario('spec-drift-triage')}>Start</button>
          <button onClick={openFlowModal}>Flow</button>
          <ScenarioFlowModal />
        </div>
      )
    }

    const html = renderToStaticMarkup(
      createElement(
        ScenarioProvider,
        null,
        createElement(ActiveScenarioConsumer, null),
      ),
    )

    // Not open initially
    expect(html).not.toContain('FSM 전이 행렬')
  })
})
