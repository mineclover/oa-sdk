import { assertNoPrototypePoisoning, type RuntimeChunkEnvelope } from "@oa-sdk/chunk-stream";
import type { ContentPort, JsonValue, UiAction, UiActionConsumeResult } from "./types.js";

function isJsonValue(val: unknown): val is JsonValue {
  if (val === null || typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return true;
  }
  if (Array.isArray(val)) {
    return val.every(isJsonValue);
  }
  if (typeof val === "object") {
    try {
      assertNoPrototypePoisoning(val);
    } catch {
      return false;
    }
    return Object.values(val as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

function asActions(data: JsonValue): UiAction[] {
  const values = Array.isArray(data) ? data : [data];
  const actions: UiAction[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Record<string, JsonValue>;
    if (
      candidate.type !== "ui-action@v1" ||
      typeof candidate.name !== "string" ||
      candidate.name.trim().length === 0
    ) {
      continue;
    }
    const action: UiAction = {
      type: "ui-action@v1",
      name: candidate.name,
      target: candidate.target,
      payload: candidate.payload,
    };
    assertNoPrototypePoisoning(action);
    actions.push(action);
  }
  return actions;
}

/** Convert a sanitized runtime envelope into data-only Scene operations. */
export class UiActionAdapter {
  private readonly port: ContentPort;
  private readonly streamId?: string | undefined;

  constructor(port: ContentPort, options: { readonly streamId?: string | undefined } = {}) {
    this.port = port;
    this.streamId = options.streamId;
  }

  async consume(envelope: RuntimeChunkEnvelope): Promise<UiActionConsumeResult> {
    if (this.streamId !== undefined && envelope.streamId !== this.streamId) {
      return { accepted: false, reason: "content-rejected", operations: [] };
    }
    if (envelope.payloadFormat !== "ui-action@v1") {
      return { accepted: false, reason: "wrong-format", operations: [] };
    }
    if (!isJsonValue(envelope.data)) {
      return { accepted: false, reason: "invalid-action", operations: [] };
    }
    const actions = asActions(envelope.data);
    if (!actions.length) {
      return { accepted: false, reason: "invalid-action", operations: [] };
    }

    const operations: Array<Record<string, JsonValue>> = actions.map((action) => {
      const op: Record<string, JsonValue> = {
        type: "scene.action",
        name: action.name,
        sequence: envelope.sequence,
      };
      if (action.target !== undefined) op.target = action.target;
      if (action.payload !== undefined) op.payload = action.payload;
      return op;
    });

    // A multi-action chunk must cross an atomic bridge. Sequentially dispatching
    // the first action and then failing the second would leave the displayed
    // state half-applied, which violates the fail-closed runtime boundary.
    if (operations.length > 1 && !this.port.dispatchBatch) {
      return { accepted: false, reason: "atomic-required", operations: [] };
    }

    try {
      if (operations.length > 1) {
        await this.port.dispatchBatch!(operations);
      } else {
        await this.port.dispatch(operations[0]!);
      }
    } catch {
      return { accepted: false, reason: "content-rejected", operations };
    }

    return { accepted: true, operations };
  }
}
