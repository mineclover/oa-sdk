import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { diff } from '../cli/commands/diff.js'
import { normalize } from '../cli/commands/normalize.js'
import { CliExitError } from '../cli/lib/errors.js'

/**
 * The contract gate of the enterprise archetype: a baseline `oa-gen normalize` writes, compared by
 * `oa-gen diff --fail-on-breaking` with a spec whose `$ref`s name other files. A breaking change made
 * in such a file must fail the gate whatever fields are written next to the `$ref`.
 */
describe('oa-gen diff of a spec that spans several files against its oa-gen normalize baseline', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-diff-referenced-files-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const write = async (file: string, lines: string[]) => {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await fs.writeFile(path.join(dir, file), [...lines, ''].join('\n'))
  }

  /** Writes the baseline of `openapi.yaml`, as the `baseline:update` script does. */
  const updateBaseline = async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await normalize.run({ spec: path.join(dir, 'openapi.yaml'), output: path.join(dir, 'openapi.baseline.yaml') })
  }

  /** Runs the gate as the `diff` script does, with the report it prints. */
  const gate = async (): Promise<{ failed: boolean; report: string }> => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let failed = false
    try {
      await diff.run({
        base: path.join(dir, 'openapi.baseline.yaml'),
        head: path.join(dir, 'openapi.yaml'),
        'fail-on-breaking': true,
      })
    } catch (error) {
      if (!(error instanceof CliExitError)) throw error
      failed = true
    }
    const report = log.mock.calls.map(call => call.join(' ')).join('\n')
    log.mockRestore()
    return { failed, report }
  }

  const USER_PATH_ITEM = [
    'get:',
    '  operationId: getUser',
    "  responses: { '200': { description: OK, content: { application/json: { schema: { type: object, properties: { id: { type: string } } } } } } }",
    'delete:',
    '  operationId: deleteUser',
    "  responses: { '204': { description: Deleted } }",
  ]
  const CHANGED_USER_PATH_ITEM = [
    'get:',
    '  operationId: getUser',
    "  responses: { '200': { description: OK, content: { application/json: { schema: { type: integer } } } } }",
  ]

  it('fails on a breaking change in the file a Path Item ref names, with path item fields next to the ref', async () => {
    await write('openapi.yaml', [
      'openapi: 3.2.0',
      'info: { title: Users, version: 1.0.0 }',
      'paths:',
      '  /users/{id}:',
      "    $ref: './paths/user.yaml'",
      '    parameters: [{ name: id, in: path, required: true, schema: { type: string } }]',
    ])
    await write('paths/user.yaml', USER_PATH_ITEM)
    await updateBaseline()
    expect(await gate()).toEqual({ failed: false, report: expect.stringContaining('No endpoint or schema changes detected.') })

    await write('paths/user.yaml', CHANGED_USER_PATH_ITEM)
    const { failed, report } = await gate()
    expect(failed).toBe(true)
    expect(report).toContain('`endpoint-removed` `DELETE /users/{id}`')
    expect(report).toContain('`response-schema-changed` `GET /users/{id}`')
  })

  it('fails on a breaking change in a path item the spec names from paths and from components.pathItems', async () => {
    await write('openapi.yaml', [
      'openapi: 3.2.0',
      'info: { title: Users, version: 1.0.0 }',
      'paths:',
      "  /users/{id}: { $ref: './paths/user.yaml' }",
      'components:',
      "  pathItems: { User: { $ref: './paths/user.yaml' } }",
    ])
    await write('paths/user.yaml', USER_PATH_ITEM)
    await updateBaseline()
    expect((await gate()).failed).toBe(false)

    await write('paths/user.yaml', CHANGED_USER_PATH_ITEM)
    const { failed, report } = await gate()
    expect(failed).toBe(true)
    expect(report).toContain('`endpoint-removed` `DELETE /users/{id}`')
    expect(report).toContain('`response-schema-changed` `GET /users/{id}`')
  })

  it('fails on a breaking change in the file a parameter Reference Object names, with fields next to it', async () => {
    await write('openapi.yaml', [
      'openapi: 3.1.0',
      'info: { title: Items, version: 1.0.0 }',
      'paths:',
      '  /items:',
      '    get:',
      '      operationId: listItems',
      "      parameters: [{ $ref: './params.yaml#/Limit', required: true, description: Page size }]",
      "      responses: { '200': { description: OK } }",
    ])
    await write('params.yaml', ['Limit: { name: limit, in: query, schema: { type: integer } }'])
    await updateBaseline()
    expect((await gate()).failed).toBe(false)

    await write('params.yaml', ['Limit: { name: limit, in: query, schema: { type: string } }'])
    const { failed, report } = await gate()
    expect(failed).toBe(true)
    expect(report).toContain('`parameter-schema-changed` `GET /items`')
  })
})
