/**
 * @oa-sdk/tools — 6-Type Document Standard Table Adapter (`UnifiedTableIR`)
 *
 * Implements the canonical intermediate representation and deterministic Phase A (`plan`) /
 * Phase B (`commit`) operations for the 6 document table families:
 * 1. `calc` (Spreadsheets: LibreOffice Calc / XLSX / CSV / GSheets)
 * 2. `writer` (Word Processors: LibreOffice Writer / DOCX / ODT / GDocs)
 * 3. `impress` (Slide Decks: LibreOffice Impress / PPTX / ODP / GSlides)
 * 4. `markdown` (Knowledge Base & Markdown: Obsidian / SiYuan / Joplin / Notion / GFM)
 * 5. `tabular-ops` (Data Cleansing & Relational: OpenRefine / Datasette / DuckDB)
 * 6. `visual-dom` (Diagram & DOM Grids: Draw.io / Mermaid / Browser DOM Tables)
 */
import { randomUUID } from 'node:crypto'
import {
  computeCanonicalSha256,
  type CommandOutcome,
  type HandoffEnvelopeV1,
  type PreviewBundleV1,
  type TwoPhaseMutationHandler,
} from './reserved-interfaces.js'

export type DocumentTableAdapterKind =
  | 'calc'
  | 'writer'
  | 'impress'
  | 'markdown'
  | 'tabular-ops'
  | 'visual-dom'

export const VALID_DOCUMENT_TABLE_ADAPTER_KINDS: ReadonlyArray<DocumentTableAdapterKind> = [
  'calc',
  'writer',
  'impress',
  'markdown',
  'tabular-ops',
  'visual-dom',
]

export interface UnifiedTableCell {
  readonly row: number
  readonly col: number
  readonly raw: string | number | boolean | null
  readonly display: string
  readonly formula?: string | undefined
  readonly dataType: 'string' | 'number' | 'boolean' | 'formula' | 'null'
  readonly rowSpan?: number | undefined
  readonly colSpan?: number | undefined
}

export interface UnifiedTableColumnMeta {
  readonly index: number
  readonly key: string
  readonly header: string
  readonly align?: 'left' | 'center' | 'right' | undefined
}

export interface UnifiedTableIR {
  readonly irVersion: 'unified-table-ir/v1'
  readonly tableId: string
  readonly adapterKind: DocumentTableAdapterKind
  readonly sourceUri: string
  readonly rowCount: number
  readonly colCount: number
  readonly columns: UnifiedTableColumnMeta[]
  readonly cells: UnifiedTableCell[]
  readonly fingerprint: string
  readonly adapterMetadata?: Record<string, unknown> | undefined
}

export type TablePatchOperation =
  | {
      readonly op: 'set-cell'
      readonly row: number
      readonly col: number
      readonly value: string | number | boolean | null
      readonly formula?: string | undefined
    }
  | {
      readonly op: 'append-row'
      readonly values: Array<string | number | boolean | null>
    }
  | {
      readonly op: 'delete-row'
      readonly row: number
    }
  | {
      readonly op: 'rename-column'
      readonly col: number
      readonly header: string
    }

export interface TablePatchPlan {
  readonly tableId: string
  readonly adapterKind: DocumentTableAdapterKind
  readonly beforeFingerprint: string
  readonly afterFingerprint: string
  readonly changedCellCount: number
  readonly operations: TablePatchOperation[]
  readonly previewIr: UnifiedTableIR
  readonly markdownPreview: string
}

/**
 * Commits for a table are serialized in-process even when the surrounding tool
 * does not opt into the file-backed session lock. This closes the gap between
 * the plan snapshot and the commit-time compare-and-swap check below.
 */
const tableCommitLocks = new Map<string, Promise<void>>()

async function withTableCommitLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = tableCommitLocks.get(projectId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  tableCommitLocks.set(projectId, current)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (tableCommitLocks.get(projectId) === current) {
      tableCommitLocks.delete(projectId)
    }
  }
}

function createStaleTablePlanError(plan: TablePatchPlan, current: UnifiedTableIR): Error {
  const error = new Error(
    `Stale table plan for "${plan.tableId}": expected fingerprint ${plan.beforeFingerprint}, ` +
      `but the current table is ${current.fingerprint}`,
  )
  Object.assign(error, {
    code: 'TABLE_PLAN_STALE',
    tableId: plan.tableId,
    expectedFingerprint: plan.beforeFingerprint,
    currentFingerprint: current.fingerprint,
  })
  return error
}

function inferCellDataType(
  raw: string | number | boolean | null,
  formula?: string,
): UnifiedTableCell['dataType'] {
  if (formula) return 'formula'
  if (raw === null) return 'null'
  if (typeof raw === 'number') return 'number'
  if (typeof raw === 'boolean') return 'boolean'
  return 'string'
}

export function computeTableIrFingerprint(
  adapterKind: DocumentTableAdapterKind,
  columns: UnifiedTableColumnMeta[],
  cells: UnifiedTableCell[],
): string {
  const sortedCols = [...columns].sort((a, b) => a.index - b.index)
  const sortedCells = [...cells].sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col))
  return computeCanonicalSha256({
    irVersion: 'unified-table-ir/v1',
    adapterKind,
    columns: sortedCols.map(c => ({
      index: c.index,
      key: c.key,
      header: c.header,
      align: c.align ?? 'left',
    })),
    cells: sortedCells.map(c => ({
      row: c.row,
      col: c.col,
      raw: c.raw,
      formula: c.formula ?? null,
      dataType: c.dataType,
      rowSpan: c.rowSpan ?? 1,
      colSpan: c.colSpan ?? 1,
    })),
  })
}

/**
 * Extracts a 2D array or Markdown table into a canonical `UnifiedTableIR` for any of the 6 adapter kinds.
 */
export function createUnifiedTableIR(params: {
  tableId?: string | undefined
  adapterKind: DocumentTableAdapterKind
  sourceUri?: string | undefined
  headers: string[]
  rows: Array<Array<string | number | boolean | null>>
  formulas?: Record<string, string> | undefined
  adapterMetadata?: Record<string, unknown> | undefined
}): UnifiedTableIR {
  const columns: UnifiedTableColumnMeta[] = params.headers.map((header, index) => ({
    index,
    key: header
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || `col_${index}`,
    header: header.trim(),
    align: 'left',
  }))

  const cells: UnifiedTableCell[] = []
  const rowCount = params.rows.length
  const colCount = columns.length

  for (let r = 0; r < rowCount; r++) {
    const rowValues = params.rows[r] ?? []
    for (let c = 0; c < colCount; c++) {
      const rawVal = rowValues[c] ?? null
      const cellCoord = `${r}:${c}`
      const formula =
        params.formulas?.[cellCoord] ??
        (typeof rawVal === 'string' && rawVal.startsWith('=') ? rawVal : undefined)
      cells.push({
        row: r,
        col: c,
        raw: rawVal,
        display: rawVal === null ? '' : String(rawVal),
        ...(formula ? { formula } : {}),
        dataType: inferCellDataType(rawVal, formula),
      })
    }
  }

  const fingerprint = computeTableIrFingerprint(params.adapterKind, columns, cells)
  return {
    irVersion: 'unified-table-ir/v1',
    tableId: params.tableId ?? `tbl_${params.adapterKind}`,
    adapterKind: params.adapterKind,
    sourceUri: params.sourceUri ?? `memory://${params.adapterKind}/table`,
    rowCount,
    colCount,
    columns,
    cells,
    fingerprint,
    ...(params.adapterMetadata ? { adapterMetadata: params.adapterMetadata } : {}),
  }
}

/**
 * Renders a `UnifiedTableIR` into a deterministic GitHub-Flavored Markdown table.
 */
export function renderTableIrToMarkdown(table: UnifiedTableIR): string {
  const headers = table.columns.map(c => c.header || c.key)
  if (headers.length === 0) return ''
  const sep = table.columns.map(c =>
    c.align === 'center' ? ':---:' : c.align === 'right' ? '---:' : '---',
  )
  const cellLookup = new Map<string, UnifiedTableCell>()
  for (const cell of table.cells) {
    cellLookup.set(`${cell.row}:${cell.col}`, cell)
  }

  const lines: string[] = []
  lines.push(`| ${headers.join(' | ')} |`)
  lines.push(`| ${sep.join(' | ')} |`)
  for (let r = 0; r < table.rowCount; r++) {
    const rowCells: string[] = []
    for (let c = 0; c < table.colCount; c++) {
      const cell = cellLookup.get(`${r}:${c}`)
      rowCells.push((cell?.display ?? '').replace(/\|/g, '\\|'))
    }
    lines.push(`| ${rowCells.join(' | ')} |`)
  }
  return lines.join('\n')
}

/**
 * Phase A (Pure / Idempotent): Computes the deterministic `TablePatchPlan` and `afterFingerprint`
 * without mutating any external store or document.
 */
export function planTableIrPatch(
  table: UnifiedTableIR,
  operations: TablePatchOperation[],
): TablePatchPlan {
  let columns = table.columns.map(c => ({ ...c }))
  const grid: Array<Array<{ raw: string | number | boolean | null; formula?: string }>> = []

  for (let r = 0; r < table.rowCount; r++) {
    const row: Array<{ raw: string | number | boolean | null; formula?: string }> = []
    for (let c = 0; c < table.colCount; c++) {
      row.push({ raw: null })
    }
    grid.push(row)
  }
  for (const cell of table.cells) {
    if (grid[cell.row] && grid[cell.row]![cell.col]) {
      grid[cell.row]![cell.col] = {
        raw: cell.raw,
        ...(cell.formula ? { formula: cell.formula } : {}),
      }
    }
  }

  let changedCellCount = 0

  for (const op of operations) {
    if (op.op === 'set-cell') {
      while (grid.length <= op.row) {
        grid.push(Array.from({ length: columns.length }, () => ({ raw: null })))
      }
      if (op.col >= 0 && op.col < columns.length) {
        grid[op.row]![op.col] = {
          raw: op.value,
          ...(op.formula ? { formula: op.formula } : {}),
        }
        changedCellCount += 1
      }
    } else if (op.op === 'append-row') {
      const newRow = Array.from({ length: columns.length }, (_, idx) => {
        const val = op.values[idx] ?? null
        return {
          raw: val,
          ...(typeof val === 'string' && val.startsWith('=') ? { formula: val } : {}),
        }
      })
      grid.push(newRow)
      changedCellCount += columns.length
    } else if (op.op === 'delete-row') {
      if (op.row >= 0 && op.row < grid.length) {
        grid.splice(op.row, 1)
        changedCellCount += columns.length
      }
    } else if (op.op === 'rename-column') {
      if (op.col >= 0 && op.col < columns.length) {
        const existing = columns[op.col]!
        columns[op.col] = {
          ...existing,
          header: op.header,
          key:
            op.header
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_|_$/g, '') || existing.key,
        }
        changedCellCount += 1
      }
    }
  }

  const nextCells: UnifiedTableCell[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < columns.length; c++) {
      const entry = grid[r]?.[c] ?? { raw: null }
      nextCells.push({
        row: r,
        col: c,
        raw: entry.raw,
        display: entry.raw === null ? '' : String(entry.raw),
        ...(entry.formula ? { formula: entry.formula } : {}),
        dataType: inferCellDataType(entry.raw, entry.formula),
      })
    }
  }

  const afterFingerprint = computeTableIrFingerprint(table.adapterKind, columns, nextCells)
  const previewIr: UnifiedTableIR = {
    irVersion: 'unified-table-ir/v1',
    tableId: table.tableId,
    adapterKind: table.adapterKind,
    sourceUri: table.sourceUri,
    rowCount: grid.length,
    colCount: columns.length,
    columns,
    cells: nextCells,
    fingerprint: afterFingerprint,
    ...(table.adapterMetadata ? { adapterMetadata: table.adapterMetadata } : {}),
  }

  return {
    tableId: table.tableId,
    adapterKind: table.adapterKind,
    beforeFingerprint: table.fingerprint,
    afterFingerprint,
    changedCellCount,
    operations,
    previewIr,
    markdownPreview: renderTableIrToMarkdown(previewIr),
  }
}

/**
 * Creates a reusable 2-Phase (`plan -> commit`) mutation handler for any of the 6 document table adapters,
 * emitting both `preview-bundle/v1` and `cli-anything-handoff-envelope/v1`.
 */
export function createTableApplyTwoPhaseHandler(
  resolveTable: (input: {
    projectId?: string
    adapterKind: DocumentTableAdapterKind
    tableId?: string
    headers?: string[]
    rows?: Array<Array<string | number | boolean | null>>
  }) => Promise<UnifiedTableIR> | UnifiedTableIR,
  onCommit?: (committedTable: UnifiedTableIR, plan: TablePatchPlan) => Promise<void> | void,
): TwoPhaseMutationHandler<
  {
    projectId?: string
    adapterKind: DocumentTableAdapterKind
    tableId?: string
    headers?: string[]
    rows?: Array<Array<string | number | boolean | null>>
    operations: TablePatchOperation[]
  },
  TablePatchPlan,
  {
    table: UnifiedTableIR
    beforeFingerprint: string
    afterFingerprint: string
    changedCellCount: number
    markdownPreview: string
  }
> {
  return {
    async plan(_ctx, input) {
      const baseTable = await resolveTable(input)
      return planTableIrPatch(baseTable, input.operations ?? [])
    },
    async commit(ctx, input, plan): Promise<CommandOutcome<any>> {
      const projectId = input.projectId ?? 'default'
      return withTableCommitLock(projectId, async () => {
        // Plans are computed before confirmation and can sit in a queue while a
        // different commit updates the same table. Re-read under the commit lock
        // and reject stale plans before invoking the mutating callback.
        const currentTable = await resolveTable(input)
        if (
          currentTable.tableId !== plan.tableId ||
          currentTable.adapterKind !== plan.adapterKind ||
          currentTable.fingerprint !== plan.beforeFingerprint
        ) {
          throw createStaleTablePlanError(plan, currentTable)
        }

        if (onCommit) {
          await onCommit(plan.previewIr, plan)
        }

        const previewBundle: PreviewBundleV1 = {
          schemaVersion: 'preview-bundle/v1',
          bundleId: `preview_table_${plan.adapterKind}_${randomUUID().slice(0, 8)}`,
          software: `table-${plan.adapterKind}`,
          recipe: 'apply-ops',
          createdAt: new Date().toISOString(),
          summary: {
            title: `Table Patch Applied (${plan.adapterKind})`,
            status: 'ready',
            highlights: [
              `Changed ${plan.changedCellCount} cells`,
              `Fingerprint: ${plan.beforeFingerprint.slice(0, 19)} -> ${plan.afterFingerprint.slice(0, 19)}`,
            ],
            metrics: {
              rowCount: plan.previewIr.rowCount,
              colCount: plan.previewIr.colCount,
              changedCellCount: plan.changedCellCount,
            },
          },
          artifacts: [
            {
              name: 'table.md',
              kind: 'markdown',
              mimeType: 'text/markdown',
              content: plan.markdownPreview,
              title: 'Markdown Table Preview',
            },
            {
              name: 'table-ir.json',
              kind: 'json',
              mimeType: 'application/json',
              content: JSON.stringify(plan.previewIr, null, 2),
              title: 'UnifiedTableIR v1 Snapshot',
            },
          ],
        }

        const handoffEnvelope: HandoffEnvelopeV1 = {
          schemaVersion: 'cli-anything-handoff-envelope/v1',
          handoffId: `handoff_table_${plan.adapterKind}_${randomUUID().slice(0, 8)}`,
          createdAt: new Date().toISOString(),
          sourceStage: ctx.meta?.surface === 'mcp' ? 'stage-2-mcp' : 'stage-1-cli',
          targetStage: ctx.meta?.surface === 'mcp' ? 'stage-1-cli' : 'stage-2-mcp',
          operationId: 'tableApplyOps',
          projectId,
          projectPath: process.cwd(),
          fingerprint: plan.afterFingerprint,
          status: 'completed',
          summary: `Applied ${plan.operations.length} table operations on ${plan.adapterKind} (${plan.tableId})`,
          previewBundleId: previewBundle.bundleId,
          suggestedNextTools: ['table_extract', 'session_status', 'session_undo'],
          payload: {
            tableId: plan.tableId,
            adapterKind: plan.adapterKind,
            beforeFingerprint: plan.beforeFingerprint,
            afterFingerprint: plan.afterFingerprint,
            table: plan.previewIr,
          },
        }

        return {
          data: {
            table: plan.previewIr,
            beforeFingerprint: plan.beforeFingerprint,
            afterFingerprint: plan.afterFingerprint,
            changedCellCount: plan.changedCellCount,
            markdownPreview: plan.markdownPreview,
          },
          summary: `Applied ${plan.operations.length} ops to ${plan.adapterKind} table "${plan.tableId}" (fingerprint: ${plan.afterFingerprint})`,
          previewBundle,
          handoffEnvelope,
        }
      })
    },
  }
}
