/**
 * @fileoverview TypeSpec type expressions of the Interface Sketch IR, parsed for emission.
 * @intent INTENT-OA-SKETCH-CODEGEN
 *
 * The sketch IR keeps field, parameter and return types as normalized TypeSpec text
 * (`string[]`, `Page<User>`, `"a" | "b"`, `{ tags: string[] }`). The emitters need their
 * structure to render JSON Schema, TypeScript and Python, so this module parses that text
 * into a small expression tree. Text it cannot read becomes an `opaque` node that every
 * renderer handles without producing invalid output.
 */

export type SketchTypeExpression =
  | { kind: 'reference'; name: string; args: SketchTypeExpression[] }
  | { kind: 'array'; element: SketchTypeExpression }
  | { kind: 'union'; options: SketchTypeExpression[] }
  | { kind: 'tuple'; items: SketchTypeExpression[] }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'object'; properties: SketchObjectProperty[] }
  | { kind: 'opaque'; text: string }

export type SketchObjectProperty = { name: string; optional: boolean; type: SketchTypeExpression }

type Token = { kind: 'ident' | 'string' | 'number' | 'punct'; text: string; value: string }

/** Parses one TypeSpec type expression; unreadable input yields an `opaque` node. */
export function parseSketchTypeExpression(text: string): SketchTypeExpression {
  const tokens = tokenizeType(text)
  if (!tokens) return { kind: 'opaque', text: text.trim() }
  const parser = new TypeParser(tokens)
  const expression = parser.parseUnion()
  return expression && parser.done() ? expression : { kind: 'opaque', text: text.trim() }
}

class TypeParser {
  private index = 0

  constructor(private readonly tokens: readonly Token[]) {}

  done(): boolean {
    return this.index === this.tokens.length
  }

  parseUnion(): SketchTypeExpression | undefined {
    if (this.peekPunct('|')) this.index++
    const first = this.parseArray()
    if (!first) return undefined
    const options = [first]
    while (this.peekPunct('|')) {
      this.index++
      const next = this.parseArray()
      if (!next) return undefined
      options.push(next)
    }
    return options.length === 1 ? first : { kind: 'union', options }
  }

  private parseArray(): SketchTypeExpression | undefined {
    let expression = this.parsePrimary()
    if (!expression) return undefined
    while (this.peekPunct('[') && this.peekPunct(']', 1)) {
      this.index += 2
      expression = { kind: 'array', element: expression }
    }
    return expression
  }

  private parsePrimary(): SketchTypeExpression | undefined {
    const token = this.tokens[this.index]
    if (!token) return undefined
    if (token.kind === 'string') {
      this.index++
      return { kind: 'string', value: token.value }
    }
    if (token.kind === 'number' || (this.peekPunct('-') && this.tokens[this.index + 1]?.kind === 'number')) {
      const negative = token.kind === 'punct'
      if (negative) this.index++
      const numberToken = this.tokens[this.index]
      this.index++
      const value = Number((numberToken?.text ?? '').replaceAll('_', ''))
      return Number.isFinite(value) ? { kind: 'number', value: negative ? -value : value } : undefined
    }
    if (token.kind === 'ident' && (token.value === 'true' || token.value === 'false')) {
      this.index++
      return { kind: 'boolean', value: token.value === 'true' }
    }
    if (this.peekPunct('(')) {
      this.index++
      const inner = this.parseUnion()
      if (!inner || !this.peekPunct(')')) return undefined
      this.index++
      return inner
    }
    if (this.peekPunct('[')) {
      this.index++
      const items: SketchTypeExpression[] = []
      while (!this.peekPunct(']')) {
        const item = this.parseUnion()
        if (!item) return undefined
        items.push(item)
        if (this.peekPunct(',')) this.index++
        else if (!this.peekPunct(']')) return undefined
      }
      this.index++
      return { kind: 'tuple', items }
    }
    if (this.peekPunct('{')) return this.parseObject()
    if (token.kind === 'ident') return this.parseReference()
    return undefined
  }

  private parseReference(): SketchTypeExpression | undefined {
    const parts = [this.tokens[this.index]?.value ?? '']
    this.index++
    while (this.peekPunct('.') && this.tokens[this.index + 1]?.kind === 'ident') {
      parts.push(this.tokens[this.index + 1]?.value ?? '')
      this.index += 2
    }
    const args: SketchTypeExpression[] = []
    if (this.peekPunct('<')) {
      this.index++
      while (!this.peekPunct('>')) {
        const arg = this.parseUnion()
        if (!arg) return undefined
        args.push(arg)
        if (this.peekPunct(',')) this.index++
        else if (!this.peekPunct('>')) return undefined
      }
      this.index++
    }
    return { kind: 'reference', name: parts.join('.'), args }
  }

  private parseObject(): SketchTypeExpression | undefined {
    this.index++
    const properties: SketchObjectProperty[] = []
    while (!this.peekPunct('}')) {
      if (this.peekPunct(';') || this.peekPunct(',')) {
        this.index++
        continue
      }
      const nameToken = this.tokens[this.index]
      if (!nameToken || (nameToken.kind !== 'ident' && nameToken.kind !== 'string')) return undefined
      this.index++
      let optional = false
      if (this.peekPunct('?')) {
        optional = true
        this.index++
      }
      if (!this.peekPunct(':')) return undefined
      this.index++
      const type = this.parseUnion()
      if (!type) return undefined
      properties.push({ name: nameToken.value, optional, type })
    }
    this.index++
    return { kind: 'object', properties }
  }

  private peekPunct(text: string, offset = 0): boolean {
    const token = this.tokens[this.index + offset]
    return token?.kind === 'punct' && token.text === text
  }
}

function tokenizeType(text: string): Token[] | undefined {
  const tokens: Token[] = []
  let offset = 0
  while (offset < text.length) {
    const char = text[offset] ?? ''
    if (/\s/.test(char)) {
      offset++
      continue
    }
    if (char === '"') {
      let end = offset + 1
      let value = ''
      while (end < text.length && text[end] !== '"') {
        if (text[end] === '\\') {
          value += text[end + 1] ?? ''
          end += 2
          continue
        }
        value += text[end]
        end++
      }
      if (end >= text.length) return undefined
      tokens.push({ kind: 'string', text: text.slice(offset, end + 1), value })
      offset = end + 1
      continue
    }
    const number = /^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/.exec(text.slice(offset))
    if (number) {
      tokens.push({ kind: 'number', text: number[0], value: number[0] })
      offset += number[0].length
      continue
    }
    const ident = /^(?:`[^`]*`|[\p{ID_Start}_$][\p{ID_Continue}$]*)/u.exec(text.slice(offset))
    if (ident) {
      const raw = ident[0]
      tokens.push({ kind: 'ident', text: raw, value: raw.startsWith('`') ? raw.slice(1, -1) : raw })
      offset += raw.length
      continue
    }
    tokens.push({ kind: 'punct', text: char, value: char })
    offset++
  }
  return tokens
}
