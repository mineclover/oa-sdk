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
 * The process exits non-zero when any check fails, so the script gates
 * regressions locally and in CI:
 *   - Time budget: each case's median must stay within its budget. Budgets were
 *     calibrated on an idle Apple M3 Pro, where they leave about 3x headroom
 *     (ring 100/200 at roughly 51/188 ms). `BENCH_PARSER_BUDGET_SCALE` (default 1)
 *     multiplies every budget for slower hardware; CI sets it explicitly.
 *   - Growth limit: a family's median may grow at most as size^k from its
 *     smallest to its largest size. Both medians come from the same interleaved
 *     run, so machine speed and background load cancel out. The limit is never
 *     scaled.
 *
 * Measurement: warm-up rounds run first, then every case is sampled once per
 * round, starting at a different case each round, so a load spike or a
 * collection of another case's garbage does not land on one case only. A
 * warm-up sample that already exceeds its budget many times over fails the case
 * at once and skips the larger sizes of its family, so a re-introduced
 * exponential expansion fails in seconds instead of running for minutes.
 */

import { performance } from 'node:perf_hooks';

import { parseDocument, type OasDocument } from '../../packages/parser/src/index.js';
import { parseDocument as parseBrowserDocument } from '../../packages/parser/src/browser.js';
import {
  calculateLatencyStats,
  generateRefRingSchema,
  generateSharedRefDiamondSchema,
} from './lib/index.js';

type BenchSize = {
  label: string;
  size: number;
  spec: OasDocument;
  budgetMs: number;
};

type BenchFamily = {
  name: string;
  /** Ascending by `size`. */
  sizes: BenchSize[];
  /** Largest allowed exponent k in median(largest) / median(smallest) <= (largest / smallest)^k. */
  maxGrowthExponent?: number;
};

type Runtime = {
  name: string;
  parse: (spec: OasDocument) => unknown;
};

type CaseResult = {
  family: BenchFamily;
  size: BenchSize;
  runtime: Runtime;
  samples: number[];
  /** Set when the case failed during warm-up or was skipped because a smaller size failed. */
  abortedReason?: string;
};

const WARMUP_ROUNDS = 2;
const MEASURED_ROUNDS = 7;
/** A warm-up sample this many times over budget is treated as a failed case without measuring it. */
const ABORT_FACTOR = 10;
const BUDGET_SCALE_ENV = 'BENCH_PARSER_BUDGET_SCALE';

const families: BenchFamily[] = [
  {
    name: 'diamond',
    sizes: [16, 18, 24].map(depth => ({
      label: `diamond depth ${depth}`,
      size: depth,
      spec: generateSharedRefDiamondSchema(depth) as OasDocument,
      budgetMs: 50,
    })),
  },
  {
    name: 'ring',
    sizes: [
      { label: 'ring 100', size: 100, spec: generateRefRingSchema(100) as OasDocument, budgetMs: 150 },
      { label: 'ring 200', size: 200, spec: generateRefRingSchema(200) as OasDocument, budgetMs: 600 },
    ],
    // The inlined output is Theta(n^2), so doubling n costs about 4x (2^2).
    // An O(n^3) path costs 8x (2^3); 2.5 sits between the two.
    maxGrowthExponent: 2.5,
  },
];

const runtimes: Runtime[] = [
  { name: 'node', parse: parseDocument },
  { name: 'browser', parse: parseBrowserDocument },
];

const budgetScale = readBudgetScale(process.env[BUDGET_SCALE_ENV]);
const scaledBudget = (size: BenchSize) => size.budgetMs * budgetScale;

const results: CaseResult[] = families.flatMap(family =>
  family.sizes.flatMap(size => runtimes.map(runtime => ({ family, size, runtime, samples: [] as number[] }))),
);

warmUp(results);
measure(results.filter(result => result.abortedReason === undefined));

console.log(
  `parser bench: median of ${MEASURED_ROUNDS} interleaved samples after ${WARMUP_ROUNDS} warm-up rounds; ` +
    `budget scale ${budgetScale} (${BUDGET_SCALE_ENV})`,
);
let failed = false;
console.log('case                     runtime   median ms   p90 ms   budget ms');
for (const result of results) {
  const budget = scaledBudget(result.size);
  const prefix = `${result.size.label.padEnd(24)} ${result.runtime.name.padEnd(9)}`;
  if (result.abortedReason !== undefined) {
    failed = true;
    console.log(`${prefix} ${'-'.padStart(9)} ${'-'.padStart(8)} ${formatMs(budget).padStart(11)}  FAILED: ${result.abortedReason}`);
    continue;
  }
  const stats = calculateLatencyStats(result.samples);
  const overBudget = stats.p50 > budget;
  if (overBudget) failed = true;
  console.log(
    `${prefix} ${stats.p50.toFixed(2).padStart(9)} ${stats.p90.toFixed(2).padStart(8)} ${formatMs(budget).padStart(11)}${overBudget ? '  OVER BUDGET' : ''}`,
  );
}

const growthChecks = families.filter(family => family.maxGrowthExponent !== undefined && family.sizes.length > 1);
if (growthChecks.length > 0) {
  console.log('growth                   runtime       ratio    limit   exponent   max exponent');
  for (const family of growthChecks) {
    const smallest = family.sizes[0]!;
    const largest = family.sizes[family.sizes.length - 1]!;
    const maxExponent = family.maxGrowthExponent!;
    const sizeRatio = largest.size / smallest.size;
    const ratioLimit = sizeRatio ** maxExponent;
    for (const runtime of runtimes) {
      const prefix = `${`${smallest.label} -> ${largest.size}`.padEnd(24)} ${runtime.name.padEnd(9)}`;
      const small = findResult(family, smallest, runtime);
      const large = findResult(family, largest, runtime);
      if (small.abortedReason !== undefined || large.abortedReason !== undefined) {
        failed = true;
        console.log(`${prefix} ${'-'.padStart(9)} ${ratioLimit.toFixed(2).padStart(8)}  FAILED: a size of this family was not measured`);
        continue;
      }
      const smallMedian = calculateLatencyStats(small.samples).p50;
      const largeMedian = calculateLatencyStats(large.samples).p50;
      if (!(smallMedian > 0)) {
        failed = true;
        console.log(`${prefix} ${'-'.padStart(9)} ${ratioLimit.toFixed(2).padStart(8)}  FAILED: ${smallest.label} median is too small to compare`);
        continue;
      }
      const ratio = largeMedian / smallMedian;
      const exponent = Math.log(ratio) / Math.log(sizeRatio);
      const overLimit = ratio > ratioLimit;
      if (overLimit) failed = true;
      console.log(
        `${prefix} ${ratio.toFixed(2).padStart(9)} ${ratioLimit.toFixed(2).padStart(8)} ${exponent.toFixed(2).padStart(10)} ${maxExponent.toFixed(2).padStart(14)}${overLimit ? '  OVER LIMIT' : ''}`,
      );
    }
  }
}

if (failed) {
  console.error('parser bench: one or more cases exceeded the time budget or growth limit');
  process.exitCode = 1;
}

/**
 * Runs the warm-up rounds. Sizes run in ascending order within a family so a
 * catastrophic smaller size can skip its larger, slower siblings.
 */
function warmUp(cases: CaseResult[]): void {
  for (let round = 0; round < WARMUP_ROUNDS; round++) {
    for (const result of cases) {
      if (result.abortedReason !== undefined) continue;
      const elapsed = timeOnce(result);
      const budget = scaledBudget(result.size);
      if (elapsed > budget * ABORT_FACTOR) {
        result.abortedReason = `warm-up sample ${formatMs(elapsed)} ms exceeds ${ABORT_FACTOR}x the budget`;
        for (const larger of cases) {
          if (
            larger.family === result.family &&
            larger.runtime === result.runtime &&
            larger.size.size > result.size.size &&
            larger.abortedReason === undefined
          ) {
            larger.abortedReason = `skipped because ${result.size.label} already failed`;
          }
        }
      }
    }
  }
}

/** Samples every case once per round, rotating the starting case each round. */
function measure(cases: CaseResult[]): void {
  for (let round = 0; round < MEASURED_ROUNDS; round++) {
    for (let offset = 0; offset < cases.length; offset++) {
      const result = cases[(round + offset) % cases.length]!;
      result.samples.push(timeOnce(result));
    }
  }
}

function timeOnce(result: CaseResult): number {
  const start = performance.now();
  result.runtime.parse(result.size.spec);
  return performance.now() - start;
}

function findResult(family: BenchFamily, size: BenchSize, runtime: Runtime): CaseResult {
  const result = results.find(entry => entry.family === family && entry.size === size && entry.runtime === runtime);
  if (!result) throw new Error(`missing bench result for ${size.label} / ${runtime.name}`);
  return result;
}

function readBudgetScale(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 1;
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`${BUDGET_SCALE_ENV} must be a positive number, received ${JSON.stringify(value)}`);
  }
  return scale;
}

function formatMs(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
