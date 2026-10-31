import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  collectEvaluationV1Issues,
  collectLockedPlanV1Issues,
  collectTestDefinitionV1Issues,
  collectTestDefinitionV2Issues,
  EVALUATION_V1_DECLARATION,
  EVALUATION_V1_FTP_MAPPING,
  EVALUATION_V1_SCHEMA_PATH,
  EVALUATION_V1_SCHEMA_SHA256,
  evaluationV1Validator,
  LOCKED_PLAN_V1_DECLARATION,
  LOCKED_PLAN_V1_FTP_MAPPING,
  LOCKED_PLAN_V1_SCHEMA_PATH,
  LOCKED_PLAN_V1_SCHEMA_SHA256,
  lockedPlanV1Validator,
  projectEvaluationV1,
  projectLockedPlanV1,
  projectTestDefinitionV1,
  projectTestDefinitionV2,
  TEST_DEFINITION_V1_DECLARATION,
  TEST_DEFINITION_V1_FTP_MAPPING,
  TEST_DEFINITION_V1_SCHEMA_PATH,
  TEST_DEFINITION_V1_SCHEMA_SHA256,
  TEST_DEFINITION_V2_DECLARATION,
  TEST_DEFINITION_V2_FTP_MAPPING,
  TEST_DEFINITION_V2_SCHEMA_PATH,
  TEST_DEFINITION_V2_SCHEMA_SHA256,
  testDefinitionV1Validator,
  testDefinitionV2Validator,
  type EvaluationV1,
  type LifecycleArtifactIssue,
  type LifecycleMappingEntry,
  type LifecycleValidator,
  type LockedPlanV1,
  type TestDefinitionV1,
  type TestDefinitionV2,
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

/** Every JSON Pointer template the declaration can produce, with `*` for array items. */
function declaredPointers(schema: Record<string, unknown>): string[] {
  const defs = schema.$defs as Record<string, Record<string, unknown>>
  const pointers = new Set<string>()
  const resolve = (node: Record<string, unknown>): Record<string, unknown> =>
    typeof node.$ref === 'string' ? resolve(defs[node.$ref.replace('#/$defs/', '')]!) : node
  const isObjectLike = (node: Record<string, unknown>): boolean => {
    const resolved = resolve(node)
    if (resolved.type === 'object') return true
    if (Array.isArray(resolved.oneOf)) {
      return (resolved.oneOf as Record<string, unknown>[]).every(branch => isObjectLike(branch))
    }
    return false
  }
  const visit = (raw: Record<string, unknown>, pointer: string): void => {
    const node = resolve(raw)
    if (Array.isArray(node.oneOf)) {
      for (const branch of node.oneOf as Record<string, unknown>[]) visit(branch, pointer)
      return
    }
    if (node.type === 'array') {
      const items = node.items as Record<string, unknown>
      if (!isObjectLike(items)) pointers.add(`${pointer}/*`)
      visit(items, `${pointer}/*`)
      return
    }
    for (const [name, child] of Object.entries((node.properties ?? {}) as Record<string, Record<string, unknown>>)) {
      pointers.add(`${pointer}/${name}`)
      visit(child, `${pointer}/${name}`)
    }
  }
  visit(schema, '')
  return [...pointers]
}

interface DeclarationSuiteSpec {
  readonly label: string
  readonly schemaPath: string
  readonly sha256: string
  readonly declaration: unknown
  readonly mapping: { readonly declaration: unknown; readonly entries: readonly LifecycleMappingEntry[] }
  readonly validator: LifecycleValidator<unknown>
  readonly collectIssues: (input: unknown) => LifecycleArtifactIssue[]
  readonly baseFixture: string
  readonly casesFixture: string
}

const SUITES: readonly DeclarationSuiteSpec[] = [
  {
    label: 'TestDefinition v1',
    schemaPath: TEST_DEFINITION_V1_SCHEMA_PATH,
    sha256: TEST_DEFINITION_V1_SCHEMA_SHA256,
    declaration: TEST_DEFINITION_V1_DECLARATION,
    mapping: TEST_DEFINITION_V1_FTP_MAPPING,
    validator: testDefinitionV1Validator,
    collectIssues: collectTestDefinitionV1Issues,
    baseFixture: 'fixtures/test-definition.v1/valid.json',
    casesFixture: 'fixtures/test-definition.v1/cases.json',
  },
  {
    label: 'TestDefinition v2',
    schemaPath: TEST_DEFINITION_V2_SCHEMA_PATH,
    sha256: TEST_DEFINITION_V2_SCHEMA_SHA256,
    declaration: TEST_DEFINITION_V2_DECLARATION,
    mapping: TEST_DEFINITION_V2_FTP_MAPPING,
    validator: testDefinitionV2Validator,
    collectIssues: collectTestDefinitionV2Issues,
    baseFixture: 'fixtures/test-definition.v2/valid.json',
    casesFixture: 'fixtures/test-definition.v2/cases.json',
  },
  {
    label: 'LockedPlan v1',
    schemaPath: LOCKED_PLAN_V1_SCHEMA_PATH,
    sha256: LOCKED_PLAN_V1_SCHEMA_SHA256,
    declaration: LOCKED_PLAN_V1_DECLARATION,
    mapping: LOCKED_PLAN_V1_FTP_MAPPING,
    validator: lockedPlanV1Validator,
    collectIssues: collectLockedPlanV1Issues,
    baseFixture: 'fixtures/locked-plan.v1/valid.json',
    casesFixture: 'fixtures/locked-plan.v1/cases.json',
  },
  {
    label: 'Evaluation v1',
    schemaPath: EVALUATION_V1_SCHEMA_PATH,
    sha256: EVALUATION_V1_SCHEMA_SHA256,
    declaration: EVALUATION_V1_DECLARATION,
    mapping: EVALUATION_V1_FTP_MAPPING,
    validator: evaluationV1Validator,
    collectIssues: collectEvaluationV1Issues,
    baseFixture: 'fixtures/evaluation.v1/valid.json',
    casesFixture: 'fixtures/evaluation.v1/cases.json',
  },
]

for (const suite of SUITES) {
  const base = readJson(suite.baseFixture)
  const table = readJson(suite.casesFixture) as { declaration: unknown; cases: DeclarationCase[] }

  describe(`${suite.label} declaration identity`, () => {
    it('pins the canonical declaration bytes by SHA-256', () => {
      const bytes = readFileSync(packageFile(suite.schemaPath))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(suite.sha256)
    })

    it('ties the case table and mapping to the same exact declaration', () => {
      expect(table.declaration).toEqual(suite.declaration)
      expect(suite.mapping.declaration).toEqual(suite.declaration)
    })

    it('maps every declared field exactly once', () => {
      const schema = readJson(suite.schemaPath) as Record<string, unknown>
      const mapped = suite.mapping.entries.map(entry => entry.wire)
      expect(new Set(mapped).size).toBe(mapped.length)
      expect([...mapped].sort()).toEqual(declaredPointers(schema).sort())
    })
  })

  describe(`${suite.label} declaration cases`, () => {
    for (const testCase of table.cases) {
      it(`${testCase.id} → ${testCase.expected}`, () => {
        const input = applyPatch(base, testCase.patch)
        const result = suite.validator.validate(input)
        if (testCase.expected === 'accept') {
          expect(result).toEqual({ success: true, data: input })
          return
        }
        expect(result.success).toBe(false)
        expect(suite.collectIssues(input)).toContainEqual(
          expect.objectContaining({
            instancePath: testCase.at,
            keyword: testCase.keyword,
          }),
        )
      })
    }

    it('rejects non-object inputs with the envelope instead of throwing', () => {
      for (const input of [undefined, null, 1, 'artifact', [], () => base]) {
        const result = suite.validator.validate(input)
        expect(result.success).toBe(false)
        if (!result.success) expect(typeof result.error).toBe('string')
      }
    })
  })
}

describe('Lifecycle artifact semantic projections', () => {
  it('projects TestDefinition v1 and v2 into detached copies without inventing optional fields', () => {
    const v1Input = readJson('fixtures/test-definition.v1/valid.json') as TestDefinitionV1
    const v1Projected = projectTestDefinitionV1(v1Input)
    expect(v1Projected).toEqual(v1Input)
    expect(v1Projected).not.toBe(v1Input)
    expect(v1Projected.target).not.toBe(v1Input.target)

    const v2Input = readJson('fixtures/test-definition.v2/valid.json') as TestDefinitionV2
    const v2Projected = projectTestDefinitionV2(v2Input)
    expect(v2Projected).toEqual(v2Input)
    expect(v2Projected).not.toBe(v2Input)
    expect(v2Projected.criteria[0]).not.toBe(v2Input.criteria[0])
    expect(v2Projected.criteria[1]).not.toBe(v2Input.criteria[1])
    expect(Object.hasOwn(v2Projected, 'description')).toBe(false)

    const v2WithDesc = projectTestDefinitionV2({ ...v2Input, description: 'authoring note' })
    expect(v2WithDesc.description).toBe('authoring note')
  })

  it('projects LockedPlan v1 with detached AliasRef bindings and deep-cloned JsonValue payloads', () => {
    const base = readJson('fixtures/locked-plan.v1/valid.json') as LockedPlanV1
    const input: LockedPlanV1 = {
      ...base,
      bindings: [
        {
          requested: { kind: 'criterion', scope: 'suite', alias: 'lifecycle' },
          resolved: base.bindings[0]!.resolved,
        },
      ],
    }
    const projected = projectLockedPlanV1(input)
    expect(projected).toEqual(input)
    expect(projected).not.toBe(input)
    expect(projected.bindings[0]!.requested).not.toBe(input.bindings[0]!.requested)
    expect(projected.definitions[0]!.body).not.toBe(input.definitions[0]!.body)
    expect(projected.selection).not.toBe(input.selection)
    expect(projected.closePolicy.normal).not.toBe(input.closePolicy.normal)
  })

  it('projects Evaluation v1 into a detached copy and preserves absent issue optionals', () => {
    const base = readJson('fixtures/evaluation.v1/valid.json') as EvaluationV1
    const input: EvaluationV1 = {
      ...base,
      issues: [
        { code: 'COLLECTOR_LOSS', component: 'collector', message: 'dropped batch' },
        {
          code: 'DUPLICATE_CONFLICT',
          component: 'collector',
          message: 'conflicting payload',
          requestIds: ['request-1'],
          occurrences: [{ sourceId: 'gateway', occurrenceId: 'occ-1' }],
        },
      ],
    }
    const projected = projectEvaluationV1(input)
    expect(projected).toEqual(input)
    expect(projected).not.toBe(input)
    expect(projected.requests[0]!.started).not.toBe(input.requests[0]!.started)
    expect(Object.hasOwn(projected.issues[0]!, 'requestIds')).toBe(false)
    expect(Object.hasOwn(projected.issues[0]!, 'occurrences')).toBe(false)
    expect(projected.issues[1]!.occurrences?.[0]).not.toBe(input.issues[1]!.occurrences?.[0])
  })
})
