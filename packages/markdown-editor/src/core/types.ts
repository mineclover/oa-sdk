export interface MarkdownTextNode {
  readonly text?: string
  readonly bold?: boolean
  readonly italic?: boolean
  readonly code?: boolean
  readonly strikethrough?: boolean
  readonly [key: string]: unknown
}

export interface MarkdownElementNode {
  readonly type?: string
  readonly children: MarkdownInlineNode[]
  readonly indent?: number
  readonly listStyleType?: string
  readonly checked?: boolean
  readonly taskState?: 'open' | 'done' | 'inapplicable'
  readonly glfmRaw?: boolean
  readonly url?: string
  readonly [key: string]: unknown
}

export type MarkdownInlineNode = MarkdownTextNode | MarkdownElementNode

export type MarkdownEditorNode = MarkdownElementNode

export type MarkdownEditorValue = MarkdownEditorNode[]
