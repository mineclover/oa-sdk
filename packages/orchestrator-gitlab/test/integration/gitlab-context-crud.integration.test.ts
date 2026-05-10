/**
 * Data-surface smoke tests against a real GitLab CE project.
 *
 * Required env:
 *   GITLAB_INTEGRATION_BASE_URL
 *   GITLAB_INTEGRATION_TOKEN
 *   GITLAB_INTEGRATION_PROJECT_ID
 *
 * Scope: prove the basic CRUD shape for GitLab-native project context storage.
 * These tests intentionally use throwaway names and best-effort cleanup.
 */
import { afterAll, describe, expect, it } from "vitest";

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

interface GitlabContext {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
}

interface ProjectInfo {
  readonly id: number;
  readonly default_branch: string | null;
}

interface LabelInfo {
  readonly name: string;
  readonly description: string | null;
}

interface MilestoneInfo {
  readonly id: number;
  readonly iid: number;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
}

interface IssueInfo {
  readonly iid: number;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly labels: ReadonlyArray<string>;
  readonly milestone: { readonly id: number; readonly title: string } | null;
}

interface NoteInfo {
  readonly id: number;
  readonly body: string;
}

interface FileInfo {
  readonly file_path: string;
  readonly branch: string;
}

interface WikiPageInfo {
  readonly slug: string;
  readonly title: string;
  readonly content?: string;
  readonly format?: string;
}

interface SnippetInfo {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly visibility: string;
}

interface ReleaseInfo {
  readonly tag_name: string;
  readonly name: string;
  readonly description: string;
}

describeIfEnabled("GitLab CE project context CRUD surfaces", () => {
  const ctx: GitlabContext = {
    baseUrl: ENV_BASE_URL as string,
    token: ENV_TOKEN as string,
    projectId: ENV_PROJECT_ID as string,
  };

  const runId = `ctx-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const projectPath = `/projects/${encodeURIComponent(ctx.projectId)}`;
  const cleanup: Array<() => Promise<void>> = [];

  afterAll(async () => {
    for (const clean of cleanup.reverse()) {
      await clean().catch(() => undefined);
    }
  });

  it("supports label + milestone + issue metadata + note CRUD", async () => {
    const labelName = `context::${runId}`;
    const milestoneTitle = `Context CRUD ${runId}`;

    const label = await request<LabelInfo>(ctx, "POST", `${projectPath}/labels`, {
      name: labelName,
      color: "#428BCA",
      description: "created by GitLab context CRUD integration test",
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/labels?name=${encodeURIComponent(labelName)}`);
    });
    expect(label.name).toBe(labelName);

    const renamedLabel = `${labelName}::updated`;
    const updatedLabel = await request<LabelInfo>(ctx, "PUT", `${projectPath}/labels`, {
      name: labelName,
      new_name: renamedLabel,
      color: "#44AD8E",
      description: "updated by GitLab context CRUD integration test",
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/labels?name=${encodeURIComponent(renamedLabel)}`);
    });
    expect(updatedLabel.name).toBe(renamedLabel);
    expect(updatedLabel.description).toContain("updated");

    const milestone = await request<MilestoneInfo>(ctx, "POST", `${projectPath}/milestones`, {
      title: milestoneTitle,
      description: "created by GitLab context CRUD integration test",
      start_date: "2026-05-09",
      due_date: "2026-05-10",
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/milestones/${String(milestone.id)}`);
    });
    expect(milestone.title).toBe(milestoneTitle);

    const updatedMilestone = await request<MilestoneInfo>(ctx, "PUT", `${projectPath}/milestones/${String(milestone.id)}`, {
      description: "updated milestone metadata",
      state_event: "activate",
    });
    expect(updatedMilestone.description).toContain("updated");

    const issue = await request<IssueInfo>(ctx, "POST", `${projectPath}/issues`, {
      title: `[context-crud] metadata ${runId}`,
      description: "initial task contract",
      labels: renamedLabel,
      milestone_id: milestone.id,
      due_date: "2026-05-10",
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "PUT", `${projectPath}/issues/${String(issue.iid)}`, { state_event: "close" });
    });
    expect(issue.labels).toContain(renamedLabel);
    expect(issue.milestone?.id).toBe(milestone.id);

    const updatedIssue = await request<IssueInfo>(ctx, "PUT", `${projectPath}/issues/${String(issue.iid)}`, {
      description: "updated task contract",
      remove_labels: renamedLabel,
    });
    expect(updatedIssue.description).toBe("updated task contract");
    expect(updatedIssue.labels).not.toContain(renamedLabel);

    const note = await request<NoteInfo>(ctx, "POST", `${projectPath}/issues/${String(issue.iid)}/notes`, {
      body: "agent context note v1",
    });
    expect(note.body).toBe("agent context note v1");

    const updatedNote = await request<NoteInfo>(
      ctx,
      "PUT",
      `${projectPath}/issues/${String(issue.iid)}/notes/${String(note.id)}`,
      { body: "agent context note v2" },
    );
    expect(updatedNote.body).toBe("agent context note v2");

    await request<unknown>(ctx, "DELETE", `${projectPath}/issues/${String(issue.iid)}/notes/${String(note.id)}`);
    const notes = await request<ReadonlyArray<NoteInfo>>(ctx, "GET", `${projectPath}/issues/${String(issue.iid)}/notes`);
    expect(notes.some((n) => n.id === note.id)).toBe(false);
  }, 60_000);

  it("supports branch-aware repository docs file CRUD", async () => {
    const project = await request<ProjectInfo>(ctx, "GET", projectPath);
    const defaultBranch = project.default_branch ?? "main";
    const branch = `context-crud-${runId}`;
    const filePath = `docs/context-crud-${runId}.md`;
    const encodedFile = encodeURIComponent(filePath);

    await request<unknown>(
      ctx,
      "POST",
      `${projectPath}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(defaultBranch)}`,
    );
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/repository/branches/${encodeURIComponent(branch)}`);
    });

    const created = await request<FileInfo>(ctx, "POST", `${projectPath}/repository/files/${encodedFile}`, {
      branch,
      commit_message: `test: create context doc ${runId}`,
      content: "# Context CRUD\n\nversion: 1\n",
    });
    expect(created.file_path).toBe(filePath);
    expect(created.branch).toBe(branch);

    const read = await request<{ readonly file_path: string; readonly content_sha256: string }>(
      ctx,
      "GET",
      `${projectPath}/repository/files/${encodedFile}?ref=${encodeURIComponent(branch)}`,
    );
    expect(read.file_path).toBe(filePath);
    expect(read.content_sha256).toMatch(/^[0-9a-f]{64}$/);

    const updated = await request<FileInfo>(ctx, "PUT", `${projectPath}/repository/files/${encodedFile}`, {
      branch,
      commit_message: `test: update context doc ${runId}`,
      content: "# Context CRUD\n\nversion: 2\n",
    });
    expect(updated.file_path).toBe(filePath);

    await request<unknown>(ctx, "DELETE", `${projectPath}/repository/files/${encodedFile}`, {
      branch,
      commit_message: `test: delete context doc ${runId}`,
    });
    const missing = await requestMaybe(ctx, "GET", `${projectPath}/repository/files/${encodedFile}?ref=${encodeURIComponent(branch)}`);
    expect(missing.status).toBe(404);
  }, 60_000);

  it("supports wiki page CRUD for living project documentation", async () => {
    const title = `context-crud-${runId}`;
    const created = await request<WikiPageInfo>(ctx, "POST", `${projectPath}/wikis`, {
      title,
      content: "# Context CRUD\n\nversion: 1\n",
      format: "markdown",
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/wikis/${encodeURIComponent(created.slug)}`);
    });
    expect(created.slug).toBe(title);

    const read = await request<WikiPageInfo>(ctx, "GET", `${projectPath}/wikis/${encodeURIComponent(created.slug)}`);
    expect(read.slug).toBe(title);
    expect(read.content).toContain("version: 1");

    const updated = await request<WikiPageInfo>(ctx, "PUT", `${projectPath}/wikis/${encodeURIComponent(created.slug)}`, {
      content: "# Context CRUD\n\nversion: 2\n",
    });
    expect(updated.content).toContain("version: 2");

    await deleteWikiPageWithRetry(ctx, projectPath, created.slug);
    const missing = await requestMaybe(ctx, "GET", `${projectPath}/wikis/${encodeURIComponent(created.slug)}`);
    expect(missing.status).toBe(404);
  }, 60_000);

  it("supports project snippet CRUD for large or temporary context artifacts", async () => {
    const snippet = await request<SnippetInfo>(ctx, "POST", `${projectPath}/snippets`, {
      title: `context-crud-${runId}`,
      description: "context artifact v1",
      visibility: "private",
      files: [{ file_path: "context.md", content: "# Context Artifact\n\nversion: 1\n" }],
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/snippets/${String(snippet.id)}`);
    });
    expect(snippet.title).toContain(runId);

    const read = await request<SnippetInfo>(ctx, "GET", `${projectPath}/snippets/${String(snippet.id)}`);
    expect(read.description).toBe("context artifact v1");

    const updated = await request<SnippetInfo>(ctx, "PUT", `${projectPath}/snippets/${String(snippet.id)}`, {
      description: "context artifact v2",
      files: [{ action: "update", file_path: "context.md", content: "# Context Artifact\n\nversion: 2\n" }],
    });
    expect(updated.description).toBe("context artifact v2");

    const raw = await requestText(
      ctx,
      "GET",
      `${projectPath}/snippets/${String(snippet.id)}/files/main/${encodeURIComponent("context.md")}/raw`,
    );
    expect(raw).toContain("version: 2");

    await request<unknown>(ctx, "DELETE", `${projectPath}/snippets/${String(snippet.id)}`);
    const missing = await requestMaybe(ctx, "GET", `${projectPath}/snippets/${String(snippet.id)}`);
    expect(missing.status).toBe(404);
  }, 60_000);

  it("supports release CRUD for tag-bound release documentation", async () => {
    const project = await request<ProjectInfo>(ctx, "GET", projectPath);
    const defaultBranch = project.default_branch ?? "main";
    const tagName = `v0.0.0-context-crud-${runId}`;

    const release = await request<ReleaseInfo>(ctx, "POST", `${projectPath}/releases`, {
      tag_name: tagName,
      ref: defaultBranch,
      name: `Context CRUD ${runId}`,
      description: "release note v1",
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/releases/${encodeURIComponent(tagName)}`);
      await request<unknown>(ctx, "DELETE", `${projectPath}/repository/tags/${encodeURIComponent(tagName)}`);
    });
    expect(release.tag_name).toBe(tagName);

    const read = await request<ReleaseInfo>(ctx, "GET", `${projectPath}/releases/${encodeURIComponent(tagName)}`);
    expect(read.description).toContain("v1");

    const updated = await request<ReleaseInfo>(ctx, "PUT", `${projectPath}/releases/${encodeURIComponent(tagName)}`, {
      description: "release note v2",
    });
    expect(updated.description).toContain("v2");

    await request<unknown>(ctx, "DELETE", `${projectPath}/releases/${encodeURIComponent(tagName)}`);
    const missing = await requestMaybe(ctx, "GET", `${projectPath}/releases/${encodeURIComponent(tagName)}`);
    expect(missing.status).toBe(404);
  }, 60_000);
});

async function request<T>(
  ctx: GitlabContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await rawRequest(ctx, method, path, body);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitLab REST ${method} ${path} -> ${String(res.status)}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function requestText(
  ctx: GitlabContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<string> {
  const res = await rawRequest(ctx, method, path, body);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitLab REST ${method} ${path} -> ${String(res.status)}: ${text.slice(0, 500)}`);
  }
  return await res.text();
}

async function requestMaybe(
  ctx: GitlabContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return await rawRequest(ctx, method, path, body);
}

async function deleteWikiPageWithRetry(ctx: GitlabContext, projectPath: string, slug: string): Promise<void> {
  const path = `${projectPath}/wikis/${encodeURIComponent(slug)}`;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await requestMaybe(ctx, "DELETE", path);
    lastStatus = res.status;
    if (res.ok || res.status === 404) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`GitLab REST DELETE ${path} did not succeed after retries; last status=${String(lastStatus)}`);
}

async function rawRequest(
  ctx: GitlabContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    "PRIVATE-TOKEN": ctx.token,
    Accept: "application/json",
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const init: RequestInit = { method, headers };
  if (payload !== undefined) init.body = payload;
  return await fetch(`${ctx.baseUrl}/api/v4${path}`, init);
}
