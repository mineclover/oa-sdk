/**
 * Workflow-oriented GitLab CE surface probes.
 *
 * This complements gitlab-context-crud.integration.test.ts. The data types here
 * are less like simple documents and more like workflow records: MR review,
 * boards, CI pipelines, and release evidence.
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
  readonly default_branch: string | null;
}

interface MergeRequestInfo {
  readonly iid: number;
  readonly title: string;
  readonly source_branch: string;
  readonly target_branch: string;
  readonly state: string;
}

interface DiscussionInfo {
  readonly id: string;
  readonly individual_note: boolean;
  readonly notes: ReadonlyArray<{ readonly id: number; readonly body: string; readonly resolved?: boolean }>;
}

interface BoardInfo {
  readonly id: number;
  readonly name?: string;
}

interface PipelineInfo {
  readonly id: number;
  readonly iid: number;
  readonly ref: string;
  readonly status: string;
}

interface ReleaseInfo {
  readonly tag_name: string;
  readonly description: string;
}

interface MaybeResponse {
  readonly status: number;
  readonly body: unknown;
}

describeIfEnabled("GitLab CE project workflow surfaces", () => {
  const ctx: GitlabContext = {
    baseUrl: ENV_BASE_URL as string,
    token: ENV_TOKEN as string,
    projectId: ENV_PROJECT_ID as string,
  };

  const runId = `wf-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const projectPath = `/projects/${encodeURIComponent(ctx.projectId)}`;
  const cleanup: Array<() => Promise<void>> = [];

  afterAll(async () => {
    for (const clean of cleanup.reverse()) {
      await clean().catch(() => undefined);
    }
  });

  it("supports merge request lifecycle plus discussion metadata", async () => {
    const project = await request<ProjectInfo>(ctx, "GET", projectPath);
    const targetBranch = project.default_branch ?? "main";
    const sourceBranch = `context-mr-${runId}`;
    const filePath = `docs/context-mr-${runId}.md`;

    await createBranch(ctx, projectPath, sourceBranch, targetBranch);
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/repository/branches/${encodeURIComponent(sourceBranch)}`);
    });

    await createOrUpdateFile(ctx, projectPath, sourceBranch, filePath, "# MR Context\n\nversion: 1\n");

    const mr = await request<MergeRequestInfo>(ctx, "POST", `${projectPath}/merge_requests`, {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title: `Context MR ${runId}`,
      description: "merge request context surface test",
      remove_source_branch: true,
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "PUT", `${projectPath}/merge_requests/${String(mr.iid)}`, { state_event: "close" });
    });
    expect(mr.source_branch).toBe(sourceBranch);
    expect(mr.target_branch).toBe(targetBranch);

    const updatedMr = await request<MergeRequestInfo>(ctx, "PUT", `${projectPath}/merge_requests/${String(mr.iid)}`, {
      description: "updated MR metadata",
    });
    expect(updatedMr.title).toContain(runId);

    const discussion = await request<DiscussionInfo>(ctx, "POST", `${projectPath}/merge_requests/${String(mr.iid)}/discussions`, {
      body: "review thread v1",
    });
    expect(discussion.notes[0]?.body).toBe("review thread v1");

    const noteId = discussion.notes[0]?.id;
    expect(noteId).toBeGreaterThan(0);
    const updatedNote = await request<{ readonly body: string }>(
      ctx,
      "PUT",
      `${projectPath}/merge_requests/${String(mr.iid)}/discussions/${discussion.id}/notes/${String(noteId)}`,
      { body: "review thread v2" },
    );
    expect(updatedNote.body).toBe("review thread v2");

    const readDiscussion = await request<DiscussionInfo>(
      ctx,
      "GET",
      `${projectPath}/merge_requests/${String(mr.iid)}/discussions/${discussion.id}`,
    );
    expect(readDiscussion.notes.some((n) => n.body === "review thread v2")).toBe(true);

    await request<unknown>(ctx, "PUT", `${projectPath}/merge_requests/${String(mr.iid)}`, { state_event: "close" });
    const closed = await request<MergeRequestInfo>(ctx, "GET", `${projectPath}/merge_requests/${String(mr.iid)}`);
    expect(closed.state).toBe("closed");
  }, 60_000);

  it("supports project issue board CRUD when the CE board API is enabled", async () => {
    const board = await request<BoardInfo>(ctx, "POST", `${projectPath}/boards`, {
      name: `Context Board ${runId}`,
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/boards/${String(board.id)}`);
    });
    expect(board.id).toBeGreaterThan(0);

    const boards = await request<ReadonlyArray<BoardInfo>>(ctx, "GET", `${projectPath}/boards`);
    expect(boards.some((b) => b.id === board.id)).toBe(true);

    const updated = await request<BoardInfo>(ctx, "PUT", `${projectPath}/boards/${String(board.id)}`, {
      name: `Context Board ${runId} updated`,
    });
    expect(updated.id).toBe(board.id);

    await request<unknown>(ctx, "DELETE", `${projectPath}/boards/${String(board.id)}`);
    const afterDelete = await request<ReadonlyArray<BoardInfo>>(ctx, "GET", `${projectPath}/boards`);
    expect(afterDelete.some((b) => b.id === board.id)).toBe(false);
  }, 60_000);

  it("supports pipeline record creation and cancellation from branch refs", async () => {
    const project = await request<ProjectInfo>(ctx, "GET", projectPath);
    const targetBranch = project.default_branch ?? "main";
    const branch = `context-pipeline-${runId}`;

    await createBranch(ctx, projectPath, branch, targetBranch);
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/repository/branches/${encodeURIComponent(branch)}`);
    });

    await createOrUpdateFile(
      ctx,
      projectPath,
      branch,
      ".gitlab-ci.yml",
      "context-smoke:\n  stage: test\n  script:\n    - echo context-smoke\n",
    );

    const pipeline = await request<PipelineInfo>(ctx, "POST", `${projectPath}/pipeline?ref=${encodeURIComponent(branch)}`);
    expect(pipeline.ref).toBe(branch);
    expect(pipeline.id).toBeGreaterThan(0);

    const read = await request<PipelineInfo>(ctx, "GET", `${projectPath}/pipelines/${String(pipeline.id)}`);
    expect(read.id).toBe(pipeline.id);

    const cancelled = await request<PipelineInfo>(ctx, "POST", `${projectPath}/pipelines/${String(pipeline.id)}/cancel`);
    expect(cancelled.id).toBe(pipeline.id);
    expect(["canceled", "canceling", "created", "pending", "running", "success", "failed", "skipped"]).toContain(cancelled.status);
  }, 60_000);

  it("probes release evidence availability on CE separately from release CRUD", async () => {
    const project = await request<ProjectInfo>(ctx, "GET", projectPath);
    const targetRef = project.default_branch ?? "main";
    const tagName = `v0.0.0-context-evidence-${runId}`;

    await request<ReleaseInfo>(ctx, "POST", `${projectPath}/releases`, {
      tag_name: tagName,
      ref: targetRef,
      name: `Context Evidence ${runId}`,
      description: "release evidence probe",
    });
    cleanup.push(async () => {
      await request<unknown>(ctx, "DELETE", `${projectPath}/releases/${encodeURIComponent(tagName)}`);
      await request<unknown>(ctx, "DELETE", `${projectPath}/repository/tags/${encodeURIComponent(tagName)}`);
    });

    const collect = await requestMaybe(ctx, "POST", `${projectPath}/releases/${encodeURIComponent(tagName)}/evidence`);
    expect([200, 201, 202, 403, 404, 405]).toContain(collect.status);

    const read = await requestMaybe(ctx, "GET", `${projectPath}/releases/${encodeURIComponent(tagName)}/evidence`);
    expect([200, 403, 404, 405]).toContain(read.status);

    if (read.status === 200) {
      expect(read.body).toBeTypeOf("object");
    }
  }, 60_000);
});

async function createBranch(ctx: GitlabContext, projectPath: string, branch: string, ref: string): Promise<void> {
  await request<unknown>(
    ctx,
    "POST",
    `${projectPath}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(ref)}`,
  );
}

async function createOrUpdateFile(
  ctx: GitlabContext,
  projectPath: string,
  branch: string,
  filePath: string,
  content: string,
): Promise<void> {
  const encodedFile = encodeURIComponent(filePath);
  const existing = await requestMaybe(ctx, "GET", `${projectPath}/repository/files/${encodedFile}?ref=${encodeURIComponent(branch)}`);
  if (existing.status === 200) {
    await request<unknown>(ctx, "PUT", `${projectPath}/repository/files/${encodedFile}`, {
      branch,
      commit_message: `test: update ${filePath}`,
      content,
    });
    return;
  }
  await request<unknown>(ctx, "POST", `${projectPath}/repository/files/${encodedFile}`, {
    branch,
    commit_message: `test: create ${filePath}`,
    content,
  });
}

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

async function requestMaybe(
  ctx: GitlabContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<MaybeResponse> {
  const res = await rawRequest(ctx, method, path, body);
  const text = await res.text().catch(() => "");
  let parsed: unknown = text;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
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
