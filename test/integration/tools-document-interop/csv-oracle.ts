export interface CsvOracle {
  parse(input: string): string[][]
  stringify(records: readonly (readonly (string | null)[])[]): string
}

export interface CsvOracleAvailability {
  readonly available: boolean
  readonly oracle?: CsvOracle
  readonly reason?: string
}

type SyncFunction = (input: unknown, options?: Record<string, unknown>) => unknown

function resolveSyncFunction(module: unknown, name: string): SyncFunction | undefined {
  if (!module || typeof module !== 'object') return undefined
  const record = module as Record<string, unknown>
  const candidate = record[name] ?? record.default
  return typeof candidate === 'function' ? (candidate as SyncFunction) : undefined
}

/**
 * Loads the independent CSV oracle without making it a production dependency.
 * The integration lane skips cleanly when the harness-only packages are absent.
 */
export async function loadCsvOracle(): Promise<CsvOracleAvailability> {
  const parseModuleName: string = 'csv-parse/sync'
  const stringifyModuleName: string = 'csv-stringify/sync'
  try {
    const [parseModule, stringifyModule] = await Promise.all([
      import(parseModuleName),
      import(stringifyModuleName),
    ])
    const parse = resolveSyncFunction(parseModule, 'parse')
    const stringify = resolveSyncFunction(stringifyModule, 'stringify')
    if (!parse || !stringify) {
      return { available: false, reason: 'CSV oracle modules do not expose sync parse/stringify functions' }
    }
    return {
      available: true,
      oracle: {
        parse(input) {
          const records = parse(input, {
            bom: true,
            relax_column_count: false,
            skip_empty_lines: false,
          })
          if (!Array.isArray(records)) throw new Error('CSV oracle returned a non-array result')
          return records.map(record => {
            if (!Array.isArray(record)) throw new Error('CSV oracle returned a malformed record')
            return record.map(value => String(value ?? ''))
          })
        },
        stringify(records) {
          return String(stringify(records, { record_delimiter: '\n' }))
        },
      },
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { available: false, reason: `CSV oracle unavailable: ${reason}` }
  }
}

export function normalizeCsvRecords(records: readonly (readonly (string | null | number | boolean)[])[]): string[][] {
  return records.map(record =>
    record.map(value => {
      if (value === null || value === undefined) return ''
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      return String(value)
    }),
  )
}
