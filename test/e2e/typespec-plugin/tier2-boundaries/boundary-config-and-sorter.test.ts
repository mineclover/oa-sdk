import { describe, it, expect } from 'vitest'
import {
  type TspPlugin,
  defineTspConfig,
  defineConfig,
  validateTspConfig,
  sortPlugins,
  sortPluginEntries,
  TspPluginCycleError,
  TspPluginMissingDependencyError,
  TspPluginDuplicateError,
  TspConfigValidationError,
} from '../../../../packages/codegen/src/plugin/index.js'

describe('Tier 2: Boundary & Corner Cases — Config & Topological Sorter', () => {
  // ── Config Validation Boundaries ──
  it('B1.1: validates empty plugins array gracefully', () => {
    const config = validateTspConfig({ input: 'main.tsp', plugins: [] })
    expect(config.plugins).toEqual([])
    expect(sortPlugins(config.plugins)).toEqual([])
  })

  it('B1.2: filters out falsy plugin entries (null, undefined, false)', () => {
    const pluginA: TspPlugin = { name: 'plugin-a' }
    const config = validateTspConfig({
      input: 'main.tsp',
      plugins: [pluginA, null, false, undefined] as any,
    })
    const sorted = sortPlugins(config.plugins)
    expect(sorted.length).toBe(1)
    expect(sorted[0].name).toBe('plugin-a')
  })

  it('B1.3: rejects missing input parameter', () => {
    expect(() => validateTspConfig({})).toThrow(TspConfigValidationError)
  })

  it('B1.4: rejects empty string input', () => {
    expect(() => validateTspConfig({ input: '   ' })).toThrow(TspConfigValidationError)
  })

  it('B1.5: rejects non-object configuration root', () => {
    expect(() => validateTspConfig(null)).toThrow(TspConfigValidationError)
    expect(() => validateTspConfig('input.tsp')).toThrow(TspConfigValidationError)
    expect(() => validateTspConfig([1, 2, 3])).toThrow(TspConfigValidationError)
  })

  it('B1.6: rejects unsupported openApiVersion strings', () => {
    expect(() => validateTspConfig({ input: 'main.tsp', openApiVersion: '2.0.0' as any })).toThrow(
      TspConfigValidationError,
    )
    expect(() => validateTspConfig({ input: 'main.tsp', openApiVersion: '4.0.0' as any })).toThrow(
      TspConfigValidationError,
    )
  })

  it('B1.7: validates object input form with entrypoint and optional tspDir', () => {
    const config = validateTspConfig({
      input: { entrypoint: 'apis/service.tsp', tspDir: './specs' },
    })
    expect(config.input).toEqual({ entrypoint: 'apis/service.tsp', tspDir: './specs' })
  })

  it('B1.8: applies sensible default values for optional configuration properties', () => {
    const config = validateTspConfig({ input: 'main.tsp' })
    expect(config.output).toBe('./src/generated')
    expect(config.openApiVersion).toBe('3.2.0')
    expect(config.dryRun).toBe(false)
    expect(config.clean).toBe(true)
    expect(config.format).toBe(true)
  })

  // ── Sorter Boundaries & Error Handling ──
  it('B1.9: throws TspPluginDuplicateError on duplicate plugin names', () => {
    const p1: TspPlugin = { name: 'my-plugin' }
    const p2: TspPlugin = { name: 'my-plugin' }
    expect(() => sortPlugins([p1, p2])).toThrow(TspPluginDuplicateError)
  })

  it('B1.10: detects 1-node self-cycle (A -> A)', () => {
    const pA: TspPlugin = { name: 'A', dependencies: ['A'] }
    expect(() => sortPlugins([pA])).toThrow(TspPluginCycleError)
  })

  it('B1.11: detects 2-node cycle (A -> B -> A) and traces cycle in error', () => {
    const pA: TspPlugin = { name: 'A', dependencies: ['B'] }
    const pB: TspPlugin = { name: 'B', dependencies: ['A'] }

    try {
      sortPlugins([pA, pB])
      expect.fail('Should have thrown TspPluginCycleError')
    } catch (err) {
      expect(err).toBeInstanceOf(TspPluginCycleError)
      const cycleErr = err as TspPluginCycleError
      expect(cycleErr.cycle).toContain('A')
      expect(cycleErr.cycle).toContain('B')
    }
  })

  it('B1.12: detects 3-node cycle (A -> B -> C -> A)', () => {
    const pA: TspPlugin = { name: 'A', dependencies: ['C'] }
    const pB: TspPlugin = { name: 'B', dependencies: ['A'] }
    const pC: TspPlugin = { name: 'C', dependencies: ['B'] }

    expect(() => sortPlugins([pA, pB, pC])).toThrow(TspPluginCycleError)
  })

  it('B1.13: throws TspPluginMissingDependencyError when a required dependency is absent', () => {
    const pB: TspPlugin = { name: 'B', dependencies: ['non-existent-plugin'] }
    expect(() => sortPlugins([pB])).toThrow(TspPluginMissingDependencyError)
  })

  it('B1.14: detects stage conflict when pre plugin depends on normal plugin', () => {
    const normal: TspPlugin = { name: 'normal-plugin' }
    const pre: TspPlugin = { name: 'pre-plugin', enforce: 'pre', dependencies: ['normal-plugin'] }

    expect(() => sortPlugins([normal, pre])).toThrow(TspPluginCycleError)
  })

  it('B1.15: successfully resolves deep 20-node dependency chain', () => {
    const plugins: TspPlugin[] = []
    const count = 20

    for (let i = 0; i < count; i++) {
      plugins.push({
        name: `p-${i}`,
        dependencies: i > 0 ? [`p-${i - 1}`] : [],
      })
    }

    // Pass in reverse order
    const reversed = [...plugins].reverse()
    const sorted = sortPlugins(reversed)

    expect(sorted.length).toBe(count)
    for (let i = 0; i < count; i++) {
      expect(sorted[i].name).toBe(`p-${i}`)
    }
  })
})
