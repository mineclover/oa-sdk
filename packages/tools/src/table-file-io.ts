/**
 * @oa-sdk/tools — 6-Type Document Standard Table Real File I/O Engine
 *
 * Provides zero-dependency deterministic file reading and writing for all 6 `UnifiedTableIR`
 * adapter families using Node.js built-ins (`node:fs`, `node:zlib`):
 * 1. `calc`: `.xlsx` (OOXML SpreadsheetML ZIP) & `.calc.json`
 * 2. `writer`: `.docx` (OOXML WordprocessingML `<w:tbl>` ZIP) & `.writer.json`
 * 3. `impress`: `.pptx` (OOXML PresentationML `<a:tbl>` ZIP) & `.impress.json`
 * 4. `markdown`: `.md` (GitHub-Flavored Markdown table with surrounding document preservation)
 * 5. `tabular-ops`: `.csv` / `.tsv` (RFC 4180 CSV & TSV)
 * 6. `visual-dom`: `.html` / `.svg` (HTML `<table>` DOM with `data-formula` & surrounding HTML preservation)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import {
  createUnifiedTableIR,
  renderTableIrToMarkdown,
  type DocumentTableAdapterKind,
  type UnifiedTableCell,
  type UnifiedTableIR,
} from './table-ir.js'

// ── Minimal Deterministic ZIP Reader / Writer (Pure Node `node:zlib`) ───────

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function createZipBuffer(entries: Record<string, string | Buffer>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const names = Object.keys(entries).sort()

  for (const name of names) {
    const rawData = Buffer.isBuffer(entries[name])
      ? (entries[name] as Buffer)
      : Buffer.from(String(entries[name]), 'utf8')
    const compressed = zlib.deflateRawSync(rawData)
    const crc = crc32(rawData)
    const nameBuf = Buffer.from(name, 'utf8')

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed
    localHeader.writeUInt16LE(0, 6) // flags
    localHeader.writeUInt16LE(8, 8) // method: deflate
    localHeader.writeUInt16LE(0, 10) // mod time
    localHeader.writeUInt16LE(0x21, 12) // mod date
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(rawData.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuf, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0x21, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(rawData.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, nameBuf)
    offset += localHeader.length + nameBuf.length + compressed.length
  }

  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(names.length, 8)
  eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDir, eocd])
}

export function readZipBuffer(zipBuf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {}
  let eocdOffset = -1
  for (let i = zipBuf.length - 22; i >= 0; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP archive: End of Central Directory not found')
  }
  const entryCount = zipBuf.readUInt16LE(eocdOffset + 8)
  let cdOffset = zipBuf.readUInt32LE(eocdOffset + 16)

  for (let i = 0; i < entryCount; i++) {
    if (zipBuf.readUInt32LE(cdOffset) !== 0x02014b50) break
    const method = zipBuf.readUInt16LE(cdOffset + 10)
    const compressedSize = zipBuf.readUInt32LE(cdOffset + 20)
    const nameLen = zipBuf.readUInt16LE(cdOffset + 28)
    const extraLen = zipBuf.readUInt16LE(cdOffset + 30)
    const commentLen = zipBuf.readUInt16LE(cdOffset + 32)
    const localHeaderOffset = zipBuf.readUInt32LE(cdOffset + 42)
    const name = zipBuf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8')

    const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26)
    const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
    const rawSlice = zipBuf.subarray(dataStart, dataStart + compressedSize)

    if (method === 0) {
      out[name] = Buffer.from(rawSlice)
    } else if (method === 8) {
      out[name] = zlib.inflateRawSync(rawSlice)
    }
    cdOffset += 46 + nameLen + extraLen + commentLen
  }
  return out
}

// ── XML & Cell Helpers ──────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function colIndexToLetter(col: number): string {
  let n = col + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function colLetterToIndex(letters: string): number {
  let n = 0
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64)
  }
  return n - 1
}

function parseScalarValue(rawText: string): string | number | boolean | null {
  const trimmed = rawText.trim()
  if (trimmed === '') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return rawText
}

function buildGridFromIr(table: UnifiedTableIR): {
  headers: string[]
  rows: Array<Array<string | number | boolean | null>>
  formulas: Record<string, string>
} {
  const headers = table.columns.map(c => c.header || c.key)
  const rows: Array<Array<string | number | boolean | null>> = Array.from(
    { length: table.rowCount },
    () => Array.from({ length: table.colCount }, () => null),
  )
  const formulas: Record<string, string> = {}
  for (const cell of table.cells) {
    if (rows[cell.row] && cell.col < table.colCount) {
      rows[cell.row]![cell.col] = cell.formula ?? cell.raw
      if (cell.formula) {
        formulas[`${cell.row}:${cell.col}`] = cell.formula
      }
    }
  }
  return { headers, rows, formulas }
}

// ── 1. `calc` Adapter (.xlsx OOXML) ─────────────────────────────────────────

function writeXlsxBuffer(table: UnifiedTableIR): Buffer {
  const { headers, rows, formulas } = buildGridFromIr(table)
  const allRows: Array<Array<string | number | boolean | null>> = [headers, ...rows]
  const sheetRowsXml: string[] = []
  const meta = table.adapterMetadata as
    | {
        xlsxEntriesBase64?: Record<string, string>
        sheetEntryPath?: string
        tableIndex?: number
        originalFingerprint?: string
      }
    | undefined
  const originalCellStyles = new Map<string, string>()
  if (meta?.xlsxEntriesBase64 && typeof meta.xlsxEntriesBase64 === 'object') {
    const targetSheetPath =
      meta.sheetEntryPath || `xl/worksheets/sheet${(meta.tableIndex ?? 0) + 1}.xml`
    const originalSheet = meta.xlsxEntriesBase64[targetSheetPath]
    if (originalSheet) {
      const xml = Buffer.from(originalSheet, 'base64').toString('utf8')
      for (const match of xml.matchAll(/<c\b([^>]*)>/g)) {
        const attrs = match[1] ?? ''
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
        const style = attrs.match(/\bs="([^"]+)"/)?.[1]
        if (ref && style) originalCellStyles.set(ref, style)
      }
    }
  }

  for (let r = 0; r < allRows.length; r++) {
    const rowVals = allRows[r] ?? []
    const cellsXml: string[] = []
    for (let c = 0; c < headers.length; c++) {
      const ref = `${colIndexToLetter(c)}${r + 1}`
      const val = rowVals[c] ?? null
      const formula = r > 0 ? formulas[`${r - 1}:${c}`] : undefined
      const style = originalCellStyles.get(ref)
      const styleAttr = style ? ` s="${escapeXml(style)}"` : ''
      if (formula) {
        const cleanFormula = formula.startsWith('=') ? formula.slice(1) : formula
        cellsXml.push(`<c r="${ref}"${styleAttr}><f>${escapeXml(cleanFormula)}</f></c>`)
      } else if (typeof val === 'number') {
        cellsXml.push(`<c r="${ref}"${styleAttr} t="n"><v>${val}</v></c>`)
      } else if (typeof val === 'boolean') {
        cellsXml.push(`<c r="${ref}"${styleAttr} t="b"><v>${val ? 1 : 0}</v></c>`)
      } else if (val !== null && val !== undefined && String(val) !== '') {
        cellsXml.push(
          `<c r="${ref}"${styleAttr} t="inlineStr"><is><t>${escapeXml(String(val))}</t></is></c>`,
        )
      }
    }
    sheetRowsXml.push(`<row r="${r + 1}">${cellsXml.join('')}</row>`)
  }

  const sheetDataXml = `<sheetData>${sheetRowsXml.join('')}</sheetData>`
  const generatedSheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    sheetDataXml +
    `</worksheet>`

  if (meta?.xlsxEntriesBase64 && typeof meta.xlsxEntriesBase64 === 'object') {
    const entries: Record<string, Buffer | string> = {}
    for (const [k, b64] of Object.entries(meta.xlsxEntriesBase64)) {
      entries[k] = Buffer.from(b64, 'base64')
    }
    const targetSheetPath =
      meta.sheetEntryPath || `xl/worksheets/sheet${(meta.tableIndex ?? 0) + 1}.xml`
    // A read/write with no IR changes must preserve the source package byte
    // structure semantically, including mergeCells, dataValidations, styles,
    // and extension nodes. For a changed table, replace only sheetData and
    // retain every other worksheet child in its original position.
    if (meta.originalFingerprint === table.fingerprint) {
      return createZipBuffer(entries)
    }
    if (entries[targetSheetPath]) {
      const sheetText = entries[targetSheetPath]!.toString('utf8')
      const openTagEnd = sheetText.search(/<sheetData\b[^>]*>/)
      const closeTagStart = sheetText.indexOf('</sheetData>')
      if (openTagEnd >= 0 && closeTagStart > openTagEnd) {
        const openTag = sheetText.slice(openTagEnd, sheetText.indexOf('>', openTagEnd) + 1)
        entries[targetSheetPath] =
          sheetText.slice(0, openTagEnd) +
          openTag +
          sheetRowsXml.join('') +
          sheetText.slice(closeTagStart)
      } else {
        entries[targetSheetPath] = generatedSheetXml
      }
    } else {
      entries[targetSheetPath] = generatedSheetXml
    }
    return createZipBuffer(entries)
  }

  const sheetXml = generatedSheetXml

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(table.tableId)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`

  return createZipBuffer({
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': rootRelsXml,
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': workbookRelsXml,
    'xl/worksheets/sheet1.xml': sheetXml,
  })
}

function readXlsxBuffer(
  buf: Buffer,
  options: { tableId?: string; sourceUri?: string; tableIndex?: number } = {},
): UnifiedTableIR {
  const entries = readZipBuffer(buf)
  const tableIndex = Number(options.tableIndex ?? 0)
  const sharedStrings: string[] = []
  if (entries['xl/sharedStrings.xml']) {
    const ssXml = entries['xl/sharedStrings.xml'].toString('utf8')
    const siMatches = ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)
    for (const m of siMatches) {
      const tMatches = [...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      sharedStrings.push(tMatches.map(tm => unescapeXml(tm[1]!)).join(''))
    }
  }

  const workbookXml = entries['xl/workbook.xml']?.toString('utf8') ?? ''
  const workbookRelsXml = entries['xl/_rels/workbook.xml.rels']?.toString('utf8') ?? ''
  const sheetMatches = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)]
  const sheetDescriptors = sheetMatches.map(match => {
    const attrs = match[1] ?? ''
    const name = attrs.match(/\bname="([^"]*)"/)?.[1]
    const relId = attrs.match(/\br:id="([^"]*)"/)?.[1] ?? attrs.match(/\bid="([^"]*)"/)?.[1]
    return { name: name ? unescapeXml(name) : undefined, relId }
  })
  const relationships = new Map<string, string>()
  for (const match of workbookRelsXml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = match[1] ?? ''
    const id = attrs.match(/\bId="([^"]*)"/)?.[1]
    const target = attrs.match(/\bTarget="([^"]*)"/)?.[1]
    if (id && target) relationships.set(id, target)
  }

  const chosenDescriptor = sheetDescriptors[tableIndex] ?? sheetDescriptors[0]
  let tableId = options.tableId ?? chosenDescriptor?.name
  const sheetKeys = Object.keys(entries)
    .filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort()
  let sheetEntryPath: string | undefined
  const relatedTarget = chosenDescriptor?.relId ? relationships.get(chosenDescriptor.relId) : undefined
  if (relatedTarget) {
    const decodedTarget = (() => {
      try {
        return decodeURIComponent(relatedTarget)
      } catch {
        return relatedTarget
      }
    })()
    sheetEntryPath = decodedTarget.startsWith('/')
      ? decodedTarget.slice(1)
      : path.posix.normalize(path.posix.join('xl', decodedTarget))
  }
  if (!sheetEntryPath || !entries[sheetEntryPath]) {
    sheetEntryPath =
      entries[`xl/worksheets/sheet${tableIndex + 1}.xml`]
        ? `xl/worksheets/sheet${tableIndex + 1}.xml`
        : sheetKeys[tableIndex] ?? 'xl/worksheets/sheet1.xml'
  }
  const sheetBuf = entries[sheetEntryPath]
  if (!sheetBuf) {
    throw new Error(`Invalid .xlsx archive: missing worksheet at index ${tableIndex} (${sheetEntryPath})`)
  }
  const sheetXml = sheetBuf.toString('utf8')
  const rawGrid = new Map<number, Map<number, string | number | boolean | null>>()
  let maxRow = -1
  let maxCol = -1

  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rIdx = Number(rowMatch[1]) - 1
    if (rIdx > maxRow) maxRow = rIdx
    const rowContent = rowMatch[2]!
    if (!rawGrid.has(rIdx)) rawGrid.set(rIdx, new Map())
    const rowMap = rawGrid.get(rIdx)!

    for (const cellMatch of rowContent.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1]!
      const inner = cellMatch[2]!
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/)
      const cIdx = refMatch?.[1] ? colLetterToIndex(refMatch[1]) : rowMap.size
      if (cIdx > maxCol) maxCol = cIdx

      const typeMatch = attrs.match(/\bt="([^"]+)"/)
      const cellType = typeMatch?.[1] ?? 'n'
      const fMatch = inner.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)
      const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)
      const tMatch = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)

      if (fMatch?.[1]) {
        const fText = unescapeXml(fMatch[1])
        rowMap.set(cIdx, fText.startsWith('=') ? fText : `=${fText}`)
      } else if (cellType === 'inlineStr' && tMatch?.[1] !== undefined) {
        rowMap.set(cIdx, unescapeXml(tMatch[1]))
      } else if (cellType === 's' && vMatch?.[1] !== undefined) {
        const ssIdx = Number(vMatch[1])
        rowMap.set(cIdx, sharedStrings[ssIdx] ?? '')
      } else if (cellType === 'b' && vMatch?.[1] !== undefined) {
        rowMap.set(cIdx, vMatch[1] === '1' || vMatch[1] === 'true')
      } else if (vMatch?.[1] !== undefined) {
        rowMap.set(cIdx, parseScalarValue(unescapeXml(vMatch[1])))
      }
    }
  }

  const colCount = maxCol + 1
  const headers: string[] = []
  const headerMap = rawGrid.get(0) ?? new Map()
  for (let c = 0; c < colCount; c++) {
    headers.push(String(headerMap.get(c) ?? `Col_${c + 1}`))
  }

  const rows: Array<Array<string | number | boolean | null>> = []
  for (let r = 1; r <= maxRow; r++) {
    const rMap = rawGrid.get(r) ?? new Map()
    const rowArr: Array<string | number | boolean | null> = []
    for (let c = 0; c < colCount; c++) {
      rowArr.push(rMap.get(c) ?? null)
    }
    rows.push(rowArr)
  }

  const xlsxEntriesBase64: Record<string, string> = {}
  for (const [k, v] of Object.entries(entries)) {
    xlsxEntriesBase64[k] = v.toString('base64')
  }

  const table = createUnifiedTableIR({
    tableId: tableId ?? 'tbl_calc',
    adapterKind: 'calc',
    sourceUri: options.sourceUri ?? 'file://table.xlsx',
    headers,
    rows,
    adapterMetadata: {
      tableIndex,
      sheetEntryPath,
      xlsxEntriesBase64,
    },
  })
  return {
    ...table,
    adapterMetadata: {
      ...(table.adapterMetadata ?? {}),
      originalFingerprint: table.fingerprint,
    },
  }
}

// ── 2. `writer` Adapter (.docx OOXML `<w:tbl>`) ─────────────────────────────

function writeDocxBuffer(table: UnifiedTableIR): Buffer {
  const { headers, rows } = buildGridFromIr(table)
  const allRows = [headers, ...rows]
  const trXml = allRows
    .map(row => {
      const tcXml = headers
        .map((_, idx) => {
          const val = row[idx]
          const text = val === null || val === undefined ? '' : String(val)
          return `<w:tc><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:tc>`
        })
        .join('')
      return `<w:tr>${tcXml}</w:tr>`
    })
    .join('')

  const meta = table.adapterMetadata as
    | {
        tblOpenTag?: string
        docXmlPrefix?: string
        docXmlSuffix?: string
        docxEntriesBase64?: Record<string, string>
      }
    | undefined
  const tblOpenTag = meta?.tblOpenTag || '<w:tbl>'
  const newTblXml = `${tblOpenTag}${trXml}</w:tbl>`

  const docXml =
    typeof meta?.docXmlPrefix === 'string' && typeof meta?.docXmlSuffix === 'string'
      ? `${meta.docXmlPrefix}${newTblXml}${meta.docXmlSuffix}`
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>${newTblXml}</w:body>` +
        `</w:document>`

  if (meta?.docxEntriesBase64 && typeof meta.docxEntriesBase64 === 'object') {
    const entries: Record<string, Buffer | string> = {}
    for (const [k, b64] of Object.entries(meta.docxEntriesBase64)) {
      entries[k] = Buffer.from(b64, 'base64')
    }
    entries['word/document.xml'] = docXml
    return createZipBuffer(entries)
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`

  return createZipBuffer({
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': rootRelsXml,
    'word/document.xml': docXml,
  })
}

function readDocxBuffer(
  buf: Buffer,
  options: { tableId?: string; sourceUri?: string; tableIndex?: number } = {},
): UnifiedTableIR {
  const entries = readZipBuffer(buf)
  const docBuf = entries['word/document.xml']
  if (!docBuf) {
    throw new Error('Invalid .docx archive: missing word/document.xml')
  }
  const docXml = docBuf.toString('utf8')
  const tableIndex = Number(options.tableIndex ?? 0)
  const tblMatches = [...docXml.matchAll(/(<w:tbl\b[^>]*>)([\s\S]*?)<\/w:tbl>/g)]
  if (tblMatches.length === 0) {
    throw new Error('No <w:tbl> found in word/document.xml')
  }
  const tblMatch = tblMatches[tableIndex]
  if (!tblMatch) {
    throw new Error(
      `Table index ${tableIndex} out of range (word/document.xml contains ${tblMatches.length} table(s))`,
    )
  }
  const matchStart = tblMatch.index ?? 0
  const matchEnd = matchStart + tblMatch[0].length
  const parsedRows: string[][] = []
  for (const trMatch of tblMatch[2]!.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
    const rowCells: string[] = []
    for (const tcMatch of trMatch[1]!.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
      const texts = [...tcMatch[1]!.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m =>
        unescapeXml(m[1]!),
      )
      rowCells.push(texts.join(''))
    }
    parsedRows.push(rowCells)
  }
  const headers = parsedRows[0] ?? []
  const rows = parsedRows.slice(1).map(r => r.map(parseScalarValue))
  const docxEntriesBase64: Record<string, string> = {}
  for (const [k, v] of Object.entries(entries)) {
    docxEntriesBase64[k] = v.toString('base64')
  }
  return createUnifiedTableIR({
    tableId: options.tableId ?? 'tbl_writer',
    adapterKind: 'writer',
    sourceUri: options.sourceUri ?? 'file://document.docx',
    headers,
    rows,
    adapterMetadata: {
      tableIndex,
      tblOpenTag: tblMatch[1],
      docXmlPrefix: docXml.slice(0, matchStart),
      docXmlSuffix: docXml.slice(matchEnd),
      docxEntriesBase64,
    },
  })
}

// ── 3. `impress` Adapter (.pptx OOXML `<a:tbl>`) ────────────────────────────

function writePptxBuffer(table: UnifiedTableIR): Buffer {
  const { headers, rows } = buildGridFromIr(table)
  const allRows = [headers, ...rows]
  const trXml = allRows
    .map(row => {
      const tcXml = headers
        .map((_, idx) => {
          const val = row[idx]
          const text = val === null || val === undefined ? '' : String(val)
          return `<a:tc><a:txBody><a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p></a:txBody></a:tc>`
        })
        .join('')
      return `<a:tr h="370840">${tcXml}</a:tr>`
    })
    .join('')

  const meta = table.adapterMetadata as
    | {
        tblOpenTag?: string
        slideXmlPrefix?: string
        slideXmlSuffix?: string
        slideKey?: string
        pptxEntriesBase64?: Record<string, string>
      }
    | undefined
  const tblOpenTag = meta?.tblOpenTag || '<a:tbl>'
  const newTblXml = `${tblOpenTag}${trXml}</a:tbl>`

  const slideXml =
    typeof meta?.slideXmlPrefix === 'string' && typeof meta?.slideXmlSuffix === 'string'
      ? `${meta.slideXmlPrefix}${newTblXml}${meta.slideXmlSuffix}`
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
        `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData>` +
        `${newTblXml}` +
        `</a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld>` +
        `</p:sld>`

  if (meta?.pptxEntriesBase64 && typeof meta.pptxEntriesBase64 === 'object') {
    const entries: Record<string, Buffer | string> = {}
    for (const [k, b64] of Object.entries(meta.pptxEntriesBase64)) {
      entries[k] = Buffer.from(b64, 'base64')
    }
    const targetSlideKey = meta.slideKey || 'ppt/slides/slide1.xml'
    entries[targetSlideKey] = slideXml
    return createZipBuffer(entries)
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
    `</Types>`

  return createZipBuffer({
    '[Content_Types].xml': contentTypesXml,
    'ppt/slides/slide1.xml': slideXml,
  })
}

function readPptxBuffer(
  buf: Buffer,
  options: { tableId?: string; sourceUri?: string; tableIndex?: number } = {},
): UnifiedTableIR {
  const entries = readZipBuffer(buf)
  const tableIndex = Number(options.tableIndex ?? 0)
  const slideKeys = Object.keys(entries)
    .filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort()
  if (slideKeys.length === 0 && entries['ppt/slides/slide1.xml']) {
    slideKeys.push('ppt/slides/slide1.xml')
  }
  if (slideKeys.length === 0) {
    throw new Error('Invalid .pptx archive: missing ppt/slides/slide1.xml')
  }

  const allTables: Array<{ slideKey: string; slideXml: string; match: RegExpMatchArray }> = []
  for (const sk of slideKeys) {
    const sXml = entries[sk]!.toString('utf8')
    for (const m of sXml.matchAll(/(<a:tbl\b[^>]*>)([\s\S]*?)<\/a:tbl>/g)) {
      allTables.push({ slideKey: sk, slideXml: sXml, match: m })
    }
  }
  if (allTables.length === 0) {
    throw new Error('No <a:tbl> found in slide XML')
  }
  const chosen = allTables[tableIndex]
  if (!chosen) {
    throw new Error(
      `Table index ${tableIndex} out of range (.pptx contains ${allTables.length} table(s))`,
    )
  }
  const { slideKey, slideXml, match: tblMatch } = chosen
  const matchStart = tblMatch.index ?? 0
  const matchEnd = matchStart + tblMatch[0].length
  const parsedRows: string[][] = []
  for (const trMatch of tblMatch[2]!.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)) {
    const rowCells: string[] = []
    for (const tcMatch of trMatch[1]!.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)) {
      const texts = [...tcMatch[1]!.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(m =>
        unescapeXml(m[1]!),
      )
      rowCells.push(texts.join(''))
    }
    parsedRows.push(rowCells)
  }
  const headers = parsedRows[0] ?? []
  const rows = parsedRows.slice(1).map(r => r.map(parseScalarValue))
  const pptxEntriesBase64: Record<string, string> = {}
  for (const [k, v] of Object.entries(entries)) {
    pptxEntriesBase64[k] = v.toString('base64')
  }
  return createUnifiedTableIR({
    tableId: options.tableId ?? 'tbl_impress',
    adapterKind: 'impress',
    sourceUri: options.sourceUri ?? 'file://deck.pptx',
    headers,
    rows,
    adapterMetadata: {
      tableIndex,
      slideKey,
      tblOpenTag: tblMatch[1],
      slideXmlPrefix: slideXml.slice(0, matchStart),
      slideXmlSuffix: slideXml.slice(matchEnd),
      pptxEntriesBase64,
    },
  })
}

// ── 4. `markdown` Adapter (.md GFM Table with Document Preservation) ────────

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i++
    } else if (trimmed[i] === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += trimmed[i]
    }
  }
  cells.push(current.trim())
  return cells
}

function parseMarkdownTableText(
  mdText: string,
  options: { tableId?: string; sourceUri?: string; tableIndex?: number } = {},
): UnifiedTableIR {
  const lines = mdText.split(/\r?\n/)
  const tableBlocks: Array<{ startLine: number; endLine: number }> = []
  const tableIndex = Number(options.tableIndex ?? 0)

  let i = 0
  while (i < lines.length - 1) {
    const line = lines[i]!.trim()
    const next = lines[i + 1]!.trim()
    if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(next)) {
      const startLine = i
      let endLine = i + 1
      for (let j = i + 2; j < lines.length; j++) {
        if (lines[j]!.trim().startsWith('|')) {
          endLine = j
        } else {
          break
        }
      }
      tableBlocks.push({ startLine, endLine })
      i = endLine + 1
    } else {
      i++
    }
  }

  if (tableBlocks.length === 0) {
    throw new Error('No GFM Markdown table found in document')
  }
  const chosenBlock = tableBlocks[tableIndex]
  if (!chosenBlock) {
    throw new Error(
      `Table index ${tableIndex} out of range (Markdown document contains ${tableBlocks.length} table(s))`,
    )
  }
  const { startLine, endLine } = chosenBlock

  const headers = splitMarkdownTableRow(lines[startLine]!)
  const rows: Array<Array<string | number | boolean | null>> = []
  for (let r = startLine + 2; r <= endLine; r++) {
    const rawCells = splitMarkdownTableRow(lines[r]!)
    rows.push(headers.map((_, idx) => parseScalarValue(rawCells[idx] ?? '')))
  }

  return createUnifiedTableIR({
    tableId: options.tableId ?? 'tbl_markdown',
    adapterKind: 'markdown',
    sourceUri: options.sourceUri ?? 'file://table.md',
    headers,
    rows,
    adapterMetadata: {
      tableIndex,
      prefixLines: lines.slice(0, startLine),
      suffixLines: lines.slice(endLine + 1),
    },
  })
}

function serializeMarkdownTableText(table: UnifiedTableIR): string {
  const mdTable = renderTableIrToMarkdown(table)
  const meta = table.adapterMetadata as
    | { prefixLines?: string[]; suffixLines?: string[] }
    | undefined
  if (meta?.prefixLines || meta?.suffixLines) {
    return [...(meta.prefixLines ?? []), mdTable, ...(meta.suffixLines ?? [])].join('\n')
  }
  return mdTable + '\n'
}

// ── 5. `tabular-ops` Adapter (.csv / .tsv RFC 4180) ─────────────────────────

function parseDelimitedText(
  text: string,
  delimiter: string,
  options: { tableId?: string; sourceUri?: string } = {},
): UnifiedTableIR {
  // RFC 4180 records are terminated by a newline only when it occurs outside
  // a quoted field. Splitting on lines first loses embedded newlines and
  // shifts every subsequent record, so scan the complete document instead.
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false
  let endedWithRecordSeparator = false

  const finishField = () => {
    record.push(field)
    field = ''
    fieldStarted = false
  }
  const finishRecord = () => {
    finishField()
    records.push(record)
    record = []
    endedWithRecordSeparator = true
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          fieldStarted = true
          i++
        } else {
          inQuotes = false
        }
      } else {
        // Normalize CRLF/CR inside quoted fields to a single LF. This keeps
        // the parsed value stable across platforms while preserving content.
        if (ch === '\r' && text[i + 1] === '\n') i++
        field += ch === '\r' ? '\n' : ch
        fieldStarted = true
      }
      endedWithRecordSeparator = false
      continue
    }

    if (ch === '"' && !fieldStarted) {
      inQuotes = true
      fieldStarted = true
    } else if (ch === delimiter) {
      finishField()
      endedWithRecordSeparator = false
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      finishRecord()
    } else {
      field += ch
      fieldStarted = true
      endedWithRecordSeparator = false
    }
  }

  if (inQuotes) {
    throw new Error('Invalid delimited text: unterminated quoted field')
  }
  // A final newline terminates the preceding record; it does not create an
  // additional empty record. Interior blank records remain represented as a
  // single empty field and therefore round-trip through the writer.
  if (text.length > 0 && (!endedWithRecordSeparator || field.length > 0 || record.length > 0)) {
    finishRecord()
  }

  const headers = records[0] ?? []
  const rows = records.slice(1).map(vals => {
    return headers.map((_, idx) => parseScalarValue(vals[idx] ?? ''))
  })

  return createUnifiedTableIR({
    tableId: options.tableId ?? 'tbl_tabular-ops',
    adapterKind: 'tabular-ops',
    sourceUri: options.sourceUri ?? 'file://table.csv',
    headers,
    rows,
    adapterMetadata: { delimiter },
  })
}

function serializeDelimitedText(table: UnifiedTableIR, delimiter = ','): string {
  const { headers, rows } = buildGridFromIr(table)
  const formatCell = (v: string | number | boolean | null): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (s.includes(delimiter) || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const allLines = [
    headers.map(h => formatCell(h)).join(delimiter),
    ...rows.map(r => headers.map((_, idx) => formatCell(r[idx] ?? null)).join(delimiter)),
  ]
  return allLines.join('\n') + '\n'
}

// ── 6. `visual-dom` Adapter (.html / .svg DOM `<table>`) ────────────────────

function parseHtmlTableText(
  htmlText: string,
  options: { tableId?: string; sourceUri?: string; tableIndex?: number } = {},
): UnifiedTableIR {
  const tableIndex = Number(options.tableIndex ?? 0)
  const tblMatches = [...htmlText.matchAll(/(<table\b([^>]*)>)([\s\S]*?)<\/table>/gi)]
  if (tblMatches.length === 0) {
    throw new Error('No <table> element found in HTML/DOM document')
  }
  const tblMatch = tblMatches[tableIndex]
  if (!tblMatch) {
    throw new Error(
      `Table index ${tableIndex} out of range (HTML document contains ${tblMatches.length} table(s))`,
    )
  }
  const matchStart = tblMatch.index ?? 0
  const matchEnd = matchStart + tblMatch[0].length
  const tblOpenTag = tblMatch[1] ?? `<table data-adapter-kind="visual-dom">`
  const tblAttrs = tblMatch[2] ?? ''
  const idMatch = tblAttrs.match(/\b(?:id|data-table-id)="([^"]+)"/i)
  const tableId = options.tableId ?? idMatch?.[1] ?? 'tbl_visual-dom'

  const trMatches = [...tblMatch[3]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  const headers: string[] = []
  const rows: Array<Array<string | number | boolean | null>> = []

  trMatches.forEach((tr, rowIndex) => {
    const cells = [
      ...tr[1]!.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi),
    ]
    if (rowIndex === 0) {
      for (const c of cells) {
        headers.push(unescapeXml(c[3]!.replace(/<[^>]+>/g, '').trim()))
      }
    } else {
      const rowVals: Array<string | number | boolean | null> = []
      for (const c of cells) {
        const attrs = c[2] ?? ''
        const fMatch = attrs.match(/\bdata-formula="([^"]+)"/i)
        if (fMatch?.[1]) {
          const f = unescapeXml(fMatch[1])
          rowVals.push(f.startsWith('=') ? f : `=${f}`)
        } else {
          rowVals.push(parseScalarValue(unescapeXml(c[3]!.replace(/<[^>]+>/g, '').trim())))
        }
      }
      rows.push(rowVals)
    }
  })

  return createUnifiedTableIR({
    tableId,
    adapterKind: 'visual-dom',
    sourceUri: options.sourceUri ?? 'file://table.html',
    headers,
    rows,
    adapterMetadata: {
      tableIndex,
      tblOpenTag,
      htmlPrefix: htmlText.slice(0, matchStart),
      htmlSuffix: htmlText.slice(matchEnd),
    },
  })
}

function serializeHtmlTableText(table: UnifiedTableIR): string {
  const { headers, rows, formulas } = buildGridFromIr(table)
  const ths = headers.map(h => `      <th>${escapeXml(h)}</th>`).join('\n')
  const trs = rows
    .map((r, rIdx) => {
      const tds = headers
        .map((_, cIdx) => {
          const val = r[cIdx]
          const formula = formulas[`${rIdx}:${cIdx}`]
          const fAttr = formula ? ` data-formula="${escapeXml(formula)}"` : ''
          const text = val === null || val === undefined ? '' : String(val)
          return `      <td${fAttr}>${escapeXml(text)}</td>`
        })
        .join('\n')
      return `    <tr>\n${tds}\n    </tr>`
    })
    .join('\n')

  const meta = table.adapterMetadata as
    | { tblOpenTag?: string; htmlPrefix?: string; htmlSuffix?: string }
    | undefined
  const openTag =
    meta?.tblOpenTag ||
    `<table data-table-id="${escapeXml(table.tableId)}" data-adapter-kind="visual-dom">`
  const tableHtml = [
    openTag,
    `  <thead>`,
    `    <tr>`,
    ths,
    `    </tr>`,
    `  </thead>`,
    `  <tbody>`,
    trs,
    `  </tbody>`,
    `</table>`,
  ].join('\n')

  if (typeof meta?.htmlPrefix === 'string' && typeof meta?.htmlSuffix === 'string') {
    return `${meta.htmlPrefix}${tableHtml}${meta.htmlSuffix}`
  }
  return `${tableHtml}\n`
}

// ── Public Unified File I/O API ─────────────────────────────────────────────

export function inferAdapterKindFromPath(filePath: string): DocumentTableAdapterKind {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.xlsx' || ext === '.ods') return 'calc'
  if (ext === '.docx' || ext === '.odt') return 'writer'
  if (ext === '.pptx' || ext === '.odp') return 'impress'
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.csv' || ext === '.tsv') return 'tabular-ops'
  if (ext === '.html' || ext === '.htm' || ext === '.svg') return 'visual-dom'
  return 'markdown'
}

export function readTableFromFile(
  filePath: string,
  options: {
    adapterKind?: DocumentTableAdapterKind | undefined
    tableId?: string | undefined
    tableIndex?: number | undefined
  } = {},
): UnifiedTableIR {
  const resolved = path.resolve(filePath)
  const ext = path.extname(resolved).toLowerCase()
  const adapterKind = options.adapterKind ?? inferAdapterKindFromPath(resolved)
  const sourceUri = `file://${resolved}`
  const tableIndex = options.tableIndex ?? 0

  if (ext === '.xlsx' || (adapterKind === 'calc' && ext !== '.json' && ext !== '.csv')) {
    return readXlsxBuffer(fs.readFileSync(resolved), {
      ...(options.tableId ? { tableId: options.tableId } : {}),
      sourceUri,
      tableIndex,
    })
  }
  if (ext === '.docx' || (adapterKind === 'writer' && ext !== '.json')) {
    return readDocxBuffer(fs.readFileSync(resolved), {
      ...(options.tableId ? { tableId: options.tableId } : {}),
      sourceUri,
      tableIndex,
    })
  }
  if (ext === '.pptx' || (adapterKind === 'impress' && ext !== '.json')) {
    return readPptxBuffer(fs.readFileSync(resolved), {
      ...(options.tableId ? { tableId: options.tableId } : {}),
      sourceUri,
      tableIndex,
    })
  }
  if (ext === '.csv' || ext === '.tsv' || adapterKind === 'tabular-ops') {
    const delimiter = ext === '.tsv' ? '\t' : ','
    return parseDelimitedText(fs.readFileSync(resolved, 'utf8'), delimiter, {
      ...(options.tableId ? { tableId: options.tableId } : {}),
      sourceUri,
    })
  }
  if (ext === '.html' || ext === '.htm' || ext === '.svg' || adapterKind === 'visual-dom') {
    return parseHtmlTableText(fs.readFileSync(resolved, 'utf8'), {
      ...(options.tableId ? { tableId: options.tableId } : {}),
      sourceUri,
      tableIndex,
    })
  }
  return parseMarkdownTableText(fs.readFileSync(resolved, 'utf8'), {
    ...(options.tableId ? { tableId: options.tableId } : {}),
    sourceUri,
    tableIndex,
  })
}

export function writeTableToFile(table: UnifiedTableIR, filePath: string): string {
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const ext = path.extname(resolved).toLowerCase()
  const kind = table.adapterKind

  if (ext === '.xlsx' || (kind === 'calc' && ext !== '.json' && ext !== '.csv')) {
    fs.writeFileSync(resolved, writeXlsxBuffer(table))
    return resolved
  }
  if (ext === '.docx' || (kind === 'writer' && ext !== '.json')) {
    fs.writeFileSync(resolved, writeDocxBuffer(table))
    return resolved
  }
  if (ext === '.pptx' || (kind === 'impress' && ext !== '.json')) {
    fs.writeFileSync(resolved, writePptxBuffer(table))
    return resolved
  }
  if (ext === '.csv' || ext === '.tsv' || kind === 'tabular-ops') {
    const delimiter = ext === '.tsv' ? '\t' : ','
    fs.writeFileSync(resolved, serializeDelimitedText(table, delimiter), 'utf8')
    return resolved
  }
  if (ext === '.html' || ext === '.htm' || ext === '.svg' || kind === 'visual-dom') {
    fs.writeFileSync(resolved, serializeHtmlTableText(table), 'utf8')
    return resolved
  }
  fs.writeFileSync(resolved, serializeMarkdownTableText(table), 'utf8')
  return resolved
}
