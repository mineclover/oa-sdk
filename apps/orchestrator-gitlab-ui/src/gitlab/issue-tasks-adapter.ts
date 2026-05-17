export interface GitLabIssueTask {
  readonly line: number
  readonly text: string
  readonly checked: boolean
  readonly inapplicable: boolean
  readonly marker: '[ ]' | '[x]' | '[X]' | '[~]'
}

export interface GitLabIssueTaskReport {
  readonly iid: string
  readonly title: string
  readonly state: string
  readonly summary: {
    readonly count: number
    readonly completedCount: number
  }
  readonly tasks: ReadonlyArray<GitLabIssueTask>
  readonly remainingTasks: ReadonlyArray<GitLabIssueTask>
}

export interface IssueTaskRequestOptions {
  readonly baseUrl?: string
  readonly authToken?: string
  readonly fetchImpl?: typeof fetch
}

export async function fetchIssueTasks(
  iid: string,
  options: IssueTaskRequestOptions = {},
): Promise<GitLabIssueTaskReport> {
  return await requestIssueTasks(`/issues/${encodeURIComponent(iid)}/tasks`, undefined, options)
}

export async function fetchRemainingIssueTasks(
  iid: string,
  options: IssueTaskRequestOptions = {},
): Promise<Pick<GitLabIssueTaskReport, 'iid' | 'title' | 'state' | 'summary' | 'remainingTasks'>> {
  return await requestIssueTasks(`/issues/${encodeURIComponent(iid)}/tasks?remaining=true`, undefined, options)
}

export async function addIssueTask(
  iid: string,
  text: string,
  options: IssueTaskRequestOptions = {},
): Promise<GitLabIssueTaskReport> {
  return await requestIssueTasks(`/issues/${encodeURIComponent(iid)}/tasks`, {
    method: 'POST',
    body: { text },
  }, options)
}

export async function updateIssueTask(
  iid: string,
  line: number,
  update: { readonly text?: string; readonly checked?: boolean; readonly inapplicable?: boolean },
  options: IssueTaskRequestOptions = {},
): Promise<GitLabIssueTaskReport> {
  return await requestIssueTasks(`/issues/${encodeURIComponent(iid)}/tasks/${String(line)}`, {
    method: 'PATCH',
    body: update,
  }, options)
}

export async function deleteIssueTask(
  iid: string,
  line: number,
  options: IssueTaskRequestOptions = {},
): Promise<GitLabIssueTaskReport> {
  return await requestIssueTasks(`/issues/${encodeURIComponent(iid)}/tasks/${String(line)}`, {
    method: 'DELETE',
  }, options)
}

async function requestIssueTasks<T>(
  path: string,
  request: { readonly method: 'POST' | 'PATCH' | 'DELETE'; readonly body?: unknown } | undefined,
  options: IssueTaskRequestOptions,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers: Record<string, string> = {}
  if (request?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (options.authToken !== undefined) {
    headers.Authorization = `Bearer ${options.authToken}`
  }
  const response = await fetchImpl(`${options.baseUrl ?? ''}${path}`, {
    method: request?.method ?? 'GET',
    headers,
    ...(request?.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
  })
  if (!response.ok) {
    throw new Error(`GitLab issue task request failed: ${String(response.status)}`)
  }
  return await response.json() as T
}
