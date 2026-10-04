import * as fs from 'node:fs'
import * as path from 'node:path'
import type * as tsType from 'typescript'
import type { Command } from '../lib/types.js'
import { str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'

import { createRequire } from 'node:module'

let cachedTs: typeof tsType | undefined

export async function getTs(): Promise<typeof tsType> {
  if (cachedTs) return cachedTs
  const modName = ['type', 'script'].join('')
  try {
    const req = createRequire(import.meta.url)
    cachedTs = req(modName) as unknown as typeof tsType
    return cachedTs
  } catch {
    const dynamicImport = new Function('s', 'return import(s)')
    const imported = (await dynamicImport(modName)) as { default?: typeof tsType }
    cachedTs = (imported.default ?? imported) as unknown as typeof tsType
    return cachedTs
  }
}

/** 전역 호출 대상이 호출되는 형태. `call`은 `name(...)`, `construct`는 `new name(...)`이다. */
export type CspInvocationKind = 'call' | 'construct'

/**
 * 전역 호출 대상이 위반이 되려면 인자가 만족해야 하는 조건.
 * - `any`: 인자와 무관하게 호출 자체가 위반이다.
 * - `string-code`: 첫 번째 인자가 문자열 리터럴 또는 템플릿 리터럴(코드 문자열)일 때만 위반이다.
 */
export type CspArgumentCondition = 'any' | 'string-code'

export interface CspCallTargetRule {
  readonly rule: `csp/${string}`
  readonly argument: CspArgumentCondition
  /** 위반으로 보는 호출 형태와 그 메시지. 없는 형태는 허용한다. */
  readonly invocations: { readonly [K in CspInvocationKind]?: string }
}

export interface CspModuleRoot {
  /** 패키지 이름 또는 스코프. 지정자가 `<name>` 또는 `<name>/...`이면 금지한다. */
  readonly name: string
  /** `ajv-formats`처럼 `<name>-<suffix>` 형태의 동반 패키지도 금지할지 여부. */
  readonly dashVariants: boolean
}

export interface CspModuleReference {
  /**
   * 이 구문에 항상 나타나는 단어. 사전 검사는 이 단어가 독립 토큰으로(멤버 이름 `x.word`가 아니게)
   * 나타나는 파일만 AST 검사로 넘긴다.
   */
  readonly keyword: string
  readonly message: string
}

export interface CspRuleTable {
  /** 전역 이름 → 규칙. `name`, `(0, name)`, `window.name` 같은 전역 참조만 검사한다. */
  readonly callTargets: { readonly [globalName: string]: CspCallTargetRule }
  readonly modules: {
    readonly rule: `csp/${string}`
    readonly roots: readonly CspModuleRoot[]
    /** 모듈 지정자를 담는 구문별 정의. 구문 → 지정자 추출은 MODULE_REFERENCE_EXTRACTORS가 맡는다. */
    readonly references: { readonly [form: string]: CspModuleReference }
  }
}

/**
 * audit:csp 규칙 표. AST 검사와 어휘 사전 검사(mayContainCspViolation)는 모두 이 표에서 도출한다.
 *
 * 규칙을 추가/변경할 때는 이 표만 고치면 사전 검사가 함께 바뀐다. 새 규칙 ID는
 * `src/__tests__/audit-csp-prefilter.test.ts`의 규칙별 위반 사례가 없으면 타입 검사에서 실패하고,
 * 표의 각 항목은 같은 파일의 표 순회 테스트가 사전 검사와 AST 결과를 함께 확인한다.
 */
export const CSP_RULE_TABLE = {
  callTargets: {
    eval: {
      rule: 'csp/no-eval',
      argument: 'any',
      invocations: { call: 'Disallowed eval() execution in Manifest V3 bundle' },
    },
    Function: {
      rule: 'csp/no-new-function',
      argument: 'any',
      invocations: {
        call: 'Disallowed Function() code evaluation in Manifest V3 bundle',
        construct: 'Disallowed new Function() code evaluation in Manifest V3 bundle',
      },
    },
    setTimeout: {
      rule: 'csp/no-string-settimeout',
      argument: 'string-code',
      invocations: { call: 'Disallowed string code evaluation in setTimeout() in Manifest V3 bundle' },
    },
    setInterval: {
      rule: 'csp/no-string-setinterval',
      argument: 'string-code',
      invocations: { call: 'Disallowed string code evaluation in setInterval() in Manifest V3 bundle' },
    },
  },
  modules: {
    rule: 'csp/no-disallowed-import',
    roots: [
      { name: 'ajv', dashVariants: true },
      { name: 'zod', dashVariants: false },
      { name: '@oa-sdk', dashVariants: false },
    ],
    references: {
      'import-declaration': {
        keyword: 'import',
        message: 'Disallowed heavy schema engine or SDK runtime import in Manifest V3 bundle',
      },
      're-export': {
        keyword: 'from',
        message: 'Disallowed heavy schema engine or SDK runtime re-export in Manifest V3 bundle',
      },
      'import-equals': {
        keyword: 'import',
        message: 'Disallowed heavy schema engine or SDK runtime import in Manifest V3 bundle',
      },
      'require-call': {
        keyword: 'require',
        message: 'Disallowed heavy schema engine or SDK runtime require() in Manifest V3 bundle',
      },
      'dynamic-import': {
        keyword: 'import',
        message: 'Disallowed dynamic import of runtime dependency in Manifest V3 bundle',
      },
    },
  },
} as const satisfies CspRuleTable

type CallTargetTable = typeof CSP_RULE_TABLE.callTargets

export type CspRuleId = CallTargetTable[keyof CallTargetTable]['rule'] | typeof CSP_RULE_TABLE.modules.rule

export type CspModuleReferenceForm = keyof typeof CSP_RULE_TABLE.modules.references

/** `window.eval`처럼 전역 호출 대상의 수신 객체로 인정하는 전역 객체 이름. */
export const CSP_GLOBAL_OBJECT_NAMES: readonly string[] = ['window', 'globalThis', 'self', 'global']

export interface CspViolation {
  file: string
  line: number
  column: number
  rule: CspRuleId
  severity: 'error' | 'warning'
  message: string
  snippet: string
}

export interface CspAuditResult {
  valid: boolean
  scannedFiles: string[]
  violations: CspViolation[]
  summary: string
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 대안들을 비캡처 그룹으로 묶는다. 대안이 없으면 어디에도 매칭되지 않는 패턴을 반환한다. */
function anyOf(alternatives: readonly string[]): string {
  return alternatives.length > 0 ? `(?:${alternatives.join('|')})` : '(?!)'
}

type CallTargetEntry = CspCallTargetRule & { readonly rule: CspRuleId }

const CALL_TARGET_RULES: ReadonlyMap<string, CallTargetEntry> = new Map<string, CallTargetEntry>(
  Object.entries(CSP_RULE_TABLE.callTargets),
)
const GLOBAL_OBJECT_NAMES: ReadonlySet<string> = new Set(CSP_GLOBAL_OBJECT_NAMES)
const MODULE_ROOTS: readonly CspModuleRoot[] = CSP_RULE_TABLE.modules.roots
const MODULE_REFERENCES: { readonly [F in CspModuleReferenceForm]: CspModuleReference } =
  CSP_RULE_TABLE.modules.references
const MODULE_REFERENCE_FORMS = Object.keys(MODULE_REFERENCES) as CspModuleReferenceForm[]

const DISALLOWED_MODULE_SPECIFIER = new RegExp(
  `^${anyOf(
    MODULE_ROOTS.map(
      root => `${escapeRegExp(root.name)}${root.dashVariants ? '(?:-[a-z0-9_]+)?' : ''}(?:/.*)?`,
    ),
  )}$`,
)

function isDisallowedModuleSpecifier(specifier: string): boolean {
  return DISALLOWED_MODULE_SPECIFIER.test(specifier.trim())
}

/*
 * 어휘 사전 검사 패턴. 모두 CSP_RULE_TABLE에서 도출한다.
 *
 * 생성된 guard 번들은 수십 MB에 달할 수 있어 파일마다 전체 AST를 만드는 비용이 크다.
 * mayContainCspViolation은 AST 규칙이 위반을 보고하기 위한 필요조건이므로, false면 AST 검사를 생략해도
 * 결과가 같다. 이 필요조건은 아래 AST 쪽 전제에 기대며, 전제를 바꾸면 사전 검사도 함께 바꿔야 한다.
 *
 * - 호출 대상은 식별자 이름으로만 찾는다(getGlobalTargetName). 식별자는 원문에 그대로 쓰이거나 유니코드
 *   이스케이프(`\u0065val`, `\u{65}val`)로만 숨길 수 있으므로, `\u`가 없으면 표의 이름이 원문에 나타나야 한다.
 *   `window.eval`처럼 속성 이름으로도 검사하므로 앞의 `.`은 배제하지 않는다.
 *   계산된 멤버 접근(`globalThis['eval']`)은 AST 규칙이 검사하지 않는다. 검사하도록 바꾸면 문자열 이스케이프
 *   (`'\x65val'`)로도 이름을 숨길 수 있으므로 호출 대상에도 `\` 조건이 필요해진다.
 * - 모듈 규칙은 표의 references 구문이 있어야 성립한다. 각 구문의 keyword는 키워드 또는 bare 식별자로만
 *   검사되므로 `.from`/`.require` 같은 멤버 이름은 제외한다(`...require()` 전개는 포함).
 * - 모듈 지정자는 문자열 리터럴 값으로만 읽는다. 금지 루트 이름이 원문에 나타나거나, 문자열 이스케이프로
 *   숨겨질 수 있을 때(`\`)만 위험하다.
 * - 주석, 문자열, 템플릿 리터럴 안의 단어도 그대로 매칭된다. 사전 검사가 덜 걸러낼 뿐 위반은 누락되지 않는다.
 * - 필요조건은 문법적으로 올바른 JavaScript에 대해 성립한다. 숫자 리터럴 바로 뒤에 붙은 식별자
 *   (`0neval()`, `1e5eval()`)는 SyntaxError라 브라우저가 번들을 실행하지 않지만, TS 파서는 오류를 복구해
 *   호출로 읽으므로 이런 소스에서는 AST 검사만 위반을 보고할 수 있다.
 */
const IDENTIFIER_START = '(?<![\\w$])'
const IDENTIFIER_END = '(?![\\w$])'
const NOT_MEMBER_NAME = '(?<!(?:^|[^.])\\.)'

const CALL_TARGET_WORD = new RegExp(
  IDENTIFIER_START + anyOf([...CALL_TARGET_RULES.keys()].map(escapeRegExp)) + IDENTIFIER_END,
)
const MODULE_REFERENCE_WORD = new RegExp(
  IDENTIFIER_START +
    NOT_MEMBER_NAME +
    anyOf([...new Set(MODULE_REFERENCE_FORMS.map(form => MODULE_REFERENCES[form].keyword))].map(escapeRegExp)) +
    IDENTIFIER_END,
)
const DISALLOWED_MODULE_ROOT_TEXT = new RegExp(anyOf(MODULE_ROOTS.map(root => escapeRegExp(root.name))))

/**
 * 소스가 CSP 규칙을 위반할 수 있는지 판정하는 어휘 사전 검사.
 * false를 반환한 소스에는 auditCspAstSync도 위반을 보고하지 않는다.
 */
export function mayContainCspViolation(content: string): boolean {
  if (content.includes('\\u')) return true
  if (CALL_TARGET_WORD.test(content)) return true
  if (!MODULE_REFERENCE_WORD.test(content)) return false
  return DISALLOWED_MODULE_ROOT_TEXT.test(content) || content.includes('\\')
}

function unwrapExpression(ts: typeof tsType, node: tsType.Node): tsType.Node {
  let current = node
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression
    } else if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      current = current.right
    } else {
      return current
    }
  }
}

/**
 * 호출/생성 대상 표현식이 가리키는 전역 이름을 반환합니다.
 * `name`, `(0, name)`, `window.name` 등 전역 객체 접근만 인식합니다.
 */
function getGlobalTargetName(ts: typeof tsType, node: tsType.Node): string | undefined {
  const unwrapped = unwrapExpression(ts, node)
  if (ts.isIdentifier(unwrapped)) {
    return unwrapped.text
  }
  if (ts.isPropertyAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.name)) {
    const obj = unwrapExpression(ts, unwrapped.expression)
    if (ts.isIdentifier(obj) && GLOBAL_OBJECT_NAMES.has(obj.text)) {
      return unwrapped.name.text
    }
  }
  return undefined
}

function isStringCodeArgument(ts: typeof tsType, node: tsType.Node): boolean {
  const arg = unwrapExpression(ts, node)
  return ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg)
}

function getStringLiteralArgument(ts: typeof tsType, args: readonly tsType.Expression[]): string | undefined {
  const first = args[0]
  if (!first) return undefined
  const arg = unwrapExpression(ts, first)
  return ts.isStringLiteral(arg) ? arg.text : undefined
}

type SyntaxKindName = keyof typeof tsType.SyntaxKind

const ARGUMENT_CONDITIONS: {
  readonly [C in CspArgumentCondition]: (ts: typeof tsType, args: readonly tsType.Expression[]) => boolean
} = {
  any: () => true,
  'string-code': (ts, args) => args[0] !== undefined && isStringCodeArgument(ts, args[0]),
}

/** 호출 형태별 AST 노드 종류. 두 노드 모두 `expression`과 `arguments`를 가진다. */
const INVOCATION_NODE_KINDS: { readonly [K in CspInvocationKind]: SyntaxKindName } = {
  call: 'CallExpression',
  construct: 'NewExpression',
}

interface ModuleReferenceExtractor {
  readonly kind: SyntaxKindName
  /** 노드가 이 구문이고 지정자가 문자열 리터럴이면 그 값을, 아니면 undefined를 반환한다. */
  readonly specifier: (ts: typeof tsType, node: tsType.Node) => string | undefined
}

/** 표의 모듈 참조 구문마다 지정자를 꺼내는 방법. 표에 구문을 추가하면 여기서 타입 오류가 난다. */
const MODULE_REFERENCE_EXTRACTORS: { readonly [F in CspModuleReferenceForm]: ModuleReferenceExtractor } = {
  // import Ajv from 'ajv' / import 'ajv'
  'import-declaration': {
    kind: 'ImportDeclaration',
    specifier: (ts, node) => {
      const { moduleSpecifier } = node as tsType.ImportDeclaration
      return ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined
    },
  },
  // export * from 'ajv' / export { z } from 'zod'
  're-export': {
    kind: 'ExportDeclaration',
    specifier: (ts, node) => {
      const { moduleSpecifier } = node as tsType.ExportDeclaration
      return moduleSpecifier && ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined
    },
  },
  // import Ajv = require('ajv')
  'import-equals': {
    kind: 'ImportEqualsDeclaration',
    specifier: (ts, node) => {
      const { moduleReference } = node as tsType.ImportEqualsDeclaration
      return ts.isExternalModuleReference(moduleReference) && ts.isStringLiteral(moduleReference.expression)
        ? moduleReference.expression.text
        : undefined
    },
  },
  // require('ajv')
  'require-call': {
    kind: 'CallExpression',
    specifier: (ts, node) => {
      const { expression, arguments: args } = node as tsType.CallExpression
      return ts.isIdentifier(expression) && expression.text === 'require'
        ? getStringLiteralArgument(ts, args)
        : undefined
    },
  },
  // import('ajv')
  'dynamic-import': {
    kind: 'CallExpression',
    specifier: (ts, node) => {
      const { expression, arguments: args } = node as tsType.CallExpression
      const isImport =
        expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expression) && expression.text === 'import')
      return isImport ? getStringLiteralArgument(ts, args) : undefined
    },
  },
}

interface ModuleReferenceHandler {
  readonly form: CspModuleReferenceForm
  readonly specifier: ModuleReferenceExtractor['specifier']
}

/** 노드 종류 → 검사 방법. TypeScript 인스턴스마다 한 번 만든다. */
interface AstDispatch {
  readonly invocations: ReadonlyMap<tsType.SyntaxKind, CspInvocationKind>
  readonly moduleReferences: ReadonlyMap<tsType.SyntaxKind, readonly ModuleReferenceHandler[]>
}

const astDispatchCache = new WeakMap<typeof tsType, AstDispatch>()

function getAstDispatch(ts: typeof tsType): AstDispatch {
  const cached = astDispatchCache.get(ts)
  if (cached) return cached

  const invocations = new Map<tsType.SyntaxKind, CspInvocationKind>()
  for (const invocation of Object.keys(INVOCATION_NODE_KINDS) as CspInvocationKind[]) {
    invocations.set(ts.SyntaxKind[INVOCATION_NODE_KINDS[invocation]], invocation)
  }

  const moduleReferences = new Map<tsType.SyntaxKind, ModuleReferenceHandler[]>()
  for (const form of MODULE_REFERENCE_FORMS) {
    const { kind, specifier } = MODULE_REFERENCE_EXTRACTORS[form]
    const syntaxKind = ts.SyntaxKind[kind]
    const handlers = moduleReferences.get(syntaxKind) ?? []
    handlers.push({ form, specifier })
    moduleReferences.set(syntaxKind, handlers)
  }

  const dispatch: AstDispatch = { invocations, moduleReferences }
  astDispatchCache.set(ts, dispatch)
  return dispatch
}

const NO_ARGUMENTS: readonly tsType.Expression[] = []

/**
 * 사전 검사 없이 CSP_RULE_TABLE의 AST 규칙만 적용해 위반 목록을 반환합니다.
 * auditCspSourceSync는 이 함수 앞에 mayContainCspViolation을 둔 것입니다.
 */
export function auditCspAstSync(filePath: string, content: string, ts: typeof tsType): CspViolation[] {
  const violations: CspViolation[] = []
  const dispatch = getAstDispatch(ts)

  // 위치 계산은 getStart(sourceFile)로 충분하므로 parent 포인터 설정(setParentNodes)은 생략한다.
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  let lines: string[] | undefined

  function addViolation(node: tsType.Node, rule: CspRuleId, message: string) {
    const startPos = node.getStart(sourceFile)
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(startPos)
    lines ??= content.split(/\r?\n/)

    violations.push({
      file: filePath,
      line: line + 1,
      column: character + 1,
      rule,
      severity: 'error',
      message,
      snippet: lines[line]?.trim() ?? '',
    })
  }

  function checkInvocation(node: tsType.CallExpression | tsType.NewExpression, invocation: CspInvocationKind) {
    const name = getGlobalTargetName(ts, node.expression)
    if (name === undefined) return
    const target = CALL_TARGET_RULES.get(name)
    const message = target?.invocations[invocation]
    if (target === undefined || message === undefined) return
    if (ARGUMENT_CONDITIONS[target.argument](ts, node.arguments ?? NO_ARGUMENTS)) {
      addViolation(node, target.rule, message)
    }
  }

  function checkModuleReferences(node: tsType.Node, handlers: readonly ModuleReferenceHandler[]) {
    for (const handler of handlers) {
      const specifier = handler.specifier(ts, node)
      if (specifier !== undefined && isDisallowedModuleSpecifier(specifier)) {
        addViolation(node, CSP_RULE_TABLE.modules.rule, `${MODULE_REFERENCES[handler.form].message}: "${specifier}"`)
      }
    }
  }

  function visit(node: tsType.Node): void {
    const invocation = dispatch.invocations.get(node.kind)
    if (invocation !== undefined) {
      checkInvocation(node as tsType.CallExpression | tsType.NewExpression, invocation)
    }
    const handlers = dispatch.moduleReferences.get(node.kind)
    if (handlers !== undefined) {
      checkModuleReferences(node, handlers)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

/**
 * 단일 소스 코드 파일(또는 문자열)을 TypeScript AST로 검사하여 CSP 위반 목록을 동기적으로 반환합니다.
 * 어휘 사전 검사로 위반이 불가능한 소스는 파싱하지 않습니다.
 */
export function auditCspSourceSync(
  filePath: string,
  content: string,
  ts: typeof tsType,
): CspViolation[] {
  return mayContainCspViolation(content) ? auditCspAstSync(filePath, content, ts) : []
}

/**
 * 단일 소스 코드 파일(또는 문자열)을 TypeScript AST로 검사하여 CSP 위반 목록을 반환합니다.
 */
export async function auditCspSource(
  filePath: string,
  content: string,
  tsInstance?: typeof tsType,
): Promise<CspViolation[]> {
  const ts = tsInstance ?? (await getTs())
  return auditCspSourceSync(filePath, content, ts)
}

/**
 * 지정된 번들 디렉토리 또는 단일 JS 파일 내 모든 번들 대상 파일을 수집합니다.
 */
export function collectBundleFiles(bundlePath: string): string[] {
  const resolved = path.resolve(process.cwd(), bundlePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`번들 경로를 찾을 수 없습니다: ${bundlePath}`)
  }

  const stat = fs.statSync(resolved)
  if (stat.isFile()) {
    return [resolved]
  }

  if (stat.isDirectory()) {
    const files: string[] = []
    function traverse(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue
          traverse(full)
        } else if (entry.isFile()) {
          if (/\.(js|mjs|cjs)$/i.test(entry.name)) {
            files.push(full)
          }
        }
      }
    }
    traverse(resolved)
    return files
  }

  return []
}

/**
 * 번들 디렉토리 또는 파일을 스캔하여 CSP 위반 여부 종합 결과를 반환합니다.
 */
export async function auditCspBundle(bundlePath: string): Promise<CspAuditResult> {
  const files = collectBundleFiles(bundlePath)
  if (files.length === 0) {
    throw new Error(`감사 대상 JavaScript 파일(.js, .mjs, .cjs)이 발견되지 않았습니다: ${bundlePath}`)
  }

  const allViolations: CspViolation[] = []

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    // 어휘 사전 검사를 통과한 파일이 있을 때만 TypeScript를 로드한다.
    if (!mayContainCspViolation(content)) continue
    const violations = auditCspAstSync(file, content, await getTs())
    allViolations.push(...violations)
  }

  const valid = allViolations.length === 0
  const summary = valid
    ? `✅ 0 CSP violations found across ${files.length} bundle file(s). Manifest V3 compliant.`
    : `❌ ${allViolations.length} CSP violation(s) found across ${files.length} bundle file(s).`

  return {
    valid,
    scannedFiles: files,
    violations: allViolations,
    summary,
  }
}

export const auditCsp: Command = {
  name: 'audit:csp',
  description: 'Manifest V3 번들의 Content Security Policy (CSP) 위반 및 런타임 의존성 감사',
  options: {
    bundle: {
      type: 'string',
      short: 'b',
      required: true,
      description: '번들 디렉토리 또는 JS 파일 경로',
    },
  },
  async run(args) {
    const bundlePath = str(args, 'bundle')
    console.log('━━━ Manifest V3 CSP Audit ━━━')
    console.log(`Target: ${bundlePath}`)

    const result = await auditCspBundle(bundlePath)

    for (const v of result.violations) {
      const icon = v.severity === 'error' ? '❌' : '⚠️'
      console.log(`  ${icon} [${v.rule}] ${v.message}`)
      console.log(`     at ${v.file}:${v.line}:${v.column}`)
      if (v.snippet) {
        console.log(`     > ${v.snippet}`)
      }
    }

    console.log(`\n${result.summary}`)

    if (!result.valid) {
      throw new CliExitError(1)
    }
  },
}
