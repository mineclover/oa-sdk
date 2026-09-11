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

## Zod 4 Schema Code Generation

Generate idiomatic Zod 4 validation schemas and inferred TypeScript types from OpenAPI 3.2 (JSON Schema Draft 2020-12) specifications:

```bash
# CLI: generate Zod schemas from an OpenAPI spec
pnpm exec oa-gen generate:zod --spec packages/schemas/dist/openapi.yaml --output ./generated/zod
```

Programmatic usage:

```typescript
import { generateZodFromSpec, createRuntimeZodValidators } from '@oa-sdk/codegen/zodgen';

// 1. Static TypeScript code emission:
const { source, schemaNames } = generateZodFromSpec(openApiDoc, {
  exportTypes: true,
  style: 'both',
});

// 2. In-memory dynamic runtime validator (native Zod 4 z.fromJSONSchema):
const validators = createRuntimeZodValidators(openApiDoc);
const result = validators.User.safeParse(data);
```

### Preflight Validation & Normalization

`oa-gen generate:zod` and `generateZodFromSpec` include an automated preflight schema validation, linting, and normalization pipeline. Broken `$ref`s or schema defects trigger structured fail-fast diagnostics:

```bash
# Validate and normalize before generation (default)
pnpm exec oa-gen generate:zod --spec spec.yaml --output ./zod

# Bypass validation or normalization when required
pnpm exec oa-gen generate:zod --spec spec.yaml --output ./zod --no-validate --no-normalize
pnpm exec oa-gen generate:zod --spec spec.yaml --output ./zod --force
```

## TypeScript Shape Taxonomy Audit

Audit TypeScript source files against the 24-feature syntax taxonomy to determine OpenAPI/TypeSpec projection feasibility:

```bash
# Audit declarations for projection feasibility
pnpm exec oa-gen audit:shape --source src/models/types.ts
```

