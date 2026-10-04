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

export type CspRuleId =
  | 'csp/no-eval'
  | 'csp/no-new-function'
  | 'csp/no-string-settimeout'
  | 'csp/no-string-setinterval'
  | 'csp/no-disallowed-import'

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

const DISALLOWED_IMPORT_PATTERN = /^(ajv(-[a-z0-9_]+)?(\/.*)?|zod(\/.*)?|@oa-sdk(\/.*)?)$/

function isDisallowedModuleSpecifier(specifier: string): boolean {
  return DISALLOWED_IMPORT_PATTERN.test(specifier.trim())
}

const GLOBAL_OBJECT_NAMES = new Set(['window', 'globalThis', 'self', 'global'])

/**
 * AST 규칙이 검사하는 식별자/모듈 지정자가 소스에 나타날 수 있는지 판정하는 어휘 사전 검사.
 *
 * 생성된 guard 번들은 수십 MB에 달할 수 있어 파일마다 전체 AST를 만드는 비용이 크다.
 * 아래 조건은 위반의 필요조건이므로 false면 AST 검사를 생략해도 결과가 동일하다.
 * 규칙을 추가/변경할 때는 이 사전 검사도 함께 갱신해야 한다.
 *
 * - `\u` : 유니코드 이스케이프 식별자(`\u0065val`)는 원문에 단어가 그대로 드러나지 않는다.
 * - 호출 규칙 대상 식별자(eval/Function/setTimeout/setInterval)는 `window.eval`처럼
 *   속성 이름으로도 검사되므로 앞의 `.`을 배제하지 않는다.
 * - import 규칙은 import/require/re-export(`from`) 구문이 있어야 성립한다. 이들은 bare 식별자
 *   또는 키워드로만 검사되므로 `.from`/`.require` 같은 속성 접근은 제외한다(`...require()` 전개는 포함).
 *   모듈 지정자는 원문에 금지 패키지 이름이 나타나거나, 문자열 이스케이프로 숨겨질 수 있을 때(`\`)만 위험하다.
 */
const CALL_TARGET_WORD = /(?<![\w$])(?:eval|Function|setTimeout|setInterval)(?![\w$])/
const MODULE_SYNTAX_WORD = /(?<![\w$])(?<!(?:^|[^.])\.)(?:import|require|from)(?![\w$])/
const DISALLOWED_PACKAGE_TEXT = /ajv|zod|@oa-sdk/

export function mayContainCspViolation(content: string): boolean {
  if (content.includes('\\u')) return true
  if (CALL_TARGET_WORD.test(content)) return true
  if (!MODULE_SYNTAX_WORD.test(content)) return false
  return DISALLOWED_PACKAGE_TEXT.test(content) || content.includes('\\')
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

function getStringLiteralArgument(ts: typeof tsType, args: tsType.NodeArray<tsType.Expression>): string | undefined {
  const first = args[0]
  if (!first) return undefined
  const arg = unwrapExpression(ts, first)
  return ts.isStringLiteral(arg) ? arg.text : undefined
}

/**
 * 단일 소스 코드 파일(또는 문자열)을 TypeScript AST로 검사하여 CSP 위반 목록을 동기적으로 반환합니다.
 */
export function auditCspSourceSync(
  filePath: string,
  content: string,
  ts: typeof tsType,
): CspViolation[] {
  const violations: CspViolation[] = []
  if (!mayContainCspViolation(content)) {
    return violations
  }

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

  function checkModuleSpecifier(node: tsType.Node, specifier: string, message: string) {
    if (isDisallowedModuleSpecifier(specifier)) {
      addViolation(node, 'csp/no-disallowed-import', `${message}: "${specifier}"`)
    }
  }

  function visitCallExpression(node: tsType.CallExpression) {
    const target = getGlobalTargetName(ts, node.expression)

    // 1. eval(...) 호출 감지 (csp/no-eval)
    if (target === 'eval') {
      addViolation(node, 'csp/no-eval', 'Disallowed eval() execution in Manifest V3 bundle')
    }

    // 2. Function(...) 감지 (csp/no-new-function)
    if (target === 'Function') {
      addViolation(node, 'csp/no-new-function', 'Disallowed Function() code evaluation in Manifest V3 bundle')
    }

    // 3. setTimeout(string, ...) 및 setInterval(string, ...) 감지
    if ((target === 'setTimeout' || target === 'setInterval') && node.arguments.length > 0) {
      if (isStringCodeArgument(ts, node.arguments[0]!)) {
        if (target === 'setTimeout') {
          addViolation(
            node,
            'csp/no-string-settimeout',
            'Disallowed string code evaluation in setTimeout() in Manifest V3 bundle',
          )
        } else {
          addViolation(
            node,
            'csp/no-string-setinterval',
            'Disallowed string code evaluation in setInterval() in Manifest V3 bundle',
          )
        }
      }
    }

    // 4.4 CommonJS require('ajv')
    if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const specifier = getStringLiteralArgument(ts, node.arguments)
      if (specifier !== undefined) {
        checkModuleSpecifier(
          node,
          specifier,
          'Disallowed heavy schema engine or SDK runtime require() in Manifest V3 bundle',
        )
      }
    }

    // 4.4 Dynamic import('ajv')
    if (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'import')
    ) {
      const specifier = getStringLiteralArgument(ts, node.arguments)
      if (specifier !== undefined) {
        checkModuleSpecifier(
          node,
          specifier,
          'Disallowed dynamic import of runtime dependency in Manifest V3 bundle',
        )
      }
    }
  }

  function visit(node: tsType.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.CallExpression:
        visitCallExpression(node as tsType.CallExpression)
        break

      // 2. new Function(...) 감지 (csp/no-new-function)
      case ts.SyntaxKind.NewExpression:
        if (getGlobalTargetName(ts, (node as tsType.NewExpression).expression) === 'Function') {
          addViolation(node, 'csp/no-new-function', 'Disallowed new Function() code evaluation in Manifest V3 bundle')
        }
        break

      // 4.1 ESM import declarations
      case ts.SyntaxKind.ImportDeclaration: {
        const { moduleSpecifier } = node as tsType.ImportDeclaration
        if (ts.isStringLiteral(moduleSpecifier)) {
          checkModuleSpecifier(
            node,
            moduleSpecifier.text,
            'Disallowed heavy schema engine or SDK runtime import in Manifest V3 bundle',
          )
        }
        break
      }

      // 4.2 ESM export declarations (export * from 'ajv' 등)
      case ts.SyntaxKind.ExportDeclaration: {
        const { moduleSpecifier } = node as tsType.ExportDeclaration
        if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
          checkModuleSpecifier(
            node,
            moduleSpecifier.text,
            'Disallowed heavy schema engine or SDK runtime re-export in Manifest V3 bundle',
          )
        }
        break
      }

      // 4.3 TS import = require(...)
      case ts.SyntaxKind.ImportEqualsDeclaration: {
        const { moduleReference } = node as tsType.ImportEqualsDeclaration
        if (ts.isExternalModuleReference(moduleReference) && ts.isStringLiteral(moduleReference.expression)) {
          checkModuleSpecifier(
            node,
            moduleReference.expression.text,
            'Disallowed heavy schema engine or SDK runtime import in Manifest V3 bundle',
          )
        }
        break
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
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
    const violations = auditCspSourceSync(file, content, await getTs())
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
