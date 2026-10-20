/**
 * Wire helpers for the provider's `tools/call` handling: JSON-RPC ids, the agent's
 * `_meta.framebook.aiTrace` metadata, and the conversion of a host tool's return value into the
 * MCP CallToolResult sent back to the agent.
 */
import { peerRpcError } from "../config/errors.js";
import { isJsonObject } from "../config/json.js";
import { PEER_RELAY_MAX_MESSAGE_BYTES, utf8ByteLength } from "../config/limits.js";
import type { AiRunPhase } from "./ai-run-controller.js";

export type JsonRpcId = string | number | null;

/** A JSON-RPC 2.0 response the provider returns through the relay or the DataChannel. */
export interface ProviderRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

/** One MCP content block. */
interface McpContentBlock {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** What the provider learned from one host tool invocation. */
export interface HostToolOutcome {
  /** The MCP CallToolResult returned to the agent. */
  readonly result: Record<string, unknown>;
  readonly failed: boolean;
  readonly failureMessage: string;
  /** The payload's `receipt` member, still unvalidated. */
  readonly receipt: unknown;
}

const MCP_CONTENT_TYPES: ReadonlySet<string> = new Set(["text", "image", "audio", "resource_link", "resource"]);

/**
 * The largest WebSocket message the provider can send the relay: the relay protocol's message
 * limit ({@link PEER_RELAY_MAX_MESSAGE_BYTES}, `MAX_WEBSOCKET_MESSAGE_BYTES` in `./server`). The
 * relay closes a socket that sends more (close code 1009), and a closed provider socket drops every
 * agent of the room, so the provider measures every frame it sends on the relay socket against it
 * and sends none that is larger. A reply too large to send is replaced by a RESULT_TOO_LARGE error
 * (see {@link encodeRelayMcpReply}); a `register` catalog has the stricter `PEER_RELAY_MAX_CATALOG_BYTES`
 * budget and is withheld with CATALOG_TOO_LARGE past it; any other frame is dropped with a warning.
 */
export const RELAY_MAX_MESSAGE_BYTES = PEER_RELAY_MAX_MESSAGE_BYTES;

/**
 * Payload JSON up to this size is repeated as a `text` content block for clients that read only
 * `content`. A larger payload gets a short text block that points at `structuredContent`, so a
 * result never carries more than two full copies of its payload (`structuredContent` and the
 * legacy `data` mirror).
 */
export const MAX_PAYLOAD_TEXT_BLOCK_BYTES = 16 * 1024;

const AI_RUN_PHASES: ReadonlySet<string> = new Set<AiRunPhase>([
  "queued",
  "running",
  "paused",
  "stopped",
  "completed",
  "failed",
  "rolled-back",
]);

export function isAiRunPhase(value: unknown): value is AiRunPhase {
  return typeof value === "string" && AI_RUN_PHASES.has(value);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : typeof error === "string" && error ? error : fallback;
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** The id of a JSON-RPC request; undefined for a notification or a value that is not a request. */
export function rpcRequestId(value: unknown): JsonRpcId | undefined {
  if (!isJsonObject(value) || value.jsonrpc !== "2.0") return undefined;
  const id = value.id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : undefined;
}

/** `params._meta.framebook.aiTrace` of a tools/call, when present. */
export function readAiTrace(meta: unknown): Record<string, unknown> | undefined {
  if (!isJsonObject(meta)) return undefined;
  const framebook = meta.framebook;
  if (!isJsonObject(framebook)) return undefined;
  return isJsonObject(framebook.aiTrace) ? framebook.aiTrace : undefined;
}

/** The run id an agent named in its trace (trimmed, at most 128 characters). */
export function traceRunId(trace: Record<string, unknown> | undefined): string | undefined {
  const runId = typeof trace?.runId === "string" ? trace.runId.trim() : "";
  return runId && runId.length <= 128 ? runId : undefined;
}

export function traceStepIndex(trace: Record<string, unknown> | undefined): number | undefined {
  const stepIndex = trace?.stepIndex;
  return typeof stepIndex === "number" && Number.isSafeInteger(stepIndex) && stepIndex >= 0 ? stepIndex : undefined;
}

function isMcpContentBlock(value: unknown): value is McpContentBlock {
  return isJsonObject(value) && typeof value.type === "string" && MCP_CONTENT_TYPES.has(value.type);
}

function isMcpContentList(value: unknown): value is McpContentBlock[] {
  return Array.isArray(value) && value.length > 0 && value.every(isMcpContentBlock);
}

/**
 * True when a host already returned an MCP CallToolResult: a non-empty list of MCP content blocks,
 * an object `structuredContent`, or a boolean `isError`. A domain object that merely has a
 * `content` member (`{ ok: true, content: "doc text" }`) is not one.
 */
function isCallToolResult(value: Record<string, unknown>): boolean {
  return isMcpContentList(value.content) || isJsonObject(value.structuredContent) || typeof value.isError === "boolean";
}

/** The payload a host tool returned: a CallToolResult's `structuredContent`, or the value itself. */
export function hostPayload(res: unknown): Record<string, unknown> {
  if (isJsonObject(res) && isCallToolResult(res)) {
    return isJsonObject(res.structuredContent) ? res.structuredContent : {};
  }
  return isJsonObject(res) ? res : { value: res };
}

function reportsNotOk(value: unknown): boolean {
  return isJsonObject(value) && "ok" in value && !value.ok;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function textBlock(text: string): McpContentBlock {
  return { type: "text", text };
}

/** The payload as a JSON text block, or a pointer to `structuredContent` when that is too large. */
function payloadTextBlock(payload: unknown): McpContentBlock {
  const json = jsonText(payload);
  // UTF-8 never takes fewer bytes than UTF-16 code units, so a long string is over budget as is.
  if (json.length <= MAX_PAYLOAD_TEXT_BLOCK_BYTES && utf8ByteLength(json) <= MAX_PAYLOAD_TEXT_BLOCK_BYTES) {
    return textBlock(json);
  }
  return textBlock(`The result is too large to repeat as text (${json.length} characters of JSON); read it from structuredContent.`);
}

function payloadErrorMessage(payload: Record<string, unknown>): string | undefined {
  const error = payload.error;
  return isJsonObject(error) ? nonEmptyString(error.message) : undefined;
}

function firstText(content: readonly McpContentBlock[]): string | undefined {
  for (const block of content) {
    if (block.type === "text") {
      const text = nonEmptyString(block.text);
      if (text) return text;
    }
  }
  return undefined;
}

/**
 * Turns a host tool's return value into the CallToolResult sent to the agent. A host that already
 * returns a CallToolResult keeps its content blocks and `isError`; any other value becomes the
 * payload, published as `structuredContent` (and the legacy `data` mirror) plus a JSON text block,
 * as MCP recommends for structured results. The text block repeats the payload only up to
 * {@link MAX_PAYLOAD_TEXT_BLOCK_BYTES}; past that it points at `structuredContent`. Either way a
 * failure is `isError: true`, whether the host said so with `isError` or with `{ ok: false }`.
 */
export function interpretHostResult(res: unknown): HostToolOutcome {
  const payload = hostPayload(res);
  if (isJsonObject(res) && isCallToolResult(res)) {
    const failed = res.isError === true || reportsNotOk(res) || reportsNotOk(payload);
    const content = isMcpContentList(res.content) ? res.content : [payloadTextBlock(payload)];
    return {
      result: { ...res, content, isError: failed },
      failed,
      failureMessage: payloadErrorMessage(payload) ?? firstText(content) ?? "Tool call failed",
      receipt: "receipt" in payload ? payload.receipt : res.receipt,
    };
  }
  const failed = reportsNotOk(payload);
  return {
    result: { content: [payloadTextBlock(payload)], structuredContent: payload, data: payload, isError: failed },
    failed,
    failureMessage: payloadErrorMessage(payload) ?? "Tool call failed",
    receipt: payload.receipt,
  };
}

/** A failed tools/call result, readable both by stock MCP clients (`content`) and by this SDK. */
export function toolErrorResult(error: { readonly code: string | number; readonly message: string }): Record<string, unknown> {
  const failure = { ok: false, error };
  return {
    isError: true,
    content: [textBlock(typeof error.code === "string" ? `${error.code}: ${error.message}` : error.message)],
    structuredContent: failure,
    data: failure,
    error,
  };
}

/** A serialized `{ type: "mcp", message }` reply for the relay WebSocket. */
export interface RelayMcpReply {
  /** The frame to send; undefined when not even the replacement error fits the limit. */
  readonly frame: string | undefined;
  /** The original reply's size, when it was over the limit and was replaced. */
  readonly oversizeBytes?: number;
}

/**
 * Serializes a reply to a relayed request for the relay WebSocket. A reply over `maxBytes` would
 * make the relay close the provider socket, so it is replaced by a small error the agent can read:
 * for tools/call an `isError` result with code RESULT_TOO_LARGE (the tool did run; only its result
 * is lost), for any other method the JSON-RPC error RESULT_TOO_LARGE with the limit as
 * `data.limitBytes`, as the relay sends it.
 */
export function encodeRelayMcpReply(
  request: unknown,
  response: ProviderRpcResponse,
  maxBytes = RELAY_MAX_MESSAGE_BYTES,
): RelayMcpReply {
  const frame = JSON.stringify({ type: "mcp", message: response });
  const bytes = utf8ByteLength(frame);
  if (bytes <= maxBytes) return { frame };
  const params = isJsonObject(request) && isJsonObject(request.params) ? request.params : undefined;
  const isToolCall = isJsonObject(request) && request.method === "tools/call" && response.result !== undefined;
  const limit = `${bytes} bytes, over the relay's ${maxBytes}-byte message limit`;
  const replacement: ProviderRpcResponse = isToolCall
    ? {
        jsonrpc: "2.0",
        id: response.id,
        result: toolErrorResult({
          code: "RESULT_TOO_LARGE",
          message: `The result of tool "${nonEmptyString(params?.name) ?? "unknown"}" is ${limit}; the tool ran but its result was not delivered`,
        }),
      }
    : { jsonrpc: "2.0", id: response.id, error: peerRpcError("RESULT_TOO_LARGE", { limitBytes: maxBytes }) };
  const fallback = JSON.stringify({ type: "mcp", message: replacement });
  return { frame: utf8ByteLength(fallback) <= maxBytes ? fallback : undefined, oversizeBytes: bytes };
}
