import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { detectSchemas } from '../../cli/lib/init/common/schema-detector.js'

describe('Schema Detector Engine', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-schema-detector-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('detects main.tsp with highest confidence', async () => {
    await fs.writeFile(path.join(tmpDir, 'main.tsp'), 'namespace MyApi;')
    const items = await detectSchemas(tmpDir)
    expect(items.length).toBe(1)
    expect(items[0]?.type).toBe('typespec')
    expect(items[0]?.confidence).toBe(1.0)
    expect(items[0]?.filePath).toBe('main.tsp')
  })

  it('detects nested openapi.yaml and openapi.json', async () => {
    const subDir = path.join(tmpDir, 'contracts', 'v1')
    await fs.mkdir(subDir, { recursive: true })
    await fs.writeFile(path.join(subDir, 'openapi.yaml'), 'openapi: 3.2.0\ninfo:\n  title: API')
    await fs.writeFile(path.join(subDir, 'openapi.json'), '{"openapi": "3.1.0"}')

    const items = await detectSchemas(tmpDir)
    expect(items.some(i => i.type === 'openapi-yaml')).toBe(true)
    expect(items.some(i => i.type === 'openapi-json')).toBe(true)
    expect(items.some(i => i.filePath === path.join('contracts', 'v1', 'openapi.yaml'))).toBe(true)
  })

  it('detects @oaOperation JSDoc annotations in TypeScript source files', async () => {
    const srcDir = path.join(tmpDir, 'src', 'controllers')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'user.ts'),
      `
      /**
       * @oaOperation GET /users
       * @oaOperation POST /users
       */
      export class UserController {}
      `,
    )

    const items = await detectSchemas(tmpDir)
    const jsdocItem = items.find(i => i.type === 'jsdoc-operations')
    expect(jsdocItem).toBeDefined()
    expect(jsdocItem?.operationsCount).toBe(2)
    expect(jsdocItem?.confidence).toBe(0.75)
  })

  it('prunes ignored directories like node_modules, dist, and .git', async () => {
    const ignoredDir = path.join(tmpDir, 'node_modules', 'some-pkg')
    await fs.mkdir(ignoredDir, { recursive: true })
    await fs.writeFile(path.join(ignoredDir, 'openapi.yaml'), 'openapi: 3.2.0')

    const distDir = path.join(tmpDir, 'dist')
    await fs.mkdir(distDir, { recursive: true })
    await fs.writeFile(path.join(distDir, 'spec.yaml'), 'openapi: 3.2.0')

    const items = await detectSchemas(tmpDir)
    expect(items.length).toBe(0)
  })

  it('excludes non-spec JSON files such as package.json and tsconfig.json', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), '{"name": "test"}')
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{"compilerOptions": {}}')
    const items = await detectSchemas(tmpDir)
    expect(items.length).toBe(0)
  })

  it('sorts detected items by descending confidence score', async () => {
    await fs.writeFile(path.join(tmpDir, 'other.tsp'), 'namespace Other;')
    await fs.writeFile(path.join(tmpDir, 'main.tsp'), 'namespace Main;')
    await fs.writeFile(path.join(tmpDir, 'openapi.yaml'), 'openapi: 3.2.0')
    await fs.writeFile(path.join(tmpDir, 'service.ts'), '/** @oaOperation GET /ping */')

    const items = await detectSchemas(tmpDir)
    expect(items.length).toBe(4)
    expect(items[0]?.filePath).toBe('main.tsp')
    expect(items[0]?.confidence).toBe(1.0)
    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i]?.confidence).toBeGreaterThanOrEqual(items[i + 1]?.confidence ?? 0)
    }
  })
})
