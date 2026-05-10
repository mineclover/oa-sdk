import { describe, expect, it, vi } from "vitest";

import { encodeGitlabProjectId, GitlabApiError, GitlabProjectClient } from "../src/gitlab-client.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitlabProjectClient", () => {
  it("normalizes project ids exactly once", () => {
    expect(encodeGitlabProjectId(123)).toBe("123");
    expect(encodeGitlabProjectId("mygroup/myrepo")).toBe("mygroup%2Fmyrepo");
    expect(encodeGitlabProjectId("mygroup%2Fmyrepo")).toBe("mygroup%2Fmyrepo");
    expect(encodeGitlabProjectId("bad%2")).toBe("bad%252");
  });

  it("builds stable project API paths", () => {
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: "mygroup/myrepo",
      fetchImpl: vi.fn(),
    });

    expect(client.projectApiPath()).toBe("/api/v4/projects/mygroup%2Fmyrepo");
    expect(client.projectApiPath("issues")).toBe("/api/v4/projects/mygroup%2Fmyrepo/issues");
    expect(client.projectApiPath("/issues/1")).toBe("/api/v4/projects/mygroup%2Fmyrepo/issues/1");
  });

  it("sends PRIVATE-TOKEN and JSON payloads through request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });

    const result = await client.request<{ ok: boolean }>("POST", client.projectApiPath("/issues"), { title: "T" });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8929/api/v4/projects/1/issues");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("tok");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ title: "T" }));
  });

  it("throws GitlabApiError with response context", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });

    await expect(client.request("GET", client.projectApiPath("/missing"))).rejects.toMatchObject({
      name: "GitlabApiError",
      method: "GET",
      path: "/api/v4/projects/1/missing",
      status: 404,
      responseBody: "nope",
    } satisfies Partial<GitlabApiError>);
  });

  it("supports non-throwing probes via requestMaybe", async () => {
    const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 }));
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });

    const res = await client.requestMaybe<string>("GET", client.projectApiPath("/evidence"));

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.body).toBe("missing");
  });
});
