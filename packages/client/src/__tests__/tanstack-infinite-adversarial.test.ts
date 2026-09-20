/**
 * Empirical Adversarial Challenge Suite: Requirement R4 (TanStack Query Infinite Query Generator)
 *
 * MISSION:
 * 1. Test pagination style coverage:
 *    - Cursor-based: cursor, starting_after, after query parameters
 *    - Page-based: page, page_number, pageIndex query parameters
 *    - Offset-based: offset, skip query parameters
 * 2. Verify getNextPageParam behavior across realistic simulated multi-page responses (3 pages -> next param -> next param -> undefined)
 * 3. Verify that non-paginated operations and mutation operations do NOT emit infinite query functions
 * 4. Verify full TypeScript strict compilation of emitted infinite query options and hooks using in-memory createProgram
 * 5. Run client test suite
 */

import { describe, it, expect } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
import { createOperationTypeNameMap, toOperationMethodName } from '@oa-sdk/core/browser'
import {
  ModuleKind,
  ScriptTarget,
  transpileModule,
  createSourceFile,
  createCompilerHost,
  createProgram,
  getPreEmitDiagnostics,
  flattenDiagnosticMessageText,
} from 'typescript'
import {
  detectPagination,
  generateOptionsFactory,
} from '../tanstack/options-factory-generator.js'
import { generateHookFactory } from '../tanstack/hook-factory-generator.js'
import { generateTanstackQuery } from '../tanstack/generate-tanstack.js'

function makeDoc(paths: OasDocument['paths']): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Adversarial R4 Spec', version: '1.0.0' },
    paths,
  } as OasDocument
}

describe('Challenger 2 — Requirement R4: TanStack Query Infinite Query Generator', () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Pagination Style Coverage
  // ─────────────────────────────────────────────────────────────────────────────
  describe('1. Pagination style parameter coverage', () => {
    const paginationParamCases = [
      // Cursor-based parameters
      { param: 'cursor', expectedType: 'cursor', expectedParam: 'cursor', expectedInitial: 'null as unknown as TPageParam' },
      { param: 'starting_after', expectedType: 'cursor', expectedParam: 'starting_after', expectedInitial: 'null as unknown as TPageParam' },
      { param: 'after', expectedType: 'cursor', expectedParam: 'after', expectedInitial: 'null as unknown as TPageParam' },
      { param: 'next_cursor', expectedType: 'cursor', expectedParam: 'next_cursor', expectedInitial: 'null as unknown as TPageParam' },
      { param: 'page_token', expectedType: 'cursor', expectedParam: 'page_token', expectedInitial: 'null as unknown as TPageParam' },
      { param: 'pageToken', expectedType: 'cursor', expectedParam: 'pageToken', expectedInitial: 'null as unknown as TPageParam' },

      // Page-based parameters
      { param: 'page', expectedType: 'page', expectedParam: 'page', expectedInitial: '1 as unknown as TPageParam' },
      { param: 'page_number', expectedType: 'page', expectedParam: 'page_number', expectedInitial: '1 as unknown as TPageParam' },
      { param: 'pageNumber', expectedType: 'page', expectedParam: 'pageNumber', expectedInitial: '1 as unknown as TPageParam' },
      { param: 'pageIndex', expectedType: 'page', expectedParam: 'pageIndex', expectedInitial: '1 as unknown as TPageParam' },
      { param: 'page_index', expectedType: 'page', expectedParam: 'page_index', expectedInitial: '1 as unknown as TPageParam' },
      { param: 'page_no', expectedType: 'page', expectedParam: 'page_no', expectedInitial: '1 as unknown as TPageParam' },
      { param: 'pageNo', expectedType: 'page', expectedParam: 'pageNo', expectedInitial: '1 as unknown as TPageParam' },

      // Offset-based parameters
      { param: 'offset', expectedType: 'offset', expectedParam: 'offset', expectedInitial: '0 as unknown as TPageParam' },
      { param: 'skip', expectedType: 'offset', expectedParam: 'skip', expectedInitial: '0 as unknown as TPageParam' },
    ]

    for (const testCase of paginationParamCases) {
      it(`detects ${testCase.expectedType}-based pagination with param "${testCase.param}"`, () => {
        const opId = `listItems_${testCase.param}`
        const spec = makeDoc({
          [`/items-${testCase.param}`]: {
            get: {
              operationId: opId,
              parameters: [
                { name: testCase.param, in: 'query', schema: { type: testCase.expectedType === 'cursor' ? 'string' : 'integer' } },
                { name: 'limit', in: 'query', schema: { type: 'integer' } },
              ],
              responses: {
                '200': {
                  description: 'List',
                  content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } },
                },
              },
            },
          },
        })

        const doc = parseDocument(spec)
        const op = doc.operations[0]!
        const info = detectPagination(op)

        expect(info).not.toBeNull()
        expect(info?.type).toBe(testCase.expectedType)
        expect(info?.paramName).toBe(testCase.expectedParam)
        expect(info?.limitName).toBe('limit')

        // Verify generated options code
        const code = generateOptionsFactory(doc, { banner: false })
        const operationNames = createOperationTypeNameMap(doc.operations)
        const baseName = operationNames.get(opId)!
        const methodName = toOperationMethodName(baseName)

        expect(code).toContain(`export function ${methodName}InfiniteQueryOptions<`)
        expect(code).toContain(`initialPageParam: ${testCase.expectedInitial}`)
        expect(code).toContain(`${JSON.stringify(testCase.expectedParam)}: pageParam`)
      })
    }

    it('handles various limit parameter variants: limit, per_page, perPage, page_size, pageSize, take, count', () => {
      const limitVariants = ['limit', 'per_page', 'perPage', 'page_size', 'pageSize', 'take', 'count']
      for (const limitParam of limitVariants) {
        const spec = makeDoc({
          [`/test-${limitParam}`]: {
            get: {
              operationId: `getItems_${limitParam}`,
              parameters: [
                { name: 'page', in: 'query', schema: { type: 'integer' } },
                { name: limitParam, in: 'query', schema: { type: 'integer' } },
              ],
              responses: {
                '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array' } } } },
              },
            },
          },
        })

        const doc = parseDocument(spec)
        const info = detectPagination(doc.operations[0]!)
        expect(info?.limitName).toBe(limitParam)
      }
    })

    it('precedence: selects cursor over page and offset when multiple parameters coexist', () => {
      const spec = makeDoc({
        '/multi-param': {
          get: {
            operationId: 'listMulti',
            parameters: [
              { name: 'cursor', in: 'query', schema: { type: 'string' } },
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'offset', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array' } } } },
            },
          },
        },
      })
      const doc = parseDocument(spec)
      const info = detectPagination(doc.operations[0]!)
      expect(info?.type).toBe('cursor')
      expect(info?.paramName).toBe('cursor')
    })

    it('precedence: selects page over offset when page and offset coexist', () => {
      const spec = makeDoc({
        '/page-offset': {
          get: {
            operationId: 'listPageOffset',
            parameters: [
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'offset', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array' } } } },
            },
          },
        },
      })
      const doc = parseDocument(spec)
      const info = detectPagination(doc.operations[0]!)
      expect(info?.type).toBe('page')
      expect(info?.paramName).toBe('page')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Realistic Simulated Multi-Page Responses (getNextPageParam behavior)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('2. Multi-page getNextPageParam verification across realistic 3-page scenarios', () => {
    // Helper to evaluate the generated getNextPageParam from an operation
    function extractGetNextPageParam(spec: OasDocument, operationId: string): (lastPage: any, allPages: any[], lastPageParam: any) => any {
      const output = generateTanstackQuery(spec)
      const js = transpileModule(output.combinedCode, {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      }).outputText

      let capturedOptions: any = null
      const fakeQueryPackage = {
        queryOptions: (opt: any) => opt,
        mutationOptions: (opt: any) => opt,
        infiniteQueryOptions: (opt: any) => {
          capturedOptions = opt
          return opt
        },
        useQuery: () => {},
        useMutation: () => {},
        useInfiniteQuery: () => {},
      }
      const fakeClient = new Proxy({}, { get: () => () => Promise.resolve() })

      const fn = new Function('require', 'exports', 'module', js)
      const moduleObj = { exports: {} as any }
      const fakeRequire = (mod: string) => {
        if (mod === '@tanstack/react-query') return fakeQueryPackage
        return {}
      }

      fn(fakeRequire, moduleObj.exports, moduleObj)
      const methodName = toOperationMethodName(operationId)
      const fnName = `${methodName}InfiniteQueryOptions`
      expect(typeof moduleObj.exports[fnName]).toBe('function')

      moduleObj.exports[fnName](fakeClient)
      expect(capturedOptions).not.toBeNull()
      expect(typeof capturedOptions.getNextPageParam).toBe('function')

      return capturedOptions.getNextPageParam
    }

    it('Page pagination with explicit nextPage: 3 pages -> 2 -> 3 -> undefined', () => {
      const spec = makeDoc({
        '/paged': {
          get: {
            operationId: 'listPaged',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      })
      const getNext = extractGetNextPageParam(spec, 'listPaged')

      const page1 = { items: ['item_1', 'item_2'], nextPage: 2 }
      const page2 = { items: ['item_3', 'item_4'], nextPage: 3 }
      const page3 = { items: [], nextPage: undefined }

      const nextFromP1 = getNext(page1, [page1], 1)
      expect(nextFromP1).toBe(2)

      const nextFromP2 = getNext(page2, [page1, page2], 2)
      expect(nextFromP2).toBe(3)

      const nextFromP3 = getNext(page3, [page1, page2, page3], 3)
      expect(nextFromP3).toBeUndefined()
    })

    it('Page pagination with totalPages: 3 pages -> 2 -> 3 -> undefined', () => {
      const spec = makeDoc({
        '/paged-total': {
          get: {
            operationId: 'listPagedTotal',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      })
      const getNext = extractGetNextPageParam(spec, 'listPagedTotal')

      const page1 = { items: ['item_1', 'item_2'], totalPages: 3 }
      const page2 = { items: ['item_3', 'item_4'], totalPages: 3 }
      const page3 = { items: ['item_5'], totalPages: 3 }

      const nextFromP1 = getNext(page1, [page1], 1)
      expect(nextFromP1).toBe(2)

      const nextFromP2 = getNext(page2, [page1, page2], 2)
      expect(nextFromP2).toBe(3)

      const nextFromP3 = getNext(page3, [page1, page2, page3], 3)
      expect(nextFromP3).toBeUndefined()
    })

    it('Page pagination with hasMore flag: 3 pages -> 2 -> 3 -> undefined', () => {
      const spec = makeDoc({
        '/paged-has-more': {
          get: {
            operationId: 'listPagedHasMore',
            parameters: [{ name: 'page_number', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      })
      const getNext = extractGetNextPageParam(spec, 'listPagedHasMore')

      const page1 = { data: ['a', 'b'], hasMore: true }
      const page2 = { data: ['c', 'd'], hasMore: true }
      const page3 = { data: ['e'], hasMore: false }

      expect(getNext(page1, [page1], 1)).toBe(2)
      expect(getNext(page2, [page1, page2], 2)).toBe(3)
      expect(getNext(page3, [page1, page2, page3], 3)).toBeUndefined()
    })

    it('Page pagination with raw array: 3 pages -> 2 -> 3 -> undefined (terminal empty array)', () => {
      const spec = makeDoc({
        '/paged-raw-array': {
          get: {
            operationId: 'listPagedArray',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array' } } } } },
          },
        },
      })
      const getNext = extractGetNextPageParam(spec, 'listPagedArray')

      const page1 = ['a', 'b']
      const page2 = ['c', 'd']
      const page3: string[] = []

      expect(getNext(page1, [page1], 1)).toBe(2)
      expect(getNext(page2, [page1, page2], 2)).toBe(3)
      expect(getNext(page3, [page1, page2, page3], 3)).toBeUndefined()
    })

    it('Offset pagination with total count: 3 pages -> 20 -> 40 -> undefined', () => {
      const spec = makeDoc({
        '/offset-total': {
          get: {
            operationId: 'listOffsetTotal',
            parameters: [{ name: 'offset', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      })
      const getNext = extractGetNextPageParam(spec, 'listOffsetTotal')

      // Total items: 45. Page size: 20.
      // Page 1: offset 0, 20 items -> nextOffset = 20 < 45 -> 20
      // Page 2: offset 20, 20 items -> nextOffset = 40 < 45 -> 40
      // Page 3: offset 40, 5 items -> nextOffset = 45 < 45 is false -> undefined
      const page1 = { items: new Array(20).fill('x'), total: 45 }
      const page2 = { items: new Array(20).fill('y'), total: 45 }
      const page3 = { items: new Array(5).fill('z'), total: 45 }

      expect(getNext(page1, [page1], 0)).toBe(20)
      expect(getNext(page2, [page1, page2], 20)).toBe(40)
      expect(getNext(page3, [page1, page2, page3], 40)).toBeUndefined()
    })

    it('Offset pagination with skip param and hasMore: 3 pages -> 10 -> 20 -> undefined', () => {
      const spec = makeDoc({
        '/offset-skip': {
          get: {
            operationId: 'listOffsetSkip',
            parameters: [{ name: 'skip', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      })
      const getNext = extractGetNextPageParam(spec, 'listOffsetSkip')

      const page1 = { items: new Array(10).fill('x'), hasMore: true }
      const page2 = { items: new Array(10).fill('y'), hasMore: true }
      const page3 = { items: new Array(4).fill('z'), hasMore: false }

      expect(getNext(page1, [page1], 0)).toBe(10)
      expect(getNext(page2, [page1, page2], 10)).toBe(20)
      expect(getNext(page3, [page1, page2, page3], 20)).toBeUndefined()
    })

    it('Cursor pagination with next_cursor token: 3 pages -> token_b -> token_c -> undefined', () => {
      const spec = makeDoc({
        '/cursor-token': {
          get: {
            operationId: 'listCursorToken',
            parameters: [{ name: 'cursor', in: 'query', schema: { type: 'string' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      })
      const getNext = extractGetNextPageParam(spec, 'listCursorToken')

      const page1 = { items: [{ id: '1' }], next_cursor: 'token_b' }
      const page2 = { items: [{ id: '2' }], next_cursor: 'token_c' }
      const page3 = { items: [], next_cursor: null }

      expect(getNext(page1, [page1], null)).toBe('token_b')
      expect(getNext(page2, [page1, page2], 'token_b')).toBe('token_c')
      expect(getNext(page3, [page1, page2, page3], 'token_c')).toBeUndefined()
    })

    it('allows caller to override initialPageParam and getNextPageParam via options', () => {
      const spec = makeDoc({
        '/custom-infinite': {
          get: {
            operationId: 'listCustom',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      })
      const output = generateTanstackQuery(spec)
      const js = transpileModule(output.combinedCode, {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      }).outputText

      let capturedOptions: any = null
      const fakeQueryPackage = {
        queryOptions: (opt: any) => opt,
        mutationOptions: (opt: any) => opt,
        infiniteQueryOptions: (opt: any) => {
          capturedOptions = opt
          return opt
        },
        useQuery: () => {},
        useMutation: () => {},
        useInfiniteQuery: () => {},
      }
      const fakeClient = new Proxy({}, { get: () => () => Promise.resolve() })

      const fn = new Function('require', 'exports', 'module', js)
      const moduleObj = { exports: {} as any }
      fn((mod: string) => mod === '@tanstack/react-query' ? fakeQueryPackage : {}, moduleObj.exports, moduleObj)

      const customGetNext = () => 'custom-next'
      moduleObj.exports.listCustomInfiniteQueryOptions(fakeClient, undefined, {
        initialPageParam: 99,
        getNextPageParam: customGetNext,
      })

      expect(capturedOptions.initialPageParam).toBe(99)
      expect(capturedOptions.getNextPageParam).toBe(customGetNext)
    })

    it('Cursor pagination with starting_after and item id fallback: 3 pages -> id_2 -> id_4 -> undefined (has_more: false)', () => {
      const spec = makeDoc({
        '/cursor-after': {
          get: {
            operationId: 'listCursorAfter',
            parameters: [{ name: 'starting_after', in: 'query', schema: { type: 'string' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      })
      const getNext = extractGetNextPageParam(spec, 'listCursorAfter')

      const page1 = { data: [{ id: 'id_1' }, { id: 'id_2' }], has_more: true }
      const page2 = { data: [{ id: 'id_3' }, { id: 'id_4' }], has_more: true }
      const page3 = { data: [{ id: 'id_5' }], has_more: false }

      expect(getNext(page1, [page1], null)).toBe('id_2')
      expect(getNext(page2, [page1, page2], 'id_2')).toBe('id_4')
      expect(getNext(page3, [page1, page2, page3], 'id_4')).toBeUndefined()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Negative Assertion: Non-Paginated Operations and Mutations
  // ─────────────────────────────────────────────────────────────────────────────
  describe('3. Non-paginated operations and mutations rejection', () => {
    const mixedSpec = makeDoc({
      '/users/{id}': {
        get: {
          operationId: 'getUserById',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'includeDetails', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { '200': { description: 'User', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/users': {
        get: {
          operationId: 'listUsers',
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Users', content: { 'application/json': { schema: { type: 'array' } } } } },
        },
        post: {
          operationId: 'createUser',
          parameters: [
            // Adversarial trap: mutation containing 'page' or 'cursor' in query
            { name: 'page', in: 'query', schema: { type: 'integer' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/orders/{orderId}': {
        put: {
          operationId: 'updateOrder',
          parameters: [
            { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Updated' } },
        },
        delete: {
          operationId: 'deleteOrder',
          parameters: [
            { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'skip', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '204': { description: 'Deleted' } },
        },
      },
    })

    const doc = parseDocument(mixedSpec)
    const optionsCode = generateOptionsFactory(doc, { banner: false })
    const hooksCode = generateHookFactory(doc, { banner: false })

    it('emits infinite query options ONLY for listUsers (paginated GET)', () => {
      expect(optionsCode).toContain('export function listUsersInfiniteQueryOptions<')
    })

    it('does NOT emit infinite query options for unpaginated GET (getUserById)', () => {
      expect(optionsCode).toContain('export function getUserByIdQueryOptions<')
      expect(optionsCode).not.toContain('getUserByIdInfiniteQueryOptions')
    })

    it('does NOT emit infinite query options for mutations (createUser, updateOrder, deleteOrder)', () => {
      expect(optionsCode).toContain('export function createUserMutationOptions<')
      expect(optionsCode).not.toContain('createUserInfiniteQueryOptions')

      expect(optionsCode).toContain('export function updateOrderMutationOptions<')
      expect(optionsCode).not.toContain('updateOrderInfiniteQueryOptions')

      expect(optionsCode).toContain('export function deleteOrderMutationOptions<')
      expect(optionsCode).not.toContain('deleteOrderInfiniteQueryOptions')
    })

    it('emits standalone infinite hooks ONLY for listUsers', () => {
      expect(hooksCode).toContain('export function useListUsersInfiniteQuery<')
      expect(hooksCode).not.toContain('useGetUserByIdInfiniteQuery')
      expect(hooksCode).not.toContain('useCreateUserInfiniteQuery')
      expect(hooksCode).not.toContain('useUpdateOrderInfiniteQuery')
      expect(hooksCode).not.toContain('useDeleteOrderInfiniteQuery')
    })

    it('registers infinite hook ONLY for listUsers in createApiHooks', () => {
      expect(hooksCode).toContain('useListUsersInfinite: <')
      expect(hooksCode).not.toContain('useGetUserByIdInfinite:')
      expect(hooksCode).not.toContain('useCreateUserInfinite:')
      expect(hooksCode).not.toContain('useUpdateOrderInfinite:')
      expect(hooksCode).not.toContain('useDeleteOrderInfinite:')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Strict TypeScript Compilation of Emitted Code via in-memory createProgram
  // ─────────────────────────────────────────────────────────────────────────────
  describe('4. Full TypeScript strict compilation with in-memory createProgram', () => {
    it('compiles emitted combined TanStack Query code under strict TypeScript settings with 0 errors', () => {
      const fullSpec = makeDoc({
        '/items': {
          get: {
            operationId: 'listItems',
            parameters: [
              { name: 'cursor', in: 'query', schema: { type: 'string' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        items: { type: 'array', items: { type: 'string' } },
                        next_cursor: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          post: {
            operationId: 'createItem',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      })

      const output = generateTanstackQuery(fullSpec, {
        clientImport: './client.js',
        typesImport: './types.js',
      })

      // Virtual files for strict compilation (normalized keys)
      const virtualFiles: Record<string, string> = {
        '/app/tanstack.ts': output.combinedCode,

        // Mock ambient client
        '/app/client.ts': `
          export type ClientMethodOptions = { signal?: AbortSignal; headers?: Record<string, string> }
          export interface ApiClient {
            listItems(query?: any, options?: ClientMethodOptions): Promise<{ items: string[]; next_cursor?: string }>
            createItem(body: { title: string }, options?: ClientMethodOptions): Promise<{ id: string; title: string }>
          }
        `,

        // Mock types
        '/app/types.ts': `
          export type ListItemsQueryParams = { cursor?: string; limit?: number }
          export type ListItemsResponse = { items: string[]; next_cursor?: string }
          export type ListItemsClientError = Error
          export type CreateItemBody = { title: string }
          export type CreateItemResponse = { id: string; title: string }
          export type CreateItemClientError = Error
        `,

        // Mock TanStack React Query declarations matching v5 API contextual typing
        '/node_modules/@tanstack/react-query/index.d.ts': `
          export interface QueryKey extends ReadonlyArray<unknown> {}
          export interface InfiniteData<TData, TPageParam = unknown> {
            pages: Array<TData>
            pageParams: Array<TPageParam>
          }
          export interface QueryFunctionContext<TQueryKey extends QueryKey = QueryKey, TPageParam = never> {
            queryKey: TQueryKey
            signal: AbortSignal
            pageParam: TPageParam
            meta?: Record<string, unknown>
          }
          export type QueryFunction<T = unknown, TQueryKey extends QueryKey = QueryKey, TPageParam = never> = (
            context: QueryFunctionContext<TQueryKey, TPageParam>
          ) => T | Promise<T>

          export type UndefinedInitialDataOptions<TQueryFnData = unknown, TError = Error, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey> = {
            queryKey: TQueryKey
            queryFn?: QueryFunction<TQueryFnData, TQueryKey, never>
            [key: string]: unknown
          }
          export type UndefinedInitialDataInfiniteOptions<TQueryFnData = unknown, TError = Error, TData = InfiniteData<TQueryFnData>, TQueryKey extends QueryKey = QueryKey, TPageParam = unknown> = {
            queryKey: TQueryKey
            queryFn?: QueryFunction<TQueryFnData, TQueryKey, TPageParam>
            initialPageParam: TPageParam
            getNextPageParam: (lastPage: TQueryFnData, allPages: Array<TQueryFnData>, lastPageParam: TPageParam) => TPageParam | undefined
            [key: string]: unknown
          }
          export type UseMutationOptions<TData = unknown, TError = Error, TVariables = void, TContext = unknown> = {
            mutationKey?: ReadonlyArray<unknown>
            mutationFn?: (variables: TVariables) => Promise<TData>
            [key: string]: unknown
          }
          export type UseQueryOptions<TQueryFnData = unknown, TError = Error, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey> = Record<string, unknown>
          export type UseQueryResult<TData = unknown, TError = Error> = { data?: TData; error?: TError; isLoading: boolean }
          export type UseInfiniteQueryOptions<TQueryFnData = unknown, TError = Error, TData = InfiniteData<TQueryFnData>, TQueryKey extends QueryKey = QueryKey, TPageParam = unknown> = Record<string, unknown>
          export type UseInfiniteQueryResult<TData = unknown, TError = Error> = { data?: TData; error?: TError; fetchNextPage: () => void }
          export type UseMutationResult<TData = unknown, TError = Error, TVariables = void, TContext = unknown> = { mutate: (variables: TVariables) => void }
          export interface QueryClient {}

          export declare function queryOptions<
            TQueryFnData = unknown,
            TError = Error,
            TData = TQueryFnData,
            TQueryKey extends QueryKey = QueryKey,
          >(
            options: UndefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey>
          ): UndefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey>

          export declare function infiniteQueryOptions<
            TQueryFnData = unknown,
            TError = Error,
            TData = InfiniteData<TQueryFnData>,
            TQueryKey extends QueryKey = QueryKey,
            TPageParam = unknown,
          >(
            options: UndefinedInitialDataInfiniteOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>
          ): UndefinedInitialDataInfiniteOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>

          export declare function mutationOptions<
            TData = unknown,
            TError = Error,
            TVariables = void,
            TContext = unknown,
          >(
            options: UseMutationOptions<TData, TError, TVariables, TContext>
          ): UseMutationOptions<TData, TError, TVariables, TContext>

          export declare function useQuery<T extends Record<string, any>>(options: T, qc?: QueryClient): any
          export declare function useMutation<T extends Record<string, any>>(options: T, qc?: QueryClient): any
          export declare function useInfiniteQuery<T extends Record<string, any>>(options: T, qc?: QueryClient): any
        `,

        // Mock @oa-sdk/client utility types
        '/node_modules/@oa-sdk/client/index.d.ts': `
          export type JsonPrimitive<T> = T
          export type Resolved<T> = T
        `,
      }

      const defaultHost = createCompilerHost({})
      const customHost = {
        ...defaultHost,
        getCurrentDirectory: () => '/app',
        getDefaultLibFileName: (options: any) => defaultHost.getDefaultLibFileName(options),
        getSourceFile: (fileName: string, languageVersionOrOptions: any) => {
          const norm = fileName.startsWith('/') ? fileName : `/app/${fileName}`
          if (virtualFiles[norm] !== undefined) {
            return createSourceFile(norm, virtualFiles[norm]!, ScriptTarget.ES2022, true)
          }
          return defaultHost.getSourceFile(fileName, languageVersionOrOptions)
        },
        fileExists: (fileName: string) => {
          const norm = fileName.startsWith('/') ? fileName : `/app/${fileName}`
          return virtualFiles[norm] !== undefined || defaultHost.fileExists(fileName)
        },
        readFile: (fileName: string) => {
          const norm = fileName.startsWith('/') ? fileName : `/app/${fileName}`
          return virtualFiles[norm] ?? defaultHost.readFile(fileName)
        },
        resolveModuleNames: (moduleNames: string[], containingFile: string) => {
          return moduleNames.map(moduleName => {
            if (moduleName === '@tanstack/react-query') {
              return { resolvedFileName: '/node_modules/@tanstack/react-query/index.d.ts', isExternalLibraryImport: true }
            }
            if (moduleName === '@oa-sdk/client') {
              return { resolvedFileName: '/node_modules/@oa-sdk/client/index.d.ts', isExternalLibraryImport: true }
            }
            if (moduleName === './client.js' || moduleName === './client') {
              return { resolvedFileName: '/app/client.ts', isExternalLibraryImport: false }
            }
            if (moduleName === './types.js' || moduleName === './types') {
              return { resolvedFileName: '/app/types.ts', isExternalLibraryImport: false }
            }
            return defaultHost.resolveModuleNameLiterals
              ? (defaultHost as any).resolveModuleNameLiterals([{ text: moduleName }], containingFile)[0]?.resolvedModule
              : undefined
          })
        },
      }

      const program = createProgram(
        ['/app/tanstack.ts'],
        {
          noEmit: true,
          target: ScriptTarget.ES2022,
          module: ModuleKind.ESNext,
          strict: true,
          noImplicitAny: true,
          strictNullChecks: true,
        },
        customHost as any,
      )

      const sourceFile = program.getSourceFile('/app/tanstack.ts')!
      const diagnostics = getPreEmitDiagnostics(program, sourceFile)

      const errors = diagnostics.map(d => {
        const msg = flattenDiagnosticMessageText(d.messageText, '\n')
        const pos = d.file?.getLineAndCharacterOfPosition(d.start || 0)
        return `[Line ${(pos?.line || 0) + 1}, Col ${(pos?.character || 0) + 1}] TS${d.code}: ${msg}`
      })

      expect(errors).toEqual([])
    }, 25_000)
  })
})
