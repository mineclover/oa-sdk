/**
 * @fileoverview Intent-Unit Module: Phase D Implementation Contract Canary & Phase E Scrap Trigger Detector
 * @intent INTENT-OA-CONTRACT-CANARY
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-04
 */

import ts from 'typescript'

export type FrictionSignalKind =
  | 'signature-deviation'
  | 'escape-hatch'
  | 'lock-reflex'
  | 'workaround-marker'

export type FrictionSignal = {
  kind: FrictionSignalKind
  line: number
  snippet: string
  message: string
}

export type ContractCanaryOptions = {
  implementationSource: string
  language?: 'typescript' | 'python' | 'auto'
  contractedOperations?: readonly string[]
  contractedModels?: readonly string[]
  scrapThreshold?: number
}

export type ContractCanaryReport = {
  passed: boolean
  scrapRequired: boolean
  totalFrictionSignals: number
  unimplementedStubCount: number
  signatureDeviations: FrictionSignal[]
  escapeHatches: FrictionSignal[]
  lockReflexes: FrictionSignal[]
  workaroundMarkers: FrictionSignal[]
  recommendation: 'proceed' | 'fix-contract-violation' | 'scrap-and-redesign-tsp'
}

export type DetachedEvidenceReport = {
  valid: boolean
  discoveredAnchors: string[]
  missingAnchors: string[]
  inlineHtmlAnchorWarnings: string[]
}

type CanaryLanguage = 'typescript' | 'python'

type CanaryPattern = {
  regex: RegExp
  label: string
  /** Languages the construct exists in */
  languages: readonly CanaryLanguage[]
  /** `code`: matched against code with comments and string contents blanked; `comment`: against comment text */
  scope: 'code' | 'comment'
}

const ESCAPE_HATCH_PATTERNS: readonly CanaryPattern[] = [
  { regex: /:\s*any\b/, label: 'TypeScript `: any` type escape hatch', languages: ['typescript'], scope: 'code' },
  { regex: /\bas\s+any\b/, label: 'TypeScript `as any` cast escape hatch', languages: ['typescript'], scope: 'code' },
  { regex: /\bas\s+unknown\s+as\b/, label: 'TypeScript double cast `as unknown as` escape hatch', languages: ['typescript'], scope: 'code' },
  {
    // TypeScript honours the directive only at the start of a `//` or `/* */` comment.
    regex: /(?:\/\/|\/\*)[\s*]*@ts-(?:ignore|expect-error)\b/,
    label: 'TypeScript compiler suppression directive',
    languages: ['typescript'],
    scope: 'comment',
  },
  { regex: /:\s*Any\b/, label: 'Python `: Any` type escape hatch', languages: ['python'], scope: 'code' },
  { regex: /\bcast\s*\(/, label: 'Python `typing.cast()` escape hatch', languages: ['python'], scope: 'code' },
  { regex: /#\s*type:\s*ignore\b/, label: 'Python `# type: ignore` suppression', languages: ['python'], scope: 'comment' },
]

const LOCK_REFLEX_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  { regex: /\bthreading\.R?Lock\s*\(/, label: 'Python `threading.Lock` synchronization reflex' },
  { regex: /\basyncio\.Lock\s*\(/, label: 'Python `asyncio.Lock` synchronization reflex' },
  { regex: /\bnew\s+(?:Mutex|RWLock|Semaphore)\s*\(/, label: 'In-process Lock/Mutex synchronization reflex' },
]

const WORKAROUND_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  { regex: /(?:\/\/|#)\s*(?:workaround|HACK|FIXME|TEMP_PATCH)\b/i, label: 'Stacked workaround/HACK marker' },
]

const STUB_PATTERNS: ReadonlyArray<RegExp> = [
  /throw\s+new\s+Error\(\s*["']not implemented["']\s*\)/i,
  /raise\s+NotImplementedError\(\s*["']not implemented["']\s*\)/i,
]

/**
 * Lines that only Python has: `def f(`, `from x import y`, a bare `import x[, y]`, `class X:` / `class X(Base):`.
 * None of them is valid TypeScript, so a source without any is treated as TypeScript.
 */
const PYTHON_MARKER =
  /^[ \t]*(?:async[ \t]+)?def[ \t]+\w+[ \t]*\(|^[ \t]*from[ \t]+[\w.]+[ \t]+import[ \t]|^[ \t]*import[ \t]+[\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*[ \t]*$|^[ \t]*class[ \t]+\w+(?:\([^)\n]*\))?[ \t]*:/m

/**
 * Evaluates an implementation file against its `.tsp` contract during Phase D (`Implement`)
 * and triggers Phase E (`Scrap` -> return to `.tsp` Arena candidates) when $\ge 2$ combined
 * friction signals accumulate (`IUD-06`).
 *
 * The source is read with the rules of its language (`language`, or detected from the source
 * when `'auto'`): comments and string literals never count as code, so a `// TODO: placeOrder()`
 * note, a docstring or a quoted `"as any"` neither implements the contract nor raises a signal.
 * A contracted name counts only when the file binds it, never when it merely refers to it (a
 * call site such as `api.placeOrder()`, a property read, a parameter with its type and default,
 * a keyword argument):
 * - an operation, when the file defines it: a function, method, accessor, class field,
 *   interface or type-literal member, object-literal key, variable or value re-export in
 *   TypeScript; a `def` or a name a Python statement assigns or annotates (`place_order = ...`,
 *   `place_order: Handler`). Python is read by logical statement, so a keyword argument or a
 *   parameter on its own line of a multi-line call or `def` binds nothing, as on one line, and
 *   a statement after a compound header on the same line (`if ENABLED: place_order = make()`,
 *   `try: place_order = x`) binds as on a line of its own.
 *   Operations match by their contracted name or its snake_case form.
 * - a model, when the file declares it (class, interface, type alias, enum; Python class,
 *   `type` statement or alias) or imports it: any import binding (`import type { Order }`,
 *   `import * as Stub` + `Stub.Order`, `from .models import Order`, `import models` +
 *   `models.Order`) or re-export (`export type { Order } from`). So an implementation may take
 *   its models from a shared module or from the `sketch_stub.*` that `oa-gen sketch emit` writes.
 */
export function checkImplementationContract(options: ContractCanaryOptions): ContractCanaryReport {
  const {
    implementationSource,
    language = 'auto',
    contractedOperations = [],
    contractedModels = [],
    scrapThreshold = 2,
  } = options
  const lang: CanaryLanguage = language === 'auto' ? detectImplementationLanguage(implementationSource) : language

  const signatureDeviations: FrictionSignal[] = []
  const escapeHatches: FrictionSignal[] = []
  const lockReflexes: FrictionSignal[] = []
  const workaroundMarkers: FrictionSignal[] = []
  let unimplementedStubCount = 0

  const rawLines = implementationSource.split('\n')
  const views = maskSource(implementationSource, lang)
  const codeLines = views.code.split('\n')
  const codeWithStringLines = views.codeWithStrings.split('\n')
  const commentLines = views.comments.split('\n')
  const escapeHatchPatterns = ESCAPE_HATCH_PATTERNS.filter(pattern => pattern.languages.includes(lang))

  for (let idx = 0; idx < rawLines.length; idx++) {
    const snippet = (rawLines[idx] ?? '').replace(/\r$/, '').trim()
    const code = codeLines[idx] ?? ''
    const comment = commentLines[idx] ?? ''
    const lineNumber = idx + 1

    for (const stubRe of STUB_PATTERNS) {
      if (stubRe.test(codeWithStringLines[idx] ?? '')) unimplementedStubCount++
    }

    for (const pat of escapeHatchPatterns) {
      if (pat.regex.test(pat.scope === 'code' ? code : comment)) {
        escapeHatches.push({ kind: 'escape-hatch', line: lineNumber, snippet, message: pat.label })
      }
    }

    for (const pat of LOCK_REFLEX_PATTERNS) {
      if (pat.regex.test(code)) {
        lockReflexes.push({ kind: 'lock-reflex', line: lineNumber, snippet, message: pat.label })
      }
    }

    for (const pat of WORKAROUND_PATTERNS) {
      if (pat.regex.test(comment)) {
        workaroundMarkers.push({ kind: 'workaround-marker', line: lineNumber, snippet, message: pat.label })
      }
    }
  }

  const declarations =
    lang === 'typescript' ? collectTypeScriptDeclarations(implementationSource) : collectPythonDeclarations(views.code)

  for (const opName of contractedOperations) {
    const snakeOp = opName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    if (!declarations.operations.has(opName) && !declarations.operations.has(snakeOp)) {
      signatureDeviations.push({
        kind: 'signature-deviation',
        line: 1,
        snippet: opName,
        message: `Contracted operation "${opName}" (or "${snakeOp}") is missing from implementation.`,
      })
    }
  }

  for (const modelName of contractedModels) {
    if (!declarations.models.has(modelName)) {
      signatureDeviations.push({
        kind: 'signature-deviation',
        line: 1,
        snippet: modelName,
        message: `Contracted model "${modelName}" is missing from implementation.`,
      })
    }
  }

  const totalFrictionSignals =
    signatureDeviations.length +
    escapeHatches.length +
    lockReflexes.length +
    workaroundMarkers.length

  const scrapRequired = totalFrictionSignals >= scrapThreshold
  const passed = totalFrictionSignals === 0 && unimplementedStubCount === 0

  const recommendation = scrapRequired
    ? 'scrap-and-redesign-tsp'
    : passed
      ? 'proceed'
      : 'fix-contract-violation'

  return {
    passed,
    scrapRequired,
    totalFrictionSignals,
    unimplementedStubCount,
    signatureDeviations,
    escapeHatches,
    lockReflexes,
    workaroundMarkers,
    recommendation,
  }
}

function detectImplementationLanguage(source: string): CanaryLanguage {
  return PYTHON_MARKER.test(maskSource(source, 'python').code) ? 'python' : 'typescript'
}

type DeclaredNames = { operations: ReadonlySet<string>; models: ReadonlySet<string> }

/**
 * Names the TypeScript file binds, read from its AST.
 *
 * - Operations: functions, methods, accessors, class fields (constructor parameter properties too),
 *   interface and type-literal members, object-literal keys (a router such as
 *   `router({ placeOrder: ... })`), variables (including destructured ones), and value re-exports
 *   (`export { placeOrder } from`).
 * - Models: classes, interfaces, type aliases and enums; every import binding (default, named, also
 *   `import type`, namespace, `import X = ...`) under its imported and its local name; re-exports;
 *   `import('./m').X` types; and names reached through a namespace binding (`Stub.Order`).
 *
 * References bind nothing: a call site (`api.placeOrder()`), a property read, a comment or a string
 * does not make an operation or model present. Neither does a parameter: its name, the members of
 * its type (`deps: { placeOrder(): Order }`) and its default value bind no operation, although a model
 * it names (`order: Stub.Order`) counts.
 */
function collectTypeScriptDeclarations(source: string): DeclaredNames {
  const sourceFile = ts.createSourceFile('implementation.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const operations = new Set<string>()
  const models = new Set<string>()
  // Bindings that stand for a whole module or namespace (`import * as M`, `import M = ...`).
  const namespaces = new Set<string>()
  // `M.a.b` chains seen anywhere; resolved once every namespace binding is known.
  const qualifiedReferences: Array<{ root: string; name: string }> = []

  const visit = (node: ts.Node, inParameter: boolean): void => {
    if (ts.isParameter(node)) {
      // A constructor parameter property (`constructor(readonly placeOrder: Handler)`) is a class
      // field. Any other parameter binds no operation, nor does anything in its type or default value.
      if (isParameterProperty(node)) addBindingNames(operations, node.name)
      ts.forEachChild(node, child => visit(child, true))
      return
    }
    // Inside a parameter only model references count (`order: Stub.Order`).
    if (!inParameter) {
      if (
        ts.isFunctionDeclaration(node)
        || ts.isMethodDeclaration(node)
        || ts.isMethodSignature(node)
        || ts.isGetAccessorDeclaration(node)
        || ts.isSetAccessorDeclaration(node)
        || ts.isPropertyDeclaration(node)
        || ts.isPropertySignature(node)
        || ts.isPropertyAssignment(node)
        || ts.isShorthandPropertyAssignment(node)
      ) {
        addName(operations, node.name)
      } else if (ts.isVariableDeclaration(node)) {
        addBindingNames(operations, node.name)
      }
    }
    if (
      ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isEnumDeclaration(node)
    ) {
      addName(models, node.name)
    } else if (ts.isImportClause(node)) {
      addName(models, node.name)
    } else if (ts.isNamespaceImport(node)) {
      addName(models, node.name)
      namespaces.add(node.name.text)
    } else if (ts.isImportSpecifier(node)) {
      addName(models, node.propertyName)
      addName(models, node.name)
    } else if (ts.isImportEqualsDeclaration(node)) {
      addName(models, node.name)
      namespaces.add(node.name.text)
      if (!ts.isExternalModuleReference(node.moduleReference)) {
        for (const segment of entityNameSegments(node.moduleReference)) models.add(segment)
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const specifier of node.exportClause.elements) {
          addName(models, specifier.propertyName)
          addName(models, specifier.name)
          if (!node.isTypeOnly && !specifier.isTypeOnly) addName(operations, specifier.name)
        }
      } else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
        addName(models, node.exportClause.name)
      }
    } else if (ts.isImportTypeNode(node) && node.qualifier) {
      for (const segment of entityNameSegments(node.qualifier)) models.add(segment)
    } else if (ts.isQualifiedName(node)) {
      const root = rootIdentifier(node.left)
      if (root) qualifiedReferences.push({ root, name: node.right.text })
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
      const root = rootIdentifier(node.expression)
      if (root) qualifiedReferences.push({ root, name: node.name.text })
    }
    ts.forEachChild(node, child => visit(child, inParameter))
  }
  visit(sourceFile, false)

  for (const reference of qualifiedReferences) {
    if (namespaces.has(reference.root)) models.add(reference.name)
  }
  return { operations, models }
}

const PARAMETER_PROPERTY_MODIFIERS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.OverrideKeyword,
])

/** A constructor parameter written with an accessibility, `readonly` or `override` modifier declares a class property. */
function isParameterProperty(node: ts.ParameterDeclaration): boolean {
  return ts.getModifiers(node)?.some(modifier => PARAMETER_PROPERTY_MODIFIERS.has(modifier.kind)) ?? false
}

/** Leftmost identifier of `a.b.c` (a qualified type name or a property-access chain). */
function rootIdentifier(node: ts.Node): string | undefined {
  let current = node
  while (ts.isQualifiedName(current) || ts.isPropertyAccessExpression(current)) {
    current = ts.isQualifiedName(current) ? current.left : current.expression
  }
  return ts.isIdentifier(current) ? current.text : undefined
}

function entityNameSegments(name: ts.EntityName): string[] {
  return ts.isQualifiedName(name) ? [...entityNameSegments(name.left), name.right.text] : [name.text]
}

function addBindingNames(names: Set<string>, binding: ts.BindingName): void {
  if (ts.isIdentifier(binding)) {
    names.add(binding.text)
    return
  }
  for (const element of binding.elements) {
    if (ts.isBindingElement(element)) addBindingNames(names, element.name)
  }
}

function addName(names: Set<string>, name: ts.Node | undefined): void {
  if (!name) return
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    names.add(name.text)
  } else if (ts.isPrivateIdentifier(name)) {
    names.add(name.text.replace(/^#/, ''))
  }
}

const PYTHON_IDENTIFIER = /^[A-Za-z_]\w*$/

/** Python's reserved words, which never name a binding (`True = ...` binds nothing). */
const PYTHON_KEYWORDS: ReadonlySet<string> = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
])

function isPythonName(text: string): boolean {
  return PYTHON_IDENTIFIER.test(text) && !PYTHON_KEYWORDS.has(text)
}

/**
 * Names the Python file binds, read statement by statement from its code with comments and string
 * contents blanked (see {@link pythonStatements}).
 *
 * - Operations: `def` / `async def`, and every name a statement assigns or annotates
 *   (`place_order = ...`, `place_order: Handler`, `place_order, cancel_order = ...`).
 * - Models: `class`, PEP 695 `type X = ...`, assigned names (type aliases), every name an import binds
 *   (`from m import X as Y` binds X and Y; `import a.b` binds `a`; `import a.b as M` binds M), and
 *   names reached through an imported binding (`models.Order`).
 *
 * Only the start of a statement can bind, so a keyword argument or a parameter written on its own
 * line inside a multi-line call or `def` binds nothing, exactly as on one line. A compound
 * statement's header (`if ...:`, `else:`, `try:`, `def f(...):`, see {@link pythonCompoundHeader})
 * binds only a `def` or `class` name, and the simple statements after its colon on the same line
 * bind like any other statement (`if ENABLED: place_order = make()`, `else: place_order = x`). A
 * call site, an attribute of another object, a comment or a docstring binds nothing either.
 */
function collectPythonDeclarations(code: string): DeclaredNames {
  const operations = new Set<string>()
  const models = new Set<string>()
  // Bindings an attribute can be read through (`import models` -> `models.Order`).
  const importBindings = new Set<string>()

  for (const logicalStatement of pythonStatements(code)) {
    let statement = logicalStatement
    for (let header = pythonCompoundHeader(statement); header; header = pythonCompoundHeader(statement)) {
      if (header.definition) operations.add(header.definition)
      if (header.declaration) models.add(header.declaration)
      statement = header.body
    }
    // PEP 695 `type X = ...` / `type X[T] = ...`.
    const typeAlias = /^\s*type\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*=(?!=)/.exec(statement)
    if (typeAlias?.[1]) {
      models.add(typeAlias[1])
      continue
    }
    // `from m import X [as Y], ...`, also parenthesised over several lines.
    const fromImport = /^\s*from\s+[.\w]+\s+import\s+([\s\S]*)$/.exec(statement)
    if (fromImport) {
      for (const item of importItems(fromImport[1] ?? '')) {
        if (!PYTHON_IDENTIFIER.test(item.name)) continue
        models.add(item.name)
        const binding = item.alias ?? item.name
        models.add(binding)
        importBindings.add(binding)
      }
      continue
    }
    // `import a.b [as M], ...`: binds M, or the top-level package `a`.
    const moduleImport = /^\s*import\s+([\s\S]*)$/.exec(statement)
    if (moduleImport) {
      for (const item of importItems(moduleImport[1] ?? '')) {
        const binding = item.alias ?? item.name.split('.')[0] ?? ''
        if (!PYTHON_IDENTIFIER.test(binding)) continue
        models.add(binding)
        importBindings.add(binding)
      }
      continue
    }
    for (const name of pythonAssignedNames(statement)) {
      operations.add(name)
      models.add(name)
    }
  }

  for (const match of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)((?:[ \t]*\.[ \t]*[A-Za-z_]\w*)+)/g)) {
    if (!match[1] || !importBindings.has(match[1])) continue
    for (const segment of (match[2] ?? '').split('.')) {
      const name = segment.trim()
      if (name) models.add(name)
    }
  }
  return { operations, models }
}

/** A compound-statement header at the start of a logical statement, and what its colon is followed by. */
type PythonCompoundHeader = {
  /** The name a `def` / `async def` header defines. */
  readonly definition?: string
  /** The name a `class` header declares. */
  readonly declaration?: string
  /** The simple statements after the header's colon on the same line (blank for a block on the next lines). */
  readonly body: string
}

/** `def f(` / `async def f[T](`: the defined name, before its type or value parameter list. */
const PYTHON_DEF_HEADER = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)(?=\s*[([])/
/** `class C`, before its `[T]`, `(Base)` or colon. */
const PYTHON_CLASS_HEADER = /^\s*class\s+([A-Za-z_]\w*)(?!\w)/
/** Clause keywords followed by a condition, target list, context manager, exception or pattern, then the colon. */
const PYTHON_CLAUSE_HEADER = /^\s*(?:(?:async\s+)?(?:for|with)|if|elif|while|except(?:\s*\*)?|case)(?!\w)/
/** Clause keywords followed directly by the colon. */
const PYTHON_BARE_CLAUSE_HEADER = /^\s*(?:else|try|finally|except)\s*:/

/**
 * The compound-statement header `statement` starts with, if any: `if/elif/while ... :`,
 * `for ... in ... :`, `with ... :`, `except ... :`, `case ... :` (each also with `async` where
 * Python allows it), `else:`, `try:`, `finally:`, `def f(...) -> T:` or `class C(...):`. Its
 * colon is the first one outside brackets that is not a walrus `:=` and does not end a `lambda`
 * parameter list, so `if (n := len(xs)) > 1:`, `with open(p, "r") as f:`,
 * `def f(x: int = 1) -> dict[str, int]:` and `if key(lambda v: v):` are read whole. A clause
 * keyword with nothing before its colon opens no header: `case: int = 1` annotates a variable
 * named by the soft keyword `case`. A `def` or `class` without a colon (an incomplete statement)
 * still defines its name.
 */
function pythonCompoundHeader(statement: string): PythonCompoundHeader | undefined {
  const bare = PYTHON_BARE_CLAUSE_HEADER.exec(statement)
  if (bare) return { body: statement.slice(bare[0].length) }
  const definition = PYTHON_DEF_HEADER.exec(statement)
  const declaration = definition ? null : PYTHON_CLASS_HEADER.exec(statement)
  const clause = (definition ?? declaration) ? null : PYTHON_CLAUSE_HEADER.exec(statement)
  const opening = definition ?? declaration ?? clause
  if (!opening) return undefined
  const colon = pythonHeaderColon(statement, opening[0].length)
  if (clause && (colon === undefined || statement.slice(opening[0].length, colon).trim() === '')) return undefined
  return {
    ...(definition?.[1] ? { definition: definition[1] } : {}),
    ...(declaration?.[1] ? { declaration: declaration[1] } : {}),
    body: colon === undefined ? '' : statement.slice(colon + 1),
  }
}

/**
 * The index of the colon that ends a compound-statement header, searching `text` from `from`:
 * the first `:` outside brackets that is no walrus `:=` and closes no `lambda` opened outside
 * brackets before it.
 */
function pythonHeaderColon(text: string, from: number): number | undefined {
  let depth = 0
  let openLambdas = 0
  for (let index = from; index < text.length; index++) {
    const char = text[index] ?? ''
    if ('([{'.includes(char)) {
      depth++
    } else if (')]}'.includes(char)) {
      depth = Math.max(0, depth - 1)
    } else if (depth > 0) {
      continue
    } else if (char === ':' && text[index + 1] !== '=') {
      if (openLambdas === 0) return index
      openLambdas--
    } else if (startsPythonWord(text, index, 'lambda')) {
      openLambdas++
      index += 'lambda'.length - 1
    }
  }
  return undefined
}

/** Whether the word `word` (not part of a longer identifier) starts at `text[index]`. */
function startsPythonWord(text: string, index: number, word: string): boolean {
  return text.startsWith(word, index)
    && !/\w/.test(text[index - 1] ?? '')
    && !/\w/.test(text[index + word.length] ?? '')
}

/**
 * The simple statements of Python code whose comments and string contents are blanked. A line
 * break inside `(`, `[` or `{` or after a trailing `\` continues the statement (implicit and
 * explicit line joining), and a `;` outside brackets separates two statements on one line.
 */
function pythonStatements(code: string): string[] {
  const statements: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < code.length; index++) {
    const char = code[index]
    if (char === '(' || char === '[' || char === '{') {
      depth++
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1)
    } else if (char === '\\') {
      // A backslash outside a string only appears as an explicit line join: skip its line break.
      if (code[index + 1] === '\r') index++
      if (code[index + 1] === '\n') index++
    } else if (depth === 0 && (char === '\n' || char === ';')) {
      statements.push(code.slice(start, index))
      start = index + 1
    }
  }
  statements.push(code.slice(start))
  return statements.map(statement => statement.replace(/\\\r?\n/g, ' '))
}

/**
 * Plain names a simple statement binds: the annotated name of `name: T [= v]`, or every name in the
 * targets of `a = v`, `a = b = v` and `a, (b, *c) = v`. An attribute or subscript target
 * (`self.x = v`, `d[k] = v`) binds no plain name.
 */
function pythonAssignedNames(statement: string): string[] {
  const annotated = /^\s*([A-Za-z_]\w*)\s*:(?!=)/.exec(statement)
  if (annotated?.[1]) return isPythonName(annotated[1]) ? [annotated[1]] : []
  const segments = splitTopLevel(statement, (text, index) => isPythonAssignmentOperator(text, index))
  return segments.slice(0, -1).flatMap(pythonTargetNames)
}

/** Whether `text[index]` is the `=` of an assignment (not `==`, `!=`, `<=`, `>=`, `:=` or `+=`-style). */
function isPythonAssignmentOperator(text: string, index: number): boolean {
  return text[index] === '=' && text[index + 1] !== '=' && !'=!<>:+-*/%&|^@~'.includes(text[index - 1] ?? ' ')
}

/** Plain names an assignment target binds: `a`, `*a`, `a, b`, `(a, [b, *c])`. */
function pythonTargetNames(target: string): string[] {
  const trimmed = target.trim().replace(/^\*\s*/, '')
  if (isPythonName(trimmed)) return [trimmed]
  const inner = enclosedContent(trimmed)
  const elements = splitTopLevel(inner ?? trimmed, (text, index) => text[index] === ',')
  if (inner === undefined && elements.length < 2) return []
  return elements.flatMap(pythonTargetNames)
}

/** `(x)` / `[x]` -> `x` when the first bracket closes at the end of `text`; otherwise `undefined`. */
function enclosedContent(text: string): string | undefined {
  const close = text[0] === '(' ? ')' : text[0] === '[' ? ']' : undefined
  if (close === undefined || !text.endsWith(close)) return undefined
  let depth = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? ''
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    if (depth === 0) return index === text.length - 1 ? text.slice(1, -1) : undefined
  }
  return undefined
}

/** Splits `text` at every position outside brackets where `isSeparator` holds. */
function splitTopLevel(text: string, isSeparator: (text: string, index: number) => boolean): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? ''
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth = Math.max(0, depth - 1)
    else if (depth === 0 && isSeparator(text, index)) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** `X as Y, a.b, (c)` -> `[{ name: 'X', alias: 'Y' }, { name: 'a.b' }, { name: 'c' }]`; `*` is skipped. */
function importItems(clause: string): Array<{ name: string; alias?: string }> {
  const items: Array<{ name: string; alias?: string }> = []
  for (const part of clause.replace(/[()]/g, ' ').split(',')) {
    const item = /^\s*([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(part)
    if (!item?.[1]) continue
    items.push(item[2] ? { name: item[1], alias: item[2] } : { name: item[1] })
  }
  return items
}

type MaskedViews = {
  /** Code only: comments and string contents are spaces (quote characters stay) */
  code: string
  /** Code and string literals: only comments are spaces */
  codeWithStrings: string
  /** Comment text only: everything else is spaces */
  comments: string
}

type CharClass = 'code' | 'string' | 'comment'

/**
 * Classifies every character of `source` as code, string contents or comment, by the lexical
 * rules of `language`, and returns three same-length views. Line breaks are kept in every view,
 * so line N of a view is line N of the source.
 */
function maskSource(source: string, language: CanaryLanguage): MaskedViews {
  const classes: CharClass[] = language === 'python' ? classifyPython(source) : classifyTypeScript(source)
  let code = ''
  let codeWithStrings = ''
  let comments = ''
  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? ''
    if (char === '\n') {
      code += char
      codeWithStrings += char
      comments += char
      continue
    }
    const charClass = classes[index]
    code += charClass === 'code' ? char : ' '
    codeWithStrings += charClass === 'comment' ? ' ' : char
    comments += charClass === 'comment' ? char : ' '
  }
  return { code, codeWithStrings, comments }
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
])

/** TypeScript: `//` and `/* *\/` comments; `'`, `"`, template literals (with `${}` code) and regex literals. */
function classifyTypeScript(source: string): CharClass[] {
  const classes: CharClass[] = new Array<CharClass>(source.length).fill('code')
  const mark = (from: number, to: number, charClass: CharClass): void => {
    for (let index = from; index < to && index < source.length; index++) classes[index] = charClass
  }
  // Brace depth of each open `${ ... }` substitution, innermost last.
  const templateDepths: number[] = []
  let lastSignificant = ''
  let lastWord = ''
  let index = 0

  const readTemplate = (start: number): number => {
    // `start` is just after a backtick or the `}` closing a substitution.
    let cursor = start
    while (cursor < source.length) {
      const char = source[cursor]
      if (char === '\\') {
        cursor += 2
        continue
      }
      if (char === '`') {
        mark(start, cursor, 'string')
        return cursor + 1
      }
      if (char === '$' && source[cursor + 1] === '{') {
        mark(start, cursor, 'string')
        templateDepths.push(0)
        return cursor + 2
      }
      cursor++
    }
    mark(start, source.length, 'string')
    return source.length
  }

  while (index < source.length) {
    const char = source[index] ?? ''
    const nextChar = source[index + 1]
    if (char === '/' && nextChar === '/') {
      const end = source.indexOf('\n', index)
      const stop = end < 0 ? source.length : end
      mark(index, stop, 'comment')
      index = stop
      continue
    }
    if (char === '/' && nextChar === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end < 0 ? source.length : end + 2
      mark(index, stop, 'comment')
      index = stop
      continue
    }
    if (char === '"' || char === "'") {
      const end = readQuotedEnd(source, index, char)
      mark(index + 1, end - 1, 'string')
      index = end
      lastSignificant = char
      lastWord = ''
      continue
    }
    if (char === '`') {
      index = readTemplate(index + 1)
      lastSignificant = '`'
      lastWord = ''
      continue
    }
    if (char === '{' && templateDepths.length > 0) {
      templateDepths[templateDepths.length - 1] = (templateDepths[templateDepths.length - 1] ?? 0) + 1
    } else if (char === '}' && templateDepths.length > 0) {
      const depth = templateDepths[templateDepths.length - 1] ?? 0
      if (depth === 0) {
        templateDepths.pop()
        index = readTemplate(index + 1)
        lastSignificant = '`'
        lastWord = ''
        continue
      }
      templateDepths[templateDepths.length - 1] = depth - 1
    }
    if (char === '/' && startsRegex(lastSignificant, lastWord)) {
      const end = readRegexEnd(source, index)
      mark(index + 1, end, 'string')
      index = end
      lastSignificant = '/'
      lastWord = ''
      continue
    }
    if (/[A-Za-z0-9_$]/.test(char)) {
      let end = index + 1
      while (end < source.length && /[A-Za-z0-9_$]/.test(source[end] ?? '')) end++
      lastWord = source.slice(index, end)
      lastSignificant = 'w'
      index = end
      continue
    }
    if (!/\s/.test(char)) {
      lastSignificant = char
      lastWord = ''
    }
    index++
  }
  return classes
}

function startsRegex(lastSignificant: string, lastWord: string): boolean {
  if (lastSignificant === '') return true
  if (lastSignificant === 'w') return REGEX_PRECEDING_KEYWORDS.has(lastWord)
  return '(,=:[!&|?{};+-*%<>~^'.includes(lastSignificant)
}

/** Offset after a regex literal's closing `/` and flags (or the end of its line when unterminated). */
function readRegexEnd(source: string, start: number): number {
  let cursor = start + 1
  let inClass = false
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '\n') return cursor
    if (char === '\\') {
      cursor += 2
      continue
    }
    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) {
      cursor++
      while (cursor < source.length && /[a-z]/i.test(source[cursor] ?? '')) cursor++
      return cursor
    }
    cursor++
  }
  return cursor
}

/** Offset after the closing quote of a one-line string (or the end of its line when unterminated). */
function readQuotedEnd(source: string, start: number, quote: string): number {
  let cursor = start + 1
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '\\') {
      cursor += 2
      continue
    }
    if (char === quote) return cursor + 1
    if (char === '\n') return cursor
    cursor++
  }
  return cursor
}

/** Python: `#` comments; single, triple-quoted and prefixed (`r`, `b`, `f`, `u`) strings. */
function classifyPython(source: string): CharClass[] {
  const classes: CharClass[] = new Array<CharClass>(source.length).fill('code')
  const mark = (from: number, to: number, charClass: CharClass): void => {
    for (let index = from; index < to && index < source.length; index++) classes[index] = charClass
  }
  let index = 0
  while (index < source.length) {
    const char = source[index] ?? ''
    if (char === '#') {
      const end = source.indexOf('\n', index)
      const stop = end < 0 ? source.length : end
      mark(index, stop, 'comment')
      index = stop
      continue
    }
    if (/\w/.test(char)) {
      // Identifiers (and string prefixes such as `r`, `b`, `f`, `rb`) are code; a quote right
      // after a prefix starts the string on the next iteration.
      let end = index + 1
      while (end < source.length && /\w/.test(source[end] ?? '')) end++
      index = end
      continue
    }
    if (char === '"' || char === "'") {
      const triple = source.startsWith(char.repeat(3), index)
      if (triple) {
        const close = source.indexOf(char.repeat(3), index + 3)
        const stop = close < 0 ? source.length : close
        mark(index + 3, stop, 'string')
        index = close < 0 ? source.length : close + 3
        continue
      }
      const end = readQuotedEnd(source, index, char)
      mark(index + 1, end - 1, 'string')
      index = end
      continue
    }
    index++
  }
  return classes
}

/**
 * Validates detached evidence review Markdown documents (`evidence/*.md`) for required
 * `#anchor` targets using code-fence masking and 3-way anchor classification (`IUD-02`, `ANCH-10`).
 */
export function validateDetachedEvidenceMarkdown(
  markdownContent: string,
  requiredAnchors: readonly string[],
): DetachedEvidenceReport {
  const discovered = new Set<string>()
  const inlineHtmlAnchorWarnings: string[] = []
  const lines = markdownContent.split(/\r?\n/)
  let inFence = false

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? ''
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const htmlMatch = /<a\s+[^>]*?\b(?:id|name)=["']([^"']+)["']/i.exec(line)
    if (htmlMatch?.[1]) {
      const id = htmlMatch[1].trim()
      discovered.add(id)
      inlineHtmlAnchorWarnings.push(
        `Line ${idx + 1}: Inline HTML anchor "#${id}" is recognized for compatibility only; prefer {#${id}} heading syntax.`,
      )
    }

    const headingMatch = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line)
    if (!headingMatch?.[1]) continue

    let rawHeading = headingMatch[1]
    const customMatch = /\{#([A-Za-z0-9._:-]+)\}\s*$/.exec(rawHeading)
    if (customMatch?.[1]) {
      discovered.add(customMatch[1])
      rawHeading = rawHeading.slice(0, customMatch.index).trim()
    }

    const cleanSlug = rawHeading
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
    if (cleanSlug) {
      discovered.add(cleanSlug)
    }
  }

  const missingAnchors = requiredAnchors
    .map(a => a.replace(/^#/, ''))
    .filter(a => !discovered.has(a))

  return {
    valid: missingAnchors.length === 0,
    discoveredAnchors: [...discovered].sort(),
    missingAnchors,
    inlineHtmlAnchorWarnings,
  }
}
