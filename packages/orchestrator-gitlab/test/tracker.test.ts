import { afterEach, describe, expect, it, vi } from "vitest";

import { GitlabTracker } from "../src/tracker.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetchTracker() {
  const requests: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL) => {
    requests.push(String(url));
    return jsonResponse([]);
  });
  return { fetchImpl, requests };
}

describe("GitlabTracker projectId encoding", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("encodes raw numeric project ids once", async () => {
    const { fetchImpl, requests } = makeFetchTracker();
    const tracker = new GitlabTracker({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 123,
      fetchImpl,
    });

    await tracker.listEligibleIssues({
      ready: "agent-ready",
      running: "agent-running",
      done: "agent-done",
      failed: "agent-failed",
    });

    expect(new URL(requests[0]).pathname).toBe("/api/v4/projects/123/issues");
  });

  it("encodes raw namespace/project paths once", async () => {
    const { fetchImpl, requests } = makeFetchTracker();
    const tracker = new GitlabTracker({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: "mygroup/myrepo",
      fetchImpl,
    });

    await tracker.listEligibleIssues({
      ready: "agent-ready",
      running: "agent-running",
      done: "agent-done",
      failed: "agent-failed",
    });

    expect(new URL(requests[0]).pathname).toBe("/api/v4/projects/mygroup%2Fmyrepo/issues");
    expect(new URL(requests[0]).pathname).not.toContain("%252F");
  });

  it("avoids double-encoding when projectId is already URL-encoded", async () => {
    const { fetchImpl, requests } = makeFetchTracker();
    const tracker = new GitlabTracker({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: "mygroup%2Fmyrepo",
      fetchImpl,
    });

    await tracker.getIssue("17");

    expect(new URL(requests[0]).pathname).toBe("/api/v4/projects/mygroup%2Fmyrepo/issues/17");
    expect(new URL(requests[0]).pathname).not.toContain("%252F");
  });

  it("uses the same encoded project segment across issue operations", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const next = String(url);
      requests.push(next);

      if (init?.method === "POST" || init?.method === "PUT") {
        return new Response(null, { status: 204 });
      }

      return jsonResponse({
        id: 9,
        iid: 17,
        title: "demo",
        description: "",
        labels: [],
        web_url: "https://example.com",
        state: "opened",
        updated_at: "2026-05-09T00:00:00.000Z",
      });
    });

    const tracker = new GitlabTracker({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: "mygroup/myrepo",
      fetchImpl,
    });

    await tracker.getIssue("17");
    await tracker.transitionLabels("17", { add: ["agent-running"], remove: [] });
    await tracker.postNote("17", "hello");

    expect(requests.map((url) => new URL(url).pathname)).toEqual([
      "/api/v4/projects/mygroup%2Fmyrepo/issues/17",
      "/api/v4/projects/mygroup%2Fmyrepo/issues/17",
      "/api/v4/projects/mygroup%2Fmyrepo/issues/17/notes",
    ]);
  });
});
