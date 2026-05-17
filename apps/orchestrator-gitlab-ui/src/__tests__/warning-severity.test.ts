import { describe, expect, it } from 'vitest'

import { maxWarningSeverity, warningSeverityFromCode } from '../domain/index.js'

describe('warning severity view model', () => {
  it('maps stable warning codes to UI severity', () => {
    expect(warningSeverityFromCode('request_failed')).toBe('error')
    expect(warningSeverityFromCode('unsupported_kind')).toBe('warning')
    expect(warningSeverityFromCode('unknown')).toBe('info')
  })

  it('keeps the strongest severity', () => {
    expect(maxWarningSeverity('info', 'warning')).toBe('warning')
    expect(maxWarningSeverity('error', 'warning')).toBe('error')
  })
})
