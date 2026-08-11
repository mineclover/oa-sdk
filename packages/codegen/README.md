# @oa-sdk/codegen

`@oa-sdk/codegen` provides the `oa-gen` CLI for OpenAPI collection, review, validation,
TypeScript generation, and external-service governance scaffolding.

## Install

The package is published to the public npm registry. Install it as a development dependency:

```bash
pnpm add -D @oa-sdk/codegen
pnpm exec oa-gen --help
```

The published package includes its runtime dependencies (`@oa-sdk/core`,
`@oa-sdk/parser`, `@oa-sdk/openapi-projection-contract`, and
`@oa-sdk/typespec-decorators`). It requires Node.js 22 or later.

This distribution boundary covers the core OA Gen CLI: collection, normalization, review,
validation, type generation, provenance/evidence, and governance scaffolding. Router, client,
and mock generation remain private workspace integrations and are deliberately absent from the
published `oa-gen` command registry.

## First governance scaffold

```bash
pnpm exec oa-gen scaffold-governance \
  --root . \
  --service orders \
  --profile nestjs-swagger \
  --source-command "pnpm export:openapi" \
  --typegen-policy verify-only
```

Use `commit-required` only when the generated TypeScript output is intentionally committed and
reviewed. The generated `openapi-governance.md` documents the produced contract and CI setup.

TypeSpec remains the human-authored contract source for OA SDK production schemas. AST provenance
and external OpenAPI governance evidence are review and traceability artifacts; they do not become
an alternate schema authority.
