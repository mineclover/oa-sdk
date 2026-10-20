import { describe, expect, it } from 'vitest'
import {
  INTERFACE_SKETCH_IR_VERSION,
  compareSketchCandidates,
  detectTypeSpecProfile,
  parseTypeSpecSketch,
} from '../src/index.js'

const DEEP_SKETCH_TSP = `
namespace PstackMonitor.FileLease;

/**
 * Base lease contract shared across intents.
 * ## @evidence contracts/common.md#lease-invariants
 */
@intent("INTENT-LEASE-CORE", "docs/lease.md#core-lease")
model BaseLeaseContract {
  leaseId: string;
  ownerAgentId: string;
  acquiredAtEpochMs: int64;
  ttlMs: int32;
}

/**
 * Derived writer lease contract with exclusive write scope.
 * ## @evidence contracts/common.md#writer-lease
 */
@intent("INTENT-LEASE-WRITER", "docs/lease.md#writer-lease")
@derivedFrom("BaseLeaseContract", "Separate writer exclusive lock from read-only observer lease")
model WriterLeaseContract is BaseLeaseContract {
  exclusivePaths: string[];
  fencingToken: int64;
}

union LeaseOutcomeKind {
  acquired: "acquired",
  contended: "contended",
  expired: "expired",
}

/**
 * Atomic file lease coordinator boundary.
 * ## @evidence contracts/common.md#lease-coordinator
 */
@intent("INTENT-LEASE-COORD", "docs/lease.md#coordinator")
interface FileLeaseCoordinator {
  @evidence("contracts/common.md#acquire-atomic")
  acquireWriterLease(request: WriterLeaseContract): LeaseOutcomeKind;
}
`

const SHALLOW_SKETCH_TSP = `
namespace ShallowExample;

model SimpleInput {
  id: string;
}

interface ShallowService {
  step1_init(x: string): void;
  step2_process(x: string): void;
  passthrough_call(x: string): void;
}
`

describe('InterfaceSketchProfile in @oa-sdk/surface-ir (TODO-OA-02 / IUD-05 / IUD-07)', () => {
  it('detects openapi-http vs interface-sketch vs hybrid profiles on standard .tsp files', () => {
    expect(detectTypeSpecProfile(DEEP_SKETCH_TSP)).toBe('interface-sketch')
    expect(
      detectTypeSpecProfile(`
        using TypeSpec.Http;
        @service(#{ title: "Users API" })
        namespace UsersApi;
        @route("/users")
        op listUsers(): string[];
      `),
    ).toBe('openapi-http')
  })

  it('parses standard .tsp sketch with @intent, @derivedFrom, model B is A, ## @evidence, and depth >= 2.5', () => {
    const ir = parseTypeSpecSketch(DEEP_SKETCH_TSP, 'file-lease')

    // v2: unions and enums carry `members`, and the IR carries `diagnostics` (v1 had neither).
    expect(INTERFACE_SKETCH_IR_VERSION).toBe('oa-sdk.interface-sketch-ir.v2')
    expect(ir.schemaVersion).toBe(INTERFACE_SKETCH_IR_VERSION)
    expect(ir.diagnostics).toEqual([])
    expect(ir.profile).toBe('interface-sketch')
    expect(ir.namespace).toBe('PstackMonitor.FileLease')
    expect(ir.models).toHaveLength(2)
    expect(ir.derivedLineage).toEqual([
      {
        derivedSymbol: 'WriterLeaseContract',
        baseSymbol: 'BaseLeaseContract',
        reason: 'Separate writer exclusive lock from read-only observer lease',
        usesModelIsSyntax: true,
      },
    ])
    expect(ir.depthMetrics.isDeep).toBe(true)
    expect(ir.depthMetrics.interfaceDepth).toBeGreaterThanOrEqual(2.5)
    expect(ir.redFlags).toHaveLength(0)
  })

  it('flags shallow-module, temporal-decomposition, and pass-through-method red flags and compares Arena candidates', () => {
    const comparison = compareSketchCandidates([
      { name: 'candidate-a-shallow', source: SHALLOW_SKETCH_TSP },
      { name: 'candidate-b-deep', source: DEEP_SKETCH_TSP },
    ])

    expect(comparison.recommendedWinner).toBe('candidate-b-deep')
    const shallowScore = comparison.candidates.find(c => c.name === 'candidate-a-shallow')
    expect(shallowScore?.isDeep).toBe(false)
    expect(shallowScore?.redFlagCount).toBeGreaterThanOrEqual(3)
  })

  it('keeps each declaration\'s own doc, @intent and evidence (metadata never leaks from an earlier declaration)', () => {
    const ir = parseTypeSpecSketch(DEEP_SKETCH_TSP, 'file-lease')

    const coordinator = ir.interfaces[0]
    expect(coordinator?.name).toBe('FileLeaseCoordinator')
    expect(coordinator?.intent).toEqual({ intentId: 'INTENT-LEASE-COORD', docAnchor: 'docs/lease.md#coordinator' })
    expect(coordinator?.doc).toBe('Atomic file lease coordinator boundary.')
    expect(coordinator?.evidence).toEqual(['contracts/common.md#lease-coordinator'])
    expect(coordinator?.operations[0]?.evidence).toEqual(['contracts/common.md#acquire-atomic'])
    expect(ir.unionsAndEnums[0]).toMatchObject({ name: 'LeaseOutcomeKind', evidence: [] })
    expect(ir.unionsAndEnums[0]?.doc).toBeUndefined()

    const ordered = parseTypeSpecSketch(`
/**
 * Order service.
 * ## @evidence docs/svc.md#svc
 */
@intent("INTENT-ORDER-SVC")
interface OrderService { place(cartId: string): Order; }

/** An order. */
@intent("INTENT-ORDER")
model Order { id: string; }
`)
    expect(ordered.models[0]).toMatchObject({ name: 'Order', intent: { intentId: 'INTENT-ORDER' }, doc: 'An order.', evidence: [] })
    expect(ordered.interfaces[0]).toMatchObject({
      name: 'OrderService',
      intent: { intentId: 'INTENT-ORDER-SVC' },
      doc: 'Order service.',
      evidence: ['docs/svc.md#svc'],
    })
  })

  it('parses extends, templates, `is X;`, nested anonymous models and anonymous op parameters completely', () => {
    const ir = parseTypeSpecSketch(`
namespace Shop;
model Base { id: string; }
model User extends Base { name: string; }
model Page<T> { items: T[]; next?: string; }
model Admin is User;
model Profile { meta: { tags: string[] }; email: string; }
interface Svc {
  get(id: string): User;
  find(filter: { q: string; limit?: int32 }, page?: int32): Page<User>;
  remove(id: string): void;
}
`)

    expect(ir.diagnostics).toEqual([])
    expect(ir.models.map(model => model.name)).toEqual(['Base', 'User', 'Page', 'Admin', 'Profile'])
    expect(ir.models.find(model => model.name === 'User')).toMatchObject({ baseModel: 'Base', fields: [{ name: 'name', typeName: 'string' }] })
    expect(ir.models.find(model => model.name === 'Page')).toMatchObject({
      templateParameters: ['T'],
      fields: [
        { name: 'items', typeName: 'T[]', optional: false },
        { name: 'next', typeName: 'string', optional: true },
      ],
    })
    expect(ir.models.find(model => model.name === 'Admin')).toMatchObject({ baseModel: 'User', fields: [] })
    expect(ir.models.find(model => model.name === 'Profile')?.fields).toEqual([
      { name: 'meta', typeName: '{ tags: string[] }', optional: false, evidence: [] },
      { name: 'email', typeName: 'string', optional: false, evidence: [] },
    ])
    expect(ir.derivedLineage).toEqual([
      { derivedSymbol: 'User', baseSymbol: 'Base', reason: 'model inheritance', usesModelIsSyntax: false },
      { derivedSymbol: 'Admin', baseSymbol: 'User', reason: 'model inheritance', usesModelIsSyntax: true },
    ])
    expect(ir.interfaces[0]?.operations).toEqual([
      { name: 'get', params: [{ name: 'id', optional: false, typeName: 'string' }], returnType: 'User', evidence: [] },
      {
        name: 'find',
        params: [
          { name: 'filter', optional: false, typeName: '{ q: string; limit?: int32 }' },
          { name: 'page', optional: true, typeName: 'int32' },
        ],
        returnType: 'Page<User>',
        evidence: [],
      },
      { name: 'remove', params: [{ name: 'id', optional: false, typeName: 'string' }], returnType: 'void', evidence: [] },
    ])
  })

  it('expands spreads, template arguments, interface extends and enum spreads declared in the same sketch', () => {
    const ir = parseTypeSpecSketch(`
namespace Catalog {
  model Page<T> { items: T[]; total: int32; }
  model Audit { createdAt: utcDateTime; }
  model Listing { ...Page<Product>; ...Audit; total: int64; }
  model Product { sku: string; }
  interface Reader { get(@path id: string): Product; }
  interface Store extends Reader { create(...Product): Product; }
  enum Primary { Red, Green }
  enum Palette { ...Primary, Blue: "blue" }
}
`)

    expect(ir.namespace).toBe('Catalog')
    expect(ir.diagnostics).toEqual([])
    expect(ir.models.find(model => model.name === 'Listing')?.fields.map(field => `${field.name}:${field.typeName}`)).toEqual([
      'items:Product[]',
      'total:int64',
      'createdAt:utcDateTime',
    ])
    expect(ir.interfaces.find(iface => iface.name === 'Store')?.operations.map(op => op.name)).toEqual(['get', 'create'])
    expect(ir.interfaces.find(iface => iface.name === 'Store')?.operations[1]?.params).toEqual([
      { name: 'sku', optional: false, typeName: 'string' },
    ])
    expect(ir.unionsAndEnums.find(item => item.name === 'Palette')?.members).toEqual([
      { name: 'Red' },
      { name: 'Green' },
      { name: 'Blue', value: '"blue"' },
    ])
  })

  it('keeps union and enum member values next to their names', () => {
    const ir = parseTypeSpecSketch(`
enum Color { Red: "red", Blue: "blue" }
enum Level { Low: 1, High: 10 }
union Pet { cat: Cat, dog: Dog }
union Lit { "a", "b" }
model Cat { name: string; }
model Dog { name: string; }
`)

    expect(ir.unionsAndEnums.map(item => [item.name, item.variants, item.members])).toEqual([
      ['Color', ['Red', 'Blue'], [{ name: 'Red', value: '"red"' }, { name: 'Blue', value: '"blue"' }]],
      ['Level', ['Low', 'High'], [{ name: 'Low', value: '1' }, { name: 'High', value: '10' }]],
      ['Pet', ['cat', 'dog'], [{ name: 'cat', value: 'Cat' }, { name: 'dog', value: 'Dog' }]],
      ['Lit', ['"a"', '"b"'], [{ name: '"a"' }, { name: '"b"' }]],
    ])
  })

  it('never reads declarations out of comments or string literals', () => {
    const ir = parseTypeSpecSketch(`
// model Ghost { id: string; }
/* interface Phantom { haunt(): void; } */
@doc("interface Fake { x(): void; } model Fake2 {}")
model Real { note: string = "model Hidden {}"; }
`)

    expect(ir.diagnostics).toEqual([])
    expect(ir.graftedSymbols).toEqual(['Real'])
    expect(ir.models[0]).toMatchObject({ name: 'Real', doc: 'interface Fake { x(): void; } model Fake2 {}' })
  })

  it('reports unreadable or unresolvable declarations as diagnostics instead of dropping them silently', () => {
    const unclosed = parseTypeSpecSketch(`model Order {\n  id: string;\n  total: float64;\n`)
    expect(unclosed.models.map(model => model.name)).toEqual(['Order'])
    expect(unclosed.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'sketch/unbalanced-delimiter', line: 1, symbol: 'Order' }),
    ])

    const broken = parseTypeSpecSketch(`
model 1Bad { id: string; }
model Ok { name: string; label: "unterminated; }
interface Svc { get(id: string) User; }
op topLevel(): void;
model Loop { ...Loop; }
model Partial { ...Elsewhere; }
`)
    const summary = broken.diagnostics.map(diagnostic => `${diagnostic.severity}:${diagnostic.code}:${diagnostic.line}`)
    expect(summary).toEqual(expect.arrayContaining([
      'error:sketch/syntax-error:2',
      'error:sketch/syntax-error:3',
      'error:sketch/syntax-error:4',
      'warning:sketch/unsupported-statement:5',
      'error:sketch/circular-reference:6',
      'warning:sketch/unresolved-reference:7',
    ]))
    expect(broken.diagnostics.every(diagnostic => diagnostic.line > 0 && diagnostic.column > 0)).toBe(true)
    expect(broken.models.map(model => model.name)).toEqual(expect.arrayContaining(['Ok', 'Loop', 'Partial']))
  })
})
