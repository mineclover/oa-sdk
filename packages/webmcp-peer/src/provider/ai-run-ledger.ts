import { isCommitReceipt, type CommitReceipt } from "./commit-receipt.js";

export type AiRunReceiptStatus = CommitReceipt["status"];
export type AiRunRollbackStatus = "rolled-back" | "failed" | "outcome-unknown";
export type AiRunLedgerDisposition =
  | "not-durable"
  | "rollback-eligible"
  | "reconciliation-required"
  | "rolled-back"
  | "rollback-unknown";

export interface AiRunOperationRecord {
  readonly runId: string;
  readonly requestId: string;
  readonly documentId: string;
  readonly actionId: string;
  readonly stepIndex: number;
  readonly status: AiRunReceiptStatus;
  readonly operationId?: string;
  readonly transactionId?: string;
  readonly replicaId?: string;
  readonly receipt: CommitReceipt;
  readonly recordedAt: string;
  readonly updatedAt: string;
  readonly rollbackStatus?: AiRunRollbackStatus;
  readonly rollbackUpdatedAt?: string;
}

export type AiRunLedgerWriteStatus = "appended" | "updated" | "duplicate";

export type AiRunLedgerWriteResult = {
  readonly status: AiRunLedgerWriteStatus;
  readonly entry: AiRunOperationRecord;
};

export interface AiRunLedgerWriteOptions {
  readonly expectedUpdatedAt?: string;
  readonly expectedEntry?: AiRunOperationRecord;
  readonly allowOutcomeUnknownResolution?: boolean;
}

export interface AiRunLedgerStore {
  find(runId: string, requestId: string): Promise<AiRunOperationRecord | null> | AiRunOperationRecord | null;
  list(runId: string): Promise<readonly AiRunOperationRecord[]> | readonly AiRunOperationRecord[];
  appendIdempotent(
    entry: AiRunOperationRecord,
    options?: AiRunLedgerWriteOptions,
  ):
    | Promise<AiRunLedgerWriteResult | { readonly status: "conflict"; readonly entry?: AiRunOperationRecord }>
    | AiRunLedgerWriteResult
    | { readonly status: "conflict"; readonly entry?: AiRunOperationRecord };
}

export interface AiRunReceiptInput {
  readonly runId: string;
  readonly actionId: string;
  readonly stepIndex: number;
  readonly receipt: CommitReceipt;
}

export interface AiRunRollbackInput {
  readonly runId: string;
  readonly requestId: string;
  readonly status: AiRunRollbackStatus;
}

export type AiRunLedgerErrorCode =
  | "INVALID_RUN"
  | "INVALID_ACTION"
  | "INVALID_STEP"
  | "INVALID_RECEIPT"
  | "IDENTITY_CONFLICT"
  | "STATUS_REGRESSION"
  | "RECONCILIATION_REQUIRED"
  | "UNKNOWN_OPERATION"
  | "ROLLBACK_CONFLICT"
  | "STORE_CONFLICT";

export class AiRunLedgerError extends Error {
  readonly code: AiRunLedgerErrorCode;
  readonly entry?: AiRunOperationRecord;

  constructor(code: AiRunLedgerErrorCode, message: string, entry?: AiRunOperationRecord) {
    super(message);
    this.name = "AiRunLedgerError";
    this.code = code;
    this.entry = entry;
  }
}

const receiptRanks: Record<AiRunReceiptStatus, number> = {
  rejected: 0,
  committed: 1,
  durable: 2,
  replicating: 3,
  replicated: 4,
  "outcome-unknown": -1,
};

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validStep(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Deep-copies ledger records so callers can never mutate stored state. `structuredClone` is part
 * of every supported runtime (Node.js >= 22 and evergreen browsers), so no JSON round-trip
 * fallback is needed.
 */
function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sameEntry(left: AiRunOperationRecord, right: AiRunOperationRecord): boolean {
  return (
    left.runId === right.runId &&
    left.requestId === right.requestId &&
    left.documentId === right.documentId &&
    left.actionId === right.actionId &&
    left.stepIndex === right.stepIndex &&
    left.status === right.status &&
    left.operationId === right.operationId &&
    left.transactionId === right.transactionId &&
    left.replicaId === right.replicaId &&
    left.rollbackStatus === right.rollbackStatus &&
    stableJson(left.receipt) === stableJson(right.receipt)
  );
}

function extractOperationId(receipt: CommitReceipt): string | undefined {
  return "operationId" in receipt && typeof receipt.operationId === "string" ? receipt.operationId : undefined;
}

function extractTransactionId(receipt: CommitReceipt): string | undefined {
  return "transactionId" in receipt && typeof receipt.transactionId === "string" ? receipt.transactionId : undefined;
}

function extractReplicaId(receipt: CommitReceipt): string | undefined {
  return "replicaId" in receipt && typeof receipt.replicaId === "string" ? receipt.replicaId : undefined;
}

function disposition(entry: AiRunOperationRecord): AiRunLedgerDisposition {
  if (entry.rollbackStatus === "rolled-back") return "rolled-back";
  if (entry.rollbackStatus === "outcome-unknown") return "rollback-unknown";
  if (entry.status === "outcome-unknown") return "reconciliation-required";
  if (entry.status === "durable" || entry.status === "replicating" || entry.status === "replicated") {
    return entry.operationId ? "rollback-eligible" : "not-durable";
  }
  return "not-durable";
}

function makeEntry(input: AiRunReceiptInput, now: string): AiRunOperationRecord {
  if (!nonBlank(input.runId)) throw new AiRunLedgerError("INVALID_RUN", "AI runId is required");
  if (!nonBlank(input.actionId)) throw new AiRunLedgerError("INVALID_ACTION", "AI actionId is required");
  if (!validStep(input.stepIndex)) {
    throw new AiRunLedgerError("INVALID_STEP", "AI stepIndex must be a non-negative safe integer");
  }
  if (!isCommitReceipt(input.receipt)) {
    throw new AiRunLedgerError("INVALID_RECEIPT", "Host returned an invalid commit receipt");
  }
  const receipt = cloneJson(input.receipt);
  const opId = extractOperationId(receipt);
  const txId = extractTransactionId(receipt);
  const repId = extractReplicaId(receipt);
  return {
    runId: input.runId.trim(),
    requestId: receipt.requestId,
    documentId: receipt.documentId,
    actionId: input.actionId.trim(),
    stepIndex: input.stepIndex,
    status: receipt.status,
    ...(opId ? { operationId: opId } : {}),
    ...(txId ? { transactionId: txId } : {}),
    ...(repId ? { replicaId: repId } : {}),
    receipt,
    recordedAt: now,
    updatedAt: now,
  };
}

function assertReceiptIdentity(
  existing: AiRunOperationRecord,
  incoming: AiRunOperationRecord,
  allowUnknownBinding: boolean,
): void {
  if (
    existing.runId !== incoming.runId ||
    existing.requestId !== incoming.requestId ||
    existing.documentId !== incoming.documentId ||
    existing.actionId !== incoming.actionId ||
    existing.stepIndex !== incoming.stepIndex
  ) {
    throw new AiRunLedgerError("IDENTITY_CONFLICT", "AI run receipt identity changed", existing);
  }
  const exactIdentity = existing.status !== "outcome-unknown" || !allowUnknownBinding;
  if (exactIdentity && existing.operationId !== incoming.operationId) {
    throw new AiRunLedgerError("IDENTITY_CONFLICT", "AI request resolved to two operation IDs", existing);
  }
  if (exactIdentity && existing.transactionId !== incoming.transactionId) {
    throw new AiRunLedgerError("IDENTITY_CONFLICT", "AI request resolved to two transaction IDs", existing);
  }
  if (exactIdentity && existing.replicaId !== incoming.replicaId) {
    throw new AiRunLedgerError("IDENTITY_CONFLICT", "AI request resolved to two replica IDs", existing);
  }
}

function assertProgression(
  existing: AiRunOperationRecord,
  incoming: AiRunOperationRecord,
  reconciliation: boolean,
): void {
  if (existing.status === "outcome-unknown" && !reconciliation) {
    throw new AiRunLedgerError(
      "RECONCILIATION_REQUIRED",
      "Outcome is unknown; reconcile the durable receipt before retrying",
      existing,
    );
  }
  assertReceiptIdentity(existing, incoming, reconciliation);
  if (sameEntry(existing, incoming)) return;
  if (existing.status === "rejected") {
    throw new AiRunLedgerError("STATUS_REGRESSION", "A rejected AI request is terminal", existing);
  }
  if (incoming.status === "outcome-unknown" && existing.status !== "outcome-unknown") {
    throw new AiRunLedgerError(
      "STATUS_REGRESSION",
      "A durable receipt cannot regress to outcome-unknown",
      existing,
    );
  }
  if (
    existing.status !== "outcome-unknown" &&
    incoming.status !== "outcome-unknown" &&
    receiptRanks[incoming.status] < receiptRanks[existing.status]
  ) {
    throw new AiRunLedgerError("STATUS_REGRESSION", "AI receipt status regressed", existing);
  }
}

function errorForStoreConflict(result: { readonly entry?: AiRunOperationRecord }): AiRunLedgerError {
  return new AiRunLedgerError("STORE_CONFLICT", "Durable AI run ledger rejected a conflicting row", result.entry);
}

export class AiRunLedger {
  private readonly now: () => string;

  constructor(private readonly store: AiRunLedgerStore, now: () => Date = () => new Date()) {
    this.now = () => {
      const value = now();
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw new Error("AI ledger clock returned an invalid date");
      }
      return value.toISOString();
    };
  }

  async recordReceipt(input: AiRunReceiptInput): Promise<AiRunLedgerWriteResult> {
    return this.write(makeEntry(input, this.now()), false);
  }

  async reconcileReceipt(input: AiRunReceiptInput): Promise<AiRunLedgerWriteResult> {
    const entry = makeEntry(input, this.now());
    const existing = await this.store.find(entry.runId, entry.requestId);
    if (!existing) {
      throw new AiRunLedgerError("RECONCILIATION_REQUIRED", "No unknown receipt exists for reconciliation");
    }
    if (existing.status !== "outcome-unknown") {
      throw new AiRunLedgerError(
        "RECONCILIATION_REQUIRED",
        "Only an outcome-unknown receipt can be reconciled",
        existing,
      );
    }
    return this.write(entry, true, existing);
  }

  async find(runId: string, requestId: string): Promise<AiRunOperationRecord | null> {
    if (!nonBlank(runId) || !nonBlank(requestId)) return null;
    const entry = await this.store.find(runId.trim(), requestId.trim());
    return entry ? cloneJson(entry) : null;
  }

  async list(runId: string): Promise<readonly AiRunOperationRecord[]> {
    if (!nonBlank(runId)) throw new AiRunLedgerError("INVALID_RUN", "AI runId is required");
    return (await this.store.list(runId.trim())).map((entry) => cloneJson(entry));
  }

  async pendingReconciliation(runId: string): Promise<readonly AiRunOperationRecord[]> {
    return (await this.list(runId)).filter((entry) => entry.status === "outcome-unknown");
  }

  async rollbackCandidates(runId: string): Promise<readonly string[]> {
    const entries = await this.list(runId);
    return entries
      .filter((entry) => disposition(entry) === "rollback-eligible" && Boolean(entry.operationId))
      .sort((left, right) => right.stepIndex - left.stepIndex || right.updatedAt.localeCompare(left.updatedAt))
      .map((entry) => entry.operationId!);
  }

  async recordRollback(input: AiRunRollbackInput): Promise<AiRunLedgerWriteResult> {
    if (!nonBlank(input.runId) || !nonBlank(input.requestId)) {
      throw new AiRunLedgerError("INVALID_RUN", "AI runId and requestId are required");
    }
    const existing = await this.store.find(input.runId.trim(), input.requestId.trim());
    if (!existing) throw new AiRunLedgerError("UNKNOWN_OPERATION", "Cannot record rollback for an unknown AI operation");
    if (!existing.operationId) {
      throw new AiRunLedgerError("ROLLBACK_CONFLICT", "AI operation has no durable operationId", existing);
    }
    if (existing.status === "outcome-unknown") {
      throw new AiRunLedgerError("RECONCILIATION_REQUIRED", "Reconcile the AI operation before rollback", existing);
    }
    if (existing.rollbackStatus === "rolled-back" || existing.rollbackStatus === "outcome-unknown") {
      if (existing.rollbackStatus === input.status) return { status: "duplicate", entry: cloneJson(existing) };
      throw new AiRunLedgerError("ROLLBACK_CONFLICT", "A terminal rollback result cannot be replaced", existing);
    }
    const entry: AiRunOperationRecord = {
      ...existing,
      updatedAt: this.now(),
      rollbackStatus: input.status,
      rollbackUpdatedAt: this.now(),
    };
    const result = await this.store.appendIdempotent(entry, {
      expectedUpdatedAt: existing.updatedAt,
      expectedEntry: existing,
    });
    if (result.status === "conflict") throw errorForStoreConflict(result);
    return { status: result.status, entry: cloneJson(result.entry) };
  }

  private async write(
    entry: AiRunOperationRecord,
    reconciliation: boolean,
    known?: AiRunOperationRecord,
  ): Promise<AiRunLedgerWriteResult> {
    const existing = known ?? (await this.store.find(entry.runId, entry.requestId));
    const sameRun = await this.store.list(entry.runId);
    const duplicateOperation = sameRun.find(
      (candidate) =>
        candidate.requestId !== entry.requestId &&
        candidate.operationId !== undefined &&
        candidate.operationId === entry.operationId,
    );
    if (entry.operationId && duplicateOperation) {
      throw new AiRunLedgerError(
        "IDENTITY_CONFLICT",
        "An operation ID cannot belong to two AI requests",
        duplicateOperation,
      );
    }
    if (existing) {
      assertProgression(existing, entry, reconciliation);
      if (sameEntry(existing, entry)) return { status: "duplicate", entry: cloneJson(existing) };
      entry = {
        ...entry,
        recordedAt: existing.recordedAt,
        updatedAt: this.now(),
        ...(existing.rollbackStatus
          ? { rollbackStatus: existing.rollbackStatus, rollbackUpdatedAt: existing.rollbackUpdatedAt }
          : {}),
      };
    }
    const result = await this.store.appendIdempotent(entry, {
      ...(existing ? { expectedUpdatedAt: existing.updatedAt, expectedEntry: existing } : {}),
      ...(reconciliation ? { allowOutcomeUnknownResolution: true } : {}),
    });
    if (result.status === "conflict") throw errorForStoreConflict(result);
    return { status: result.status, entry: cloneJson(result.entry) };
  }
}

export class InMemoryAiRunLedgerStore implements AiRunLedgerStore {
  private readonly rows = new Map<string, AiRunOperationRecord>();

  private key(runId: string, requestId: string): string {
    return `${runId}\u0000${requestId}`;
  }

  find(runId: string, requestId: string): AiRunOperationRecord | null {
    const value = this.rows.get(this.key(runId, requestId));
    return value ? cloneJson(value) : null;
  }

  list(runId: string): readonly AiRunOperationRecord[] {
    return [...this.rows.values()].filter((row) => row.runId === runId).map(cloneJson);
  }

  appendIdempotent(
    entry: AiRunOperationRecord,
    options: AiRunLedgerWriteOptions = {},
  ): AiRunLedgerWriteResult | { readonly status: "conflict"; readonly entry?: AiRunOperationRecord } {
    const key = this.key(entry.runId, entry.requestId);
    const existing = this.rows.get(key);
    if (existing && existing.documentId !== entry.documentId) return { status: "conflict", entry: cloneJson(existing) };
    if (options.expectedEntry && (!existing || stableJson(existing) !== stableJson(options.expectedEntry))) {
      return { status: "conflict", ...(existing ? { entry: cloneJson(existing) } : {}) };
    }
    if (existing && options.expectedUpdatedAt !== undefined && existing.updatedAt !== options.expectedUpdatedAt) {
      return { status: "conflict", entry: cloneJson(existing) };
    }
    if (
      existing &&
      existing.status === "outcome-unknown" &&
      entry.status !== "outcome-unknown" &&
      !options.allowOutcomeUnknownResolution
    ) {
      return { status: "conflict", entry: cloneJson(existing) };
    }
    if (
      existing &&
      (existing.rollbackStatus === "rolled-back" || existing.rollbackStatus === "outcome-unknown") &&
      existing.rollbackStatus !== entry.rollbackStatus
    ) {
      return { status: "conflict", entry: cloneJson(existing) };
    }
    if (existing && entry.status === "outcome-unknown" && existing.status !== "outcome-unknown") {
      return { status: "conflict", entry: cloneJson(existing) };
    }
    if (existing && existing.status === "rejected") return { status: "conflict", entry: cloneJson(existing) };
    if (
      existing &&
      existing.status !== "outcome-unknown" &&
      entry.status !== "outcome-unknown" &&
      receiptRanks[entry.status] < receiptRanks[existing.status]
    ) {
      return { status: "conflict", entry: cloneJson(existing) };
    }
    if (existing && sameEntry(existing, entry)) return { status: "duplicate", entry: cloneJson(existing) };
    this.rows.set(key, cloneJson(entry));
    return { status: existing ? "updated" : "appended", entry: cloneJson(entry) };
  }
}

export function aiRunLedgerDisposition(entry: AiRunOperationRecord): AiRunLedgerDisposition {
  return disposition(entry);
}
