// Regression tests for the durable JSONL helpers and FileAiRunLedgerStore crash recovery: a torn
// final row (an append interrupted before its newline) must never brick the ledger, must never be
// read as a committed row, and must be repaired on byte offsets so multi-byte rows stay intact.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiRunLedger } from "../src/provider.js";
import { FileAiRunLedgerStore, appendDurableLineSync, readDurableJsonLinesSync, truncateUnterminatedTailSync } from "../src/server.js";

let tempDir = "";
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-peer-durable-"));
});
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const receipt = (requestId: string, documentId = "doc-1") => ({
  status: "durable" as const,
  requestId,
  documentId,
  operationId: `op-${requestId}`,
  transactionId: `tx-${requestId}`,
  replicaId: "rep-1",
  committedAt: "2026-10-18T00:00:00.000Z",
});

function ledgerAt(file: string): AiRunLedger {
  return new AiRunLedger(new FileAiRunLedgerStore(file));
}

function record(ledger: AiRunLedger, requestId: string, stepIndex: number, documentId?: string) {
  return ledger.recordReceipt({ runId: "run-1", actionId: "act-1", stepIndex, receipt: receipt(requestId, documentId) });
}

function committedLines(file: string): unknown[] {
  const raw = fs.readFileSync(file, "utf8");
  expect(raw.endsWith("\n")).toBe(true);
  return raw.slice(0, -1).split("\n").map((line) => JSON.parse(line) as unknown);
}

describe("FileAiRunLedgerStore torn-row recovery", () => {
  it("keeps serving list/find/recordReceipt after a half-written final row", async () => {
    const file = path.join(tempDir, "ledger.jsonl");
    const ledger = ledgerAt(file);
    expect((await record(ledger, "req-1", 0)).status).toBe("appended");
    fs.appendFileSync(file, '{"runId":"run-1","requestId":"req-2","documentId":"do');

    expect((await ledger.list("run-1")).map((row) => row.requestId)).toEqual(["req-1"]);
    expect((await ledger.find("run-1", "req-1"))?.requestId).toBe("req-1");
    expect(await ledger.find("run-1", "req-2")).toBeNull();

    expect((await record(ledger, "req-2", 1)).status).toBe("appended");
    expect((await ledger.list("run-1")).map((row) => row.requestId)).toEqual(["req-1", "req-2"]);
    expect(committedLines(file)).toHaveLength(2);
  });

  it("never reads an unterminated (valid JSON) final row as committed, so the next append cannot drop it silently", async () => {
    const file = path.join(tempDir, "ledger.jsonl");
    const ledger = ledgerAt(file);
    await record(ledger, "req-1", 0);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n$/, ""));

    // The append that wrote req-1 never completed (its newline is missing), so it is not a row.
    expect(await ledger.list("run-1")).toEqual([]);
    expect((await record(ledger, "req-2", 1)).status).toBe("appended");
    expect((await ledger.list("run-1")).map((row) => row.requestId)).toEqual(["req-2"]);
    expect(committedLines(file)).toHaveLength(1);
  });

  it("truncates on byte offsets, leaving earlier multi-byte rows intact", async () => {
    const file = path.join(tempDir, "ledger.jsonl");
    const ledger = ledgerAt(file);
    const documentId = "문서-한글-문서";
    await record(ledger, "req-1", 0, documentId);
    await record(ledger, "req-2", 1, documentId);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n$/, ""));

    expect((await record(ledger, "req-3", 2, documentId)).status).toBe("appended");
    const rows = await ledger.list("run-1");
    expect(rows.map((row) => row.requestId)).toEqual(["req-1", "req-3"]);
    expect(rows.every((row) => row.documentId === documentId)).toBe(true);
  });

  it("still rejects corrupt interior rows", async () => {
    const file = path.join(tempDir, "ledger.jsonl");
    const ledger = ledgerAt(file);
    await record(ledger, "req-1", 0);
    fs.writeFileSync(file, `{"broken":\n${fs.readFileSync(file, "utf8")}`);
    await expect(ledger.list("run-1")).rejects.toThrow("AI_RUN_LEDGER_FILE_CORRUPT: row 1");
    fs.writeFileSync(file, `${JSON.stringify({ runId: "run-1" })}\n`);
    await expect(ledger.list("run-1")).rejects.toThrow("AI_RUN_LEDGER_FILE_CORRUPT: row 1");
  });
});

describe("durable JSONL helpers", () => {
  const numberRow = {
    parse(value: unknown): { n: number } {
      if (typeof value !== "object" || value === null || typeof (value as { n?: unknown }).n !== "number") throw new TypeError("ROW_INVALID");
      return { n: (value as { n: number }).n };
    },
  };

  it("validates every row with the given schema", () => {
    const file = path.join(tempDir, "rows.jsonl");
    appendDurableLineSync(file, '{"n":1}\n');
    appendDurableLineSync(file, '{"n":2}\n');
    expect(readDurableJsonLinesSync(file, "ROWS_CORRUPT", numberRow)).toEqual([{ n: 1 }, { n: 2 }]);
    appendDurableLineSync(file, '{"n":"three"}\n');
    expect(() => readDurableJsonLinesSync(file, "ROWS_CORRUPT", numberRow)).toThrow("ROWS_CORRUPT: row 3");
  });

  it("reads or skips an unterminated tail as asked", () => {
    const file = path.join(tempDir, "rows.jsonl");
    fs.writeFileSync(file, '{"n":1}\n{"n":2}');
    expect(readDurableJsonLinesSync(file, "ROWS_CORRUPT", numberRow)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(readDurableJsonLinesSync(file, "ROWS_CORRUPT", numberRow, { ignoreUnterminatedTail: true })).toEqual([{ n: 1 }]);
    fs.writeFileSync(file, '{"n":1}\n{"n":');
    expect(() => readDurableJsonLinesSync(file, "ROWS_CORRUPT", numberRow)).toThrow("ROWS_CORRUPT: truncated final row");
    expect(readDurableJsonLinesSync(file, "ROWS_CORRUPT", numberRow, { ignoreUnterminatedTail: true })).toEqual([{ n: 1 }]);
  });

  it("truncates only the bytes after the last newline", () => {
    const file = path.join(tempDir, "rows.jsonl");
    fs.writeFileSync(file, '{"s":"한글"}\n{"s":"한');
    expect(truncateUnterminatedTailSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe('{"s":"한글"}\n');
    expect(truncateUnterminatedTailSync(file)).toBe(false);
    expect(truncateUnterminatedTailSync(path.join(tempDir, "missing.jsonl"))).toBe(false);
  });
});
