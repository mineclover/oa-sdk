import {
  capabilityClass,
  warningClass,
  type Capability,
  type RuntimeWarning,
} from '../data/dashboard.js'

export interface WarningsCapabilitiesProps {
  warnings: RuntimeWarning[]
  capabilities: Capability[]
  labels: {
    warningsTitle: string
    capabilitiesTitle: string
    owner: string
  }
}

export function WarningsCapabilitiesPanel({ capabilities, labels, warnings }: WarningsCapabilitiesProps) {
  return (
    <section className="panel warnings-capabilities">
      <div className="warnings-capabilities-grid">
        <div className="warnings-capabilities-pane">
          <h2>{labels.warningsTitle}</h2>
          <ul className="run-list">
            {warnings.map(alert => (
              <li className="run-card warnings-capabilities-item" key={alert.id}>
                <div className="run-title">
                  <strong>{alert.message}</strong>
                  <span className={warningClass(alert.level)}>{alert.level}</span>
                </div>
                <p className="run-meta warnings-capabilities-remediation">{alert.remediation}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="warnings-capabilities-pane">
          <h2>{labels.capabilitiesTitle}</h2>
          <ul className="run-list">
            {capabilities.map(item => (
              <li className="run-card warnings-capabilities-item" key={item.id}>
                <div className="run-title">
                  <strong>{item.name}</strong>
                  <span className={capabilityClass(item.status)}>{item.status}</span>
                </div>
                <div className="run-meta">{labels.owner}: {item.owner}</div>
                <p className="run-meta warnings-capabilities-remediation">{item.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
