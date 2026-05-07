import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startHttpServer, type HttpServerHandle } from "../src/http-server.js";
import { OrchestratorRuntime } from "../src/runtime.js";

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  let body: unknown = undefined;
  if (res.headers.get("content-type")?.includes("application/json") === true) {
    body = await res.json().catch(() => undefined);
  }
  return { status: res.status, body };
}

describe("HTTP observability server", () => {
  let rt: OrchestratorRuntime;
  let handle: HttpServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    rt = new OrchestratorRuntime();
    rt.startedAt = Date.now();
    handle = await startHttpServer(rt, { host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;
  });

  afterEach(async () => {
    await handle.close();
  });

  it("GET /healthz returns 200 ok=true while alive", async () => {
    const r = await fetchJson(`${baseUrl}/healthz`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, shuttingDown: false });
  });

  it("GET /healthz returns 503 ok=false once shuttingDown is set", async () => {
    rt.shuttingDown = true;
    const r = await fetchJson(`${baseUrl}/healthz`);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ ok: false, shuttingDown: true });
  });

  it("GET /state returns metrics + in-flight snapshot", async () => {
    rt.metrics.totalDispatched = 7;
    rt.metrics.totalSucceeded = 5;
    rt.metrics.tokens.total = 1234;
    rt.inFlight.set("42", {
      issue: {
        id: "42",
        iid: "42",
        title: "Fix things",
        description: "",
        labels: [],
        url: "http://x/42",
        state: "opened",
        authorUsername: undefined,
        updatedAt: new Date().toISOString(),
      },
      agentName: "echo",
      startedAt: Date.now() - 100,
      turnNumber: 2,
      attempt: 1,
    });

    const r = await fetchJson(`${baseUrl}/state`);
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect((body.metrics as Record<string, number>).totalDispatched).toBe(7);
    expect((body.metrics as Record<string, number>).totalSucceeded).toBe(5);
    expect(body.inFlight).toEqual([
      expect.objectContaining({
        issueId: "42",
        issueIid: "42",
        title: "Fix things",
        agent: "echo",
        turnNumber: 2,
        attempt: 1,
      }),
    ]);
  });

  it("GET /issues/:iid returns 404 when no in-flight worker matches", async () => {
    const r = await fetchJson(`${baseUrl}/issues/999`);
    expect(r.status).toBe(404);
  });

  it("GET /issues/:iid returns the matching in-flight snapshot", async () => {
    rt.inFlight.set("123", {
      issue: {
        id: "123",
        iid: "123",
        title: "T",
        description: "",
        labels: [],
        url: "http://x/123",
        state: "opened",
        authorUsername: undefined,
        updatedAt: new Date().toISOString(),
      },
      agentName: "claude",
      startedAt: Date.now(),
      turnNumber: 1,
      attempt: 1,
    });
    const r = await fetchJson(`${baseUrl}/issues/123`);
    expect(r.status).toBe(200);
    expect((r.body as Record<string, unknown>).agent).toBe("claude");
  });

  it("rejects POST with 405", async () => {
    const r = await fetchJson(`${baseUrl}/state`, { method: "POST" });
    expect(r.status).toBe(405);
  });

  it("GET /issues/:iid/history returns the appended ring buffer", async () => {
    rt.appendHistory("55", {
      at: 1_000,
      turnNumber: 1,
      attempt: 1,
      status: "succeeded",
      durationMs: 250,
      agent: "echo",
      summarySnippet: "first turn",
    });
    rt.appendHistory("55", {
      at: 2_000,
      turnNumber: 2,
      attempt: 1,
      status: "failed",
      durationMs: 400,
      agent: "echo",
      summarySnippet: "second turn",
    });

    const r = await fetchJson(`${baseUrl}/issues/55/history`);
    expect(r.status).toBe(200);
    const body = r.body as { iid: string; entries: ReadonlyArray<Record<string, unknown>> };
    expect(body.iid).toBe("55");
    expect(body.entries.length).toBe(2);
    expect(body.entries[0]?.turnNumber).toBe(1);
    expect(body.entries[1]?.status).toBe("failed");
  });

  it("GET /issues/:iid/history returns empty entries when none recorded", async () => {
    const r = await fetchJson(`${baseUrl}/issues/never-seen/history`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ iid: "never-seen", entries: [] });
  });
});

describe("HTTP server auth", () => {
  let rt: OrchestratorRuntime;
  let handle: HttpServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    rt = new OrchestratorRuntime();
    rt.startedAt = Date.now();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      authToken: "secret-token-1234",
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;
  });
  afterEach(async () => {
    await handle.close();
  });

  it("/healthz remains unauthenticated", async () => {
    const r = await fetchJson(`${baseUrl}/healthz`);
    expect(r.status).toBe(200);
  });

  it("/state requires Authorization: Bearer <token>", async () => {
    const r = await fetchJson(`${baseUrl}/state`);
    expect(r.status).toBe(401);
  });

  it("/state accepts the correct bearer token", async () => {
    const r = await fetchJson(`${baseUrl}/state`, {
      headers: { Authorization: "Bearer secret-token-1234" },
    });
    expect(r.status).toBe(200);
  });

  it("/state rejects a wrong-length token (constant-time guard)", async () => {
    const r = await fetchJson(`${baseUrl}/state`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(r.status).toBe(401);
  });
});
