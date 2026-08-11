import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OasSchema } from '@oa-sdk/parser/browser'
import { describe, expect, it } from 'vitest'
import {
  analyzeSchemaFidelity,
  projectSchemaToTs,
  type TypegenFidelity,
  type TypegenFidelityDiagnosticCode,
} from '../../typegen/schema-fidelity.js'

type FidelityCorpusCase = {
  id: string
  schema: OasSchema
  expectedType: string
  expectedFidelity: TypegenFidelity
  expectedDiagnostics: ReadonlyArray<{
    code: TypegenFidelityDiagnosticCode
    pointer: string
  }>
}

const FIDELITY_CORPUS: readonly FidelityCorpusCase[] = [
  {
    id: 'nested type array',
    schema: {
      type: 'object',
      properties: { value: { type: ['string', 'null'] } },
      required: ['value'],
    },
    expectedType: `{
  value: string | null
}`,
    expectedFidelity: 'exact',
    expectedDiagnostics: [],
  },
  {
    id: 'allOf with structural sibling',
    schema: {
      allOf: [{ $ref: '#/components/schemas/Base' }],
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    expectedType: `({
  id: string
}) & (Base)`,
    expectedFidelity: 'exact',
    expectedDiagnostics: [],
  },
  {
    id: 'oneOf exclusivity',
    schema: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    expectedType: 'string | number',
    expectedFidelity: 'safe-widening',
    expectedDiagnostics: [
      { code: 'typegen/one-of-exclusivity-widened', pointer: '/oneOf' },
    ],
  },
  {
    id: 'single oneOf branch',
    schema: { oneOf: [{ type: 'string' }] },
    expectedType: 'string',
    expectedFidelity: 'exact',
    expectedDiagnostics: [],
  },
  {
    id: 'typed index signature',
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: { type: 'number' },
    },
    expectedType: `{
  id: string
  [key: string]: number | string
}`,
    expectedFidelity: 'safe-widening',
    expectedDiagnostics: [
      { code: 'typegen/index-signature-widened', pointer: '/additionalProperties' },
    ],
  },
  {
    id: 'compatible typed index signature',
    schema: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
      additionalProperties: { type: 'boolean' },
    },
    expectedType: `{
  enabled: boolean
  [key: string]: boolean
}`,
    expectedFidelity: 'exact',
    expectedDiagnostics: [],
  },
  {
    id: 'runtime string constraint',
    schema: {
      type: 'object',
      properties: { value: { type: 'string', format: 'uuid' } },
    },
    expectedType: `{
  /** @format uuid */
  value?: string
}`,
    expectedFidelity: 'runtime-only',
    expectedDiagnostics: [
      { code: 'typegen/runtime-constraint', pointer: '/properties/value/format' },
    ],
  },
  {
    id: 'open prefix tuple',
    schema: { type: 'array', prefixItems: [{ type: 'string' }] },
    expectedType: '[string]',
    expectedFidelity: 'unsafe-narrowing',
    expectedDiagnostics: [
      { code: 'typegen/prefix-items-narrowed', pointer: '/prefixItems' },
    ],
  },
  {
    id: 'ref sibling is ignored as a widening',
    schema: {
      $ref: '#/components/schemas/Base',
      prefixItems: [{ type: 'string' }],
    },
    expectedType: 'Base',
    expectedFidelity: 'safe-widening',
    expectedDiagnostics: [
      { code: 'typegen/ref-siblings-widened', pointer: '/$ref' },
    ],
  },
  {
    id: 'single conditional branch',
    schema: { if: { type: 'string' }, then: { type: 'string' } },
    expectedType: 'string',
    expectedFidelity: 'unsafe-narrowing',
    expectedDiagnostics: [
      { code: 'typegen/conditional-narrowed', pointer: '/if' },
    ],
  },
  {
    id: 'dynamic ref',
    schema: { $dynamicRef: '#node' },
    expectedType: 'unknown',
    expectedFidelity: 'unsupported',
    expectedDiagnostics: [
      { code: 'typegen/unsupported-keyword', pointer: '/$dynamicRef' },
    ],
  },
]

describe('schema fidelity — deterministic corpus', () => {
  for (const corpusCase of FIDELITY_CORPUS) {
    it(corpusCase.id, () => {
      const projection = projectSchemaToTs(corpusCase.schema)

      expect(projection.type).toBe(corpusCase.expectedType)
      expect(projection.fidelity).toBe(corpusCase.expectedFidelity)
      expect(projection.diagnostics.map(({ code, pointer }) => ({ code, pointer })))
        .toEqual(corpusCase.expectedDiagnostics)
    })
  }

  it('sorts diagnostics by escaped JSON Pointer independently of property insertion order', () => {
    const schema: OasSchema = {
      type: 'object',
      properties: {
        z: { type: 'number', minimum: 0 },
        'a/b~c': { type: 'string', format: 'uuid' },
      },
    }

    const first = analyzeSchemaFidelity(schema)
    const second = analyzeSchemaFidelity({
      ...schema,
      properties: Object.fromEntries(Object.entries(schema.properties ?? {}).reverse()),
    })

    expect(first).toEqual(second)
    expect(first.diagnostics.map(diagnostic => diagnostic.pointer)).toEqual([
      '/properties/a~1b~0c/format',
      '/properties/z/minimum',
    ])
  })

  it('emits a mixed object type accepted by the TypeScript checker', () => {
    const projection = projectSchemaToTs({
      type: 'object',
      properties: {
        id: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['id'],
      additionalProperties: { type: 'boolean' },
    })
    const fixture = `
type Mixed = ${projection.type}
const schemaValid: Mixed = { id: 'id', count: 1, enabled: true }
const safeWidening: Mixed = { id: 'id', extra: 'fixed-property-type' }
void schemaValid
void safeWidening
`
    const tempDir = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-fidelity-'))
    const fixturePath = join(tempDir, 'fixture.ts')
    const require = createRequire(import.meta.url)
    const tscBin = require.resolve('typescript/bin/tsc')
    writeFileSync(fixturePath, fixture, 'utf8')

    try {
      expect(() => execFileSync(process.execPath, [
        tscBin,
        '--strict',
        '--exactOptionalPropertyTypes',
        '--noEmit',
        '--skipLibCheck',
        fixturePath,
      ], { encoding: 'utf8', stdio: 'pipe' })).not.toThrow()
    } finally {
      rmSync(tempDir, { recursive: true })
    }
  })
})
