import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EVALUATION_V1_DECLARATION, EVALUATION_V1_FTP_MAPPING, EVALUATION_V1_SCHEMA_PATH, EVALUATION_V1_SCHEMA_SHA256, evaluationV1Validator,
  LOCKED_PLAN_V1_DECLARATION, LOCKED_PLAN_V1_FTP_MAPPING, LOCKED_PLAN_V1_SCHEMA_PATH, LOCKED_PLAN_V1_SCHEMA_SHA256, lockedPlanV1Validator,
  TEST_DEFINITION_V1_DECLARATION, TEST_DEFINITION_V1_FTP_MAPPING, TEST_DEFINITION_V1_SCHEMA_PATH, TEST_DEFINITION_V1_SCHEMA_SHA256, testDefinitionV1Validator,
} from './index.js'

const file = (path: string) => new URL(`../${path}`, import.meta.url)
const json = (path: string): unknown => JSON.parse(readFileSync(file(path), 'utf8'))

describe('FTP lifecycle artifact declarations', () => {
  for (const [name, path, expected, ref, mapping] of [
    ['TestDefinition', TEST_DEFINITION_V1_SCHEMA_PATH, TEST_DEFINITION_V1_SCHEMA_SHA256, TEST_DEFINITION_V1_DECLARATION, TEST_DEFINITION_V1_FTP_MAPPING],
    ['LockedPlan', LOCKED_PLAN_V1_SCHEMA_PATH, LOCKED_PLAN_V1_SCHEMA_SHA256, LOCKED_PLAN_V1_DECLARATION, LOCKED_PLAN_V1_FTP_MAPPING],
    ['Evaluation', EVALUATION_V1_SCHEMA_PATH, EVALUATION_V1_SCHEMA_SHA256, EVALUATION_V1_DECLARATION, EVALUATION_V1_FTP_MAPPING],
  ] as const) {
    it(`${name} declaration bytes and mapping identity are pinned`, () => {
      expect(createHash('sha256').update(readFileSync(file(path))).digest('hex')).toBe(expected)
      expect(mapping.declaration).toEqual(ref)
    })
  }

  it('validates the three portable lifecycle fixtures', () => {
    expect(testDefinitionV1Validator.validate(json('fixtures/test-definition.v1/valid.json')).success).toBe(true)
    expect(lockedPlanV1Validator.validate(json('fixtures/locked-plan.v1/valid.json')).success).toBe(true)
    expect(evaluationV1Validator.validate(json('fixtures/evaluation.v1/valid.json')).success).toBe(true)
  })

  it('rejects an unknown field instead of treating it as an extension', () => {
    const input = { ...(json('fixtures/evaluation.v1/valid.json') as Record<string, unknown>), extra: true }
    expect(evaluationV1Validator.validate(input).success).toBe(false)
  })
})
