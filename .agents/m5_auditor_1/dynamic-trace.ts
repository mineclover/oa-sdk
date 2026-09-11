import { createRequire } from 'node:module'
const req = createRequire('/Users/junwoobang/workflow/oa-sdk/packages/codegen/package.json')
const zodMod = await import(req.resolve('zod'))
const z = zodMod.z
import {
  generateZodFromSpec,
  createRuntimeZodValidators,
  createDynamicZodValidator,
  schemaToZod,
  normalizeOasForZodRuntime,
} from '../../packages/codegen/src/zodgen/index.js'
import type { OasDocument, OasSchema } from '@oa-sdk/parser'

console.log('=== FORENSIC AUDIT: DYNAMIC EXECUTION TRACING ===\n')

// 1. Trace Static Code Generation with Full OAS 3.2 Spec
const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Forensic Audit Spec', version: '1.0.0' },
  components: {
    schemas: {
      TreeNode: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          value: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100 },
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/TreeNode' },
          },
          coords: {
            type: 'array',
            prefixItems: [{ type: 'number' }, { type: 'number' }],
            items: false,
          },
        },
        unevaluatedProperties: false,
        description: 'Recursive tree node with strictly bounded value and sealed properties',
      },
      Animal: {
        type: 'object',
        discriminator: {
          propertyName: 'kind',
          mapping: {
            dog: '#/components/schemas/Dog',
            cat: '#/components/schemas/Cat',
          },
          defaultMapping: '#/components/schemas/UnknownAnimal',
        },
        oneOf: [
          { $ref: '#/components/schemas/Dog' },
          { $ref: '#/components/schemas/Cat' },
        ],
      },
      Dog: {
        type: 'object',
        required: ['kind', 'barkVolume'],
        properties: {
          kind: { type: 'string', const: 'dog' },
          barkVolume: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        },
        additionalProperties: false,
      },
      Cat: {
        type: 'object',
        required: ['kind', 'purrPitch'],
        properties: {
          kind: { type: 'string', const: 'cat' },
          purrPitch: { type: 'number', exclusiveMinimum: 20 },
        },
        additionalProperties: false,
      },
      UnknownAnimal: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string' },
          rawInfo: { type: 'string', default: 'unclassified' },
        },
        additionalProperties: true,
      },
    },
  },
}

console.log('[Trace 1] Generating Zod 4 TypeScript code from specification...')
const generatedCode = generateZodFromSpec(spec, { style: 'both' })
console.log('Generated Code Snippet (first 800 chars):')
console.log(generatedCode.slice(0, 800))
console.log('...\n')

// Verify generated code contains expected idioms
const checks = [
  { name: 'import { z } from "zod"', passed: generatedCode.includes("import { z } from 'zod'") },
  { name: 'z.lazy for TreeNode circular ref', passed: generatedCode.includes('z.lazy(() => TreeNodeSchema)') },
  { name: 'exclusive bounds .gt(0).lt(100)', passed: generatedCode.includes('.gt(0)') && generatedCode.includes('.lt(100)') },
  { name: 'tuple coords with items:false', passed: generatedCode.includes('z.tuple([z.number(), z.number()])') },
  { name: 'sealed object .strict()', passed: generatedCode.includes('.strict()') },
  { name: 'metadata .describe()', passed: generatedCode.includes('.describe("Recursive tree node') },
  { name: 'metadata .default(5)', passed: generatedCode.includes('.default(5)') },
  { name: 'discriminator with defaultMapping', passed: generatedCode.includes('z.discriminatedUnion("kind"') && generatedCode.includes('UnknownAnimalSchema') },
]

for (const c of checks) {
  console.log(`  Assertion [${c.passed ? 'PASS' : 'FAIL'}]: ${c.name}`)
  if (!c.passed) throw new Error(`Static code generation check failed: ${c.name}`)
}

// 2. Evaluate Generated Code in V8 runtime with live Zod
console.log('\n[Trace 2] Evaluating generated code in Node.js runtime...')
const jsCode = generatedCode
  .replace(/^import\s+.*$/gm, '')
  .replace(/^export\s+type\s+.*$/gm, '')
  .replace(/^export\s+const\s+/gm, 'const ')

const moduleEvalFn = new Function('z', `${jsCode}\nreturn { TreeNodeSchema, AnimalSchema, DogSchema, CatSchema, UnknownAnimalSchema };`)
const schemas = moduleEvalFn(z)

console.log('  Successfully instantiated schemas in V8 runtime.')

// Test TreeNodeSchema validation
const validTree = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  value: 42.5,
  coords: [10, 20],
  children: [
    {
      id: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      value: 99.9,
      coords: [1, 2],
      children: [],
    },
  ],
}

console.log('  Testing TreeNodeSchema with valid nested tree...')
const validResult = schemas.TreeNodeSchema.safeParse(validTree)
console.log(`  TreeNode safeParse(validTree): ${validResult.success ? 'SUCCESS' : 'FAILED'}`)
if (!validResult.success) throw new Error('Valid tree failed validation')

// Test boundary violations
console.log('  Testing TreeNodeSchema boundary violation (value: 0 at exclusiveMinimum)...')
const invalidBound1 = { ...validTree, value: 0 }
const bound1Result = schemas.TreeNodeSchema.safeParse(invalidBound1)
console.log(`  Bound 0 rejected: ${!bound1Result.success ? 'PASS' : 'FAIL'}`)
if (bound1Result.success) throw new Error('exclusiveMinimum boundary 0 should be rejected')

console.log('  Testing TreeNodeSchema boundary violation (value: 100 at exclusiveMaximum)...')
const invalidBound2 = { ...validTree, value: 100 }
const bound2Result = schemas.TreeNodeSchema.safeParse(invalidBound2)
console.log(`  Bound 100 rejected: ${!bound2Result.success ? 'PASS' : 'FAIL'}`)
if (bound2Result.success) throw new Error('exclusiveMaximum boundary 100 should be rejected')

// Test strictness violation
console.log('  Testing TreeNodeSchema sealing violation (extra undeclared key)...')
const extraKeyObj = { ...validTree, undeclaredProperty: 'malicious' }
const strictResult = schemas.TreeNodeSchema.safeParse(extraKeyObj)
console.log(`  Strict rejection: ${!strictResult.success ? 'PASS' : 'FAIL'}`)
if (strictResult.success) throw new Error('Strict sealing should reject undeclaredProperty')

// Test tuple length violation
console.log('  Testing tuple length violation (coords: [1, 2, 3] with items: false)...')
const invalidTuple = { ...validTree, coords: [1, 2, 3] }
const tupleResult = schemas.TreeNodeSchema.safeParse(invalidTuple)
console.log(`  Tuple rejection: ${!tupleResult.success ? 'PASS' : 'FAIL'}`)
if (tupleResult.success) throw new Error('Tuple with items:false should reject extra element')

// Test default value injection
console.log('  Testing DogSchema default value injection...')
const dogWithoutBark = { kind: 'dog' }
const dogParseResult = schemas.DogSchema.safeParse(dogWithoutBark)
console.log(`  Dog default barkVolume: ${dogParseResult.data?.barkVolume} (expected 5)`)
if (dogParseResult.data?.barkVolume !== 5) throw new Error('Default value 5 not applied')

// 3. Trace In-Memory Dynamic Runtime Validator Adapter
console.log('\n[Trace 3] Tracing in-memory createRuntimeZodValidators...')
const runtimeValidators = createRuntimeZodValidators(spec)
console.log(`  Runtime validators created for keys: ${Object.keys(runtimeValidators).join(', ')}`)

const treeVal = runtimeValidators.TreeNode
if (!treeVal) throw new Error('TreeNode validator missing from runtime validators')

console.log('  Testing runtime TreeNode validator with valid tree...')
const rtValid = treeVal.safeParse(validTree)
console.log(`  Runtime validTree safeParse: ${rtValid.success ? 'SUCCESS' : 'FAILED'}`)
if (!rtValid.success) throw new Error(`Runtime validator failed on valid tree: ${JSON.stringify(rtValid.error)}`)

console.log('  Testing runtime TreeNode validator with invalid data (coords as string)...')
const rtInvalid = treeVal.safeParse({ ...validTree, coords: 'invalid' })
console.log(`  Runtime invalid rejection: ${!rtInvalid.success ? 'PASS' : 'FAIL'}`)
if (rtInvalid.success) throw new Error('Runtime validator should have rejected invalid coords')

// 4. Trace createDynamicZodValidator on standalone schema
console.log('\n[Trace 4] Tracing createDynamicZodValidator on standalone schema...')
const standaloneSchema: OasSchema = {
  type: 'object',
  required: ['email', 'score'],
  properties: {
    email: { type: 'string', format: 'email' },
    score: { type: 'integer', minimum: 0, maximum: 100 },
  },
  unevaluatedProperties: false,
}

const dynVal = createDynamicZodValidator(standaloneSchema)
const goodEmail = dynVal.safeParse({ email: 'test@example.com', score: 95 })
const badEmail = dynVal.safeParse({ email: 'not-an-email', score: 95 })
const extraKey = dynVal.safeParse({ email: 'test@example.com', score: 95, foo: 'bar' })

console.log(`  Good email parse: ${goodEmail.success ? 'PASS' : 'FAIL'}`)
console.log(`  Bad email rejection: ${!badEmail.success ? 'PASS' : 'FAIL'}`)
console.log(`  Extra key rejection: ${!extraKey.success ? 'PASS' : 'FAIL'}`)

if (!goodEmail.success || badEmail.success || extraKey.success) {
  throw new Error('createDynamicZodValidator behavior check failed')
}

console.log('\n=== DYNAMIC EXECUTION TRACING COMPLETED: ALL CHECKS VERIFIED EMPIRICALLY ===')
