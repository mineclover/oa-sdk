import { describe, expect, it } from 'vitest'
import {
  sortPluginEntries,
  sortPlugins,
} from '../../plugin/sorter.js'
import {
  type TspPlugin,
  TspPluginCycleError,
  TspPluginDuplicateError,
  TspPluginMissingDependencyError,
} from '../../plugin/types.js'

function makePlugin(
  name: string,
  dependencies: string[] = [],
  enforce?: 'pre' | 'post',
): TspPlugin {
  return {
    name,
    dependencies,
    ...(enforce ? { enforce } : {}),
  }
}

describe('Topological Plugin Sorter (Kahn Algorithm & DAG)', () => {
  it('returns an empty array when given empty or undefined plugins', () => {
    expect(sortPlugins([])).toEqual([])
    expect(sortPlugins(undefined)).toEqual([])
    expect(sortPluginEntries([])).toEqual([])
  })

  it('filters out falsy values (null, undefined, false)', () => {
    const p1 = makePlugin('plugin-a')
    const p2 = makePlugin('plugin-b')
    const result = sortPlugins([p1, null, false, undefined, p2])
    expect(result.map(p => p.name)).toEqual(['plugin-a', 'plugin-b'])
  })

  it('normalizes tuple entries [plugin, options]', () => {
    const p1 = makePlugin('plugin-a')
    const p2 = makePlugin('plugin-b')
    const entries = sortPluginEntries([
      [p1, { optA: 123 }],
      [p2, { optB: 'test' }],
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0]!.plugin.name).toBe('plugin-a')
    expect(entries[0]!.options).toEqual({ optA: 123 })
    expect(entries[1]!.plugin.name).toBe('plugin-b')
    expect(entries[1]!.options).toEqual({ optB: 'test' })
  })

  it('preserves declaration order among independent plugins without dependencies', () => {
    const p1 = makePlugin('alpha')
    const p2 = makePlugin('beta')
    const p3 = makePlugin('gamma')
    const result = sortPlugins([p1, p2, p3])
    expect(result.map(p => p.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('sorts a linear dependency chain correctly', () => {
    // gamma depends on beta, beta depends on alpha
    const pGamma = makePlugin('gamma', ['beta'])
    const pBeta = makePlugin('beta', ['alpha'])
    const pAlpha = makePlugin('alpha', [])

    const result = sortPlugins([pGamma, pBeta, pAlpha])
    expect(result.map(p => p.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('sorts a diamond dependency graph in correct topological order', () => {
    // D depends on B & C; B & C depend on A
    const pA = makePlugin('A')
    const pB = makePlugin('B', ['A'])
    const pC = makePlugin('C', ['A'])
    const pD = makePlugin('D', ['B', 'C'])

    const result = sortPlugins([pD, pC, pB, pA])
    expect(result.map(p => p.name)).toEqual(['A', 'C', 'B', 'D'])
  })

  it('throws TspPluginDuplicateError when duplicate plugin names are detected', () => {
    const p1 = makePlugin('dup')
    const p2 = makePlugin('dup')
    expect(() => sortPlugins([p1, p2])).toThrow(TspPluginDuplicateError)
    expect(() => sortPlugins([p1, p2])).toThrow('Duplicate plugin name detected: "dup"')
  })

  it('throws TspPluginMissingDependencyError when a required dependency is omitted', () => {
    const pClient = makePlugin('client', ['typescript'])
    expect(() => sortPlugins([pClient])).toThrow(TspPluginMissingDependencyError)
    expect(() => sortPlugins([pClient])).toThrow(
      'Plugin "client" requires missing dependency "typescript"',
    )
  })

  it('detects a self-dependency cycle (1-node cycle) and formats cycle path', () => {
    const pSelf = makePlugin('self', ['self'])
    expect(() => sortPlugins([pSelf])).toThrow(TspPluginCycleError)
    try {
      sortPlugins([pSelf])
    } catch (e) {
      const err = e as TspPluginCycleError
      expect(err.cycle).toEqual(['self', 'self'])
      expect(err.message).toBe('Circular plugin dependency detected: self -> self')
    }
  })

  it('detects a 2-node cycle (A -> B -> A)', () => {
    const pA = makePlugin('A', ['B'])
    const pB = makePlugin('B', ['A'])
    expect(() => sortPlugins([pA, pB])).toThrow(TspPluginCycleError)
    expect(() => sortPlugins([pA, pB])).toThrow(/Circular plugin dependency detected:/)
  })

  it('detects a 3-node cycle (A -> B -> C -> A)', () => {
    const pA = makePlugin('A', ['C'])
    const pB = makePlugin('B', ['A'])
    const pC = makePlugin('C', ['B'])
    expect(() => sortPlugins([pA, pB, pC])).toThrow(TspPluginCycleError)
    try {
      sortPlugins([pA, pB, pC])
    } catch (e) {
      const err = e as TspPluginCycleError
      expect(err.cycle).toContain('A')
      expect(err.cycle).toContain('B')
      expect(err.cycle).toContain('C')
    }
  })

  it('orders enforce: "pre" plugins before standard plugins and enforce: "post" plugins after', () => {
    const pNormal = makePlugin('normal')
    const pPre = makePlugin('pre-plugin', [], 'pre')
    const pPost = makePlugin('post-plugin', [], 'post')

    const result = sortPlugins([pPost, pNormal, pPre])
    expect(result.map(p => p.name)).toEqual(['pre-plugin', 'normal', 'post-plugin'])
  })

  it('allows a normal plugin to depend on an enforce: "pre" plugin', () => {
    const pPre = makePlugin('pre-setup', [], 'pre')
    const pNormal = makePlugin('normal-gen', ['pre-setup'])

    const result = sortPlugins([pNormal, pPre])
    expect(result.map(p => p.name)).toEqual(['pre-setup', 'normal-gen'])
  })

  it('allows a post plugin to depend on a normal plugin', () => {
    const pNormal = makePlugin('normal-gen', [])
    const pPost = makePlugin('post-format', ['normal-gen'], 'post')

    const result = sortPlugins([pPost, pNormal])
    expect(result.map(p => p.name)).toEqual(['normal-gen', 'post-format'])
  })

  it('rejects an enforce: "pre" plugin depending on a normal plugin as invalid stage order', () => {
    const pNormal = makePlugin('normal-gen', [])
    const pPre = makePlugin('pre-setup', ['normal-gen'], 'pre')

    expect(() => sortPlugins([pPre, pNormal])).toThrow(TspPluginCycleError)
  })
})
