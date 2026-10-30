import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readTableFromFile,
  writeTableToFile,
} from '@oa-sdk/tools'
import { loadCsvOracle, normalizeCsvRecords } from './csv-oracle.js'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempFile(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sdk-document-interop-csv-'))
  tempRoots.push(root)
  return path.join(root, name)
}

describe('tools document interop CSV harness', () => {
  it('keeps the native codec contract for an external-style CSV fixture', () => {
    const input = tempFile('product-export.csv')
    fs.writeFileSync(input, 'id,note\r\n1,"hello\r\nworld"\r\n2,"a""b"\r\n,\r\n')

    const table = readTableFromFile(input)
    expect(table.rowCount).toBe(3)
    expect(table.cells.find(cell => cell.row === 0 && cell.col === 1)?.raw).toBe('hello\nworld')
    expect(table.cells.find(cell => cell.row === 1 && cell.col === 1)?.raw).toBe('a"b')
    expect(table.cells.find(cell => cell.row === 2 && cell.col === 0)?.raw).toBeNull()

    const output = tempFile('patched.csv')
    writeTableToFile(table, output)
    expect(readTableFromFile(output).rowCount).toBe(3)
  })

  it('compares the native roundtrip with the independent CSV oracle when installed', async ({ skip }) => {
    const availability = await loadCsvOracle()
    if (!availability.available || !availability.oracle) {
      skip(availability.reason ?? 'CSV oracle packages are not installed')
      return
    }

    const sourceRecords = [
      ['id', 'note'],
      ['1', 'hello\nworld'],
      ['2', 'a"b'],
      ['', ''],
    ] as const
    const input = tempFile('oracle-input.csv')
    fs.writeFileSync(input, availability.oracle.stringify(sourceRecords))
    const native = readTableFromFile(input)
    const nativeRecords = [
      native.columns.map(column => column.header),
      ...Array.from({ length: native.rowCount }, (_, row) =>
        Array.from({ length: native.colCount }, (_, col) => {
          const cell = native.cells.find(candidate => candidate.row === row && candidate.col === col)
          return cell?.raw ?? null
        }),
      ),
    ]
    expect(normalizeCsvRecords(nativeRecords)).toEqual(availability.oracle.parse(fs.readFileSync(input, 'utf8')))

    const output = tempFile('oracle-output.csv')
    writeTableToFile(native, output)
    expect(availability.oracle.parse(fs.readFileSync(output, 'utf8'))).toEqual(
      availability.oracle.parse(availability.oracle.stringify(sourceRecords)),
    )
  })
})
