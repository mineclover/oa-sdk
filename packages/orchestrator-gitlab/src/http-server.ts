import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { GitlabContextKind, GitlabContextSearchQuery, GitlabContextSearchService } from "./context-search.js";
import type { GitlabDocumentSaveInput, GitlabDocumentSaveService } from "./document-save.js";
import type { GitlabIssueTaskService } from "./issue-tasks.js";
import type { OrchestratorRuntime } from "./runtime.js";
import { snapshot } from "./runtime.js";

export interface HttpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly authToken?: string;
  readonly documentSave?: GitlabDocumentSaveService;
  readonly contextSearch?: Pick<GitlabContextSearchService, "searchDetailed">;
  readonly issueTasks?: Pick<GitlabIssueTaskService, "getIssueTasks" | "addIssueTask" | "updateIssueTask" | "deleteIssueTask">;
}

export interface HttpServerHandle {
  /** Resolved bound port. Useful for tests with `port: 0`. */
  readonly port: number;
  close(): Promise<void>;
}

const ISSUE_PATH_RE = /^\/issues\/([^/?#]+)\/?$/;
const ISSUE_HISTORY_PATH_RE = /^\/issues\/([^/?#]+)\/history\/?$/;
const ISSUE_TASKS_PATH_RE = /^\/issues\/([^/?#]+)\/tasks\/?$/;
const ISSUE_TASK_PATH_RE = /^\/issues\/([^/?#]+)\/tasks\/(\d+)\/?$/;
const DOCUMENT_SAVE_PATH = "/documents/save";
const CONTEXT_SEARCH_PATH = "/context/search";
const SEARCHABLE_CONTEXT_KINDS = new Set<GitlabContextKind>([
  "issue",
  "merge_request",
  "repo_file",
  "wiki_page",
  "snippet",
  "pipeline",
  "release",
  "label",
  "milestone",
  "board",
]);

/**
 * Start the orchestrator's observability HTTP server.
 *
 * Routes:
 *   - `GET /healthz` — `200 {ok:true}` while the orchestrator loop is alive,
 *     `503 {ok:false}` once shutdown begins. Always unauthenticated.
 *   - `GET /state`   — `200 RuntimeSnapshot` JSON.
 *   - `GET /issues/:iid` — `200 InFlightSnapshot` for the in-flight worker
 *     handling that IID, `404` if no such worker.
 *
 * `authToken` (when set) gates `/state` and `/issues/:iid` via
 * `Authorization: Bearer <token>`. `/healthz` stays public so external probes
 * (Kubernetes, load balancers, uptime monitors) work without secret rotation.
 *
 * Returns a handle whose `close()` shuts down the server and waits for
 * in-flight HTTP requests to drain. Long-running keep-alive sockets are forced
 * closed after a 1s grace period so shutdown stays bounded.
 */
export async function startHttpServer(
  rt: OrchestratorRuntime,
  opts: HttpServerOptions,
): Promise<HttpServerHandle> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(rt, opts, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: opts.host, port: opts.port });
  });

  const addr = server.address();
  const port = addr !== null && typeof addr === "object" ? addr.port : opts.port;

  return {
    port,
    close(): Promise<void> {
      return new Promise<void>((resolve) => {
        const grace = setTimeout(() => {
          // Force-close lingering keep-alive sockets so shutdown is bounded.
          server.closeAllConnections?.();
        }, 1_000);
        server.close(() => {
          clearTimeout(grace);
          resolve();
        });
      });
    },
  };
}

async function handleRequest(
  rt: OrchestratorRuntime,
  opts: HttpServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";

    if (path === DOCUMENT_SAVE_PATH && req.method === "POST") {
      if (opts.authToken !== undefined && !checkAuth(req.headers.authorization, opts.authToken)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      await handleDocumentSave(opts, req, res);
      return;
    }

    if (path === CONTEXT_SEARCH_PATH && req.method === "GET") {
      if (opts.authToken !== undefined && !checkAuth(req.headers.authorization, opts.authToken)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      await handleContextSearch(opts, req, res);
      return;
    }

    const issueTasksMatch = ISSUE_TASKS_PATH_RE.exec(path);
    if (issueTasksMatch !== null && (req.method === "GET" || req.method === "POST")) {
      if (opts.authToken !== undefined && !checkAuth(req.headers.authorization, opts.authToken)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      await handleIssueTasks(opts, issueTasksMatch[1] ?? "", req, res);
      return;
    }

    const issueTaskMatch = ISSUE_TASK_PATH_RE.exec(path);
    if (issueTaskMatch !== null && (req.method === "PATCH" || req.method === "DELETE")) {
      if (opts.authToken !== undefined && !checkAuth(req.headers.authorization, opts.authToken)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      await handleIssueTask(opts, issueTaskMatch[1] ?? "", Number.parseInt(issueTaskMatch[2] ?? "", 10), req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, { error: "method_not_allowed" });
      return;
    }

    if (path === "/healthz") {
      const alive = !rt.shuttingDown;
      send(res, alive ? 200 : 503, { ok: alive, shuttingDown: rt.shuttingDown });
      return;
    }

    if (opts.authToken !== undefined && !checkAuth(req.headers.authorization, opts.authToken)) {
      send(res, 401, { error: "unauthorized" });
      return;
    }

    if (path === "/state") {
      send(res, 200, snapshot(rt));
      return;
    }

    const historyMatch = ISSUE_HISTORY_PATH_RE.exec(path);
    if (historyMatch !== null) {
      const iid = decodeURIComponent(historyMatch[1] ?? "");
      // History is keyed by internal id, but for GitLab id===iid in our normalization.
      // Try both lookups for correctness when a custom Tracker uses different keys.
      const direct = rt.history.get(iid);
      let entries = direct;
      if (entries === undefined) {
        for (const [k, buf] of rt.history) {
          if (k === iid) {
            entries = buf;
            break;
          }
        }
      }
      send(res, 200, { iid, entries: entries ?? [] });
      return;
    }

    const issueMatch = ISSUE_PATH_RE.exec(path);
    if (issueMatch !== null) {
      const iid = decodeURIComponent(issueMatch[1] ?? "");
      const snap = snapshot(rt);
      const found = snap.inFlight.find((s) => s.issueIid === iid || s.issueId === iid);
      if (found === undefined) {
        send(res, 404, { error: "not_in_flight", iid });
        return;
      }
      send(res, 200, found);
      return;
    }

    send(res, 404, { error: "not_found", path });
  } catch (err) {
    send(res, 500, { error: "internal_error", message: err instanceof Error ? err.message : String(err) });
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function handleDocumentSave(
  opts: HttpServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (opts.documentSave === undefined) {
    send(res, 503, { error: "document_save_unavailable" });
    return;
  }
  const body = await readJsonBody(req);
  const input = parseDocumentSaveBody(body);
  const result = await opts.documentSave.save(input, { dryRun: body.dryRun !== false });
  send(res, 200, result);
}

async function handleContextSearch(
  opts: HttpServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (opts.contextSearch === undefined) {
    send(res, 503, { error: "context_search_unavailable" });
    return;
  }
  const query = parseContextSearchQuery(req.url ?? CONTEXT_SEARCH_PATH);
  const result = await opts.contextSearch.searchDetailed(query, { includeCapabilities: false });
  send(res, 200, result);
}

async function handleIssueTasks(
  opts: HttpServerOptions,
  encodedIid: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (opts.issueTasks === undefined) {
    send(res, 503, { error: "issue_tasks_unavailable" });
    return;
  }
  const iid = decodeURIComponent(encodedIid);
  const report = req.method === "POST"
    ? await opts.issueTasks.addIssueTask(iid, requiredString(await readJsonBody(req), "text"))
    : await opts.issueTasks.getIssueTasks(iid);
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.searchParams.get("remaining") === "true") {
    send(res, 200, {
      iid: report.iid,
      title: report.title,
      state: report.state,
      summary: report.summary,
      remainingTasks: report.remainingTasks,
    });
    return;
  }
  send(res, 200, report);
}

async function handleIssueTask(
  opts: HttpServerOptions,
  encodedIid: string,
  line: number,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (opts.issueTasks === undefined) {
    send(res, 503, { error: "issue_tasks_unavailable" });
    return;
  }
  const iid = decodeURIComponent(encodedIid);
  const report = req.method === "DELETE"
    ? await opts.issueTasks.deleteIssueTask(iid, line)
    : await opts.issueTasks.updateIssueTask(iid, line, parseTaskUpdateBody(await readJsonBody(req)));
  send(res, 200, report);
}

function parseContextSearchQuery(rawUrl: string): GitlabContextSearchQuery {
  const url = new URL(rawUrl, "http://127.0.0.1");
  const text = optionalSearchParam(url, "text");
  const state = parseSearchState(optionalSearchParam(url, "state"));
  const kinds = parseContextKinds(optionalSearchParam(url, "kinds"));
  const limit = parseLimit(optionalSearchParam(url, "limit"));

  return {
    ...(text !== undefined ? { text } : {}),
    ...(kinds !== undefined ? { kinds } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function parseSearchState(rawState: string | undefined): GitlabContextSearchQuery["state"] | undefined {
  if (rawState === undefined) return undefined;
  if (rawState !== "opened" && rawState !== "closed" && rawState !== "merged" && rawState !== "all") {
    throw new Error("state must be opened, closed, merged, or all");
  }
  return rawState;
}

function optionalSearchParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  if (value === null || value.trim().length === 0) return undefined;
  return value.trim();
}

function parseContextKinds(rawKinds: string | undefined): ReadonlyArray<GitlabContextKind> | undefined {
  if (rawKinds === undefined) return undefined;
  const kinds = rawKinds.split(",").map((kind) => kind.trim()).filter((kind) => kind.length > 0);
  if (kinds.length === 0) return undefined;
  for (const kind of kinds) {
    if (!SEARCHABLE_CONTEXT_KINDS.has(kind as GitlabContextKind)) {
      throw new Error(`unsupported context search kind: ${kind}`);
    }
  }
  return kinds as ReadonlyArray<GitlabContextKind>;
}

function parseLimit(rawLimit: string | undefined): number | undefined {
  if (rawLimit === undefined) return undefined;
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return limit;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function parseDocumentSaveBody(body: Record<string, unknown>): GitlabDocumentSaveInput {
  const target = requiredString(body, "target");
  if (target !== "wiki" && target !== "repository" && target !== "release") {
    throw new Error("target must be wiki, repository, or release");
  }
  const mode = optionalString(body, "mode");
  if (mode !== undefined && mode !== "create" && mode !== "update") {
    throw new Error("mode must be create or update");
  }
  const input: GitlabDocumentSaveInput = {
    target,
    path: requiredString(body, "path"),
    title: requiredString(body, "title"),
    markdown: requiredString(body, "markdown"),
  };
  if (mode !== undefined) {
    const branch = optionalString(body, "branch");
    return branch === undefined ? { ...input, mode } : { ...input, mode, branch };
  }
  const branch = optionalString(body, "branch");
  return branch === undefined ? input : { ...input, branch };
}

function parseTaskUpdateBody(body: Record<string, unknown>) {
  const text = optionalString(body, "text");
  const checked = optionalBoolean(body, "checked");
  const inapplicable = optionalBoolean(body, "inapplicable");
  if (text === undefined && checked === undefined && inapplicable === undefined) {
    throw new Error("task update must include text, checked, or inapplicable");
  }
  return {
    ...(text !== undefined ? { text } : {}),
    ...(checked !== undefined ? { checked } : {}),
    ...(inapplicable !== undefined ? { inapplicable } : {}),
  };
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string when provided`);
  }
  return value;
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean when provided`);
  }
  return value;
}

function checkAuth(authHeader: string | undefined, expected: string): boolean {
  if (authHeader === undefined) return false;
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (m === null) return false;
  const provided = m[1] ?? "";
  // Constant-time comparison.
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
