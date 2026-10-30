/**
 * @oa-sdk/tools — Single-Point Spec Hydrator (`hydrateToolsFromOpenApi`)
 *
 * Hydrates `ToolDefinition[]` and `CLI-Anything` / `mcp-use` v2 execution metadata
 * directly from a TypeSpec-compiled OpenAPI 3.1/3.2 specification (`x-oa-sdk-tool*`),
 * enforcing 1:1 parity between `.tsp` `operationId`s and pure domain handlers.
 */
import { randomUUID } from 'node:crypto'
import {
  FileSessionStore,
  HandoffEnvelopeStore,
  PreviewBundleStore,
  computeCanonicalSha256,
  isTwoPhaseMutationHandler,
  normalizeCommandOutcome,
  type AnyPipelineToolHandler,
  type CommandOutcome,
  type ElicitationContext,
  type HandoffEnvelopeV1,
  type PreviewBundleV1,
  type SessionMutationInput,
} from './reserved-interfaces.js'
import {
  dereferenceSchema,
  normalizeJsonSchema,
  type JsonSchemaObject,
  type JsonSchemaProperty,
} from './schema.js'
import { toStandardSchemaWithJson, type StandardSchemaWithJson } from './standard-schema.js'
import type { ToolDefinition } from './types.js'

export interface HydratedCliFlagMeta {
  readonly propertyName: string
  readonly flagName: string
  readonly short?: string | undefined
  readonly env?: string | undefined
  readonly negatable?: boolean | undefined
  readonly placeholder?: string | undefined
  readonly type: string
  readonly required: boolean
  readonly description?: string | undefined
  readonly default?: unknown
}

export interface HydratedPositionalArgMeta {
  readonly name: string
  readonly order: number
  readonly required: boolean
  readonly description?: string | undefined
}

export interface HydratedToolMeta {
  readonly operationId: string
  readonly route: string
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly stage: string
  readonly cliGroup: string
  readonly cliCommand: string
  readonly aliases: string[]
  readonly positionalArgs: HydratedPositionalArgMeta[]
  readonly cliFlags: HydratedCliFlagMeta[]
  readonly readOnly: boolean
  readonly destructive: boolean
  readonly idempotent: boolean
  readonly openWorld: boolean
  readonly dryRunSupport: boolean
  readonly sessionLock: 'none' | 'shared-read' | 'exclusive-file'
  readonly undoSnapshot: boolean
  readonly executionModel:
    | 'single-phase'
    | 'plan-only'
    | 'two-phase-commit'
    | 'two-phase-elicit-commit'
    | 'verification-gate'
    | 'handoff-bridge'
  readonly requiresPreviewBundle: boolean
  readonly requiresHandoffEnvelope: boolean
  readonly mcpToolName: string
  readonly mcpVisibility: 'model' | 'app'
  readonly mcpView?: string | undefined
  readonly resourceUriTemplate?: string | undefined
  readonly reservedInterfaces: string[]
  readonly tableAdapter?: {
    readonly adapterKind: string
    readonly irVersion: string
    readonly preserveFormulas: boolean
    readonly preserveMergedCells: boolean
  } | undefined
}

export interface HydratedToolDefinition<TInput = any, TOutput = any>
  extends ToolDefinition<TInput, CommandOutcome<TOutput>, StandardSchemaWithJson<TInput>> {
  readonly operationId: string
  readonly standardInputSchema: StandardSchemaWithJson<TInput>
  readonly standardOutputSchema?: StandardSchemaWithJson<TOutput> | undefined
  readonly pipelineMeta: HydratedToolMeta
  readonly rawHandler: AnyPipelineToolHandler<TInput, any, TOutput>
}

export interface HydrateToolsOptions {
  /** Base directory for `.cli-anything/{sessions,previews,handoffs}` stores */
  readonly stateDir?: string | undefined
  /** Enforce 1:1 match between spec `operationId`s and `handlers` keys (default: true) */
  readonly strictHandlerParity?: boolean | undefined
  /** Optional custom type guards keyed by schema component name */
  readonly guards?: Record<string, (val: unknown) => boolean> | undefined
}

export interface HydratedOpenApiBundle {
  readonly title: string
  readonly version: string
  readonly reservedInterfaces: string[]
  readonly tools: HydratedToolDefinition[]
  readonly toolsByOperationId: Map<string, HydratedToolDefinition>
  readonly toolsByMcpName: Map<string, HydratedToolDefinition>
  readonly sessionStore: FileSessionStore
  readonly previewStore: PreviewBundleStore
  readonly handoffStore: HandoffEnvelopeStore
  readonly openApiDoc: Record<string, unknown>
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

function extractComponentSchemas(openApiDoc: Record<string, unknown>): Record<string, JsonSchemaObject> {
  const components = openApiDoc.components as Record<string, unknown> | undefined
  const schemas = components?.schemas as Record<string, JsonSchemaObject> | undefined
  return schemas ?? {}
}

function extractOperationInputSchema(
  opObj: Record<string, unknown>,
  components: Record<string, JsonSchemaObject>,
  dryRunSupport: boolean,
): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {}
  const required = new Set<string>()

  // 1. Parameters (path, query, header)
  const parameters = Array.isArray(opObj.parameters) ? opObj.parameters : []
  for (const rawParam of parameters) {
    if (!rawParam || typeof rawParam !== 'object') continue
    const param = rawParam as Record<string, unknown>
    const name = typeof param.name === 'string' ? param.name : undefined
    if (!name) continue
    const paramSchema =
      param.schema && typeof param.schema === 'object'
        ? dereferenceSchema(param.schema as JsonSchemaObject, components)
        : { type: 'string' }
    properties[name] = {
      ...(paramSchema as JsonSchemaProperty),
      ...(typeof param.description === 'string' ? { description: param.description } : {}),
    }
    if (param.required === true) {
      required.add(name)
    }
  }

  // 2. RequestBody JSON Schema
  const requestBody = opObj.requestBody as Record<string, unknown> | undefined
  const content = requestBody?.content as Record<string, unknown> | undefined
  const jsonMedia = content?.['application/json'] as Record<string, unknown> | undefined
  const bodySchemaRaw = jsonMedia?.schema as JsonSchemaObject | undefined

  if (bodySchemaRaw) {
    const derefBody = dereferenceSchema(bodySchemaRaw, components)
    if (derefBody.properties && typeof derefBody.properties === 'object') {
      for (const [propName, propVal] of Object.entries(derefBody.properties)) {
        properties[propName] = propVal
      }
    }
    if (Array.isArray(derefBody.required)) {
      for (const reqKey of derefBody.required) {
        if (typeof reqKey === 'string') required.add(reqKey)
      }
    }
  }

  // 3. Pre-reserve `dryRun?: boolean` when `dryRunSupport` is true
  if (dryRunSupport && !('dryRun' in properties)) {
    properties.dryRun = {
      type: 'boolean',
      description: 'Execute Phase A plan/validation only without mutating disk state (--dry-run)',
      default: false,
    }
  }

  return normalizeJsonSchema(
    {
      type: 'object',
      properties,
      ...(required.size > 0 ? { required: [...required] } : {}),
    },
    components,
  )
}

function extractOperationOutputSchema(
  opObj: Record<string, unknown>,
  components: Record<string, JsonSchemaObject>,
): JsonSchemaObject | undefined {
  const responses = opObj.responses as Record<string, unknown> | undefined
  if (!responses) return undefined
  const successResp = (responses['200'] ?? responses['201'] ?? responses.default) as
    | Record<string, unknown>
    | undefined
  if (!successResp) return undefined
  const content = successResp.content as Record<string, unknown> | undefined
  const jsonMedia = content?.['application/json'] as Record<string, unknown> | undefined
  const schemaRaw = jsonMedia?.schema as JsonSchemaObject | undefined
  if (!schemaRaw) return undefined
  return normalizeJsonSchema(dereferenceSchema(schemaRaw, components), components)
}

function extractPositionalAndFlagMeta(
  inputSchema: JsonSchemaObject,
  explicitPositionalNames: string[],
): {
  positionalArgs: HydratedPositionalArgMeta[]
  cliFlags: HydratedCliFlagMeta[]
} {
  const props = inputSchema.properties ?? {}
  const requiredSet = new Set(inputSchema.required ?? [])
  const positionalMap = new Map<string, HydratedPositionalArgMeta>()

  // 1. Explicit positionalArgs array on `@oaTool` / `@pipeline*`
  explicitPositionalNames.forEach((name, idx) => {
    const prop = props[name]
    positionalMap.set(name, {
      name,
      order: idx,
      required: requiredSet.has(name),
      ...(typeof prop?.description === 'string' ? { description: prop.description } : {}),
    })
  })

  // 2. Property-level `@positional(order)` (`x-oa-sdk-positional`)
  for (const [propName, propVal] of Object.entries(props)) {
    const posExt = propVal?.['x-oa-sdk-positional'] as { order?: number } | undefined
    if (posExt && typeof posExt.order === 'number') {
      positionalMap.set(propName, {
        name: propName,
        order: posExt.order,
        required: requiredSet.has(propName),
        ...(typeof propVal.description === 'string' ? { description: propVal.description } : {}),
      })
    }
  }

  const positionalArgs = [...positionalMap.values()].sort((a, b) => a.order - b.order)

  const cliFlags: HydratedCliFlagMeta[] = []
  for (const [propName, propVal] of Object.entries(props)) {
    const flagExt = propVal?.['x-oa-sdk-cli-flag'] as
      | { short?: string; env?: string; negatable?: boolean; placeholder?: string }
      | undefined
    const rawType = Array.isArray(propVal?.type) ? propVal.type[0] : propVal?.type
    cliFlags.push({
      propertyName: propName,
      flagName: toKebabCase(propName),
      ...(flagExt?.short ? { short: flagExt.short } : {}),
      ...(flagExt?.env ? { env: flagExt.env } : {}),
      ...(flagExt?.negatable !== undefined ? { negatable: flagExt.negatable } : {}),
      ...(flagExt?.placeholder ? { placeholder: flagExt.placeholder } : {}),
      type: typeof rawType === 'string' ? rawType : 'string',
      required: requiredSet.has(propName) && !positionalMap.has(propName),
      ...(typeof propVal?.description === 'string' ? { description: propVal.description } : {}),
      ...(propVal?.default !== undefined ? { default: propVal.default } : {}),
    })
  }

  return { positionalArgs, cliFlags }
}

/**
 * Hydrates executable `HydratedToolDefinition[]` and `R1~R5` stores from a single
 * compiled OpenAPI 3.1/3.2 document + a map of pure `operationId` handlers.
 */
export function hydrateToolsFromOpenApi(
  openApiDoc: Record<string, unknown>,
  handlers: Record<string, AnyPipelineToolHandler>,
  options?: HydrateToolsOptions,
): HydratedOpenApiBundle {
  const strictHandlerParity = options?.strictHandlerParity ?? true
  const stateDir = options?.stateDir ?? process.cwd()
  const sessionStore = new FileSessionStore(stateDir)
  const previewStore = new PreviewBundleStore(stateDir)
  const handoffStore = new HandoffEnvelopeStore(stateDir)

  const info = (openApiDoc.info as Record<string, unknown> | undefined) ?? {}
  const title = typeof info.title === 'string' ? info.title : 'CLI-Anything × mcp-use Service'
  const version = typeof info.version === 'string' ? info.version : '1.0.0'

  const components = extractComponentSchemas(openApiDoc)
  const paths = (openApiDoc.paths as Record<string, unknown> | undefined) ?? {}

  const globalReservedRaw = openApiDoc['x-oa-sdk-reserved-interfaces'] as
    | { interfaces?: string[] }
    | undefined
  const reservedSet = new Set<string>(
    globalReservedRaw?.interfaces ?? [
      'session',
      'dry-run-elicit',
      'preview-bundle',
      'handoff-envelope',
      'sep-2640-skills',
    ],
  )

  const discoveredOperationIds = new Set<string>()
  const tools: HydratedToolDefinition[] = []
  const toolsByOperationId = new Map<string, HydratedToolDefinition>()
  const toolsByMcpName = new Map<string, HydratedToolDefinition>()

  for (const [route, pathItemRaw] of Object.entries(paths)) {
    if (!pathItemRaw || typeof pathItemRaw !== 'object') continue
    const pathItem = pathItemRaw as Record<string, unknown>

    for (const methodKey of HTTP_METHODS) {
      const opRaw = pathItem[methodKey]
      if (!opRaw || typeof opRaw !== 'object') continue
      const opObj = opRaw as Record<string, unknown>

      const operationId =
        typeof opObj.operationId === 'string'
          ? opObj.operationId
          : `${methodKey}_${route.replace(/[^a-zA-Z0-9]/g, '_')}`

      const toolExt = (opObj['x-oa-sdk-tool'] ?? opObj['x-oa-tool']) as
        | Record<string, unknown>
        | undefined
      if (!toolExt) continue

      discoveredOperationIds.add(operationId)
      const rawHandler = handlers[operationId]
      if (!rawHandler) {
        if (strictHandlerParity) {
          throw new Error(
            `[Spec-Handler Drift] Missing handler for operationId "${operationId}" declared in OpenAPI spec at ${methodKey.toUpperCase()} ${route}.`,
          )
        }
        continue
      }

      const opReserved = opObj['x-oa-sdk-reserved-interfaces'] as
        | { interfaces?: string[] }
        | undefined
      if (Array.isArray(opReserved?.interfaces)) {
        for (const iface of opReserved.interfaces) {
          reservedSet.add(iface)
        }
      }

      const stage = typeof toolExt.stage === 'string' ? toolExt.stage : 'inspect'
      const cliGroup = typeof toolExt.cliGroup === 'string' ? toolExt.cliGroup : 'default'
      const cliCommand =
        typeof toolExt.cliCommand === 'string' ? toolExt.cliCommand : toKebabCase(operationId)
      const aliases = Array.isArray(toolExt.aliases)
        ? toolExt.aliases.filter((a): a is string => typeof a === 'string')
        : []
      const explicitPositionals = Array.isArray(toolExt.positionalArgs)
        ? toolExt.positionalArgs.filter((a): a is string => typeof a === 'string')
        : []

      const readOnly = typeof toolExt.readOnly === 'boolean' ? toolExt.readOnly : stage === 'inspect'
      const destructive = typeof toolExt.destructive === 'boolean' ? toolExt.destructive : false
      const idempotent = typeof toolExt.idempotent === 'boolean' ? toolExt.idempotent : true
      const openWorld = typeof toolExt.openWorld === 'boolean' ? toolExt.openWorld : false
      const dryRunSupport =
        typeof toolExt.dryRunSupport === 'boolean' ? toolExt.dryRunSupport : !readOnly
      const sessionLock = (
        typeof toolExt.sessionLock === 'string'
          ? toolExt.sessionLock
          : readOnly
            ? 'none'
            : 'exclusive-file'
      ) as HydratedToolMeta['sessionLock']
      const undoSnapshot =
        typeof toolExt.undoSnapshot === 'boolean' ? toolExt.undoSnapshot : !readOnly
      const executionModel = (
        typeof toolExt.executionModel === 'string'
          ? toolExt.executionModel
          : readOnly
            ? 'single-phase'
            : destructive
              ? 'two-phase-elicit-commit'
              : 'two-phase-commit'
      ) as HydratedToolMeta['executionModel']
      const requiresPreviewBundle =
        typeof toolExt.requiresPreviewBundle === 'boolean' ? toolExt.requiresPreviewBundle : false
      const requiresHandoffEnvelope =
        typeof toolExt.requiresHandoffEnvelope === 'boolean'
          ? toolExt.requiresHandoffEnvelope
          : false

      const surfaceExt = opObj['x-oa-sdk-mcp-surface'] as
        | { view?: string; visibility?: 'model' | 'app'; resourceUriTemplate?: string }
        | undefined
      const mcpToolName =
        typeof toolExt.mcpToolName === 'string' && toolExt.mcpToolName.length > 0
          ? toolExt.mcpToolName
          : `${cliGroup.replace(/-/g, '_')}_${cliCommand.replace(/-/g, '_')}`
      const mcpVisibility = (surfaceExt?.visibility ??
        (toolExt.mcpVisibility === 'app' ? 'app' : 'model')) as 'model' | 'app'
      const mcpView =
        surfaceExt?.view ?? (typeof toolExt.mcpView === 'string' ? toolExt.mcpView : undefined)
      const resourceUriTemplate =
        surfaceExt?.resourceUriTemplate ??
        (typeof toolExt.resourceUriTemplate === 'string'
          ? toolExt.resourceUriTemplate
          : undefined)

      const tableAdapterExt = opObj['x-oa-sdk-table-adapter'] as
        | {
            adapterKind: string
            irVersion?: string
            preserveFormulas?: boolean
            preserveMergedCells?: boolean
          }
        | undefined

      const inputJsonSchema = extractOperationInputSchema(opObj, components, dryRunSupport)
      if (executionModel === 'two-phase-elicit-commit') {
        inputJsonSchema.properties = {
          ...inputJsonSchema.properties,
          confirm: {
            type: 'boolean',
            description: 'Explicitly confirm this destructive operation when interactive confirmation is unavailable',
            default: false,
          },
        }
      }
      const outputJsonSchema = extractOperationOutputSchema(opObj, components)
      const { positionalArgs, cliFlags } = extractPositionalAndFlagMeta(
        inputJsonSchema,
        explicitPositionals,
      )

      const standardInputSchema = toStandardSchemaWithJson(inputJsonSchema, components)
      const standardOutputSchema = outputJsonSchema
        ? toStandardSchemaWithJson(outputJsonSchema, components)
        : undefined

      const description =
        (typeof opObj.description === 'string' && opObj.description) ||
        (typeof opObj.summary === 'string' && opObj.summary) ||
        `${cliGroup} ${cliCommand} (${operationId})`

      const pipelineMeta: HydratedToolMeta = {
        operationId,
        route,
        method: methodKey.toUpperCase() as HydratedToolMeta['method'],
        stage,
        cliGroup,
        cliCommand,
        aliases,
        positionalArgs,
        cliFlags,
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
        ...(resourceUriTemplate ? { resourceUriTemplate } : {}),
        reservedInterfaces: [...reservedSet],
        ...(tableAdapterExt
          ? {
              tableAdapter: {
                adapterKind: tableAdapterExt.adapterKind,
                irVersion: tableAdapterExt.irVersion ?? 'unified-table-ir/v1',
                preserveFormulas: tableAdapterExt.preserveFormulas ?? true,
                preserveMergedCells: tableAdapterExt.preserveMergedCells ?? true,
              },
            }
          : {}),
      }

      const execute = async (
        ctx: ElicitationContext,
        rawInput: Record<string, unknown>,
      ): Promise<CommandOutcome<any>> => {
        const input = (rawInput ?? {}) as Record<string, unknown>
        const isDryRun =
          Boolean(input.dryRun) ||
          Boolean(ctx.meta?.dryRun) ||
          pipelineMeta.executionModel === 'plan-only'
        const projectId =
          (typeof input.projectId === 'string' && input.projectId) ||
          (typeof input.projectPath === 'string' && input.projectPath) ||
          (typeof ctx.meta?.projectId === 'string' && ctx.meta.projectId) ||
          'default'

        // Confirmation is mandatory for this execution model on every surface,
        // including hosts without elicitation support and single-phase handlers.
        const confirmMutation = async (plan?: unknown): Promise<CommandOutcome<any> | undefined> => {
          if (pipelineMeta.executionModel !== 'two-phase-elicit-commit' || isDryRun || input.confirm === true) {
            return undefined
          }
          const response = typeof ctx.elicit === 'function'
            ? await ctx.elicit(
                `confirm_${operationId}`,
                `Confirm destructive operation "${cliGroup} ${cliCommand}" on project "${projectId}"?`,
                {
                  type: 'object',
                  properties: { confirm: { type: 'boolean', default: false } },
                  required: ['confirm'],
                },
              )
            : undefined
          if (response?.action === 'accept' && response.data?.confirm === true) return undefined
          return {
            data: { cancelled: true, ...(plan !== undefined ? { plan } : {}) },
            summary: `Confirmation required for destructive operation ${cliGroup} ${cliCommand}; use confirm=true or accept the confirmation prompt`,
            passed: false,
            meta: { cancelled: true, confirmationRequired: true, operationId },
          }
        }

        const commitWithSession = async (
          commit: () => Promise<CommandOutcome<any>>,
          captureState?: () => Promise<Record<string, unknown>>,
        ): Promise<CommandOutcome<any>> => {
          const exclusive = !isDryRun && pipelineMeta.sessionLock === 'exclusive-file'
          if (!isDryRun && pipelineMeta.undoSnapshot && !pipelineMeta.readOnly) {
            const run = async () => {
              const beforeState = captureState ? await captureState() : undefined
              const result = await commit()
              const afterState = captureState
                ? await captureState()
                : (typeof result.data === 'object' && result.data !== null
                    ? result.data as Record<string, unknown>
                    : { value: result.data })
              const mutation: SessionMutationInput = {
                operationId,
                summary: result.summary ?? `${cliGroup} ${cliCommand}`,
                ...(beforeState ? { beforeState } : {}),
                afterState,
              }
              return { result, mutation }
            }
            if (exclusive) return sessionStore.commitMutation(projectId, run)
            const { result, mutation } = await run()
            await sessionStore.recordMutation(projectId, mutation)
            return result
          }
          return exclusive ? sessionStore.withProjectLock(projectId, commit) : commit()
        }

        let outcome: CommandOutcome<any>

        if (isTwoPhaseMutationHandler(rawHandler)) {
          // Phase A: Pure plan computation (0 disk writes, safe across dry-run & ctx.elicit re-runs)
          const planned = await rawHandler.plan(ctx, input)
          if (isDryRun) {
            const normalizedPlan = normalizeCommandOutcome(
              planned,
              `[DRY-RUN] Planned ${cliGroup} ${cliCommand} for ${projectId}`,
            )
            const dryRunPreview: PreviewBundleV1 =
              normalizedPlan.previewBundle ?? {
                schemaVersion: 'preview-bundle/v1',
                bundleId: `preview_${operationId}_${randomUUID().slice(0, 8)}`,
                software: cliGroup,
                recipe: cliCommand,
                createdAt: new Date().toISOString(),
                summary: {
                  title: `Dry-Run Plan: ${cliGroup} ${cliCommand}`,
                  status: 'dry-run',
                  highlights: [normalizedPlan.summary ?? 'Plan computed with 0 disk mutations'],
                },
                artifacts: [
                  {
                    name: 'plan.json',
                    kind: 'json',
                    mimeType: 'application/json',
                    content: JSON.stringify(normalizedPlan.data, null, 2),
                  },
                ],
              }
            previewStore.writeBundle(dryRunPreview)
            return {
              ...normalizedPlan,
              previewBundle: dryRunPreview,
              meta: {
                ...(normalizedPlan.meta ?? {}),
                dryRun: true,
                stage: 'plan',
                operationId,
              },
            }
          }

          const cancelled = await confirmMutation(isCommandOutcome(planned) ? planned.data : planned)
          if (cancelled) return cancelled

          // Capture, commit and snapshot share a single project lock acquisition.
          outcome = await commitWithSession(async () => {
            const rawCommitted = await rawHandler.commit(
              ctx,
              input,
              isCommandOutcome(planned) ? planned.data : planned,
            )
            return normalizeCommandOutcome(rawCommitted, `Executed ${cliGroup} ${cliCommand}`)
          }, rawHandler.captureState ? () => rawHandler.captureState!(ctx, input) : undefined)
        } else {
          const cancelled = await confirmMutation()
          if (cancelled) return cancelled
          // Single-phase handlers receive the same locking and snapshot boundary.
          const execCtx: ElicitationContext = {
            ...ctx,
            meta: { ...(ctx.meta ?? {}), dryRun: isDryRun, projectId, operationId },
          }
          outcome = await commitWithSession(async () => {
            const res = await rawHandler(execCtx, input)
            return normalizeCommandOutcome(res, `Executed ${cliGroup} ${cliCommand}`)
          })
        }

        // Persist preview-bundle/v1 if present or required (R3)
        let previewBundle = outcome.previewBundle
        if (!previewBundle && pipelineMeta.requiresPreviewBundle) {
          previewBundle = {
            schemaVersion: 'preview-bundle/v1',
            bundleId: `preview_${operationId}_${randomUUID().slice(0, 8)}`,
            software: cliGroup,
            recipe: cliCommand,
            createdAt: new Date().toISOString(),
            summary: {
              title: `${cliGroup} ${cliCommand}`,
              status: isDryRun ? 'dry-run' : 'ready',
              highlights: [outcome.summary ?? `Completed ${operationId}`],
            },
            artifacts: [
              {
                name: 'result.json',
                kind: 'json',
                mimeType: 'application/json',
                content: JSON.stringify(outcome.data, null, 2),
              },
            ],
          }
        }
        if (previewBundle) {
          previewStore.writeBundle(previewBundle)
        }

        // Persist handoff-envelope/v1 if present or required (R4)
        let handoffEnvelope = outcome.handoffEnvelope
        if (!handoffEnvelope && pipelineMeta.requiresHandoffEnvelope) {
          handoffEnvelope = {
            schemaVersion: 'cli-anything-handoff-envelope/v1',
            handoffId: `handoff_${operationId}_${randomUUID().slice(0, 8)}`,
            createdAt: new Date().toISOString(),
            sourceStage: (ctx.meta?.surface === 'mcp' ? 'stage-2-mcp' : 'stage-1-cli') as HandoffEnvelopeV1['sourceStage'],
            targetStage: (ctx.meta?.surface === 'mcp' ? 'stage-1-cli' : 'stage-2-mcp') as HandoffEnvelopeV1['targetStage'],
            operationId,
            projectId,
            projectPath: stateDir,
            fingerprint: computeCanonicalSha256(outcome.data),
            status: isDryRun ? 'dry-run-planned' : 'completed',
            summary: outcome.summary ?? `Handoff from ${operationId}`,
            ...(previewBundle ? { previewBundleId: previewBundle.bundleId } : {}),
            suggestedNextTools: [],
            payload:
              typeof outcome.data === 'object' && outcome.data !== null
                ? (outcome.data as Record<string, unknown>)
                : { result: outcome.data },
          }
        }
        if (handoffEnvelope) {
          handoffStore.writeEnvelope(handoffEnvelope)
        }

        return {
          ...outcome,
          ...(previewBundle ? { previewBundle } : {}),
          ...(handoffEnvelope ? { handoffEnvelope } : {}),
          meta: {
            ...(outcome.meta ?? {}),
            operationId,
            stage: pipelineMeta.stage,
            dryRun: isDryRun,
            fingerprint: computeCanonicalSha256(outcome.data),
          },
        }
      }

      const hydratedTool: HydratedToolDefinition = {
        name: mcpToolName,
        operationId,
        description,
        category: cliGroup,
        inputSchema: standardInputSchema,
        ...(standardOutputSchema ? { outputSchema: standardOutputSchema } : {}),
        standardInputSchema,
        ...(standardOutputSchema ? { standardOutputSchema } : {}),
        execute,
        rawHandler,
        pipelineMeta,
        hints: {
          readOnly,
          destructive,
          idempotent,
          hidden: mcpVisibility === 'app',
        },
        cli: {
          command: cliCommand,
          aliases,
          arguments: positionalArgs.map(pos => ({
            name: pos.name,
            required: pos.required,
            ...(pos.description ? { description: pos.description } : {}),
          })),
        },
        api: {
          method: pipelineMeta.method,
          path: route,
          tags: [cliGroup],
        },
        mcp: {
          toolName: mcpToolName,
          annotations: {
            readOnly,
            destructive,
            idempotent,
            openWorld,
          },
        },
      }

      tools.push(hydratedTool)
      toolsByOperationId.set(operationId, hydratedTool)
      toolsByMcpName.set(mcpToolName, hydratedTool)
    }
  }

  if (strictHandlerParity) {
    for (const handlerKey of Object.keys(handlers)) {
      if (!discoveredOperationIds.has(handlerKey)) {
        throw new Error(
          `[Spec-Handler Drift] Handler "${handlerKey}" is not declared in the OpenAPI specification.`,
        )
      }
    }
  }

  return {
    title,
    version,
    reservedInterfaces: [...reservedSet],
    tools,
    toolsByOperationId,
    toolsByMcpName,
    sessionStore,
    previewStore,
    handoffStore,
    openApiDoc,
  }
}

function isCommandOutcome(value: unknown): value is CommandOutcome<any> {
  return typeof value === 'object' && value !== null && 'data' in value && !Array.isArray(value)
}

/**
 * Generates synchronized CLI Command & MCP Tool Markdown tables directly from the
 * hydrated OpenAPI specification so `SKILL.md` never drifts from `.tsp` SSOT.
 */
export function generateSkillMarkdownFromSpec(
  bundleOrSpec: HydratedOpenApiBundle | Record<string, unknown>,
  options?: { readonly binName?: string | undefined; readonly includeMcpTable?: boolean | undefined },
): string {
  const binName = options?.binName ?? 'skills-platform'
  const includeMcpTable = options?.includeMcpTable ?? true

  const bundle: HydratedOpenApiBundle =
    'tools' in bundleOrSpec && Array.isArray((bundleOrSpec as HydratedOpenApiBundle).tools)
      ? (bundleOrSpec as HydratedOpenApiBundle)
      : hydrateToolsFromOpenApi(bundleOrSpec as Record<string, unknown>, {}, { strictHandlerParity: false })

  const lines: string[] = []
  lines.push(`### Stage 1 CLI Commands (\`${binName}\`)`)
  lines.push('')
  lines.push('| Group | Command | Positional Args | Key Flags | Stage | Dry-Run | Description |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')

  for (const tool of bundle.tools) {
    const meta = tool.pipelineMeta
    const posStr =
      meta.positionalArgs.length > 0
        ? meta.positionalArgs.map(p => (p.required ? `<${p.name}>` : `[${p.name}]`)).join(' ')
        : '—'
    const flagStr =
      meta.cliFlags
        .filter(f => !meta.positionalArgs.some(p => p.name === f.propertyName))
        .map(f => `--${f.flagName}${f.short ? ` (-${f.short})` : ''}`)
        .join(', ') || '—'
    lines.push(
      `| \`${meta.cliGroup}\` | \`${binName} ${meta.cliGroup} ${meta.cliCommand}\` | \`${posStr}\` | ${flagStr} | \`${meta.stage}\` | ${meta.dryRunSupport ? 'Yes (`--dry-run`)' : 'No'} | ${tool.description} |`,
    )
  }

  if (includeMcpTable) {
    lines.push('')
    lines.push('### Stage 2 MCP Tools (`mcp-use` v2)')
    lines.push('')
    lines.push('| MCP Tool Name | Operation ID | Stage | Execution Model | Hints (`RO/Dest/Idem`) | Visibility / View |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const tool of bundle.tools) {
      const meta = tool.pipelineMeta
      const hints = `RO:${meta.readOnly} / D:${meta.destructive} / I:${meta.idempotent}`
      const viewInfo = meta.mcpView ? `${meta.mcpVisibility} (\`${meta.mcpView}\`)` : meta.mcpVisibility
      lines.push(
        `| \`${meta.mcpToolName}\` | \`${meta.operationId}\` | \`${meta.stage}\` | \`${meta.executionModel}\` | \`${hints}\` | ${viewInfo} |`,
      )
    }
  }

  return lines.join('\n')
}

/**
 * Mechanically generates a comprehensive, zero-drift Reference Manual (Markdown)
 * from a `.tsp`-emitted OpenAPI 3.2 specification or `HydratedOpenApiBundle`.
 */
export function generateHarnessManualFromSpec(
  bundleOrSpec: HydratedOpenApiBundle | Record<string, unknown>,
  options?: { readonly binName?: string | undefined },
): string {
  const binName = options?.binName ?? 'skills-platform'
  const bundle: HydratedOpenApiBundle =
    'tools' in bundleOrSpec && Array.isArray((bundleOrSpec as HydratedOpenApiBundle).tools)
      ? (bundleOrSpec as HydratedOpenApiBundle)
      : hydrateToolsFromOpenApi(
          bundleOrSpec as Record<string, unknown>,
          {},
          { strictHandlerParity: false },
        )

  const groupsMap = new Map<string, HydratedToolDefinition[]>()
  const stageCounts = new Map<string, number>()
  let hasTableAdapter = false

  for (const tool of bundle.tools) {
    const meta = tool.pipelineMeta
    stageCounts.set(meta.stage, (stageCounts.get(meta.stage) ?? 0) + 1)
    if (meta.tableAdapter) hasTableAdapter = true
    if (!groupsMap.has(meta.cliGroup)) {
      groupsMap.set(meta.cliGroup, [])
    }
    groupsMap.get(meta.cliGroup)!.push(tool)
  }

  const stageSummaryParts = [...stageCounts.entries()]
    .map(([stg, count]) => `\`${stg}\` (${count})`)
    .join(', ')

  const groupNodesMermaid = [...groupsMap.entries()]
    .map(([grp, items], idx) => `    G${idx}["${binName} ${grp} (${items.length} cmds)"]`)
    .join('\n')
  const groupEdgesMermaid = [...groupsMap.keys()]
    .map((_, idx) => `    TSP --> G${idx}\n    G${idx} --> ENV`)
    .join('\n')

  const cliGroupSections: string[] = []
  for (const [cliGroup, groupTools] of groupsMap.entries()) {
    const cmdBlocks: string[] = []
    for (const tool of groupTools) {
      const meta = tool.pipelineMeta
      const posParts = meta.positionalArgs.map(p => (p.required ? `<${p.name}>` : `[${p.name}]`))
      const flagParts = meta.cliFlags
        .filter(f => !meta.positionalArgs.some(p => p.name === f.propertyName))
        .map(f => {
          const shortPrefix = f.short ? `-${f.short}|` : ''
          const ph = f.placeholder || `<${f.propertyName}>`
          const token = `${shortPrefix}--${f.flagName} ${ph}`
          return f.required ? token : `[${token}]`
        })
      const synopsis = [
        `${binName} ${meta.cliGroup} ${meta.cliCommand}`,
        ...posParts,
        ...flagParts,
        ...(meta.dryRunSupport ? ['[--dry-run]'] : []),
        '[--json]',
      ].join(' ')

      const paramRows: string[] = []
      for (const p of meta.positionalArgs) {
        const matchedFlag = meta.cliFlags.find(f => f.propertyName === p.name)
        paramRows.push(
          `| \`${p.name}\` (${p.required ? '**required**' : 'optional'}) | \`Pos #${p.order}\` | \`${matchedFlag?.type ?? 'string'}\` | ${p.description || matchedFlag?.description || '—'} |`,
        )
      }
      for (const f of meta.cliFlags) {
        if (meta.positionalArgs.some(p => p.name === f.propertyName)) continue
        const flagLabel = f.short
          ? `\`-${f.short}, --${f.flagName}\``
          : `\`--${f.flagName}\``
        paramRows.push(
          `| \`${f.propertyName}\` (${f.required ? '**required**' : 'optional'}) | ${flagLabel} | \`${f.type}\` | ${f.description || '—'} |`,
        )
      }

      cmdBlocks.push(
        [
          `#### \`${binName} ${meta.cliGroup} ${meta.cliCommand}\` (\`${meta.operationId}\`)`,
          '',
          `> **Endpoint**: \`${meta.method} ${meta.route}\` · **Stage**: \`${meta.stage.toUpperCase()}\` · **Execution**: \`${meta.executionModel}\` · **Lock**: \`${meta.sessionLock}\``,
          '',
          tool.description,
          '',
          '| Surface | Binding & Governance Metadata |',
          '| --- | --- |',
          `| **Stage 1 CLI** | \`${synopsis}\` |`,
          `| **Stage 2 MCP** | \`${meta.mcpToolName}\` · View: \`${meta.mcpView || 'none'}\` (\`${meta.mcpVisibility}\`) · Hints: \`RO:${meta.readOnly} / D:${meta.destructive} / I:${meta.idempotent}\` |`,
          `| **Safety & State** | Dry-Run: \`${meta.dryRunSupport ? 'Yes (--dry-run)' : 'No'}\` · R1 Undo Snapshot: \`${meta.undoSnapshot ? 'Recorded' : 'None'}\` |`,
          ...(paramRows.length > 0
            ? [
                '',
                '**Request Parameters (`application/json` & CLI Flags)**',
                '',
                '| Parameter | CLI Binding | Type | Description |',
                '| --- | --- | --- | --- |',
                ...paramRows,
              ]
            : []),
        ].join('\n'),
      )
    }
    cliGroupSections.push([`### Group: \`${cliGroup}\``, '', ...cmdBlocks].join('\n\n---\n\n'))
  }

  const mcpToolRows = bundle.tools.map(tool => {
    const meta = tool.pipelineMeta
    return `| \`${meta.mcpToolName}\` | \`${meta.method} ${meta.route}\` (\`${meta.operationId}\`) | \`${meta.stage}\` | \`${meta.executionModel}\` | \`RO:${meta.readOnly} / D:${meta.destructive} / I:${meta.idempotent}\` |`
  })

  return [
    `# ${bundle.title} — API & Dual-Surface Technical Specification (v${bundle.version})`,
    '',
    `> [!NOTE]`,
    `> **Single-Point \`.tsp\` SSOT Technical Specification**: Mechanically synthesized from the OpenAPI 3.2 contract.`,
    '',
    '## 1. Contract Identity & Pipeline Overview',
    '',
    '| Specification Field | Value |',
    '| --- | --- |',
    `| **Service Title** | \`${bundle.title}\` |`,
    `| **Contract Version** | \`${bundle.version}\` |`,
    `| **CLI Binary** | \`${binName}\` |`,
    `| **Domain Operations** | **${bundle.tools.length}** endpoints across **${groupsMap.size}** \`@toolGroup\` groups |`,
    `| **Stage Distribution** | ${stageSummaryParts} |`,
    `| **Reserved MCP Interfaces** | ${bundle.reservedInterfaces.map(i => `\`${i}\``).join(', ')} |`,
    '',
    '```mermaid',
    'flowchart LR',
    '    TSP["Single-Point .tsp SSOT"]',
    ...groupNodesMermaid.split('\n'),
    '    ENV["Handoff Artifacts<br/>preview-bundle/v1 & handoff-envelope/v1"]',
    '    MCP["Stage 2 mcp-use v2 Server"]',
    ...groupEdgesMermaid.split('\n'),
    '    ENV --> MCP',
    '```',
    '',
    '---',
    '',
    '## 2. Quick Lookup Matrix (Stage 1 CLI & Stage 2 MCP)',
    '',
    generateSkillMarkdownFromSpec(bundle, { binName }),
    '',
    '---',
    '',
    '## 3. Stage 1 CLI Command Reference Manual',
    '',
    ...cliGroupSections,
    '',
    '---',
    '',
    '## 4. Stage 2 `mcp-use` v2 Tool & Schema Reference',
    '',
    '| MCP Tool Name | HTTP Route (`operationId`) | Stage | Execution Model | MCP Annotations |',
    '| --- | --- | --- | --- | --- |',
    ...mcpToolRows,
    ...(hasTableAdapter
      ? [
          '',
          '---',
          '',
          '## 5. 6-Type Document Standard Table Adapter (`UnifiedTableIR`) Specification',
          '',
          'Supports `calc` (`.xlsx`), `writer` (`.docx`), `impress` (`.pptx`), `markdown` (`.md`), `tabular-ops` (`.csv`/`.tsv`), and `visual-dom` (`.html`/`.svg`) with 0-based `tableIndex` selection and in-place context preservation.',
        ]
      : []),
  ].join('\n')
}
