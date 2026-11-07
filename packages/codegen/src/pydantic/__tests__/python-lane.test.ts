import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPydanticModels } from '../build.js'
import { PYDANTIC_FIXTURE_NAMES, loadPydanticFixture } from './fixtures.js'
import { PYDANTIC_PRESETS, type PydanticBuildOptions, type PydanticPreset } from '../options.js'

type Example = { pyName: string; value: unknown; alias: boolean }
const enabled = process.env.OA_SDK_PYDANTIC_PY_LANE === '1'
const lane = enabled ? describe : describe.skip
const driverPath = join(import.meta.dirname, 'python-lane/check_models.py')
const presets = Object.keys(PYDANTIC_PRESETS) as PydanticPreset[]

const semanticDocument = {
  openapi: '3.2.0', info: { title: 'semantic', version: '1' }, components: { schemas: {
    Person: { type: 'object', required: ['personId'], properties: {
      personId: { type: 'string' }, nickName: { type: 'string' }, note: { type: ['string', 'null'] },
      _meta: { type: 'string' }, from: { type: 'string' }, json: { type: 'string' },
    } },
    Locked: {
      type: 'object', required: ['id'], properties: { id: { type: 'string' } },
      unevaluatedProperties: { not: {} },
    },
    Tags: { type: 'object', required: ['values'], properties: {
      values: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    } },
  } },
}

function runDriver(modulePath: string, payload: unknown): Record<string, number> {
  const payloadPath = join(modulePath, 'payload.json')
  writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`)
  const result = spawnSync('uv', [
    'run', '--no-project', '--with', 'pydantic[email]>=2.11,<3', 'python', driverPath, payloadPath,
  ], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  if (result.error?.message.includes('ENOENT')) throw new Error('uv is required for the Python lane')
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}') as Record<string, number>
}

function examplesFor(
  fixture: ReturnType<typeof loadPydanticFixture>,
  decls: ReturnType<typeof buildPydanticModels>['ir']['decls'],
): Example[] {
  const schemas = fixture.components?.schemas ?? {}
  return decls.flatMap(decl => {
    if (decl.pyName === null) return []
    const schema = schemas[decl.name] as Record<string, unknown> | undefined
    const values = Array.isArray(schema?.examples) ? schema.examples
      : schema?.example === undefined ? [] : [schema.example]
    return values.map(value => ({ pyName: decl.pyName!, value, alias: decl.kind === 'model' }))
  })
}

function modelCases(result: ReturnType<typeof buildPydanticModels>, examples: Example[]) {
  return result.ir.decls.flatMap(decl => {
    const sample = examples.find(example => example.pyName === decl.pyName && example.alias)
    if (decl.kind !== 'model' || sample === undefined || typeof sample.value !== 'object'
      || sample.value === null) return []
    return [{
      pyName: decl.pyName!, value: sample.value,
      fields: decl.fields.map(field => ({ wire: field.wireName, attribute: field.attribute })),
      open: decl.openness.kind === 'open',
    }]
  })
}

function writeModule(result: ReturnType<typeof buildPydanticModels>): string {
  const dir = mkdtempSync(join(tmpdir(), 'oa-sdk-pydantic-'))
  writeFileSync(join(dir, 'models.py'), result.source)
  return dir
}

lane('Pydantic Python lane (set OA_SDK_PYDANTIC_PY_LANE=1 to run)', () => {
  for (const fixtureName of PYDANTIC_FIXTURE_NAMES) {
    for (const preset of presets) {
      it(`${fixtureName}/${preset}`, () => {
        const fixture = loadPydanticFixture(fixtureName)
        const result = buildPydanticModels(fixture, { preset })
        const examples = examplesFor(fixture, result.ir.decls)
        const dir = writeModule(result)
        try {
          const counters = runDriver(dir, {
            module: join(dir, 'models.py'), fixture: fixtureName, options: result.options,
            examples, modelCases: modelCases(result, examples),
          })
          if (fixtureName === 'approved') expect(counters.examples).toBeGreaterThan(0)
          if (fixtureName === 'chunk-stream') expect(counters.taggedUnion).toBe(4)
          expect(spawnSync('uv', [
            'run', '--no-project', '--with', 'ruff', 'ruff', 'check', '--no-cache',
            '--select', 'E,F', '--ignore', 'E501',
            join(dir, 'models.py'),
          ], { encoding: 'utf8' }).status).toBe(0)
        } finally { rmSync(dir, { recursive: true, force: true }) }
      })
    }
  }

  const semanticCases: Array<[string, PydanticBuildOptions, Record<string, number>]> = [
    ['default', {}, {
      omitNickName: 1, rejectNickNameNull: 1, acceptNoteNull: 1, wireInput: 1,
      attributeInput: 1, dumpByAlias: 1, ignoreExtra: 1, lockedReject: 1,
      duplicateReject: 1, uniqueAccept: 1,
    }],
    ['plain', { optionalStyle: 'plain' }, { acceptNickNameNull: 1, acceptNoteNull: 1 }],
    ['allow', { extra: 'allow' }, { allowExtra: 1, lockedReject: 1 }],
    ['forbid', { extra: 'forbid' }, { forbidExtra: 1 }],
    ['preserve', { naming: 'preserve' }, { preserveNames: 3, preserveAliases: 3 }],
  ]
  for (const [name, options, expected] of semanticCases) {
    it(`semantic/${name}`, () => {
      const result = buildPydanticModels(semanticDocument, options)
      const dir = writeModule(result)
      try {
        const actual = runDriver(dir, {
          module: join(dir, 'models.py'), fixture: 'semantic', options: result.options,
          examples: [], modelCases: [], semantic: true,
        })
        expect(actual).toEqual(expected)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  }
})
