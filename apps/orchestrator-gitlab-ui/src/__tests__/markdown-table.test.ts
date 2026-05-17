import { describe, expect, it } from 'vitest'
import {
  createDefaultMarkdownTable,
  markdownTableToMarkdown,
  parseMarkdownTable,
} from '../components/markdown-table.js'

describe('markdown table helpers', () => {
  it('parses GitLab pipe tables into editable rows', () => {
    expect(parseMarkdownTable('| Status | Owner |\n| --- | --- |\n| Open | @user |')).toEqual({
      headers: ['Status', 'Owner'],
      rows: [['Open', '@user']],
    })
  })

  it('serializes editable rows back to Markdown tables', () => {
    expect(markdownTableToMarkdown({
      headers: ['Status', 'Owner'],
      rows: [['Open', '@user']],
    })).toBe('| Status | Owner |\n| --- | --- |\n| Open | @user |')
  })

  it('provides a stable default table for new inserts', () => {
    expect(markdownTableToMarkdown(createDefaultMarkdownTable())).toContain('| Status | Owner | Reference |')
  })
})
