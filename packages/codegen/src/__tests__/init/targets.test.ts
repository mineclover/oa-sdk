import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  TARGET_PROFILES,
  FastifyTargetProfile,
  ElysiaTargetProfile,
  HonoTargetProfile,
  ExpressTargetProfile,
  NestJSTargetProfile,
  GenericTargetProfile,
  getTargetProfile,
  detectTargetProfile,
} from '../../cli/lib/init/targets/index.js'

describe('Init Target Strategy Profiles', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-init-targets-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('registers all 6 mutually exclusive target profiles', () => {
    const keys = Object.keys(TARGET_PROFILES).sort()
    expect(keys).toEqual(['elysia', 'express', 'fastify', 'generic', 'hono', 'nestjs'])
  })

  it('retrieves target profiles by id or throws on unknown', () => {
    expect(getTargetProfile('fastify')).toBeInstanceOf(FastifyTargetProfile)
    expect(getTargetProfile('elysia')).toBeInstanceOf(ElysiaTargetProfile)
    expect(() => getTargetProfile('unknown' as any)).toThrow('Unknown target framework')
  })

  describe('FastifyTargetProfile', () => {
    const profile = new FastifyTargetProfile()

    it('detects fastify dependency in package.json with node runtime', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { fastify: '^4.26.0' } }),
      )
      const res = await profile.detect(tmpDir)
      expect(res.confidence).toBeGreaterThanOrEqual(0.9)
      expect(res.detectedRuntime).toBe('node')
      expect(res.matchedMarkers).toContain('fastify dependency')
    })

    it('generates Fastify config with target fastify', async () => {
      const config = await profile.generateConfig({
        cwd: tmpDir,
        frameworkId: 'fastify',
        runtime: 'node',
      })
      expect(config).toContain("target: 'fastify'")
      expect(config).toContain("schemaEntry: 'openapi.yaml'")
    })

    it('enforces Node ESM tooling with tsx watch in scripts', () => {
      const scripts = profile.getRecommendedScripts({
        cwd: tmpDir,
        frameworkId: 'fastify',
        runtime: 'node',
      })
      expect(scripts['dev']).toContain('tsx watch')
      expect(scripts['generate:router']).toContain('fastify')
    })

    it('includes Node devDependencies and excludes Bun dependencies', () => {
      const deps = profile.getRecommendedDependencies({
        cwd: tmpDir,
        frameworkId: 'fastify',
        runtime: 'node',
      })
      expect(deps.devDependencies['tsx']).toBeDefined()
      expect(deps.devDependencies['@types/node']).toBeDefined()
      expect(deps.devDependencies['@types/bun']).toBeUndefined()
    })
  })

  describe('ElysiaTargetProfile (Strict Bun Runtime Isolation)', () => {
    const profile = new ElysiaTargetProfile()

    it('detects elysia dependency or bun.lockb with bun runtime', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { elysia: '^1.0.0' } }),
      )
      const res = await profile.detect(tmpDir)
      expect(res.confidence).toBeGreaterThanOrEqual(0.9)
      expect(res.detectedRuntime).toBe('bun')
    })

    it('detects bun.lockb even when elysia dependency is not in package.json', async () => {
      await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'bun-app' }))
      await fs.writeFile(path.join(tmpDir, 'bun.lockb'), '')
      const res = await profile.detect(tmpDir)
      expect(res.confidence).toBeGreaterThanOrEqual(0.9)
      expect(res.detectedRuntime).toBe('bun')
    })

    it('strictly injects Bun native scripts (bun --watch, bun x) with ZERO tsx/nodemon', () => {
      const scripts = profile.getRecommendedScripts({
        cwd: tmpDir,
        frameworkId: 'elysia',
        runtime: 'bun',
      })
      expect(scripts['dev']).toContain('bun --watch')
      expect(scripts['generate:router']).toContain('bun x')
      expect(scripts['mock']).toContain('bun x')

      const combined = Object.values(scripts).join(' ')
      expect(combined).not.toContain('tsx')
      expect(combined).not.toContain('nodemon')
    })

    it('strictly includes @types/bun and ZERO Node tooling (@types/node, tsx)', () => {
      const deps = profile.getRecommendedDependencies({
        cwd: tmpDir,
        frameworkId: 'elysia',
        runtime: 'bun',
      })
      expect(deps.devDependencies['@types/bun']).toBeDefined()
      expect(deps.devDependencies['@types/node']).toBeUndefined()
      expect(deps.devDependencies['tsx']).toBeUndefined()
    })
  })

  describe('HonoTargetProfile (Dynamic Bun / Node Runtime)', () => {
    const profile = new HonoTargetProfile()

    it('detects hono dependency in package.json', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { hono: '^4.0.0' } }),
      )
      const res = await profile.detect(tmpDir)
      expect(res.confidence).toBeGreaterThanOrEqual(0.8)
    })

    it('selects bun scripts when runtime is bun', () => {
      const scripts = profile.getRecommendedScripts({
        cwd: tmpDir,
        frameworkId: 'hono',
        runtime: 'bun',
      })
      expect(scripts['dev']).toContain('bun --watch')
      expect(scripts['generate:router']).toContain('bun x')
    })

    it('selects tsx watch scripts when runtime is node', () => {
      const scripts = profile.getRecommendedScripts({
        cwd: tmpDir,
        frameworkId: 'hono',
        runtime: 'node',
      })
      expect(scripts['dev']).toContain('tsx watch')
      expect(scripts['generate:router']).not.toContain('bun x')
    })
  })

  describe('ExpressTargetProfile', () => {
    const profile = new ExpressTargetProfile()

    it('detects express dependency in package.json', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { express: '^4.19.0' } }),
      )
      const res = await profile.detect(tmpDir)
      expect(res.confidence).toBeGreaterThanOrEqual(0.8)
      expect(res.detectedRuntime).toBe('node')
    })

    it('recommends express router generation and types', () => {
      const scripts = profile.getRecommendedScripts({
        cwd: tmpDir,
        frameworkId: 'express',
        runtime: 'node',
      })
      expect(scripts['generate:router']).toContain('express')

      const deps = profile.getRecommendedDependencies({
        cwd: tmpDir,
        frameworkId: 'express',
        runtime: 'node',
      })
      expect(deps.devDependencies['@types/express']).toBeDefined()
    })
  })

  describe('NestJSTargetProfile', () => {
    const profile = new NestJSTargetProfile()

    it('detects nestjs via @nestjs/core or nest-cli.json', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
      )
      const res = await profile.detect(tmpDir)
      expect(res.confidence).toBeGreaterThanOrEqual(0.9)
      expect(res.detectedRuntime).toBe('node')
    })

    it('coexists with Nest CLI without replacing nest start', () => {
      const scripts = profile.getRecommendedScripts({
        cwd: tmpDir,
        frameworkId: 'nestjs',
        runtime: 'node',
      })
      expect(scripts['start:dev']).toBe('nest start --watch')
      expect(scripts['generate:contract']).toBeDefined()
    })
  })

  describe('GenericTargetProfile', () => {
    const profile = new GenericTargetProfile()

    it('provides low confidence fallback', async () => {
      const res = await profile.detect(tmpDir)
      expect(res.confidence).toBeLessThan(0.5)
    })

    it('is selected by detectTargetProfile when no framework matches', async () => {
      const { profile: detected } = await detectTargetProfile(tmpDir)
      expect(detected.id).toBe('generic')
    })
  })
})
