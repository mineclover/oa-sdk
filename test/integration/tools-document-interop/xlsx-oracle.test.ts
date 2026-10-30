import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compareXlsxInvariants,
  createXlsxInteropFixture,
  inspectWithExcelJs,
  loadExcelJsOracle,
  readXlsxInvariantSnapshot,
  roundTripNativeXlsx,
} from './xlsx-oracle.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempXlsx(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sdk-document-interop-'))
  roots.push(root)
  return path.join(root, 'interop.xlsx')
}

describe('document interop XLSX oracle harness', () => {
  it('preserves native XLSX invariants through an offline no-op roundtrip', () => {
    const filePath = tempXlsx()
    createXlsxInteropFixture(filePath)
    const before = readXlsxInvariantSnapshot(filePath)
    const after = roundTripNativeXlsx(filePath).snapshot
    expect(compareXlsxInvariants(before, after)).toEqual({ passed: true, mismatches: [] })
  })

  it('reports optional ExcelJS availability without making it a production dependency', async () => {
    const result = await loadExcelJsOracle()
    expect(typeof result.available).toBe('boolean')
    if (!result.available) expect(result.reason).toBeTruthy()
    else expect(result.module?.Workbook).toBeTypeOf('function')
  })

  it('uses ExcelJS as an optional semantic oracle when installed', async () => {
    const filePath = tempXlsx()
    createXlsxInteropFixture(filePath)
    const inspection = await inspectWithExcelJs(filePath)
    if (inspection.status === 'skipped') {
      expect(inspection.reason).toBeTruthy()
    } else {
      expect(inspection.sheetNames).toEqual(['Interop'])
      expect(inspection.firstSheetValues).toBeDefined()
    }
  })
})
