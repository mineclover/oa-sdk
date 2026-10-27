import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { assessEffectDiagnostics } from "./diagnostics-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(root, ".reports", "latest.json");
const specs = [
  ["effect", "4.0.6"], ["zod", "4.6.5"], ["typescript", "7.0.2"],
  ["@oa-sdk/codegen", "0.10.0"], ["@oa-sdk/client", "0.3.0"], ["@effect/tsgo", "0.59.0"]
];
const sources = [
  "package.json", "package-lock.json", "contract/openapi.yaml", "tsconfig.json",
  "tsconfig.negative.json", "src/service.ts", "src/negative/floating-effect.ts",
  "scripts/diagnostics-contract.mjs", "scripts/review.mjs",
  "test/diagnostics-contract.test.mjs", "test/runtime.test.mjs",
  "Dockerfile", "compose.yaml", "scripts/run-docker.sh",
  "docs/docker-test-environment.md", "docs/reference-sources.md",
  "docs/verification-protocol.md"
];
const generated = ["src/api/types.ts", "src/api/client.ts", "src/api/schemas.ts"];

function digestFiles(files) {
  const hash = createHash("sha256");
  const entries = [];
  for (const item of files) {
    const abs = path.join(root, item);
    const bytes = existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs) : null;
    const sha256 = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
    entries.push({ path: item, sha256 });
    hash.update(item + "\0" + (sha256 ?? "MISSING") + "\0");
  }
  return { sha256: hash.digest("hex"), entries };
}

function installedPackage(name) {
  try {
    const p = JSON.parse(readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8"));
    return { version: p.version, gitHead: typeof p.gitHead === "string" ? p.gitHead : null };
  } catch {
    return null;
  }
}

function spawn(name, args) {
  const start = performance.now();
  const command = process.execPath;
  const bin = name === "oa-gen"
    ? path.join(root, "node_modules", "@oa-sdk", "codegen", "dist", "cli", "index.js")
    : name === "effect-tsgo"
    ? path.join(root, "node_modules", "@effect", "tsgo", "dist", "effect-tsgo.cjs")
    : null;
  const argv = bin ? [bin, ...args] : args;
  const processResult = spawnSync(command, argv, {
    cwd: root, encoding: "utf8", shell: false, timeout: 180000, maxBuffer: 8 * 1024 * 1024
  });
  return {
    command: name, args, status: processResult.status,
    signal: processResult.signal, error: processResult.error?.message ?? null,
    durationMs: Math.round(performance.now() - start),
    stdout: (processResult.stdout ?? "").slice(-32768),
    stderr: (processResult.stderr ?? "").slice(-32768)
  };
}

const tools = Object.fromEntries(specs.map(([name, pinned]) => [name, { pinned, installed: installedPackage(name) }]));
const before = digestFiles(sources);
const receipt = {
  schema: "oa-effect-tsgo-reference-review/v1",
  timestamp: new Date().toISOString(),
  intent: "Independent OA SDK contract generation + Effect 4 runtime + Effect TSGO checks; no TTSC",
  node: process.version,
  runtime: {
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    declaredContainer: process.env.OA_EFFECT_DOCKER_CONTAINER === "1",
    declaredBaseImage: process.env.OA_EFFECT_BASE_IMAGE ?? null
  },
  toolchain: tools,
  sourceBefore: before,
  steps: [],
  verdict: "blocked"
};
const blockers = [];
if (Number(process.versions.node.split(".")[0]) !== 26) blockers.push("node-26-required-for-reference-matrix");
if (!existsSync(path.join(root, "package-lock.json"))) blockers.push("lockfile-missing-run-npm-install-and-commit-lock");
for (const [name, detail] of Object.entries(tools)) {
  if (!detail.installed) blockers.push(name + "-not-installed");
  else if (detail.installed.version !== detail.pinned) blockers.push(name + "-version-mismatch");
}
function writeReceipt() {
  receipt.sourceAfter = digestFiles(sources);
  receipt.generated = digestFiles(generated);
  receipt.inputsUnchanged = receipt.sourceBefore.sha256 === receipt.sourceAfter.sha256;
  if (!receipt.inputsUnchanged) receipt.verdict = "blocked-input-changed";
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ verdict: receipt.verdict, blockers: receipt.blockers ?? [], report: outPath }));
  if (receipt.verdict !== "candidate-passed") process.exitCode = 1;
}
if (blockers.length) {
  receipt.blockers = blockers;
  writeReceipt();
} else {
  let stopped = false;
  function step(id, cmd, args, { exitCode = 0, diagnosticMode = null } = {}) {
    if (stopped) {
      receipt.steps.push({ id, state: "not-run", reason: "upstream-failed" });
      return;
    }
    const result = spawn(cmd, args);
    let assessment = null;
    if (diagnosticMode !== null) {
      assessment = assessEffectDiagnostics(result.stdout, {
        expectedRule: diagnosticMode === "negative" ? "floatingEffect" : null
      });
    }
    const ok = !result.error && result.signal === null &&
      result.status === exitCode &&
      (!assessment || assessment.status === "passed");
    receipt.steps.push({
      id, state: ok ? "passed" : "failed",
      ...(assessment ? { assessment } : {}),
      process: result
    });
    if (!ok) stopped = true;
  }
  step("contract-validation", "oa-gen", ["validate", "--spec", "./contract/openapi.yaml", "--require-32"]);
  step("type-generation", "oa-gen", ["typegen", "--spec", "./contract/openapi.yaml", "--output", "./src/api/types.ts"]);
  step("client-generation", "oa-gen", ["generate:client", "--spec", "./contract/openapi.yaml", "--types-import", "./types.js", "--output", "./src/api/client.ts"]);
  step("zod-generation", "oa-gen", ["generate:zod", "--spec", "./contract/openapi.yaml", "--output", "./src/api/schemas.ts"]);
  step("effect-typescript-check", "effect-tsgo", ["tsc@7.0.2", "-p", "tsconfig.json", "--noEmit"]);
  step("valid-effect-diagnostics", "effect-tsgo", ["diagnostics", "--project", "tsconfig.json", "--format", "json"], { diagnosticMode: "positive" });
  step("invalid-effect-diagnostics", "effect-tsgo", ["diagnostics", "--project", "tsconfig.negative.json", "--format", "json"], { diagnosticMode: "negative", exitCode: 1 });
  step("effect-typescript-emit", "effect-tsgo", ["tsc@7.0.2", "-p", "tsconfig.json"]);
  step("runtime-transport-and-schema", "node", ["--test", "test/runtime.test.mjs"]);
  receipt.verdict = stopped ? "failed-or-incomplete" : "candidate-passed";
  // Passing this harness is evidence of this run only, not approval, release readiness,
  // independent review, or Effect Runtime DevTools integration.
  writeReceipt();
}
