# @oa-sdk/typespec-tooling

TypeSpec IDE tooling, VS Code configuration presets, snippets, and linter rules for the `oa-sdk` monorepo.

## Features

- **VS Code Configuration Presets**: Recommended extensions and settings for TypeSpec formatting (`typespec.typespec-vscode`) and LSP integration.
- **Snippets**: Productivity snippets for HTTP operations (`@route`, `@summary`, `@operationId`), response components (`@oaUseResponseComponent`), and logical ERD modeling (`@entity`, `@field`, `@primaryKey`, `@relationship`).
- **Linter Rules**: TypeSpec compiler rules (`require-operation-id`, `require-documentation`) for API contract consistency.

## Usage

```typescript
import {
  createDefaultVsCodeSettings,
  createDefaultVsCodeExtensions,
  typeSpecSnippets,
  oaSdkLinter,
} from '@oa-sdk/typespec-tooling'
```
