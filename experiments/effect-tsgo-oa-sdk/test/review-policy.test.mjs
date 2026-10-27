import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assessGeneratedArtifacts, assessNodeTap, assessCompilerVersion } from "../scripts/review-policy.mjs";

test("generated artifacts must physically exist and contain bytes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "effect-oa-generated-"));
  try {
    mkdirSync(path.join(root, "api"));
    writeFileSync(path.join(root, "api/types.ts"), "export type T = string;");
    writeFileSync(path.join(root, "api/client.ts"), "");
    const check = assessGeneratedArtifacts(root, ["api/types.ts", "api/client.ts", "api/schema.ts"]);
    assert.equal(check.status, "blocked");
    assert.deepEqual(check.missing, ["api/schema.ts"]);
    assert.deepEqual(check.empty, ["api/client.ts"]);
    writeFileSync(path.join(root, "api/client.ts"), "export function go() {}");
    writeFileSync(path.join(root, "api/schema.ts"), "export const S = 1");
    assert.equal(assessGeneratedArtifacts(root, ["api/types.ts", "api/client.ts", "api/schema.ts"]).status, "passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const tap = (tests, pass, fail, skipped = 0) =>
  `TAP version 13\n# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n`;

test("a TAP suite must report actual passing cases", () => {
  const result = assessNodeTap(tap(3, 3, 0), { minimumTests: 3 });
  assert.equal(result.status, "passed");
  assert.equal(result.summary.tests, 3);
});

test("zero tests cannot pass even with process exit zero", () => {
  assert.equal(assessNodeTap(tap(0, 0, 0)).status, "blocked");
});

test("a truncated TAP summary cannot pass", () => {
  assert.equal(assessNodeTap("TAP version 13\nok 1 - no summary", { minimumTests: 1 }).status, "blocked");
});

test("any failed/skipped TAP test blocks the run", () => {
  assert.equal(assessNodeTap(tap(4, 3, 1)).status, "blocked");
  assert.equal(assessNodeTap(tap(4, 3, 0, 1)).status, "blocked");
});

test("unpatched TypeScript compiler is not an Effect TSGO pass", () => {
  assert.equal(assessCompilerVersion("Version 7.0.2").status, "blocked");
  assert.equal(assessCompilerVersion("Version 7.1.0+effect-tsgo.0.59.0").status, "blocked");
});

test("Effect-patched correct compiler version is admitted", () => {
  assert.equal(assessCompilerVersion("Version 7.0.2+effect-tsgo.0.59.0\n").status, "passed");
});
