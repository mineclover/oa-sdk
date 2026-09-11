import { createRequire } from 'node:module'
const req = createRequire('/Users/junwoobang/workflow/oa-sdk/packages/codegen/package.json')
const zodMod = await import(req.resolve('zod'))
const z = zodMod.z
import {
  generateZodFromSpec,
  createZod4Algebra,
  schemaToZod,
  createRuntimeZodValidators,
  createDynamicZodValidator,
} from '../../packages/codegen/src/zodgen/index.js'
import type { OasDocument, OasSchema } from '@oa-sdk/parser'

console.log('=== ADVERSARIAL STRESS-TESTING ===\n')

// 1. Stress-Test: 3-way mutual circular recursion (A -> B -> C -> A)
console.log('[Stress 1] Testing 3-component mutual circular references...')
const cyclicSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Cycle Spec', version: '1.0.0' },
  components: {
    schemas: {
      Alpha: {
        type: 'object',
        properties: { beta: { $ref: '#/components/schemas/Beta' } },
      },
      Beta: {
        type: 'object',
        properties: { gamma: { $ref: '#/components/schemas/Gamma' } },
      },
      Gamma: {
        type: 'object',
        properties: { alpha: { $ref: '#/components/schemas/Alpha' } },
      },
    },
  },
}

const cyclicCode = generateZodFromSpec(cyclicSpec)
const evalFn = new Function('z', `${cyclicCode.replace(/^import\s+.*$/gm, '').replace(/^export\s+type\s+.*$/gm, '').replace(/^export\s+const\s+/gm, 'const ')}\nreturn { AlphaSchema, BetaSchema, GammaSchema };`)
const cyclicSchemas = evalFn(z)

const testCycleData = {
  beta: {
    gamma: {
      alpha: {
        beta: {
          gamma: {},
        },
      },
    },
  },
}

const cycleParsed = cyclicSchemas.AlphaSchema.safeParse(testCycleData)
console.log(`  3-way mutual recursion safeParse: ${cycleParsed.success ? 'PASS' : 'FAIL'}`)
if (!cycleParsed.success) throw new Error('Failed 3-way mutual recursion')

// 2. Stress-Test: Escape injection in property names, descriptions, defaults
console.log('\n[Stress 2] Testing escape injection in identifiers, descriptions, defaults...')
const injectionSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Injection Spec', version: '1.0.0' },
  components: {
    schemas: {
      'Complex-Name.With$Symbols': {
        type: 'object',
        description: 'Testing "quotes", \'single\', \\backslashes\\, and \nnewlines\r\n',
        properties: {
          'weird-key.name[0]': {
            type: 'string',
            default: 'Default "with" \'quotes\' and \\backslashes\\',
          },
          'boolean-true-schema': true,
          'boolean-false-never': false,
        },
      },
    },
  },
}

const injectionCode = generateZodFromSpec(injectionSpec)
console.log('  Injection code successfully generated without syntax error.')
const jsCleanCode = injectionCode.replace(/^import\s+.*$/gm, '').replace(/^export\s+type\s+.*$/gm, '').replace(/^export\s+const\s+/gm, 'const ')
const injectionResult = new Function('z', jsCleanCode + '\nreturn ComplexNameWith$SymbolsSchema;')(z)

const injectionParsed = injectionResult.safeParse({})
console.log(`  Injection schema parsed with defaults: ${injectionParsed.success ? 'PASS' : 'FAIL'}`)
if (!injectionParsed.success) throw new Error('Injection schema failed to parse')

// 3. Stress-Test: Edge boolean schemas in runtime validator
console.log('\n[Stress 3] Testing boolean schemas in createDynamicZodValidator...')
const trueValidator = createDynamicZodValidator(true as unknown as OasSchema)
const falseValidator = createDynamicZodValidator(false as unknown as OasSchema)

const trueCheck = trueValidator.safeParse('any value').success && trueValidator.safeParse(12345).success
const falseCheck = !falseValidator.safeParse('anything').success && !falseValidator.safeParse(null).success
console.log(`  Boolean true schema accepts all: ${trueCheck ? 'PASS' : 'FAIL'}`)
console.log(`  Boolean false schema rejects all: ${falseCheck ? 'PASS' : 'FAIL'}`)
if (!trueCheck || !falseCheck) throw new Error('Boolean schema dynamic validator failed')

console.log('\n=== ALL ADVERSARIAL STRESS-TESTS PASSED ===')
