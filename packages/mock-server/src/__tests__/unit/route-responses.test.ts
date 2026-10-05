/**
 * core/handler.ts — RouteResponses: request-independent response parts are
 * computed once per route and shared, everything request-dependent is not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDocument, type OasResponse, type OasSchema, type OperationEntry } from '@oa-sdk/parser'
import { getResponse } from 'msw'
import { generator } from '../../core/generate.js'
import { handleRouteRequest, RouteResponses } from '../../core/handler.js'
import { pickResponse, validatePickedResponse } from '../../core/response-picker.js'
import type { RequestParts } from '../../core/request-validator.js'
import type { MockPlugin } from '../../core/plugin.js'
import { createMswHandlers } from '../../adapters/msw.js'
import { createResponseBytesSpec } from '../fixtures/response-bytes.js'

const parsed = parseDocument(createResponseBytesSpec())

function operation(path: string, method: string): OperationEntry {
  const entry = parsed.routes.get(path)?.get(method as OperationEntry['method'])
  if (!entry) throw new Error(`fixture has no ${method} ${path}`)
  return entry
}

function requestParts(overrides: Partial<RequestParts> = {}): RequestParts {
  return { pathParams: {}, queryParams: {}, headers: {}, body: undefined, contentType: undefined, ...overrides }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RouteResponses', () => {
  it('generates and validates the operation response once and returns it on every call', () => {
    const entry = operation('/widgets/{widgetId}', 'get')
    const fold = vi.spyOn(generator, 'fold')
    const route = new RouteResponses(entry.responses)

    const first = route.defaultChecked()
    const foldsForFirst = fold.mock.calls.length
    const second = route.defaultChecked()

    expect(foldsForFirst).toBeGreaterThan(0)
    expect(fold).toHaveBeenCalledTimes(foldsForFirst)
    expect(second).toEqual(first)
    expect(second!.picked).toBe(first!.picked)
    expect(first!.errors).toBeUndefined()
  })

  it('starts from a response the caller already picked', () => {
    const entry = operation('/widgets/{widgetId}', 'get')
    const picked = new RouteResponses(entry.responses).defaultPicked()!
    const fold = vi.spyOn(generator, 'fold')

    const route = new RouteResponses(entry.responses, picked)

    expect(route.defaultChecked()!.picked).toBe(picked)
    expect(fold).not.toHaveBeenCalled()
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
    const route = new RouteResponses(operation('/events', 'get').responses)
    const picked = route.defaultPicked()!
    const collect = async () => {
      const chunks: string[] = []
      for await (const chunk of route.streamChunks(picked)) chunks.push(chunk)
      return chunks
    }

    const first = await collect()
    const fold = vi.spyOn(generator, 'fold')
    const second = await collect()

    expect(first).toEqual(['data: {"seq":1}\n\n', 'data: {"seq":1}\n\n', 'data: {"seq":1}\n\n'])
    expect(second).toEqual(first)
    expect(fold).not.toHaveBeenCalled()
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
    const entry = operation('/widgets/{widgetId}', 'get')
    const route = new RouteResponses(entry.responses)
    const first = handleRouteRequest(requestParts({ pathParams: { widgetId: 'w-1' } }), entry, {}, [], route)
    const fold = vi.spyOn(generator, 'fold')

    const second = handleRouteRequest(requestParts({ pathParams: { widgetId: 'w-2' } }), entry, {}, [], route)

    expect(first.type === 'success' && second.type === 'success' && second.picked === first.picked).toBe(true)
    expect(fold).not.toHaveBeenCalled()
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
    const handlers = createMswHandlers(createResponseBytesSpec())
    const request = () => getResponse(handlers, new Request('http://api.example.test/v1/widgets/w-1'))
    await request()
    const fold = vi.spyOn(generator, 'fold')

    const response = await request()

    expect(response?.status).toBe(200)
    expect(fold).not.toHaveBeenCalled()
  })
})
