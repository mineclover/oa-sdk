import type { Value } from 'platejs'

export interface MarkdownImportRequest {
  readonly markdown: string
  readonly version: number
}

export interface PlateDocumentEditorDocument {
  readonly title: string
  readonly project: string
  readonly path: string
  readonly owner: string
}

export interface PlateDocumentEditorLabels {
  readonly title: string
  readonly description: string
  readonly placeholder: string
  readonly reset: string
  readonly saved: string
  readonly project: string
  readonly path: string
  readonly owner: string
  readonly blocks: string
  readonly formatting: string
  readonly references: string
  readonly status: string
  readonly blockOrder: string
  readonly dragBlock: string
  readonly linkTitle: string
  readonly linkText: string
  readonly linkUrl: string
  readonly linkApply: string
  readonly linkCancel: string
  readonly toolbar: {
    readonly heading1: string
    readonly heading2: string
    readonly heading3: string
    readonly heading4: string
    readonly heading5: string
    readonly heading6: string
    readonly quote: string
    readonly bold: string
    readonly italic: string
    readonly code: string
    readonly strike: string
    readonly link: string
    readonly bulletList: string
    readonly numberedList: string
    readonly todoList: string
    readonly indent: string
    readonly outdent: string
  }
  readonly snippets: {
    readonly issueReference: string
    readonly mergeRequestReference: string
    readonly labelReference: string
    readonly milestoneReference: string
    readonly table: string
    readonly codeFence: string
    readonly mermaid: string
    readonly math: string
    readonly toc: string
    readonly alert: string
    readonly image: string
    readonly searchPlaceholder: string
    readonly search: string
    readonly manual: string
    readonly noResults: string
    readonly unavailable: string
  }
}

export interface PlateDocumentEditorProps {
  readonly initialValue: Value
  readonly markdownImport?: MarkdownImportRequest
  readonly onMarkdownChange: (markdown: string) => void
  readonly storageKey: string
  readonly document: PlateDocumentEditorDocument
  readonly labels: PlateDocumentEditorLabels
}
