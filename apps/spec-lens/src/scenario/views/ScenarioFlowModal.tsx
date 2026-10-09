import { useScenario } from '../contexts/ScenarioContext.js'
import { Badge } from '../../components/Badge.js'
import { ScenarioFlowEnumerator } from '@oa-sdk/spec-lens-contract'

export function ScenarioFlowModal() {
  const { activeScenario, machineState, isFlowModalOpen, closeFlowModal, flowAnalysis } = useScenario()

  if (!isFlowModalOpen || !activeScenario || !flowAnalysis) return null

  const mermaidText = ScenarioFlowEnumerator.toMermaidStateDiagram(activeScenario, {
    highlightCurrentView: machineState.currentView,
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="flow-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeFlowModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 840,
          maxHeight: '90vh',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.5))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-elevated)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 id="flow-modal-title" style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>
              {activeScenario.title}
            </h2>
            <Badge variant="blue">{activeScenario.persona}</Badge>
            <Badge variant="purple">현재 뷰: {machineState.currentView}</Badge>
          </div>
          <button
            type="button"
            onClick={closeFlowModal}
            className="btn btn-secondary"
            style={{ padding: '4px 10px', fontSize: 13 }}
          >
            닫기
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {activeScenario.description}
          </p>

          {/* Stats Bar */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              padding: '10px 14px',
              borderRadius: 6,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              fontSize: 'var(--text-xs)',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)' }}>진입 뷰: </span>
              <strong>{activeScenario.initialView}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>제한 뷰: </span>
              <strong>{activeScenario.boundedViews.join(', ')}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>발견된 완료 경로: </span>
              <strong style={{ color: 'var(--green)' }}>{flowAnalysis.terminalPaths.length}개</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>미완료 고아 뷰: </span>
              <strong>{flowAnalysis.deadEnds.length === 0 ? '0 (안전)' : flowAnalysis.deadEnds.join(', ')}</strong>
            </div>
          </div>

          {/* Transition Matrix Table */}
          <div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              FSM 전이 행렬 (Transition Rules)
            </h4>
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px 12px' }}>출발 뷰</th>
                    <th style={{ padding: '8px 12px' }}>액션 (BEHAVIOR)</th>
                    <th style={{ padding: '8px 12px' }}>도착 뷰</th>
                    <th style={{ padding: '8px 12px' }}>가드 조건</th>
                    <th style={{ padding: '8px 12px' }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {flowAnalysis.matrix.map((row, idx) => {
                    const isCurrent = row.fromView === machineState.currentView
                    return (
                      <tr
                        key={idx}
                        style={{
                          background: isCurrent ? 'var(--blue-bg)' : undefined,
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <td style={{ padding: '8px 12px', fontWeight: isCurrent ? 600 : 400 }}>{row.fromView}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{row.actionType}</td>
                        <td style={{ padding: '8px 12px' }}>{row.toView}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                          {row.guardIds.length > 0 ? row.guardIds.join(', ') : 'None'}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {row.isTerminal ? (
                            <span style={{ color: 'var(--green)', fontWeight: 600 }}>목표 도달</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>전이</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mermaid Diagram Code */}
          <div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              Mermaid stateDiagram-v2
            </h4>
            <pre
              style={{
                margin: 0,
                padding: '12px 16px',
                borderRadius: 6,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                overflowX: 'auto',
                lineHeight: 1.4,
              }}
            >
              {mermaidText}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
