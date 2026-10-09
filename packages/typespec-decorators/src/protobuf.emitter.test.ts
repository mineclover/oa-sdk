import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const workspaceRoot = resolve(import.meta.dirname, '../../..')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('TypeSpec Protobuf / RPC / WireFormat decorators emitter integration', () => {
  it('emits protobuf, field, rpc, and wireFormat extensions through actual TypeSpec compiler', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-proto-fixture-'))
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

@service(#{ title: "Protobuf Service Fixture" })
namespace ProtoFixture;

@protobuf(#{ messageName: "TelemetryEvent", package: "telemetry.v1" })
@wireFormat("protobuf")
model TelemetryEvent {
  @field(1, #{ type: "string" })
  id: string;

  @field(2, #{ type: "double" })
  timestamp: float64;

  @field(3, #{ type: "string", repeated: true })
  tags: string[];

  @field(4, #{ type: "int32" })
  priority?: integer = 1;
}

@route("/telemetry")
interface TelemetryService {
  @post
  @route("/push")
  @rpc(#{ methodName: "PushEvent", serviceName: "TelemetryService" })
  @wireFormat("protobuf")
  push(@body event: TelemetryEvent): {
    @statusCode statusCode: 200;
    @body result: TelemetryEvent;
  };
}
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

    const emittedYaml = readFileSync(emittedPath, 'utf8')
    const parsed = parseYaml(emittedYaml) as any

    // Verify TelemetryEvent has x-oa-sdk-protobuf and x-oa-sdk-wire-format
    const schema = parsed.components.schemas.TelemetryEvent
    expect(schema).toBeDefined()
    expect(schema['x-oa-sdk-protobuf']).toEqual({
      messageName: 'TelemetryEvent',
      package: 'telemetry.v1',
    })
    expect(schema['x-oa-sdk-wire-format']).toBe('protobuf')

    // Verify properties have x-oa-sdk-protobuf-field
    expect(schema.properties.id['x-oa-sdk-protobuf-field']).toEqual({
      index: 1,
      type: 'string',
    })
    expect(schema.properties.timestamp['x-oa-sdk-protobuf-field']).toEqual({
      index: 2,
      type: 'double',
    })
    expect(schema.properties.tags['x-oa-sdk-protobuf-field']).toEqual({
      index: 3,
      type: 'string',
      repeated: true,
    })
    expect(schema.properties.priority['x-oa-sdk-protobuf-field']).toEqual({
      index: 4,
      type: 'int32',
    })

    // Verify route operation has x-oa-sdk-rpc and x-oa-sdk-wire-format
    const op = parsed.paths['/telemetry/push'].post
    expect(op['x-oa-sdk-rpc']).toEqual({
      methodName: 'PushEvent',
      serviceName: 'TelemetryService',
    })
    expect(op['x-oa-sdk-wire-format']).toBe('protobuf')
  })
})
