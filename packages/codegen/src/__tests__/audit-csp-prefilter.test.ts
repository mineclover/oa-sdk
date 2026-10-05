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
  type CspModuleReference,
  type CspModuleReferenceForm,
  type CspModuleReferenceSyntax,
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
 * (1) 모든 CspRuleId와 모듈 참조 구문에 위반 사례가 있는지 타입 수준에서 강제하고,
 * (2) 표의 항목을 순회해 사전 검사와 AST 결과가 함께 맞는지 확인하고,
 * (3) AST 규칙 밖에서 이름과 토큰을 숨기거나 바꾼 형태에 대해 "AST가 보고하면 사전 검사도 true"인지 확인한다.
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
/**
 * 레거시 8진수 이스케이프(`\000`-`\377`)는 첫 글자가 U+00FF 이하일 때만 쓸 수 있다. 세 자리로 채워 뒤따르는
 * 숫자가 이스케이프에 붙지 않게 한다.
 */
const octalEscapeFirst = (text: string) => `\\${text.codePointAt(0)!.toString(8).padStart(3, '0')}${text.slice(1)}`

/** 문자열 안에서 `\` 뒤에 오면 줄 연속이 되는 줄 종결자. */
const LINE_TERMINATORS = ['\n', '\r\n', ' ', ' '] as const

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
    'require("aj\\\r\nv")',
    'require("aj\\ v")',
    'import("\\u0061jv")',
    '\\u0072equire("zod")',
    'import/* gap */Ajv/* gap */from/* gap */"ajv"',
    '`${require("zod")}`',
    // 지정자 앞의 무관한 이스케이프(`\"`, 정규식 `\/`)가 이스케이프 해석의 정렬을 흐트러뜨리지 않는다.
    'const m = { "from": "a\\"b" }; const p = s.replace(/\\//g, "~1"); export * from "@oa\\-sdk/core"',
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

/** 표의 식별 토큰, 지정자 리터럴, 토큰 사이 공백/주석으로 모듈 참조 사례를 만든다. */
type SpecifierSample = (token: string, literal: string, gap: string) => string

/**
 * 모듈 참조 구문별 사례. 호출 구문은 표의 식별 토큰을 호출 대상으로 넣어 만들므로, 표에 토큰을 추가하면
 * 사례도 함께 늘어난다. 선언 구문은 문법이 고정되어 있어 키워드를 그대로 쓴다. 표의 토큰이 그 문법의
 * 키워드와 다르면 AST가 보고하지 않아 아래 테스트가 실패한다.
 * CspModuleReferenceSyntax에 구문을 추가하면 여기에 사례를 넣기 전까지 타입 오류가 난다.
 */
const SYNTAX_SAMPLES: { readonly [S in CspModuleReferenceSyntax]: NonEmpty<SpecifierSample> } = {
  ImportDeclaration: [
    (_token, literal, gap) => `import${gap}Ajv${gap}from${gap}${literal}`,
    (_token, literal, gap) => `import${gap}${literal}`,
    (_token, literal, gap) => `import${gap}{${gap}a${gap}as${gap}b${gap}}${gap}from${gap}${literal}`,
    (_token, literal, gap) => `import${gap}*${gap}as${gap}ns${gap}from${gap}${literal}`,
  ],
  ExportDeclaration: [
    (_token, literal, gap) => `export${gap}*${gap}from${gap}${literal}`,
    (_token, literal, gap) => `export${gap}{${gap}a${gap}}${gap}from${gap}${literal}`,
    (_token, literal, gap) => `export${gap}*${gap}as${gap}ns${gap}from${gap}${literal}`,
  ],
  ImportEqualsDeclaration: [
    (_token, literal, gap) => `import${gap}Ajv${gap}=${gap}require(${gap}${literal}${gap})`,
  ],
  CallExpression: [
    (token, literal, gap) => `${token}(${gap}${literal}${gap})`,
    (token, literal, gap) => `f(...${gap}${token}(${literal}))`,
    (token, literal, gap) => `\`\${${gap}${token}(${literal})}\``,
  ],
}

/** 같은 지정자 값을 나타내는 문자열 리터럴 표기. 이스케이프 형태를 포함한다. */
const SPECIFIER_LITERALS: ReadonlyArray<(specifier: string) => string> = [
  specifier => `"${specifier}"`,
  specifier => `'${specifier}'`,
  specifier => `"${hexEscapeFirst(specifier)}"`,
  specifier => `"${unicodeEscapeFirst(specifier)}"`,
  specifier => `'${codePointEscapeFirst(specifier)}'`,
  ...LINE_TERMINATORS.map(
    terminator => (specifier: string) => `"${specifier.slice(0, 1)}\\${terminator}${specifier.slice(1)}"`,
  ),
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

const MODULE_REFERENCES = Object.entries(CSP_RULE_TABLE.modules.references) as Array<
  [CspModuleReferenceForm, CspModuleReference]
>
const MODULE_ROOTS: readonly CspModuleRoot[] = CSP_RULE_TABLE.modules.roots
const MODULE_TOKENS: ReadonlySet<string> = new Set(MODULE_REFERENCES.flatMap(([, reference]) => reference.tokens))

/** 호출 구문(`require(...)`, `import(...)`)으로 지정자를 담는 표 항목과 그 호출 대상 토큰. */
const CALL_REFERENCES = MODULE_REFERENCES.filter(([, reference]) => reference.syntax === 'CallExpression')
const CALL_TOKENS: ReadonlySet<string> = new Set(CALL_REFERENCES.flatMap(([, reference]) => reference.tokens))

/** 표 항목의 토큰마다 구문 사례를 만든다. */
function referenceSources(reference: CspModuleReference, literal: string, gaps: readonly string[] = GAPS): string[] {
  return reference.tokens.flatMap(token =>
    SYNTAX_SAMPLES[reference.syntax].flatMap(sample => gaps.map(gap => sample(token, literal, gap))),
  )
}

describe.each(MODULE_REFERENCES)('audit:csp module reference %s', (_form, reference) => {
  /*
   * 표의 tokens와 AST가 노드에서 읽는 식별 토큰(MODULE_REFERENCE_READERS)이 어긋나면, 이 구문의 사례가 보고되지
   * 않거나 다른 구문의 메시지로 보고되어 이 테스트가 실패한다.
   */
  it('is identified by each table token and reported for every disallowed root and literal form', () => {
    const mismatches: unknown[] = []
    for (const root of MODULE_ROOTS) {
      for (const specifier of disallowedSpecifiers(root)) {
        const expected = [{ rule: CSP_RULE_TABLE.modules.rule, message: `${reference.message}: "${specifier}"` }]
        for (const literal of SPECIFIER_LITERALS) {
          for (const source of referenceSources(reference, literal(specifier))) {
            const prefilter = mayContainCspViolation(source)
            const actual = reported(source)
            if (!prefilter || JSON.stringify(actual) !== JSON.stringify(expected)) {
              mismatches.push({ source, prefilter, actual })
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('does not report specifiers outside the disallowed roots', () => {
    const sources = MODULE_ROOTS.flatMap(root =>
      allowedSpecifiers(root).flatMap(specifier => referenceSources(reference, `"${specifier}"`, [' '])),
    )
    const mismatches = collectMismatches(sources, source => {
      const actual = reported(source)
      return actual.length === 0 ? undefined : { source, actual }
    })
    expect(mismatches).toEqual([])
  })

  /*
   * 레거시 8진수 이스케이프는 strict 모드가 아닌 스크립트에서 올바른 JavaScript지만 TypeScript는 오류로 보고하므로
   * (파서는 복구해 같은 값을 만든다) 아래 문법 검증 사례에서 제외하고 여기서 따로 확인한다.
   */
  it('is kept by the prefilter and reported by the AST for legacy octal escapes in sloppy-mode scripts', () => {
    const mismatches: unknown[] = []
    for (const root of MODULE_ROOTS) {
      for (const specifier of disallowedSpecifiers(root)) {
        const expected = [{ rule: CSP_RULE_TABLE.modules.rule, message: `${reference.message}: "${specifier}"` }]
        for (const source of referenceSources(reference, `"${octalEscapeFirst(specifier)}"`, [' '])) {
          const prefilter = mayContainCspViolation(source)
          const actual = reported(source)
          if (!prefilter || JSON.stringify(actual) !== JSON.stringify(expected)) {
            mismatches.push({ source, prefilter, actual })
          }
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  /*
   * 잘못된 `\x`는 SyntaxError지만 TypeScript 파서는 복구하면서 그 백슬래시를 지정자 값에 남기고
   * (`"\x61jv/\xg"` → `ajv/\xg`), 사전 검사의 이스케이프 해석(cookStringEscapes)은 백슬래시를 버린다. 두 해석값은
   * 백슬래시가 없는 구간에서만 일치하지만, 금지 루트 이름에는 백슬래시가 없으므로 이스케이프로 숨긴 루트
   * 이름 바로 뒤에 잘못된 `\x`가 와도 사전 검사는 AST가 보고하는 위반을 놓치지 않아야 한다.
   */
  it('is kept by the prefilter when a malformed \\x escape follows an escaped root name', () => {
    const malformedSuffixes = ['/\\xg', '/\\x', '/\\x6']
    const mismatches: unknown[] = []
    for (const root of MODULE_ROOTS) {
      for (const suffix of malformedSuffixes) {
        // TypeScript는 잘못된 `\x`를 원문 그대로(백슬래시 포함) 지정자 값에 남긴다.
        const specifier = `${root.name}${suffix}`
        const expected = [{ rule: CSP_RULE_TABLE.modules.rule, message: `${reference.message}: "${specifier}"` }]
        for (const source of referenceSources(reference, `"${hexEscapeFirst(root.name)}${suffix}"`, [' '])) {
          const prefilter = mayContainCspViolation(source)
          const actual = reported(source)
          if (!prefilter || JSON.stringify(actual) !== JSON.stringify(expected)) {
            mismatches.push({ source, prefilter, actual })
          }
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('lets the prefilter skip escape-free sources without a disallowed root', () => {
    const sources = referenceSources(reference, '"./local.js"', [' '])
    expect(sources.filter(source => mayContainCspViolation(source))).toEqual([])
  })

  it('lets the prefilter skip escaped specifiers that decode to no disallowed root', () => {
    // `\u`는 식별자 이스케이프일 수도 있어 사전 검사가 항상 통과시키므로 제외한다.
    const literals = [...SPECIFIER_LITERALS.map(literal => literal('./local.js')), `"${octalEscapeFirst('./local.js')}"`]
      .filter(literal => literal.includes('\\') && !literal.includes('\\u'))
    expect(literals.length).toBeGreaterThan(0)
    const sources = literals.flatMap(literal => referenceSources(reference, literal, [' ']))
    expect(sources.filter(source => mayContainCspViolation(source))).toEqual([])
  })
})

describe('audit:csp module roots', () => {
  it('have no backslash in their names, which the escape-decoding prefilter relies on', () => {
    // cookStringEscapes는 지정자 해석값 중 백슬래시가 없는 구간만 보존한다(잘못된 `\x` 참고).
    expect(MODULE_ROOTS.map(root => root.name).filter(name => name.includes('\\'))).toEqual([])
  })
})

/**
 * `name`과 같은 이름의 멤버, 그리고 `name`에 접두사/접미사를 붙인 별칭
 * (`__require`, `__webpack_require__` 등 번들러가 만드는 이름 포함).
 */
function aliasCallees(name: string): string[] {
  return [
    `obj.${name}`,
    `module.${name}`,
    `${name}Like`,
    `$${name}`,
    `__${name}`,
    `__non_webpack_${name}__`,
    `__webpack_${name}__`,
  ]
}

describe('audit:csp module calls are identified only by table tokens', () => {
  it('does not report calls whose callee is not a table token', () => {
    const sources = [...CALL_TOKENS].flatMap(token =>
      aliasCallees(token)
        .filter(callee => !CALL_TOKENS.has(callee))
        .flatMap(callee => MODULE_ROOTS.map(root => `${callee}("${root.name}")`)),
    )
    const mismatches = collectMismatches(sources, source => {
      const actual = reported(source)
      return actual.length === 0 ? undefined : { source, actual }
    })
    expect(mismatches).toEqual([])
  })
})

describe('audit:csp module prefilter selectivity', () => {
  it('skips root names that appear only as member calls or plain strings', () => {
    const sources = MODULE_ROOTS.flatMap(root => [
      `const name = "${root.name}"`,
      ...[...MODULE_TOKENS].map(token => `obj.${token}("${root.name}")`),
    ])
    expect(sources.filter(source => mayContainCspViolation(source))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. 사전 검사 건전성: AST 규칙 밖에서 이름과 토큰을 숨기거나 바꾼 형태 (표 순회)
// ---------------------------------------------------------------------------

/** 같은 문자열 값의 표기. 문자열 리터럴 이스케이프에 더해 AST가 지금 읽지 않는 템플릿과 연결을 포함한다. */
const STRING_VALUE_FORMS: ReadonlyArray<(text: string) => string> = [
  ...SPECIFIER_LITERALS,
  text => `\`${text}\``,
  text => `"${text.slice(0, 1)}" + "${text.slice(1)}"`,
]

/** `import`처럼 식별자 참조로 쓸 수 없는 예약어인지 확인한다. */
function isReservedWord(word: string): boolean {
  const kind = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, word).scan()
  return kind >= ts.SyntaxKind.FirstReservedWord && kind <= ts.SyntaxKind.LastReservedWord
}

/**
 * `name`을 가리키거나 `name`에서 이름만 바꾼 호출 대상 표현식. AST 규칙이 지금 보고하지 않는 형태(계산된
 * 멤버 접근과 그 문자열 이스케이프, 중첩 전역 객체, 별칭)를 포함한다. `optionalChain`이면 생성자 호출에는
 * 쓸 수 없는 선택적 체이닝 형태도 넣는다.
 */
function disguisedCallees(name: string, optionalChain: boolean): string[] {
  const identifierReference = !isReservedWord(name)
  return [
    ...(identifierReference ? [`(0, ${name})`, `(${name})`] : []),
    ...(identifierReference && optionalChain ? [`${name}?.`] : []),
    ...CSP_GLOBAL_OBJECT_NAMES.flatMap(object => [
      ...STRING_VALUE_FORMS.map(key => `${object}[${key(name)}]`),
      `${object}.${object}.${name}`,
      ...(optionalChain ? [`${object}?.${name}`, `${object}?.[${STRING_VALUE_FORMS[0]!(name)}]`] : []),
    ]),
    ...aliasCallees(name),
  ]
}

/**
 * 태그된 템플릿 호출(``Function`return 1` ``, ``new Function`return 1` ``). AST 규칙이 지금 보고하지 않는
 * 알려진 공백이며(CSP_RULE_TABLE.callTargets 주석), 검사하도록 바뀌어도 사전 검사가 이를 통과시켜야 한다.
 */
function taggedTemplateInvocations(callee: string): string[] {
  return [`${callee}\`code()\``, `new ${callee}\`code()\``]
}

/** 표 항목(호출 대상 이름, 호출 구문 토큰)별로 이름과 토큰, 지정자를 숨기거나 바꾼 사례. */
function disguisedSourcesByEntry(): Array<[string, string[]]> {
  const callTargets = CALL_TARGETS.map(([name, target]): [string, string[]] => {
    const argument = ARGUMENT_SAMPLES[target.argument].satisfying[0]
    return [
      `call target ${name}`,
      [
        ...INVOCATION_KINDS.flatMap(invocation =>
          disguisedCallees(name, invocation === 'call').map(callee =>
            INVOCATION_SAMPLES[invocation](callee, argument, ' '),
          ),
        ),
        ...[...new Set([...globalCalleeForms(name), ...disguisedCallees(name, false)])].flatMap(
          taggedTemplateInvocations,
        ),
      ],
    ]
  })
  const moduleCalls = CALL_REFERENCES.flatMap(([form, reference]) =>
    reference.tokens.map((token): [string, string[]] => [
      `${form} token ${token}`,
      MODULE_ROOTS.flatMap(root => [
        ...disguisedCallees(token, true).map(callee => `${callee}(${STRING_VALUE_FORMS[0]!(root.name)})`),
        ...STRING_VALUE_FORMS.map(literal => `${token}(${literal(root.name)})`),
      ]),
    ]),
  )
  return [...callTargets, ...moduleCalls]
}

describe('audit:csp prefilter soundness beyond the AST rules', () => {
  /*
   * AST 규칙이 지금 보고하지 않는 형태라도, AST가 이를 읽도록 바뀌면(계산된 멤버 접근, 별칭 require,
   * 템플릿 지정자 등) 사전 검사도 함께 바뀌어야 한다. 그렇지 않으면 사전 검사가 건너뛴 파일의 위반이
   * 누락되므로, 어떤 형태든 "AST가 보고하면 사전 검사도 true"여야 한다.
   */
  it('keeps every disguised source that the AST reports', () => {
    const sources = disguisedSourcesByEntry().flatMap(([, entrySources]) => entrySources)
    const missed = collectMismatches(sources, source => {
      const actual = reported(source)
      return actual.length > 0 && !mayContainCspViolation(source) ? { source, actual } : undefined
    })
    expect(missed).toEqual([])
  })

  it('includes sources the prefilter skips for every table entry', () => {
    const vacuous = disguisedSourcesByEntry()
      .filter(([, entrySources]) => entrySources.every(source => mayContainCspViolation(source)))
      .map(([entry]) => entry)
    expect(vacuous).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. 사례 문법 검증: 위 사례가 파서 오류 복구에 기대지 않는지 확인한다
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
      ...MODULE_REFERENCES.flatMap(([, reference]) => referenceSources(reference, '"m"')),
      ...MODULE_ROOTS.flatMap(root =>
        [...disallowedSpecifiers(root), ...allowedSpecifiers(root)].flatMap(specifier =>
          STRING_VALUE_FORMS.map(literal => `const m = ${literal(specifier)}`),
        ),
      ),
      ...[...CALL_TOKENS].flatMap(token => aliasCallees(token).map(callee => `${callee}("m")`)),
      ...disguisedSourcesByEntry().flatMap(([, entrySources]) => entrySources),
    ]

    const invalid = sources.flatMap(source => {
      const errors = syntaxErrors(source)
      return errors.length > 0 ? [{ source, errors }] : []
    })
    expect(invalid).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 6. 사전 검사가 걸러내야 하는 일반 코드와 위치 보고
// ---------------------------------------------------------------------------

describe('audit:csp lexical prefilter', () => {
  const benign: Array<[string, string]> = [
    ['plain guard', 'export function isUser(data) { return typeof data === "object" && data !== null }'],
    ['evaluated identifiers', 'let evaluated0 = true; const evaluationRecord = { evaluatedAt: 1 }'],
    ['property access from/require', 'const xs = Array.from(ys); obj.require(1); const p = /a\\d+/'],
    ['typeof function', 'if (typeof cb === "function") cb()'],
    // 생성된 guard 번들의 형태: "from" 키와 JSON 포인터 이스케이프용 정규식이 함께 있다.
    [
      'module keyword text with unrelated escapes',
      'const s = { "from": { "type": "string" }, "pattern": "^\\\\d+$" }; p.replace(/~/g, "~0").replace(/\\//g, "~1")',
    ],
    ['escaped backslash before hex digits', 'const p = require("\\\\x7aod")'],
  ]

  it.each(benign)('skips AST analysis for %s', (_name, source) => {
    expect(mayContainCspViolation(source)).toBe(false)
    // 사전 검사를 거치지 않은 AST 규칙의 판정도 위반 없음이어야 한다.
    expect(reported(source)).toEqual([])
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
