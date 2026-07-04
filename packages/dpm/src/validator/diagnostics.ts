export type DpmDiagnosticSeverity = 'error' | 'warning' | 'info'

export type DpmDiagnosticCode =
  | 'SYN001'
  | 'REL001'
  | 'REL002'
  | 'REL003'
  | 'REL004'
  | 'REL005'
  | 'REL006'
  | 'REL007'
  | 'REL008'
  | 'REL009'
  | 'REL010'
  | 'REL011'
  | 'REL012'
  | 'REL013'
  | 'SAF001'
  | 'SAF002'
  | 'SAF003'
  | 'SAF004'
  | 'SAF005'
  | 'SAF006'
  | 'SAF007'
  | 'SAF008'
  | 'SAF009'
  | 'SAF010'
  | 'SAF011'
  | 'SAF012'

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

export function createDpmDiagnostic(input: DpmDiagnostic): DpmDiagnostic {
  return {
    severity: input.severity,
    code: input.code,
    message: input.message,
    sourcePointer: input.sourcePointer,
    ...(input.catalogCoordinate ? { catalogCoordinate: copyCatalogCoordinate(input.catalogCoordinate) } : {}),
    ...(input.registryCoordinate ? { registryCoordinate: copyRegistryCoordinate(input.registryCoordinate) } : {}),
  }
}

export function summarizeDpmDiagnostics(diagnostics: readonly DpmDiagnostic[]): DpmValidationSummary {
  return {
    errors: diagnostics.filter(diagnostic => diagnostic.severity === 'error').length,
    warnings: diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length,
    infos: diagnostics.filter(diagnostic => diagnostic.severity === 'info').length,
  }
}

export function sortDpmDiagnostics(diagnostics: readonly DpmDiagnostic[]): DpmDiagnostic[] {
  return [...diagnostics].sort((left, right) =>
    `${left.code}.${left.sourcePointer}.${left.message}`.localeCompare(
      `${right.code}.${right.sourcePointer}.${right.message}`,
    ),
  )
}

function copyCatalogCoordinate(coordinate: DpmCatalogCoordinate): DpmCatalogCoordinate {
  return {
    ...(coordinate.table ? { table: coordinate.table } : {}),
    ...(coordinate.column ? { column: coordinate.column } : {}),
    ...(coordinate.columns ? { columns: [...coordinate.columns] } : {}),
  }
}

function copyRegistryCoordinate(coordinate: DpmRegistryCoordinate): DpmRegistryCoordinate {
  return {
    ...(coordinate.datasetId ? { datasetId: coordinate.datasetId } : {}),
    ...(coordinate.registryVersion ? { registryVersion: coordinate.registryVersion } : {}),
    ...(coordinate.relationshipName ? { relationshipName: coordinate.relationshipName } : {}),
    ...(coordinate.relationshipVersion ? { relationshipVersion: coordinate.relationshipVersion } : {}),
    ...(coordinate.status ? { status: coordinate.status } : {}),
  }
}
