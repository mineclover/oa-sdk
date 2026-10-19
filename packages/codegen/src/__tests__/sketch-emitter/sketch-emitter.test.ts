import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveRefGraph, type OasDocument } from '@oa-sdk/parser'
import { describe, expect, it } from 'vitest'
import { INTERFACE_SKETCH_IR_VERSION, parseTypeSpecSketch } from '@oa-sdk/surface-ir'
import { emitSketchArtifacts } from '../../index.js'
import { INTERFACE_SKETCH_IR_V1_VERSION, type InterfaceSketchIrV1 } from '../../sketch-emitter/index.js'

const python310 = (() => {
  const probe = spawnSync('python3', ['-I', '-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' })
  return probe.status === 0 && probe.stdout.trim() === 'True'
})()

/** Runs a Python stub as a script (so `dataclasses` sees its module) and returns the result. */
function runPython(stub: string, epilogue: string): { status: number | null; output: string } {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sketch-py-'))
  try {
    const file = join(directory, 'sketch_stub.py')
    writeFileSync(file, `${stub}\n${epilogue}\n`)
    const result = spawnSync('python3', ['-I', file], { encoding: 'utf8' })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

type Schemas = Record<string, Record<string, unknown>>

const SAMPLE_TSP = `
namespace PstackMonitor.ModelRouting;

/**
 * Base model routing policy.
 * ## @evidence contracts/routing.md#base-policy
 */
@intent("INTENT-ROUTE-BASE", "docs/routing.md#base-policy")
model BaseRoutingPolicy {
  taskKind: string;
  preferredModel: string;
  timeoutSec: int32;
}

/**
 * Derived deep-workload routing policy.
 * ## @evidence contracts/routing.md#deep-policy
 */
@intent("INTENT-ROUTE-DEEP", "docs/routing.md#deep-policy")
@derivedFrom("BaseRoutingPolicy", "Separate 10m+ deep workload budget from instant routing")
model DeepRoutingPolicy is BaseRoutingPolicy {
  requireApprovalMemo: boolean;
  maxSubagents: int32;
}

interface ModelRouter {
  @evidence("contracts/routing.md#resolve-route")
  resolveDeepRoute(policy: DeepRoutingPolicy): string;
}
`

describe('emitSketchArtifacts in @oa-sdk/codegen (TODO-OA-03)', () => {
  it('emits JSON Schema 2020-12 with x-evidence/x-oa-sdk-intent/x-oa-sdk-derived-from, OpenAPI 3.1, Mermaid, TS stub, and Python stub', () => {
    const out = emitSketchArtifacts(SAMPLE_TSP, 'model-routing')

    expect(out.ir.profile).toBe('interface-sketch')
    expect(out.jsonSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')

    const defs = out.jsonSchema.$defs as Record<string, Record<string, unknown>>
    expect(defs.DeepRoutingPolicy).toBeDefined()
    expect(defs.DeepRoutingPolicy?.['x-oa-sdk-derived-from']).toEqual({
      baseSymbol: 'BaseRoutingPolicy',
      reason: 'Separate 10m+ deep workload budget from instant routing',
    })
    expect(defs.DeepRoutingPolicy?.['x-evidence']).toEqual({
      requirements: ['contracts/routing.md#deep-policy'],
    })

    expect(out.openApi.openapi).toBe('3.1.0')
    expect(out.mermaid).toContain('BaseRoutingPolicy <|-- DeepRoutingPolicy : @derivedFrom')
    expect(out.tsStub).toContain('export interface DeepRoutingPolicy extends BaseRoutingPolicy')
    expect(out.tsStub).toContain('throw new Error("not implemented");')
    expect(out.pyStub).toContain('class DeepRoutingPolicy(BaseRoutingPolicy):')
    expect(out.pyStub).toContain('raise NotImplementedError("not implemented")')
  })

  const REFERENCING_TSP = `
namespace Demo;
enum Role { admin, user }
model Address { street: string; }
model User { address: Address; role: Role; tags: Address[]; }
model Page<T> { items: T[]; next?: string; }
model UserPage is Page<User>;
model Listing { page: Page<Address>; byRole: Record<Role>; meta: { tags: string[] }; }
interface Users { get(id: string): User; }
`

  it('points every OpenAPI $ref into components.schemas and every JSON Schema $ref into $defs', () => {
    const out = emitSketchArtifacts(REFERENCING_TSP, 'demo')
    const schemas = (out.openApi.components as { schemas: Schemas }).schemas

    expect(schemas.User?.properties).toEqual({
      address: { $ref: '#/components/schemas/Address' },
      role: { $ref: '#/components/schemas/Role' },
      tags: { type: 'array', items: { $ref: '#/components/schemas/Address' } },
    })
    const openApiRefs = resolveRefGraph(out.openApi as unknown as OasDocument).nodes
    expect(openApiRefs.length).toBeGreaterThan(0)
    expect(openApiRefs.filter(node => !node.resolved)).toEqual([])

    const defs = out.jsonSchema.$defs as Schemas
    expect(defs.User?.properties).toMatchObject({ address: { $ref: '#/$defs/Address' } })
    const jsonSchemaRefs = JSON.stringify(out.jsonSchema).match(/"\$ref":"([^"]+)"/g) ?? []
    for (const ref of jsonSchemaRefs) {
      const name = /#\/\$defs\/([^"]+)/.exec(ref)?.[1]
      expect(name && defs[name], ref).toBeTruthy()
    }

    // Template instances have no definition of their own and are expanded in place.
    expect(schemas.UserPage?.properties).toEqual({
      items: { type: 'array', items: { $ref: '#/components/schemas/User' } },
      next: { type: 'string' },
    })
    expect(schemas.Listing?.properties).toMatchObject({
      page: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Address' } } } },
      byRole: { type: 'object', additionalProperties: { $ref: '#/components/schemas/Role' } },
      meta: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } }, required: ['tags'] },
    })
  })

  it('emits enum values and union variant types instead of member names', () => {
    const out = emitSketchArtifacts(`
enum Color { Red: "red", Blue: "blue" }
enum Level { Low: 1, High: 10 }
enum Plain { Alpha, Beta }
union Pet { cat: Cat, dog: Dog }
union Lit { "a", "b" }
model Cat { name: string; }
model Dog { name: string; }
`, 'enums')
    const defs = out.jsonSchema.$defs as Schemas

    expect(defs.Color).toEqual({ type: 'string', enum: ['red', 'blue'] })
    expect(defs.Level).toEqual({ type: 'integer', enum: [1, 10] })
    expect(defs.Plain).toEqual({ type: 'string', enum: ['Alpha', 'Beta'] })
    expect(defs.Pet).toEqual({ anyOf: [{ $ref: '#/$defs/Cat' }, { $ref: '#/$defs/Dog' }] })
    expect(defs.Lit).toEqual({ type: 'string', enum: ['a', 'b'] })

    expect(out.tsStub).toContain('export type Color = "red" | "blue";')
    expect(out.tsStub).toContain('export type Level = 1 | 10;')
    expect(out.tsStub).toContain('export type Pet = Cat | Dog;')
    expect(out.pyStub).toContain('Color = Literal["red", "blue"]')
    expect(out.pyStub).toContain('Level = Literal[1, 10]')
    expect(out.pyStub).toContain('Pet = Union["Cat", "Dog"]')
  })

  it('emits from a v1 IR saved by an earlier release, which has no members or diagnostics', () => {
    const current = parseTypeSpecSketch(`
enum Color { Red: "red", Blue: "blue" }
union Pet { cat: Cat, dog: Dog }
model Cat { name: string; }
model Dog { name: string; }
`, 'legacy')
    // The v1 shape: no `members` on unions/enums, no `diagnostics`.
    const { diagnostics: _diagnostics, unionsAndEnums, ...rest } = current
    const legacy: InterfaceSketchIrV1 = {
      ...rest,
      schemaVersion: INTERFACE_SKETCH_IR_V1_VERSION,
      unionsAndEnums: unionsAndEnums.map(({ members: _members, ...union }) => union),
    }

    const out = emitSketchArtifacts(legacy)
    const defs = out.jsonSchema.$defs as Schemas

    expect(out.ir.schemaVersion).toBe(INTERFACE_SKETCH_IR_VERSION)
    expect(out.ir.diagnostics).toEqual([])
    expect(out.ir.versionHash).toBe(current.versionHash)
    // v1 kept only member names, so an enum emits its names.
    expect(out.ir.unionsAndEnums.find(u => u.name === 'Color')?.members).toEqual([{ name: 'Red' }, { name: 'Blue' }])
    expect(defs.Color).toEqual({ type: 'string', enum: ['Red', 'Blue'] })
    expect(out.tsStub).toContain('export type Color = "Red" | "Blue";')
    expect(out.pyStub).toContain('Color = Literal["Red", "Blue"]')

    const unknownVersion = JSON.parse(JSON.stringify({ ...current, schemaVersion: 'oa-sdk.interface-sketch-ir.v9' }))
    expect(() => emitSketchArtifacts(unknownVersion)).toThrow(/Unsupported Interface Sketch IR schemaVersion "oa-sdk.interface-sketch-ir.v9"/)
  })

  const ORDERING_TSP = `
model Admin is User { level: int32; }
model User { nickname?: string; id: string; }
interface Users { find(q?: string, id: string): User; }
`

  it('emits Python dataclasses whose required fields may follow optional ones, bases first', () => {
    const out = emitSketchArtifacts(ORDERING_TSP, 'ordering')

    expect(out.pyStub.match(/^@dataclass\(kw_only=True\)$/gm)).toHaveLength(2)
    expect(out.pyStub).not.toMatch(/^@dataclass$/m)
    expect(out.pyStub.indexOf('class User:')).toBeLessThan(out.pyStub.indexOf('class Admin(User):'))
    expect(out.pyStub).toContain('def find(self, *, q: Optional[str] = None, id: str) -> User:')
    expect(out.tsStub).toContain('find(q: string | undefined, id: string): User;')
  })

  it.runIf(python310)('produces a Python stub that imports and constructs on Python 3.10+', () => {
    const ordering = runPython(
      emitSketchArtifacts(ORDERING_TSP, 'ordering').pyStub,
      'print(Admin(id="x", level=1))',
    )
    expect(ordering.output).toContain("Admin(nickname=None, id='x', level=1)")
    expect(ordering.status).toBe(0)

    const referencing = runPython(
      emitSketchArtifacts(REFERENCING_TSP, 'demo').pyStub,
      'print(UserPage(items=[]), Listing(page=Page(items=[]), byRole={}, meta={}))',
    )
    expect(referencing.status, referencing.output).toBe(0)
  })
})
