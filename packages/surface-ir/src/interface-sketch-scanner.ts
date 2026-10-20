/**
 * @fileoverview Sub-Intent Module: TypeSpec (.tsp) declaration scanner for the Interface Sketch IR
 * @intent INTENT-OA-SKETCH-SCANNER
 * @parentIntent INTENT-OA-SKETCH-IR
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-02
 *
 * A dependency-free tokenizer and recursive-descent scanner for the declaration subset of
 * TypeSpec the sketch IR reads: namespaces, models, interfaces, unions and enums, with their
 * doc comments, decorators, template parameters, `extends` / `is` heritage, spreads and
 * operation signatures. Bodies are read with balanced-delimiter tracking, so anonymous
 * models (`meta: { tags: string[] }`) and anonymous op parameters stay inside their member.
 * Comments and string literals are tokens, so keywords inside them are never declarations.
 *
 * Anything the scanner cannot read is reported as a diagnostic instead of being skipped:
 * unterminated strings or comments, unbalanced delimiters, unreadable declaration headers and
 * members. Statements outside the IR (`import`, `using`, `alias`, `scalar`, `dec`, `fn`,
 * `const`, augment decorators, directives) are consumed without a diagnostic; top-level
 * operations are consumed with a warning because the IR records only interface operations.
 */

export type SketchDiagnosticCode =
  | 'sketch/syntax-error'
  | 'sketch/unbalanced-delimiter'
  | 'sketch/unsupported-statement'
  | 'sketch/unresolved-reference'
  | 'sketch/circular-reference'
  | 'sketch/operation-signature-reference'

export type SketchDiagnostic = {
  severity: 'error' | 'warning'
  code: SketchDiagnosticCode
  message: string
  /** 1-based source line */
  line: number
  /** 1-based source column */
  column: number
  /** Declaration the diagnostic belongs to, when known */
  symbol?: string
}

export type RawDecoratorArgument = { kind: 'string'; value: string } | { kind: 'expression'; text: string }

export type RawDecorator = {
  /** Last segment of the decorator name (`OaSdkTypeSpec.intent` -> `intent`) */
  name: string
  args: RawDecoratorArgument[]
}

export type RawMetadata = {
  /** Bodies of the doc comments (`/** ... *\/`) directly in front of the declaration */
  docs: string[]
  decorators: RawDecorator[]
}

export type RawSpread = { kind: 'spread'; ref: string; line: number; column: number }

export type RawField = {
  kind: 'field'
  name: string
  optional: boolean
  typeName: string
  meta: RawMetadata
}

export type RawModel = {
  name: string
  templateParameters: string[]
  heritage?: { kind: 'extends' | 'is'; ref: string }
  members: Array<RawField | RawSpread>
  meta: RawMetadata
  line: number
  column: number
}

export type RawParam = { kind: 'param'; name: string; optional: boolean; typeName: string } | RawSpread

export type RawOperation = {
  name: string
  params: RawParam[]
  returnType: string
  /** `op name is Other<...>;` — the signature comes from another operation */
  signatureRef?: string
  meta: RawMetadata
  line: number
  column: number
}

export type RawInterface = {
  name: string
  templateParameters: string[]
  extends: string[]
  operations: RawOperation[]
  meta: RawMetadata
  line: number
  column: number
}

export type RawVariant = { kind: 'variant'; name: string; value?: string; meta: RawMetadata }

export type RawUnionOrEnum = {
  kind: 'union' | 'enum'
  name: string
  templateParameters: string[]
  members: Array<RawVariant | RawSpread>
  meta: RawMetadata
  line: number
  column: number
}

export type SketchScanResult = {
  namespace?: string
  models: RawModel[]
  interfaces: RawInterface[]
  unionsAndEnums: RawUnionOrEnum[]
  diagnostics: SketchDiagnostic[]
}

type TokenKind = 'ident' | 'string' | 'number' | 'punct' | 'doc'

type Token = {
  kind: TokenKind
  /** Source text of the token */
  text: string
  /** Decoded value: identifier name, string contents, or doc comment body */
  value: string
  start: number
  end: number
}

const OPENERS: Readonly<Record<string, string>> = { '{': '}', '(': ')', '[': ']', '<': '>' }
const CLOSERS = new Set(['}', ')', ']', '>'])
const SKIPPED_STATEMENT_KEYWORDS = new Set(['import', 'using', 'alias', 'scalar', 'const', 'dec', 'extern', 'fn'])
const DIRECTIVES = new Set(['suppress', 'deprecated'])
const DECLARATION_KEYWORDS = new Set(['model', 'interface', 'union', 'enum', 'namespace', 'alias', 'scalar', 'import', 'using'])

/** Scans a TypeSpec source into raw declarations plus diagnostics for what could not be read. */
export function scanTypeSpecSketch(source: string): SketchScanResult {
  const diagnostics: SketchDiagnostic[] = []
  const lineStarts = computeLineStarts(source)
  const position = (offset: number): { line: number; column: number } => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if ((lineStarts[mid] ?? 0) <= offset) low = mid
      else high = mid - 1
    }
    return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 }
  }
  const report = (
    severity: SketchDiagnostic['severity'],
    code: SketchDiagnosticCode,
    offset: number,
    message: string,
    symbol?: string,
  ): void => {
    diagnostics.push({ severity, code, message, ...position(offset), ...(symbol ? { symbol } : {}) })
  }

  const tokens = tokenize(source, report)
  const parser = new DeclarationParser(tokens, source.length, report, position)
  const result = parser.parseFile()
  return { ...result, diagnostics }
}

type Reporter = (
  severity: SketchDiagnostic['severity'],
  code: SketchDiagnosticCode,
  offset: number,
  message: string,
  symbol?: string,
) => void

class DeclarationParser {
  private index = 0
  private namespace: string | undefined
  private readonly models: RawModel[] = []
  private readonly interfaces: RawInterface[] = []
  private readonly unionsAndEnums: RawUnionOrEnum[] = []

  constructor(
    private readonly tokens: readonly Token[],
    private readonly sourceLength: number,
    private readonly report: Reporter,
    private readonly position: (offset: number) => { line: number; column: number },
  ) {}

  parseFile(): Omit<SketchScanResult, 'diagnostics'> {
    this.parseStatements(false)
    return {
      ...(this.namespace ? { namespace: this.namespace } : {}),
      models: this.models,
      interfaces: this.interfaces,
      unionsAndEnums: this.unionsAndEnums,
    }
  }

  // ─── statements ──────────────────────────────────────────────────────────

  private parseStatements(insideBlock: boolean): void {
    const blockStart = this.previousOffset()
    while (!this.atEnd()) {
      const meta = this.parseMetadata()
      const token = this.peek()
      if (!token) break
      if (this.isPunct(token, '}')) {
        if (insideBlock) {
          this.index++
          return
        }
        this.report('error', 'sketch/unbalanced-delimiter', token.start, 'Unexpected `}` with no open block.')
        this.index++
        continue
      }
      if (this.isPunct(token, ';')) {
        this.index++
        continue
      }
      if (this.isPunct(token, '@')) {
        // `@@augment(Target, ...)` statement.
        this.skipStatement()
        continue
      }
      if (token.kind === 'ident') {
        switch (token.value) {
          case 'namespace':
            this.parseNamespace()
            continue
          case 'model':
            this.parseModel(meta)
            continue
          case 'interface':
            this.parseInterface(meta)
            continue
          case 'union':
          case 'enum':
            this.parseUnionOrEnum(meta, token.value)
            continue
          case 'op': {
            const name = this.peek(1)
            this.report(
              'warning',
              'sketch/unsupported-statement',
              token.start,
              `Operation ${name?.kind === 'ident' ? `"${name.value}" ` : ''}is declared outside an interface; the sketch IR records only interface operations.`,
              name?.kind === 'ident' ? name.value : undefined,
            )
            this.skipStatement()
            continue
          }
          default:
            if (SKIPPED_STATEMENT_KEYWORDS.has(token.value)) {
              this.skipStatement()
              continue
            }
        }
      }
      this.report('error', 'sketch/syntax-error', token.start, `Unexpected ${describe(token)} at statement start.`)
      this.skipStatement()
    }
    if (insideBlock) {
      this.report('error', 'sketch/unbalanced-delimiter', blockStart, 'Namespace block is not closed with `}`.')
    }
  }

  private parseNamespace(): void {
    const keyword = this.next()
    const name = this.parseDottedName()
    if (!name) {
      this.report('error', 'sketch/syntax-error', keyword.start, 'Expected a namespace name after `namespace`.')
      this.recoverStatement()
      return
    }
    if (!this.namespace) this.namespace = name
    const token = this.peek()
    if (token && this.isPunct(token, ';')) {
      this.index++
      return
    }
    if (token && this.isPunct(token, '{')) {
      this.index++
      this.parseStatements(true)
      return
    }
    this.report('error', 'sketch/syntax-error', token?.start ?? this.sourceLength, `Expected \`;\` or \`{\` after namespace ${name}.`, name)
    this.recoverStatement()
  }

  private parseModel(meta: RawMetadata): void {
    const keyword = this.next()
    const header = this.parseDeclarationHeader('model', keyword)
    if (!header) return
    const { name, templateParameters } = header
    let heritage: RawModel['heritage']
    const heritageToken = this.peek()
    if (heritageToken?.kind === 'ident' && (heritageToken.value === 'extends' || heritageToken.value === 'is')) {
      this.index++
      const ref = this.readExpression(new Set(['{', ';']))
      if (!ref) {
        this.report('error', 'sketch/syntax-error', heritageToken.start, `Expected a base model after \`${heritageToken.value}\`.`, name)
      } else {
        heritage = { kind: heritageToken.value, ref }
      }
    }

    const model: RawModel = {
      name,
      templateParameters,
      ...(heritage ? { heritage } : {}),
      members: [],
      meta,
      ...this.position(keyword.start),
    }
    const token = this.peek()
    if (token && this.isPunct(token, ';') && heritage?.kind === 'is') {
      this.index++
      this.models.push(model)
      return
    }
    if (!token || !this.isPunct(token, '{')) {
      this.report('error', 'sketch/syntax-error', token?.start ?? this.sourceLength, `Expected a \`{\` body for model ${name}.`, name)
      this.recoverStatement()
      this.models.push(model)
      return
    }
    this.index++
    this.parseBlockMembers(name, 'model', () => {
      const memberMeta = this.parseMetadata()
      const start = this.peek()
      if (!start || this.isPunct(start, '}')) return
      if (this.isPunct(start, '...')) {
        this.index++
        const ref = this.readExpression(new Set([';', ',']))
        if (ref) model.members.push({ kind: 'spread', ref, ...this.position(start.start) })
        else this.report('error', 'sketch/syntax-error', start.start, `Expected a model after \`...\` in ${name}.`, name)
        return
      }
      const field = this.parsePropertyLike(name, 'property')
      if (field) model.members.push({ kind: 'field', ...field, meta: memberMeta })
    })
    this.models.push(model)
  }

  private parseInterface(meta: RawMetadata): void {
    const keyword = this.next()
    const header = this.parseDeclarationHeader('interface', keyword)
    if (!header) return
    const { name, templateParameters } = header
    const extendsRefs: string[] = []
    const extendsToken = this.peek()
    if (extendsToken?.kind === 'ident' && extendsToken.value === 'extends') {
      this.index++
      for (;;) {
        const ref = this.readExpression(new Set(['{', ',', ';']))
        if (ref) extendsRefs.push(ref)
        const separator = this.peek()
        if (separator && this.isPunct(separator, ',')) {
          this.index++
          continue
        }
        break
      }
    }
    const iface: RawInterface = {
      name,
      templateParameters,
      extends: extendsRefs,
      operations: [],
      meta,
      ...this.position(keyword.start),
    }
    const token = this.peek()
    if (!token || !this.isPunct(token, '{')) {
      this.report('error', 'sketch/syntax-error', token?.start ?? this.sourceLength, `Expected a \`{\` body for interface ${name}.`, name)
      this.recoverStatement()
      this.interfaces.push(iface)
      return
    }
    this.index++
    this.parseBlockMembers(name, 'interface', () => {
      const opMeta = this.parseMetadata()
      let start = this.peek()
      if (!start || this.isPunct(start, '}')) return
      if (start.kind === 'ident' && start.value === 'op' && this.peek(1)?.kind === 'ident') {
        this.index++
        start = this.peek()
        if (!start) return
      }
      if (start.kind !== 'ident') {
        this.report('error', 'sketch/syntax-error', start.start, `Expected an operation in interface ${name}, found ${describe(start)}.`, name)
        this.skipToSeparator()
        return
      }
      this.index++
      const opName = start.value
      const symbol = `${name}.${opName}`
      if (this.peekPunct('<')) this.parseTemplateParameters()
      const location = this.position(start.start)
      if (this.peekPunct('(')) {
        const params = this.parseParameters(symbol)
        let returnType = 'void'
        if (this.peekPunct(':')) {
          this.index++
          returnType = this.readExpression(new Set([';', ','])) || 'void'
        } else {
          this.report('error', 'sketch/syntax-error', this.peek()?.start ?? this.sourceLength, `Expected \`:\` and a return type for operation ${symbol}.`, symbol)
          this.skipToSeparator()
        }
        iface.operations.push({ name: opName, params, returnType, meta: opMeta, ...location })
        return
      }
      const isToken = this.peek()
      if (isToken?.kind === 'ident' && isToken.value === 'is') {
        this.index++
        const signatureRef = this.readExpression(new Set([';', ',']))
        this.report(
          'warning',
          'sketch/operation-signature-reference',
          isToken.start,
          `Operation ${symbol} takes its signature from \`${signatureRef}\`; its parameters and return type are not expanded.`,
          symbol,
        )
        iface.operations.push({ name: opName, params: [], returnType: 'unknown', signatureRef, meta: opMeta, ...location })
        return
      }
      this.report('error', 'sketch/syntax-error', isToken?.start ?? this.sourceLength, `Expected \`(\` after operation name ${symbol}.`, symbol)
      this.skipToSeparator()
    })
    this.interfaces.push(iface)
  }

  private parseUnionOrEnum(meta: RawMetadata, kind: 'union' | 'enum'): void {
    const keyword = this.next()
    const header = this.parseDeclarationHeader(kind, keyword)
    if (!header) return
    const { name, templateParameters } = header
    const declaration: RawUnionOrEnum = {
      kind,
      name,
      templateParameters,
      members: [],
      meta,
      ...this.position(keyword.start),
    }
    const token = this.peek()
    if (!token || !this.isPunct(token, '{')) {
      this.report('error', 'sketch/syntax-error', token?.start ?? this.sourceLength, `Expected a \`{\` body for ${kind} ${name}.`, name)
      this.recoverStatement()
      this.unionsAndEnums.push(declaration)
      return
    }
    this.index++
    this.parseBlockMembers(name, kind, () => {
      const memberMeta = this.parseMetadata()
      const start = this.peek()
      if (!start || this.isPunct(start, '}')) return
      if (this.isPunct(start, '...')) {
        this.index++
        const ref = this.readExpression(new Set([';', ',']))
        if (ref) declaration.members.push({ kind: 'spread', ref, ...this.position(start.start) })
        return
      }
      const head = this.readExpression(new Set([':', ';', ',']))
      if (!head) {
        this.report('error', 'sketch/syntax-error', start.start, `Expected a member in ${kind} ${name}.`, name)
        this.skipToSeparator()
        return
      }
      if (this.peekPunct(':')) {
        this.index++
        const value = this.readExpression(new Set([';', ',']))
        declaration.members.push({ kind: 'variant', name: head, ...(value ? { value } : {}), meta: memberMeta })
        return
      }
      declaration.members.push({ kind: 'variant', name: head, meta: memberMeta })
    })
    this.unionsAndEnums.push(declaration)
  }

  // ─── members ─────────────────────────────────────────────────────────────

  /**
   * Reads `{ member (; | ,) ... }` after the opening brace. `parseMember` reads one member
   * (or nothing at the closing brace); the separator after it is consumed here.
   */
  private parseBlockMembers(symbol: string, kind: string, parseMember: () => void): void {
    const open = this.tokens[this.index - 1]
    for (;;) {
      const token = this.peek()
      if (!token) {
        this.report('error', 'sketch/unbalanced-delimiter', open?.start ?? this.sourceLength, `The body of ${kind} ${symbol} is not closed with \`}\`.`, symbol)
        return
      }
      if (this.isPunct(token, '}')) {
        this.index++
        return
      }
      if (this.isPunct(token, ';') || this.isPunct(token, ',')) {
        this.index++
        continue
      }
      if (this.startsDeclaration(kind === 'interface')) {
        // `model Foo` / `interface Bar` cannot be a member: the body was never closed.
        this.report('error', 'sketch/unbalanced-delimiter', open?.start ?? token.start, `The body of ${kind} ${symbol} is not closed with \`}\` before ${describe(token)} ${describe(this.peek(1) ?? token)}.`, symbol)
        return
      }
      const before = this.index
      parseMember()
      const after = this.peek()
      if (after && (this.isPunct(after, ';') || this.isPunct(after, ','))) {
        this.index++
      } else if (after && !this.isPunct(after, '}') && !this.startsDeclaration(kind === 'interface')) {
        this.report('error', 'sketch/syntax-error', after.start, `Expected \`;\` between members of ${kind} ${symbol}, found ${describe(after)}.`, symbol)
        this.skipToSeparator()
      }
      if (this.index === before) this.index++
    }
  }

  /** `name?: Type = default` — the name may be an identifier or a string literal. */
  private parsePropertyLike(
    owner: string,
    what: 'property' | 'parameter',
  ): { name: string; optional: boolean; typeName: string } | undefined {
    const nameToken = this.peek()
    if (!nameToken || (nameToken.kind !== 'ident' && nameToken.kind !== 'string')) {
      this.report('error', 'sketch/syntax-error', nameToken?.start ?? this.sourceLength, `Expected a ${what} name in ${owner}, found ${nameToken ? describe(nameToken) : 'end of input'}.`, owner)
      this.skipToSeparator()
      return undefined
    }
    this.index++
    let optional = false
    if (this.peekPunct('?')) {
      optional = true
      this.index++
    }
    if (!this.peekPunct(':')) {
      this.report('error', 'sketch/syntax-error', this.peek()?.start ?? this.sourceLength, `Expected \`:\` after ${what} ${nameToken.value} in ${owner}.`, owner)
      this.skipToSeparator()
      return undefined
    }
    this.index++
    const typeName = this.readExpression(new Set([';', ',', '=']))
    if (!typeName) {
      this.report('error', 'sketch/syntax-error', nameToken.start, `Expected a type for ${what} ${nameToken.value} in ${owner}.`, owner)
    }
    if (this.peekPunct('=')) {
      this.index++
      this.readExpression(new Set([';', ',']))
    }
    return { name: nameToken.value, optional, typeName: typeName || 'unknown' }
  }

  private parseParameters(symbol: string): RawParam[] {
    const open = this.next()
    const params: RawParam[] = []
    for (;;) {
      const token = this.peek()
      if (!token) {
        this.report('error', 'sketch/unbalanced-delimiter', open.start, `The parameter list of ${symbol} is not closed with \`)\`.`, symbol)
        return params
      }
      if (this.isPunct(token, ')')) {
        this.index++
        return params
      }
      if (this.isPunct(token, ',')) {
        this.index++
        continue
      }
      const before = this.index
      this.parseMetadata()
      const start = this.peek()
      if (start && this.isPunct(start, '...')) {
        this.index++
        const ref = this.readExpression(new Set([',']))
        if (ref) params.push({ kind: 'spread', ref, ...this.position(start.start) })
      } else if (start && !this.isPunct(start, ')')) {
        const param = this.parsePropertyLike(symbol, 'parameter')
        if (param) params.push({ kind: 'param', ...param })
      }
      const after = this.peek()
      if (after && !this.isPunct(after, ',') && !this.isPunct(after, ')')) {
        this.report('error', 'sketch/syntax-error', after.start, `Expected \`,\` or \`)\` in the parameter list of ${symbol}, found ${describe(after)}.`, symbol)
        this.skipUntil(new Set([',', ')']))
      }
      if (this.index === before) this.index++
    }
  }

  // ─── shared pieces ───────────────────────────────────────────────────────

  /**
   * A declaration keyword followed by a name (`model Foo`, `namespace Bar`) is never a
   * member: properties are `name: Type` and interface operations are `name(...)` or `op name(...)`.
   */
  private startsDeclaration(insideInterface: boolean, from = 0): boolean {
    let offset = from
    while (this.peek(offset)?.kind === 'doc') offset++
    const keyword = this.peek(offset)
    const name = this.peek(offset + 1)
    if (keyword?.kind !== 'ident' || name?.kind !== 'ident') return false
    if (keyword.value === 'op') return !insideInterface
    return DECLARATION_KEYWORDS.has(keyword.value)
  }

  private parseDeclarationHeader(
    kind: string,
    keyword: Token,
  ): { name: string; templateParameters: string[] } | undefined {
    const nameToken = this.peek()
    if (!nameToken || nameToken.kind !== 'ident') {
      this.report('error', 'sketch/syntax-error', nameToken?.start ?? keyword.end, `Expected a name after \`${kind}\`, found ${nameToken ? describe(nameToken) : 'end of input'}.`)
      this.recoverStatement()
      return undefined
    }
    this.index++
    const templateParameters = this.peekPunct('<') ? this.parseTemplateParameters() : []
    return { name: nameToken.value, templateParameters }
  }

  /** `<T, U extends Foo = Bar>` — keeps each parameter's name. */
  private parseTemplateParameters(): string[] {
    const open = this.next()
    const names: string[] = []
    let expectName = true
    let depth = 0
    for (;;) {
      const token = this.peek()
      if (!token) {
        this.report('error', 'sketch/unbalanced-delimiter', open.start, 'Template parameter list is not closed with `>`.')
        return names
      }
      this.index++
      if (depth === 0 && this.isPunct(token, '>')) return names
      if (depth === 0 && this.isPunct(token, ',')) {
        expectName = true
        continue
      }
      if (token.kind === 'punct' && OPENERS[token.text]) depth++
      else if (token.kind === 'punct' && CLOSERS.has(token.text)) depth--
      if (expectName && depth === 0 && token.kind === 'ident') names.push(token.value)
      expectName = false
    }
  }

  /** Doc comments, decorators and directives in front of a declaration or member. */
  private parseMetadata(): RawMetadata {
    const meta: RawMetadata = { docs: [], decorators: [] }
    for (;;) {
      const token = this.peek()
      if (!token) return meta
      if (token.kind === 'doc') {
        meta.docs.push(token.value)
        this.index++
        continue
      }
      if (this.isPunct(token, '#') && this.peek(1)?.kind === 'ident' && DIRECTIVES.has(this.peek(1)?.value ?? '')) {
        this.skipDirective(token)
        continue
      }
      if (this.isPunct(token, '@') && !this.isPunct(this.peek(1), '@')) {
        const decorator = this.parseDecorator()
        if (decorator) meta.decorators.push(decorator)
        continue
      }
      return meta
    }
  }

  private parseDecorator(): RawDecorator | undefined {
    const at = this.next()
    const name = this.parseDottedName()
    if (!name) {
      this.report('error', 'sketch/syntax-error', at.start, 'Expected a decorator name after `@`.')
      return undefined
    }
    const args: RawDecoratorArgument[] = []
    if (this.peekPunct('(')) {
      const open = this.next()
      let argTokens: Token[] = []
      let depth = 0
      const flush = (): void => {
        if (argTokens.length === 0) return
        const [only] = argTokens
        args.push(
          argTokens.length === 1 && only?.kind === 'string'
            ? { kind: 'string', value: only.value }
            : { kind: 'expression', text: joinTokens(argTokens) },
        )
        argTokens = []
      }
      for (;;) {
        const token = this.peek()
        if (!token) {
          this.report('error', 'sketch/unbalanced-delimiter', open.start, `Arguments of @${name} are not closed with \`)\`.`)
          break
        }
        this.index++
        if (depth === 0 && this.isPunct(token, ')')) break
        if (depth === 0 && this.isPunct(token, ',')) {
          flush()
          continue
        }
        if (token.kind === 'punct' && OPENERS[token.text]) depth++
        else if (token.kind === 'punct' && CLOSERS.has(token.text)) depth--
        argTokens.push(token)
      }
      flush()
    }
    const segments = name.split('.')
    return { name: segments[segments.length - 1] ?? name, args }
  }

  private parseDottedName(): string | undefined {
    const first = this.peek()
    if (!first || first.kind !== 'ident') return undefined
    this.index++
    const parts = [first.value]
    while (this.peekPunct('.') && this.peek(1)?.kind === 'ident') {
      this.index++
      parts.push(this.next().value)
    }
    return parts.join('.')
  }

  /**
   * Reads an expression up to a depth-0 stop token or the closer of an enclosing block,
   * tracking `{}`, `()`, `[]` and `<>`. Returns its normalized source text.
   */
  private readExpression(stops: ReadonlySet<string>): string {
    const collected: Token[] = []
    const stack: string[] = []
    for (;;) {
      const token = this.peek()
      if (!token) break
      if (stack.length === 0) {
        if (token.kind === 'punct' && (stops.has(token.text) || CLOSERS.has(token.text))) break
        // A type never contains `model Foo` or `op bar`: a missing `;` or `}` ends the expression here.
        if (this.startsDeclaration(false)) break
      }
      if (token.kind === 'punct' && OPENERS[token.text]) {
        stack.push(OPENERS[token.text] ?? '')
      } else if (token.kind === 'punct' && CLOSERS.has(token.text)) {
        const expected = stack.pop()
        if (expected !== token.text) {
          this.report('error', 'sketch/unbalanced-delimiter', token.start, `Unexpected \`${token.text}\`${expected ? `; expected \`${expected}\`` : ''}.`)
          if (expected === undefined) break
        }
      } else if (token.kind === 'doc') {
        this.index++
        continue
      }
      collected.push(token)
      this.index++
    }
    if (stack.length > 0) {
      this.report('error', 'sketch/unbalanced-delimiter', collected[0]?.start ?? this.sourceLength, `Expression is missing \`${stack[stack.length - 1]}\`.`)
    }
    return joinTokens(collected)
  }

  /**
   * Error recovery after an unreadable declaration header: skips the rest of the statement
   * unless the next token already starts another declaration, which is then parsed normally.
   */
  private recoverStatement(): void {
    if (!this.startsDeclaration(false)) this.skipStatement()
  }

  /** Skips one statement: up to a depth-0 `;`, or through a depth-0 `{ ... }` block. */
  private skipStatement(): void {
    const start = this.peek()
    let depth = 0
    for (;;) {
      const token = this.peek()
      if (!token) {
        if (depth > 0 && start) this.report('error', 'sketch/unbalanced-delimiter', start.start, 'Statement is not closed.')
        return
      }
      if (depth === 0 && token !== start && (this.isPunct(token, '}') || this.startsDeclaration(false))) return
      this.index++
      if (token.kind !== 'punct') continue
      if (OPENERS[token.text]) {
        depth++
        continue
      }
      if (CLOSERS.has(token.text)) {
        depth = Math.max(0, depth - 1)
        if (depth === 0 && token.text === '}') {
          if (this.peekPunct(';')) this.index++
          return
        }
        continue
      }
      if (depth === 0 && token.text === ';') return
    }
  }

  /** Skips to the next depth-0 `;` / `,` or the closer of the enclosing block, without consuming it. */
  private skipToSeparator(): void {
    this.skipUntil(new Set([';', ',']))
  }

  private skipUntil(stops: ReadonlySet<string>): void {
    let depth = 0
    for (;;) {
      const token = this.peek()
      if (!token) return
      if (depth === 0 && this.startsDeclaration(false)) return
      if (token.kind === 'punct') {
        if (depth === 0 && (stops.has(token.text) || CLOSERS.has(token.text))) return
        if (OPENERS[token.text]) depth++
        else if (CLOSERS.has(token.text)) depth--
      }
      this.index++
    }
  }

  /** `#suppress "code" "reason"` — runs to the end of its line. */
  private skipDirective(hash: Token): void {
    const line = this.position(hash.start).line
    this.index++
    while (!this.atEnd() && this.position(this.peek()?.start ?? 0).line === line) this.index++
  }

  private previousOffset(): number {
    return this.tokens[this.index - 1]?.start ?? 0
  }

  private atEnd(): boolean {
    return this.index >= this.tokens.length
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset]
  }

  private next(): Token {
    const token = this.tokens[this.index]
    this.index++
    if (!token) throw new Error('scanner advanced past the end of input')
    return token
  }

  private peekPunct(text: string): boolean {
    return this.isPunct(this.peek(), text)
  }

  private isPunct(token: Token | undefined, text: string): boolean {
    return token?.kind === 'punct' && token.text === text
  }
}

// ─── tokenizer ─────────────────────────────────────────────────────────────

const IDENT_START = /[\p{ID_Start}_$]/u
const IDENT_PART = /[\p{ID_Continue}$‌‍]/u
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/y

function tokenize(source: string, report: Reporter): Token[] {
  const tokens: Token[] = []
  let offset = 0
  while (offset < source.length) {
    const char = source[offset] ?? ''
    if (/\s/.test(char)) {
      offset++
      continue
    }
    if (source.startsWith('//', offset)) {
      const newline = source.indexOf('\n', offset)
      offset = newline < 0 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', offset)) {
      const close = source.indexOf('*/', offset + 2)
      if (close < 0) {
        report('error', 'sketch/syntax-error', offset, 'Comment is not closed with `*/`.')
        break
      }
      const isDoc = source.startsWith('/**', offset) && !source.startsWith('/**/', offset)
      if (isDoc) {
        tokens.push({ kind: 'doc', text: source.slice(offset, close + 2), value: source.slice(offset + 3, close), start: offset, end: close + 2 })
      }
      offset = close + 2
      continue
    }
    if (source.startsWith('"""', offset)) {
      const close = source.indexOf('"""', offset + 3)
      if (close < 0) {
        report('error', 'sketch/syntax-error', offset, 'Triple-quoted string is not closed with `"""`.')
        break
      }
      tokens.push({ kind: 'string', text: source.slice(offset, close + 3), value: source.slice(offset + 3, close), start: offset, end: close + 3 })
      offset = close + 3
      continue
    }
    if (char === '"' || char === '`') {
      const end = readQuoted(source, offset, char)
      if (end < 0) {
        report('error', 'sketch/syntax-error', offset, char === '"' ? 'String literal is not closed with `"`.' : 'Escaped identifier is not closed with `` ` ``.')
        const newline = source.indexOf('\n', offset)
        offset = newline < 0 ? source.length : newline + 1
        continue
      }
      const text = source.slice(offset, end)
      tokens.push({ kind: char === '"' ? 'string' : 'ident', text, value: unescape(text.slice(1, -1)), start: offset, end })
      offset = end
      continue
    }
    if (IDENT_START.test(char)) {
      let end = offset + 1
      while (end < source.length && IDENT_PART.test(source[end] ?? '')) end++
      const text = source.slice(offset, end)
      tokens.push({ kind: 'ident', text, value: text, start: offset, end })
      offset = end
      continue
    }
    NUMBER.lastIndex = offset
    const number = NUMBER.exec(source)
    if (number && number.index === offset) {
      tokens.push({ kind: 'number', text: number[0], value: number[0], start: offset, end: offset + number[0].length })
      offset += number[0].length
      continue
    }
    if (source.startsWith('...', offset)) {
      tokens.push({ kind: 'punct', text: '...', value: '...', start: offset, end: offset + 3 })
      offset += 3
      continue
    }
    tokens.push({ kind: 'punct', text: char, value: char, start: offset, end: offset + 1 })
    offset++
  }
  return tokens
}

/** Returns the offset after the closing quote, or -1 when the line ends first. */
function readQuoted(source: string, start: number, quote: string): number {
  let offset = start + 1
  while (offset < source.length) {
    const char = source[offset]
    if (char === '\\') {
      offset += 2
      continue
    }
    if (char === quote) return offset + 1
    if (char === '\n') return -1
    offset++
  }
  return -1
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, (_match, escaped: string) => {
    switch (escaped) {
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      default:
        return escaped
    }
  })
}

/** Joins tokens with one space wherever the source had whitespace or comments between them. */
function joinTokens(tokens: readonly Token[]): string {
  let text = ''
  let previous: Token | undefined
  for (const token of tokens) {
    if (previous && token.start > previous.end) text += ' '
    text += token.text
    previous = token
  }
  return text
}

function describe(token: Token): string {
  if (token.kind === 'ident') return `\`${token.text}\``
  if (token.kind === 'string') return 'a string literal'
  if (token.kind === 'number') return `number ${token.text}`
  if (token.kind === 'doc') return 'a doc comment'
  return `\`${token.text}\``
}

function computeLineStarts(source: string): number[] {
  const starts = [0]
  for (let offset = 0; offset < source.length; offset++) {
    if (source[offset] === '\n') starts.push(offset + 1)
  }
  return starts
}
