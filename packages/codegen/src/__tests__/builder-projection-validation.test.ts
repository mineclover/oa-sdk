import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { validateOpenApiProjection } from '@oa-sdk/openapi-projection-contract'
import { DEFINITION_PROJECTION_COLLISION_REPORT_EXTENSION } from '@oa-sdk/parser'
import { buildSpec } from '../cli/lib/build-spec.js'

const OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
] as const

const pkgDir = resolve(__dirname, '../..')
const repoRoot = resolve(pkgDir, '../..')
const schemasDir = resolve(repoRoot, 'packages/schemas/src')
const fragmentsDir = resolve(schemasDir, 'fragments')

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-builder-projection-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('definition builder projection validation', () => {
  it('adapts existing target builds to valid shared OpenApiProjectionResult envelopes', () => {
    for (const target of targetFixtures()) {
      const result = buildSpec({
        targetPath: resolve(schemasDir, 'targets', `${target.name}.yaml`),
        fragmentsDir,
        outputPath: join(tmpDir, `${target.name}.yaml`),
      })

      expect(result.valid).toBe(true)
      expect(result.summary.errors).toBe(0)
      expect(validateOpenApiProjection(result.projection)).toEqual({
        valid: true,
        diagnostics: [],
      })

      expect(result.projection.profile).toBe('full-api-document')
      expect(Object.keys(result.document.paths ?? {}).sort()).toEqual([...target.paths].sort())
      expect(JSON.stringify(result.document)).not.toContain('oa://')
      assertValidOperations(result.document, target.operationIds)

      expect(result.collisionReport.length).toBeGreaterThan(0)
      expect(result.projection.projection[DEFINITION_PROJECTION_COLLISION_REPORT_EXTENSION])
        .toEqual(result.collisionReport)
    }
  })

  it('rejects invalid emitted documents under the full-api-document profile', () => {
    const result = buildSpec({
      targetPath: resolve(schemasDir, 'targets/public-api.yaml'),
      fragmentsDir,
      outputPath: join(tmpDir, 'public-api.yaml'),
    })

    const validation = validateOpenApiProjection({
      ...result.projection,
      projection: {
        ...result.projection.projection,
        paths: undefined,
      },
    })

    expect(validation.valid).toBe(false)
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'openapi-projection/invalid-document',
      message: 'Projection document must declare a paths object.',
    }))
  })
})

function targetFixtures(): Array<{
  name: string
  paths: string[]
  operationIds: string[]
}> {
  return [
    {
      name: 'public-api',
      paths: ['/books/{bookId}/notes'],
      operationIds: ['listPublicBookNotes'],
    },
    {
      name: 'admin-api',
      paths: ['/admin/books/{bookId}/notes'],
      operationIds: ['listAdminBookNotes'],
    },
    {
      name: 'internal-api',
      paths: ['/internal/health'],
      operationIds: ['getInternalHealth'],
    },
    {
      name: 'book-notebook-api',
      paths: ['/books/{bookId}/notes', '/notebooks/{notebookId}/notes'],
      operationIds: ['listPublicBookNotes', 'listPublicNotebookNotes'],
    },
  ]
}

function assertValidOperations(
  document: { paths?: Record<string, unknown> },
  expectedOperationIds: readonly string[],
): void {
  const seenOperationIds = new Set<string>()
  const actualOperationIds: string[] = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    expect(isRecord(pathItem)).toBe(true)
    if (!isRecord(pathItem)) continue

    const pathParameters = collectInlineParameters(pathItem.parameters)
    const pathParameterNames = new Set([...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!))

    for (const method of OPERATION_METHODS) {
      const operation = pathItem[method]
      if (operation === undefined) continue

      expect(isRecord(operation)).toBe(true)
      if (!isRecord(operation)) continue

      expect(operation.operationId).toEqual(expect.any(String))
      expect(operation.operationId).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/)
      expect(seenOperationIds.has(operation.operationId as string)).toBe(false)
      seenOperationIds.add(operation.operationId as string)
      actualOperationIds.push(operation.operationId as string)

      const operationParameters = [
        ...pathParameters,
        ...collectInlineParameters(operation.parameters),
      ]
      const definedPathParameters = new Map(
        operationParameters
          .filter(parameter => parameter.in === 'path')
          .map(parameter => [parameter.name, parameter]),
      )

      for (const name of pathParameterNames) {
        expect(definedPathParameters.get(name)).toEqual(expect.objectContaining({
          name,
          in: 'path',
          required: true,
        }))
      }

      for (const parameter of definedPathParameters.values()) {
        expect(pathParameterNames.has(parameter.name as string)).toBe(true)
      }
    }
  }

  expect(actualOperationIds.sort()).toEqual([...expectedOperationIds].sort())
}

function collectInlineParameters(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((parameter): parameter is Record<string, unknown> => {
    return isRecord(parameter) && typeof parameter.$ref !== 'string'
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
