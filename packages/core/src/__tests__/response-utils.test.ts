import { describe, it, expect } from 'vitest'
import { pickDefaultStatus } from '../response-utils.js'

describe('pickDefaultStatus', () => {
  // ── 우선순위 1: 정확한 2xx ──────────────────────────────

  it('단일 200 → 200', () => {
    expect(pickDefaultStatus({ '200': {} })).toBe(200)
  })

  it('201 + 200 → 200 (가장 낮은 2xx)', () => {
    expect(pickDefaultStatus({ '201': {}, '200': {} })).toBe(200)
  })

  it('204 단독 → 204', () => {
    expect(pickDefaultStatus({ '204': {} })).toBe(204)
  })

  it('200 + 400 + 500 → 200 (2xx 우선)', () => {
    expect(pickDefaultStatus({ '500': {}, '200': {}, '400': {} })).toBe(200)
  })

  // ── 우선순위 2: 2xx 없으면 가장 낮은 정확한 코드 ─────────

  it('400 + 404 (2xx 없음) → 400', () => {
    expect(pickDefaultStatus({ '404': {}, '400': {} })).toBe(400)
  })

  it('500 단독 → 500', () => {
    expect(pickDefaultStatus({ '500': {} })).toBe(500)
  })

  it('301 + 302 → 301', () => {
    expect(pickDefaultStatus({ '302': {}, '301': {} })).toBe(301)
  })

  // ── 우선순위 3: 범위 코드 2XX ─────────────────────────────

  it('2XX 범위 → 200', () => {
    expect(pickDefaultStatus({ '2XX': {} })).toBe(200)
  })

  it('2XX + 4XX → 200 (2XX 우선)', () => {
    expect(pickDefaultStatus({ '4XX': {}, '2XX': {} })).toBe(200)
  })

  // ── 우선순위 4: 2XX 없는 범위 ─────────────────────────────

  it('4XX 단독 → 400', () => {
    expect(pickDefaultStatus({ '4XX': {} })).toBe(400)
  })

  it('5XX 단독 → 500', () => {
    expect(pickDefaultStatus({ '5XX': {} })).toBe(500)
  })

  it('3XX + 5XX → 300', () => {
    expect(pickDefaultStatus({ '5XX': {}, '3XX': {} })).toBe(300)
  })

  // ── 우선순위 5: default ───────────────────────────────────

  it('default만 → 200', () => {
    expect(pickDefaultStatus({ default: {} })).toBe(200)
  })

  // ── 폴백 ─────────────────────────────────────────────────

  it('빈 responses → 200', () => {
    expect(pickDefaultStatus({})).toBe(200)
  })

  // ── 혼합 ─────────────────────────────────────────────────

  it('정확한 코드가 범위보다 우선', () => {
    expect(pickDefaultStatus({ '2XX': {}, '201': {} })).toBe(201)
  })

  it('정확한 코드가 default보다 우선', () => {
    expect(pickDefaultStatus({ default: {}, '404': {} })).toBe(404)
  })

  it('범위가 default보다 우선', () => {
    expect(pickDefaultStatus({ default: {}, '4XX': {} })).toBe(400)
  })

  it('OAS 범위를 벗어난 status key는 무시한다', () => {
    expect(pickDefaultStatus({ '600': {}, '000': {}, '6XX': {} })).toBe(200)
  })
})
