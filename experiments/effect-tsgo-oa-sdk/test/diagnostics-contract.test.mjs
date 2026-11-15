import assert from "node:assert/strict";
import { test } from "node:test";
import { assessEffectDiagnostics } from "../scripts/diagnostics-contract.mjs";

const summary = { filesChecked: 2, filesWithoutPlugin: 0, totalFiles: 2, errors: 0, warnings: 0, messages: 0 };
const floating = { file: "src/negative/floating-effect.ts", start: 5, length: 12, line: 1, column: 1, code: 377100, name: "floatingEffect", severity: "error", message: "Effect value is not run" };

test("valid checked project with zero errors passes", () => {
  const r = assessEffectDiagnostics({ diagnostics: [], summary });
  assert.equal(r.status, "passed");
  assert.equal(r.coverage.filesChecked, 2);
});

test("expected Effect error is a passing negative test, not a clean compilation", () => {
  const r = assessEffectDiagnostics({ diagnostics: [floating], summary: { ...summary, errors: 1 } }, { expectedRule: "floatingEffect" });
  assert.equal(r.status, "passed");
  assert.equal(r.reason, "expected-rule-observed");
  assert.equal(r.findings[0].source, "effect-tsgo");
});

test("missing expected diagnostic fails rather than disappearing", () => {
  const r = assessEffectDiagnostics({ diagnostics: [], summary }, { expectedRule: "floatingEffect" });
  assert.equal(r.status, "failed");
});

test("unselected Effect plugin is blocked, not green", () => {
  const r = assessEffectDiagnostics({ diagnostics: [], summary: { ...summary, filesChecked: 0, filesWithoutPlugin: 2 } });
  assert.equal(r.status, "blocked");
});

test("partial project coverage is blocked", () => {
  const r = assessEffectDiagnostics({ diagnostics: [], summary: { ...summary, filesWithoutPlugin: 1 } });
  assert.equal(r.status, "blocked");
});

test("malformed report is blocked", () => {
  const r = assessEffectDiagnostics("Some unrelated output");
  assert.equal(r.status, "blocked");
});

test("unexpected error fails the positive case", () => {
  const r = assessEffectDiagnostics({ diagnostics: [floating], summary: { ...summary, errors: 1 } });
  assert.equal(r.status, "failed");
});

test("unknown severity cannot masquerade as clean output", () => {
  const r = assessEffectDiagnostics({ diagnostics: [{ ...floating, severity: "none" }], summary });
  assert.equal(r.status, "blocked");
});

test("an unrelated file cannot satisfy the negative fixture expectation", () => {
  const r = assessEffectDiagnostics({
    diagnostics: [{ ...floating, file: "src/service.ts" }],
    summary: { ...summary, errors: 1 }
  }, { expectedRule: "floatingEffect", expectedFile: "src/negative/floating-effect.ts" });
  assert.equal(r.status, "failed");
});

test("absolute Linux/Windows negative paths preserve expected rule identity", () => {
  for (const file of [
    "/workspace/src/negative/floating-effect.ts",
    String.raw`C:\workspace\src\negative\floating-effect.ts`
  ]) {
    const r = assessEffectDiagnostics({
      diagnostics: [{ ...floating, file }],
      summary: { ...summary, errors: 1 }
    }, { expectedRule: "floatingEffect", expectedFile: "src/negative/floating-effect.ts" });
    assert.equal(r.status, "passed", file);
  }
});
