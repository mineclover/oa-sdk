/**
 * Zod output must stay byte-identical when its graph helpers and preflight move to `schema-graph`.
 * The golden files were produced by `generateZodFromSpec` BEFORE the extraction; do not update them
 * as part of the extraction.
 */
import { describe, expect, it } from 'vitest'
import { generateZodFromSpec } from '../../zodgen/index.js'
import { PYDANTIC_FIXTURE_NAMES, loadPydanticFixture } from '../../pydantic/__tests__/fixtures.js'

describe('zodgen output parity across the schema-graph extraction', () => {
  for (const name of PYDANTIC_FIXTURE_NAMES.filter(name => name !== 'operations')) {
    it(`${name}: generateZodFromSpec output is unchanged`, async () => {
      const code = generateZodFromSpec(loadPydanticFixture(name))
      await expect(code).toMatchFileSnapshot(`./golden/zod.${name}.ts.snap`)
    })
  }
})
