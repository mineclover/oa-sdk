import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const workspaceRoot = resolve(packageRoot, '../..')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type EmittedOpenApi = {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: unknown }> }> }>>
  components?: { schemas?: Record<string, unknown> }
}

/** Compiles `main.tsp` against this package as a consumer would import it and returns the emitted OpenAPI. */
function compileWithPackage(source: string): EmittedOpenApi {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-contracts-fixture-'))
  tmpDirs.push(directory)
  const nodeModules = join(directory, 'node_modules')
  mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
  symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
  symlinkSync(packageRoot, join(nodeModules, '@oa-sdk', 'typespec-decorators'), 'dir')
  writeFileSync(join(directory, 'main.tsp'), source)
  writeFileSync(join(directory, 'tspconfig.yaml'), `
kind: project
entrypoint: main.tsp
emit:
  - "@typespec/openapi3"
options:
  "@typespec/openapi3":
    file-type: json
    openapi-versions:
      - 3.2.0
`)

  try {
    execFileSync(
      join(workspaceRoot, 'node_modules', '.bin', 'tsp'),
      ['compile', directory, '--output-dir', join(directory, 'output'), '--warn-as-error'],
      { cwd: directory, encoding: 'utf8' },
    )
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; message: string }
    throw new Error(`${failure.message}\n${failure.stdout ?? ''}${failure.stderr ?? ''}`)
  }

  return JSON.parse(readFileSync(join(directory, 'output', '@typespec', 'openapi3', 'openapi.json'), 'utf8')) as EmittedOpenApi
}

/** Every fenced ```typespec block of the README that ships in the package tarball. */
function readmeTypeSpecExamples(): string[] {
  const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8')
  return [...readme.matchAll(/^```typespec\n([\s\S]*?)^```$/gm)].map(match => match[1]!)
}

function jsonSchemaRef(response: { content?: Record<string, { schema?: unknown }> } | undefined): unknown {
  return (response?.content?.['application/json']?.schema as { $ref?: unknown } | undefined)?.$ref
}

describe('@oa-sdk/typespec-decorators standard contracts', () => {
  it('compiles every TypeSpec example in the README without diagnostics', () => {
    const examples = readmeTypeSpecExamples()
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      expect(() => compileWithPackage(example)).not.toThrow()
    }
  }, 60_000)

  it('emits the documented responses and error schemas from namespace OaSdkTypeSpec', () => {
    const emitted = compileWithPackage(`
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Contracts fixture" })
namespace Fixture;

model Widget { id: string; }

@route("/widgets")
interface Widgets {
  @get list(): Ok<PageResult<Widget>> | StandardHttpErrors;
  @post create(@body body: Widget): Created<Widget> | ErrorResponse<409>;
  @delete @route("/{id}") remove(@path id: string): NoContent;
}
`)

    const errorRef = '#/components/schemas/OaSdkTypeSpec.StandardError'
    const list = emitted.paths['/widgets']!.get!.responses
    expect(Object.keys(list).sort()).toEqual(['200', '400', '401', '403', '404', '500'])
    for (const status of ['400', '401', '403', '404', '500']) {
      expect(jsonSchemaRef(list[status])).toBe(errorRef)
    }
    expect(list['200']!.content!['application/json']!.schema).toMatchObject({
      type: 'object',
      required: ['items', 'total'],
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/Widget' } },
        page: { minimum: 1, default: 1 },
        limit: { minimum: 1, maximum: 100, default: 20 },
      },
    })

    const create = emitted.paths['/widgets']!.post!.responses
    expect(Object.keys(create).sort()).toEqual(['201', '409'])
    expect(jsonSchemaRef(create['201'])).toBe('#/components/schemas/Widget')
    expect(jsonSchemaRef(create['409'])).toBe(errorRef)

    const remove = emitted.paths['/widgets/{id}']!.delete!.responses
    expect(Object.keys(remove)).toEqual(['204'])
    expect(remove['204']!.content).toBeUndefined()

    expect(emitted.components?.schemas?.['OaSdkTypeSpec.StandardError']).toMatchObject({
      required: ['code', 'message'],
      properties: {
        details: { type: 'array', items: { $ref: '#/components/schemas/OaSdkTypeSpec.StandardValidationError' } },
      },
    })
    expect(emitted.components?.schemas?.['OaSdkTypeSpec.StandardValidationError']).toMatchObject({
      required: ['path', 'message'],
    })
  }, 20_000)
})
