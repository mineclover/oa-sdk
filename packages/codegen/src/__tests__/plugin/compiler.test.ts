import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
} from '../../plugin/compiler.js'

const packageRoot = resolve(__dirname, '../../..')
const monorepoRoot = resolve(packageRoot, '../..')
const productionTspDir = resolve(monorepoRoot, 'packages/schemas/typespec')
const productionMainTsp = resolve(productionTspDir, 'main.tsp')
const scratchDir = resolve(packageRoot, '.tmp-plugin-compiler-test')

describe('In-Memory TypeSpec Compiler', () => {
  beforeAll(() => {
    mkdirSync(scratchDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(scratchDir, { recursive: true, force: true })
  })

  it('resolves entrypoint when input is a direct .tsp file path', () => {
    const entry = resolveTypeSpecEntrypoint(productionMainTsp)
    expect(entry).toBe(productionMainTsp)
  })

  it('resolves entrypoint to main.tsp when input is a directory path', () => {
    const entry = resolveTypeSpecEntrypoint(productionTspDir)
    expect(entry).toBe(productionMainTsp)
  })

  it('resolves entrypoint when input is an object with entrypoint and tspDir', () => {
    const entry = resolveTypeSpecEntrypoint({
      entrypoint: 'main.tsp',
      tspDir: productionTspDir,
    })
    expect(entry).toBe(productionMainTsp)
  })

  it('throws an error if input path does not exist', () => {
    expect(() =>
      resolveTypeSpecEntrypoint('/path/that/does/not/exist/test.tsp'),
    ).toThrow(/does not exist/)
  })

  it('throws an error if directory contains neither main.tsp nor index.tsp', () => {
    const emptyDir = join(scratchDir, 'empty-dir')
    mkdirSync(emptyDir, { recursive: true })
    expect(() => resolveTypeSpecEntrypoint(emptyDir)).toThrow(
      /does not contain "main.tsp" or "index.tsp"/,
    )
  })

  it('compiles production TypeSpec schema directly in memory without disk artifacts', async () => {
    const beforeFiles = readdirSync(productionTspDir)

    const result = await compileTypeSpecInMemory(productionMainTsp, {
      openApiVersion: '3.2.0',
    })

    expect(result).toBeDefined()
    expect(result.program).toBeDefined()
    expect(result.document).toBeDefined()
    expect(result.document.openapi).toBe('3.2.0')
    expect(result.document.info).toBeDefined()
    expect(result.document.paths).toBeDefined()
    expect(result.routesCount).toBeGreaterThan(0)
    expect(result.sourceFiles.length).toBeGreaterThan(0)
    expect(result.entrypoint).toBe(productionMainTsp)

    // Ensure zero intermediate disk artifacts were written
    const afterFiles = readdirSync(productionTspDir)
    expect(afterFiles).toEqual(beforeFiles)
  })

  it('compiles directory input resolution directly in memory', async () => {
    const result = await compileTypeSpecInMemory(productionTspDir)
    expect(result.document).toBeDefined()
    expect(result.routesCount).toBeGreaterThan(0)
    expect(result.entrypoint).toBe(productionMainTsp)
  })

  it('compiles a local synthetic TypeSpec workspace in memory', async () => {
    const localDir = join(scratchDir, 'synthetic')
    mkdirSync(localDir, { recursive: true })

    const mainFile = join(localDir, 'main.tsp')
    writeFileSync(
      mainFile,
      [
        'import "@typespec/http";',
        'using Http;',
        '@service(#{ title: "Synthetic API" })',
        'namespace Synthetic;',
        '',
        'model Widget {',
        '  id: string;',
        '  name: string;',
        '}',
        '',
        '@route("/widgets")',
        'op listWidgets(): Widget[];',
        '',
        '@route("/widgets/{id}")',
        'op getWidget(@path id: string): Widget;',
      ].join('\n'),
      'utf8',
    )

    const result = await compileTypeSpecInMemory(mainFile)
    expect(result.document.info.title).toBe('Synthetic API')
    expect(result.routesCount).toBe(2)
    const paths = result.document.paths as Record<string, any> | undefined
    expect(paths?.['/widgets']?.get).toBeDefined()
    expect(paths?.['/widgets/{id}']?.get).toBeDefined()
  })

  it('throws descriptive error with diagnostics on TypeSpec syntax error', async () => {
    const invalidDir = join(scratchDir, 'invalid')
    mkdirSync(invalidDir, { recursive: true })

    const invalidFile = join(invalidDir, 'main.tsp')
    writeFileSync(
      invalidFile,
      'namespace Broken;\nmodel BrokenWidget { id: NonExistentType; }\n',
      'utf8',
    )

    await expect(compileTypeSpecInMemory(invalidFile)).rejects.toThrow(
      /TypeSpec compilation failed:/,
    )
  })
})
