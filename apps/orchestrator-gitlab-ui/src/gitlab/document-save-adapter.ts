import type { GitLabDocumentSaveDraft } from '../editor/plate-doc-editor.js'

export interface BackendDocumentSaveOptions {
  readonly branch: string
  readonly mode: 'create' | 'update'
  readonly dryRun: boolean
}

export interface BackendDocumentSaveRequest {
  readonly method: 'POST'
  readonly path: '/documents/save'
  readonly body: {
    readonly target: GitLabDocumentSaveDraft['target']
    readonly path: string
    readonly title: string
    readonly markdown: string
    readonly branch: string
    readonly mode: BackendDocumentSaveOptions['mode']
    readonly dryRun: boolean
  }
}

export function buildBackendDocumentSaveRequest(
  draft: GitLabDocumentSaveDraft,
  options: BackendDocumentSaveOptions,
): BackendDocumentSaveRequest {
  return {
    method: 'POST',
    path: '/documents/save',
    body: {
      target: draft.target,
      path: draft.path,
      title: draft.title,
      markdown: draft.markdown,
      branch: options.branch,
      mode: options.mode,
      dryRun: options.dryRun,
    },
  }
}

export async function executeBackendDocumentSave(
  request: BackendDocumentSaveRequest,
  options: {
    readonly baseUrl?: string
    readonly authToken?: string
    readonly fetchImpl?: typeof fetch
  } = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options.authToken !== undefined) {
    headers.Authorization = `Bearer ${options.authToken}`
  }
  return await fetchImpl(`${options.baseUrl ?? ''}${request.path}`, {
    method: request.method,
    headers,
    body: JSON.stringify(request.body),
  })
}
