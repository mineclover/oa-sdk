# TypeSpec Authoring Conventions

Status: active convention for the OA SDK production schema bundle.

This guide defines the normal authoring path. It keeps TypeSpec as the only
human-authored contract source and treats OpenAPI YAML as generated review
evidence.

## Ownership

| Contract fact | Authoring location | Rule |
|---|---|---|
| Service metadata | `packages/schemas/typespec/metadata/service.tsp` | Change only for root-level concerns; `main.tsp` remains the composition root. |
| Reusable component registry | `packages/schemas/typespec/metadata/common-components.tsp` | Keep component identity separate from domain models and operations. |
| API contract version | `packages/schemas/typespec/version.tsp` (`ContractVersion`) | The only source for `info.version`; do not derive it from package or build versions. |
| Domain models, response wrappers, operations | matching domain `.tsp` module | Prefer TypeSpec-native syntax. |
| Enum and value vocabularies | smallest owning domain `.tsp` module, or `common.tsp` when contract review explicitly assigns a cross-domain vocabulary | Use TypeSpec-native literal unions or aliases. Keep resource-specific filters declared on their operations; `metadata/common-components.tsp` is not a global enum registry. |
| OpenAPI facts the emitter cannot preserve | OA SDK TypeSpec extension | Use a versioned, documented extension; do not encode semantics in comments. |
| Generated OpenAPI | `src/.merged*.yaml`, `dist/openapi.*` | Never edit directly. |
| Approved review baseline | `packages/schemas/typespec/approved.openapi.yaml` | Never edit directly; update only with the approval command. |

Use [the ownership guide](../internal/typespec-roundtrip/authoring-ownership-guide.md)
before adding an extension. `oa-sdk.typespec-extensions.v5` is the only
currently accepted sidecar-less vocabulary. A future restore-bearing extension
change requires a new version, an explicit migration, and focused bundle-check coverage.

## Versioning

Keep these version channels independent.

| Channel | Authority | Bump rule |
|---|---|---|
| API contract | `ContractVersion` in `version.tsp`, emitted as OpenAPI `info.version` | Semantic versioning: major for incompatible consumer changes, minor for backward-compatible additions, patch for backward-compatible corrections. Before 1.0, an incompatible change advances `0.MINOR`. |
| Workspace package | package `version` plus Changesets/release policy | Package distribution lifecycle; it must not be changed merely because the API snapshot changed. |
| TypeSpec bundle/extension/candidate/drift and cross-repo evidence schemas | their explicit `schemaVersion` fields plus [artifact compatibility policy](../cli-spec/oa-sdk-artifact-compatibility-policy.v1.json) | Bump only when that artifact's machine-readable format becomes incompatible; it is not the API version. Keep only the current major schema supported unless the policy explicitly lists a reader migration. |
| Approved snapshot | Git commit plus content hash | No semantic version of its own. Regenerate through the approval command only after a reviewed contract change. |
| Runtime build information | deployment environment, returned by `GET /version` | Deployment identity; its example value must not drive `ContractVersion`. |

When a contract version changes, include the owning `.tsp` change, reviewed approved
snapshot, and an API-diff summary in the same pull request. A changed snapshot with no
consumer-visible contract change does not require a version bump.

Pull-request CI also compares the base and head approved snapshots. A breaking API diff
fails CI unless `ContractVersion` has the required semantic-version bump: major after
1.0, or minor while the contract is below 1.0. The gate is
`pnpm schema:check-contract-version -- --base-ref <git-ref>`.

## Contract Change Workflow

1. Update the smallest owning `.tsp` module. Keep models and HTTP semantics in native TypeSpec whenever the emitter preserves them.
   - 신규 엔드포인트 및 DTO 스캐폴딩 시 `oa-gen tsp-scaffold --route <path> --method <method> --file <path>`를 활용합니다.
2. 컴파일 전 AST 차원에서 파괴적 변경을 조기 점검하기 위해 `oa-gen tsp diff --base origin/main --head HEAD --fail-on-breaking`을 실행합니다.
3. 실시간 Mock 서버를 띄워 변경된 API를 즉시 테스트하려면 `oa-gen mock --tsp packages/schemas/typespec/main.tsp --watch`를 사용합니다.
4. Run `pnpm schema:approve-typespec-reference` to compile and restore a candidate under the gitignored `.oa-sdk/typespec-candidates/` directory and show the normalized OpenAPI diff.
5. Review the `.tsp` change and the candidate diff together. Treat a changed operation, reusable component, example, or security rule as a contract change.
6. When approved, run `pnpm schema:approve-typespec-reference -- --write`. This is the only command that updates `approved.openapi.yaml`.
7. Run `pnpm schema:validate`. For changes that affect a downstream consumer, also run `pnpm schema:downstream-check`.

Changing a wire value set is a contract change. A named alias can reduce duplicate TypeSpec
declarations without necessarily producing a named OpenAPI schema component. Conversely, a
deliberate public component or `$ref` identity requires a named native `enum` or `union`, changes
the emitted contract topology, and must be reviewed in the candidate diff. Do not classify either
change merely as formatting.

The approved snapshot is intentionally committed: it provides a reviewable
baseline. The candidate is local, frequently regenerated, and carries the
manifest path plus source, baseline, and candidate hashes. Promotion always
uses the snapshot declared by that manifest and verifies that the baseline has
not changed. It is not a second source of truth and must not be regenerated by
a normal build, otherwise the diff gate would compare the candidate to itself.

When promotion also clears accepted drift, the command records an ignored local
promotion journal before either committed file changes. The next approval or
TypeSpec validation command completes that exact pair only when both files still
match the recorded before/after hashes; an unrelated manual edit fails recovery
instead of being overwritten.

## Extension Convention

Use the following order of preference.

1. TypeSpec-native decorator or model syntax.
2. Existing OA SDK extension documented by the ownership guide.
3. Compatibility sidecar only when the bundle is generated or the extension cannot own the fact.
4. Propose a versioned extension design before adding a new restore-bearing field.

Do not add an OA SDK extension solely to represent an enum or a value vocabulary that native
TypeSpec can express. If per-value metadata or another OpenAPI-native fact cannot roundtrip,
make an explicit ownership decision and, when needed, propose a versioned extension rather than
placing unvalidated semantics in comments or a generic extension payload.

Do not put a generic `@extension` payload directly into a new operation when a
shared authoring helper exists. `@oa-sdk/typespec-decorators` currently owns:
- `@oaUseResponseComponent`: validates status/component shape for v5 response components (`x-oa-sdk-operation-component-refs`).
- `@personaCapability`: validates and emits persona capability traits (`x-oa-sdk-persona-traits`) verified against `packages/personas/src/traits/skill.yaml`.
- `@pseudonymize`: validates and emits DPM pseudonymization projection rules (`x-oa-sdk-dpm-projection`).

Until a helper covers an extension family, keep the payload adjacent to its
operation and add a focused example or test that proves the restored OpenAPI
result.

## Required Review Evidence

- The approved snapshot diff is intentional.
- `pnpm schema:typespec-check` passes after the snapshot update.
- `pnpm schema:typespec-provenance-check` passes: every production operation,
  reusable component, and `$ref` source has a TypeSpec AST declaration or
  versioned extension restore owner. The local artifact is evidence, not a
  second authoring source.
- `accepted-restored-drift.json` is empty, or every entry is reviewed and
  hash-pinned for the exact restored/reference values.
- A promotion that supersedes accepted restored drift uses
  `--clear-accepted-restored-drift` so the approved snapshot and drift state
  are reviewed together.
- Reusable response and parameter references remain valid after restoration.
- `pnpm schema:validate` passes; downstream changes also pass the downstream
  gate.

The rollback path is not a second authoring path. Use `:openapi` commands only
to prove reversibility or recover a failed TypeSpec migration; rerun
`pnpm schema:validate` before committing generated production artifacts.

## References

- [TypeSpec 5분 퀵스타트 가이드](./typespec/01-quickstart-5min.md)
- [TypeSpec 작성 규칙 및 컨벤션 표준](./typespec/02-authoring-conventions.md)
- [TypeSpec 커스텀 데코레이터 레퍼런스](./typespec/03-decorators-reference.md)
- [TypeSpec 스캐폴딩 및 Semantic Diff 도구 활용법](./typespec/04-scaffolding-and-diff.md)
- [TypeSpec 트러블슈팅 및 자주 묻는 질문(FAQ)](./typespec/05-troubleshooting.md)
- [TypeSpec IDE 환경 설정 및 생산성 가이드](./typespec-ide-setup.md)
- [Canonical schema pipeline and governance spec](../internal/spec.md)
- [TypeSpec-first authoring ADR](../internal/architecture/009-typespec-first-authoring.md)
- [Production operations and promotion runbook](../internal/typespec-roundtrip/production-operations.md)
