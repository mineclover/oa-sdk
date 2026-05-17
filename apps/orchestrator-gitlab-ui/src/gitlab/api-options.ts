export interface OrchestratorApiOptions {
  readonly baseUrl?: string
  readonly authToken?: string
}

const baseUrlStorageKey = 'orchestrator-gitlab-ui.api.baseUrl'
const authTokenStorageKey = 'orchestrator-gitlab-ui.api.authToken'

export function getOrchestratorApiOptions(): OrchestratorApiOptions {
  const baseUrl = stripTrailingSlashes(firstNonEmpty(
    readLocalStorage(baseUrlStorageKey),
    import.meta.env.VITE_ORCHESTRATOR_GITLAB_API_BASE_URL,
  ))
  const authToken = firstNonEmpty(
    readLocalStorage(authTokenStorageKey),
    import.meta.env.VITE_ORCHESTRATOR_GITLAB_AUTH_TOKEN,
  )
  return {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(authToken !== undefined ? { authToken } : {}),
  }
}

function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed !== undefined && trimmed.length > 0) return trimmed
  }
  return undefined
}

function stripTrailingSlashes(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, '')
}

function readLocalStorage(key: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  return window.localStorage.getItem(key) ?? undefined
}
