import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { OrchestratorRuntime } from "./runtime.js";
import { snapshot } from "./runtime.js";

export interface HttpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly authToken?: string;
}

export interface HttpServerHandle {
  /** Resolved bound port. Useful for tests with `port: 0`. */
  readonly port: number;
  close(): Promise<void>;
}

const ISSUE_PATH_RE = /^\/issues\/([^/?#]+)\/?$/;
const ISSUE_HISTORY_PATH_RE = /^\/issues\/([^/?#]+)\/history\/?$/;

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
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";

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
