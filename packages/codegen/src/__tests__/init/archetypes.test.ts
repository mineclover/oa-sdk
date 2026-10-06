import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  ARCHETYPE_PROFILES,
  getArchetypeProfile,
  detectArchetypeProfile,
  MvpArchetypeProfile,
  MicroserviceArchetypeProfile,
  EnterpriseArchetypeProfile,
  type ArchetypeProfile,
} from '../../cli/lib/init/archetypes/index.js'

describe('Modular Archetype Engine (packages/codegen/src/cli/lib/init/archetypes/)', () => {
  describe('1. MvpArchetypeProfile', () => {
    const mvp = new MvpArchetypeProfile()

    it('has correct metadata and identifier', () => {
      expect(mvp.id).toBe('mvp')
      expect(mvp.name).toBe('MVP')
      expect(mvp.displayName).toBe('MVP')
      expect(mvp.description).toContain('Rapid iteration')
      expect(mvp.summaryBullet).toBeDefined()
    })

    it('generates archetype config snippet for MVP', () => {
      const snippet = mvp.getArchetypeConfig({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'mvp',
      })

      expect(snippet.rootFields['archetype']).toBe('mvp')
      expect(snippet.rootFields['client']).toEqual({ outDir: './src/client' })
      expect(snippet.rootFields['mock']).toEqual({ port: 4010, watch: true })
      expect(snippet.specFields?.['strictValidation']).toBe(false)
    })

    it('generates partial OaConfig fragment for MVP', () => {
      const fragment = mvp.generateConfigFragment({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'mvp',
      })

      expect(fragment.archetype).toBe('mvp')
      expect(fragment.core?.dialect?.oasVersion).toBe('3.2.0')
      expect(fragment.core?.client?.enabled).toBe(true)
      expect(fragment.core?.client?.wireFormatSafety).toBe(false)
      expect(fragment.core?.gates?.failOnBreaking).toBe(false)
      expect(fragment.core?.gates?.preflightLint).toBe('warn')
      expect(fragment.product?.archetype).toBe('mvp')
      expect(fragment.product?.framework).toBe('fastify')
      expect(fragment.product?.jitSchema).toBe(false)
    })

    it('returns Node.js scripts for MVP', () => {
      const scripts = mvp.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'mvp',
      })

      // The client SDK comes from the generate script of the target: `generate --target client` was plain generate.
      expect(scripts).toEqual({ mock: 'oa-gen mock --watch', validate: 'oa-gen validate' })
    })

    it('returns Bun scripts for MVP', () => {
      const scripts = mvp.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'elysia',
        runtime: 'bun',
        archetypeId: 'mvp',
      })

      expect(scripts).toEqual({ mock: 'bun x oa-gen mock --watch', validate: 'bun x oa-gen validate' })
    })

    it('returns recommended devDependencies for MVP', () => {
      const deps = mvp.getRecommendedDependencies({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'mvp',
      })

      // `@oa-sdk` packages are named only; init picks their specifiers (oa-sdk-packages.ts).
      expect(deps.oaSdkDevDependencies).toEqual(['@oa-sdk/client', '@oa-sdk/mock-server'])
      expect(deps.devDependencies['@oa-sdk/client']).toBeUndefined()
    })

    it('detects early stage version markers in detect()', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mvp-detect-'))
      try {
        await fs.writeFile(
          path.join(tmp, 'package.json'),
          JSON.stringify({ name: 'prototype', version: '0.1.0' }),
        )
        const res = await mvp.detect(tmp)
        expect(res.confidence).toBeGreaterThan(0.5)
        expect(res.matchedMarkers.some((m) => m.includes('early package version'))).toBe(true)
      } finally {
        await fs.rm(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('2. MicroserviceArchetypeProfile', () => {
    const microservice = new MicroserviceArchetypeProfile()

    it('has correct metadata and identifier', () => {
      expect(microservice.id).toBe('microservice')
      expect(microservice.name).toBe('Microservice')
      expect(microservice.displayName).toBe('Microservice')
      expect(microservice.description).toContain('High-throughput')
      expect(microservice.summaryBullet).toBeDefined()
    })

    it('generates archetype config snippet for Microservice', () => {
      const snippet = microservice.getArchetypeConfig({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'microservice',
      })

      expect(snippet.rootFields['archetype']).toBe('microservice')
      expect(snippet.rootFields['contracts']).toEqual({
        outDir: './src/contracts',
        wireSafe: true,
      })
      expect(snippet.specFields?.['target']).toBe('fastify')
    })

    it('generates partial OaConfig fragment for Microservice', () => {
      const fragment = microservice.generateConfigFragment({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'microservice',
      })

      expect(fragment.archetype).toBe('microservice')
      expect(fragment.core?.client?.wireFormatSafety).toBe(true)
      expect(fragment.core?.typegen?.resolveSymbolCycles).toBe(true)
      expect(fragment.core?.gates?.driftCheck).toBe(true)
      expect(fragment.core?.gates?.preflightLint).toBe('error')
      expect(fragment.product?.jitSchema).toBe(true)
      expect(fragment.product?.zeroCopy).toBe(true)
    })

    it('returns only the live mock for Node: init writes no contract tests to run', () => {
      const scripts = microservice.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'microservice',
      })

      expect(scripts).toEqual({ mock: 'oa-gen mock --watch' })
    })

    it('returns only the live mock for Bun', () => {
      const scripts = microservice.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'elysia',
        runtime: 'bun',
        archetypeId: 'microservice',
      })

      expect(scripts).toEqual({ mock: 'bun x oa-gen mock --watch' })
    })

    it('adds no test runner, on Node or Bun', () => {
      const nodeDeps = microservice.getRecommendedDependencies({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'microservice',
      })
      expect(nodeDeps.devDependencies).toEqual({})
      expect(nodeDeps.oaSdkDevDependencies).toEqual(['@oa-sdk/core', '@oa-sdk/router'])

      const bunDeps = microservice.getRecommendedDependencies({
        cwd: '.',
        frameworkId: 'elysia',
        runtime: 'bun',
        archetypeId: 'microservice',
      })
      expect(bunDeps.devDependencies).toEqual({})
      expect(bunDeps.oaSdkDevDependencies).toEqual(['@oa-sdk/core', '@oa-sdk/router'])
    })

    it('detects Dockerfile and k8s in detect()', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'microservice-detect-'))
      try {
        await fs.writeFile(path.join(tmp, 'Dockerfile'), 'FROM node:20-alpine')
        await fs.mkdir(path.join(tmp, 'k8s'))
        const res = await microservice.detect(tmp)
        expect(res.confidence).toBeGreaterThanOrEqual(0.7)
        expect(res.matchedMarkers.some((m) => m.includes('Dockerfile'))).toBe(true)
        expect(res.matchedMarkers.some((m) => m.includes('k8s'))).toBe(true)
      } finally {
        await fs.rm(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('3. EnterpriseArchetypeProfile', () => {
    const enterprise = new EnterpriseArchetypeProfile()

    it('has correct metadata and identifier', () => {
      expect(enterprise.id).toBe('enterprise')
      expect(enterprise.name).toBe('Enterprise')
      expect(enterprise.displayName).toBe('Enterprise')
      expect(enterprise.description).toContain('Breaking change CI gate against a committed contract baseline')
      expect(enterprise.summaryBullet).toBeDefined()
    })

    it('generates archetype config snippet for Enterprise', () => {
      const snippet = enterprise.getArchetypeConfig({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'enterprise',
      })

      expect(snippet.rootFields['archetype']).toBe('enterprise')
      expect(snippet.rootFields['governance']).toEqual({
        failOnBreaking: true,
        require32: true,
        strictLint: true,
        lintCategories: ['structure', 'refs', 'components', 'semantics'],
      })
      expect(snippet.rootFields['personas']).toEqual({
        enabled: true,
        traitsFile: 'skill.yaml',
      })
      expect(snippet.specFields?.['profile']).toBe('full-api-document')
    })

    it('generates partial OaConfig fragment for Enterprise', () => {
      const fragment = enterprise.generateConfigFragment({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'enterprise',
      })

      expect(fragment.archetype).toBe('enterprise')
      expect(fragment.core?.gates?.failOnBreaking).toBe(true)
      expect(fragment.core?.gates?.baseRef).toBe('origin/main')
      expect(fragment.core?.gates?.preflightLint).toBe('error')
      expect(fragment.product?.personas?.enforceCoverage).toBe(true)
      expect(fragment.product?.personas?.minCoverageRatio).toBe(0.8)
    })

    const specAt = (filePath: string) => ({
      type: 'openapi-yaml' as const,
      filePath,
      confidence: 1,
      description: 'test spec',
    })

    it('returns Enterprise gate scripts on the spec and the contract baseline for Node', () => {
      const scripts = enterprise.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'express',
        runtime: 'node',
        archetypeId: 'enterprise',
      })

      // Without a detected spec, the openapi.yaml init records as the schema entry.
      expect(scripts).toEqual({
        'lint:spec': 'oa-gen lint --spec openapi.yaml',
        'diff': 'oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking',
        'baseline:update': 'oa-gen normalize --spec openapi.yaml --output openapi.baseline.yaml',
        'ci:gate':
          'oa-gen validate --spec openapi.yaml --require-32' +
          ' && oa-gen lint --spec openapi.yaml' +
          ' && oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking',
      })
    })

    it('returns Enterprise scripts for Bun with every oa-gen command run through bun x', () => {
      const scripts = enterprise.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'elysia',
        runtime: 'bun',
        archetypeId: 'enterprise',
      })

      expect(scripts['diff']).toBe('bun x oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking')
      expect(scripts['ci:gate']).toBe(
        'bun x oa-gen validate --spec openapi.yaml --require-32' +
          ' && bun x oa-gen lint --spec openapi.yaml' +
          ' && bun x oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking',
      )
      for (const script of Object.values(scripts)) {
        expect(script.split(' && ').every(command => command.startsWith('bun x oa-gen ')), script).toBe(true)
      }
    })

    it('runs the gate on the detected spec entry point, TypeSpec included, quoting a path with spaces', () => {
      const options = { cwd: '.', frameworkId: 'generic' as const, runtime: 'node' as const, archetypeId: 'enterprise' as const }

      const typespec = enterprise.getRecommendedScripts({ ...options, detectedSchema: specAt(path.join('typespec', 'main.tsp')) })
      expect(typespec['lint:spec']).toBe('oa-gen lint --spec typespec/main.tsp')
      expect(typespec['baseline:update']).toBe('oa-gen normalize --spec typespec/main.tsp --output openapi.baseline.yaml')

      const spaced = enterprise.getRecommendedScripts({ ...options, detectedSchema: specAt(path.join('My API', 'openapi.yaml')) })
      expect(spaced['diff']).toBe('oa-gen diff --base openapi.baseline.yaml --head "My API/openapi.yaml" --fail-on-breaking')
    })

    it('plans the contract baseline from the spec entry point', () => {
      const options = { cwd: '.', frameworkId: 'generic' as const, runtime: 'node' as const, archetypeId: 'enterprise' as const }

      expect(enterprise.getContractBaseline(options)).toEqual({ path: 'openapi.baseline.yaml', specPath: 'openapi.yaml' })
      expect(enterprise.getContractBaseline({ ...options, detectedSchema: specAt('main.tsp') }))
        .toEqual({ path: 'openapi.baseline.yaml', specPath: 'main.tsp' })
    })

    it('adds no gate and no baseline for a spec entry point lint and diff cannot load', () => {
      // A TypeScript schema module is projected only by the commands that read oa.config.ts.
      const options = {
        cwd: '.',
        frameworkId: 'generic' as const,
        runtime: 'node' as const,
        archetypeId: 'enterprise' as const,
        detectedSchema: specAt('src/schema.ts'),
      }

      expect(enterprise.getRecommendedScripts(options)).toEqual({})
      expect(enterprise.getContractBaseline(options)).toEqual({
        path: 'openapi.baseline.yaml',
        status: 'no-gate',
        reason: 'the spec entry point src/schema.ts is not an OpenAPI YAML/JSON document or a TypeSpec entry point, ' +
          'which oa-gen lint and diff read',
      })
    })

    it('adds no gate and no baseline, with the reason, when init cannot tell the spec entry point', () => {
      // init keeps an oa.config.ts whose spec it cannot tell; the scripts never fall back to openapi.yaml.
      const options = {
        cwd: '.',
        frameworkId: 'generic' as const,
        runtime: 'node' as const,
        archetypeId: 'enterprise' as const,
        specEntryUnavailable: 'the existing oa.config.ts did not load',
      }

      expect(enterprise.getRecommendedScripts(options)).toEqual({})
      expect(enterprise.getContractBaseline(options)).toEqual({
        path: 'openapi.baseline.yaml',
        status: 'no-gate',
        reason: 'the existing oa.config.ts did not load',
      })
    })

    it('mvp and microservice have no contract baseline', () => {
      const profiles: ArchetypeProfile[] = [new MvpArchetypeProfile(), new MicroserviceArchetypeProfile()]
      for (const profile of profiles) expect(profile.getContractBaseline, profile.id).toBeUndefined()
    })

    it('returns recommended devDependencies for Enterprise', () => {
      const deps = enterprise.getRecommendedDependencies({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
        archetypeId: 'enterprise',
      })

      expect(deps.oaSdkDevDependencies).toEqual(['@oa-sdk/personas', '@oa-sdk/core'])
    })

    it('detects skill.yaml and pnpm-workspace in detect()', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'enterprise-detect-'))
      try {
        await fs.writeFile(path.join(tmp, 'skill.yaml'), 'name: my-skill')
        await fs.writeFile(path.join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"')
        const res = await enterprise.detect(tmp)
        expect(res.confidence).toBeGreaterThanOrEqual(0.7)
        expect(res.matchedMarkers.some((m) => m.includes('skill.yaml'))).toBe(true)
        expect(res.matchedMarkers.some((m) => m.includes('monorepo'))).toBe(true)
      } finally {
        await fs.rm(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('4. Archetype Registry & Resolver', () => {
    it('registers all 3 concrete archetypes', () => {
      expect(ARCHETYPE_PROFILES.map((p) => p.id)).toEqual(['mvp', 'microservice', 'enterprise'])
    })

    it('resolves archetype by identifier case-insensitively', () => {
      expect(getArchetypeProfile('mvp').id).toBe('mvp')
      expect(getArchetypeProfile('MVP').id).toBe('mvp')
      expect(getArchetypeProfile('microservice').id).toBe('microservice')
      expect(getArchetypeProfile('Microservice').id).toBe('microservice')
      expect(getArchetypeProfile('enterprise').id).toBe('enterprise')
      expect(getArchetypeProfile('ENTERPRISE').id).toBe('enterprise')
    })

    it('throws descriptive error on unknown archetype', () => {
      expect(() => getArchetypeProfile('unknown')).toThrow(
        /Unknown lifecycle archetype: "unknown"\. Allowed values: mvp, microservice, enterprise/,
      )
    })

    it('detectArchetypeProfile falls back to MVP on empty project', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-project-'))
      try {
        const detected = await detectArchetypeProfile(tmp)
        expect(detected.profile.id).toBe('mvp')
      } finally {
        await fs.rm(tmp, { recursive: true, force: true })
      }
    })
  })
})
