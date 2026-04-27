/**
 * SQLite driver benchmark for SQLiteWorkspaceIndex.
 *
 * Compares `better-sqlite3` (native) vs `node:sqlite` (Node ≥22 built-in)
 * against a synthetic workload representative of `oa-gen typegen --incremental`:
 * many small transactional writes (replaceFileIndex / upsertFile) followed
 * by queries (listFiles / listComponents / snapshot).
 *
 * Usage (from repo root or anywhere):
 *   node --import tsx packages/codegen/scripts/bench-sqlite-driver.ts
 *
 * Output:
 *   - JSON report at packages/codegen/.bench/sqlite-driver.json
 *   - One-paragraph human summary on stdout
 *
 * Architecture:
 *   - Orchestrator (default) forks one worker subprocess per
 *     (driver × phase × repetition) combination to avoid require-cache
 *     contamination and shared open handles.
 *   - Worker (BENCH_ROLE=worker) runs the workload via the public
 *     createSQLiteWorkspaceIndex API and reports timings as JSON on stdout.
 *   - To force `node:sqlite`, the worker pre-loads a stub that intercepts
 *     `require('better-sqlite3')` so that loadSqliteDriver() falls through.
 *     This keeps production source untouched.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import * as process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import type {
  WorkspaceComponentRecord,
  WorkspaceFileIndexData,
  WorkspaceFileRecord,
  WorkspaceRefRecord,
  WorkspaceSourceLocationRecord,
} from '../src/workspace-index.ts'
import {
  createSQLiteWorkspaceIndex,
  type SqliteDriverName,
} from '../src/sqlite-workspace-index.ts'

const __filename = fileURLToPath(import.meta.url)

// -----------------------------------------------------------------------------
// Workload synthesis
// -----------------------------------------------------------------------------

/** Synthetic workload size — moderate spec: 75 files, 5 components each, 5 refs. */
const WORKLOAD = {
  fileCount: 75,
  componentsPerFile: 5,
  refsPerFile: 5,
  sourceLocationsPerFile: 5,
} as const

type DriverChoice = SqliteDriverName

type Phase = 'cold' | 'warm'

interface WorkerResult {
  driver: DriverChoice
  phase: Phase
  reportedDriver: SqliteDriverName | null
  fallbackReason: string | null
  durationMs: number
  ops: {
    upsertFiles: number
    replaceFileIndex: number
    listFiles: number
    listComponents: number
    listRefs: number
    snapshot: number
  }
}

function makeFileRecord(idx: number, mutationSeed: number): WorkspaceFileRecord {
  return {
    filePath: `components/file-${idx.toString().padStart(4, '0')}.yaml`,
    contentHash: `sha256-${idx}-${mutationSeed}`,
    size: 1024 + (idx * 17 % 4096),
    mtimeMs: 1_700_000_000_000 + idx * 1000 + mutationSeed,
    parserVersion: '1.0.0',
    lastSeenRun: `run-${mutationSeed}`,
  }
}

function makeFileData(idx: number, mutationSeed: number): WorkspaceFileIndexData {
  const filePath = `components/file-${idx.toString().padStart(4, '0')}.yaml`
  const components: WorkspaceComponentRecord[] = []
  const refs: WorkspaceRefRecord[] = []
  const sourceLocations: WorkspaceSourceLocationRecord[] = []

  for (let c = 0; c < WORKLOAD.componentsPerFile; c += 1) {
    components.push({
      filePath,
      section: 'schemas',
      name: `Schema_${idx}_${c}`,
      pointer: `#/components/schemas/Schema_${idx}_${c}`,
      contentHash: `chash-${idx}-${c}-${mutationSeed}`,
      owner: `owner-${idx % 7}`,
      line: c * 10 + 1,
      column: 1,
    })
  }

  for (let r = 0; r < WORKLOAD.refsPerFile; r += 1) {
    const targetIdx = (idx + r + 1) % WORKLOAD.fileCount
    refs.push({
      fromFile: filePath,
      fromPointer: `#/components/schemas/Schema_${idx}_${r}/properties/ref_${r}`,
      refText: `./file-${targetIdx.toString().padStart(4, '0')}.yaml#/components/schemas/Schema_${targetIdx}_0`,
      kind: 'internal',
      resolved: true,
      toFile: `components/file-${targetIdx.toString().padStart(4, '0')}.yaml`,
      toPointer: `#/components/schemas/Schema_${targetIdx}_0`,
    })
  }

  for (let s = 0; s < WORKLOAD.sourceLocationsPerFile; s += 1) {
    sourceLocations.push({
      filePath,
      pointer: `#/components/schemas/Schema_${idx}_${s}`,
      line: s * 10 + 1,
      column: 1,
    })
  }

  return { components, refs, sourceLocations }
}

// -----------------------------------------------------------------------------
// Worker
// -----------------------------------------------------------------------------

async function runWorker(): Promise<void> {
  const driver = process.env['BENCH_FORCE_DRIVER'] as DriverChoice
  const phase = process.env['BENCH_PHASE'] as Phase
  const dbPath = process.env['BENCH_DB_PATH']
  const mutationSeed = Number(process.env['BENCH_MUTATION_SEED'] ?? '0')

  if (!driver || !phase || !dbPath) {
    throw new Error('Worker missing required env: BENCH_FORCE_DRIVER, BENCH_PHASE, BENCH_DB_PATH')
  }

  if (driver === 'node:sqlite') {
    blockBetterSqlite3()
  }

  const ops = {
    upsertFiles: 0,
    replaceFileIndex: 0,
    listFiles: 0,
    listComponents: 0,
    listRefs: 0,
    snapshot: 0,
  }

  const t0 = performance.now()

  const index = createSQLiteWorkspaceIndex({ dbPath })
  const reportedDriver = index.driverName ?? null
  const fallbackReason = index.fallbackReason ?? null

  if (phase === 'cold') {
    // Cold: populate from scratch (DB is freshly empty).
    for (let i = 0; i < WORKLOAD.fileCount; i += 1) {
      index.upsertFile(makeFileRecord(i, mutationSeed))
      ops.upsertFiles += 1
    }
    for (let i = 0; i < WORKLOAD.fileCount; i += 1) {
      index.replaceFileIndex(`components/file-${i.toString().padStart(4, '0')}.yaml`, makeFileData(i, mutationSeed))
      ops.replaceFileIndex += 1
    }
    // A few queries at the end to mimic post-write reads.
    void index.listFiles(); ops.listFiles += 1
    void index.listComponents(); ops.listComponents += 1
    void index.listRefs(); ops.listRefs += 1
    void index.snapshot(); ops.snapshot += 1
  } else {
    // Warm: DB already populated. Read everything then mutate ~10% of files.
    void index.listFiles(); ops.listFiles += 1
    void index.listComponents(); ops.listComponents += 1
    void index.listRefs(); ops.listRefs += 1
    void index.snapshot(); ops.snapshot += 1

    const mutateCount = Math.max(1, Math.floor(WORKLOAD.fileCount / 10))
    for (let i = 0; i < mutateCount; i += 1) {
      // Use mutationSeed offset so warm phase actually writes new content hashes.
      index.upsertFile(makeFileRecord(i, mutationSeed))
      ops.upsertFiles += 1
      index.replaceFileIndex(`components/file-${i.toString().padStart(4, '0')}.yaml`, makeFileData(i, mutationSeed))
      ops.replaceFileIndex += 1
    }

    void index.listComponents(); ops.listComponents += 1
    void index.listRefs(); ops.listRefs += 1
  }

  index.close()

  const t1 = performance.now()

  const result: WorkerResult = {
    driver,
    phase,
    reportedDriver,
    fallbackReason,
    durationMs: t1 - t0,
    ops,
  }

  process.stdout.write(`__BENCH_RESULT__${JSON.stringify(result)}\n`)
}

/**
 * Make `require('better-sqlite3')` fail in this process so that
 * loadSqliteDriver() falls through to `node:sqlite`. This emulates an
 * environment where the optional native dep is not installed, without
 * mutating production source.
 */
function blockBetterSqlite3(): void {
  // Acquire the mutable CJS Module constructor via createRequire — direct
  // `import * as Module` yields a frozen ESM namespace whose properties cannot
  // be reassigned.
  type ResolveFn = (request: string, ...rest: unknown[]) => string
  const localRequire = createRequire(__filename)
  const ModuleCtor = localRequire('node:module') as { _resolveFilename: ResolveFn }
  const original = ModuleCtor._resolveFilename
  ModuleCtor._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]): string {
    if (request === 'better-sqlite3') {
      const err = new Error("Cannot find module 'better-sqlite3' (forced by benchmark)") as Error & { code?: string }
      err.code = 'MODULE_NOT_FOUND'
      throw err
    }
    return original.apply(this, [request, ...rest])
  }
}

// -----------------------------------------------------------------------------
// Orchestrator
// -----------------------------------------------------------------------------

interface DriverPhaseStat {
  phase: Phase
  runs: WorkerResult[]
  medianMs: number | null
}

interface DriverReport {
  driver: DriverChoice
  available: boolean
  unavailableReason: string | null
  cold: DriverPhaseStat
  warm: DriverPhaseStat
}

interface BenchReport {
  generatedAt: string
  node: string
  platform: string
  workload: typeof WORKLOAD
  repetitions: number
  drivers: DriverReport[]
  comparison: {
    coldDeltaPct: number | null
    warmDeltaPct: number | null
    materiallyFasterColdThreshold: 30
    materiallyFasterWarmThreshold: 50
    verdict: 'keep' | 'reconsider' | 'inconclusive'
    rationale: string
  }
}

const REPETITIONS = 3

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  }
  return sorted[mid] ?? null
}

function detectNodeSqliteAvailability(): { available: boolean, reason: string | null } {
  try {
    const probe = spawnSync(process.execPath, ['-e', "require('node:sqlite'); process.exit(0)"], {
      encoding: 'utf8',
    })
    if (probe.status === 0) return { available: true, reason: null }
    return { available: false, reason: (probe.stderr || probe.stdout || 'unknown').trim() }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function detectBetterSqlite3Availability(): { available: boolean, reason: string | null } {
  try {
    const probe = spawnSync(
      process.execPath,
      ['-e', "require(require.resolve('better-sqlite3', { paths: [process.cwd()] })); process.exit(0)"],
      {
        encoding: 'utf8',
        cwd: resolve(dirname(__filename), '..'),
      },
    )
    if (probe.status === 0) return { available: true, reason: null }
    return { available: false, reason: (probe.stderr || probe.stdout || 'unknown').trim() }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function spawnWorker(args: {
  driver: DriverChoice
  phase: Phase
  dbPath: string
  mutationSeed: number
}): WorkerResult {
  const tsxBin = resolve(dirname(__filename), '..', '..', '..', 'node_modules', '.bin', 'tsx')
  const result = spawnSync(tsxBin, [__filename], {
    env: {
      ...process.env,
      BENCH_ROLE: 'worker',
      BENCH_FORCE_DRIVER: args.driver,
      BENCH_PHASE: args.phase,
      BENCH_DB_PATH: args.dbPath,
      BENCH_MUTATION_SEED: String(args.mutationSeed),
    },
    encoding: 'utf8',
    timeout: 30_000,
  })

  if (result.status !== 0) {
    throw new Error(
      `Worker failed (driver=${args.driver}, phase=${args.phase}, status=${result.status}): `
      + `${(result.stderr || result.stdout || '').slice(0, 1000)}`,
    )
  }

  const stdout = result.stdout || ''
  const marker = '__BENCH_RESULT__'
  const lineStart = stdout.lastIndexOf(marker)
  if (lineStart < 0) {
    throw new Error(`Worker did not emit a result marker. stdout=${stdout.slice(0, 500)}`)
  }
  const jsonEnd = stdout.indexOf('\n', lineStart)
  const jsonStr = stdout.slice(lineStart + marker.length, jsonEnd < 0 ? undefined : jsonEnd)
  return JSON.parse(jsonStr) as WorkerResult
}

function benchmarkDriver(driver: DriverChoice, available: boolean, unavailableReason: string | null): DriverReport {
  if (!available) {
    return {
      driver,
      available,
      unavailableReason,
      cold: { phase: 'cold', runs: [], medianMs: null },
      warm: { phase: 'warm', runs: [], medianMs: null },
    }
  }

  const coldRuns: WorkerResult[] = []
  const warmRuns: WorkerResult[] = []

  for (let rep = 0; rep < REPETITIONS; rep += 1) {
    // Each repetition uses a fresh DB directory so cold == truly cold.
    const dir = mkdtempSync(join(tmpdir(), `bench-sqlite-${driver.replace(':', '_')}-`))
    const dbPath = join(dir, 'state.sqlite')
    try {
      const cold = spawnWorker({ driver, phase: 'cold', dbPath, mutationSeed: rep + 1 })
      coldRuns.push(cold)
      // Sanity: ensure the worker actually used the requested driver.
      if (cold.reportedDriver && cold.reportedDriver !== driver) {
        throw new Error(`Cold worker reported driver=${cold.reportedDriver}, expected ${driver}`)
      }
      if (cold.fallbackReason) {
        throw new Error(`Cold worker entered fallback: ${cold.fallbackReason}`)
      }

      const warm = spawnWorker({ driver, phase: 'warm', dbPath, mutationSeed: rep + 100 })
      warmRuns.push(warm)
      if (warm.reportedDriver && warm.reportedDriver !== driver) {
        throw new Error(`Warm worker reported driver=${warm.reportedDriver}, expected ${driver}`)
      }
      if (warm.fallbackReason) {
        throw new Error(`Warm worker entered fallback: ${warm.fallbackReason}`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  return {
    driver,
    available: true,
    unavailableReason: null,
    cold: { phase: 'cold', runs: coldRuns, medianMs: median(coldRuns.map(r => r.durationMs)) },
    warm: { phase: 'warm', runs: warmRuns, medianMs: median(warmRuns.map(r => r.durationMs)) },
  }
}

function pct(better: number, slower: number): number {
  // Returns "how much faster `better` is than `slower`" as a positive number
  // when better < slower (i.e. faster). Negative means better is actually slower.
  if (slower <= 0) return 0
  return ((slower - better) / slower) * 100
}

function buildComparison(better: DriverReport, node: DriverReport): BenchReport['comparison'] {
  const coldA = better.cold.medianMs
  const coldB = node.cold.medianMs
  const warmA = better.warm.medianMs
  const warmB = node.warm.medianMs

  if (!better.available || !node.available || coldA === null || coldB === null || warmA === null || warmB === null) {
    return {
      coldDeltaPct: null,
      warmDeltaPct: null,
      materiallyFasterColdThreshold: 30,
      materiallyFasterWarmThreshold: 50,
      verdict: 'inconclusive',
      rationale: !better.available
        ? `better-sqlite3 unavailable: ${better.unavailableReason ?? 'unknown'}`
        : !node.available
          ? `node:sqlite unavailable: ${node.unavailableReason ?? 'unknown'}`
          : 'incomplete measurements',
    }
  }

  const coldDelta = pct(coldA, coldB)
  const warmDelta = pct(warmA, warmB)
  const coldMaterial = coldDelta >= 30
  const warmMaterial = warmDelta >= 50

  const verdict: 'keep' | 'reconsider' = coldMaterial || warmMaterial ? 'keep' : 'reconsider'
  const rationale = verdict === 'keep'
    ? `better-sqlite3 ${coldMaterial ? `≥30% faster on cold (${coldDelta.toFixed(1)}%)` : ''}`
      + `${coldMaterial && warmMaterial ? ' AND ' : ''}`
      + `${warmMaterial ? `≥50% faster on warm (${warmDelta.toFixed(1)}%)` : ''}`.trim()
    : `Neither threshold met: cold ${coldDelta.toFixed(1)}% (need ≥30), warm ${warmDelta.toFixed(1)}% (need ≥50). `
      + 'Reconsider whether the optional native dep is worth its complexity.'

  return {
    coldDeltaPct: coldDelta,
    warmDeltaPct: warmDelta,
    materiallyFasterColdThreshold: 30,
    materiallyFasterWarmThreshold: 50,
    verdict,
    rationale,
  }
}

async function runOrchestrator(): Promise<void> {
  const betterAvail = detectBetterSqlite3Availability()
  const nodeAvail = detectNodeSqliteAvailability()

  console.log(`[bench] node=${process.version} platform=${process.platform}/${process.arch}`)
  console.log(`[bench] better-sqlite3: ${betterAvail.available ? 'available' : `UNAVAILABLE (${betterAvail.reason ?? '?'})`}`)
  console.log(`[bench] node:sqlite:    ${nodeAvail.available ? 'available' : `UNAVAILABLE (${nodeAvail.reason ?? '?'})`}`)

  if (!nodeAvail.available) {
    console.log(`[bench] Skipping node:sqlite measurements; require Node ≥22 with sqlite enabled.`)
  }

  console.log(`[bench] workload: ${WORKLOAD.fileCount} files × ${WORKLOAD.componentsPerFile} components × ${WORKLOAD.refsPerFile} refs, repetitions=${REPETITIONS}`)

  const better = benchmarkDriver('better-sqlite3', betterAvail.available, betterAvail.reason)
  const node = benchmarkDriver('node:sqlite', nodeAvail.available, nodeAvail.reason)

  const report: BenchReport = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    workload: WORKLOAD,
    repetitions: REPETITIONS,
    drivers: [better, node],
    comparison: buildComparison(better, node),
  }

  const reportDir = resolve(dirname(__filename), '..', '.bench')
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, 'sqlite-driver.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  // Human summary
  const fmt = (n: number | null): string => (n === null ? 'n/a' : `${n.toFixed(1)} ms`)
  console.log('')
  console.log('='.repeat(72))
  console.log('SQLite driver benchmark (median of 3 runs per phase)')
  console.log('='.repeat(72))
  console.log(`  better-sqlite3  cold: ${fmt(better.cold.medianMs)}   warm: ${fmt(better.warm.medianMs)}`)
  console.log(`  node:sqlite     cold: ${fmt(node.cold.medianMs)}   warm: ${fmt(node.warm.medianMs)}`)
  if (report.comparison.coldDeltaPct !== null && report.comparison.warmDeltaPct !== null) {
    const cd = report.comparison.coldDeltaPct
    const wd = report.comparison.warmDeltaPct
    const sign = (n: number): string => (n >= 0 ? '+' : '')
    console.log('')
    console.log(`  better-sqlite3 vs node:sqlite — cold: ${sign(cd)}${cd.toFixed(1)}% faster, warm: ${sign(wd)}${wd.toFixed(1)}% faster`)
    console.log(`  Material thresholds: cold ≥30%, warm ≥50%`)
    console.log(`  Verdict: ${report.comparison.verdict.toUpperCase()} — ${report.comparison.rationale}`)
  } else {
    console.log(`  Verdict: ${report.comparison.verdict.toUpperCase()} — ${report.comparison.rationale}`)
  }
  console.log('')
  console.log(`Report written to: ${reportPath}`)
}

// -----------------------------------------------------------------------------
// Entry
// -----------------------------------------------------------------------------

const role = process.env['BENCH_ROLE'] ?? 'orchestrator'

if (role === 'worker') {
  runWorker().catch((err: unknown) => {
    process.stderr.write(`[worker] error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    process.exit(1)
  })
} else {
  runOrchestrator().catch((err: unknown) => {
    process.stderr.write(`[orchestrator] error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    process.exit(1)
  })
}
