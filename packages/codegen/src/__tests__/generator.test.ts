import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { generateComponents } from '../generator.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `oa-sdk-codegen-test-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('generateComponents — single file (기본)', () => {
  it('components.yaml 생성', () => {
    const schemas = { User: z.object({ id: z.string().uuid(), name: z.string() }) }
    const result = generateComponents(schemas, { output: tmpDir })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatch(/components\.yaml$/)
    expect(existsSync(result.files[0]!)).toBe(true)
  })

  it('YAML 파싱 가능하고 올바른 구조', () => {
    const schemas = { User: z.object({ id: z.string().uuid(), name: z.string() }) }
    generateComponents(schemas, { output: tmpDir })

    const raw = readFileSync(join(tmpDir, 'components.yaml'), 'utf8')
    const parsed = parseYaml(raw) as {
      components: { schemas: Record<string, unknown> }
    }

    expect(parsed.components.schemas).toBeDefined()
    expect(parsed.components.schemas['User']).toBeDefined()
  })

  it('스키마 내용이 올바르게 변환됨', () => {
    const schemas = {
      User: z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100),
        active: z.boolean().default(true),
      }),
    }
    generateComponents(schemas, { output: tmpDir })

    const raw = readFileSync(join(tmpDir, 'components.yaml'), 'utf8')
    const parsed = parseYaml(raw) as {
      components: { schemas: { User: { type: string; properties: Record<string, unknown>; required: string[] } } }
    }

    const user = parsed.components.schemas['User']
    expect(user?.type).toBe('object')
    expect((user?.properties['id'] as { format: string }).format).toBe('uuid')
    expect(user?.required).toContain('id')
    expect(user?.required).toContain('name')
    expect(user?.required).not.toContain('active') // default → not required
  })

  it('커스텀 filename', () => {
    const schemas = { Item: z.object({ id: z.string() }) }
    const result = generateComponents(schemas, { output: tmpDir, filename: 'my-components' })
    expect(result.files[0]).toMatch(/my-components\.yaml$/)
  })

  it('여러 스키마가 하나의 파일에 포함', () => {
    const schemas = {
      User: z.object({ id: z.string() }),
      Post: z.object({ title: z.string() }),
      Comment: z.object({ body: z.string() }),
    }
    generateComponents(schemas, { output: tmpDir })

    const raw = readFileSync(join(tmpDir, 'components.yaml'), 'utf8')
    const parsed = parseYaml(raw) as { components: { schemas: Record<string, unknown> } }

    expect(Object.keys(parsed.components.schemas)).toHaveLength(3)
    expect(parsed.components.schemas['User']).toBeDefined()
    expect(parsed.components.schemas['Post']).toBeDefined()
    expect(parsed.components.schemas['Comment']).toBeDefined()
  })
})

describe('generateComponents — per-schema', () => {
  it('스키마별 별도 파일 생성', () => {
    const schemas = {
      User: z.object({ id: z.string() }),
      Post: z.object({ title: z.string() }),
    }
    const result = generateComponents(schemas, { output: tmpDir, grouping: 'per-schema' })

    expect(result.files).toHaveLength(2)
    expect(result.files.some(f => f.endsWith('user.yaml'))).toBe(true)
    expect(result.files.some(f => f.endsWith('post.yaml'))).toBe(true)
  })

  it('PascalCase → kebab-case 파일명', () => {
    const schemas = { CreateUserRequest: z.object({ name: z.string() }) }
    const result = generateComponents(schemas, { output: tmpDir, grouping: 'per-schema' })
    expect(result.files[0]).toMatch(/create-user-request\.yaml$/)
  })

  it('각 파일이 독립적인 components.schemas 구조', () => {
    const schemas = { User: z.object({ id: z.string() }) }
    generateComponents(schemas, { output: tmpDir, grouping: 'per-schema' })

    const raw = readFileSync(join(tmpDir, 'user.yaml'), 'utf8')
    const parsed = parseYaml(raw) as { components: { schemas: Record<string, unknown> } }
    expect(parsed.components.schemas['User']).toBeDefined()
  })
})

describe('generateComponents — mergeIntoSpec', () => {
  it('새 spec.yaml에 components.schemas 생성', () => {
    const specPath = join(tmpDir, 'spec.yaml')
    const schemas = { User: z.object({ id: z.string().uuid() }) }

    const result = generateComponents(schemas, {
      output: tmpDir,
      mergeIntoSpec: true,
      specPath,
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toBe(specPath)
    expect(existsSync(specPath)).toBe(true)

    const raw = readFileSync(specPath, 'utf8')
    const parsed = parseYaml(raw) as { components: { schemas: Record<string, unknown> } }
    expect(parsed.components.schemas['User']).toBeDefined()
  })

  it('기존 spec.yaml에 병합 (기존 내용 보존)', () => {
    const specPath = join(tmpDir, 'spec.yaml')

    // 기존 spec 작성
    const existingSpec = `
openapi: "3.1.0"
info:
  title: Test
  version: "1.0.0"
paths:
  /health:
    get:
      operationId: health
      responses:
        "200":
          description: OK
components:
  schemas:
    HealthStatus:
      type: object
      properties:
        status:
          type: string
`
    writeFileSync(specPath, existingSpec, 'utf8')

    const schemas = { User: z.object({ id: z.string().uuid() }) }
    generateComponents(schemas, { output: tmpDir, mergeIntoSpec: true, specPath })

    const raw = readFileSync(specPath, 'utf8')
    const parsed = parseYaml(raw) as {
      components: { schemas: Record<string, unknown> }
      paths: Record<string, unknown>
    }

    // 새 스키마 추가
    expect(parsed.components.schemas['User']).toBeDefined()
    // 기존 스키마 보존
    expect(parsed.components.schemas['HealthStatus']).toBeDefined()
    // 기존 paths 보존
    expect(parsed.paths['/health']).toBeDefined()
  })

  it('중복 스키마 덮어쓸 때 warnings 반환', () => {
    const specPath = join(tmpDir, 'spec.yaml')
    writeFileSync(specPath, 'components:\n  schemas:\n    User:\n      type: object\n', 'utf8')

    const schemas = { User: z.object({ id: z.string() }) }
    const result = generateComponents(schemas, { output: tmpDir, mergeIntoSpec: true, specPath })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('User')
  })
})

describe('generateComponents — CodegenResult 구조', () => {
  it('components 메타데이터 반환', () => {
    const schemas = {
      User: z.object({ id: z.string() }),
      Post: z.object({ title: z.string() }),
    }
    const result = generateComponents(schemas, { output: tmpDir })

    expect(result.components).toHaveLength(2)
    const userComp = result.components.find(c => c.name === 'User')
    expect(userComp).toBeDefined()
    expect(userComp?.schema).toBeDefined()
  })

  it('경고 없는 경우 warnings 빈 배열', () => {
    const schemas = { User: z.object({ id: z.string() }) }
    const result = generateComponents(schemas, { output: tmpDir })
    expect(result.warnings).toEqual([])
  })

  it('output 경로 없어도 자동 생성', () => {
    const nestedDir = join(tmpDir, 'a', 'b', 'c')
    const schemas = { User: z.object({ id: z.string() }) }
    expect(() => generateComponents(schemas, { output: nestedDir })).not.toThrow()
    expect(existsSync(nestedDir)).toBe(true)
  })
})

describe('generateComponents — components that share a schema', () => {
  const Id = z.object({ id: z.string() })
  const Pair = z.object({ first: Id, second: Id })
  const idSchema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  const idRef = { $ref: '#/components/schemas/Id' }
  const pairSchema = { type: 'object', properties: { first: idRef, second: idRef }, required: ['first', 'second'] }

  function writtenComponents(schemas: Record<string, z.ZodTypeAny>): Record<string, unknown> {
    generateComponents(schemas, { output: tmpDir })
    const raw = readFileSync(join(tmpDir, 'components.yaml'), 'utf8')
    return (parseYaml(raw) as { components: { schemas: Record<string, unknown> } }).components.schemas
  }

  it('writes a component used inside an earlier component as its own schema, not a self $ref', () => {
    expect(writtenComponents({ Pair, Id })).toEqual({ Pair: pairSchema, Id: idSchema })
  })

  it('writes the same components when the dependency comes first', () => {
    expect(writtenComponents({ Id, Pair })).toEqual({ Id: idSchema, Pair: pairSchema })
  })
})
