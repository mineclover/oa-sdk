/**
 * S4 pass `extensions` — reads: no options.
 *
 * Keeps `x-*` extensions (fixed setting `extensions: 'preserve'`) and drops keys whose value is
 * not JSON-serializable, with `pydantic/extension-dropped`. Normalizes key order (sorted) so output
 * does not depend on schema key order.
 */
import type { PyPass } from './index.js'
import { cloneIr } from './lib/ir-utils.js'

const DROPPED = Symbol('dropped')
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function jsonValue(value: unknown): JsonValue | typeof DROPPED {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : DROPPED
  if (Array.isArray(value)) {
    const items: JsonValue[] = []
    for (const item of value) {
      const normalized = jsonValue(item)
      if (normalized === DROPPED) return DROPPED
      items.push(normalized)
    }
    return items
  }
  if (typeof value !== 'object') return DROPPED
  const entries: Array<[string, JsonValue]> = []
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const normalized = jsonValue((value as Record<string, unknown>)[key])
    if (normalized === DROPPED) return DROPPED
    entries.push([key, normalized])
  }
  return Object.fromEntries(entries)
}

export const extensionsPass: PyPass<never> = {
  name: 'extensions',
  reads: [],
  run(ir, options, analysis) {
    void options
    void analysis
    const result = cloneIr(ir)
    const normalize = (
      extensions: Record<string, unknown> | undefined,
      pointer: string,
    ): Record<string, unknown> | undefined => {
      if (extensions === undefined) return undefined
      const kept: Record<string, unknown> = {}
      const keys = Object.keys(extensions)
        .filter(item => item.startsWith('x-'))
        .sort((left, right) => left.localeCompare(right))
      for (const key of keys) {
        const value = jsonValue(extensions[key])
        if (value === DROPPED) {
          result.diagnostics.push({
            code: 'pydantic/extension-dropped',
            severity: 'warning',
            pointer,
            message: `Extension '${key}' was dropped because its value is not JSON-serializable`,
          })
        } else kept[key] = value
      }
      return Object.keys(kept).length === 0 ? undefined : kept
    }
    for (const decl of result.decls) {
      if (decl.kind === 'model') {
        const extensions = normalize(decl.extensions, decl.pointer)
        if (extensions === undefined) delete decl.extensions
        else decl.extensions = extensions
        for (const field of decl.fields) {
          const fieldExtensions = normalize(field.extensions, field.pointer)
          if (fieldExtensions === undefined) delete field.extensions
          else field.extensions = fieldExtensions
        }
      }
    }
    return result
  },
}
