import { type MouseEvent } from 'react'
import {
  issuePriorityClass,
  issueStateClass,
  issueQueue,
  type Issue,
} from '../data/dashboard.js'
import { SummaryStrip, type SummaryStripMetric } from '../components/SummaryStrip.js'
import { IssueQueue } from '../components/IssueQueue.js'
import { IssueTaskPanel } from '../components/IssueTaskPanel.js'
import { translate, type Locale } from '../i18n/index.js'
import { commonIssueLabels } from './OverviewPage.js'

interface IssueCountByStatus {
  running: number
  queued: number
  blocked: number
  review: number
  done: number
}

function countIssuesByStatus(issues: readonly Issue[]): IssueCountByStatus {
  return issues.reduce(
    (acc, issue) => {
      if (issue.status in acc) {
        acc[issue.status] += 1
      }
      return acc
    },
    { running: 0, queued: 0, blocked: 0, review: 0, done: 0 },
  )
}

const queueMetrics: SummaryStripMetric[] = issueQueue.map(issue => ({
  id: issue.iid,
  label: `Issue #${issue.iid}`,
  value: issue.project,
  detail: `${issue.priority} priority · ${issue.owner}`,
}))

const issueStatusSummary = countIssuesByStatus(issueQueue)

function queueSummaryMetrics(locale: Locale): SummaryStripMetric[] {
  return [
    {
      id: 'open',
      label: translate(locale, 'issues.openWorkItems'),
      value: issueQueue.length - issueStatusSummary.done,
      detail: translate(locale, 'issues.activeIntake'),
    },
    {
      id: 'running',
      label: translate(locale, 'issues.inExecution'),
      value: issueStatusSummary.running,
      detail: translate(locale, 'issues.operatorsHandling'),
    },
    {
      id: 'queued',
      label: translate(locale, 'issues.queued'),
      value: issueStatusSummary.queued,
      detail: translate(locale, 'issues.readyForPickup'),
    },
    {
      id: 'blocked',
      label: translate(locale, 'issues.blocked'),
      value: issueStatusSummary.blocked,
      detail: translate(locale, 'issues.needsApproval'),
    },
    {
      id: 'review',
      label: translate(locale, 'issues.awaitingReview'),
      value: issueStatusSummary.review,
      detail: translate(locale, 'issues.humanCheckpoint'),
    },
  ]
}

export interface IssuesPageProps {
  readonly locale: Locale
  readonly pathname: string
  readonly onNavigate: (path: string) => void
}

function issueDetailPath(iid: string): string {
  return `/issues/${encodeURIComponent(iid)}`
}

function issueIidFromPathname(pathname: string): string | undefined {
  const match = /^\/issues\/([^/?#]+)\/?$/.exec(pathname)
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1])
}

export function IssuesPage({ locale, onNavigate, pathname }: IssuesPageProps) {
  const issueLabels = commonIssueLabels(locale)
  const routeIssueIid = issueIidFromPathname(pathname)
  const selectedIssue = issueQueue.find(issue => issue.iid === routeIssueIid)

  if (routeIssueIid !== undefined && selectedIssue === undefined) {
    return (
      <section className="panel">
        <h2>{translate(locale, 'issues.notFoundTitle')}</h2>
        <p className="run-meta">{translate(locale, 'issues.notFoundDescription')}</p>
        <button className="button" type="button" onClick={() => onNavigate('/issues')}>
          {translate(locale, 'issues.backToIssues')}
        </button>
      </section>
    )
  }

  if (selectedIssue !== undefined) {
    return (
      <>
        <section className="panel document-workspace">
          <div>
            <h2>#{selectedIssue.iid} {selectedIssue.title}</h2>
            <p className="run-meta">{issueLabels.project}: {selectedIssue.project}</p>
          </div>
          <button className="button" type="button" onClick={() => onNavigate('/issues')}>
            {translate(locale, 'issues.backToIssues')}
          </button>
        </section>
        <IssueTaskPanel
          issue={selectedIssue}
          labels={{
            title: translate(locale, 'issues.tasksTitle'),
            description: translate(locale, 'issues.tasksDescription'),
            addPlaceholder: translate(locale, 'issues.taskAddPlaceholder'),
            add: translate(locale, 'issues.taskAdd'),
            refresh: translate(locale, 'issues.taskRefresh'),
            done: translate(locale, 'issues.taskDone'),
            remaining: translate(locale, 'issues.remaining'),
            unavailable: translate(locale, 'issues.taskUnavailable'),
            delete: translate(locale, 'issues.taskDelete'),
          }}
        />
      </>
    )
  }

  function handleOpenIssue(event: MouseEvent<HTMLAnchorElement>, iid: string) {
    event.preventDefault()
    onNavigate(issueDetailPath(iid))
  }

  return (
    <>
      <SummaryStrip
        metrics={queueSummaryMetrics(locale)}
        pipelineStatesLabel={translate(locale, 'summary.pipelineStates')}
        pipelines={[]}
      />

      <section className="panel-grid">
        <IssueQueue issues={issueQueue} labels={issueLabels} />

        <section className="panel">
          <h2>{translate(locale, 'issues.workIntake')}</h2>
          <ul className="run-list">
            {queueMetrics.slice(0, 3).map(metric => (
              <li className="run-card" key={metric.id}>
                <div className="run-title">
                <a href={issueDetailPath(metric.id)} onClick={event => handleOpenIssue(event, metric.id)}>
                  <strong>{metric.label}</strong>
                </a>
                <span>{metric.value}</span>
              </div>
                <p className="run-meta">{metric.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      </section>

      <section className="panel">
        <h2>{translate(locale, 'issues.workStaging')}</h2>
        <ul className="run-list">
          {issueQueue.map(issue => (
            <li className="run-card" key={`stage-${issue.iid}`}>
              <div className="run-title">
                <a href={issueDetailPath(issue.iid)} onClick={event => handleOpenIssue(event, issue.iid)}>
                  <strong>{`#${issue.iid} ${issue.title}`}</strong>
                </a>
                <span className={issuePriorityClass(issue.priority)}>{issue.priority}</span>
              </div>
              <p className="run-meta">{issueLabels.project}: {issue.project}</p>
              <p className="run-meta issue-queue-bottom">
                <span className={issueStateClass(issue.status)}>{issue.status}</span>
                <span className="issue-queue-position">{issueLabels.owner}: {issue.owner}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
