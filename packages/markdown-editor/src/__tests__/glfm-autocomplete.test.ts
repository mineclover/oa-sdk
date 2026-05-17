import { describe, expect, it } from 'vitest'
import {
  gitLabMarkdownAutocompleteTriggers,
  type GitLabMarkdownAutocompleteProvider,
} from '../index.js'

describe('GitLab Markdown autocomplete hooks', () => {
  it('declares structured provider-neutral autocomplete triggers', () => {
    expect(gitLabMarkdownAutocompleteTriggers).toEqual([
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
    ])
  })

  it('supports host-provided autocomplete providers', async () => {
    const provider: GitLabMarkdownAutocompleteProvider = async request => [
      {
        id: 'priority-high',
        kind: request.kind,
        label: 'priority::high',
        markdown: '~"priority::high"',
      },
    ]

    await expect(provider({ kind: 'label', query: 'priority' })).resolves.toEqual([
      {
        id: 'priority-high',
        kind: 'label',
        label: 'priority::high',
        markdown: '~"priority::high"',
      },
    ])
  })
})
