import { describe, expect, it } from 'vitest'
import { analyzeMarkdown, isGitLabTaskMarkdown } from '../editor/markdown-insights.js'

describe('markdown insights', () => {
  it('tracks GitLab issue and merge request references from Markdown', () => {
    expect(analyzeMarkdown('Implements #123 and closes !456. Duplicates #123.').references).toEqual([
      { kind: 'issue', reference: '#123' },
      { kind: 'mergeRequest', reference: '!456' },
    ])
  })

  it('tracks GitLab task list items with source line numbers', () => {
    expect(analyzeMarkdown('- [ ] write docs\n- [x] publish\n  * [~] skipped').tasks).toEqual([
      { line: 1, marker: '[ ]', text: 'write docs' },
      { line: 2, marker: '[x]', text: 'publish' },
      { line: 3, marker: '[~]', text: 'skipped' },
    ])
    expect(isGitLabTaskMarkdown('- [ ] write docs')).toBe(true)
  })
})
