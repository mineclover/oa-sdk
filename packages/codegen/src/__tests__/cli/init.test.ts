import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { runInit } from '../../cli/lib/init/index.js'
import { init } from '../../cli/commands/init.js'
import { BUILT_AGAINST_VERSIONS } from '../../cli/lib/built-against-versions.js'

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
    // Outside any workspace, the release of @oa-sdk/core this codegen was built against.
    expect(pkg.devDependencies['@oa-sdk/core']).toBe(`^${BUILT_AGAINST_VERSIONS['@oa-sdk/core']}`)
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
    // @oa-sdk/personas is private, so outside a workspace that contains it init leaves it out and says so.
    expect(pkg.devDependencies['@oa-sdk/personas']).toBeUndefined()
    expect(res.unavailablePackages?.map(entry => entry.name)).toEqual(['@oa-sdk/personas'])
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
    expect(pkg.devDependencies['@oa-sdk/core']).toBe(`^${BUILT_AGAINST_VERSIONS['@oa-sdk/core']}`)
    expect(enterpriseRes.unavailablePackages?.map(entry => entry.name)).toEqual(['@oa-sdk/personas'])
  })

  describe('outputRouting presets in init', () => {
    it('generates idiomatic and syntactically valid fsd outputRouting preset', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'fsd-app', dependencies: { express: '^4.19.0' } }, null, 2),
      )

      const res = await runInit({
        cwd: tmpDir,
        target: 'express',
        routing: 'fsd',
      })

      expect(res.routing).toBe('fsd')
      const configContent = await fs.readFile(res.configPath, 'utf-8')
      expect(configContent).toContain("pattern: 'src/features/{tag}/api/{tag}.{kind}.ts'")
      expect(configContent).toContain("target: 'src/shared/api/{tag}.{kind}.ts'")
      expect(configContent).toContain("client: 'src/shared/api/client.ts'")

      // Verify array-of-objects syntax: rules must have { ... }
      expect(configContent).toMatch(/rules:\s*\[\s*\{\s*tag:/)

      // Transpile with TS to verify zero syntax errors
      const ts = await import('typescript')
      const transpileResult = ts.default.transpileModule(configContent, {
        compilerOptions: { module: ts.default.ModuleKind.ESNext },
      })
      expect(transpileResult.diagnostics?.length ?? 0).toBe(0)
    })

    it('generates monorepo outputRouting preset', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'monorepo-app' }, null, 2),
      )

      const res = await runInit({
        cwd: tmpDir,
        target: 'hono',
        routing: 'monorepo',
      })

      expect(res.routing).toBe('monorepo')
      const configContent = await fs.readFile(res.configPath, 'utf-8')
      expect(configContent).toContain("contract: 'packages/contracts/src/api.contract.ts'")
      expect(configContent).toContain("client: 'packages/client-sdk/src/index.ts'")
      expect(configContent).toContain("queries: 'apps/web/src/api/queries.ts'")
    })

    it('generates by-kind outputRouting preset', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'bykind-app' }, null, 2),
      )

      const res = await runInit({
        cwd: tmpDir,
        target: 'fastify',
        routing: 'by-kind',
      })

      expect(res.routing).toBe('by-kind')
      const configContent = await fs.readFile(res.configPath, 'utf-8')
      expect(configContent).toContain("contract: 'src/contracts/{tag}.contract.ts'")
      expect(configContent).toContain("client: 'src/client/{tag}.client.ts'")
      expect(configContent).toContain("queries: 'src/queries/{tag}.queries.ts'")
    })

    it('generates default outputRouting preset', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'default-app' }, null, 2),
      )

      const res = await runInit({
        cwd: tmpDir,
        target: 'generic',
        routing: 'default',
      })

      expect(res.routing).toBe('default')
      const configContent = await fs.readFile(res.configPath, 'utf-8')
      expect(configContent).toContain("pattern: 'src/api/{tag}/{tag}.{kind}.ts'")
    })

    it('rejects invalid routing preset via CLI command', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'err-app' }, null, 2),
      )

      await expect(
        init.run({ cwd: tmpDir, routing: 'invalid-preset' }, { cwd: tmpDir, projectRoot: tmpDir }),
      ).rejects.toThrow()
    })
  })

  describe('@oa-sdk package specifiers follow where the project lives', () => {
    type Manifest = { devDependencies?: Record<string, string> }
    const oaSdkDevDependencies = (manifest: Manifest) =>
      Object.fromEntries(Object.entries(manifest.devDependencies ?? {}).filter(([name]) => name.startsWith('@oa-sdk/')))
    const builtAgainst = (name: string) => `^${BUILT_AGAINST_VERSIONS[name]}`

    const writeJson = async (file: string, value: unknown) => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify(value, null, 2))
    }

    /** A pnpm workspace with `packages/*` and `apps/*` members, like the oa-sdk repository. */
    const createWorkspace = async (memberPackages: string[]) => {
      await fs.writeFile(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n  - "apps/*"\n')
      await writeJson(path.join(tmpDir, 'package.json'), { name: 'workspace-root', private: true })
      for (const name of memberPackages) {
        await writeJson(path.join(tmpDir, 'packages', name.split('/')[1]!, 'package.json'), { name, version: '0.0.0' })
      }
    }

    it('writes the ranges this codegen was built against outside any workspace', async () => {
      await writeJson(path.join(tmpDir, 'package.json'), { name: 'consumer', dependencies: { express: '^4.19.0' } })

      const res = await runInit({ cwd: tmpDir, target: 'express', archetype: 'enterprise', yes: true })

      const pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8')) as Manifest
      const written = oaSdkDevDependencies(pkg)
      expect(Object.keys(written).sort())
        .toEqual(['@oa-sdk/client', '@oa-sdk/codegen', '@oa-sdk/core', '@oa-sdk/mock-server', '@oa-sdk/router'])
      for (const [name, specifier] of Object.entries(written)) expect(specifier, name).toBe(builtAgainst(name))
      expect(res.unavailablePackages).toEqual([{ name: '@oa-sdk/personas', reason: expect.stringContaining('not published') }])
    })

    it('writes workspace:* for the @oa-sdk packages of the pnpm workspace the project is a member of', async () => {
      await createWorkspace(['@oa-sdk/codegen', '@oa-sdk/core', '@oa-sdk/personas'])
      const appDir = path.join(tmpDir, 'apps', 'orders')
      await writeJson(path.join(appDir, 'package.json'), { name: 'orders', dependencies: { express: '^4.19.0' } })

      const res = await runInit({ cwd: appDir, target: 'express', archetype: 'enterprise', yes: true })

      const pkg = JSON.parse(await fs.readFile(path.join(appDir, 'package.json'), 'utf-8')) as Manifest
      expect(oaSdkDevDependencies(pkg)).toEqual({
        '@oa-sdk/codegen': 'workspace:*',
        '@oa-sdk/core': 'workspace:*',
        '@oa-sdk/personas': 'workspace:*',
        // Not a member of this workspace, so it installs from the registry.
        '@oa-sdk/router': builtAgainst('@oa-sdk/router'),
        '@oa-sdk/client': builtAgainst('@oa-sdk/client'),
        '@oa-sdk/mock-server': builtAgainst('@oa-sdk/mock-server'),
      })
      expect(res.unavailablePackages).toEqual([])
    })

    it('writes registry ranges for a project inside the workspace directory that is not a member', async () => {
      await createWorkspace(['@oa-sdk/codegen', '@oa-sdk/core', '@oa-sdk/personas'])
      const scratchDir = path.join(tmpDir, 'scratch', 'orders')
      await writeJson(path.join(scratchDir, 'package.json'), { name: 'orders', dependencies: { express: '^4.19.0' } })

      const res = await runInit({ cwd: scratchDir, target: 'express', archetype: 'enterprise', yes: true })

      const pkg = JSON.parse(await fs.readFile(path.join(scratchDir, 'package.json'), 'utf-8')) as Manifest
      for (const [name, specifier] of Object.entries(oaSdkDevDependencies(pkg))) expect(specifier, name).toBe(builtAgainst(name))
      expect(res.unavailablePackages?.map(entry => entry.name)).toEqual(['@oa-sdk/personas'])
    })

    it('tells the user which packages it left out of package.json and why', async () => {
      await writeJson(path.join(tmpDir, 'package.json'), { name: 'consumer' })
      const logs: string[] = []
      const log = console.log
      console.log = (...parts: unknown[]) => { logs.push(parts.map(String).join(' ')) }
      try {
        await init.run({ cwd: tmpDir, target: 'generic', archetype: 'enterprise', yes: true })
      } finally {
        console.log = log
      }
      expect(logs.join('\n')).toContain('devDependency "@oa-sdk/personas": not added (private package, not published to the registry')
    })
  })
})
