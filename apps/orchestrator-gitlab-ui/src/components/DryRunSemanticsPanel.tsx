import type { DryRunStep } from '../data/dashboard.js'

function effectLabel(effect: DryRunStep['effect']) {
  if (effect === 'none') return 'No writes'
  if (effect === 'preview') return 'Preview only'
  return 'Isolated'
}

export interface DryRunSemanticsPanelProps {
  steps: DryRunStep[]
  labels: {
    title: string
    description: string
  }
}

export function DryRunSemanticsPanel({ labels, steps }: DryRunSemanticsPanelProps) {
  return (
    <section className="panel dry-run-panel">
      <h2>{labels.title}</h2>
      <p className="run-meta">{labels.description}</p>
      <ul className="run-list dry-run-list">
        {steps.map(step => (
          <li className="run-card dry-run-row" key={step.id}>
            <div className="run-title">
              <strong>{step.title}</strong>
              <span className="badge badge-info">{effectLabel(step.effect)}</span>
            </div>
            <p className="run-meta dry-run-details">{step.details}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
