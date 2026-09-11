import { describe, it, expect } from 'vitest'
import {
  extractOperationsFromSource,
  buildPathPointer,
  SUPPORTED_HTTP_METHODS,
} from '@oa-sdk/parser'

describe('Tier 1: Zero-Decorator Operation Extraction (Features 8–10)', () => {
  // =========================================================================
  // Feature 8: JSDoc `@oaOperation` Tag Extraction
  // =========================================================================
  describe('F8: JSDoc @oaOperation Tag Extraction', () => {
    it('T1-F8-1: extracts @oaOperation GET /items from exported function declarations', () => {
      const source = [
        '/**',
        ' * List all items in the repository.',
        ' * @oaOperation GET /items',
        ' */',
        'export function listItems(): Promise<string[]> { return Promise.resolve([]); }',
      ].join('\n')

      const result = extractOperationsFromSource(source)
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(1)
      const op = result.operations[0]
      expect(op.method).toBe('get')
      expect(op.path).toBe('/items')
      expect(op.declarationName).toBe('listItems')
      expect(op.declarationKind).toBe('function')
    })

    it('T1-F8-2: extracts @oaOperation POST /items from exported type alias declarations', () => {
      const source = [
        '/**',
        ' * Create a new item bundle.',
        ' * @oaOperation POST /items',
        ' */',
        'export type CreateItemOp = { body: { name: string }; response: { id: string } };',
      ].join('\n')

      const result = extractOperationsFromSource(source)
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(1)
      const op = result.operations[0]
      expect(op.method).toBe('post')
      expect(op.path).toBe('/items')
      expect(op.declarationName).toBe('CreateItemOp')
      expect(op.declarationKind).toBe('type-alias')
    })

    it('T1-F8-3: ignores unannotated exported functions without route guessing heuristics', () => {
      const source = [
        'export function getItemById(id: string): string { return id; }',
        'export function listUsers(): void {}',
        'export function deleteAccount(): void {}',
      ].join('\n')

      const result = extractOperationsFromSource(source)
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(0) // Zero guessed operations!
    })

    it('T1-F8-4: ignores unexported declarations even if annotated with @oaOperation', () => {
      const source = [
        '/**',
        ' * @oaOperation GET /private-items',
        ' */',
        'function privateHandler(): void {}',
      ].join('\n')

      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(0)
    })

    it('T1-F8-5: extracts multi-line JSDoc comment description alongside operation metadata', () => {
      const source = [
        '/**',
        ' * Retrieves comprehensive user profile with permissions.',
        ' * Handles caching internally.',
        ' * @oaOperation GET /users/{id}/profile',
        ' */',
        'export function getUserProfile(): void {}',
      ].join('\n')

      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(1)
      const op = result.operations[0]
      expect(op.path).toBe('/users/{id}/profile')
      expect(op.description).toBeDefined()
    })
  })

  // =========================================================================
  // Feature 9: Operation Syntax & Route Validation
  // =========================================================================
  describe('F9: Operation Syntax & Route Validation', () => {
    it('T1-F9-1: validates all 8 standard HTTP methods (GET, PUT, POST, DELETE, OPTIONS, HEAD, PATCH, TRACE)', () => {
      const methods = ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE']
      for (const method of methods) {
        const source = `
          /** @oaOperation ${method} /resource */
          export function testOp(): void {}
        `
        const result = extractOperationsFromSource(source)
        expect(result.diagnostics).toHaveLength(0)
        expect(result.operations).toHaveLength(1)
        expect(result.operations[0].method).toBe(method.toLowerCase())
      }
    })

    it('T1-F9-2: validates OpenAPI 3.2 QUERY method', () => {
      const source = `
        /** @oaOperation QUERY /search */
        export function searchOp(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.diagnostics).toHaveLength(0)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].method).toBe('query')
      expect(SUPPORTED_HTTP_METHODS.has('query')).toBe(true)
    })

    it('T1-F9-3: rejects malformed tags missing leading slash with invalid-oa-operation diagnostic', () => {
      const source = `
        /** @oaOperation GET users */
        export function listUsers(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0].code).toBe('invalid-oa-operation')
      expect(result.diagnostics[0].message).toContain("must have the form '<METHOD> /path'")
    })

    it('T1-F9-4: rejects unsupported HTTP verbs with informative diagnostic', () => {
      const source = `
        /** @oaOperation CONNECT /tunnel */
        export function tunnelOp(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0].message).toContain('Unsupported HTTP method: CONNECT')
    })

    it('T1-F9-5: supports case-insensitive HTTP method syntax in JSDoc tag', () => {
      const source = `
        /** @oaOperation get /users */
        export function getOp(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].method).toBe('get')
      expect(result.diagnostics).toHaveLength(0)
    })
  })

  // =========================================================================
  // Feature 10: OpenAPI 3.2 Operation Synthesis
  // =========================================================================
  describe('F10: OpenAPI 3.2 Operation Synthesis', () => {
    it('T1-F10-1: synthesizes OpenAPI 3.2 path pointer #/paths/~1items/get for root path', () => {
      const pointer = buildPathPointer('/items', 'GET')
      expect(pointer).toBe('#/paths/~1items/get')
    })

    it('T1-F10-2: encodes path parameters and forward slashes with RFC 6901 escaping', () => {
      const pointer = buildPathPointer('/users/{id}/avatar', 'POST')
      expect(pointer).toBe('#/paths/~1users~1{id}~1avatar/post')
    })

    it('T1-F10-3: escapes tildes in path according to JSON Pointer RFC 6901 specification', () => {
      const pointer = buildPathPointer('/version~1/info', 'GET')
      expect(pointer).toBe('#/paths/~1version~01~1info/get')
    })

    it('T1-F10-4: distinguishes function vs type-alias declaration kinds in operation record', () => {
      const source = [
        '/** @oaOperation GET /users */',
        'export function listUsers(): void {}',
        '/** @oaOperation POST /users */',
        'export type CreateUserOp = {};',
      ].join('\n')

      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(2)
      expect(result.operations[0].declarationKind).toBe('function')
      expect(result.operations[1].declarationKind).toBe('type-alias')
    })

    it('T1-F10-5: provides accurate line and column source coordinates for emitted operations', () => {
      const source = [
        '// Line 1: Header comment',
        '// Line 2: Empty line',
        '/** @oaOperation DELETE /users/{id} */',
        'export function deleteUser(): void {}',
      ].join('\n')

      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(1)
      const op = result.operations[0]
      expect(op.line).toBe(4)
      expect(op.outputPointer).toBe('#/paths/~1users~1{id}/delete')
    })
  })
})
