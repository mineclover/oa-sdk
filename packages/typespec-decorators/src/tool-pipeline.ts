import type {
  DecoratorContext,
  Interface,
  ModelProperty,
  Namespace,
  Operation,
  Type,
} from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import {
  CLI_FLAG_EXTENSION,
  MCP_SURFACE_EXTENSION,
  PIPELINE_STAGE_PRESETS,
  POSITIONAL_EXTENSION,
  RESERVED_MCP_INTERFACES_EXTENSION,
  TABLE_ADAPTER_EXTENSION,
  TOOL_EXTENSION,
  TOOL_GROUP_EXTENSION,
  VALID_EXECUTION_MODELS,
  VALID_MCP_VISIBILITIES,
  VALID_PIPELINE_STAGES,
  VALID_RESERVED_MCP_INTERFACES,
  VALID_SESSION_LOCKS,
  VALID_TABLE_ADAPTER_KINDS,
  VALID_TOOL_IDENTIFIER_PATTERN,
  namespace,
  type PipelineStagePresetConfig,
} from './constants.js'
import { reportDiagnostic } from './lib.js'

export {
  CLI_FLAG_EXTENSION,
  MCP_SURFACE_EXTENSION,
  PIPELINE_STAGE_PRESETS,
  POSITIONAL_EXTENSION,
  RESERVED_MCP_INTERFACES_EXTENSION,
  TABLE_ADAPTER_EXTENSION,
  TOOL_EXTENSION,
  TOOL_GROUP_EXTENSION,
  VALID_EXECUTION_MODELS,
  VALID_MCP_VISIBILITIES,
  VALID_PIPELINE_STAGES,
  VALID_RESERVED_MCP_INTERFACES,
  VALID_SESSION_LOCKS,
  VALID_TABLE_ADAPTER_KINDS,
  VALID_TOOL_IDENTIFIER_PATTERN,
  namespace,
  type PipelineStagePresetConfig,
}

type ToolPipelineTarget = Operation | Interface | Namespace | ModelProperty

function reportInvalidRule(
  context: DecoratorContext,
  target: ToolPipelineTarget,
  message: string,
  argIndex = 0,
): void {
  reportDiagnostic(context.program, {
    code: 'invalid-tool-pipeline-rule',
    target: context.getArgumentTarget(argIndex) ?? target,
    format: { message },
  })
}

function describeOptionValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function isOptionsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNumericOption(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'object' || value === null) return undefined
  if ('asNumber' in value && typeof value.asNumber === 'function') {
    let resolved: unknown
    try {
      resolved = value.asNumber()
    } catch {
      return Number.NaN
    }
    return typeof resolved === 'number' ? resolved : Number.NaN
  }
  if ('value' in value && typeof value.value === 'number') return value.value
  return undefined
}

function resolveBooleanOption(
  context: DecoratorContext,
  target: ToolPipelineTarget,
  options: Record<string, unknown> | undefined,
  key: string,
  fallback: boolean,
  argIndex = 0,
): boolean | undefined {
  const raw = options?.[key]
  if (raw === undefined) return fallback
  if (typeof raw === 'boolean') return raw
  reportInvalidRule(
    context,
    target,
    `${key} must be a boolean (received: ${describeOptionValue(raw)}).`,
    argIndex,
  )
  return undefined
}

function resolveStringOption(
  context: DecoratorContext,
  target: ToolPipelineTarget,
  options: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
  choices?: { readonly label: string; readonly values: ReadonlySet<string> },
  argIndex = 0,
): string | undefined {
  const raw = options?.[key]
  if (raw === undefined) return fallback
  const expected = choices ? `one of: ${[...choices.values].join(', ')}` : 'a string'
  if (typeof raw !== 'string') {
    reportInvalidRule(
      context,
      target,
      `${key} must be ${expected} (received: ${describeOptionValue(raw)}).`,
      argIndex,
    )
    return undefined
  }
  if (choices && !choices.values.has(raw)) {
    reportInvalidRule(
      context,
      target,
      `Unknown ${choices.label} "${raw}". Expected ${expected}.`,
      argIndex,
    )
    return undefined
  }
  return raw
}

function resolveStringArrayOption(
  context: DecoratorContext,
  target: ToolPipelineTarget,
  options: Record<string, unknown> | undefined,
  key: string,
  fallback: readonly string[] = [],
  argIndex = 0,
): string[] | undefined {
  const raw = options?.[key]
  if (raw === undefined) return [...fallback]
  if (!Array.isArray(raw) || !raw.every(item => typeof item === 'string' && item.trim().length > 0)) {
    reportInvalidRule(
      context,
      target,
      `${key} must be an array of non-empty strings (received: ${describeOptionValue(raw)}).`,
      argIndex,
    )
    return undefined
  }
  return [...raw]
}

function toSnakeCaseToolSegment(value: string): string {
  return value.trim().replace(/-/g, '_')
}

function buildDefaultMcpToolName(cliGroup: string, cliCommand: string): string {
  if (!cliGroup) return toSnakeCaseToolSegment(cliCommand)
  return `${toSnakeCaseToolSegment(cliGroup)}_${toSnakeCaseToolSegment(cliCommand)}`
}

function getContainerOperations(target: Interface | Namespace): Iterable<Operation> {
  const ops = (target as { operations?: Map<string, Operation> }).operations
  if (ops && typeof ops.values === 'function') {
    return ops.values()
  }
  return []
}

function lookupInheritedExtension<T>(
  program: DecoratorContext['program'],
  operation: Operation,
  extensionKey: `x-${string}`,
): T | undefined {
  const iface = (operation as { interface?: Interface }).interface
  if (iface) {
    const fromInterface = getExtensions(program, iface as unknown as Type).get(extensionKey) as T | undefined
    if (fromInterface !== undefined) return fromInterface
    const ifaceNs = (iface as { namespace?: Namespace }).namespace
    if (ifaceNs) {
      const fromIfaceNs = getExtensions(program, ifaceNs as unknown as Type).get(extensionKey) as T | undefined
      if (fromIfaceNs !== undefined) return fromIfaceNs
    }
  }
  const ns = (operation as { namespace?: Namespace }).namespace
  if (ns) {
    const fromNs = getExtensions(program, ns as unknown as Type).get(extensionKey) as T | undefined
    if (fromNs !== undefined) return fromNs
  }
  return undefined
}

/**
 * L1 Decorator: `@toolGroup(groupName, options?)`
 * Declares a CLI-Anything 2-level `<group>` on an Interface or Namespace, and propagates
 * `cliGroup` to all child operations (emitting `x-oa-sdk-tool-group`).
 */
export function $toolGroup(
  context: DecoratorContext,
  target: Interface | Namespace,
  groupName: string,
  options?: Record<string, unknown>,
): void {
  if (typeof groupName !== 'string' || !VALID_TOOL_IDENTIFIER_PATTERN.test(groupName)) {
    reportInvalidRule(
      context,
      target,
      `groupName must be a lowercase kebab-case identifier matching ${VALID_TOOL_IDENTIFIER_PATTERN.source} (received: ${describeOptionValue(groupName)}).`,
      0,
    )
    return
  }
  if (options !== undefined && !isOptionsRecord(options)) {
    reportInvalidRule(
      context,
      target,
      `@toolGroup options must be an object (received: ${describeOptionValue(options)}).`,
      1,
    )
    return
  }
  const description = resolveStringOption(context, target, options, 'description', '', undefined, 1)
  if (description === undefined) return
  const aliases = resolveStringArrayOption(context, target, options, 'aliases', [], 1)
  if (aliases === undefined) return

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    cliGroup: groupName,
    ...(description ? { description } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  }
  setExtension(context.program, target, TOOL_GROUP_EXTENSION, payload)

  for (const op of getContainerOperations(target)) {
    setExtension(context.program, op, TOOL_GROUP_EXTENSION, payload)
    const existingTool = getExtensions(context.program, op).get(TOOL_EXTENSION) as
      | Record<string, unknown>
      | undefined
    if (existingTool && (!existingTool.cliGroup || existingTool._inheritedGroup !== false)) {
      const cliCommand = String(existingTool.cliCommand ?? '')
      const updatedTool: Record<string, unknown> = {
        ...existingTool,
        cliGroup: groupName,
      }
      if (existingTool._autoMcpToolName === true && cliCommand) {
        updatedTool.mcpToolName = buildDefaultMcpToolName(groupName, cliCommand)
      }
      setExtension(context.program, op, TOOL_EXTENSION, updatedTool)
    }
  }
}

/**
 * L1 Decorator: `@reservedMcpInterfaces(interfaces, options?)`
 * Pre-reserves the 5 CLI-Anything-governed MCP interfaces (`session`, `dry-run-elicit`,
 * `preview-bundle`, `handoff-envelope`, `sep-2640-skills`) on a Namespace or Interface.
 */
export function $reservedMcpInterfaces(
  context: DecoratorContext,
  target: Namespace | Interface,
  interfaces: unknown,
  options?: Record<string, unknown>,
): void {
  const expected = `one of: ${[...VALID_RESERVED_MCP_INTERFACES].join(', ')}`
  if (!Array.isArray(interfaces) || interfaces.length === 0) {
    reportInvalidRule(
      context,
      target,
      `@reservedMcpInterfaces requires a non-empty array of reserved interface names (${expected}).`,
      0,
    )
    return
  }
  const normalized: string[] = []
  for (const item of interfaces) {
    if (typeof item !== 'string' || !VALID_RESERVED_MCP_INTERFACES.has(item)) {
      reportInvalidRule(
        context,
        target,
        `Unknown reserved MCP interface ${describeOptionValue(item)}. Expected ${expected}.`,
        0,
      )
      return
    }
    if (!normalized.includes(item)) {
      normalized.push(item)
    }
  }
  if (options !== undefined && !isOptionsRecord(options)) {
    reportInvalidRule(
      context,
      target,
      `@reservedMcpInterfaces options must be an object (received: ${describeOptionValue(options)}).`,
      1,
    )
    return
  }

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    direction: 'mcp-use>cli',
    interfaces: normalized,
  }
  setExtension(context.program, target, RESERVED_MCP_INTERFACES_EXTENSION, payload)

  for (const op of getContainerOperations(target)) {
    setExtension(context.program, op, RESERVED_MCP_INTERFACES_EXTENSION, payload)
  }
}

function applyToolPipelinePreset(
  context: DecoratorContext,
  target: Operation,
  presetStage: string,
  cliCommandArg: string | undefined,
  options: Record<string, unknown> | undefined,
  optionsArgIndex: number,
): void {
  if (options !== undefined && !isOptionsRecord(options)) {
    reportInvalidRule(
      context,
      target,
      `Tool pipeline options must be an object (received: ${describeOptionValue(options)}).`,
      optionsArgIndex,
    )
    return
  }

  const preset = PIPELINE_STAGE_PRESETS[presetStage] ?? PIPELINE_STAGE_PRESETS.custom!

  const stage = resolveStringOption(
    context,
    target,
    options,
    'stage',
    preset.stage,
    { label: 'pipeline stage', values: VALID_PIPELINE_STAGES },
    optionsArgIndex,
  )
  if (stage === undefined) return

  const stageDefaults = PIPELINE_STAGE_PRESETS[stage] ?? preset

  const inheritedGroupObj = lookupInheritedExtension<{ cliGroup?: string }>(
    context.program,
    target,
    TOOL_GROUP_EXTENSION,
  )
  const explicitGroupRaw = options?.cliGroup
  const hasExplicitGroup = explicitGroupRaw !== undefined
  const cliGroup = resolveStringOption(
    context,
    target,
    options,
    'cliGroup',
    inheritedGroupObj?.cliGroup ?? '',
    undefined,
    optionsArgIndex,
  )
  if (cliGroup === undefined) return
  if (cliGroup !== '' && !VALID_TOOL_IDENTIFIER_PATTERN.test(cliGroup)) {
    reportInvalidRule(
      context,
      target,
      `cliGroup must be a lowercase kebab-case identifier matching ${VALID_TOOL_IDENTIFIER_PATTERN.source} (received: ${describeOptionValue(cliGroup)}).`,
      optionsArgIndex,
    )
    return
  }

  const defaultCommand = cliCommandArg ?? (typeof options?.cliCommand === 'string' ? options.cliCommand : '')
  const cliCommand =
    cliCommandArg !== undefined
      ? cliCommandArg
      : resolveStringOption(context, target, options, 'cliCommand', defaultCommand, undefined, optionsArgIndex)
  if (cliCommand === undefined) return
  if (typeof cliCommand !== 'string' || !VALID_TOOL_IDENTIFIER_PATTERN.test(cliCommand)) {
    reportInvalidRule(
      context,
      target,
      `cliCommand must be a lowercase kebab-case identifier matching ${VALID_TOOL_IDENTIFIER_PATTERN.source} (received: ${describeOptionValue(cliCommand)}).`,
      cliCommandArg !== undefined ? 0 : optionsArgIndex,
    )
    return
  }

  const aliases = resolveStringArrayOption(context, target, options, 'aliases', [], optionsArgIndex)
  if (aliases === undefined) return

  const positionalArgs = resolveStringArrayOption(
    context,
    target,
    options,
    'positionalArgs',
    [],
    optionsArgIndex,
  )
  if (positionalArgs === undefined) return

  const readOnly = resolveBooleanOption(
    context,
    target,
    options,
    'readOnly',
    stageDefaults.readOnly,
    optionsArgIndex,
  )
  if (readOnly === undefined) return

  const destructive = resolveBooleanOption(
    context,
    target,
    options,
    'destructive',
    stageDefaults.destructive,
    optionsArgIndex,
  )
  if (destructive === undefined) return

  const idempotent = resolveBooleanOption(
    context,
    target,
    options,
    'idempotent',
    stageDefaults.idempotent,
    optionsArgIndex,
  )
  if (idempotent === undefined) return

  const openWorld = resolveBooleanOption(
    context,
    target,
    options,
    'openWorld',
    stageDefaults.openWorld,
    optionsArgIndex,
  )
  if (openWorld === undefined) return

  const dryRunSupport = resolveBooleanOption(
    context,
    target,
    options,
    'dryRunSupport',
    stageDefaults.dryRunSupport,
    optionsArgIndex,
  )
  if (dryRunSupport === undefined) return

  const undoSnapshot = resolveBooleanOption(
    context,
    target,
    options,
    'undoSnapshot',
    stageDefaults.undoSnapshot,
    optionsArgIndex,
  )
  if (undoSnapshot === undefined) return

  const requiresPreviewBundle = resolveBooleanOption(
    context,
    target,
    options,
    'requiresPreviewBundle',
    stageDefaults.requiresPreviewBundle,
    optionsArgIndex,
  )
  if (requiresPreviewBundle === undefined) return

  const requiresHandoffEnvelope = resolveBooleanOption(
    context,
    target,
    options,
    'requiresHandoffEnvelope',
    stageDefaults.requiresHandoffEnvelope,
    optionsArgIndex,
  )
  if (requiresHandoffEnvelope === undefined) return

  const sessionLock = resolveStringOption(
    context,
    target,
    options,
    'sessionLock',
    stageDefaults.sessionLock,
    { label: 'session lock policy', values: VALID_SESSION_LOCKS },
    optionsArgIndex,
  )
  if (sessionLock === undefined) return

  const executionModel = resolveStringOption(
    context,
    target,
    options,
    'executionModel',
    stageDefaults.executionModel,
    { label: 'execution model', values: VALID_EXECUTION_MODELS },
    optionsArgIndex,
  )
  if (executionModel === undefined) return

  const hasExplicitMcpToolName = options?.mcpToolName !== undefined
  const mcpToolName = resolveStringOption(
    context,
    target,
    options,
    'mcpToolName',
    buildDefaultMcpToolName(cliGroup, cliCommand),
    undefined,
    optionsArgIndex,
  )
  if (mcpToolName === undefined) return

  const existingSurface = getExtensions(context.program, target).get(MCP_SURFACE_EXTENSION) as
    | { view?: string; visibility?: string; resourceUriTemplate?: string }
    | undefined

  const mcpView = resolveStringOption(
    context,
    target,
    options,
    'mcpView',
    existingSurface?.view ?? '',
    undefined,
    optionsArgIndex,
  )
  if (mcpView === undefined) return

  const mcpVisibility = resolveStringOption(
    context,
    target,
    options,
    'mcpVisibility',
    existingSurface?.visibility ?? 'model',
    { label: 'MCP visibility', values: VALID_MCP_VISIBILITIES },
    optionsArgIndex,
  )
  if (mcpVisibility === undefined) return

  const inheritedReserved = lookupInheritedExtension<Record<string, unknown>>(
    context.program,
    target,
    RESERVED_MCP_INTERFACES_EXTENSION,
  )
  if (inheritedReserved) {
    setExtension(context.program, target, RESERVED_MCP_INTERFACES_EXTENSION, inheritedReserved)
  }

  const inheritedTableAdapter = lookupInheritedExtension<Record<string, unknown>>(
    context.program,
    target,
    TABLE_ADAPTER_EXTENSION,
  )
  if (
    inheritedTableAdapter &&
    getExtensions(context.program, target).get(TABLE_ADAPTER_EXTENSION) === undefined
  ) {
    setExtension(context.program, target, TABLE_ADAPTER_EXTENSION, inheritedTableAdapter)
  }

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    stage,
    cliGroup,
    cliCommand,
    aliases,
    positionalArgs,
    readOnly,
    destructive,
    idempotent,
    openWorld,
    dryRunSupport,
    sessionLock,
    undoSnapshot,
    executionModel,
    requiresPreviewBundle,
    requiresHandoffEnvelope,
    mcpToolName,
    mcpVisibility,
    ...(mcpView ? { mcpView } : {}),
    ...(existingSurface?.resourceUriTemplate
      ? { resourceUriTemplate: existingSurface.resourceUriTemplate }
      : {}),
    _inheritedGroup: !hasExplicitGroup,
    _autoMcpToolName: !hasExplicitMcpToolName,
  }

  setExtension(context.program, target, TOOL_EXTENSION, payload)
}

/**
 * L2-0 Decorator: `@oaTool(options)`
 * Low-level tool contract decorator supporting full customization of CLI + mcp-use properties.
 */
export function $oaTool(
  context: DecoratorContext,
  target: Operation,
  options?: Record<string, unknown>,
): void {
  applyToolPipelinePreset(context, target, 'custom', undefined, options, 0)
}

/**
 * L2-1 Decorator: `@pipelineInspect(commandName, options?)`
 * Repeatable preset for Read-Only Inspect / List / Get / Status pipeline stage.
 */
export function $pipelineInspect(
  context: DecoratorContext,
  target: Operation,
  commandName: string,
  options?: Record<string, unknown>,
): void {
  applyToolPipelinePreset(context, target, 'inspect', commandName, options, 1)
}

/**
 * L2-2 Decorator: `@pipelinePlan(commandName, options?)`
 * Repeatable preset for Pure Plan / Dry-Run / Diff Simulation pipeline stage.
 */
export function $pipelinePlan(
  context: DecoratorContext,
  target: Operation,
  commandName: string,
  options?: Record<string, unknown>,
): void {
  applyToolPipelinePreset(context, target, 'plan', commandName, options, 1)
}

/**
 * L2-3 Decorator: `@pipelineApply(commandName, options?)`
 * Repeatable preset for 2-Phase (`plan -> commit`) Idempotent State Mutation pipeline stage.
 */
export function $pipelineApply(
  context: DecoratorContext,
  target: Operation,
  commandName: string,
  options?: Record<string, unknown>,
): void {
  applyToolPipelinePreset(context, target, 'apply', commandName, options, 1)
}

/**
 * L2-4 Decorator: `@pipelineDestructive(commandName, options?)`
 * Repeatable preset for 2-Phase (`plan -> ctx.elicit() -> commit`) Destructive Mutation stage.
 */
export function $pipelineDestructive(
  context: DecoratorContext,
  target: Operation,
  commandName: string,
  options?: Record<string, unknown>,
): void {
  applyToolPipelinePreset(context, target, 'destructive', commandName, options, 1)
}

/**
 * L2-5 Decorator: `@pipelineVerify(commandName, options?)`
 * Repeatable preset for Deterministic Gate / Verification / Doctor pipeline stage.
 */
export function $pipelineVerify(
  context: DecoratorContext,
  target: Operation,
  commandName: string,
  options?: Record<string, unknown>,
): void {
  applyToolPipelinePreset(context, target, 'verify', commandName, options, 1)
}

/**
 * L2-6 Decorator: `@pipelineHandoff(commandName, options?)`
 * Repeatable preset for Stage 1 CLI -> Stage 2 MCP Handoff / Snapshot Export pipeline stage.
 */
export function $pipelineHandoff(
  context: DecoratorContext,
  target: Operation,
  commandName: string,
  options?: Record<string, unknown>,
): void {
  applyToolPipelinePreset(context, target, 'handoff', commandName, options, 1)
}

/**
 * L3 Decorator: `@positional(order?)`
 * Marks a `ModelProperty` as a CLI positional argument with deterministic ordering.
 */
export function $positional(
  context: DecoratorContext,
  target: ModelProperty,
  order?: unknown,
): void {
  let resolvedOrder = 0
  if (order !== undefined) {
    const num = toNumericOption(order)
    if (num === undefined || !Number.isSafeInteger(num) || num < 0) {
      reportInvalidRule(
        context,
        target,
        `@positional order must be a non-negative integer (received: ${describeOptionValue(order)}).`,
        0,
      )
      return
    }
    resolvedOrder = num
  }
  setExtension(context.program, target, POSITIONAL_EXTENSION, {
    order: resolvedOrder,
  })
}

/**
 * L3 Decorator: `@cliFlag(options)`
 * Customizes CLI flag projection for a `ModelProperty` (`short`, `env`, `negatable`, `placeholder`).
 */
export function $cliFlag(
  context: DecoratorContext,
  target: ModelProperty,
  options: Record<string, unknown>,
): void {
  if (!isOptionsRecord(options)) {
    reportInvalidRule(
      context,
      target,
      `@cliFlag options must be an object (received: ${describeOptionValue(options)}).`,
      0,
    )
    return
  }
  const long = resolveStringOption(context, target, options, 'long', '', undefined, 0)
  if (long === undefined) return
  const short = resolveStringOption(context, target, options, 'short', '', undefined, 0)
  if (short === undefined) return
  if (short !== '' && !/^[A-Za-z]$/.test(short)) {
    reportInvalidRule(
      context,
      target,
      `@cliFlag short option must be a single ASCII letter (received: ${describeOptionValue(short)}).`,
      0,
    )
    return
  }
  const env = resolveStringOption(context, target, options, 'env', '', undefined, 0)
  if (env === undefined) return
  const placeholder = resolveStringOption(context, target, options, 'placeholder', '', undefined, 0)
  if (placeholder === undefined) return
  const negatable = resolveBooleanOption(context, target, options, 'negatable', false, 0)
  if (negatable === undefined) return

  const payload: Record<string, unknown> = {
    ...(long ? { long } : {}),
    ...(short ? { short } : {}),
    ...(env ? { env } : {}),
    ...(placeholder ? { placeholder } : {}),
    negatable,
  }
  setExtension(context.program, target, CLI_FLAG_EXTENSION, payload)
}

/**
 * L3 Decorator: `@mcpSurface(options)`
 * Separately attaches `mcp-use` surface-specific bindings (`view`, `visibility`, `resourceUriTemplate`)
 * onto an Operation without cluttering the core CLI pipeline stage declaration.
 */
export function $mcpSurface(
  context: DecoratorContext,
  target: Operation,
  options: Record<string, unknown>,
): void {
  if (!isOptionsRecord(options)) {
    reportInvalidRule(
      context,
      target,
      `@mcpSurface options must be an object (received: ${describeOptionValue(options)}).`,
      0,
    )
    return
  }
  const view = resolveStringOption(context, target, options, 'view', '', undefined, 0)
  if (view === undefined) return
  const visibility = resolveStringOption(
    context,
    target,
    options,
    'visibility',
    'model',
    { label: 'MCP visibility', values: VALID_MCP_VISIBILITIES },
    0,
  )
  if (visibility === undefined) return
  const resourceUriTemplate = resolveStringOption(
    context,
    target,
    options,
    'resourceUriTemplate',
    '',
    undefined,
    0,
  )
  if (resourceUriTemplate === undefined) return

  const payload: Record<string, unknown> = {
    visibility,
    ...(view ? { view } : {}),
    ...(resourceUriTemplate ? { resourceUriTemplate } : {}),
  }
  setExtension(context.program, target, MCP_SURFACE_EXTENSION, payload)

  const existingTool = getExtensions(context.program, target).get(TOOL_EXTENSION) as
    | Record<string, unknown>
    | undefined
  if (existingTool) {
    setExtension(context.program, target, TOOL_EXTENSION, {
      ...existingTool,
      mcpVisibility: visibility,
      ...(view ? { mcpView: view } : {}),
      ...(resourceUriTemplate ? { resourceUriTemplate } : {}),
    })
  }
}

/**
 * L3 Decorator: `@tableAdapter(adapterKind, options?)`
 * Binds an Operation or Interface to one of the 6-Type Document Standard Table Adapters
 * (`calc`, `writer`, `impress`, `markdown`, `tabular-ops`, `visual-dom`) using `UnifiedTableIR`.
 */
export function $tableAdapter(
  context: DecoratorContext,
  target: Operation | Interface,
  adapterKind: string,
  options?: Record<string, unknown>,
): void {
  const expected = `one of: ${[...VALID_TABLE_ADAPTER_KINDS].join(', ')}`
  if (typeof adapterKind !== 'string' || !VALID_TABLE_ADAPTER_KINDS.has(adapterKind)) {
    reportInvalidRule(
      context,
      target,
      `Unknown table adapter kind ${describeOptionValue(adapterKind)}. Expected ${expected}.`,
      0,
    )
    return
  }
  if (options !== undefined && !isOptionsRecord(options)) {
    reportInvalidRule(
      context,
      target,
      `@tableAdapter options must be an object (received: ${describeOptionValue(options)}).`,
      1,
    )
    return
  }
  const irVersion = resolveStringOption(
    context,
    target,
    options,
    'irVersion',
    'unified-table-ir/v1',
    undefined,
    1,
  )
  if (irVersion === undefined) return
  const preserveFormulas = resolveBooleanOption(
    context,
    target,
    options,
    'preserveFormulas',
    true,
    1,
  )
  if (preserveFormulas === undefined) return
  const preserveMergedCells = resolveBooleanOption(
    context,
    target,
    options,
    'preserveMergedCells',
    true,
    1,
  )
  if (preserveMergedCells === undefined) return

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    adapterKind,
    irVersion,
    preserveFormulas,
    preserveMergedCells,
  }
  setExtension(context.program, target, TABLE_ADAPTER_EXTENSION, payload)

  if ((target as { kind?: string }).kind === 'Interface') {
    for (const op of getContainerOperations(target as Interface)) {
      if (getExtensions(context.program, op).get(TABLE_ADAPTER_EXTENSION) === undefined) {
        setExtension(context.program, op, TABLE_ADAPTER_EXTENSION, payload)
      }
    }
  }
}
