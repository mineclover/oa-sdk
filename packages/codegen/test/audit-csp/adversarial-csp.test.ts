import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  auditCsp,
  auditCspBundle,
  auditCspSource,
  auditCspSourceSync,
  getTs,
  collectBundleFiles,
  type CspViolation,
} from '../../src/cli/commands/audit-csp.js'
import { generateStandaloneGuards } from '../../src/standalone-guards/index.js'
import { CliExitError } from '../../src/cli/lib/errors.js'

describe('Adversarial Manifest V3 CSP Audit Scanner Hardening Suite', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  const setupTempDir = async (prefix = 'oa-csp-adv-') => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  // =========================================================================
  // 1. OBFUSCATED & INDIRECT EVAL INVOCATIONS
  // =========================================================================
  describe('Adversarial Eval Detection (csp/no-eval)', () => {
    it('detects direct eval call in various syntactical contexts', async () => {
      const code = `
        function foo() {
          eval("console.log('direct eval')");
        }
        const x = eval("1 + 1");
        const ternary = true ? eval("2") : 0;
        const arrow = () => eval("3");
        class Evaluator {
          execute(code) { return eval(code); }
        }
      `
      const violations = await auditCspSource('eval-direct.js', code)
      expect(violations.length).toBe(5)
      expect(violations.every(v => v.rule === 'csp/no-eval')).toBe(true)
    })

    it('detects comma-expression indirect eval: (0, eval)("...") and deep nesting', async () => {
      const code = `
        const res1 = (0, eval)("1 + 1");
        const res2 = (0, 0, eval)("2 + 2");
        const res3 = (1, (2, (3, eval)))("3 + 3");
        const res4 = ((0, eval))("4 + 4");
      `
      const violations = await auditCspSource('eval-indirect-comma.js', code)
      expect(violations.length).toBe(4)
      expect(violations.every(v => v.rule === 'csp/no-eval')).toBe(true)
    })

    it('detects global object eval access: window.eval, globalThis.eval, self.eval, global.eval', async () => {
      const code = `
        window.eval("var a = 1;");
        globalThis.eval("var b = 2;");
        self.eval("var c = 3;");
        global.eval("var d = 4;");
        (0, window.eval)("var e = 5;");
        (0, globalThis.eval)("var f = 6;");
        ((globalThis).eval)("var g = 7;");
        ((window).eval)("var h = 8;");
      `
      const violations = await auditCspSource('eval-globals.js', code)
      expect(violations.length).toBe(8)
      expect(violations.every(v => v.rule === 'csp/no-eval')).toBe(true)
    })

    it('does NOT flag safe identifiers and local methods named evaluate or eval in non-global objects', async () => {
      const code = `
        function evaluate(expression) {
          return Number(expression);
        }
        const evaluateValue = evaluate("42");
        const evalScore = 95;
        const localObj = {
          eval(x) { return x * 2; }
        };
        const safeRes = localObj.eval(10);
      `
      const violations = await auditCspSource('eval-safe.js', code)
      expect(violations.filter(v => v.rule === 'csp/no-eval')).toHaveLength(0)
    })
  })

  // =========================================================================
  // 2. CONSTRUCTOR CALLS (new Function, Function)
  // =========================================================================
  describe('Adversarial Function Constructor Detection (csp/no-new-function)', () => {
    it('detects new Function(...) with various argument counts', async () => {
      const code = `
        const f0 = new Function("return 0;");
        const f1 = new Function("a", "return a;");
        const f2 = new Function("a", "b", "return a + b;");
        const f3 = new Function("a", "b", "c", "return a + b + c;");
      `
      const violations = await auditCspSource('fn-constructor-args.js', code)
      expect(violations.length).toBe(4)
      expect(violations.every(v => v.rule === 'csp/no-new-function')).toBe(true)
    })

    it('detects Function(...) invoked as a standard function call', async () => {
      const code = `
        const f0 = Function("return this;")();
        const f1 = (Function)("return 42;")();
        const f2 = (0, Function)("return true;")();
        const f3 = (1, (2, Function))("return 'dynamic';")();
      `
      const violations = await auditCspSource('fn-call-syntax.js', code)
      expect(violations.length).toBe(4)
      expect(violations.every(v => v.rule === 'csp/no-new-function')).toBe(true)
    })

    it('detects new window.Function, new globalThis.Function, globalThis.Function(...)', async () => {
      const code = `
        const w1 = new window.Function("return 1;");
        const w2 = window.Function("return 2;")();
        const g1 = new globalThis.Function("return 3;");
        const g2 = globalThis.Function("return 4;")();
        const s1 = new self.Function("return 5;");
        const gl1 = new global.Function("return 6;");
      `
      const violations = await auditCspSource('fn-globals.js', code)
      expect(violations.length).toBe(6)
      expect(violations.every(v => v.rule === 'csp/no-new-function')).toBe(true)
    })

    it('does NOT flag safe identifiers or user-defined functions with Function substring', async () => {
      const code = `
        class FunctionBuilder {
          build() { return () => 42; }
        }
        function createFunctionLike() { return () => true; }
        const fn = createFunctionLike();
        const isFunction = typeof fn === 'function';
      `
      const violations = await auditCspSource('fn-safe.js', code)
      expect(violations.filter(v => v.rule === 'csp/no-new-function')).toHaveLength(0)
    })
  })

  // =========================================================================
  // 3. STRING VS CALLBACK TIMERS (setTimeout, setInterval)
  // =========================================================================
  describe('Adversarial Timer Detection (setTimeout, setInterval)', () => {
    it('detects string literals in setTimeout and setInterval across global targets', async () => {
      const code = `
        setTimeout("alert('timeout')", 100);
        window.setTimeout("alert('win timeout')", 200);
        globalThis.setTimeout("alert('globalThis timeout')", 300);
        self.setTimeout("alert('self timeout')", 400);
        (0, setTimeout)("alert('comma timeout')", 500);

        setInterval("poll()", 1000);
        window.setInterval("pollWin()", 2000);
        globalThis.setInterval("pollGlobal()", 3000);
        self.setInterval("pollSelf()", 4000);
        (0, setInterval)("pollComma()", 5000);
      `
      const violations = await auditCspSource('timer-strings.js', code)
      expect(violations.length).toBe(10)

      const timeouts = violations.filter(v => v.rule === 'csp/no-string-settimeout')
      const intervals = violations.filter(v => v.rule === 'csp/no-string-setinterval')
      expect(timeouts.length).toBe(5)
      expect(intervals.length).toBe(5)
    })

    it('detects template literal strings (with and without substitutions) in timers', async () => {
      const code = `
        const cmd = "doWork()";
        setTimeout(\`console.log('static template')\`, 100);
        setTimeout(\`\${cmd}\`, 200);
        setInterval(\`tick(\${Date.now()})\`, 1000);
        window.setTimeout(\`
          const a = 1;
          const b = 2;
          console.log(a + b);
        \`, 500);
      `
      const violations = await auditCspSource('timer-templates.js', code)
      expect(violations.length).toBe(4)
      expect(violations.filter(v => v.rule === 'csp/no-string-settimeout').length).toBe(3)
      expect(violations.filter(v => v.rule === 'csp/no-string-setinterval').length).toBe(1)
    })

    it('passes safe timers with arrow functions, function expressions, identifiers, and bound methods', async () => {
      const code = `
        const handler = () => console.log('tick');
        function onInterval() { console.log('interval'); }
        const controller = {
          tick() { console.log('method'); }
        };

        setTimeout(() => console.log('arrow'), 100);
        setTimeout(function() { console.log('fn'); }, 200);
        setTimeout(handler, 300);
        setTimeout(controller.tick.bind(controller), 400);
        setTimeout(controller.tick, 500);

        setInterval(() => {}, 1000);
        setInterval(onInterval, 2000);
        window.setTimeout(() => {}, 0);
        globalThis.setInterval(() => {}, 500);
      `
      const violations = await auditCspSource('timer-safe.js', code)
      expect(violations.filter(v => v.rule.startsWith('csp/no-string-'))).toEqual([])
    })
  })

  // =========================================================================
  // 4. DISALLOWED RUNTIME IMPORTS & ENGINES (ajv, zod, @oa-sdk)
  // =========================================================================
  describe('Adversarial Disallowed Imports Detection (csp/no-disallowed-import)', () => {
    it('detects all forms of ESM static imports for ajv, zod, @oa-sdk', async () => {
      const code = `
        import Ajv from 'ajv';
        import { Ajv2020 } from 'ajv/dist/2020';
        import addFormats from 'ajv-formats';
        import ajvErrors from 'ajv-errors';
        import { z } from 'zod';
        import * as zod from 'zod';
        import { z as customZod } from 'zod';
        import 'zod';
        import '@oa-sdk/core';
        import { parseSpec } from '@oa-sdk/parser';
        import { validateOpenApiProjection } from '@oa-sdk/openapi-projection-contract';
        import { generateStandaloneGuards } from '@oa-sdk/codegen';
        import * as oaSdk from '@oa-sdk';
      `
      const violations = await auditCspSource('disallowed-esm-imports.js', code)
      expect(violations.length).toBe(13)
      expect(violations.every(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
    })

    it('detects all forms of ESM re-exports for ajv, zod, @oa-sdk', async () => {
      const code = `
        export * from 'ajv';
        export { Ajv2020 } from 'ajv/dist/2020';
        export * from 'ajv-formats';
        export { z } from 'zod';
        export * as zod from 'zod';
        export { parseSpec } from '@oa-sdk/parser';
        export { validateOpenApiProjection } from '@oa-sdk/openapi-projection-contract';
        export * from '@oa-sdk/codegen';
      `
      const violations = await auditCspSource('disallowed-esm-exports.js', code)
      expect(violations.length).toBe(8)
      expect(violations.every(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
    })

    it('detects CommonJS require(...) and TS import = require(...) calls', async () => {
      const code = `
        const Ajv = require('ajv');
        const formats = require('ajv-formats');
        const { z } = require('zod');
        const parser = require('@oa-sdk/parser');
        const contract = require('@oa-sdk/openapi-projection-contract');
        const codegen = require('@oa-sdk/codegen');
        import AjvType = require('ajv');
        import ZodType = require('zod');
        import SdkType = require('@oa-sdk/core');
      `
      const violations = await auditCspSource('disallowed-require.js', code)
      expect(violations.length).toBe(9)
      expect(violations.every(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
    })

    it('detects dynamic import(...) calls targeting disallowed packages', async () => {
      const code = `
        async function loadAjv() {
          const mod = await import('ajv');
          return mod;
        }
        async function loadZod() {
          const mod = await import('zod');
          return mod;
        }
        async function loadSdk() {
          const parser = await import('@oa-sdk/parser');
          const contract = await import('@oa-sdk/openapi-projection-contract');
          const codegen = await import('@oa-sdk/codegen');
          return { parser, contract, codegen };
        }
      `
      const violations = await auditCspSource('disallowed-dynamic-import.js', code)
      expect(violations.length).toBe(5)
      expect(violations.every(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
    })

    it('passes permitted local relative imports, node built-ins, and standard utility packages', async () => {
      const code = `
        import * as fs from 'node:fs';
        import * as path from 'node:path';
        import { isSurfaceBlock } from './guards/SurfaceBlock.js';
        import { isSurfaceParam } from '../guards/SurfaceParam.js';
        import { format } from 'date-fns';
        import lodash from 'lodash';
        import clsx from 'clsx';
        export * from './guards/SurfaceBlock.js';
        export { isSurfaceParam } from '../guards/SurfaceParam.js';
        const localMod = require('./local-helper.js');
        const nodeCrypto = require('node:crypto');
      `
      const violations = await auditCspSource('allowed-imports.js', code)
      expect(violations.filter(v => v.rule === 'csp/no-disallowed-import')).toHaveLength(0)
    })
  })

  // =========================================================================
  // 5. CLEAN STANDALONE GUARD BUNDLE 0 FALSE POSITIVES & RUNTIME EXECUTION
  // =========================================================================
  describe('Clean Standalone Guard Bundles 0 False Positives Verification', () => {
    it('verifies complex split guard bundle produces 0 CSP violations across all emitted files', async () => {
      const outDir = await setupTempDir('clean-complex-bundle-')

      const complexSchemaDoc = {
        $defs: {
          ProblemDetails: {
            type: 'object',
            required: ['type', 'title', 'status'],
            properties: {
              type: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'integer', minimum: 100, maximum: 599 },
              detail: { type: 'string' },
              instance: { type: 'string' },
              code: { type: 'string' },
              invalidParams: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'reason'],
                  properties: {
                    name: { type: 'string' },
                    reason: { type: 'string' },
                    path: { type: 'string' },
                  },
                },
              },
            },
          },
          SurfaceBlock: {
            type: 'object',
            required: ['id', 'selector', 'editable'],
            properties: {
              id: { type: 'string' },
              selector: { type: 'string' },
              editable: { type: 'boolean' },
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          SurfaceParam: {
            type: 'object',
            required: ['name', 'value', 'unquotedValue'],
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              unquotedValue: { type: 'string' },
            },
          },
          NumericBoundsTest: {
            type: 'object',
            required: ['positiveFloat', 'boundedInt'],
            properties: {
              positiveFloat: { type: 'number', exclusiveMinimum: 0 },
              boundedInt: { type: 'integer', minimum: 0, maximum: 1000 },
            },
          },
        },
      }

      // Generate split standalone guards
      const artifacts = await generateStandaloneGuards({
        schemaDocument: complexSchemaDoc,
        outDir,
        split: true,
      })

      expect(artifacts.length).toBeGreaterThanOrEqual(8)

      // Audit entire output bundle directory
      const auditResult = await auditCspBundle(outDir)
      expect(auditResult.valid).toBe(true)
      expect(auditResult.violations).toHaveLength(0)
      expect(auditResult.scannedFiles.length).toBeGreaterThanOrEqual(5)

      // Verify CLI command runs without throwing
      await expect(auditCsp.run({ bundle: outDir })).resolves.toBeUndefined()

      // Dynamic execution verification: Import guards and test narrowing
      const problemMod = await import(pathToFileURL(path.join(outDir, 'guards', 'ProblemDetails.js')).href)
      const blockMod = await import(pathToFileURL(path.join(outDir, 'guards', 'SurfaceBlock.js')).href)
      const numMod = await import(pathToFileURL(path.join(outDir, 'guards', 'NumericBoundsTest.js')).href)

      expect(problemMod.isProblemDetails({
        type: 'about:blank',
        title: 'Validation Error',
        status: 422,
        invalidParams: [{ name: 'selector', reason: 'Missing selector' }],
      })).toBe(true)

      expect(blockMod.isSurfaceBlock({
        id: 'block-1',
        selector: '.card',
        editable: true,
        tags: ['hero', 'main'],
      })).toBe(true)

      expect(numMod.isNumericBoundsTest({
        positiveFloat: 0.001,
        boundedInt: 500,
      })).toBe(true)

      expect(numMod.isNumericBoundsTest({
        positiveFloat: 0, // exclusiveMinimum: 0 should reject 0
        boundedInt: 500,
      })).toBe(false)
    })

    it('verifies that minLength in schemas compiles to zero runtime dependencies and passes CSP audit', async () => {
      const outDir = await setupTempDir('minlength-clean-')

      const minLengthSchema = {
        $defs: {
          StringWithMinLength: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1 },
            },
          },
        },
      }

      await generateStandaloneGuards({
        schemaDocument: minLengthSchema,
        outDir,
        split: true,
      })

      // The CSP scanner confirms 0 runtime dependencies and 0 violations
      const auditResult = await auditCspBundle(outDir)
      expect(auditResult.valid).toBe(true)
      expect(auditResult.violations.length).toBe(0)
    })

    it('empirically detects that raw unbundled require("ajv/dist/runtime/ucs2length") is intercepted by CSP scanner', async () => {
      const testCode = `
        const ucs2length = require("ajv/dist/runtime/ucs2length").default;
        export function validate(s) { return ucs2length(s) > 0; }
      `
      const ts = await getTs()
      const violations = auditCspSourceSync('test.js', testCode, ts)
      expect(violations.some(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
      expect(violations[0]?.snippet).toContain('ajv/dist/runtime/ucs2length')
    })

    it('verifies that any accidental forbidden code injection into bundle causes audit:csp to fail with exit code 1', async () => {
      const outDir = await setupTempDir('poisoned-bundle-')

      const schemaDoc = {
        $defs: {
          Sample: { type: 'object', properties: { id: { type: 'string' } } },
        },
      }

      await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      // Ensure initially clean
      const initial = await auditCspBundle(outDir)
      expect(initial.valid).toBe(true)

      // Poison 1: add an eval into a guard file
      await fs.appendFile(path.join(outDir, 'guards', 'Sample.js'), '\nconst _leak = (0, eval)("1");\n', 'utf8')

      const afterPoison1 = await auditCspBundle(outDir)
      expect(afterPoison1.valid).toBe(false)
      expect(afterPoison1.violations.some(v => v.rule === 'csp/no-eval')).toBe(true)

      // Poison 2: add a disallowed import into index.js
      await fs.appendFile(path.join(outDir, 'index.js'), "\nimport { z } from 'zod';\n", 'utf8')

      const afterPoison2 = await auditCspBundle(outDir)
      expect(afterPoison2.violations.some(v => v.rule === 'csp/no-disallowed-import')).toBe(true)

      // CLI must throw CliExitError
      await expect(auditCsp.run({ bundle: outDir })).rejects.toThrow(CliExitError)
    })
  })
})
