import type { PyDecl, PyModuleIR, PyTypeExpr } from './ir.js'
import { visitType } from './passes/lib/ir-utils.js'

export type EncodingHelperKey = `${'unixtime' | 'http-date'}:${'aware' | 'naive'}`

function declTypes(decl: PyDecl): PyTypeExpr[] {
  if (decl.kind === 'model') {
    return [...decl.fields.map(field => field.type), ...(decl.openness.kind === 'typed-map' ? [decl.openness.value] : [])]
  }
  return decl.kind === 'alias' ? [decl.type] : []
}

export function encodingHelperKeys(ir: PyModuleIR): Set<EncodingHelperKey> {
  const keys = new Set<EncodingHelperKey>()
  for (const decl of ir.decls) {
    for (const type of declTypes(decl)) {
      visitType(type, value => {
        if (value.kind !== 'decoded') return
        keys.add(`${value.encoding}:${value.datetimeMode ?? 'aware'}`)
      })
    }
  }
  return keys
}

export function encodingHelperSource(keys: Set<EncodingHelperKey>): string[] {
  const lines: string[] = []
  const ordered = [...keys].sort()
  for (const key of ordered) {
    const [encoding, mode] = key.split(':') as ['unixtime' | 'http-date', 'aware' | 'naive']
    const suffix = mode === 'naive' ? '_naive' : ''
    if (encoding === 'unixtime') {
      lines.push(`def _decode_unixtime${suffix}(value: object) -> datetime:`)
      lines.push('    if isinstance(value, datetime):', '        return value')
      lines.push('    if isinstance(value, bool) or not isinstance(value, int):')
      lines.push('        raise ValueError("unixtime must be an integer or datetime")')
      lines.push('    try:', `        parsed = datetime.fromtimestamp(value, timezone.utc)${mode === 'naive' ? '.replace(tzinfo=None)' : ''}`, '    except (TypeError, ValueError, OverflowError, OSError) as error:', '        raise ValueError("invalid unixtime") from error')
      lines.push('    return parsed', '', '')
      lines.push(`def _encode_unixtime${suffix}(value: datetime) -> int:`)
      lines.push('    if not isinstance(value, datetime):')
      lines.push('        raise ValueError("unixtime serializer requires datetime")')
      lines.push(`    return int(${mode === 'naive' ? 'value.replace(tzinfo=timezone.utc)' : 'value'}.timestamp())`, '', '')
    } else {
      lines.push(`def _decode_http_date${suffix}(value: object) -> datetime:`)
      lines.push('    if isinstance(value, datetime):', '        return value')
      lines.push('    if not isinstance(value, str):')
      lines.push('        raise ValueError("http-date must be a string or datetime")')
      lines.push('    try:', '        parsed = parsedate_to_datetime(value)', '    except (TypeError, ValueError, OverflowError, IndexError) as error:', '        raise ValueError("invalid HTTP-date") from error')
      lines.push(`    return parsed${mode === 'naive' ? '.replace(tzinfo=None)' : ''}`, '', '')
      lines.push(`def _encode_http_date${suffix}(value: datetime) -> str:`)
      lines.push('    if not isinstance(value, datetime):')
      lines.push('        raise ValueError("http-date serializer requires datetime")')
      lines.push(`    return format_datetime(${mode === 'naive' ? 'value.replace(tzinfo=timezone.utc)' : 'value.astimezone(timezone.utc) if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)'}, usegmt=True)`, '', '')
    }
  }
  return lines
}
