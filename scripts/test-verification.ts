import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { loadVerification, renderVerification, sha256, validateVerification, type TestRunEvidence, type VerificationContext } from './lib/verification.js'

function createFixture(root: string): VerificationContext {
  const regression = 'packages/tools/src/tool-pipeline-regressions.test.ts'
  const other = 'packages/tools/test/other.test.ts'
  const source = 'packages/tools/src/openapi-hydrator.ts'
  const failingSource = 'packages/tools/src/table-ir.ts'
  const repro = 'docs/reports/reproduction.json'
  const report = 'docs/reports/review.md'
  const probe = 'scripts/probe.ts'
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  for (const file of [regression, other, source, failingSource, probe, report]) write(file, `fixture ${file}`)
  write(repro, JSON.stringify({ kind: 'defect-reproduction', observations: { counterexample: true },
    sourceHashes: { [failingSource]: sha256(readFileSync(join(root, failingSource))),
      [probe]: sha256(readFileSync(join(root, probe))) } }))
  const historical: TestRunEvidence & { packages: Record<string, { passed: number }> } = {
    schemaVersion: 1, kind: 'test-run', runId: 'core-downstream-20261026-historical', recordedAt: '2026-10-26',
    sourceBinding: 'unrecorded', sourceHashes: {}, passed: 2, failed: 0, skipped: 4, executedPassed: 1, cachedPassed: 1, passedFiles: 2,
    packages: { '@oa-sdk/tools': { passed: 2 } },
    files: [
      { file: regression, package: '@oa-sdk/tools', track: 'core', cases: 1, resultSource: 'cache' },
      { file: other, package: '@oa-sdk/tools', track: 'core', cases: 1, resultSource: 'executed' },
      { file: 'packages/tools/test/past-skipped.test.ts', package: '@oa-sdk/tools', track: 'core', cases: 0, skipped: 4, resultSource: 'executed' },
    ],
  }
  const focused: TestRunEvidence = {
    schemaVersion: 1, kind: 'test-run', runId: 'tools-20261026-management', recordedAt: '2026-10-26',
    sourceBinding: 'captured-after-execution',
    sourceHashes: Object.fromEntries([source, regression].map(f => [f, sha256(readFileSync(join(root, f)))])),
    passed: 1, failed: 0, skipped: 0, executedPassed: 1, cachedPassed: 0, passedFiles: 1,
    files: [{ file: regression, package: '@oa-sdk/tools', track: 'core', cases: 1, resultSource: 'executed',
      tests: [{ title: 'fixture exact assertion', status: 'passed' }] }],
  }
  return {
    root, features: [{ id: 'fixture', name: 'fixture feature', testPaths: [regression, other] },
      { id: 'unassessed', name: 'unassessed fixture', testPaths: [other] }],
    runs: new Map([[historical.runId, historical], [focused.runId, focused]]),
    registry: {
      schemaVersion: 1, updatedAt: '2026-10-26',
      runs: [{ id: historical.runId, artifact: 'docs/reports/historical.json' }, { id: focused.runId, artifact: 'docs/reports/focused.json' }],
      claims: [
        { id: 'verified-fixture', featureId: 'fixture', statement: 'fixture verified', status: 'verified', level: 'integration',
          scope: 'fixture only', excludes: ['external systems'], sourceFiles: [source, regression],
          evidence: [{ kind: 'regression', runId: focused.runId, file: regression, test: 'fixture exact assertion', assertion: 'fixture accepted' }] },
        { id: 'failing-fixture', featureId: 'fixture', statement: 'fixture failure', status: 'failing', level: 'unit',
          scope: 'fixture only', excludes: [], sourceFiles: [failingSource],
          evidence: [{ kind: 'reproduction', file: probe, artifact: repro, observation: 'counterexample', assertion: 'fixture mismatch' }] },
        { id: 'unverified-fixture', featureId: 'fixture', statement: 'external fixture', status: 'unverified', level: 'external-e2e',
          scope: 'external', excludes: [], sourceFiles: [source], evidence: [] },
      ],
      defects: [
        { id: 'FIXED', claimId: 'verified-fixture', priority: 'P1', state: 'fixed', title: 'fixed fixture', report, closeCriteria: 'passing fixture' },
        { id: 'OPEN', claimId: 'failing-fixture', priority: 'P2', state: 'open', title: 'open fixture', report, closeCriteria: 'correct fixture' },
      ],
    },
  }
}

const unitRoot = mkdtempSync(join(tmpdir(), 'oa-verification-unit-'))
try {
  // Validate live data separately; invariant fixtures never depend on how many
  // real defects remain open or on which historical runs are currently selected.
  assert.deepEqual(validateVerification(loadVerification(process.cwd())), [])
  const base = createFixture(unitRoot)
  assert.deepEqual(validateVerification(base), [])
  let checks = 1
  function reject(label: string, mutate: (context: VerificationContext) => void, message: string): void {
    const fixture = structuredClone(base)
    mutate(fixture)
    const errors = validateVerification(fixture)
    assert(errors.some(e => e.includes(message)), `${label}: expected ${message}, got ${errors.join('; ')}`)
    checks++
  }
  const historical = 'core-downstream-20261026-historical'
  const focused = 'tools-20261026-management'
  reject('inflated pass total', c => { c.runs.get(historical)!.passed++ }, 'passed total mismatch')
  reject('cache passes mislabeled as direct', c => { c.runs.get(historical)!.executedPassed++ }, 'executedPassed total mismatch')
  reject('duplicate file counted twice', c => { const r = c.runs.get(historical)!; r.files.push(r.files[0]!) }, 'duplicate identity')
  reject('skip counted as a pass', c => { c.runs.get(historical)!.skipped = 0 }, 'skipped total mismatch')
  reject('negative cases', c => { c.runs.get(historical)!.files[0]!.cases = -1 }, 'invalid case count')
  reject('wrong package identity', c => { c.runs.get(historical)!.files[0]!.package = '@oa-sdk/other' }, 'package/file mismatch')
  reject('inconsistent package summary', c => {
    const r = c.runs.get(historical)! as TestRunEvidence & { packages: Record<string, { passed: number }> }
    r.packages['@oa-sdk/tools']!.passed++
  }, 'package total mismatch')
  reject('unknown feature', c => { c.registry.claims[0]!.featureId = 'missing' }, 'unknown feature')
  reject('unknown issue claim', c => { c.registry.defects[0]!.claimId = 'missing' }, 'unknown claim')
  reject('verified claim without evidence', c => { c.registry.claims[0]!.evidence = [] }, 'verified needs current direct proof')
  reject('open defect on verified claim', c => { c.registry.defects[0]!.state = 'open' }, 'verified needs current direct proof')
  reject('closed defect without proof', c => { c.registry.claims[0]!.status = 'unverified' }, 'fixed needs a verified regression claim')
  reject('cache cannot establish a new guarantee', c => {
    const r = c.runs.get(focused)!
    for (const f of r.files) f.resultSource = 'cache'
    r.cachedPassed = r.passed; r.executedPassed = 0
  }, 'verified needs current direct proof')
  reject('unbound historical run cannot prove current source', c => { c.runs.get(focused)!.sourceBinding = 'unrecorded' }, 'verified needs current direct proof')
  reject('changed source requires review', c => { c.runs.get(focused)!.sourceHashes['packages/tools/src/openapi-hydrator.ts'] = '0'.repeat(64) }, 'verified needs current direct proof')
  reject('local passes cannot become external validation', c => { c.registry.claims[0]!.level = 'external-e2e' }, 'cannot establish external-e2e')
  reject('passing unrelated title is insufficient', c => { c.registry.claims[0]!.evidence[0]!.test = 'invented assertion'; c.registry.claims[0]!.evidence.splice(1) }, 'missing passing test title')
  reject('missing reproduction snapshot', c => { delete c.registry.claims.find(x => x.status === 'failing')!.evidence[0]!.artifact }, 'missing reproduction artifact')
  reject('source escape', c => { c.registry.claims[0]!.sourceFiles = ['../outside'] }, 'repository-relative file')
  reject('malformed run data', c => { (c.runs.get(historical)! as unknown as { files: unknown }).files = null }, 'Invalid verification data')
  const summary = renderVerification(base)
  assert(summary.includes('미평가') && summary.includes('서로 더하지 않는다'))
  assert(summary.includes('unverified · external-e2e') && summary.includes('open 1, fixed 1'))
  checks++

  // Exercise the importer boundary: native reporter totals, immutable outputs,
  // infrastructure failure, and statuses are different from product guarantees.
  mkdirSync('.oa-cache', { recursive: true })
  const temp = mkdtempSync(join(process.cwd(), '.oa-cache', 'verification-test-'))
  try {
    const input = join(temp, 'report.json')
    const output = relative(process.cwd(), join(temp, 'evidence.json'))
    const report = {
      startTime: Date.now(), success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
      testResults: [{ name: join(process.cwd(), 'packages/tools/src/tool-pipeline-regressions.test.ts'),
        assertionResults: [{ fullName: 'importer fixture only', status: 'passed' }] }],
    }
    const run = (extra: string[] = []) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/record-vitest-evidence.ts',
      '--run-id', 'importer-fixture', '--input', input, '--track', 'core',
      '--command', 'fixture; not a product test', '--output', output, ...extra], { encoding: 'utf8' })
    writeFileSync(input, JSON.stringify(report))
    assert.equal(run().status, 0)
    const imported = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(imported.executedPassed, 1); assert.equal(imported.cachedPassed, 0)
    assert.equal(run().status, 1, 'existing snapshots must not be overwritten')
    rmSync(output)
    writeFileSync(input, JSON.stringify({ ...report, numPassedTests: 9 }))
    assert.match(run().stderr, /Incomplete reporter totals/)
    writeFileSync(input, JSON.stringify({ ...report, success: false }))
    assert.match(run().stderr, /infrastructure failure/)
    writeFileSync(input, JSON.stringify({ ...report, success: false, numPassedTests: 0, numFailedTests: 1,
      testResults: [{ ...report.testResults[0], assertionResults: [{ fullName: 'failed fixture', status: 'failed' }] }] }))
    assert.equal(run().status, 0, 'recording failure evidence must not mislabel it as a pass')
    const failed = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(failed.failed, 1); assert.equal(failed.executedPassed, 0)
    rmSync(output)
    writeFileSync(input, JSON.stringify({ ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ fullName: 'fixture', status: 'invented' }] }] }))
    assert.match(run().stderr, /Unknown test status/)
    writeFileSync(input, JSON.stringify(report))
    const sourceDir = join(temp, 'sources')
    mkdirSync(sourceDir)
    const source = join(sourceDir, 'changed.ts')
    writeFileSync(source, 'export const changed = true')
    const modified = new Date(report.startTime + 1000)
    utimesSync(source, modified, modified)
    assert.match(run(['--source-dir', relative(process.cwd(), sourceDir)]).stderr, /Source changed after the test run started/)
    checks += 7
  } finally { rmSync(temp, { recursive: true, force: true }) }
  console.log(`Verification management: ${checks} invariant checks passed. These are governance checks, excluded from product test-run totals.`)

} finally { rmSync(unitRoot, { recursive: true, force: true }) }
