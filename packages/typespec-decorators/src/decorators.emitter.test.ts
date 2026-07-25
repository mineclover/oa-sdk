import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const workspaceRoot = resolve(import.meta.dirname, '../../..')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('@oa-sdk/typespec-decorators emitter integration', () => {
  it('emits the v5 response-component reference through the actual TypeSpec compiler', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-decorator-fixture-'))
    tmpDirs.push(directory)
    const nodeModules = join(directory, 'node_modules')
    mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
    symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
    symlinkSync(join(workspaceRoot, 'packages', 'typespec-decorators'), join(nodeModules, '@oa-sdk', 'typespec-decorators'), 'dir')
    writeFileSync(join(directory, 'main.tsp'), `
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using Http;
using OpenAPI;
using OaSdkTypeSpec;

@service(#{ title: "Decorator fixture" })
namespace Fixture;

@route("/widgets")
@oaUseResponseComponent("400", "BadRequest")
op getWidget(): void;
`)
    writeFileSync(join(directory, 'tspconfig.yaml'), `
kind: project
entrypoint: main.tsp
emit:
  - "@typespec/openapi3"
options:
  "@typespec/openapi3":
    openapi-versions:
      - 3.2.0
`)

    try {
      execFileSync(
        join(workspaceRoot, 'node_modules', '.bin', 'tsp'),
        ['compile', directory, '--output-dir', join(directory, 'output')],
        { cwd: directory, encoding: 'utf8' },
      )
    } catch (error) {
      const failure = error as { stderr?: string; stdout?: string; message: string }
      throw new Error(`${failure.message}\n${failure.stdout ?? ''}${failure.stderr ?? ''}`)
    }

    const emittedPath = join(directory, 'output', '@typespec', 'openapi3', 'openapi.yaml')
    expect(existsSync(emittedPath)).toBe(true)
    const emitted = readFileSync(emittedPath, 'utf8')
    expect(emitted).toContain('x-oa-sdk-operation-component-refs:')
    expect(emitted).toContain("statusCode: '400'")
    expect(emitted).toContain("ref: '#/components/responses/BadRequest'")
  })
})
