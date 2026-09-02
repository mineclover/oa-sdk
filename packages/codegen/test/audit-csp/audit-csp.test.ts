import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  auditCsp,
  auditCspBundle,
  auditCspSource,
  type CspViolation,
} from '../../src/cli/commands/audit-csp.js'
import { CliExitError } from '../../src/cli/lib/errors.js'

describe('Manifest V3 CSP Audit Scanner & CLI Command', () => {
  const setupTempDir = async (prefix = 'oa-csp-test-') => {
    return await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  }

  // =========================================================================
  // 1. AST SOURCE SCANNER UNIT TESTS
  // =========================================================================

  describe('auditCspSource AST Rule Verification', () => {
    it('passes clean JavaScript code without dynamic evaluation or disallowed imports', async () => {
      const cleanCode = `
        export function isUser(data) {
          if (data === null || typeof data !== 'object') return false;
          if (typeof data.id !== 'string') return false;
          if (typeof data.age !== 'number' || data.age < 0) return false;
          return true;
        }

        export function calculateTotal(items) {
          return items.reduce((acc, item) => acc + item.price, 0);
        }

        setTimeout(() => {
          console.log('Timer with function callback is clean');
        }, 100);

        setInterval(function() {
          console.log('Interval with function callback is clean');
        }, 1000);
      `
      const violations = await auditCspSource('clean.js', cleanCode)
      expect(violations).toEqual([])
    })

    it('detects eval() and window.eval() calls (csp/no-eval)', async () => {
      const code = `
        const result = eval('2 + 2');
        const winResult = window.eval('window.location.href');
        const globalResult = globalThis.eval('1');
        const indirectEval = (0, eval)('something()');
      `
      const violations = await auditCspSource('eval-test.js', code)
      expect(violations.length).toBe(4)
      expect(violations.every(v => v.rule === 'csp/no-eval')).toBe(true)
      expect(violations[0]?.line).toBe(2)
      expect(violations[1]?.line).toBe(3)
      expect(violations[2]?.line).toBe(4)
      expect(violations[3]?.line).toBe(5)
    })

    it('detects new Function() and Function() constructor calls (csp/no-new-function)', async () => {
      const code = `
        const add = new Function('a', 'b', 'return a + b');
        const callFn = Function('return this')();
        const winFn = new window.Function('return 42');
        const parenFn = new (Function)('return true');
      `
      const violations = await auditCspSource('new-function-test.js', code)
      expect(violations.length).toBe(4)
      expect(violations.every(v => v.rule === 'csp/no-new-function')).toBe(true)
      expect(violations[0]?.line).toBe(2)
      expect(violations[1]?.line).toBe(3)
      expect(violations[2]?.line).toBe(4)
      expect(violations[3]?.line).toBe(5)
    })

    it('detects setTimeout(string) and setInterval(string) calls (csp/no-string-settimeout / csp/no-string-setinterval)', async () => {
      const code = `
        setTimeout("alert('hello')", 1000);
        window.setTimeout('doSomething()', 500);
        setTimeout(\`console.log('\${user}')\`, 200);
        setInterval("pollServer()", 5000);
        window.setInterval('refresh()', 3000);
      `
      const violations = await auditCspSource('timer-test.js', code)
      expect(violations.length).toBe(5)

      const timeoutViolations = violations.filter(v => v.rule === 'csp/no-string-settimeout')
      const intervalViolations = violations.filter(v => v.rule === 'csp/no-string-setinterval')

      expect(timeoutViolations.length).toBe(3)
      expect(intervalViolations.length).toBe(2)
    })

    it('does NOT flag setTimeout / setInterval with function references or arrow functions', async () => {
      const code = `
        function handler() {}
        setTimeout(handler, 1000);
        setTimeout(() => handler(), 500);
        setInterval(function() { handler(); }, 2000);
        window.setTimeout(() => {}, 100);
      `
      const violations = await auditCspSource('valid-timers.js', code)
      expect(violations).toEqual([])
    })

    it('detects disallowed schema engine and SDK runtime ESM imports (csp/no-disallowed-import)', async () => {
      const code = `
        import Ajv from 'ajv';
        import addFormats from 'ajv-formats';
        import Ajv2020 from 'ajv/dist/2020';
        import { z } from 'zod';
        import { zodToSchema } from '@oa-sdk/codegen';
        import '@oa-sdk/core';
        import { parseSpec } from '@oa-sdk/parser';
      `
      const violations = await auditCspSource('imports-test.js', code)
      expect(violations.length).toBe(7)
      expect(violations.every(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
    })

    it('detects disallowed CommonJS require() and dynamic import() calls (csp/no-disallowed-import)', async () => {
      const code = `
        const Ajv = require('ajv');
        const { z } = require('zod');
        const sdk = require('@oa-sdk/core');
        async function load() {
          const mod = await import('zod');
          const ajvMod = await import('ajv');
          const sdkMod = await import('@oa-sdk/openapi-projection-contract');
        }
      `
      const violations = await auditCspSource('require-test.js', code)
      expect(violations.length).toBe(6)
      expect(violations.every(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
    })

    it('detects disallowed ESM re-exports (csp/no-disallowed-import)', async () => {
      const code = `
        export * from 'ajv';
        export { z } from 'zod';
        export { validateDocument } from '@oa-sdk/parser';
      `
      const violations = await auditCspSource('exports-test.js', code)
      expect(violations.length).toBe(3)
      expect(violations.every(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
    })

    it('allows clean local relative imports and standard utilities', async () => {
      const code = `
        import { isSurfaceBlock } from './guards/SurfaceBlock.js';
        import * as utils from '../utils/format.js';
        export { isSurfaceBlock };
        export * from './index.js';
      `
      const violations = await auditCspSource('local-imports.js', code)
      expect(violations).toEqual([])
    })
  })

  // =========================================================================
  // 2. BUNDLE AUDIT & CLI INTEGRATION TESTS
  // =========================================================================

  describe('auditCspBundle & CLI audit:csp Command', () => {
    it('passes a clean bundle directory containing multiple JS files', async () => {
      const bundleDir = await setupTempDir('clean-bundle-')

      await fs.writeFile(
        path.join(bundleDir, 'index.js'),
        `
        export * from './guards.js';
        `,
        'utf8',
      )

      await fs.writeFile(
        path.join(bundleDir, 'guards.js'),
        `
        export function isProfile(data) {
          return typeof data === 'object' && data !== null && typeof data.id === 'string';
        }
        `,
        'utf8',
      )

      const result = await auditCspBundle(bundleDir)
      expect(result.valid).toBe(true)
      expect(result.violations.length).toBe(0)
      expect(result.scannedFiles.length).toBe(2)
      expect(result.summary).toContain('0 CSP violations found')

      // Direct CLI invocation should succeed without throwing
      await expect(
        auditCsp.run({ bundle: bundleDir }),
      ).resolves.toBeUndefined()
    })

    it('audits a single JS file passed to --bundle', async () => {
      const bundleDir = await setupTempDir('single-file-')
      const targetFile = path.join(bundleDir, 'bundle.js')

      await fs.writeFile(
        targetFile,
        `
        export function isOk(x) { return Boolean(x); }
        `,
        'utf8',
      )

      const result = await auditCspBundle(targetFile)
      expect(result.valid).toBe(true)
      expect(result.scannedFiles).toEqual([targetFile])
    })

    it('fails and reports violations across multiple files in a bundle directory', async () => {
      const bundleDir = await setupTempDir('violating-bundle-')

      await fs.writeFile(
        path.join(bundleDir, 'bad-eval.js'),
        `
        export function runDynamic(code) {
          return eval(code);
        }
        `,
        'utf8',
      )

      await fs.writeFile(
        path.join(bundleDir, 'bad-import.js'),
        `
        import Ajv from 'ajv';
        const ajv = new Ajv();
        `,
        'utf8',
      )

      await fs.writeFile(
        path.join(bundleDir, 'bad-timer.js'),
        `
        setTimeout("alert('hello')", 500);
        `,
        'utf8',
      )

      const result = await auditCspBundle(bundleDir)
      expect(result.valid).toBe(false)
      expect(result.violations.length).toBe(3)
      expect(result.scannedFiles.length).toBe(3)

      const ruleMap = result.violations.map(v => v.rule)
      expect(ruleMap).toContain('csp/no-eval')
      expect(ruleMap).toContain('csp/no-disallowed-import')
      expect(ruleMap).toContain('csp/no-string-settimeout')

      // CLI execution must throw CliExitError(1)
      await expect(
        auditCsp.run({ bundle: bundleDir }),
      ).rejects.toThrow(CliExitError)
    })

    it('passes generated standalone guards output (split & single-file)', async () => {
      const { generateStandaloneGuards } = await import('../../src/standalone-guards/index.js')
      const outDir = await setupTempDir('gen-guards-csp-')

      const schemaDoc = {
        $defs: {
          SurfaceBlock: {
            type: 'object',
            required: ['id', 'type'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
            },
          },
          SurfaceParam: {
            type: 'object',
            required: ['name', 'value'],
            properties: {
              name: { type: 'string' },
              value: { type: 'number' },
            },
          },
        },
      }

      await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      const result = await auditCspBundle(outDir)
      expect(result.valid).toBe(true)
      expect(result.violations.length).toBe(0)
      expect(result.scannedFiles.length).toBeGreaterThanOrEqual(3)

      await expect(auditCsp.run({ bundle: outDir })).resolves.toBeUndefined()
    })

    it('throws error when bundle directory does not exist', async () => {
      const nonExistent = path.join(os.tmpdir(), 'non-existent-bundle-dir-12345')
      await expect(auditCspBundle(nonExistent)).rejects.toThrow(/번들 경로를 찾을 수 없습니다/)
    })

    it('throws error when directory has no JS files', async () => {
      const emptyDir = await setupTempDir('empty-bundle-')
      await fs.writeFile(path.join(emptyDir, 'readme.txt'), 'hello', 'utf8')
      await expect(auditCspBundle(emptyDir)).rejects.toThrow(/감사 대상 JavaScript 파일/)
    })
  })
})
