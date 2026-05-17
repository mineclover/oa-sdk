import { describe, expect, it, vi } from 'vitest'
import {
  buildBackendDocumentSaveRequest,
  executeBackendDocumentSave,
} from '../gitlab/document-save-adapter.js'
import type { GitLabDocumentSaveDraft } from '../editor/plate-doc-editor.js'

const draft: GitLabDocumentSaveDraft = {
  documentId: 'DOC-01',
  target: 'wiki',
  project: 'payments/checkout',
  path: 'wiki/release-pipelines',
  title: 'Release pipelines',
  markdown: '## Release pipelines',
}

describe('backend document save adapter', () => {
  it('builds backend save requests without GitLab token fields', () => {
    expect(buildBackendDocumentSaveRequest(draft, {
      branch: 'main',
      mode: 'update',
      dryRun: true,
    })).toEqual({
      method: 'POST',
      path: '/documents/save',
      body: {
        target: 'wiki',
        path: 'wiki/release-pipelines',
        title: 'Release pipelines',
        markdown: '## Release pipelines',
        branch: 'main',
        mode: 'update',
        dryRun: true,
      },
    })
  })

  it('executes backend requests with optional bearer auth but no PRIVATE-TOKEN', async () => {
    const response = new Response('{}', { status: 200 })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response)
    const request = buildBackendDocumentSaveRequest(draft, {
      branch: 'main',
      mode: 'update',
      dryRun: false,
    })

    await expect(executeBackendDocumentSave(request, {
      baseUrl: 'http://127.0.0.1:3210',
      authToken: 'ui-session-token',
      fetchImpl,
    })).resolves.toBe(response)
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:3210/documents/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ui-session-token',
      },
      body: JSON.stringify(request.body),
    })
  })
})
