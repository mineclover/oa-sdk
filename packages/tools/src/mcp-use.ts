/**
 * @oa-sdk/tools — Stage 2 `mcp-use` v2 Server Binder (`registerToolsOnMcpUse`)
 *
 * Binds a `HydratedOpenApiBundle` onto an `mcp-use` v2 `MCPServer` (or compatible host),
 * automatically wiring:
 * - Both `schema` (`inputSchema`) and `outputSchema` via `StandardSchemaWithJson` (`~standard` v1)
 * - `*Hint` annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
 * - `{ content, structuredContent, _meta }` output envelope
 * - The 5 CLI-Anything-governed Reserved MCP Interfaces (`R1`~`R5`: `session_*`, `dryRun/elicit`,
 *   `preview_*`, `handoff_*`, and SEP-2640 `skills_*` / `SkillsSnapshot`).
 */
import { createToolContext } from './context.js'
import {
  generateSkillMarkdownFromSpec,
  type HydratedOpenApiBundle,
  type HydratedToolDefinition,
} from './openapi-hydrator.js'
import {
  buildMcpUseSkillsSnapshot,
  type ElicitationContext,
  isTwoPhaseMutationHandler,
  type SessionSnapshotEntry,
  type SessionStateRestorer,
  type Sep2640SkillsSnapshot,
} from './reserved-interfaces.js'
import { toStandardSchemaWithJson, type StandardSchemaWithJson } from './standard-schema.js'

export { buildMcpUseSkillsSnapshot, generateSkillMarkdownFromSpec }

export interface McpUseToolRegistrationDefinition {
  readonly name: string
  readonly title?: string | undefined
  readonly description: string
  readonly schema: StandardSchemaWithJson<any>
  readonly outputSchema?: StandardSchemaWithJson<any> | undefined
  readonly annotations?: {
    readonly readOnlyHint?: boolean | undefined
    readonly destructiveHint?: boolean | undefined
    readonly idempotentHint?: boolean | undefined
    readonly openWorldHint?: boolean | undefined
  } | undefined
  readonly view?: { readonly name: string; readonly [key: string]: unknown } | undefined
  readonly visibility?: 'model' | 'app' | undefined
  readonly _meta?: Record<string, unknown> | undefined
}

export interface McpUseCallToolResponse<TStructured = unknown> {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>
  readonly structuredContent?: TStructured | undefined
  readonly isError?: boolean | undefined
  readonly _meta?: Record<string, unknown> | undefined
}

export type McpUseToolCallback = (
  input: Record<string, unknown>,
  ctx?: Record<string, unknown>,
) => Promise<McpUseCallToolResponse<any>>

export interface McpUseLikeServer {
  tool(definition: McpUseToolRegistrationDefinition, callback: McpUseToolCallback): unknown
  resourceTemplate?(
    definition: {
      name: string
      uriTemplate: string
      mimeType?: string
      description?: string
    },
    callback: (uri: URL, params: Record<string, string>) => Promise<unknown>,
  ): unknown
}

export interface RegisterMcpUseOptions {
  /** Optional directory or directories of `SKILL.md` packages to expose via SEP-2640 (`R5`) */
  readonly skillDirs?: string | string[] | undefined
  /** Optional surface manifest overriding `view` / `visibility` per `operationId` */
  readonly surfaceOverrides?: Record<
    string,
    {
      readonly view?: string | { readonly name: string; readonly [key: string]: unknown }
      readonly visibility?: 'model' | 'app'
    }
  > | undefined
  /** Include the R1~R5 reserved tools (`session_*`, `preview_inspect`, `handoff_*`, `skills_*`) (default: true) */
  readonly includeReservedTools?: boolean | undefined
}

export interface RegisteredMcpUseSurface {
  readonly registeredTools: Map<
    string,
    {
      readonly definition: McpUseToolRegistrationDefinition
      readonly callback: McpUseToolCallback
    }
  >
  readonly registeredResourceTemplates: string[]
  readonly skillsSnapshot?: Sep2640SkillsSnapshot | undefined
  invokeTool(
    toolName: string,
    input?: Record<string, unknown>,
    ctx?: Record<string, unknown>,
  ): Promise<McpUseCallToolResponse<any>>
}

function registerSingleTool(
  server: McpUseLikeServer,
  registeredTools: Map<
    string,
    { definition: McpUseToolRegistrationDefinition; callback: McpUseToolCallback }
  >,
  definition: McpUseToolRegistrationDefinition,
  callback: McpUseToolCallback,
): void {
  registeredTools.set(definition.name, { definition, callback })
  server.tool(definition, callback)
}

function createMcpSessionRestorer(
  bundle: HydratedOpenApiBundle,
  projectId: string,
  rawMcpCtx: Record<string, unknown> | undefined,
): SessionStateRestorer {
  return async (snapshot: SessionSnapshotEntry, targetState: Record<string, unknown>) => {
    const tool = bundle.toolsByOperationId.get(snapshot.operationId)
    const handler = tool?.rawHandler
    if (!handler || !isTwoPhaseMutationHandler(handler) || typeof handler.restoreState !== 'function') {
      throw new Error(
        `Cannot restore session snapshot "${snapshot.snapshotId}": operation "${snapshot.operationId}" does not expose restoreState`,
      )
    }
    const baseCtx = createToolContext({
      meta: {
        surface: 'mcp',
        projectId,
        operationId: snapshot.operationId,
        sessionAction: 'restore',
        ...(rawMcpCtx ? { mcpContext: rawMcpCtx } : {}),
      },
    })
    const elicitFn = rawMcpCtx && typeof rawMcpCtx.elicit === 'function'
      ? (rawMcpCtx.elicit as ElicitationContext['elicit'])
      : undefined
    const ctx: ElicitationContext = {
      ...baseCtx,
      ...(elicitFn ? { elicit: elicitFn } : {}),
    }
    await handler.restoreState(ctx, projectId, targetState)
  }
}

/**
 * Registers all hydrated domain tools and `R1`~`R5` reserved interfaces onto an
 * `mcp-use` v2 `MCPServer` instance.
 */
export function registerToolsOnMcpUse(
  server: McpUseLikeServer,
  bundle: HydratedOpenApiBundle,
  options?: RegisterMcpUseOptions,
): RegisteredMcpUseSurface {
  const registeredTools = new Map<
    string,
    { definition: McpUseToolRegistrationDefinition; callback: McpUseToolCallback }
  >()
  const registeredResourceTemplates: string[] = []
  const includeReservedTools = options?.includeReservedTools ?? true

  // 1. Register Hydrated Domain Tools from `.tsp` Spec
  for (const tool of bundle.tools) {
    const { definition, callback } = buildMcpUseToolBinding(tool, options?.surfaceOverrides?.[tool.operationId])
    if (!registeredTools.has(definition.name)) {
      registerSingleTool(server, registeredTools, definition, callback)
    }
  }

  // 2. Register R1: Reserved `session_*` Tools & `session://` Resource Templates
  if (includeReservedTools && bundle.reservedInterfaces.includes('session')) {
    const projectInputSchema = toStandardSchemaWithJson<{ projectId?: string }>({
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Target project identifier', default: 'default' },
      },
    })

    if (!registeredTools.has('session_status')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'session_status',
          description: 'Reserved R1 Interface: Inspect file-locked session state and undo/redo stack depth',
          schema: projectInputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async input => {
          const projectId = typeof input?.projectId === 'string' ? input.projectId : 'default'
          const record = bundle.sessionStore.readSession(projectId)
          const data = {
            projectId: record.projectId,
            updatedAt: record.updatedAt,
            undoCount: record.undoStack.length,
            redoCount: record.redoStack.length,
            currentState: record.currentState,
          }
          return {
            content: [{ type: 'text', text: `Session "${projectId}" (undo: ${data.undoCount}, redo: ${data.redoCount})` }],
            structuredContent: data,
          }
        },
      )
    }

    if (!registeredTools.has('session_undo')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'session_undo',
          description: 'Reserved R1 Interface: Undo the most recent committed mutation snapshot on a project session',
          schema: projectInputSchema,
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        },
        async (input, rawCtx) => {
          const projectId = typeof input?.projectId === 'string' ? input.projectId : 'default'
          try {
            const res = await bundle.sessionStore.undo(
              projectId,
              createMcpSessionRestorer(bundle, projectId, rawCtx),
            )
            return {
              content: [
                {
                  type: 'text',
                  text: res.undone
                    ? `Undid snapshot ${res.restoredSnapshot?.snapshotId}`
                    : `No undo snapshots available for "${projectId}"`,
                },
              ],
              structuredContent: res,
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
              isError: true,
              content: [{ type: 'text', text: message }],
            }
          }
        },
      )
    }

    if (!registeredTools.has('session_redo')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'session_redo',
          description: 'Reserved R1 Interface: Redo the most recently undone mutation snapshot on a project session',
          schema: projectInputSchema,
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        },
        async (input, rawCtx) => {
          const projectId = typeof input?.projectId === 'string' ? input.projectId : 'default'
          try {
            const res = await bundle.sessionStore.redo(
              projectId,
              createMcpSessionRestorer(bundle, projectId, rawCtx),
            )
            return {
              content: [
                {
                  type: 'text',
                  text: res.redone
                    ? `Redid snapshot ${res.reappliedSnapshot?.snapshotId}`
                    : `No redo snapshots available for "${projectId}"`,
                },
              ],
              structuredContent: res,
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
              isError: true,
              content: [{ type: 'text', text: message }],
            }
          }
        },
      )
    }

    if (!registeredTools.has('session_history')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'session_history',
          description: 'Reserved R1 Interface: Read undo/redo snapshot history for a project session',
          schema: projectInputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async input => {
          const projectId = typeof input?.projectId === 'string' ? input.projectId : 'default'
          const record = bundle.sessionStore.readSession(projectId)
          const data = {
            projectId: record.projectId,
            undoStack: record.undoStack,
            redoStack: record.redoStack,
          }
          return {
            content: [{ type: 'text', text: `Session history for "${projectId}" (${record.undoStack.length} entries)` }],
            structuredContent: data,
          }
        },
      )
    }

    if (typeof server.resourceTemplate === 'function') {
      server.resourceTemplate(
        {
          name: 'session_state',
          uriTemplate: 'session://{projectId}/state',
          mimeType: 'application/json',
          description: 'Reserved R1 Resource: Current deterministic session state for a project',
        },
        async (_uri, params) => bundle.sessionStore.readSession(params.projectId ?? 'default'),
      )
      registeredResourceTemplates.push('session://{projectId}/state')
    }
  }

  // 3. Register R3: Reserved `preview_inspect` Tool & `preview://` Resource Template
  if (includeReservedTools && bundle.reservedInterfaces.includes('preview-bundle')) {
    if (!registeredTools.has('preview_inspect')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'preview_inspect',
          description: 'Reserved R3 Interface: Inspect a preview-bundle/v1 manifest and summary by bundleId',
          schema: toStandardSchemaWithJson<{ bundleId: string }>({
            type: 'object',
            properties: {
              bundleId: { type: 'string', description: 'Preview bundle identifier' },
            },
            required: ['bundleId'],
          }),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async input => {
          const bundleId = String(input?.bundleId ?? '')
          const found = bundle.previewStore.readBundle(bundleId)
          if (!found) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Preview bundle "${bundleId}" not found` }],
            }
          }
          return {
            content: [{ type: 'text', text: `Preview bundle ${found.bundleId}: ${found.summary.title}` }],
            structuredContent: found,
            _meta: { previewBundle: found },
          }
        },
      )
    }

    if (typeof server.resourceTemplate === 'function') {
      server.resourceTemplate(
        {
          name: 'preview_bundle',
          uriTemplate: 'preview://{bundleId}/manifest',
          mimeType: 'application/json',
          description: 'Reserved R3 Resource: preview-bundle/v1 manifest and artifacts',
        },
        async (_uri, params) => bundle.previewStore.readBundle(params.bundleId ?? ''),
      )
      registeredResourceTemplates.push('preview://{bundleId}/manifest')
    }
  }

  // 4. Register R4: Reserved `handoff_inspect` & `handoff_resume` Tools & `handoff://` Resource
  if (includeReservedTools && bundle.reservedInterfaces.includes('handoff-envelope')) {
    const handoffInputSchema = toStandardSchemaWithJson<{ projectId?: string; handoffId?: string }>({
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project identifier', default: 'default' },
        handoffId: { type: 'string', description: 'Optional specific handoff envelope ID' },
      },
    })

    if (!registeredTools.has('handoff_inspect')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'handoff_inspect',
          description: 'Reserved R4 Interface: Inspect the latest Stage 1 -> Stage 2 cli-anything-handoff-envelope/v1',
          schema: handoffInputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async input => {
          const projectId = typeof input?.projectId === 'string' ? input.projectId : 'default'
          const handoffId = typeof input?.handoffId === 'string' ? input.handoffId : undefined
          const env = handoffId
            ? bundle.handoffStore.readById(projectId, handoffId)
            : bundle.handoffStore.readLatest(projectId)
          if (!env) {
            return {
              isError: true,
              content: [{ type: 'text', text: `No handoff envelope found for project "${projectId}"` }],
            }
          }
          return {
            content: [{ type: 'text', text: `Handoff ${env.handoffId} (${env.status}): ${env.summary}` }],
            structuredContent: env,
            _meta: { handoffEnvelope: env },
          }
        },
      )
    }

    if (!registeredTools.has('handoff_resume')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'handoff_resume',
          description: 'Reserved R4 Interface: Resume or commit a Stage 1 dry-run handoff envelope in Stage 2 MCP',
          schema: handoffInputSchema,
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async (input, rawCtx) => {
          const projectId = typeof input?.projectId === 'string' ? input.projectId : 'default'
          const handoffId = typeof input?.handoffId === 'string' ? input.handoffId : undefined
          const env = handoffId
            ? bundle.handoffStore.readById(projectId, handoffId)
            : bundle.handoffStore.readLatest(projectId)
          if (!env) {
            return {
              isError: true,
              content: [{ type: 'text', text: `No handoff envelope found for project "${projectId}"` }],
            }
          }
          const targetTool = bundle.toolsByOperationId.get(env.operationId)
          if (targetTool && env.status === 'dry-run-planned') {
            const bound = registeredTools.get(targetTool.name)
            if (bound) {
              return bound.callback({ ...env.payload, projectId, dryRun: false }, rawCtx)
            }
          }
          return {
            content: [{ type: 'text', text: `Resumed handoff ${env.handoffId} (${env.operationId})` }],
            structuredContent: {
              resumed: true,
              handoffId: env.handoffId,
              operationId: env.operationId,
              fingerprint: env.fingerprint,
              suggestedNextTools: env.suggestedNextTools,
              payload: env.payload,
            },
            _meta: { handoffEnvelope: env },
          }
        },
      )
    }

    if (typeof server.resourceTemplate === 'function') {
      server.resourceTemplate(
        {
          name: 'handoff_latest',
          uriTemplate: 'handoff://{projectId}/latest',
          mimeType: 'application/json',
          description: 'Reserved R4 Resource: Latest cli-anything-handoff-envelope/v1 for a project',
        },
        async (_uri, params) => bundle.handoffStore.readLatest(params.projectId ?? 'default'),
      )
      registeredResourceTemplates.push('handoff://{projectId}/latest')
    }
  }

  // 5. Register R5: SEP-2640 (`io.modelcontextprotocol/skills`) Snapshot & Tools
  const skillsSnapshot = options?.skillDirs ? buildMcpUseSkillsSnapshot(options.skillDirs) : undefined
  if (includeReservedTools && bundle.reservedInterfaces.includes('sep-2640-skills') && skillsSnapshot) {
    if (!registeredTools.has('skills_list')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'skills_list',
          description: 'Reserved R5 Interface (SEP-2640): List immutable SkillsSnapshot entries served over MCP',
          schema: toStandardSchemaWithJson({ type: 'object', properties: {} }),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async () => ({
          content: [{ type: 'text', text: `SEP-2640 SkillsSnapshot (${skillsSnapshot.skills.length} skills, etag: ${skillsSnapshot.etag})` }],
          structuredContent: {
            capability: skillsSnapshot.capability,
            etag: skillsSnapshot.etag,
            skills: skillsSnapshot.skills.map(s => ({
              name: s.name,
              description: s.description,
              uri: s.uri,
              versionHash: s.versionHash,
              fileCount: s.files.length,
            })),
          },
        }),
      )
    }

    if (!registeredTools.has('skills_get')) {
      registerSingleTool(
        server,
        registeredTools,
        {
          name: 'skills_get',
          description: 'Reserved R5 Interface (SEP-2640): Retrieve a skill package and its verified files by name',
          schema: toStandardSchemaWithJson<{ name: string }>({
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Skill name' },
            },
            required: ['name'],
          }),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async input => {
          const skillName = String(input?.name ?? '')
          const found = skillsSnapshot.skills.find(s => s.name === skillName)
          if (!found) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Skill "${skillName}" not found in SEP-2640 snapshot` }],
            }
          }
          return {
            content: [{ type: 'text', text: `Skill ${found.name} (${found.versionHash})` }],
            structuredContent: found,
          }
        },
      )
    }
  }

  return {
    registeredTools,
    registeredResourceTemplates,
    ...(skillsSnapshot ? { skillsSnapshot } : {}),
    async invokeTool(
      toolName: string,
      input: Record<string, unknown> = {},
      ctx?: Record<string, unknown>,
    ): Promise<McpUseCallToolResponse<any>> {
      const entry = registeredTools.get(toolName)
      if (!entry) {
        throw new Error(`Unknown MCP tool "${toolName}"`)
      }
      const validation = entry.definition.schema.safeParse(input)
      if (!validation.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Input validation failed for ${toolName}: ${validation.error.message}` }],
        }
      }
      return entry.callback(validation.data, ctx)
    },
  }
}

function buildMcpUseToolBinding(
  tool: HydratedToolDefinition,
  surfaceOverride?: {
    readonly view?: string | { readonly name: string; readonly [key: string]: unknown }
    readonly visibility?: 'model' | 'app'
  },
): {
  definition: McpUseToolRegistrationDefinition
  callback: McpUseToolCallback
} {
  const meta = tool.pipelineMeta
  const resolvedViewName =
    typeof surfaceOverride?.view === 'string'
      ? surfaceOverride.view
      : surfaceOverride?.view?.name ?? meta.mcpView
  const resolvedView =
    typeof surfaceOverride?.view === 'object'
      ? surfaceOverride.view
      : resolvedViewName
        ? { name: resolvedViewName }
        : undefined
  const resolvedVisibility = surfaceOverride?.visibility ?? meta.mcpVisibility

  const definition: McpUseToolRegistrationDefinition = {
    name: meta.mcpToolName,
    title: `${meta.cliGroup} ${meta.cliCommand}`,
    description: tool.description,
    schema: tool.standardInputSchema,
    ...(tool.standardOutputSchema ? { outputSchema: tool.standardOutputSchema } : {}),
    annotations: {
      readOnlyHint: meta.readOnly,
      destructiveHint: meta.destructive,
      idempotentHint: meta.idempotent,
      openWorldHint: meta.openWorld,
    },
    ...(resolvedView ? { view: resolvedView } : {}),
    visibility: resolvedVisibility,
    _meta: {
      operationId: meta.operationId,
      stage: meta.stage,
      executionModel: meta.executionModel,
      cliEquivalent: `${meta.cliGroup} ${meta.cliCommand}`,
      ...(meta.tableAdapter ? { tableAdapter: meta.tableAdapter } : {}),
    },
  }

  const callback: McpUseToolCallback = async (input, rawMcpCtx) => {
    try {
      const baseCtx = createToolContext({
        meta: {
          surface: 'mcp',
          operationId: meta.operationId,
          ...(rawMcpCtx ? { mcpContext: rawMcpCtx } : {}),
        },
      })
      const elicitFn =
        rawMcpCtx && typeof rawMcpCtx.elicit === 'function'
          ? (rawMcpCtx.elicit as ElicitationContext['elicit'])
          : undefined
      const ctx: ElicitationContext = {
        ...baseCtx,
        ...(elicitFn ? { elicit: elicitFn } : {}),
      }

      const outcome = await tool.execute(ctx, input ?? {})
      const isGateFailure = outcome.passed === false

      return {
        ...(isGateFailure ? { isError: true } : {}),
        content: [
          {
            type: 'text',
            text: outcome.summary ?? JSON.stringify(outcome.data),
          },
        ],
        structuredContent: outcome.data,
        _meta: {
          ...(outcome.meta ?? {}),
          ...(outcome.previewBundle ? { previewBundle: outcome.previewBundle } : {}),
          ...(outcome.handoffEnvelope ? { handoffEnvelope: outcome.handoffEnvelope } : {}),
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      }
    }
  }

  return { definition, callback }
}
