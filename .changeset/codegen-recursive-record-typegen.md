---
"@oa-sdk/codegen": patch
---

Make `oa-gen typegen` emit a compiling declaration for a recursive map schema.

- **Behavior change:** a component schema that is a recursive map (`type: object` with `additionalProperties` that refers back to the schema, directly or around a cycle) was emitted as `export type Node = Record<string, Node>`, which TypeScript rejects with TS2456 ("Type alias 'Node' circularly references itself"). It is now emitted as an index-signature object type (`export type Node = { [key: string]: Node }`, or `export interface Node { [key: string]: Node }` under `--style interface`). Non-recursive maps keep the shorter `Record<string, T>` spelling.
