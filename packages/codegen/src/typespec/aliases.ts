import type { Program, Type } from '@typespec/compiler'

export interface TypeSpecNamedAlias {
  name: string
  doc?: string | undefined
  kind: 'string-union' | 'number-union' | 'boolean-union' | 'mixed-union' | 'primitive'
  literals?: ReadonlyArray<string | number | boolean> | undefined
  tsType: string
}

const SCALAR_TS_MAP = new Map<string, string>([
  ['string', 'string'],
  ['boolean', 'boolean'],
  ['numeric', 'number'],
  ['integer', 'number'],
  ['float', 'number'],
  ['decimal', 'number'],
  ['decimal128', 'number'],
  ['int8', 'number'],
  ['int16', 'number'],
  ['int32', 'number'],
  ['int64', 'number'],
  ['uint8', 'number'],
  ['uint16', 'number'],
  ['uint32', 'number'],
  ['uint64', 'number'],
  ['safeint', 'number'],
  ['float32', 'number'],
  ['float64', 'number'],
  ['utcDateTime', 'string'],
  ['offsetDateTime', 'string'],
  ['plainDate', 'string'],
  ['plainTime', 'string'],
  ['duration', 'string'],
  ['url', 'string'],
])

function formatLiteral(value: string | number | boolean): string {
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    return `'${escaped}'`
  }
  return String(value)
}

function extractAstDoc(stmt: Record<string, unknown>): string | undefined {
  const docs = stmt.docs as Array<{ content?: Array<{ text?: string }> }> | undefined
  if (Array.isArray(docs) && docs.length > 0) {
    const text = docs
      .flatMap(d => (d.content ?? []).map(c => c.text ?? ''))
      .join('\n')
      .trim()
    if (text) return text
  }
  const decorators = stmt.decorators as Array<{ decorator?: { sv?: string }; arguments?: Array<{ value?: unknown }> }> | undefined
  if (Array.isArray(decorators)) {
    for (const dec of decorators) {
      if (dec.decorator?.sv === 'doc' && typeof dec.arguments?.[0]?.value === 'string') {
        const text = dec.arguments[0].value.trim()
        if (text) return text
      }
    }
  }
  return undefined
}

function resolveSemanticType(type: Type): Omit<TypeSpecNamedAlias, 'name' | 'doc'> | null {
  if (type.kind === 'Union') {
    const literals: Array<string | number | boolean> = []
    const tsParts: string[] = []
    let hasString = false
    let hasNumber = false
    let hasBoolean = false

    for (const variant of type.variants.values()) {
      const vt = variant.type
      if (vt.kind === 'String') {
        hasString = true
        literals.push(vt.value)
        tsParts.push(formatLiteral(vt.value))
      } else if (vt.kind === 'Number') {
        hasNumber = true
        literals.push(vt.value)
        tsParts.push(formatLiteral(vt.value))
      } else if (vt.kind === 'Boolean') {
        hasBoolean = true
        literals.push(vt.value)
        tsParts.push(formatLiteral(vt.value))
      } else {
        const inner = resolveSemanticType(vt)
        if (!inner) return null
        if (inner.kind === 'string-union' && inner.literals) hasString = true
        else if (inner.kind === 'number-union' && inner.literals) hasNumber = true
        else if (inner.kind === 'boolean-union' && inner.literals) hasBoolean = true
        else hasString = true
        if (inner.literals) literals.push(...inner.literals)
        tsParts.push(inner.tsType)
      }
    }

    if (tsParts.length === 0) return null
    const kindCount = Number(hasString) + Number(hasNumber) + Number(hasBoolean)
    const kind: TypeSpecNamedAlias['kind'] =
      kindCount > 1
        ? 'mixed-union'
        : hasString
          ? 'string-union'
          : hasNumber
            ? 'number-union'
            : 'boolean-union'

    return {
      kind,
      ...(literals.length > 0 ? { literals } : {}),
      tsType: tsParts.join(' | '),
    }
  }

  if (type.kind === 'String') {
    return { kind: 'primitive', literals: [type.value], tsType: formatLiteral(type.value) }
  }
  if (type.kind === 'Number') {
    return { kind: 'primitive', literals: [type.value], tsType: formatLiteral(type.value) }
  }
  if (type.kind === 'Boolean') {
    return { kind: 'primitive', literals: [type.value], tsType: formatLiteral(type.value) }
  }
  if (type.kind === 'Scalar') {
    const mapped = SCALAR_TS_MAP.get(type.name)
    if (mapped) {
      return { kind: 'primitive', tsType: mapped }
    }
  }

  return null
}

/**
 * Extracts named TypeSpec `alias` declarations from authored `.tsp` source files
 * (excluding `node_modules`) so literal unions and scalar aliases survive OpenAPI 3.1 emission.
 */
export function extractTypeSpecNamedAliases(program: Program): TypeSpecNamedAlias[] {
  const byName = new Map<string, TypeSpecNamedAlias>()

  const visitStatements = (stmts: ReadonlyArray<unknown> | undefined): void => {
    if (!Array.isArray(stmts)) return
    for (const rawStmt of stmts) {
      if (!rawStmt || typeof rawStmt !== 'object') continue
      const stmt = rawStmt as Record<string, unknown>

      if (
        'value' in stmt
        && 'templateParameters' in stmt
        && Array.isArray(stmt.templateParameters)
        && stmt.templateParameters.length === 0
      ) {
        const idNode = stmt.id as { sv?: string } | undefined
        const name = idNode?.sv?.trim()
        if (name && stmt.value) {
          try {
            const semType = program.checker.getTypeForNode(stmt.value as Parameters<Program['checker']['getTypeForNode']>[0])
            const resolved = resolveSemanticType(semType)
            if (resolved) {
              const doc = extractAstDoc(stmt)
              byName.set(name, {
                name,
                ...(doc ? { doc } : {}),
                ...resolved,
              })
            }
          } catch {
            // Skip unresolvable aliases safely
          }
        }
      }

      if (Array.isArray(stmt.statements)) {
        visitStatements(stmt.statements)
      }
    }
  }

  for (const [filePath, sf] of program.sourceFiles.entries()) {
    const normalized = filePath.replace(/\\/g, '/')
    if (normalized.includes('/node_modules/')) continue
    visitStatements(sf.statements)
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Renders `export type <Name> = ...` declarations for extracted named aliases
 * not already present in `existingNames`.
 */
export function renderNamedAliasDeclarations(
  aliases: readonly TypeSpecNamedAlias[],
  existingNames: ReadonlySet<string> = new Set(),
): string {
  const lines: string[] = []
  for (const alias of aliases) {
    if (existingNames.has(alias.name)) continue
    if (alias.doc) {
      lines.push(`/** ${alias.doc.replace(/\*\//g, '* /')} */`)
    }
    lines.push(`export type ${alias.name} = ${alias.tsType}`)
  }
  return lines.join('\n')
}
