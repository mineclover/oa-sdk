/** Something that looked like an attack or a misconfiguration; reported, never thrown. */
export type SecurityEvent = {
  type: 'origin-mismatch' | 'source-mismatch' | 'session-mismatch' | 'malformed-message' | 'unauthorized-call' | 'rate-limited'
  origin?: string
  sessionId?: string
  detail?: string
}

export type SecurityListener = (event: SecurityEvent) => void
