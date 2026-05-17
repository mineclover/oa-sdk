# @oa-sdk/markdown-editor

Reusable Markdown editor syntax helpers, GitLab Flavored Markdown serialization,
GLFM snippets, Plate presets, and editor themes.

## Theme CSS

Import the base editor styles once, then import exactly one theme file after it:

```ts
import '@oa-sdk/markdown-editor/themes/base.css'
import '@oa-sdk/markdown-editor/themes/gitlab.css'
```

Available themes:

- `@oa-sdk/markdown-editor/themes/gitlab.css`
- `@oa-sdk/markdown-editor/themes/compact.css`
- `@oa-sdk/markdown-editor/themes/high-contrast.css`

Host apps can override any `--md-editor-*` variable after importing a theme.
For example:

```css
:root {
  --md-editor-content-padding: 16px;
  --md-editor-link-color: #005fcc;
}
```

The Plate preset also accepts class name overrides through
`createGitLabPlatePlugins({ classNames })` when a host wants to use its own
semantic CSS hooks.

