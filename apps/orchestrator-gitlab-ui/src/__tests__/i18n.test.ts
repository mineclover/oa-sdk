import { describe, expect, it } from 'vitest'
import { normalizeLocale, translate } from '../i18n/index.js'

describe('i18n', () => {
  it('normalizes supported browser and stored locales', () => {
    expect(normalizeLocale('ko-KR')).toBe('ko')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale(undefined)).toBe('en')
  })

  it('translates route chrome in Korean and English', () => {
    expect(translate('ko', 'route.issues.title')).toBe('이슈')
    expect(translate('en', 'route.issues.title')).toBe('Issues')
  })

  it('translates editor link panel labels in Korean and English', () => {
    expect(translate('ko', 'docs.editorLinkTitle')).toBe('링크 작성')
    expect(translate('en', 'docs.editorLinkTitle')).toBe('Create link')
    expect(translate('ko', 'docs.editorLinkApply')).toBe('링크 적용')
    expect(translate('en', 'docs.editorLinkApply')).toBe('Apply link')
  })

  it('interpolates params in locale strings', () => {
    expect(translate('ko', 'time.minutesAgo', { minutes: 17 })).toBe('17분 전')
    expect(translate('en', 'time.minutesAgo', { minutes: 17 })).toBe('17m ago')
  })
})
