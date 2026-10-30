import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createUnifiedTableIR,
  createZipBuffer,
  planTableIrPatch,
  readTableFromFile,
  readZipBuffer,
  writeTableToFile,
} from './index.js'

const tempRoots: string[] = []
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempFile(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sdk-table-io-regression-'))
  tempRoots.push(root)
  return path.join(root, name)
}

describe('table file I/O external review regressions', () => {
  it('parses RFC 4180 multiline fields, escaped quotes, and empty records', () => {
    const file = tempFile('quoted.csv')
    fs.writeFileSync(file, 'id,note\r\n1,"hello\r\nworld"\r\n2,"a""b"\r\n,\r\n')

    const table = readTableFromFile(file)
    expect(table.rowCount).toBe(3)
    expect(table.cells.find(cell => cell.row === 0 && cell.col === 1)?.raw).toBe('hello\nworld')
    expect(table.cells.find(cell => cell.row === 1 && cell.col === 1)?.raw).toBe('a"b')
    expect(table.cells.find(cell => cell.row === 2 && cell.col === 0)?.raw).toBeNull()

    const roundTrip = tempFile('quoted-roundtrip.csv')
    writeTableToFile(table, roundTrip)
    expect(readTableFromFile(roundTrip).rowCount).toBe(3)
  })

  it('preserves worksheet metadata on a no-op XLSX roundtrip', () => {
    const file = tempFile('metadata.xlsx')
    writeTableToFile(
      createUnifiedTableIR({ adapterKind: 'calc', tableId: 'Original', headers: ['A', 'B'], rows: [[1, null]] }),
      file,
    )
    const entries = readZipBuffer(fs.readFileSync(file))
    entries['xl/worksheets/sheet1.xml'] = Buffer.from(
      entries['xl/worksheets/sheet1.xml']!
        .toString()
        .replace(
          '</worksheet>',
          '<mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells><dataValidations count="1"><dataValidation type="whole" sqref="A2"><formula1>0</formula1></dataValidation></dataValidations></worksheet>',
        ),
    )
    fs.writeFileSync(file, createZipBuffer(entries))

    const original = readTableFromFile(file)
    writeTableToFile(original, file)
    const written = readZipBuffer(fs.readFileSync(file))['xl/worksheets/sheet1.xml']!.toString()
    expect(written).toContain('<mergeCells')
    expect(written).toContain('<dataValidations')
    expect(readTableFromFile(file).fingerprint).toBe(original.fingerprint)
  })

  it('resolves workbook sheet relationships for read and write after sheet reorder', () => {
    const file = tempFile('reordered.xlsx')
    writeTableToFile(
      createUnifiedTableIR({ adapterKind: 'calc', tableId: 'Original', headers: ['A'], rows: [[1]] }),
      file,
    )
    const entries = readZipBuffer(fs.readFileSync(file))
    const firstSheet = entries['xl/worksheets/sheet1.xml']!.toString()
    entries['xl/worksheets/sheet2.xml'] = Buffer.from(
      firstSheet.replace('<c r="A2" t="n">', '<c r="A2" s="3" t="n">').replace('<v>1</v>', '<v>999</v>'),
    )
    entries['[Content_Types].xml'] = Buffer.from(
      entries['[Content_Types].xml']!
        .toString()
        .replace(
          '</Types>',
          '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        ),
    )
    entries['xl/workbook.xml'] = Buffer.from(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="2" r:id="rId2"/><sheet name="Notes" sheetId="1" r:id="rId1"/></sheets></workbook>',
    )
    entries['xl/_rels/workbook.xml.rels'] = Buffer.from(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    )
    fs.writeFileSync(file, createZipBuffer(entries))

    const selected = readTableFromFile(file, { tableIndex: 0 })
    expect(selected.tableId).toBe('Budget')
    expect(selected.cells.find(cell => cell.row === 0 && cell.col === 0)?.raw).toBe(999)

    const changed = planTableIrPatch(selected, [{ op: 'set-cell', row: 0, col: 0, value: 1000 }]).previewIr
    // The writer uses the supplied metadata path, so the selected worksheet is
    // the only part changed even when the workbook's XML order differs.
    writeTableToFile(changed, file)
    const after = readZipBuffer(fs.readFileSync(file))
    expect(after['xl/worksheets/sheet2.xml']!.toString()).toContain('<v>1000</v>')
    expect(after['xl/worksheets/sheet2.xml']!.toString()).toContain('s="3"')
    expect(after['xl/worksheets/sheet1.xml']!.toString()).toContain('<v>1</v>')
  })
})
