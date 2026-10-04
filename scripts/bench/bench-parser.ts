/**
 * oa-sdk Parser Benchmark: shared `$ref` expansion scaling (Goal 69).
 *
 * Measures `parseDocument` (Node and browser entrypoints) on fixtures whose
 * cost is super-linear when `$ref` targets are re-expanded at every use site:
 *   - Diamond DAG: each schema references the next level twice. Inline output
 *     is 2^depth unless expansions are shared, so the budget is flat.
 *   - Reference ring: every component expansion walks the whole ring and is cut
 *     at a different point, so the inlined output itself is O(n^2) and cannot be
 *     shared. These budgets guard against regressing past that floor.
 *
 * Each case has a time budget. The process exits non-zero when any median
 * exceeds its budget, so the script can gate regressions.
 */

import { performance } from 'node:perf_hooks';

import { parseDocument, type OasDocument } from '../../packages/parser/src/index.js';
import { parseDocument as parseBrowserDocument } from '../../packages/parser/src/browser.js';
import {
  calculateLatencyStats,
  generateRefRingSchema,
  generateSharedRefDiamondSchema,
} from './lib/index.js';

type BenchCase = {
  name: string;
  spec: Record<string, unknown>;
  budgetMs: number;
};

const ITERATIONS = 5;

const cases: BenchCase[] = [
  ...[16, 18, 24].map(depth => ({
    name: `diamond depth ${depth}`,
    spec: generateSharedRefDiamondSchema(depth),
    budgetMs: 50,
  })),
  { name: 'ring 100', spec: generateRefRingSchema(100), budgetMs: 150 },
  { name: 'ring 200', spec: generateRefRingSchema(200), budgetMs: 600 },
];

const runtimes = [
  ['node', (spec: OasDocument) => parseDocument(spec)],
  ['browser', (spec: OasDocument) => parseBrowserDocument(spec)],
] as const;

let failed = false;
console.log('case                     runtime   median ms   p90 ms   budget ms');
for (const benchCase of cases) {
  for (const [runtime, parse] of runtimes) {
    const samples: number[] = [];
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const start = performance.now();
      parse(benchCase.spec as OasDocument);
      samples.push(performance.now() - start);
    }
    const stats = calculateLatencyStats(samples);
    const overBudget = stats.p50 > benchCase.budgetMs;
    if (overBudget) failed = true;
    console.log(
      `${benchCase.name.padEnd(24)} ${runtime.padEnd(9)} ${stats.p50.toFixed(2).padStart(9)} ${stats.p90.toFixed(2).padStart(8)} ${String(benchCase.budgetMs).padStart(11)}${overBudget ? '  OVER BUDGET' : ''}`,
    );
  }
}

if (failed) {
  console.error('parser bench: one or more cases exceeded the time budget');
  process.exitCode = 1;
}
