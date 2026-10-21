---
"@oa-sdk/codegen": patch
---

Improve the onboarding path.

- `oa-gen init` now adds `@types/node` at `^22.0.0`, matching the Node.js 22 floor the packages require (it added `^20.0.0` before), and prints the install and `generate` steps after the summary.
- Loading an `oa.config.ts` that imports a package the project has not installed now appends an install hint to the error, instead of only the bare `Cannot find package` message.
