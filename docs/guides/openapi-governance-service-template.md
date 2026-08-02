# OpenAPI Governance Service Template

새 서비스에 oa-sdk governance를 붙일 때 사용하는 표준 템플릿이다. 외부 프레임워크가
생성하는 OpenAPI 산출물(NestJS Swagger, FastAPI 등)은 먼저 스캐폴드 명령으로
`raw → normalized → upgraded` artifact interface를 만든다.

```bash
oa-gen scaffold-governance \
  --root services/{service} \
  --service {service-name} \
  --profile generic \
  --source-command "{command-that-writes-contracts/openapi.raw.yaml}" \
  --runtime-openapi-url http://localhost:{port}/openapi.json \
  --oa-gen-command "oa-gen" \
  --oa-gen-setup-command "{service-specific-install-or-build-command}" \
  --typegen-policy verify-only
```

NestJS Swagger 서비스는 `--profile nestjs-swagger`를 사용한다.

## Service Profile

| Field | Value |
|---|---|
| Service name | `{service-name}` |
| Owner | `{team-or-owner}` |
| Runtime base URL | `http://localhost:{port}` |
| Runtime OpenAPI URL | `http://localhost:{port}/openapi.json` |
| Raw artifact | `contracts/openapi.raw.yaml` |
| Normalized governance artifact | `contracts/openapi.normalized.yaml` |
| OpenAPI 3.2 analysis artifact | `contracts/openapi.upgraded.yaml` |
| Baseline OpenAPI | `contracts/v1.openapi.yaml` |
| Baseline provenance | `contracts/baselines/{service}/v1.provenance.json` |
| Target config | `{path-to-target.yaml}` |
| Fragments root | `{path-to-fragments}` |
| Governance output dir | `artifacts/openapi-governance/{service-name}` |

## Input Mode

Choose one primary source mode.

| Mode | When to use | Required fields |
|---|---|---|
| Managed OpenAPI only | Service already emits/owns one OpenAPI document | Managed OpenAPI, generated artifact, runtime URL |
| Definition Builder target | Service owns modular fragments and target configs | Target config, fragments root, managed artifact output |
| Projection producer | Service emits OpenAPI Projection envelope or component bundle | Projection snapshot, managed OpenAPI adapter output |
| Python ContractSpec snapshot | Python service uses `oa-contract` snapshot | ContractSpec JSON, emitted OpenAPI artifact |

## Artifact Interface

`openapi-governance.config.json` declares which artifact each oa-sdk capability consumes.

```json
{
  "schemaVersion": "oa-gen.openapi-governance.v2",
  "artifacts": {
    "raw": "contracts/openapi.raw.yaml",
    "normalized": "contracts/openapi.normalized.yaml",
    "upgraded": "contracts/openapi.upgraded.yaml",
    "baseline": "contracts/v1.openapi.yaml",
    "collectReport": "contracts/openapi.collect-report.json",
    "typegen": "src/generated/api-types.ts"
  },
  "consumers": {
    "governance": "artifacts.normalized",
    "review": "artifacts.normalized",
    "typegen": "artifacts.normalized",
    "inventory": "artifacts.upgraded",
    "validate": "artifacts.upgraded",
    "driftManaged": "artifacts.normalized"
  },
  "tooling": {
    "oaGenCommand": "oa-gen",
    "installation": "path-command",
    "setupCommand": "{service-specific-install-or-build-command}"
  },
  "automation": {
    "artifactDirectory": ".oa-sdk/governance",
    "reviewBundle": ".oa-sdk/governance/review-bundle.md",
    "typegen": {
      "policy": "verify-only"
    },
    "baseline": {
      "source": "artifacts.normalized",
      "promotion": "reviewed-commit"
    }
  }
}
```

Use `normalized` for contract stability and breaking-change review. Use `upgraded`
for OpenAPI 3.2 inventory, validation, and analysis features.

`tooling.oaGenCommand` is the service-local default and can be overridden by
`OA_GEN` in developer shells or CI. `tooling.setupCommand` is optional trusted
shell input that the generated CI uses to install or build that command. The generated scaffold never resolves an
OA SDK monorepo path. `automation.artifactDirectory` is uploaded by the
generated GitHub Actions template; baseline promotion remains a reviewed commit
even though `update-baseline` performs the local file copy.

`automation.typegen.policy` makes generated-TypeScript ownership explicit. Use
`verify-only` when the file is an ignored build artifact: CI must generate it successfully,
but does not require a commit. Use `commit-required` only when the generated file is a
reviewed source artifact: the CI target verifies both Git tracking and a clean diff after
generation. `ci` always runs typegen, so the policy cannot silently be bypassed by using the
CI entrypoint instead of `all`.

### v1 → v2 migration

`oa-gen.openapi-governance.v1` is not read as a live configuration. Re-run the
scaffold with `--force`, explicitly supplying the service's `--oa-gen-command`
and, where CI must prepare it, `--oa-gen-setup-command`; select `--typegen-policy` explicitly
when the generated artifact is committed. This rewrites only the
config, rendered script, service guide, and generated workflow; it does not
rewrite the committed OpenAPI baseline. Review the resulting baseline policy
and CI shell command in the same pull request.

## Path Ownership

> External-artifact mode: declare these paths in the service's CI gate via `--must-include-path` / `--must-exclude-path` flags on `oa-gen target-check --artifact`. The scaffold's rendered script does not run target-check; add it to CI as needed.

List expected public surface.

```yaml
mustIncludePaths:
  - /health
  - /users

mustExcludePaths:
  - /admin
  - /internal
```

For nested paths, follow [Path Fragment Conventions](./path-fragment-conventions.md).

```txt
/books/{bookId}/notes/{noteId}
→ fragments/path/public/book/books/by-book-id/notes/by-note-id/BookNoteByIdPath.yaml
```

## Target Artifact And Sidecars

> Definition Builder mode only. External-artifact services skip this entire section — the rendered `scripts/openapi-governance.sh` produces normalized/upgraded artifacts via `oa-gen collect` instead.

```bash
SERVICE={service-name}
OUT=artifacts/openapi-governance/$SERVICE

mkdir -p "$OUT"

oa-gen build-spec \
  --target {path-to-target.yaml} \
  --fragments {path-to-fragments} \
  --output "$OUT/$SERVICE.openapi.yaml" \
  --diagnostics "$OUT/$SERVICE.diagnostics.json" \
  --collision-report "$OUT/$SERVICE.collisions.json" \
  --composition-report "$OUT/$SERVICE.composition.json" \
  --provenance "$OUT/$SERVICE.provenance.json" \
  --metadata-registry "$OUT/$SERVICE.metadata.json"
```

Skip this section for services that do not use Definition Builder target configs.

## Standard Checks

Definition Builder mode:

```bash
SERVICE={service-name}
OUT=artifacts/openapi-governance/$SERVICE

oa-gen validate --spec {path-to-managed-openapi.yaml}

oa-gen diff \
  --base contracts/baselines/$SERVICE/v1.openapi.yaml \
  --head {path-to-managed-openapi.yaml} \
  --fail-on-breaking

oa-gen check-artifact \
  --head {path-to-managed-openapi.yaml} \
  --artifact {path-to-generated-openapi.yaml}

oa-gen inventory \
  --spec {path-to-managed-openapi.yaml} \
  --format json \
  > "$OUT/$SERVICE.inventory.json"
```

Scaffolded external-artifact mode:

```bash
bash scripts/openapi-governance.sh collect
bash scripts/openapi-governance.sh check
bash scripts/openapi-governance.sh review
bash scripts/openapi-governance.sh review-bundle
bash scripts/openapi-governance.sh typegen
bash scripts/openapi-governance.sh inventory
bash scripts/openapi-governance.sh validate-upgraded
bash scripts/openapi-governance.sh drift
bash scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"
bash scripts/openapi-governance.sh update-baseline
bash scripts/openapi-governance.sh all
```

## Duplicate Review

> Definition Builder mode only. External-artifact services skip this section — there are no fragments to dedupe.

정책 선택과 추가 `--check`/`--fail-on` 설정은 [Duplicate Review 가이드](./duplicate-review.md)를 따른다.

```bash
oa-gen duplicate-review \
  --fragments {path-to-fragments} \
  --policy ci \
  --target {path-to-target.yaml} \
  --format json \
  > "$OUT/$SERVICE.duplicate-review.json"
```

Skip this section if the service does not use Definition Builder fragments.

## Target Coverage

Definition Builder target mode:

```bash
oa-gen target-check \
  --target {path-to-target.yaml} \
  --fragments {path-to-fragments} \
  --must-include-path /health \
  --must-exclude-path /admin \
  --format json \
  > "$OUT/$SERVICE.target-check.json"
```

Artifact mode:

```bash
oa-gen target-check \
  --artifact {path-to-generated-openapi.yaml} \
  --must-include-path /health \
  --must-exclude-path /admin \
  --format json \
  > "$OUT/$SERVICE.target-check.json"
```

## Runtime Drift

URL mode:

```bash
oa-gen drift \
  --runtime-openapi-url http://localhost:{port}/openapi.json \
  --managed-openapi {path-to-managed-openapi.yaml} \
  --format json \
  > "$OUT/$SERVICE.runtime-drift.json"
```

Authenticated URL mode:

```bash
oa-gen drift \
  --runtime-openapi-url https://api.example.test/openapi.json \
  --runtime-header "Authorization: Bearer $OPENAPI_TOKEN" \
  --managed-openapi {path-to-managed-openapi.yaml} \
  --format json \
  > "$OUT/$SERVICE.runtime-drift.json"
```

The drift report records request header names only, not header values.

File mode:

```bash
oa-gen drift \
  --runtime-openapi {path-to-runtime-openapi.yaml} \
  --managed-openapi {path-to-managed-openapi.yaml} \
  --format json \
  > "$OUT/$SERVICE.runtime-drift.json"
```

If runtime OpenAPI requires more complex authentication than static headers, produce a local runtime
OpenAPI file first and use file mode.

## Review Bundle

Definition Builder mode (full sidecar set):

```bash
oa-gen review-bundle \
  --base contracts/baselines/$SERVICE/v1.openapi.yaml \
  --head {path-to-managed-openapi.yaml} \
  --artifact {path-to-generated-openapi.yaml} \
  --inventory \
  --runtime-drift "$OUT/$SERVICE.runtime-drift.json" \
  --base-provenance "contracts/baselines/$SERVICE/v1.provenance.json" \
  --head-provenance "$OUT/$SERVICE.provenance.json" \
  --composition-report "$OUT/$SERVICE.composition.json" \
  --metadata-registry "$OUT/$SERVICE.metadata.json" \
  --base-metadata-registry "contracts/baselines/$SERVICE/v1.metadata.json" \
  --head-metadata-registry "$OUT/$SERVICE.metadata.json" \
  --duplicate-review "$OUT/$SERVICE.duplicate-review.json" \
  --format markdown \
  > "$OUT/$SERVICE.review.md"
```

If a sidecar does not apply to the service, omit that flag.

External-artifact mode minimum:

```bash
bash scripts/openapi-governance.sh review-bundle
```

The scaffold's `review-bundle` target invokes `oa-gen review-bundle --base BASELINE --head NORMALIZED --artifact BASELINE --inventory --format markdown`. Composition / metadata-registry / duplicate-review sidecars do not apply because external-artifact mode does not produce them.

## CI Gate

Use this as the service PR gate.

```bash
pnpm --filter @oa-sdk/codegen build
pnpm --filter @oa-sdk/codegen typecheck
pnpm --filter @oa-sdk/codegen test
pnpm check:cli-spec
pnpm check:feature-tests
pnpm check:api-index

oa-gen diff \
  --base contracts/baselines/{service-name}/v1.openapi.yaml \
  --head {path-to-managed-openapi.yaml} \
  --fail-on-breaking

oa-gen check-artifact \
  --head {path-to-managed-openapi.yaml} \
  --artifact {path-to-generated-openapi.yaml}

oa-gen target-check \
  --artifact {path-to-generated-openapi.yaml} \
  --must-include-path /health \
  --must-exclude-path /admin
```

## Adoption Checklist

### External-artifact services (NestJS Swagger, FastAPI, etc.)

- [ ] Ran `oa-gen scaffold-governance --root <service> --service <name> --profile <profile> --source-command "<cmd>" --runtime-openapi-url "<url>"`.
- [ ] `openapi-governance.config.json` artifact paths and `consumers` mapping reflect the service layout (re-run scaffold with `--force` after editing the source-of-truth fields).
- [ ] `contracts/v1.openapi.yaml` baseline is committed (initial baseline via `bash scripts/openapi-governance.sh update-baseline`).
- [ ] Raw / normalized / upgraded / collect-report / generated-types paths are gitignored.
- [ ] CI runs `bash scripts/openapi-governance.sh ci` (collect → baseline review bundle → validate-upgraded → typegen) and uploads `.oa-sdk/governance`; use `all` locally.
- [ ] `automation.typegen.policy` is `verify-only` for ignored generated files, or `commit-required` with a tracked, freshness-checked file.
- [ ] Authenticated runtime drift uses `bash scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"`.

### Definition Builder services

- [ ] Service has a managed OpenAPI source path.
- [ ] Service has a generated artifact path or target artifact output path.
- [ ] Service has a baseline OpenAPI path.
- [ ] Service has a runtime OpenAPI URL or exported runtime OpenAPI file.
- [ ] Public/admin/internal path ownership is documented.
- [ ] `mustIncludePaths` and `mustExcludePaths` are listed.
- [ ] Path folder conventions are followed.
- [ ] Duplicate review is configured for fragment-based services.
- [ ] Review bundle output path is stable.
- [ ] CI runs diff, artifact freshness, target-check, and relevant package gates.
