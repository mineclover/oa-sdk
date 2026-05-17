import {
  issuePriorityClass,
  issueStateClass,
  type Issue,
} from '../data/dashboard.js'

export interface IssueQueueProps {
  issues: Issue[]
  labels: {
    title: string
    project: string
    owner: string
    estimate: string
    remaining: string
    queuePosition: string
    notAvailable: string
  }
}

function formatMinutes(minutes: number | null, notAvailable: string) {
  if (minutes === null) return notAvailable
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

export function IssueQueue({ issues, labels }: IssueQueueProps) {
  return (
    <section className="panel issue-queue">
      <h2>{labels.title}</h2>
      <ul className="run-list issue-queue-list">
        {issues.map(issue => (
          <li className="run-card issue-queue-row" key={issue.iid}>
            <div className="run-title">
              <strong>
                #{issue.iid} {issue.title}
              </strong>
              <span className={issuePriorityClass(issue.priority)}>{issue.priority}</span>
            </div>
            <div className="run-meta">{labels.project}: {issue.project}</div>
            <div className="run-meta">{labels.owner}: {issue.owner}</div>
            <div className="run-meta">
              {labels.estimate}: {formatMinutes(issue.estimateMinutes, labels.notAvailable)} · {labels.remaining}: {formatMinutes(issue.remainingMinutes, labels.notAvailable)}
            </div>
            <div className="run-meta issue-queue-bottom">
              <span className={issueStateClass(issue.status)}>{issue.status}</span>
              <span className="issue-queue-position">#{issue.queuePosition} {labels.queuePosition}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
