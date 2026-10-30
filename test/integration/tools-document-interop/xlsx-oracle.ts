import fs from 'node:fs'
import path from 'node:path'
import {
  createUnifiedTableIR,
  createZipBuffer,
  readTableFromFile,
  readZipBuffer,
  writeTableToFile,
  type UnifiedTableIR,
} from '@oa-sdk/tools'

export interface ExcelJsWorksheetLike {
  readonly name: string
  readonly getSheetValues?: () => unknown
}

export interface ExcelJsWorkbookLike {
  readonly worksheets: readonly ExcelJsWorksheetLike[]
  readonly addWorksheet: (name: string) => {
    readonly addRow: (values: unknown[]) => unknown
    readonly mergeCells: (range: string) => unknown
    readonly getCell: (address: string) => {
      value: unknown
      style: Record<string, unknown>
      dataValidation: Record<string, unknown>
    }
  }
  readonly xlsx: {
    readonly readFile: (filePath: string) => Promise<void>
    readonly writeFile: (filePath: string) => Promise<void>
  }
}

export interface XlsxOracleModule {
  readonly Workbook: new () => ExcelJsWorkbookLike
}

export interface XlsxOracleAvailability {
  readonly available: boolean
  readonly reason?: string
  readonly module?: XlsxOracleModule
}

export interface XlsxInvariantSnapshot {
  readonly sheetEntryPath: string
  readonly relationshipTarget: string | undefined
  readonly hasMergeCells: boolean
  readonly hasDataValidations: boolean
  readonly styleIds: string[]
  readonly formulaCount: number
  readonly dataFingerprint: string
}

export interface XlsxInvariantComparison {
  readonly passed: boolean
  readonly mismatches: string[]
}

export interface ExcelJsInspection {
  readonly status: 'available' | 'skipped'
  readonly reason?: string
  readonly sheetNames?: string[]
  readonly firstSheetValues?: unknown
}

/**
 * Loads ExcelJS only in the interop harness. The production tools package never
 * imports this module or carries this dependency.
 */
export async function loadExcelJsOracle(): Promise<XlsxOracleAvailability> {
  const moduleName = 'exceljs'
  try {
    const loaded = (await import(moduleName)) as { default?: XlsxOracleModule } & XlsxOracleModule
    const module = loaded.default ?? loaded
    if (typeof module.Workbook !== 'function') {
      return { available: false, reason: 'exceljs did not expose Workbook' }
    }
    return { available: true, module }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function inspectWithExcelJs(filePath: string): Promise<ExcelJsInspection> {
  const oracle = await loadExcelJsOracle()
  if (!oracle.available || !oracle.module) {
    return { status: 'skipped', reason: oracle.reason ?? 'exceljs is unavailable' }
  }
  const workbook = new oracle.module.Workbook()
  await workbook.xlsx.readFile(filePath)
  const firstSheet = workbook.worksheets[0]
  return {
    status: 'available',
    sheetNames: workbook.worksheets.map(sheet => sheet.name),
    ...(firstSheet?.getSheetValues
      ? { firstSheetValues: firstSheet.getSheetValues() }
      : {}),
  }
}

function resolveWorksheetPath(workbookXml: string, relationshipsXml: string, tableIndex = 0): {
  sheetEntryPath: string
  relationshipTarget: string | undefined
} {
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)].map(match => {
    const attrs = match[1] ?? ''
    return {
      relId: attrs.match(/\br:id="([^"]*)"/)?.[1] ?? attrs.match(/\bid="([^"]*)"/)?.[1],
    }
  })
  const relationships = new Map<string, string>()
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = match[1] ?? ''
    const id = attrs.match(/\bId="([^"]*)"/)?.[1]
    const target = attrs.match(/\bTarget="([^"]*)"/)?.[1]
    if (id && target) relationships.set(id, target)
  }
  const relationshipTarget = sheets[tableIndex]?.relId
    ? relationships.get(sheets[tableIndex]!.relId)
    : undefined
  const normalized = relationshipTarget
    ? relationshipTarget.startsWith('/')
      ? relationshipTarget.slice(1)
      : path.posix.normalize(path.posix.join('xl', relationshipTarget))
    : `xl/worksheets/sheet${tableIndex + 1}.xml`
  return { sheetEntryPath: normalized, relationshipTarget }
}

export function readXlsxInvariantSnapshot(filePath: string, tableIndex = 0): XlsxInvariantSnapshot {
  const entries = readZipBuffer(fs.readFileSync(filePath))
  const workbookXml = entries['xl/workbook.xml']?.toString('utf8') ?? ''
  const relationshipsXml = entries['xl/_rels/workbook.xml.rels']?.toString('utf8') ?? ''
  const { sheetEntryPath, relationshipTarget } = resolveWorksheetPath(
    workbookXml,
    relationshipsXml,
    tableIndex,
  )
  const sheetXml = entries[sheetEntryPath]?.toString('utf8') ?? ''
  const table = readTableFromFile(filePath, { tableIndex })
  return {
    sheetEntryPath,
    relationshipTarget,
    hasMergeCells: /<mergeCells\b/.test(sheetXml),
    hasDataValidations: /<dataValidations\b/.test(sheetXml),
    styleIds: [...sheetXml.matchAll(/<c\b[^>]*\bs="([^"]+)"/g)]
      .map(match => match[1]!)
      .sort(),
    formulaCount: [...sheetXml.matchAll(/<f\b/g)].length,
    dataFingerprint: table.fingerprint,
  }
}

export function compareXlsxInvariants(
  before: XlsxInvariantSnapshot,
  after: XlsxInvariantSnapshot,
): XlsxInvariantComparison {
  const mismatches: string[] = []
  if (before.sheetEntryPath !== after.sheetEntryPath) mismatches.push('sheetEntryPath')
  if (before.relationshipTarget !== after.relationshipTarget) mismatches.push('relationshipTarget')
  if (before.hasMergeCells !== after.hasMergeCells) mismatches.push('mergeCells')
  if (before.hasDataValidations !== after.hasDataValidations) mismatches.push('dataValidations')
  if (before.styleIds.join(',') !== after.styleIds.join(',')) mismatches.push('styles')
  if (before.formulaCount !== after.formulaCount) mismatches.push('formulas')
  if (before.dataFingerprint !== after.dataFingerprint) mismatches.push('dataFingerprint')
  return { passed: mismatches.length === 0, mismatches }
}

/** Creates a small native fixture for offline harness tests. */
export function createXlsxInteropFixture(filePath: string): void {
  const table = createUnifiedTableIR({
    adapterKind: 'calc',
    tableId: 'Interop',
    headers: ['Amount', 'Formula'],
    rows: [[42, '=A2*2']],
    formulas: { '0:1': '=A2*2' },
  })
  writeTableToFile(table, filePath)
  const entries = readZipBuffer(fs.readFileSync(filePath))
  const sheetPath = 'xl/worksheets/sheet1.xml'
  const sheetXml = entries[sheetPath]!.toString('utf8')
  entries[sheetPath] = Buffer.from(
    sheetXml.replace(
      '</worksheet>',
      '<mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells>' +
        '<dataValidations count="1"><dataValidation type="whole" sqref="A2"><formula1>0</formula1></dataValidation></dataValidations>' +
        '</worksheet>',
    ),
  )
  fs.writeFileSync(filePath, createZipBuffer(entries))
}

export function roundTripNativeXlsx(filePath: string): {
  readonly table: UnifiedTableIR
  readonly snapshot: XlsxInvariantSnapshot
} {
  const table = readTableFromFile(filePath)
  writeTableToFile(table, filePath)
  return { table, snapshot: readXlsxInvariantSnapshot(filePath) }
}
