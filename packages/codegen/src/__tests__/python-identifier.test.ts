import { describe, expect, it } from 'vitest'
import { pascalCase, pythonIdentifier, snakeCase } from '../python-identifier.js'

describe('python identifier helpers', () => {
  it('sanitizes identifiers, keywords, snake case, and PascalCase', () => {
    expect(pythonIdentifier('from')).toBe('from_')
    expect(pythonIdentifier('2fa-code')).toBe('_2fa_code')
    expect(snakeCase('targetLogicalTime')).toBe('target_logical_time')
    expect(pascalCase('target-logical-time')).toBe('TargetLogicalTime')
  })
})

