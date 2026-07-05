export type DpmDiagnosticSeverity = 'error' | 'warning' | 'info'

export const DPM_DIAGNOSTIC_CODES = [
  'SYN001',
  'REL001',
  'REL002',
  'REL003',
  'REL004',
  'REL005',
  'REL006',
  'REL007',
  'REL008',
  'REL009',
  'REL010',
  'REL011',
  'REL012',
  'REL013',
  'SAF001',
  'SAF002',
  'SAF003',
  'SAF004',
  'SAF005',
  'SAF006',
  'SAF007',
  'SAF008',
  'SAF009',
  'SAF010',
  'SAF011',
  'SAF012',
] as const

export type DpmDiagnosticCode = typeof DPM_DIAGNOSTIC_CODES[number]
