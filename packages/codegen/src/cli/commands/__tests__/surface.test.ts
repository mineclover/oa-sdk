import { describe, expect, it } from 'vitest'
import { surface } from '../surface.js'

describe('surface CLI command', () => {
  it('exposes Forge target projection inputs and output controls', () => {
    expect(surface.name).toBe('surface')
    expect(surface.options.spec).toMatchObject({ required: true, short: 's' })
    expect(surface.options.target).toBeDefined()
    expect(surface.options['out-dir']).toMatchObject({ short: 'o' })
    expect(surface.options.mapping).toBeDefined()
    expect(surface.options['fail-on-warning']).toBeDefined()
  })
})
