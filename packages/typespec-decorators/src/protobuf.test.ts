import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Diagnostic, Interface, Model, Operation, Program } from '@typespec/compiler'
import { createTester, mockFile } from '@typespec/compiler/testing'
import { getExtensions } from '@typespec/openapi'
import { describe, expect, it } from 'vitest'
import * as protobufDecorators from './protobuf.js'

const packageRoot = resolve(import.meta.dirname, '..')

/**
 * Compiles against the real `lib/protobuf.tsp` declarations bound to this source module, so the
 * compiler runs these decorators and `$onValidate` without a build.
 */
const Tester = createTester(packageRoot, { libraries: ['@typespec/http', '@typespec/openapi'] })
  .files({
    'protobuf.tsp': readFileSync(resolve(packageRoot, 'lib', 'protobuf.tsp'), 'utf8')
      .replace('import "../dist/protobuf.js";', 'import "./protobuf.js";'),
    'protobuf.js': mockFile.js({ ...protobufDecorators }),
  })
  .import('@typespec/http', '@typespec/openapi', './protobuf.tsp')
  .using('Http', 'OaSdkTypeSpec')

async function compile(code: string): Promise<{ program: Program; diagnostics: readonly Diagnostic[] }> {
  const [result, diagnostics] = await Tester.compileAndDiagnose(code)
  return { program: result.program, diagnostics }
}

function messages(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
}

function interfaceOf(program: Program, name: string): Interface {
  const found = program.getGlobalNamespaceType().interfaces.get(name)
  if (!found) throw new Error(`interface ${name} not found`)
  return found
}

function operationOf(program: Program, iface: string, name: string): Operation {
  const found = interfaceOf(program, iface).operations.get(name)
  if (!found) throw new Error(`operation ${iface}.${name} not found`)
  return found
}

function modelOf(program: Program, name: string): Model {
  const found = program.getGlobalNamespaceType().models.get(name)
  if (!found) throw new Error(`model ${name} not found`)
  return found
}

describe('@rpc and @wireFormat on an interface', () => {
  it('reach every operation of the interface, and operation values win', async () => {
    const { program, diagnostics } = await compile(`
      @route("/widgets")
      @rpc(#{ serviceName: "WidgetService", streaming: "none" })
      @wireFormat("protobuf")
      interface Widgets {
        @get list(): string[];
        @get @route("/{id}") @rpc(#{ methodName: "Read", serviceName: "Override" }) @wireFormat("json")
        read(@path id: string): string;
      }

      @route("/more")
      interface MoreWidgets extends Widgets {
        @post create(): void;
      }
    `)
    expect(messages(diagnostics)).toEqual([])

    const rpcOf = (iface: string, name: string) => getExtensions(program, operationOf(program, iface, name)).get('x-oa-sdk-rpc')
    const formatOf = (iface: string, name: string) => getExtensions(program, operationOf(program, iface, name)).get('x-oa-sdk-wire-format')
    expect(rpcOf('Widgets', 'list')).toEqual({ serviceName: 'WidgetService', streaming: 'none' })
    expect(rpcOf('Widgets', 'read')).toEqual({ serviceName: 'Override', streaming: 'none', methodName: 'Read' })
    expect(formatOf('Widgets', 'list')).toBe('protobuf')
    expect(formatOf('Widgets', 'read')).toBe('json')

    // An interface without its own @rpc does not pass on the one it extends; operation values stay.
    expect(rpcOf('MoreWidgets', 'list')).toBeUndefined()
    expect(rpcOf('MoreWidgets', 'read')).toEqual({ methodName: 'Read', serviceName: 'Override' })
    expect(rpcOf('MoreWidgets', 'create')).toBeUndefined()
  })

  it('rejects a methodName on an interface, which would name every operation the same', async () => {
    const { program, diagnostics } = await compile(`
      @rpc(#{ methodName: "Same" }) interface Widgets { @get @route("/a") a(): void; @get @route("/b") b(): void; }
    `)
    expect(messages(diagnostics)).toEqual([
      '@oa-sdk/typespec-decorators/invalid-rpc-rule: methodName names a single operation; set it with @rpc on an operation of interface "Widgets", not on the interface.',
    ])
    expect(getExtensions(program, operationOf(program, 'Widgets', 'a')).get('x-oa-sdk-rpc')).toBeUndefined()
  })

  it('reports @protobuf on an interface instead of dropping it', async () => {
    const { diagnostics } = await compile(`
      @protobuf(#{ package: "widgets.v1" }) interface Widgets { @get list(): void; }
    `)
    expect(messages(diagnostics)).toEqual([
      '@oa-sdk/typespec-decorators/invalid-protobuf-rule: @protobuf applies to models, not to interface "Widgets". Put @protobuf on each message model, and @rpc(#{ serviceName }) on the interface.',
    ])
  })
})

describe('@field numbers', () => {
  it('reports a number another field of the model already uses', async () => {
    const { program, diagnostics } = await compile(`
      @protobuf model Widget { @field(1) id: int32; @field(1) name: string; @field(2) size: int32; }
    `)
    expect(messages(diagnostics)).toEqual([
      '@oa-sdk/typespec-decorators/invalid-protobuf-rule: Field number 1 is already used by "id" in model Widget.',
    ])
    expect(diagnostics[0]?.target).toBe(modelOf(program, 'Widget').properties.get('name'))
  })

  it('counts inherited fields and reports each conflict once', async () => {
    const { diagnostics } = await compile(`
      model Resource { @field(1) id: string; @field(2) createdAt: utcDateTime; }
      model Order extends Resource { @field(2) amount: int32; @field(3) note: string; }
      model Page<T> { @field(1) items: T[]; @field(1) next: string; }
      model Orders is Page<Order>;
      model Widgets is Page<string>;
      model Shared { @field(1) shared: string; }
      model First { @field(1) first: string; ...Shared }
      model Second { @field(1) second: string; ...Shared }
    `)
    // `Page`'s conflict reaches each model built from it, but it is one declaration: one report.
    // `Shared` conflicts with a different field in each model that spreads it: one report each.
    expect(messages(diagnostics)).toEqual([
      '@oa-sdk/typespec-decorators/invalid-protobuf-rule: Field number 2 is already used by "createdAt" in model Order.',
      expect.stringMatching(/^@oa-sdk\/typespec-decorators\/invalid-protobuf-rule: Field number 1 is already used by "items" in model (Orders|Widgets)\.$/),
      '@oa-sdk/typespec-decorators/invalid-protobuf-rule: Field number 1 is already used by "first" in model First.',
      '@oa-sdk/typespec-decorators/invalid-protobuf-rule: Field number 1 is already used by "second" in model Second.',
    ])
  })

  it('lets a redeclared inherited property keep or free its number', async () => {
    const { diagnostics } = await compile(`
      @discriminator("kind") model Pet { @field(1) kind: string; @field(2) name: string; }
      model Cat extends Pet { @field(1) kind: "cat"; @field(3) meow: boolean; }
      model Animal { @field(1) kind: string; }
      model Bird extends Animal { @field(3) kind: "bird"; @field(1) wings: int32; }
      model Chick extends Bird { @field(2) age: int32; }
    `)
    expect(messages(diagnostics)).toEqual([])
  })

  it('reports a redeclared property on the number of another inherited field', async () => {
    const { program, diagnostics } = await compile(`
      model Pet { @field(1) kind: string; @field(2) name: string; }
      model Dog extends Pet { @field(2) kind: "dog"; }
      model Puppy extends Dog { @field(3) age: int32; }
    `)
    // Reported once, on Dog's own property; Puppy only inherits the conflict.
    expect(messages(diagnostics)).toEqual([
      '@oa-sdk/typespec-decorators/invalid-protobuf-rule: Field number 2 is already used by "name" in model Dog.',
    ])
    expect(diagnostics[0]?.target).toBe(modelOf(program, 'Dog').properties.get('kind'))
  })

  it('accepts distinct numbers, written as integer values', async () => {
    const { program, diagnostics } = await compile(`
      model Resource { @field(1) id: string; }
      model Order extends Resource { @field(2, #{ type: "sint32" }) amount: int32; @field(536870911) last: string; }
    `)
    expect(messages(diagnostics)).toEqual([])
    const amount = modelOf(program, 'Order').properties.get('amount')!
    expect(getExtensions(program, amount).get('x-oa-sdk-protobuf-field')).toEqual({ index: 2, type: 'sint32' })
  })
})
