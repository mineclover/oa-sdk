import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  VALID_DOCUMENT_TABLE_ADAPTER_KINDS,
  createTableApplyTwoPhaseHandler,
  createToolContext,
  createUnifiedTableIR,
  generateHarnessManualFromSpec,
  generateSkillMarkdownFromSpec,
  hydrateToolsFromOpenApi,
  planTableIrPatch,
  readTableFromFile,
  registerToolsOnMcpUse,
  runCliAnythingArgv,
  toStandardSchemaWithJson,
  writeTableToFile,
  type McpUseLikeServer,
  type McpUseToolCallback,
  type McpUseToolRegistrationDefinition,
} from './index.js'

const tmpDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function buildSampleOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: {
      title: 'Skills Platform Unified Tool Spec',
      version: '0.2.0',
    },
    'x-oa-sdk-reserved-interfaces': {
      schemaVersion: 1,
      direction: 'mcp-use>cli',
      interfaces: ['session', 'dry-run-elicit', 'preview-bundle', 'handoff-envelope', 'sep-2640-skills'],
    },
    components: {
      schemas: {
        ProjectApplyRequest: {
          type: 'object',
          required: ['projectId'],
          properties: {
            projectId: {
              type: 'string',
              description: 'Target project identifier',
              'x-oa-sdk-positional': { order: 0 },
            },
            presetId: {
              type: 'string',
              description: 'Preset to apply',
              'x-oa-sdk-cli-flag': { short: 'p', env: 'SKILLS_PRESET', negatable: false },
            },
          },
        },
        ProjectApplyResponse: {
          type: 'object',
          required: ['projectId', 'appliedPreset', 'appliedCount'],
          properties: {
            projectId: { type: 'string' },
            appliedPreset: { type: 'string' },
            appliedCount: { type: 'integer' },
          },
        },
        ProjectRemoveRequest: {
          type: 'object',
          required: ['projectId'],
          properties: {
            projectId: {
              type: 'string',
              'x-oa-sdk-positional': { order: 0 },
            },
          },
        },
        ProjectRemoveResponse: {
          type: 'object',
          required: ['removed'],
          properties: {
            removed: { type: 'boolean' },
            projectId: { type: 'string' },
          },
        },
        TableApplyOpsRequest: {
          type: 'object',
          required: ['adapterKind', 'operations'],
          properties: {
            adapterKind: {
              type: 'string',
              enum: ['calc', 'writer', 'impress', 'markdown', 'tabular-ops', 'visual-dom'],
              'x-oa-sdk-positional': { order: 0 },
            },
            tableId: { type: 'string' },
            operations: {
              type: 'array',
              items: { type: 'object' },
            },
          },
        },
      },
    },
    paths: {
      '/projects/apply': {
        post: {
          operationId: 'projectApply',
          summary: 'Apply a skill preset to a project',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProjectApplyRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Applied',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ProjectApplyResponse' },
                },
              },
            },
          },
          'x-oa-sdk-tool': {
            schemaVersion: 1,
            stage: 'apply',
            cliGroup: 'project',
            cliCommand: 'apply',
            aliases: ['sync'],
            positionalArgs: [],
            readOnly: false,
            destructive: false,
            idempotent: true,
            openWorld: false,
            dryRunSupport: true,
            sessionLock: 'exclusive-file',
            undoSnapshot: true,
            executionModel: 'two-phase-commit',
            requiresPreviewBundle: true,
            requiresHandoffEnvelope: true,
            mcpToolName: 'project_apply',
            mcpVisibility: 'model',
            mcpView: 'project-activation-summary',
          },
        },
      },
      '/projects/remove': {
        post: {
          operationId: 'projectRemove',
          summary: 'Remove a project registration',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProjectRemoveRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Removed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ProjectRemoveResponse' },
                },
              },
            },
          },
          'x-oa-sdk-tool': {
            schemaVersion: 1,
            stage: 'destructive',
            cliGroup: 'project',
            cliCommand: 'remove',
            readOnly: false,
            destructive: true,
            idempotent: false,
            openWorld: false,
            dryRunSupport: true,
            sessionLock: 'exclusive-file',
            undoSnapshot: true,
            executionModel: 'two-phase-elicit-commit',
            requiresPreviewBundle: true,
            requiresHandoffEnvelope: false,
            mcpToolName: 'project_remove',
            mcpVisibility: 'model',
          },
        },
      },
      '/tables/apply-ops': {
        post: {
          operationId: 'tableApplyOps',
          summary: 'Apply deterministic patch operations to a UnifiedTableIR document table',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TableApplyOpsRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Patched table',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
          'x-oa-sdk-tool': {
            schemaVersion: 1,
            stage: 'apply',
            cliGroup: 'table',
            cliCommand: 'apply-ops',
            readOnly: false,
            destructive: false,
            idempotent: true,
            openWorld: false,
            dryRunSupport: true,
            sessionLock: 'exclusive-file',
            undoSnapshot: true,
            executionModel: 'two-phase-commit',
            requiresPreviewBundle: true,
            requiresHandoffEnvelope: true,
            mcpToolName: 'table_apply_ops',
            mcpVisibility: 'model',
          },
          'x-oa-sdk-table-adapter': {
            schemaVersion: 1,
            adapterKind: 'calc',
            irVersion: 'unified-table-ir/v1',
            preserveFormulas: true,
            preserveMergedCells: true,
          },
        },
      },
    },
  }
}

describe('Single-Point Spec Hydrator + CLI-Anything + mcp-use v2 Reserved Interfaces', () => {
  it('wraps JSON Schema 2020-12 into StandardSchemaWithJson (~standard v1)', () => {
    const std = toStandardSchemaWithJson<{ projectId: string }>({
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
      },
    })

    expect(std['~standard'].version).toBe(1)
    expect(std['~standard'].vendor).toBe('@oa-sdk/tools')
    expect(std['~standard'].jsonSchema.input()).toMatchObject({
      type: 'object',
      required: ['projectId'],
    })
    expect(std['~standard'].validate({ projectId: 'demo' })).toEqual({
      value: { projectId: 'demo' },
    })
    const invalid = std['~standard'].validate({})
    expect('issues' in invalid && Array.isArray(invalid.issues)).toBe(true)
  })

  it('enforces 1:1 spec-handler parity at hydration time', () => {
    const spec = buildSampleOpenApiSpec()
    expect(() => hydrateToolsFromOpenApi(spec, {})).toThrow(/Missing handler for operationId "projectApply"/)

    expect(() =>
      hydrateToolsFromOpenApi(spec, {
        projectApply: async () => ({}),
        projectRemove: async () => ({}),
        tableApplyOps: async () => ({}),
        extraOrphanHandler: async () => ({}),
      }),
    ).toThrow(/Handler "extraOrphanHandler" is not declared in the OpenAPI specification/)
  })

  it('executes 2-Phase handlers across Stage 1 CLI (--dry-run -> commit -> session undo/redo) and Stage 2 mcp-use (elicit -> handoff)', async () => {
    const stateDir = makeTempDir('oa-sdk-tools-state-')
    const skillDir = makeTempDir('oa-sdk-tools-skill-')
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: sample-cli-skill\ndescription: Sample skill for SEP-2640\n---\n# Sample Skill\n',
      'utf8',
    )

    let commitCallCount = 0
    let domainValue = 0
    const spec = buildSampleOpenApiSpec()

    const bundle = hydrateToolsFromOpenApi(
      spec,
      {
        projectApply: {
          async plan(_ctx, input) {
            return {
              projectId: input.projectId,
              appliedPreset: input.presetId ?? 'default-preset',
              appliedCount: 3,
            }
          },
          async commit(_ctx, _input, plan) {
            commitCallCount += 1
            domainValue += 1
            return {
              data: plan,
              summary: `Applied ${plan.appliedPreset} (${plan.appliedCount} skills) to ${plan.projectId}`,
            }
          },
          async captureState() {
            return { domainValue }
          },
          async restoreState(_ctx, _projectId, state) {
            domainValue = Number(state.domainValue)
          },
        },
        projectRemove: {
          async plan(_ctx, input) {
            return { projectId: input.projectId, willRemove: true }
          },
          async commit(_ctx, input) {
            return {
              data: { removed: true, projectId: input.projectId },
              summary: `Removed project ${input.projectId}`,
            }
          },
        },
        tableApplyOps: createTableApplyTwoPhaseHandler(input =>
          createUnifiedTableIR({
            tableId: input.tableId ?? `tbl_${input.adapterKind}`,
            adapterKind: input.adapterKind,
            headers: ['Metric', 'Q1', 'Q2'],
            rows: [
              ['Revenue', 100, 120],
              ['Cost', 40, 45],
            ],
          }),
        ),
      },
      { stateDir },
    )

    // 1. Stage 1 CLI: --dry-run runs Phase A only (commitCallCount remains 0!)
    const dryRunRes = await runCliAnythingArgv(bundle, [
      '--json',
      '--dry-run',
      'project',
      'apply',
      'alpha-proj',
      '-p',
      'core-preset',
    ])
    expect(dryRunRes.exitCode).toBe(0)
    expect(commitCallCount).toBe(0)
    expect(JSON.parse(dryRunRes.stdout)).toEqual({
      projectId: 'alpha-proj',
      appliedPreset: 'core-preset',
      appliedCount: 3,
    })
    expect(dryRunRes.outcome?.meta?.dryRun).toBe(true)
    expect(dryRunRes.outcome?.previewBundle?.summary.status).toBe('dry-run')

    // 2. Stage 1 CLI: Normal commit runs Phase A -> Phase B under lock & records undo snapshot
    const applyRes = await runCliAnythingArgv(bundle, [
      '--json',
      'project',
      'apply',
      'alpha-proj',
      '-p',
      'core-preset',
    ])
    expect(applyRes.exitCode).toBe(0)
    expect(commitCallCount).toBe(1)
    expect(applyRes.outcome?.handoffEnvelope?.schemaVersion).toBe('cli-anything-handoff-envelope/v1')

    // 3. Stage 1 CLI: Reserved R1 `session status`, `session undo`, `session redo`
    const statusRes = await runCliAnythingArgv(bundle, ['--json', 'session', 'status', 'alpha-proj'])
    expect(JSON.parse(statusRes.stdout).undoCount).toBe(1)

    const undoRes = await runCliAnythingArgv(bundle, ['--json', 'session', 'undo', 'alpha-proj'])
    expect(JSON.parse(undoRes.stdout).undone).toBe(true)

    const redoRes = await runCliAnythingArgv(bundle, ['--json', 'session', 'redo', 'alpha-proj'])
    expect(JSON.parse(redoRes.stdout).redone).toBe(true)

    // 4. Stage 2 mcp-use v2 Server Registration & Reserved Interfaces (R1~R5)
    const registeredMap = new Map<string, { def: McpUseToolRegistrationDefinition; cb: McpUseToolCallback }>()
    const mockMcpServer: McpUseLikeServer = {
      tool(def, cb) {
        registeredMap.set(def.name, { def, cb })
      },
      resourceTemplate() {
        return undefined
      },
    }

    const mcpSurface = registerToolsOnMcpUse(mockMcpServer, bundle, { skillDirs: [skillDir] })

    // Both inputSchema AND outputSchema are registered on project_apply
    const projectApplyDef = registeredMap.get('project_apply')?.def
    expect(projectApplyDef?.schema['~standard'].version).toBe(1)
    expect(projectApplyDef?.outputSchema?.['~standard'].version).toBe(1)
    expect(projectApplyDef?.view).toEqual({ name: 'project-activation-summary' })

    // Destructive tool (`project_remove`) triggers `ctx.elicit()` and cancels when declined
    const declinedRemove = await mcpSurface.invokeTool(
      'project_remove',
      { projectId: 'alpha-proj' },
      {
        elicit: async () => ({ action: 'decline' as const }),
      },
    )
    expect(declinedRemove.isError).toBe(true)
    expect(declinedRemove.structuredContent.cancelled).toBe(true)

    // Destructive tool commits when `ctx.elicit()` is accepted
    const acceptedRemove = await mcpSurface.invokeTool(
      'project_remove',
      { projectId: 'alpha-proj' },
      {
        elicit: async () => ({ action: 'accept' as const, data: { confirm: true } }),
      },
    )
    expect(acceptedRemove.isError).toBeUndefined()
    expect(acceptedRemove.structuredContent).toEqual({ removed: true, projectId: 'alpha-proj' })

    // Reserved R4 `handoff_inspect` & R5 `skills_list`
    const handoffInspect = await mcpSurface.invokeTool('handoff_inspect', { projectId: 'alpha-proj' })
    expect(handoffInspect.structuredContent.operationId).toBe('projectApply')

    const skillsList = await mcpSurface.invokeTool('skills_list', {})
    expect(skillsList.structuredContent.capability).toBe('io.modelcontextprotocol/skills')
    expect(skillsList.structuredContent.skills[0].name).toBe('sample-cli-skill')

    // 5. 6-Type Document Standard Table Adapter (`UnifiedTableIR`) Fingerprint Parity across CLI & MCP
    for (const adapterKind of VALID_DOCUMENT_TABLE_ADAPTER_KINDS) {
      const opsJson = JSON.stringify([
        { op: 'set-cell', row: 0, col: 1, value: 250 },
        { op: 'append-row', values: ['Profit', 210, 75, '=B3-C3'] },
      ])
      const cliTableRes = await runCliAnythingArgv(bundle, [
        '--json',
        'table',
        'apply-ops',
        adapterKind,
        '--operations',
        opsJson,
      ])
      expect(cliTableRes.exitCode).toBe(0)
      const cliData = JSON.parse(cliTableRes.stdout)

      const mcpTableRes = await mcpSurface.invokeTool('table_apply_ops', {
        adapterKind,
        operations: JSON.parse(opsJson),
      })
      expect(mcpTableRes.isError).toBeUndefined()
      expect(mcpTableRes.structuredContent.afterFingerprint).toBe(cliData.afterFingerprint)
    }

    // 6. Auto-generated SKILL.md Markdown table & Full Reference Manual from Spec
    const md = generateSkillMarkdownFromSpec(bundle, { binName: 'skills-platform' })
    expect(md).toContain('`skills-platform project apply`')
    expect(md).toContain('`project_apply`')
    expect(md).toContain('`table_apply_ops`')

    const manualMd = generateHarnessManualFromSpec(bundle, { binName: 'skills-platform' })
    expect(manualMd).toContain('## 1. Contract Identity & Pipeline Overview')
    expect(manualMd).toContain('flowchart LR')
    expect(manualMd).toContain('## 3. Stage 1 CLI Command Reference Manual')
    expect(manualMd).toContain('#### `skills-platform table apply-ops` (`tableApplyOps`)')
    expect(manualMd).toContain('## 4. Stage 2 `mcp-use` v2 Tool & Schema Reference')
  })

  it('reads, patches, and writes real disk files across all 6 document table formats (.xlsx, .docx, .pptx, .md, .csv, .html)', () => {
    const tmpDir = makeTempDir('oa-sdk-table-file-io-')
    const fileCases: Array<{
      adapterKind: (typeof VALID_DOCUMENT_TABLE_ADAPTER_KINDS)[number]
      ext: string
    }> = [
      { adapterKind: 'calc', ext: '.xlsx' },
      { adapterKind: 'writer', ext: '.docx' },
      { adapterKind: 'impress', ext: '.pptx' },
      { adapterKind: 'markdown', ext: '.md' },
      { adapterKind: 'tabular-ops', ext: '.csv' },
      { adapterKind: 'visual-dom', ext: '.html' },
    ]

    for (const { adapterKind, ext } of fileCases) {
      const filePath = path.join(tmpDir, `sample_${adapterKind}${ext}`)
      const seedIr = createUnifiedTableIR({
        tableId: `tbl_${adapterKind}`,
        adapterKind,
        headers: ['Element', 'Target', 'Score'],
        rows: [
          ['el_character_tutor_01', 'pose', 95],
          ['el_fraction_board_01', 'graphic', 88],
        ],
      })

      writeTableToFile(seedIr, filePath)
      expect(fs.existsSync(filePath)).toBe(true)

      const loadedIr = readTableFromFile(filePath, { adapterKind, tableId: `tbl_${adapterKind}` })
      expect(loadedIr.adapterKind).toBe(adapterKind)
      expect(loadedIr.rowCount).toBe(2)
      expect(loadedIr.colCount).toBe(3)
      expect(loadedIr.fingerprint).toBe(seedIr.fingerprint)

      const planned = planTableIrPatch(loadedIr, [
        { op: 'set-cell', row: 1, col: 2, value: 99 },
        { op: 'append-row', values: ['el_submit_cta_01', 'fsm', 100] },
      ])
      const outPath = path.join(tmpDir, `patched_${adapterKind}${ext}`)
      writeTableToFile(planned.previewIr, outPath)

      const reloadedPatched = readTableFromFile(outPath, {
        adapterKind,
        tableId: `tbl_${adapterKind}`,
      })
      expect(reloadedPatched.rowCount).toBe(3)
      expect(reloadedPatched.fingerprint).toBe(planned.afterFingerprint)
    }
  })

  it('rejects concurrent table commits whose plans were based on the same fingerprint', async () => {
    let current = createUnifiedTableIR({
      tableId: 'tbl_tabular-ops',
      adapterKind: 'tabular-ops',
      headers: ['A', 'B'],
      rows: [[0, 0]],
    })
    const handler = createTableApplyTwoPhaseHandler(
      () => current,
      table => {
        current = table
      },
    )
    const ctx = createToolContext()
    const firstInput = {
      projectId: 'same-project',
      adapterKind: 'tabular-ops' as const,
      operations: [{ op: 'set-cell' as const, row: 0, col: 0, value: 1 }],
    }
    const secondInput = {
      projectId: 'same-project',
      adapterKind: 'tabular-ops' as const,
      operations: [{ op: 'set-cell' as const, row: 0, col: 1, value: 1 }],
    }

    // Both plans intentionally observe the same base fingerprint before either
    // commit starts. The commit-time compare-and-swap must reject one plan.
    const firstPlan = await handler.plan(ctx, firstInput)
    const secondPlan = await handler.plan(ctx, secondInput)
    const [firstCommit, secondCommit] = await Promise.allSettled([
      handler.commit(ctx, firstInput, firstPlan),
      handler.commit(ctx, secondInput, secondPlan),
    ])

    expect(firstCommit.status).toBe('fulfilled')
    expect(secondCommit.status).toBe('rejected')
    expect((secondCommit as PromiseRejectedResult).reason).toMatchObject({ code: 'TABLE_PLAN_STALE' })
    expect(current.cells.map(cell => cell.raw)).toEqual([1, 0])
  })
})
