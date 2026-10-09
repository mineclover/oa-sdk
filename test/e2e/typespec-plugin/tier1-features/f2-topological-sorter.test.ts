import { describe, it, expect } from 'vitest'
import {
  type TspPlugin,
  sortPlugins,
  sortPluginEntries,
} from '../../../../packages/codegen/src/plugin/index.js'

describe('Tier 1: F2 - Topological Plugin Sorter', () => {
  it('F2.1: sorts linear dependencies in strict prerequisite order (Kahn algorithm)', () => {
    const pluginA: TspPlugin = { name: 'plugin-a' }
    const pluginB: TspPlugin = { name: 'plugin-b', dependencies: ['plugin-a'] }
    const pluginC: TspPlugin = { name: 'plugin-c', dependencies: ['plugin-b'] }

    // Provide in reverse order to ensure sorter actively orders them
    const sorted = sortPlugins([pluginC, pluginB, pluginA])
    expect(sorted.map(p => p.name)).toEqual(['plugin-a', 'plugin-b', 'plugin-c'])
  })

  it('F2.2: prioritizes enforce: "pre" plugins ahead of standard plugins', () => {
    const standard1: TspPlugin = { name: 'std-1' }
    const standard2: TspPlugin = { name: 'std-2' }
    const prePlugin: TspPlugin = { name: 'pre-processor', enforce: 'pre' }

    const sorted = sortPlugins([standard1, standard2, prePlugin])
    expect(sorted[0].name).toBe('pre-processor')
    expect(sorted.map(p => p.name)).toEqual(['pre-processor', 'std-1', 'std-2'])
  })

  it('F2.3: defers enforce: "post" plugins to run after standard plugins', () => {
    const postPlugin: TspPlugin = { name: 'post-formatter', enforce: 'post' }
    const standard1: TspPlugin = { name: 'std-1' }
    const standard2: TspPlugin = { name: 'std-2' }

    const sorted = sortPlugins([postPlugin, standard1, standard2])
    expect(sorted[sorted.length - 1].name).toBe('post-formatter')
    expect(sorted.map(p => p.name)).toEqual(['std-1', 'std-2', 'post-formatter'])
  })

  it('F2.4: correctly resolves diamond dependency DAGs (A -> B, A -> C, B & C -> D)', () => {
    const pluginA: TspPlugin = { name: 'A' }
    const pluginB: TspPlugin = { name: 'B', dependencies: ['A'] }
    const pluginC: TspPlugin = { name: 'C', dependencies: ['A'] }
    const pluginD: TspPlugin = { name: 'D', dependencies: ['B', 'C'] }

    const sorted = sortPlugins([pluginD, pluginC, pluginB, pluginA])
    const names = sorted.map(p => p.name)

    expect(names[0]).toBe('A')
    expect(names.indexOf('B')).toBeGreaterThan(names.indexOf('A'))
    expect(names.indexOf('C')).toBeGreaterThan(names.indexOf('A'))
    expect(names.indexOf('D')).toBeGreaterThan(names.indexOf('B'))
    expect(names.indexOf('D')).toBeGreaterThan(names.indexOf('C'))
    expect(names[3]).toBe('D')
  })

  it('F2.5: preserves user declaration order when plugins have no dependencies on each other', () => {
    const p1: TspPlugin = { name: 'alpha' }
    const p2: TspPlugin = { name: 'beta' }
    const p3: TspPlugin = { name: 'gamma' }

    const sorted1 = sortPlugins([p1, p2, p3])
    expect(sorted1.map(p => p.name)).toEqual(['alpha', 'beta', 'gamma'])

    const sorted2 = sortPlugins([p3, p1, p2])
    expect(sorted2.map(p => p.name)).toEqual(['gamma', 'alpha', 'beta'])
  })
})
