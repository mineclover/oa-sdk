import { describe, expect, it } from 'vitest'
import {
  isMarkdownEditorValue,
  parseStoredEditorValue,
  plateValueToGitLabMarkdown,
  serializeEditorValue,
  type MarkdownEditorValue,
} from '../index.js'

const fallbackValue: MarkdownEditorValue = [
  {
    children: [{ text: 'Fallback' }],
    type: 'p',
  },
]

describe('Markdown editor persistence', () => {
  it('falls back for empty or invalid storage', () => {
    expect(parseStoredEditorValue(null, fallbackValue)).toBe(fallbackValue)
    expect(parseStoredEditorValue('{bad json', fallbackValue)).toBe(fallbackValue)
    expect(parseStoredEditorValue(JSON.stringify({ children: [] }), fallbackValue)).toBe(fallbackValue)
  })

  it('loads and serializes valid editor values', () => {
    const value: MarkdownEditorValue = [{ type: 'p', children: [{ text: 'Saved draft' }] }]

    expect(isMarkdownEditorValue(value)).toBe(true)
    expect(parseStoredEditorValue(JSON.stringify(value), fallbackValue)).toEqual(value)
    expect(serializeEditorValue(value)).toBe(JSON.stringify(value))
  })
})

describe('GitLab Flavored Markdown serialization', () => {
  it('serializes headings, inline marks, and blockquotes', () => {
    expect(
      plateValueToGitLabMarkdown([
        { type: 'h1', children: [{ text: 'Title' }] },
        { type: 'h6', children: [{ text: 'Minor' }] },
        {
          type: 'p',
          children: [
            { text: 'Bold', bold: true },
            { text: ' and ' },
            { text: 'italic', italic: true },
            { text: ' and ' },
            { text: 'code', code: true },
            { text: ' and ' },
            { text: 'strike', strikethrough: true },
          ],
        },
        { type: 'blockquote', children: [{ text: 'Quoted' }] },
      ]),
    ).toBe('# Title\n\n###### Minor\n\n**Bold** and *italic* and `code` and ~~strike~~\n\n> Quoted')
  })

  it('serializes links and indented lists', () => {
    expect(
      plateValueToGitLabMarkdown([
        { type: 'p', listStyleType: 'disc', children: [{ text: 'Bullet' }] },
        { type: 'p', listStyleType: 'disc', indent: 1, children: [{ text: 'Nested bullet' }] },
        { type: 'p', listStyleType: 'decimal', children: [{ text: 'First' }] },
        { type: 'p', listStyleType: 'decimal', children: [{ text: 'Second' }] },
        {
          type: 'p',
          children: [
            { text: 'See ' },
            { type: 'a', url: 'https://gitlab.example.com', children: [{ text: 'GitLab' }] },
          ],
        },
      ]),
    ).toBe('- Bullet\n\n  - Nested bullet\n\n1. First\n\n2. Second\n\nSee [GitLab](https://gitlab.example.com)')
  })

  it('serializes todo lists to GitLab task list Markdown', () => {
    expect(
      plateValueToGitLabMarkdown([
        { type: 'p', listStyleType: 'todo', checked: false, children: [{ text: 'Write docs' }] },
        { type: 'p', listStyleType: 'todo', checked: true, children: [{ text: 'Publish docs' }] },
        { type: 'p', listStyleType: 'todo', indent: 1, checked: false, children: [{ text: 'Nested check' }] },
      ]),
    ).toBe('- [ ] Write docs\n\n- [x] Publish docs\n\n  - [ ] Nested check')
  })

  it('serializes inapplicable task list items with the GitLab [~] marker', () => {
    expect(
      plateValueToGitLabMarkdown([
        { type: 'p', listStyleType: 'todo', taskState: 'inapplicable', children: [{ text: 'No rollout needed' }] },
        { type: 'p', listStyleType: 'todo', taskState: 'done', children: [{ text: 'Verified' }] },
      ]),
    ).toBe('- [~] No rollout needed\n\n- [x] Verified')
  })

  it('preserves raw GitLab Flavored Markdown snippets', () => {
    expect(
      plateValueToGitLabMarkdown([
        {
          type: 'p',
          glfmRaw: true,
          children: [{ text: 'Implements #123 and !456 with ~"priority::high".' }],
        },
        {
          type: 'p',
          glfmRaw: true,
          children: [{ text: '| Status | Owner |\n| --- | --- |\n| Open | @platform |' }],
        },
        {
          type: 'p',
          glfmRaw: true,
          children: [{ text: '```mermaid\ngraph TD\n  Issue[#123] --> MR[!456]\n```' }],
        },
      ]),
    ).toBe(
      'Implements #123 and !456 with ~"priority::high".\n\n' +
      '| Status | Owner |\n| --- | --- |\n| Open | @platform |\n\n' +
      '```mermaid\ngraph TD\n  Issue[#123] --> MR[!456]\n```',
    )
  })
})
