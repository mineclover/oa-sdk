import { describe, it, expect } from 'vitest'
import { formatGeneratedTs } from '../format.js'

describe('formatGeneratedTs', () => {
  it('top-level 문은 인덴트 없음', () => {
    const code = formatGeneratedTs('export type User = string\nexport type Post = number')
    expect(code).toBe('export type User = string\nexport type Post = number')
  })

  it('{ } 블록 내부 인덴트', () => {
    const code = formatGeneratedTs('export type User = {\nid: string\nname: string\n}')
    expect(code).toContain('  id: string')
    expect(code).toContain('  name: string')
  })

  it('중첩 블록', () => {
    const code = formatGeneratedTs('export type User = {\n_meta?: {\noperationId?: string\n}\n}')
    expect(code).toContain('  _meta?: {')
    expect(code).toContain('    operationId?: string')
    expect(code).toContain('  }')
  })

  it('빈 줄 유지', () => {
    const code = formatGeneratedTs('export type A = string\n\nexport type B = number')
    expect(code).toContain('\n\n')
  })

  it('import 문은 항상 레벨 0', () => {
    const code = formatGeneratedTs("import { Hono } from 'hono'\n\nconst app = new Hono()")
    expect(code.startsWith('import')).toBe(true)
  })

  it('커스텀 인덴트', () => {
    const code = formatGeneratedTs('{\na: string\n}', '    ')
    expect(code).toContain('    a: string')
  })

  it('// 주석은 레벨 0', () => {
    const code = formatGeneratedTs('// Auto-generated\nexport type X = string')
    expect(code.startsWith('//')).toBe(true)
  })

  it('같은 줄 { } 쌍 이후 indent 유지', () => {
    const input = 'export type X = {\nfoo: { bar: string }\nbaz: number\n}'
    const result = formatGeneratedTs(input)
    const lines = result.split('\n')
    // foo and baz should have same indent level
    expect(lines[1]).toMatch(/^\s{2}foo/)
    expect(lines[2]).toMatch(/^\s{2}baz/)
  })
})
