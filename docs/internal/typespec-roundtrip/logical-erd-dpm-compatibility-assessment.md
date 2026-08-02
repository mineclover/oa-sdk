# TypeSpec logical ERD ↔ DPM compatibility assessment

**Status: evidence-only compatibility assessment — no DPM adapter or DPM persistence is activated**

This record compares the portable `oa-sdk.logical-erd.v1` artifact with the canonical
DPM owner contract in `mineclover/data-governance`. TypeSpec ERD is the logical-model
authority; DPM (Data Pseudonymization Manifest) is an opt-in policy consumer for a
selected subset. This record defines the minimum information that such a bridge would
need. It does **not** make an ERD artifact a DPM revision, write a DPM registry, or
create a physical database binding.

## Evidence examined

| Canonical owner surface | What it establishes | ERD consequence |
| --- | --- | --- |
| `packages/dpm/src/model/data-identity-types.ts` | A DPM v1.1 field has distinct object ID, revision ID, scoped entity locator, origin/lifecycle, and optional catalog-bound storage reference. | A TypeSpec field ID cannot be silently treated as a DPM object or revision ID. |
| `packages/dpm/src/catalog/snapshot-record-types.ts` | A physical object belongs to `dpm.catalog.snapshot.v1`, including a freshness hash. | Table/column text alone is evidence-poor; a bridge requires an accepted snapshot reference. |
| `packages/dpm/src/model/relationship-types.ts` | A DPM relationship has physical endpoints plus transform, orphan, condition, and canonical-key policy. | An ERD relationship supplies only logical endpoints/cardinality and must not instantiate a DPM relationship. |
| Goal 68 logical-data boundary | DPM links independently identified logical/API/catalog objects and expressly excludes DDL, migration, and implicit API↔DB matching. | The bridge must be explicit, read-only, and reviewable. |

## Direct mapping verdict

| ERD value | DPM target | Verdict | Reason |
| --- | --- | --- | --- |
| `dataset.id` | `DpmEntityRef.datasetId` | candidate | Same scope role, but a bridge must state this mapping explicitly. |
| `entity.id` | DPM entity identity | not direct | DPM needs independent `datasetId`, `namespace`, and `name`; an ERD stable ID is not that tuple. |
| `entity.locator` | entity `namespace` / `name` | navigation only | A locator is renameable, so it cannot derive a stable DPM object identity. |
| `field.id` | `objectId` / `revisionId` | not direct | DPM keeps object and immutable revision identities separate. |
| `field.name`, `type`, `required` | DPM field name/type/nullable | candidate | Requires an owner-approved type mapping and `required → nullable` rule. |
| `primaryKey`, `unique`, `foreignKey` | DPM key / storage / relationship policy | insufficient | ERD describes a logical constraint; DPM relationship and catalog contracts need separate policy and physical evidence. |
| `relationship` | DPM relationship policy | not a default mapping | An ERD relationship remains authoritative on its own. DPM requires physical `ModelEndpoint` and operational policy only for a separately approved pseudonymization use case. |
| source spans and artifact hash | DPM source coordinate / freshness evidence | attachable evidence | Valuable provenance, but it must not replace DPM identity or catalog freshness. |

## Required owner-provided bridge input

An eventual bridge must receive a versioned, owner-owned mapping for every projected
field. The mapping must be explicit rather than inferred from names or locators:

```text
ERD field stable ID
  -> DPM object ID + immutable revision ID
  -> DPM entity { datasetId, namespace, name }
  -> semantic type + origin + lifecycle
  -> optional catalog { snapshotId, versionHash, table, column }
  -> optional API binding identity
```

For a `persisted` DPM field, catalog identity/freshness and table/column are required.
For `derived`, `computed`, or `api_only`, the bridge must demonstrate that no storage
reference is claimed. Relationship projection needs a separately approved policy input
for DPM transform strategy, orphan policy, physical endpoints, and canonical-key
components; it is not implied by `@relationship`.

## Safe implementation sequence

1. Keep `oa-sdk.logical-erd.v1` independently schema- and semantically-valid.
2. Have the DPM owner define and version the bridge mapping input and its compatibility
   fixture in `data-governance`.
3. Validate a supplied catalog snapshot read-only; report confirmed, mismatch, unbound,
   or unknown evidence without mutating TypeSpec or the database.
4. Run an owner-owned fixture that proves stable ID rename handling, catalog freshness
   failure, non-persisted origin handling, and relationship-policy non-inference.
5. Only after owner acceptance, publish a DPM-side adapter or consumer surface. The
   historical OA SDK repository must remain a fixture/evidence consumer, not a second
   DPM registry.

## Current decision

The TypeSpec prototype may emit, schema-check, semantically validate, and diff logical
ERD artifacts. It must not emit `data_definitions`, `dpm.data-binding-artifact.v1`, DPM
relationships, catalog snapshots, DDL, migrations, or physical FKs. A DPM field bridge
is only relevant where pseudonymization policy is needed; ERD relationship projection is
not a standing work item and must never be inferred from naming conventions.
