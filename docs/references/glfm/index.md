# GitLab Flavored Markdown reference

> source: [GitLab Flavored Markdown (GLFM)](https://docs.gitlab.com/user/markdown/)
> scope: `apps/orchestrator-gitlab-ui` document editor, GitLab Wiki pages, repository Markdown documents, and releases.

This reference is the working baseline for GitLab document authoring in this
repository. Any editor feature that serializes content for GitLab must preserve
GitLab Flavored Markdown rather than generic Markdown only.

## Current editor target

The first implementation target is a safe authoring subset for project context
documents:

- headings `#` through `######`
- paragraphs and blockquotes
- bold, italic, inline code, and strikethrough
- inline links
- unordered lists
- ordered lists
- nested lists through indentation
- task lists using `- [ ]` and `- [x]`
- task list inapplicable state using `- [~]`
- issue task lookup and line-based mutation through `/issues/:iid/tasks`
- raw GLFM snippets for GitLab-specific references such as `#123`, `!123`,
  `~"label"`, and `%milestone`
- GitLab API-backed search insertion for issue and merge request references
- provider-neutral autocomplete hooks for labels, milestones, users, commits,
  and snippets
- raw GLFM snippets for tables, fenced code blocks, Mermaid diagrams, math
  blocks, table of contents tags, alerts, and images

## GLFM backlog

The editor is not yet a complete GLFM implementation. Track these as explicit
feature work instead of assuming generic Markdown compatibility is enough:

- embedded media and attachment upload workflows
- structured autocomplete for commits, labels, milestones, users, and snippets
- automatic URL linking behavior
- description lists
- emoji and custom emoji
- footnotes
- front matter
- includes and placeholders
- inline diffs
- wiki-specific Markdown

## Implementation rule

When extending the editor, add serializer tests that assert the exact GLFM text
sent to the save payload. The UI may use Plate nodes internally, but the
contract boundary is the generated GitLab Markdown string.
