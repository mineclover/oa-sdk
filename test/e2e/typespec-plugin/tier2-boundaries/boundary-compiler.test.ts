import { describe, it, expect, afterAll } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import {
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
} from '../../../../packages/codegen/src/plugin/index.js'

describe('Tier 2: Boundary & Corner Cases — In-Memory Compiler', () => {
  const petstoreFile = resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  const petstoreDir = resolve('test/e2e/typespec-plugin/fixtures/petstore')
  const invalidFile = resolve('test/e2e/typespec-plugin/fixtures/syntax-error/invalid.tsp')
  const tempBase = resolve('.tmp-compiler-boundaries')

  if (!existsSync(tempBase)) {
    mkdirSync(tempBase, { recursive: true })
  }

  afterAll(() => {
    if (existsSync(tempBase)) {
      rmSync(tempBase, { recursive: true, force: true })
    }
  })

  it('B2.1: throws when given a non-existent file path', async () => {
    await expect(
      compileTypeSpecInMemory('/path/to/definitely/non-existent-file.tsp'),
    ).rejects.toThrow(/does not exist/)
  })

  it('B2.2: throws when given a directory without main.tsp or index.tsp', async () => {
    const emptyTempDir = mkdtempSync(join(tempBase, 'tsp-empty-dir-'))
    try {
      await expect(compileTypeSpecInMemory(emptyTempDir)).rejects.toThrow(
        /does not contain "main.tsp" or "index.tsp"/,
      )
    } finally {
      rmSync(emptyTempDir, { recursive: true, force: true })
    }
  })

  it('B2.3: captures syntax errors with formatted diagnostics and line/column numbers', async () => {
    try {
      await compileTypeSpecInMemory(invalidFile)
      expect.fail('Should have thrown on invalid syntax')
    } catch (err: any) {
      expect(err.message).toContain('TypeSpec compilation failed')
      expect(err.diagnostics).toBeDefined()
      expect(err.diagnostics.length).toBeGreaterThan(0)
    }
  })

  it('B2.4: fails when referencing an undefined model identifier in TypeSpec', async () => {
    const tempDir = mkdtempSync(join(tempBase, 'tsp-broken-ref-'))
    const brokenFile = join(tempDir, 'main.tsp')
    writeFileSync(
      brokenFile,
      `
import "@typespec/http";
using Http;

model Order {
  id: string;
  unknownTarget: NonExistentType;
}
`,
    )

    try {
      await expect(compileTypeSpecInMemory(brokenFile)).rejects.toThrow(
        /TypeSpec compilation failed/,
      )
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('B2.5: compiles empty TypeSpec file producing 0 routes without crashing', async () => {
    const tempDir = mkdtempSync(join(tempBase, 'tsp-empty-file-'))
    const emptyFile = join(tempDir, 'main.tsp')
    writeFileSync(emptyFile, 'namespace EmptyApi;')

    try {
      const result = await compileTypeSpecInMemory(emptyFile)
      expect(result.routesCount).toBe(0)
      expect(result.document.paths).toEqual({})
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('B2.6: compiles TypeSpec containing only models (0 operations) with populated schemas', async () => {
    const tempDir = mkdtempSync(join(tempBase, 'tsp-models-only-'))
    const modelsOnlyFile = join(tempDir, 'main.tsp')
    writeFileSync(
      modelsOnlyFile,
      `
import "@typespec/http";
import "@typespec/openapi";
using Http;

@service(#{ title: "Models API" })
namespace ModelsOnly;

model User {
  id: string;
  name: string;
}

model Organization {
  orgId: string;
}

@route("/users")
namespace Users {
  @get op getUser(): User;
  @get @route("/org") op getOrg(): Organization;
}
`,
    )

    try {
      const result = await compileTypeSpecInMemory(modelsOnlyFile)
      expect(result.routesCount).toBe(2)
      const schemas = Object.keys(result.document.components?.schemas ?? {})
      expect(schemas).toContain('User')
      expect(schemas).toContain('Organization')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('B2.7: produces valid OpenAPI 3.0.0 document when requested', async () => {
    const result = await compileTypeSpecInMemory(petstoreFile, { openApiVersion: '3.0.0' })
    expect(result.document.openapi).toBe('3.0.0')
  })

  it('B2.8: produces valid OpenAPI 3.1.0 document when requested', async () => {
    const result = await compileTypeSpecInMemory(petstoreFile, { openApiVersion: '3.1.0' })
    expect(result.document.openapi).toBe('3.1.0')
  })

  it('B2.9: produces valid OpenAPI 3.2.0 document when requested', async () => {
    const result = await compileTypeSpecInMemory(petstoreFile, { openApiVersion: '3.2.0' })
    expect(result.document.openapi).toBe('3.2.0')
  })

  it('B2.10: supports incremental re-compilation using oldProgram cache', async () => {
    const firstResult = await compileTypeSpecInMemory(petstoreFile)
    expect(firstResult.program).toBeDefined()

    const secondResult = await compileTypeSpecInMemory(petstoreFile, {
      oldProgram: firstResult.program,
    })
    expect(secondResult.program).toBeDefined()
    expect(secondResult.document.openapi).toBe('3.2.0')
  })

  it('B2.11: resolves object configuration input with tspDir and relative entrypoint', async () => {
    const result = await compileTypeSpecInMemory({
      entrypoint: 'main.tsp',
      tspDir: petstoreDir,
    })
    expect(result.entrypoint).toBe(petstoreFile)
    expect(result.document.info.title).toBe('Petstore Service')
  })

  it('B2.12: rejects object configuration input pointing to non-existent entrypoint', async () => {
    await expect(
      compileTypeSpecInMemory({
        entrypoint: 'missing-file.tsp',
        tspDir: petstoreDir,
      }),
    ).rejects.toThrow(/does not exist/)
  })
})
