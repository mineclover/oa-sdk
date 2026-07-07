# @oa-sdk/dpm

Relationship-first Data Pseudonymization Manifest toolkit for turning database and profile evidence into reviewable, executable pseudonymization contracts.

## Consumer Surface

Prefer package subpaths for new consumers. The root `@oa-sdk/dpm` entrypoint remains a compatibility aggregate, but focused imports keep product code tied to the smallest stable surface.

| Import | Use for | Source owner |
|---|---|---|
| `@oa-sdk/dpm/package` | package metadata and manifest schema validation | `src/public/package.ts` |
| `@oa-sdk/dpm/catalog` | catalog snapshots, PostgreSQL catalog profiling, OpenAPI projection adapters | `src/public/catalog.ts` |
| `@oa-sdk/dpm/profile` | profile artifacts, Kafka topic profiling, connector validation, profile analysis | `src/public/profile.ts` |
| `@oa-sdk/dpm/relationship` | relationship discovery, registry snapshots, model helpers, validation/compile/dry-run | `src/public/relationship.ts` |
| `@oa-sdk/dpm/gateway` | OpenAPI contract document and in-process runtime helpers | `src/public/gateway.ts` |
| `@oa-sdk/dpm/storage` | job, report, registry, and profile baseline repositories/adapters | `src/public/storage.ts` |
| `@oa-sdk/dpm/publishing` | AI schema context and physical foreign-key recommendation projections | `src/public/publishing.ts` |

`package.json` publishes the same subpaths and `src/index.ts` re-exports the category barrels for compatibility.

## Practical Loops

### Manifest execution

Use `@oa-sdk/dpm/catalog` to build or load catalog evidence, then use `@oa-sdk/dpm/relationship` to validate, compile, and dry-run a manifest against an approved registry snapshot.

The manifest schema version is exposed through `DPM_VERSION`. It is the DPM contract baseline, not the npm package version in `package.json`.

### Kafka profile review

Use `@oa-sdk/dpm/profile` to convert a captured Kafka topic bundle into a profile connector result. The Kafka connector validates malformed input before graph creation, returns failed connector results as diagnostics, and keeps failed envelopes compatible with the generic connector validator.

Profile analysis produces review proposals. It does not auto-approve relationships. Use `@oa-sdk/dpm/gateway` for the product workflow that bridges a reviewer-selected profile hint into candidate import, approval, registry write receipt, and registry snapshot export.

### Persistence and publishing

Use `@oa-sdk/dpm/storage` when product code needs registry rows, approval audit events, job/report rows, or profile baseline history. Use `@oa-sdk/dpm/publishing` to project compiled relationship metadata into AI-readable context without exposing source database credentials, token vault material, raw payload samples, or reverse token lookup APIs.

## Safety Boundaries

- Connectors produce evidence; approved registry snapshots remain the execution source of truth.
- PostgreSQL catalog profiling is read-only catalog evidence collection.
- Kafka profile fixtures contain captured shape and metrics, not message payload samples.
- Physical foreign-key output is recommendation-only and does not mutate a target database.
- Split registry storage adapters are convenient for tests and simple integrations. Production approval flows should prefer an atomic commit adapter or database constraints that reject concurrent approved-version conflicts.

## Verification

Package surface regressions are covered by:

```bash
pnpm --filter @oa-sdk/dpm run smoke:subpaths
pnpm --filter @oa-sdk/dpm run smoke:pack
```

Product-oriented profile review is exercised by:

```bash
pnpm demo:dpm:profile
```
