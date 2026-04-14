import { describe, it, expect } from 'vitest'
import { listFunctions, getFunction } from '../../core/function-registry.js'
import { createMockApplication } from '../fixtures/mock-application.js'

const app = createMockApplication()

describe('listFunctions', () => {
  it('모든 함수의 이름, 설명, 스키마를 반환한다', () => {
    const fns = listFunctions(app)
    expect(fns).toHaveLength(3)
    expect(fns.map((f) => f.name)).toEqual(['createUser', 'getUsers', 'minimal'])
  })

  it('각 함수에 parameters 스키마가 포함된다', () => {
    const fns = listFunctions(app)
    for (const fn of fns) {
      expect(fn.parameters).toBeDefined()
    }
  })

  it('description이 있는 함수는 description이 포함된다', () => {
    const fns = listFunctions(app)
    const createUser = fns.find((f) => f.name === 'createUser')
    expect(createUser?.description).toBe('Create a new user')
  })
})

describe('getFunction', () => {
  it('이름으로 함수를 찾는다', () => {
    const fn = getFunction(app, 'createUser')
    expect(fn).toBeDefined()
    expect(fn?.name).toBe('createUser')
  })

  it('존재하지 않는 이름 → undefined', () => {
    const fn = getFunction(app, 'nonExistent')
    expect(fn).toBeUndefined()
  })
})
