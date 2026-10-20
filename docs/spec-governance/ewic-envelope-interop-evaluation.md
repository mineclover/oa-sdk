# EWIC v0.1 Entity/Workflow/Execution/Evidence Envelope Interoperability Evaluation Report

**Issue Reference:** [mineclover/oa-sdk#3](https://github.com/mineclover/oa-sdk/issues/3)  
**Parent Collaboration Issue:** [mineclover/oa-sdk#2](https://github.com/mineclover/oa-sdk/issues/2)  
**External SSOT Grounding:** Google Drive `collab-context-harness` (`1h_CjCUEaOUaKzImXqbmbRS0AGkPdmkiB`)  
- [workflow-entity-spec.v0.1.json](https://drive.google.com/file/d/1ygCYypDGkcGnB8dMBiiCmuHdQqYX7ceM/view) (File ID: `1ygCYypDGkcGnB8dMBiiCmuHdQqYX7ceM`)  
- [EWIC-v0.1.md](https://drive.google.com/file/d/12azN_IsoWeV1FfmuoWYgXKJaHYB9lrlx/view) (File ID: `12azN_IsoWeV1FfmuoWYgXKJaHYB9lrlx`)  
**Evaluation Date:** 2026-10-13  
**Status:** **VERIFIED & ACCEPTED (READ-ONLY INTEROP)**  
**Integration Test Suite:** `test/integration/ewic-envelope/ewic-envelope.test.ts` (38/38 Tests Passing, 100% Exit Code 0)

---

## 1. Executive Summary

This report evaluates and validates the interoperability contract between the Shared Context Harness (`CollaborationManifest`, `SourceReference`) and the **Entity/Workflow Interchange Convention (EWIC) v0.1** envelopes (`entity-source/v1`, `entity-derived/v1`, `colab-run-packet/v1`) in accordance with **Issue #3**.

The evaluation proves that:
1. **Full Envelope Fidelity**: TypeSpec and JSON Schema Draft 2020-12 accurately model the 6 canonical entity kinds (`spec`, `framework`, `resource`, `workflow`, `execution`, `evidence`) and the derived / execution packet schemas.
2. **Lossless Adapter & Drive Preservation**: Adapters (`SourceReferenceAdapter`, `CollaborationManifestAdapter`, `KindAdapters`) strictly preserve Drive `fileId`, `revision`, `contentHash`, `parentChain`, and `locator`. All unknown/custom fields round-trip without loss (forward-compatibility guarantee). For envelopes produced by the adapter, `source.provider` also round-trips (see §3.4 for the one lossy case: envelopes without the `_originalSourceReference` side-channel).
3. **Execution Snapshot Reproducibility**: `execution` envelopes pin `workflowRef` and `resolvedRefs` snapshots (`snapshotId` and `contentHash`). When reference drift occurs, execution is rejected with a typed stale error identifying the drifted refs.
4. **RFC 8785 Canonical Digest Readback**: Implements deterministic JSON canonicalization (JCS) and SHA-256 digest computation (`sha256:<hex>`). All envelopes pass 100% digest readback verification; tampered payloads are immediately detected.
5. **Universal Tool Surface (@oa-sdk/tools)**: 3 read-only tools (`ewic_validate_envelope`, `ewic_adapt_source_reference`, `ewic_verify_execution`) deploy seamlessly to MCP Server, Commander CLI, and Hono REST HTTP app.
6. **No-Leak Negative Security**: Denied ACL and missing envelope scenarios return indistinguishable `{ status: 'unavailable' }` responses to prevent presence enumeration attacks. Underlying provider exceptions and internal file paths are masked.
7. **Strict Non-Expansion & Boundary Invariants**:
   - **Zero ID Minting Authority**: The SDK does not issue official `ent_<UUIDv7>` identities (IDs must be provided by external authorities or generators).
   - **Immutability by Default**: `sourceIsImmutableByDefault: true` is strictly respected; zero mutation tools are exposed.
   - **Zero Semantic Authority**: The SDK acts solely as an envelope validator, adapter, and projection compiler; it owns no project topology, NES canonical relations, or domain definitions.

---

## 2. Contract Scope Verification Matrix

| # | Requirement Area | Scope & Invariant | Realized Implementation | Verification Result |
|---|---|---|---|:---:|
| **R1** | **TypeSpec Schema AST Ingestion** | In-memory compilation of EWIC envelope and kind contracts without disk I/O; 4 OpenAPI 3.1.0 routes. | `schema/typespec/*.tsp` | **PASSED (100%)** |
| **R2** | **JSON Schema Draft 2020-12 Fidelity** | Structural and identity invariant validation across all 6 entity kinds, derived envelope, and Colab run packets. | `schema/json-schema/*.schema.json`<br>`validator/ewic-validator.ts` | **PASSED (100%)** |
| **R3** | **RFC 8785 Canonical Digest Readback** | Deterministic JCS stringification, `sha256:<hex>` computation, and 100% digest verification on readback. | `canonical/canonical-json.ts` | **PASSED (100%)** |
| **R4** | **Lossless Adapters & Drive SSOT Preservation** | Full round-trip preservation of Drive `fileId`, `parentChain`, `locator`, `revision`, `contentHash`, and unknown fields. `source.provider` round-trips through `_originalSourceReference.sourceProvider` for adapter-produced envelopes; an envelope without that side-channel is restored from the SSOT alone, where `local` (the SSOT value for `semantic` and `web`) comes back as `drive`. | `adapters/source-reference-adapter.ts`<br>`adapters/collaboration-manifest-adapter.ts` | **PASSED (100%)** |
| **R5** | **Execution Snapshot Reproducibility** | Verification of pinned `workflowRef` and `resolvedRefs`; typed rejection (`{ status: 'stale' }`) on snapshot drift. | `validator/ewic-validator.ts`<br>`tools/ewic-verify-execution.ts` | **PASSED (100%)** |
| **R6** | **Universal Tool Surface Bridge** | 3 read-only tools generated via `@oa-sdk/tools` deployed across MCP Server, Commander CLI, and Hono REST. | `tools/*.ts` | **PASSED (100%)** |
| **R7** | **Fail-Closed & No-Leak Security** | Indistinguishable ACL denial vs. non-existent resource responses; provider exception masking. | `tools/ewic-verify-execution.ts` | **PASSED (100%)** |
| **R8** | **SDK Scope Non-Expansion** | Zero mutation tools, source immutability by default, no authoritative ID issuance or semantic catalog ownership. | Entire integration suite | **PASSED (100%)** |

---

## 3. Detailed Verification Findings

### 3.1 TypeSpec AST Ingestion (Tier 1)
- Compiled `schema/typespec/main.tsp` in-memory using `compileTypeSpecInMemory`.
- Extracted 4 HTTP operations:
  - `GET /envelopes/source/{id}`
  - `GET /envelopes/derived/{id}`
  - `POST /envelopes/verify-execution`
  - `GET /colab/runs/{runId}`
- Verified 0 diagnostics with error severity and clean OpenAPI 3.1.0 document output.

### 3.2 Schema Validation & Invariants (Tier 2)
- Validated sample envelopes across all 6 canonical kinds (`spec`, `framework`, `resource`, `workflow`, `execution`, `evidence`).
- Enforced `revisionId` invariant: must strictly equal `${id}@${revision}`.
- Enforced kind invariant: rejected unrecognized kinds outside the 6 allowed types.
- Enforced SSOT path invariant: rejected empty or whitespace-only provenance paths.

### 3.3 RFC 8785 Canonical Digest Readback (Tier 3)
- Canonical JSON output verified:
  - Keys sorted by UTF-16 code units at all nesting levels.
  - Numbers and floats serialized without insignificant trailing zeroes or spaces.
  - `undefined`, functions, and symbols omitted.
- All 6 generated sample envelopes passed 100% digest readback verification (`calculated === declared`).
- Tampered payloads (single character modification) immediately failed digest verification.

### 3.4 Adapters & Drive Attributes Preservation (Tier 4)
- **Drive SSOT Preservation**:
  - `ref-oa-sdk` adapted to EWIC Resource Envelope: `fileId` (`1m0oG9fBv_ref_oa_sdk_file`), `parentChain` (`['1h_CjCUEaOUaKzImXqbmbRS0AGkPdmkiB', '13kImqWVGEzPeuUD2x4b1bH9lPcqXBUv5']`), `locator`, `revision`, and `contentHash` were 100% retained.
- **Lossless Unknown Field Round-Trip**:
  - Attached custom extension properties (`customExtension: { traceId, priorityScore, labels }`, `upstreamMirrorUrl`).
  - Round-tripped `SourceReference -> Resource Envelope -> SourceReference`.
  - Verified 0 missing keys and 0 value alterations.
- **Source Provider Round-Trip**:
  - The EWIC SSOT provider enum (`google_drive`, `github`, `nes`, `local`) is narrower than the `reference.schema.json` `source.provider` enum (`github`, `drive`, `nes`, `semantic`, `web`): `semantic` and `web` both map to `local`.
  - `toResourceEnvelope` therefore also stores the original value in `_originalSourceReference.sourceProvider`, and `fromResourceEnvelope` restores it from there when it is one of the schema's providers. All five providers round-trip (test: `round-trips source.provider "%s" through the Resource Envelope`, with `covers every provider allowed by reference.schema.json in the round-trip cases` pinning the enum).
  - An envelope that lacks the side-channel (for example one produced outside this adapter) is restored from the SSOT alone: `github` -> `github`, `nes` -> `nes`, and everything else, including `local`, -> `drive`. This direction is lossy for `semantic` and `web` (test: `falls back to the SSOT provider mapping for envelopes without the side-channel`).

### 3.5 Execution Snapshot Reproducibility & Stale Denial (Tier 5)
- Execution envelope referencing `workflowRef` and `resolvedRefs`:
  - When resolved entity hashes match pinned execution record: `{ status: 'reproducible', resolvedCount: 1 }`.
  - When referenced entity drifts: `{ status: 'stale', driftedRefs: [{ refUri, expectedHash, actualHash }] }`.
  - When referenced entity is absent: `{ status: 'unavailable' }`.

### 3.6 Tool Surface & Security Boundaries (Tier 6 & 7)
- Unified tools exported to:
  - **MCP Server** (`createMcpServer`): Listed 3 tools with compliant Draft 2020-12 input schemas.
  - **Commander CLI** (`createCli`): Category command `ewic` with 3 subcommands.
  - **Hono REST** (`createHttpApp` / `ToolApp`): Standard OpenAPI routes.
- **Timing / Presence Enumeration Defense**:
  - Unauthorized actor -> `{ status: 'unavailable' }`.
  - Non-existent resource -> `{ status: 'unavailable' }`.
  - Both responses are identical, preventing attackers from probing for envelope existence.
  - The denial holds because `ewic_verify_execution` authorizes before it verifies: it reads the `workflowRef` envelope and every `resolvedRefs` envelope with `readSourceEnvelope` and checks each with `canReadEnvelope(actorId, envelope)` before any `verifySnapshot` call. A denied actor therefore never reaches the stale/reproducible paths, and no current hash is computed or returned for it.
  - **Actor binding (host requirement)**: the actor checked is the transport-bound `ctx.meta.actorId` when the host sets one; an input `actorId` that contradicts it is denied as `unavailable` without any ACL call. Without a binding the input `actorId` is trusted as-is, so a host that exposes this tool must bind `ctx.meta.actorId` from its own authentication for the ACL check to mean anything (test: `uses the transport-bound ctx.meta.actorId and denies a contradicting input actorId`).
- **Exception Concealment**:
  - Database error leaking `/Users/private/secure/tokens.db` was masked to `{ status: 'unavailable' }`.
  - A throwing ACL check or envelope read is concealed the same way.

---

## 4. Acceptance Sign-Off

- [x] **TypeSpec & JSON Schema Draft 2020-12**: Full model and validator coverage for source, derived, and Colab run packet envelopes.
- [x] **Lossless Unknown-Field Round-Trip**: Verified across adapters in both directions.
- [x] **Drive SSOT Preservation**: fileId, revision, contentHash, parentChain, and locator preserved.
- [x] **Stale Snapshot Denial**: Detected reference drift and returned typed stale errors.
- [x] **Digest Readback**: RFC 8785 canonical hash verified.
- [x] **No-Leak Negative Tests**: Indistinguishable denial and path concealment confirmed.
- [x] **Boundary Discipline**: Zero mutation tools; SDK does not issue official IDs or claim domain authority.

**Conclusion:** Issue #3 acceptance criteria are completely satisfied. EWIC v0.1 envelopes and adapters are fully verified and integrated with the `@oa-sdk` core toolchain.
