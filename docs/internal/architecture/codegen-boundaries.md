# Codegen Internal Boundaries

`@oa-sdk/codegen` remains one public package for compatibility, but its internal responsibilities
are intentionally separated into five zones.

| Zone | Owns | Direction |
|---|---|---|
| `src/typegen/` | OpenAPI → TypeScript type generation | depends on parser/core only |
| `src/drizzle/` | Drizzle → Zod/OpenAPI projection | adapter layer; no governance CLI imports |
| `src/builder-index.ts` | Definition Builder primitives | consumed by governance build commands |
| `src/cli/commands/`, `src/cli/lib/` | validate, diff, review, TypeSpec, artifact governance | orchestration layer |
| `src/spec-lens/` | spec-lens-facing provenance/diff adapter | explicit governance integration facade |

The stable rule is that `typegen` and `drizzle` do not import `cli` implementation modules. The CLI
may compose them, and the package root may expose selected public helpers. This keeps a future
`@oa-sdk/governance` extraction possible without changing the current public package first.

```bash
pnpm check:codegen-boundaries
```
