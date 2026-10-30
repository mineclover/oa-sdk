import "../dist/tool-pipeline.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

/**
 * Declares a CLI-Anything 2-level `<group>` on an Interface or Namespace,
 * propagating `cliGroup` to all child operations (`x-oa-sdk-tool-group`).
 */
extern dec toolGroup(
  target: Interface | Namespace,
  groupName: valueof string,
  options?: valueof unknown,
);

/**
 * Pre-reserves the 5 CLI-Anything-governed MCP interfaces (`session`, `dry-run-elicit`,
 * `preview-bundle`, `handoff-envelope`, `sep-2640-skills`) in the `mcp-use > cli` direction
 * (`x-oa-sdk-reserved-interfaces`).
 */
extern dec reservedMcpInterfaces(
  target: Namespace | Interface,
  interfaces: valueof unknown,
  options?: valueof unknown,
);

/**
 * Low-level tool contract decorator emitting `x-oa-sdk-tool`.
 */
extern dec oaTool(
  target: Operation,
  options?: valueof unknown,
);

/**
 * Repeatable preset for Read-Only Inspect / List / Get / Status pipeline stage (`x-oa-sdk-tool`).
 */
extern dec pipelineInspect(
  target: Operation,
  commandName: valueof string,
  options?: valueof unknown,
);

/**
 * Repeatable preset for Pure Plan / Dry-Run / Diff Simulation pipeline stage (`x-oa-sdk-tool`).
 */
extern dec pipelinePlan(
  target: Operation,
  commandName: valueof string,
  options?: valueof unknown,
);

/**
 * Repeatable preset for 2-Phase (`plan -> commit`) Idempotent State Mutation pipeline stage (`x-oa-sdk-tool`).
 */
extern dec pipelineApply(
  target: Operation,
  commandName: valueof string,
  options?: valueof unknown,
);

/**
 * Repeatable preset for 2-Phase (`plan -> ctx.elicit() -> commit`) Destructive Mutation stage (`x-oa-sdk-tool`).
 */
extern dec pipelineDestructive(
  target: Operation,
  commandName: valueof string,
  options?: valueof unknown,
);

/**
 * Repeatable preset for Deterministic Gate / Verification / Doctor pipeline stage (`x-oa-sdk-tool`).
 */
extern dec pipelineVerify(
  target: Operation,
  commandName: valueof string,
  options?: valueof unknown,
);

/**
 * Repeatable preset for Stage 1 CLI -> Stage 2 MCP Handoff / Snapshot Export pipeline stage (`x-oa-sdk-tool`).
 */
extern dec pipelineHandoff(
  target: Operation,
  commandName: valueof string,
  options?: valueof unknown,
);

/**
 * Marks a ModelProperty as a CLI positional argument with deterministic ordering (`x-oa-sdk-positional`).
 */
extern dec positional(
  target: ModelProperty,
  order?: valueof unknown,
);

/**
 * Customizes CLI flag projection (`short`, `env`, `negatable`, `placeholder`) on a ModelProperty (`x-oa-sdk-cli-flag`).
 */
extern dec cliFlag(
  target: ModelProperty,
  options: valueof unknown,
);

/**
 * Separately attaches `mcp-use` surface-specific bindings (`view`, `visibility`, `resourceUriTemplate`)
 * onto an Operation (`x-oa-sdk-mcp-surface`).
 */
extern dec mcpSurface(
  target: Operation,
  options: valueof unknown,
);

/**
 * Binds an Operation or Interface to one of the 6-Type Document Standard Table Adapters
 * (`calc`, `writer`, `impress`, `markdown`, `tabular-ops`, `visual-dom`) (`x-oa-sdk-table-adapter`).
 */
extern dec tableAdapter(
  target: Operation | Interface,
  adapterKind: valueof string,
  options?: valueof unknown,
);
