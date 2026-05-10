/**
 * API-first GitLab context search integration test against a real CE project.
 */
import { afterAll, describe, expect, it } from "vitest";

import { GitlabContextSearchService } from "../../src/context-search.js";
import { GitlabProjectClient } from "../../src/gitlab-client.js";

const ENV_BASE_URL = process.env.GITLAB_INTEGRATION_BASE_URL;
const ENV_TOKEN = process.env.GITLAB_INTEGRATION_TOKEN;
const ENV_PROJECT_ID = process.env.GITLAB_INTEGRATION_PROJECT_ID;

const ENABLED =
  ENV_BASE_URL !== undefined &&
  ENV_BASE_URL.length > 0 &&
  ENV_TOKEN !== undefined &&
  ENV_TOKEN.length > 0 &&
  ENV_PROJECT_ID !== undefined &&
  ENV_PROJECT_ID.length > 0;

const describeIfEnabled = ENABLED ? describe : describe.skip;

interface ProjectInfo {
  readonly default_branch: string | null;
}

interface IssueInfo {
  readonly iid: number;
}

interface MergeRequestInfo {
  readonly iid: number;
}

interface SnippetInfo {
  readonly id: number;
}

interface NoteInfo {
  readonly id: number;
}

describeIfEnabled("GitLab CE context search", () => {
  const client = new GitlabProjectClient({
    baseUrl: ENV_BASE_URL ?? "http://127.0.0.1",
    token: ENV_TOKEN ?? "",
    projectId: ENV_PROJECT_ID ?? "0",
  });
  const service = new GitlabContextSearchService({
    client,
    coordinateProjectId: ENV_PROJECT_ID ?? "0",
  });
  const runId = `search-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const projectPath = client.projectApiPath();
  const cleanup: Array<() => Promise<void>> = [];

  afterAll(async () => {
    for (const clean of cleanup.reverse()) {
      await clean().catch(() => undefined);
    }
  });

  it("searches and expands issue, MR, repo doc, wiki, snippet, and release fixtures", async () => {
    const project = await client.request<ProjectInfo>("GET", projectPath);
    const defaultBranch = project.default_branch ?? "main";
    const branch = `context-search-${runId}`;
    const marker = `ctx-search-${runId}`;

    await client.request<unknown>(
      "POST",
      `${projectPath}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(defaultBranch)}`,
    );
    cleanup.push(async () => {
      await client.request<unknown>("DELETE", `${projectPath}/repository/branches/${encodeURIComponent(branch)}`);
    });

    const docPath = `docs/${marker}.md`;
    await client.request<unknown>("POST", `${projectPath}/repository/files/${encodeURIComponent(docPath)}`, {
      branch,
      commit_message: `test: create ${marker} doc`,
      content: `# ${marker}\n\nrepository documentation fixture\n`,
    });

    const issue = await client.request<IssueInfo>("POST", `${projectPath}/issues`, {
      title: `${marker} issue`,
      description: `issue description for ${marker}`,
      labels: marker,
    });
    const issueNote = await client.request<NoteInfo>("POST", `${projectPath}/issues/${String(issue.iid)}/notes`, {
      body: `issue note for ${marker}`,
    });
    cleanup.push(async () => {
      await client.request<unknown>("PUT", `${projectPath}/issues/${String(issue.iid)}`, { state_event: "close" });
    });

    await client.request<unknown>("POST", `${projectPath}/repository/files/${encodeURIComponent(`docs/${marker}-mr.md`)}`, {
      branch,
      commit_message: `test: create ${marker} mr doc`,
      content: `# ${marker} MR\n`,
    });
    const mr = await client.request<MergeRequestInfo>("POST", `${projectPath}/merge_requests`, {
      source_branch: branch,
      target_branch: defaultBranch,
      title: `${marker} merge request`,
      description: `merge request description for ${marker}`,
      remove_source_branch: true,
    });
    await client.request<unknown>("POST", `${projectPath}/merge_requests/${String(mr.iid)}/discussions`, {
      body: `merge request discussion for ${marker}`,
    });
    cleanup.push(async () => {
      await client.request<unknown>("PUT", `${projectPath}/merge_requests/${String(mr.iid)}`, { state_event: "close" });
    });

    const wiki = await client.request<{ readonly slug: string }>("POST", `${projectPath}/wikis`, {
      title: marker,
      content: `# ${marker}\n\nwiki fixture\n`,
      format: "markdown",
    });
    cleanup.push(async () => {
      await client.request<unknown>("DELETE", `${projectPath}/wikis/${encodeURIComponent(wiki.slug)}`);
    });

    const snippet = await client.request<SnippetInfo>("POST", `${projectPath}/snippets`, {
      title: `${marker} snippet`,
      description: `snippet description for ${marker}`,
      visibility: "private",
      files: [{ file_path: "context.md", content: `# ${marker}\n` }],
    });
    cleanup.push(async () => {
      await client.request<unknown>("DELETE", `${projectPath}/snippets/${String(snippet.id)}`);
    });

    const tagName = `v0.0.0-${marker}`;
    await client.request<unknown>("POST", `${projectPath}/releases`, {
      tag_name: tagName,
      ref: defaultBranch,
      name: `${marker} release`,
      description: `release description for ${marker}`,
    });
    cleanup.push(async () => {
      await client.request<unknown>("DELETE", `${projectPath}/releases/${encodeURIComponent(tagName)}`);
      await client.request<unknown>("DELETE", `${projectPath}/repository/tags/${encodeURIComponent(tagName)}`);
    });

    const searchResponse = await service.searchDetailed({
      text: marker,
      kinds: ["issue", "merge_request", "repo_file", "wiki_page", "snippet", "release"],
      ref: branch,
      limit: 20,
    }, {
      includeCapabilities: true,
    });
    expect(searchResponse.warnings).toEqual([]);
    expect(searchResponse.capabilities?.version).not.toBe("");
    const results = searchResponse.results;

    expect(new Set(results.map((r) => r.kind))).toEqual(
      new Set(["issue", "merge_request", "repo_file", "wiki_page", "snippet", "release"]),
    );

    const issueResult = results.find((r) => r.kind === "issue");
    expect(issueResult).toBeDefined();
    const issueDoc = await service.expand(issueResult!.id, {
      includeComments: true,
      includeLinkedObjects: true,
      maxComments: 5,
    });
    expect(issueDoc.body).toContain(marker);
    expect(issueDoc.metadata.comments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: issueNote.id, body: `issue note for ${marker}` }),
    ]));
    expect(issueDoc.links).toContainEqual({
      rel: "comment",
      target: `gitlab://project/${ENV_PROJECT_ID ?? "0"}/issues/${String(issue.iid)}/notes/${String(issueNote.id)}`,
    });

    const mrResult = results.find((r) => r.kind === "merge_request");
    expect(mrResult).toBeDefined();
    const mrDoc = await service.expand(mrResult!.id, {
      includeDiscussions: true,
      includeLinkedObjects: true,
      includePipelineStatus: true,
      maxComments: 5,
    });
    expect(mrDoc.metadata.discussions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        notes: expect.arrayContaining([expect.objectContaining({ body: `merge request discussion for ${marker}` })]),
      }),
    ]));

    const repoResult = results.find((r) => r.kind === "repo_file" && r.title === docPath);
    expect(repoResult).toBeDefined();
    const repoDoc = await service.expand(repoResult!.id);
    expect(repoDoc.body).toContain("repository documentation fixture");

    const wikiResult = results.find((r) => r.kind === "wiki_page");
    expect(wikiResult).toBeDefined();
    const wikiDoc = await service.expand(wikiResult!.id);
    expect(wikiDoc.body).toContain("wiki fixture");

    const unsupported = await service.searchDetailed({ kinds: ["issue_note", "discussion"], limit: 5 });
    expect(unsupported.results).toEqual([]);
    expect(new Set(unsupported.warnings.map((warning) => warning.kind))).toEqual(new Set(["issue_note", "discussion"]));

    const capabilities = await service.discoverCapabilities();
    expect(capabilities.version).not.toBe("");
    expect(capabilities.enterprise).toBe(false);
    expect(capabilities.supportsWiki).toBe(true);
    expect(capabilities.supportsProjectSnippets).toBe(true);
    expect(capabilities.supportsIssueBoards).toBe(true);
    expect(capabilities.supportsMergeRequests).toBe(true);
    expect(capabilities.supportsPipelineCreate).toBe(true);
    expect(capabilities.supportsReleaseEvidence).toBe(false);
  }, 90_000);
});
