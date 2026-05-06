import type { Issue, LabelConfig, Tracker } from "./types.js";

export interface GitlabTrackerOptions {
  /** GitLab base URL, e.g. "http://localhost:8929" — no trailing slash. */
  readonly baseUrl: string;
  /** Personal access token or project access token with `api` scope. */
  readonly token: string;
  /** Numeric project id (preferred) or URL-encoded namespace/path (e.g. `mygroup%2Fmyrepo`). */
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
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #projectId: string;
  readonly #fetch: typeof fetch;

  constructor(opts: GitlabTrackerOptions) {
    if (opts.baseUrl.endsWith("/")) {
      throw new Error("GitlabTracker: baseUrl must not end with '/'");
    }
    this.#baseUrl = opts.baseUrl;
    this.#token = opts.token;
    this.#projectId = String(opts.projectId);
    this.#fetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
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
    const path = `/api/v4/projects/${encodeURIComponent(this.#projectId)}/issues?${params.toString()}`;
    const raws = await this.#request<ReadonlyArray<GitlabIssueRaw>>("GET", path);

    const skip = new Set([labels.running, labels.done, labels.failed]);
    return raws
      .filter((r) => !r.labels.some((l) => skip.has(l)))
      .map((r) => normalizeIssue(r));
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
    const path = `/api/v4/projects/${encodeURIComponent(this.#projectId)}/issues/${encodeURIComponent(issueId)}`;
    await this.#request<unknown>("PUT", path, body);
  }

  async postNote(issueId: string, body: string): Promise<void> {
    const path = `/api/v4/projects/${encodeURIComponent(this.#projectId)}/issues/${encodeURIComponent(issueId)}/notes`;
    await this.#request<unknown>("POST", path, { body });
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "PRIVATE-TOKEN": this.#token,
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
    const res = await this.#fetch(`${this.#baseUrl}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GitlabApiError(method, path, res.status, text);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }
}

export class GitlabApiError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly responseBody: string;

  constructor(method: string, path: string, status: number, responseBody: string) {
    super(`GitLab API ${method} ${path} → ${status}`);
    this.name = "GitlabApiError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.responseBody = responseBody;
  }
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
