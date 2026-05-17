import { indent, outdent } from '@platejs/indent'
import { upsertLink } from '@platejs/link'
import { toggleList } from '@platejs/list'
import type { Value } from 'platejs'
import type { PlateEditor } from 'platejs/react'

type ToggleCommand = {
  readonly toggle: () => void
}

type GitLabPlateTransforms = {
  readonly h1?: ToggleCommand
  readonly h2?: ToggleCommand
  readonly h3?: ToggleCommand
  readonly h4?: ToggleCommand
  readonly h5?: ToggleCommand
  readonly h6?: ToggleCommand
  readonly blockquote: ToggleCommand
  readonly bold: ToggleCommand
  readonly italic: ToggleCommand
  readonly code: ToggleCommand
  readonly strikethrough: ToggleCommand
  readonly setValue: (value: Value) => void
  readonly insertNodes: (node: Value[number]) => void
}

export type GitLabPlateEditor = PlateEditor & {
  readonly tf: PlateEditor['tf'] & GitLabPlateTransforms
}

export type GitLabMarkdownListStyle = 'disc' | 'decimal' | 'todo'

export interface GitLabPlateCommands {
  readonly resetValue: (value: Value) => void
  readonly insertRawMarkdown: (markdown: string) => void
  readonly upsertLink: (params: { readonly text: string; readonly url: string }) => void
  readonly toggleHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) => void
  readonly toggleBlockquote: () => void
  readonly toggleBold: () => void
  readonly toggleItalic: () => void
  readonly toggleInlineCode: () => void
  readonly toggleStrikethrough: () => void
  readonly toggleList: (listStyleType: GitLabMarkdownListStyle) => void
  readonly indentBlock: () => void
  readonly outdentBlock: () => void
}

export function asGitLabPlateEditor(editor: PlateEditor): GitLabPlateEditor {
  return editor as GitLabPlateEditor
}

export function resetGitLabPlateValue(editor: PlateEditor, value: Value): void {
  asGitLabPlateEditor(editor).tf.setValue(value)
}

export function insertRawGitLabMarkdown(editor: PlateEditor, markdown: string): void {
  asGitLabPlateEditor(editor).tf.insertNodes({
    children: [{ text: markdown }],
    glfmRaw: true,
    type: 'p',
  } as Value[number])
}

export function upsertGitLabLink(editor: PlateEditor, params: {
  readonly text: string
  readonly url: string
}): void {
  upsertLink(editor, { skipValidation: true, text: params.text, url: params.url })
}

export function toggleGitLabHeading(editor: PlateEditor, level: 1 | 2 | 3 | 4 | 5 | 6): void {
  const transforms = asGitLabPlateEditor(editor).tf
  if (level === 1) transforms.h1?.toggle()
  else if (level === 2) transforms.h2?.toggle()
  else if (level === 3) transforms.h3?.toggle()
  else if (level === 4) transforms.h4?.toggle()
  else if (level === 5) transforms.h5?.toggle()
  else transforms.h6?.toggle()
}

export function toggleGitLabBlockquote(editor: PlateEditor): void {
  asGitLabPlateEditor(editor).tf.blockquote.toggle()
}

export function toggleGitLabBold(editor: PlateEditor): void {
  asGitLabPlateEditor(editor).tf.bold.toggle()
}

export function toggleGitLabItalic(editor: PlateEditor): void {
  asGitLabPlateEditor(editor).tf.italic.toggle()
}

export function toggleGitLabInlineCode(editor: PlateEditor): void {
  asGitLabPlateEditor(editor).tf.code.toggle()
}

export function toggleGitLabStrikethrough(editor: PlateEditor): void {
  asGitLabPlateEditor(editor).tf.strikethrough.toggle()
}

export function toggleGitLabList(editor: PlateEditor, listStyleType: GitLabMarkdownListStyle): void {
  toggleList(editor, { listStyleType })
}

export function indentGitLabBlock(editor: PlateEditor): void {
  indent(editor)
}

export function outdentGitLabBlock(editor: PlateEditor): void {
  outdent(editor)
}

export function createGitLabPlateCommands(editor: PlateEditor): GitLabPlateCommands {
  return {
    indentBlock: () => indentGitLabBlock(editor),
    insertRawMarkdown: markdown => insertRawGitLabMarkdown(editor, markdown),
    outdentBlock: () => outdentGitLabBlock(editor),
    resetValue: value => resetGitLabPlateValue(editor, value),
    toggleBlockquote: () => toggleGitLabBlockquote(editor),
    toggleBold: () => toggleGitLabBold(editor),
    toggleHeading: level => toggleGitLabHeading(editor, level),
    toggleInlineCode: () => toggleGitLabInlineCode(editor),
    toggleItalic: () => toggleGitLabItalic(editor),
    toggleList: listStyleType => toggleGitLabList(editor, listStyleType),
    toggleStrikethrough: () => toggleGitLabStrikethrough(editor),
    upsertLink: params => upsertGitLabLink(editor, params),
  }
}
