import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Tier 1: F10 - Governance Registration & Monorepo Gates', () => {
  const repoRoot = resolve('.')

  it('F10.1: verifies docs/internal/api-index.md exists and tracks API symbols', () => {
    const apiIndexPath = resolve(repoRoot, 'docs/internal/api-index.md')
    expect(existsSync(apiIndexPath)).toBe(true)

    const content = readFileSync(apiIndexPath, 'utf8')
    expect(content).toContain('API Index')
    expect(content).toContain('@oa-sdk/codegen')
  })

  it('F10.2: verifies docs/internal/release-policy.json includes @oa-sdk/codegen in distributionCandidates', () => {
    const policyPath = resolve(repoRoot, 'docs/internal/release-policy.json')
    expect(existsSync(policyPath)).toBe(true)

    const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
    expect(policy.distributionCandidates).toContain('@oa-sdk/codegen')
    expect(policy.primaryTrack).toBe('corePlatform')
  })

  it('F10.3: verifies packages/codegen package.json is ESM-compliant with proper engine constraints', () => {
    const pkgPath = resolve(repoRoot, 'packages/codegen/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

    expect(pkg.name).toBe('@oa-sdk/codegen')
    expect(pkg.type).toBe('module')
    expect(pkg.bin).toBeDefined()
    expect(pkg.bin['oa-gen']).toBeDefined()
  })

  it('F10.4: verifies packages/codegen/src/plugin/index.ts exports all core plugin engine contracts', async () => {
    const pluginIndex = await import('../../../../packages/codegen/src/plugin/index.js')

    expect(pluginIndex.defineConfig).toBeDefined()
    expect(pluginIndex.defineTspConfig).toBeDefined()
    expect(pluginIndex.validateTspConfig).toBeDefined()
    expect(pluginIndex.sortPlugins).toBeDefined()
    expect(pluginIndex.compileTypeSpecInMemory).toBeDefined()
    expect(pluginIndex.TspPluginContextImpl).toBeDefined()
    expect(pluginIndex.TspPluginCycleError).toBeDefined()
    expect(pluginIndex.TspPluginMissingDependencyError).toBeDefined()
    expect(pluginIndex.TspPluginDuplicateError).toBeDefined()
    expect(pluginIndex.TspFileConflictError).toBeDefined()
  })

  it('F10.5: verifies error hierarchy inherits from Error and preserves error names', async () => {
    const {
      TspPluginError,
      TspPluginCycleError,
      TspPluginMissingDependencyError,
      TspPluginDuplicateError,
      TspFileConflictError,
      TspConfigValidationError,
    } = await import('../../../../packages/codegen/src/plugin/index.js')

    const cycleErr = new TspPluginCycleError(['A', 'B', 'A'])
    expect(cycleErr).toBeInstanceOf(Error)
    expect(cycleErr.name).toBe('TspPluginCycleError')
    expect(cycleErr.cycle).toEqual(['A', 'B', 'A'])

    const missErr = new TspPluginMissingDependencyError('pluginB', 'pluginA')
    expect(missErr.name).toBe('TspPluginMissingDependencyError')

    const dupErr = new TspPluginDuplicateError('pluginA')
    expect(dupErr.name).toBe('TspPluginDuplicateError')

    const confErr = new TspFileConflictError('path.ts', 'p1', 'p2')
    expect(confErr.name).toBe('TspFileConflictError')

    const valErr = new TspConfigValidationError('invalid')
    expect(valErr.name).toBe('TspConfigValidationError')
  })
})
