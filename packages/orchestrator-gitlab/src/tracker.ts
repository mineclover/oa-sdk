import { GitlabApiError, GitlabProjectClient } from "./gitlab-client.js";
import type { Issue, LabelConfig, Tracker } from "./types.js";

export interface GitlabTrackerOptions {
  /** GitLab base URL, e.g. "http://localhost:8929" — no trailing slash. */
  readonly baseUrl: string;
  /** Personal access token or project access token with `api` scope. */
  readonly token: string;
  /** Numeric project id (preferred) or namespace/path (e.g. `mygroup/myrepo`). */
  readonly projectId: string | number;
  /** Optional fetch override for testing. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

interface GitlabIssueRaw {
  readonly id: number;
  readonly iid: number;
  readonly title: string;
  readonly description: string | null;
  readonly labels: ReadonlyArray<string>;
  readonly web_url: string;
  readonly state: string;
  readonly author?: { username?: string };
  readonly updated_at: string;
}

export class GitlabTracker implements Tracker {
  readonly #client: GitlabProjectClient;

  constructor(opts: GitlabTrackerOptions) {
    this.#client = new GitlabProjectClient(opts);
  }

  async listEligibleIssues(labels: LabelConfig): Promise<ReadonlyArray<Issue>> {
    // We pull anything labelled `ready` AND open. We then filter out anything
    // already labelled `running`/`done`/`failed` client-side — GitLab's REST
    // API supports `Not[labels]` only on EE, so this stays portable.
    const params = new URLSearchParams({
      labels: labels.ready,
      state: "opened",
      per_page: "50",
      order_by: "updated_at",
      sort: "asc",
    });
    const issuePages: GitlabIssueRaw[] = [];
    let nextPage: string | null = null;

    do {
      const requestParams = new URLSearchParams(params);
      if (nextPage !== null) requestParams.set("page", nextPage);

      const path = this.#client.projectApiPath(`/issues?${requestParams.toString()}`);
      const response = await this.#client.requestMaybe<ReadonlyArray<GitlabIssueRaw>>("GET", path);
      if (!response.ok) {
        const text = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
        throw new GitlabApiError("GET", path, response.status, text);
      }

      if (Array.isArray(response.body)) {
        issuePages.push(...response.body);
      }
      nextPage = nextIssuePage(response.headers);
    } while (nextPage !== null);

    const skip = new Set([labels.running, labels.done, labels.failed]);
    return issuePages
      .filter((r) => !r.labels.some((l) => skip.has(l)))
      .map((r) => normalizeIssue(r));
  }

  async getIssue(issueId: string): Promise<Issue> {
    const path = this.#client.projectApiPath(`/issues/${encodeURIComponent(issueId)}`);
    const raw = await this.#client.request<GitlabIssueRaw>("GET", path);
    return normalizeIssue(raw);
  }

  async transitionLabels(
    issueId: string,
    transition: { add?: ReadonlyArray<string>; remove?: ReadonlyArray<string> },
  ): Promise<void> {
    const body: Record<string, string> = {};
    if (transition.add !== undefined && transition.add.length > 0) {
      body.add_labels = transition.add.join(",");
    }
    if (transition.remove !== undefined && transition.remove.length > 0) {
      body.remove_labels = transition.remove.join(",");
    }
    if (Object.keys(body).length === 0) return;

    // We need the IID for the issue update endpoint, not the global id. The
    // orchestrator tracks issues by id (stable) but here we need the IID. We
    // recover it from a side-channel: the orchestrator passes IID-as-id when
    // calling tracker methods. To keep that contract honest, expose the IID
    // via Issue.iid and have orchestrator pass IID into these methods.
    const path = this.#client.projectApiPath(`/issues/${encodeURIComponent(issueId)}`);
    await this.#client.request<unknown>("PUT", path, body);
  }

  async postNote(issueId: string, body: string): Promise<void> {
    const path = this.#client.projectApiPath(`/issues/${encodeURIComponent(issueId)}/notes`);
    await this.#client.request<unknown>("POST", path, { body });
  }
}
export { GitlabApiError };

function nextIssuePage(headers: Headers): string | null {
  const xNextPage = Number.parseInt(headers.get("x-next-page") ?? "", 10);
  if (Number.isInteger(xNextPage) && xNextPage > 0) {
    return String(xNextPage);
  }

  const currentPage = Number.parseInt(headers.get("x-page") ?? "", 10);
  const totalPages = Number.parseInt(headers.get("x-total-pages") ?? "", 10);
  if (Number.isInteger(currentPage) && Number.isInteger(totalPages) && currentPage < totalPages) {
    return String(currentPage + 1);
  }

  const linkHeader = headers.get("link");
  if (linkHeader === null) return null;

  const nextLinkMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  if (nextLinkMatch === null || nextLinkMatch[1] === undefined) return null;
  try {
    const nextPage = new URL(nextLinkMatch[1]).searchParams.get("page");
    const parsed = Number.parseInt(nextPage ?? "", 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return String(parsed);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeIssue(r: GitlabIssueRaw): Issue {
  return {
    id: String(r.iid), // we use iid as the addressable id (see comment in transitionLabels)
    iid: String(r.iid),
    title: r.title,
    description: r.description ?? "",
    labels: r.labels,
    url: r.web_url,
    state: r.state,
    authorUsername: r.author?.username,
    updatedAt: r.updated_at,
  };
}
