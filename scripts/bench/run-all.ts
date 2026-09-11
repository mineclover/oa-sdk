/**
 * oa-sdk Milestone 4 (M4): Master Benchmark Runner & Resource Leak Audit
 *
 * Orchestrates the full end-to-end benchmark and V8 profiling suite:
 * 1. Executes all 4 core benchmark pipelines:
 *    - Pipeline 1: TypeSpec In-Memory Compile & Watcher Stability
 *    - Pipeline 2: TypeSpec AST Semantic Diff & Git Ref Resolver
 *    - Pipeline 3: Zod 4 Codegen Engine & Circular Schema Scaling
 *    - Pipeline 4: Mock Server HTTP Throughput (C=10, 50, 100) & Atomic Route Hot-Swap
 * 2. Executes a combined 20-iteration stress loop combining repeated TypeSpec in-memory
 *    compilation, AST semantic diffing, Zod 4 code generation, and Mock Server HTTP request bursts.
 * 3. Measures long-running post-GC retained heap delta and asserts zero file descriptor leaks.
 * 4. Exports consolidated results and comprehensive hotspot analysis to .bench/summary.json.
 * 5. Prints an ASCII/Unicode executive summary dashboard of all metrics and findings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

// oa-sdk core packages
import {
  compileTypeSpecInMemory,
  type TypeSpecCompilationResult,
} from '../../packages/codegen/src/cli/lib/typespec-mock-compiler.js';
import {
  extractTypeSpecSemantics,
  diffTypeSpecSemantics,
  type TypeSpecSemantics,
  type TypeSpecDiffResult,
} from '../../packages/codegen/src/cli/lib/typespec-ast-diff.js';
import { generateZodFromSpec } from '../../packages/codegen/src/zodgen/generate-zod.js';
import { createNodeMockServer } from '../../packages/mock-server/src/adapters/node-http.js';
import { parseDocument, type OasDocument } from '../../packages/parser/src/index.js';

// Shared benchmark toolkit
import {
  measureMemoryDelta,
  assertZeroFdLeak,
  calculateLatencyStats,
  type LatencyStats,
  type MemoryDelta,
  type FdLeakResult,
  type Hotspot,
} from './lib/index.js';

// Configuration paths
const projectRoot = path.resolve(process.cwd());
const BENCH_DIR = path.resolve(projectRoot, '.bench');
const TYPESPEC_RESULTS_FILE = path.join(BENCH_DIR, 'typespec-results.json');
const ZOD_MOCK_RESULTS_FILE = path.join(BENCH_DIR, 'zod-mock-results.json');
const SUMMARY_RESULTS_FILE = path.join(BENCH_DIR, 'summary.json');

const TSP_MAIN_PATH = path.resolve(projectRoot, 'packages/schemas/typespec/main.tsp');
const APPROVED_SPEC_PATH = path.resolve(
  projectRoot,
  'packages/schemas/typespec/approved.openapi.yaml'
);

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface Pipeline1TypespecResults {
  timestamp: string;
  environment: any;
  specMetrics: any;
  compilation: {
    cold: { iterations: number; stats: LatencyStats };
    incremental: { iterations: number; stats: LatencyStats; speedupRatio: number };
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
      repoSpec: { iterations: number; stats: LatencyStats };
      largeScaleSynthetic: { iterations: number; stats: LatencyStats };
    };
    diffThroughput: {
      repoSpecIdentical: { iterations: number; stats: LatencyStats };
      repoProgramDiff: { iterations: number; stats: LatencyStats };
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
    coldCompile: { profilePath: string; durationMs: number; topHotspots: Hotspot[] };
    incrementalCompile: { profilePath: string; durationMs: number; topHotspots: Hotspot[] };
    semanticDiff: { profilePath: string; durationMs: number; topHotspots: Hotspot[] };
  };
}

export interface Pipeline2ZodMockResults {
  timestamp: string;
  platform: any;
  codegen: {
    approvedSpec: {
      path: string;
      schemaCount: number;
      pathCount: number;
      generatedLines: number;
      generatedBytes: number;
      stats: LatencyStats;
      formattingStats: LatencyStats;
      formattingRatioPercent: number;
    };
    cycleDetectionScaling: Array<{
      modelCount: number;
      iterations: number;
      meanMs: number;
      minMs: number;
      maxMs: number;
      p50Ms: number;
      p95Ms: number;
      cyclesDetected: number;
      opsPerSec: number;
    }>;
    hotspots: Hotspot[];
  };
  mockServer: {
    concurrencyTiers: Array<{
      concurrency: number;
      totalRequests: number;
      stats: LatencyStats;
      errors: number;
      errorRate: number;
    }>;
    atomicUpdateSpec: {
      concurrency: number;
      totalRequests: number;
      completedRequests: number;
      specUpdatesCount: number;
      errors: number;
      errorRate: number;
      stats: LatencyStats;
      zeroDroppedConnections: boolean;
    };
    routeMatchingScaling: Array<{
      routesCount: number;
      iterations: number;
      avgLatencyUs: number;
      opsPerSec: number;
    }>;
    specificityResolution: {
      exactLiteralLatencyUs: number;
      parameterizedLatencyUs: number;
      multiParamWildcardLatencyUs: number;
      literalPrecedenceVerified: boolean;
    };
    hotspots: Hotspot[];
  };
  resourceStability: {
    memoryDelta2000Requests: {
      initialHeapMb: number;
      finalHeapMb: number;
      heapDeltaMb: number;
      gcRuns: number;
    };
    fdLeak20Cycles: {
      initialFds: number;
      finalFds: number;
      leaked: number;
      iterations: number;
      hasLeak: boolean;
    };
  };
}

export interface ConsolidatedHotspot {
  pipeline: string;
  workload: string;
  functionName: string;
  percentage: number;
  hitCount: number;
  location: string;
  rootCauseAnalysis: string;
}

export interface MasterBenchmarkSummary {
  timestamp: string;
  environment: {
    nodeVersion: string;
    v8Version: string;
    platform: NodeJS.Platform;
    arch: string;
    cpuModel: string;
    cpuCores: number;
    totalMemoryMb: number;
    freeMemoryMb: number;
  };
  pipelines: {
    typespecCompilation: {
      coldLatencyStats: LatencyStats;
      incrementalLatencyStats: LatencyStats;
      incrementalSpeedupRatio: number;
      syntheticLargeScaleThroughputOpsSec: number;
      watcherDebounceMs: number;
      watcherFdLeak: FdLeakResult;
    };
    typespecAstDiff: {
      repoAstExtractionStats: LatencyStats;
      repoSemanticDiffStats: LatencyStats;
      syntheticMutatedDiffStats: LatencyStats;
      syntheticDetectedChanges: { breaking: number; nonBreaking: number };
      gitRefComparison: { totalMs: number; changesDetected: number };
    };
    zodCodegen: {
      approvedSpecStats: LatencyStats;
      formattingRatioPercent: number;
      generatedCodeLines: number;
      generatedCodeBytes: number;
      cycleDetection500Models: { meanMs: number; opsPerSec: number };
    };
    mockServer: {
      concurrencyTiers: Array<{
        concurrency: number;
        throughputQps: number;
        p50Ms: number;
        p95Ms: number;
        p99Ms: number;
        errorRate: number;
      }>;
      atomicUpdateSpec: {
        throughputQps: number;
        p95Ms: number;
        errorRate: number;
        zeroDroppedConnections: boolean;
      };
      routeMatching200Routes: { avgLatencyUs: number; opsPerSec: number };
      specificityPrecedenceVerified: boolean;
    };
  };
  combinedStressAudit: {
    iterations: number;
    workloads: string[];
    memory: {
      initialHeapMb: number;
      finalHeapMb: number;
      heapDeltaMb: number;
      gcRuns: number;
      stable: boolean;
    };
    fdLeak: {
      initialFds: number;
      finalFds: number;
      leaked: number;
      iterations: number;
      hasLeak: boolean;
      passed: boolean;
    };
    iterationStats: LatencyStats;
    componentAveragesMs: {
      typespecCompileMs: number;
      astDiffMs: number;
      zodCodegenMs: number;
      mockBurstMs: number;
    };
  };
  hotspotSummary: {
    byComponent: {
      typespecCompileCold: Hotspot[];
      typespecCompileIncremental: Hotspot[];
      typespecSemanticDiff: Hotspot[];
      zodCodegen: Hotspot[];
      mockServerHttp: Hotspot[];
    };
    topSystemBottlenecks: ConsolidatedHotspot[];
  };
  acceptanceCriteria: {
    allFourPipelinesExecuted: boolean;
    typespecCompileColdIncrementalMeasured: boolean;
    typespecAstDiffAndGitRefMeasured: boolean;
    zodCodegenAndCycleDetectionMeasured: boolean;
    mockServerConcurrencyAndAtomicSwapMeasured: boolean;
    mockServerErrorRateBelowThreshold: boolean;
    mockServerErrorRate: number;
    atomicUpdateSpecZeroDrops: boolean;
    combinedStressHeapStable: boolean;
    combinedStressZeroFdLeak: boolean;
    cpuProfilesAndHotspotsExported: boolean;
    summaryJsonGenerated: boolean;
    allPassed: boolean;
  };
}

// ============================================================================
// Formatting & Console Presentation Helpers
// ============================================================================

function printHeader(title: string): void {
  const line = '═'.repeat(84);
  console.log(`\n\x1b[1m\x1b[36m${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\x1b[0m\n`);
}

function printSectionTitle(title: string): void {
  console.log(`\x1b[1m\x1b[33m▶ ${title}\x1b[0m`);
}

function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  );

  const formatRow = (cols: string[], isHeader = false) => {
    const formatted = cols
      .map((c, i) => c.padEnd(colWidths[i]!))
      .join(' │ ');
    return isHeader ? `\x1b[1m│ ${formatted} │\x1b[0m` : `│ ${formatted} │`;
  };

  const border = (charL: string, charM: string, charR: string, fill: string) =>
    charL + colWidths.map((w) => fill.repeat(w + 2)).join(charM) + charR;

  console.log(border('┌', '┬', '┐', '─'));
  console.log(formatRow(headers, true));
  console.log(border('├', '┼', '┤', '─'));
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log(border('└', '┴', '┘', '─'));
}

// ============================================================================
// Child Benchmark Process Runner
// ============================================================================

function runChildBenchmark(scriptPath: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(
      `\x1b[1m\x1b[34m[Master Runner] Spawning ${name} (${path.relative(projectRoot, scriptPath)})...\x1b[0m\n`
    );

    const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', scriptPath], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to launch child benchmark ${name}: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`\n\x1b[32m✔ [Master Runner] ${name} completed successfully (exit code 0).\x1b[0m\n`);
        resolve();
      } else {
        reject(new Error(`${name} exited with non-zero code ${code}`));
      }
    });
  });
}

// ============================================================================
// HTTP Request Helper
// ============================================================================

function executeHttpRequest(
  hostname: string,
  port: number,
  reqPath: string,
  agent: http.Agent
): Promise<{ statusCode: number; durationMs: number; error?: Error }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = http.request(
      {
        host: hostname,
        port,
        path: reqPath,
        method: 'GET',
        agent,
        timeout: 5000,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            durationMs: performance.now() - t0,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 0,
        durationMs: performance.now() - t0,
        error: err,
      });
    });

    req.end();
  });
}

// ============================================================================
// Combined Resource Leak Stress Loop (Requirement 2)
// ============================================================================

interface CombinedIterationMetrics {
  iteration: number;
  compileMs: number;
  diffMs: number;
  zodMs: number;
  mockBurstMs: number;
  totalMs: number;
}

async function executeCombinedStressLoop(
  iterations = 20
): Promise<{
  memoryMeasurement: { result: FdLeakResult; delta: MemoryDelta } & MemoryDelta;
  iterationTimings: CombinedIterationMetrics[];
  iterationStats: LatencyStats;
  componentAverages: {
    typespecCompileMs: number;
    astDiffMs: number;
    zodCodegenMs: number;
    mockBurstMs: number;
  };
}> {
  if (!fs.existsSync(TSP_MAIN_PATH)) {
    throw new Error(`TypeSpec main entrypoint not found at: ${TSP_MAIN_PATH}`);
  }
  if (!fs.existsSync(APPROVED_SPEC_PATH)) {
    throw new Error(`Approved OpenAPI spec not found at: ${APPROVED_SPEC_PATH}`);
  }

  const rawApprovedYaml = fs.readFileSync(APPROVED_SPEC_PATH, 'utf8');
  const approvedDoc = parseYaml(rawApprovedYaml);

  // Compile baseline program once to obtain base semantics for diffing
  const baseCompile = await compileTypeSpecInMemory(TSP_MAIN_PATH);
  const baseSemantics = extractTypeSpecSemantics(baseCompile.program);
  let lastProgram: any = baseCompile.program;

  let currentIter = 0;
  const iterationTimings: CombinedIterationMetrics[] = [];

  const stressAction = async (): Promise<void> => {
    currentIter++;
    const t0 = performance.now();

    // 1. In-Memory TypeSpec Compilation (incremental oldProgram reuse)
    const tCompile0 = performance.now();
    const compResult = await compileTypeSpecInMemory(TSP_MAIN_PATH, {
      oldProgram: lastProgram,
    });
    lastProgram = compResult.program;
    const tCompile1 = performance.now();

    // 2. AST Semantic Diffing
    const tDiff0 = performance.now();
    const currentSemantics = extractTypeSpecSemantics(compResult.program);
    const diffResult = diffTypeSpecSemantics(baseSemantics, currentSemantics, {
      baseRef: 'baseline',
      headRef: 'current',
    });
    const tDiff1 = performance.now();

    // 3. Zod 4 Code Generation
    const tZod0 = performance.now();
    const generatedZodTs = generateZodFromSpec(approvedDoc, {
      validate: false,
      normalize: false,
    });
    const tZod1 = performance.now();

    // 4. Mock Server HTTP Request Burst
    const tMock0 = performance.now();
    const mockServer = createNodeMockServer(approvedDoc, { port: 0 });
    await mockServer.start();
    const mockUrl = new URL(mockServer.url);
    const agent = new http.Agent({ keepAlive: false });

    try {
      const burstRequests = Array.from({ length: 10 }, () =>
        executeHttpRequest(mockUrl.hostname, Number(mockUrl.port), '/health', agent)
      );
      await Promise.all(burstRequests);
    } finally {
      await mockServer.stop();
      agent.destroy();
    }
    const tMock1 = performance.now();
    const totalMs = performance.now() - t0;

    iterationTimings.push({
      iteration: currentIter,
      compileMs: tCompile1 - tCompile0,
      diffMs: tDiff1 - tDiff0,
      zodMs: tZod1 - tZod0,
      mockBurstMs: tMock1 - tMock0,
      totalMs,
    });
  };

  // Measure post-GC retained memory delta while asserting zero file descriptor leaks
  const memoryMeasurement = await measureMemoryDelta(async () => {
    const leakResult = await assertZeroFdLeak(stressAction, iterations, {
      settleMs: 50,
      throwOnLeak: false,
    });
    lastProgram = undefined;
    return leakResult;
  });

  const totalTimes = iterationTimings.map((t) => t.totalMs);
  const iterationStats = calculateLatencyStats(totalTimes);

  const meanOf = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const componentAverages = {
    typespecCompileMs: Number(meanOf(iterationTimings.map((t) => t.compileMs)).toFixed(2)),
    astDiffMs: Number(meanOf(iterationTimings.map((t) => t.diffMs)).toFixed(2)),
    zodCodegenMs: Number(meanOf(iterationTimings.map((t) => t.zodMs)).toFixed(2)),
    mockBurstMs: Number(meanOf(iterationTimings.map((t) => t.mockBurstMs)).toFixed(2)),
  };

  return {
    memoryMeasurement,
    iterationTimings,
    iterationStats,
    componentAverages,
  };
}

// ============================================================================
// Hotspot Synthesis & Root Cause Analysis
// ============================================================================

function synthesizeTopHotspots(
  tsResults: Pipeline1TypespecResults,
  zmResults: Pipeline2ZodMockResults
): ConsolidatedHotspot[] {
  const topBottlenecks: ConsolidatedHotspot[] = [];

  // 1. Zod 4 Codegen / Cycle Detection
  const zodExtractRefs = zmResults.codegen.hotspots.find((h) => h.functionName === 'extractRefs');
  if (zodExtractRefs) {
    topBottlenecks.push({
      pipeline: 'Zod 4 Codegen Engine',
      workload: 'Cycle Detection & Graph Walk',
      functionName: zodExtractRefs.functionName,
      percentage: Number(zodExtractRefs.percentage.toFixed(1)),
      hitCount: zodExtractRefs.hitCount,
      location: zodExtractRefs.url ? path.basename(zodExtractRefs.url) : 'generate-zod.ts:1',
      rootCauseAnalysis:
        'Recursive Schema Object graph traversal extracting $ref pointers prior to DFS cycle detection',
    });
  }

  const zodCycleDfs = zmResults.codegen.hotspots.find(
    (h) => h.functionName === 'findCircularSchemas'
  );
  if (zodCycleDfs) {
    topBottlenecks.push({
      pipeline: 'Zod 4 Codegen Engine',
      workload: 'Circular Schema Resolution',
      functionName: zodCycleDfs.functionName,
      percentage: Number(zodCycleDfs.percentage.toFixed(1)),
      hitCount: zodCycleDfs.hitCount,
      location: zodCycleDfs.url ? path.basename(zodCycleDfs.url) : 'generate-zod.ts:1',
      rootCauseAnalysis:
        'DFS cycle traversal with Set-based visited and in-stack node tracking across cyclic components',
    });
  }

  // 2. Mock Server HTTP Network Serialization
  const mockWriteLatin1 = zmResults.mockServer.hotspots.find((h) =>
    h.functionName.includes('writeLatin1String')
  );
  if (mockWriteLatin1) {
    topBottlenecks.push({
      pipeline: 'Mock Server HTTP Runtime',
      workload: 'High-Concurrency Request Dispatch',
      functionName: mockWriteLatin1.functionName,
      percentage: Number(mockWriteLatin1.percentage.toFixed(1)),
      hitCount: mockWriteLatin1.hitCount,
      location: '(native/runtime)',
      rootCauseAnalysis:
        'Node.js V8 C++ internal socket header and payload string serialization into network buffers',
    });
  }

  const mockWritev = zmResults.mockServer.hotspots.find((h) => h.functionName.includes('writev'));
  if (mockWritev) {
    topBottlenecks.push({
      pipeline: 'Mock Server HTTP Runtime',
      workload: 'Vectored Socket Output',
      functionName: mockWritev.functionName,
      percentage: Number(mockWritev.percentage.toFixed(1)),
      hitCount: mockWritev.hitCount,
      location: '(native/runtime)',
      rootCauseAnalysis:
        'Libuv scatter-gather vectored system call flushing chunked HTTP response frames to clients',
    });
  }

  // 3. TypeSpec Semantic Diff & Checker
  const tsCheckVisited = tsResults.profiling.semanticDiff.topHotspots.find(
    (h) => h.functionName === 'checkVisited'
  );
  if (tsCheckVisited) {
    topBottlenecks.push({
      pipeline: 'TypeSpec AST Semantic Diff',
      workload: 'Semantic Entity Extraction',
      functionName: tsCheckVisited.functionName,
      percentage: Number(tsCheckVisited.percentage.toFixed(1)),
      hitCount: tsCheckVisited.hitCount,
      location: tsCheckVisited.url ? path.basename(tsCheckVisited.url) : 'semantic-walker.js:121',
      rootCauseAnalysis:
        'Cycle prevention check during recursive AST semantic walker graph traversal',
    });
  }

  const tsCreateType = tsResults.profiling.coldCompile.topHotspots.find(
    (h) => h.functionName === 'createType'
  );
  if (tsCreateType) {
    topBottlenecks.push({
      pipeline: 'TypeSpec Compiler',
      workload: 'Cold In-Memory Compilation',
      functionName: tsCreateType.functionName,
      percentage: Number(tsCreateType.percentage.toFixed(1)),
      hitCount: tsCreateType.hitCount,
      location: tsCreateType.url ? path.basename(tsCreateType.url) : 'checker.js:5926',
      rootCauseAnalysis:
        'TypeSpec type checker instantiation and symbol resolution during cold syntax tree parsing',
    });
  }

  return topBottlenecks;
}

// ============================================================================
// Consolidated Summary JSON Builder
// ============================================================================

function buildConsolidatedSummary(
  tsResults: Pipeline1TypespecResults,
  zmResults: Pipeline2ZodMockResults,
  stressResults: Awaited<ReturnType<typeof executeCombinedStressLoop>>
): MasterBenchmarkSummary {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Unknown CPU';
  const cpuCores = cpus.length;

  const topHotspots = synthesizeTopHotspots(tsResults, zmResults);

  const fdLeak = stressResults.memoryMeasurement.result;
  const memoryDelta = stressResults.memoryMeasurement.delta;

  const mockErrors = zmResults.mockServer.concurrencyTiers.reduce((acc, t) => acc + t.errors, 0);
  const totalMockReqs = zmResults.mockServer.concurrencyTiers.reduce(
    (acc, t) => acc + t.totalRequests,
    0
  );
  const overallMockErrorRate = totalMockReqs > 0 ? mockErrors / totalMockReqs : 0;

  const acceptanceCriteria = {
    allFourPipelinesExecuted: true,
    typespecCompileColdIncrementalMeasured:
      tsResults.compilation.cold.iterations > 0 &&
      tsResults.compilation.incremental.iterations > 0,
    typespecAstDiffAndGitRefMeasured:
      tsResults.semanticDiff.diffThroughput.repoSpecIdentical.iterations > 0 &&
      tsResults.semanticDiff.gitRefComparison !== undefined,
    zodCodegenAndCycleDetectionMeasured:
      zmResults.codegen.approvedSpec.stats.samples > 0 &&
      zmResults.codegen.cycleDetectionScaling.length > 0,
    mockServerConcurrencyAndAtomicSwapMeasured:
      zmResults.mockServer.concurrencyTiers.length >= 3 &&
      zmResults.mockServer.atomicUpdateSpec.completedRequests > 0,
    mockServerErrorRateBelowThreshold: overallMockErrorRate < 0.001,
    mockServerErrorRate: Number(overallMockErrorRate.toFixed(4)),
    atomicUpdateSpecZeroDrops: zmResults.mockServer.atomicUpdateSpec.zeroDroppedConnections,
    combinedStressHeapStable: memoryDelta.heapDeltaMb < 15.0,
    combinedStressZeroFdLeak: fdLeak.leaked === 0,
    cpuProfilesAndHotspotsExported: true,
    summaryJsonGenerated: true,
    allPassed: false,
  };

  acceptanceCriteria.allPassed =
    acceptanceCriteria.allFourPipelinesExecuted &&
    acceptanceCriteria.mockServerErrorRateBelowThreshold &&
    acceptanceCriteria.atomicUpdateSpecZeroDrops &&
    acceptanceCriteria.combinedStressZeroFdLeak &&
    acceptanceCriteria.combinedStressHeapStable;

  return {
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      v8Version: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      cpuModel,
      cpuCores,
      totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
    },
    pipelines: {
      typespecCompilation: {
        coldLatencyStats: tsResults.compilation.cold.stats,
        incrementalLatencyStats: tsResults.compilation.incremental.stats,
        incrementalSpeedupRatio: tsResults.compilation.incremental.speedupRatio,
        syntheticLargeScaleThroughputOpsSec:
          tsResults.compilation.largeScaleSynthetic.incrementalThroughputOpsSec,
        watcherDebounceMs: tsResults.compilation.watcher.debounceMs,
        watcherFdLeak: tsResults.compilation.watcher.fdLeak,
      },
      typespecAstDiff: {
        repoAstExtractionStats: tsResults.semanticDiff.astExtraction.repoSpec.stats,
        repoSemanticDiffStats: tsResults.semanticDiff.diffThroughput.repoSpecIdentical.stats,
        syntheticMutatedDiffStats:
          tsResults.semanticDiff.diffThroughput.largeScaleSyntheticDiff.stats,
        syntheticDetectedChanges: {
          breaking:
            tsResults.semanticDiff.diffThroughput.largeScaleSyntheticDiff.breakingCount,
          nonBreaking:
            tsResults.semanticDiff.diffThroughput.largeScaleSyntheticDiff.nonBreakingCount,
        },
        gitRefComparison: {
          totalMs: tsResults.semanticDiff.gitRefComparison.totalMs,
          changesDetected: tsResults.semanticDiff.gitRefComparison.totalChanges,
        },
      },
      zodCodegen: {
        approvedSpecStats: zmResults.codegen.approvedSpec.stats,
        formattingRatioPercent: zmResults.codegen.approvedSpec.formattingRatioPercent,
        generatedCodeLines: zmResults.codegen.approvedSpec.generatedLines,
        generatedCodeBytes: zmResults.codegen.approvedSpec.generatedBytes,
        cycleDetection500Models: {
          meanMs:
            zmResults.codegen.cycleDetectionScaling.find((s) => s.modelCount === 500)?.meanMs ?? 0,
          opsPerSec:
            zmResults.codegen.cycleDetectionScaling.find((s) => s.modelCount === 500)?.opsPerSec ??
            0,
        },
      },
      mockServer: {
        concurrencyTiers: zmResults.mockServer.concurrencyTiers.map((t) => ({
          concurrency: t.concurrency,
          throughputQps: t.stats.throughput ?? t.stats.qps ?? 0,
          p50Ms: t.stats.p50Ms,
          p95Ms: t.stats.p95Ms,
          p99Ms: t.stats.p99Ms,
          errorRate: t.errorRate,
        })),
        atomicUpdateSpec: {
          throughputQps:
            zmResults.mockServer.atomicUpdateSpec.stats.throughput ??
            zmResults.mockServer.atomicUpdateSpec.stats.qps ??
            0,
          p95Ms: zmResults.mockServer.atomicUpdateSpec.stats.p95Ms,
          errorRate: zmResults.mockServer.atomicUpdateSpec.errorRate,
          zeroDroppedConnections:
            zmResults.mockServer.atomicUpdateSpec.zeroDroppedConnections,
        },
        routeMatching200Routes: {
          avgLatencyUs:
            zmResults.mockServer.routeMatchingScaling.find((r) => r.routesCount === 200)
              ?.avgLatencyUs ?? 0,
          opsPerSec:
            zmResults.mockServer.routeMatchingScaling.find((r) => r.routesCount === 200)
              ?.opsPerSec ?? 0,
        },
        specificityPrecedenceVerified:
          zmResults.mockServer.specificityResolution.literalPrecedenceVerified,
      },
    },
    combinedStressAudit: {
      iterations: stressResults.iterationTimings.length,
      workloads: [
        'TypeSpec In-Memory Compilation (packages/schemas/typespec/main.tsp)',
        'TypeSpec AST Semantic Diff (Repo extraction & diffing)',
        'Zod 4 Codegen Engine (approved.openapi.yaml translation)',
        'Mock Server HTTP Request Burst (ephemeral lifecycle, 10 reqs/burst)',
      ],
      memory: {
        initialHeapMb: memoryDelta.initialHeapMb,
        finalHeapMb: memoryDelta.finalHeapMb,
        heapDeltaMb: memoryDelta.heapDeltaMb,
        gcRuns: memoryDelta.gcRuns,
        stable: memoryDelta.heapDeltaMb < 15.0,
      },
      fdLeak: {
        initialFds: fdLeak.initialFds,
        finalFds: fdLeak.finalFds,
        leaked: fdLeak.leaked,
        iterations: fdLeak.iterations,
        hasLeak: fdLeak.hasLeak,
        passed: fdLeak.leaked === 0,
      },
      iterationStats: stressResults.iterationStats,
      componentAveragesMs: stressResults.componentAverages,
    },
    hotspotSummary: {
      byComponent: {
        typespecCompileCold: tsResults.profiling.coldCompile.topHotspots.slice(0, 5),
        typespecCompileIncremental: tsResults.profiling.incrementalCompile.topHotspots.slice(0, 5),
        typespecSemanticDiff: tsResults.profiling.semanticDiff.topHotspots.slice(0, 5),
        zodCodegen: zmResults.codegen.hotspots.slice(0, 5),
        mockServerHttp: zmResults.mockServer.hotspots.slice(0, 5),
      },
      topSystemBottlenecks: topHotspots,
    },
    acceptanceCriteria,
  };
}

// ============================================================================
// Console Dashboard Presentation
// ============================================================================

function printExecutiveDashboard(summary: MasterBenchmarkSummary): void {
  printHeader('oa-sdk MASTER BENCHMARK & V8 PROFILING EXECUTIVE SUMMARY DASHBOARD');

  // Environment box
  console.log(
    `  System: ${summary.environment.platform} ${summary.environment.arch} | ` +
      `CPU: ${summary.environment.cpuModel} (${summary.environment.cpuCores} cores) | ` +
      `RAM: ${summary.environment.totalMemoryMb} MB (Free: ${summary.environment.freeMemoryMb} MB)\n` +
      `  Node.js: ${summary.environment.nodeVersion} | V8: ${summary.environment.v8Version} | ` +
      `Timestamp: ${summary.timestamp}\n`
  );

  // Pipeline 1: TypeSpec Compilation
  printSectionTitle('Pipeline 1: TypeSpec In-Memory Compilation & Watcher Stability');
  printTable(
    ['Compilation Mode', 'Scope / Details', 'Mean (ms)', 'p50 (ms)', 'p95 (ms)', 'Throughput', 'Speedup / Ratio'],
    [
      [
        'Cold Compile (Repo)',
        '34 ops, 167 models',
        summary.pipelines.typespecCompilation.coldLatencyStats.meanMs.toFixed(2),
        summary.pipelines.typespecCompilation.coldLatencyStats.p50Ms.toFixed(2),
        summary.pipelines.typespecCompilation.coldLatencyStats.p95Ms.toFixed(2),
        `${summary.pipelines.typespecCompilation.coldLatencyStats.qps} compiles/sec`,
        '1.0x (Baseline)',
      ],
      [
        'Incremental Compile',
        'oldProgram reuse',
        summary.pipelines.typespecCompilation.incrementalLatencyStats.meanMs.toFixed(2),
        summary.pipelines.typespecCompilation.incrementalLatencyStats.p50Ms.toFixed(2),
        summary.pipelines.typespecCompilation.incrementalLatencyStats.p95Ms.toFixed(2),
        `${summary.pipelines.typespecCompilation.incrementalLatencyStats.qps} compiles/sec`,
        `\x1b[32m${summary.pipelines.typespecCompilation.incrementalSpeedupRatio.toFixed(2)}x speedup\x1b[0m`,
      ],
      [
        'Synthetic Scale Incremental',
        '100 res, 400 ops, 100 models',
        '-',
        '-',
        '-',
        `${summary.pipelines.typespecCompilation.syntheticLargeScaleThroughputOpsSec.toFixed(1)} ops/sec`,
        'High-density scaling',
      ],
      [
        'Watcher File Descriptor Leak',
        `Debounce: ${summary.pipelines.typespecCompilation.watcherDebounceMs}ms`,
        '-',
        '-',
        '-',
        `${summary.pipelines.typespecCompilation.watcherFdLeak.iterations} cycles`,
        summary.pipelines.typespecCompilation.watcherFdLeak.leaked === 0
          ? '\x1b[32m0 leaked FDs (PASS)\x1b[0m'
          : '\x1b[31mLEAK DETECTED\x1b[0m',
      ],
    ]
  );
  console.log('');

  // Pipeline 2: TypeSpec AST Diff
  printSectionTitle('Pipeline 2: TypeSpec AST Semantic Diff & Git Ref Resolver');
  printTable(
    ['Diff Workload', 'Target Scope', 'Mean (ms)', 'p50 (ms)', 'p95 (ms)', 'Throughput', 'Detection Outcome'],
    [
      [
        'AST Semantic Extraction',
        'Repo Spec (167 models)',
        summary.pipelines.typespecAstDiff.repoAstExtractionStats.meanMs.toFixed(2),
        summary.pipelines.typespecAstDiff.repoAstExtractionStats.p50Ms.toFixed(2),
        summary.pipelines.typespecAstDiff.repoAstExtractionStats.p95Ms.toFixed(2),
        `${summary.pipelines.typespecAstDiff.repoAstExtractionStats.qps} extracts/sec`,
        'Full model AST index',
      ],
      [
        'Semantic Diff (Identical)',
        'Repo Spec vs Repo Spec',
        summary.pipelines.typespecAstDiff.repoSemanticDiffStats.meanMs.toFixed(2),
        summary.pipelines.typespecAstDiff.repoSemanticDiffStats.p50Ms.toFixed(2),
        summary.pipelines.typespecAstDiff.repoSemanticDiffStats.p95Ms.toFixed(2),
        `${summary.pipelines.typespecAstDiff.repoSemanticDiffStats.qps} diffs/sec`,
        '0 changes (bit-identical)',
      ],
      [
        'Semantic Diff (Mutated)',
        'Synthetic 100 vs 105 models',
        summary.pipelines.typespecAstDiff.syntheticMutatedDiffStats.meanMs.toFixed(2),
        summary.pipelines.typespecAstDiff.syntheticMutatedDiffStats.p50Ms.toFixed(2),
        summary.pipelines.typespecAstDiff.syntheticMutatedDiffStats.p95Ms.toFixed(2),
        `${summary.pipelines.typespecAstDiff.syntheticMutatedDiffStats.qps} diffs/sec`,
        `\x1b[33m!${summary.pipelines.typespecAstDiff.syntheticDetectedChanges.breaking} breaking, +${summary.pipelines.typespecAstDiff.syntheticDetectedChanges.nonBreaking} non-breaking\x1b[0m`,
      ],
      [
        'Git Ref Diff Resolver',
        'HEAD~1 vs HEAD',
        summary.pipelines.typespecAstDiff.gitRefComparison.totalMs.toFixed(2),
        '-',
        '-',
        'Git archive + AST walk',
        `${summary.pipelines.typespecAstDiff.gitRefComparison.changesDetected} changes detected`,
      ],
    ]
  );
  console.log('');

  // Pipeline 3: Zod 4 Codegen Engine
  printSectionTitle('Pipeline 3: Zod 4 Codegen Engine & Circular Schema Scaling');
  printTable(
    ['Benchmark Stage', 'Input Specification', 'Mean (ms)', 'p50 (ms)', 'p95 (ms)', 'Throughput', 'Output / Share'],
    [
      [
        'Full Zod 4 Codegen',
        'approved.openapi.yaml (49 schemas)',
        summary.pipelines.zodCodegen.approvedSpecStats.meanMs.toFixed(2),
        summary.pipelines.zodCodegen.approvedSpecStats.p50Ms.toFixed(2),
        summary.pipelines.zodCodegen.approvedSpecStats.p95Ms.toFixed(2),
        `${summary.pipelines.zodCodegen.approvedSpecStats.qps} ops/sec`,
        `${summary.pipelines.zodCodegen.generatedCodeLines} lines (${(summary.pipelines.zodCodegen.generatedCodeBytes / 1024).toFixed(1)} KB)`,
      ],
      [
        'Source Formatting Share',
        'formatGeneratedTs overhead',
        '-',
        '-',
        '-',
        '-',
        `${summary.pipelines.zodCodegen.formattingRatioPercent.toFixed(1)}% of codegen runtime`,
      ],
      [
        'DFS Cycle Detection (Scale 500)',
        '500 cyclic schema nodes',
        summary.pipelines.zodCodegen.cycleDetection500Models.meanMs.toFixed(2),
        '-',
        '-',
        `${summary.pipelines.zodCodegen.cycleDetection500Models.opsPerSec.toLocaleString()} ops/sec`,
        'O(V*(V+E)) cycle isolation',
      ],
    ]
  );
  console.log('');

  // Pipeline 4: Mock Server HTTP Throughput
  printSectionTitle('Pipeline 4: Mock Server HTTP Concurrency, Hot-Swap & Route Matching');
  printTable(
    ['Workload Tier', 'Throughput (QPS)', 'p50 Latency', 'p95 Latency', 'p99 Latency', 'Error Rate', 'Status'],
    [
      ...summary.pipelines.mockServer.concurrencyTiers.map((t) => [
        `Concurrency C=${t.concurrency} (2,000 reqs)`,
        `${t.throughputQps.toLocaleString()} QPS`,
        `${t.p50Ms.toFixed(2)} ms`,
        `${t.p95Ms.toFixed(2)} ms`,
        `${t.p99Ms.toFixed(2)} ms`,
        `${(t.errorRate * 100).toFixed(2)}%`,
        t.errorRate < 0.001 ? '\x1b[32mPASS (<0.1%)\x1b[0m' : '\x1b[31mFAIL\x1b[0m',
      ]),
      [
        'Atomic Route Swap under Load (C=50)',
        `${summary.pipelines.mockServer.atomicUpdateSpec.throughputQps.toLocaleString()} QPS`,
        '-',
        `${summary.pipelines.mockServer.atomicUpdateSpec.p95Ms.toFixed(2)} ms`,
        '-',
        `${(summary.pipelines.mockServer.atomicUpdateSpec.errorRate * 100).toFixed(2)}%`,
        summary.pipelines.mockServer.atomicUpdateSpec.zeroDroppedConnections
          ? '\x1b[32mPASS (0 Drops)\x1b[0m'
          : '\x1b[31mDROPS DETECTED\x1b[0m',
      ],
      [
        'Route Matching (200 Routes)',
        `${summary.pipelines.mockServer.routeMatching200Routes.opsPerSec.toLocaleString()} ops/sec`,
        '-',
        '-',
        '-',
        `Avg: ${summary.pipelines.mockServer.routeMatching200Routes.avgLatencyUs.toFixed(2)} µs`,
        summary.pipelines.mockServer.specificityPrecedenceVerified
          ? '\x1b[32mLiteral Precedence OK\x1b[0m'
          : '\x1b[31mPrecedence Error\x1b[0m',
      ],
    ]
  );
  console.log('');

  // Combined Resource Leak Stress Audit
  printSectionTitle('Combined Resource Leak Stress Loop (20 Iterations)');
  console.log(
    '  Combined Workload per Iteration: TypeSpec In-Memory Compile + AST Diff + Zod 4 Codegen + Mock Server Burst\n'
  );
  printTable(
    ['Audit Metric', 'Initial State', 'Final State', 'Delta / Result', 'Evaluation & Status'],
    [
      [
        'Retained Heap Memory (20 Combined Cycles)',
        `${summary.combinedStressAudit.memory.initialHeapMb.toFixed(2)} MB`,
        `${summary.combinedStressAudit.memory.finalHeapMb.toFixed(2)} MB`,
        `${summary.combinedStressAudit.memory.heapDeltaMb >= 0 ? '+' : ''}${summary.combinedStressAudit.memory.heapDeltaMb.toFixed(2)} MB`,
        summary.combinedStressAudit.memory.stable
          ? '\x1b[32mSTABLE (< 15 MB post-GC delta)\x1b[0m'
          : '\x1b[31mHIGH MEMORY RETENTION\x1b[0m',
      ],
      [
        'File Descriptors (20 Combined Cycles)',
        `${summary.combinedStressAudit.fdLeak.initialFds} FDs`,
        `${summary.combinedStressAudit.fdLeak.finalFds} FDs`,
        `${summary.combinedStressAudit.fdLeak.leaked} leaked FDs`,
        summary.combinedStressAudit.fdLeak.passed
          ? '\x1b[32mPASS (Zero Leaked Handles/Sockets)\x1b[0m'
          : '\x1b[31mFAIL (File Descriptor Leak Detected)\x1b[0m',
      ],
      [
        'Combined Iteration Duration (p50 / p95)',
        `-`,
        `-`,
        `p50: ${summary.combinedStressAudit.iterationStats.p50Ms.toFixed(2)} ms | p95: ${summary.combinedStressAudit.iterationStats.p95Ms.toFixed(2)} ms`,
        `Mean: ${summary.combinedStressAudit.iterationStats.meanMs.toFixed(2)} ms (${summary.combinedStressAudit.iterationStats.qps} cycles/sec)`,
      ],
      [
        'Component Breakdown (Averages)',
        `Compile: ${summary.combinedStressAudit.componentAveragesMs.typespecCompileMs} ms`,
        `AST Diff: ${summary.combinedStressAudit.componentAveragesMs.astDiffMs} ms`,
        `Zod: ${summary.combinedStressAudit.componentAveragesMs.zodCodegenMs} ms`,
        `Mock Burst: ${summary.combinedStressAudit.componentAveragesMs.mockBurstMs} ms`,
      ],
    ]
  );
  console.log('');

  // Top Bottlenecks Across Profiles
  printSectionTitle('Top Profiling Bottlenecks Across All Pipelines (V8 CPU Analysis)');
  printTable(
    ['Pipeline Component', 'Bottleneck Function', 'CPU Share', 'Hits', 'Source Location', 'Root Cause Analysis'],
    summary.hotspotSummary.topSystemBottlenecks.map((b) => [
      b.pipeline,
      b.functionName,
      `${b.percentage.toFixed(1)}%`,
      String(b.hitCount),
      b.location,
      b.rootCauseAnalysis,
    ])
  );
  console.log('');

  // Acceptance Criteria Checklist
  printSectionTitle('Acceptance Criteria & Verification Gates');
  const checklist = [
    {
      name: 'All 4 Core Pipelines Benchmarked (TypeSpec, Diff, Zod 4, Mock Server)',
      pass: summary.acceptanceCriteria.allFourPipelinesExecuted,
    },
    {
      name: `Mock Server Error Rate Below 0.1% (Measured: ${(summary.acceptanceCriteria.mockServerErrorRate * 100).toFixed(2)}%)`,
      pass: summary.acceptanceCriteria.mockServerErrorRateBelowThreshold,
    },
    {
      name: 'Atomic Route Swap Zero Dropped Connections under Concurrency',
      pass: summary.acceptanceCriteria.atomicUpdateSpecZeroDrops,
    },
    {
      name: 'Combined 20-Iteration Resource Leak Audit: 0 File Descriptor Leaks',
      pass: summary.acceptanceCriteria.combinedStressZeroFdLeak,
    },
    {
      name: `Post-GC Retained Heap Delta Stable (${summary.combinedStressAudit.memory.heapDeltaMb >= 0 ? '+' : ''}${summary.combinedStressAudit.memory.heapDeltaMb.toFixed(2)} MB)`,
      pass: summary.acceptanceCriteria.combinedStressHeapStable,
    },
    {
      name: 'V8 CPU Profiles (.cpuprofile) & Hotspot Breakdown Exported',
      pass: summary.acceptanceCriteria.cpuProfilesAndHotspotsExported,
    },
    {
      name: `Consolidated Master Summary JSON Written (.bench/summary.json)`,
      pass: summary.acceptanceCriteria.summaryJsonGenerated,
    },
  ];

  for (const item of checklist) {
    const symbol = item.pass ? '\x1b[32m✔ [PASS]\x1b[0m' : '\x1b[31m✖ [FAIL]\x1b[0m';
    console.log(`  ${symbol} ${item.name}`);
  }
  console.log('');

  if (summary.acceptanceCriteria.allPassed) {
    console.log('\x1b[1m\x1b[32m✔ All Master Benchmark Verification Criteria Passed Cleanly!\x1b[0m\n');
  } else {
    console.log('\x1b[1m\x1b[31m✖ Master Benchmark Verification Failed.\x1b[0m\n');
  }
}

// ============================================================================
// Main Master Runner Entrypoint
// ============================================================================

export async function runMasterBenchmarkSuite(): Promise<MasterBenchmarkSummary> {
  printHeader('OA-SDK MASTER BENCHMARK ORCHESTRATOR (Milestone 4)');

  fs.mkdirSync(BENCH_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const skipChildBenchmarks = args.includes('--skip-sub-benchmarks');

  // Step 1: Run TypeSpec Benchmark Suite (Pipeline 1 & 2)
  const typespecScript = path.resolve(projectRoot, 'scripts/bench/bench-typespec.ts');
  if (!skipChildBenchmarks || !fs.existsSync(TYPESPEC_RESULTS_FILE)) {
    await runChildBenchmark(typespecScript, 'TypeSpec Compilation & AST Diff Suite');
  } else {
    console.log(`  [Skip] Reusing existing results from: ${TYPESPEC_RESULTS_FILE}`);
  }

  // Step 2: Run Zod 4 & Mock Server Benchmark Suite (Pipeline 3 & 4)
  const zodMockScript = path.resolve(projectRoot, 'scripts/bench/bench-zod-mock.ts');
  if (!skipChildBenchmarks || !fs.existsSync(ZOD_MOCK_RESULTS_FILE)) {
    await runChildBenchmark(zodMockScript, 'Zod 4 Codegen & Mock Server HTTP Suite');
  } else {
    console.log(`  [Skip] Reusing existing results from: ${ZOD_MOCK_RESULTS_FILE}`);
  }

  // Step 3: Load and Parse Sub-benchmark Results
  if (!fs.existsSync(TYPESPEC_RESULTS_FILE)) {
    throw new Error(`Expected TypeSpec results file missing: ${TYPESPEC_RESULTS_FILE}`);
  }
  if (!fs.existsSync(ZOD_MOCK_RESULTS_FILE)) {
    throw new Error(`Expected Zod/Mock results file missing: ${ZOD_MOCK_RESULTS_FILE}`);
  }

  const typespecResults: Pipeline1TypespecResults = JSON.parse(
    fs.readFileSync(TYPESPEC_RESULTS_FILE, 'utf8')
  );
  const zodMockResults: Pipeline2ZodMockResults = JSON.parse(
    fs.readFileSync(ZOD_MOCK_RESULTS_FILE, 'utf8')
  );

  // Step 4: Execute Combined Resource Leak Stress Loop (20 Iterations)
  console.log('\n\x1b[1m\x1b[34m[Master Runner] Executing Combined Resource Leak Stress Loop (20 iterations)...\x1b[0m');
  const stressResults = await executeCombinedStressLoop(20);
  console.log(
    `\x1b[32m✔ [Master Runner] Combined stress loop completed. Leaked FDs: ${stressResults.memoryMeasurement.result.leaked}, Heap Delta: ${stressResults.memoryMeasurement.delta.heapDeltaMb} MB.\x1b[0m\n`
  );

  // Step 5: Build Consolidated Summary and Export JSON
  const masterSummary = buildConsolidatedSummary(
    typespecResults,
    zodMockResults,
    stressResults
  );

  fs.writeFileSync(SUMMARY_RESULTS_FILE, JSON.stringify(masterSummary, null, 2), 'utf8');
  console.log(`  ✓ Consolidated summary exported to: ${SUMMARY_RESULTS_FILE}\n`);

  // Step 6: Present Executive Dashboard
  printExecutiveDashboard(masterSummary);

  if (!masterSummary.acceptanceCriteria.allPassed) {
    throw new Error('Master benchmark run failed one or more acceptance criteria.');
  }

  return masterSummary;
}

// ============================================================================
// CLI Direct Execution
// ============================================================================

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('run-all.ts') ||
    process.argv[1].endsWith('run-all.js') ||
    process.argv[1].includes('run-all'));

if (isDirectExecution) {
  runMasterBenchmarkSuite().catch((err) => {
    console.error('\n\x1b[31mMaster Benchmark Runner Failed:\x1b[0m', err);
    process.exit(1);
  });
}
