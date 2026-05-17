import { describe, expect, it } from 'vitest'
import {
  createGitLabMarkdownImageSnippetMarkdown,
  gitLabMarkdownSnippets,
} from '../index.js'

describe('GitLab Markdown snippets', () => {
  it('declares stable snippet ids and label keys', () => {
    expect(gitLabMarkdownSnippets.map(snippet => snippet.id)).toEqual([
      'issue-reference',
      'merge-request-reference',
      'label-reference',
      'milestone-reference',
      'table',
      'code-fence',
      'mermaid',
      'math',
      'toc',
      'alert',
      'image',
    ])
    expect(gitLabMarkdownSnippets.map(snippet => snippet.labelKey)).toContain('issueReference')
    expect(gitLabMarkdownSnippets.map(snippet => snippet.labelKey)).toContain('image')
  })

  it('keeps reference snippets provider-neutral', () => {
    expect(gitLabMarkdownSnippets.filter(snippet => snippet.kind === 'reference')).toEqual([
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
    ])
  })

  it('declares prompt-backed and raw snippet Markdown', () => {
    const snippetsById = new Map(gitLabMarkdownSnippets.map(snippet => [snippet.id, snippet]))

    expect(snippetsById.get('label-reference')).toMatchObject({
      kind: 'prompt',
      fallbackMarkdown: '~"priority::high"',
    })
    expect(snippetsById.get('table')).toMatchObject({
      kind: 'raw',
      markdown: '| Status | Owner | Reference |\n| --- | --- | --- |\n| Open | @user | #123 |',
    })
    expect(snippetsById.get('mermaid')).toMatchObject({
      kind: 'raw',
      markdown: '```mermaid\ngraph TD\n  Issue[#123] --> MR[!123]\n```',
    })
  })

  it('renders image snippet Markdown from host-provided values', () => {
    expect(createGitLabMarkdownImageSnippetMarkdown({
      alt: 'architecture diagram',
      url: 'https://example.com/architecture.png',
    })).toBe('![architecture diagram](https://example.com/architecture.png)')
  })
})
