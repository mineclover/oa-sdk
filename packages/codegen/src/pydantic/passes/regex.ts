/**
 * S4 pass `regex` — reads: regex.
 *
 * Fills `PyConstraints.pattern.python` everywhere and `PyModelDecl.regexEngine`:
 * - `raw`: python = source; engine `rust-regex`;
 * - `python-re`: python = source; engine `python-re` for every model;
 * - `ecma`: tokenize (escapes and character classes); outside a class `\d`→`[0-9]`, `\D`→`[^0-9]`,
 *   `\w`→`[A-Za-z0-9_]`, `\W`→`[^A-Za-z0-9_]`; inside a class `\d`→`0-9`, `\w`→`A-Za-z0-9_`;
 *   `\D`/`\W` inside a class stay and emit `pydantic/regex-class-untranslatable`; lookaround
 *   (`(?=` `(?!` `(?<=` `(?<!`) or a backreference switches the owning model to `python-re` and emits
 *   `pydantic/regex-engine-fallback`; otherwise `rust-regex`.
 * Models without patterns get `rust-regex` (or `python-re` in `python-re` mode).
 */
import type { PyPass } from './index.js'
import { cloneIr, mapType, visitType } from './lib/ir-utils.js'
import type { PyTypeExpr } from '../ir.js'

interface RegexTranslation {
  python: string
  fallback: boolean
  classUntranslatable: boolean
}

function translateEcma(source: string): RegexTranslation {
  let python = ''
  let inClass = false
  let fallback = hasLookaround(source) || /\\[1-9]/.test(source) || /\\k<[^>]+>/.test(source)
  let classUntranslatable = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '\\' && index + 1 < source.length) {
      const escaped = source[index + 1] ?? ''
      if (/^[1-9]$/.test(escaped)) fallback = true
      if (escaped === 'd' || escaped === 'w') {
        python += inClass ? (escaped === 'd' ? '0-9' : 'A-Za-z0-9_') : (escaped === 'd' ? '[0-9]' : '[A-Za-z0-9_]')
        index++
        continue
      }
      if (escaped === 'D' || escaped === 'W') {
        if (inClass) classUntranslatable = true
        if (inClass) python += `\\${escaped}`
        else python += escaped === 'D' ? '[^0-9]' : '[^A-Za-z0-9_]'
        index++
        continue
      }
      python += `\\${escaped}`
      index++
      continue
    }
    if (character === '[') inClass = true
    if (character === ']') inClass = false
    python += character
  }
  return { python, fallback, classUntranslatable }
}

function hasLookaround(source: string): boolean {
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\\') {
      index++
      continue
    }
    if (source[index] !== '(') continue
    const rest = source.slice(index)
    if (rest.startsWith('(?=') || rest.startsWith('(?!') || rest.startsWith('(?<=') || rest.startsWith('(?<!')) {
      return true
    }
  }
  return false
}

function rewriteType(
  type: PyTypeExpr,
  mode: 'ecma' | 'raw' | 'python-re',
  owners: ReadonlySet<string>,
  result: ReturnType<typeof cloneIr>,
  pointer: string,
  fallbackModels: Set<string>,
): PyTypeExpr {
  return mapType(type, value => {
    if (value.kind !== 'constrained' || value.constraints.pattern === undefined) return value
    const source = value.constraints.pattern.source
    const translated = mode === 'ecma'
      ? translateEcma(source)
      : { python: source, fallback: false, classUntranslatable: false }
    if (translated.fallback) {
      for (const owner of owners) fallbackModels.add(owner)
      result.diagnostics.push({
        code: 'pydantic/regex-engine-fallback',
        severity: 'warning',
        pointer,
        message: owners.size === 0
          ? 'Regex pattern requires Python re but has no owning model'
          : `Regex pattern requires Python re for model(s) ${[...owners].sort().join(', ')}`,
      })
    }
    if (translated.classUntranslatable) {
      result.diagnostics.push({
        code: 'pydantic/regex-class-untranslatable',
        severity: 'warning',
        pointer,
        message: 'Regex class contains an ECMA escape that cannot be translated safely',
      })
    }
    return {
      ...value,
      constraints: { ...value.constraints, pattern: { source, python: translated.python } },
    }
  })
}

export const regexPass: PyPass<'regex'> = {
  name: 'regex',
  reads: ['regex'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    const byName = new Map(result.decls.map(decl => [decl.name, decl]))
    const refs = (type: PyTypeExpr): string[] => {
      const values: string[] = []
      visitType(type, value => { if (value.kind === 'ref') values.push(value.target) })
      return [...new Set(values)].sort((left, right) => left.localeCompare(right))
    }
    const ownerMap = new Map<string, Set<string>>()
    const fallbackModels = new Set<string>()
    const addOwner = (declName: string, owner: string): void => {
      const owners = ownerMap.get(declName) ?? new Set<string>()
      owners.add(owner)
      ownerMap.set(declName, owners)
    }
    const walk = (declName: string, owner: string, visiting: Set<string>): void => {
      if (visiting.has(declName)) return
      visiting.add(declName)
      addOwner(declName, owner)
      const decl = byName.get(declName)
      if (decl === undefined) return
      const types: PyTypeExpr[] = decl.kind === 'alias'
        ? [decl.type]
        : decl.kind === 'model'
          ? [
            ...decl.fields.map(field => field.type),
            ...(decl.openness.kind === 'typed-map' ? [decl.openness.value] : []),
          ]
          : []
      for (const type of types) {
        for (const target of refs(type)) {
          const targetDecl = byName.get(target)
          const follows = targetDecl?.kind === 'alias'
          if (follows) walk(target, owner, new Set(visiting))
        }
      }
    }
    for (const decl of result.decls) if (decl.kind === 'model') walk(decl.name, decl.name, new Set())
    for (const decl of result.decls) {
      if (decl.kind === 'model') {
        decl.regexEngine = options.regex === 'python-re' ? 'python-re' : 'rust-regex'
        const owners = ownerMap.get(decl.name) ?? new Set([decl.name])
        decl.fields = decl.fields.map(field => ({
          ...field,
          type: rewriteType(field.type, options.regex, owners, result, field.pointer, fallbackModels),
        }))
        if (decl.openness.kind === 'typed-map') decl.openness = {
          kind: 'typed-map',
          value: rewriteType(decl.openness.value, options.regex, owners, result, decl.pointer, fallbackModels),
        }
      } else if (decl.kind === 'alias') {
        decl.type = rewriteType(
          decl.type,
          options.regex,
          ownerMap.get(decl.name) ?? new Set(),
          result,
          decl.pointer,
          fallbackModels,
        )
      }
    }
    for (const decl of result.decls) {
      if (decl.kind === 'model' && fallbackModels.has(decl.name)) decl.regexEngine = 'python-re'
    }
    return result
  },
}
