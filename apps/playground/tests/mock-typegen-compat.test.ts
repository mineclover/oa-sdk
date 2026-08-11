/**
 * Private downstream mock generation ↔ public typegen compatibility.
 *
 * This belongs to the playground because it composes independently owned packages.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { generateTypesFromSpec } from '@oa-sdk/codegen/typegen'
import { generateAlgebra } from '@oa-sdk/mock-server'
import { derefSpec, foldSchema, type OasDocument, type OasSchema } from '@oa-sdk/parser'
import { afterAll, describe, expect, it } from 'vitest'

const appDir = resolve(__dirname, '..')
const tscBin = resolve(appDir, 'node_modules/.bin/tsc')
const tmpDir = join(appDir, '.tmp-mock-typegen-compat')

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

const spec = {
  openapi: '3.2.0',
  info: { title: 'Mock Compat', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name', 'role'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'user'] },
          score: { type: 'integer' },
        },
      },
      NewUser: {
        type: 'object',
        required: ['name', 'role'],
        properties: {
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
      ApiError: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
} as unknown as OasDocument

function generatedMocks(): Record<string, unknown> {
  const dereferenced = derefSpec(spec)
  const schemas = (dereferenced.components?.schemas ?? {}) as Record<string, OasSchema>
  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [name, foldSchema(schema, generateAlgebra)]),
  )
}

describe('mock-server ↔ typegen compatibility', () => {
  it('assigns generated mock values to generated TypeScript types', () => {
    mkdirSync(tmpDir, { recursive: true })
    const types = generateTypesFromSpec(spec, { banner: false })
    const usage = Object.entries(generatedMocks())
      .map(([name, value]) => `const mock${name}: ${name} = ${toLiteral(value)}`)
      .join('\n')
    const content = `${types}\n\n${usage}\n`

    writeFileSync(join(tmpDir, 'compat.ts'), content, 'utf8')
    writeFileSync(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
        },
        include: ['compat.ts'],
      }),
      'utf8',
    )

    try {
      execFileSync(tscBin, ['--noEmit'], {
        cwd: tmpDir,
        encoding: 'utf8',
        timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      const commandError = error as { stdout?: string; stderr?: string }
      expect.fail(
        `mock-server response is incompatible with typegen output:\n${commandError.stdout ?? ''}${commandError.stderr ?? ''}\n\n${content}`,
      )
    }
  }, 70_000)

  it('generates required fields without optional fields', () => {
    const user = generatedMocks().User as Record<string, unknown>
    expect(user).toHaveProperty('id')
    expect(user).toHaveProperty('name')
    expect(user).toHaveProperty('role')
    expect(user).not.toHaveProperty('email')
    expect(user).not.toHaveProperty('score')
  })

  it('generates a declared enum value and UUID-shaped format value', () => {
    const user = generatedMocks().User as Record<string, unknown>
    expect(['admin', 'user']).toContain(user.role)
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

function toLiteral(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(toLiteral).join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => `${JSON.stringify(key)}: ${toLiteral(entryValue)}`)
    return `{ ${entries.join(', ')} }`
  }
  return 'undefined'
}
