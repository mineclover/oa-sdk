import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startHttpServer, type HttpServerHandle } from "../src/http-server.js";
import { OrchestratorRuntime } from "../src/runtime.js";
import type { GitlabDocumentSaveInput } from "../src/document-save.js";
import type { GitlabContextSearchQuery } from "../src/context-search.js";
import type { GitlabIssueTaskReport } from "../src/issue-tasks.js";

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

describe("HTTP document save endpoint", () => {
  let rt: OrchestratorRuntime;
  let handle: HttpServerHandle;
  let baseUrl: string;

  afterEach(async () => {
    await handle.close();
  });

  it("returns 503 when document save is not configured", async () => {
    rt = new OrchestratorRuntime();
    handle = await startHttpServer(rt, { host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/documents/save`, {
      method: "POST",
      body: JSON.stringify({ target: "wiki", path: "wiki/a", title: "A", markdown: "# A" }),
    });

    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "document_save_unavailable" });
  });

  it("requires auth when authToken is configured", async () => {
    rt = new OrchestratorRuntime();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      authToken: "secret",
      documentSave: fakeDocumentSaveService(),
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/documents/save`, {
      method: "POST",
      body: JSON.stringify({ target: "wiki", path: "wiki/a", title: "A", markdown: "# A" }),
    });

    expect(r.status).toBe(401);
  });

  it("returns dry-run document save request by default", async () => {
    rt = new OrchestratorRuntime();
    const service = fakeDocumentSaveService();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      authToken: "secret",
      documentSave: service,
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/documents/save`, {
      method: "POST",
      headers: { Authorization: "Bearer secret" },
      body: JSON.stringify({ target: "repository", path: "docs/a.md", title: "A", markdown: "# A", branch: "docs/a" }),
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      dryRun: true,
      request: {
        method: "PUT",
        path: "/api/v4/projects/1/repository/files/docs%2Fa.md",
        body: {
          branch: "docs/a",
          content: "# A",
        },
      },
    });
    expect(service.calls).toEqual([
      {
        input: { target: "repository", path: "docs/a.md", title: "A", markdown: "# A", branch: "docs/a" },
        opts: { dryRun: true },
      },
    ]);
  });

  it("passes dryRun false through to document save service", async () => {
    rt = new OrchestratorRuntime();
    const service = fakeDocumentSaveService();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      documentSave: service,
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/documents/save`, {
      method: "POST",
      body: JSON.stringify({ target: "wiki", path: "wiki/a", title: "A", markdown: "# A", dryRun: false }),
    });

    expect(r.status).toBe(200);
    expect(service.calls[0]?.opts).toEqual({ dryRun: false });
  });
});

describe("HTTP context search endpoint", () => {
  let rt: OrchestratorRuntime;
  let handle: HttpServerHandle;
  let baseUrl: string;

  afterEach(async () => {
    await handle.close();
  });

  it("returns 503 when context search is not configured", async () => {
    rt = new OrchestratorRuntime();
    handle = await startHttpServer(rt, { host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/context/search?kinds=issue&text=release`);

    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "context_search_unavailable" });
  });

  it("requires auth when authToken is configured", async () => {
    rt = new OrchestratorRuntime();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      authToken: "secret",
      contextSearch: fakeContextSearchService(),
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/context/search?kinds=issue&text=release`);

    expect(r.status).toBe(401);
  });

  it("passes query filters to the context search service", async () => {
    rt = new OrchestratorRuntime();
    const service = fakeContextSearchService();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      contextSearch: service,
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/context/search?kinds=issue,merge_request&text=release&state=opened&limit=7`);

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      results: [
        {
          id: "gitlab://project/1/issues/123",
          kind: "issue",
          title: "Release blocker",
          metadata: { iid: 123, state: "opened" },
        },
      ],
      warnings: [],
    });
    expect(service.calls).toEqual([
      {
        query: {
          kinds: ["issue", "merge_request"],
          text: "release",
          state: "opened",
          limit: 7,
        },
        options: { includeCapabilities: false },
      },
    ]);
  });
});

describe("HTTP issue task endpoint", () => {
  let rt: OrchestratorRuntime;
  let handle: HttpServerHandle;
  let baseUrl: string;

  afterEach(async () => {
    await handle.close();
  });

  it("returns 503 when issue task service is not configured", async () => {
    rt = new OrchestratorRuntime();
    handle = await startHttpServer(rt, { host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/issues/42/tasks`);

    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "issue_tasks_unavailable" });
  });

  it("requires auth when authToken is configured", async () => {
    rt = new OrchestratorRuntime();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      authToken: "secret",
      issueTasks: fakeIssueTaskService(),
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/issues/42/tasks`);

    expect(r.status).toBe(401);
  });

  it("returns remaining issue tasks for a specific issue", async () => {
    rt = new OrchestratorRuntime();
    const service = fakeIssueTaskService();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      issueTasks: service,
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const r = await fetchJson(`${baseUrl}/issues/42/tasks?remaining=true`);

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      iid: "42",
      title: "Task issue",
      state: "opened",
      summary: { count: 2, completedCount: 1 },
      remainingTasks: [
        { line: 1, text: "write docs", marker: "[ ]", checked: false, inapplicable: false },
      ],
    });
    expect(service.calls).toEqual(["42"]);
  });

  it("creates, updates, and deletes tasks through issue task endpoints", async () => {
    rt = new OrchestratorRuntime();
    const service = fakeIssueTaskService();
    handle = await startHttpServer(rt, {
      host: "127.0.0.1",
      port: 0,
      issueTasks: service,
    });
    baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    expect((await fetchJson(`${baseUrl}/issues/42/tasks`, {
      method: "POST",
      body: JSON.stringify({ text: "new task" }),
    })).status).toBe(200);
    expect((await fetchJson(`${baseUrl}/issues/42/tasks/1`, {
      method: "PATCH",
      body: JSON.stringify({ checked: true, text: "write docs now" }),
    })).status).toBe(200);
    expect((await fetchJson(`${baseUrl}/issues/42/tasks/2`, { method: "DELETE" })).status).toBe(200);

    expect(service.calls).toEqual([
      "add:42:new task",
      "update:42:1:true:write docs now",
      "delete:42:2",
    ]);
  });
});

function fakeDocumentSaveService() {
  const calls: Array<{ input: GitlabDocumentSaveInput; opts: { dryRun?: boolean } }> = [];
  return {
    calls,
    async save(input: GitlabDocumentSaveInput, opts: { dryRun?: boolean }) {
      calls.push({ input, opts });
      return {
        dryRun: opts.dryRun === true,
        request: {
          method: "PUT" as const,
          path: input.target === "repository" ? "/api/v4/projects/1/repository/files/docs%2Fa.md" : "/api/v4/projects/1/wikis/a",
          body: input.target === "repository"
            ? { branch: input.branch ?? "main", content: input.markdown }
            : { title: input.title, content: input.markdown },
        },
      };
    },
  };
}

function fakeContextSearchService() {
  const calls: Array<{ query: GitlabContextSearchQuery; options: { includeCapabilities?: boolean } }> = [];
  return {
    calls,
    async searchDetailed(query: GitlabContextSearchQuery, options: { includeCapabilities?: boolean } = {}) {
      calls.push({ query, options });
      return {
        results: [
          {
            id: "gitlab://project/1/issues/123",
            kind: "issue" as const,
            title: "Release blocker",
            metadata: { iid: 123, state: "opened" },
          },
        ],
        warnings: [],
      };
    },
  };
}

function fakeIssueTaskService() {
  const calls: string[] = [];
  const report: GitlabIssueTaskReport = {
    iid: "42",
    title: "Task issue",
    state: "opened",
    summary: { count: 2, completedCount: 1 },
    tasks: [
      { line: 1, text: "write docs", marker: "[ ]", checked: false, inapplicable: false },
      { line: 2, text: "done", marker: "[x]", checked: true, inapplicable: false },
    ],
    remainingTasks: [
      { line: 1, text: "write docs", marker: "[ ]", checked: false, inapplicable: false },
    ],
  };
  return {
    calls,
    async getIssueTasks(iid: string | number) {
      calls.push(String(iid));
      return report;
    },
    async addIssueTask(iid: string | number, text: string) {
      calls.push(`add:${String(iid)}:${text}`);
      return report;
    },
    async updateIssueTask(iid: string | number, line: number, update: { checked?: boolean; text?: string }) {
      calls.push(`update:${String(iid)}:${String(line)}:${String(update.checked)}:${String(update.text)}`);
      return report;
    },
    async deleteIssueTask(iid: string | number, line: number) {
      calls.push(`delete:${String(iid)}:${String(line)}`);
      return report;
    },
  };
}
