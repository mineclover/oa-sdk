# Goal 69 - Parser Ref Expansion Performance and Ref-Preserving Graph

**Status: in progress (opened 2026-10-05)**

## Purpose

Parser IR construction currently re-expands every `$ref` target at every use
site. Shared targets (a schema referenced from several places that are
themselves referenced from several places) therefore cost time and memory
exponential in the sharing depth, and every downstream generator pays that cost
again because codegen re-parses the same document per generator.

Goal 69 shares every `$ref` expansion whose result does not depend on the
current expansion stack, keeps the expanded values and completeness evidence
identical, and prepares a ref-preserving graph projection that later consumers
(spec-lens, the Goal 70 studio candidate) can read without inlining.

Scope: Core Platform (`@oa-sdk/parser`, `@oa-sdk/codegen`). Changes to
Downstream packages (`client`, `router`, `mock-server`) are limited to
compatibility fixes required by the parser contract change; their own
performance work stays behind a scope-reactivation decision.

## Measured Baseline (2026-10-05, `packages/parser/dist`)

| Fixture | Size | `parseDocument` |
|---|---|---|
| Diamond DAG (each schema refs the next twice) | depth 14 / 16 / 18 | 296 ms / 1.38 s / 5.0 s |
| Ring of schemas | 100 / 200 / 400 | 51 ms / 188 ms / 1009 ms |
| `resolveRefGraph` on diamond | depth 16 | 262,108 nodes, 693 ms |
| Completeness scan (`existing.some`) | 2,000 / 8,000 refs | 24 ms / 222 ms |

## Results (69.1-69.4, 2026-10-05)

Same machine, HEAD parser source vs. Goal 69 parser source, median of 5:

| Fixture | HEAD | Goal 69 |
|---|---|---|
| `packages/schemas/typespec/approved.openapi.yaml` (Node / browser) | 15.5 / 8.3 ms | 2.4 / 2.8 ms |
| Diamond depth 14 | 358 ms | 0.2 ms |
| Diamond depth 16 | 1.31 s | 0.2 ms |
| Ring 100 / 200 / 400 (Node) | 52 / 199 / 1204 ms | 57 / 210 / 1257 ms |

Rings stay at parity: each component's inlined expansion is cut at a different
point of the ring, so the output itself is O(n^2) and has nothing to share.
Removing that floor requires the ref-preserving projection (69.7), not a faster
inliner.

`corepack pnpm bench:parser` (`scripts/bench/bench-parser.ts`) gates diamond
depth 16/18/24 at 50 ms and ring 100/200 at 150/600 ms. HEAD fails the diamond
budgets by more than an order of magnitude.

### Ref graph and projection (69.5b, 69.7)

| Input | Before | After |
|---|---|---|
| `approved.openapi.yaml` `resolveRefGraph` | 7.7 ms, 722 nodes (165 distinct) | 2.5 ms, 165 nodes |
| Diamond depth 16 `resolveRefGraph` | 1.74 s, 393,179 nodes | 0.2 ms, 33 nodes |
| Ring 400 `projectRefGraph` | n/a | 400 nodes, 400 edges |

`resolveRefGraph` used to re-walk a shared target once per path, so lint and
the TypeSpec provenance check reported the same diagnostic once per path. Each
occurrence now appears once. `resolved` means the target exists; cycle problems
are only `ref-cycle` diagnostics. Descent counts are non-negative, so an
unguarded cycle exists exactly when the zero-descent edges contain a cycle;
every occurrence on such a cycle is diagnosed, including cycles that sit beside
a guarded path between the same targets.

`projectRefGraph` is the ref-preserving view: entry-document declarations
(`components.*`, `paths`, `webhooks`) and external targets are nodes, and each
`$ref` occurrence is an edge from its nearest enclosing declaration to the
target's. Self-references are kept and edges on cycles carry `recursion:
'guarded' | 'unguarded'`. Output size is linear in occurrences, which removes
the O(n^2) ring floor for consumers that need structure rather than inlined
schemas. spec-lens `GetGraphHandler` maps projection edges to provenance
`canonicalId`s. This also fixes two bugs in its previous walker: path keys were
not pointer-escaped, so path-level edges were missing, and refs were matched as
raw strings, so dangling refs produced edges. spec-lens still hides self-edges.

## Contract

- Expanding a `$ref` target produces the same value, the same diagnostics, and
  the same diagnostic order as before; only the work is shared.
- A memoized expansion is reused only when it cannot observe the current
  expansion stack: the expansion did not hit a cycle against a frame below its
  own, and none of the targets it expanded is on the current stack. External
  file targets are never memoized.
- Parser output may share identical subtrees between use sites (a DAG rather
  than a tree). Output is still acyclic. Consumers must not treat a repeated
  object as a cycle; ancestor-path tracking is the supported cycle guard.
- `ParsedDocument.resolution` completeness evidence is unchanged.

## Units

| Unit | Status | Scope |
|---|---|---|
| 69.1 Shared ref expansion memo (`RefExpansionMemo`) for Node (`DerefFolder`) and browser (`derefInternalSpec`) deref; resolver accepts an O(1) stack view | done | parser |
| 69.2 Linear completeness scan (`Set` of covered refs, clean-subtree skip, lazily formatted pointers) | done | parser |
| 69.3 DAG-safe consumers: client `serializeValidationSchema` switched from a global seen-set to an ancestor-path guard. Typegen `analyzeSchemaFidelity` already used one | done | client |
| 69.4 Diamond and ring fixtures in `scripts/bench` with regression thresholds (`bench:parser`) | done | parser bench |
| 69.5a Recursive schema rule shared by parse and lint (`recursion-guard.ts`) | done | parser |
| 69.5b `resolveRefGraph` records one node per `$ref` occurrence and visits each target once; unguarded cycles come from SCCs of zero-descent edges; typegen dedupes with a `Map` | done | parser, codegen |
| 69.6 `oa-gen generate` parses each projected spec once (lazily) and passes the `ParsedDocument` to every generator. Typegen's two non-deref parses stay: after 69.2 they are linear | done | codegen |
| 69.7 Ref-preserving graph projection `projectRefGraph` (declarations as nodes, one edge per `$ref` occurrence with `guarded`/`unguarded` recursion); spec-lens graph edges use it | done | parser, spec-lens |

## Decisions

- Recursive schemas are allowed (decided 2026-10-05). `recursion-guard.ts`
  defines validity: a cycle is valid recursion when the path from the cyclic
  target back to itself crosses at least one instance-descending keyword
  (`properties`, `patternProperties`, `additionalProperties`,
  `unevaluatedProperties`, `propertyNames`, `items`, `prefixItems`,
  `additionalItems`, `unevaluatedItems`, `contains`, `contentSchema`). Such
  cycles are finite for every finite instance (trees, linked lists, JSON value
  types), emit no diagnostic, and keep the document `complete`.
  - Cycles through aliases or same-instance keywords only (`allOf`, `anyOf`,
    `oneOf`, `not`, `if`/`then`/`else`, `dependentSchemas`) never make progress
    and stay `ref-cycle` diagnostics, so the document stays `partial`.
  - Representation is unchanged: `cycleStrategy` cuts valid recursion like any
    other cycle (`{}` by default, `$ref` with `preserve-ref`). Preserved
    recursion refs are reported through `onRecursiveRef` /
    `recursiveRefs` and count as covered in completeness evidence.
  - Parse (Node and browser deref) and lint (`resolveRefGraph`) use the same
    rule; this replaces the `type: object` heuristic from commit 3845a5d5.
    Goal 65's cycle clause is amended accordingly.
- Pre-existing: `DerefFolder` disables internal file paths in cache keys, so
  internal refs inside an external document share the `<root>` key namespace
  with the entry document. This affects cycle identity only; 69.1 does not
  memoize external expansions and leaves this behavior unchanged.

## Deferred (Downstream, needs scope-reactivation decision)

- mock-server: per-request response generation and validation, URL-keyed
  `allowedHeadersCache` growth.
- `route-match`: linear regex scan per request.
- Generated client: inline `JSON.parse` of validation schemas per call.
- CI: no `.turbo` persistence, repeated `build:core`, serial test workers.
- `codegen` dev-depends on `client`/`router`/`mock-server` but imports them at
  runtime in `oa-gen generate`.

## Verification

- `packages/parser/src/__tests__/ref-expansion-memo.test.ts` compares Node and
  browser deref against an un-memoized oracle on 60 seeded random ref graphs
  per cycle strategy (values and diagnostic order). It also covers
  context-sensitive mutual recursion, diagnostic replay per use site, and a
  40-level diamond. Removing either memo safety condition fails these tests.
- `packages/client/src/__tests__/runtime-schema.test.ts` covers shared subtree
  serialization and true object cycles.
- `packages/parser/src/__tests__/recursion-guard.test.ts` pins the recursion
  rule (keyword contexts, property names that look like keywords, data values)
  and checks that Node parse, browser parse, and `resolveRefGraph` agree on
  valid and invalid cycles.
- Client, router, and mock-server "rejects incomplete ref" tests now use an
  unguarded `allOf` self-cycle. New positive tests generate a client and router
  from a recursive tree spec and serve it from the Node mock server
  (`{"name":"","children":[]}` for a required recursive field).
- Parser, client, router, mock-server, and codegen full suites pass; parser,
  client, and codegen typecheck. Codegen CLI subprocess tests time out under
  host load average above 10 and pass when rerun.
- Existing ref-completeness, cycle-strategy, and sibling-merge tests are
  unchanged and pass.
