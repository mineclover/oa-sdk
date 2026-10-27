/**
 * Normalize structured Effect TSGO diagnostics. A missing/disabled plugin is
 * not equivalent to an empty error list, even when the command exits zero.
 * Source of JSON format: Effect-TS/tsgo/etsdiagnostics/diagnostics.go.
 */
export function assessEffectDiagnostics(raw, { expectedRule = null, expectedFile = null } = {}) {
  let report;
  try {
    report = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { status: "blocked", reason: "unparseable-json", findings: [] };
  }
  if (!report || typeof report !== "object" || !Array.isArray(report.diagnostics) ||
      !report.summary || typeof report.summary !== "object") {
    return { status: "blocked", reason: "invalid-json-envelope", findings: [] };
  }
  const s = report.summary;
  for (const key of ["filesChecked", "filesWithoutPlugin", "totalFiles", "errors", "warnings", "messages"]) {
    if (!Number.isInteger(s[key]) || s[key] < 0) {
      return { status: "blocked", reason: "invalid-summary-" + key, findings: [] };
    }
  }
  const findings = [];
  for (const d of report.diagnostics) {
    if (!d || typeof d !== "object" || typeof d.file !== "string" ||
        typeof d.name !== "string" || typeof d.message !== "string" ||
        !Number.isInteger(d.code) || !["error", "warning", "message"].includes(d.severity)) {
      return { status: "blocked", reason: "invalid-diagnostic", findings: [] };
    }
    findings.push({
      source: "effect-tsgo",
      file: d.file,
      start: d.start,
      length: d.length,
      line: d.line,
      column: d.column,
      code: d.code,
      rule: d.name,
      severity: d.severity,
      message: d.message
    });
  }
  const coverage = { filesChecked: s.filesChecked, filesWithoutPlugin: s.filesWithoutPlugin, totalFiles: s.totalFiles };
  if (s.filesChecked === 0 || s.filesWithoutPlugin > 0) {
    return { status: "blocked", reason: "missing-or-partial-effect-analysis", coverage, findings };
  }
  if (expectedRule !== null) {
    const matchesFile = (file) =>
      expectedFile === null ||
      file.replace(/\\/g, "/").replace(/^\\.\\//, "").endsWith("/" + expectedFile) ||
      file.replace(/\\/g, "/").replace(/^\\.\\//, "") === expectedFile;
    const matched = findings.some(d => d.rule === expectedRule && d.severity === "error" && matchesFile(d.file));
    return {
      status: matched ? "passed" : "failed",
      reason: matched ? "expected-rule-observed" : "expected-rule-missing",
      coverage,
      findings
    };
  }
  return {
    status: s.errors === 0 && !findings.some(d => d.severity === "error") ? "passed" : "failed",
    reason: s.errors === 0 && !findings.some(d => d.severity === "error") ? "no-error-diagnostics" : "unexpected-errors",
    coverage,
    findings
  };
}
