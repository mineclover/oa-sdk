import { describe, it, expect } from 'vitest'
import { auditCspSourceSync, getTs, mayContainCspViolation } from '../cli/commands/audit-csp.js'

/**
 * audit:csp의 어휘 사전 검사(mayContainCspViolation)는 AST 검사를 생략해도 되는지 판단하는
 * 필요조건이다. 위반이 존재하는 소스에서 false를 반환하면 위반이 누락되므로, 이스케이프/전개 등
 * 원문에 단어가 그대로 드러나지 않는 형태까지 모두 true여야 한다.
 */
describe('audit:csp lexical prefilter', () => {
  const violating: Array<[string, string]> = [
    ['eval call', 'eval("1")'],
    ['global eval', 'window.eval("1")'],
    ['indirect eval', '(0, eval)("1")'],
    ['unicode-escaped eval', '\\u0065val("1")'],
    ['unicode code point escaped eval', '\\u{65}val("1")'],
    ['new Function', 'new Function("return 1")'],
    ['string setTimeout', 'setTimeout("x()", 1)'],
    ['string setInterval', 'globalThis.setInterval(`x()`, 1)'],
    ['esm import', 'import Ajv from "ajv"'],
    ['side-effect import', "import 'zod'"],
    ['re-export', 'export * from "@oa-sdk/core"'],
    ['compact re-export', 'export*from"ajv/dist/core"'],
    ['require', 'const z = require("zod")'],
    ['spread require', 'f(...require("ajv"))'],
    ['dynamic import', 'await import("ajv-formats")'],
    ['hex-escaped specifier', 'require("\\x61jv")'],
    ['identity-escaped specifier', 'require("\\a\\jv")'],
    ['line-continued specifier', 'require("aj\\\nv")'],
  ]

  it.each(violating)('keeps AST analysis for %s', async (_name, source) => {
    expect(mayContainCspViolation(source)).toBe(true)
    const violations = auditCspSourceSync('sample.js', source, await getTs())
    expect(violations).toHaveLength(1)
  })

  const benign: Array<[string, string]> = [
    ['plain guard', 'export function isUser(data) { return typeof data === "object" && data !== null }'],
    ['evaluated identifiers', 'let evaluated0 = true; const evaluationRecord = { evaluatedAt: 1 }'],
    ['property access from/require', 'const xs = Array.from(ys); obj.require(1); const p = /a\\d+/'],
    ['typeof function', 'if (typeof cb === "function") cb()'],
  ]

  it.each(benign)('skips AST analysis for %s', (_name, source) => {
    expect(mayContainCspViolation(source)).toBe(false)
  })

  it('reports the same location and snippet when parent pointers are not built', async () => {
    const source = 'const a = 1\r\n  if (a) {\n    window.setTimeout("tick()", 10)\n  }\n'
    const [violation] = auditCspSourceSync('loc.js', source, await getTs())
    expect(violation).toMatchObject({
      rule: 'csp/no-string-settimeout',
      line: 3,
      column: 5,
      snippet: 'window.setTimeout("tick()", 10)',
    })
  })
})
