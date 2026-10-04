# `@oa-sdk/surface-ir`

Target-neutral API surface IR built from `@oa-sdk/parser`'s `ParsedDocument`.
The package keeps wire-contract facts in the parser IR and adds SDK/CLI surface
policy such as group names, method names, lifecycle, visibility, pagination, and
streaming profiles.

## Forge projection

`toForgeProjection()` produces `x-fern-*` and `x-forge-*` operation metadata.
`emitForgeOverlays()` emits one OpenAPI Overlay document per top-level Forge
command, which matches Forge's one-command-per-overlay resolution model.

The IR is derived from the TypeSpec-generated OpenAPI artifact. It does not
modify TypeSpec source, approved snapshots, or canonical generated artifacts.
