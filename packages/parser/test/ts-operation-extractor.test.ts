import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  extractOperationsFromSource,
  extractOperationsFromFile,
  toOperationEntry,
  type ExtractedOperation,
  type OperationDiagnostic,
} from '../src/index.js'

describe('ts-operation-extractor', () => {
  describe('Function Declarations with @oaOperation', () => {
    it('extracts valid operations from exported function declarations', () => {
      const source = `
        /** @oaOperation GET /users */
        export function listUsers() {
          return []
        }

        /** @oaOperation POST /users */
        export async function createUser(data: unknown) {
          return data
        }
      `

      const result = extractOperationsFromSource(source, 'users.ts')
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(2)

      const [listOp, createOp] = result.operations

      expect(listOp.method).toBe('get')
      expect(listOp.path).toBe('/users')
      expect(listOp.declarationName).toBe('listUsers')
      expect(listOp.declarationKind).toBe('function')
      expect(listOp.file).toBe('users.ts')
      expect(listOp.line).toBe(3)
      expect(listOp.column).toBe(9)
      expect(listOp.operationEntry.openApiPath).toBe('/users')
      expect(listOp.operationEntry.method).toBe('get')
      expect(listOp.operationEntry.operationId).toBe('listUsers')

      expect(createOp.method).toBe('post')
      expect(createOp.path).toBe('/users')
      expect(createOp.declarationName).toBe('createUser')
      expect(createOp.declarationKind).toBe('function')
      expect(createOp.file).toBe('users.ts')
      expect(createOp.line).toBe(8)
      expect(createOp.column).toBe(9)
      expect(createOp.operationEntry.openApiPath).toBe('/users')
      expect(createOp.operationEntry.method).toBe('post')
      expect(createOp.operationEntry.operationId).toBe('createUser')
    })

    it('extracts export default function declarations', () => {
      const source = `
        /** @oaOperation GET /health */
        export default function healthCheck() {
          return { status: 'ok' }
        }
      `

      const result = extractOperationsFromSource(source, 'health.ts')
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].declarationName).toBe('healthCheck')
      expect(result.operations[0].method).toBe('get')
      expect(result.operations[0].path).toBe('/health')
    })

    it('extracts functions exported via separate export clause', () => {
      const source = `
        /** @oaOperation GET /catalog */
        function getCatalog() {}

        export { getCatalog }
      `

      const result = extractOperationsFromSource(source, 'catalog.ts')
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].declarationName).toBe('getCatalog')
      expect(result.operations[0].method).toBe('get')
      expect(result.operations[0].path).toBe('/catalog')
    })

    it('extracts JSDoc description, summary, deprecated, operationId, and tags', () => {
      const source = `
        /**
         * Fetch all active users with pagination.
         * Filtered by organization.
         * @summary List Active Users
         * @oaOperation GET /users/{orgId}
         * @operationId getOrgUsers
         * @tags users, directory
         * @deprecated
         */
        export function listOrgUsers(orgId: string) {}
      `

      const result = extractOperationsFromSource(source, 'org-users.ts')
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(1)

      const op = result.operations[0]
      expect(op.description).toBe(
        'Fetch all active users with pagination.\nFiltered by organization.',
      )
      expect(op.summary).toBe('List Active Users')
      expect(op.deprecated).toBe(true)
      expect(op.operationEntry.operationId).toBe('getOrgUsers')
      expect(op.operationEntry.tags).toEqual(['users', 'directory'])
      expect(op.operationEntry.deprecated).toBe(true)
      expect(op.operationEntry.summary).toBe('List Active Users')
      expect(op.operationEntry.description).toBe(
        'Fetch all active users with pagination.\nFiltered by organization.',
      )
      expect(op.operationEntry.parameters).toHaveLength(1)
      expect(op.operationEntry.parameters[0]).toEqual({
        name: 'orgId',
        in: 'path',
        required: true,
      })
    })
  })

  describe('Type Alias Declarations with @oaOperation', () => {
    it('extracts valid operations from exported type aliases', () => {
      const source = `
        /** @oaOperation GET /items */
        export type ListItemsOp = {
          response: string[]
        }

        /** @oaOperation POST /items */
        export type CreateItemOp = {
          body: { name: string }
          response: { id: string }
        }
      `

      const result = extractOperationsFromSource(source, 'items.ts')
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(2)

      const [listOp, createOp] = result.operations

      expect(listOp.declarationKind).toBe('type-alias')
      expect(listOp.declarationName).toBe('ListItemsOp')
      expect(listOp.method).toBe('get')
      expect(listOp.path).toBe('/items')
      expect(listOp.operationEntry.operationId).toBe('ListItemsOp')

      expect(createOp.declarationKind).toBe('type-alias')
      expect(createOp.declarationName).toBe('CreateItemOp')
      expect(createOp.method).toBe('post')
      expect(createOp.path).toBe('/items')
      expect(createOp.operationEntry.operationId).toBe('CreateItemOp')
    })

    it('extracts type aliases exported via export clause', () => {
      const source = `
        /** @oaOperation DELETE /items/{id} */
        type DeleteItemOp = {
          params: { id: string }
        }

        export { DeleteItemOp }
      `

      const result = extractOperationsFromSource(source, 'delete-item.ts')
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].declarationKind).toBe('type-alias')
      expect(result.operations[0].declarationName).toBe('DeleteItemOp')
      expect(result.operations[0].method).toBe('delete')
      expect(result.operations[0].path).toBe('/items/{id}')
    })
  })

  describe('Supported HTTP Methods (including OAS 3.2 QUERY)', () => {
    const methods = [
      { method: 'GET', normalized: 'get', path: '/test-get' },
      { method: 'PUT', normalized: 'put', path: '/test-put' },
      { method: 'POST', normalized: 'post', path: '/test-post' },
      { method: 'DELETE', normalized: 'delete', path: '/test-delete' },
      { method: 'OPTIONS', normalized: 'options', path: '/test-options' },
      { method: 'HEAD', normalized: 'head', path: '/test-head' },
      { method: 'PATCH', normalized: 'patch', path: '/test-patch' },
      { method: 'TRACE', normalized: 'trace', path: '/test-trace' },
      { method: 'QUERY', normalized: 'query', path: '/test-query' },
    ]

    for (const { method, normalized, path } of methods) {
      it(`supports uppercase ${method} method`, () => {
        const source = `
          /** @oaOperation ${method} ${path} */
          export function op_${normalized}() {}
        `
        const result = extractOperationsFromSource(source, 'methods.ts')
        expect(result.diagnostics).toHaveLength(0)
        expect(result.operations).toHaveLength(1)
        expect(result.operations[0].method).toBe(normalized)
        expect(result.operations[0].path).toBe(path)
        expect(result.operations[0].operationEntry.method).toBe(normalized)
      })

      it(`supports lowercase ${normalized} method`, () => {
        const source = `
          /** @oaOperation ${normalized} ${path} */
          export function op_lower_${normalized}() {}
        `
        const result = extractOperationsFromSource(source, 'methods-lower.ts')
        expect(result.diagnostics).toHaveLength(0)
        expect(result.operations).toHaveLength(1)
        expect(result.operations[0].method).toBe(normalized)
        expect(result.operations[0].path).toBe(path)
      })
    }

    it('specifically supports OAS 3.2 QUERY operation on function and type alias', () => {
      const source = `
        /** @oaOperation QUERY /search */
        export function searchItems(query: unknown) {}

        /** @oaOperation query /filter */
        export type FilterItemsOp = { query: unknown }
      `

      const result = extractOperationsFromSource(source, 'query-ops.ts')
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(2)

      expect(result.operations[0].method).toBe('query')
      expect(result.operations[0].path).toBe('/search')
      expect(result.operations[0].declarationKind).toBe('function')

      expect(result.operations[1].method).toBe('query')
      expect(result.operations[1].path).toBe('/filter')
      expect(result.operations[1].declarationKind).toBe('type-alias')
    })
  })

  describe('Invalid Annotations & Structured Diagnostics', () => {
    it('rejects missing path annotation (empty tag)', () => {
      const source = `
        /** @oaOperation */
        export function emptyAnnotation() {}
      `

      const result = extractOperationsFromSource(source, 'invalid.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.file).toBe('invalid.ts')
      expect(diag.line).toBe(2)
      expect(diag.column).toBe(13)
      expect(diag.severity).toBe('error')
      expect(diag.message).toContain("@oaOperation must have the form '<METHOD> /path'")
    })

    it('rejects missing path with uppercase method (/** @oaOperation GET */)', () => {
      const source = `
        /** @oaOperation GET */
        export function missingPath() {}
      `

      const result = extractOperationsFromSource(source, 'missing-path.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.message).toContain("@oaOperation must have the form '<METHOD> /path'")
    })

    it('rejects lowercase method without format (/** @oaOperation get */)', () => {
      const source = `
        /** @oaOperation get */
        export function lowercaseNoFormat() {}
      `

      const result = extractOperationsFromSource(source, 'lowercase-no-format.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.message).toContain("@oaOperation must have the form '<METHOD> /path'")
    })

    it('rejects path without leading slash (/** @oaOperation GET users */)', () => {
      const source = `
        /** @oaOperation GET users */
        export function noLeadingSlash() {}
      `

      const result = extractOperationsFromSource(source, 'no-leading-slash.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.message).toContain("Path must begin with leading '/': 'users'")
    })

    it('rejects unsupported HTTP methods (/** @oaOperation FOOBAR /users */)', () => {
      const source = `
        /** @oaOperation FOOBAR /users */
        export function unsupportedVerb() {}
      `

      const result = extractOperationsFromSource(source, 'unsupported-verb.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.message).toContain('Unsupported HTTP method: FOOBAR')
    })

    it('rejects malformed path template with unclosed brace', () => {
      const source = `
        /** @oaOperation GET /users/{id */
        export function unclosedBrace() {}
      `

      const result = extractOperationsFromSource(source, 'unclosed.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.message).toContain('unclosed parameter brace')
    })

    it('rejects malformed path template with empty parameter braces', () => {
      const source = `
        /** @oaOperation GET /users/{} */
        export function emptyBrace() {}
      `

      const result = extractOperationsFromSource(source, 'empty-brace.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.message).toContain('empty parameter name')
    })

    it('rejects malformed path template with nested braces', () => {
      const source = `
        /** @oaOperation GET /users/{{id}} */
        export function nestedBrace() {}
      `

      const result = extractOperationsFromSource(source, 'nested.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.message).toContain('nested parameter braces')
    })

    it('rejects malformed path template with unmatched closing brace', () => {
      const source = `
        /** @oaOperation GET /users/id} */
        export function unmatchedClose() {}
      `

      const result = extractOperationsFromSource(source, 'unmatched.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)

      const diag = result.diagnostics[0]
      expect(diag.code).toBe('invalid-oa-operation')
      expect(diag.message).toContain('unmatched closing brace')
    })
  })

  describe('Unannotated Declarations are Strictly Ignored', () => {
    it('strictly ignores exported functions and types without @oaOperation', () => {
      const source = `
        export function helperOne(x: number): number {
          return x * 2
        }

        export async function helperAsync(): Promise<void> {}

        export type UserRecord = {
          id: string
          name: string
        }

        export const CONSTANT_VAL = 42

        function internalHelper() {}
        type InternalType = boolean
      `

      const result = extractOperationsFromSource(source, 'helpers.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operationEntries).toHaveLength(0)
    })

    it('strictly ignores unexported functions even if annotated with @oaOperation', () => {
      const source = `
        /** @oaOperation GET /internal-only */
        function internalSecret() {}

        /** @oaOperation POST /internal-type */
        type InternalSecretOp = { body: string }
      `

      const result = extractOperationsFromSource(source, 'internal.ts')
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(0)
    })
  })

  describe('Mixed Files (Valid, Invalid, Unannotated)', () => {
    it('correctly processes a realistic mixed file', () => {
      const source = `
        export interface UserModel {
          id: string
        }

        /** @oaOperation GET /users */
        export function listUsers(): UserModel[] {
          return []
        }

        export function calculateTax(): number {
          return 0
        }

        /** @oaOperation POST users */
        export function brokenCreateUser() {}

        /** @oaOperation POST /users */
        export type CreateUserOp = {
          body: UserModel
          response: UserModel
        }

        export type OtherHelper = string
      `

      const result = extractOperationsFromSource(source, 'mixed.ts')

      // Exactly 2 valid operations
      expect(result.operations).toHaveLength(2)
      expect(result.operations[0].declarationName).toBe('listUsers')
      expect(result.operations[0].method).toBe('get')
      expect(result.operations[0].path).toBe('/users')

      expect(result.operations[1].declarationName).toBe('CreateUserOp')
      expect(result.operations[1].method).toBe('post')
      expect(result.operations[1].path).toBe('/users')

      // Exactly 1 diagnostic for brokenCreateUser (no leading slash)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0].code).toBe('invalid-oa-operation')
      expect(result.diagnostics[0].message).toContain("Path must begin with leading '/': 'users'")

      // Operation entries match operations
      expect(result.operationEntries).toHaveLength(2)
      expect(toOperationEntry(result.operations[0])).toBe(result.operations[0].operationEntry)
    })
  })

  describe('Multiple @oaOperation tags on one declaration', () => {
    it('extracts multiple operations when a function handles multiple paths', () => {
      const source = `
        /**
         * @oaOperation GET /users
         * @oaOperation GET /members
         */
        export function listAccounts() {}
      `

      const result = extractOperationsFromSource(source, 'multi-routes.ts')
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(2)
      expect(result.operations[0].path).toBe('/users')
      expect(result.operations[1].path).toBe('/members')
    })
  })

  describe('File Extraction (extractOperationsFromFile)', () => {
    it('reads from disk and extracts operations', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'oa-extractor-test-'))
      const filePath = join(tempDir, 'routes.ts')

      try {
        const fileContent = `
          /** @oaOperation GET /api/v1/ping */
          export function ping() { return 'pong' }

          /** @oaOperation QUERY /api/v1/search */
          export type SearchOp = { query: string }
        `
        writeFileSync(filePath, fileContent, 'utf-8')

        const result = extractOperationsFromFile(filePath)
        expect(result.diagnostics).toHaveLength(0)
        expect(result.operations).toHaveLength(2)
        expect(result.operations[0].file).toBe(filePath)
        expect(result.operations[0].path).toBe('/api/v1/ping')
        expect(result.operations[0].method).toBe('get')
        expect(result.operations[1].path).toBe('/api/v1/search')
        expect(result.operations[1].method).toBe('query')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
