import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { compile, NodeHost, type Namespace, type Program, type Type } from '@typespec/compiler'
import { unsafe_mutateSubgraphWithNamespace, type unsafe_MutatorWithNamespace } from '@typespec/compiler/experimental'
import { getExtensions } from '@typespec/openapi'
import { afterEach, describe, expect, it } from 'vitest'

const workspaceRoot = resolve(import.meta.dirname, '../../..')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type CompileResult = { ok: true } | { ok: false; output: string }

/** A temporary project that resolves `@typespec/*` and this package like a consumer would. */
function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-traceid-fixture-'))
  tmpDirs.push(directory)
  const nodeModules = join(directory, 'node_modules')
  mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
  symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
  symlinkSync(join(workspaceRoot, 'packages', 'typespec-decorators'), join(nodeModules, '@oa-sdk', 'typespec-decorators'), 'dir')
  return directory
}

/** Compiles `body` with the real TypeSpec compiler against this package (no emitters). */
function compileTypeSpec(body: string): CompileResult {
  const directory = fixtureDirectory()
  writeFileSync(join(directory, 'main.tsp'), `
import "@oa-sdk/typespec-decorators/governance";

using OaSdkTypeSpec;

namespace TraceIdFixture;
${body}
`)
  try {
    execFileSync(
      join(workspaceRoot, 'node_modules', '.bin', 'tsp'),
      ['compile', join(directory, 'main.tsp'), '--no-emit'],
      { cwd: directory, encoding: 'utf8', stdio: 'pipe' },
    )
    return { ok: true }
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; message: string }
    return { ok: false, output: `${failure.message}\n${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('@traceId uniqueness through the TypeSpec compiler', () => {
  it('compiles `model Derived is Base` when Base carries @traceId (documented @derivedFrom lineage)', () => {
    const result = compileTypeSpec(`
@traceId("TRC-BASE-001")
model Base { id: string; }

@derivedFrom("Base", "Specialized contract")
model Derived is Base { level: int32; }
`)
    expect(result).toEqual({ ok: true })
  }, 30_000)

  it('compiles a @traceId template instantiated more than once', () => {
    const result = compileTypeSpec(`
@traceId("TRC-PAGE-001")
model Page<T> { items: T[]; }

model User { id: string; }
model Order { id: string; }

model Listing {
  users: Page<User>;
  orders: Page<Order>;
}
`)
    expect(result).toEqual({ ok: true })
  }, 30_000)

  it('compiles a spread of a model whose property carries @traceId', () => {
    const result = compileTypeSpec(`
model Base {
  @traceId("TRC-PROP-001")
  id: string;
}

model Other {
  ...Base;
  extra: int32;
}
`)
    expect(result).toEqual({ ok: true })
  }, 30_000)

  it('rejects the same id written on two separate declarations', () => {
    const result = compileTypeSpec(`
@traceId("TRC-DUP-001")
model First { id: string; }

@traceId("TRC-DUP-001")
model Second { id: string; }
`)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.output).toContain('Duplicate traceId "TRC-DUP-001"')
  }, 30_000)
})

type JsonObject = { [key: string]: unknown }

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function child(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) current = isJsonObject(current) ? current[key] : undefined
  return current
}

/** Compiles `source` (a whole main.tsp) through `@typespec/openapi3` and returns the JSON document. */
function emitOpenApi(source: string): JsonObject {
  const directory = fixtureDirectory()
  writeFileSync(join(directory, 'main.tsp'), source)
  const outputDirectory = join(directory, 'out')
  execFileSync(
    join(workspaceRoot, 'node_modules', '.bin', 'tsp'),
    [
      'compile', join(directory, 'main.tsp'),
      '--emit', '@typespec/openapi3',
      '--option', '@typespec/openapi3.file-type=json',
      '--output-dir', outputDirectory,
    ],
    { cwd: directory, encoding: 'utf8', stdio: 'pipe' },
  )
  const document: unknown = JSON.parse(readFileSync(join(outputDirectory, '@typespec', 'openapi3', 'openapi.json'), 'utf8'))
  if (!isJsonObject(document)) throw new Error('openapi3 did not emit a JSON object')
  return document
}

/** Every derived-type form TypeSpec replays a declaration's decorators onto. */
const TRACE_ID_DERIVED_TYPES_TSP = `
import "@typespec/http";
import "@oa-sdk/typespec-decorators/governance";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Trace id copies" })
namespace TraceIdCopies;

@traceId("TRC-BASE-001")
model Base {
  @traceId("TRC-BASE-ID-001")
  id: string;
}

@derivedFrom("Base", "Specialized contract")
model Derived is Base { level: int32; }

@traceId("TRC-OWN-DERIVED-001")
model OwnDerived is Base { tier: int32; }

model Spread { ...Base; extra: int32; }

@friendlyName("{name}Page", T)
@traceId("TRC-PAGE-001")
model Page<T> { items: T[]; }

@traceId("TRC-BASE-PAGE-001")
model BasePage is Page<Base>;

@route("/bases")
interface Bases {
  @traceId("TRC-LIST-BASES-001")
  @get list(): Base[];
}

@route("/v2/bases")
interface BasesV2 extends Bases {}

@route("/catalog")
@get op catalog(): {
  derived: Derived;
  own: OwnDerived;
  spread: Spread;
  derivedPage: Page<Derived>;
  spreadPage: Page<Spread>;
  basePage: BasePage;
};
`

describe('@traceId in the emitted OpenAPI document', () => {
  it('puts each trackingId only on the declaration it is written on, never on a derived type', () => {
    const document = emitOpenApi(TRACE_ID_DERIVED_TYPES_TSP)
    const schemas = child(document, 'components', 'schemas')
    const trackingId = (...keys: string[]): unknown => child(schemas, ...keys, 'x-oa-sdk-trace', 'trackingId')

    expect(trackingId('Base')).toBe('TRC-BASE-001')
    expect(trackingId('Base', 'properties', 'id')).toBe('TRC-BASE-ID-001')
    // `is` copies: Derived keeps its @derivedFrom lineage but not Base's id.
    expect(child(schemas, 'Derived', 'x-oa-sdk-trace')).toEqual({
      derivedFrom: { baseSymbol: 'Base', reason: 'Specialized contract' },
    })
    expect(trackingId('Derived', 'properties', 'id')).toBeUndefined()
    expect(trackingId('OwnDerived')).toBe('TRC-OWN-DERIVED-001')
    // Spread property copies.
    expect(trackingId('Spread', 'properties', 'id')).toBeUndefined()
    // Template instances, and a named instance with its own id.
    expect(child(schemas, 'DerivedPage')).toBeDefined()
    expect(trackingId('DerivedPage')).toBeUndefined()
    expect(trackingId('SpreadPage')).toBeUndefined()
    expect(trackingId('BasePage')).toBe('TRC-BASE-PAGE-001')
    // Operations cloned by `interface BasesV2 extends Bases`.
    expect(child(document, 'paths', '/bases', 'get', 'x-oa-sdk-trace', 'trackingId')).toBe('TRC-LIST-BASES-001')
    expect(child(document, 'paths', '/v2/bases', 'get')).toBeDefined()
    expect(child(document, 'paths', '/v2/bases', 'get', 'x-oa-sdk-trace', 'trackingId')).toBeUndefined()
  }, 60_000)
})

/** Every `x-oa-sdk-trace.trackingId` in `document`, with the JSON pointer of the element carrying it. */
function trackingIdsIn(document: unknown): Array<{ pointer: string; trackingId: unknown }> {
  const found: Array<{ pointer: string; trackingId: unknown }> = []
  const visit = (value: unknown, pointer: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pointer}/${index}`))
      return
    }
    if (!isJsonObject(value)) return
    const trace = value['x-oa-sdk-trace']
    if (isJsonObject(trace) && trace.trackingId !== undefined) found.push({ pointer, trackingId: trace.trackingId })
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'x-oa-sdk-trace') visit(item, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)
    }
  }
  visit(document, '#')
  return found
}

/**
 * `@@traceId` statements naming members TypeSpec copied: a spread-copied property, an
 * `is`-copied property, an operation cloned by `interface ... extends`, `op ... is` parameter
 * copies (of a plain operation and of a template instance, also inside an interface), and a
 * property and an operation copied out of a template instance. Copies are derived again
 * (`...CreateWidget`, `is WidgetV2`, `extends BasesV2`, `is getWidgetCopy`), so a statement is
 * replayed onto types it does not name.
 */
const TRACE_ID_AUGMENT_COPIES_TSP = `
import "@typespec/http";
import "@oa-sdk/typespec-decorators/governance";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Trace id augments" })
namespace TraceIdAugments;

model Widget { name: string; size: int32; }

model CreateWidget { ...Widget; }
model CreateWidgetCopy { ...CreateWidget; }
@@traceId(CreateWidget.name, "TRC-CREATE-NAME-001");

model WidgetV2 is Widget { extra: int32; }
model WidgetV3 is WidgetV2;
@@traceId(WidgetV2.size, "TRC-V2-SIZE-001");

model Page<T> { items: T[]; }
model WidgetPage is Page<Widget>;
@@traceId(WidgetPage.items, "TRC-WIDGET-PAGE-ITEMS-001");

@route("/bases")
interface Bases { @get list(): Widget[]; }

@route("/v2/bases")
interface BasesV2 extends Bases {}

@route("/v3/bases")
interface BasesV3 extends BasesV2 {}
@@traceId(BasesV2.list, "TRC-V2-LIST-001");

interface Store<T> { @get read(): T; }

@route("/widget-store")
interface WidgetStore extends Store<Widget> {}
@@traceId(WidgetStore.read, "TRC-WIDGET-STORE-READ-001");

@route("/widgets/{id}") @get op getWidget(@path id: string): Widget;
@route("/copies/{id}") @get op getWidgetCopy is getWidget;
@route("/copies-v2/{id}") op getWidgetCopyV2 is getWidgetCopy;
@@traceId(getWidgetCopy::parameters.id, "TRC-COPY-ID-001");

@get op getT<T>(@path id: string): T;
@route("/template-copies/{id}") op getWidgetTemplateCopy is getT<Widget>;
@route("/template-copies-v2/{id}") op getWidgetTemplateCopyV2 is getWidgetTemplateCopy;
@@traceId(getWidgetTemplateCopy::parameters.id, "TRC-TEMPLATE-COPY-ID-001");

interface WidgetOps { @route("/widget-ops/{id}") read is getT<Widget>; }
@@traceId(WidgetOps.read::parameters.id, "TRC-WIDGET-OPS-READ-ID-001");

@route("/catalog")
@get op catalog(): {
  create: CreateWidget;
  createCopy: CreateWidgetCopy;
  v2: WidgetV2;
  v3: WidgetV3;
  page: WidgetPage;
  pageOfWidget: Page<Widget>;
};
`

describe('@@traceId naming a member TypeSpec copied', () => {
  it('puts the trackingId on the copy the augment names, not on its source or on a type derived from it', () => {
    const document = emitOpenApi(TRACE_ID_AUGMENT_COPIES_TSP)
    const schemas = child(document, 'components', 'schemas')
    const trackingId = (...keys: string[]): unknown => child(schemas, ...keys, 'x-oa-sdk-trace', 'trackingId')
    const operationTrackingId = (path: string): unknown => child(document, 'paths', path, 'get', 'x-oa-sdk-trace', 'trackingId')
    const parameterTrackingIds = (path: string): unknown => {
      const parameters = child(document, 'paths', path, 'get', 'parameters')
      return Array.isArray(parameters) ? parameters.map(parameter => child(parameter, 'x-oa-sdk-trace', 'trackingId')) : parameters
    }

    // Spread-copied property: CreateWidget.name, not Widget.name or CreateWidgetCopy.name.
    expect(trackingId('CreateWidget', 'properties', 'name')).toBe('TRC-CREATE-NAME-001')
    expect(trackingId('Widget', 'properties', 'name')).toBeUndefined()
    expect(trackingId('CreateWidgetCopy', 'properties', 'name')).toBeUndefined()
    // `is`-copied property: WidgetV2.size, not Widget.size or WidgetV3.size.
    expect(trackingId('WidgetV2', 'properties', 'size')).toBe('TRC-V2-SIZE-001')
    expect(trackingId('Widget', 'properties', 'size')).toBeUndefined()
    expect(trackingId('WidgetV3', 'properties', 'size')).toBeUndefined()
    // Property `is`-copied out of a template instance: concrete in WidgetPage, absent from Page<Widget>.
    expect(trackingId('WidgetPage', 'properties', 'items')).toBe('TRC-WIDGET-PAGE-ITEMS-001')
    // Operation cloned by `interface BasesV2 extends Bases`: not Bases.list or BasesV3.list.
    expect(operationTrackingId('/v2/bases')).toBe('TRC-V2-LIST-001')
    expect(operationTrackingId('/bases')).toBeUndefined()
    expect(operationTrackingId('/v3/bases')).toBeUndefined()
    // Operation cloned out of a template instance: concrete in WidgetStore.
    expect(operationTrackingId('/widget-store')).toBe('TRC-WIDGET-STORE-READ-001')
    // `op getWidgetCopy is getWidget` parameter copy: not getWidget's own parameter, nor the
    // parameter of `op getWidgetCopyV2 is getWidgetCopy`.
    expect(parameterTrackingIds('/copies/{id}')).toEqual(['TRC-COPY-ID-001'])
    expect(parameterTrackingIds('/widgets/{id}')).toEqual([undefined])
    expect(parameterTrackingIds('/copies-v2/{id}')).toEqual([undefined])
    // `op ... is getT<Widget>` parameter copies, at the namespace and inside an interface: the
    // copied parameters keep the syntax node of the template getT<T>, yet the copy is concrete.
    expect(parameterTrackingIds('/template-copies/{id}')).toEqual(['TRC-TEMPLATE-COPY-ID-001'])
    expect(parameterTrackingIds('/template-copies-v2/{id}')).toEqual([undefined])
    expect(parameterTrackingIds('/widget-ops/{id}')).toEqual(['TRC-WIDGET-OPS-READ-ID-001'])

    // As `oa-gen trace --verify` requires, no two elements share a trackingId.
    const ids = trackingIdsIn(document)
    expect(ids.map(entry => entry.trackingId).sort()).toEqual([
      'TRC-COPY-ID-001',
      'TRC-CREATE-NAME-001',
      'TRC-TEMPLATE-COPY-ID-001',
      'TRC-V2-LIST-001',
      'TRC-V2-SIZE-001',
      'TRC-WIDGET-OPS-READ-ID-001',
      'TRC-WIDGET-PAGE-ITEMS-001',
      'TRC-WIDGET-STORE-READ-001',
    ])
  }, 60_000)

  it('carries an augment of a template declaration on no template instance, without diagnostics', () => {
    // Before: resolving `Page` without template arguments reported invalid-template-args.
    const document = emitOpenApi(`
import "@typespec/http";
import "@oa-sdk/typespec-decorators/governance";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Trace id template augments" })
namespace TraceIdTemplateAugments;

model Widget { name: string; }

@friendlyName("{name}Page", T)
model Page<T> { items: T[]; }
@@traceId(Page, "TRC-PAGE-001");
@@traceId(Page.items, "TRC-PAGE-ITEMS-001");

@friendlyName("{name}Box", T)
model Box<T> { ...Widget; value: T; }
@@traceId(Box.name, "TRC-BOX-NAME-001");

@route("/listing")
@get op listing(): { widgets: Page<Widget>; names: Page<string>; box: Box<int32> };

model Gadget { name: string; }
@get op getT<T>(@path id: string): T;

// A template operation copying a template instance, instantiated twice.
op getCopyT<U> is getT<U>;
@@traceId(getCopyT::parameters.id, "TRC-COPY-T-ID-001");
@route("/copy-t/widget/{id}") op getWidgetCopy is getCopyT<Widget>;
@route("/copy-t/gadget/{id}") op getGadgetCopy is getCopyT<Gadget>;

// An operation of a template interface; the interface extending an instance shares its parameters.
interface Ops<T> { read is getT<T>; }
@@traceId(Ops.read::parameters.id, "TRC-OPS-T-READ-ID-001");
@route("/widget-ops") interface WidgetOps extends Ops<Widget> {}

// A template operation copying a plain operation: the copied parameters' node lies in no template.
@route("/plain/{id}") @get op getPlain(@path id: string): Widget;
op getPlainCopyT<U> is getPlain;
@@traceId(getPlainCopyT::parameters.id, "TRC-PLAIN-COPY-T-ID-001");
@route("/plain-copy-t/widget/{id}") op getPlainWidget is getPlainCopyT<Widget>;
@route("/plain-copy-t/gadget/{id}") op getPlainGadget is getPlainCopyT<Gadget>;

// A spread into the signature of a template operation.
op createT<T>(...Widget, @query extra: T): void;
@@traceId(createT::parameters.name, "TRC-CREATE-T-NAME-001");
@route("/create") @post op createWidget is createT<string>;
`)
    const schemas = child(document, 'components', 'schemas')
    for (const name of ['WidgetPage', 'stringPage', 'int32Box']) expect(child(schemas, name), name).toBeDefined()
    for (const path of ['/copy-t/widget/{id}', '/copy-t/gadget/{id}', '/widget-ops/{id}', '/plain-copy-t/widget/{id}', '/plain-copy-t/gadget/{id}', '/create']) {
      expect(child(document, 'paths', path), path).toBeDefined()
    }
    expect(trackingIdsIn(document)).toEqual([])
  }, 60_000)
})

/**
 * A service using every form that reaches a `@traceId` application: declarations (model,
 * property, nested anonymous property, operation, operation parameter, interface operation)
 * and the types TypeSpec derives from them.
 */
const TRACE_ID_MUTATION_TSP = `
import "@typespec/http";
import "@oa-sdk/typespec-decorators/governance";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Trace id snapshots" })
namespace TraceIdSnapshots;

@traceId("TRC-PART-001")
model Part { @traceId("TRC-PART-LABEL-001") label: string; }

@traceId("TRC-WIDGET-001")
model Widget {
  @traceId("TRC-WIDGET-NAME-001") name: string;
  part: Part;
  inline: { @traceId("TRC-WIDGET-INLINE-001") deep: string };
}

model Derived is Widget { level: int32; }
model Spread { ...Widget; extra: int32; }

@traceId("TRC-PAGE-001")
model Page<T> { @traceId("TRC-PAGE-ITEMS-001") items: T[]; }

model Listing { widgets: Page<Widget>; }

@traceId("TRC-GET-WIDGET-001")
@route("/widgets/{id}") @get op getWidget(@traceId("TRC-GET-WIDGET-ID-001") @path id: string): Widget;

@route("/copies/{id}") @get op getWidgetCopy is getWidget;

@route("/bases")
interface Bases {
  @traceId("TRC-LIST-BASES-001")
  @get list(): Widget[];
}

@route("/v2/bases")
interface BasesV2 extends Bases {}

@route("/listing") @get op listing(): { listing: Listing; derived: Derived; spread: Spread };
`

/** Same shape as a `@typespec/versioning` snapshot mutator: it clones every type of the service namespace. */
const VERSION_SNAPSHOT_SHAPE: unsafe_MutatorWithNamespace = {
  name: 'version-snapshot-shape',
  Namespace: { mutate: () => {} },
  Model: { mutate: () => {} },
  ModelProperty: { mutate: () => {} },
  Operation: { mutate: () => {} },
  Interface: { mutate: () => {} },
}

async function compileProgram(source: string): Promise<Program> {
  const directory = fixtureDirectory()
  writeFileSync(join(directory, 'main.tsp'), source)
  return compile(NodeHost, join(directory, 'main.tsp'), { noEmit: true })
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`)
  return value
}

/** The types a `@traceId` application of TRACE_ID_MUTATION_TSP reaches, as seen from `service`. */
function traceTargets(service: Namespace): Record<string, Type> {
  const model = (name: string) => required(service.models.get(name), name)
  const property = (owner: Type, name: string) => {
    if (owner.kind !== 'Model') throw new Error(`${name}: owner is a ${owner.kind}`)
    return required(owner.properties.get(name), name)
  }
  const operation = (name: string) => required(service.operations.get(name), name)
  const interfaceOperation = (owner: string, name: string) =>
    required(required(service.interfaces.get(owner), owner).operations.get(name), `${owner}.${name}`)
  const widget = model('Widget')
  const page = property(model('Listing'), 'widgets').type
  return {
    Part: model('Part'),
    'Part.label': property(model('Part'), 'label'),
    Widget: widget,
    'Widget.name': property(widget, 'name'),
    'Widget.inline.deep': property(property(widget, 'inline').type, 'deep'),
    getWidget: operation('getWidget'),
    'getWidget(id)': property(operation('getWidget').parameters, 'id'),
    'Bases.list': interfaceOperation('Bases', 'list'),
    // Derived types: none of them carries the id.
    Derived: model('Derived'),
    'Derived.name': property(model('Derived'), 'name'),
    Spread: model('Spread'),
    'Spread.name': property(model('Spread'), 'name'),
    'Page<Widget>': page,
    'Page<Widget>.items': property(page, 'items'),
    getWidgetCopy: operation('getWidgetCopy'),
    'getWidgetCopy(id)': property(operation('getWidgetCopy').parameters, 'id'),
    'BasesV2.list': interfaceOperation('BasesV2', 'list'),
  }
}

function trackingIds(program: Program, targets: Record<string, Type>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(targets).map(([label, type]) => {
    const trace = getExtensions(program, type).get('x-oa-sdk-trace')
    return [label, isJsonObject(trace) ? trace.trackingId : undefined]
  }))
}

describe('@traceId on types cloned by a mutator', () => {
  it('keeps each trackingId on the clone of its declaration, as in a versioned snapshot', async () => {
    const program = await compileProgram(TRACE_ID_MUTATION_TSP)
    expect(program.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
    const service = required(program.getGlobalNamespaceType().namespaces.get('TraceIdSnapshots'), 'service namespace')
    const snapshot = unsafe_mutateSubgraphWithNamespace(program, [VERSION_SNAPSHOT_SHAPE], service).type
    if (snapshot.kind !== 'Namespace') throw new Error(`snapshot is a ${snapshot.kind}`)

    const originals = traceTargets(service)
    const clones = traceTargets(snapshot)
    // The snapshot is made of clones, not of the original types.
    for (const label of Object.keys(originals)) expect(clones[label], label).not.toBe(originals[label])

    const expected = {
      Part: 'TRC-PART-001',
      'Part.label': 'TRC-PART-LABEL-001',
      Widget: 'TRC-WIDGET-001',
      'Widget.name': 'TRC-WIDGET-NAME-001',
      'Widget.inline.deep': 'TRC-WIDGET-INLINE-001',
      getWidget: 'TRC-GET-WIDGET-001',
      'getWidget(id)': 'TRC-GET-WIDGET-ID-001',
      'Bases.list': 'TRC-LIST-BASES-001',
      Derived: undefined,
      'Derived.name': undefined,
      Spread: undefined,
      'Spread.name': undefined,
      'Page<Widget>': undefined,
      'Page<Widget>.items': undefined,
      getWidgetCopy: undefined,
      'getWidgetCopy(id)': undefined,
      'BasesV2.list': undefined,
    }
    expect(trackingIds(program, originals)).toEqual(expected)
    expect(trackingIds(program, clones)).toEqual(expected)
    expect(program.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  }, 60_000)

  it('keeps an augment id on the clone of the copy it names, as in a versioned snapshot', async () => {
    const program = await compileProgram(TRACE_ID_AUGMENT_COPIES_TSP)
    expect(program.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
    const service = required(program.getGlobalNamespaceType().namespaces.get('TraceIdAugments'), 'service namespace')
    const snapshot = unsafe_mutateSubgraphWithNamespace(program, [VERSION_SNAPSHOT_SHAPE], service).type
    if (snapshot.kind !== 'Namespace') throw new Error(`snapshot is a ${snapshot.kind}`)

    const targets = (namespace: Namespace): Record<string, Type> => {
      const model = (name: string) => required(namespace.models.get(name), name)
      const property = (owner: Type, name: string) => {
        if (owner.kind !== 'Model') throw new Error(`${name}: owner is a ${owner.kind}`)
        return required(owner.properties.get(name), name)
      }
      const operation = (name: string) => required(namespace.operations.get(name), name)
      const interfaceOperation = (owner: string, name: string) =>
        required(required(namespace.interfaces.get(owner), owner).operations.get(name), `${owner}.${name}`)
      return {
        'CreateWidget.name': property(model('CreateWidget'), 'name'),
        'WidgetV2.size': property(model('WidgetV2'), 'size'),
        'WidgetPage.items': property(model('WidgetPage'), 'items'),
        'BasesV2.list': interfaceOperation('BasesV2', 'list'),
        'WidgetStore.read': interfaceOperation('WidgetStore', 'read'),
        'getWidgetCopy(id)': property(operation('getWidgetCopy').parameters, 'id'),
        'getWidgetTemplateCopy(id)': property(operation('getWidgetTemplateCopy').parameters, 'id'),
        'WidgetOps.read(id)': property(interfaceOperation('WidgetOps', 'read').parameters, 'id'),
        // The sources of the named copies, and types derived from the named copies.
        'Widget.name': property(model('Widget'), 'name'),
        'CreateWidgetCopy.name': property(model('CreateWidgetCopy'), 'name'),
        'Widget.size': property(model('Widget'), 'size'),
        'WidgetV3.size': property(model('WidgetV3'), 'size'),
        'Bases.list': interfaceOperation('Bases', 'list'),
        'BasesV3.list': interfaceOperation('BasesV3', 'list'),
        'getWidget(id)': property(operation('getWidget').parameters, 'id'),
        'getWidgetCopyV2(id)': property(operation('getWidgetCopyV2').parameters, 'id'),
        'getT<Widget>(id)': property(required(operation('getWidgetTemplateCopy').sourceOperation, 'getT<Widget>').parameters, 'id'),
        'getWidgetTemplateCopyV2(id)': property(operation('getWidgetTemplateCopyV2').parameters, 'id'),
      }
    }
    const originals = targets(service)
    const clones = targets(snapshot)
    for (const label of Object.keys(originals)) expect(clones[label], label).not.toBe(originals[label])

    const expected = {
      'CreateWidget.name': 'TRC-CREATE-NAME-001',
      'WidgetV2.size': 'TRC-V2-SIZE-001',
      'WidgetPage.items': 'TRC-WIDGET-PAGE-ITEMS-001',
      'BasesV2.list': 'TRC-V2-LIST-001',
      'WidgetStore.read': 'TRC-WIDGET-STORE-READ-001',
      'getWidgetCopy(id)': 'TRC-COPY-ID-001',
      'getWidgetTemplateCopy(id)': 'TRC-TEMPLATE-COPY-ID-001',
      'WidgetOps.read(id)': 'TRC-WIDGET-OPS-READ-ID-001',
      'Widget.name': undefined,
      'CreateWidgetCopy.name': undefined,
      'Widget.size': undefined,
      'WidgetV3.size': undefined,
      'Bases.list': undefined,
      'BasesV3.list': undefined,
      'getWidget(id)': undefined,
      'getWidgetCopyV2(id)': undefined,
      'getT<Widget>(id)': undefined,
      'getWidgetTemplateCopyV2(id)': undefined,
    }
    expect(trackingIds(program, originals)).toEqual(expected)
    expect(trackingIds(program, clones)).toEqual(expected)
    expect(program.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  }, 60_000)

  it('keeps the ids on the MergePatchUpdate<T> variants built from mutator clones (documented known limit)', () => {
    const document = emitOpenApi(`
import "@typespec/http";
import "@oa-sdk/typespec-decorators/governance";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Merge patch" })
namespace MergePatch;

@traceId("TRC-PART-001")
model Part { @traceId("TRC-PART-LABEL-001") label: string; }

@traceId("TRC-WIDGET-001")
model Widget { @traceId("TRC-WIDGET-NAME-001") name: string; part: Part; }

@route("/widgets/{id}") @get op getWidget(@path id: string): Widget;
@route("/widgets/{id}") @patch(#{ implicitOptionality: false })
op updateWidget(@path id: string, @body body: MergePatchUpdate<Widget>): Widget;
`)
    const schemas = child(document, 'components', 'schemas')
    const trackingId = (...keys: string[]): unknown => child(schemas, ...keys, 'x-oa-sdk-trace', 'trackingId')

    for (const [name, id, label] of [
      ['Widget', 'TRC-WIDGET-001', 'TRC-WIDGET-NAME-001'],
      ['WidgetMergePatchUpdate', 'TRC-WIDGET-001', 'TRC-WIDGET-NAME-001'],
    ] as const) {
      expect(trackingId(name), name).toBe(id)
      expect(trackingId(name, 'properties', 'name'), name).toBe(label)
    }
    for (const name of ['Part', 'PartMergePatchUpdate']) {
      expect(trackingId(name), name).toBe('TRC-PART-001')
      expect(trackingId(name, 'properties', 'label'), name).toBe('TRC-PART-LABEL-001')
    }

    // The clones carry the declaration they were built from, so `oa-gen trace` can tell a
    // variant sharing an id from two independent declarations colliding.
    const declarationId = (...keys: string[]): unknown => child(schemas, ...keys, 'x-oa-sdk-trace', 'declarationId')
    expect(declarationId('Widget')).toMatch(/^tsd_[0-9a-f]{16}$/)
    expect(declarationId('WidgetMergePatchUpdate')).toBe(declarationId('Widget'))
    expect(declarationId('PartMergePatchUpdate')).toBe(declarationId('Part'))
    expect(declarationId('Widget')).not.toBe(declarationId('Part'))
  }, 60_000)
})
