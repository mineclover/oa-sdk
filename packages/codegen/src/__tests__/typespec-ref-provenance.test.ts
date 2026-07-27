import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { createTypeSpecCompatibilitySidecarFromEntries } from '../cli/lib/typespec-sidecar.js'
import { buildTypeSpecRefProvenance } from '../cli/lib/typespec-ref-provenance.js'

const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
})

describe('TypeSpec declaration-to-reference provenance', () => {
  it('maps native model and operation declarations to public pointers and $ref sources', () => {
    const sourceRoot = makeSource(`
@operationId("createWidget")
@route("/widgets")
@post
op createWidget(): Widget;

model Widget {
  id: string;
}
`)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({
        paths: {
          '/widgets': {
            post: {
              operationId: 'createWidget',
              responses: {
                '200': {
                  description: 'ok',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } },
                },
              },
            },
          },
        },
        components: { schemas: { Widget: { type: 'object' } } },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report).toMatchObject({
      valid: true,
      counts: { publicPointers: 2, coveredPublicPointers: 2, refNodes: 1, coveredRefNodes: 1 },
    })
    expect(result.artifact.provenanceKind).toBe('typespec-source-ast')
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'emits', outputPointer: '#/components/schemas/Widget' }),
      expect.objectContaining({ kind: 'emits', outputPointer: '#/paths/~1widgets/post' }),
      expect.objectContaining({ kind: 'references', outputPointer: '#/paths/~1widgets/post/responses/200/content/application~1json/schema/$ref', targetRef: '#/components/schemas/Widget' }),
    ]))
  })

  it('attributes restored reusable components to their root extension and rejects an unowned component', () => {
    const sourceRoot = makeSource(`
@extension("x-oa-sdk-components", #{})
namespace Demo;

model Error {
  message: string;
}
`)
    const sidecar = createTypeSpecCompatibilitySidecarFromEntries([{
      kind: 'component-response',
      pointer: '#/x-oa-sdk-components/responses/0',
      target: { name: 'BadRequest' },
      value: {
        description: 'bad',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    }])
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({
        components: {
          schemas: { Error: { type: 'object' } },
          responses: {
            BadRequest: {
              description: 'bad',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      }),
      sidecar,
    })

    expect(result.report.valid).toBe(true)
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'restores', outputPointer: '#/components/responses/BadRequest', restoreFamily: 'x-oa-sdk-components' }),
      expect.objectContaining({ kind: 'references', outputPointer: '#/components/responses/BadRequest/content/application~1json/schema/$ref' }),
    ]))

    const mutated = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({ components: { schemas: { Ghost: { type: 'object' } } } }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })
    expect(mutated.report.valid).toBe(false)
    expect(mutated.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'typespec-provenance/missing-public-owner', pointer: '#/components/schemas/Ghost' }),
    ]))
  })
})

function makeSource(content: string): string {
  const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-ref-provenance-'))
  workspaces.push(workspace)
  writeFileSync(join(workspace, 'main.tsp'), content)
  return workspace
}

function document(value: Record<string, unknown>): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    ...value,
  } as OasDocument
}
