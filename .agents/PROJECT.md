# Project: Modular Agent Skill Architecture for oa-sdk Monorepo

## Architecture
This project establishes a modular, closed-by-default agent skill architecture for the `oa-sdk` monorepo across all 4 architectural tiers (17 packages, 5 applications):
1. **Tier 1: Core & Codegen**:
   - `@oa-sdk/core`: Core primitives, shared error envelope `ApiError<Code>`, root resolution.
   - `@oa-sdk/parser`: OpenAPI 3.1/3.2 AST pipeline, definition IDs, collision resolution, cycle dereferencing, route specificity matching.
   - `@oa-sdk/codegen`: AST bidirectional sync via `EntitySpec`, bottom-up reverse-offset patch engine (`applyTextEdits`), Typia `ts.IntersectionTypeNode` tag parsing, Zod/TS adapters, zero-eval CSP enforcement (`oa-gen audit:csp`).
   - `@oa-sdk/schemas`: Modular OpenAPI 3.1/3.2 schema fragmentation, bundle/merge algorithms, `oa-gen validate --require-32`.
2. **Tier 2: Spec-Lens Platform**:
   - `@oa-sdk/spec-lens`: SQLite WAL cache lifecycle (`.spec-lens.db`), CQRS command/query handlers, symbol indexing, diff engine.
   - `@oa-sdk/spec-lens-contract`: Browser-safe wire contracts, schema version pinning, runtime response guards (`isSpecLensResponse`).
   - `apps/spec-lens`: React 19 UI with D3.js force-directed dependency graphs and Monaco split diff views.
3. **Tier 3: Runtime & Downstream**:
   - `@oa-sdk/router`: Typed Hono/Express route stubs, colon path mapping (`toColonPath`), OAS 3.2 verb handling (`HEAD`, `TRACE`, `QUERY`), raw query string extraction (`__readOaRawQuerystring`).
   - `@oa-sdk/client`: Zero-dependency typed fetch client SDK, structural duck-typing (`isClientError`), exponential backoff retry with `Retry-After` parsing, body stream cancellation, SSE and NDJSON streaming.
   - `@oa-sdk/mock-server`: Dual MSW and Node HTTP mock server adapters, WeakMap cached regex router, specificity scoring, stateful overrides (`server.override`), 422 sensitive value redaction (`MockReceivedValueSummary`).
   - `@oa-sdk/typia-mock`: Maintenance-only quarantine boundary isolating compiler transforms (`ttsc`/`ts-patch`), 3-stage validation pipeline (`parse` -> `coerce` -> `validate`), minimal mock synthesis.
4. **Tier 4: TypeSpec & Governance**:
   - `@oa-sdk/typespec-*`: Emitters and decorators (`$oaUseResponseComponent`, `$dataset`, `$entity`, `$field`, `$primaryKey`, `$relationship`).
   - `@oa-sdk/personas`: API persona capability traits (`packages/personas/src/traits/skill.yaml`), 3-bucket architecture (`identity`, `reference`, `outcome`), profile rendering.
   - `@oa-sdk/dpm`: Dynamic Package Manager subpaths, `DpmNeutralDataBindingArtifact`, fail-closed row execution boundary.
5. **Closed-by-Default Governance & Document Gates**:
   - Skill registration in `.agents/skills.json` and `.agents/plugins.json`.
   - `@spec-platform/document-gates` validation (`createAgentConfigGate`, `createMarkdownLocalLinkGate`, `createCliExampleGate`, `createPackageEntrypointGate`).
   - Repository-wide documentation verification via `pnpm check:docs`.

## Code Layout
- `.agents/skills/oa-codegen/SKILL.md`: AST bidirectional sync, trivia retention, Typia AOT tag parsing, Zod/TS adapters, CSP audit rules.
- `.agents/skills/oa-spec-lens/SKILL.md`: SQLite WAL schema & lifecycle, symbol indexing & query APIs, markdown projection, contract-first architecture.
- `.agents/skills/oa-schemas/SKILL.md`: Modular OpenAPI 3.1/3.2 schema fragmentation, bundling algorithms, circular reference resolution, `oa-gen validate --require-32`.
- `.agents/skills/oa-runtime/SKILL.md`: Downstream runtime architecture, route matching, typed client generation, in-memory mock server, Typia compiler transform isolation.
- `.agents/skills/oa-governance/SKILL.md`: API persona capability traits, DPM patterns, Closed-by-Default governance, 4-tier build/test verification.
- `.agents/skills.json`: Agent skill configuration and directory whitelisting.
- `.agents/plugins.json`: Agent plugin configuration.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | `oa-codegen` Skill Authoring | AST bidirectional sync, trivia preservation, Typia `ts.IntersectionTypeNode` tag parsing, Zod/TS adapters, CSP zero-eval rules | M1 | ORIGINAL_REQUEST §R2.1 |
| F2 | `oa-schemas` Skill Authoring | Modular OpenAPI 3.1/3.2 schema fragmentation, bundle/merge algorithms, circular reference resolution, `oa-gen validate --require-32` | M1 | ORIGINAL_REQUEST §R2.3 |
| F3 | `oa-spec-lens` Skill Authoring | SQLite WAL database lifecycle (`.spec-lens.db`), symbol indexing & query APIs, markdown projection, contract-first architecture | M2 | ORIGINAL_REQUEST §R2.2 |
| F4 | `oa-runtime` Skill Authoring | Downstream runtime architecture, route matching, typed client generation, in-memory mock server, Typia compiler transform isolation | M3 | ORIGINAL_REQUEST §R2.4 |
| F5 | `oa-governance` Skill Authoring | API persona capability traits (`skill.yaml`), DPM patterns, Closed-by-Default agent skill governance, 4-tier build/test verification | M3 | ORIGINAL_REQUEST §R2.5 |
| F6 | Governance Registry Configuration | Register and whitelist all 5 modular skills in `.agents/skills.json` and `.agents/plugins.json` under closed-by-default rules | M4 | ORIGINAL_REQUEST §R3 |
| F7 | Document Gates Verification | Verify all skills and docs comply with `@spec-platform/document-gates` (`createAgentConfigGate`, link gates, CLI example gates) | M5 | ORIGINAL_REQUEST §R3, AC |
| F8 | Monorepo Documentation Integrity | Execute `pnpm check:docs` across entire monorepo with 0 errors | M5 | ORIGINAL_REQUEST §R3, AC |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core & Codegen + Schemas Skills | Features F1, F2 (`.agents/skills/oa-codegen/SKILL.md`, `.agents/skills/oa-schemas/SKILL.md`) | none | IN_PROGRESS |
| M2 | Spec-Lens Platform Skill | Feature F3 (`.agents/skills/oa-spec-lens/SKILL.md`) | none | PLANNED |
| M3 | Runtime & Governance Skills | Features F4, F5 (`.agents/skills/oa-runtime/SKILL.md`, `.agents/skills/oa-governance/SKILL.md`) | none | PLANNED |
| M4 | Closed-by-Default Registry Config | Feature F6 (`.agents/skills.json`, `.agents/plugins.json`) | M1, M2, M3 | PLANNED |
| M5 | Final Milestone: Verification & Integrity | Features F7, F8 (`createAgentConfigGate`, `pnpm check:docs`, Reviewers, Challengers, Forensic Auditor) | M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### Skill Document Structure Contract
Every `SKILL.md` under `.agents/skills/<skill-name>/SKILL.md` must adhere to:
1. **Frontmatter**:
   ```yaml
   ---
   name: <skill-name>
   description: <detailed description matching Antigravity and document-gates schema>
   ---
   ```
2. **Architectural Boundaries**: Mermaid diagrams illustrating component boundaries, data flow, and package relationships.
3. **Deep Operational Recipes & Code Snippets**: Concrete TypeScript/YAML/CLI snippets with exact flags, parameters, and algorithms.
4. **Troubleshooting Matrices**: Symptom, Root Cause, Remediation table.
5. **Local Link & CLI Example Gate Compliance**: No broken internal links, valid bash command blocks with real flags.

### Governance Whitelist Contract
`.agents/skills.json` and `.agents/plugins.json` must adhere to Closed-by-Default rules:
- No uncontained wildcards (`.*`, `*`).
- Hermetic directory references (`.agents/skills`).
- Whitelisted pattern constraints matching `@spec-platform/document-gates`.
