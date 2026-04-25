# OpenAPI Governance Service Template

새 서비스에 oa-sdk governance를 붙일 때 이 문서를 복사해서 서비스별 설정 문서로 사용한다.
권장 위치는 서비스 repo의 `docs/openapi-governance.md` 또는 monorepo의
`services/{service}/openapi-governance.md`다.

## Service Profile

| Field | Value |
|---|---|
| Service name | `{service-name}` |
| Owner | `{team-or-owner}` |
| Runtime base URL | `http://localhost:{port}` |
| Runtime OpenAPI URL | `http://localhost:{port}/openapi.json` |
| Managed OpenAPI | `{path-to-managed-openapi.yaml}` |
| Generated artifact | `{path-to-generated-openapi.yaml}` |
| Baseline OpenAPI | `contracts/baselines/{service}/v1.openapi.yaml` |
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

## Path Ownership

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

## Duplicate Review

```bash
oa-gen duplicate-review \
  --fragments {path-to-fragments} \
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

- [ ] Service has a managed OpenAPI source path.
- [ ] Service has a generated artifact path or target artifact output path.
- [ ] Service has a baseline OpenAPI path.
- [ ] Service has a runtime OpenAPI URL or exported runtime OpenAPI file.
- [ ] Public/admin/internal path ownership is documented.
- [ ] `mustIncludePaths` and `mustExcludePaths` are listed.
- [ ] Definition Builder services follow path folder conventions.
- [ ] Duplicate review is configured for fragment-based services.
- [ ] Review bundle output path is stable.
- [ ] CI runs diff, artifact freshness, target-check, and relevant package gates.
