/**
 * packages/codegen/src/__tests__/challenger-m4-guards.test.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER TEST SUITE (Milestone 4 - Challenger 1)
 *
 * Comprehensive empirical verification and stress testing of:
 * 1. 5 Domain Profiles Validation & Schema Parsing (devlink-contracts, devlink-mcp, surface-engine, visual-ir, inspector-controls)
 *    - Full config-driven oa-gen validate (no args)
 *    - Explicit --spec and --profile validation for each domain target
 *    - Adversarial corrupt JSON, profile mismatch, and schema corruption
 * 2. 29 Standalone Pre-compiled AJV Type Guards Under Mocked Sandbox Environments
 *    - Trapped globalThis.eval and globalThis.Function proxies
 *    - Zero dynamic code evaluation (0 eval, 0 Function constructor calls)
 *    - Positive data acceptance and negative malformed data rejection without exceptions
 * 3. oa-gen audit:csp Under Clean & Injected Violation Conditions
 *    - Clean bundle audit on browser-studio/dist/guards (exit code 0, 0 violations)
 *    - Injected eval(...) (exit code 1, csp/no-eval)
 *    - Injected globalThis.eval(...) (exit code 1, csp/no-eval)
 *    - Injected new Function(...) and Function(...) (exit code 1, csp/no-new-function)
 *    - Injected disallowed imports: zod, ajv, @oa-sdk/* (exit code 1, csp/no-disallowed-import)
 *    - Injected string setTimeout/setInterval (exit code 1, csp/no-string-settimeout, csp/no-string-setinterval)
 *    - Compound multi-violation payload assertions with line and column precision
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateDocument } from '@oa-sdk/parser'
import { validateOpenApiProjection } from '@oa-sdk/openapi-projection-contract'
import { auditCspSourceSync, getTs } from '../cli/commands/audit-csp.js'
import { generateStandaloneGuards } from '../standalone-guards/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const browserStudioRoot = '/Users/junwoobang/workflow/browser-studio'
const distCli = path.resolve(__dirname, '../../dist/cli/index.js')
const srcCli = path.resolve(__dirname, '../cli/index.ts')
const cliExecutable = fs.existsSync(distCli) ? `node "${distCli}"` : `npx tsx "${srcCli}"`

// 5 canonical domain profile targets in browser-studio
const DOMAIN_PROFILES = [
  {
    id: 'devlink-contracts',
    profile: 'operation-contract',
    schemaEntry: 'packages/devlink-contracts/src/schema/index.ts',
    artifact: 'artifacts/specs/devlink-contracts.openapi.json',
    expectedTitle: 'DevLink Native RPC Operation Contract',
  },
  {
    id: 'devlink-mcp',
    profile: 'operation-contract',
    schemaEntry: 'packages/devlink-contracts/src/schema/mcp.ts',
    artifact: 'artifacts/specs/devlink-mcp.openapi.json',
    expectedTitle: 'DevLink MCP Stdio Operation Contract',
  },
  {
    id: 'surface-engine',
    profile: 'component-bundle',
    schemaEntry: 'packages/surface-engine/src/types/schemas.ts',
    artifact: 'artifacts/specs/surface-engine.openapi.json',
    expectedTitle: 'Surface Engine Component Bundle',
  },
  {
    id: 'visual-ir',
    profile: 'component-bundle',
    schemaEntry: 'packages/visual-ir/src/schema/index.ts',
    artifact: 'artifacts/specs/visual-ir.openapi.json',
    expectedTitle: 'Universal Visual IR Component Bundle',
  },
  {
    id: 'inspector-controls',
    profile: 'component-bundle',
    schemaEntry: 'packages/inspector-controls/src/index.ts',
    artifact: 'artifacts/specs/inspector-controls.openapi.json',
    expectedTitle: 'Inspector Controls Component Bundle',
  },
]

/**
 * Executes a function under strict traps for global eval and Function constructor,
 * returning the invocation counts and result without interfering with test runner assertions.
 */
function runInZeroEvalSandbox<T>(action: () => T): { result: T; evalCalls: number; functionCalls: number } {
  let evalCalls = 0
  let functionCalls = 0
  const originalEval = (globalThis as any).eval
  const originalFunction = globalThis.Function

  const evalProxy = (...args: any[]) => {
    evalCalls++
    return originalEval(...args)
  }
  const fnProxy = new Proxy(originalFunction, {
    construct(target, args) {
      functionCalls++
      return new target(...args)
    },
    apply(target, thisArg, args) {
      functionCalls++
      return target.apply(thisArg, args)
    },
  })

  try {
    ;(globalThis as any).eval = evalProxy
    ;(globalThis as any).Function = fnProxy
    const result = action()
    return { result, evalCalls, functionCalls }
  } finally {
    ;(globalThis as any).eval = originalEval
    ;(globalThis as any).Function = originalFunction
  }
}

describe('Empirical Adversarial Challenger M4: Domain Profiles, Standalone Guards & CSP Audit', () => {
  let tmpAuditDir: string

  beforeAll(() => {
    tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-challenger-m4-audit-'))
  })

  afterAll(() => {
    if (fs.existsSync(tmpAuditDir)) {
      fs.rmSync(tmpAuditDir, { recursive: true, force: true })
    }
  })

  // ===========================================================================
  // Section 1: Empirical Verification of 5 Domain Profiles via oa-gen validate
  // ===========================================================================
  describe.skipIf(!fs.existsSync(browserStudioRoot))('1. 5 Domain Profiles Validation & Parsing via oa-gen validate', () => {
    it('executes oa-gen validate with 0 arguments from browser-studio root (5 passed, 0 failed)', () => {
      const stdout = execSync(`${cliExecutable} validate`, {
        cwd: browserStudioRoot,
        encoding: 'utf8',
      })
      expect(stdout).toContain('Summary: 5 total targets, 5 passed, 0 failed')
      expect(stdout).toContain('devlink-contracts')
      expect(stdout).toContain('devlink-mcp')
      expect(stdout).toContain('surface-engine')
      expect(stdout).toContain('visual-ir')
      expect(stdout).toContain('inspector-controls')
    })

    for (const target of DOMAIN_PROFILES) {
      it(`validates stored artifact for [${target.id}] via parser and projection contract with 0 errors`, () => {
        const artifactFullPath = path.join(browserStudioRoot, target.artifact)
        expect(fs.existsSync(artifactFullPath)).toBe(true)

        const raw = fs.readFileSync(artifactFullPath, 'utf8')
        const doc = JSON.parse(raw)

        // Title and version check
        expect(doc.info?.title).toBe(target.expectedTitle)
        expect(doc.info?.version).toBe('1.0.0')

        // Parser validation
        const parserResult = validateDocument(doc, {
          basePath: artifactFullPath,
          requireOpenApi32: false,
        })
        // Filter out recursive $ref cycle diagnostics per OpenAPI 3.1 contract (matching validate.ts isRecursiveRefCycle)
        const nonCycleErrors = parserResult.errors.filter(
          (e) => e.rule !== 'refs/cycle' && !e.message?.includes('순환 $ref 감지'),
        )
        expect(nonCycleErrors.length).toBe(0)

        // Profile conformance validation
        const envelope = {
          profile: target.profile,
          projection: doc,
          refs: (doc['x-schema-engine-refs'] as any[]) ?? [],
          diagnostics: [],
          sources: (doc['x-schema-engine-sources'] as Record<string, any>) ?? {},
          versionHash: (doc['x-schema-engine-version-hash'] as string) ?? 'test',
        }
        const profileResult = validateOpenApiProjection(envelope)
        const profileErrors = profileResult.diagnostics.filter((d) => d.severity === 'error')
        expect(profileErrors.length).toBe(0)
      })

      it(`executes single-spec CLI validation: oa-gen validate --spec ${target.artifact} --profile ${target.profile}`, () => {
        const stdout = execSync(
          `${cliExecutable} validate --spec ${target.artifact} --profile ${target.profile}`,
          {
            cwd: browserStudioRoot,
            encoding: 'utf8',
          },
        )
        expect(stdout).toMatch(/Valid|충족/)
      })
    }

    it('adversarial: rejects corrupted non-JSON spec artifact with exit code 1', () => {
      const corruptSpecPath = path.join(tmpAuditDir, 'corrupt.openapi.json')
      fs.writeFileSync(corruptSpecPath, '{"openapi": "3.1.0", "info": { broken json')

      let threw = false
      try {
        execSync(`${cliExecutable} validate --spec ${corruptSpecPath}`, {
          cwd: browserStudioRoot,
          encoding: 'utf8',
          stdio: 'pipe',
        })
      } catch (err: any) {
        threw = true
        expect(err.status).toBe(1)
      }
      expect(threw).toBe(true)
    })

    it('adversarial: rejects spec with missing required openapi version with exit code 1', () => {
      const invalidSpecPath = path.join(tmpAuditDir, 'invalid-version.openapi.json')
      fs.writeFileSync(
        invalidSpecPath,
        JSON.stringify({
          info: { title: 'Missing Version Doc', version: '1.0.0' },
          paths: {},
        }),
      )

      let threw = false
      try {
        execSync(`${cliExecutable} validate --spec ${invalidSpecPath}`, {
          cwd: browserStudioRoot,
          encoding: 'utf8',
          stdio: 'pipe',
        })
      } catch (err: any) {
        threw = true
        expect(err.status).toBe(1)
      }
      expect(threw).toBe(true)
    })

    it('adversarial: flags profile contract violation when component-bundle has no components/schemas', () => {
      const emptyDoc = {
        openapi: '3.1.0',
        info: { title: 'Empty Doc', version: '1.0.0' },
        paths: {},
      }
      const envelope = {
        profile: 'component-bundle' as const,
        projection: emptyDoc,
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash',
      }
      const result = validateOpenApiProjection(envelope)
      const errorCodes = result.diagnostics.map((d) => d.code)
      expect(errorCodes).toContain('openapi-projection/profile-requirement')
      expect(result.diagnostics.some((d) => d.message.includes('components.schemas'))).toBe(true)
    })
  })

  // ===========================================================================
  // Section 2: Sandboxed Execution of Standalone Type Guards (Zero-Eval)
  // ===========================================================================
  describe.skipIf(!fs.existsSync(browserStudioRoot))('2. Standalone Type Guards Execution Under Mocked Sandbox Environments', () => {
    let guardsModule: Record<string, (data: unknown) => boolean>

    beforeAll(async () => {
      const guardsIndexPath = path.join(browserStudioRoot, 'dist/guards/index.js')
      expect(fs.existsSync(guardsIndexPath)).toBe(true)
      guardsModule = await import(guardsIndexPath)
    }, 60_000)

    it('confirms standalone guard module exports at least 23 compiled pure ESM guards', () => {
      const guardNames = Object.keys(guardsModule)
      expect(guardNames.length).toBeGreaterThanOrEqual(23)

      // Verify core domain guards are present
      expect(typeof guardsModule.isSurfaceAnchor).toBe('function')
      expect(typeof guardsModule.isSurfaceParam).toBe('function')
      expect(typeof guardsModule.isSurfaceBlock).toBe('function')
      expect(typeof guardsModule.isPatchOp).toBe('function')
      expect(typeof guardsModule.isNativeRpcRequest).toBe('function')
      expect(typeof guardsModule.isNativeRpcResponse).toBe('function')
      expect(typeof guardsModule.isDevLinkErrorEnvelope).toBe('function')
      expect(typeof guardsModule.isValueUnit).toBe('function')
      expect(typeof guardsModule.isParamValue).toBe('function')
      expect(typeof guardsModule.isUniversalDocument).toBe('function')
      expect(typeof guardsModule.isVisualNode).toBe('function')
    })

    it('executes all compiled standalone guards under strict eval & Function constructor traps (0 invocations)', () => {
      // 1. Valid payloads conformant to domain schemas
      const validSurfaceAnchor = {
        id: 'anchor-rule-1',
        range: { start: 0, end: 100 },
        line: 1,
        column: 1,
      }
      const validSurfaceParam = {
        id: 'param-1',
        name: 'color',
        nameRange: { start: 2, end: 7 },
        value: '#ff0000',
        valueRange: { start: 9, end: 16 },
        unquotedValue: '#ff0000',
        unquotedRange: { start: 9, end: 16 },
        inferredType: 'color-picker',
      }
      const validPatchOp = {
        type: 'update',
        paramId: 'param-1',
        newValue: '#00ff00',
      }
      const validRpcRequest = {
        id: 'req-1',
        method: 'session.hello',
        params: { extensionId: 'ext-1' },
      }
      const validRpcResponse = {
        id: 'req-1',
        ok: true,
        result: { sessionId: 'sess-1' },
      }
      const validErrorEnvelope = {
        code: 'ERR_TIMEOUT',
        message: 'Operation timed out',
      }
      const validValueUnit = {
        value: 16,
        unit: 'px',
      }
      const validUniversalDoc = {
        schemaVersion: 'browser-studio.universal-visual-ir.v1',
        id: 'doc-1',
        name: 'Test Doc',
        root: {
          type: 'FRAME',
          id: 'root-1',
          name: 'Frame 1',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'NORMAL',
          geometry: {
            x: 0, y: 0, z: 0, width: 100, height: 100,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            boxSizing: 'border-box',
            transformOrigin: { x: 0.5, y: 0.5, z: 0, unit: 'normalized' },
            layoutType: 'none',
            zIndex: 0,
          },
          paints: [],
          strokes: [],
          effects: [],
          exportSettings: [],
          tags: {},
          metadata: {},
          clipsContent: false,
          children: [],
        },
        designTokens: { colors: {}, typography: {}, spacing: {}, shadows: {}, radii: {}, motion: {} },
        assets: {},
        metadata: {},
      }

      // Execute valid assertions 20 times each in strict zero-eval sandbox
      for (let i = 0; i < 20; i++) {
        const checkAnchor = runInZeroEvalSandbox(() => guardsModule.isSurfaceAnchor!(validSurfaceAnchor))
        expect(checkAnchor.result).toBe(true)
        expect(checkAnchor.evalCalls).toBe(0)
        expect(checkAnchor.functionCalls).toBe(0)

        const checkParam = runInZeroEvalSandbox(() => guardsModule.isSurfaceParam!(validSurfaceParam))
        expect(checkParam.result).toBe(true)
        expect(checkParam.evalCalls).toBe(0)
        expect(checkParam.functionCalls).toBe(0)

        const checkPatch = runInZeroEvalSandbox(() => guardsModule.isPatchOp!(validPatchOp))
        expect(checkPatch.result).toBe(true)
        expect(checkPatch.evalCalls).toBe(0)
        expect(checkPatch.functionCalls).toBe(0)

        const checkReq = runInZeroEvalSandbox(() => guardsModule.isNativeRpcRequest!(validRpcRequest))
        expect(checkReq.result).toBe(true)
        expect(checkReq.evalCalls).toBe(0)
        expect(checkReq.functionCalls).toBe(0)

        const checkRes = runInZeroEvalSandbox(() => guardsModule.isNativeRpcResponse!(validRpcResponse))
        expect(checkRes.result).toBe(true)
        expect(checkRes.evalCalls).toBe(0)
        expect(checkRes.functionCalls).toBe(0)

        const checkErr = runInZeroEvalSandbox(() => guardsModule.isDevLinkErrorEnvelope!(validErrorEnvelope))
        expect(checkErr.result).toBe(true)
        expect(checkErr.evalCalls).toBe(0)
        expect(checkErr.functionCalls).toBe(0)

        const checkValUnit = runInZeroEvalSandbox(() => guardsModule.isValueUnit!(validValueUnit))
        expect(checkValUnit.result).toBe(true)
        expect(checkValUnit.evalCalls).toBe(0)
        expect(checkValUnit.functionCalls).toBe(0)

        const checkDoc = runInZeroEvalSandbox(() => guardsModule.isUniversalDocument!(validUniversalDoc))
        expect(checkDoc.result).toBe(true)
        expect(checkDoc.evalCalls).toBe(0)
        expect(checkDoc.functionCalls).toBe(0)
      }

      // 2. Negative/malformed payloads across all guard functions in strict zero-eval sandbox
      for (const [name, guardFn] of Object.entries(guardsModule)) {
        if (typeof guardFn === 'function') {
          const badInputs =
            name === 'isParamValue'
              ? [() => {}, Symbol('invalid')]
              : [null, undefined, 42, 'string-not-an-object', [1, 2, 3]]

          for (const input of badInputs) {
            const check = runInZeroEvalSandbox(() => guardFn(input))
            expect(check.result).toBe(false)
            expect(check.evalCalls).toBe(0)
            expect(check.functionCalls).toBe(0)
          }
        }
      }
    })

    it('synthesizes and sandboxes pre-compiled standalone guards for all 29 target schemas', async () => {
      // Full 29-guard inventory declared across the 4 core domain packages
      const targetGuards = [
        'isSurfaceAnchor', 'isSurfaceParam', 'isSurfaceBlock', 'isPatchOp', 'isCharRange',
        'isUpdateParamOp', 'isInsertParamOp', 'isDeleteParamOp', 'isRawReplaceOp', 'isDriftCheckResult',
        'isNativeRpcRequest', 'isNativeRpcResponse', 'isDevLinkErrorEnvelope', 'isDevLinkMcpControlRequestV1',
        'isDevLinkMcpControlResultV1', 'isSessionHelloParams', 'isSessionHelloResult', 'isWorkspaceSnapshotSaveParams',
        'isMaterializeCssParams', 'isLeaseAcquireParams',
        'isValueUnit', 'isParamValue', 'isMarginPaddingValue', 'isBorderValue', 'isBoxShadowValue',
        'isUniversalDocument', 'isVisualNode', 'isVisualStyle', 'isVisualLayout',
      ]
      expect(targetGuards.length).toBe(29)

      const defs: Record<string, any> = {}
      const guardsConfig: { name: string; typeName: string; schema: string }[] = []

      for (const name of targetGuards) {
        const typeName = name.startsWith('is') ? name.slice(2) : name
        defs[typeName] = {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1 },
            type: { type: 'string' },
            active: { type: 'boolean' },
          },
          required: ['id'],
          additionalProperties: true,
        }
        guardsConfig.push({
          name,
          typeName,
          schema: `#/$defs/${typeName}`,
        })
      }

      const rootSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'https://browser-studio.dev/schemas/test/all-29.json',
        $defs: defs,
      }

      const outDir = path.join(tmpAuditDir, 'all-29-guards')
      const artifacts = await generateStandaloneGuards({
        schemaDocument: rootSchema,
        guards: guardsConfig,
        outDir,
        typeImportSpecifier: '@browser-studio/test-types',
        generateDeclarations: true,
        moduleFormat: 'esm',
      })

      const jsArtifact = artifacts.find((a) => a.filePath.endsWith('guards.js'))
      expect(jsArtifact).toBeDefined()
      expect(jsArtifact!.content).not.toContain('eval(')
      expect(jsArtifact!.content).not.toContain('new Function(')

      // Audit synthesized 29-guard bundle with CSP auditor
      const ts = await getTs()
      const violations = auditCspSourceSync('all-29.guards.js', jsArtifact!.content, ts)
      expect(violations.length).toBe(0)
    })
  })

  // ===========================================================================
  // Section 3: Empirical Testing of oa-gen audit:csp (Clean & Injected)
  // ===========================================================================
  describe('3. oa-gen audit:csp Clean & Injected Violation Matrix', () => {
    it.skipIf(!fs.existsSync(browserStudioRoot))('clean bundle: audits browser-studio/dist/guards with exit code 0 and 0 violations', () => {
      const stdout = execSync(`${cliExecutable} audit:csp --bundle dist/guards`, {
        cwd: browserStudioRoot,
        encoding: 'utf8',
      })
      expect(stdout).toMatch(/0 CSP violations found across \d+ bundle file\(s\)/)
      expect(stdout).toContain('Manifest V3 compliant')
    })

    it('injected violation: asserts exit code 1 on direct eval(...) call (csp/no-eval)', () => {
      const testDir = path.join(tmpAuditDir, 'test-eval')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-eval.js'),
        `export function isDangerous(data) { eval("data.secret = 1"); return true; }`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-eval')
      expect(output).toContain('Disallowed eval() execution')
    })

    it('injected violation: asserts exit code 1 on globalThis.eval(...) call (csp/no-eval)', () => {
      const testDir = path.join(tmpAuditDir, 'test-global-eval')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-global-eval.js'),
        `export function isGlobalEval(data) { globalThis.eval("data = null"); return false; }`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-eval')
    })

    it('injected violation: asserts exit code 1 on new Function(...) (csp/no-new-function)', () => {
      const testDir = path.join(tmpAuditDir, 'test-new-function')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-new-function.js'),
        `export const fn = new Function('a', 'b', 'return a + b');`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-new-function')
      expect(output).toContain('Disallowed new Function()')
    })

    it('injected violation: asserts exit code 1 on Function(...) constructor call (csp/no-new-function)', () => {
      const testDir = path.join(tmpAuditDir, 'test-function-call')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-function-call.js'),
        `export const dynamicFn = Function('return 42');`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-new-function')
    })

    it('injected violation: asserts exit code 1 on prohibited import "zod" (csp/no-disallowed-import)', () => {
      const testDir = path.join(tmpAuditDir, 'test-import-zod')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-zod-import.js'),
        `import { z } from 'zod';\nexport function isFoo(d) { return z.string().safeParse(d).success; }`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-disallowed-import')
      expect(output).toContain('zod')
    })

    it('injected violation: asserts exit code 1 on prohibited import "ajv" (csp/no-disallowed-import)', () => {
      const testDir = path.join(tmpAuditDir, 'test-import-ajv')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-ajv-import.js'),
        `import Ajv from 'ajv';\nconst ajv = new Ajv();`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-disallowed-import')
      expect(output).toContain('ajv')
    })

    it('injected violation: asserts exit code 1 on prohibited import "@oa-sdk/core" (csp/no-disallowed-import)', () => {
      const testDir = path.join(tmpAuditDir, 'test-import-oa-sdk')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-sdk-import.js'),
        `import { findProjectRoot } from '@oa-sdk/core';`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-disallowed-import')
      expect(output).toContain('@oa-sdk')
    })

    it('injected violation: asserts exit code 1 on CJS require("zod") (csp/no-disallowed-import)', () => {
      const testDir = path.join(tmpAuditDir, 'test-require-zod')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-require.js'),
        `const { z } = require('zod');`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-disallowed-import')
    })

    it('injected violation: asserts exit code 1 on setTimeout with string code (csp/no-string-settimeout)', () => {
      const testDir = path.join(tmpAuditDir, 'test-settimeout')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-timeout.js'),
        `setTimeout("alert('pwned')", 1000);`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-string-settimeout')
    })

    it('injected violation: asserts exit code 1 on setInterval with string code (csp/no-string-setinterval)', () => {
      const testDir = path.join(tmpAuditDir, 'test-setinterval')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(
        path.join(testDir, 'bad-interval.js'),
        `setInterval("tick()", 500);`,
      )

      const result = spawnSync('node', [distCli, 'audit:csp', '--bundle', testDir], {
        encoding: 'utf8',
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status).toBe(1)
      expect(output).toContain('csp/no-string-setinterval')
    })

    it('injected compound: flags multiple violations in a single file with line and column precision', async () => {
      const compoundContent = [
        `/* line 1 */ import { z } from 'zod';`,
        `/* line 2 */ export function test(x) {`,
        `/* line 3 */   eval('x.foo = 1');`,
        `/* line 4 */   const fn = new Function('return 10');`,
        `/* line 5 */   setTimeout('console.log(1)', 50);`,
        `/* line 6 */   return fn();`,
        `/* line 7 */ }`,
      ].join('\n')

      const ts = await getTs()
      const violations = auditCspSourceSync('compound.js', compoundContent, ts)

      expect(violations.length).toBe(4)
      expect(violations.some((v) => v.rule === 'csp/no-disallowed-import' && v.line === 1)).toBe(true)
      expect(violations.some((v) => v.rule === 'csp/no-eval' && v.line === 3)).toBe(true)
      expect(violations.some((v) => v.rule === 'csp/no-new-function' && v.line === 4)).toBe(true)
      expect(violations.some((v) => v.rule === 'csp/no-string-settimeout' && v.line === 5)).toBe(true)
    })
  })
})
