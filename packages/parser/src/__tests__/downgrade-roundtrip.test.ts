/**
 * 3.2→3.1 다운그레이드 변환 로직 테스트
 *
 * 실제 downgrade-3.1.ts 스크립트가 아닌, 변환 규칙의 정합성을 검증.
 * 변환 규칙: dataValue→value, serializedValue 제거, schema examples→example
 */
import { describe, it, expect } from 'vitest'

// 다운그레이드 변환 규칙을 직접 테스트 (스크립트 의존 없이)
function downgradeExample(ex: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ex)) {
    if (k === 'dataValue') { result['value'] = v; continue }
    if (k === 'serializedValue') continue // 제거
    result[k] = v
  }
  return result
}

function upgradeExample(ex: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ex)) {
    if (k === 'value' && !('dataValue' in ex)) { result['dataValue'] = v; continue }
    result[k] = v
  }
  return result
}

describe('다운그레이드: Example Object', () => {
  it('dataValue → value', () => {
    const ex = { summary: 'test', dataValue: { status: 'ok' } }
    const result = downgradeExample(ex)
    expect(result['value']).toEqual({ status: 'ok' })
    expect(result['dataValue']).toBeUndefined()
  })

  it('serializedValue 제거', () => {
    const ex = { dataValue: { a: 1 }, serializedValue: '{"a":1}' }
    const result = downgradeExample(ex)
    expect(result['serializedValue']).toBeUndefined()
    expect(result['value']).toEqual({ a: 1 })
  })

  it('summary 보존', () => {
    const ex = { summary: '정상 응답', dataValue: {} }
    const result = downgradeExample(ex)
    expect(result['summary']).toBe('정상 응답')
  })

  it('falsy dataValue (0, false, null) 보존', () => {
    expect(downgradeExample({ dataValue: 0 })['value']).toBe(0)
    expect(downgradeExample({ dataValue: false })['value']).toBe(false)
    expect(downgradeExample({ dataValue: null })['value']).toBe(null)
  })
})

describe('업그레이드: Example Object', () => {
  it('value → dataValue', () => {
    const ex = { summary: 'test', value: { status: 'ok' } }
    const result = upgradeExample(ex)
    expect(result['dataValue']).toEqual({ status: 'ok' })
    expect(result['value']).toBeUndefined()
  })

  it('summary 보존', () => {
    const ex = { summary: '정상', value: {} }
    const result = upgradeExample(ex)
    expect(result['summary']).toBe('정상')
  })
})

describe('라운드트립: Example Object', () => {
  it('dataValue → value → dataValue 무손실', () => {
    const original = { summary: 'test', dataValue: { id: '123', name: 'Alice' } }
    const downgraded = downgradeExample(original)
    const upgraded = upgradeExample(downgraded)
    expect(upgraded['dataValue']).toEqual(original['dataValue'])
    expect(upgraded['summary']).toBe(original['summary'])
  })

  it('falsy 값 라운드트립', () => {
    for (const val of [0, false, null, '']) {
      const d = downgradeExample({ dataValue: val })
      const u = upgradeExample(d)
      expect(u['dataValue']).toBe(val)
    }
  })
})

describe('Schema Object examples 변환', () => {
  it('named map → singular: 첫 번째 값 사용', () => {
    const namedMap = {
      alice: { dataValue: { id: '1', name: 'Alice' } },
      bob: { dataValue: { id: '2', name: 'Bob' } },
    }
    const values = Object.values(namedMap).map(ex => ex['dataValue'])
    const singular = values[0]
    expect(singular).toEqual({ id: '1', name: 'Alice' })
  })

  it('singular → named map 복원 (generic name)', () => {
    const singular = { id: '1', name: 'Alice' }
    const namedMap = { default: { dataValue: singular } }
    expect(namedMap['default']['dataValue']).toEqual(singular)
  })
})
