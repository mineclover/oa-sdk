import { describe, expect, it } from 'vitest'
import {
  createGitLabDocumentSaveDraft,
  createDocumentInitialValue,
  defaultDocumentValue,
  documentEditorStorageKey,
  plateValueToGitLabMarkdown,
  parseStoredEditorValue,
  serializeEditorValue,
} from '../editor/plate-doc-editor.js'

describe('Plate document editor persistence helpers', () => {
  it('falls back to the default document for empty or invalid storage', () => {
    expect(parseStoredEditorValue(null)).toBe(defaultDocumentValue)
    expect(parseStoredEditorValue('{bad json')).toBe(defaultDocumentValue)
    expect(parseStoredEditorValue(JSON.stringify({ children: [] }))).toBe(defaultDocumentValue)
  })

  it('loads valid Plate values from storage', () => {
    const value = [{ type: 'p', children: [{ text: 'Saved draft' }] }]

    expect(parseStoredEditorValue(JSON.stringify(value))).toEqual(value)
  })

  it('serializes editor values as JSON', () => {
    expect(serializeEditorValue(defaultDocumentValue)).toBe(JSON.stringify(defaultDocumentValue))
  })

  it('creates document-scoped storage keys', () => {
    expect(documentEditorStorageKey('DOC-01')).toBe('orchestrator-gitlab-ui.docs.editor.value.DOC-01')
    expect(documentEditorStorageKey('DOC-02')).not.toBe(documentEditorStorageKey('DOC-01'))
  })

  it('creates initial editor values from selected document metadata', () => {
    const value = createDocumentInitialValue({
      id: 'DOC-01',
      title: 'Runbook',
      project: 'payments/checkout',
      path: 'wiki/release-pipelines',
      owner: 'platform',
    })

    expect(value[0]).toMatchObject({ type: 'h2', children: [{ text: 'Runbook' }] })
    expect(JSON.stringify(value)).toContain('payments/checkout')
    expect(JSON.stringify(value)).toContain('wiki/release-pipelines')
  })

  it('serializes Plate values to GitLab Markdown-compatible text', () => {
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

  it('serializes links and indented GitLab Markdown lists', () => {
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

  it('preserves raw GitLab Flavored Markdown snippets for GitLab rendering', () => {
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

  it('creates GitLab document save dry-run payloads', () => {
    const draft = createGitLabDocumentSaveDraft({
      documentId: 'DOC-01',
      target: 'wiki',
      project: 'payments/checkout',
      path: 'wiki/release-pipelines',
      title: 'Release pipeline strategy',
      markdown: '## Release pipeline strategy',
    })

    expect(draft).toMatchObject({
      documentId: 'DOC-01',
      target: 'wiki',
      markdown: '## Release pipeline strategy',
    })
  })
})
