# OA SDK FTP contract

`@oa-sdk/ftp-contract` holds the canonical exchange declarations that the
[Functional Test Platform](https://github.com/mineclover/functional-test-platform)
(FTP) consumes. FTP owns the semantic contract, verdict rules and TCK; oa-sdk owns
the field, type, allowed-value and null declarations of the exchanged artifacts.
FTP must not create a parallel wire schema or provider identifiers for these
artifacts.

The package contains no FTP runtime, evaluator, target or runner.

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

What the declaration fixes:

- Every object is closed (`additionalProperties: false`), so a misspelled core field is rejected instead of being absorbed as an extension.
- Missing and null are distinct. No field admits `null` except `observations[].payload`, whose content belongs to the observation point revision. This is the FTP T-J02 case.
- Identifiers are non-empty strings. `order.sequence` is a canonical nonnegative decimal string (`0` or no leading zero).
- An observation with `unit: "attempt"` requires `domainAttemptId`.
- `receivedAt` is `YYYY-MM-DDTHH:mm:ss[.fraction]Z` with year 0001-9999, a 1-9 digit fraction and no leap second. The validator also checks day-of-month validity, because JSON Schema `format` is only an annotation.

The validator receives already-decoded data. Duplicate keys, raw number tokens and
invalid Unicode belong to the consumer's JSON decoder stage. Reference resolution,
occurrence conflicts, coverage sufficiency and verdicts belong to FTP's semantic
layers. A rejection here is an artifact-input rejection, not a product `FAIL`.

```ts
import {
  projectRunEvidenceV1,
  RUN_EVIDENCE_V1_DECLARATION,
  RUN_EVIDENCE_V1_FTP_MAPPING_REF,
  runEvidenceV1Validator,
} from '@oa-sdk/ftp-contract'

const port = createOaSchemaPort({
  declaration: RUN_EVIDENCE_V1_DECLARATION,
  profile: { id: 'core', revision: '0.1' },
  mapping: RUN_EVIDENCE_V1_FTP_MAPPING_REF,
  validator: runEvidenceV1Validator,
  project: projectRunEvidenceV1,
})
```

## Revision rules

A published revision is immutable. Any change to the declaration bytes, to the
meaning of a field, or to the mapping table creates a new revision with its own
`ExactRef`, file and hash. Older revisions stay in the package so past evidence can
be re-validated.
