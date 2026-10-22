import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { traceCommand } from '../../cli/commands/trace.js'
import { compileTypeSpecInMemory } from '../../cli/lib/typespec-mock-compiler.js'
import { buildSpecTraceabilityGraph } from '../../traceability/index.js'

const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
const tmpDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A temporary TypeSpec project that resolves `@typespec/*` and `@oa-sdk/typespec-decorators`. */
function typeSpecProject(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'oa-trace-typespec-copies-'))
  tmpDirs.push(directory)
  const nodeModules = join(directory, 'node_modules')
  mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
  symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
  symlinkSync(join(workspaceRoot, 'packages', 'typespec-decorators'), join(nodeModules, '@oa-sdk', 'typespec-decorators'), 'dir')
  writeFileSync(join(directory, 'main.tsp'), source)
  return directory
}

// The documented lineage pattern (`@traceId` on Base, `@derivedFrom` + `model Derived is Base`)
// plus every other form TypeSpec replays a declaration's decorators onto.
const DERIVED_TYPES_TSP = `
import "@typespec/http";
import "@oa-sdk/typespec-decorators/governance";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Trace id copies" })
namespace TraceIdCopies;

@traceId("TRC-BASE-001")
model Base { id: string; }

@derivedFrom("Base", "Specialized contract")
model Derived is Base { level: int32; }

@traceId("TRC-DERIVED-001")
model OwnDerived is Base { tier: int32; }

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
  derivedPage: Page<Derived>;
  ownPage: Page<OwnDerived>;
  basePage: BasePage;
};
`

const MERGE_PATCH_TSP = `
import "@typespec/http";
import "@oa-sdk/typespec-decorators/governance";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Merge patch trace" })
namespace MergePatchTrace;

@traceId("TRC-PART-001")
model Part { @traceId("TRC-PART-LABEL-001") label: string; }

@traceId("TRC-WIDGET-001")
model Widget { @traceId("TRC-WIDGET-NAME-001") name: string; part: Part; }

@route("/widgets/{id}") @get op getWidget(@path id: string): Widget;
@route("/widgets/{id}") @patch(#{ implicitOptionality: false })
op updateWidget(@path id: string, @body body: MergePatchUpdate<Widget>): Widget;
`

describe('TypeSpec @traceId copies through the trace gate', () => {
  it('compiles `model Derived is Base` through openapi3 and passes buildSpecTraceabilityGraph without duplicate ids', async () => {
    const directory = typeSpecProject(DERIVED_TYPES_TSP)
    const { document } = await compileTypeSpecInMemory(join(directory, 'main.tsp'))

    const graph = buildSpecTraceabilityGraph({ spec: document })

    expect(graph.diagnostics).toEqual([])
    const tracking = (pointer: string) => {
      const node = graph.nodes[pointer]
      return node ? [node.trackingIdSource, node.trackingIdSource === 'explicit' ? node.trackingId : 'generated'] : undefined
    }
    expect(tracking('#/components/schemas/Base')).toEqual(['explicit', 'TRC-BASE-001'])
    // The `is` copy keeps lineage through @derivedFrom and gets a generated id of its own.
    expect(tracking('#/components/schemas/Derived')).toEqual(['generated', 'generated'])
    expect(tracking('#/components/schemas/OwnDerived')).toEqual(['explicit', 'TRC-DERIVED-001'])
    // Template instances that became components, and a named instance with its own id.
    expect(tracking('#/components/schemas/DerivedPage')).toEqual(['generated', 'generated'])
    expect(tracking('#/components/schemas/OwnDerivedPage')).toEqual(['generated', 'generated'])
    expect(tracking('#/components/schemas/BasePage')).toEqual(['explicit', 'TRC-BASE-PAGE-001'])
    // Operations cloned by `interface BasesV2 extends Bases`.
    expect(tracking('#/paths/~1bases/get')).toEqual(['explicit', 'TRC-LIST-BASES-001'])
    expect(tracking('#/paths/~1v2~1bases/get')).toEqual(['generated', 'generated'])
  }, 60_000)

  it('accepts one id shared by MergePatchUpdate variants of the same declaration', async () => {
    const directory = typeSpecProject(MERGE_PATCH_TSP)
    const { document } = await compileTypeSpecInMemory(join(directory, 'main.tsp'))

    const graph = buildSpecTraceabilityGraph({ spec: document })

    expect(graph.diagnostics).toEqual([])
    const widget = graph.nodes['#/components/schemas/Widget']!
    const patch = graph.nodes['#/components/schemas/WidgetMergePatchUpdate']!
    expect(widget.trackingIdSource).toBe('explicit')
    expect(widget.trackingId).toBe('TRC-WIDGET-001')
    expect(patch.trackingId).toBe('TRC-WIDGET-001')
    expect(widget.declarationId).toMatch(/^tsd_[0-9a-f]{16}$/)
    expect(patch.declarationId).toBe(widget.declarationId)
    // A different declaration has different evidence, so a shared id across these still fails.
    const part = graph.nodes['#/components/schemas/Part']!
    expect(part.declarationId).not.toBe(widget.declarationId)
  }, 60_000)

  it('lets `oa-gen trace --verify` accept the emitted document', async () => {
    const directory = typeSpecProject(DERIVED_TYPES_TSP)
    const { document } = await compileTypeSpecInMemory(join(directory, 'main.tsp'))
    const specPath = join(directory, 'openapi.json')
    writeFileSync(specPath, JSON.stringify(document, null, 2), 'utf-8')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(traceCommand.run({ spec: specPath, verify: true, format: 'json' })).resolves.toBeUndefined()
  }, 60_000)
})

// `@@traceId` statements naming members TypeSpec copied (a spread copy, an `is` copy, operations
// cloned by `interface ... extends`, also out of a template instance, and the parameter an
// `op ... is` copy of a template instance copies), each copy derived again.
const AUGMENTED_COPIES_TSP = `
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

@route("/widget-store-v2")
interface WidgetStoreV2 extends WidgetStore {}
@@traceId(WidgetStore.read, "TRC-WIDGET-STORE-READ-001");

@get op getT<T>(@path id: string): T;
@route("/template-copies/{id}") op getWidgetTemplateCopy is getT<Widget>;
@route("/template-copies-v2/{id}") op getWidgetTemplateCopyV2 is getWidgetTemplateCopy;
@@traceId(getWidgetTemplateCopy::parameters.id, "TRC-TEMPLATE-COPY-ID-001");

@route("/catalog")
@get op catalog(): { create: CreateWidget; createCopy: CreateWidgetCopy; v2: WidgetV2; v3: WidgetV3 };
`

describe('TypeSpec @@traceId on copied members through the trace gate', () => {
  it('puts each id on the copy the augment names and passes buildSpecTraceabilityGraph without duplicate ids', async () => {
    const directory = typeSpecProject(AUGMENTED_COPIES_TSP)
    const { document } = await compileTypeSpecInMemory(join(directory, 'main.tsp'))

    const graph = buildSpecTraceabilityGraph({ spec: document })

    expect(graph.diagnostics).toEqual([])
    const tracking = (pointer: string) => {
      const node = graph.nodes[pointer]
      return node ? [node.trackingIdSource, node.trackingIdSource === 'explicit' ? node.trackingId : 'generated'] : undefined
    }
    // Operations cloned by `interface ... extends`: only the named clone carries the id.
    expect(tracking('#/paths/~1bases/get')).toEqual(['generated', 'generated'])
    expect(tracking('#/paths/~1v2~1bases/get')).toEqual(['explicit', 'TRC-V2-LIST-001'])
    expect(tracking('#/paths/~1v3~1bases/get')).toEqual(['generated', 'generated'])
    expect(tracking('#/paths/~1widget-store/get')).toEqual(['explicit', 'TRC-WIDGET-STORE-READ-001'])
    expect(tracking('#/paths/~1widget-store-v2/get')).toEqual(['generated', 'generated'])
    // Copied properties: the named copy, not its source or a type derived from it.
    const schemas = document.components?.schemas as Record<string, unknown> | undefined
    const propertyTrackingId = (schema: string, property: string): unknown => {
      const definition = schemas?.[schema] as { properties?: Record<string, { 'x-oa-sdk-trace'?: { trackingId?: unknown } }> } | undefined
      return definition?.properties?.[property]?.['x-oa-sdk-trace']?.trackingId
    }
    expect(propertyTrackingId('CreateWidget', 'name')).toBe('TRC-CREATE-NAME-001')
    expect(propertyTrackingId('Widget', 'name')).toBeUndefined()
    expect(propertyTrackingId('CreateWidgetCopy', 'name')).toBeUndefined()
    expect(propertyTrackingId('WidgetV2', 'size')).toBe('TRC-V2-SIZE-001')
    expect(propertyTrackingId('Widget', 'size')).toBeUndefined()
    expect(propertyTrackingId('WidgetV3', 'size')).toBeUndefined()
    // The parameter `op getWidgetTemplateCopy is getT<Widget>` copies: not the parameter of
    // `op getWidgetTemplateCopyV2 is getWidgetTemplateCopy`.
    const parameterTrackingIds = (path: string): unknown[] | undefined => {
      const pathItem = document.paths?.[path] as { get?: { parameters?: Array<{ 'x-oa-sdk-trace'?: { trackingId?: unknown } }> } } | undefined
      return pathItem?.get?.parameters?.map(parameter => parameter['x-oa-sdk-trace']?.trackingId)
    }
    expect(parameterTrackingIds('/template-copies/{id}')).toEqual(['TRC-TEMPLATE-COPY-ID-001'])
    expect(parameterTrackingIds('/template-copies-v2/{id}')).toEqual([undefined])
  }, 60_000)

  it('lets `oa-gen trace --verify` accept the emitted document', async () => {
    const directory = typeSpecProject(AUGMENTED_COPIES_TSP)
    const { document } = await compileTypeSpecInMemory(join(directory, 'main.tsp'))
    const specPath = join(directory, 'openapi.json')
    writeFileSync(specPath, JSON.stringify(document, null, 2), 'utf-8')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(traceCommand.run({ spec: specPath, verify: true, format: 'json' })).resolves.toBeUndefined()
  }, 60_000)
})
