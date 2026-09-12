import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { runInit } from '../../cli/lib/init/index.js'
import { init } from '../../cli/commands/init.js'

describe('oa-gen init CLI & Orchestrator', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-init-cli-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('generates oa.config.ts and patches package.json for fastify target', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-fastify-app', dependencies: { fastify: '^4.20.0' } }, null, 2),
    )
    await fs.writeFile(path.join(tmpDir, 'openapi.yaml'), 'openapi: 3.2.0\ninfo:\n  title: Fastify API')

    const res = await runInit({ cwd: tmpDir, target: 'fastify' })

    expect(res.targetId).toBe('fastify')
    expect(res.runtime).toBe('node')
    expect(res.configPath).toBe(path.join(tmpDir, 'oa.config.ts'))

    const configContent = await fs.readFile(res.configPath, 'utf-8')
    expect(configContent).toContain("schemaEntry: 'openapi.yaml'")
    expect(configContent).toContain("target: 'fastify'")

    const pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['dev']).toContain('tsx watch')
    expect(pkg.scripts['generate:router']).toContain('fastify')
    expect(pkg.devDependencies['tsx']).toBeDefined()
  })

  it('respects dryRun option without modifying any files on disk', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-elysia-app', dependencies: { elysia: '^1.0.0' } }, null, 2),
    )
    await fs.writeFile(path.join(tmpDir, 'spec.yaml'), 'openapi: 3.2.0')

    const res = await runInit({ cwd: tmpDir, target: 'elysia', dryRun: true })

    expect(res.targetId).toBe('elysia')
    expect(res.runtime).toBe('bun')
    expect(res.dryRun).toBe(true)

    const configExists = await fs.access(path.join(tmpDir, 'oa.config.ts')).then(() => true).catch(() => false)
    expect(configExists).toBe(false)

    const pkgRaw = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8')
    expect(pkgRaw).not.toContain('bun --watch')
  })

  it('auto-detects Elysia framework and Bun runtime from bun.lockb', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'bun-app' }, null, 2),
    )
    await fs.writeFile(path.join(tmpDir, 'bun.lockb'), '')
    await fs.writeFile(path.join(tmpDir, 'openapi.json'), '{"openapi": "3.1.0"}')

    const res = await runInit({ cwd: tmpDir })

    expect(res.targetId).toBe('elysia')
    expect(res.runtime).toBe('bun')

    const configContent = await fs.readFile(res.configPath, 'utf-8')
    expect(configContent).toContain("target: 'elysia'")
    expect(configContent).toContain("schemaEntry: 'openapi.json'")

    const pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['dev']).toContain('bun --watch')
    expect(pkg.devDependencies['@types/bun']).toBeDefined()
    expect(pkg.devDependencies['tsx']).toBeUndefined()
  })

  it('allows explicit --spec option to override auto-detected schema', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'app' }, null, 2),
    )
    await fs.writeFile(path.join(tmpDir, 'default.yaml'), 'openapi: 3.2.0')

    const res = await runInit({
      cwd: tmpDir,
      target: 'generic',
      spec: 'custom-specs/api.yaml',
    })

    const configContent = await fs.readFile(res.configPath, 'utf-8')
    expect(configContent).toContain("schemaEntry: 'custom-specs/api.yaml'")
  })

  it('executes via Command interface run method successfully', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'cli-test', dependencies: { express: '^4.19.0' } }, null, 2),
    )

    await init.run({
      cwd: tmpDir,
      target: 'express',
      yes: true,
    })

    const configExists = await fs.access(path.join(tmpDir, 'oa.config.ts')).then(() => true).catch(() => false)
    expect(configExists).toBe(true)

    const pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['generate:router']).toContain('express')
  })

  it('exposes --archetype option in Command definition', () => {
    expect(init.options?.['archetype']).toBeDefined()
    expect(init.options?.['archetype']?.short).toBe('a')
    expect(init.options?.['archetype']?.type).toBe('string')
  })

  it('initializes project with explicit --archetype microservice', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'microservice-app', dependencies: { fastify: '^4.20.0' } }, null, 2),
    )

    const res = await runInit({
      cwd: tmpDir,
      target: 'fastify',
      archetype: 'microservice',
    })

    expect(res.archetypeId).toBe('microservice')
    expect(res.targetId).toBe('fastify')

    const config = await fs.readFile(res.configPath, 'utf-8')
    expect(config).toContain("archetype: 'microservice'")
    expect(config).toContain("wireFormatSafety: true")

    const pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['test:contract']).toBe('vitest run src/__tests__/contracts')
    expect(pkg.scripts['generate:contract']).toBeDefined()
    expect(pkg.scripts['audit:wire']).toBeDefined()
    expect(pkg.devDependencies['vitest']).toBeDefined()
    expect(pkg.devDependencies['@oa-sdk/core']).toBe('workspace:*')
  })

  it('initializes project with explicit --archetype enterprise', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'enterprise-app', dependencies: { express: '^4.19.0' } }, null, 2),
    )

    const res = await runInit({
      cwd: tmpDir,
      target: 'express',
      archetype: 'enterprise',
    })

    expect(res.archetypeId).toBe('enterprise')

    const config = await fs.readFile(res.configPath, 'utf-8')
    expect(config).toContain("archetype: 'enterprise'")
    expect(config).toContain("failOnBreaking: true")

    const pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['ci:gate']).toContain('--fail-on-breaking')
    expect(pkg.scripts['diff']).toBeDefined()
    expect(pkg.scripts['personas:check']).toBeDefined()
    expect(pkg.devDependencies['@oa-sdk/personas']).toBe('workspace:*')
  })

  it('rejects invalid archetype via CLI run method', async () => {
    await expect(
      init.run({
        cwd: tmpDir,
        archetype: 'invalid-archetype',
      }),
    ).rejects.toThrow()
  })

  it('throws descriptive error when invalid archetype is passed to runInit', async () => {
    await expect(
      runInit({
        cwd: tmpDir,
        archetype: 'invalid-archetype',
      }),
    ).rejects.toThrow(/Unknown lifecycle archetype: "invalid-archetype"/)
  })

  it('seamlessly evolves an MVP project to Enterprise non-destructively with --force', async () => {
    // 1. Initial Day 1 MVP setup
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'evolving-app',
          dependencies: { fastify: '^4.20.0' },
          scripts: { custom: 'echo custom-script' },
        },
        null,
        2,
      ),
    )

    const mvpRes = await runInit({
      cwd: tmpDir,
      target: 'fastify',
      archetype: 'mvp',
    })
    expect(mvpRes.archetypeId).toBe('mvp')

    let pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['custom']).toBe('echo custom-script')
    expect(pkg.scripts['generate:client']).toBeDefined()
    expect(pkg.scripts['ci:gate']).toBeUndefined()

    // 2. Day 180 Enterprise Evolution with --force
    const enterpriseRes = await runInit({
      cwd: tmpDir,
      target: 'fastify',
      archetype: 'enterprise',
      force: true,
    })
    expect(enterpriseRes.archetypeId).toBe('enterprise')

    const evolvedConfig = await fs.readFile(enterpriseRes.configPath, 'utf-8')
    expect(evolvedConfig).toContain("archetype: 'enterprise'")

    pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8'))
    // Custom script preserved
    expect(pkg.scripts['custom']).toBe('echo custom-script')
    // Enterprise scripts added
    expect(pkg.scripts['ci:gate']).toBeDefined()
    expect(pkg.scripts['diff']).toBeDefined()
    expect(pkg.devDependencies['@oa-sdk/personas']).toBeDefined()
  })
})
