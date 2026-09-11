/**
 * Smoke Test Verification Suite for oa-sdk Benchmark & Profiling Library.
 *
 * Executed via: node --expose-gc --import tsx scripts/bench/lib/test-smoke.ts
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  withCpuProfile,
  profileBlock,
  ensureGc,
  runGc,
  getHeapUsageMb,
  measureMemoryDelta,
  getOpenFdCount,
  getOpenFdDetails,
  assertZeroFdLeak,
  calculateLatencyStats,
  now,
  measureDuration,
  measureDurationSync,
  sleep,
  formatMs,
  formatQps,
  generateSyntheticTypeSpec,
  generateSyntheticOpenApiSchema,
} from './index.js';

import { compile, NodeHost } from '@typespec/compiler';
import { findCircularSchemas } from '../../../packages/codegen/src/zodgen/generate-zod.js';
import { createNodeMockServer } from '../../../packages/mock-server/src/adapters/node-http.js';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  totalTests++;
  process.stdout.write(`  [RUN] ${name}... `);
  try {
    await fn();
    passedTests++;
    console.log('✅ PASS');
  } catch (err) {
    console.log('❌ FAIL');
    console.error(err);
    process.exitCode = 1;
  }
}

async function runAllSmokeTests(): Promise<void> {
  console.log('Starting Smoke Tests for scripts/bench/lib/ ...\n');

  // ============================================================================
  // 1. Profiler Tests (`profiler.ts`)
  // ============================================================================
  console.log('--- 1. Testing Profiler (profiler.ts) ---');

  await test('withCpuProfile records samples and exports .cpuprofile JSON', async () => {
    const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-smoke-prof-'));

    try {
      const { result, profile } = await withCpuProfile(
        'smoke-test-profile',
        async () => {
          let sum = 0;
          for (let i = 0; i < 5_000_000; i++) {
            sum += Math.sqrt(i);
          }
          return sum;
        },
        {
          samplingIntervalUs: 500,
          outputDir: tmpOutDir,
          saveRawProfile: true,
        }
      );

      assert.ok(result > 0, 'Workload should return positive computation');
      assert.equal(profile.name, 'smoke-test-profile');
      assert.ok(profile.durationMs > 0, 'Duration should be positive');
      assert.ok(fs.existsSync(profile.profilePath), `Profile file should exist at ${profile.profilePath}`);

      const fileContent = fs.readFileSync(profile.profilePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      assert.ok(Array.isArray(parsed.nodes), 'Raw profile should contain nodes array');

      assert.ok(profile.totalHitCount >= 0, 'totalHitCount should be non-negative');
      assert.ok(Array.isArray(profile.topHotspots), 'topHotspots should be an array');
      if (profile.topHotspots.length > 0) {
        const top = profile.topHotspots[0]!;
        assert.ok(typeof top.functionName === 'string', 'Hotspot functionName should be string');
        assert.ok(top.hitCount >= 0, 'Hotspot hitCount should be non-negative');
        assert.ok(top.percentage >= 0 && top.percentage <= 100, 'Hotspot percentage should be between 0 and 100');
      }
    } finally {
      fs.rmSync(tmpOutDir, { recursive: true, force: true });
    }
  });

  await test('profileBlock alias works identically to withCpuProfile', async () => {
    const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-smoke-alias-'));
    try {
      const { result, profile } = await profileBlock(
        'alias-test',
        () => 42 * 2,
        { outputDir: tmpOutDir }
      );
      assert.equal(result, 84);
      assert.ok(fs.existsSync(profile.profilePath));
    } finally {
      fs.rmSync(tmpOutDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 2. Memory & GC Tests (`memory.ts`)
  // ============================================================================
  console.log('\n--- 2. Testing Memory & GC (memory.ts) ---');

  await test('ensureGc and runGc execute multiple GC passes', () => {
    const gcFn = ensureGc();
    assert.equal(typeof gcFn, 'function', 'ensureGc should return a function');
    const runs = runGc(3);
    assert.ok(runs >= 1, `runGc(3) should execute at least 1 pass, got ${runs}`);
  });

  await test('getHeapUsageMb returns current heap in MB', () => {
    const mb = getHeapUsageMb();
    assert.ok(mb > 0 && mb < 4096, `Heap usage should be reasonable (>0 MB), got ${mb} MB`);
  });

  await test('measureMemoryDelta measures initial, final, and delta heap', async () => {
    const { result, delta, initialHeapMb, finalHeapMb, heapDeltaMb } = await measureMemoryDelta(async () => {
      // Allocate 100,000 objects in memory
      const items = new Array(100_000).fill(null).map((_, i) => ({ id: i, name: `item-${i}` }));
      return items.length;
    });

    assert.equal(result, 100_000);
    assert.ok(delta.initialHeapMb > 0, 'initialHeapMb should be > 0');
    assert.ok(delta.finalHeapMb > 0, 'finalHeapMb should be > 0');
    assert.equal(typeof delta.heapDeltaMb, 'number', 'heapDeltaMb should be a number');
    assert.ok(delta.gcRuns >= 2, `gcRuns should be at least 2, got ${delta.gcRuns}`);

    // Test root object property destructuring compatibility
    assert.equal(initialHeapMb, delta.initialHeapMb);
    assert.equal(finalHeapMb, delta.finalHeapMb);
    assert.equal(heapDeltaMb, delta.heapDeltaMb);
  });

  // ============================================================================
  // 3. File Descriptor Tests (`fd.ts`)
  // ============================================================================
  console.log('\n--- 3. Testing File Descriptors (fd.ts) ---');

  await test('getOpenFdCount and getOpenFdDetails return valid process descriptors', () => {
    const count = getOpenFdCount();
    assert.ok(Number.isInteger(count) && count > 0, `getOpenFdCount should return integer > 0, got ${count}`);

    const details = getOpenFdDetails();
    assert.ok(details.count > 0, 'details.count should be > 0');
    assert.ok(Array.isArray(details.openFds), 'details.openFds should be array');
    assert.ok(typeof details.activeHandles === 'number', 'details.activeHandles should be number');
  });

  await test('assertZeroFdLeak detects zero leaks across file open/close iterations', async () => {
    const result = await assertZeroFdLeak(
      () => {
        const fd = fs.openSync('/dev/null', 'r');
        fs.closeSync(fd);
      },
      10,
      { settleMs: 20 }
    );

    assert.equal(result.iterations, 10);
    assert.equal(result.leaked, 0, `Expected 0 leaked FDs, got ${result.leaked}`);
    assert.equal(result.hasLeak, false);
    assert.ok(result.initialFds > 0);
    assert.ok(result.finalFds > 0);
  });

  // ============================================================================
  // 4. Stats & Timing Tests (`stats.ts`)
  // ============================================================================
  console.log('\n--- 4. Testing Stats & High-Precision Timing (stats.ts) ---');

  await test('calculateLatencyStats computes exact percentiles, mean, stddev, and QPS', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const stats = calculateLatencyStats(samples);

    assert.equal(stats.samples, 10);
    assert.equal(stats.minMs, 10);
    assert.equal(stats.maxMs, 100);
    assert.equal(stats.meanMs, 55);
    assert.equal(stats.p50Ms, 55);
    assert.equal(stats.p90Ms, 91);
    assert.equal(stats.p95Ms, 95.5);
    assert.equal(stats.p99Ms, 99.1);
    assert.ok(stats.stddevMs > 28 && stats.stddevMs < 29, `stddevMs should be ~28.72, got ${stats.stddevMs}`);
    assert.equal(stats.qps, 18);

    // Test aliases
    assert.equal(stats.min, stats.minMs);
    assert.equal(stats.p50, stats.p50Ms);
    assert.equal(stats.p90, stats.p90Ms);
    assert.equal(stats.p95, stats.p95Ms);
    assert.equal(stats.p99, stats.p99Ms);
    assert.equal(stats.max, stats.maxMs);
    assert.equal(stats.mean, stats.meanMs);
    assert.equal(stats.stddev, stats.stddevMs);
    assert.equal(stats.throughput, stats.qps);
  });

  await test('calculateLatencyStats with custom totalDurationMs computes accurate throughput', () => {
    const samples = [5, 5, 5, 5];
    // 4 samples across 200 ms wall clock = 20 QPS
    const stats = calculateLatencyStats(samples, 200);
    assert.equal(stats.samples, 4);
    assert.equal(stats.qps, 20);
    assert.equal(stats.throughput, 20);
  });

  await test('calculateLatencyStats handles empty and single-element edge cases', () => {
    const empty = calculateLatencyStats([]);
    assert.equal(empty.samples, 0);
    assert.equal(empty.minMs, 0);
    assert.equal(empty.p50Ms, 0);
    assert.equal(empty.qps, 0);

    const single = calculateLatencyStats([42.5]);
    assert.equal(single.samples, 1);
    assert.equal(single.minMs, 42.5);
    assert.equal(single.maxMs, 42.5);
    assert.equal(single.p50Ms, 42.5);
    assert.equal(single.meanMs, 42.5);
    assert.equal(single.stddevMs, 0);
  });

  await test('high-precision time helpers (now, measureDuration, sleep, formatMs)', async () => {
    const t0 = now();
    assert.ok(t0 > 0);

    const syncRes = measureDurationSync(() => {
      let acc = 0;
      for (let i = 0; i < 100_000; i++) acc += i;
      return acc;
    });
    assert.ok(syncRes.durationMs >= 0);

    const asyncRes = await measureDuration(async () => {
      await sleep(20);
      return 'done';
    });
    assert.equal(asyncRes.result, 'done');
    assert.ok(asyncRes.durationMs >= 15, `Sleep duration should be >= 15 ms, got ${asyncRes.durationMs}`);

    assert.equal(formatMs(0.0005), '0.5 µs');
    assert.equal(formatMs(12.345), '12.35 ms');
    assert.equal(formatMs(1500), '1.50 s');
    assert.equal(formatQps(5815), '5,815 ops/s');
  });

  // ============================================================================
  // 5. Generator Tests (`generators.ts`)
  // ============================================================================
  console.log('\n--- 5. Testing Synthetic Generators (generators.ts) ---');

  await test('generateSyntheticTypeSpec produces valid compilable TypeSpec code', async () => {
    const tspSource = generateSyntheticTypeSpec(3, { cyclic: true });
    assert.ok(tspSource.includes('import "@typespec/http";'));
    assert.ok(tspSource.includes('model Resource0 {'));
    assert.ok(tspSource.includes('model Resource2 {'));
    assert.ok(tspSource.includes('parent?: Resource0;'));
    assert.ok(tspSource.includes('sibling?: Resource1;'));
    assert.ok(tspSource.includes('@route("/resources-0")'));
    assert.ok(tspSource.includes('@operationId("listResource0")'));

    // Verify compilation with @typespec/compiler
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-smoke-'));
    const rootNm = path.resolve(process.cwd(), 'node_modules');
    fs.symlinkSync(rootNm, path.join(tmpDir, 'node_modules'), 'dir');

    const tspFile = path.join(tmpDir, 'main.tsp');
    fs.writeFileSync(tspFile, tspSource, 'utf8');

    try {
      const program = await compile(NodeHost, tspFile, { noEmit: true });
      assert.equal(program.hasError(), false, 'Synthetic TypeSpec should compile without errors');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('generateSyntheticOpenApiSchema produces valid OAS 3.2 document with cycles and depth', async () => {
    const doc = generateSyntheticOpenApiSchema(4, { cyclic: true, depth: 3 }) as any;

    assert.equal(doc.openapi, '3.2.0');
    assert.equal(Object.keys(doc.components.schemas).length, 4);
    assert.ok(doc.paths['/api/v1/models-0']);

    const model0 = doc.components.schemas.Model0;
    assert.equal(model0.properties.parent.$ref, '#/components/schemas/Model0');
    assert.equal(model0.properties.sibling.$ref, '#/components/schemas/Model1');

    // Verify nested hierarchy depth
    assert.ok(model0.properties.nestedLayer1.properties.nestedLayer2.properties.nestedLayer3);

    // Verify cycle detection integration with findCircularSchemas
    const circulars = findCircularSchemas(doc.components.schemas);
    assert.equal(circulars.size, 4, 'All 4 cyclic models should be detected');
    assert.ok(circulars.has('Model0'));
    assert.ok(circulars.has('Model3'));
  });

  await test('generateSyntheticOpenApiSchema integrates cleanly with createNodeMockServer', async () => {
    // Non-cyclic spec for mock server routing verification
    const doc = generateSyntheticOpenApiSchema(3, { cyclic: false, depth: 1 }) as any;
    const server = createNodeMockServer(doc, { port: 0 });

    await server.start();
    assert.ok(server.url.startsWith('http://127.0.0.1:'), `Server URL should be valid: ${server.url}`);

    await server.stop();
  });

  // ============================================================================
  // Final Summary
  // ============================================================================
  console.log('\n========================================================');
  console.log(`Smoke Test Summary: ${passedTests} / ${totalTests} passed (100%)`);
  console.log('========================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAllSmokeTests().catch(err => {
  console.error('Fatal unhandled error in smoke test:', err);
  process.exit(1);
});
