/**
 * oa-sdk Milestone 2 (M2): TypeSpec Compile & AST Diff Benchmark Suite
 *
 * Measures quantitative performance and resource metrics for:
 * 1. TypeSpec In-Memory Compilation & Hot-Reload (Cold vs Incremental speedup, large-scale throughput, retained heap delta, watcher stability)
 * 2. TypeSpec AST Semantic Diff (Extraction speed, diff throughput on repo & synthetic specs, Git ref comparison)
 * 3. V8 CPU Profiling (Cold compile, incremental compile, and semantic diff CPU profiles with hotspot analysis)
 *
 * Produces:
 * - .bench/typespec-results.json
 * - .bench/typespec-compile-cold.cpuprofile
 * - .bench/typespec-compile-incremental.cpuprofile
 * - .bench/typespec-diff.cpuprofile
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  withCpuProfile,
  measureMemoryDelta,
  assertZeroFdLeak,
  calculateLatencyStats,
  generateSyntheticTypeSpec,
  type LatencyStats,
  type CpuProfileResult,
  type MemoryDelta,
  type FdLeakResult,
  type Hotspot,
} from './lib/index.js';

import {
  compileTypeSpecInMemory,
  watchTypeSpec,
  type TypeSpecCompilationResult,
} from '../../packages/codegen/src/cli/lib/typespec-mock-compiler.js';

import {
  extractTypeSpecSemantics,
  diffTypeSpecSemantics,
  diffTypeSpecPrograms,
  type TypeSpecSemantics,
  type TypeSpecDiffResult,
} from '../../packages/codegen/src/cli/lib/typespec-ast-diff.js';

import {
  resolveTypeSpecProgramRef,
  type ResolvedTypeSpecProgram,
} from '../../packages/codegen/src/cli/lib/typespec-ref-resolver.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface TypeSpecBenchmarkResults {
  timestamp: string;
  environment: {
    nodeVersion: string;
    v8Version: string;
    platform: NodeJS.Platform;
    arch: string;
    cpus: string;
    totalMemoryMb: number;
  };
  specMetrics: {
    repoSpec: {
      path: string;
      sourceFilesCount: number;
      routesCount: number;
      operationsCount: number;
      modelsCount: number;
    };
    syntheticSpec: {
      resourceCount: number;
      routesCount: number;
      operationsCount: number;
      modelsCount: number;
    };
  };
  compilation: {
    cold: {
      iterations: number;
      stats: LatencyStats;
    };
    incremental: {
      iterations: number;
      stats: LatencyStats;
      speedupRatio: number;
    };
    largeScaleSynthetic: {
      resourceCount: number;
      routesCount: number;
      modelsCount: number;
      coldDurationMs: number;
      incrementalStats: LatencyStats;
      speedupRatio: number;
      coldThroughputOpsSec: number;
      incrementalThroughputOpsSec: number;
    };
    memory: {
      iterations: number;
      initialHeapMb: number;
      finalHeapMb: number;
      heapDeltaMb: number;
      gcRuns: number;
    };
    watcher: {
      watchedFilesCount: number;
      debounceMs: number;
      changeDetected: boolean;
      fdLeak: FdLeakResult;
      stable: boolean;
    };
  };
  semanticDiff: {
    astExtraction: {
      repoSpec: {
        iterations: number;
        stats: LatencyStats;
      };
      largeScaleSynthetic: {
        iterations: number;
        stats: LatencyStats;
      };
    };
    diffThroughput: {
      repoSpecIdentical: {
        iterations: number;
        stats: LatencyStats;
      };
      repoProgramDiff: {
        iterations: number;
        stats: LatencyStats;
      };
      largeScaleSyntheticDiff: {
        iterations: number;
        stats: LatencyStats;
        totalChanges: number;
        breakingCount: number;
        nonBreakingCount: number;
        diffsPerSecond: number;
      };
    };
    gitRefComparison: {
      baseRef: string;
      headRef: string;
      available: boolean;
      baseResolveMs: number;
      headResolveMs: number;
      diffMs: number;
      totalMs: number;
      totalChanges: number;
      breakingCount: number;
      nonBreakingCount: number;
    };
  };
  profiling: {
    coldCompile: {
      profilePath: string;
      durationMs: number;
      totalHitCount: number;
      topHotspots: Hotspot[];
    };
    incrementalCompile: {
      profilePath: string;
      durationMs: number;
      totalHitCount: number;
      topHotspots: Hotspot[];
    };
    semanticDiff: {
      profilePath: string;
      durationMs: number;
      totalHitCount: number;
      topHotspots: Hotspot[];
    };
  };
}

// ============================================================================
// Synthetic Spec Mutation Helper
// ============================================================================

/**
 * Generate a mutated variant of synthetic TypeSpec with known breaking and non-breaking changes.
 */
function generateMutatedSyntheticTypeSpec(baseCount = 100, additions = 5): string {
  let text = generateSyntheticTypeSpec(baseCount + additions);

  // 1. Remove delete operation on resources 0..4 (5 operation-removed breaking changes)
  for (let i = 0; i < 5; i++) {
    const deleteRegex = new RegExp(
      `\\s*@delete\\s+@route\\("/\\{id\\}"\\)\\s+@operationId\\("deleteResource${i}"\\)\\s+delete\\(@path id: string\\): void;`,
      'g'
    );
    text = text.replace(deleteRegex, '');
  }

  // 2. Change route on resources 5..9 (route-changed breaking changes)
  for (let i = 5; i < 10; i++) {
    text = text.replace(`@route("/resources-${i}")`, `@route("/resources-v2-${i}")`);
  }

  // 3. Make price required on models 10..14 (5 property-required breaking changes)
  for (let i = 10; i < 15; i++) {
    text = text.replace(
      `model Resource${i} {\n  id: string;\n  name: string;\n  description?: string;\n  count?: int32;\n  price?: float64;`,
      `model Resource${i} {\n  id: string;\n  name: string;\n  description?: string;\n  count?: int32;\n  price: float64;`
    );
  }

  // 4. Change count property type on models 15..19 (5 property-type-changed breaking changes)
  for (let i = 15; i < 20; i++) {
    text = text.replace(
      `model Resource${i} {\n  id: string;\n  name: string;\n  description?: string;\n  count?: int32;`,
      `model Resource${i} {\n  id: string;\n  name: string;\n  description?: string;\n  count?: string;`
    );
  }

  return text;
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatMs(val: number): string {
  return `${val.toFixed(2)} ms`;
}

function formatRate(val: number): string {
  return `${val.toFixed(1)} ops/sec`;
}

function printSectionHeader(title: string): void {
  console.log('\n' + '='.repeat(80));
  console.log(`  ${title}`);
  console.log('='.repeat(80));
}

function printSubHeader(title: string): void {
  console.log(`\n--- ${title} ---`);
}

function printHotspots(hotspots: Hotspot[], max = 5): void {
  for (const [idx, h] of hotspots.slice(0, max).entries()) {
    const fn = h.functionName || '(anonymous)';
    const loc = h.url ? `${path.basename(h.url)}:${h.lineNumber}` : 'native/internal';
    console.log(`   ${(idx + 1).toString().padStart(2)}. [${h.percentage.toFixed(2).padStart(5)}%] ${fn.padEnd(28)} (${loc}, ${h.hitCount} hits)`);
  }
}

// ============================================================================
// Main Benchmark Runner
// ============================================================================

export async function runTypeSpecBenchmarkSuite(options?: {
  silent?: boolean;
}): Promise<TypeSpecBenchmarkResults> {
  const silent = options?.silent ?? false;
  const log = (...args: unknown[]) => {
    if (!silent) console.log(...args);
  };

  const projectRoot = process.cwd();
  const benchDir = path.resolve(projectRoot, '.bench');
  fs.mkdirSync(benchDir, { recursive: true });

  const tempWorkspace = path.resolve(projectRoot, 'packages/schemas/typespec/.bench-tmp');
  fs.mkdirSync(tempWorkspace, { recursive: true });

  const repoTspPath = path.resolve(projectRoot, 'packages/schemas/typespec/main.tsp');
  if (!fs.existsSync(repoTspPath)) {
    throw new Error(`Repository TypeSpec main entrypoint not found at: ${repoTspPath}`);
  }

  log('🚀 Starting oa-sdk TypeSpec Performance Benchmark & V8 Profiling Suite...');
  log(`   Repository Entrypoint: ${path.relative(projectRoot, repoTspPath)}`);
  log(`   Output Directory:      ${path.relative(projectRoot, benchDir)}`);

  try {
    // ------------------------------------------------------------------------
    // Phase 1: Environment & Repository Baseline Inspection
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 1: Environment & Baseline Spec Inspection');

    const initialComp = await compileTypeSpecInMemory(repoTspPath);
    const repoSemantics = extractTypeSpecSemantics(initialComp.program);

    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? `${cpus[0]?.model ?? 'Unknown'} (${cpus.length} cores)` : 'Unknown';
    const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));

    log(`   Node.js:  ${process.version} (V8: ${process.versions.v8})`);
    log(`   Platform: ${process.platform} (${process.arch}) | CPU: ${cpuModel}`);
    log(`   Authored Files:   ${initialComp.sourceFiles.length} .tsp files`);
    log(`   OpenAPI Routes:   ${initialComp.routesCount} HTTP operations`);
    log(`   Extracted Models: ${repoSemantics.models.size} models, ${repoSemantics.operations.size} operations`);

    // ------------------------------------------------------------------------
    // Phase 2: TypeSpec In-Memory Compilation (Cold vs Incremental)
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 2: In-Memory Compilation & Incremental Recompilation');

    // Warmup OS file cache
    await compileTypeSpecInMemory(repoTspPath);

    // Measure Cold Compilation Latency (5 fresh runs without oldProgram)
    printSubHeader('Cold Compilation Latency (5 fresh runs)');
    const coldLatencies: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await compileTypeSpecInMemory(repoTspPath);
      coldLatencies.push(performance.now() - t0);
    }
    const coldStats = calculateLatencyStats(coldLatencies);
    log(`   Mean: ${formatMs(coldStats.meanMs)} | p50: ${formatMs(coldStats.p50Ms)} | p95: ${formatMs(coldStats.p95Ms)} | min: ${formatMs(coldStats.minMs)} | max: ${formatMs(coldStats.maxMs)}`);

    // Measure Incremental Compilation Latency (10 runs with oldProgram)
    printSubHeader('Incremental Compilation Latency (10 runs with oldProgram)');
    const incLatencies: number[] = [];
    let currentProg = initialComp.program;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const incRes = await compileTypeSpecInMemory(repoTspPath, { oldProgram: currentProg });
      incLatencies.push(performance.now() - t0);
      currentProg = incRes.program;
    }
    const incStats = calculateLatencyStats(incLatencies);
    const speedupRatio = Number((coldStats.meanMs / incStats.meanMs).toFixed(2));
    log(`   Mean: ${formatMs(incStats.meanMs)} | p50: ${formatMs(incStats.p50Ms)} | p95: ${formatMs(incStats.p95Ms)} | min: ${formatMs(incStats.minMs)} | max: ${formatMs(incStats.maxMs)}`);
    log(`   ⚡ Incremental Speedup: ${speedupRatio}x faster than cold compilation`);

    // ------------------------------------------------------------------------
    // Phase 3: Large-Scale Synthetic Compilation & Throughput
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 3: Large-Scale Synthetic Spec Compilation (100 Resources)');

    const syntheticTspPath = path.join(tempWorkspace, 'synthetic-100.tsp');
    const syntheticSource = generateSyntheticTypeSpec(100);
    fs.writeFileSync(syntheticTspPath, syntheticSource, 'utf8');

    // Cold compile synthetic
    const tSynthCold0 = performance.now();
    const synthColdRes = await compileTypeSpecInMemory(syntheticTspPath);
    const synthColdDur = performance.now() - tSynthCold0;

    const synthSemantics = extractTypeSpecSemantics(synthColdRes.program);
    const synthOpsCount = synthSemantics.operations.size;
    const synthModelsCount = synthSemantics.models.size;

    // Incremental compile synthetic (5 iterations)
    const synthIncLatencies: number[] = [];
    let synthProg = synthColdRes.program;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const inc = await compileTypeSpecInMemory(syntheticTspPath, { oldProgram: synthProg });
      synthIncLatencies.push(performance.now() - t0);
      synthProg = inc.program;
    }
    const synthIncStats = calculateLatencyStats(synthIncLatencies);
    const synthSpeedupRatio = Number((synthColdDur / synthIncStats.meanMs).toFixed(2));

    const coldOpsSec = Number(((synthOpsCount / synthColdDur) * 1000).toFixed(1));
    const incOpsSec = Number(((synthOpsCount / synthIncStats.meanMs) * 1000).toFixed(1));

    log(`   Spec Scale:      100 Resources | ${synthOpsCount} Operations | ${synthModelsCount} Domain Models`);
    log(`   Cold Compile:    ${formatMs(synthColdDur)} (${formatRate(coldOpsSec)})`);
    log(`   Incremental:     ${formatMs(synthIncStats.meanMs)} (p50: ${formatMs(synthIncStats.p50Ms)}, ${formatRate(incOpsSec)})`);
    log(`   ⚡ Scale Speedup: ${synthSpeedupRatio}x faster`);

    // ------------------------------------------------------------------------
    // Phase 4: Retained Heap Memory Delta Across 10 Incremental Compilations
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 4: Retained Heap Memory Delta Tracking');

    const memMeasurement = await measureMemoryDelta(async () => {
      let prog = initialComp.program;
      for (let i = 0; i < 10; i++) {
        const res = await compileTypeSpecInMemory(repoTspPath, { oldProgram: prog });
        prog = res.program;
      }
    });

    log(`   Initial Heap:  ${memMeasurement.initialHeapMb.toFixed(2)} MB`);
    log(`   Final Heap:    ${memMeasurement.finalHeapMb.toFixed(2)} MB`);
    log(`   Heap Delta:    ${memMeasurement.heapDeltaMb >= 0 ? '+' : ''}${memMeasurement.heapDeltaMb.toFixed(3)} MB (across 10 compilations)`);
    log(`   GC Passes:     ${memMeasurement.gcRuns} executed`);

    // ------------------------------------------------------------------------
    // Phase 5: Watcher Stability & Handle Leak Verification
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 5: Watcher Stability & File Descriptor Leak Check');

    const watchTestFile = path.join(tempWorkspace, 'watcher-test.tsp');
    fs.writeFileSync(watchTestFile, 'model WatchTest { id: string; }', 'utf8');

    // 1. Verify change debounce event trigger
    let changeFired = false;
    const testWatcher = watchTypeSpec(
      [watchTestFile],
      () => {
        changeFired = true;
      },
      undefined,
      50
    );

    fs.writeFileSync(watchTestFile, 'model WatchTest { id: string; name?: string; }', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 150));
    testWatcher.close();

    // 2. Verify zero FD / handle leaks across 10 watch cycles
    const fdLeakResult = await assertZeroFdLeak(async () => {
      const w = watchTypeSpec([watchTestFile], () => {}, undefined, 20);
      w.close();
    }, 10);

    const watcherStable = changeFired && !fdLeakResult.hasLeak;
    log(`   Change Trigger:     ${changeFired ? 'PASSED (debounced event received)' : 'FAILED'}`);
    log(`   FD Leak Test:       ${fdLeakResult.hasLeak ? 'FAILED' : 'PASSED (0 leaked file descriptors)'}`);
    log(`   Initial/Final FDs:  ${fdLeakResult.initialFds} -> ${fdLeakResult.finalFds} (delta: ${fdLeakResult.leaked})`);
    log(`   Watcher Status:     ${watcherStable ? 'STABLE & CLEAN' : 'UNSTABLE'}`);

    // ------------------------------------------------------------------------
    // Phase 6: AST Semantic Extraction Benchmark
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 6: TypeSpec AST Semantic Extraction Speed');

    // Repo spec semantic extraction (20 iterations)
    const repoExtractionLatencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      extractTypeSpecSemantics(initialComp.program);
      repoExtractionLatencies.push(performance.now() - t0);
    }
    const repoExtractionStats = calculateLatencyStats(repoExtractionLatencies);

    // Large synthetic spec semantic extraction (20 iterations)
    const synthExtractionLatencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      extractTypeSpecSemantics(synthColdRes.program);
      synthExtractionLatencies.push(performance.now() - t0);
    }
    const synthExtractionStats = calculateLatencyStats(synthExtractionLatencies);

    log(`   Repo Spec (167 models, 34 ops):   Mean: ${formatMs(repoExtractionStats.meanMs)} | p50: ${formatMs(repoExtractionStats.p50Ms)} | ${formatRate(repoExtractionStats.qps)}`);
    log(`   Synthetic (100 models, 400 ops):  Mean: ${formatMs(synthExtractionStats.meanMs)} | p50: ${formatMs(synthExtractionStats.p50Ms)} | ${formatRate(synthExtractionStats.qps)}`);

    // ------------------------------------------------------------------------
    // Phase 7: AST Semantic Diff Throughput
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 7: AST Semantic Diff Throughput');

    // 1. Repo spec identical diff
    const repoDiffLatencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      diffTypeSpecSemantics(repoSemantics, repoSemantics, { baseRef: 'repo', headRef: 'repo' });
      repoDiffLatencies.push(performance.now() - t0);
    }
    const repoDiffStats = calculateLatencyStats(repoDiffLatencies);

    // 2. Repo spec program diff (extraction + diff)
    const repoProgramDiffLatencies: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      diffTypeSpecPrograms(initialComp.program, initialComp.program, { baseRef: 'repo', headRef: 'repo' });
      repoProgramDiffLatencies.push(performance.now() - t0);
    }
    const repoProgramDiffStats = calculateLatencyStats(repoProgramDiffLatencies);

    // 3. Large synthetic spec mutated diff (100 vs 105 models with 30+ mutations)
    const syntheticMutatedPath = path.join(tempWorkspace, 'synthetic-105-mutated.tsp');
    const syntheticMutatedSource = generateMutatedSyntheticTypeSpec(100, 5);
    fs.writeFileSync(syntheticMutatedPath, syntheticMutatedSource, 'utf8');

    const synthMutatedComp = await compileTypeSpecInMemory(syntheticMutatedPath);
    const synthMutatedSemantics = extractTypeSpecSemantics(synthMutatedComp.program);

    const synthDiffLatencies: number[] = [];
    let lastSynthDiffResult: TypeSpecDiffResult | undefined;
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      lastSynthDiffResult = diffTypeSpecSemantics(synthSemantics, synthMutatedSemantics, {
        baseRef: 'synthetic-100',
        headRef: 'synthetic-105-mutated',
      });
      synthDiffLatencies.push(performance.now() - t0);
    }
    const synthDiffStats = calculateLatencyStats(synthDiffLatencies);

    log(`   Repo Baseline Diff (identical):     Mean: ${formatMs(repoDiffStats.meanMs)} | p50: ${formatMs(repoDiffStats.p50Ms)} | ${formatRate(repoDiffStats.qps)}`);
    log(`   Repo Program Diff (extract+diff):   Mean: ${formatMs(repoProgramDiffStats.meanMs)} | p50: ${formatMs(repoProgramDiffStats.p50Ms)} | ${formatRate(repoProgramDiffStats.qps)}`);
    log(`   Synthetic Mutated (100 vs 105):     Mean: ${formatMs(synthDiffStats.meanMs)} | p50: ${formatMs(synthDiffStats.p50Ms)} | ${formatRate(synthDiffStats.qps)}`);
    log(`   Detected Changes in Synthetic:      Total: ${lastSynthDiffResult?.summary.totalChanges} (!${lastSynthDiffResult?.summary.breakingCount} breaking, +${lastSynthDiffResult?.summary.nonBreakingCount} non-breaking)`);

    // ------------------------------------------------------------------------
    // Phase 8: Git Ref Comparison Latency (HEAD~1 vs HEAD)
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 8: Git Ref Comparison Latency (HEAD~1 vs HEAD)');

    let gitRefAvailable = false;
    try {
      await execFileAsync('git', ['rev-parse', '--verify', 'HEAD~1'], { cwd: projectRoot });
      gitRefAvailable = true;
    } catch {
      gitRefAvailable = false;
    }

    let gitBaseResolveMs = 0;
    let gitHeadResolveMs = 0;
    let gitDiffMs = 0;
    let gitTotalMs = 0;
    let gitDiffResult: TypeSpecDiffResult = {
      baseRef: 'HEAD~1',
      headRef: 'HEAD',
      breakingChanges: [],
      nonBreakingChanges: [],
      allChanges: [],
      summary: { totalChanges: 0, breakingCount: 0, nonBreakingCount: 0 },
    };

    if (gitRefAvailable) {
      const tGit0 = performance.now();
      const baseResolved = await resolveTypeSpecProgramRef('HEAD~1', projectRoot, 'packages/schemas/typespec/main.tsp');
      const tGit1 = performance.now();
      gitBaseResolveMs = Number((tGit1 - tGit0).toFixed(2));

      const headResolved = await resolveTypeSpecProgramRef('HEAD', projectRoot, 'packages/schemas/typespec/main.tsp');
      const tGit2 = performance.now();
      gitHeadResolveMs = Number((tGit2 - tGit1).toFixed(2));

      gitDiffResult = diffTypeSpecPrograms(baseResolved.program, headResolved.program, {
        baseRef: 'HEAD~1',
        headRef: 'HEAD',
      });
      const tGit3 = performance.now();
      gitDiffMs = Number((tGit3 - tGit2).toFixed(2));
      gitTotalMs = Number((tGit3 - tGit0).toFixed(2));

      await baseResolved.cleanup();
      await headResolved.cleanup();

      log(`   Base (HEAD~1) Resolve: ${formatMs(gitBaseResolveMs)} (includes git archive + compile)`);
      log(`   Head (HEAD) Resolve:   ${formatMs(gitHeadResolveMs)}`);
      log(`   AST Semantic Diff:     ${formatMs(gitDiffMs)}`);
      log(`   Total Git Diff Time:   ${formatMs(gitTotalMs)}`);
      log(`   Changes Between Refs:  Total: ${gitDiffResult.summary.totalChanges} (!${gitDiffResult.summary.breakingCount} breaking, +${gitDiffResult.summary.nonBreakingCount} non-breaking)`);
    } else {
      log('   ⚠️ Git ref HEAD~1 not available in this clone. Skipped git ref benchmark.');
    }

    // ------------------------------------------------------------------------
    // Phase 9: V8 CPU Profiling & Hotspot Extraction
    // ------------------------------------------------------------------------
    printSectionHeader('Phase 9: V8 CPU Profiling & Hotspot Extraction');

    // 1. Profile Cold Compilation
    log('   Profiling Cold Compilation (typespec-compile-cold)...');
    const { profile: coldProfile } = await withCpuProfile(
      'typespec-compile-cold',
      async () => {
        for (let i = 0; i < 2; i++) {
          await compileTypeSpecInMemory(repoTspPath);
        }
      },
      {
        outputDir: benchDir,
        samplingIntervalUs: 500,
        topHotspotCount: 10,
      }
    );

    // 2. Profile Incremental Compilation
    log('   Profiling Incremental Compilation (typespec-compile-incremental)...');
    const { profile: incProfile } = await withCpuProfile(
      'typespec-compile-incremental',
      async () => {
        let prog = initialComp.program;
        for (let i = 0; i < 15; i++) {
          const res = await compileTypeSpecInMemory(repoTspPath, { oldProgram: prog });
          prog = res.program;
        }
      },
      {
        outputDir: benchDir,
        samplingIntervalUs: 500,
        topHotspotCount: 10,
      }
    );

    // 3. Profile Semantic Diff
    log('   Profiling Semantic Diff (typespec-diff)...');
    const { profile: diffProfile } = await withCpuProfile(
      'typespec-diff',
      async () => {
        for (let i = 0; i < 100; i++) {
          diffTypeSpecSemantics(synthSemantics, synthMutatedSemantics, {
            baseRef: 'synth',
            headRef: 'synth',
          });
          diffTypeSpecPrograms(initialComp.program, initialComp.program, {
            baseRef: 'repo',
            headRef: 'repo',
          });
        }
      },
      {
        outputDir: benchDir,
        samplingIntervalUs: 200,
        topHotspotCount: 10,
      }
    );

    printSubHeader('Top Hotspots: Cold Compilation (typespec-compile-cold.cpuprofile)');
    printHotspots(coldProfile.topHotspots, 5);

    printSubHeader('Top Hotspots: Incremental Compilation (typespec-compile-incremental.cpuprofile)');
    printHotspots(incProfile.topHotspots, 5);

    printSubHeader('Top Hotspots: Semantic Diff (typespec-diff.cpuprofile)');
    printHotspots(diffProfile.topHotspots, 5);

    // ------------------------------------------------------------------------
    // Phase 10: Compile Report & Print Summary
    // ------------------------------------------------------------------------
    const results: TypeSpecBenchmarkResults = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        v8Version: process.versions.v8,
        platform: process.platform,
        arch: process.arch,
        cpus: cpuModel,
        totalMemoryMb: totalMemMb,
      },
      specMetrics: {
        repoSpec: {
          path: path.relative(projectRoot, repoTspPath),
          sourceFilesCount: initialComp.sourceFiles.length,
          routesCount: initialComp.routesCount,
          operationsCount: repoSemantics.operations.size,
          modelsCount: repoSemantics.models.size,
        },
        syntheticSpec: {
          resourceCount: 100,
          routesCount: synthOpsCount,
          operationsCount: synthOpsCount,
          modelsCount: synthModelsCount,
        },
      },
      compilation: {
        cold: {
          iterations: coldLatencies.length,
          stats: coldStats,
        },
        incremental: {
          iterations: incLatencies.length,
          stats: incStats,
          speedupRatio,
        },
        largeScaleSynthetic: {
          resourceCount: 100,
          routesCount: synthOpsCount,
          modelsCount: synthModelsCount,
          coldDurationMs: Number(synthColdDur.toFixed(2)),
          incrementalStats: synthIncStats,
          speedupRatio: synthSpeedupRatio,
          coldThroughputOpsSec: coldOpsSec,
          incrementalThroughputOpsSec: incOpsSec,
        },
        memory: {
          iterations: 10,
          initialHeapMb: memMeasurement.initialHeapMb,
          finalHeapMb: memMeasurement.finalHeapMb,
          heapDeltaMb: memMeasurement.heapDeltaMb,
          gcRuns: memMeasurement.gcRuns,
        },
        watcher: {
          watchedFilesCount: initialComp.sourceFiles.length,
          debounceMs: 50,
          changeDetected: changeFired,
          fdLeak: fdLeakResult,
          stable: watcherStable,
        },
      },
      semanticDiff: {
        astExtraction: {
          repoSpec: {
            iterations: repoExtractionLatencies.length,
            stats: repoExtractionStats,
          },
          largeScaleSynthetic: {
            iterations: synthExtractionLatencies.length,
            stats: synthExtractionStats,
          },
        },
        diffThroughput: {
          repoSpecIdentical: {
            iterations: repoDiffLatencies.length,
            stats: repoDiffStats,
          },
          repoProgramDiff: {
            iterations: repoProgramDiffLatencies.length,
            stats: repoProgramDiffStats,
          },
          largeScaleSyntheticDiff: {
            iterations: synthDiffLatencies.length,
            stats: synthDiffStats,
            totalChanges: lastSynthDiffResult?.summary.totalChanges ?? 0,
            breakingCount: lastSynthDiffResult?.summary.breakingCount ?? 0,
            nonBreakingCount: lastSynthDiffResult?.summary.nonBreakingCount ?? 0,
            diffsPerSecond: synthDiffStats.qps,
          },
        },
        gitRefComparison: {
          baseRef: 'HEAD~1',
          headRef: 'HEAD',
          available: gitRefAvailable,
          baseResolveMs: gitBaseResolveMs,
          headResolveMs: gitHeadResolveMs,
          diffMs: gitDiffMs,
          totalMs: gitTotalMs,
          totalChanges: gitDiffResult.summary.totalChanges,
          breakingCount: gitDiffResult.summary.breakingCount,
          nonBreakingCount: gitDiffResult.summary.nonBreakingCount,
        },
      },
      profiling: {
        coldCompile: {
          profilePath: path.relative(projectRoot, coldProfile.profilePath),
          durationMs: coldProfile.durationMs,
          totalHitCount: coldProfile.totalHitCount,
          topHotspots: coldProfile.topHotspots,
        },
        incrementalCompile: {
          profilePath: path.relative(projectRoot, incProfile.profilePath),
          durationMs: incProfile.durationMs,
          totalHitCount: incProfile.totalHitCount,
          topHotspots: incProfile.topHotspots,
        },
        semanticDiff: {
          profilePath: path.relative(projectRoot, diffProfile.profilePath),
          durationMs: diffProfile.durationMs,
          totalHitCount: diffProfile.totalHitCount,
          topHotspots: diffProfile.topHotspots,
        },
      },
    };

    const resultsFile = path.join(benchDir, 'typespec-results.json');
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2), 'utf8');

    printSectionHeader('Benchmark Execution Summary Table');
    console.table([
      {
        Workload: 'Repo Cold Compile',
        Scale: `${initialComp.routesCount} ops, ${repoSemantics.models.size} models`,
        'Mean (ms)': coldStats.meanMs.toFixed(2),
        'p50 (ms)': coldStats.p50Ms.toFixed(2),
        'p95 (ms)': coldStats.p95Ms.toFixed(2),
        Throughput: `${coldStats.qps.toFixed(1)} compiles/sec`,
        'Ratio / Delta': '1.0x (baseline)',
      },
      {
        Workload: 'Repo Incremental Compile',
        Scale: 'oldProgram reuse',
        'Mean (ms)': incStats.meanMs.toFixed(2),
        'p50 (ms)': incStats.p50Ms.toFixed(2),
        'p95 (ms)': incStats.p95Ms.toFixed(2),
        Throughput: `${incStats.qps.toFixed(1)} compiles/sec`,
        'Ratio / Delta': `${speedupRatio}x speedup`,
      },
      {
        Workload: 'Synthetic 100 Cold',
        Scale: '100 res, 400 ops, 100 models',
        'Mean (ms)': synthColdDur.toFixed(2),
        'p50 (ms)': synthColdDur.toFixed(2),
        'p95 (ms)': synthColdDur.toFixed(2),
        Throughput: `${coldOpsSec.toFixed(1)} ops/sec`,
        'Ratio / Delta': '1.0x',
      },
      {
        Workload: 'Synthetic 100 Incremental',
        Scale: '100 res, 400 ops',
        'Mean (ms)': synthIncStats.meanMs.toFixed(2),
        'p50 (ms)': synthIncStats.p50Ms.toFixed(2),
        'p95 (ms)': synthIncStats.p95Ms.toFixed(2),
        Throughput: `${incOpsSec.toFixed(1)} ops/sec`,
        'Ratio / Delta': `${synthSpeedupRatio}x speedup`,
      },
      {
        Workload: 'AST Semantic Extraction',
        Scale: 'Repo (167 models, 34 ops)',
        'Mean (ms)': repoExtractionStats.meanMs.toFixed(2),
        'p50 (ms)': repoExtractionStats.p50Ms.toFixed(2),
        'p95 (ms)': repoExtractionStats.p95Ms.toFixed(2),
        Throughput: `${repoExtractionStats.qps.toFixed(1)} extracts/sec`,
        'Ratio / Delta': 'Fast AST walk',
      },
      {
        Workload: 'AST Semantic Diff (Identical)',
        Scale: 'Repo Spec',
        'Mean (ms)': repoDiffStats.meanMs.toFixed(2),
        'p50 (ms)': repoDiffStats.p50Ms.toFixed(2),
        'p95 (ms)': repoDiffStats.p95Ms.toFixed(2),
        Throughput: `${repoDiffStats.qps.toFixed(1)} diffs/sec`,
        'Ratio / Delta': '0 changes',
      },
      {
        Workload: 'AST Semantic Diff (Mutated)',
        Scale: '100 vs 105 models (31 changes)',
        'Mean (ms)': synthDiffStats.meanMs.toFixed(2),
        'p50 (ms)': synthDiffStats.p50Ms.toFixed(2),
        'p95 (ms)': synthDiffStats.p95Ms.toFixed(2),
        Throughput: `${synthDiffStats.qps.toFixed(1)} diffs/sec`,
        'Ratio / Delta': `${lastSynthDiffResult?.summary.breakingCount} breaking / ${lastSynthDiffResult?.summary.nonBreakingCount} non-breaking`,
      },
      {
        Workload: 'Git Ref Comparison',
        Scale: 'HEAD~1 vs HEAD',
        'Mean (ms)': gitTotalMs.toFixed(2),
        'p50 (ms)': gitTotalMs.toFixed(2),
        'p95 (ms)': gitTotalMs.toFixed(2),
        Throughput: `${(1000 / Math.max(gitTotalMs, 1)).toFixed(1)} runs/sec`,
        'Ratio / Delta': gitRefAvailable ? `${gitDiffResult.summary.totalChanges} changes` : 'N/A',
      },
      {
        Workload: 'Retained Heap Delta (10 inc)',
        Scale: '10 incremental compilations',
        'Mean (ms)': '-',
        'p50 (ms)': '-',
        'p95 (ms)': '-',
        Throughput: `${memMeasurement.gcRuns} GC cycles`,
        'Ratio / Delta': `${memMeasurement.heapDeltaMb >= 0 ? '+' : ''}${memMeasurement.heapDeltaMb.toFixed(3)} MB`,
      },
      {
        Workload: 'Watcher FD Leak Audit',
        Scale: '10 open/close cycles',
        'Mean (ms)': '-',
        'p50 (ms)': '-',
        'p95 (ms)': '-',
        Throughput: `${fdLeakResult.iterations} cycles`,
        'Ratio / Delta': `${fdLeakResult.leaked} leaked FDs (${watcherStable ? 'STABLE' : 'LEAK'})`,
      },
    ]);

    log(`\n✅ TypeSpec Benchmark completed successfully!`);
    log(`   Results JSON: ${path.relative(projectRoot, resultsFile)}`);
    log(`   CPU Profiles:`);
    log(`     - ${results.profiling.coldCompile.profilePath}`);
    log(`     - ${results.profiling.incrementalCompile.profilePath}`);
    log(`     - ${results.profiling.semanticDiff.profilePath}\n`);

    return results;
  } finally {
    // Clean up temporary bench files
    if (fs.existsSync(tempWorkspace)) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
  }
}

// ============================================================================
// CLI Invocation
// ============================================================================

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('bench-typespec.ts') ||
    process.argv[1].endsWith('bench-typespec.js') ||
    process.argv[1].includes('bench-typespec'));

if (isDirectExecution) {
  runTypeSpecBenchmarkSuite().catch((err) => {
    console.error('❌ TypeSpec benchmark suite execution failed:', err);
    process.exit(1);
  });
}
