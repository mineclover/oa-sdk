export type GitLabMarkdownReferenceKind = 'issue' | 'merge_request'

export type GitLabMarkdownSnippetId =
  | 'issue-reference'
  | 'merge-request-reference'
  | 'label-reference'
  | 'milestone-reference'
  | 'table'
  | 'code-fence'
  | 'mermaid'
  | 'math'
  | 'toc'
  | 'alert'
  | 'image'

export type GitLabMarkdownSnippetLabelKey =
  | 'issueReference'
  | 'mergeRequestReference'
  | 'labelReference'
  | 'milestoneReference'
  | 'table'
  | 'codeFence'
  | 'mermaid'
  | 'math'
  | 'toc'
  | 'alert'
  | 'image'

export interface GitLabMarkdownReferenceSnippet {
  readonly id: GitLabMarkdownSnippetId
  readonly kind: 'reference'
  readonly labelKey: GitLabMarkdownSnippetLabelKey
  readonly referenceKind: GitLabMarkdownReferenceKind
  readonly fallbackMarkdown: string
}

export interface GitLabMarkdownPromptSnippet {
  readonly id: GitLabMarkdownSnippetId
  readonly kind: 'prompt'
  readonly labelKey: GitLabMarkdownSnippetLabelKey
  readonly fallbackMarkdown: string
}

export interface GitLabMarkdownRawSnippet {
  readonly id: GitLabMarkdownSnippetId
  readonly kind: 'raw'
  readonly labelKey: GitLabMarkdownSnippetLabelKey
  readonly markdown: string
}

export interface GitLabMarkdownImageSnippet {
  readonly id: GitLabMarkdownSnippetId
  readonly kind: 'image'
  readonly labelKey: GitLabMarkdownSnippetLabelKey
  readonly urlPrompt: string
  readonly altPrompt: string
  readonly defaultUrl: string
  readonly defaultAlt: string
}

export type GitLabMarkdownSnippet =
  | GitLabMarkdownReferenceSnippet
  | GitLabMarkdownPromptSnippet
  | GitLabMarkdownRawSnippet
  | GitLabMarkdownImageSnippet

export const gitLabMarkdownSnippets: ReadonlyArray<GitLabMarkdownSnippet> = [
  {
    id: 'issue-reference',
    kind: 'reference',
    labelKey: 'issueReference',
    referenceKind: 'issue',
    fallbackMarkdown: '#123',
  },
  {
    id: 'merge-request-reference',
    kind: 'reference',
    labelKey: 'mergeRequestReference',
    referenceKind: 'merge_request',
    fallbackMarkdown: '!123',
  },
  {
    id: 'label-reference',
    kind: 'prompt',
    labelKey: 'labelReference',
    fallbackMarkdown: '~"priority::high"',
  },
  {
    id: 'milestone-reference',
    kind: 'prompt',
    labelKey: 'milestoneReference',
    fallbackMarkdown: '%"release candidate"',
  },
  {
    id: 'table',
    kind: 'raw',
    labelKey: 'table',
    markdown: '| Status | Owner | Reference |\n| --- | --- | --- |\n| Open | @user | #123 |',
  },
  {
    id: 'code-fence',
    kind: 'raw',
    labelKey: 'codeFence',
    markdown: '```ts\n// paste code here\n```',
  },
  {
    id: 'mermaid',
    kind: 'raw',
    labelKey: 'mermaid',
    markdown: '```mermaid\ngraph TD\n  Issue[#123] --> MR[!123]\n```',
  },
  {
    id: 'math',
    kind: 'raw',
    labelKey: 'math',
    markdown: '```math\na^2+b^2=c^2\n```',
  },
  {
    id: 'toc',
    kind: 'raw',
    labelKey: 'toc',
    markdown: '[[_TOC_]]',
  },
  {
    id: 'alert',
    kind: 'raw',
    labelKey: 'alert',
    markdown: '> [!note]\n> Add rollout note here.',
  },
  {
    id: 'image',
    kind: 'image',
    labelKey: 'image',
    urlPrompt: 'Image URL',
    altPrompt: 'Alt text',
    defaultUrl: 'https://example.com/image.png',
    defaultAlt: 'diagram',
  },
]

export function createGitLabMarkdownImageSnippetMarkdown(params: {
  readonly url: string
  readonly alt: string
}): string {
  return `![${params.alt}](${params.url})`
}

