import { describe, expect, it, vi } from "vitest";

import {
  GitlabContextSearchService,
  gitlabBoardCoordinate,
  gitlabDiscussionCoordinate,
  gitlabIssueCoordinate,
  gitlabIssueNoteCoordinate,
  gitlabLabelCoordinate,
  gitlabMergeRequestCoordinate,
  gitlabMilestoneCoordinate,
  gitlabPipelineCoordinate,
  gitlabRepoFileCoordinate,
  gitlabReleaseCoordinate,
  gitlabSnippetCoordinate,
  gitlabWikiPageCoordinate,
  parseGitlabContextCoordinate,
} from "../src/context-search.js";
import { GitlabProjectClient } from "../src/gitlab-client.js";

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

describe("GitLab context coordinates", () => {
  it("round-trips supported coordinate kinds", () => {
    expect(parseGitlabContextCoordinate(gitlabIssueCoordinate("1", 42))).toEqual({
      kind: "issue",
      issueIid: "42",
    });
    expect(parseGitlabContextCoordinate(gitlabMergeRequestCoordinate("1", 7))).toEqual({
      kind: "merge_request",
      mergeRequestIid: "7",
    });
    expect(parseGitlabContextCoordinate(gitlabIssueNoteCoordinate("1", 42, 99))).toEqual({
      kind: "issue_note",
      issueIid: "42",
      noteId: "99",
    });
    expect(parseGitlabContextCoordinate(gitlabDiscussionCoordinate("1", 7, "abc123"))).toEqual({
      kind: "discussion",
      mergeRequestIid: "7",
      discussionId: "abc123",
    });
    expect(parseGitlabContextCoordinate(gitlabRepoFileCoordinate("1", "docs/a b.md", "feature/x"))).toEqual({
      kind: "repo_file",
      path: "docs/a b.md",
      ref: "feature/x",
    });
    expect(parseGitlabContextCoordinate(gitlabWikiPageCoordinate("1", "Runbook/Deploy"))).toEqual({
      kind: "wiki_page",
      slug: "Runbook/Deploy",
    });
    expect(parseGitlabContextCoordinate(gitlabSnippetCoordinate("1", 3))).toEqual({
      kind: "snippet",
      snippetId: "3",
    });
    expect(parseGitlabContextCoordinate(gitlabPipelineCoordinate("1", 10))).toEqual({
      kind: "pipeline",
      pipelineId: "10",
    });
    expect(parseGitlabContextCoordinate(gitlabLabelCoordinate("1", "area::api"))).toEqual({
      kind: "label",
      name: "area::api",
    });
    expect(parseGitlabContextCoordinate(gitlabMilestoneCoordinate("1", 11))).toEqual({
      kind: "milestone",
      milestoneId: "11",
    });
    expect(parseGitlabContextCoordinate(gitlabBoardCoordinate("1", 12))).toEqual({
      kind: "board",
      boardId: "12",
    });
    expect(parseGitlabContextCoordinate(gitlabReleaseCoordinate("1", "v1.0.0"))).toEqual({
      kind: "release",
      tagName: "v1.0.0",
    });
  });
});

describe("GitlabContextSearchService", () => {
  it("federates issue, MR, repo file, wiki, snippet, and release search", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/issues")) {
        return jsonResponse([
          {
            iid: 1,
            title: "API issue",
            description: "issue body",
            state: "opened",
            labels: ["area::api"],
            web_url: "http://gitlab/issues/1",
            updated_at: "2026-05-10T00:00:06.000Z",
          },
        ]);
      }
      if (path.endsWith("/merge_requests")) {
        return jsonResponse([
          {
            iid: 2,
            title: "API MR",
            description: "mr body",
            state: "opened",
            labels: ["area::api"],
            web_url: "http://gitlab/mr/2",
            updated_at: "2026-05-10T00:00:05.000Z",
            source_branch: "feature/api",
            target_branch: "main",
          },
        ]);
      }
      if (path.endsWith("/repository/tree")) {
        return jsonResponse([
          { path: "docs/api.md", type: "blob" },
          { path: "src/index.ts", type: "blob" },
        ]);
      }
      if (path.endsWith("/wikis")) {
        return jsonResponse([{ slug: "API", title: "API Wiki", format: "markdown" }]);
      }
      if (path.endsWith("/snippets")) {
        return jsonResponse([
          {
            id: 4,
            title: "API snippet",
            description: "snippet body",
            visibility: "private",
            updated_at: "2026-05-10T00:00:04.000Z",
          },
        ]);
      }
      if (path.endsWith("/releases")) {
        return jsonResponse([
          {
            tag_name: "v1.0.0",
            name: "API release",
            description: "release body",
            released_at: "2026-05-10T00:00:03.000Z",
          },
        ]);
      }
      return jsonResponse([]);
    });
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });
    const service = new GitlabContextSearchService({ client, coordinateProjectId: "1" });

    const results = await service.search({
      text: "api",
      kinds: ["issue", "merge_request", "repo_file", "wiki_page", "snippet", "release"],
      ref: "main",
      limit: 20,
    });

    expect(results.map((r) => r.kind)).toEqual([
      "issue",
      "merge_request",
      "snippet",
      "release",
      "wiki_page",
      "repo_file",
    ]);
    expect(results.map((r) => r.id)).toContain("gitlab://project/1/repository/files/docs%2Fapi.md?ref=main");
  });

  it("returns detailed search metadata for partial failures, cursor, and capabilities", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname;
      if (path.endsWith("/version")) {
        return jsonResponse({ version: "18.11.2", enterprise: false });
      }
      if (path.endsWith("/wikis") || path.endsWith("/snippets") || path.endsWith("/boards")) {
        return jsonResponse([]);
      }
      if (path.endsWith("/merge_requests") || path.endsWith("/pipelines")) {
        if (parsed.searchParams.get("order_by") === "updated_at") {
          return jsonPageResponse({ message: "boom" }, "", 500);
        }
        return jsonResponse([]);
      }
      if (path.endsWith("/issues")) {
        return jsonPageResponse(
          [
            {
              iid: 1,
              title: "Paged issue",
              description: "body",
              state: "opened",
              labels: [],
              web_url: "http://gitlab/issues/1",
              updated_at: "2026-05-10T00:00:00.000Z",
            },
          ],
          "2",
        );
      }
      return jsonResponse([]);
    });
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });
    const service = new GitlabContextSearchService({ client, coordinateProjectId: "1" });

    const response = await service.searchDetailed(
      { text: "api", kinds: ["issue", "pipeline", "discussion"], limit: 10 },
      { includeCapabilities: true },
    );

    expect(response.results.map((r) => r.kind)).toEqual(["issue"]);
    expect(response.cursor).toBe("page=2");
    expect(response.capabilities?.version).toBe("18.11.2");
    expect(response.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "discussion", code: "unsupported_kind" }),
      expect.objectContaining({ kind: "pipeline", code: "request_failed", status: 500 }),
    ]));
  });

  it("propagates cursor input as page parameter and returns next page cursor", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname;
      if (path.endsWith("/issues")) {
        return jsonPageResponse([
          {
            iid: 1,
            title: "Paged issue",
            description: "body",
            state: "opened",
            labels: [],
            web_url: "http://gitlab/issues/1",
            updated_at: "2026-05-10T00:00:00.000Z",
          },
        ], "4");
      }
      if (path.endsWith("/repository/tree")) {
        return jsonResponse([
          { path: "docs/api.md", type: "blob" },
        ]);
      }
      return jsonResponse([]);
    });
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });
    const service = new GitlabContextSearchService({ client, coordinateProjectId: "1" });

    const response = await service.searchDetailed({
      cursor: "page=3",
      kinds: ["issue", "repo_file"],
      limit: 20,
    });

    const issueRequest = fetchImpl.mock.calls.find(([requestUrl]) =>
      new URL(String(requestUrl)).pathname.endsWith("/issues"),
    );
    const repoFileRequest = fetchImpl.mock.calls.find(([requestUrl]) =>
      new URL(String(requestUrl)).pathname.endsWith("/repository/tree"),
    );
    if (issueRequest === undefined || repoFileRequest === undefined) {
      throw new Error("expected issue and repo file requests");
    }
    expect(new URL(String(issueRequest[0])).searchParams.get("page")).toBe("3");
    expect(new URL(String(repoFileRequest[0])).searchParams.get("page")).toBe("3");
    expect(response.cursor).toBe("page=4");
    expect(response.results.map((r) => r.kind)).toEqual(["issue", "repo_file"]);
  });

  it("search() keeps legacy behavior by dropping detailed warnings", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname;
      if (path.endsWith("/issues")) {
        return jsonResponse([
          {
            iid: 1,
            title: "API issue",
            description: "issue body",
            state: "opened",
            labels: [],
            web_url: "http://gitlab/issues/1",
            updated_at: "2026-05-10T00:00:00.000Z",
          },
        ]);
      }
      if (path.endsWith("/pipelines")) {
        return jsonPageResponse({ message: "boom" }, "", 500);
      }
      return jsonResponse([]);
    });
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });
    const service = new GitlabContextSearchService({ client, coordinateProjectId: "1" });

    const detailed = await service.searchDetailed({
      kinds: ["issue", "pipeline", "discussion"],
      limit: 20,
    });
    const legacy = await service.search({ kinds: ["issue", "pipeline", "discussion"], limit: 20 });

    expect(detailed.results).toEqual(legacy);
    expect(detailed.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "discussion", code: "unsupported_kind" }),
      expect.objectContaining({ kind: "pipeline", code: "request_failed", status: 500 }),
    ]));
    expect("warnings" in legacy).toBe(false);
    expect("cursor" in legacy).toBe(false);
  });

  it("searches labels, milestones, boards, and pipelines as first-class context kinds", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/labels")) {
        return jsonPageResponse([{ name: "area::api", color: "#ff0000", description: "API area" }]);
      }
      if (path.endsWith("/milestones")) {
        return jsonPageResponse([
          {
            id: 10,
            iid: 3,
            title: "v1",
            description: "release",
            state: "active",
            due_date: "2026-05-10",
          },
        ]);
      }
      if (path.endsWith("/boards")) {
        return jsonPageResponse([{ id: 4, name: "Agent Board" }]);
      }
      if (path.endsWith("/pipelines")) {
        return jsonPageResponse([
          {
            id: 5,
            status: "success",
            ref: "main",
            sha: "abc",
            web_url: "http://gitlab/pipelines/5",
            updated_at: "2026-05-10T00:00:00.000Z",
          },
        ]);
      }
      return jsonResponse([]);
    });
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });
    const service = new GitlabContextSearchService({ client, coordinateProjectId: "1" });

    const response = await service.searchDetailed({
      kinds: ["label", "milestone", "board", "pipeline"],
      limit: 20,
    });

    expect(new Set(response.results.map((r) => r.kind))).toEqual(new Set(["label", "milestone", "board", "pipeline"]));
    expect(response.results.map((r) => r.id)).toEqual(expect.arrayContaining([
      "gitlab://project/1/labels/area%3A%3Aapi",
      "gitlab://project/1/milestones/3",
      "gitlab://project/1/boards/4",
      "gitlab://project/1/pipelines/5",
    ]));
  });

  it("expands an issue document with comments and links", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/issues/5/notes")) {
        return jsonResponse([
          {
            id: 55,
            body: "comment body",
            system: false,
            created_at: "2026-05-10T00:00:01.000Z",
            updated_at: "2026-05-10T00:00:02.000Z",
            author: { username: "alice", name: "Alice" },
          },
        ]);
      }
      return jsonResponse({
        iid: 5,
        title: "Expandable issue",
        description: "long issue body",
        state: "opened",
        labels: ["context"],
        web_url: "http://gitlab/issues/5",
        updated_at: "2026-05-10T00:00:00.000Z",
      });
    });
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });
    const service = new GitlabContextSearchService({ client, coordinateProjectId: "1" });

    const doc = await service.expand(gitlabIssueCoordinate("1", 5), {
      includeComments: true,
      includeLinkedObjects: true,
    });

    expect(doc.kind).toBe("issue");
    expect(doc.title).toBe("Expandable issue");
    expect(doc.body).toBe("long issue body");
    expect(doc.metadata.labels).toEqual(["context"]);
    expect(doc.metadata.comments).toEqual([
      expect.objectContaining({ id: 55, body: "comment body", authorUsername: "alice" }),
    ]);
    expect(doc.links).toEqual([{ rel: "comment", target: "gitlab://project/1/issues/5/notes/55" }]);
  });

  it("expands a merge request with discussions and head pipeline link", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/merge_requests/7/discussions")) {
        return jsonResponse([
          {
            id: "disc-1",
            individual_note: false,
            notes: [
              {
                id: 101,
                body: "discussion body",
                system: false,
                created_at: "2026-05-10T00:00:03.000Z",
                author: { username: "reviewer" },
              },
            ],
          },
        ]);
      }
      return jsonResponse({
        iid: 7,
        title: "Expandable MR",
        description: "mr body",
        state: "opened",
        labels: ["context"],
        web_url: "http://gitlab/mr/7",
        updated_at: "2026-05-10T00:00:00.000Z",
        source_branch: "feature/search",
        target_branch: "main",
        head_pipeline: {
          id: 77,
          status: "success",
          ref: "feature/search",
          sha: "abc",
          web_url: "http://gitlab/pipelines/77",
          updated_at: "2026-05-10T00:00:04.000Z",
        },
      });
    });
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });
    const service = new GitlabContextSearchService({ client, coordinateProjectId: "1" });

    const doc = await service.expand(gitlabMergeRequestCoordinate("1", 7), {
      includeDiscussions: true,
      includeLinkedObjects: true,
      includePipelineStatus: true,
    });

    expect(doc.kind).toBe("merge_request");
    expect(doc.metadata.headPipeline).toEqual(expect.objectContaining({ id: 77, status: "success" }));
    expect(doc.metadata.discussions).toEqual([
      expect.objectContaining({
        id: "disc-1",
        notes: [expect.objectContaining({ id: 101, body: "discussion body" })],
      }),
    ]);
    expect(doc.links).toEqual([
      { rel: "pipeline", target: "gitlab://project/1/pipelines/77" },
      { rel: "discussion", target: "gitlab://project/1/merge-requests/7/discussions/disc-1" },
    ]);
  });

  it("discovers CE-compatible context capabilities", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/version")) {
        return jsonResponse({ version: "18.11.2", enterprise: false });
      }
      if (path.endsWith("/wikis") || path.endsWith("/snippets") || path.endsWith("/boards")) {
        return jsonResponse([]);
      }
      if (path.endsWith("/merge_requests") || path.endsWith("/pipelines")) {
        return jsonResponse([]);
      }
      return jsonResponse({ message: "not found" }, 404);
    });
    const client = new GitlabProjectClient({
      baseUrl: "http://localhost:8929",
      token: "tok",
      projectId: 1,
      fetchImpl,
    });
    const service = new GitlabContextSearchService({ client, coordinateProjectId: "1" });

    await expect(service.discoverCapabilities()).resolves.toEqual({
      version: "18.11.2",
      enterprise: false,
      supportsWiki: true,
      supportsProjectSnippets: true,
      supportsIssueBoards: true,
      supportsMergeRequests: true,
      supportsPipelineCreate: true,
      supportsReleaseEvidence: false,
    });
  });
});
