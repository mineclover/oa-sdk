import { describe, it, expect } from 'vitest'
import { createOperationTypeNameMap, pascalCase, toTypeScriptIdentifier, escapeKey, toColonPath } from '../strings.js'

describe('pascalCase', () => {
  it('snake_case', () => expect(pascalCase('user_name')).toBe('UserName'))
  it('kebab-case', () => expect(pascalCase('get-users')).toBe('GetUsers'))
  it('space separated', () => expect(pascalCase('hello world')).toBe('HelloWorld'))
  it('single word', () => expect(pascalCase('users')).toBe('Users'))
  it('already PascalCase', () => expect(pascalCase('UserName')).toBe('UserName'))
  it('empty string', () => expect(pascalCase('')).toBe(''))
  it('mixed delimiters', () => expect(pascalCase('get_user-by-id')).toBe('GetUserById'))
  it('operationId style', () => expect(pascalCase('listUsers')).toBe('ListUsers'))
})

describe('escapeKey', () => {
  it('valid identifier', () => expect(escapeKey('name')).toBe('name'))
  it('starts with $', () => expect(escapeKey('$ref')).toBe('$ref'))
  it('starts with _', () => expect(escapeKey('_meta')).toBe('_meta'))
  it('contains hyphen', () => expect(escapeKey('content-type')).toBe("'content-type'"))
  it('contains dot', () => expect(escapeKey('foo.bar')).toBe("'foo.bar'"))
  it('starts with number', () => expect(escapeKey('2xx')).toBe("'2xx'"))
  it('contains space', () => expect(escapeKey('my key')).toBe("'my key'"))
  it("single quote가 포함된 키 이스케이프", () => {
    expect(escapeKey("it's")).toBe("'it\\'s'")
  })
  it('control characters are escaped into a single-line TypeScript literal', () => {
    expect(escapeKey('bad\nkey')).toBe("'bad\\nkey'")
    expect(escapeKey('tab\tkey')).toBe("'tab\\tkey'")
  })
})

describe('toTypeScriptIdentifier', () => {
  it('operationId의 문법상 안전하지 않은 문자를 제거한다', () => {
    expect(toTypeScriptIdentifier('get.user/v1')).toBe('GetUserV1')
  })

  it('숫자로 시작하는 식별자에는 안전한 접두어를 붙인다', () => {
    expect(toTypeScriptIdentifier('2026-users')).toBe('Operation2026Users')
  })
})

describe('createOperationTypeNameMap', () => {
  it('동일한 정규화 결과에는 문서 순서와 무관하게 suffix를 붙인다', () => {
    const names = createOperationTypeNameMap([
      { operationId: 'list_users' },
      { operationId: 'list-users' },
    ])
    const reversed = createOperationTypeNameMap([
      { operationId: 'list-users' },
      { operationId: 'list_users' },
    ])
    expect([...names.entries()]).toEqual([...reversed.entries()])
    expect(new Set(names.values())).toEqual(new Set(['ListUsers', 'ListUsers2']))
  })
})

describe('toColonPath', () => {
  it('/users/{id} → /users/:id', () => expect(toColonPath('/users/{id}')).toBe('/users/:id'))
  it('multiple params', () => expect(toColonPath('/users/{userId}/posts/{postId}')).toBe('/users/:userId/posts/:postId'))
  it('no params', () => expect(toColonPath('/users')).toBe('/users'))
  it('root', () => expect(toColonPath('/')).toBe('/'))
})
