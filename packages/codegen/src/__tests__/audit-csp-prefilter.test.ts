import { beforeAll, describe, it, expect } from 'vitest'
import type * as tsType from 'typescript'
import {
  CSP_GLOBAL_OBJECT_NAMES,
  CSP_RULE_TABLE,
  auditCspAstSync,
  auditCspSourceSync,
  getTs,
  mayContainCspViolation,
  type CspArgumentCondition,
  type CspCallTargetRule,
  type CspInvocationKind,
  type CspModuleReferenceForm,
  type CspModuleRoot,
  type CspRuleId,
} from '../cli/commands/audit-csp.js'

/**
 * audit:csp의 어휘 사전 검사(mayContainCspViolation)는 AST 검사를 생략해도 되는지 판단하는
 * 필요조건이다. 위반이 존재하는 소스에서 false를 반환하면 위반이 누락되므로, 이스케이프/전개/주석/템플릿 등
 * 원문에 단어가 그대로 드러나지 않거나 흩어진 형태까지 모두 true여야 한다. 필요조건은 문법적으로 올바른
 * JavaScript에 대해 정의되므로 사례도 모두 올바른 문법으로 만든다.
 *
 * 사전 검사와 AST 규칙은 모두 CSP_RULE_TABLE에서 도출된다. 아래 테스트는
 * (1) 모든 CspRuleId에 위반 사례가 있는지 타입 수준에서 강제하고,
 * (2) 표의 항목을 순회해 사전 검사와 AST 결과가 함께 맞는지 확인한다.
 */

type NonEmpty<T> = readonly [T, ...T[]]

let ts: typeof tsType

beforeAll(async () => {
  ts = await getTs()
})

function reported(source: string): Array<{ rule: CspRuleId; message: string }> {
  return auditCspAstSync('sample.js', source, ts).map(({ rule, message }) => ({ rule, message }))
}

/** 기대와 다른 사례를 모아 한 번에 보여준다. 표 순회 테스트는 사례가 많아 개별 it으로 나누지 않는다. */
function collectMismatches<T>(
  sources: Iterable<string>,
  check: (source: string) => T | undefined,
): T[] {
  const mismatches: T[] = []
  for (const source of sources) {
    const mismatch = check(source)
    if (mismatch !== undefined) mismatches.push(mismatch)
  }
  return mismatches
}

const codePointHex = (text: string) => text.codePointAt(0)!.toString(16)
const unicodeEscapeFirst = (text: string) => `\\u${codePointHex(text).padStart(4, '0')}${text.slice(1)}`
const codePointEscapeFirst = (text: string) => `\\u{${codePointHex(text)}}${text.slice(1)}`
const hexEscapeFirst = (text: string) => `\\x${codePointHex(text).padStart(2, '0')}${text.slice(1)}`

/** 토큰 사이에 끼울 수 있는 공백/주석. */
const GAPS = [' ', '/* gap */', '\n// gap\n'] as const

// ---------------------------------------------------------------------------
// 1. 규칙 ID별 위반 사례 (CspRuleId 전수, 타입 수준 강제)
// ---------------------------------------------------------------------------

/**
 * CspRuleId는 CSP_RULE_TABLE에서 도출된다. 표에 규칙을 추가하면 여기에 위반 사례를 넣기 전까지
 * `satisfies`가 타입 오류를 낸다.
 */
const RULE_SAMPLES = {
  'csp/no-eval': [
    'eval("1")',
    'window.eval("1")',
    '(0, eval)("1")',
    '\\u0065val("1")',
    '\\u{65}val("1")',
    'ev\\u0061l("1")',
    'self.\\u0065val("1")',
    'eval/* gap */("1")',
    '`${eval("1")}`',
  ],
  'csp/no-new-function': [
    'new Function("return 1")',
    'Function("return 1")()',
    'new globalThis.Function',
    'new \\u0046unction("return 1")',
    'new/* gap */Function("return 1")',
    '`${new Function("return 1")}`',
  ],
  'csp/no-string-settimeout': [
    'setTimeout("x()", 1)',
    'setTimeout(`${a}()`, 1)',
    'set\\u0054imeout("x()", 1)',
    'setTimeout(/* gap */ "x()", 1)',
    '`${setTimeout("x()", 1)}`',
  ],
  'csp/no-string-setinterval': [
    'globalThis.setInterval(`x()`, 1)',
    'setInterval("x()", 1)',
    "(0, setInterval)('x()', 1)",
    'setInterval(\n// gap\n"x()", 1)',
  ],
  'csp/no-disallowed-import': [
    'import Ajv from "ajv"',
    "import 'zod'",
    'export * from "@oa-sdk/core"',
    'export*from"ajv/dist/core"',
    "export { z } from 'zod'",
    'import z = require("zod")',
    'const z = require("zod")',
    'f(...require("ajv"))',
    'await import("ajv-formats")',
    'require("\\x61jv")',
    'require("\\a\\jv")',
    'require("aj\\\nv")',
    'import("\\u0061jv")',
    '\\u0072equire("zod")',
    'import/* gap */Ajv/* gap */from/* gap */"ajv"',
    '`${require("zod")}`',
  ],
} satisfies Record<CspRuleId, NonEmpty<string>>

describe('audit:csp rule samples (every CspRuleId)', () => {
  const cases = Object.entries(RULE_SAMPLES).flatMap(([rule, sources]) =>
    sources.map((source): [string, string] => [rule, source]),
  )

  it.each(cases)('%s keeps AST analysis for %j', (rule, source) => {
    expect(mayContainCspViolation(source)).toBe(true)
    const violations = auditCspAstSync('sample.js', source, ts)
    expect(violations.map(v => v.rule)).toEqual([rule])
    expect(auditCspSourceSync('sample.js', source, ts)).toEqual(violations)
  })
})

// ---------------------------------------------------------------------------
// 2. 전역 호출 대상 규칙 (CSP_RULE_TABLE.callTargets 순회)
// ---------------------------------------------------------------------------

const INVOCATION_SAMPLES: {
  readonly [K in CspInvocationKind]: (callee: string, argument: string, gap: string) => string
} = {
  call: (callee, argument, gap) => `${callee}${gap}(${gap}${argument}${gap})`,
  construct: (callee, argument, gap) => `new${gap}${callee}${gap}(${gap}${argument}${gap})`,
}

const ARGUMENT_SAMPLES: {
  readonly [C in CspArgumentCondition]: {
    /** 조건을 만족하는 첫 번째 인자 (빈 문자열은 인자 없음) */
    readonly satisfying: NonEmpty<string>
    readonly unsatisfying: readonly string[]
  }
} = {
  any: {
    satisfying: ['"code()"', '', 'code', '() => code()'],
    unsatisfying: [],
  },
  'string-code': {
    satisfying: ['"code()"', "'code()'", '`code()`', '`${code}()`', '("code()")', '(0, "code()")'],
    unsatisfying: ['', 'code', '() => code()', 'function () {}', 'code.bind(null)', '0'],
  },
}

const INVOCATION_KINDS = Object.keys(INVOCATION_SAMPLES) as CspInvocationKind[]

/** 전역 참조로 인정되는 호출 대상 표현식. 식별자 이스케이프 형태를 포함한다. */
function globalCalleeForms(name: string): string[] {
  return [
    name,
    `(${name})`,
    `(0, ${name})`,
    unicodeEscapeFirst(name),
    codePointEscapeFirst(name),
    ...CSP_GLOBAL_OBJECT_NAMES.flatMap(object => [
      `${object}.${name}`,
      `(${object}).${name}`,
      `(0, ${object}.${name})`,
      `${object}.${unicodeEscapeFirst(name)}`,
    ]),
  ]
}

/** 전역 참조가 아닌 호출 대상 표현식. */
function nonGlobalCalleeForms(name: string): string[] {
  return [`obj.${name}`, `this.${name}`, `${name}Like`, `$${name}`]
}

const CALL_TARGETS = Object.entries(CSP_RULE_TABLE.callTargets) as Array<
  [string, CspCallTargetRule & { readonly rule: CspRuleId }]
>

function* invocationSources(
  name: string,
  invocations: readonly CspInvocationKind[],
  callees: readonly string[],
  argumentsList: readonly string[],
): Generator<[CspInvocationKind, string]> {
  for (const invocation of invocations) {
    for (const callee of callees) {
      for (const argument of argumentsList) {
        for (const gap of GAPS) {
          yield [invocation, INVOCATION_SAMPLES[invocation](callee, argument, gap)]
        }
      }
    }
  }
}

describe.each(CALL_TARGETS)('audit:csp call target %s', (name, target) => {
  const declared = INVOCATION_KINDS.filter(kind => target.invocations[kind] !== undefined)
  const undeclared = INVOCATION_KINDS.filter(kind => target.invocations[kind] === undefined)

  it('declares at least one invocation form', () => {
    expect(declared.length).toBeGreaterThan(0)
  })

  it('is kept by the prefilter and reported by the AST for every global callee form', () => {
    const mismatches: unknown[] = []
    for (const [invocation, source] of invocationSources(
      name,
      declared,
      globalCalleeForms(name),
      ARGUMENT_SAMPLES[target.argument].satisfying,
    )) {
      const expected = [{ rule: target.rule, message: target.invocations[invocation] }]
      const prefilter = mayContainCspViolation(source)
      const actual = reported(source)
      if (!prefilter || JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches.push({ source, prefilter, actual })
      }
    }
    expect(mismatches).toEqual([])
  })

  it('is not reported for undeclared invocations, unsatisfying arguments, or non-global callees', () => {
    const satisfying = ARGUMENT_SAMPLES[target.argument].satisfying
    const sources = [
      ...invocationSources(name, undeclared, globalCalleeForms(name), satisfying),
      ...invocationSources(name, declared, globalCalleeForms(name), ARGUMENT_SAMPLES[target.argument].unsatisfying),
      ...invocationSources(name, INVOCATION_KINDS, nonGlobalCalleeForms(name), satisfying),
    ].map(([, source]) => source)

    const mismatches = collectMismatches(sources, source => {
      const actual = reported(source)
      return actual.length === 0 ? undefined : { source, actual }
    })
    expect(mismatches).toEqual([])
  })

  it('lets the prefilter skip sources that only mention longer identifiers', () => {
    const source = `const ${name}Value = 1; let $${name} = 2; obj.${name}_x = ${name}0`
    expect(mayContainCspViolation(source)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. 금지 모듈 규칙 (CSP_RULE_TABLE.modules 순회)
// ---------------------------------------------------------------------------

type SpecifierSample = (literal: string, gap: string) => string

const MODULE_REFERENCE_SAMPLES: { readonly [F in CspModuleReferenceForm]: NonEmpty<SpecifierSample> } = {
  'import-declaration': [
    (literal, gap) => `import${gap}Ajv${gap}from${gap}${literal}`,
    (literal, gap) => `import${gap}${literal}`,
    (literal, gap) => `import${gap}{${gap}a${gap}as${gap}b${gap}}${gap}from${gap}${literal}`,
    (literal, gap) => `import${gap}*${gap}as${gap}ns${gap}from${gap}${literal}`,
  ],
  're-export': [
    (literal, gap) => `export${gap}*${gap}from${gap}${literal}`,
    (literal, gap) => `export${gap}{${gap}a${gap}}${gap}from${gap}${literal}`,
    (literal, gap) => `export${gap}*${gap}as${gap}ns${gap}from${gap}${literal}`,
  ],
  'import-equals': [(literal, gap) => `import${gap}Ajv${gap}=${gap}require(${gap}${literal}${gap})`],
  'require-call': [
    (literal, gap) => `require(${gap}${literal}${gap})`,
    (literal, gap) => `f(...${gap}require(${literal}))`,
    (literal, gap) => `\`\${${gap}require(${literal})}\``,
  ],
  'dynamic-import': [
    (literal, gap) => `import(${gap}${literal}${gap})`,
    (literal, gap) => `\`\${${gap}import(${literal})}\``,
  ],
}

/** 같은 지정자 값을 나타내는 문자열 리터럴 표기. 이스케이프 형태를 포함한다. */
const SPECIFIER_LITERALS: ReadonlyArray<(specifier: string) => string> = [
  specifier => `"${specifier}"`,
  specifier => `'${specifier}'`,
  specifier => `"${hexEscapeFirst(specifier)}"`,
  specifier => `"${unicodeEscapeFirst(specifier)}"`,
  specifier => `'${codePointEscapeFirst(specifier)}'`,
  specifier => `"${specifier.slice(0, 1)}\\\n${specifier.slice(1)}"`,
]

function disallowedSpecifiers(root: CspModuleRoot): string[] {
  return [
    root.name,
    `${root.name}/dist/runtime`,
    ...(root.dashVariants ? [`${root.name}-formats`, `${root.name}-formats/dist`] : []),
  ]
}

function allowedSpecifiers(root: CspModuleRoot): string[] {
  return [
    `${root.name}x`,
    `x${root.name}`,
    `./${root.name}`,
    `../${root.name}/index.js`,
    ...(root.dashVariants ? [] : [`${root.name}-plugin`]),
  ]
}

const MODULE_REFERENCE_FORMS = Object.keys(CSP_RULE_TABLE.modules.references) as CspModuleReferenceForm[]
const MODULE_ROOTS: readonly CspModuleRoot[] = CSP_RULE_TABLE.modules.roots

describe.each(MODULE_REFERENCE_FORMS)('audit:csp module reference %s', form => {
  const { message } = CSP_RULE_TABLE.modules.references[form]
  const samples = MODULE_REFERENCE_SAMPLES[form]

  it('is kept by the prefilter and reported by the AST for every disallowed root and literal form', () => {
    const mismatches: unknown[] = []
    for (const root of MODULE_ROOTS) {
      for (const specifier of disallowedSpecifiers(root)) {
        const expected = [{ rule: CSP_RULE_TABLE.modules.rule, message: `${message}: "${specifier}"` }]
        for (const literal of SPECIFIER_LITERALS) {
          for (const sample of samples) {
            for (const gap of GAPS) {
              const source = sample(literal(specifier), gap)
              const prefilter = mayContainCspViolation(source)
              const actual = reported(source)
              if (!prefilter || JSON.stringify(actual) !== JSON.stringify(expected)) {
                mismatches.push({ source, prefilter, actual })
              }
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('does not report specifiers outside the disallowed roots', () => {
    const sources = MODULE_ROOTS.flatMap(root =>
      allowedSpecifiers(root).flatMap(specifier => samples.map(sample => sample(`"${specifier}"`, ' '))),
    )
    const mismatches = collectMismatches(sources, source => {
      const actual = reported(source)
      return actual.length === 0 ? undefined : { source, actual }
    })
    expect(mismatches).toEqual([])
  })

  it('lets the prefilter skip escape-free sources without a disallowed root', () => {
    const sources = samples.map(sample => sample('"./local.js"', ' '))
    expect(sources.filter(source => mayContainCspViolation(source))).toEqual([])
  })
})

describe('audit:csp module prefilter selectivity', () => {
  it('skips root names that appear only as member calls or plain strings', () => {
    const keywords = new Set(MODULE_REFERENCE_FORMS.map(form => CSP_RULE_TABLE.modules.references[form].keyword))
    const sources = MODULE_ROOTS.flatMap(root => [
      `const name = "${root.name}"`,
      ...[...keywords].map(keyword => `obj.${keyword}("${root.name}")`),
    ])
    expect(sources.filter(source => mayContainCspViolation(source))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. 사례 문법 검증: 위 사례가 파서 오류 복구에 기대지 않는지 확인한다
// ---------------------------------------------------------------------------

describe('audit:csp samples are syntactically valid', () => {
  function syntaxErrors(source: string): string[] {
    const { diagnostics = [] } = ts.transpileModule(source, { fileName: 'sample.ts', reportDiagnostics: true })
    return diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
  }

  it('builds every sample shape without syntax errors', () => {
    const representativeArgument = ARGUMENT_SAMPLES['string-code'].satisfying[0]
    const sources = [
      ...Object.values(RULE_SAMPLES).flat(),
      ...CALL_TARGETS.flatMap(([name]) => [
        ...INVOCATION_KINDS.flatMap(kind =>
          GAPS.map(gap => INVOCATION_SAMPLES[kind](name, representativeArgument, gap)),
        ),
        ...[...globalCalleeForms(name), ...nonGlobalCalleeForms(name)].map(callee =>
          INVOCATION_SAMPLES.call(callee, representativeArgument, ' '),
        ),
      ]),
      ...Object.values(ARGUMENT_SAMPLES).flatMap(({ satisfying, unsatisfying }) =>
        [...satisfying, ...unsatisfying].map(argument => INVOCATION_SAMPLES.call('f', argument, ' ')),
      ),
      ...MODULE_REFERENCE_FORMS.flatMap(form =>
        MODULE_REFERENCE_SAMPLES[form].flatMap(sample => GAPS.map(gap => sample('"m"', gap))),
      ),
      ...MODULE_ROOTS.flatMap(root =>
        [...disallowedSpecifiers(root), ...allowedSpecifiers(root)].flatMap(specifier =>
          SPECIFIER_LITERALS.map(literal => `require(${literal(specifier)})`),
        ),
      ),
    ]

    const invalid = sources.flatMap(source => {
      const errors = syntaxErrors(source)
      return errors.length > 0 ? [{ source, errors }] : []
    })
    expect(invalid).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. 사전 검사가 걸러내야 하는 일반 코드와 위치 보고
// ---------------------------------------------------------------------------

describe('audit:csp lexical prefilter', () => {
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
