/**
 * Direct GitLab REST helpers used by integration tests. Intentionally separate
 * from `src/tracker.ts` so that tests can drive GitLab independently of the
 * code under test (creating fixtures, asserting raw state, cleaning up).
 */

export interface GitlabContext {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string | number;
}

export interface CreatedIssue {
  readonly id: number;
  readonly iid: number;
  readonly title: string;
  readonly web_url: string;
}

export interface IssueDetail {
  readonly iid: number;
  readonly title: string;
  readonly state: string;
  readonly labels: ReadonlyArray<string>;
}

export interface IssueNote {
  readonly id: number;
  readonly body: string;
  readonly system: boolean;
}

export async function createIssue(
  ctx: GitlabContext,
  args: { title: string; description?: string; labels: ReadonlyArray<string> },
): Promise<CreatedIssue> {
  const path = `/api/v4/projects/${encodeURIComponent(String(ctx.projectId))}/issues`;
  const body: Record<string, unknown> = {
    title: args.title,
    labels: args.labels.join(","),
  };
  if (args.description !== undefined) {
    body.description = args.description;
  }
  return await request<CreatedIssue>(ctx, "POST", path, body);
}

export async function getIssue(ctx: GitlabContext, iid: number | string): Promise<IssueDetail> {
  const path = `/api/v4/projects/${encodeURIComponent(String(ctx.projectId))}/issues/${encodeURIComponent(String(iid))}`;
  return await request<IssueDetail>(ctx, "GET", path);
}

export async function listNotes(
  ctx: GitlabContext,
  iid: number | string,
): Promise<ReadonlyArray<IssueNote>> {
  const path = `/api/v4/projects/${encodeURIComponent(String(ctx.projectId))}/issues/${encodeURIComponent(String(iid))}/notes?sort=asc&order_by=created_at`;
  return await request<ReadonlyArray<IssueNote>>(ctx, "GET", path);
}

export async function closeIssue(ctx: GitlabContext, iid: number | string): Promise<void> {
  const path = `/api/v4/projects/${encodeURIComponent(String(ctx.projectId))}/issues/${encodeURIComponent(String(iid))}`;
  await request<unknown>(ctx, "PUT", path, { state_event: "close" });
}

async function request<T>(
  ctx: GitlabContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
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
  if (payload !== undefined) {
    init.body = payload;
  }
  const res = await fetch(`${ctx.baseUrl}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitLab REST ${method} ${path} → ${String(res.status)}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
