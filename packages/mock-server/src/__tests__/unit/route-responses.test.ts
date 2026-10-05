/**
 * core/handler.ts — RouteResponses: request-independent response parts are
 * computed once per route and shared, everything request-dependent is not.
 *
 * Whether a response was generated is observed by counting the reads of its
 * schema (support/read-counter.ts), never with a spy on the shared generator:
 * a spy replaces a generator method, which customizes the generator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDocument, type OasMediaType, type OasResponse, type OasSchema, type OperationEntry, type SchemaAlgebra } from '@oa-sdk/parser'
import { getResponse } from 'msw'
import { GenerateFolder, generateAlgebra, generator } from '../../core/generate.js'
import { handleRequest, handleRouteRequest, RouteResponses, type HandlerResult } from '../../core/handler.js'
import { sharedGenerationIsBuiltin, StreamFolder, streamer } from '../../core/stream.js'
import { pickResponse, validatePickedResponse } from '../../core/response-picker.js'
import type { RequestParts } from '../../core/request-validator.js'
import type { MockPlugin } from '../../core/plugin.js'
import { createMswHandlers } from '../../adapters/msw.js'
import { createGeneratedIntegerSpec, createResponseBytesSpec } from '../fixtures/response-bytes.js'
import { countReads, type ReadCounter } from '../support/read-counter.js'
import { replaceProperty } from '../support/replace-property.js'

const parsed = parseDocument(createResponseBytesSpec())

function operation(path: string, method: string, document = parsed): OperationEntry {
  const entry = document.routes.get(path)?.get(method as OperationEntry['method'])
  if (!entry) throw new Error(`fixture has no ${method} ${path}`)
  return entry
}

/**
 * A freshly parsed fixture operation whose response schema (`status`,
 * `mediaType`, `schemaKey`) counts its reads, and the parsed document.
 */
function watchedOperation(
  path: string,
  method: string,
  { status = '200', mediaType = 'application/json', schemaKey = 'schema' }: { status?: string; mediaType?: string; schemaKey?: 'schema' | 'itemSchema' } = {},
): ReadCounter & { entry: OperationEntry; document: ReturnType<typeof parseDocument> } {
  const document = parseDocument(createResponseBytesSpec())
  const entry = operation(path, method, document)
  const content = entry.responses[status]?.content?.[mediaType] as OasMediaType | undefined
  if (!content) throw new Error(`fixture has no ${status} ${mediaType} response for ${method} ${path}`)
  return { entry, document, ...countReads(content, schemaKey) }
}

function requestParts(overrides: Partial<RequestParts> = {}): RequestParts {
  return { pathParams: {}, queryParams: {}, headers: {}, body: undefined, contentType: undefined, ...overrides }
}

async function collectChunks(chunks: AsyncIterable<string>): Promise<string[]> {
  const collected: string[] = []
  for await (const chunk of chunks) collected.push(chunk)
  return collected
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RouteResponses', () => {
  it('generates and validates the operation response once and returns it on every call', () => {
    const { entry, reads } = watchedOperation('/widgets/{widgetId}', 'get')
    const route = new RouteResponses(entry.responses)

    const first = route.defaultChecked()
    const readsForFirst = reads()
    const second = route.defaultChecked()

    expect(readsForFirst).toBeGreaterThan(0)
    expect(reads()).toBe(readsForFirst)
    expect(second).toEqual(first)
    expect(second!.picked).toBe(first!.picked)
    expect(first!.errors).toBeUndefined()
  })

  it('starts from a response the caller already picked', () => {
    const { entry, reads } = watchedOperation('/widgets/{widgetId}', 'get')
    const picked = pickResponse(entry.responses)!
    const readsToPick = reads()

    const route = new RouteResponses(entry.responses, picked)

    expect(route.defaultPicked()).toBe(picked)
    expect(readsToPick).toBeGreaterThan(0)
    expect(reads()).toBe(readsToPick)
    expect(route.defaultChecked()!.picked).toBe(picked)
  })

  it('records an operation without a response as having none', () => {
    expect(new RouteResponses({}).defaultChecked()).toBeUndefined()
    expect(new RouteResponses({}, null).defaultChecked()).toBeUndefined()
  })

  it('keeps the response schema errors of a response that violates its schema', () => {
    const route = new RouteResponses(operation('/broken', 'get').responses)

    expect(route.defaultChecked()!.errors).toEqual([expect.objectContaining({ path: '/response/body/count', code: 'TYPE_ERROR' })])
  })

  it('serializes its own responses once and any other response on every call', () => {
    const route = new RouteResponses(operation('/xml', 'get').responses)
    const own = route.defaultPicked()!
    const copy = { ...own }

    expect(route.serializedBody(own)).toBe('<widget><id>5</id><label>xx</label></widget>')
    expect(route.serializedBody(own)).toBe(route.serializedBody(own))
    copy.body = { id: 6, label: 'other' }
    expect(route.serializedBody(copy)).toBe('<widget><id>6</id><label>other</label></widget>')
  })

  it('generates the stream events of its own streaming response once', async () => {
    const { entry, reads } = watchedOperation('/events', 'get', { mediaType: 'text/event-stream', schemaKey: 'itemSchema' })
    const route = new RouteResponses(entry.responses)
    const picked = route.defaultPicked()!

    const first = await collectChunks(route.streamChunks(picked))
    const readsForFirst = reads()
    const second = await collectChunks(route.streamChunks(picked))

    expect(first).toEqual(['data: {"seq":1}\n\n', 'data: {"seq":1}\n\n', 'data: {"seq":1}\n\n'])
    expect(second).toEqual(first)
    expect(readsForFirst).toBeGreaterThan(0)
    expect(reads()).toBe(readsForFirst)
  })
})

describe('RouteResponses with a response schema that fails to compile', () => {
  /**
   * Responses whose only schema violates the 2020-12 meta-schema (`examples`
   * must be an array). Every call returns a new schema object, because the
   * validator remembers the schema objects it has compiled.
   */
  const uncompilableResponses = (status: string): Record<string, OasResponse> => {
    const schema: OasSchema = {
      type: 'object',
      required: ['code'],
      properties: { code: { type: 'string' } },
      examples: { sample: { value: { code: 'x' } } } as unknown as unknown[],
    }
    return { [status]: { description: status, content: { 'application/json': { schema } } } }
  }

  it.each([
    ['operation', '200', (route: RouteResponses) => route.defaultChecked()!],
    ['documented 401', '401', (route: RouteResponses) => route.unauthorizedChecked()],
    ['documented 422', '422', (route: RouteResponses) => route.documentedValidationChecked()!],
  ])('checks the %s response on every call until its schema compiles, as an uncached check does', (_, status, check) => {
    // An uncached check validates the response on every call, against its own schema object.
    const uncached = pickResponse(uncompilableResponses(status))!
    const uncachedErrors = [1, 2, 3].map(() => {
      const validation = validatePickedResponse(uncached)
      return validation.valid ? undefined : validation.errors
    })
    const route = new RouteResponses(uncompilableResponses(status))

    const checks = [1, 2, 3].map(() => check(route))

    // The validator reports the meta-schema violation on the first compile of a schema object only.
    expect(uncachedErrors[0]).toEqual([expect.objectContaining({ code: 'SCHEMA_COMPILE_ERROR', path: '/response/body' })])
    expect(uncachedErrors.slice(1)).toEqual([undefined, undefined])
    expect(checks.map(checked => checked.errors)).toEqual(uncachedErrors)
    expect(checks.map(checked => checked.picked.status)).toEqual([Number(status), Number(status), Number(status)])
    expect(checks[2]!.picked).toBe(checks[0]!.picked)
  })
})

describe('handleRouteRequest', () => {
  it('serves the shared operation response to valid requests without regenerating it', () => {
    const { entry, reads } = watchedOperation('/widgets/{widgetId}', 'get')
    const route = new RouteResponses(entry.responses)
    const first = handleRouteRequest(requestParts({ pathParams: { widgetId: 'w-1' } }), entry, {}, [], route)
    const readsForFirst = reads()

    const second = handleRouteRequest(requestParts({ pathParams: { widgetId: 'w-2' } }), entry, {}, [], route)

    expect(first.type === 'success' && second.type === 'success' && second.picked === first.picked).toBe(true)
    expect(readsForFirst).toBeGreaterThan(0)
    expect(reads()).toBe(readsForFirst)
  })

  it('shares the documented 401 response between requests without credentials', () => {
    const entry = operation('/secure', 'get')
    const route = new RouteResponses(entry.responses)
    const schemes = parsed.securitySchemes

    const first = handleRouteRequest(requestParts(), entry, schemes, [], route)
    const second = handleRouteRequest(requestParts(), entry, schemes, [], route)

    expect(first).toEqual({ type: 'success', picked: expect.objectContaining({ status: 401 }), callbacks: [] })
    expect(second.type === 'success' && first.type === 'success' && second.picked === first.picked).toBe(true)
  })

  it('builds documented 422 details from each request', () => {
    const entry = operation('/widgets', 'post')
    const route = new RouteResponses(entry.responses)
    const invalid = (body: unknown) => handleRouteRequest(
      requestParts({ body, contentType: 'application/json' }),
      entry,
      {},
      [],
      route,
    )

    const missingSize = invalid({ name: 'a' })
    const badName = invalid({ name: '', size: 1 })

    expect(missingSize.type === 'success' && missingSize.picked.body).toMatchObject({ details: [{ path: '/body/size' }] })
    expect(badName.type === 'success' && badName.picked.body).toMatchObject({ details: [{ path: '/body/name' }] })
  })

  it('serves the shared operation response when plugins match nothing and transform nothing', () => {
    const entry = operation('/range', 'get')
    const route = new RouteResponses(entry.responses)
    const observer: MockPlugin = { name: 'observer', onMatch: () => undefined }

    const first = handleRouteRequest(requestParts(), entry, {}, [observer], route)
    const second = handleRouteRequest(requestParts(), entry, {}, [observer], route)

    expect(first.type === 'success' && first.picked).toBe(route.defaultPicked())
    expect(second.type === 'success' && second.picked).toBe(route.defaultPicked())
  })

  it('gives response hooks a response of their own', () => {
    const entry = operation('/range', 'get')
    const route = new RouteResponses(entry.responses)
    const shared = route.defaultPicked()
    const received: unknown[] = []
    const recorder: MockPlugin = {
      name: 'recorder',
      onResponse(response) {
        received.push(response)
        return response
      },
    }

    handleRouteRequest(requestParts(), entry, {}, [recorder], route)
    handleRouteRequest(requestParts(), entry, {}, [recorder], route)

    expect(received).toHaveLength(2)
    expect(received[0]).not.toBe(received[1])
    expect(received).not.toContain(shared)
    expect(received[0]).toEqual(shared)
  })

})

describe('MSW adapter', () => {
  it('generates a route response on the first request only', async () => {
    const { document, reads } = watchedOperation('/widgets/{widgetId}', 'get')
    const handlers = createMswHandlers(document)
    const request = () => getResponse(handlers, new Request('http://api.example.test/v1/widgets/w-1'))
    await request()
    const readsForFirst = reads()

    const response = await request()

    expect(response?.status).toBe(200)
    expect(readsForFirst).toBeGreaterThan(0)
    expect(reads()).toBe(readsForFirst)
  })
})

// ─── customized shared generator ─────────────────────────────────────────────

let numberedIntegers = 0

/** A GenerateFolder subclass whose integer handler keeps state: it numbers its calls. */
class NumberingFolder extends GenerateFolder {
  protected override algebra(): SchemaAlgebra<unknown> {
    return { ...super.algebra(), integer: () => ++numberedIntegers }
  }
}

const builtinFold = GenerateFolder.prototype.fold
const builtinAlgebra = GenerateFolder.prototype['algebra']
const builtinGenerateString = GenerateFolder.prototype['generateString']
const builtinStreamGenerate = StreamFolder.prototype.generate

/**
 * Every way to customize the shared generator, each applied with a
 * replacement that generates the same values as the original: whether reuse
 * is safe is decided by what is in place, not by what it happens to produce.
 */
const SHARED_GENERATOR_CUSTOMIZATIONS: [string, () => () => void][] = [
  ['a generateAlgebra handler replaced', () => replaceProperty(generateAlgebra, 'integer', generateAlgebra.integer.bind(null))],
  ['a handler added to generateAlgebra', () => replaceProperty(generateAlgebra, 'typeUnion', (_schema: OasSchema, branches: unknown[]) => branches[0])],
  ['generator.fold replaced', () => replaceProperty(generator, 'fold', builtinFold.bind(generator))],
  ['a spy on generator.fold', () => {
    const spy = vi.spyOn(generator, 'fold')
    return () => spy.mockRestore()
  }],
  ['generator.algebra() replaced', () => replaceProperty(generator, 'algebra', builtinAlgebra.bind(generator))],
  ['generator.generateString() replaced', () => replaceProperty(generator, 'generateString', builtinGenerateString.bind(generator))],
  ['GenerateFolder.prototype.fold replaced', () => replaceProperty(GenerateFolder.prototype, 'fold', function (this: GenerateFolder, node: unknown) {
    return builtinFold.call(this, node)
  })],
  ['GenerateFolder.prototype.algebra replaced', () => replaceProperty(GenerateFolder.prototype, 'algebra', function (this: GenerateFolder) {
    return builtinAlgebra.call(this)
  })],
  ['GenerateFolder.prototype.generateString replaced', () => replaceProperty(GenerateFolder.prototype, 'generateString', function (this: GenerateFolder, schema: OasSchema) {
    return builtinGenerateString.call(this, schema)
  })],
  ['the generator turned into a subclass with a stateful hook', () => {
    Object.setPrototypeOf(generator, NumberingFolder.prototype)
    return () => Object.setPrototypeOf(generator, GenerateFolder.prototype)
  }],
  ['streamer.generate replaced', () => replaceProperty(streamer, 'generate', builtinStreamGenerate.bind(streamer))],
  ['StreamFolder.prototype.generate replaced', () => replaceProperty(StreamFolder.prototype, 'generate', function (this: StreamFolder, ...args: Parameters<StreamFolder['generate']>) {
    return builtinStreamGenerate.apply(this, args)
  })],
  ['the streamer given a subclass with a stateful hook', () => replaceProperty(streamer, 'folder', new NumberingFolder())],
]

/** Numbers the shared generator's integers from 1 until the returned undo is called. */
function numberIntegers(): () => void {
  let count = 0
  return replaceProperty(generateAlgebra, 'integer', () => ++count)
}

const integers = parseDocument(createGeneratedIntegerSpec())

/** The body of a successful result. */
function bodyOf(result: HandlerResult): unknown {
  if (result.type !== 'success') throw new Error(`expected success, received ${result.type}`)
  return result.picked.body
}

describe('sharedGenerationIsBuiltin', () => {
  it.each(SHARED_GENERATOR_CUSTOMIZATIONS)('is false while %s', (_name, customize) => {
    expect(sharedGenerationIsBuiltin()).toBe(true)

    const undo = customize()
    try {
      expect(sharedGenerationIsBuiltin()).toBe(false)
    } finally {
      undo()
    }

    expect(sharedGenerationIsBuiltin()).toBe(true)
  })
})

describe('RouteResponses with a customized shared generator', () => {
  const entry = operation('/n', 'get', integers)
  const serve = (route: RouteResponses) => bodyOf(handleRouteRequest(requestParts(), entry, {}, [], route))

  afterEach(() => {
    expect(sharedGenerationIsBuiltin()).toBe(true)
  })

  it.each(SHARED_GENERATOR_CUSTOMIZATIONS)('generates the response for every request while %s', (_name, customize) => {
    const route = new RouteResponses(entry.responses)
    const builtin = serve(route)

    const undo = customize()
    let served: unknown[]
    try {
      served = [serve(route), serve(route)]
    } finally {
      undo()
    }

    expect(served[0]).not.toBe(builtin)
    expect(served[1]).not.toBe(served[0])
    expect(serve(route)).toBe(builtin)
  })

  it('calls a handler that keeps state for every request, exactly as handleRequest does', () => {
    const route = new RouteResponses(entry.responses)
    const builtin = serve(route)

    let undo = numberIntegers()
    const routed = [1, 2, 3].map(() => serve(route))
    undo()
    undo = numberIntegers()
    const uncached = [1, 2, 3].map(() => bodyOf(handleRequest(requestParts(), entry, {})))
    undo()

    expect(routed).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
    expect(uncached).toEqual(routed)
    expect(builtin).toEqual({ n: 0 })
    expect(serve(route)).toBe(builtin)
  })

  it('does not adopt a response the caller picked while the generator was customized', () => {
    const undo = numberIntegers()
    const customPick = pickResponse(entry.responses)!
    const route = new RouteResponses(entry.responses, customPick)
    undo()

    expect(customPick.body).toEqual({ n: 1 })
    expect(route.defaultPicked()).not.toBe(customPick)
    expect(serve(route)).toEqual({ n: 0 })
  })

  it('records nothing it computed while the generator was customized', () => {
    const route = new RouteResponses(entry.responses)

    const undo = numberIntegers()
    const customized = [serve(route), serve(route)]
    undo()

    expect(customized).toEqual([{ n: 1 }, { n: 2 }])
    expect(serve(route)).toEqual({ n: 0 })
  })

  it('generates the events of its own stream on every call while the generator is customized', async () => {
    const route = new RouteResponses(operation('/n-events', 'get', integers).responses)
    const picked = route.defaultPicked()!
    const builtin = await collectChunks(route.streamChunks(picked))

    const undo = numberIntegers()
    const customized = [await collectChunks(route.streamChunks(picked)), await collectChunks(route.streamChunks(picked))]
    undo()

    expect(builtin).toEqual(['data: {"n":0}\n\n', 'data: {"n":0}\n\n', 'data: {"n":0}\n\n'])
    expect(customized).toEqual([
      ['data: {"n":1}\n\n', 'data: {"n":2}\n\n', 'data: {"n":3}\n\n'],
      ['data: {"n":4}\n\n', 'data: {"n":5}\n\n', 'data: {"n":6}\n\n'],
    ])
    expect(await collectChunks(route.streamChunks(picked))).toEqual(builtin)
  })
})
