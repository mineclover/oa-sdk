# TypeScript 5 baseline and TypeScript 7 enhanced compatibility

oa-sdk publishes one standard TypeScript declaration surface. TypeScript 5 is
the source and declaration compatibility baseline; TypeScript 7 is an enhanced
consumer-validation lane for generated declarations. It is not a second source
compiler for every workspace package.

## Compatibility lanes

| Lane | Compiler | Contract | Owner command |
|---|---|---|---|
| TS 5 baseline | `typescript@5.9.3` | All workspace source, public exports, and emitted declarations compile with the supported compiler. TS 7-only syntax or compiler APIs must not enter this lane. | `pnpm check:ts5` |
| TS 7 enhanced | `typescript@7.0.2` + `ttsc@0.22.0` | Codegen output is consumable by a native TypeScript 7/`ttsc` project. It does not redefine the SDK source compatibility contract. | `pnpm check:ts7` |

All regular `@oa-sdk/*` packages pin TypeScript 5.9.3. The private
`@oa-sdk/ttsc-compile-fixture` owns TypeScript 7 and `ttsc`; neither dependency
may be added to a production package merely to run an additional compiler.

## Why the lanes are isolated

TypeScript 5 and 7 do not share every compiler option or compiler API. A single
workspace dependency can also replace `node_modules/.bin/tsc`, silently changing
which compiler existing tests use. The fixture prevents that collision: normal
package `tsc` invocations remain TypeScript 5, while the fixture resolves its
own TypeScript 7 runtime for `ttsc`.

The TS 7 compile check creates a minimal project config rather than reusing the
TS 5 workspace `tsconfig`. This is intentional: compatibility means the
generated declaration can be consumed, not that an incompatible source config
must be accepted unchanged by both compilers.

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
   run `pnpm check:ts7`. Verify its platform-native compiler dependency is
   installed in CI.
3. If a package needs the TypeScript compiler API, keep the version-specific
   integration behind a local adapter boundary. Application and generated-code
   logic must not import a version-specific compiler API directly.
4. Run both checks for a codegen, declaration-export, or TypeScript dependency
   change. Ordinary implementation changes use the TS 5 baseline command for
   their affected workspace track.
