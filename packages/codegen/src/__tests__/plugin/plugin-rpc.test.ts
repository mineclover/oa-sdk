import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { buildRpcContract } from '@oa-sdk/surface-ir'
import { defineTspConfig, runTspPluginPipeline } from '../../plugin/index.js'
import { pluginRpc } from '../../plugin/plugins/rpc.js'
import { generateRpcModule } from '../../rpc/generate-rpc-module.js'

const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(directory)
  return directory
}

/** Type-checks a generated module, resolving its `RpcContract` import to `@oa-sdk/surface-ir`. */
function typeCheck(moduleSource: string, usage: string): string[] {
  const directory = tempDir('oa-sdk-rpc-module-')
  // The contract literal is checked against the real RpcContract type.
  const surfaceIrTypes = join(workspaceRoot, 'packages', 'surface-ir', 'dist', 'index.js')
  writeFileSync(join(directory, 'rpc-runtime.ts'), `export type { RpcContract } from ${JSON.stringify(surfaceIrTypes)}\n`)
  writeFileSync(join(directory, 'rpc.ts'), moduleSource)
  writeFileSync(join(directory, 'usage.ts'), usage)
  const program = ts.createProgram([join(directory, 'rpc.ts'), join(directory, 'usage.ts')], {
    strict: true,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    types: [],
  })
  return ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('pluginRpc', () => {
  it('emits procedure types and contract data from a TypeSpec program with @rpc names', async () => {
    const directory = tempDir('oa-sdk-rpc-plugin-')
    const nodeModules = join(directory, 'node_modules')
    mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
    symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
    symlinkSync(join(workspaceRoot, 'packages', 'typespec-decorators'), join(nodeModules, '@oa-sdk', 'typespec-decorators'), 'dir')
    writeFileSync(join(directory, 'main.tsp'), `
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Todo Service" })
namespace Todos;

model Todo {
  id: int32;
  title: string;
  done: boolean;
}

model NotFound {
  @statusCode statusCode: 404;
  code: string;
  message: string;
}

@tag("Todo Items")
@route("/todos")
interface TodoItems {
  @get
  @summary("List todos")
  list(@query done?: boolean, @query limit?: int32): Todo[];

  @get
  get(@path id: int32): Todo | NotFound;

  @post
  @rpc(#{ serviceName: "TodoService", methodName: "Create" })
  create(@body todo: { title: string }): { @statusCode statusCode: 201; @body todo: Todo };

  @delete
  remove(@path id: int32): { @statusCode statusCode: 204 };
}
`)

    const result = await runTspPluginPipeline(defineTspConfig({
      input: join(directory, 'main.tsp'),
      outputDir: join(directory, 'generated'),
      plugins: [pluginRpc({ name: 'todo', runtimeImport: './rpc-runtime.js' })],
      dryRun: true,
    }))

    expect(result.success).toBe(true)
    const file = result.files.find(candidate => candidate.path === 'rpc.ts')!
    expect(file.exports).toEqual(['TodoProcedures', 'todoContract'])
    expect([...file.metadata?.procedures as string[]].sort()).toEqual([
      'TodoService.Create',
      'todoItems.TodoItems_get',
      'todoItems.TodoItems_list',
      'todoItems.TodoItems_remove',
    ])
    expect(file.content).toContain("'TodoService.Create': {")
    expect(file.content).toContain('  /**\n   * List todos\n   * GET /todos\n   */\n')
    expect(typeCheck(file.content, `
import { todoContract, type TodoProcedures } from './rpc.js'
type Create = TodoProcedures['TodoService.Create']
const input: Create['input'] = { title: 'write tests' }
const output: Create['output'] = { id: 1, title: input.title, done: false }
const list: TodoProcedures['todoItems.TodoItems_list']['input'] = { done: true, limit: 10 }
const removed: TodoProcedures['todoItems.TodoItems_remove']['output'] = undefined
// @ts-expect-error id is required
const missing: TodoProcedures['todoItems.TodoItems_get']['input'] = {}
export { input, output, list, removed, missing, todoContract }
`)).toEqual([])
  })
})

describe('generateRpcModule', () => {
  it('declares component types that procedure schemas still reference', () => {
    const document = parseDocument({
      openapi: '3.2.0',
      info: { title: 'Tree', version: '1.0.0' },
      paths: {
        '/tree': {
          get: { operationId: 'getTree', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } } },
        },
      },
    } as unknown as OasDocument)
    const contract = buildRpcContract(document)
    // A contract from another producer may keep recursive types as references.
    contract.procedures.getTree!.output = { $ref: '#/components/schemas/Node' }
    contract.schemas = {
      Node: {
        type: 'object',
        description: 'A tree node',
        required: ['children'],
        properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } },
      },
      Unused: { type: 'string' },
    }
    const source = generateRpcModule(contract, { runtimeImport: './rpc-runtime.js', banner: false })

    expect(source).toContain('/** A tree node */\nexport type Node = {')
    expect(source).not.toContain('Unused =')
    expect(source).toContain("  'getTree': {\n    input: Record<string, never>")
    expect(typeCheck(source, `
import type { ApiProcedures } from './rpc.js'
const tree: ApiProcedures['getTree']['output'] = { children: [{ children: [] }] }
export { tree }
`)).toEqual([])
  })

  it('defaults runtimeImport to public @oa-sdk/surface-ir instead of private @oa-sdk/rpc', () => {
    const document = parseDocument({
      openapi: '3.2.0',
      info: { title: 'Ping', version: '1.0.0' },
      paths: {
        '/ping': {
          get: { operationId: 'ping', responses: { '204': { description: 'ok' } } },
        },
      },
    } as unknown as OasDocument)
    const contract = buildRpcContract(document)
    const source = generateRpcModule(contract)
    expect(source).toContain("import type { RpcContract } from '@oa-sdk/surface-ir'")
    expect(source).not.toContain("from '@oa-sdk/rpc'")
  })
})
