import * as fs from 'node:fs'
import ts from 'typescript'

const testFilePath = '/Users/junwoobang/workflow/oa-sdk/packages/codegen/test/e2e/zod4-generator.e2e.test.ts'
const sourceCode = fs.readFileSync(testFilePath, 'utf-8')
const sourceFile = ts.createSourceFile(testFilePath, sourceCode, ts.ScriptTarget.Latest, true)

interface TestInfo {
  name: string
  line: number
  expectCalls: number
  tautologies: string[]
  assertions: string[]
}

const tests: TestInfo[] = []
let currentTest: TestInfo | null = null

function visit(node: ts.Node) {
  if (ts.isCallExpression(node)) {
    const fnName = node.expression.getText(sourceFile)
    if (fnName === 'it' || fnName === 'test') {
      const firstArg = node.arguments[0]
      const testName = firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : 'unknown'
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      const prevTest = currentTest
      currentTest = {
        name: testName,
        line: pos.line + 1,
        expectCalls: 0,
        tautologies: [],
        assertions: [],
      }
      tests.push(currentTest)

      // Traverse children of this test
      node.arguments.forEach((arg, idx) => {
        if (idx > 0) ts.forEachChild(arg, visit)
      })

      currentTest = prevTest
      return
    }

    if (currentTest && fnName === 'expect') {
      currentTest.expectCalls++
      const parent = node.parent
      if (ts.isPropertyAccessExpression(parent) && ts.isCallExpression(parent.parent)) {
        const matcherCall = parent.parent
        const matcherName = parent.name.getText(sourceFile)
        const expectArg = node.arguments[0]?.getText(sourceFile) ?? ''
        const matcherArg = matcherCall.arguments[0]?.getText(sourceFile) ?? ''

        const fullAssertion = `${expectArg} .${matcherName}(${matcherArg})`
        currentTest.assertions.push(fullAssertion)

        // Check for tautologies
        if (expectArg === 'true' && matcherArg === 'true') {
          currentTest.tautologies.push(`expect(true).toBe(true)`)
        }
        if (expectArg === 'false' && matcherArg === 'false') {
          currentTest.tautologies.push(`expect(false).toBe(false)`)
        }
        if (expectArg === '1' && matcherArg === '1') {
          currentTest.tautologies.push(`expect(1).toBe(1)`)
        }
        if (expectArg === matcherArg && expectArg.length > 0 && !expectArg.includes('(')) {
          currentTest.tautologies.push(`expect(${expectArg}).${matcherName}(${matcherArg})`)
        }
      }
    }
  }

  ts.forEachChild(node, visit)
}

visit(sourceFile)

console.log(`Total tests detected: ${tests.length}`)
const testsWithZeroExpects = tests.filter(t => t.expectCalls === 0)
console.log(`Tests with 0 expects: ${testsWithZeroExpects.length}`)
if (testsWithZeroExpects.length > 0) {
  console.log('Zero expect tests:', testsWithZeroExpects.map(t => `${t.line}: ${t.name}`))
}

const testsWithTautologies = tests.filter(t => t.tautologies.length > 0)
console.log(`Tests with tautologies: ${testsWithTautologies.length}`)
if (testsWithTautologies.length > 0) {
  console.log('Tautology tests:', testsWithTautologies.map(t => `${t.line}: ${t.name} -> ${t.tautologies.join(', ')}`))
}

let totalExpects = 0
for (const t of tests) {
  totalExpects += t.expectCalls
}
console.log(`Total expect calls: ${totalExpects} (average ${(totalExpects / tests.length).toFixed(2)} per test)`)
