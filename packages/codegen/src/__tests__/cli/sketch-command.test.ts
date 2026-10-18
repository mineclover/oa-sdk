import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sketchCommand } from '../../cli/commands/sketch.js'
import { CliExitError } from '../../cli/lib/errors.js'

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

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sketch-test-'))
    output = []
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      output.push(values.map(String).join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
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
})
