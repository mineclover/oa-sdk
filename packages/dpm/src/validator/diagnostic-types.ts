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

export type DpmCatalogCoordinate = {
  table?: string
  column?: string
  columns?: string[]
}

export type DpmRegistryCoordinate = {
  datasetId?: string
  registryVersion?: string
  relationshipName?: string
  relationshipVersion?: string
  status?: string
}

export type DpmDiagnostic = {
  severity: DpmDiagnosticSeverity
  code: DpmDiagnosticCode
  message: string
  sourcePointer: string
  catalogCoordinate?: DpmCatalogCoordinate
  registryCoordinate?: DpmRegistryCoordinate
}

export type DpmValidationSummary = {
  errors: number
  warnings: number
  infos: number
}

export type DpmValidationResult = {
  valid: boolean
  diagnostics: DpmDiagnostic[]
  summary: DpmValidationSummary
}
