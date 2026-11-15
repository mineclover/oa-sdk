import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Never report success when OA's generated API artifacts are absent or empty. */
export function assessGeneratedArtifacts(root, files) {
  const missing = [];
  const empty = [];
  for (const file of files) {
    const full = path.join(root, file);
    if (!existsSync(full) || !statSync(full).isFile()) {
      missing.push(file);
    } else if (readFileSync(full).length === 0) {
      empty.push(file);
    }
  }
  return { status: missing.length || empty.length ? "blocked" : "passed", missing, empty };
}

/** Verify an explicit TAP report; command exit 0 by itself does not prove tests ran. */
export function assessNodeTap(output, { minimumTests = 1 } = {}) {
  const summary = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*#\s+(tests|pass|fail|skipped|cancelled)\s+(\d+)\s*$/.exec(line);
    if (match) summary[match[1]] = Number(match[2]);
  }
  const count = summary.tests;
  if (!Number.isInteger(count) || count < minimumTests || summary.fail !== 0 ||
      !Number.isInteger(summary.pass) || summary.pass + (summary.skipped ?? 0) + (summary.cancelled ?? 0) !== count ||
      (summary.skipped ?? 0) !== 0 || (summary.cancelled ?? 0) !== 0) {
    return { status: "blocked", reason: "missing-or-failed-tap-summary", summary };
  }
  return { status: "passed", reason: "all-tests-observed", summary };
}

/** Assert the selected compiler binary is the Effect-patched TypeScript 7.0.2 tool. */
export function assessCompilerVersion(output, expectedTypeScriptVersion = "7.0.2") {
  const normalized = output.trim();
  const prefix = `Version ${expectedTypeScriptVersion}+effect-tsgo.`;
  return {
    status: normalized.startsWith(prefix) ? "passed" : "blocked",
    expectedPrefix: prefix,
    observed: normalized.slice(0, 220)
  };
}
