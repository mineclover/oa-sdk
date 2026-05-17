import { afterEach, describe, expect, it, vi } from "vitest";

import { GitlabTracker } from "../src/tracker.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonPageResponse(value: unknown, nextPage = "", status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "x-next-page": nextPage,
    },
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

  it("paginates through eligible issue pages and keeps CE label filtering client-side", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const parsed = new URL(String(url));
      requests.push(String(url));

      if (parsed.searchParams.get("page") === "2") {
        return jsonPageResponse([
          {
            id: 3,
            iid: 3,
            title: "page two ready issue",
            description: null,
            labels: ["agent-ready"],
            web_url: "https://example.com/3",
            state: "opened",
            updated_at: "2026-05-10T00:00:02.000Z",
          },
        ]);
      }

      return jsonPageResponse([
        {
          id: 1,
          iid: 1,
          title: "ready issue",
          description: null,
          labels: ["agent-ready"],
          web_url: "https://example.com/1",
          state: "opened",
          updated_at: "2026-05-10T00:00:00.000Z",
        },
        {
          id: 2,
          iid: 2,
          title: "running issue",
          description: null,
          labels: ["agent-ready", "agent-running"],
          web_url: "https://example.com/2",
          state: "opened",
          updated_at: "2026-05-10T00:00:01.000Z",
        },
      ], "2");
    });

    const tracker = new GitlabTracker({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 42,
      fetchImpl,
    });

    const issues = await tracker.listEligibleIssues({
      ready: "agent-ready",
      running: "agent-running",
      done: "agent-done",
      failed: "agent-failed",
    });

    expect(issues.map((issue) => issue.iid)).toEqual(["1", "3"]);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[0]).searchParams.get("labels")).toBe("agent-ready");
    expect(new URL(requests[0]).searchParams.get("page")).toBeNull();
    expect(new URL(requests[1]).searchParams.get("page")).toBe("2");
  });

  it("falls back to x-page/x-total-pages when x-next-page is absent", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const parsed = new URL(String(url));
      requests.push(String(url));

      if (parsed.searchParams.get("page") === "2") {
        return new Response(
          JSON.stringify([
            {
              id: 2,
              iid: 2,
              title: "second page",
              description: null,
              labels: ["agent-ready"],
              web_url: "https://example.com/2",
              state: "opened",
              updated_at: "2026-05-10T00:00:01.000Z",
            },
          ]),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-page": "2",
              "x-total-pages": "2",
            },
          },
        );
      }

      return new Response(
        JSON.stringify([
          {
            id: 1,
            iid: 1,
            title: "first page",
            description: null,
            labels: ["agent-ready"],
            web_url: "https://example.com/1",
            state: "opened",
            updated_at: "2026-05-10T00:00:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-page": "1",
            "x-total-pages": "2",
          },
        },
      );
    });

    const tracker = new GitlabTracker({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 42,
      fetchImpl,
    });

    const issues = await tracker.listEligibleIssues({
      ready: "agent-ready",
      running: "agent-running",
      done: "agent-done",
      failed: "agent-failed",
    });

    expect(issues.map((issue) => issue.iid)).toEqual(["1", "2"]);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1]).searchParams.get("page")).toBe("2");
  });

  it("preserves GitLab API error details while listing eligible issues", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "unauthorized" }, 401),
    );
    const tracker = new GitlabTracker({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 42,
      fetchImpl,
    });

    await expect(tracker.listEligibleIssues({
      ready: "agent-ready",
      running: "agent-running",
      done: "agent-done",
      failed: "agent-failed",
    })).rejects.toMatchObject({
      name: "GitlabApiError",
      status: 401,
      responseBody: JSON.stringify({ message: "unauthorized" }),
    });
  });
});
