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

function unwrapExpression(ts: typeof tsType, node: tsType.Node): tsType.Node {
  let current = node
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return unwrapExpression(ts, current.right)
  }
  return current
}

function isTargetIdentifier(ts: typeof tsType, node: tsType.Node, targetName: string): boolean {
  const unwrapped = unwrapExpression(ts, node)
  if (ts.isIdentifier(unwrapped) && unwrapped.text === targetName) {
    return true
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    if (unwrapped.name.text === targetName) {
      const obj = unwrapExpression(ts, unwrapped.expression)
      if (ts.isIdentifier(obj) && ['window', 'globalThis', 'self', 'global'].includes(obj.text)) {
        return true
      }
    }
  }
  return false
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
  const scriptKind = filePath.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.JS
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind)
  const lines = content.split(/\r?\n/)

  function addViolation(node: tsType.Node, rule: CspRuleId, message: string) {
    const startPos = node.getStart(sourceFile)
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(startPos)
    const lineNumber = line + 1
    const columnNumber = character + 1
    const snippet = lines[line]?.trim() ?? ''

    violations.push({
      file: filePath,
      line: lineNumber,
      column: columnNumber,
      rule,
      severity: 'error',
      message,
      snippet,
    })
  }

  function visit(node: tsType.Node) {
    // 1. eval(...) 호출 감지 (csp/no-eval)
    if (ts.isCallExpression(node)) {
      if (isTargetIdentifier(ts, node.expression, 'eval')) {
        addViolation(node, 'csp/no-eval', 'Disallowed eval() execution in Manifest V3 bundle')
      }
    }

    // 2. new Function(...) 및 Function(...) 감지 (csp/no-new-function)
    if (ts.isNewExpression(node)) {
      if (isTargetIdentifier(ts, node.expression, 'Function')) {
        addViolation(node, 'csp/no-new-function', 'Disallowed new Function() code evaluation in Manifest V3 bundle')
      }
    }
    if (ts.isCallExpression(node)) {
      if (isTargetIdentifier(ts, node.expression, 'Function')) {
        addViolation(node, 'csp/no-new-function', 'Disallowed Function() code evaluation in Manifest V3 bundle')
      }
    }

    // 3. setTimeout(string, ...) 및 setInterval(string, ...) 감지
    if (ts.isCallExpression(node)) {
      const isSetTimeout = isTargetIdentifier(ts, node.expression, 'setTimeout')
      const isSetInterval = isTargetIdentifier(ts, node.expression, 'setInterval')
      if (isSetTimeout || isSetInterval) {
        if (node.arguments.length > 0) {
          const firstArg = unwrapExpression(ts, node.arguments[0]!)
          if (
            ts.isStringLiteral(firstArg) ||
            ts.isNoSubstitutionTemplateLiteral(firstArg) ||
            ts.isTemplateExpression(firstArg)
          ) {
            if (isSetTimeout) {
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
      }
    }

    // 4. 금지된 런타임 라이브러리 import/require 감지 (csp/no-disallowed-import)
    // 4.1 ESM import declarations
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text
        if (isDisallowedModuleSpecifier(specifier)) {
          addViolation(
            node,
            'csp/no-disallowed-import',
            `Disallowed heavy schema engine or SDK runtime import in Manifest V3 bundle: "${specifier}"`,
          )
        }
      }
    }

    // 4.2 ESM export declarations (export * from 'ajv' 등)
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text
        if (isDisallowedModuleSpecifier(specifier)) {
          addViolation(
            node,
            'csp/no-disallowed-import',
            `Disallowed heavy schema engine or SDK runtime re-export in Manifest V3 bundle: "${specifier}"`,
          )
        }
      }
    }

    // 4.3 TS import = require(...)
    if (ts.isImportEqualsDeclaration(node)) {
      if (
        ts.isExternalModuleReference(node.moduleReference) &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        const specifier = node.moduleReference.expression.text
        if (isDisallowedModuleSpecifier(specifier)) {
          addViolation(
            node,
            'csp/no-disallowed-import',
            `Disallowed heavy schema engine or SDK runtime import in Manifest V3 bundle: "${specifier}"`,
          )
        }
      }
    }

    // 4.4 CommonJS require(...) 및 동적 import(...)
    if (ts.isCallExpression(node)) {
      // CommonJS require('ajv')
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length > 0) {
          const firstArg = unwrapExpression(ts, node.arguments[0]!)
          if (ts.isStringLiteral(firstArg)) {
            const specifier = firstArg.text
            if (isDisallowedModuleSpecifier(specifier)) {
              addViolation(
                node,
                'csp/no-disallowed-import',
                `Disallowed heavy schema engine or SDK runtime require() in Manifest V3 bundle: "${specifier}"`,
              )
            }
          }
        }
      }

      // Dynamic import('ajv')
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'import')
      ) {
        if (node.arguments.length > 0) {
          const firstArg = unwrapExpression(ts, node.arguments[0]!)
          if (ts.isStringLiteral(firstArg)) {
            const specifier = firstArg.text
            if (isDisallowedModuleSpecifier(specifier)) {
              addViolation(
                node,
                'csp/no-disallowed-import',
                `Disallowed dynamic import of runtime dependency in Manifest V3 bundle: "${specifier}"`,
              )
            }
          }
        }
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

  const ts = await getTs()
  const allViolations: CspViolation[] = []

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    const violations = auditCspSourceSync(file, content, ts)
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
