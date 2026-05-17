import { useState } from 'react'
import { getOrchestratorApiOptions } from '../gitlab/api-options.js'
import {
  searchGitLabReferences,
  type GitLabReferenceSearchKind,
  type GitLabReferenceSuggestion,
} from '../gitlab/reference-search-adapter.js'

export type GitLabReferenceSearchState = 'idle' | 'loading' | 'loaded' | 'error'

export function useGitLabReferenceSearch() {
  const [kind, setKind] = useState<GitLabReferenceSearchKind>('issue')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ReadonlyArray<GitLabReferenceSuggestion>>([])
  const [state, setState] = useState<GitLabReferenceSearchState>('idle')

  function open(nextKind: GitLabReferenceSearchKind) {
    setKind(nextKind)
    setState('idle')
  }

  async function run() {
    if (query.trim().length === 0) return
    setState('loading')
    try {
      const nextResults = await searchGitLabReferences({
        kind,
        text: query.trim(),
      }, getOrchestratorApiOptions())
      setResults(nextResults)
      setState('loaded')
    } catch {
      setResults([])
      setState('error')
    }
  }

  return {
    kind,
    open,
    query,
    results,
    run,
    setQuery,
    state,
  } as const
}
