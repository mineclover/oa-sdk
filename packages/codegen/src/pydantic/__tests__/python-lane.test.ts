import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { buildPydanticModels } from '../build.js'
import { PYDANTIC_FIXTURE_NAMES, loadPydanticFixture } from './fixtures.js'
import { PYDANTIC_PRESETS, type PydanticBuildOptions, type PydanticPreset } from '../options.js'
import { deriveParitySourceSchemas } from './parity-source.js'

type Example = { pyName: string; value: unknown; alias: boolean }
const enabled = process.env.OA_SDK_PYDANTIC_PY_LANE === '1'
const lane = enabled ? describe : describe.skip
const driverPath = join(import.meta.dirname, 'python-lane/check_models.py')
const presets = Object.keys(PYDANTIC_PRESETS) as PydanticPreset[]
const parityAllowList = JSON.parse(readFileSync(join(import.meta.dirname, 'python-lane/parity-allowlist.json'), 'utf8')) as Array<{ fixture: string; pointer: string; reason: string }>
const parityExpectedModels: Record<string, number> = {
  approved: 70, 'chunk-stream': 26, 'discriminated-envelope': 6, cycles: 3, scalars: 1, operations: 9,
}
const parityExpectedAllowListedDifferences: Record<string, number> = {
  approved: 2, 'chunk-stream': 0, 'discriminated-envelope': 0, cycles: 0, scalars: 0, operations: 0,
}

const semanticDocument = {
  openapi: '3.2.0', info: { title: 'semantic', version: '1' }, components: { schemas: {
    Person: { type: 'object', required: ['personId'], properties: {
      personId: { type: 'string' }, nickName: { type: 'string' }, note: { type: ['string', 'null'] },
      _meta: { type: 'string' }, from: { type: 'string' }, json: { type: 'string' },
    } },
    Locked: {
      type: 'object', required: ['id'], properties: { id: { type: 'string' } },
      unevaluatedProperties: { not: {} },
    },
    Tags: { type: 'object', required: ['values'], properties: {
      values: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    } },
  } },
}

const encodingDocument = {
  openapi: '3.2.0', info: { title: 'encoding', version: '1' }, components: { schemas: {
    Encoded: { type: 'object', 'x-lane-model': 'encoded', required: ['unix', 'httpDate', 'token'], properties: {
      unix: { type: 'integer', format: 'unixtime' },
      httpDate: { type: 'string', format: 'http-date' },
      token: { type: 'string', contentEncoding: 'base64url' },
    } },
  } },
}

const recursiveDocument = {
  openapi: '3.2.0', info: { title: 'recursive', version: '1' }, components: { schemas: {
    NodeList: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
    Node: { type: 'object', required: ['value', 'children'], properties: {
      value: { type: 'string' }, children: { $ref: '#/components/schemas/NodeList' },
    } },
  } },
}

const exactDocument = {
  openapi: '3.2.0', info: { title: 'exact', version: '1' }, components: { schemas: {
    Choice: { oneOf: [
      { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
      { type: 'object', required: ['y'], properties: { y: { type: 'string' } } },
    ] },
    Envelope: { type: 'object', required: ['choice', 'either'], properties: {
      choice: { $ref: '#/components/schemas/Choice' },
      either: { anyOf: [{ type: 'integer' }, { type: 'number' }] },
    } },
  } },
}

const operationLaneDocument = {
  openapi: '3.2.0', info: { title: 'operation lane', version: '1' }, components: { schemas: {
    Request: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    Created: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    Accepted: { type: 'object', required: ['accepted'], properties: { accepted: { type: 'boolean' } } },
    NotFound: { type: 'object', required: ['code'], properties: { code: { type: 'string', enum: ['NOT_FOUND'] } } },
    Error: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
  } }, paths: { '/items/{id}': { get: {
    operationId: 'readItem', parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'X-Request-Id', in: 'header', required: true, schema: { type: 'string' } },
    ], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Request' } } } },
    responses: {
      '200': { description: 'created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Created' } } } },
      '201': { description: 'accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/Accepted' } } } },
      '404': { description: 'missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/NotFound' } } } },
      default: { description: 'error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
  } } }
}

const bodyTypesLaneDocument = {
  openapi: '3.2.0', info: { title: 'body types lane', version: '1' }, components: { schemas: {
    Cat: { type: 'object', required: ['name', 'meow'], properties: { name: { type: 'string' }, meow: { type: 'integer' } } },
    Dog: { type: 'object', required: ['name', 'bark'], properties: { name: { type: 'string' }, bark: { type: 'string' } } },
    Pet: { type: 'object', oneOf: [{ $ref: '#/components/schemas/PetCat' }, { $ref: '#/components/schemas/PetDog' }], discriminator: { propertyName: 'kind', mapping: { cat: '#/components/schemas/PetCat', dog: '#/components/schemas/PetDog' } } },
    PetCat: { type: 'object', required: ['kind', 'value'], properties: { kind: { type: 'string', enum: ['cat'] }, value: { $ref: '#/components/schemas/Cat' } } },
    PetDog: { type: 'object', required: ['kind', 'value'], properties: { kind: { type: 'string', enum: ['dog'] }, value: { $ref: '#/components/schemas/Dog' } } },
    Pet2: { type: 'object', oneOf: [{ $ref: '#/components/schemas/Pet2Cat' }, { $ref: '#/components/schemas/Pet2Dog' }], discriminator: { propertyName: 'type', mapping: { cat: '#/components/schemas/Pet2Cat', dog: '#/components/schemas/Pet2Dog' } } },
    Pet2Cat: { type: 'object', required: ['type', 'data'], properties: { type: { type: 'string', enum: ['cat'] }, data: { $ref: '#/components/schemas/Cat' } } },
    Pet2Dog: { type: 'object', required: ['type', 'data'], properties: { type: { type: 'string', enum: ['dog'] }, data: { $ref: '#/components/schemas/Dog' } } },
  } }, paths: { '/upload': { post: {
    operationId: 'upload', requestBody: { content: {
      'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, files: { type: 'array', items: { type: 'string', format: 'binary' } } } } },
      'text/plain': { schema: { type: 'string' } },
    } }, responses: { '200': { description: 'stream', content: {
      'text/event-stream': { itemSchema: { type: 'string' } },
      'application/jsonl': { schema: { type: 'array', items: { type: 'string' } } },
    } } },
  } }, '/raw': { post: {
    operationId: 'raw', requestBody: { content: { 'text/plain': {} } },
    responses: { '200': { description: 'bytes', content: { 'application/octet-stream': {} } } },
  } } }
}

const fidelityDocument = {
  openapi: '3.2.0', info: { title: 'type fidelity', version: '1' }, components: { schemas: {
    Profile: { type: 'object', title: 'Profile title', required: ['displayName', 'code'], properties: {
      displayName: { type: 'string', title: 'Display name' },
      code: { type: 'string', title: 'Code', pattern: '\\d+' },
      homepage: { type: 'string', format: 'uri' },
      ttl: { type: 'string', format: 'duration', default: 'P1Y' },
    } },
  } }, paths: { '/profiles/{profileId}': { post: {
    operationId: 'createProfile', parameters: [{ name: 'profileId', in: 'path', required: true,
      schema: { type: 'string', title: 'Profile id' } }], requestBody: { required: true, content: {
      'application/json': { schema: { type: 'object', title: 'Create body', required: ['displayName'], properties: {
        displayName: { type: 'string', title: 'Display name' },
      } } },
    } }, responses: { '200': { description: 'ok', content: {
      'application/json': { schema: { $ref: '#/components/schemas/Profile' } },
    } } },
  } } },
}

function runDriver(modulePath: string, payload: unknown): Record<string, number> {
  const payloadPath = join(modulePath, 'payload.json')
  writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`)
  const result = spawnSync('uv', [
    'run', '--no-project', '--with', 'pydantic[email]>=2.11,<3', 'python', driverPath, payloadPath,
  ], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  if (result.error?.message.includes('ENOENT')) throw new Error('uv is required for the Python lane')
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}') as Record<string, number>
}

function examplesFor(
  fixture: ReturnType<typeof loadPydanticFixture>,
  decls: ReturnType<typeof buildPydanticModels>['ir']['decls'],
): Example[] {
  const schemas = fixture.components?.schemas ?? {}
  return decls.flatMap(decl => {
    if (decl.pyName === null) return []
    const schema = schemas[decl.name] as Record<string, unknown> | undefined
    const values = Array.isArray(schema?.examples) ? schema.examples
      : schema?.example === undefined ? [] : [schema.example]
    return values.map(value => ({ pyName: decl.pyName!, value, alias: decl.kind === 'model' }))
  })
}

function modelCases(result: ReturnType<typeof buildPydanticModels>, examples: Example[]) {
  return result.ir.decls.flatMap(decl => {
    const sample = examples.find(example => example.pyName === decl.pyName && example.alias)
    if (decl.kind !== 'model' || sample === undefined || typeof sample.value !== 'object'
      || sample.value === null) return []
    return [{
      pyName: decl.pyName!, value: sample.value,
      fields: decl.fields.map(field => ({ wire: field.wireName, attribute: field.attribute })),
      open: decl.openness.kind === 'open',
    }]
  })
}

function writeModule(result: ReturnType<typeof buildPydanticModels>): string {
  const dir = mkdtempSync(join(tmpdir(), 'oa-sdk-pydantic-'))
  writeFileSync(join(dir, 'models.py'), result.source)
  return dir
}

function writeSplitPackage(result: ReturnType<typeof buildPydanticModels>): string {
  const root = mkdtempSync(join(tmpdir(), 'oa-sdk-pydantic-pkg-'))
  const dir = join(root, 'generated_pkg')
  mkdirSync(dir)
  for (const file of result.files) {
    if (file.path.endsWith('.py')) writeFileSync(join(dir, file.path), file.content)
  }
  return dir
}

function runStaticChecks(dir: string, files: string[] = ['models.py']): void {
  const paths = files.filter(file => existsSync(join(dir, file))).map(file => join(dir, file))
  expect(spawnSync('uv', [
    'run', '--no-project', '--with', 'ruff', 'ruff', 'check', '--no-cache',
    '--select', 'E,F,I001,UP037', ...paths,
  ], { encoding: 'utf8' }).status).toBe(0)
  expect(spawnSync('uv', [
    'run', '--no-project', '--with', 'pyright', 'pyright', '--pythonversion', '3.11',
    ...paths,
  ], { encoding: 'utf8' }).status).toBe(0)
}

lane('Pydantic Python lane (set OA_SDK_PYDANTIC_PY_LANE=1 to run)', () => {
  for (const fixtureName of PYDANTIC_FIXTURE_NAMES) {
    for (const preset of presets) {
      it(`${fixtureName}/${preset}`, () => {
        const fixture = loadPydanticFixture(fixtureName)
        const result = buildPydanticModels(fixture, { preset })
        const examples = examplesFor(fixture, result.ir.decls)
        const dir = writeModule(result)
        try {
          const counters = runDriver(dir, {
            module: join(dir, 'models.py'), fixture: fixtureName, options: result.options,
            examples, modelCases: modelCases(result, examples),
          })
          if (fixtureName === 'approved') expect(counters.examples).toBeGreaterThan(0)
          if (fixtureName === 'chunk-stream') expect(counters.taggedUnion).toBe(4)
          runStaticChecks(dir)
        } finally { rmSync(dir, { recursive: true, force: true }) }
      })
    }
  }

  const semanticCases: Array<[string, PydanticBuildOptions, Record<string, number>]> = [
    ['default', {}, {
      omitNickName: 1, rejectNickNameNull: 1, acceptNoteNull: 1, wireInput: 1,
      attributeInput: 1, dumpByAlias: 1, ignoreExtra: 1, lockedReject: 1,
      duplicateReject: 1, uniqueAccept: 1,
    }],
    ['plain', { optionalStyle: 'plain' }, { acceptNickNameNull: 1, acceptNoteNull: 1 }],
    ['allow', { extra: 'allow' }, { allowExtra: 1, lockedReject: 1 }],
    ['forbid', { extra: 'forbid' }, { forbidExtra: 1 }],
    ['preserve', { naming: 'preserve' }, { preserveNames: 3, preserveAliases: 3 }],
  ]
  for (const [name, options, expected] of semanticCases) {
    it(`semantic/${name}`, () => {
      const result = buildPydanticModels(semanticDocument, options)
      const dir = writeModule(result)
      try {
        const actual = runDriver(dir, {
          module: join(dir, 'models.py'), fixture: 'semantic', options: result.options,
          examples: [], modelCases: [], semantic: true,
        })
        expect(actual).toEqual(expected)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  }

  for (const fixtureName of PYDANTIC_FIXTURE_NAMES) {
    it(`parity/${fixtureName}`, () => {
      const document = loadPydanticFixture(fixtureName)
      const result = buildPydanticModels(document, { layout: 'single', regex: 'ecma' })
      const source = deriveParitySourceSchemas(document, result.ir)
      const dir = writeModule(result)
      try {
        const actual = runDriver(dir, {
          module: join(dir, 'models.py'), fixture: fixtureName, parity: true,
          sourceSchemas: source.models, components: source.components,
          refMap: source.refMap,
          modelMap: Object.fromEntries(Object.keys(source.models).map(name => [name, name])),
          allowList: parityAllowList.filter(entry => entry.fixture === fixtureName),
        })
        expect(actual).toEqual({ comparedModels: parityExpectedModels[fixtureName], allowListedDifferences: parityExpectedAllowListedDifferences[fixtureName], newDifferences: 0 })
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  }

  it('encoding/decode round-trips wire values and preserves model extensions', () => {
    const result = buildPydanticModels(encodingDocument, { encodingPolicy: 'decode' })
    const dir = writeModule(result)
    try {
      const actual = runDriver(dir, {
        module: join(dir, 'models.py'), fixture: 'encoding', options: result.options,
        examples: [], modelCases: [], encoding: true,
      })
      expect(actual).toEqual({ decodeUnix: 1, decodeHttpDate: 1, decodeBase64Url: 1, dumpWire: 1, modelExtension: 1 })
      runStaticChecks(dir)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('encoding/decode supports naive datetimes', () => {
    const result = buildPydanticModels(encodingDocument, { encodingPolicy: 'decode', datetime: 'naive' })
    const dir = writeModule(result)
    try {
      const actual = runDriver(dir, {
        module: join(dir, 'models.py'), fixture: 'encoding-naive', options: result.options,
        examples: [], modelCases: [], encodingNaive: true,
      })
      expect(actual).toEqual({ decodeUnixNaive: 1, decodeHttpDateNaive: 1, dumpWireNaive: 1 })
      runStaticChecks(dir)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('encoding/decode accepts Python semantic values', () => {
    const result = buildPydanticModels(encodingDocument, { encodingPolicy: 'decode' })
    const dir = writeModule(result)
    try {
      const actual = runDriver(dir, {
        module: join(dir, 'models.py'), fixture: 'encoding-python', options: result.options,
        examples: [], modelCases: [], encodingPython: true,
      })
      expect(actual).toEqual({ pythonValues: 1 })
      runStaticChecks(dir)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('frozen models reject assignment', () => {
    const result = buildPydanticModels(semanticDocument, { frozen: true })
    const dir = writeModule(result)
    try {
      const actual = runDriver(dir, {
        module: join(dir, 'models.py'), fixture: 'frozen', options: result.options,
        examples: [], modelCases: [], frozen: true,
      })
      expect(actual).toEqual({ frozenReject: 1 })
      runStaticChecks(dir)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('recursive aliases import and validate nested payloads', () => {
    const result = buildPydanticModels(recursiveDocument)
    const dir = writeModule(result)
    try {
      const actual = runDriver(dir, {
        module: join(dir, 'models.py'), fixture: 'recursive-alias', options: result.options,
        examples: [], modelCases: [], recursiveAlias: true,
      })
      expect(actual).toEqual({ recursiveAlias: 1 })
      runStaticChecks(dir)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  for (const layout of ['split', 'single'] as const) {
    it(`operations ${layout} validates request, response union, aliases, metadata, and 404 error payloads`, () => {
      const result = buildPydanticModels(operationLaneDocument, { layout })
      const dir = layout === 'split' ? writeSplitPackage(result) : writeModule(result)
      try {
        const actual = runDriver(dir, {
          module: join(dir, layout === 'split' ? 'operations.py' : 'models.py'), fixture: 'operations-inline', options: result.options, operations: true,
        })
        expect(actual).toEqual({ requestModels: 1, bodyAlias: 1, responseUnion: 1, error404: 1, metadata404: 1 })
        runStaticChecks(dir, layout === 'split' ? ['models.py', 'operations.py', '__init__.py'] : ['models.py'])
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  }

  it('exact oneOf rejects ambiguous and unmatched payloads', () => {
    const result = buildPydanticModels(exactDocument, { oneOfMode: 'exact' })
    const exactDir = writeModule(result)
    const smartResult = buildPydanticModels(exactDocument)
    const smartDir = writeModule(smartResult)
    try {
      const actual = runDriver(exactDir, {
        module: join(exactDir, 'models.py'), fixture: 'exact', options: result.options, exact: true,
      })
      expect(actual).toEqual({ exactAmbiguous: 1, exactNone: 1, exactOne: 1, anyOfOverlap: 1 })
      const smart = runDriver(smartDir, {
        module: join(smartDir, 'models.py'), fixture: 'exact', options: smartResult.options, smart: true,
      })
      expect(smart).toEqual({ smartAmbiguous: 1 })
      runStaticChecks(exactDir)
    } finally {
      rmSync(exactDir, { recursive: true, force: true })
      rmSync(smartDir, { recursive: true, force: true })
    }
  })

  it('non-JSON bodies, stream items and discriminated envelopes', () => {
    const result = buildPydanticModels(bodyTypesLaneDocument, { layout: 'single' })
    const dir = writeModule(result)
    try {
      const actual = runDriver(dir, { module: join(dir, 'models.py'), fixture: 'body-types', options: result.options, bodyTypes: true })
      expect(actual).toEqual({ multipartBytes: 1, textAlias: 1, streamItems: 2, envelopeVariants: 1, envelopeUnknownReject: 1, schemaLessText: 1, schemaLessBytes: 1 })
      runStaticChecks(dir)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('type metadata and normalized schema parity report exact counters', () => {
    const result = buildPydanticModels(fidelityDocument, { regex: 'ecma', layout: 'single' })
    const dir = writeModule(result)
    try {
      const source = deriveParitySourceSchemas(fidelityDocument as OasDocument, result.ir)
      const actual = runDriver(dir, {
        module: join(dir, 'models.py'), fixture: 'type-fidelity', parity: true,
        sourceSchemas: source.models,
        components: source.components,
        refMap: source.refMap,
        modelMap: Object.fromEntries(Object.keys(source.models).map(name => [name, name])),
        allowList: parityAllowList.filter(entry => entry.fixture === 'type-fidelity'), metadata: true,
      })
      expect(actual).toEqual({ comparedModels: 3, allowListedDifferences: 1, newDifferences: 0, modelTitle: 1, fieldTitle: 1, originalPattern: 1, uriFormat: 1 })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('normalizer unit cases cover optional, cyclic, allOf, alias, map, docs and literal forms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-sdk-pydantic-normalizer-'))
    try {
      const actual = runDriver(dir, { fixture: 'normalizer', normalizerUnit: true })
      expect(actual).toEqual({ normalizerUnit: 1 })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
