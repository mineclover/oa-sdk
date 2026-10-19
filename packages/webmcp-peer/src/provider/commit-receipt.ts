export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type CommitReceipt =
  | {
      status: "rejected";
      requestId: string;
      documentId: string;
      errorCode: string;
      message: string;
    }
  | {
      status: "committed";
      requestId: string;
      documentId: string;
      transactionId: string;
    }
  /**
   * A durable commit that carries metadata only. It names no operation, so it is not
   * rollback-eligible, and carries none of the document-commit fields.
   */
  | {
      status: "durable";
      requestId: string;
      documentId: string;
      transactionId: string;
      committedAt: string;
      operationId?: never;
      replicaId?: never;
      partial?: never;
      appliedCommandCount?: never;
      requestedCommandCount?: never;
    }
  /**
   * A durable document commit: it names the operation and the replica that committed it, and may
   * report a partial application (`partial: true` requires `appliedCommandCount <
   * requestedCommandCount`).
   */
  | {
      status: "durable";
      requestId: string;
      documentId: string;
      transactionId: string;
      committedAt: string;
      operationId: string;
      replicaId: string;
      partial?: boolean;
      appliedCommandCount?: number;
      requestedCommandCount?: number;
    }
  | {
      status: "replicating";
      requestId: string;
      documentId: string;
      transactionId: string;
      operationId: string;
      replicaId: string;
      committedAt: string;
      queuedAt: string;
    }
  | {
      status: "replicated";
      requestId: string;
      documentId: string;
      transactionId: string;
      operationId: string;
      replicaId: string;
      committedAt: string;
      ackedBy: string[];
      replicatedAt: string;
    }
  | {
      status: "outcome-unknown";
      requestId: string;
      documentId: string;
      message: string;
      transactionId?: string;
      operationId?: string;
    };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = [...required, ...optional];
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string" || !allowed.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.prototype.hasOwnProperty.call(descriptor, "value");
    })
  );
}

function isAuthorityText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim().length > 0;
}

export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 19) === value.slice(0, 19);
}

function isNonEmptyArrayOf(value: unknown, predicate: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(predicate);
}

function hasReceiptBase(value: Record<string, unknown>): boolean {
  return isAuthorityText(value.requestId) && isAuthorityText(value.documentId);
}

function hasDurableFields(value: Record<string, unknown>): boolean {
  return (
    isAuthorityText(value.transactionId) &&
    isAuthorityText(value.operationId) &&
    isAuthorityText(value.replicaId) &&
    isUtcTimestamp(value.committedAt)
  );
}

function isCommandCount(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** The metadata-only `durable` member: exactly the five base keys. */
function isDurableMetadataReceipt(value: Record<string, unknown>): boolean {
  return (
    hasKeys(value, ["status", "requestId", "documentId", "transactionId", "committedAt"]) &&
    isAuthorityText(value.transactionId) &&
    isUtcTimestamp(value.committedAt)
  );
}

/** The document-commit `durable` member: operation and replica ids, optional partial counts. */
function isDurableDocumentReceipt(value: Record<string, unknown>): boolean {
  return (
    hasKeys(
      value,
      ["status", "requestId", "documentId", "transactionId", "committedAt", "operationId", "replicaId"],
      ["partial", "appliedCommandCount", "requestedCommandCount"],
    ) &&
    hasDurableFields(value) &&
    (value.partial === undefined || typeof value.partial === "boolean") &&
    isCommandCount(value.appliedCommandCount) &&
    isCommandCount(value.requestedCommandCount) &&
    (value.partial !== true ||
      (typeof value.appliedCommandCount === "number" &&
        typeof value.requestedCommandCount === "number" &&
        value.appliedCommandCount < value.requestedCommandCount))
  );
}

export function isCommitReceipt(value: unknown): value is CommitReceipt {
  if (!isPlainRecord(value) || !hasReceiptBase(value)) return false;
  switch (value.status) {
    case "rejected":
      return (
        hasKeys(value, ["status", "requestId", "documentId", "errorCode", "message"]) &&
        isAuthorityText(value.errorCode) &&
        isAuthorityText(value.message)
      );
    case "committed":
      return (
        hasKeys(value, ["status", "requestId", "documentId", "transactionId"]) &&
        isAuthorityText(value.transactionId)
      );
    case "durable":
      return isDurableMetadataReceipt(value) || isDurableDocumentReceipt(value);
    case "replicating":
      return (
        hasKeys(value, [
          "status",
          "requestId",
          "documentId",
          "transactionId",
          "operationId",
          "replicaId",
          "committedAt",
          "queuedAt",
        ]) &&
        hasDurableFields(value) &&
        isUtcTimestamp(value.queuedAt) &&
        Date.parse(value.queuedAt) >= Date.parse(value.committedAt as string)
      );
    case "replicated":
      return (
        hasKeys(value, [
          "status",
          "requestId",
          "documentId",
          "transactionId",
          "operationId",
          "replicaId",
          "committedAt",
          "ackedBy",
          "replicatedAt",
        ]) &&
        hasDurableFields(value) &&
        isNonEmptyArrayOf(value.ackedBy, isAuthorityText) &&
        isUtcTimestamp(value.replicatedAt) &&
        Date.parse(value.replicatedAt) >= Date.parse(value.committedAt as string)
      );
    case "outcome-unknown":
      return (
        hasKeys(value, ["status", "requestId", "documentId", "message"], ["transactionId", "operationId"]) &&
        isAuthorityText(value.message) &&
        (value.transactionId === undefined || isAuthorityText(value.transactionId)) &&
        (value.operationId === undefined || isAuthorityText(value.operationId))
      );
    default:
      return false;
  }
}
