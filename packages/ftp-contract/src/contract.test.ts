import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  collectRunEvidenceIssues,
  projectRunEvidenceV1,
  RUN_EVIDENCE_V1_DECLARATION,
  RUN_EVIDENCE_V1_FTP_MAPPING,
  RUN_EVIDENCE_V1_SCHEMA_PATH,
  RUN_EVIDENCE_V1_SCHEMA_SHA256,
  runEvidenceV1Validator,
  type RunEvidenceV1,
} from './index.js'

type Patch = { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }
type DeclarationCase = {
  id: string
  patch: Patch[]
  expected: 'accept' | 'reject'
  at?: string
  keyword?: string
}

const packageFile = (path: string) => new URL(`../${path}`, import.meta.url)
const readJson = (path: string): unknown => JSON.parse(readFileSync(packageFile(path), 'utf8'))
const base = readJson('fixtures/run-evidence.v1/valid-lifecycle.json') as RunEvidenceV1
const table = readJson('fixtures/run-evidence.v1/cases.json') as { declaration: unknown; cases: DeclarationCase[] }

/** Minimal RFC 6902 add/remove/replace over a structured clone. */
function applyPatch(document: unknown, patch: readonly Patch[]): unknown {
  const result = structuredClone(document)
  for (const operation of patch) {
    const segments = operation.path.split('/').slice(1).map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    const key = segments.pop()
    if (key === undefined) throw new Error(`Root patch is unsupported: ${operation.path}`)
    let parent = result as Record<string, unknown>
    for (const segment of segments) parent = parent[segment] as Record<string, unknown>
    if (operation.op === 'remove') delete parent[key]
    else parent[key] = operation.value
  }
  return result
}

describe('RunEvidence v1 declaration identity', () => {
  it('pins the canonical declaration bytes by SHA-256', () => {
    const bytes = readFileSync(packageFile(RUN_EVIDENCE_V1_SCHEMA_PATH))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(RUN_EVIDENCE_V1_SCHEMA_SHA256)
  })

  it('ties the case table and mapping to the same exact declaration', () => {
    expect(table.declaration).toEqual(RUN_EVIDENCE_V1_DECLARATION)
    expect(RUN_EVIDENCE_V1_FTP_MAPPING.declaration).toEqual(RUN_EVIDENCE_V1_DECLARATION)
  })
})

describe('RunEvidence v1 declaration cases', () => {
  for (const testCase of table.cases) {
    it(`${testCase.id} → ${testCase.expected}`, () => {
      const input = applyPatch(base, testCase.patch)
      const result = runEvidenceV1Validator.validate(input)
      if (testCase.expected === 'accept') {
        expect(result).toEqual({ success: true, data: input })
        return
      }
      expect(result.success).toBe(false)
      expect(collectRunEvidenceIssues(input)).toContainEqual(expect.objectContaining({
        instancePath: testCase.at,
        keyword: testCase.keyword,
      }))
    })
  }

  it('rejects non-object inputs with the envelope instead of throwing', () => {
    for (const input of [undefined, null, 1, 'evidence', [], () => base]) {
      const result = runEvidenceV1Validator.validate(input)
      expect(result.success).toBe(false)
      if (!result.success) expect(typeof result.error).toBe('string')
    }
  })
})

/** Every JSON Pointer template the declaration can produce, with `*` for array items. */
function declaredPointers(schema: Record<string, unknown>): string[] {
  const defs = schema.$defs as Record<string, Record<string, unknown>>
  const pointers: string[] = []
  const visit = (node: Record<string, unknown>, pointer: string): void => {
    if (typeof node.$ref === 'string') return visit(defs[node.$ref.replace('#/$defs/', '')]!, pointer)
    if (node.type === 'array') {
      const items = node.items as Record<string, unknown>
      const itemNode = typeof items.$ref === 'string' ? defs[items.$ref.replace('#/$defs/', '')]! : items
      if (itemNode.type !== 'object') pointers.push(`${pointer}/*`)
      return visit(items, `${pointer}/*`)
    }
    for (const [name, child] of Object.entries((node.properties ?? {}) as Record<string, Record<string, unknown>>)) {
      pointers.push(`${pointer}/${name}`)
      visit(child, `${pointer}/${name}`)
    }
  }
  visit(schema, '')
  return pointers
}

describe('RunEvidence v1 → FTP semantic mapping', () => {
  it('maps every declared field exactly once', () => {
    const schema = readJson(RUN_EVIDENCE_V1_SCHEMA_PATH) as Record<string, unknown>
    const mapped = RUN_EVIDENCE_V1_FTP_MAPPING.entries.map(entry => entry.wire)
    expect(new Set(mapped).size).toBe(mapped.length)
    expect([...mapped].sort()).toEqual(declaredPointers(schema).sort())
  })

  it('projects a validated artifact into a detached copy without inventing fields', () => {
    const result = runEvidenceV1Validator.validate(structuredClone(base))
    if (!result.success) throw new Error(result.error)
    const projected = projectRunEvidenceV1(result.data)
    expect(projected).toEqual(base)
    expect(projected).not.toBe(result.data)
    expect(projected.observations[0]!.point).not.toBe(result.data.observations[0]!.point)
    expect(Object.hasOwn(projected, 'retryOfRunId')).toBe(false)
    expect(Object.hasOwn(projected.observations[0]!, 'payload')).toBe(false)
    expect(Object.hasOwn(projected.observations[1]!, 'payload')).toBe(true)
    expect(projected.observations[1]!.payload).toBeNull()
  })
})
