# PRD: Markdown Editor Library

Status: implemented through US-005. This PRD tracks extracting the GitLab Markdown editor work from `apps/orchestrator-gitlab-ui` into a reusable editor library that can evolve syntax support, themes, snippets, and host integrations independently.

## Overview

The GitLab UI currently owns both the application workflow and the Markdown syntax implementation. The editor already supports a focused GitLab Flavored Markdown subset, including headings, inline marks, lists, task lists, links, raw GLFM snippets, and GitLab reference insertion. To keep this maintainable, the Markdown syntax layer should become a package with clear contracts, tests, and extension points.

The first milestone is intentionally narrow: move pure value persistence and Plate-to-GLFM serialization into a reusable package, then let the GitLab UI consume it. Later milestones can lift the React/Plate shell, snippet registry, theme tokens, and provider adapters.

## Goals

- Separate Markdown syntax contracts from GitLab UI page state and save workflows.
- Keep generated GitLab Markdown as the compatibility boundary.
- Provide a package API for editor value persistence, GLFM serialization, raw snippet nodes, and future syntax feature packs.
- Preserve current GitLab UI behavior while moving implementation behind a reusable package.
- Enable multiple themes and host-specific provider adapters without coupling them to the serializer.

## Non-Goals

- Do not replace Plate in the first milestone.
- Do not implement a full GLFM parser in the first milestone.
- Do not move GitLab API calls into the library; host apps should inject providers.
- Do not change GitLab document save API behavior.

## Package Ownership

- `@oa-sdk/markdown-editor` owns Markdown editor value contracts, persistence helpers, GLFM serialization, and future reusable editor presets.
- `@oa-sdk/orchestrator-gitlab-ui` owns GitLab document targets, save payloads, API options, local document seed content, and GitLab reference search wiring.
- `docs/references/glfm` remains the source reference for GLFM behavior and backlog.

## Quality Gates

- `pnpm --filter @oa-sdk/markdown-editor test`
- `pnpm --filter @oa-sdk/markdown-editor typecheck`
- `pnpm --filter @oa-sdk/orchestrator-gitlab-ui test`
- `pnpm --filter @oa-sdk/orchestrator-gitlab-ui typecheck`

When a GLFM feature is added, add exact serializer tests for the Markdown payload string.

## User Stories

### US-001: Extract Pure GLFM Serialization
**Description:** As an editor maintainer, I want GLFM serialization in a reusable package so that Markdown syntax behavior can be tested and versioned outside the GitLab UI.

**Acceptance Criteria:**
- [x] Create `@oa-sdk/markdown-editor`.
- [x] Move Plate-compatible value types into the package without requiring React.
- [x] Move stored editor value parse/serialize helpers into the package.
- [x] Move `plateValueToGitLabMarkdown` into the package as a GLFM serializer.
- [x] Preserve heading, paragraph, blockquote, inline mark, link, list, task list, indentation, and raw GLFM snippet behavior.
- [x] Add exact serializer tests in the package.
- [x] Update `orchestrator-gitlab-ui` to consume the package.
- [x] Focused package and app tests pass.

### US-002: Introduce GLFM Snippet Registry
**Description:** As an editor maintainer, I want GitLab-specific snippets declared as data so that tables, code fences, Mermaid, math, TOC, alerts, images, labels, milestones, issues, and merge requests are easier to add or customize.

**Acceptance Criteria:**
- [x] Define snippet IDs and metadata.
- [x] Support prompt-backed snippets without hardcoding prompt text inside the editor shell.
- [x] Keep issue/MR lookup provider injected by the host app.
- [x] Add tests for snippet raw Markdown output.

### US-003: Extract Plate Preset and Commands
**Description:** As a React app developer, I want a reusable Plate preset and command map so that host apps can render their own toolbar while sharing Markdown behavior.

**Acceptance Criteria:**
- [x] Move Plate plugin list and element components into a reusable preset.
- [x] Expose command helpers for headings, blockquote, marks, lists, indentation, links, and raw GLFM insertion.
- [x] Keep host styling and labels configurable.
- [x] Verify the GitLab UI toolbar still performs existing actions.

### US-004: Add Theme Tokens
**Description:** As a product developer, I want multiple editor themes so that the same Markdown editor can fit operational dashboards, docs pages, and high-contrast workflows.

**Acceptance Criteria:**
- [x] Define stable `--md-editor-*` CSS variables.
- [x] Add base, GitLab-like, compact, and high-contrast theme files.
- [x] Migrate app CSS to theme variables without visual regressions.
- [x] Document theme import and override rules.

### US-005: Expand GLFM Coverage
**Description:** As a GitLab documentation author, I want more GLFM syntax support so that the editor can cover advanced documentation workflows over time.

**Acceptance Criteria:**
- [x] Prioritize backlog from `docs/references/glfm/index.md`.
- [x] Add support for task list inapplicable state `[~]`.
- [x] Add structured autocomplete hooks for labels, milestones, users, commits, and snippets.
- [x] Add feature tests for every supported syntax addition.
