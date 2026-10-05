import { describe, it, expect } from 'vitest'
import { BUILT_AGAINST_VERSIONS } from '../../cli/lib/built-against-versions.js'
import {
  TARGET_PROFILES,
  getTargetProfile,
  ARCHETYPE_PROFILES,
  getArchetypeProfile,
  composeInitConfig,
  composeInitScripts,
  composeInitDependencies,
  composeInitPackagePatches,
  OA_SDK_INIT_PACKAGES,
  type OaSdkPackageSources,
} from '../../cli/lib/init/index.js'
import type { TargetFrameworkId } from '../../cli/lib/init/types.js'
import type { LifecycleArchetypeId } from '../../cli/lib/init/archetypes/types.js'

describe('Orthogonal Target x Archetype Composition Engine ($6 \\times 3 = 18$ Matrix)', () => {
  const targetIds: TargetFrameworkId[] = ['fastify', 'elysia', 'hono', 'express', 'nestjs', 'generic']
  const archetypeIds: LifecycleArchetypeId[] = ['mvp', 'microservice', 'enterprise']
  /** A project in a pnpm workspace that has every `@oa-sdk` package init recommends as a member. */
  const inOaSdkWorkspace: OaSdkPackageSources = {
    workspacePackages: new Set(Object.keys(OA_SDK_INIT_PACKAGES)),
    versions: BUILT_AGAINST_VERSIONS,
  }

  describe('1. Full Matrix Permutations (18 Compositions)', () => {
    for (const tId of targetIds) {
      for (const aId of archetypeIds) {
        it(`composes ${tId} with ${aId} cleanly`, () => {
          const target = getTargetProfile(tId)
          const archetype = getArchetypeProfile(aId)
          const runtime = target.defaultRuntime

          const options = {
            cwd: '/workspace/test-app',
            frameworkId: target.id,
            runtime,
            detectedSchema: {
              type: 'openapi-yaml' as const,
              filePath: 'openapi.yaml',
              confidence: 0.9,
              description: 'Root spec',
            },
          }

          // 1. Config Generation
          const config = composeInitConfig(target, archetype, options)
          expect(config).toContain("import { defineConfig } from '@oa-sdk/codegen'")
          expect(config).toContain(`archetype: '${aId}'`)
          expect(config).toContain(`target: '${tId}'`)
          expect(config).toContain("schemaEntry: 'openapi.yaml'")
          expect(config).toContain('// Shared Platform Core SSOT')
          expect(config).toContain('// Product-Specific Domain Extensions')

          // 2. Scripts Generation
          const scripts = composeInitScripts(target, archetype, options)
          expect(Object.keys(scripts).length).toBeGreaterThanOrEqual(2)

          // 3. Dependencies Generation: outside a workspace, codegen installs from the registry...
          const deps = composeInitDependencies(target, archetype, options)
          expect(deps.devDependencies).toBeDefined()
          expect(deps.devDependencies['@oa-sdk/codegen']).toBe(`^${BUILT_AGAINST_VERSIONS['@oa-sdk/codegen']}`)
          const specifiers = Object.values({ ...deps.dependencies, ...deps.devDependencies })
          expect(specifiers.filter(specifier => specifier.startsWith('workspace:'))).toEqual([])

          // ...and inside a pnpm workspace that has it, through the workspace protocol.
          const workspaceDeps = composeInitDependencies(target, archetype, { ...options, oaSdkSources: inOaSdkWorkspace })
          expect(workspaceDeps.devDependencies['@oa-sdk/codegen']).toBe('workspace:*')
        })
      }
    }
  })

  describe('2. Strict Bun vs Node Runtime Isolation', () => {
    it('enforces Bun runtime isolation on Elysia target across all archetypes', () => {
      const elysia = getTargetProfile('elysia')

      for (const aId of archetypeIds) {
        const archetype = getArchetypeProfile(aId)
        const options = {
          cwd: '/workspace/elysia-app',
          frameworkId: elysia.id,
          runtime: elysia.defaultRuntime, // 'bun'
        }

        const deps = composeInitDependencies(elysia, archetype, options)
        const scripts = composeInitScripts(elysia, archetype, options)

        // STRICT INVARIANT: Bun projects MUST NOT receive Node tooling
        expect(deps.devDependencies['tsx'], `${aId} should not have tsx`).toBeUndefined()
        expect(deps.devDependencies['nodemon'], `${aId} should not have nodemon`).toBeUndefined()
        expect(deps.devDependencies['@types/node'], `${aId} should not have @types/node`).toBeUndefined()
        expect(deps.devDependencies['vitest'], `${aId} should not have vitest`).toBeUndefined()
        expect(deps.devDependencies['@types/bun'], `${aId} must have @types/bun`).toBeDefined()

        // Scripts must use bun or bun x
        for (const [key, cmd] of Object.entries(scripts)) {
          expect(cmd, `Script ${key} in Elysia ${aId} should not use tsx`).not.toContain('tsx')
          expect(cmd, `Script ${key} in Elysia ${aId} should not use vitest`).not.toContain('vitest')
          if (cmd.includes('oa-gen')) {
            expect(cmd, `Script ${key} in Elysia ${aId} should use bun x oa-gen`).toContain('bun x oa-gen')
          }
        }
      }
    })

    it('enforces Node runtime tooling on Fastify target across all archetypes', () => {
      const fastify = getTargetProfile('fastify')

      for (const aId of archetypeIds) {
        const archetype = getArchetypeProfile(aId)
        const options = {
          cwd: '/workspace/fastify-app',
          frameworkId: fastify.id,
          runtime: fastify.defaultRuntime, // 'node'
        }

        const deps = composeInitDependencies(fastify, archetype, options)
        const scripts = composeInitScripts(fastify, archetype, options)

        // Node projects must have Node ESM tooling, and strictly 0 @types/bun
        expect(deps.devDependencies['@types/bun'], `${aId} should not have @types/bun`).toBeUndefined()
        expect(deps.devDependencies['tsx'], `${aId} should have tsx`).toBeDefined()
        expect(deps.devDependencies['@types/node'], `${aId} should have @types/node`).toBeDefined()

        // Scripts should use Node ESM tooling
        expect(scripts['dev']).toContain('tsx watch')
      }
    })

    it('handles Hono dynamic runtime correctly on Bun vs Node', () => {
      const hono = getTargetProfile('hono')
      const microservice = getArchetypeProfile('microservice')

      // 1. Hono on Bun
      const bunDeps = composeInitDependencies(hono, microservice, {
        cwd: '.',
        frameworkId: 'hono',
        runtime: 'bun',
      })
      const bunScripts = composeInitScripts(hono, microservice, {
        cwd: '.',
        frameworkId: 'hono',
        runtime: 'bun',
      })
      expect(bunDeps.devDependencies['@types/bun']).toBeDefined()
      expect(bunDeps.devDependencies['tsx']).toBeUndefined()
      expect(bunDeps.devDependencies['vitest']).toBeUndefined()
      expect(bunScripts['test:contract']).toBe('bun test src/__tests__/contracts')

      // 2. Hono on Node
      const nodeDeps = composeInitDependencies(hono, microservice, {
        cwd: '.',
        frameworkId: 'hono',
        runtime: 'node',
      })
      const nodeScripts = composeInitScripts(hono, microservice, {
        cwd: '.',
        frameworkId: 'hono',
        runtime: 'node',
      })
      expect(nodeDeps.devDependencies['@types/node']).toBeDefined()
      expect(nodeDeps.devDependencies['@types/bun']).toBeUndefined()
      expect(nodeDeps.devDependencies['vitest']).toBeDefined()
      expect(nodeScripts['test:contract']).toBe('vitest run src/__tests__/contracts')
    })
  })

  describe('3. Lifecycle Archetype Invariants in Composed Configurations', () => {
    it('Enterprise archetype injects CI gate scripts and persona traits across all targets', () => {
      const enterprise = getArchetypeProfile('enterprise')

      for (const tId of targetIds) {
        const target = getTargetProfile(tId)
        const patches = composeInitPackagePatches(target, enterprise, {
          cwd: '.',
          frameworkId: target.id,
          runtime: target.defaultRuntime,
        })

        expect(patches.scripts['diff'], `${tId} diff script`).toBeDefined()
        expect(patches.scripts['ci:gate'], `${tId} ci:gate script`).toBeDefined()
        expect(patches.scripts['personas:check'], `${tId} personas:check script`).toBeDefined()

        // @oa-sdk/personas is private: only a workspace that contains it can provide it.
        expect(patches.devDependencies['@oa-sdk/personas'], `${tId} personas devDep`).toBeUndefined()
        expect(patches.unavailable.map(entry => entry.name), `${tId} unavailable`).toEqual(['@oa-sdk/personas'])
        const workspacePatches = composeInitPackagePatches(target, enterprise, {
          cwd: '.',
          frameworkId: target.id,
          runtime: target.defaultRuntime,
          oaSdkSources: inOaSdkWorkspace,
        })
        expect(workspacePatches.devDependencies['@oa-sdk/personas'], `${tId} personas devDep in workspace`).toBe('workspace:*')
        expect(workspacePatches.unavailable, `${tId} unavailable in workspace`).toEqual([])
      }
    })

    it('Microservice archetype injects contract testing scripts and wire typing', () => {
      const microservice = getArchetypeProfile('microservice')

      for (const tId of targetIds) {
        const target = getTargetProfile(tId)
        const patches = composeInitPackagePatches(target, microservice, {
          cwd: '.',
          frameworkId: target.id,
          runtime: target.defaultRuntime,
        })

        expect(patches.scripts['generate:contract']).toBeDefined()
        expect(patches.scripts['test:contract']).toBeDefined()
        expect(patches.scripts['audit:wire']).toBeDefined()
      }
    })

    it('MVP archetype injects live mock and client SDK scripts', () => {
      const mvp = getArchetypeProfile('mvp')

      for (const tId of targetIds) {
        const target = getTargetProfile(tId)
        const patches = composeInitPackagePatches(target, mvp, {
          cwd: '.',
          frameworkId: target.id,
          runtime: target.defaultRuntime,
        })

        expect(patches.scripts['mock']).toBeDefined()
        expect(patches.scripts['generate:client']).toBeDefined()
        expect(patches.scripts['validate']).toBeDefined()
        expect(patches.devDependencies['@oa-sdk/client']).toBeDefined()
      }
    })
  })
})
