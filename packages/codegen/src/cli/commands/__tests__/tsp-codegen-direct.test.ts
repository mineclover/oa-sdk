import { describe, expect, it, afterAll } from 'vitest'
import { join, resolve } from 'node:path'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { loadSpecDocumentAsync, loadSpecWithPath } from '../../lib/load-spec.js'
import { typegen } from '../typegen.js'
import { generateZod } from '../generate-zod.js'
import { validate } from '../validate.js'

import { fileURLToPath } from 'node:url'

describe('Direct TypeSpec Codegen Support', () => {
  const currentDir = fileURLToPath(new URL('.', import.meta.url))
  const testDir = resolve(currentDir, '../../../../.tmp-tsp-codegen-' + Date.now())
  mkdirSync(testDir, { recursive: true })
  const tspFile = join(testDir, 'api.tsp')

  writeFileSync(
    tspFile,
    `import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "Test API" })
@info(#{ version: "1.0.0" })
namespace TestService;

model Widget {
  id: string;
  name: string;
  count: integer;
}

@route("/widgets/{id}")
@get
op getWidget(@path id: string): {
  @statusCode statusCode: 200;
  @body body: Widget;
};
`,
    'utf8',
  )

  afterAll(() => {
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failure
    }
  })

  it('loadSpecDocumentAsync compiles .tsp directly into OasDocument', async () => {
    const loaded = await loadSpecDocumentAsync(tspFile)
    expect(loaded.document).toBeDefined()
    expect(loaded.document.openapi).toMatch(/^3\.[12]\.0$/)
    expect(loaded.document.info.title).toBe('Test API')
    expect(loaded.document.paths?.['/widgets/{id}']).toBeDefined()
  })

  it('loadSpecWithPath rejects .tsp with clear guidance', () => {
    expect(() => loadSpecWithPath(tspFile)).toThrow(/loadSpecDocumentAsync/)
  })

  it('typegen generates TypeScript types directly from .tsp', async () => {
    const outTs = join(testDir, 'types.ts')
    await typegen.run({ spec: tspFile, output: outTs })
    const content = readFileSync(outTs, 'utf8')
    expect(content).toContain('Widget')
    expect(content).toContain('id: string')
    expect(content).toContain('name: string')
  })

  it('generate:zod generates Zod schemas directly from .tsp', async () => {
    const outZod = join(testDir, 'schemas.ts')
    await generateZod.run({ spec: tspFile, output: outZod, 'no-validate': true })
    const content = readFileSync(outZod, 'utf8')
    expect(content).toContain('z.object')
    expect(content).toContain('Widget')
  })

  it('validate validates .tsp directly in-memory', async () => {
    await expect(validate.run({ spec: tspFile })).resolves.not.toThrow()
  })
})
