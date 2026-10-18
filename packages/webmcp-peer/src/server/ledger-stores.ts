import {
  existsSync,
  mkdirSync,
  readFileSync,
  truncateSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  isCommitReceipt,
  isUtcTimestamp,
  type AiRunLedgerStore,
  type AiRunLedgerWriteOptions,
  type AiRunLedgerWriteResult,
  type AiRunOperationRecord,
} from "../provider.js";
import {
  appendDurableLineSync,
  readDurableJsonLinesSync,
  withFileLockSync,
} from "./durable-file.js";

const require = createRequire(import.meta.url);

type AiRunLedgerConflict = { readonly status: "conflict"; readonly entry?: AiRunOperationRecord };

function ledgerKey(runId: string, requestId: string): string {
  return `${runId}\u0000${requestId}`;
}

function cloneLedger<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalLedgerJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLedgerJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(name => `${JSON.stringify(name)}:${canonicalLedgerJson(object[name])}`).join(",")}}`;
}

function sameLedgerIdentity(left: AiRunOperationRecord, right: AiRunOperationRecord, allowUnknownBinding = false): boolean {
  const exact = left.status !== "outcome-unknown" || !allowUnknownBinding;
  return left.runId === right.runId && left.requestId === right.requestId
    && left.documentId === right.documentId && left.actionId === right.actionId
    && left.stepIndex === right.stepIndex
    && (!exact || left.operationId === right.operationId)
    && (!exact || left.transactionId === right.transactionId)
    && (!exact || left.replicaId === right.replicaId);
}

function sameLedgerRow(left: AiRunOperationRecord, right: AiRunOperationRecord): boolean {
  return sameLedgerIdentity(left, right) && canonicalLedgerJson(left) === canonicalLedgerJson(right);
}

function validLedgerEntry(value: unknown): value is AiRunOperationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as AiRunOperationRecord;
  if (!entry.runId?.trim() || !entry.requestId?.trim() || !entry.documentId?.trim() || !entry.actionId?.trim()
    || !Number.isSafeInteger(entry.stepIndex) || entry.stepIndex < 0
    || !isCommitReceipt(entry.receipt) || entry.receipt.requestId !== entry.requestId
    || entry.receipt.documentId !== entry.documentId || entry.receipt.status !== entry.status
    || !isUtcTimestamp(entry.recordedAt) || !isUtcTimestamp(entry.updatedAt)) return false;
  const receipt = entry.receipt;
  if (entry.operationId !== ("operationId" in receipt && typeof receipt.operationId === "string" ? receipt.operationId : undefined)
    || entry.transactionId !== ("transactionId" in receipt && typeof receipt.transactionId === "string" ? receipt.transactionId : undefined)
    || entry.replicaId !== ("replicaId" in receipt && typeof receipt.replicaId === "string" ? receipt.replicaId : undefined)) return false;
  if (entry.rollbackStatus === undefined) return entry.rollbackUpdatedAt === undefined;
  return (entry.rollbackStatus === "rolled-back" || entry.rollbackStatus === "failed" || entry.rollbackStatus === "outcome-unknown")
    && isUtcTimestamp(entry.rollbackUpdatedAt);
}

function assertLedgerEntry(value: unknown): asserts value is AiRunOperationRecord {
  if (!validLedgerEntry(value)) throw new Error("AI_RUN_LEDGER_ENTRY_INVALID");
}

const ledgerStatusRanks = { rejected: 0, committed: 1, durable: 2, replicating: 3, replicated: 4, "outcome-unknown": -1 };

function canReplaceLedger(existing: AiRunOperationRecord, entry: AiRunOperationRecord, options: AiRunLedgerWriteOptions): boolean {
  if (!sameLedgerIdentity(existing, entry, options.allowOutcomeUnknownResolution === true)) return false;
  if (options.expectedUpdatedAt !== undefined && existing.updatedAt !== options.expectedUpdatedAt) return false;
  if (options.expectedEntry && canonicalLedgerJson(existing) !== canonicalLedgerJson(options.expectedEntry)) return false;
  if (sameLedgerRow(existing, entry)) return true;
  if (existing.rollbackStatus === "rolled-back" || existing.rollbackStatus === "outcome-unknown") {
    if (existing.rollbackStatus !== entry.rollbackStatus) return false;
  }
  if (existing.status === "outcome-unknown" && entry.status !== "outcome-unknown") return options.allowOutcomeUnknownResolution === true;
  if (entry.status === "outcome-unknown" && existing.status !== "outcome-unknown") return false;
  if (existing.status === "rejected") return false;
  return ledgerStatusRanks[entry.status] >= ledgerStatusRanks[existing.status];
}

function ledgerRowsFromFile(filePath: string): Map<string, AiRunOperationRecord> {
  if (!existsSync(filePath)) return new Map();
  const rows = readDurableJsonLinesSync<AiRunOperationRecord>(filePath, "AI_RUN_LEDGER_FILE_CORRUPT");
  const result = new Map<string, AiRunOperationRecord>();
  for (const row of rows) {
    assertLedgerEntry(row);
    result.set(ledgerKey(row.runId, row.requestId), row);
  }
  return result;
}

function recoverTornFinalLedgerRow(filePath: string): void {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  if (raw.length > 0 && !raw.endsWith("\n")) truncateSync(filePath, raw.lastIndexOf("\n") + 1);
}

export class FileAiRunLedgerStore implements AiRunLedgerStore {
  constructor(readonly filePath: string) {}

  find(runId: string, requestId: string): AiRunOperationRecord | null {
    return withFileLockSync(this.filePath, () => cloneLedger(ledgerRowsFromFile(this.filePath).get(ledgerKey(runId, requestId)) ?? null));
  }

  list(runId: string): readonly AiRunOperationRecord[] {
    return withFileLockSync(this.filePath, () => [...ledgerRowsFromFile(this.filePath).values()]
      .filter(row => row.runId === runId)
      .map(cloneLedger));
  }

  appendIdempotent(entry: AiRunOperationRecord, options: AiRunLedgerWriteOptions = {}): AiRunLedgerWriteResult | AiRunLedgerConflict {
    assertLedgerEntry(entry);
    return withFileLockSync(this.filePath, () => {
      const rows = ledgerRowsFromFile(this.filePath);
      const existing = rows.get(ledgerKey(entry.runId, entry.requestId));
      const duplicateOperation = entry.operationId && [...rows.values()].find(row =>
        row.runId === entry.runId && row.requestId !== entry.requestId && row.operationId === entry.operationId);
      if (duplicateOperation) return { status: "conflict", entry: cloneLedger(duplicateOperation) };
      if (existing && sameLedgerRow(existing, entry)) {
        if (options.expectedUpdatedAt !== undefined && existing.updatedAt !== options.expectedUpdatedAt) return { status: "conflict", entry: cloneLedger(existing) };
        if (options.expectedEntry && canonicalLedgerJson(existing) !== canonicalLedgerJson(options.expectedEntry)) return { status: "conflict", entry: cloneLedger(existing) };
        return { status: "duplicate", entry: cloneLedger(existing) };
      }
      if (options.expectedEntry && !existing) return { status: "conflict" };
      if (existing && !canReplaceLedger(existing, entry, options)) return { status: "conflict", entry: cloneLedger(existing) };
      mkdirSync(dirname(this.filePath), { recursive: true });
      recoverTornFinalLedgerRow(this.filePath);
      appendDurableLineSync(this.filePath, `${JSON.stringify(entry)}\n`);
      return { status: existing ? "updated" : "appended", entry: cloneLedger(entry) };
    });
  }
}

type SqliteLedgerRow = { run_id: string; request_id: string; entry_json: string };
type SqliteLedgerDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): SqliteLedgerRow | undefined;
    all(...params: unknown[]): SqliteLedgerRow[];
    run(...params: unknown[]): { changes: number };
  };
  close(): void;
};

function openLedgerDatabase(filePath: string): SqliteLedgerDb {
  try {
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SqliteLedgerDb };
    return new DatabaseSync(filePath);
  } catch (error) {
    throw new Error("AI_RUN_LEDGER_SQLITE_RUNTIME_UNAVAILABLE", { cause: error });
  }
}

function ledgerRowEntry(row: SqliteLedgerRow): AiRunOperationRecord {
  try {
    const entry = JSON.parse(row.entry_json) as AiRunOperationRecord;
    if (entry.runId !== row.run_id || entry.requestId !== row.request_id) throw new Error();
    assertLedgerEntry(entry);
    return entry;
  } catch {
    throw new Error("AI_RUN_LEDGER_SQLITE_CORRUPT");
  }
}

export class SqliteAiRunLedgerStore implements AiRunLedgerStore {
  private readonly db: SqliteLedgerDb;

  constructor(readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = openLedgerDatabase(filePath);
    this.db.exec(`PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS framebook_ai_run_operation_ledger (
        run_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, request_id)
      );`);
  }

  close(): void { this.db.close(); }

  find(runId: string, requestId: string): AiRunOperationRecord | null {
    const row = this.db.prepare("SELECT run_id, request_id, entry_json FROM framebook_ai_run_operation_ledger WHERE run_id = ? AND request_id = ?").get(runId, requestId);
    return row ? ledgerRowEntry(row) : null;
  }

  list(runId: string): readonly AiRunOperationRecord[] {
    return this.db.prepare("SELECT run_id, request_id, entry_json FROM framebook_ai_run_operation_ledger WHERE run_id = ? ORDER BY updated_at, request_id").all(runId).map(ledgerRowEntry);
  }

  appendIdempotent(entry: AiRunOperationRecord, options: AiRunLedgerWriteOptions = {}): AiRunLedgerWriteResult | AiRunLedgerConflict {
    assertLedgerEntry(entry);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const duplicate = entry.operationId
        ? this.db.prepare("SELECT run_id, request_id, entry_json FROM framebook_ai_run_operation_ledger WHERE run_id = ? AND request_id <> ?").all(entry.runId, entry.requestId)
          .map(ledgerRowEntry).find(row => row.operationId === entry.operationId)
        : undefined;
      if (duplicate) { this.db.exec("ROLLBACK"); return { status: "conflict", entry: cloneLedger(duplicate) }; }
      const existingRow = this.db.prepare("SELECT run_id, request_id, entry_json FROM framebook_ai_run_operation_ledger WHERE run_id = ? AND request_id = ?").get(entry.runId, entry.requestId);
      const existing = existingRow ? ledgerRowEntry(existingRow) : undefined;
      if (existing && sameLedgerRow(existing, entry)) {
        if ((options.expectedUpdatedAt !== undefined && existing.updatedAt !== options.expectedUpdatedAt)
          || (options.expectedEntry && canonicalLedgerJson(existing) !== canonicalLedgerJson(options.expectedEntry))) {
          this.db.exec("ROLLBACK");
          return { status: "conflict", entry: cloneLedger(existing) };
        }
        this.db.exec("ROLLBACK");
        return { status: "duplicate", entry: cloneLedger(existing) };
      }
      if (options.expectedEntry && !existing) {
        this.db.exec("ROLLBACK");
        return { status: "conflict" };
      }
      if (existing && !canReplaceLedger(existing, entry, options)) {
        this.db.exec("ROLLBACK");
        return { status: "conflict", entry: cloneLedger(existing) };
      }
      this.db.prepare(`INSERT INTO framebook_ai_run_operation_ledger(run_id, request_id, entry_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(run_id, request_id) DO UPDATE SET entry_json = excluded.entry_json, updated_at = excluded.updated_at`)
        .run(entry.runId, entry.requestId, JSON.stringify(entry), entry.updatedAt);
      this.db.exec("COMMIT");
      return { status: existing ? "updated" : "appended", entry: cloneLedger(entry) };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    }
  }
}
