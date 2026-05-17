import type { Value } from 'platejs'
import {
  parseStoredEditorValue as parseStoredMarkdownEditorValue,
  plateValueToGitLabMarkdown as markdownEditorValueToGitLabMarkdown,
  serializeEditorValue as serializeMarkdownEditorValue,
  type MarkdownEditorValue,
} from '@oa-sdk/markdown-editor'

export const documentEditorStorageKeyPrefix = 'orchestrator-gitlab-ui.docs.editor.value'

export interface DocumentEditorSeed {
  readonly id: string
  readonly title: string
  readonly project: string
  readonly path: string
  readonly owner: string
}

export type GitLabDocumentTarget = 'wiki' | 'repository' | 'release'

export interface GitLabDocumentSaveDraft {
  readonly documentId: string
  readonly target: GitLabDocumentTarget
  readonly project: string
  readonly path: string
  readonly title: string
  readonly markdown: string
}

export const defaultDocumentValue: Value = [
  {
    children: [{ text: 'Release Notes v2.4' }],
    type: 'h2',
  },
  {
    children: [
      {
        text: 'Summarize GitLab issue decisions, linked merge requests, rollout notes, and release evidence here.',
      },
    ],
    type: 'p',
  },
  {
    children: [{ text: 'Review checklist' }],
    type: 'h3',
  },
  {
    children: [
      {
        text: 'Confirm Wiki links, repository docs, and release documentation are aligned before publishing.',
      },
    ],
    type: 'p',
  },
]

export function documentEditorStorageKey(documentId: string): string {
  return `${documentEditorStorageKeyPrefix}.${documentId}`
}

export function createDocumentInitialValue(document: DocumentEditorSeed): Value {
  return [
    {
      children: [{ text: document.title }],
      type: 'h2',
    },
    {
      children: [
        {
          text: `Project: ${document.project}`,
        },
      ],
      type: 'p',
    },
    {
      children: [
        {
          text: `Path: ${document.path}`,
        },
      ],
      type: 'p',
    },
    {
      children: [{ text: 'Editorial notes' }],
      type: 'h3',
    },
    {
      children: [
        {
          text: `Owner ${document.owner} should align issue decisions, merge requests, release evidence, and publishing notes here.`,
        },
      ],
      type: 'p',
    },
  ]
}

export function parseStoredEditorValue(rawValue: string | null, fallbackValue: Value = defaultDocumentValue): Value {
  return parseStoredMarkdownEditorValue(rawValue, fallbackValue as MarkdownEditorValue) as Value
}

export function serializeEditorValue(value: Value): string {
  return serializeMarkdownEditorValue(value as MarkdownEditorValue)
}

export function plateValueToGitLabMarkdown(value: Value): string {
  return markdownEditorValueToGitLabMarkdown(value as MarkdownEditorValue)
}

export function createGitLabDocumentSaveDraft(params: GitLabDocumentSaveDraft): GitLabDocumentSaveDraft {
  return params
}
