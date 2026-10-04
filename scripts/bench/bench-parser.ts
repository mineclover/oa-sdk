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
 *   - Time budget: each case's median CPU time must stay within its budget.
 *     Budgets were calibrated on an idle Apple M3 Pro, where Goal 69 measured
 *     ring 100/200 at roughly 51/188 ms. `BENCH_PARSER_BUDGET_SCALE` (default 1)
 *     multiplies every budget for slower hardware; CI sets it explicitly.
 *   - Growth limit: a family's cost may grow at most as size^k from its
 *     smallest to its largest size. The limit is never scaled. The growth is
 *     the median over measured rounds of largest/smallest, where both samples
 *     of a ratio come from the same round, so a constant machine speed factor
 *     cancels in every ratio.
 *
 * What is timed: `parseDocument` is synchronous, CPU-bound work on the main
 * thread, so each sample is the main thread's CPU time (user + system) for one
 * parse. Unlike wall-clock time it does not count the time a loaded machine
 * leaves the thread waiting for a core. Load still inflates CPU time through
 * shared caches, memory pressure and clock speed, so it does not cancel: the
 * per-round pairing keeps both samples of a ratio close in time, and the
 * median discards the rounds where a spike hit one sample only. Wall-clock
 * medians are printed alongside for diagnosis and gate nothing.
 *
 * Measurement: warm-up rounds run first, in ascending size order. A warm-up
 * sample that already exceeds its budget many times over fails the case at
 * once and skips the larger sizes of its family, so a re-introduced
 * exponential expansion fails in seconds instead of running for minutes.
 * Every measured round then samples each case once, in an order shuffled per
 * round from a fixed seed: no case always follows the same case, and the order
 * is the same on every run. A full garbage collection runs before every sample,
 * outside the timed region, so each sample starts from the same heap state and
 * neither pays for collecting another case's garbage nor benefits from a young
 * generation another case has grown. This needs `--expose-gc`, which
 * `pnpm bench:parser` passes.
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
  /** Largest allowed exponent k in median(largest / smallest per round) <= (largest / smallest size)^k. */
  maxGrowthExponent?: number;
};

type Runtime = {
  name: string;
  parse: (spec: OasDocument) => unknown;
};

type Sample = {
  /** Main-thread CPU time (user + system) in milliseconds; every check uses this. */
  cpuMs: number;
  /** Wall-clock time in milliseconds; reported only. */
  wallMs: number;
};

type CaseResult = {
  family: BenchFamily;
  size: BenchSize;
  runtime: Runtime;
  /** One sample per measured round, in round order. */
  samples: Sample[];
  /** Set when the case failed during warm-up or was skipped because a smaller size failed. */
  abortedReason?: string;
};

const WARMUP_ROUNDS = 2;
/** Odd, so the median is one measured round rather than an average of two. */
const MEASURED_ROUNDS = 11;
/** Seed of the per-round sample order; fixed so every run uses the same orders. */
const ORDER_SEED = 0x6f612d73;
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

const collectGarbage = requireGc();
const budgetScale = readBudgetScale(process.env[BUDGET_SCALE_ENV]);
const scaledBudget = (size: BenchSize) => size.budgetMs * budgetScale;

const results: CaseResult[] = families.flatMap(family =>
  family.sizes.flatMap(size => runtimes.map(runtime => ({ family, size, runtime, samples: [] as Sample[] }))),
);

warmUp(results);
measure(results.filter(result => result.abortedReason === undefined));

console.log(
  `parser bench: main-thread CPU time, median of ${MEASURED_ROUNDS} shuffled rounds after ${WARMUP_ROUNDS} warm-up rounds, ` +
    `full GC before every sample, budget scale ${budgetScale} (${BUDGET_SCALE_ENV})`,
);
let failed = false;
console.log('case                     runtime   median ms   p90 ms   budget ms   wall median ms');
for (const result of results) {
  const budget = scaledBudget(result.size);
  const prefix = `${result.size.label.padEnd(24)} ${result.runtime.name.padEnd(9)}`;
  if (result.abortedReason !== undefined) {
    failed = true;
    console.log(`${prefix} ${'-'.padStart(9)} ${'-'.padStart(8)} ${formatMs(budget).padStart(11)}  FAILED: ${result.abortedReason}`);
    continue;
  }
  const cpu = calculateLatencyStats(result.samples.map(sample => sample.cpuMs));
  const wall = calculateLatencyStats(result.samples.map(sample => sample.wallMs));
  const overBudget = cpu.p50 > budget;
  if (overBudget) failed = true;
  console.log(
    `${prefix} ${cpu.p50.toFixed(2).padStart(9)} ${cpu.p90.toFixed(2).padStart(8)} ${formatMs(budget).padStart(11)} ${wall.p50.toFixed(2).padStart(16)}${overBudget ? '  OVER BUDGET' : ''}`,
  );
}

const growthChecks = families.filter(family => family.maxGrowthExponent !== undefined && family.sizes.length > 1);
if (growthChecks.length > 0) {
  console.log('growth                   runtime       ratio    limit   exponent   max exponent   round ratios');
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
      if (small.samples.some(sample => !(sample.cpuMs > 0))) {
        failed = true;
        console.log(`${prefix} ${'-'.padStart(9)} ${ratioLimit.toFixed(2).padStart(8)}  FAILED: a ${smallest.label} sample is too small to compare`);
        continue;
      }
      const roundRatios = pairedRatios(large.samples, small.samples);
      const ratio = calculateLatencyStats(roundRatios).p50;
      const exponent = Math.log(ratio) / Math.log(sizeRatio);
      const overLimit = ratio > ratioLimit;
      if (overLimit) failed = true;
      const range = `${Math.min(...roundRatios).toFixed(2)}-${Math.max(...roundRatios).toFixed(2)}`;
      console.log(
        `${prefix} ${ratio.toFixed(2).padStart(9)} ${ratioLimit.toFixed(2).padStart(8)} ${exponent.toFixed(2).padStart(10)} ${maxExponent.toFixed(2).padStart(14)}   ${range.padStart(12)}${overLimit ? '  OVER LIMIT' : ''}`,
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
      const { cpuMs } = timeOnce(result);
      const budget = scaledBudget(result.size);
      if (cpuMs > budget * ABORT_FACTOR) {
        result.abortedReason = `warm-up sample ${formatMs(cpuMs)} ms exceeds ${ABORT_FACTOR}x the budget`;
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

/**
 * Samples every case once per round, in an order shuffled for each round, so
 * `samples[round]` of every case comes from the same round.
 */
function measure(cases: CaseResult[]): void {
  const random = createRandom(ORDER_SEED);
  for (let round = 0; round < MEASURED_ROUNDS; round++) {
    for (const result of shuffle(cases, random)) {
      result.samples.push(timeOnce(result));
    }
  }
}

/** Collects garbage outside the timed region, then times one parse. */
function timeOnce(result: CaseResult): Sample {
  collectGarbage();
  const wallStart = performance.now();
  const cpuStart = process.threadCpuUsage();
  result.runtime.parse(result.size.spec);
  const cpu = process.threadCpuUsage(cpuStart);
  const wallMs = performance.now() - wallStart;
  return { cpuMs: (cpu.user + cpu.system) / 1000, wallMs };
}

/** CPU-time ratios `numerator[round] / denominator[round]`, one per measured round. */
function pairedRatios(numerator: Sample[], denominator: Sample[]): number[] {
  if (numerator.length !== denominator.length) {
    throw new Error(`cannot pair ${numerator.length} samples with ${denominator.length} samples`);
  }
  return numerator.map((sample, round) => sample.cpuMs / denominator[round]!.cpuMs);
}

/** Fisher-Yates shuffle of a copy of `items`. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  return shuffled;
}

/** Seeded PRNG (mulberry32) returning numbers in [0, 1). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function requireGc(): () => void {
  const gc = globalThis.gc;
  if (typeof gc !== 'function') {
    throw new Error(
      'parser bench needs --expose-gc to collect garbage between samples; run it with `pnpm bench:parser` ' +
        'or `node --expose-gc --import tsx scripts/bench/bench-parser.ts`',
    );
  }
  return () => gc();
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
