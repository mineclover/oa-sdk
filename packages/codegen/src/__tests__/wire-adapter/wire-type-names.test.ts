import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { generateTypesFromSpec } from '../../typegen/generate-types.js'
import {
  extractWireSchemaFromOas,
  MessagePackTargetAdapter,
  ProtobufCodecTargetAdapter,
  RpcContractTargetAdapter,
} from '../../wire-adapter/index.js'

const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
const codecTypesModule = join(workspaceRoot, 'packages', 'client', 'src', 'codec', 'codec-types')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const protobufContent = (name: string) => ({ content: { 'application/x-protobuf': { schema: ref(name) } } })

/** TypeSpec names components of sub-namespace models with dots; one key collides once cleaned. */
const namespacedDocument = {
  openapi: '3.1.0',
  info: { title: 'Shop', version: '1.0.0' },
  paths: {
    '/widgets/{id}': {
      put: {
        operationId: 'putWidget',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, ...protobufContent('InventoryWidget') },
        responses: { '200': { description: 'ok', ...protobufContent('Inventory.Widget') } },
      },
    },
  },
  components: {
    schemas: {
      'Inventory.Color': { type: 'string', enum: ['red', 'blue'] },
      'Inventory.Widget': {
        type: 'object',
        required: ['id', 'color'],
        properties: { id: { type: 'string' }, color: ref('Inventory.Color'), parts: { type: 'array', items: ref('InventoryWidget') } },
      },
      InventoryWidget: { type: 'object', required: ['count'], properties: { count: { type: 'integer', format: 'int32' } } },
    },
  },
} as unknown as OasDocument

const compilerOptions: ts.CompilerOptions = {
  strict: true,
  exactOptionalPropertyTypes: true,
  noEmit: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [],
}

function diagnosticsOf(files: Record<string, string>): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-wire-names-'))
  tmpDirs.push(directory)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content)
  const program = ts.createProgram(Object.keys(files).map(name => join(directory, name)), compilerOptions)
  return ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const file = diagnostic.file ? `${diagnostic.file.fileName.slice(directory.length + 1)}: ` : ''
    return file + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  })
}

describe('Wire TypeScript names for component keys that are not identifiers', () => {
  it('uses the types.ts declaration names in every adapter, so the modules compile together', () => {
    const model = extractWireSchemaFromOas(namespacedDocument)
    expect(model.models.map(m => [m.name, m.tsTypeName])).toEqual([['Inventory.Widget', 'InventoryWidget'], ['InventoryWidget', 'InventoryWidget2']])
    expect(model.enums.map(e => [e.name, e.tsTypeName])).toEqual([['Inventory.Color', 'InventoryColor']])

    const typesImport = './types.js'
    const types = generateTypesFromSpec(namespacedDocument, { style: 'type' })
    expect(types).toContain('export type InventoryWidget = {')
    expect(types).toContain('export type InventoryWidget2 = {')

    const clientStub = [
      `export type { BinaryCodecAdapter } from ${JSON.stringify(codecTypesModule)}`,
      `import type { BinaryCodecAdapter } from ${JSON.stringify(codecTypesModule)}`,
      'export declare const messagePackAdapter: BinaryCodecAdapter<unknown>',
    ].join('\n')
    const toStub = (source: string) => source.replaceAll("from '@oa-sdk/client'", "from './client.js'")
    const protobufCodecs = toStub(new ProtobufCodecTargetAdapter().transform(model, { typesImport }))
    const inlineCodecs = toStub(new ProtobufCodecTargetAdapter().transform(model))
    const messagePack = toStub(new MessagePackTargetAdapter().transform(model, { typesImport }))
    const rpc = new RpcContractTargetAdapter().transform(model, { typesImport, clientImport: './client.js' })

    expect(protobufCodecs).toContain("import type { InventoryWidget, InventoryWidget2 } from './types.js'")
    expect(protobufCodecs).toContain('export function encodeInventoryWidget2(payload: InventoryWidget2): Uint8Array')
    expect(inlineCodecs).toContain('export interface InventoryWidget {')
    expect(messagePack).toContain('export const inventoryWidget2MessagePackCodec: BinaryCodecAdapter<InventoryWidget2>')
    expect(rpc).toContain('async putWidget(request: InventoryWidget2, params: ')
    expect(rpc).toContain('Promise<InventoryWidget>')
    // Codecs stay keyed by component name, the way the RPC client looks them up.
    expect(protobufCodecs).toContain('"Inventory.Widget": inventoryWidgetProtobufCodec,')
    expect(rpc).toContain("responseType: 'Inventory.Widget',")

    expect(diagnosticsOf({
      'client.ts': clientStub,
      'types.ts': types,
      'protobuf.ts': protobufCodecs,
      'inline.ts': inlineCodecs,
      'messagepack.ts': messagePack,
      'rpc.ts': rpc,
    })).toEqual([])
  })

  it('keeps colliding components apart at runtime', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-wire-names-run-'))
    tmpDirs.push(directory)
    const source = new ProtobufCodecTargetAdapter().transform(extractWireSchemaFromOas(namespacedDocument))
    const file = join(directory, 'codecs.mjs')
    writeFileSync(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
    const codecs = await import(pathToFileURL(file).href) as Record<string, (value: unknown) => unknown>
    const registry = (codecs.getGeneratedProtobufCodecs as () => Record<string, { encode(value: unknown): Uint8Array; decode(raw: Uint8Array): unknown }>)()

    const widget = { id: 'w', color: 'blue', parts: [{ count: 3 }] }
    expect(Object.keys(registry)).toEqual(['Inventory.Widget', 'InventoryWidget'])
    expect(registry['Inventory.Widget']!.decode(registry['Inventory.Widget']!.encode(widget))).toEqual(widget)
    expect(registry.InventoryWidget!.decode(registry.InventoryWidget!.encode({ count: 9 }))).toEqual({ count: 9 })
  })
})
