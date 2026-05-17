export type {
  MarkdownEditorNode,
  MarkdownEditorValue,
  MarkdownElementNode,
  MarkdownInlineNode,
  MarkdownTextNode,
} from './core/types.js'
export {
  isMarkdownEditorValue,
  parseStoredEditorValue,
  serializeEditorValue,
} from './core/persistence.js'
export { plateValueToGitLabMarkdown } from './glfm/serialize-plate.js'
export {
  gitLabMarkdownAutocompleteTriggers,
  type GitLabMarkdownAutocompleteItem,
  type GitLabMarkdownAutocompleteKind,
  type GitLabMarkdownAutocompleteProvider,
  type GitLabMarkdownAutocompleteRequest,
  type GitLabMarkdownAutocompleteTrigger,
} from './glfm/autocomplete.js'
export {
  createGitLabMarkdownImageSnippetMarkdown,
  gitLabMarkdownSnippets,
  type GitLabMarkdownImageSnippet,
  type GitLabMarkdownPromptSnippet,
  type GitLabMarkdownRawSnippet,
  type GitLabMarkdownReferenceKind,
  type GitLabMarkdownReferenceSnippet,
  type GitLabMarkdownSnippet,
  type GitLabMarkdownSnippetId,
  type GitLabMarkdownSnippetLabelKey,
} from './glfm/snippets.js'
