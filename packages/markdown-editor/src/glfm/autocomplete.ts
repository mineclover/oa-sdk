export type GitLabMarkdownAutocompleteKind =
  | 'label'
  | 'milestone'
  | 'user'
  | 'commit'
  | 'snippet'

export interface GitLabMarkdownAutocompleteTrigger {
  readonly kind: GitLabMarkdownAutocompleteKind
  readonly prefix: string
  readonly description: string
}

export interface GitLabMarkdownAutocompleteItem {
  readonly id: string
  readonly kind: GitLabMarkdownAutocompleteKind
  readonly label: string
  readonly markdown: string
  readonly description?: string
}

export interface GitLabMarkdownAutocompleteRequest {
  readonly kind: GitLabMarkdownAutocompleteKind
  readonly query: string
}

export type GitLabMarkdownAutocompleteProvider = (
  request: GitLabMarkdownAutocompleteRequest,
) => Promise<ReadonlyArray<GitLabMarkdownAutocompleteItem>>

export const gitLabMarkdownAutocompleteTriggers: ReadonlyArray<GitLabMarkdownAutocompleteTrigger> = [
  {
    kind: 'label',
    prefix: '~',
    description: 'GitLab label reference',
  },
  {
    kind: 'milestone',
    prefix: '%',
    description: 'GitLab milestone reference',
  },
  {
    kind: 'user',
    prefix: '@',
    description: 'GitLab user mention',
  },
  {
    kind: 'commit',
    prefix: 'commit:',
    description: 'GitLab commit reference',
  },
  {
    kind: 'snippet',
    prefix: '$',
    description: 'Reusable Markdown snippet',
  },
]
