# Release Decision Record Template

Status: template. Copy this record into the release PR or the external artifact
review before an official export.

```md
# OA SDK release decision

## Candidate

- Source commit: `<full SHA>`
- Release ID: `<immutable release-id>`
- Artifact target: `mineclover/oa-sdk-releases/releases/<release-id>/`

## Public package intent

| Package | Committed version | Changeset / release note | Include? |
| --- | --- | --- | --- |
| `@oa-sdk/core` | `<version>` | `<path or link>` | yes/no |
| `@oa-sdk/openapi-projection-contract` | `<version>` | `<path or link>` | yes/no |
| `@oa-sdk/typespec-decorators` | `<version>` | `<path or link>` | yes/no |
| `@oa-sdk/parser` | `<version>` | `<path or link>` | yes/no |
| `@oa-sdk/codegen` | `<version>` | `<path or link>` | yes/no |

## Contract evidence

- API contract version: `<ContractVersion>`
- Approved snapshot diff reviewed: yes/no
- Breaking-change decision and migration note: `<link or none>`
- `schema:check-contract-version -- --base-ref <base>`: pass/fail

## Source evidence

- Clean `pnpm release:preflight`: pass/fail
- Required CI run: `<URL>`
- Tarball/import/consumer smoke: pass/fail
- External artifact manifest SHA-512 reviewed: yes/no

## Runtime launch scope (only if this release launches an API runtime)

- OAuth issuer/audience/claim policy: `<owner decision>`
- scope/role and 403 policy: `<owner decision>`
- export lifecycle/idempotency/pseudonymization policy: `<owner decision>`
- World completion and projection-status policy: `<owner decision>`

## Approval

- Source release owner: `<name>`
- External artifact reviewer: `<name>`
- Runtime owner (if applicable): `<name>`
```

This record is evidence for an official release, not a substitute for the
protected external promotion workflow.
