# @oa-sdk/ftp-contract

## 0.3.0

### Minor Changes

- Supply `TestDefinition` revision `2` (`oa-sdk.ftp/test-definition@2`) supporting `DefinitionRef` (`ExactRef` or `AliasRef`), multi-criterion `criteria` (`minItems: 1`) with explicit `criterionCombination`, and optional non-null `description`, while preserving immutable revision `1` bytes.
- Align `LockedPlanV1` TypeScript wire types with `oa-sdk.ftp/locked-plan@1` (`DefinitionRefV1` on `Definition.dependencies` and `bindings[].requested`), expand all lifecycle semantic mappings (`TEST_DEFINITION_V1_FTP_MAPPING`, `TEST_DEFINITION_V2_FTP_MAPPING`, `LOCKED_PLAN_V1_FTP_MAPPING`, `EVALUATION_V1_FTP_MAPPING`) to 1:1 JSON Pointers with detached field-by-field projections, add RFC 6902 `cases.json` conformance suites for every lifecycle declaration, exclude `*.test.ts` from published `dist/`, and retire superseded `proposals/` review drafts.

## 0.2.1

### Patch Changes

- Promote the Functional Test Platform exchange contract to the reviewed public distribution candidate set.
