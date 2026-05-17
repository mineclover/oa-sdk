import {
  maxWarningSeverity,
  warningSeverityFromCode,
  type NormalizedWarning,
  type WarningSeverity,
} from './warning-severity.js'

export interface RuntimeTokens {
  readonly input: number
  readonly output: number
  readonly total: number
}

export interface RuntimeMetrics {
  readonly inFlight: number
  readonly totalDispatched: number
  readonly totalSucceeded: number
  readonly totalFailed: number
  readonly totalCancelled: number
  readonly tokens: RuntimeTokens
}

export interface RuntimeErrorInfo {
  readonly msg: string
  readonly at: number
}

export interface RuntimeInFlightSnapshot {
  readonly issueId: string
  readonly issueIid: string
  readonly title: string
  readonly url: string
  readonly agent: string
  readonly turnNumber: number
  readonly attempt: number
  readonly startedAt: number
  readonly elapsedMs: number
  readonly lastTurnStatus: string | undefined
}

export interface RuntimeSnapshot {
  readonly startedAt: number
  readonly uptimeMs: number
  readonly shuttingDown: boolean
  readonly inFlight: ReadonlyArray<RuntimeInFlightSnapshot>
  readonly metrics: Readonly<RuntimeMetrics>
  readonly lastError: RuntimeErrorInfo | undefined
  readonly reloadCount: number
  readonly lastReloadError: RuntimeErrorInfo | undefined
}

export type RuntimeState = 'stopped' | 'running' | 'idle' | 'stopping'

export interface RuntimeSummaryIssue {
  readonly issueId: string
  readonly issueIid: string
  readonly title: string
  readonly agent: string
  readonly ageMs: number
  readonly turnNumber: number
  readonly attempt: number
  readonly lastTurnStatus: string | undefined
  readonly url: string
}

export interface RuntimeSummary {
  readonly state: RuntimeState
  readonly health: WarningSeverity
  readonly summary: string
  readonly inFlightCount: number
  readonly topInFlight: ReadonlyArray<RuntimeSummaryIssue>
  readonly totals: {
    readonly dispatched: number
    readonly succeeded: number
    readonly failed: number
    readonly cancelled: number
  }
  readonly warnings: ReadonlyArray<NormalizedWarning>
  readonly tokens: RuntimeTokens
}

export interface RuntimeSummaryOptions {
  readonly now?: number
  readonly topInFlightLimit?: number
}

export function buildRuntimeSummary(
  snapshot: RuntimeSnapshot,
  options: RuntimeSummaryOptions = {},
): RuntimeSummary {
  const now = options.now ?? Date.now()
  const topInFlightLimit = options.topInFlightLimit ?? 5
  const warnings = buildRuntimeWarnings(snapshot)
  const health = warnings
    .map((warning) => warning.severity)
    .reduce((acc, severity) => maxWarningSeverity(acc, severity), 'info' as WarningSeverity)

  const topInFlight = snapshot.inFlight
    .map((item) => runtimeSummaryIssue(item, now))
    .sort((left, right) => right.ageMs - left.ageMs)
    .slice(0, topInFlightLimit)

  return {
    state: deriveRuntimeState(snapshot),
    health,
    summary: `${snapshot.inFlight.length} in-flight issue(s); ${topInFlight.length} shown`,
    inFlightCount: snapshot.inFlight.length,
    topInFlight,
    totals: {
      dispatched: snapshot.metrics.totalDispatched,
      succeeded: snapshot.metrics.totalSucceeded,
      failed: snapshot.metrics.totalFailed,
      cancelled: snapshot.metrics.totalCancelled,
    },
    warnings,
    tokens: { ...snapshot.metrics.tokens },
  }
}

export function runtimeSummaryIssue(
  inFlight: RuntimeInFlightSnapshot,
  now: number,
): RuntimeSummaryIssue {
  return {
    issueId: inFlight.issueId,
    issueIid: inFlight.issueIid,
    title: inFlight.title,
    agent: inFlight.agent,
    ageMs: Math.max(0, now - inFlight.startedAt),
    turnNumber: inFlight.turnNumber,
    attempt: inFlight.attempt,
    lastTurnStatus: inFlight.lastTurnStatus,
    url: inFlight.url,
  }
}

export function deriveRuntimeState(snapshot: RuntimeSnapshot): RuntimeState {
  if (snapshot.shuttingDown) return 'stopping'
  if (snapshot.startedAt <= 0) return 'stopped'
  if (snapshot.inFlight.length > 0) return 'running'
  return 'idle'
}

function buildRuntimeWarnings(snapshot: RuntimeSnapshot): NormalizedWarning[] {
  const warnings: NormalizedWarning[] = []
  if (snapshot.lastError !== undefined) {
    warnings.push({
      kind: 'runtime',
      code: 'runtime_error',
      message: snapshot.lastError.msg,
      severity: warningSeverityFromCode('runtime_error'),
    })
  }
  if (snapshot.lastReloadError !== undefined) {
    warnings.push({
      kind: 'runtime',
      code: 'runtime_reload_error',
      message: snapshot.lastReloadError.msg,
      severity: warningSeverityFromCode('runtime_reload_error'),
    })
  }
  return warnings
}
