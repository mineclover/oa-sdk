import { describe, expect, it, vi } from 'vitest'
import {
  addIssueTask,
  deleteIssueTask,
  fetchRemainingIssueTasks,
  updateIssueTask,
} from '../gitlab/issue-tasks-adapter.js'

describe('issue tasks adapter', () => {
  it('fetches remaining tasks without exposing GitLab private token fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      iid: '42',
      title: 'Task issue',
      state: 'opened',
      summary: { count: 2, completedCount: 1 },
      remainingTasks: [{ line: 1, text: 'write docs', checked: false, inapplicable: false, marker: '[ ]' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(fetchRemainingIssueTasks('42', {
      baseUrl: 'http://127.0.0.1:7081',
      authToken: 'ui-token',
      fetchImpl,
    })).resolves.toMatchObject({ iid: '42', remainingTasks: [{ text: 'write docs' }] })
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:7081/issues/42/tasks?remaining=true', {
      method: 'GET',
      headers: { Authorization: 'Bearer ui-token' },
    })
  })

  it('builds add, update, and delete task requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
        iid: '42',
        title: 'Task issue',
        state: 'opened',
        summary: { count: 0, completedCount: 0 },
        tasks: [],
        remainingTasks: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await addIssueTask('42', 'new task', { fetchImpl })
    await updateIssueTask('42', 7, { checked: true }, { fetchImpl })
    await deleteIssueTask('42', 8, { fetchImpl })

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/issues/42/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'new task' }),
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/issues/42/tasks/7', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked: true }),
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(3, '/issues/42/tasks/8', {
      method: 'DELETE',
      headers: {},
    })
  })
})
