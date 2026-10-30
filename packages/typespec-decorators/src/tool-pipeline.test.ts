import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  Numeric,
  type DecoratorContext,
  type Diagnostic,
  type Interface,
  type ModelProperty,
  type Namespace,
  type Operation,
  type Program,
} from '@typespec/compiler'
import { getExtensions } from '@typespec/openapi'
import { afterEach, describe, expect, it } from 'vitest'
import {
  $cliFlag,
  $mcpSurface,
  $oaTool,
  $pipelineApply,
  $pipelineDestructive,
  $pipelineHandoff,
  $pipelineInspect,
  $pipelinePlan,
  $pipelineVerify,
  $positional,
  $reservedMcpInterfaces,
  $tableAdapter,
  $toolGroup,
  CLI_FLAG_EXTENSION,
  MCP_SURFACE_EXTENSION,
  POSITIONAL_EXTENSION,
  RESERVED_MCP_INTERFACES_EXTENSION,
  TABLE_ADAPTER_EXTENSION,
  TOOL_EXTENSION,
  TOOL_GROUP_EXTENSION,
} from './tool-pipeline.js'

const workspaceRoot = resolve(import.meta.dirname, '../../..')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

interface MockProgram extends Program {
  diagnostics: Diagnostic[]
}

function createProgram(): MockProgram {
  const stateMaps = new Map<symbol, Map<unknown, unknown>>()
  const diagnostics: Diagnostic[] = []
  return {
    diagnostics,
    stateMap(key: symbol) {
      let map = stateMaps.get(key)
      if (!map) {
        map = new Map()
        stateMaps.set(key, map)
      }
      return map
    },
    reportDiagnostic(diagnostic: Diagnostic) {
      diagnostics.push(diagnostic)
    },
  } as unknown as MockProgram
}

function createContext(program: MockProgram): DecoratorContext {
  return {
    program,
    getArgumentTarget: () => undefined,
  } as unknown as DecoratorContext
}

describe('@oa-sdk/typespec-decorators/tool-pipeline decorator set', () => {
  it('resolves all 6 repeatable pipeline stage presets with mcp-use > cli pre-reservation', () => {
    const program = createProgram()
    const context = createContext(program)

    const opInspect = {} as Operation
    $pipelineInspect(context, opInspect, 'inspect', { cliGroup: 'skill', positionalArgs: ['skillId'] })

    const opPlan = {} as Operation
    $pipelinePlan(context, opPlan, 'plan', { cliGroup: 'project' })

    const opApply = {} as Operation
    $pipelineApply(context, opApply, 'apply', { cliGroup: 'project', mcpView: 'project-summary' })

    const opDestructive = {} as Operation
    $pipelineDestructive(context, opDestructive, 'remove', { cliGroup: 'project' })

    const opVerify = {} as Operation
    $pipelineVerify(context, opVerify, 'verify', { cliGroup: 'project' })

    const opHandoff = {} as Operation
    $pipelineHandoff(context, opHandoff, 'export-snapshot', { cliGroup: 'skill' })

    expect(program.diagnostics).toHaveLength(0)

    expect(getExtensions(program, opInspect).get(TOOL_EXTENSION)).toMatchObject({
      stage: 'inspect',
      cliGroup: 'skill',
      cliCommand: 'inspect',
      positionalArgs: ['skillId'],
      readOnly: true,
      destructive: false,
      idempotent: true,
      dryRunSupport: false,
      sessionLock: 'none',
      executionModel: 'single-phase',
      mcpToolName: 'skill_inspect',
    })

    expect(getExtensions(program, opPlan).get(TOOL_EXTENSION)).toMatchObject({
      stage: 'plan',
      cliGroup: 'project',
      cliCommand: 'plan',
      readOnly: true,
      dryRunSupport: true,
      sessionLock: 'shared-read',
      executionModel: 'plan-only',
      requiresPreviewBundle: true,
      mcpToolName: 'project_plan',
    })

    expect(getExtensions(program, opApply).get(TOOL_EXTENSION)).toMatchObject({
      stage: 'apply',
      cliGroup: 'project',
      cliCommand: 'apply',
      readOnly: false,
      destructive: false,
      idempotent: true,
      dryRunSupport: true,
      sessionLock: 'exclusive-file',
      undoSnapshot: true,
      executionModel: 'two-phase-commit',
      requiresPreviewBundle: true,
      mcpToolName: 'project_apply',
      mcpView: 'project-summary',
    })

    expect(getExtensions(program, opDestructive).get(TOOL_EXTENSION)).toMatchObject({
      stage: 'destructive',
      cliGroup: 'project',
      cliCommand: 'remove',
      readOnly: false,
      destructive: true,
      idempotent: false,
      dryRunSupport: true,
      sessionLock: 'exclusive-file',
      undoSnapshot: true,
      executionModel: 'two-phase-elicit-commit',
      mcpToolName: 'project_remove',
    })

    expect(getExtensions(program, opVerify).get(TOOL_EXTENSION)).toMatchObject({
      stage: 'verify',
      cliGroup: 'project',
      cliCommand: 'verify',
      readOnly: true,
      executionModel: 'verification-gate',
      mcpToolName: 'project_verify',
    })

    expect(getExtensions(program, opHandoff).get(TOOL_EXTENSION)).toMatchObject({
      stage: 'handoff',
      cliGroup: 'skill',
      cliCommand: 'export-snapshot',
      readOnly: true,
      requiresPreviewBundle: true,
      requiresHandoffEnvelope: true,
      executionModel: 'handoff-bridge',
      mcpToolName: 'skill_export_snapshot',
    })
  })

  it('propagates @toolGroup, @reservedMcpInterfaces, and @tableAdapter regardless of evaluation order', () => {
    const program = createProgram()
    const context = createContext(program)

    const op1 = {} as Operation
    const op2 = {} as Operation
    const operations = new Map<string, Operation>([
      ['op1', op1],
      ['op2', op2],
    ])
    const iface = { kind: 'Interface', operations } as unknown as Interface
    ;(op1 as unknown as { interface: Interface }).interface = iface
    ;(op2 as unknown as { interface: Interface }).interface = iface

    // Case A: operation decorator runs BEFORE container decorators
    $pipelineApply(context, op1, 'apply-ops')
    $toolGroup(context, iface, 'table', { description: 'Table operations', aliases: ['tbl'] })
    $reservedMcpInterfaces(context, iface, ['session', 'preview-bundle', 'handoff-envelope'])
    $tableAdapter(context, iface, 'calc', { preserveFormulas: true })

    // Case B: operation decorator runs AFTER container decorators
    $pipelinePlan(context, op2, 'plan-ops')

    expect(program.diagnostics).toHaveLength(0)

    expect(getExtensions(program, op1).get(TOOL_EXTENSION)).toMatchObject({
      cliGroup: 'table',
      cliCommand: 'apply-ops',
      mcpToolName: 'table_apply_ops',
    })
    expect(getExtensions(program, op2).get(TOOL_EXTENSION)).toMatchObject({
      cliGroup: 'table',
      cliCommand: 'plan-ops',
      mcpToolName: 'table_plan_ops',
    })
    expect(getExtensions(program, op1).get(TOOL_GROUP_EXTENSION)).toEqual({
      schemaVersion: 1,
      cliGroup: 'table',
      description: 'Table operations',
      aliases: ['tbl'],
    })
    expect(getExtensions(program, op2).get(RESERVED_MCP_INTERFACES_EXTENSION)).toEqual({
      schemaVersion: 1,
      direction: 'mcp-use>cli',
      interfaces: ['session', 'preview-bundle', 'handoff-envelope'],
    })
    expect(getExtensions(program, op1).get(TABLE_ADAPTER_EXTENSION)).toEqual({
      schemaVersion: 1,
      adapterKind: 'calc',
      irVersion: 'unified-table-ir/v1',
      preserveFormulas: true,
      preserveMergedCells: true,
    })
  })

  it('decorates model properties with @positional and @cliFlag, and operations with @mcpSurface', () => {
    const program = createProgram()
    const context = createContext(program)

    const propId = {} as ModelProperty
    const propPreset = {} as ModelProperty
    $positional(context, propId, Numeric('0'))
    $cliFlag(context, propPreset, { short: 'p', env: 'SKILLS_PRESET', negatable: false })

    const op = {} as Operation
    $mcpSurface(context, op, {
      view: 'project-activation-summary',
      visibility: 'app',
      resourceUriTemplate: 'session://{projectId}/state',
    })
    $oaTool(context, op, { cliGroup: 'project', cliCommand: 'refresh-view' })

    expect(program.diagnostics).toHaveLength(0)
    expect(getExtensions(program, propId).get(POSITIONAL_EXTENSION)).toEqual({ order: 0 })
    expect(getExtensions(program, propPreset).get(CLI_FLAG_EXTENSION)).toEqual({
      short: 'p',
      env: 'SKILLS_PRESET',
      negatable: false,
    })
    expect(getExtensions(program, op).get(MCP_SURFACE_EXTENSION)).toEqual({
      visibility: 'app',
      view: 'project-activation-summary',
      resourceUriTemplate: 'session://{projectId}/state',
    })
    expect(getExtensions(program, op).get(TOOL_EXTENSION)).toMatchObject({
      cliGroup: 'project',
      cliCommand: 'refresh-view',
      mcpView: 'project-activation-summary',
      mcpVisibility: 'app',
      resourceUriTemplate: 'session://{projectId}/state',
    })
  })

  it('reports invalid-tool-pipeline-rule diagnostics on invalid inputs', () => {
    const program = createProgram()
    const context = createContext(program)

    $toolGroup(context, {} as Namespace, 'Invalid_Group')
    $reservedMcpInterfaces(context, {} as Namespace, ['unknown-interface'])
    $pipelineInspect(context, {} as Operation, 'BadCommand!')
    $positional(context, {} as ModelProperty, -1)
    $cliFlag(context, {} as ModelProperty, { short: 'too-long' })
    $tableAdapter(context, {} as Operation, 'excel-unknown')

    expect(program.diagnostics).toHaveLength(6)
    for (const diag of program.diagnostics) {
      expect(diag.code).toBe('@oa-sdk/typespec-decorators/invalid-tool-pipeline-rule')
    }
  })

  it('emits tool-pipeline extensions through the real TypeSpec OpenAPI 3.2 compiler', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-tool-pipeline-fixture-'))
    tmpDirs.push(directory)
    const nodeModules = join(directory, 'node_modules')
    mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
    symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
    symlinkSync(
      join(workspaceRoot, 'packages', 'typespec-decorators'),
      join(nodeModules, '@oa-sdk', 'typespec-decorators'),
      'dir',
    )

    writeFileSync(
      join(directory, 'main.tsp'),
      `
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators/tool-pipeline";

using Http;
using OpenAPI;
using OaSdkTypeSpec;

@service(#{ title: "Skills Platform Tool Pipeline Fixture" })
@reservedMcpInterfaces(#["session", "dry-run-elicit", "preview-bundle", "handoff-envelope", "sep-2640-skills"])
namespace Fixture;

model ProjectApplyRequest {
  @positional(0)
  projectId: string;

  @cliFlag(#{ short: "p", env: "SKILLS_PRESET" })
  presetId?: string;
}

model ProjectApplyResponse {
  appliedCount: int32;
  fingerprint: string;
}

@toolGroup("project")
interface ProjectLifecycle {
  @route("/projects/apply")
  @post
  @pipelineApply("apply")
  @mcpSurface(#{ view: "project-activation-summary", visibility: "model" })
  op projectApply(@body input: ProjectApplyRequest): ProjectApplyResponse;
}
`,
    )

    writeFileSync(
      join(directory, 'tspconfig.yaml'),
      `
kind: project
entrypoint: main.tsp
emit:
  - "@typespec/openapi3"
options:
  "@typespec/openapi3":
    openapi-versions:
      - 3.2.0
`,
    )

    execFileSync(
      join(workspaceRoot, 'node_modules', '.bin', 'tsp'),
      ['compile', directory, '--output-dir', join(directory, 'output')],
      { cwd: directory, encoding: 'utf8' },
    )

    const emittedPath = join(directory, 'output', '@typespec', 'openapi3', 'openapi.yaml')
    expect(existsSync(emittedPath)).toBe(true)
    const emitted = readFileSync(emittedPath, 'utf8')
    expect(emitted).toContain('x-oa-sdk-tool:')
    expect(emitted).toContain('stage: apply')
    expect(emitted).toContain('cliGroup: project')
    expect(emitted).toContain('cliCommand: apply')
    expect(emitted).toContain('executionModel: two-phase-commit')
    expect(emitted).toContain('mcpToolName: project_apply')
    expect(emitted).toContain('mcpView: project-activation-summary')
    expect(emitted).toContain('x-oa-sdk-reserved-interfaces:')
    expect(emitted).toContain('x-oa-sdk-positional:')
    expect(emitted).toContain('x-oa-sdk-cli-flag:')
  }, 20_000)
})
