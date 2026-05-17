import { useEffect, useState } from 'react'
import type { Issue } from '../data/dashboard.js'
import {
  addIssueTask,
  deleteIssueTask,
  fetchIssueTasks,
  updateIssueTask,
  type GitLabIssueTaskReport,
} from '../gitlab/issue-tasks-adapter.js'
import { getOrchestratorApiOptions } from '../gitlab/api-options.js'

export interface IssueTaskPanelProps {
  readonly issue: Issue
  readonly labels: {
    readonly title: string
    readonly description: string
    readonly addPlaceholder: string
    readonly add: string
    readonly refresh: string
    readonly done: string
    readonly remaining: string
    readonly unavailable: string
    readonly delete: string
  }
}

function fallbackReport(issue: Issue): GitLabIssueTaskReport {
  return {
    iid: issue.iid,
    title: issue.title,
    state: issue.status,
    summary: { count: 3, completedCount: 1 },
    tasks: [
      { line: 1, text: 'Clarify acceptance criteria', marker: '[ ]', checked: false, inapplicable: false },
      { line: 2, text: 'Link related merge request', marker: '[x]', checked: true, inapplicable: false },
      { line: 3, text: 'Publish rollout note', marker: '[ ]', checked: false, inapplicable: false },
    ],
    remainingTasks: [
      { line: 1, text: 'Clarify acceptance criteria', marker: '[ ]', checked: false, inapplicable: false },
      { line: 3, text: 'Publish rollout note', marker: '[ ]', checked: false, inapplicable: false },
    ],
  }
}

export function IssueTaskPanel({ issue, labels }: IssueTaskPanelProps) {
  const [report, setReport] = useState<GitLabIssueTaskReport>(() => fallbackReport(issue))
  const [newTask, setNewTask] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle')

  useEffect(() => {
    setReport(fallbackReport(issue))
    setNewTask('')
  }, [issue])

  async function refreshTasks() {
    setStatus('loading')
    try {
      setReport(await fetchIssueTasks(issue.iid, getOrchestratorApiOptions()))
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  async function addTask() {
    if (newTask.trim().length === 0) return
    setStatus('saving')
    try {
      setReport(await addIssueTask(issue.iid, newTask.trim(), getOrchestratorApiOptions()))
      setNewTask('')
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  async function toggleTask(line: number, checked: boolean) {
    setStatus('saving')
    try {
      setReport(await updateIssueTask(issue.iid, line, { checked }, getOrchestratorApiOptions()))
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  async function removeTask(line: number) {
    setStatus('saving')
    try {
      setReport(await deleteIssueTask(issue.iid, line, getOrchestratorApiOptions()))
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="panel issue-task-panel">
      <div className="document-editor-heading">
        <div>
          <h2>{labels.title}</h2>
          <p className="run-meta">#{report.iid} {report.title}</p>
        </div>
        <span className="badge badge-info">
          {report.summary.completedCount}/{report.summary.count} {labels.done}
        </span>
      </div>
      <p className="run-meta">{labels.description}</p>
      <div className="issue-task-controls">
        <input
          className="reference-search-input"
          value={newTask}
          placeholder={labels.addPlaceholder}
          onChange={event => setNewTask(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void addTask()
            }
          }}
        />
        <button className="editor-toolbar-button" type="button" onClick={() => void addTask()}>{labels.add}</button>
        <button className="editor-toolbar-button" type="button" onClick={() => void refreshTasks()}>{labels.refresh}</button>
      </div>
      {status === 'error' ? <p className="reference-search-message">{labels.unavailable}</p> : null}
      <ul className="issue-task-list">
        {report.tasks.map(task => (
          <li className="issue-task-row" key={`${task.line}-${task.text}`}>
            <label>
              <input
                checked={task.checked}
                type="checkbox"
                onChange={event => void toggleTask(task.line, event.target.checked)}
              />
              <span className={task.checked ? 'issue-task-done' : ''}>{task.text}</span>
            </label>
            <button className="editor-toolbar-button" type="button" onClick={() => void removeTask(task.line)}>
              {labels.delete}
            </button>
          </li>
        ))}
      </ul>
      <p className="run-meta">{labels.remaining}: {report.remainingTasks.length}</p>
      {status === 'loading' || status === 'saving' ? <p className="run-meta">{status}</p> : null}
    </section>
  )
}
