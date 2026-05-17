export type WarningSeverity = 'info' | 'warning' | 'error'

export interface NormalizedWarning {
  readonly kind: string
  readonly code: string
  readonly message: string
  readonly severity: WarningSeverity
  readonly status?: number | undefined
}

const ORDER: Record<WarningSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
}

export function warningSeverityFromCode(code: string): WarningSeverity {
  if (code === 'request_failed' || code === 'runtime_error' || code === 'runtime_reload_error') {
    return 'error'
  }
  if (code === 'unsupported_kind') return 'warning'
  return 'info'
}

export function maxWarningSeverity(left: WarningSeverity, right: WarningSeverity): WarningSeverity {
  return ORDER[left] >= ORDER[right] ? left : right
}

export function warningSeverityClass(severity: WarningSeverity): string {
  if (severity === 'error') return 'badge badge-critical'
  if (severity === 'warning') return 'badge badge-warning'
  return 'badge badge-info'
}
