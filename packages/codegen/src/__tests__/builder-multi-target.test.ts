import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { validateOpenApiProjection } from '@oa-sdk/openapi-projection-contract'
import { buildSpec } from '../cli/lib/build-spec.js'
import { generateTypesFromSpec } from '../typegen/generate-types.js'

const pkgDir = resolve(__dirname, '../..')
const repoRoot = resolve(pkgDir, '../..')
const schemasDir = resolve(repoRoot, 'packages/schemas/src')
const fragmentsDir = resolve(schemasDir, 'fragments')

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-builder-multi-target-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('definition builder multi-target API generation', () => {
  it('keeps public, admin, and internal OpenAPI/typegen surfaces separated', () => {
    const outputs = new Map(TARGETS.map(target => {
      const result = buildSpec({
        targetPath: resolve(schemasDir, 'targets', `${target.name}.yaml`),
        fragmentsDir,
        outputPath: join(tmpDir, `${target.name}.yaml`),
      })
      const document = result.document as OasDocument
      const types = generateTypesFromSpec(document)

      expect(result.valid).toBe(true)
      expect(result.summary.errors).toBe(0)
      expect(validateOpenApiProjection(result.projection)).toEqual({ valid: true, diagnostics: [] })
      expect(Object.keys(document.paths ?? {}).sort()).toEqual(target.paths)
      expect(collectOperationIds(document)).toEqual([target.operationId])
      expect(types).toContain(`export type ${target.responseType}`)
      expect(types).toContain(`export type ${target.operationType}`)

      return [target.name, { document, types }] as const
    }))

    for (const target of TARGETS) {
      const output = outputs.get(target.name)
      expect(output).toBeDefined()
      if (!output) continue

      for (const forbiddenOperationId of TARGETS
        .filter(candidate => candidate.name !== target.name)
        .map(candidate => candidate.operationId)) {
        expect(collectOperationIds(output.document)).not.toContain(forbiddenOperationId)
      }

      for (const forbiddenPath of TARGETS
        .filter(candidate => candidate.name !== target.name)
        .flatMap(candidate => candidate.paths)) {
        expect(output.document.paths?.[forbiddenPath]).toBeUndefined()
      }
    }

    expect(outputs.get('public-api')?.types).toContain('A public note attached to a book.')
    expect(outputs.get('public-api')?.types).not.toContain('moderationState')
    expect(outputs.get('admin-api')?.types).toContain('moderationState')
    expect(outputs.get('internal-api')?.types).toContain('Internal health target fixture.')
    expect(outputs.get('internal-api')?.types).not.toContain('BookNote')
  })
})

const TARGETS = [
  {
    name: 'public-api',
    paths: ['/books/{bookId}/notes'],
    operationId: 'listPublicBookNotes',
    responseType: 'ListPublicBookNotesResponse',
    operationType: 'ListPublicBookNotesOp',
  },
  {
    name: 'admin-api',
    paths: ['/admin/books/{bookId}/notes'],
    operationId: 'listAdminBookNotes',
    responseType: 'ListAdminBookNotesResponse',
    operationType: 'ListAdminBookNotesOp',
  },
  {
    name: 'internal-api',
    paths: ['/internal/health'],
    operationId: 'getInternalHealth',
    responseType: 'GetInternalHealthResponse',
    operationType: 'GetInternalHealthOp',
  },
] as const

function collectOperationIds(document: OasDocument): string[] {
  const ids: string[] = []
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const operation of Object.values(pathItem)) {
      if (operation && typeof operation === 'object' && 'operationId' in operation) {
        ids.push(String((operation as { operationId: unknown }).operationId))
      }
    }
  }
  return ids.sort()
}
