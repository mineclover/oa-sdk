import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { repositoryFile, sha256, type TestRunEvidence } from './lib/verification.js'

// Imports one native Vitest JSON report. Cached Turbo logs cannot enter this path.
try {
  const args = process.argv.slice(2)
  const values = (flag: string): string[] => args.flatMap((v, i) => v === flag ? [args[i + 1] ?? ''] : [])
  const one = (flag: string) => {
    const matches = values(flag)
    if (matches.length !== 1 || !matches[0]) throw new Error(`Expected exactly one ${flag}`)
    return matches[0]
  }
  const root = process.cwd()
  const runId = one('--run-id')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId)) throw new Error('Invalid run ID')
  const output = repositoryFile(root, one('--output'))
  if (existsSync(output)) throw new Error('Evidence snapshots are immutable; choose a new run ID and output file')
  const input = readFileSync(resolve(one('--input')))
  const report = JSON.parse(input.toString())
  if (!Array.isArray(report.testResults) || !Number.isFinite(report.startTime)) throw new Error('Expected a native Vitest JSON report')
  const track = one('--track')
  if (!['core', 'downstream', 'maintenance', 'internal'].includes(track)) throw new Error('Invalid track')
  const files: TestRunEvidence['files'] = report.testResults.map((file: {
    name: string; assertionResults: Array<{ fullName: string; status: string }>
  }) => {
    const name = relative(root, resolve(file.name)).split(sep).join('/')
    repositoryFile(root, name)
    const parts = name.split('/')
    if (parts[0] !== 'packages' || !parts[1]) throw new Error(`Expected a package test file: ${name}`)
    const pkg = JSON.parse(readFileSync(resolve(root, 'packages', parts[1], 'package.json'), 'utf8')).name
    const tests = file.assertionResults.map(test => {
      if (!['passed', 'failed', 'pending', 'todo', 'skipped', 'disabled'].includes(test.status)) throw new Error(`Unknown test status ${test.status}`)
      return { title: test.fullName, status: (test.status === 'passed' || test.status === 'failed' ? test.status : 'skipped') as 'passed' | 'failed' | 'skipped' }
    })
    return { file: name, package: pkg, track, resultSource: 'executed' as const,
      cases: tests.filter(t => t.status === 'passed').length,
      failed: tests.filter(t => t.status === 'failed').length,
      skipped: tests.filter(t => t.status === 'skipped').length, tests }
  })
  const passed = files.reduce((n, f) => n + f.cases, 0)
  const failed = files.reduce((n, f) => n + (f.failed ?? 0), 0)
  const skipped = files.reduce((n, f) => n + (f.skipped ?? 0), 0)
  if (passed !== report.numPassedTests || failed !== report.numFailedTests || passed + failed + skipped !== report.numTotalTests) throw new Error('Incomplete reporter totals')
  if (!report.success && failed === 0) throw new Error('Reporter indicates an infrastructure failure; no passing snapshot recorded')
  const sourceHashes: Record<string, string> = {}
  const capture = (file: string): void => {
    const absolute = repositoryFile(root, file)
    if (statSync(absolute).mtimeMs > report.startTime) {
      throw new Error(`Source changed after the test run started: ${file}; run tests again before importing`)
    }
    sourceHashes[file] = sha256(readFileSync(absolute))
  }
  for (const file of files) capture(file.file)
  const walk = (dir: string): void => {
    for (const entry of readdirSync(repositoryFile(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`
      if (entry.isDirectory() && !['node_modules', 'dist', '.git', '.turbo'].includes(entry.name)) walk(file)
      else if (entry.isFile()) capture(file)
    }
  }
  for (const dir of values('--source-dir')) walk(dir)
  const evidence = {
    schemaVersion: 1 as const, kind: 'test-run' as const, runId,
    recordedAt: new Date().toISOString(), startedAt: new Date(report.startTime).toISOString(),
    sourceBinding: 'captured-after-execution' as const, sourceHashes,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    worktree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() ? 'dirty' : 'clean',
    nodeVersion: process.version, command: one('--command'), reporterSha256: sha256(input),
    passed, failed, skipped, executedPassed: passed, cachedPassed: 0,
    passedFiles: files.filter(f => f.cases > 0).length, files,
  }
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
  console.log(`Recorded ${runId}: ${passed} direct passes, ${failed} failures, ${skipped} skips. No cache results imported.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
