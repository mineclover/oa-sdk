import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TypeSpecCompileRequest } from '../cli/lib/typespec-bundle-check.js'
import {
  compileTypeSpecBundleForSpecLens,
  resolveSpecLensTypeSpecSourceReadBudget,
  SPEC_LENS_TYPESPEC_MAX_ARTIFACT_BYTES,
  SPEC_LENS_TYPESPEC_MAX_SOURCE_AGGREGATE_BYTES,
  SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRIES,
  SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRY_BYTES,
  type SpecLensTypeSpecSourceEntry,
} from '../cli/lib/typespec-spec-lens.js'

const root = resolve(__dirname, '../../../..')

describe('compileTypeSpecBundleForSpecLens', () => {
  it('uses generated allowlisted config and records reachable source evidence with a fake compiler', async () => {
    const compile = vi.fn(async ({
      projectPath,
      outputDir,
      timeoutMs,
      maxOutputBytes,
      maxOldSpaceSizeMb,
    }: TypeSpecCompileRequest) => {
      const config = readFileSync(join(projectPath, 'tspconfig.yaml'), 'utf8')
      expect(config).toContain('@typespec/openapi3')
      expect(config).not.toContain('@evil/emitter')
      expect(config).toContain('entrypoint: "main.tsp"')
      expect(readdirSync(join(projectPath, 'node_modules', '@typespec')).sort()).toEqual([
        'http',
        'openapi',
        'openapi3',
      ])
      expect(existsSync(join(projectPath, 'node_modules', 'yaml'))).toBe(false)
      expect(timeoutMs).toBe(60_000)
      expect(maxOutputBytes).toBe(256 * 1024)
      expect(maxOldSpaceSizeMb).toBe(512)
      const emittedPath = join(outputDir, '@typespec', 'openapi3', 'openapi.yaml')
      mkdirSync(resolve(emittedPath, '..'), { recursive: true })
      writeFileSync(emittedPath, JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Historical API', version: '1.0.0' },
        paths: {
          '/users': {
            get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } },
          },
        },
      }))
    })
    const entries: SpecLensTypeSpecSourceEntry[] = [
      {
        relativePath: 'oa-sdk.typespec-bundle.json',
        content: JSON.stringify({
          schemaVersion: 'oa-sdk.typespec-bundle.v1',
          entrypoint: 'main.tsp',
          compatibility: {
            openapiVersion: '3.2.0',
            oaSdkExtensionSchemaVersion: 'oa-sdk.typespec-extensions.v5',
          },
        }),
      },
      { relativePath: 'main.tsp', content: 'import "@typespec/http";\nimport "./models.tsp";\n' },
      { relativePath: 'models.tsp', content: 'model User { id: string; }\n' },
      { relativePath: 'unreachable.tsp', content: 'import "@evil/unreachable";\n' },
      { relativePath: 'tspconfig.yaml', content: 'emit:\n  - "@evil/emitter"\n' },
    ]

    const result = await compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries,
      runtimeRoot: root,
      compile,
    })

    expect(compile).toHaveBeenCalledOnce()
    expect(result.document.paths).toHaveProperty('/users')
    expect(result.evidence).toMatchObject({
      sourceFiles: ['main.tsp', 'models.tsp'],
      compatibilitySource: 'typespec-extensions',
      toolchain: {
        schemaVersion: 'oa-sdk.spec-lens.typespec-toolchain.v1',
        packages: {
          '@typespec/compiler': '1.13.0',
          '@typespec/http': '1.13.0',
          '@typespec/openapi': '1.13.0',
          '@typespec/openapi3': '1.13.0',
        },
        restoreContract: 'oa-sdk.codegen.typespec-restore.v1',
        isolationPolicy: 'oa-sdk.spec-lens.typespec-isolation.v2',
        resourcePolicy: {
          compileTimeoutMs: 60_000,
          compileMaxOutputBytes: 256 * 1024,
          compileMaxOldSpaceSizeMb: 512,
          sourceReadBudget: resolveSpecLensTypeSpecSourceReadBudget(),
          maxArtifactBytes: 32 * 1024 * 1024,
        },
      },
      compiler: {
        configSource: 'generated-allowlist',
        emitter: '@typespec/openapi3',
        packageImports: ['@typespec/http', '@typespec/openapi'],
        resources: {
          timeoutMs: 60_000,
          maxOutputBytes: 256 * 1024,
          maxOldSpaceSizeMb: 512,
          sourceReadBudget: resolveSpecLensTypeSpecSourceReadBudget(),
          maxArtifactBytes: 32 * 1024 * 1024,
          isolationPolicy: 'oa-sdk.spec-lens.typespec-isolation.v2',
        },
      },
      gates: {
        compatibilitySidecar: 'pass',
        restoredValidation: 'pass',
      },
    })
    expect(result.evidence.toolchain.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    const {
      fingerprint,
      schemaVersion: _schemaVersion,
      ...fingerprintPayload
    } = result.evidence.toolchain
    void _schemaVersion
    expect(fingerprint).toBe(
      createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex'),
    )
    expect(result.evidence.compiler.resources.sourceReadBudget).toEqual(
      result.evidence.toolchain.resourcePolicy.sourceReadBudget,
    )
  })

  it('uses the official AST for triple-quoted and template strings without treating pseudo-imports as imports', async () => {
    const compile = createSuccessfulCompile()
    const manifest = createManifest()
    const triplePseudo = `const text = """
  "
  import "@evil/triple";
  "
  """;
model A {}
`
    const templatePseudo = `const text = "before \${"x import \\"@evil/template\\";"} after";
model A {}
`

    for (const content of [triplePseudo, templatePseudo]) {
      await expect(compileTypeSpecBundleForSpecLens({
        sourceRoot: 'typespec',
        manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
        entries: [
          { relativePath: 'oa-sdk.typespec-bundle.json', content: manifest },
          { relativePath: 'main.tsp', content },
        ],
        runtimeRoot: root,
        compile,
      })).resolves.toHaveProperty('document.openapi', '3.2.0')
    }
    expect(compile).toHaveBeenCalledTimes(2)
  })

  it('fails closed on parse diagnostics that previously hid a reachable package import', async () => {
    const compile = createSuccessfulCompile()
    const bypassSource = `const before = """
  "
  """;
import "@evil/runtime";
const after = """
  "
  """;
`

    await expect(compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries: [
        { relativePath: 'oa-sdk.typespec-bundle.json', content: createManifest() },
        { relativePath: 'main.tsp', content: bypassSource },
      ],
      runtimeRoot: root,
      compile,
    })).rejects.toThrow('TypeSpec parse failed in main.tsp: import-first')
    expect(compile).not.toHaveBeenCalled()
  })

  it('fails closed on an unterminated triple-quoted string before compile', async () => {
    const compile = createSuccessfulCompile()
    await expect(compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries: [
        { relativePath: 'oa-sdk.typespec-bundle.json', content: createManifest() },
        { relativePath: 'main.tsp', content: 'const text = """\nunterminated\n' },
      ],
      runtimeRoot: root,
      compile,
    })).rejects.toThrow('TypeSpec parse failed in main.tsp')
    expect(compile).not.toHaveBeenCalled()
  })

  it('binds package materialization and compiler CLI to codegen dependencies instead of cwd shadows', async () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-runtime-test-'))
    const compile = createSuccessfulCompile()
    try {
      for (const packageName of ['compiler', 'http', 'openapi', 'openapi3']) {
        const packagePath = join(runtimeRoot, 'node_modules', '@typespec', packageName)
        mkdirSync(packagePath, { recursive: true })
        writeFileSync(join(packagePath, 'package.json'), JSON.stringify({
          name: packageName === 'compiler' ? '@evil/compiler' : `@typespec/${packageName}`,
          version: '1.13.0',
        }))
      }
      await expect(compileTypeSpecBundleForSpecLens({
        sourceRoot: 'typespec',
        manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
        entries: [
          { relativePath: 'oa-sdk.typespec-bundle.json', content: createManifest() },
          { relativePath: 'main.tsp', content: 'model A {}\n' },
        ],
        runtimeRoot,
        compile,
      })).resolves.toHaveProperty('document.openapi', '3.2.0')
      expect(compile).toHaveBeenCalledOnce()
      const request = compile.mock.calls[0]?.[0]
      expect(request?.compilerCliPath).toContain('@typespec/compiler')
      expect(request?.compilerCliPath).not.toContain(runtimeRoot)
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

  it('rejects unsafe paths and non-allowlisted reachable package imports before compile', async () => {
    const manifest = JSON.stringify({
      schemaVersion: 'oa-sdk.typespec-bundle.v1',
      entrypoint: 'main.tsp',
      compatibility: {
        openapiVersion: '3.2.0',
        oaSdkExtensionSchemaVersion: 'oa-sdk.typespec-extensions.v5',
      },
    })
    await expect(compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries: [
        { relativePath: 'oa-sdk.typespec-bundle.json', content: manifest },
        { relativePath: 'main.tsp', content: 'import "@evil/runtime";\n' },
      ],
      runtimeRoot: root,
      compile: vi.fn(),
    })).rejects.toThrow('not allowlisted')

    await expect(compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries: [
        { relativePath: 'oa-sdk.typespec-bundle.json', content: manifest },
        { relativePath: 'main.tsp', content: '' },
        { relativePath: '../outside.tsp', content: '' },
      ],
      runtimeRoot: root,
      compile: vi.fn(),
    })).rejects.toThrow('must stay inside the repository')
  })

  it('fails closed on source entry count, per-entry, and aggregate byte limits before compile', async () => {
    const compile = createSuccessfulCompile()
    const baseEntries = [
      { relativePath: 'oa-sdk.typespec-bundle.json', content: createManifest() },
      { relativePath: 'main.tsp', content: 'model A {}\n' },
    ]
    await expect(compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries: [
        ...baseEntries,
        ...Array.from({ length: SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRIES - 1 }, (_, index) => ({
          relativePath: `unused-${index}.tsp`,
          content: '',
        })),
      ],
      runtimeRoot: root,
      compile,
    })).rejects.toThrow(`entry count ${SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRIES + 1} exceeds limit`)

    await expect(compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries: [
        baseEntries[0]!,
        { relativePath: 'main.tsp', content: 'x'.repeat(SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRY_BYTES + 1) },
      ],
      runtimeRoot: root,
      compile,
    })).rejects.toThrow(`main.tsp exceeds ${SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRY_BYTES} bytes`)

    const chunk = 'x'.repeat(SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRY_BYTES)
    await expect(compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries: [
        ...baseEntries,
        ...Array.from({ length: Math.ceil(SPEC_LENS_TYPESPEC_MAX_SOURCE_AGGREGATE_BYTES / chunk.length) }, (_, index) => ({
          relativePath: `aggregate-${index}.tsp`,
          content: chunk,
        })),
      ],
      runtimeRoot: root,
      compile,
    })).rejects.toThrow(`aggregate limit ${SPEC_LENS_TYPESPEC_MAX_SOURCE_AGGREGATE_BYTES} bytes`)
    expect(compile).not.toHaveBeenCalled()
  })

  it('rejects an oversized emitted artifact before parsing it', async () => {
    const compile = vi.fn(async ({ outputDir }: TypeSpecCompileRequest) => {
      const emittedPath = join(outputDir, '@typespec', 'openapi3', 'openapi.yaml')
      mkdirSync(resolve(emittedPath, '..'), { recursive: true })
      writeFileSync(emittedPath, '')
      truncateSync(emittedPath, SPEC_LENS_TYPESPEC_MAX_ARTIFACT_BYTES + 1)
    })

    await expect(compileTypeSpecBundleForSpecLens({
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
      entries: [
        { relativePath: 'oa-sdk.typespec-bundle.json', content: createManifest() },
        { relativePath: 'main.tsp', content: 'model A {}\n' },
      ],
      runtimeRoot: root,
      compile,
    })).rejects.toThrow(`emitted OpenAPI exceeds artifact limit ${SPEC_LENS_TYPESPEC_MAX_ARTIFACT_BYTES} bytes`)
  })

  it('smokes the authored production bundle through the isolated compiler path', async () => {
    const sourceRoot = resolve(root, 'packages/schemas/typespec')
    const entries = readSourceEntries(sourceRoot)
    const result = await compileTypeSpecBundleForSpecLens({
      sourceRoot: 'packages/schemas/typespec',
      manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
      entries,
      runtimeRoot: root,
    })

    expect(result.document.openapi).toBe('3.2.0')
    expect(Object.keys(result.document.paths as Record<string, unknown>).length).toBeGreaterThan(0)
    expect(result.evidence.gates).toEqual({
      compatibilitySidecar: 'pass',
      restoredValidation: 'pass',
      expectedDiff: 'pass',
    })
    expect(result.evidence.sourceFiles).toContain('main.tsp')
  }, 60_000)
})

function readSourceEntries(rootPath: string): SpecLensTypeSpecSourceEntry[] {
  const entries: SpecLensTypeSpecSourceEntry[] = []
  function visit(path: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const fullPath = join(path, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
      } else if (entry.isFile()) {
        entries.push({
          relativePath: relative(rootPath, fullPath).replaceAll('\\', '/'),
          content: readFileSync(fullPath, 'utf8'),
        })
      }
    }
  }
  visit(rootPath)
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function createManifest(): string {
  return JSON.stringify({
    schemaVersion: 'oa-sdk.typespec-bundle.v1',
    entrypoint: 'main.tsp',
    compatibility: {
      openapiVersion: '3.2.0',
      oaSdkExtensionSchemaVersion: 'oa-sdk.typespec-extensions.v5',
    },
  })
}

function createSuccessfulCompile() {
  return vi.fn(async ({ outputDir }: TypeSpecCompileRequest) => {
    const emittedPath = join(outputDir, '@typespec', 'openapi3', 'openapi.yaml')
    mkdirSync(resolve(emittedPath, '..'), { recursive: true })
    writeFileSync(emittedPath, JSON.stringify({
      openapi: '3.2.0',
      info: { title: 'Historical API', version: '1.0.0' },
      paths: {},
    }))
  })
}
