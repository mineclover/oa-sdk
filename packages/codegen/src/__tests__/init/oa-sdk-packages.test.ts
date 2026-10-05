import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILT_AGAINST_VERSIONS } from '../../cli/lib/built-against-versions.js'
import { COMPANION_PACKAGES } from '../../cli/lib/companion-packages.js'
import {
  ARCHETYPE_PROFILES,
  OA_SDK_INIT_PACKAGES,
  REGISTRY_OA_SDK_PACKAGES,
  REGISTRY_SOURCES,
  TARGET_PROFILES,
  UNPINNED_SPECIFIER,
  WORKSPACE_SPECIFIER,
  composeInitDependencies,
  findOaSdkPackageSources,
  findPnpmWorkspace,
  findUninstallableOaSdkEntries,
  resolveOaSdkPackage,
  type OaSdkPackageName,
} from '../../cli/lib/init/index.js'
import type { TargetRuntime } from '../../cli/lib/init/types.js'

/**
 * `oa-gen init` must write `@oa-sdk` specifiers the project can install where
 * it lives: `workspace:*` resolves only inside a pnpm workspace that has the
 * package, and npm rejects the protocol outright (EUNSUPPORTEDPROTOCOL).
 */

const CODEGEN_DIR = path.resolve(__dirname, '../../..')
const OA_SDK_PACKAGES = Object.keys(OA_SDK_INIT_PACKAGES) as OaSdkPackageName[]
const runtimes: TargetRuntime[] = ['node', 'bun']

/** Every target x archetype x runtime combination init can scaffold. */
const combinations = Object.values(TARGET_PROFILES).flatMap(target =>
  ARCHETYPE_PROFILES.flatMap(archetype => runtimes.map(runtime => ({
    target,
    archetype,
    options: { cwd: '/workspace/app', frameworkId: target.id, runtime },
    label: `${target.id} x ${archetype.id} (${runtime})`,
  }))))

describe('resolveOaSdkPackage', () => {
  const versions = { '@oa-sdk/router': '0.4.2', '@oa-sdk/codegen': '1.0.0-beta.3' }

  it('uses the workspace protocol for a package of the workspace the project is a member of', () => {
    const sources = { workspacePackages: new Set(['@oa-sdk/router', '@oa-sdk/personas']), versions }
    expect(resolveOaSdkPackage('@oa-sdk/router', sources)).toEqual({ name: '@oa-sdk/router', specifier: WORKSPACE_SPECIFIER })
    expect(resolveOaSdkPackage('@oa-sdk/personas', sources)).toEqual({ name: '@oa-sdk/personas', specifier: WORKSPACE_SPECIFIER })
  })

  it('uses the releases compatible with the built-against version for a published package', () => {
    const sources = { workspacePackages: new Set(['@oa-sdk/core']), versions }
    expect(resolveOaSdkPackage('@oa-sdk/router', sources).specifier).toBe('^0.4.2')
    expect(resolveOaSdkPackage('@oa-sdk/codegen', sources).specifier).toBe('^1.0.0-beta.3')
  })

  it('uses the latest release when this build did not record the version it was built against', () => {
    expect(resolveOaSdkPackage('@oa-sdk/client', { workspacePackages: new Set(), versions: {} }).specifier)
      .toBe(UNPINNED_SPECIFIER)
  })

  it('leaves a private package out, with the reason, outside a workspace that has it', () => {
    const resolution = resolveOaSdkPackage('@oa-sdk/personas', { workspacePackages: new Set(['@oa-sdk/router']), versions })
    expect(resolution.specifier).toBeUndefined()
    expect(resolution).toMatchObject({ name: '@oa-sdk/personas', reason: expect.stringContaining('not published to the registry') })
  })

  it('defaults to the registry and the versions this build was built against', () => {
    expect(resolveOaSdkPackage('@oa-sdk/codegen').specifier).toBe(`^${BUILT_AGAINST_VERSIONS['@oa-sdk/codegen']}`)
    expect(REGISTRY_SOURCES.workspacePackages.size).toBe(0)
  })
})

describe('the @oa-sdk packages init recommends', () => {
  it('are named by profiles only, never given a specifier there, and are all used', () => {
    const recommended = new Set<string>()
    for (const { target, archetype, options, label } of combinations) {
      for (const deps of [target.getRecommendedDependencies(options), archetype.getRecommendedDependencies({ ...options, archetypeId: archetype.id })]) {
        const specified = Object.keys({ ...deps.dependencies, ...deps.devDependencies }).filter(name => name.startsWith('@oa-sdk/'))
        expect(specified, label).toEqual([])
      }
      const { devDependencies, unavailable } = composeInitDependencies(target, archetype, options)
      for (const name of Object.keys(devDependencies)) if (name.startsWith('@oa-sdk/')) recommended.add(name)
      for (const { name } of unavailable) recommended.add(name)
    }
    expect([...recommended].sort()).toEqual([...OA_SDK_PACKAGES].sort())
  })

  it('are private in the oa-sdk workspace exactly when only a workspace can provide them', async () => {
    const workspace = await findPnpmWorkspace(CODEGEN_DIR)
    for (const name of OA_SDK_PACKAGES) {
      const directory = workspace?.packages.get(name)
      expect(directory, `${name} is an oa-sdk workspace package`).toBeDefined()
      const manifest = JSON.parse(await fs.readFile(path.join(directory!, 'package.json'), 'utf8')) as { private?: boolean }
      expect(manifest.private === true, name).toBe(OA_SDK_INIT_PACKAGES[name] === 'workspace')
    }
  })

  it('have a built-against version when published, so a built codegen never writes an unpinned specifier', () => {
    for (const name of OA_SDK_PACKAGES) {
      if (OA_SDK_INIT_PACKAGES[name] === 'registry') expect(BUILT_AGAINST_VERSIONS[name], name).toBeDefined()
    }
  })

  it('are written, outside any workspace, with specifiers npm accepts', () => {
    // npm resolves registry ranges; it rejects `workspace:` with EUNSUPPORTEDPROTOCOL.
    const range = /^\^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
    for (const { target, archetype, options, label } of combinations) {
      const { dependencies, devDependencies, unavailable } = composeInitDependencies(target, archetype, options)
      for (const [name, specifier] of Object.entries({ ...dependencies, ...devDependencies })) {
        expect(specifier, `${label}: ${name}`).not.toMatch(/^workspace:/)
        if (name.startsWith('@oa-sdk/')) expect(specifier, `${label}: ${name}`).toMatch(range)
      }
      expect(unavailable.map(entry => entry.name), label).toEqual(archetype.id === 'enterprise' ? ['@oa-sdk/personas'] : [])
    }
  })
})

describe('REGISTRY_OA_SDK_PACKAGES', () => {
  it('are exactly the packages init writes a registry range for outside any workspace', () => {
    const written = new Set<string>()
    for (const { target, archetype, options } of combinations) {
      const { devDependencies } = composeInitDependencies(target, archetype, options)
      for (const name of Object.keys(devDependencies)) if (name.startsWith('@oa-sdk/')) written.add(name)
    }
    expect([...REGISTRY_OA_SDK_PACKAGES].sort()).toEqual([...written].sort())
    expect(REGISTRY_OA_SDK_PACKAGES).toContain('@oa-sdk/core')
    expect(REGISTRY_OA_SDK_PACKAGES).not.toContain('@oa-sdk/personas')
  })

  it('include every companion package, whose install hints name the same built-against range', () => {
    for (const name of COMPANION_PACKAGES) expect(REGISTRY_OA_SDK_PACKAGES, name).toContain(name)
  })
})

describe('findUninstallableOaSdkEntries', () => {
  const versions = { '@oa-sdk/core': '0.3.1', '@oa-sdk/parser': '0.4.0' }
  const outside = { workspacePackages: new Set<string>(), versions }
  const manifest = (value: unknown) => JSON.stringify(value)

  it('tells to remove a private package outside a workspace that has it, whatever its specifier', () => {
    const entries = findUninstallableOaSdkEntries(manifest({
      devDependencies: { '@oa-sdk/personas': '^0.1.0' },
      peerDependencies: { '@oa-sdk/personas': 'workspace:*' },
    }), outside)
    expect(entries).toEqual([
      { name: '@oa-sdk/personas', section: 'devDependencies', specifier: '^0.1.0', reason: expect.stringContaining('not published to the registry'), fix: { action: 'remove' } },
      { name: '@oa-sdk/personas', section: 'peerDependencies', specifier: 'workspace:*', reason: expect.stringContaining('not published to the registry'), fix: { action: 'remove' } },
    ])
  })

  it('tells to replace a workspace: entry outside a workspace that has the package with the registry specifier init writes', () => {
    const entries = findUninstallableOaSdkEntries(manifest({
      dependencies: { '@oa-sdk/parser': 'workspace:^', '@oa-sdk/dpm': 'workspace:*', 'not-oa-sdk': 'workspace:*' },
      devDependencies: { '@oa-sdk/core': 'workspace:*', '@oa-sdk/client': 'workspace:*', '@oa-sdk/router': '^0.2.0' },
    }), outside)
    expect(entries.map(({ name, section, specifier, fix }) => ({ name, section, specifier, fix }))).toEqual([
      // Not recommended by init, but built against: its range.
      { name: '@oa-sdk/parser', section: 'dependencies', specifier: 'workspace:^', fix: { action: 'replace', replacement: '^0.4.0' } },
      // Neither: no version this build knows.
      { name: '@oa-sdk/dpm', section: 'dependencies', specifier: 'workspace:*', fix: { action: 'replace', replacement: undefined } },
      { name: '@oa-sdk/core', section: 'devDependencies', specifier: 'workspace:*', fix: { action: 'replace', replacement: '^0.3.1' } },
      // A registry package whose built-against version this build does not know: what init writes for it.
      { name: '@oa-sdk/client', section: 'devDependencies', specifier: 'workspace:*', fix: { action: 'replace', replacement: UNPINNED_SPECIFIER } },
    ])
    expect(entries[0]!.reason).toBe('the workspace: protocol resolves only in a pnpm workspace that has @oa-sdk/parser as a member')
  })

  it('finds nothing to fix for the packages of the workspace the project is a member of', () => {
    const member = { workspacePackages: new Set(['@oa-sdk/personas', '@oa-sdk/core']), versions }
    expect(findUninstallableOaSdkEntries(manifest({
      devDependencies: { '@oa-sdk/personas': 'workspace:*', '@oa-sdk/core': 'workspace:*', '@oa-sdk/router': '^0.2.2' },
    }), member)).toEqual([])
  })

  it('finds no entries in JSON that is not a manifest with dependency maps', () => {
    expect(findUninstallableOaSdkEntries('[]', outside)).toEqual([])
    expect(findUninstallableOaSdkEntries(manifest({ devDependencies: 'workspace:*' }), outside)).toEqual([])
  })
})

describe('findOaSdkPackageSources', () => {
  it('lists the workspace packages for a member of the oa-sdk repository workspace', async () => {
    const sources = await findOaSdkPackageSources(CODEGEN_DIR)
    for (const name of OA_SDK_PACKAGES) expect(sources.workspacePackages.has(name), name).toBe(true)
    expect(sources.versions).toBe(BUILT_AGAINST_VERSIONS)
  })

  it('lists nothing for a project outside any workspace', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-sdk-sources-'))
    try {
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name":"consumer"}')
      expect((await findOaSdkPackageSources(projectDir)).workspacePackages.size).toBe(0)
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true })
    }
  })
})
