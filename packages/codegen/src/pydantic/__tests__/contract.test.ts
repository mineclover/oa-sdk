/**
 * Pipeline contract tests. Block prefixes name the implementation phase that must turn them green
 * (docs/internal/architecture/pydantic-codegen-pipeline.md §7). Phase-specific behaviour tests live
 * next to this file; these are the cross-cutting invariants.
 */
import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import * as root from '../../index.js'
import { analyzeSchemaGraph } from '../../schema-graph/index.js'
import {
  PY_PASSES,
  PYDANTIC_PRESETS,
  PYDANTIC_S6_READS,
  PYDANTIC_SEMANTIC_OPTION_KEYS,
  buildPydanticModels,
  findUnresolvedPySlots,
  lowerToPyIr,
  preparePydanticDocument,
  pydanticOptionValues,
  resolvePydanticBuildOptions,
  runPyPasses,
  type PyModuleIR,
  type PydanticPreset,
} from '../index.js'
import {
  PYDANTIC_FIXTURE_NAMES,
  goldenPath,
  loadPydanticFixture,
  withReversedOperations,
  withReversedSchemas,
  type PydanticFixtureName,
} from './fixtures.js'

const PRESETS = Object.keys(PYDANTIC_PRESETS) as PydanticPreset[]

function lowerFixture(doc: unknown): { ir: PyModuleIR; analysis: ReturnType<typeof analyzeSchemaGraph> } {
  const options = resolvePydanticBuildOptions()
  const prepared = preparePydanticDocument(doc, options.preflight)
  const analysis = analyzeSchemaGraph(prepared.schemas)
  return { ir: lowerToPyIr(prepared, analysis, 'models'), analysis }
}

describe('[S0] resolvePydanticBuildOptions', () => {
  it('applies defaults < preset < explicit options', () => {
    expect(resolvePydanticBuildOptions().extra).toBe('ignore')
    expect(resolvePydanticBuildOptions({ preset: 'strict' }).extra).toBe('forbid')
    expect(resolvePydanticBuildOptions({ preset: 'strict', extra: 'allow' }).extra).toBe('allow')
    expect(resolvePydanticBuildOptions({ preset: 'passthrough' }).naming).toBe('preserve')
  })

  it('rejects unknown presets, option values and non-.py outputs', () => {
    expect(() => resolvePydanticBuildOptions({ preset: 'loose' as PydanticPreset })).toThrow(/preset/)
    expect(() => resolvePydanticBuildOptions({ extra: 'drop' as 'ignore' })).toThrow(/extra/)
    expect(() => resolvePydanticBuildOptions({ output: 'models.ts' })).toThrow(/output/)
    expect(resolvePydanticBuildOptions().layout).toBe('split')
    expect(() => resolvePydanticBuildOptions({ layout: 'multi' as 'single' })).toThrow(/layout/)
  })

  it('returns a frozen object', () => {
    expect(Object.isFrozen(resolvePydanticBuildOptions())).toBe(true)
  })
})

describe('[P1a] S1-S3 data contract', () => {
  for (const name of PYDANTIC_FIXTURE_NAMES) {
    it(`${name}: lowered IR is plain JSON data`, () => {
      const { ir } = lowerFixture(loadPydanticFixture(name))
      expect(JSON.parse(JSON.stringify(ir))).toEqual(ir)
      expect(ir.irVersion).toBe(1)
      expect(ir.decls.length).toBeGreaterThan(0)
    })

    it(`${name}: S3 leaves every decision slot unresolved`, () => {
      const { ir } = lowerFixture(loadPydanticFixture(name))
      expect(ir.imports).toBeNull()
      for (const decl of ir.decls) {
        expect(decl.pyName, decl.name).toBeNull()
        if (decl.kind === 'model') {
          expect(decl.extra, decl.name).toBeNull()
          expect(decl.regexEngine, decl.name).toBeNull()
          for (const field of decl.fields) {
            const slots = [field.attribute, field.alias, field.default, field.rejectExplicitNull]
            expect(slots, `${decl.name}.${field.wireName}`).toEqual([null, null, null, null])
          }
        } else if (decl.kind === 'enum') {
          expect([decl.repr, decl.members], decl.name).toEqual([null, null])
        } else if (decl.kind === 'operation') {
          for (const media of decl.requestBody?.mediaTypes ?? []) expect(media.pyName).toBeNull()
          for (const response of decl.responses) for (const media of response.mediaTypes) expect(media.pyName).toBeNull()
        }
      }
    })

    it(`${name}: analysis and lowered IR do not depend on component order`, () => {
      const forward = lowerFixture(loadPydanticFixture(name))
      const reversed = lowerFixture(withReversedSchemas(loadPydanticFixture(name)))
      expect(reversed.analysis).toEqual(forward.analysis)
      expect(reversed.ir).toEqual(forward.ir)
    })
  }
})

describe('[P1b] S4 pass contract', () => {
  for (const name of PYDANTIC_FIXTURE_NAMES) {
    for (const preset of PRESETS) {
      it(`${name}/${preset}: passes resolve every slot`, () => {
        const { ir, analysis } = lowerFixture(loadPydanticFixture(name))
        const result = runPyPasses(ir, resolvePydanticBuildOptions({ preset }), analysis)
        expect(findUnresolvedPySlots(result.ir)).toEqual([])
        expect(JSON.parse(JSON.stringify(result.ir))).toEqual(result.ir)
      })
    }
  }

  it('S4 resolves every media alias and envelope decision slot', () => {
    const { ir, analysis } = lowerFixture(loadPydanticFixture('discriminated-envelope'))
    expect(runPyPasses(ir, resolvePydanticBuildOptions(), analysis).ir.decls.flatMap(decl => decl.kind === 'operation'
      ? [...(decl.requestBody?.mediaTypes ?? []), ...decl.responses.flatMap(response => response.mediaTypes)].map(media => media.pyName)
      : []).every(value => value !== null)).toBe(true)
    expect(findUnresolvedPySlots(runPyPasses(ir, resolvePydanticBuildOptions(), analysis).ir)).toEqual([])
  })

  it('every option a pass declares is observable in that pass on some fixture', () => {
    const unobserved: string[] = []
    for (const pass of PY_PASSES) {
      if (pass.name === 'oneofPolicy') continue
      for (const key of pass.reads) {
        const observed = PYDANTIC_FIXTURE_NAMES.some(name => {
          const { ir, analysis } = lowerFixture(loadPydanticFixture(name))
          const before = PY_PASSES.slice(0, PY_PASSES.indexOf(pass)).map(p => p.name)
          const input = runPyPasses(ir, resolvePydanticBuildOptions(), analysis, { only: before }).ir
          const outputs = pydanticOptionValues(key).map(value =>
            runPyPasses(input, resolvePydanticBuildOptions({ [key]: value }), analysis, { only: [pass.name] }).ir)
          return outputs.some(output => JSON.stringify(output) !== JSON.stringify(outputs[0]))
        })
        if (!observed) unobserved.push(`${pass.name}.${key}`)
      }
    }
    expect(unobserved).toEqual([])
  })

  it('every semantic option is read by at least one pass', () => {
    const read = new Set(PY_PASSES.flatMap(pass => pass.reads))
    expect(PYDANTIC_SEMANTIC_OPTION_KEYS.filter(key => !read.has(key))).toEqual([])
  })
})

describe('[P1c] S5-S6 output contract', () => {
  const cases: Array<[PydanticFixtureName, PydanticPreset]> = PYDANTIC_FIXTURE_NAMES.flatMap(name =>
    PRESETS.map(preset => [name, preset] as [PydanticFixtureName, PydanticPreset]))

  for (const [name, preset] of cases) {
    it(`${name}/${preset}: matches golden module`, async () => {
      const result = buildPydanticModels(loadPydanticFixture(name), { preset })
      await expect(result.source).toMatchFileSnapshot(goldenPath(`${name}.${preset}.py`))
    })
  }

  for (const name of PYDANTIC_FIXTURE_NAMES) {
    it(`${name}: output bytes do not depend on component order or repetition`, () => {
      const first = buildPydanticModels(loadPydanticFixture(name))
      const again = buildPydanticModels(loadPydanticFixture(name))
      const reversed = buildPydanticModels(withReversedSchemas(loadPydanticFixture(name)))
      expect(again.source).toBe(first.source)
      expect(reversed.source).toBe(first.source)
      expect(reversed.report.contentSha256).toBe(first.report.contentSha256)
    })
  }

  it('emitIr adds the IR file next to the module', () => {
    const result = buildPydanticModels(loadPydanticFixture('cycles'), { emitIr: true, output: 'pkg/models.py' })
    expect(result.files.map(file => file.path)).toEqual(['pkg/models.py', 'pkg/operations.py', 'pkg/__init__.py', 'pkg/models.py.ir.json'])
    expect(JSON.parse(result.files.at(-1)!.content)).toEqual(result.ir)
  })

  it('operations: emitIr matches the IR golden', async () => {
    const result = buildPydanticModels(loadPydanticFixture('operations'), { emitIr: true })
    await expect(result.files.find(file => file.path.endsWith('.ir.json'))?.content)
      .toMatchFileSnapshot(goldenPath('operations.ir.json'))
    expect(JSON.parse(result.files.find(file => file.path.endsWith('.ir.json'))!.content)).toEqual(result.ir)
    const codes = result.diagnostics.map(diagnostic => diagnostic.code)
    expect(codes).toContain('pydantic/operation-id-missing')
    expect(codes).toContain('pydantic/operation-name-collision')
    const operation = result.ir.decls.find(decl => decl.kind === 'operation' && decl.parameters.some(parameter => parameter.name === 'filter'))
    expect(operation?.kind).toBe('operation')
    if (operation?.kind === 'operation') {
      expect(operation.responses.map(response => response.status)).toEqual(expect.arrayContaining(['200', '400', 'default']))
      expect(operation.responses.some(response => response.headers.length > 0)).toBe(true)
      expect(operation.parameters.some(parameter => parameter.name === 'filter' && parameter.required === false)).toBe(true)
    }
  })

  it('operations: split and single operation modules match goldens', async () => {
    const split = buildPydanticModels(loadPydanticFixture('operations'))
    await expect(split.files.find(file => file.path.endsWith('operations.py'))?.content)
      .toMatchFileSnapshot(goldenPath('operations.split.py'))
    const single = buildPydanticModels(loadPydanticFixture('operations'), { layout: 'single' })
    await expect(single.source).toMatchFileSnapshot(goldenPath('operations.single.py'))
  })

  it('oneOf inline component branches resolve in smart and exact modes', () => {
    const document = {
      openapi: '3.2.0', info: { title: 'oneof', version: '1' }, components: { schemas: {
        Choice: { oneOf: [
          { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
          { type: 'object', required: ['y'], properties: { y: { type: 'string' } } },
        ] },
      } },
    }
    expect(() => buildPydanticModels(document)).not.toThrow()
    expect(() => buildPydanticModels(document, { oneOfMode: 'exact' })).not.toThrow()
    expect(buildPydanticModels(document).source).not.toBe(buildPydanticModels(document, { oneOfMode: 'exact' }).source)
    expect(resolvePydanticBuildOptions().oneOfMode).toBe('smart')
    expect(PY_PASSES.find(pass => pass.name === 'oneofPolicy')?.reads).toEqual(['oneOfMode'])
  })

  it('S3 lowering is option-independent and records only oneOf origin facts', () => {
    const document = {
      openapi: '3.2.0', info: { title: 'origin', version: '1' }, components: { schemas: {
        Choice: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
        Either: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      } },
    }
    const prepared = preparePydanticDocument(document, resolvePydanticBuildOptions().preflight)
    const analysis = analyzeSchemaGraph(prepared.schemas)
    const smart = lowerToPyIr(prepared, analysis, 'models')
    const exact = lowerToPyIr(prepared, analysis, 'models')
    expect(exact).toEqual(smart)
    const choice = smart.decls.find(decl => decl.kind === 'alias' && decl.name === 'Choice')
    const either = smart.decls.find(decl => decl.kind === 'alias' && decl.name === 'Either')
    expect(choice?.kind === 'alias' && choice.type.kind === 'union' ? choice.type.origin : undefined).toBe('oneOf')
    expect(either?.kind === 'alias' && either.type.kind === 'union' ? either.type.origin : undefined).toBeUndefined()
    expect(smart.decls.some(decl => decl.kind === 'alias' && decl.type.kind === 'union' && decl.type.exact === true)).toBe(false)
  })

  it('S3 records envelope facts with an unresolved decision slot', () => {
    const { ir, analysis } = lowerFixture(loadPydanticFixture('discriminated-envelope'))
    for (const name of ['Pet', 'Pet2']) {
      const decl = ir.decls.find(item => item.kind === 'alias' && item.name === name)
      expect(decl?.kind === 'alias' && decl.type.kind === 'union' ? decl.type.envelope?.decision : undefined).toBeNull()
    }
    expect(ir.decls.filter(decl => decl.kind === 'model' && decl.envelopeVariant === null).map(decl => decl.name).sort()).toEqual(['Pet2Cat', 'Pet2Dog', 'PetCat', 'PetDog'])
    expect(findUnresolvedPySlots(ir).some(slot => slot.slot.includes('envelope.decision'))).toBe(true)
    expect(findUnresolvedPySlots(ir).some(slot => slot.slot.endsWith('envelopeVariant'))).toBe(true)
    const resolved = runPyPasses(ir, resolvePydanticBuildOptions(), analysis).ir
    expect(findUnresolvedPySlots(resolved)).toEqual([])
    expect(resolved.decls.filter(decl => decl.kind === 'model' && decl.envelopeVariant === true).length).toBe(4)
  })

  it('operation media, status unions, metadata, and report files are deterministic', () => {
    const document = {
      openapi: '3.2.0', info: { title: 'operation policies', version: '1' },
      paths: { '/items': { get: {
        operationId: 'readItem',
        parameters: [{ name: 'X-Request-Id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'text/plain': { schema: { type: 'string' } } } },
        responses: {
          '200': { description: 'ok', content: {
            'application/vnd.result+json': { schema: { $ref: '#/components/schemas/Accepted' } },
            'application/json': { schema: { $ref: '#/components/schemas/Created' } },
          } },
          '201': { description: 'accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/Accepted' } } } },
          '404': { description: 'missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/NotFound' } } } },
          default: { description: 'error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      } } },
      components: { schemas: {
        Accepted: { type: 'object', required: ['accepted'], properties: { accepted: { type: 'boolean' } } },
        Created: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        NotFound: { type: 'object', required: ['code'], properties: { code: { type: 'string', enum: ['NOT_FOUND'] } } },
        Error: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
      } },
    }
    const result = buildPydanticModels(document)
    const operation = result.ir.decls.find(decl => decl.kind === 'operation')
    expect(operation?.kind).toBe('operation')
    if (operation?.kind !== 'operation') return
    expect(operation.requestBody?.mediaType).toBe('text/plain')
    expect(operation.requestBody?.schema).toEqual({ kind: 'builtin', name: 'str' })
    expect(operation.requestBody?.mediaTypes.find(media => media.mediaType === 'text/plain')?.schema).toEqual({ kind: 'builtin', name: 'str' })
    expect(operation.responses.find(response => response.status === '200')?.mediaType).toBe('application/json')
    expect(result.diagnostics.filter(diagnostic => diagnostic.code === 'pydantic/media-type-unsupported')).toHaveLength(0)
    const operationSource = result.files.find(file => file.path === 'operations.py')?.content ?? ''
    expect(operationSource).toContain('ReadItemResponse: TypeAlias = Created | Accepted')
    expect(operationSource).toContain('request_media={"text/plain": ReadItemBody}')
    expect(operationSource).toContain('ReadItemError: TypeAlias = NotFound | Error')
    expect(operationSource).toContain('"404": NotFound')
    expect(result.report.declarations.operations).toBe(1)
    expect(result.report.files).toEqual(['models.py', 'operations.py', '__init__.py'])
    expect(buildPydanticModels(document, { layout: 'single' }).report.files).toEqual(['models.py'])
    expect(buildPydanticModels(document, { emitOperations: false }).report.files).toEqual(['models.py'])
    const reversed = buildPydanticModels(withReversedOperations(document as OasDocument))
    expect(reversed.files.find(file => file.path === 'operations.py')?.content)
      .toBe(result.files.find(file => file.path === 'operations.py')?.content)
  })

  it('operation parameter groups use ordinary naming and optional policy slots', () => {
    const document = {
      openapi: '3.2.0', info: { title: 'params', version: '1' }, paths: { '/items': { get: {
        operationId: 'read', parameters: [
          { name: 'X-Request-Id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'pageSize', in: 'query', required: false, schema: { type: 'integer' } },
        ], responses: { '204': { description: 'ok' } },
      } } },
    }
    const reject = buildPydanticModels(document, { naming: 'snake-alias', optionalStyle: 'reject-null' })
    const plain = buildPydanticModels(document, { naming: 'snake-alias', optionalStyle: 'plain' })
    const header = reject.ir.decls.find(decl => decl.kind === 'model' && decl.pyName === 'ReadHeaderParams')
    const rejectQuery = reject.ir.decls.find(decl => decl.kind === 'model' && decl.pyName === 'ReadQueryParams')
    const plainQuery = plain.ir.decls.find(decl => decl.kind === 'model' && decl.pyName === 'ReadQueryParams')
    expect(header?.kind === 'model' ? header.fields[0] : undefined).toMatchObject({ attribute: 'x_request_id', alias: 'X-Request-Id' })
    expect(rejectQuery?.kind === 'model' ? rejectQuery.fields[0]?.rejectExplicitNull : undefined).toBe(true)
    expect(plainQuery?.kind === 'model' ? plainQuery.fields[0]?.rejectExplicitNull : undefined).toBe(false)
  })

  it('operations are independent of path and method declaration order and close refs', () => {
    const document = loadPydanticFixture('operations')
    const first = buildPydanticModels(document, { emitIr: true })
    const reversed = buildPydanticModels(withReversedOperations(document), { emitIr: true })
    expect(reversed.ir).toEqual(first.ir)
    expect(findUnresolvedPySlots(first.ir)).toEqual([])
    const names = new Set(first.ir.decls.map(decl => decl.name))
    for (const operation of first.ir.decls.filter(decl => decl.kind === 'operation')) {
      const visit = (type: import('../ir.js').PyTypeExpr): void => {
        if (type.kind === 'ref') expect(names.has(type.target)).toBe(true)
        if (type.kind === 'list') visit(type.item)
        if (type.kind === 'dict') visit(type.value)
        if (type.kind === 'union') type.members.forEach(visit)
        if (type.kind === 'constrained') visit(type.base)
      }
      operation.parameters.forEach(parameter => visit(parameter.schema))
      if (operation.requestBody?.schema) visit(operation.requestBody.schema)
      operation.responses.forEach(response => {
        if (response.schema) visit(response.schema)
        response.headers.forEach(header => visit(header.schema))
      })
    }
  })

  it('emitOperations false removes operation declarations and owned models', () => {
    const document = loadPydanticFixture('operations')
    const enabled = buildPydanticModels(document)
    const disabled = buildPydanticModels(document, { emitOperations: false })
    expect(disabled.ir.decls.some(decl => decl.kind === 'operation')).toBe(false)
    expect(disabled.ir.decls.some(decl => decl.kind === 'model' && decl.operationOwner !== undefined)).toBe(false)
    expect(disabled.source).toBe(buildPydanticModels({ ...document, paths: undefined }).source)
    expect(PYDANTIC_S6_READS).toEqual(expect.arrayContaining(['layout', 'emitOperations']))
    expect(enabled.report.layout).toBe('split')
    expect(enabled.report.emitOperations).toBe(true)
  })

  it('operation inline schemas use unique structured roles and resolve all slots', () => {
    const document = {
      openapi: '3.2.0', info: { title: 'inline', version: '1' },
      paths: {
        '/a': { post: { operationId: 'make', parameters: [{ name: 'q', in: 'query', schema: { type: 'object', properties: { x: { type: 'string' } } } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { inner: { type: 'object', properties: { y: { type: 'string' } } } } } } } }, responses: Object.fromEntries(['200', '201', '404', '500'].map(status => [status, { description: status, content: { 'application/json': { schema: { type: 'object', properties: { value: { type: 'string' } } } } } }])) } },
        '/b': { get: { operationId: 'make', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { b: { type: 'string' } } } } } } } } },
      }, components: { schemas: { MakeResponse: { type: 'object', properties: { id: { type: 'string' } } } } },
    }
    const result = buildPydanticModels(document, { emitIr: true })
    expect(findUnresolvedPySlots(result.ir)).toEqual([])
    const declarations = result.ir.decls.filter(decl => decl.kind === 'model' || decl.kind === 'operation')
    expect(new Set(declarations.map(decl => decl.name)).size).toBe(declarations.length)
    expect(new Set(declarations.map(decl => decl.pyName)).size).toBe(declarations.length)
    expect(result.ir.diagnostics.map(diagnostic => diagnostic.code)).toContain('pydantic/operation-name-collision')
    expect(result.ir.decls.filter(decl => decl.kind === 'operation').map(decl => decl.pyName)).toEqual(['Make', 'Make2'])
    expect(result.ir.decls.filter(decl => decl.kind === 'model').map(decl => decl.pyName)).toEqual(expect.arrayContaining([
      'MakeBody', 'MakeBodyInner', 'MakeQueryParamQ', 'MakeResponse', 'MakeResponse201', 'MakeError404', 'MakeError500', 'Make2Response',
    ]))
  })

  it('resolves operation component refs and path-level parameter precedence', () => {
    const document = {
      openapi: '3.2.0', info: { title: 'refs', version: '1' },
      paths: { '/refs/{id}': {
        parameters: [{ $ref: '#/components/parameters/Id' }],
        get: {
          operationId: 'readRefs',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { $ref: '#/components/requestBodies/Body' },
          responses: { '200': { $ref: '#/components/responses/Ok' } },
        },
      } },
      components: {
        schemas: { Body: { type: 'object', properties: { value: { type: 'string' } } }, Result: { type: 'object' } },
        parameters: { Id: { name: 'id', in: 'path', required: true, schema: { type: 'integer' } } },
        requestBodies: { Body: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Body' } } } } },
        responses: { Ok: { description: 'ok', headers: { 'X-Ref': { $ref: '#/components/headers/RefHeader' } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } } },
        headers: { RefHeader: { required: true, schema: { type: 'string' } } },
      },
    }
    const operation = buildPydanticModels(document).ir.decls.find(decl => decl.kind === 'operation')
    expect(operation?.kind).toBe('operation')
    if (operation?.kind !== 'operation') return
    expect(operation.parameters).toHaveLength(1)
    expect(operation.parameters[0]?.pointer).toBe('/paths/~1refs~1{id}/get/parameters/0')
    expect(operation.parameters[0]?.schema).toEqual({ kind: 'builtin', name: 'str' })
    expect(operation.requestBody?.schema).toEqual({ kind: 'ref', target: 'Body' })
    expect(operation.responses[0]?.schema).toEqual({ kind: 'ref', target: 'Result' })
    expect(operation.responses[0]?.headers[0]?.schema).toEqual({ kind: 'builtin', name: 'str' })
  })
})

describe('[public] package root exposes every stage', () => {
  for (const name of PYDANTIC_FIXTURE_NAMES) {
    it(`${name}: S0-S6 composed from package-root exports equals buildPydanticModels`, () => {
      const doc = loadPydanticFixture(name)
      const options = root.resolvePydanticBuildOptions({ emitIr: true })
      const prepared = root.preparePydanticDocument(doc, options.preflight)
      const combined = root.analyzeSchemaGraph({ ...prepared.schemas, ...prepared.operationSchemas })
      const components = root.analyzeSchemaGraph(prepared.schemas)
      const analysis = { ...combined, order: [...components.order, ...combined.order.filter(name => prepared.operationSchemas[name] !== undefined)] }
      const lowered = root.lowerToPyIr(prepared, analysis, root.pydanticModuleName(options.output))
      const { ir } = root.runPyPasses(lowered, options, analysis)
      const operationSource = ir.decls.some(decl => decl.kind === 'operation')
        ? root.renderPyOperationsModule(ir, options.layout === 'split') : undefined
      const source = options.layout === 'single' ? root.renderPyOperationsModule(ir, false) : root.renderPyModule(ir)
      const { files, report } = root.emitPydanticFiles(source, ir, options, {
        ...(operationSource === undefined ? {} : { operations: operationSource, packageInit: root.renderPyPackageInit() }),
      })

      const whole = root.buildPydanticModels(doc, { emitIr: true })
      expect(files).toEqual(whole.files)
      expect(report).toEqual(whole.report)
    })
  }
})
