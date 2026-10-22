---
"@oa-sdk/tools": patch
---

Refresh dependency ranges and transitive pins for the 2026-10-22 security audit.

- Raise `hono` to `^4.13.13` and `@modelcontextprotocol/sdk` to `^1.32.1`.
- Pin patched transitive versions through workspace overrides; the NestJS reference app moves to
  NestJS 11 / Swagger 11, and the schema-lint stack moves to Redocly 2.67 / Spectral 6.17.
- `pnpm audit --prod` now reports no known vulnerabilities. The full audit is down to four
  dev-only advisories: `braces` and `sprintf-js` have no patched release, `uuid` would require an
  incompatible major bump through Azure MSAL, and `esbuild` is a Windows-only dev-server low.
