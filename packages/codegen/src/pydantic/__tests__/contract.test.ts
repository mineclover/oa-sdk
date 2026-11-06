/**
 * Pipeline contract tests. Block prefixes name the implementation phase that must turn them green
 * (docs/internal/architecture/pydantic-codegen-pipeline.md §7). Phase-specific behaviour tests live
 * next to this file; these are the cross-cutting invariants.
 */
import { describe, expect, it } from 'vitest'
import { analyzeSchemaGraph } from '../../schema-graph/index.js'
import {
  PY_PASSES,
  PYDANTIC_PRESETS,
  PYDANTIC_SEMANTIC_OPTION_KEYS,
  buildPydanticModels,
  findUnresolvedPySlots,
  lowerToPyIr,
  preparePydanticDocument,
  pydanticOptionValues,
  resolvePydanticBuildOptions,
  runPyPasses,
  type PyModuleIR,
  type PydanticPreset,
} from '../index.js'
import {
  PYDANTIC_FIXTURE_NAMES,
  goldenPath,
  loadPydanticFixture,
  withReversedSchemas,
  type PydanticFixtureName,
} from './fixtures.js'

const PRESETS = Object.keys(PYDANTIC_PRESETS) as PydanticPreset[]

function lowerFixture(doc: unknown): { ir: PyModuleIR; analysis: ReturnType<typeof analyzeSchemaGraph> } {
  const options = resolvePydanticBuildOptions()
  const prepared = preparePydanticDocument(doc, options.preflight)
  const analysis = analyzeSchemaGraph(prepared.schemas)
  return { ir: lowerToPyIr(prepared, analysis, 'models'), analysis }
}

describe('[S0] resolvePydanticBuildOptions', () => {
  it('applies defaults < preset < explicit options', () => {
    expect(resolvePydanticBuildOptions().extra).toBe('ignore')
    expect(resolvePydanticBuildOptions({ preset: 'strict' }).extra).toBe('forbid')
    expect(resolvePydanticBuildOptions({ preset: 'strict', extra: 'allow' }).extra).toBe('allow')
    expect(resolvePydanticBuildOptions({ preset: 'passthrough' }).naming).toBe('preserve')
  })

  it('rejects unknown presets, option values and non-.py outputs', () => {
    expect(() => resolvePydanticBuildOptions({ preset: 'loose' as PydanticPreset })).toThrow(/preset/)
    expect(() => resolvePydanticBuildOptions({ extra: 'drop' as 'ignore' })).toThrow(/extra/)
    expect(() => resolvePydanticBuildOptions({ output: 'models.ts' })).toThrow(/output/)
  })

  it('returns a frozen object', () => {
    expect(Object.isFrozen(resolvePydanticBuildOptions())).toBe(true)
  })
})

describe('[P1a] S1-S3 data contract', () => {
  for (const name of PYDANTIC_FIXTURE_NAMES) {
    it(`${name}: lowered IR is plain JSON data`, () => {
      const { ir } = lowerFixture(loadPydanticFixture(name))
      expect(JSON.parse(JSON.stringify(ir))).toEqual(ir)
      expect(ir.irVersion).toBe(1)
      expect(ir.decls.length).toBeGreaterThan(0)
    })

    it(`${name}: S3 leaves every decision slot unresolved`, () => {
      const { ir } = lowerFixture(loadPydanticFixture(name))
      expect(ir.imports).toBeNull()
      for (const decl of ir.decls) {
        expect(decl.pyName, decl.name).toBeNull()
        if (decl.kind === 'model') {
          expect(decl.extra, decl.name).toBeNull()
          expect(decl.regexEngine, decl.name).toBeNull()
          for (const field of decl.fields) {
            const slots = [field.attribute, field.alias, field.default, field.rejectExplicitNull]
            expect(slots, `${decl.name}.${field.wireName}`).toEqual([null, null, null, null])
          }
        } else if (decl.kind === 'enum') {
          expect([decl.repr, decl.members], decl.name).toEqual([null, null])
        }
      }
    })

    it(`${name}: analysis and lowered IR do not depend on component order`, () => {
      const forward = lowerFixture(loadPydanticFixture(name))
      const reversed = lowerFixture(withReversedSchemas(loadPydanticFixture(name)))
      expect(reversed.analysis).toEqual(forward.analysis)
      expect(reversed.ir).toEqual(forward.ir)
    })
  }
})

describe('[P1b] S4 pass contract', () => {
  for (const name of PYDANTIC_FIXTURE_NAMES) {
    for (const preset of PRESETS) {
      it(`${name}/${preset}: passes resolve every slot`, () => {
        const { ir, analysis } = lowerFixture(loadPydanticFixture(name))
        const result = runPyPasses(ir, resolvePydanticBuildOptions({ preset }), analysis)
        expect(findUnresolvedPySlots(result.ir)).toEqual([])
        expect(JSON.parse(JSON.stringify(result.ir))).toEqual(result.ir)
      })
    }
  }

  it('every option a pass declares is observable in that pass on some fixture', () => {
    const unobserved: string[] = []
    for (const pass of PY_PASSES) {
      for (const key of pass.reads) {
        const observed = PYDANTIC_FIXTURE_NAMES.some(name => {
          const { ir, analysis } = lowerFixture(loadPydanticFixture(name))
          const before = PY_PASSES.slice(0, PY_PASSES.indexOf(pass)).map(p => p.name)
          const input = runPyPasses(ir, resolvePydanticBuildOptions(), analysis, { only: before }).ir
          const outputs = pydanticOptionValues(key).map(value =>
            runPyPasses(input, resolvePydanticBuildOptions({ [key]: value }), analysis, { only: [pass.name] }).ir)
          return outputs.some(output => JSON.stringify(output) !== JSON.stringify(outputs[0]))
        })
        if (!observed) unobserved.push(`${pass.name}.${key}`)
      }
    }
    expect(unobserved).toEqual([])
  })

  it('every semantic option is read by at least one pass', () => {
    const read = new Set(PY_PASSES.flatMap(pass => pass.reads))
    expect(PYDANTIC_SEMANTIC_OPTION_KEYS.filter(key => !read.has(key))).toEqual([])
  })
})

describe('[P1c] S5-S6 output contract', () => {
  const cases: Array<[PydanticFixtureName, PydanticPreset]> = PYDANTIC_FIXTURE_NAMES.flatMap(name =>
    PRESETS.map(preset => [name, preset] as [PydanticFixtureName, PydanticPreset]))

  for (const [name, preset] of cases) {
    it(`${name}/${preset}: matches golden module`, async () => {
      const result = buildPydanticModels(loadPydanticFixture(name), { preset })
      await expect(result.source).toMatchFileSnapshot(goldenPath(`${name}.${preset}.py`))
    })
  }

  for (const name of PYDANTIC_FIXTURE_NAMES) {
    it(`${name}: output bytes do not depend on component order or repetition`, () => {
      const first = buildPydanticModels(loadPydanticFixture(name))
      const again = buildPydanticModels(loadPydanticFixture(name))
      const reversed = buildPydanticModels(withReversedSchemas(loadPydanticFixture(name)))
      expect(again.source).toBe(first.source)
      expect(reversed.source).toBe(first.source)
      expect(reversed.report.contentSha256).toBe(first.report.contentSha256)
    })
  }

  it('emitIr adds the IR file next to the module', () => {
    const result = buildPydanticModels(loadPydanticFixture('cycles'), { emitIr: true, output: 'pkg/models.py' })
    expect(result.files.map(file => file.path)).toEqual(['pkg/models.py', 'pkg/models.py.ir.json'])
    expect(JSON.parse(result.files[1]!.content)).toEqual(result.ir)
  })
})
