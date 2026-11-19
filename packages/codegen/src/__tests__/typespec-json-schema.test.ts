import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NodeHost, compile } from '@typespec/compiler'
import {
  compileTypeSpecToJsonSchemas,
  createTypeSpecFallbackHost,
} from '../typespec/index.js'
import { generateStandaloneGuards } from '../standalone-guards/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CODEGEN_ROOT = resolve(__dirname, '../..')

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map(dir => rm(dir, { recursive: true, force: true })),
  )
})

describe('TypeSpec pure data-model JSON Schema 2020-12 & Zod-free subpaths', () => {
  it('(a)-(c) compiles pure data-model .tsp without @service/@route into closed JSON Schema 2020-12, preserves aliases, and runs zero-eval guards + assertions', async () => {
    const dir = await makeTempDir('oa-sdk-tsp-pure-')
    const tspPath = join(dir, 'recipe.tsp')
    const tspSource = `
/** Primitive field value tag. */
alias FieldKind = "string" | "number" | "boolean";

/** Single-tag discriminator literal. */
alias SingleTag = "continuity-cut";

model ColumnDef {
  key: string;
  kind: FieldKind;
}

model UnusedHelper {
  note: string;
}

model RecipeDoc {
  tag: SingleTag;
  title: string;
  columns: ColumnDef[];
}
`
    await writeFile(tspPath, tspSource, 'utf8')

    const result = await compileTypeSpecToJsonSchemas(tspPath, {
      models: ['RecipeDoc'],
      schemaIds: { RecipeDoc: 'https://example.org/schemas/recipe-doc.json' },
      closedObjects: true,
      normalizeSingleEnumToConst: true,
      includeTypes: true,
      includeGuards: true,
      includeAssertions: true,
      guardsOutDir: join(dir, 'guards'),
    })

    // (a) JSON Schema 2020-12, $id, closed objects, single-literal const, pruned $defs
    const recipeSchema = result.jsonSchemas.RecipeDoc!
    expect(recipeSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(recipeSchema.$id).toBe('https://example.org/schemas/recipe-doc.json')
    expect(recipeSchema.title).toBe('RecipeDoc')
    expect(recipeSchema.additionalProperties).toBe(false)

    const props = recipeSchema.properties as Record<string, Record<string, unknown>>
    expect(props.tag).toEqual({ type: 'string', const: 'continuity-cut' })

    const defs = recipeSchema.$defs as Record<string, Record<string, unknown>>
    expect(Object.keys(defs)).toEqual(['ColumnDef'])
    expect(defs.ColumnDef!.additionalProperties).toBe(false)
    expect('UnusedHelper' in defs).toBe(false)

    // (b) named aliases extracted and preserved in typesDts
    expect(result.namedAliases.map(a => a.name)).toEqual(
      expect.arrayContaining(['FieldKind', 'SingleTag']),
    )
    const fieldKindAlias = result.namedAliases.find(a => a.name === 'FieldKind')
    expect(fieldKindAlias).toMatchObject({
      kind: 'string-union',
      literals: ['string', 'number', 'boolean'],
      tsType: `'string' | 'number' | 'boolean'`,
    })
    expect(result.typesDts).toContain(`export type FieldKind = 'string' | 'number' | 'boolean'`)
    expect(result.typesDts).toContain(`export type SingleTag = 'continuity-cut'`)

    // (c) standalone guards + .errors + validate* + assert* + zero eval/new Function
    expect(result.guardArtifacts && result.guardArtifacts.length > 0).toBe(true)
    const guardsOut = join(dir, 'guards')
    await mkdir(guardsOut, { recursive: true })
    await writeFile(join(guardsOut, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
    await writeFile(join(guardsOut, 'types.d.ts'), result.typesDts!, 'utf8')

    let jsPath = ''
    let dtsContent = ''
    for (const art of result.guardArtifacts!) {
      await mkdir(dirname(art.filePath), { recursive: true })
      await writeFile(art.filePath, art.content, 'utf8')
      if (art.kind === 'js') {
        expect(art.content).not.toMatch(/\beval\s*\(/)
        expect(art.content).not.toMatch(/new\s+Function\b/)
        jsPath = art.filePath
      } else if (art.filePath.endsWith('guards.d.ts')) {
        dtsContent = art.content
      }
    }

    expect(dtsContent).toContain('validateRecipeDoc')
    expect(dtsContent).toContain('assertRecipeDoc')

    const mod = await import(`${pathToFileURL(jsPath).href}?t=${Date.now()}`)
    const validSample = {
      tag: 'continuity-cut',
      title: 'Demo',
      columns: [{ key: 'id', kind: 'string' }],
    }
    const invalidSample = {
      tag: 'wrong',
      title: 'Demo',
      columns: [{ key: 'id', kind: 'invalid' }],
    }

    expect(mod.isRecipeDoc(validSample)).toBe(true)
    expect(mod.isRecipeDoc.errors).toBeNull()

    expect(mod.isRecipeDoc(invalidSample)).toBe(false)
    expect(Array.isArray(mod.isRecipeDoc.errors)).toBe(true)
    expect(mod.isRecipeDoc.errors.length).toBeGreaterThan(0)

    // Subsequent valid call clears .errors
    expect(mod.isRecipeDoc(validSample)).toBe(true)
    expect(mod.isRecipeDoc.errors).toBeNull()

    expect(mod.validateRecipeDoc(validSample)).toEqual({
      valid: true,
      data: validSample,
      errors: null,
    })
    const failedValidation = mod.validateRecipeDoc(invalidSample)
    expect(failedValidation.valid).toBe(false)
    expect(Array.isArray(failedValidation.errors)).toBe(true)
    expect(failedValidation.errors.length).toBeGreaterThan(0)

    expect(() => mod.assertRecipeDoc(validSample)).not.toThrow()
    expect(() => mod.assertRecipeDoc(invalidSample)).toThrow(TypeError)
  })

  it('(d) supports writePackageJson: auto | true | false cleanly against ESM ancestor boundaries', async () => {
    const schemaDocument = {
      openapi: '3.1.0',
      info: { title: 'PkgTest', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          Item: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
        },
      },
    }

    const baseDir = await makeTempDir('oa-sdk-write-pkg-')

    // 1. ESM ancestor + 'auto' => skips package.json
    const esmParent = join(baseDir, 'esm-parent')
    const esmChildGuards = join(esmParent, 'sub', 'guards')
    await mkdir(esmParent, { recursive: true })
    await writeFile(join(esmParent, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
    await generateStandaloneGuards({
      schemaDocument,
      outDir: esmChildGuards,
      schemas: ['Item'],
      writePackageJson: 'auto',
    })
    expect(existsSync(join(esmChildGuards, 'package.json'))).toBe(false)
    expect(existsSync(join(esmChildGuards, 'guards.js'))).toBe(true)

    // 2. Non-ESM ancestor + 'auto' => writes { "type": "module" } package.json
    const cjsParent = join(baseDir, 'cjs-parent')
    const cjsChildGuards = join(cjsParent, 'sub', 'guards')
    await mkdir(cjsParent, { recursive: true })
    await writeFile(join(cjsParent, 'package.json'), JSON.stringify({ name: 'cjs-root' }), 'utf8')
    await generateStandaloneGuards({
      schemaDocument,
      outDir: cjsChildGuards,
      schemas: ['Item'],
      writePackageJson: 'auto',
    })
    expect(existsSync(join(cjsChildGuards, 'package.json'))).toBe(true)
    const writtenPkg = JSON.parse(await readFile(join(cjsChildGuards, 'package.json'), 'utf8'))
    expect(writtenPkg).toEqual({ type: 'module' })

    // 3. Non-ESM ancestor + false => skips package.json
    const skipGuards = join(cjsParent, 'skip-guards')
    await generateStandaloneGuards({
      schemaDocument,
      outDir: skipGuards,
      schemas: ['Item'],
      writePackageJson: false,
    })
    expect(existsSync(join(skipGuards, 'package.json'))).toBe(false)

    // 4. ESM ancestor + true => forces writing package.json
    const forceGuards = join(esmParent, 'force-guards')
    await generateStandaloneGuards({
      schemaDocument,
      outDir: forceGuards,
      schemas: ['Item'],
      writePackageJson: true,
    })
    expect(existsSync(join(forceGuards, 'package.json'))).toBe(true)
  })

  it('(e) createTypeSpecFallbackHost compiles an isolated /tmp .tsp importing @typespec/http without local node_modules', async () => {
    const dir = await makeTempDir('oa-sdk-fallback-host-')
    const tspPath = join(dir, 'isolated.tsp')
    await writeFile(
      tspPath,
      `
import "@typespec/http";
using TypeSpec.Http;

@service(#{ title: "IsolatedTemp" })
namespace IsolatedTemp;

model Ping {
  ok: boolean;
}

@route("/ping")
@get
op getPing(): Ping;
`,
      'utf8',
    )

    const fallbackHost = createTypeSpecFallbackHost(NodeHost)
    const program = await compile(fallbackHost, tspPath, { noEmit: true })
    const errors = program.diagnostics.filter(d => d.severity === 'error')
    expect(errors).toEqual([])
  })

  it('(f) @oa-sdk/codegen/typespec and @oa-sdk/codegen/guards built dist bundles contain zero zod imports', async () => {
    const entryPoints = [
      resolve(CODEGEN_ROOT, 'dist/typespec/index.js'),
      resolve(CODEGEN_ROOT, 'dist/standalone-guards/index.js'),
    ]

    for (const entry of entryPoints) {
      expect(existsSync(entry)).toBe(true)
    }

    const visited = new Set<string>()
    const queue = [...entryPoints]
    const relImportRe = /import\s+(?:[^'"]*\s+from\s+)?['"](\.[^'"]+)['"]|import\(['"](\.[^'"]+)['"]\)/g
    const zodImportRe = /(?:from|import\s*\()\s*['"]zod(?:\/[^'"]*)?['"]/

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)

      const content = await readFile(current, 'utf8')
      expect(content, `Unexpected zod import in ${current}`).not.toMatch(zodImportRe)

      for (const match of content.matchAll(relImportRe)) {
        const spec = match[1] ?? match[2]
        if (!spec) continue
        const resolved = resolve(dirname(current), spec)
        if (existsSync(resolved) && !visited.has(resolved)) {
          queue.push(resolved)
        }
      }
    }
  })
})
