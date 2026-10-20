import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { INTERFACE_SKETCH_IR_VERSION } from '@oa-sdk/surface-ir'
import { sketchCommand } from '../../cli/commands/sketch.js'
import { CliExitError } from '../../cli/lib/errors.js'
import { oaGenGovernanceManifest } from '../../cli/spec/oa-gen-governance.js'

// One deep operation that hides payment, inventory and shipping behind a single entry point.
const DEEP_SKETCH = `namespace Orders;
/** An order aggregate. */
model Order { id: string; total: float64; }
interface OrderService {
  /** Places an order and hides payment, inventory and shipping coordination. */
  placeOrder(cartId: string): Order;
}
`

// The same capability exposed as four shallow steps the caller must sequence.
const SHALLOW_SKETCH = `namespace Orders;
model Order { id: string; total: float64; }
interface OrderService {
  reserveInventory(cartId: string): void;
  chargePayment(cartId: string): void;
  createShipment(cartId: string): void;
  getOrder(id: string): Order;
}
`

describe('CLI: oa-gen sketch', () => {
  let tempDir: string
  let output: string[]
  let errors: string[]

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sketch-test-'))
    output = []
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      output.push(values.map(String).join(' '))
    })
    errors = []
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      errors.push(values.map(String).join(' '))
    })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const write = (relativePath: string, content: string): string => {
    const filePath = path.join(tempDir, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    return filePath
  }
  const lastJson = () => JSON.parse(output.at(-1)!)

  it('compare scores each candidate from its own source and recommends the deeper interface', async () => {
    const shallow = write('shallow.tsp', SHALLOW_SKETCH)
    const deep = write('deep.tsp', DEEP_SKETCH)

    await sketchCommand.run({ action: 'compare', spec: `${shallow},${deep}` })

    const result = lastJson()
    const byName = Object.fromEntries(result.candidates.map((candidate: { name: string }) => [candidate.name, candidate]))
    expect(byName.deep.exportedSurfaceCount).toBeGreaterThan(0)
    expect(byName.shallow.exportedSurfaceCount).toBeGreaterThan(byName.deep.exportedSurfaceCount)
    expect(byName.deep.interfaceDepth).toBeGreaterThan(byName.shallow.interfaceDepth)
    expect(byName.deep.score).toBeGreaterThan(byName.shallow.score)
    expect(result.recommendedWinner).toBe('deep')
  })

  it('compare reads candidates from a candidates/ directory', async () => {
    write('arena/candidates/a-shallow.tsp', SHALLOW_SKETCH)
    write('arena/candidates/b-deep.tsp', DEEP_SKETCH)

    await sketchCommand.run({ action: 'compare', spec: path.join(tempDir, 'arena') })

    expect(lastJson().recommendedWinner).toBe('b-deep')
  })

  it('compare fails with fewer than two candidates', async () => {
    const only = write('only.tsp', DEEP_SKETCH)
    await expect(sketchCommand.run({ action: 'compare', spec: only })).rejects.toBeInstanceOf(CliExitError)
  })

  it('emit writes the five sketch artifacts', async () => {
    const spec = write('orders.tsp', DEEP_SKETCH)
    const outDir = path.join(tempDir, 'out')

    await sketchCommand.run({ action: 'emit', spec, 'out-dir': outDir })

    expect(fs.readdirSync(outDir).sort()).toEqual(
      ['orders.mmd', 'orders.openapi.json', 'orders.schema.json', 'sketch_stub.py', 'sketch_stub.ts'],
    )
    expect(lastJson()).toMatchObject({ ok: true, domain: 'orders' })
  })

  it('check-contract passes a conforming implementation and rejects a missing operation', async () => {
    const spec = write('orders.tsp', DEEP_SKETCH)
    const good = write(
      'good.ts',
      `export interface Order { id: string; total: number }
export class OrderService {
  placeOrder(cartId: string): Order { return { id: cartId, total: 0 } }
}
`,
    )
    await sketchCommand.run({ action: 'check-contract', spec, impl: good })
    expect(lastJson()).toMatchObject({ passed: true, scrapRequired: false })

    const missing = write('missing.ts', `export interface Order { id: string; total: number }\n`)
    await expect(sketchCommand.run({ action: 'check-contract', spec, impl: missing })).rejects.toBeInstanceOf(CliExitError)
    expect(lastJson().signatureDeviations.map((signal: { message: string }) => signal.message).join(' ')).toContain('placeOrder')
  })

  it('check-contract accepts an implementation that imports its models from the emitted sketch_stub', async () => {
    const spec = write('orders.tsp', DEEP_SKETCH)
    const outDir = path.join(tempDir, 'out')
    await sketchCommand.run({ action: 'emit', spec, 'out-dir': outDir })

    const typescriptImpl = write(
      'out/order-service.ts',
      `import type { Order, OrderService } from './sketch_stub'
export class OrderServiceImpl implements OrderService {
  placeOrder(cartId: string): Order { return { id: cartId, total: 0 } }
}
`,
    )
    await sketchCommand.run({ action: 'check-contract', spec, impl: typescriptImpl })
    expect(lastJson()).toMatchObject({ passed: true, scrapRequired: false, signatureDeviations: [] })

    const pythonImpl = write(
      'out/order_service.py',
      `from .sketch_stub import Order, OrderService


class OrderServiceImpl(OrderService):
    def place_order(self, cart_id: str) -> Order:
        return Order(id=cart_id, total=0.0)
`,
    )
    await sketchCommand.run({ action: 'check-contract', spec, impl: pythonImpl })
    expect(lastJson()).toMatchObject({ passed: true, scrapRequired: false, signatureDeviations: [] })
  })

  it('verify names the IR by the domain, so its versionHash matches emit and does not depend on the checkout path', async () => {
    const specA = write('dev-a/sketches/orders.tsp', DEEP_SKETCH)
    const specB = write('ci-b/sketches/orders.tsp', DEEP_SKETCH)

    await sketchCommand.run({ action: 'verify', spec: specA })
    const verifyA = lastJson()
    await sketchCommand.run({ action: 'verify', spec: specB })
    const verifyB = lastJson()
    await sketchCommand.run({ action: 'emit', spec: specA, 'out-dir': path.join(tempDir, 'out') })
    const emitted = lastJson()

    expect(verifyA.schemaVersion).toBe(INTERFACE_SKETCH_IR_VERSION)
    expect(verifyA.specName).toBe('orders')
    expect(verifyA.versionHash).toBe(verifyB.versionHash)
    expect(verifyA.versionHash).toBe(emitted.ir.versionHash)

    await sketchCommand.run({ action: 'verify', spec: specA, domain: 'custom' })
    expect(lastJson().specName).toBe('custom')
  })

  it('declares the IR schemaVersion it prints as the sketch report schema in the governance manifest', () => {
    const entry = oaGenGovernanceManifest.commands.find((command) => command.id === 'sketch')
    expect(entry?.components.reports.map((report) => report.schema)).toEqual([INTERFACE_SKETCH_IR_VERSION])
  })

  it('fails verify, emit and check-contract when the sketch cannot be read completely', async () => {
    const spec = write('broken.tsp', `namespace Orders;\nmodel Order { id: string;\ninterface OrderService { placeOrder(cartId: string): Order; }\n`)
    const impl = write('impl.ts', `export interface Order { id: string }\nexport function placeOrder(cartId: string): Order { return { id: cartId } }\n`)
    const outDir = path.join(tempDir, 'broken-out')

    await expect(sketchCommand.run({ action: 'verify', spec })).rejects.toBeInstanceOf(CliExitError)
    expect(lastJson().diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'sketch/unbalanced-delimiter', line: 2 }),
    ])
    expect(errors.join('\n')).toContain('sketch/unbalanced-delimiter')

    await expect(sketchCommand.run({ action: 'emit', spec, 'out-dir': outDir })).rejects.toBeInstanceOf(CliExitError)
    expect(fs.existsSync(outDir)).toBe(false)

    await expect(sketchCommand.run({ action: 'check-contract', spec, impl })).rejects.toBeInstanceOf(CliExitError)

    const deep = write('deep.tsp', DEEP_SKETCH)
    output = []
    errors = []
    await expect(sketchCommand.run({ action: 'compare', spec: `${deep},${spec}` })).rejects.toBeInstanceOf(CliExitError)
    expect(output).toEqual([])
    expect(errors.join('\n')).toContain(`${spec}:2:`)
  })

  it('check-contract requires every declaration of an extends / is / templated sketch', async () => {
    const spec = write('shop.tsp', `namespace Shop;
model Base { id: string; }
model User extends Base { name: string; }
model Admin is User;
model Profile { meta: { tags: string[] }; email: string; }
interface Svc {
  get(id: string): User;
  find(filter: { q: string }): User[];
  remove(id: string): void;
}
`)
    const partial = write('partial.ts', `export interface Base { id: string }
export interface Profile { email: string }
// TODO: find(filter) and remove(id)
export class Svc { get(id: string): Base { return { id } } }
`)

    await expect(sketchCommand.run({ action: 'check-contract', spec, impl: partial })).rejects.toBeInstanceOf(CliExitError)
    expect(lastJson().signatureDeviations.map((signal: { snippet: string }) => signal.snippet)).toEqual([
      'find',
      'remove',
      'User',
      'Admin',
    ])
  })
})
