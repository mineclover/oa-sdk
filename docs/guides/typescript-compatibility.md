# TypeScript 5 baseline and TypeScript 7 enhanced compatibility

oa-sdk publishes one standard TypeScript declaration surface. TypeScript 5 is
the stable source and declaration compatibility baseline; TypeScript 7/`ttsc`
is a Node 26 Current compatibility no-emit validation lane for Core source and generated
declarations. It is not the default compiler for workspace builds or declaration emission.

## Compatibility lanes

| Lane | Compiler | Contract | Owner command |
|---|---|---|---|
| Stable | Node.js 24 LTS + `typescript@5.9.3` | All workspace source, public exports, and emitted declarations compile with the supported compiler. TS 7-only syntax or compiler APIs must not enter this lane. | `pnpm check:ts5` |
| Node 26 Current compatibility | Node.js 26 + `typescript@7.0.2` + `ttsc@0.26.0` | Each Core TypeScript package and generated code compile without emission. This lane detects forward compatibility drift and does not redefine the SDK source or declaration contract. | `pnpm check:ts7` |

Use `source scripts/use-node-version.sh stable` for the default lane or
`source scripts/use-node-version.sh node26` before running the Node 26 lane.

Node 26 is a Current release, not an LTS release. Keep Node 24 LTS as the
production lane; the Node 26 job is forward-compatibility validation only and
must not become a release or deployment requirement. See the official [Node.js release schedule](https://nodejs.org/en/about/previous-releases).

All regular `@oa-sdk/*` packages pin TypeScript 5.9.3. The private
`@oa-sdk/ttsc-compile-fixture` owns TypeScript 7 and `ttsc`; neither dependency
may be added to a production package merely to run the latest validation lane.

## Why the lanes are isolated

TypeScript 5 and 7 do not share every compiler option or compiler API. A single
workspace dependency can also replace `node_modules/.bin/tsc`, silently changing
which compiler existing tests use. The fixture prevents that collision: normal
package `tsc` invocations remain TypeScript 5, while the fixture resolves its
own TypeScript 7 runtime for `ttsc`.

The TS 7 lane checks each Core package's existing `tsconfig` with `ttsc` and
also creates a minimal consumer config for generated declarations. The former
detects forward-compatibility drift in source; the latter proves that generated
output can be consumed without replacing the stable workspace compiler.

## Generated declaration policy

- Publish one `.d.ts` surface compiled from the TS 5 baseline. Do not add
  `typesVersions` or TS 7-only declarations unless a released public type must
  genuinely differ by compiler version.
- `oa-gen typegen` output must use syntax accepted by both lanes. The codegen
  compatibility test compiles a representative fixture and the actual merged
  OpenAPI contract with both compilers.
- Generated declaration ordering uses Unicode code-point comparison, never the
  host's locale-sensitive `localeCompare`, so output is reproducible across CI
  and consumer environments.
- A future TS 7-only generation feature must be explicit, for example
  `target: 'ts7'`; the default remains the TS 5-compatible target. Add a
  dedicated output fixture and document the consumer requirement before
  releasing it.

## Upgrade procedure

1. Update every regular workspace package from one pinned TS 5 version to the
   next selected TS 5 version, regenerate `pnpm-lock.yaml`, then run
   `pnpm check:ts5`.
2. Update TypeScript 7 and `ttsc` only in `packages/ttsc-compile-fixture`, then
   run `pnpm check:ts7` on Node.js 26. Verify its platform-native compiler
   dependency is installed in CI.
3. If a package needs the TypeScript compiler API, keep the version-specific
   integration behind a local adapter boundary. Application and generated-code
   logic must not import a version-specific compiler API directly.
4. Run both checks for a codegen, declaration-export, or TypeScript dependency
   change. Ordinary implementation changes use the TS 5 baseline command for
   their affected workspace track.
