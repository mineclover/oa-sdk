export type GitLabReferenceSearchKind = 'issue' | 'merge_request'

export interface GitLabReferenceSuggestion {
  readonly id: string
  readonly kind: GitLabReferenceSearchKind
  readonly title: string
  readonly preview?: string
  readonly url?: string
  readonly updatedAt?: string
  readonly iid: number
  readonly glfmReference: string
}

interface ContextSearchResult {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly preview?: string
  readonly url?: string
  readonly updatedAt?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

interface ContextSearchResponse {
  readonly results?: ReadonlyArray<ContextSearchResult>
}

export interface SearchGitLabReferencesOptions {
  readonly baseUrl?: string
  readonly authToken?: string
  readonly fetchImpl?: typeof fetch
}

export async function searchGitLabReferences(
  params: {
    readonly text: string
    readonly kind: GitLabReferenceSearchKind
    readonly limit?: number
  },
  options: SearchGitLabReferencesOptions = {},
): Promise<ReadonlyArray<GitLabReferenceSuggestion>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const query = new URLSearchParams({
    kinds: params.kind,
    text: params.text,
    state: 'opened',
    limit: String(params.limit ?? 8),
  })
  const headers: Record<string, string> = {}
  if (options.authToken !== undefined) {
    headers.Authorization = `Bearer ${options.authToken}`
  }
  const response = await fetchImpl(`${options.baseUrl ?? ''}/context/search?${query.toString()}`, { headers })
  if (!response.ok) {
    throw new Error(`GitLab reference search failed: ${String(response.status)}`)
  }
  const body = await response.json() as ContextSearchResponse
  return (body.results ?? [])
    .filter((result): result is ContextSearchResult & { kind: GitLabReferenceSearchKind } =>
      result.kind === 'issue' || result.kind === 'merge_request')
    .map(resultToSuggestion)
}

function resultToSuggestion(result: ContextSearchResult & { kind: GitLabReferenceSearchKind }): GitLabReferenceSuggestion {
  const iid = Number(result.metadata?.iid)
  if (!Number.isInteger(iid) || iid < 1) {
    throw new Error(`GitLab reference search result is missing iid: ${result.id}`)
  }
  return {
    id: result.id,
    kind: result.kind,
    title: result.title,
    ...(result.preview !== undefined ? { preview: result.preview } : {}),
    ...(result.url !== undefined ? { url: result.url } : {}),
    ...(result.updatedAt !== undefined ? { updatedAt: result.updatedAt } : {}),
    iid,
    glfmReference: result.kind === 'issue' ? `#${String(iid)}` : `!${String(iid)}`,
  }
}
