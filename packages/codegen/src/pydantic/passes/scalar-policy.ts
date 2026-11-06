/**
 * S4 pass `scalarPolicy` — reads: enumStyle, datetime, uri, intBounds.
 *
 * Replaces every `scalar` fact with a concrete type and decides enum representation
 * (mapping table: docs/reports/typespec-pydantic-codegen-review.md §4.1):
 * - string formats: `date-time` → `AwareDatetime` | `datetime` (`datetime` option), `date`, `time`,
 *   `duration` → `timedelta`, `uuid` → `UUID`, `email` → `EmailStr`, `uri`/`url` → `str` | `AnyUrl`
 *   (`uri` option), `byte`/`contentEncoding: base64` → `Base64Bytes`, unknown format → `str`;
 * - integer → `int`; with `intBounds: 'format'`, `int8`…`int64`/`uint8`…`uint64`/`int32`/`int64`
 *   wrap it in `constrained` with the format's `ge`/`le` (merged with existing bounds, keeping the tighter);
 * - number → `float`; `decimal`/`decimal128` → `Decimal`;
 * - enum declarations: `repr` = `str-enum` when `enumStyle === 'str-enum'` and every value is a
 *   string, else `literal`; `members` = unique UPPER_SNAKE identifiers for `str-enum`, `[]` otherwise.
 */
import type { PyPass } from './index.js'
import type { PyBound, PyConstraints, PyTypeExpr } from '../ir.js'
import { pythonIdentifier, snakeCase } from '../../python-identifier.js'
import { cloneIr, mapDeclTypes } from './lib/ir-utils.js'

function boundFor(format: string): PyConstraints | undefined {
  const bounds: Record<string, PyConstraints> = {
    int8: { ge: -128, le: 127 },
    int16: { ge: -32768, le: 32767 },
    int32: { ge: -2147483648, le: 2147483647 },
    int64: { ge: { integer: '-9223372036854775808' }, le: { integer: '9223372036854775807' } },
    uint8: { ge: 0, le: 255 },
    uint16: { ge: 0, le: 65535 },
    uint32: { ge: 0, le: 4294967295 },
    uint64: { ge: 0, le: { integer: '18446744073709551615' } },
    safeint: { ge: -(2 ** 53 - 1), le: 2 ** 53 - 1 },
  }
  return bounds[format]
}

function boundBigInt(bound: PyBound): bigint {
  return typeof bound === 'number' ? BigInt(bound) : BigInt(bound.integer)
}

function tighterLower(constraints: PyConstraints, bound: PyBound): PyConstraints {
  const current = constraints.ge
  if (current === undefined || boundBigInt(bound) > boundBigInt(current)) {
    return { ...constraints, ge: bound }
  }
  return constraints
}

function tighterUpper(constraints: PyConstraints, bound: PyBound): PyConstraints {
  const current = constraints.le
  if (current === undefined || boundBigInt(bound) < boundBigInt(current)) {
    return { ...constraints, le: bound }
  }
  return constraints
}

type ScalarOptions = {
  datetime: 'aware' | 'naive'
  uri: string
  intBounds: 'format' | 'none'
}

function scalarType(
  format: string | undefined,
  encoding: string | undefined,
  base: 'string' | 'integer' | 'number',
  options: ScalarOptions,
): PyTypeExpr {
  if (base === 'string') {
    if (format === 'date-time') return options.datetime === 'aware'
      ? { kind: 'named', module: 'pydantic', name: 'AwareDatetime' }
      : { kind: 'named', module: 'datetime', name: 'datetime' }
    if (format === 'date') return { kind: 'named', module: 'datetime', name: 'date' }
    if (format === 'time') return { kind: 'named', module: 'datetime', name: 'time' }
    if (format === 'duration') return { kind: 'named', module: 'datetime', name: 'timedelta' }
    if (format === 'uuid') return { kind: 'named', module: 'uuid', name: 'UUID' }
    if (format === 'email') return { kind: 'named', module: 'pydantic', name: 'EmailStr' }
    if (format === 'uri' || format === 'url') {
      return options.uri.startsWith('a') && options.uri.endsWith('url')
        ? { kind: 'named', module: 'pydantic', name: 'AnyUrl' }
        : { kind: 'builtin', name: 'str' }
    }
    if (format === 'byte' || encoding === 'base64') return { kind: 'named', module: 'pydantic', name: 'Base64Bytes' }
    return { kind: 'builtin', name: 'str' }
  }
  if (base === 'number') {
    return format === 'decimal' || format === 'decimal128'
      ? { kind: 'named', module: 'decimal', name: 'Decimal' }
      : { kind: 'builtin', name: 'float' }
  }
  return { kind: 'builtin', name: 'int' }
}

export const scalarPolicyPass: PyPass<'enumStyle' | 'datetime' | 'uri' | 'intBounds'> = {
  name: 'scalarPolicy',
  reads: ['enumStyle', 'datetime', 'uri', 'intBounds'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    const map = (type: PyTypeExpr): PyTypeExpr => {
      if (type.kind === 'constrained' && type.base.kind === 'constrained') {
        const outer = type.constraints
        const inner = type.base.constraints
        let constraints: PyConstraints = { ...inner, ...outer }
        if (inner.ge !== undefined && outer.ge !== undefined) constraints = tighterLower(constraints, inner.ge)
        if (inner.le !== undefined && outer.le !== undefined) constraints = tighterUpper(constraints, inner.le)
        return { kind: 'constrained', base: type.base.base, constraints }
      }
      if (type.kind !== 'scalar') return type
      const value = scalarType(type.format, type.contentEncoding, type.base, options)
      if (type.base !== 'integer' || options.intBounds !== 'format' || type.format === undefined) return value
      const bounds = boundFor(type.format)
      if (bounds === undefined) return value
      return { kind: 'constrained', base: value, constraints: { ...bounds } }
    }
    result.decls = result.decls.map(decl => mapDeclTypes(decl, map))
    for (const decl of result.decls) {
      if (decl.kind !== 'enum') continue
      const strings = decl.values.every(value => typeof value === 'string')
      if (options.enumStyle !== 'str-enum' || !strings) {
        decl.repr = 'literal'
        decl.members = []
        continue
      }
      decl.repr = 'str-enum'
      const used = new Set<string>()
      decl.members = decl.values.map(value => {
        const source = snakeCase(String(value)).toUpperCase()
        const base = pythonIdentifier(source).toUpperCase()
        let name = base
        let suffix = 2
        while (used.has(name)) name = `${base}_${suffix++}`
        used.add(name)
        return { name, value: String(value) }
      })
    }
    if (!result.decls.some(decl => decl.kind === 'enum')) {
      result.diagnostics.push({
        code: 'pydantic/encoding-degraded',
        severity: 'info',
        pointer: '/',
        message: `Enum style '${options.enumStyle}' had no named enum declarations to transform`,
      })
    }
    return result
  },
}
