import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Value } from 'platejs'

const indent = vi.fn()
const outdent = vi.fn()
const toggleList = vi.fn()
const upsertLink = vi.fn()

vi.mock('@platejs/indent', () => ({
  indent,
  outdent,
}))

vi.mock('@platejs/list', () => ({
  toggleList,
}))

vi.mock('@platejs/link', () => ({
  upsertLink,
}))

function createEditor() {
  const markdownValue: Value = [{ type: 'h2', children: [{ text: 'Imported' }] }]
  return {
    getApi: vi.fn(() => ({
      markdown: {
        deserialize: vi.fn(() => markdownValue),
      },
    })),
    tf: {
      blockquote: { toggle: vi.fn() },
      bold: { toggle: vi.fn() },
      code: { toggle: vi.fn() },
      h1: { toggle: vi.fn() },
      h2: { toggle: vi.fn() },
      h3: { toggle: vi.fn() },
      h4: { toggle: vi.fn() },
      h5: { toggle: vi.fn() },
      h6: { toggle: vi.fn() },
      insertNodes: vi.fn(),
      italic: { toggle: vi.fn() },
      setValue: vi.fn(),
      strikethrough: { toggle: vi.fn() },
    },
  }
}

describe('GitLab Plate commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a bound command map for editor transforms', async () => {
    const { createGitLabPlateCommands } = await import('../plate/index.js')
    const editor = createEditor()
    const commands = createGitLabPlateCommands(editor as never)
    const value: Value = [{ type: 'p', children: [{ text: 'Reset' }] }]

    commands.resetValue(value)
    commands.resetValueFromMarkdown('## Imported')
    commands.insertRawMarkdown('[[TOC]]')
    commands.toggleHeading(3)
    commands.toggleBlockquote()
    commands.toggleBold()
    commands.toggleItalic()
    commands.toggleInlineCode()
    commands.toggleStrikethrough()

    expect(editor.tf.setValue).toHaveBeenCalledWith(value)
    expect(editor.tf.setValue).toHaveBeenCalledWith([{ type: 'h2', children: [{ text: 'Imported' }] }])
    expect(editor.tf.insertNodes).toHaveBeenCalledWith({
      children: [{ text: '[[TOC]]' }],
      glfmRaw: true,
      type: 'p',
    })
    expect(editor.tf.h3.toggle).toHaveBeenCalledTimes(1)
    expect(editor.tf.blockquote.toggle).toHaveBeenCalledTimes(1)
    expect(editor.tf.bold.toggle).toHaveBeenCalledTimes(1)
    expect(editor.tf.italic.toggle).toHaveBeenCalledTimes(1)
    expect(editor.tf.code.toggle).toHaveBeenCalledTimes(1)
    expect(editor.tf.strikethrough.toggle).toHaveBeenCalledTimes(1)
  })

  it('delegates list, indentation, and link commands to Plate helpers', async () => {
    const { createGitLabPlateCommands } = await import('../plate/index.js')
    const editor = createEditor()
    const commands = createGitLabPlateCommands(editor as never)

    commands.toggleList('todo')
    commands.indentBlock()
    commands.outdentBlock()
    commands.upsertLink({ text: 'GitLab', url: 'https://gitlab.example.com' })

    expect(toggleList).toHaveBeenCalledWith(editor, { listStyleType: 'todo' })
    expect(indent).toHaveBeenCalledWith(editor)
    expect(outdent).toHaveBeenCalledWith(editor)
    expect(upsertLink).toHaveBeenCalledWith(editor, {
      skipValidation: true,
      text: 'GitLab',
      url: 'https://gitlab.example.com',
    })
  })
})
