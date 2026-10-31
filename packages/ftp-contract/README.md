# OA SDK FTP contract

`@oa-sdk/ftp-contract` holds the canonical exchange declarations that the
[Functional Test Platform](https://github.com/mineclover/functional-test-platform)
(FTP) consumes. FTP owns the semantic contract, verdict rules and TCK; `oa-sdk`
owns the closed wire shapes, value types, allowed values and missing-vs-null rules
of the exchanged artifacts. FTP must not create a parallel wire schema or provider
identifiers for these artifacts.

The package contains no FTP runtime, evaluator, target or runner.

## Supplied declarations

All declarations live under namespace `oa-sdk.ftp`, use JSON Schema Draft 2020-12,
enforce closed objects (`additionalProperties: false`), pin their exact bytes via
exported SHA-256 constants, and ship with RFC 6902 `cases.json` conformance tables,
1:1 JSON Pointer semantic mappings, and detached non-inventing projection helpers:

| Artifact | Revision | Schema path | `$id` | Declaration `ExactRef` id | Mapping `ExactRef` id | FTP target profiles |
| --- | --- | --- | --- | --- | --- | --- |
| `RunEvidence` | `1` | `schema/oa-sdk.ftp.run-evidence.v1.schema.json` | `urn:oa-sdk:ftp:run-evidence:1` | `run-evidence` | `run-evidence.ftp-core` | `core@0.1`, `request-lifecycle@0.1` |
| `TestDefinition` | `1` | `schema/oa-sdk.ftp.test-definition.v1.schema.json` | `urn:oa-sdk:ftp:test-definition:1` | `test-definition` | `test-definition.ftp-core` | `core@0.1` |
| `TestDefinition` | `2` | `schema/oa-sdk.ftp.test-definition.v2.schema.json` | `urn:oa-sdk:ftp:test-definition:2` | `test-definition` | `test-definition.ftp-core` | `core@0.1` |
| `LockedPlan` | `1` | `schema/oa-sdk.ftp.locked-plan.v1.schema.json` | `urn:oa-sdk:ftp:locked-plan:1` | `locked-plan` | `locked-plan.ftp-core` | `core@0.1`, `execution@0.1` |
| `Evaluation` | `1` | `schema/oa-sdk.ftp.evaluation.v1.schema.json` | `urn:oa-sdk:ftp:evaluation:1` | `evaluation` | `evaluation.ftp-core` | `request-lifecycle@0.1` |

## Lifecycle artifact declarations

Provider decisions locked for the portable lifecycle exchange artifacts:

- **`TestDefinition` (`v1` and `v2`)**:
  - Revision `1` (`oa-sdk.ftp/test-definition@1`) remains permanently pinned for single-criterion `ExactRef`-only authoring inputs (`criterion` + explicit `criterionCombination: "all" | "any"`).
  - Revision `2` (`oa-sdk.ftp/test-definition@2`) is the full authoring declaration aligned with FTP portable contract v0.1 (`REF-01`, `REF-02`, `REF-03`): `target`, `claim`, `method`, `dataset` and `criteria[]` (`minItems: 1`) accept `DefinitionRef` (`ExactRef` or `AliasRef`), `criterionCombination` (`"all" | "any"`) is required even for single-element `criteria`, and `description` is an optional non-empty string (`null` rejected).
- **`LockedPlan` (`v1`, `oa-sdk.ftp/locked-plan@1`)**:
  - `definitions[].ref`, `bindings[].resolved`, `resolver` and `applications[].criterion` must be locked `ExactRef`s, whereas `bindings[].requested` and `definitions[].dependencies[]` admit `DefinitionRef` (`ExactRef` or `AliasRef`) to preserve pre-resolution binding lineage.
  - `definitions[].body` and `selection` admit arbitrary `JsonValue` (including `null` per `WIRE-03`); every envelope field rejects `null`.
- **`Evaluation` (`v1`, `oa-sdk.ftp/evaluation@1`)**:
  - Represents `request-lifecycle@0.1` evaluation output (`verdict` and sub-verdicts in `PASS | FAIL | INCONCLUSIVE | NOT_APPLICABLE | ERROR`, nonnegative integer `coverage.minimum` and `coverage.applicable`, and optional `issues[].requestIds` / `issues[].occurrences` that reject `null` when present).

## RunEvidence revision 1

| Input | Value |
| --- | --- |
| Declaration | `schema/oa-sdk.ftp.run-evidence.v1.schema.json` (JSON Schema 2020-12, `$id` `urn:oa-sdk:ftp:run-evidence:1`) |
| Declaration `ExactRef` | `{ "kind": "schema-declaration", "namespace": "oa-sdk.ftp", "id": "run-evidence", "revision": "1" }` |
| Declaration bytes | SHA-256 exported as `RUN_EVIDENCE_V1_SCHEMA_SHA256`; a test pins it against the file bytes |
| Validator | `runEvidenceV1Validator.validate(unknown)` returns `{ success: true, data }` or `{ success: false, error }`, synchronously, without throwing on any input |
| Structured issues | `collectRunEvidenceIssues(unknown)` returns `{ instancePath, keyword, message }[]` |
| Mapping `ExactRef` | `{ "kind": "semantic-mapping", "namespace": "oa-sdk.ftp", "id": "run-evidence.ftp-core", "revision": "1" }` |
| Mapping | `RUN_EVIDENCE_V1_FTP_MAPPING.entries` (field to FTP role and clauses) and `projectRunEvidenceV1` |
| FTP target | `docs/portable-contract-v0.1.md` revision `0.1`, profiles `core@0.1` and `request-lifecycle@0.1` |
| Fixtures | `fixtures/run-evidence.v1/valid-lifecycle.json` and `fixtures/run-evidence.v1/cases.json` (RFC 6902 patches with expected accept/reject) |

What `RunEvidence` revision `1` fixes:

- Every object is closed (`additionalProperties: false`), so a misspelled core field is rejected instead of being absorbed as an extension.
- Missing and null are distinct. No field admits `null` except `observations[].payload`, whose content belongs to the observation point revision. This is the FTP T-J02 case.
- Identifiers are non-empty strings. `order.sequence` is a canonical nonnegative decimal string (`0` or no leading zero).
- An observation with `unit: "attempt"` requires `domainAttemptId`.
- `receivedAt` is `YYYY-MM-DDTHH:mm:ss[.fraction]Z` with year 0001-9999, a 1-9 digit fraction and no leap second. The validator also checks day-of-month validity, because JSON Schema `format` is only an annotation.

## Consumer port binding

Validators receive already-decoded data. Duplicate keys, raw number tokens and
invalid Unicode belong to the consumer's JSON decoder stage. Reference resolution,
occurrence conflicts, coverage sufficiency and verdicts belong to FTP's semantic
layers. A rejection here is an artifact-input rejection, not a product `FAIL`.

```ts
import {
  LOCKED_PLAN_V1_DECLARATION,
  LOCKED_PLAN_V1_FTP_MAPPING_REF,
  lockedPlanV1Validator,
  projectLockedPlanV1,
  projectRunEvidenceV1,
  projectTestDefinitionV2,
  RUN_EVIDENCE_V1_DECLARATION,
  RUN_EVIDENCE_V1_FTP_MAPPING_REF,
  runEvidenceV1Validator,
  TEST_DEFINITION_V2_DECLARATION,
  TEST_DEFINITION_V2_FTP_MAPPING_REF,
  testDefinitionV2Validator,
} from '@oa-sdk/ftp-contract'

const runEvidencePort = createOaSchemaPort({
  declaration: RUN_EVIDENCE_V1_DECLARATION,
  profile: { id: 'core', revision: '0.1' },
  mapping: RUN_EVIDENCE_V1_FTP_MAPPING_REF,
  validator: runEvidenceV1Validator,
  project: projectRunEvidenceV1,
})

const testDefinitionPort = createOaSchemaPort({
  declaration: TEST_DEFINITION_V2_DECLARATION,
  profile: { id: 'core', revision: '0.1' },
  mapping: TEST_DEFINITION_V2_FTP_MAPPING_REF,
  validator: testDefinitionV2Validator,
  project: projectTestDefinitionV2,
})

const lockedPlanPort = createOaSchemaPort({
  declaration: LOCKED_PLAN_V1_DECLARATION,
  profile: { id: 'core', revision: '0.1' },
  mapping: LOCKED_PLAN_V1_FTP_MAPPING_REF,
  validator: lockedPlanV1Validator,
  project: projectLockedPlanV1,
})
```

## Revision rules

A published revision is immutable. Any change to the declaration bytes, to the
meaning of a field, or to the mapping table creates a new revision with its own
`ExactRef`, file and hash. Older revisions stay in the package so past artifacts and
evidence can be re-validated.
