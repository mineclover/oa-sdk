import { describe, it, expect } from 'vitest'
import { pascalCase, escapeKey, toColonPath } from '../strings.js'

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
})

describe('toColonPath', () => {
  it('/users/{id} → /users/:id', () => expect(toColonPath('/users/{id}')).toBe('/users/:id'))
  it('multiple params', () => expect(toColonPath('/users/{userId}/posts/{postId}')).toBe('/users/:userId/posts/:postId'))
  it('no params', () => expect(toColonPath('/users')).toBe('/users'))
  it('root', () => expect(toColonPath('/')).toBe('/'))
})
